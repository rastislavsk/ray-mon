import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    WORKER_PRIPOJ_URL,
    WORKER_PV_URL,
    geocodeUrl,
    openMeteoUrl,
    PLANT,
    SITE,
    TYPICAL_PLANT,
    WEATHER_CACHE_MS,
    WEATHER_KEEP_MS,
    WEATHER_STORAGE_KEY,
} from '../shared/config.js';
import { loadData, pripojZdroj, searchPlaces } from '../web/data.js';
import { FIXED_NOW, fixture, fixtureData } from './helpers.js';

/** Iná elektráreň než Dvorany - na overenie, že sa sťahuje pre ňu. */
const OTHER_SITE = { name: 'Sevilla', lat: 37.39, lon: -5.98, elevationM: 10, timezone: 'Europe/Madrid' };

const weatherJson = fixture('open-meteo.json');
const { pv } = fixtureData();

/**
 * Falošný fetch: odpovede podľa URL, null = výpadok. Zapisuje, čo sa volalo.
 * @param {Record<string, unknown>} routes
 */
function fakeFetch(routes) {
    /** @type {string[]} */ const calls = [];
    const impl = /** @type {typeof fetch} */ (
        /** @type {unknown} */ (
            async (/** @type {string} */ url) => {
                calls.push(url);
                const body = routes[url];
                if (body === undefined || body === null) return { ok: false, status: 500, json: async () => ({}) };
                return { ok: true, status: 200, json: async () => body };
            }
        )
    );
    return { impl, calls };
}

test('bez merania: Worker sa ani nevolá, predpoveď je počítaná v prehliadači', async () => {
    const f = fakeFetch({ [openMeteoUrl(SITE)]: weatherJson });
    const r = await loadData({ site: SITE, plant: PLANT, zdroj: null }, FIXED_NOW, f.impl);
    assert.deepEqual(f.calls, [openMeteoUrl(SITE)]);
    assert.equal(r.pv, null);
    assert.equal(r.pvFailed, false, 'bez pripojenia meranie nie je, ale nezlyhalo');
    assert.deepEqual(r.forecast, fixtureData().forecast);
});

test('iná lokalita: predpoveď je pre jej zostavu', async () => {
    const later = new Date(FIXED_NOW.getTime() + 2 * WEATHER_CACHE_MS);
    const f = fakeFetch({ [openMeteoUrl(OTHER_SITE)]: weatherJson });
    const r = await loadData({ site: OTHER_SITE, plant: TYPICAL_PLANT, zdroj: null }, later, f.impl);
    assert.deepEqual(f.calls, [openMeteoUrl(OTHER_SITE)]);
    assert.equal(r.pv, null);
    assert.ok(r.forecast && r.forecast.days.length === 7);
    assert.notDeepEqual(r.forecast, fixtureData().forecast);
});

test('počasie sa drží v pamäti; pri výpadku ostáva staré, pri zlých dátach predpoveď nie je', async () => {
    const t0 = new Date(FIXED_NOW.getTime() + 10 * WEATHER_CACHE_MS);
    const settings = { site: SITE, plant: PLANT, zdroj: null };
    const first = fakeFetch({ [openMeteoUrl(SITE)]: weatherJson });
    await loadData(settings, t0, first.impl);
    const again = fakeFetch({});
    const cached = await loadData(settings, new Date(t0.getTime() + 60_000), again.impl);
    assert.ok(!again.calls.includes(openMeteoUrl(SITE)), 'do hodiny sa počasie nesťahuje znova');
    assert.ok(cached.forecast);
    // Po vypršaní sa skúsi znova; výpadok nechá staré počasie.
    const down = fakeFetch({});
    const stale = await loadData(settings, new Date(t0.getTime() + 2 * WEATHER_CACHE_MS), down.impl);
    assert.ok(down.calls.includes(openMeteoUrl(SITE)));
    assert.ok(stale.forecast);
    // Nezmyselná odpoveď: predpoveď nie je, appka nespadne.
    const broken = fakeFetch({ [openMeteoUrl(OTHER_SITE)]: { hourly: { time: 'x' } } });
    const r = await loadData(
        { site: OTHER_SITE, plant: TYPICAL_PLANT, zdroj: null },
        new Date(t0.getTime() + 5 * WEATHER_CACHE_MS),
        broken.impl,
    );
    assert.equal(r.forecast, null);
});

