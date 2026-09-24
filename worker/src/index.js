// Cloudflare Worker: živé meranie pre appku. POST /pv stiahne kiosk Huawei FusionSolar,
// ktorého odkaz si používateľ zadal v Nastavení, a vráti ho vo formáte `pv`. Prehliadač
// by sa na kiosk priamo nedostal. Worker nič neukladá - nemá úložisko ani plánované behy.

import { fetchWithRetry } from '../../shared/http.js';
import { kioskApiUrl, parseKiosk } from '../../shared/kiosk.js';

const CORS_HEADERS = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
};

/** @param {number} status @param {unknown} body */
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });

/**
 * POST /pv: živé meranie z kiosku, ktorého odkaz je v tele požiadavky (text). Worker z neho
 * vezme len server a kľúč kiosku a adresu dát si zloží sám, takže nesťahuje nič iné než
 * kiosk FusionSolar. Odkaz si nikam neukladá.
 * @param {Request} request @param {Date} now @param {typeof fetch} fetchImpl
 */
export async function handlePv(request, now, fetchImpl = fetch) {
    const url = kioskApiUrl((await request.text()).slice(0, 2000));
    if (!url) return json(400, { error: 'odkaz nie je kiosk FusionSolar' });
    try {
        const res = await fetchWithRetry(url, {}, { fetchImpl, attempts: 2, delayMs: 500 });
        return json(200, { pv: parseKiosk(await res.json(), now), servedAt: now.toISOString() });
    } catch {
        // Bez podrobností: tie by mohli obsahovať odkaz, a ten do odpovedí ani logov nepatrí.
        return json(502, { error: 'kiosk neodpovedá alebo vrátil nečakané dáta' });
    }
}

/** @param {Request} request @param {Date} [now] @param {typeof fetch} [fetchImpl] */
export async function handleRequest(request, now = new Date(), fetchImpl = fetch) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (new URL(request.url).pathname !== '/pv') return json(404, { error: 'not found' });
    if (request.method !== 'POST') return json(405, { error: 'method not allowed' });
    return handlePv(request, now, fetchImpl);
}

export default {
    /** @param {Request} request */
    fetch(request) {
        return handleRequest(request);
    },
};
