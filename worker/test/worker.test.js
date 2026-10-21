import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handlePripoj, handlePv, handleRequest } from '../src/index.js';
import { otvor, pecatKey, zapecat } from '../src/pecat.js';

const fixture = (/** @type {string} */ name) => readFileSync(new URL(`../../test/fixtures/${name}`, import.meta.url), 'utf8');
const NOW = new Date('2026-09-05T11:00:00Z');
// Tajný kľúč len pre testy (32 bajtov v base64); skutočný je v nastavení Workera.
const ENV = { PECAT_KLUC: btoa('0123456789abcdef0123456789abcdef') };
const INY = { PECAT_KLUC: btoa('fedcba9876543210fedcba9876543210') };

/** Podvrhnutý fetch: stačí mu adresa, typ `fetch` mu dá toto jediné pretypovanie. @param {(url: string) => Promise<Response>} fn */
const asFetch = (fn) => /** @type {typeof fetch} */ (/** @type {unknown} */ (fn));

/** @param {Record<string, string | null>} routes */
function fakeFetch(routes) {
    return asFetch(async (url) => {
        const body = routes[url];
        if (body === undefined) return new Response('not found', { status: 404 });
        if (body === null) return new Response('boom', { status: 500 });
        return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    });
}

const KIOSK_PAGE = 'https://region01eu5.fusionsolar.huawei.com/pvmswebsite/nologin/assets/build/index.html#/kiosk?kk=Abc123xyz';
const KIOSK_API = 'https://region01eu5.fusionsolar.huawei.com/rest/pvms/web/kiosk/v1/station-kiosk-file?kk=Abc123xyz';
const post = (/** @type {string} */ path, /** @type {string} */ body) => new Request(`https://w.test${path}`, { method: 'POST', body });
const pvRequest = (/** @type {string} */ body) => post('/pv', body);
const pripojRequest = (/** @type {unknown} */ body) => post('/pripoj', JSON.stringify(body));
const kioskOk = () => fakeFetch({ [KIOSK_API]: fixture('kiosk.json') });

test('pečať: zapečatený prístup sa otvorí len tým istým kľúčom a nedá sa v ňom nič prečítať', async () => {
    const key = /** @type {Promise<CryptoKey>} */ (pecatKey(ENV.PECAT_KLUC));
    const pecat = await zapecat(key, { sposob: 'huawei-kiosk', pristup: { odkaz: KIOSK_PAGE } });
    assert.match(pecat, /^v1\.[A-Za-z0-9_-]+$/);
    assert.ok(!pecat.includes('Abc123xyz'));
    assert.notEqual(await zapecat(key, { sposob: 'huawei-kiosk', pristup: { odkaz: KIOSK_PAGE } }), pecat, 'zakaždým iný vektor');
    assert.deepEqual(await otvor(key, pecat), { sposob: 'huawei-kiosk', pristup: { odkaz: KIOSK_PAGE } });
    const iny = /** @type {Promise<CryptoKey>} */ (pecatKey(INY.PECAT_KLUC));
    assert.equal(await otvor(iny, pecat), null);
    assert.equal(await otvor(key, `${pecat.slice(0, -2)}AA`), null, 'pozmenený balíček');
    assert.equal(await otvor(key, 'v2.abc'), null);
    assert.equal(pecatKey(undefined), null);
    assert.throws(() => pecatKey(btoa('kratky')), /32 bajtov/);
});

test('POST /pripoj: kiosk nájde elektráreň, vráti jej meno, meranie a zapečatený prístup', async () => {
    /** @type {string[]} */ const calls = [];
    const f = kioskOk();
    const spy = asFetch(async (url) => (calls.push(url), f(url)));
    const res = await handleRequest(pripojRequest({ sposob: 'huawei-kiosk', udaje: { odkaz: KIOSK_PAGE } }), ENV, NOW, spy);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const { stanice } = await res.json();
    assert.equal(stanice.length, 1);
    assert.equal(stanice[0].pv.realTimePowerKw, 6.412);
    assert.ok(stanice[0].nazov, 'meno elektrárne z kiosku');
    assert.equal(stanice[0].nazov, stanice[0].pv.stationName);
    assert.deepEqual(calls, [KIOSK_API]);

    // Zapečatený prístup funguje na meranie.
    const meranie = await handleRequest(pvRequest(stanice[0].pecat), ENV, NOW, kioskOk());
    assert.equal(meranie.status, 200);
    const body = await meranie.json();
    assert.equal(body.pv.realTimePowerKw, 6.412);
    assert.equal(body.pecat, undefined, 'prístup sa neobnovil, appka si nechá ten svoj');
});

