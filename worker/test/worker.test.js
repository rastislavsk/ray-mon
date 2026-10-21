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

/**
 * Podvrhnutý server výrobcu: odpoveď podľa začiatku adresy, zapamätá si volania.
 * @param {Array<[string, number, unknown]>} routes [začiatok adresy, status, JSON]
 */
function vyrobca(routes) {
    /** @type {Array<{ url: string, init: any }>} */ const calls = [];
    const impl = /** @type {typeof fetch} */ (
        /** @type {unknown} */ (
            async (/** @type {string} */ url, /** @type {any} */ init) => {
                calls.push({ url, init });
                const r = routes.find(([prefix]) => url.startsWith(prefix));
                if (!r) return new Response('not found', { status: 404 });
                return new Response(JSON.stringify(r[2]), { status: r[1], headers: { 'content-type': 'application/json' } });
            }
        )
    );
    return { impl, calls };
}

/** Pripojí a hneď zmeria prvú nájdenú elektráreň. @param {unknown} body @param {typeof fetch} impl */
async function pripojAMeraj(body, impl) {
    const res = await handlePripoj(pripojRequest(body), ENV, NOW, impl);
    const json = await res.json();
    if (res.status !== 200) return { status: res.status, json };
    const meranie = await handlePv(pvRequest(json.stanice[0].pecat), ENV, NOW, impl);
    return { status: 200, json, meranie: await meranie.json() };
}

const FOX_LIST = { errno: 0, result: { data: [{ deviceSN: '60BH1234', stationName: 'Dvorany' }] } };
const FOX_REAL = { errno: 0, result: [{ deviceSN: '60BH1234', datas: [{ variable: 'pvPower', unit: 'kW', value: 3.4 }] }] };
const FOX_GEN = { errno: 0, result: { today: 18.2, month: 410.5, cumulative: 9876.4 } };

test('Fox ESS: kľúč nájde menič, meria podpísanými požiadavkami len na foxesscloud.com', async () => {
    const f = vyrobca([
        ['https://www.foxesscloud.com/op/v0/device/list', 200, FOX_LIST],
        ['https://www.foxesscloud.com/op/v1/device/real/query', 200, FOX_REAL],
        ['https://www.foxesscloud.com/op/v0/device/generation?sn=60BH1234', 200, FOX_GEN],
    ]);
    const r = await pripojAMeraj({ sposob: 'foxess-kluc', udaje: { kluc: 'tajny-kluc' } }, f.impl);
    assert.equal(r.status, 200);
    assert.equal(r.json.stanice[0].nazov, 'Dvorany');
    assert.equal(r.json.stanice[0].pv.realTimePowerKw, 3.4);
    assert.ok(!r.json.stanice[0].pecat.includes('tajny'), 'kľúč nie je v pečati čitateľný');
    assert.deepEqual([r.meranie.pv.realTimePowerKw, r.meranie.pv.dailyEnergyKwh, r.meranie.pv.cumulativeEnergyKwh], [3.4, 18.2, 9876.4]);
    assert.ok(f.calls.every((c) => c.url.startsWith('https://www.foxesscloud.com/op/')));
    assert.ok(f.calls.every((c) => c.init.headers.token === 'tajny-kluc' && /^[0-9a-f]{32}$/.test(c.init.headers.signature)));
    const real = f.calls.find((c) => c.url.endsWith('/real/query'));
    assert.deepEqual(JSON.parse(real?.init.body), { sns: ['60BH1234'], variables: ['pvPower'] });
});

