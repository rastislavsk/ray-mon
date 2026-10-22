import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carbonPayback, co2SavedKg } from '../shared/carbon.js';
import { EVERYDAY, installedKw, PLANT, SITE, TARIFF } from '../shared/config.js';
import { fmt1, fmtSum, kwpText } from '../shared/format.js';
import {
    posterBestDay,
    posterButtonText,
    posterCo2Value,
    posterLinkText,
    posterPayback,
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
    zdroj: { sposob: 'huawei-kiosk', pecat: 'v1.test-pecat-0123456789', nazov: '' },
    known: /** @type {import('../shared/settings.js').Known} */ ('elektraren'),
    loading: false,
    pv,
    forecast,
    dayLog: LOG,
};
/** Bez kiosku: meranie nie je, dnešok z predpovede, ostatné z denníka. */
const NO_KIOSK = { ...BASE, zdroj: null, pv: null };

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

test('summaryModel: facts sú čísla riadkov', () => {
    const month = /** @type {NonNullable<ReturnType<typeof summaryModel>>} */ (summaryModel(BASE, 'mesiac'));
    assert.equal(month.facts.kwh, pv.monthEnergyKwh);
    assert.equal(month.facts.phones, pv.monthEnergyKwh / EVERYDAY.phoneChargeKwh);
    assert.equal(month.facts.km, pv.monthEnergyKwh * EVERYDAY.evKmPerKwh);
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
    const d = { time: '13:00', month: 'septembri' };
    assert.equal(statsHeroSub('dnes', d), 'vyrobené dnes do 13:00');
    assert.equal(statsHeroSub('mesiac', d), 'vyrobené v septembri');
    assert.equal(statsHeroSub('rok', d), 'vyrobené tento rok');
    assert.equal(statsHeroSub('spolu', d), 'vyrobené od spustenia');
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
    assert.equal(posterBestDay({ date: '2026-06-14', today: false }, 'rok'), '14. 6.', 'v roku s mesiacom');
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
        assert.equal(m.periods, true);
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
            ['mesiac', 'tyzden', 'rok'],
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
    assert.equal(dnes.posters[2].label, 'Rok 2026 na streche · zdieľať');
    assert.deepEqual(dnes.best, statsBestText({ date: '2026-09-03', kwh: 35.5, today: false }));
});

test('statistikaModel: bez cien len kWh a výzva doplniť ceny, bez vety o spotrebe', () => {
    const m = statistikaModel({ ...BASE, tariff: TARIFF }, 'mesiac');
    assert.equal(m.value, null);
    assert.equal(m.prices, true);
    assert.equal(m.note, '');
    assert.equal(m.hero?.kwh, pv.monthEnergyKwh);
});

test('statistikaModel: bez kiosku len dnešok z predpovede ako odhad a výzva na meranie, nič z denníka', () => {
    const s = statsModel(NO_KIOSK, 'dnes');
    for (const period of STATS_PERIODS) {
        const m = statistikaModel(NO_KIOSK, period);
        assert.equal(m.kind, 'ok');
        assert.equal(m.periods, false, 'prepínač obdobia bez súčtov z kiosku nie je');
        assert.equal(m.hero?.period, 'dnes');
        assert.equal(m.hero?.kwh, s.forecastToday?.kwh);
        assert.equal(m.hero?.estimate, true);
        assert.equal(m.hero?.sub, STATISTIKA_TEXTS.forecastSub);
        assert.deepEqual(m.rows, [], 'mesiac, rok ani spolu si appka nedoskladá');
        assert.equal(m.best, null);
        assert.equal(m.value, statsValueText(/** @type {number} */ (s.forecastToday?.value), '€', true));
        assert.equal(m.progress, null);
        assert.equal(m.measure, 'ask');
        assert.equal(m.note, '');
        assert.deepEqual(m.posters, [], 'plagát bez merania nie je');
    }
    // Kiosk zadaný, ale neodpovedá: veta namiesto výzvy.
    assert.equal(statistikaModel({ ...BASE, pv: null }, 'mesiac').measure, 'off');
    // Bez dnešku v predpovedi: pomlčka a „to je ako“ nie je.
    const empty = statistikaModel({ ...NO_KIOSK, forecast: { ...forecast, days: [] } }, 'dnes');
    assert.equal(empty.hero?.kwh, null);
    assert.equal(empty.equiv, null);
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
    const input = BASE;
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
        { value: `~${fmtSum(/** @type {number} */ (s.facts.value), 0)} €`, label: 'hodnota podľa tarify' },
        { value: posterCo2Value(co2SavedKg(s.kwh)), label: 'CO2eq menej ako zo siete' },
        {
            value: `${posterPayback(/** @type {number} */ (carbonPayback(pv.cumulativeEnergyKwh, PLANT))).pct} %`,
            label: 'uhlíka panelov od spustenia',
        },
    ]);
    assert.ok(m.note.startsWith(s.note), 'najprv chýbajúce dni');
    assert.match(m.note, /Za 1 deň appka čísla nemá/);
    assert.ok(
        m.note.endsWith(
            'kWh zo siete SR 95 g (Ember 2025), zo slnka 30 g (IEA PVPS 2023, prepočítané na výrobu v SR). ' +
                'Výroba týchto panelov aj s meničom stála asi 11,0 t CO2eq, rozpočítaná na 30 rokov prevádzky.',
        ),
        m.note,
    );
    // Bez súčtu od spustenia nie je splatenie ani dlh panelov, úspora za obdobie ostáva.
    const noTotal = /** @type {NonNullable<ReturnType<typeof posterModel>>} */ (
        posterModel({ ...input, pv: { ...pv, cumulativeEnergyKwh: null } }, 'mesiac')
    );
    assert.ok(!noTotal.tiles.some((t) => t.label.startsWith('uhlík')));
    assert.ok(noTotal.tiles.some((t) => t.label === 'CO2eq menej ako zo siete'));
    assert.doesNotMatch(noTotal.note, /Výroba týchto panelov/);
    const paid = posterModel({ ...input, pv: { ...pv, cumulativeEnergyKwh: 1e6 } }, 'mesiac');
    assert.deepEqual(paid?.tiles.at(-1), { value: '100 %', label: 'uhlík panelov splatený' });
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
