// Obnova dát (web/refresh.js): kedy sa appka pýta Workera na meranie, čo spraví s odpoveďou,
// odmietnutím a výpadkom a čo si zapíše do úložiska. Sieť, úložisko aj hodiny sú falošné.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    MERANIE_STORAGE_KEY,
    PLANT,
    PRISTUP_STORAGE_KEY,
    SETTINGS_STORAGE_KEY,
    SITE,
    TARIFF_TEMPLATES,
    WORKER_PV_URL,
    openMeteoUrl,
} from '../shared/config.js';
import { createRefresh } from '../web/refresh.js';
import { createStore, initialState } from '../web/state.js';
import { FIXED_NOW, fakeStorage, fixture, pvAt } from './helpers.js';

const PECAT = 'v1.AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const NOVA_PECAT = 'v1.ZyXwVuTsRqPoNmLkJiHgFeDcBa543210';
/** Huawei cez API účet: výrobca dáva dáta raz za 5 minút (shared/zdroje.js). */
const ZDROJ = { sposob: 'huawei-northbound', nazov: 'Dvorany', pecat: PECAT };
const SAVED = { site: SITE, plant: PLANT, tariff: TARIFF_TEMPLATES.jedna, zdroj: ZDROJ };
const MIN = 60 * 1000;

/**
 * Appka s pripojeným meraním (alebo s daným nastavením), falošné úložisko a falošná sieť: počasie
 * vždy, Worker odpovedá z frontu `odpovede` (prázdny front = výpadok 500).
 * @param {import('node:test').TestContext} t
 * @param {{ saved?: object | null, site?: object | null }} [start]
 */
function appka(t, start = { saved: SAVED }) {
    t.mock.timers.enable({ apis: ['Date'], now: FIXED_NOW });
    const storage = fakeStorage();
    /** @type {Array<{ status: number, body?: unknown }>} */ const odpovede = [];
    /** @type {string[]} */ const dopyty = [];
    const weather = fixture('open-meteo.json');
    /** @type {any} */ (globalThis).fetch = async (/** @type {string} */ url, /** @type {any} */ init) => {
        if (url === openMeteoUrl(SITE)) return { ok: true, status: 200, json: async () => weather };
        assert.equal(url, WORKER_PV_URL);
        dopyty.push(init.body);
        const r = odpovede.shift() ?? { status: 500 };
        return { ok: r.status < 300, status: r.status, json: async () => r.body ?? {} };
    };
    t.after(() => {
        storage.restore();
        delete (/** @type {any} */ (globalThis).fetch);
    });
    const store = createStore(initialState(FIXED_NOW, { wide: false, tall: true }, /** @type {any} */ (start)));
    return { store, refresh: createRefresh(/** @type {any} */ (store)), odpovede, dopyty, saved: storage.saved };
}

/** Odpoveď Workera s meraním v danej chvíli. @param {Date} at @param {string} [pecat] */
const meranie = (at, pecat) => ({ status: 200, body: { pv: pvAt(at), ...(pecat ? { pecat } : {}) } });

/** Posunie hodiny appky. @param {import('node:test').TestContext} t @param {number} ms */
const posun = (t, ms) => t.mock.timers.setTime(Date.now() + ms);

test('bez polohy appka nič nesťahuje', async (t) => {
    const a = appka(t, {});
    await a.refresh();
    assert.equal(a.store.get().loading, true);
    assert.equal(a.store.get().forecast, null);
});

test('bez merania: predpoveď z počasia, Worker sa nevolá', async (t) => {
    const a = appka(t, { saved: { ...SAVED, zdroj: null } });
    await a.refresh();
    const s = a.store.get();
    assert.equal(s.loading, false);
    assert.ok(s.forecast);
    assert.equal(s.pv, null);
    assert.deepEqual(a.dopyty, []);
});

test('meranie: prvá obnova sa pýta, ďalšia do intervalu spôsobu nie; dopyt sa zapíše do spoločného rytmu', async (t) => {
    const a = appka(t);
    a.odpovede.push(meranie(FIXED_NOW));
    await a.refresh();
    assert.deepEqual(a.dopyty, [PECAT], 'Workeru ide zapečatený prístup');
    assert.equal(a.store.get().pv?.updatedAt, pvAt(FIXED_NOW).updatedAt);
    assert.ok(a.saved.has(MERANIE_STORAGE_KEY), 'rytmus je spoločný pre obe appky');
    assert.ok(Object.keys(a.store.get().dayLog).length, 'dnešok je v denníku výroby');

    posun(t, MIN);
    await a.refresh();
    assert.equal(a.dopyty.length, 1, 'Huawei dá nové dáta až o 5 minút');
    assert.ok(a.store.get().pv, 'posledné meranie ostáva');

    posun(t, 5 * MIN);
    a.odpovede.push(meranie(new Date(Date.now())));
    await a.refresh();
    assert.equal(a.dopyty.length, 2);
});