test('POST /pripoj: zlé údaje 400 bez sťahovania, výpadok výrobcu 502, bez kľúča Workera 503', async () => {
    let called = false;
    const never = asFetch(async () => ((called = true), new Response('{}')));
    for (const body of [
        { sposob: 'huawei-kiosk', udaje: { odkaz: 'https://example.com/?kk=Abc123xyz' } },
        { sposob: 'neznamy', udaje: {} },
        { sposob: 'huawei-kiosk' },
        { sposob: 'huawei-kiosk', udaje: { odkaz: 42 } },
    ]) {
        const res = await handlePripoj(pripojRequest(body), ENV, NOW, never);
        assert.equal(res.status, 400);
        assert.deepEqual(await res.json(), { chyba: 'udaje' });
    }
    assert.equal((await handlePripoj(post('/pripoj', 'nie json'), ENV, NOW, never)).status, 400);
    assert.equal(called, false);

    const req = () => pripojRequest({ sposob: 'huawei-kiosk', udaje: { odkaz: KIOSK_PAGE } });
    const down = await handlePripoj(req(), ENV, NOW, fakeFetch({ [KIOSK_API]: null }));
    assert.equal(down.status, 502);
    assert.ok(!(await down.text()).includes('Abc123xyz'));
    // Kiosk s neplatným kľúčom odpovedá, len bez dát - to sú zlé údaje, nie výpadok.
    const junk = await handlePripoj(req(), ENV, NOW, fakeFetch({ [KIOSK_API]: '{"nie":"kiosk"}' }));
    assert.equal(junk.status, 400);
    assert.equal((await handlePripoj(req(), {}, NOW, kioskOk())).status, 503);
});

test('POST /pv: holý odkaz na kiosk (appka spred zapečatenia) vráti pv aj zapečatený prístup', async () => {
    const res = await handleRequest(pvRequest(KIOSK_PAGE), ENV, NOW, kioskOk());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    const body = await res.json();
    assert.equal(body.pv.realTimePowerKw, 6.412);
    assert.equal(body.pv.updatedAt, NOW.toISOString());
    const key = /** @type {Promise<CryptoKey>} */ (pecatKey(ENV.PECAT_KLUC));
    assert.deepEqual(await otvor(key, body.pecat), { sposob: 'huawei-kiosk', pristup: { odkaz: KIOSK_PAGE } });
    // Bez kľúča Workera meria ďalej, len bez pečate.
    const bezKluca = await (await handleRequest(pvRequest(KIOSK_PAGE), {}, NOW, kioskOk())).json();
    assert.equal(bezKluca.pv.realTimePowerKw, 6.412);
    assert.equal(bezKluca.pecat, undefined);
});

test('POST /pv: cudzí odkaz, cudzia pečať či príliš dlhé telo 400 bez sťahovania, výpadok 502', async () => {
    let called = false;
    const never = asFetch(async () => ((called = true), new Response('{}')));
    const cudzia = await zapecat(/** @type {Promise<CryptoKey>} */ (pecatKey(INY.PECAT_KLUC)), {
        sposob: 'huawei-kiosk',
        pristup: { odkaz: KIOSK_PAGE },
    });
    for (const body of ['https://example.com/?kk=Abc123xyz', cudzia, 'v1.nezmysel', 'x'.repeat(20000)])
        assert.equal((await handlePv(pvRequest(body), ENV, NOW, never)).status, 400);
    assert.equal(called, false);
    const down = await handlePv(pvRequest(KIOSK_PAGE), ENV, NOW, fakeFetch({ [KIOSK_API]: null }));
    assert.equal(down.status, 502);
    assert.ok(!(await down.text()).includes('Abc123xyz'));
});

test('POST /pv: neplatný kľúč kiosku (404) sa neopakuje, výpadok servera áno', async () => {
    /** @type {string[]} */ const calls = [];
    /** @param {number} status */
    const kiosk = (status) => asFetch(async (url) => (calls.push(url), new Response('x', { status })));
    assert.equal((await handlePv(pvRequest(KIOSK_PAGE), ENV, NOW, kiosk(404))).status, 502);
    assert.equal(calls.length, 1, 'druhý pokus by dopadol rovnako');
    calls.length = 0;
    assert.equal((await handlePv(pvRequest(KIOSK_PAGE), ENV, NOW, kiosk(503))).status, 502);
    assert.equal(calls.length, 2);
});

test('iné cesty 404, iné metódy 405, OPTIONS 204', async () => {
    assert.equal((await handleRequest(new Request('https://w.test/'), ENV, NOW)).status, 404);
    assert.equal((await handleRequest(new Request('https://w.test/status'), ENV, NOW)).status, 404);
    assert.equal((await handleRequest(new Request('https://w.test/pv'), ENV, NOW)).status, 405);
    assert.equal((await handleRequest(new Request('https://w.test/pripoj'), ENV, NOW)).status, 405);
    const options = await handleRequest(new Request('https://w.test/pripoj', { method: 'OPTIONS' }), ENV, NOW);
    assert.equal(options.status, 204);
    assert.equal(options.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
});