/**
 * Nové otvorenie appky: modul data.js načítaný nanovo, s prázdnou pamäťou (adresa s ?značkou je
 * pre Node iný modul).
 * @param {string} tag @returns {Promise<typeof import('../web/data.js')>}
 */
const openApp = (tag) => import(/** @type {string} */ (`../web/data.js?${tag}`));

test('počasie sa odkladá v prehliadači: po otvorení je predpoveď hneď, bez siete', async () => {
    /** @type {Map<string, string>} */ const saved = new Map();
    /** @type {any} */ (globalThis).localStorage = {
        getItem: (/** @type {string} */ k) => saved.get(k) ?? null,
        setItem: (/** @type {string} */ k, /** @type {string} */ v) => saved.set(k, String(v)),
        removeItem: (/** @type {string} */ k) => saved.delete(k),
    };
    try {
        const settings = { site: SITE, plant: PLANT, zdroj: null };
        const prve = await openApp('prve');
        assert.equal(prve.keptForecast(settings, FIXED_NOW), null, 'prvé otvorenie nemá nič odložené');
        await prve.loadData(settings, FIXED_NOW, fakeFetch({ [openMeteoUrl(SITE)]: weatherJson }).impl);
        assert.ok(saved.has(WEATHER_STORAGE_KEY));

        // Ďalšie otvorenie: predpoveď je hneď a je tá istá ako z čerstvého počasia.
        const druhe = await openApp('druhe');
        assert.deepEqual(druhe.keptForecast(settings, FIXED_NOW), fixtureData().forecast);
        assert.equal(druhe.keptForecast({ site: OTHER_SITE, plant: TYPICAL_PLANT }, FIXED_NOW), null, 'iná lokalita');
        // Do WEATHER_CACHE_MS sa počasie znova nesťahuje ani po otvorení.
        const ticho = fakeFetch({});
        const r = await druhe.loadData(settings, new Date(FIXED_NOW.getTime() + 60_000), ticho.impl);
        assert.deepEqual(ticho.calls, []);
        assert.ok(r.forecast);

        // Staršie než WEATHER_KEEP_MS sa nepoužije ani pri výpadku; hodiny posunuté dozadu tiež nie.
        const tretie = await openApp('tretie');
        const neskoro = new Date(FIXED_NOW.getTime() + WEATHER_KEEP_MS);
        assert.equal(tretie.keptForecast(settings, neskoro), null);
        assert.equal(tretie.keptForecast(settings, new Date(FIXED_NOW.getTime() - 60_000)), null);
        assert.equal((await tretie.loadData(settings, neskoro, fakeFetch({}).impl)).forecast, null);
        // Do WEATHER_KEEP_MS výpadok nechá odložené počasie.
        const skor = new Date(neskoro.getTime() - 60_000);
        assert.ok((await tretie.loadData(settings, skor, fakeFetch({}).impl)).forecast);

        // Poškodený zápis: akoby nič odložené nebolo.
        saved.set(WEATHER_STORAGE_KEY, '{"url":1}');
        assert.equal((await openApp('stvrte')).keptForecast(settings, FIXED_NOW), null);
    } finally {
        delete (/** @type {any} */ (globalThis).localStorage);
    }
});

test('searchPlaces vráti lokality, pri chybe hádže', async () => {
    const hit = {
        results: [
            { name: 'Nitra', latitude: 48.31, longitude: 18.09, elevation: 150, timezone: 'Europe/Bratislava', country: 'Slovensko' },
        ],
    };
    const ok = fakeFetch({ [geocodeUrl('Nitra')]: hit });
    const results = await searchPlaces('Nitra', ok.impl);
    assert.equal(results.length, 1);
    assert.equal(results[0].site.name, 'Nitra');
    await assert.rejects(searchPlaces('Nitra', fakeFetch({}).impl));
});

