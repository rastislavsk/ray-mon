import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORKER_PV_URL, DEMO_PLANT, DEMO_SITE, geocodeUrl, openMeteoUrl, PLANT, SITE, WEATHER_CACHE_MS } from '../shared/config.js';
import { loadData, searchPlaces } from '../web/data.js';
import { FIXED_NOW, fixture, fixtureData } from './helpers.js';

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

test('bez kiosku: Worker sa ani nevolá, predpoveď je počítaná v prehliadači', async () => {
    const f = fakeFetch({ [openMeteoUrl(SITE)]: weatherJson });
    const r = await loadData({ site: SITE, plant: PLANT, kiosk: '' }, FIXED_NOW, f.impl);
    assert.deepEqual(f.calls, [openMeteoUrl(SITE)]);
    assert.equal(r.pv, null);
    assert.equal(r.pvFailed, false, 'bez kiosku meranie nie je, ale nezlyhalo');
    assert.deepEqual(r.forecast, fixtureData().forecast);
});

test('iná lokalita: predpoveď je pre jej zostavu', async () => {
    const later = new Date(FIXED_NOW.getTime() + 2 * WEATHER_CACHE_MS);
    const f = fakeFetch({ [openMeteoUrl(DEMO_SITE)]: weatherJson });
    const r = await loadData({ site: DEMO_SITE, plant: DEMO_PLANT, kiosk: '' }, later, f.impl);
    assert.deepEqual(f.calls, [openMeteoUrl(DEMO_SITE)]);
    assert.equal(r.pv, null);
    assert.ok(r.forecast && r.forecast.days.length === 7);
    assert.notDeepEqual(r.forecast, fixtureData().forecast);
});

test('počasie sa drží v pamäti; pri výpadku ostáva staré, pri zlých dátach predpoveď nie je', async () => {
    const t0 = new Date(FIXED_NOW.getTime() + 10 * WEATHER_CACHE_MS);
    const settings = { site: SITE, plant: PLANT, kiosk: '' };
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
    const broken = fakeFetch({ [openMeteoUrl(DEMO_SITE)]: { hourly: { time: 'x' } } });
    const r = await loadData({ site: DEMO_SITE, plant: DEMO_PLANT, kiosk: '' }, new Date(t0.getTime() + 5 * WEATHER_CACHE_MS), broken.impl);
    assert.equal(r.forecast, null);
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

test('vlastný kiosk: odkaz ide Workeru v tele POST, cron Workera sa nepýta', async () => {
    const kiosk = 'https://region01eu5.fusionsolar.huawei.com/pvmswebsite/nologin/assets/build/index.html#/kiosk?kk=Abc123xyz';
    /** @type {Array<{ url: string, init: any }>} */ const calls = [];
    const impl = /** @type {typeof fetch} */ (
        /** @type {unknown} */ (
            async (/** @type {string} */ url, /** @type {any} */ init) => {
                calls.push({ url, init });
                if (url === WORKER_PV_URL) return { ok: true, status: 200, json: async () => ({ pv }) };
                return { ok: true, status: 200, json: async () => weatherJson };
            }
        )
    );
    const r = await loadData({ site: DEMO_SITE, plant: DEMO_PLANT, kiosk }, FIXED_NOW, impl);
    assert.deepEqual(r.pv, pv);
    const post = calls.find((c) => c.url === WORKER_PV_URL);
    assert.ok(post);
    assert.equal(post.init.method, 'POST');
    assert.equal(post.init.body, kiosk);
    // Každá požiadavka má časový limit - zaseknuté spojenie nesmie čakať donekonečna.
    assert.ok(
        calls.every((c) => c.init.signal instanceof AbortSignal),
        'požiadavka bez časového limitu',
    );
    assert.equal(r.pvFailed, false);
    assert.ok(!calls.some((c) => c.url.includes('Abc123xyz')), 'odkaz nie je v žiadnej adrese');

    const down = fakeFetch({ [openMeteoUrl(DEMO_SITE)]: weatherJson });
    const failed = await loadData({ site: DEMO_SITE, plant: DEMO_PLANT, kiosk }, FIXED_NOW, down.impl);
    assert.equal(failed.pv, null);
    assert.equal(failed.pvFailed, true, 'výpadok kiosku sa odlíši od chýbajúceho kiosku');
    assert.ok(failed.forecast, 'výpadok kiosku predpoveď nezhodí');
});

test('kiosk vráti nezmysel: meranie nie je, predpoveď áno', async () => {
    const kiosk = 'https://region01eu5.fusionsolar.huawei.com/pvmswebsite/nologin/assets/build/index.html#/kiosk?kk=Abc123xyz';
    const f = fakeFetch({ [WORKER_PV_URL]: { pv: { nezmysel: 1 } }, [openMeteoUrl(SITE)]: weatherJson });
    const r = await loadData({ site: SITE, plant: PLANT, kiosk }, FIXED_NOW, f.impl);
    assert.equal(r.pv, null);
    assert.ok(r.forecast);
});
