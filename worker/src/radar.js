// Karta Radar: GET /radar/<snímka>?b=<bloky>. Prehliadač sa k súborom OPERA nedostane (server neposiela
// CORS) a celý súbor by mu bol zbytočný. Worker prečíta index na začiatku súboru a pošle len
// požadované bloky, nespracúva ich. Výsledok drží cache Cloudflare, snímka sa už nemení.

import { RADAR } from '../../shared/config.js';
import { hdf5Bloky } from '../../shared/radar-data.js';

const HLAVICKA = { 'access-control-allow-origin': '*' };
const NAJVIAC_BLOKOV = 4;
/** Kde v súbore končí hlavička s indexom (prvé dáta začínali na 13 kB). */
const HLAVICKA_BAJTOV = 16384;

/** @param {string} zdroj @param {string} tag */
function adresa(zdroj, tag) {
    const den = `${tag.slice(0, 4)}/${tag.slice(4, 6)}/${tag.slice(6, 8)}`;
    return `${zdroj}${den}/OPERA/COMP/OPERA@${tag}@0@DBZH.h5`;
}

/** Bloky z adresy. Iba násobky rozmerov bloku v mriežke, inak null. @param {string | null} b */
export function parseBloky(b) {
    if (!b) return null;
    const bloky = b.split(',').map((s) => s.split('_').map(Number));
    const dobre = bloky.every(
        ([row, col, navyse]) =>
            navyse === undefined &&
            Number.isInteger(row) &&
            Number.isInteger(col) &&
            row >= 0 &&
            col >= 0 &&
            row < RADAR.riadky &&
            col < RADAR.stlpce &&
            row % RADAR.blokRiadky === 0 &&
            col % RADAR.blokStlpce === 0,
    );
    return dobre && bloky.length <= NAJVIAC_BLOKOV ? bloky : null;
}

/**
 * Index súboru. Snímka, ktorá ešte nie je zverejnená, je 404 a nesmie ostať v cache: o chvíľu už bude.
 * @param {string} subor @param {typeof fetch} fetchImpl
 */
async function indexSuboru(subor, fetchImpl) {
    const r = await fetchImpl(subor, { headers: { range: `bytes=0-${HLAVICKA_BAJTOV - 1}` } });
    if (r.status === 403 || r.status === 404) return { status: 404 };
    return r.status === 206 ? { bloky: hdf5Bloky(await r.arrayBuffer()) } : { status: 502 };
}

/**
 * Prvý zdroj z RADAR.s3, ktorý snímku má. Chýbajúca (404) posunie na ďalší zdroj, výpadok (502) nie:
 * vtedy nevieme, či by ju ďalší mal novšiu či inú.
 * @param {string} tag @param {typeof fetch} fetchImpl
 */
async function najdiSubor(tag, fetchImpl) {
    for (const zdroj of RADAR.s3) {
        const subor = adresa(zdroj, tag);
        const index = await indexSuboru(subor, fetchImpl);
        if (index.status !== 404) return { subor, ...index };
    }
    return { subor: '', status: 404, bloky: undefined };
}

/**
 * Hlavička s rozmermi a bloky za ňou.
 * @param {string} subor @param {Array<{ row: number, col: number, size: number, addr: number }>} vyber @param {typeof fetch} fetchImpl
 */
async function teloOdpovede(subor, vyber, fetchImpl) {
    const casti = await Promise.all(
        vyber.map((b) => fetchImpl(subor, { headers: { range: `bytes=${b.addr}-${b.addr + b.size - 1}` } }).then((r) => r.arrayBuffer())),
    );
    const meta = new TextEncoder().encode(JSON.stringify(vyber.map(({ row, col, size }) => ({ row, col, size }))));
    const dlzka = new Uint8Array(4);
    new DataView(dlzka.buffer).setUint32(0, meta.length, true);
    return new Blob([dlzka, meta, ...casti]);
}

/**
 * @param {Request} request @param {{ fetchImpl: typeof fetch, cache: Cache | null, waitUntil: (p: Promise<unknown>) => void }} ctx
 */
export async function handleRadar(request, { fetchImpl, cache, waitUntil }) {
    const url = new URL(request.url);
    const tag = /^\/radar\/(\d{8}T\d{4})$/.exec(url.pathname)?.[1];
    const chcem = parseBloky(url.searchParams.get('b'));
    if (request.method !== 'GET' || !tag || !chcem) return new Response('', { status: 400, headers: HLAVICKA });
    const hit = await cache?.match(request);
    if (hit) return hit;
    const { subor, bloky, status } = await najdiSubor(tag, fetchImpl);
    if (status) return new Response('', { status, headers: { ...HLAVICKA, 'cache-control': 'no-store' } });
    const vyber = bloky?.filter((b) => chcem.some(([row, col]) => row === b.row && col === b.col));
    if (!vyber?.length) return new Response('', { status: 502, headers: HLAVICKA });
    const res = new Response(await teloOdpovede(subor, vyber, fetchImpl), {
        headers: { ...HLAVICKA, 'content-type': 'application/octet-stream', 'cache-control': 'public, max-age=86400' },
    });
    if (cache) waitUntil(cache.put(request, res.clone()));
    return res;
}
