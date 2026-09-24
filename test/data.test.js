import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEMO_PLANT,
    DEMO_SITE,
    geocodeUrl,
    LEGACY_SOURCES,
    openMeteoUrl,
    PLANT,
    SITE,
    WEATHER_CACHE_MS,
    WORKER_URL,
} from '../shared/config.js';
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

test('Dvorany: živé meranie z Workera a predpoveď počítaná v prehliadači', async () => {
    const f = fakeFetch({ [WORKER_URL]: { pv }, [openMeteoUrl(SITE)]: weatherJson });
    const r = await loadData({ site: SITE, plant: PLANT }, FIXED_NOW, f.impl);
    assert.equal(r.source, 'worker');
    assert.deepEqual(r.pv, pv);
    assert.deepEqual(r.forecast, fixtureData().forecast);
});

test('iná lokalita: Worker sa ani nevolá, predpoveď je pre jej zostavu', async () => {
    const later = new Date(FIXED_NOW.getTime() + 2 * WEATHER_CACHE_MS);
    const f = fakeFetch({ [openMeteoUrl(DEMO_SITE)]: weatherJson });
    const r = await loadData({ site: DEMO_SITE, plant: DEMO_PLANT }, later, f.impl);
    assert.deepEqual(f.calls, [openMeteoUrl(DEMO_SITE)]);
    assert.equal(r.pv, null);
    assert.equal(r.source, null);
    assert.ok(r.forecast && r.forecast.days.length === 7);
    assert.notDeepEqual(r.forecast, fixtureData().forecast);
});

test('počasie sa drží v pamäti; pri výpadku ostáva staré, pri zlých dátach predpoveď nie je', async () => {
    const t0 = new Date(FIXED_NOW.getTime() + 10 * WEATHER_CACHE_MS);
    const settings = { site: SITE, plant: PLANT };
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
    // Worker aj záloha dole: živé meranie nie je.
    assert.equal(stale.pv, null);
    assert.ok(down.calls.includes(LEGACY_SOURCES.pv));
    // Nezmyselná odpoveď: predpoveď nie je, appka nespadne.
    const broken = fakeFetch({ [openMeteoUrl(DEMO_SITE)]: { hourly: { time: 'x' } } });
    const r = await loadData({ site: DEMO_SITE, plant: DEMO_PLANT }, new Date(t0.getTime() + 5 * WEATHER_CACHE_MS), broken.impl);
    assert.equal(r.forecast, null);
});

test('živé meranie zo zálohy, keď Worker nevráti platné pv', async () => {
    const f = fakeFetch({ [WORKER_URL]: { pv: { nezmysel: 1 } }, [LEGACY_SOURCES.pv]: pv });
    const r = await loadData({ site: SITE, plant: PLANT }, FIXED_NOW, f.impl);
    assert.equal(r.source, 'legacy');
    assert.deepEqual(r.pv, pv);
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