test('súbežné obnovy: kým jedna beží, ďalšia dostane tú istú a Worker sa pýta raz', async (t) => {
    const a = appka(t);
    a.odpovede.push(meranie(FIXED_NOW));
    const prva = a.refresh();
    assert.ok(a.saved.has(MERANIE_STORAGE_KEY), 'dopyt je v rytme hneď, nie až s odpoveďou - druhá appka sa medzitým nepýta');
    assert.equal(a.refresh(), prva);
    await prva;
    assert.equal(a.dopyty.length, 1);
});

test('výpadok: posledné meranie ostáva najviac STALE_PV_MS, potom zmizne', async (t) => {
    const a = appka(t);
    a.odpovede.push(meranie(FIXED_NOW));
    await a.refresh();
    const pv = a.store.get().pv;
    assert.ok(pv);

    posun(t, 5 * MIN);
    await a.refresh(); // front je prázdny - Worker odpovie 500
    assert.equal(a.dopyty.length, 2);
    assert.equal(a.store.get().pv, pv);
    assert.equal(a.store.get().pristup, null, 'výpadok nie je odmietnutý prístup');

    posun(t, 20 * MIN);
    await a.refresh();
    assert.equal(a.store.get().pv, null, 'staré meranie by sa tvárilo ako výkon teraz');
});

test('odmietnutý prístup: odmietnutia sa rátajú a ukladajú, po dvoch meranie zmizne, úspech ich zmaže', async (t) => {
    const a = appka(t);
    a.odpovede.push(meranie(FIXED_NOW));
    await a.refresh();

    a.odpovede.push({ status: 400, body: { kod: 'prihlasenie:20400' } });
    await a.refresh({ skus: true });
    assert.equal(a.store.get().pristup?.n, 1);
    assert.equal(a.store.get().pristup?.kod, 'prihlasenie:20400');
    assert.ok(a.store.get().pv, 'po prvom odmietnutí ešte nie je isté, že prístup neplatí');
    assert.ok(a.saved.has(PRISTUP_STORAGE_KEY), 'appka po otvorení nebude skúšať zlé heslo hneď znova');

    // Bez „Skúsiť znova“ sa po odmietnutí čaká interval spôsobu.
    await a.refresh();
    assert.equal(a.dopyty.length, 2);

    a.odpovede.push({ status: 400, body: {} });
    await a.refresh({ skus: true });
    assert.equal(a.store.get().pristup?.n, 2);
    assert.equal(a.store.get().pv, null, 'prístup neplatí - meranie sa netvári ako teraz');

    a.odpovede.push(meranie(new Date(Date.now())));
    await a.refresh({ skus: true });
    assert.equal(a.store.get().pristup, null);
    assert.ok(a.store.get().pv);
    assert.equal(a.saved.get(PRISTUP_STORAGE_KEY), undefined);
});

test('nová pečať od Workera sa uloží do nastavenia', async (t) => {
    const a = appka(t);
    a.odpovede.push(meranie(FIXED_NOW, NOVA_PECAT));
    await a.refresh();
    assert.equal(a.store.get().zdroj?.pecat, NOVA_PECAT);
    assert.match(a.saved.get(SETTINGS_STORAGE_KEY) ?? '', new RegExp(NOVA_PECAT));
});

test('druhá appka medzitým obnovila prístup: pred dopytom sa prevezme uložená pečať', async (t) => {
    const a = appka(t);
    a.odpovede.push(meranie(FIXED_NOW, NOVA_PECAT));
    await a.refresh();
    // Akoby nová pečať prišla v druhej appke: v úložisku je, v stave tejto ešte stará.
    a.store.setState({ zdroj: ZDROJ });
    posun(t, 5 * MIN);
    a.odpovede.push(meranie(new Date(Date.now())));
    await a.refresh();
    assert.equal(a.dopyty[1], NOVA_PECAT);
});

test('kým sa sťahovalo, človek uložil inú elektráreň: stará odpoveď sa zahodí', async (t) => {
    const a = appka(t);
    a.odpovede.push(meranie(FIXED_NOW));
    const bezi = a.refresh();
    a.store.setState({ zdroj: null });
    await bezi;
    assert.equal(a.store.get().pv, null);
    assert.equal(a.store.get().loading, true, 'stav novej elektrárne odpoveď nezmenila');
});
