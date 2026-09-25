import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handlePv, handleRequest } from '../src/index.js';

const fixture = (/** @type {string} */ name) => readFileSync(new URL(`../../test/fixtures/${name}`, import.meta.url), 'utf8');
const NOW = new Date('2026-09-05T11:00:00Z');

/** @param {Record<string, string | null>} routes */
function fakeFetch(routes) {
    return /** @type {typeof fetch} */ (
        /** @type {unknown} */ (
            async (/** @type {string} */ url) => {
                const body = routes[url];
                if (body === undefined) return new Response('not found', { status: 404 });
                if (body === null) return new Response('boom', { status: 500 });
                return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
            }
        )
    );
}

const KIOSK_PAGE = 'https://region01eu5.fusionsolar.huawei.com/pvmswebsite/nologin/assets/build/index.html#/kiosk?kk=Abc123xyz';
const KIOSK_API = 'https://region01eu5.fusionsolar.huawei.com/rest/pvms/web/kiosk/v1/station-kiosk-file?kk=Abc123xyz';
const pvRequest = (/** @type {string} */ body) => new Request('https://w.test/pv', { method: 'POST', body });

test('POST /pv: odkaz na kiosk od používateľa vráti pv, Worker sťahuje len adresu dát kiosku', async () => {
    /** @type {string[]} */ const calls = [];
    const f = fakeFetch({ [KIOSK_API]: fixture('kiosk.json') });
    const spy = /** @type {typeof fetch} */ (/** @type {unknown} */ (async (/** @type {string} */ url) => (calls.push(url), f(url))));
    const res = await handleRequest(pvRequest(KIOSK_PAGE), NOW, spy);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json();
    assert.equal(body.pv.realTimePowerKw, 6.412);
    assert.equal(body.pv.updatedAt, NOW.toISOString());
    assert.deepEqual(calls, [KIOSK_API]);
});

test('POST /pv: cudzí odkaz 400 bez sťahovania, výpadok kiosku 502 bez odkazu v odpovedi', async () => {
    let called = false;
    const never = /** @type {typeof fetch} */ (/** @type {unknown} */ (async () => ((called = true), new Response('{}'))));
    const bad = await handlePv(pvRequest('https://example.com/?kk=Abc123xyz'), NOW, never);
    assert.equal(bad.status, 400);
    assert.equal(called, false);
    const down = await handlePv(pvRequest(KIOSK_PAGE), NOW, fakeFetch({ [KIOSK_API]: null }));
    assert.equal(down.status, 502);
    assert.ok(!(await down.text()).includes('Abc123xyz'));
    const junk = await handlePv(pvRequest(KIOSK_PAGE), NOW, fakeFetch({ [KIOSK_API]: '{"nie":"kiosk"}' }));
    assert.equal(junk.status, 502);
});

test('POST /pv: neplatný kľúč (kiosk vráti 404) sa neopakuje, výpadok servera áno', async () => {
    /** @type {string[]} */ const calls = [];
    /** @param {number} status */
    const kiosk = (status) =>
        /** @type {typeof fetch} */ (
            /** @type {unknown} */ (async (/** @type {string} */ url) => (calls.push(url), new Response('x', { status })))
        );
    assert.equal((await handlePv(pvRequest(KIOSK_PAGE), NOW, kiosk(404))).status, 502);
    assert.equal(calls.length, 1, 'druhý pokus by dopadol rovnako');
    calls.length = 0;
    assert.equal((await handlePv(pvRequest(KIOSK_PAGE), NOW, kiosk(503))).status, 502);
    assert.equal(calls.length, 2);
});

test('iné cesty 404, iné metódy 405, OPTIONS 204', async () => {
    assert.equal((await handleRequest(new Request('https://w.test/'), NOW)).status, 404);
    assert.equal((await handleRequest(new Request('https://w.test/status'), NOW)).status, 404);
    assert.equal((await handleRequest(new Request('https://w.test/pv'), NOW)).status, 405);
    const options = await handleRequest(new Request('https://w.test/pv', { method: 'OPTIONS' }), NOW);
    assert.equal(options.status, 204);
    assert.equal(options.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
});
