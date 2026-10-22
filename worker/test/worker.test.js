import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

// ---- Huawei Northbound --------------------------------------------------------------------

const NB_HOST = 'https://eu5.fusionsolar.huawei.com';

/**
 * Podvrhnutý server Northbound. Prihlásenie vráti token v hlavičke `xsrf-token`, dáta len
 * s platným tokenom (inak failCode 305). `tokeny` je poradie tokenov, ktoré prihlásenia vydajú.
 * @param {{ heslo?: string, tokeny?: string[], platne?: string[], realFail?: number }} [opts]
 */
function northbound(
    { heslo = 'tajne', tokeny = ['t1', 't2'], platne, realFail, loginFail, stationsFail, stareFail, devTyp = 38 } = /** @type {any} */ ({}),
) {
    /** @type {Array<{ path: string, body: any, token: string | null, cookie: string | null }>} */ const calls = [];
    let prihlasenia = 0;
    const valid = new Set(platne ?? tokeny);
    const ok = (/** @type {unknown} */ data) => Response.json({ success: true, failCode: 0, data });
    const fail = (/** @type {number} */ failCode) => Response.json({ success: false, failCode, data: null });
    /** Odpovede dátových ciest (s platným tokenom). @type {Record<string, () => Response>} */
    const data = {
        '/thirdData/stations': () => (stationsFail ? fail(stationsFail) : ok({ list: [{ plantCode: 'NE=1', plantName: 'Dvorany' }] })),
        // Starší zoznam (Historical Interfaces): bez stránkovania, stationCode a stationName.
        '/thirdData/getStationList': () =>
            stareFail ? fail(stareFail) : ok([{ stationCode: 'NE=1', stationName: 'Dvorany', capacity: 0.01 }]),
        '/thirdData/getDevList': () => ok([{ id: 11, stationCode: 'NE=1', devTypeId: devTyp }]),
        '/thirdData/getDevRealKpi': () =>
            realFail ? fail(realFail) : ok([{ devId: 11, dataItemMap: { active_power: 4.2, day_cap: 20, total_cap: 5000 } }]),
        '/thirdData/getStationRealKpi': () =>
            ok([{ stationCode: 'NE=1', dataItemMap: { day_power: 21.5, month_power: 400, total_power: 5100 } }]),
    };
    /** @param {any} body */
    const login = (body) => {
        if (loginFail) return fail(loginFail);
        if (body.systemCode !== heslo) return fail(20400);
        const headers = new Headers({ 'xsrf-token': tokeny[prihlasenia++] ?? 'tX', 'content-type': 'application/json' });
        // Huawei CloudWAF a relácia nastavujú cookies, ako pri skutočnom serveri.
        headers.append('set-cookie', 'HWWAFSESID=waf1; path=/');
        headers.append('set-cookie', 'XSRF-TOKEN=xc; Path=/; Secure; HttpOnly');
        return new Response(JSON.stringify({ success: true, failCode: 0, data: null }), { headers });
    };
    const impl = /** @type {typeof fetch} */ (
        /** @type {unknown} */ (
            async (/** @type {string} */ url, /** @type {any} */ init) => {
                const path = url.replace(NB_HOST, '');
                const body = init.body ? JSON.parse(init.body) : null;
                const token = init.headers?.['xsrf-token'] ?? null;
                calls.push({ path, body, token, cookie: init.headers?.cookie ?? null });
                if (!url.startsWith(NB_HOST)) return new Response('x', { status: 404 });
                if (path === '/thirdData/login') return login(body);
                if (!valid.has(token)) return fail(305);
                return data[path] ? data[path]() : fail(20004);
            }
        )
    );
    return { impl, calls, prihlasenia: () => prihlasenia };
}

const NB_UDAJE = { meno: 'api-dvorany', heslo: 'tajne', server: 'eu5.fusionsolar.huawei.com' };

