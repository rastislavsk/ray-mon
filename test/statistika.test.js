import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVERYDAY, installedKw, PLANT, SITE, TARIFF } from '../shared/config.js';
import { logSum } from '../shared/daylog.js';
import { fmt1, fmtSum, kwpText } from '../shared/format.js';
import { sunRuns } from '../shared/launches.js';
import {
    posterBestDay,
    posterButtonText,
    posterLinkText,
    statsBestText,
    statsHeroSub,
    statsProgressText,
    statsValueText,
    STATISTIKA_TEXTS,
} from '../shared/messages.js';
import { STATS_PERIODS, statsModel } from '../shared/stats.js';
import { kwhText, monthBest, posterModel, statistikaModel } from '../shared/statistika.js';
import { bestOf, summaryModel } from '../shared/summary.js';
import { FIXED_NOW, fixtureData } from './helpers.js';

const { pv, forecast } = fixtureData();
/** Tarifa Dvorian s cenami: NT lacné, VT drahé. */
const PRICED = { ...TARIFF, bands: TARIFF.bands.map((b) => ({ ...b, price: b.id === 'nt' ? 0.14 : 0.19 })) };
/** Denník: tri dni septembra (14. je najlepší), jeden augustový a jeden z minulého roka. */
const LOG = { '2025-12-31': 2, '2026-08-20': 40, '2026-09-01': 20, '2026-09-03': 35.5, '2026-09-04': 12 };
const BASE = {
    now: FIXED_NOW,
    site: SITE,
    plant: PLANT,
    tariff: PRICED,
    kiosk: 'kiosk',
    known: /** @type {import('../shared/settings.js').Known} */ ('elektraren'),
    loading: false,
    pv,
    forecast,
    launches: /** @type {import('../shared/launches.js').Launch[]} */ ([]),
    dayLog: LOG,
};
/** Bez kiosku: meranie nie je, dnešok z predpovede, ostatné z denníka. */
const NO_KIOSK = { ...BASE, kiosk: '', pv: null };

test('logSum: súčet zapísaných dní podľa začiatku dátumu, bez dňa null', () => {
    assert.deepEqual(logSum(LOG, '2026-09-'), { kwh: 67.5, days: 3 });
    assert.deepEqual(logSum(LOG, '2026-'), { kwh: 107.5, days: 4 });
    assert.deepEqual(logSum(LOG, ''), { kwh: 109.5, days: 5 });
    assert.deepEqual(logSum(LOG, '2026-10-'), { kwh: null, days: 0 });
    assert.deepEqual(logSum({}, ''), { kwh: null, days: 0 });
});

test('sunRuns: len daná vec, len na slnku, len v dňoch obdobia', () => {
    const list = [
        { d: '2026-08-31', id: 'pracka', m: 600, sun: true },
        { d: '2026-09-01', id: 'pracka', m: 600, sun: true },
        { d: '2026-09-02', id: 'pracka', m: 1300, sun: false },
        { d: '2026-09-03', id: 'susicka', m: 700, sun: true },
        { d: '2026-09-05', id: 'pracka', m: 700, sun: true },
    ];
    assert.equal(sunRuns(list, 'pracka', '2026-09-01', '2026-09-05'), 2);
    assert.equal(sunRuns(list, 'pracka', '2026-08-30', '2026-09-05'), 3);
    assert.equal(sunRuns(list, 'susicka', '2026-09-01', '2026-09-05'), 1);
    assert.equal(sunRuns([], 'pracka', '2026-09-01', '2026-09-05'), 0);
});

test('bestOf: najvyšší deň, deň bez čísla sa nepočíta, pri rovnosti skorší', () => {
    assert.deepEqual(
        bestOf([
            { date: '2026-09-01', kwh: 20 },
            { date: '2026-09-02', kwh: null },
            { date: '2026-09-03', kwh: 35.5 },
            { date: '2026-09-04', kwh: 35.5 },
        ]),
        { date: '2026-09-03', kwh: 35.5 },
    );
    assert.equal(bestOf([{ date: '2026-09-01', kwh: null }]), null);
});

