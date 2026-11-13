import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRASY } from '../../shared/config.js';
import { handleRequest } from '../src/index.js';

const post = (/** @type {string} */ body) => new Request('https://w.test/trasy', { method: 'POST', body });

/**
 * Podvrhnutý smerovač: zapíše adresy a odpovie tabuľkou, kde je každé mesto o 100 km ďalej.
 * @param {{ status?: number, pada?: boolean }} [o]
 */
function osrm({ status = 200, pada = false } = {}) {
    /** @type {string[]} */ const adresy = [];
    const impl = /** @type {typeof fetch} */ (
        /** @type {unknown} */ (
            async (/** @type {string} */ url) => {
                adresy.push(url);
                if (pada) throw new Error('timeout');
                const body = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
                const n = body.split(';').length;
                const tabulka = {
                    code: 'Ok',
                    sources: [{ distance: 10 }],
                    destinations: Array.from({ length: n }, () => ({ distance: 10 })),
                    distances: [Array.from({ length: n }, (_, i) => i * 100000)],
                };
                return new Response(JSON.stringify(tabulka), { status });
            }
        )
    );
    return { impl, adresy };
}

test('POST /trasy: zaokrúhlená poloha, jedna požiadavka na smerovač, id a km miest', async () => {
    const o = osrm();
    const res = await handleRequest(post(JSON.stringify({ lat: 48.4812, lon: 18.1249 })), {}, new Date(), o.impl);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(o.adresy.length, 1);
    assert.ok(o.adresy[0].startsWith(`${TRASY.osrmUrl}18.12,48.48;`), 'dom prvý a zaokrúhlený');
    assert.equal(body.trasy.length, TRASY.najviacMiest);
    assert.deepEqual(body.trasy[0], { id: 'nitra', km: 100 });
});

test('POST /trasy: zlé telo 400, výpadok smerovača 502, uprostred oceánu bez požiadavky prázdne', async () => {
    for (const body of ['', 'x', '{"lat":"48","lon":18}', '{"lat":91,"lon":18}', '[]']) {
        const res = await handleRequest(post(body), {}, new Date(), osrm().impl);
        assert.equal(res.status, 400, body);
    }
    const chyba = await handleRequest(post('{"lat":48.48,"lon":18.12}'), {}, new Date(), osrm({ status: 503 }).impl);
    assert.equal(chyba.status, 502);
    const pada = await handleRequest(post('{"lat":48.48,"lon":18.12}'), {}, new Date(), osrm({ pada: true }).impl);
    assert.equal(pada.status, 502);
    const o = osrm();
    const ocean = await handleRequest(post('{"lat":0,"lon":-140}'), {}, new Date(), o.impl);
    assert.deepEqual(await ocean.json(), { trasy: [] });
    assert.equal(o.adresy.length, 0);
});