test('Huawei Northbound: prihlásenie, elektrárne, meniče a meranie jedným dopytom na druh', async () => {
    const s = northbound();
    const res = await handlePripoj(pripojRequest({ sposob: 'huawei-northbound', udaje: NB_UDAJE }), ENV, NOW, s.impl);
    assert.equal(res.status, 200);
    const { stanice } = await res.json();
    assert.equal(stanice.length, 1);
    assert.equal(stanice[0].nazov, 'Dvorany');
    assert.deepEqual([stanice[0].pv.realTimePowerKw, stanice[0].pv.dailyEnergyKwh, stanice[0].pv.monthEnergyKwh], [4.2, 21.5, 400]);
    assert.ok(!stanice[0].pecat.includes('tajne'));
    assert.deepEqual(
        s.calls.map((c) => c.path),
        ['/thirdData/login', '/thirdData/stations', '/thirdData/getDevList', '/thirdData/getStationRealKpi', '/thirdData/getDevRealKpi'],
    );
    assert.ok(
        s.calls.slice(1).every((c) => c.token === 't1'),
        'dáta s tokenom z hlavičky prihlásenia',
    );
    assert.deepEqual(s.calls.find((c) => c.path === '/thirdData/getDevRealKpi')?.body, { devIds: '11', devTypeId: 38 });
    // Meranie hneď potom: token z pečate, žiadne ďalšie prihlásenie, pečať sa nemení.
    const meranie = await (await handlePv(pvRequest(stanice[0].pecat), ENV, NOW, s.impl)).json();
    assert.equal(meranie.pv.realTimePowerKw, 4.2);
    assert.equal(meranie.pecat, undefined);
    assert.equal(s.prihlasenia(), 1);
});

test('Huawei Northbound: vypršaný token aj odhlásenie (305) znamenajú jedno nové prihlásenie a novú pečať', async () => {
    const s = northbound();
    const { stanice } = await (
        await handlePripoj(pripojRequest({ sposob: 'huawei-northbound', udaje: NB_UDAJE }), ENV, NOW, s.impl)
    ).json();
    // O pol hodiny neskôr: token je starší než 25 minút, Worker sa prihlási vopred.
    const neskor = new Date(NOW.getTime() + 30 * 60 * 1000);
    const po = await (await handlePv(pvRequest(stanice[0].pecat), ENV, neskor, s.impl)).json();
    assert.equal(po.pv.realTimePowerKw, 4.2);
    assert.match(po.pecat, /^v1\./);
    assert.equal(s.prihlasenia(), 2);
    // Huawei reláciu zrušil skôr (305): prihlási sa raz znova a meria.
    const zrusena = northbound({ platne: ['t1'] });
    const key = /** @type {Promise<CryptoKey>} */ (pecatKey(ENV.PECAT_KLUC));
    const pecat = await zapecat(key, {
        sposob: 'huawei-northbound',
        pristup: { ...NB_UDAJE, token: 'stary', tokenAt: NOW.getTime(), plant: 'NE=1', nazov: 'Dvorany', devs: { 38: [11] } },
    });
    const res = await (await handlePv(pvRequest(pecat), ENV, NOW, zrusena.impl)).json();
    assert.equal(res.pv.realTimePowerKw, 4.2);
    assert.ok(res.pecat, 'nový token v novej pečati');
    assert.equal(zrusena.prihlasenia(), 1);
});

test('Huawei Northbound: menič s batériou (23093) - pripojenie ho nájde, staršej pečati sa doplní raz', async () => {
    const s = northbound({ devTyp: 23093 });
    const { stanice } = await (
        await handlePripoj(pripojRequest({ sposob: 'huawei-northbound', udaje: NB_UDAJE }), ENV, NOW, s.impl)
    ).json();
    assert.equal(stanice[0].pv.realTimePowerKw, 4.2);
    assert.deepEqual(s.calls.find((c) => c.path === '/thirdData/getDevRealKpi')?.body, { devIds: '11', devTypeId: 23093 });
    // Pečať spred opravy: elektráreň bez meničov. Prvé meranie si zoznam vypýta a zapečatí.
    const key = /** @type {Promise<CryptoKey>} */ (pecatKey(ENV.PECAT_KLUC));
    const stara = await zapecat(key, {
        sposob: 'huawei-northbound',
        pristup: { ...NB_UDAJE, token: 't1', tokenAt: NOW.getTime(), plant: 'NE=1', nazov: 'Dvorany', devs: {} },
    });
    const m = northbound({ devTyp: 23093, platne: ['t1'] });
    const prve = await (await handlePv(pvRequest(stara), ENV, NOW, m.impl)).json();
    assert.equal(prve.pv.realTimePowerKw, 4.2);
    assert.equal((await otvor(await key, prve.pecat))?.pristup.devs['23093'][0], 11);
    const druhe = await (await handlePv(pvRequest(prve.pecat), ENV, NOW, m.impl)).json();
    assert.equal(druhe.pv.realTimePowerKw, 4.2);
    assert.equal(m.calls.filter((c) => c.path === '/thirdData/getDevList').length, 1, 'zoznam zariadení len raz');
    // Elektráreň naozaj bez meniča: zoznam sa vypýta raz a potom už nie.
    const bez = northbound({ devTyp: 17, platne: ['t1'] });
    const r1 = await (await handlePv(pvRequest(stara), ENV, NOW, bez.impl)).json();
    assert.equal(r1.pv.realTimePowerKw, null);
    await handlePv(pvRequest(r1.pecat), ENV, NOW, bez.impl);
    assert.equal(bez.calls.filter((c) => c.path === '/thirdData/getDevList').length, 1);
});