test('summaryModel: facts sú čísla riadkov, prania zo slnka v dňoch obdobia', () => {
    const launches = [
        { d: '2026-08-31', id: 'pracka', m: 600, sun: true },
        { d: '2026-09-02', id: 'pracka', m: 600, sun: true },
        { d: '2026-09-04', id: 'pracka', m: 1300, sun: false },
        { d: '2026-09-05', id: 'umyvacka', m: 700, sun: true },
    ];
    const month = /** @type {NonNullable<ReturnType<typeof summaryModel>>} */ (summaryModel({ ...BASE, launches }, 'mesiac'));
    assert.equal(month.facts.kwh, pv.monthEnergyKwh);
    assert.equal(month.facts.phones, pv.monthEnergyKwh / EVERYDAY.phoneChargeKwh);
    assert.equal(month.facts.km, pv.monthEnergyKwh * EVERYDAY.evKmPerKwh);
    assert.equal(month.facts.washes, 1, 'augustové pranie do septembra nepatrí, nočné nie je zo slnka');
    assert.deepEqual(month.facts.launches, { all: 3, sun: 2 });
    const week = /** @type {NonNullable<ReturnType<typeof summaryModel>>} */ (summaryModel({ ...BASE, launches }, 'tyzden'));
    assert.equal(week.facts.washes, 2, 'posledných 7 dní siaha do augusta');
});

test('monthBest: najlepší deň mesiaca z denníka aj s dneškom z merania; z jedného dňa nič', () => {
    assert.deepEqual(monthBest(BASE, '2026-09-05'), { date: '2026-09-03', kwh: 35.5, today: false });
    // Dnešok zo živého merania prebije zapísané dni, keď je vyšší.
    const high = { ...BASE, pv: { ...pv, dailyEnergyKwh: 50 } };
    assert.deepEqual(monthBest(high, '2026-09-05'), { date: '2026-09-05', kwh: 50, today: true });
    assert.equal(monthBest({ ...BASE, dayLog: {} }, '2026-09-05'), null, 'len dnešok - nie je s čím porovnať');
    assert.equal(monthBest({ ...NO_KIOSK, dayLog: { '2026-09-01': 0, '2026-09-02': 0 } }, '2026-09-05'), null, 'bez výroby');
});

test('texty: odkiaľ je číslo, hodnota, pás, najlepší deň a tlačidlá plagátu', () => {
    const d = { time: '13:00', month: 'septembri', days: 0 };
    assert.equal(statsHeroSub('dnes', { ...d, source: 'live' }), 'vyrobené dnes do 13:00');
    assert.equal(statsHeroSub('mesiac', { ...d, source: 'live' }), 'vyrobené v septembri');
    assert.equal(statsHeroSub('rok', { ...d, source: 'live' }), 'vyrobené tento rok');
    assert.equal(statsHeroSub('spolu', { ...d, source: 'live' }), 'vyrobené od spustenia');
    assert.equal(statsHeroSub('dnes', { ...d, source: 'forecast' }), 'odhad z predpovede na celý dnešok');
    assert.equal(statsHeroSub('mesiac', { ...d, source: 'log', days: 3 }), '3 dni v septembri v denníku appky');
    assert.equal(statsHeroSub('rok', { ...d, source: 'log', days: 1 }), '1 deň tento rok v denníku appky');
    assert.equal(statsHeroSub('spolu', { ...d, source: 'log', days: 12 }), '12 dní v denníku appky');
    assert.equal(statsHeroSub('rok', { ...d, source: 'log', days: 0 }), 'appka zatiaľ nemá zapísaný ani jeden deň');
    assert.equal(statsValueText(4.784, '€', false), 'Hodnota podľa tarify 4,78 €');
    assert.equal(statsValueText(1297.2, '€', true), `Hodnota podľa tarify ≈ ${fmtSum(1297.2, 2)} €`);
    assert.equal(statsProgressText(62, 51.04), '62 % z predpovede 51,0 kWh');
    assert.deepEqual(statsBestText({ date: '2026-09-12', kwh: 61, today: false }), {
        title: 'Najlepší deň septembra',
        text: 'Sobota 12. · 61,0 kWh. Strecha vtedy makala ako blázon.',
    });
    assert.equal(statsBestText({ date: '2026-10-05', kwh: 40.2, today: true }).title, 'Najlepší deň októbra');
    assert.equal(statsBestText({ date: '2026-10-05', kwh: 40.2, today: true }).text, 'Dnes · 40,2 kWh. Strecha dnes maká ako blázon.');
    assert.equal(posterBestDay({ date: '2026-09-12', today: false }), 'so 12.');
    assert.equal(posterBestDay({ date: '2026-09-12', today: true }), 'dnes');
    assert.equal(posterButtonText('September na streche'), 'September na streche · zdieľať');
    assert.equal(posterLinkText('September na streche', 168.2), 'September na streche: 168 kWh · súhrn na zdieľanie');
    assert.equal(kwhText(null), '–');
    assert.equal(kwhText(9112.4), fmtSum(9112.4, 1));
});

