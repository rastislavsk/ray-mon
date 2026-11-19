// Web Push bez obsahu: Worker telefón len zobudí, text si service worker (sw.js) vypočíta sám
// z čerstvej predpovede. Bez obsahu netreba šifrovať telo (RFC 8291), stačí podpis VAPID
// (RFC 8292) - JWT podpísaný kľúčom P-256 cez WebCrypto, žiadna knižnica.

import { APP_URL, OZNAMENIA } from '../../shared/config.js';

/** @param {Uint8Array | ArrayBuffer} bytes */
const b64url = (bytes) =>
    btoa(String.fromCharCode(...new Uint8Array(bytes)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
/** @param {string} s */
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
/** @param {unknown} obj */
const b64json = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));

/** Ako dlho push služba drží budenie, kým telefón nie je online - neskoré ranné oznámenie nemá zmysel. */
const TTL_S = OZNAMENIA.stepMin * 60;

/**
 * Adresa odberu, na ktorú smie Worker poslať push: https, len tlačiteľné znaky ASCII (metadáta KV
 * majú limit v bajtoch) a server jednej zo známych push služieb (OZNAMENIA.pushHosts, s bodkou na
 * začiatku aj ich poddomény). Inak by z Workera bol proxy na čokoľvek.
 * @param {unknown} endpoint
 */
export function platnyOdber(endpoint) {
    if (typeof endpoint !== 'string' || endpoint.length > OZNAMENIA.maxEndpoint || !/^[\x21-\x7e]+$/.test(endpoint)) return false;
    try {
        const url = new URL(endpoint);
        return (
            url.protocol === 'https:' &&
            OZNAMENIA.pushHosts.some((h) => (h.startsWith('.') ? url.hostname.endsWith(h) : url.hostname === h))
        );
    } catch {
        return false;
    }
}

/**
 * Kľúč VAPID z tajomstva: súkromný na podpis a verejný (`k`) odvodený z toho istého JWK - push služba
 * podpis overí len kľúčom, s ktorým sa telefón prihlásil (OZNAMENIA.vapidPublic). Keď nesedia,
 * každý push skončí 403, preto to `match` povie a budenie to zapíše do logu.
 * @param {string} jwkJson súkromný kľúč (tajomstvo VAPID_JWK)
 */
export async function vapidKlic(jwkJson) {
    const jwk = JSON.parse(jwkJson);
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const k = b64url(new Uint8Array([4, ...fromB64url(jwk.x), ...fromB64url(jwk.y)]));
    return { key, k, match: k === OZNAMENIA.vapidPublic };
}

/**
 * Hlavička Authorization s podpisom VAPID pre push službu odberu.
 * @param {string} endpoint @param {{ key: CryptoKey, k: string }} klic @param {Date} now
 */
export async function vapidAuth(endpoint, { key, k }, now) {
    const claims = { aud: new URL(endpoint).origin, exp: Math.floor(now.getTime() / 1000) + OZNAMENIA.jwtH * 3600, sub: APP_URL };
    const unsigned = `${b64json({ typ: 'JWT', alg: 'ES256' })}.${b64json(claims)}`;
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned));
    return `vapid t=${unsigned}.${b64url(sig)}, k=${k}`;
}

/** Bajty za sebou. @param {...Uint8Array} casti @returns {Uint8Array<ArrayBuffer>} */
function spoj(...casti) {
    const out = new Uint8Array(casti.reduce((n, c) => n + c.length, 0));
    let i = 0;
    for (const c of casti) {
        out.set(c, i);
        i += c.length;
    }
    return out;
}

/** HKDF-SHA-256 (extract aj expand) na `dlzka` bajtov. @param {BufferSource} salt @param {BufferSource} ikm @param {BufferSource} info @param {number} dlzka */
async function hkdf(salt, ikm, info, dlzka) {
    const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, dlzka * 8));
}

