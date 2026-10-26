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

/**
 * Pošle prázdny push. Vráti stav odpovede push služby: 201 doručené na službu, 404/410 odber už
 * neplatí (Worker ho zmaže).
 * @param {string} endpoint @param {{ key: CryptoKey, k: string }} klic @param {Date} now @param {typeof fetch} fetchImpl
 */
export async function posliPush(endpoint, klic, now, fetchImpl) {
    const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { authorization: await vapidAuth(endpoint, klic, now), ttl: String(TTL_S), urgency: 'high', 'content-length': '0' },
    });
    return res.status;
}