test('Fox ESS: zlý kľúč 400, priveľa dopytov a výpadok 502', async () => {
    const zly = vyrobca([['https://www.foxesscloud.com/', 200, { errno: 41809, msg: 'illegal token' }]]);
    assert.equal((await pripojAMeraj({ sposob: 'foxess-kluc', udaje: { kluc: 'x' } }, zly.impl)).status, 400);
    const casto = vyrobca([['https://www.foxesscloud.com/', 200, { errno: 40400 }]]);
    assert.equal((await pripojAMeraj({ sposob: 'foxess-kluc', udaje: { kluc: 'x' } }, casto.impl)).status, 502);
    const dole = vyrobca([['https://www.foxesscloud.com/', 503, {}]]);
    assert.equal((await pripojAMeraj({ sposob: 'foxess-kluc', udaje: { kluc: 'x' } }, dole.impl)).status, 502);
    assert.equal((await pripojAMeraj({ sposob: 'foxess-kluc', udaje: { kluc: '' } }, dole.impl)).status, 400);
});

const SOLAX_OK = {
    success: true,
    exception: 'Query success!',
    result: { acpower: 3100, yieldtoday: 13.6, yieldtotal: 31120.6, powerdc1: 3300 },
};

test('SolaX: token a číslo modulu, adresa sa skladá len zo servera SolaX', async () => {
    const f = vyrobca([['https://www.solaxcloud.com/proxyApp/proxy/api/getRealtimeInfo.do?tokenId=', 200, SOLAX_OK]]);
    const udaje = { token: '20200722185111234567890', sn: 'SXABCDEFGH' };
    const r = await pripojAMeraj({ sposob: 'solax-token', udaje }, f.impl);
    assert.equal(r.status, 200);
    assert.deepEqual([r.meranie.pv.realTimePowerKw, r.meranie.pv.dailyEnergyKwh], [3.3, 13.6]);
    assert.equal(
        f.calls[0].url,
        'https://www.solaxcloud.com/proxyApp/proxy/api/getRealtimeInfo.do?tokenId=20200722185111234567890&sn=SXABCDEFGH',
    );
    const zly = vyrobca([['https://www.solaxcloud.com/', 200, { success: false, exception: 'tokenId error', result: null }]]);
    assert.equal((await pripojAMeraj({ sposob: 'solax-token', udaje }, zly.impl)).status, 400);
    // Údaje, z ktorých by sa dala poskladať iná adresa, sa ani nepošlú.
    const never = vyrobca([]);
    assert.equal((await pripojAMeraj({ sposob: 'solax-token', udaje: { ...udaje, sn: 'x&y=1' } }, never.impl)).status, 400);
    assert.equal(never.calls.length, 0);
});

test('Victron: token nájde inštalácie, výkon z diagnostiky, zlý token 400', async () => {
    const B = 'https://vrmapi.victronenergy.com/v2';
    const diag = { success: true, records: [{ dbusServiceType: 'solarcharger', dbusPath: '/Yield/Power', rawValue: 2400 }] };
    const f = vyrobca([
        [`${B}/users/me`, 200, { success: true, user: { id: 22 } }],
        [
            `${B}/users/22/installations`,
            200,
            {
                success: true,
                records: [
                    { idSite: 7, name: 'Chata' },
                    { idSite: 8, name: 'Dom' },
                ],
            },
        ],
        [`${B}/installations/7/diagnostics`, 200, diag],
        [`${B}/installations/8/diagnostics`, 503, {}],
    ]);
    const r = await pripojAMeraj({ sposob: 'victron-token', udaje: { token: 'vrm-token' } }, f.impl);
    assert.equal(r.status, 200);
    assert.deepEqual(
        r.json.stanice.map((/** @type {any} */ s) => [s.nazov, s.pv && s.pv.realTimePowerKw]),
        [
            ['Chata', 2.4],
            ['Dom', null],
        ],
        'elektráreň, ktorá práve neodpovedá, sa ukáže bez merania',
    );
    assert.equal(r.meranie.pv.realTimePowerKw, 2.4);
    assert.ok(f.calls.every((c) => c.url.startsWith(B) && c.init.headers['x-authorization'] === 'Token vrm-token'));
    const zly = vyrobca([[`${B}/users/me`, 401, { success: false, errors: 'Not logged in', error_code: 'not_logged_in' }]]);
    assert.equal((await pripojAMeraj({ sposob: 'victron-token', udaje: { token: 'zly' } }, zly.impl)).status, 400);
});