const TEXT = new TextEncoder();

/**
 * Telo pushu s obsahom (docs/navrhy/spotrebic-koniec-opakovanie.html): `text` zašifrovaný pre odber s kľúčmi `keys`
 * podľa RFC 8291 (aes128gcm, jeden záznam) - prečítať ho vie len telefón. Kľúč odosielateľa a soľ sú pri každom
 * pushi nové; `pevne` ich dá len test so známymi hodnotami z RFC.
 * @param {string} text @param {{ p256dh: string, auth: string }} keys
 * @param {{ as?: CryptoKeyPair, salt?: Uint8Array<ArrayBuffer> }} [pevne]
 */
export async function zasifruj(text, keys, pevne = {}) {
    const uaPub = fromB64url(keys.p256dh);
    const as =
        pevne.as ??
        /** @type {CryptoKeyPair} */ (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']));
    const asPub = new Uint8Array(/** @type {ArrayBuffer} */ (await crypto.subtle.exportKey('raw', as.publicKey)));
    const ua = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const ecdh = new Uint8Array(await crypto.subtle.deriveBits(/** @type {any} */ ({ name: 'ECDH', public: ua }), as.privateKey, 256));
    const ikm = await hkdf(fromB64url(keys.auth), ecdh, spoj(TEXT.encode('WebPush: info\0'), uaPub, asPub), 32);
    const salt = pevne.salt ?? crypto.getRandomValues(new Uint8Array(16));
    const cek = await hkdf(salt, ikm, TEXT.encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(salt, ikm, TEXT.encode('Content-Encoding: nonce\0'), 12);
    const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
    // Posledný (a jediný) záznam končí oddeľovačom 2.
    const sifra = new Uint8Array(
        await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, spoj(TEXT.encode(text), new Uint8Array([2]))),
    );
    const hlava = new Uint8Array(16 + 4 + 1 + asPub.length);
    hlava.set(salt);
    new DataView(hlava.buffer).setUint32(16, 4096);
    hlava[20] = asPub.length;
    hlava.set(asPub, 21);
    return spoj(hlava, sifra);
}

/**
 * Pošle push: prázdny (ranné oznámenie si text vypočíta service worker), alebo s obsahom `obsah` - JSON zašifrovaný
 * pre kľúče odberu. Vráti stav odpovede push služby: 201 doručené na službu, 404/410 odber už neplatí (Worker ho zmaže).
 * @param {string} endpoint @param {{ key: CryptoKey, k: string }} klic @param {Date} now @param {typeof fetch} fetchImpl
 * @param {{ data: object, keys: { p256dh: string, auth: string } }} [obsah]
 */
export async function posliPush(endpoint, klic, now, fetchImpl, obsah) {
    const telo = obsah ? await zasifruj(JSON.stringify(obsah.data), obsah.keys) : null;
    const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
            authorization: await vapidAuth(endpoint, klic, now),
            ttl: String(TTL_S),
            urgency: 'high',
            ...(telo ? { 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream' } : { 'content-length': '0' }),
        },
        ...(telo ? { body: telo } : {}),
    });
    return res.status;
}

/**
 * Kľúče odberu z tela požiadavky (`p256dh` verejný kľúč P-256, `auth` 16 bajtov), inak null.
 * @param {unknown} keys @returns {{ p256dh: string, auth: string } | null}
 */
export function klucOdberu(keys) {
    if (!keys || typeof keys !== 'object') return null;
    const { p256dh, auth } = /** @type {Record<string, unknown>} */ (keys);
    const b64 = (/** @type {unknown} */ s, /** @type {number} */ n) =>
        typeof s === 'string' && /^[A-Za-z0-9_-]+$/.test(s) && fromB64url(s).length === n;
    return b64(p256dh, 65) && b64(auth, 16) ? { p256dh: /** @type {string} */ (p256dh), auth: /** @type {string} */ (auth) } : null;
}