test('statistikaModel: so živým meraním čísla zo statsModel pre každé obdobie', () => {
    for (const period of STATS_PERIODS) {
        const m = statistikaModel(BASE, period);
        const s = statsModel(BASE, period);
        assert.equal(m.kind, 'ok');
        assert.equal(m.sub, kwpText(installedKw(PLANT)));
        assert.equal(m.hero?.kwh, s.hero.kwh, period);
        assert.equal(m.hero?.estimate, false);
        assert.deepEqual(
            m.rows.map((r) => [r.period, r.name, r.kwh]),
            s.rows.map((r) => [r.period, r.label, r.kwh]),
        );
        assert.equal(m.value, statsValueText(/** @type {number} */ (s.hero.value), '€', false));
        const kwh = /** @type {number} */ (s.hero.kwh);
        assert.deepEqual(m.equiv, {
            phones: `${fmtSum(Math.round(kwh / EVERYDAY.phoneChargeKwh), 0)}×`,
            km: `${fmtSum(Math.round(kwh * EVERYDAY.evKmPerKwh), 0)} km`,
        });
        assert.equal(m.note, STATISTIKA_TEXTS.note);
        assert.equal(m.measure, null);
        assert.equal(m.prices, false);
        assert.deepEqual(
            m.posters.map((p) => p.period),
            ['mesiac', 'tyzden'],
        );
    }
    const dnes = statistikaModel(BASE, 'dnes');
    const s = statsModel(BASE, 'dnes');
    assert.equal(dnes.hero?.sub, 'vyrobené dnes do 13:00');
    assert.deepEqual(dnes.progress, {
        pct: s.progress?.pct,
        text: statsProgressText(/** @type {number} */ (s.progress?.pct), /** @type {number} */ (s.forecastToday?.kwh)),
    });
    assert.equal(statistikaModel(BASE, 'mesiac').progress, null);
    assert.equal(statistikaModel(BASE, 'mesiac').hero?.sub, 'vyrobené v septembri');
    assert.equal(dnes.posters[0].label, 'September na streche · zdieľať');
    assert.equal(dnes.posters[1].label, 'Posledných 7 dní na streche · zdieľať');
    assert.deepEqual(dnes.best, statsBestText({ date: '2026-09-03', kwh: 35.5, today: false }));
});

test('statistikaModel: bez cien len kWh a výzva doplniť ceny, bez vety o spotrebe', () => {
    const m = statistikaModel({ ...BASE, tariff: TARIFF }, 'mesiac');
    assert.equal(m.value, null);
    assert.equal(m.prices, true);
    assert.equal(m.note, '');
    assert.equal(m.hero?.kwh, pv.monthEnergyKwh);
});

test('statistikaModel: bez kiosku dnešok z predpovede ako odhad, ostatné z denníka a výzva na meranie', () => {
    const dnes = statistikaModel(NO_KIOSK, 'dnes');
    const s = statsModel(NO_KIOSK, 'dnes');
    assert.equal(dnes.kind, 'ok');
    assert.equal(dnes.hero?.kwh, s.forecastToday?.kwh);
    assert.equal(dnes.hero?.estimate, true);
    assert.equal(dnes.hero?.sub, 'odhad z predpovede na celý dnešok');
    assert.equal(dnes.value, statsValueText(/** @type {number} */ (s.forecastToday?.value), '€', true));
    assert.equal(dnes.progress, null);
    assert.equal(dnes.measure, 'ask');
    assert.equal(dnes.note, '');
    assert.deepEqual(dnes.posters, [], 'plagát bez merania nie je');
    assert.deepEqual(
        dnes.rows.map((r) => [r.name, r.kwh, r.estimate]),
        [
            ['September', 67.5, true],
            ['Rok 2026', 107.5, true],
            [STATISTIKA_TEXTS.logAll, 109.5, true],
        ],
    );
    const mesiac = statistikaModel(NO_KIOSK, 'mesiac');
    assert.equal(mesiac.hero?.kwh, 67.5);
    assert.equal(mesiac.hero?.sub, '3 dni v septembri v denníku appky');
    assert.equal(mesiac.value, null, 'súčet z denníka sa neoceňuje');
    assert.equal(mesiac.rows[0].kwh, s.forecastToday?.kwh);
    // Prázdny denník: pomlčka a „to je ako“ nie je.
    const empty = statistikaModel({ ...NO_KIOSK, dayLog: {} }, 'rok');
    assert.equal(empty.hero?.kwh, null);
    assert.equal(empty.equiv, null);
    assert.equal(empty.best, null);
    // Kiosk zadaný, ale neodpovedá: veta namiesto výzvy.
    assert.equal(statistikaModel({ ...BASE, pv: null }, 'dnes').measure, 'off');
});