test('Huawei Northbound: zlé heslo a cudzí server 400, limit 407 je výpadok (502)', async () => {
    const zle = await handlePripoj(
        pripojRequest({ sposob: 'huawei-northbound', udaje: { ...NB_UDAJE, heslo: 'zle' } }),
        ENV,
        NOW,
        northbound().impl,
    );
    assert.equal(zle.status, 400);
    const never = northbound();
    for (const server of ['example.com', 'eu5.fusionsolar.huawei.com.example.com']) {
        const res = await handlePripoj(
            pripojRequest({ sposob: 'huawei-northbound', udaje: { ...NB_UDAJE, server } }),
            ENV,
            NOW,
            never.impl,
        );
        assert.equal(res.status, 400);
    }
    assert.equal(never.calls.length, 0);
    const limit = northbound({ realFail: 407 });
    const { stanice } = await (
        await handlePripoj(pripojRequest({ sposob: 'huawei-northbound', udaje: NB_UDAJE }), ENV, NOW, limit.impl)
    ).json();
    assert.equal(stanice[0].pv, null, 'pripojenie prejde, meranie príde neskôr');
    assert.equal((await handlePv(pvRequest(stanice[0].pecat), ENV, NOW, limit.impl)).status, 502);
});

test('Huawei Northbound: cookies z prihlásenia idú s každým dopytom, aj zapečatené na meranie', async () => {
    const s = northbound();
    const { stanice } = await (
        await handlePripoj(pripojRequest({ sposob: 'huawei-northbound', udaje: NB_UDAJE }), ENV, NOW, s.impl)
    ).json();
    assert.ok(s.calls.slice(1).every((c) => c.cookie === 'HWWAFSESID=waf1; XSRF-TOKEN=xc'));
    s.calls.length = 0;
    await handlePv(pvRequest(stanice[0].pecat), ENV, NOW, s.impl);
    assert.ok(s.calls.length > 0 && s.calls.every((c) => c.cookie === 'HWWAFSESID=waf1; XSRF-TOKEN=xc'));
});

test('Huawei Northbound: chyba nesie krok a kód od Huawei (nič tajné), staršie rozhranie zoznamu ako záloha', async () => {
    const pripoj = async (/** @type {any} */ opts) => {
        const res = await handlePripoj(pripojRequest({ sposob: 'huawei-northbound', udaje: NB_UDAJE }), ENV, NOW, northbound(opts).impl);
        return { status: res.status, body: await res.json() };
    };
    assert.deepEqual(await pripoj({ loginFail: 20400 }), { status: 400, body: { chyba: 'udaje', kod: 'prihlasenie:20400' } });
    assert.deepEqual(await pripoj({ loginFail: 407 }), { status: 502, body: { chyba: 'vyrobca', kod: 'prihlasenie:407' } });
    // Nový zoznam účet nemá povolený: staršie getStationList elektráreň nájde.
    const zaloha = northbound({ stationsFail: 401 });
    const res = await handlePripoj(pripojRequest({ sposob: 'huawei-northbound', udaje: NB_UDAJE }), ENV, NOW, zaloha.impl);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).stanice[0].nazov, 'Dvorany');
    assert.deepEqual(zaloha.calls.map((c) => c.path).slice(0, 3), ['/thirdData/login', '/thirdData/stations', '/thirdData/getStationList']);
    // Nevyjde ani staršie: kód nového rozhrania.
    assert.deepEqual(await pripoj({ stationsFail: 401, stareFail: 401 }), { status: 400, body: { chyba: 'udaje', kod: 'zoznam:401' } });
    // Priveľa dopytov: staršie sa neskúša, dopadlo by rovnako.
    const casto = northbound({ stationsFail: 407 });
    const r407 = await handlePripoj(pripojRequest({ sposob: 'huawei-northbound', udaje: NB_UDAJE }), ENV, NOW, casto.impl);
    assert.deepEqual([r407.status, await r407.json()], [502, { chyba: 'vyrobca', kod: 'zoznam:407' }]);
    assert.ok(!casto.calls.some((c) => c.path === '/thirdData/getStationList'));
});

