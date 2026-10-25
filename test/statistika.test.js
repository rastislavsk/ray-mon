import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installedKw, PLANT, SITE, TARIFF } from '../shared/config.js';
import { kwpText } from '../shared/format.js';
import { statsLinkText, STATISTIKA_TEXTS, statistikaTexts, summaryMeter } from '../shared/messages.js';
import { STATS_PERIODS } from '../shared/stats.js';
import { statistikaModel } from '../shared/statistika.js';
import { summaryModel } from '../shared/summary.js';
import { FIXED_NOW, fixtureData } from './helpers.js';

const { pv, forecast } = fixtureData();
/** Tarifa Dvorian s cenami: NT lacné, VT drahé. */
const PRICED = { ...TARIFF, bands: TARIFF.bands.map((b) => ({ ...b, price: b.id === 'nt' ? 0.14 : 0.19 })) };
/** Denník: tri dni septembra (3. je najlepší), jeden augustový a jeden z minulého roka. */
const LOG = { '2025-12-31': 2, '2026-08-20': 40, '2026-09-01': 20, '2026-09-03': 35.5, '2026-09-04': 12 };
const BASE = {
    now: FIXED_NOW,
    site: SITE,
    plant: PLANT,
    tariff: PRICED,
    zdroj: { sposob: 'huawei-kiosk', pecat: 'v1.test-pecat-0123456789', nazov: '' },
    known: /** @type {import('../shared/settings.js').Known} */ ('elektraren'),
    loading: false,
    pv,
    forecast,
    dayLog: LOG,
};
/** Bez kiosku: meranie nie je, dnešok z predpovede. */
const NO_KIOSK = { ...BASE, zdroj: null, pv: null };

test('texty: odkaz z Môžem? a pás pod veľkým číslom', () => {
    assert.equal(statsLinkText('September na streche', 168.2), 'September na streche: 168 kWh');
    assert.deepEqual(summaryMeter({ pct: 52, forecastKwh: 61.44 }), { pct: 52, left: 'z predpovede 61,4 kWh', right: '52 %' });
    assert.equal(summaryMeter({ pct: 130, forecastKwh: 20 }).pct, 100, 'pás nepretečie, veta povie celé číslo');
    assert.equal(summaryMeter({ pct: 130, forecastKwh: 20 }).right, '130 %');
    assert.deepEqual(summaryMeter({ payback: 0.183 }), { pct: 18, left: 'uhlík z výroby panelov', right: '18 % splatené' });
    assert.equal(summaryMeter({ payback: 1.2 }).right, 'splatený');
    assert.notEqual(statistikaTexts('slusny').note, STATISTIKA_TEXTS.note, 'veta o hodnote má aj vykanie');
});

test('statistikaModel: so živým meraním plagát zo summaryModel pre každé obdobie', () => {
    for (const period of STATS_PERIODS) {
        const m = statistikaModel(BASE, period);
        assert.equal(m.kind, 'ok');
        assert.equal(m.sub, kwpText(installedKw(PLANT)));
        assert.deepEqual(m.summary, summaryModel(BASE, period), period);
        assert.equal(m.measure, null);
        assert.equal(m.prices, false);
    }
    assert.match(statistikaModel(BASE, 'mesiac', { voice: 'slusny' }).summary?.note ?? '', /by ste/, 'poznámka v tóne appky');
});

test('statistikaModel: bez cien výzva doplniť ceny', () => {
    const m = statistikaModel({ ...BASE, tariff: TARIFF }, 'mesiac');
    assert.equal(m.prices, true);
    assert.equal(m.summary?.kwh, pv.monthEnergyKwh);
});

test('statistikaModel: bez kiosku dnešok z predpovede ako odhad a výzva na meranie', () => {
    for (const period of STATS_PERIODS) {
        const m = statistikaModel(NO_KIOSK, period);
        assert.equal(m.kind, 'ok');
        assert.equal(m.summary?.kind, 'estimate');
        assert.equal(m.summary?.period, 'dnes');
        assert.equal(m.measure, 'ask');
    }
    // Kiosk zadaný, ale neodpovedá: veta namiesto výzvy.
    assert.equal(statistikaModel({ ...BASE, pv: null }, 'mesiac').measure, 'off');
    // Bez dnešku v predpovedi: plagát nie je, výzva na meranie áno.
    const empty = statistikaModel({ ...NO_KIOSK, forecast: { ...forecast, days: [] } }, 'dnes');
    assert.equal(empty.summary, null);
    assert.equal(empty.measure, 'ask');
});

test('statistikaModel: stavy bez čísel - bez polohy, bez panelov, načítavanie, bez dát', () => {
    assert.equal(statistikaModel({ ...BASE, known: 'nic' }, 'dnes').kind, 'ask');
    const setup = statistikaModel({ ...BASE, known: 'poloha' }, 'dnes');
    assert.equal(setup.kind, 'setup');
    assert.equal(setup.sub, STATISTIKA_TEXTS.setupSub);
    assert.equal(setup.summary, null);
    const loading = statistikaModel({ ...BASE, pv: null, forecast: null, loading: true }, 'dnes');
    assert.equal(loading.kind, 'loading');
    assert.equal(loading.retry, false);
    const offline = statistikaModel({ ...BASE, pv: null, forecast: null }, 'dnes', { online: false });
    assert.equal(offline.kind, 'offline');
    assert.equal(offline.retry, true);
    assert.match(offline.sub, /Nie je internet/);
    assert.match(statistikaModel({ ...BASE, pv: null, forecast: null }, 'dnes').sub, /Predpoveď počasia neprišla/);
});