test('statistikaModel: stavy bez čísel - bez polohy, bez panelov, načítavanie, bez dát', () => {
    assert.equal(statistikaModel({ ...BASE, known: 'nic' }, 'dnes').kind, 'ask');
    const setup = statistikaModel({ ...BASE, known: 'poloha' }, 'dnes');
    assert.equal(setup.kind, 'setup');
    assert.equal(setup.sub, STATISTIKA_TEXTS.setupSub);
    assert.equal(setup.hero, null);
    assert.deepEqual(setup.posters, []);
    const loading = statistikaModel({ ...BASE, pv: null, forecast: null, loading: true }, 'dnes');
    assert.equal(loading.kind, 'loading');
    assert.equal(loading.retry, false);
    const offline = statistikaModel({ ...BASE, pv: null, forecast: null }, 'dnes', { online: false });
    assert.equal(offline.kind, 'offline');
    assert.equal(offline.retry, true);
    assert.match(offline.sub, /Nie je internet/);
    assert.match(statistikaModel({ ...BASE, pv: null, forecast: null }, 'dnes').sub, /Predpoveď počasia neprišla/);
});

test('posterModel: čísla zo summaryModel, stĺpce dní a chýbajúce dni', () => {
    const launches = [{ d: '2026-09-02', id: 'pracka', m: 600, sun: true }];
    const input = { ...BASE, launches };
    const m = /** @type {NonNullable<ReturnType<typeof posterModel>>} */ (posterModel(input, 'mesiac'));
    const s = /** @type {NonNullable<ReturnType<typeof summaryModel>>} */ (summaryModel(input, 'mesiac'));
    assert.equal(m.title, `September na streche · ${SITE.name}`);
    assert.equal(m.kwh, `${fmtSum(Math.round(s.kwh), 0)} kWh`);
    assert.equal(m.total, s.kwh);
    assert.equal(m.cols.length, 5, 'mesiac od 1. po dnešok');
    assert.deepEqual(
        m.cols.map((c) => c.h),
        s.days.map((d) => (d.frac === null ? null : Math.max(4, Math.round(d.frac * 100)))),
    );
    assert.equal(m.cols.filter((c) => c.best).length, 1);
    assert.deepEqual(m.tiles, [
        { value: `${fmtSum(Math.round(s.facts.phones), 0)}×`, label: 'nabitý mobil' },
        { value: `${fmtSum(Math.round(s.facts.km), 0)} km`, label: 'elektrickým autom' },
        { value: posterBestDay(/** @type {NonNullable<typeof s.facts.best>} */ (s.facts.best)), label: `najlepší deň, ${fmt1(35.5)} kWh` },
        { value: '1×', label: 'pranie zo slnka' },
        { value: `~${fmtSum(/** @type {number} */ (s.facts.value), 0)} €`, label: 'hodnota podľa tarify' },
    ]);
    assert.equal(m.note, s.note);
    assert.match(m.note, /Za 1 deň appka čísla nemá/);
    assert.equal(m.foot, 'RAY-MON · slnko nefakturuje');
    const week = /** @type {NonNullable<ReturnType<typeof posterModel>>} */ (
        posterModel({ ...BASE, tariff: TARIFF, dayLog: {} }, 'tyzden')
    );
    assert.equal(week.cols.length, 7);
    assert.equal(week.cols.filter((c) => c.h === null).length, 6, 'zo 7 dní je známy len dnešok');
    assert.ok(!week.tiles.some((t) => t.label === 'pranie zo slnka' || t.label === 'hodnota podľa tarify'));
    assert.equal(posterModel({ ...BASE, site: { ...SITE, name: '' } }, 'tyzden')?.title, 'Posledných 7 dní na streche');
    assert.equal(posterModel(NO_KIOSK, 'mesiac'), null);
});