test('Huawei Northbound: pripojenie po 305 (účet sa prihlásil aj inde) sa raz prihlási znova', async () => {
    const pripoj = (/** @type {typeof fetch} */ impl) =>
        handlePripoj(pripojRequest({ sposob: 'huawei-northbound', udaje: NB_UDAJE }), ENV, NOW, impl);
    // Prvý token Huawei hneď zrušil, druhý platí.
    const raz = northbound({ platne: ['t2'] });
    const res = await pripoj(raz.impl);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).stanice[0].nazov, 'Dvorany');
    assert.equal(raz.prihlasenia(), 2);
    // Zruší aj druhý: len jedno opakovanie, potom kód 305 pre appku.
    const stale = northbound({ platne: [] });
    const r2 = await pripoj(stale.impl);
    assert.deepEqual([r2.status, await r2.json()], [502, { chyba: 'vyrobca', kod: 'zoznam:305' }]);
    assert.equal(stale.prihlasenia(), 2);
});

// ---- Solis a Deye -------------------------------------------------------------------------

const SOLIS_OK = {
    code: '0',
    msg: 'success',
    data: {
        page: {
            records: [
                { id: 1308675217944611083, stationName: 'Dvorany', power: 5.772, powerStr: 'kW', dayEnergy: 31.3, dayEnergyStr: 'kWh' },
            ],
        },
    },
};