test('pripojené meranie: zapečatený prístup ide Workeru v tele POST, nová pečať sa vráti', async () => {
    const zdroj = { sposob: 'huawei-kiosk', pecat: 'v1.AbCdEfGhIjKlMnOpQrStUvWxYz012345', nazov: 'Dvorany' };
    const kiosk = 'https://region01eu5.fusionsolar.huawei.com/pvmswebsite/nologin/assets/build/index.html#/kiosk?kk=Abc123xyz';
    const nova = 'v1.NovaPecatOdWorkera0123456789';
    /** @type {Array<{ url: string, init: any }>} */ const calls = [];
    const impl = /** @type {typeof fetch} */ (
        /** @type {unknown} */ (
            async (/** @type {string} */ url, /** @type {any} */ init) => {
                calls.push({ url, init });
                if (url === WORKER_PV_URL) return { ok: true, status: 200, json: async () => ({ pv, pecat: nova }) };
                return { ok: true, status: 200, json: async () => weatherJson };
            }
        )
    );
    const r = await loadData({ site: OTHER_SITE, plant: TYPICAL_PLANT, zdroj }, FIXED_NOW, impl);
    assert.deepEqual(r.pv, pv);
    assert.equal(r.pecat, nova);
    const post = calls.find((c) => c.url === WORKER_PV_URL);
    assert.ok(post);
    assert.equal(post.init.method, 'POST');
    assert.equal(post.init.body, zdroj.pecat);
    // Nastavenie spred zapečatenia: holý odkaz na kiosk ide tou istou cestou.
    calls.length = 0;
    await loadData({ site: OTHER_SITE, plant: TYPICAL_PLANT, zdroj: { ...zdroj, pecat: kiosk } }, FIXED_NOW, impl);
    assert.equal(calls.find((c) => c.url === WORKER_PV_URL)?.init.body, kiosk);
    assert.ok(!calls.some((c) => c.url.includes('Abc123xyz')), 'odkaz nie je v žiadnej adrese');
    // Každá požiadavka má časový limit - zaseknuté spojenie nesmie čakať donekonečna.
    assert.ok(
        calls.every((c) => c.init.signal instanceof AbortSignal),
        'požiadavka bez časového limitu',
    );
    assert.equal(r.pvFailed, false);

    const down = fakeFetch({ [openMeteoUrl(OTHER_SITE)]: weatherJson });
    const failed = await loadData({ site: OTHER_SITE, plant: TYPICAL_PLANT, zdroj }, FIXED_NOW, down.impl);
    assert.equal(failed.pv, null);
    assert.equal(failed.pecat, null);
    assert.equal(failed.pvFailed, true, 'výpadok merania sa odlíši od chýbajúceho merania');
    assert.ok(failed.forecast, 'výpadok merania predpoveď nezhodí');
});

test('meranie vráti nezmysel: meranie nie je, predpoveď áno; nezmyselná pečať sa zahodí', async () => {
    const zdroj = { sposob: 'huawei-kiosk', pecat: 'v1.AbCdEfGhIjKlMnOpQrStUvWxYz012345', nazov: 'Dvorany' };
    const f = fakeFetch({ [WORKER_PV_URL]: { pv: { nezmysel: 1 } }, [openMeteoUrl(SITE)]: weatherJson });
    const r = await loadData({ site: SITE, plant: PLANT, zdroj }, FIXED_NOW, f.impl);
    assert.equal(r.pv, null);
    assert.ok(r.forecast);
    const g = fakeFetch({ [WORKER_PV_URL]: { pv, pecat: 'https://example.com' }, [openMeteoUrl(SITE)]: weatherJson });
    assert.equal((await loadData({ site: SITE, plant: PLANT, zdroj }, FIXED_NOW, g.impl)).pecat, null);
});

