import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RADAR } from '../../shared/config.js';
import { handleRadar, parseBloky } from '../src/radar.js';

const URL_OK = 'https://x.dev/radar/20261107T0730?b=2280_1760';

/** Hlavička súboru s jedným blokom v indexe. */
function hlavicka() {
    const buf = new ArrayBuffer(16384);
    const b = new Uint8Array(buf);
    const v = new DataView(buf);
    b.set([84, 82, 69, 69, 1, 0], 100);
    v.setUint16(106, 1, true);
    v.setUint32(124, 3, true);
    v.setBigUint64(132, 2280n, true);
    v.setBigUint64(140, 1760n, true);
    v.setBigUint64(156, 20000n, true);
    return buf;
}

/** @param {number} [status] */
function server(status = 206) {
    /** @type {string[]} */ const rozsahy = [];
    const fetchImpl = /** @type {typeof fetch} */ (
        /** @type {unknown} */ (
            async (/** @type {string} */ _url, /** @type {{ headers: { range: string } }} */ init) => {
                rozsahy.push(init.headers.range);
                if (status !== 206) return new Response('', { status });
                return new Response(init.headers.range.startsWith('bytes=0-') ? hlavicka() : new Uint8Array([1, 2, 3]), { status });
            }
        )
    );
    return { fetchImpl, rozsahy, cache: null, waitUntil: () => {} };
}

test('parseBloky: len násobky bloku v mriežke, najviac štyri', () => {
    assert.deepEqual(parseBloky('2280_1760,3040_880'), [
        [2280, 1760],
        [3040, 880],
    ]);
    assert.equal(parseBloky(null), null);
    assert.equal(parseBloky('1_1'), null);
    assert.equal(parseBloky('5320_0'.replace('5320', '5320')), null);
    assert.equal(parseBloky('760_880_1'), null);
    assert.equal(parseBloky('a_b'), null);
    assert.equal(parseBloky('0_0,0_880,0_1760,0_2640,760_0'), null);
});

test('handleRadar: pošle len požadovaný blok', async () => {
    const s = server();
    const r = await handleRadar(new Request(URL_OK), s);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.deepEqual(s.rozsahy, ['bytes=0-16383', 'bytes=20000-20002']);
    const buf = await r.arrayBuffer();
    const dlzka = new DataView(buf).getUint32(0, true);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, dlzka))), [{ row: 2280, col: 1760, size: 3 }]);
    assert.deepEqual([...new Uint8Array(buf, 4 + dlzka)], [1, 2, 3]);
});

test('handleRadar: zlá adresa a metóda', async () => {
    const s = server();
    assert.equal((await handleRadar(new Request('https://x.dev/radar/abc?b=0_0'), s)).status, 400);
    assert.equal((await handleRadar(new Request('https://x.dev/radar/20261107T0730?b=1_1'), s)).status, 400);
    assert.equal((await handleRadar(new Request(URL_OK, { method: 'POST' }), s)).status, 400);
    assert.deepEqual(s.rozsahy, []);
});

test('handleRadar: nezverejnená snímka je 404 bez cache, výpadok 502', async () => {
    const r = await handleRadar(new Request(URL_OK), server(404));
    assert.equal(r.status, 404);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal((await handleRadar(new Request(URL_OK), server(403))).status, 404);
    assert.equal((await handleRadar(new Request(URL_OK), server(500))).status, 502);
});

test('handleRadar: snímku, ktorú hlavný zdroj nemá, vezme zo zálohy, aj s blokmi', async () => {
    /** @type {string[]} */ const adresy = [];
    const fetchImpl = /** @type {typeof fetch} */ (
        /** @type {unknown} */ (
            async (/** @type {string} */ url, /** @type {{ headers: { range: string } }} */ init) => {
                adresy.push(url);
                if (url.startsWith(RADAR.s3[0])) return new Response('', { status: 404 });
                return new Response(init.headers.range.startsWith('bytes=0-') ? hlavicka() : new Uint8Array([1, 2, 3]), { status: 206 });
            }
        )
    );
    const r = await handleRadar(new Request(URL_OK), { fetchImpl, cache: null, waitUntil: () => {} });
    assert.equal(r.status, 200);
    assert.deepEqual(
        adresy.map((a) => RADAR.s3.findIndex((z) => a.startsWith(z))),
        [0, 1, 1],
    );
    assert.ok(adresy[1].endsWith('2026/11/07/OPERA/COMP/OPERA@20261107T0730@0@DBZH.h5'));
});

test('handleRadar: výpadok hlavného zdroja zálohu neskúša', async () => {
    const s = server(500);
    assert.equal((await handleRadar(new Request(URL_OK), s)).status, 502);
    assert.equal(s.rozsahy.length, 1);
});

test('handleRadar: blok, ktorý súbor nemá, je 502', async () => {
    const r = await handleRadar(new Request('https://x.dev/radar/20261107T0730?b=0_0'), server());
    assert.equal(r.status, 502);
});

test('handleRadar: cache odpovie bez servera a nová odpoveď sa do nej uloží', async () => {
    /** @type {Promise<unknown>[]} */ const cakaj = [];
    /** @type {Map<string, Response>} */ const pamat = new Map();
    const cache = /** @type {any} */ ({
        match: async (/** @type {Request} */ q) => pamat.get(q.url),
        put: async (/** @type {Request} */ q, /** @type {Response} */ r) => void pamat.set(q.url, r),
    });
    const s = { ...server(), cache, waitUntil: (/** @type {Promise<unknown>} */ p) => void cakaj.push(p) };
    await handleRadar(new Request(URL_OK), s);
    await Promise.all(cakaj);
    const pocet = s.rozsahy.length;
    const r = await handleRadar(new Request(URL_OK), s);
    assert.equal(r.status, 200);
    assert.equal(s.rozsahy.length, pocet);
});