test('Solis: podpísaná požiadavka na port 13333, elektráreň podľa id, zlý kľúč 400', async () => {
    const f = vyrobca([['https://www.soliscloud.com:13333/v1/api/userStationList', 200, SOLIS_OK]]);
    const r = await pripojAMeraj({ sposob: 'solis-kluc', udaje: { keyId: '1300386381676565707', secret: 'tajne' } }, f.impl);
    assert.equal(r.status, 200);
    assert.equal(r.json.stanice[0].nazov, 'Dvorany');
    assert.deepEqual([r.meranie.pv.realTimePowerKw, r.meranie.pv.dailyEnergyKwh], [5.772, 31.3]);
    const h = f.calls[0].init.headers;
    assert.match(h.authorization, /^API 1300386381676565707:[A-Za-z0-9+/]{27}=$/, 'HmacSHA1 v base64');
    assert.match(h['content-md5'], /^[A-Za-z0-9+/]{22}==$/);
    assert.match(h.date, /^[A-Z][a-z]{2}, \d{1,2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/);
    assert.equal(f.calls[0].init.method, 'POST');
    const zly = vyrobca([['https://www.soliscloud.com:13333/', 200, { code: 'R0000', msg: 'No authority' }]]);
    const zle = await pripojAMeraj({ sposob: 'solis-kluc', udaje: { keyId: 'x', secret: 'y' } }, zly.impl);
    assert.deepEqual([zle.status, zle.json], [400, { chyba: 'udaje', kod: 'zoznam:R0000' }], 'kód od Solis ide do appky');
    assert.equal((await pripojAMeraj({ sposob: 'solis-kluc', udaje: { keyId: '', secret: 'y' } }, zly.impl)).status, 400);
});

test('Deye: heslo ide len ako SHA-256 a do pečate nie, meria výkon a dnešok tokenom', async () => {
    const B = 'https://eu1-developer.deyecloud.com';
    const f = vyrobca([
        [`${B}/v1.0/account/token?appId=202406270000000`, 200, { success: true, code: '1000000', accessToken: 'deye-token' }],
        [
            `${B}/v1.0/station/list`,
            200,
            {
                success: true,
                code: '1000000',
                stationList: [{ id: 10, name: 'Chata', installedCapacity: 10, regionTimezone: 'Europe/Bratislava' }],
            },
        ],
        [`${B}/v1.0/station/latest`, 200, { success: true, code: '1000000', generationPower: 3400 }],
        [`${B}/v1.0/station/history`, 200, { success: true, code: '1000000', stationDataItems: [{ generationValue: 18.2 }] }],
    ]);
    const udaje = { appId: '202406270000000', appSecret: 'app-tajne', email: 'a@b.sk', heslo: 'moje-heslo' };
    const r = await pripojAMeraj({ sposob: 'deye-aplikacia', udaje }, f.impl);
    assert.equal(r.status, 200);
    assert.deepEqual(
        [r.json.stanice[0].nazov, r.json.stanice[0].pv.realTimePowerKw, r.json.stanice[0].pv.dailyEnergyKwh],
        ['Chata', 3.4, 18.2],
    );
    const login = JSON.parse(f.calls[0].init.body);
    assert.equal(login.password, createHash('sha256').update('moje-heslo').digest('hex'));
    assert.ok(!JSON.stringify(f.calls).includes('moje-heslo'), 'heslo nikam neodišlo v čitateľnej podobe');
    const key = /** @type {Promise<CryptoKey>} */ (pecatKey(ENV.PECAT_KLUC));
    const obsah = await otvor(key, r.json.stanice[0].pecat);
    assert.ok(
        obsah && !JSON.stringify(obsah).includes('moje-heslo') && !JSON.stringify(obsah).includes(login.password),
        'v pečati nie je heslo ani jeho hash',
    );
    assert.equal(obsah?.pristup.token, 'deye-token');
    assert.equal(r.meranie.pv.realTimePowerKw, 3.4);
    const history = f.calls.filter((c) => c.url.endsWith('/v1.0/station/history')).at(-1);
    assert.equal(JSON.parse(history?.init.body).granularity, 2);
    assert.equal(history?.init.headers.authorization, 'Bearer deye-token');
    assert.equal(r.json.stanice[0].platiDo, new Date(NOW.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString(), 'token platí 60 dní');
    const zly = vyrobca([[`${B}/v1.0/account/token`, 200, { success: false, code: '2101019', msg: 'auth failed' }]]);
    const zle = await pripojAMeraj({ sposob: 'deye-aplikacia', udaje }, zly.impl);
    assert.deepEqual([zle.status, zle.json], [400, { chyba: 'udaje', kod: 'prihlasenie:2101019' }], 'kód od Deye ide do appky');
});

test('Deye: obnova prístupu len heslom, aplikáciu a e-mail Worker doplní zo starej pečate', async () => {
    const B = 'https://eu1-developer.deyecloud.com';
    const f = vyrobca([
        [`${B}/v1.0/account/token`, 200, { success: true, code: '1000000', accessToken: 'deye-token' }],
        [
            `${B}/v1.0/station/list`,
            200,
            { success: true, code: '1000000', stationList: [{ id: 10, name: 'Chata', installedCapacity: 10 }] },
        ],
        [`${B}/v1.0/station/`, 200, { success: true, code: '1000000' }],
    ]);
    const udaje = { appId: '202406270000000', appSecret: 'app-tajne', email: 'a@b.sk', heslo: 'moje-heslo' };
    const r = { json: await (await handlePripoj(pripojRequest({ sposob: 'deye-aplikacia', udaje }), ENV, NOW, f.impl)).json() };
    f.calls.length = 0;
    const obnova = await handlePripoj(
        pripojRequest({ sposob: 'deye-aplikacia', udaje: { heslo: 'nove-heslo' }, pecat: r.json.stanice[0].pecat }),
        ENV,
        NOW,
        f.impl,
    );
    assert.equal(obnova.status, 200);
    assert.equal(f.calls[0].url, `${B}/v1.0/account/token?appId=202406270000000`);
    assert.deepEqual(JSON.parse(f.calls[0].init.body), {
        appSecret: 'app-tajne',
        email: 'a@b.sk',
        password: createHash('sha256').update('nove-heslo').digest('hex'),
    });
    // Bez pečate, s pečaťou iného spôsobu či iného Workera nič nedoplní.
    const kiosk = await zapecat(/** @type {Promise<CryptoKey>} */ (pecatKey(ENV.PECAT_KLUC)), {
        sposob: 'huawei-kiosk',
        pristup: { appId: 'x' },
    });
    for (const pecat of ['', kiosk, r.json.stanice[0].pecat.slice(0, -4) + 'AAAA']) {
        const res = await handlePripoj(pripojRequest({ sposob: 'deye-aplikacia', udaje: { heslo: 'h' }, pecat }), ENV, NOW, f.impl);
        assert.equal(res.status, 400);
    }
});
