// Odložené počasie medzi otvoreniami appky (web/data.js). Test načíta data.js viackrát (každé
// otvorenie s prázdnou pamäťou) a meranie pokrytia v Node 22 potom z celého behu započíta len
// jednu kópiu - pokrytie data.js by vyšlo okolo 60 %, hoci ho testy prejdú celé. Preto beží
// v samostatnom behu bez merania pokrytia (test/run.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openMeteoUrl, PLANT, SITE, TYPICAL_PLANT, WEATHER_KEEP_MS, WEATHER_STORAGE_KEY } from '../../shared/config.js';
import { FIXED_NOW, fakeFetch, fakeStorage, fixture, fixtureData } from '../helpers.js';

/** Iná elektráreň než Dvorany - na overenie, že sa odložené počasie berie len pre tú istú lokalitu. */
const OTHER_SITE = { name: 'Sevilla', lat: 37.39, lon: -5.98, elevationM: 10, timezone: 'Europe/Madrid' };

const weatherJson = fixture('open-meteo.json');

/**
 * Nové otvorenie appky: modul data.js načítaný nanovo, s prázdnou pamäťou (adresa s ?značkou je
 * pre Node iný modul).
 * @param {string} tag @returns {Promise<typeof import('../../web/data.js')>}
 */
const openApp = (tag) => import(/** @type {string} */ (`../../web/data.js?${tag}`));

test('počasie sa odkladá v prehliadači: po otvorení je predpoveď hneď, bez siete', async () => {
    const { saved, restore } = fakeStorage();
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
        restore();
    }
});
