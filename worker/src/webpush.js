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
/** @param {unknown} obj */
const b64json = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));

/** Ako dlho platí podpis a ako dlho push služba drží budenie, kým telefón nie je online. */
const JWT_H = 12;
const TTL_S = OZNAMENIA.stepMin * 60;

/**
 * Adresa odberu, na ktorú smie Worker poslať push: https a server jednej zo známych push služieb
 * (OZNAMENIA.pushHosts, s bodkou na začiatku aj ich poddomény). Inak by z Workera bol proxy na čokoľvek.
 * @param {unknown} endpoint
 */
export function platnyOdber(endpoint) {
    if (typeof endpoint !== 'string' || endpoint.length > OZNAMENIA.maxEndpoint) return false;
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
 * Hlavička Authorization s podpisom VAPID pre push službu odberu.
 * @param {string} endpoint @param {string} jwkJson súkromný kľúč (tajomstvo VAPID_JWK) @param {Date} now
 */
export async function vapidAuth(endpoint, jwkJson, now) {
    const key = await crypto.subtle.importKey('jwk', JSON.parse(jwkJson), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const claims = { aud: new URL(endpoint).origin, exp: Math.floor(now.getTime() / 1000) + JWT_H * 3600, sub: APP_URL };
    const unsigned = `${b64json({ typ: 'JWT', alg: 'ES256' })}.${b64json(claims)}`;
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned));
    return `vapid t=${unsigned}.${b64url(sig)}, k=${OZNAMENIA.vapidPublic}`;
}

/**
 * Pošle prázdny push. Vráti stav odpovede push služby: 201 doručené na službu, 404/410 odber už
 * neplatí (Worker ho zmaže).
 * @param {string} endpoint @param {string} jwkJson @param {Date} now @param {typeof fetch} fetchImpl
 */
export async function posliPush(endpoint, jwkJson, now, fetchImpl) {
    const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { authorization: await vapidAuth(endpoint, jwkJson, now), ttl: String(TTL_S), urgency: 'high', 'content-length': '0' },
    });
    return res.status;
}