test('pripojZdroj: údaje idú Workeru v tele, odpoveď sa preverí, chyby majú druh', async () => {
    /** @param {number} status @param {unknown} body */
    const worker = (status, body) => {
        /** @type {any[]} */ const calls = [];
        const impl = /** @type {typeof fetch} */ (
            /** @type {unknown} */ (
                async (/** @type {string} */ url, /** @type {any} */ init) => {
                    calls.push({ url, init });
                    return { ok: status < 300, status, json: async () => body };
                }
            )
        );
        return { impl, calls };
    };
    const st = { nazov: 'Dvorany', pecat: 'v1.AbCdEfGhIjKlMnOpQrStUvWxYz012345', pv };
    const ok = worker(200, { stanice: [st, { nazov: 1, pecat: 'zla' }, { nazov: 'Bez merania', pecat: st.pecat, pv: { x: 1 } }] });
    const r = await pripojZdroj('huawei-kiosk', { odkaz: 'https://k' }, ok.impl);
    assert.deepEqual(r, { stanice: [st, { nazov: 'Bez merania', pecat: st.pecat, pv: null }] });
    assert.equal(ok.calls[0].url, WORKER_PRIPOJ_URL);
    assert.equal(ok.calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(ok.calls[0].init.body), { sposob: 'huawei-kiosk', udaje: { odkaz: 'https://k' } });
    assert.deepEqual(await pripojZdroj('x', {}, worker(400, { chyba: 'udaje' }).impl), { chyba: 'udaje', kod: '' });
    assert.deepEqual(await pripojZdroj('x', {}, worker(502, { chyba: 'vyrobca' }).impl), { chyba: 'vyrobca', kod: '' });
    assert.deepEqual(await pripojZdroj('x', {}, worker(503, { chyba: 'server' }).impl), { chyba: 'server', kod: '' });
    // Kód chyby od výrobcu prejde, len ak má očakávaný tvar.
    assert.deepEqual(await pripojZdroj('x', {}, worker(400, { chyba: 'udaje', kod: 'prihlasenie:20400' }).impl), {
        chyba: 'udaje',
        kod: 'prihlasenie:20400',
    });
    assert.deepEqual(await pripojZdroj('x', {}, worker(400, { chyba: 'udaje', kod: '<script>' }).impl), { chyba: 'udaje', kod: '' });
    const padne = /** @type {typeof fetch} */ (/** @type {unknown} */ (async () => Promise.reject(new TypeError('siet'))));
    assert.deepEqual(await pripojZdroj('x', {}, padne), { chyba: 'server' });
    // Obnova prístupu: stará pečať ide s údajmi; dátum platnosti prejde, len keď je to čas.
    const obnova = worker(200, {
        stanice: [
            { ...st, platiDo: '2026-12-20T12:00:00.000Z' },
            { ...st, platiDo: 'zajtra' },
        ],
    });
    const ro = await pripojZdroj('deye-aplikacia', { heslo: 'h' }, obnova.impl, st.pecat);
    assert.deepEqual(JSON.parse(obnova.calls[0].init.body), { sposob: 'deye-aplikacia', udaje: { heslo: 'h' }, pecat: st.pecat });
    assert.deepEqual(ro, { stanice: [{ ...st, platiDo: '2026-12-20T12:00:00.000Z' }, st] });
});

test('výrobca prístup odmietol (400): odlíši sa od výpadku a nesie kód chyby', async () => {
    const zdroj = { sposob: 'huawei-northbound', pecat: 'v1.AbCdEfGhIjKlMnOpQrStUvWxYz012345', nazov: 'Dvorany' };
    /** @param {number} status @param {unknown} body */
    const worker = (status, body) =>
        /** @type {typeof fetch} */ (
            /** @type {unknown} */ (
                async (/** @type {string} */ url) =>
                    url === WORKER_PV_URL
                        ? { ok: false, status, json: async () => body }
                        : { ok: true, status: 200, json: async () => weatherJson }
            )
        );
    const s = { site: SITE, plant: PLANT, zdroj };
    const odm = await loadData(s, FIXED_NOW, worker(400, { chyba: 'udaje', kod: 'meranie:20400' }));
    assert.deepEqual([odm.pv, odm.pvFailed, odm.odmietnute], [null, true, 'meranie:20400']);
    assert.ok(odm.forecast);
    assert.equal((await loadData(s, FIXED_NOW, worker(400, { chyba: 'udaje', kod: '<x>' }))).odmietnute, '', 'nezmyselný kód sa zahodí');
    assert.equal((await loadData(s, FIXED_NOW, worker(502, { chyba: 'vyrobca' }))).odmietnute, null, 'výpadok nie je odmietnutie');
    assert.equal((await loadData({ ...s, zdroj: null }, FIXED_NOW, worker(400, {}))).odmietnute, null);
});
