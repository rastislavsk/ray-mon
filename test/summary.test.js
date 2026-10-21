import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAYLOG, EVERYDAY, PLANT, SITE, TARIFF } from '../shared/config.js';
import { lastDays, monthDays, parseDayLog, recordDay } from '../shared/daylog.js';
import { fmtSum } from '../shared/format.js';
import { carbonFacts } from '../shared/carbon.js';
import { plural, posterCo2Value, posterPayback, SUMMARY_TRIPS } from '../shared/messages.js';
import { summaryModel } from '../shared/summary.js';
import { FIXED_NOW, fixtureData } from './helpers.js';

const { pv, forecast } = fixtureData();
/** Tarifa Dvorian s cenami: NT lacné, VT drahé. */
const PRICED = { ...TARIFF, bands: TARIFF.bands.map((b) => ({ ...b, price: b.id === 'nt' ? 0.14 : 0.19 })) };
const BASE = {
    now: FIXED_NOW,
    site: SITE,
    plant: PLANT,
    tariff: PRICED,
    kiosk: 'kiosk',
    loading: false,
    pv,
    forecast,
    launches: [],
    dayLog: {},
};

test('parseDayLog: len platné dni, zoradené, najviac DAYLOG.limit', () => {
    assert.deepEqual(parseDayLog({ '2026-09-02': 20, '2026-09-01': 12.5, '1.9.2026': 3, '2026-09-03': -1, '2026-09-04': 'x' }), {
        '2026-09-01': 12.5,
        '2026-09-02': 20,
    });
    assert.deepEqual(parseDayLog([1, 2]), {});
    assert.deepEqual(parseDayLog(null), {});
    const many = Object.fromEntries(
        Array.from({ length: DAYLOG.limit + 3 }, (_, i) => [
            `2025-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
            i,
        ]),
    );
    assert.ok(Object.keys(parseDayLog(many)).length <= DAYLOG.limit);
});

test('recordDay: od rána, len vyšší súčet, bez zmeny ten istý objekt', () => {
    const log = { '2026-09-05': 10 };
    assert.equal(recordDay(log, '2026-09-05', DAYLOG.fromMin - 1, 30), log, 'tesne po polnoci sa nezapisuje');
    assert.equal(recordDay(log, '2026-09-05', 600, 8), log, 'nižší súčet deň nezníži');
    assert.equal(recordDay(log, '2026-09-05', 600, null), log);
    assert.deepEqual(recordDay(log, '2026-09-05', 600, 12), { '2026-09-05': 12 });
    assert.deepEqual(recordDay(log, '2026-09-06', 600, 1), { '2026-09-05': 10, '2026-09-06': 1 });
});

test('lastDays a monthDays: dni až po dnešok, chýbajúce sú null', () => {
    const log = { '2026-09-01': 5, '2026-09-04': 7 };
    assert.deepEqual(lastDays(log, '2026-09-05', 3), [
        { date: '2026-09-03', kwh: null },
        { date: '2026-09-04', kwh: 7 },
        { date: '2026-09-05', kwh: null },
    ]);
    const month = monthDays(log, '2026-09-05');
    assert.equal(month.length, 5);
    assert.equal(month[0].date, '2026-09-01');
});

test('plural a trasy', () => {
    assert.equal(plural(1, ['rok', 'roky', 'rokov']), 'rok');
    assert.equal(plural(3, ['rok', 'roky', 'rokov']), 'roky');
    assert.equal(plural(7, ['rok', 'roky', 'rokov']), 'rokov');
    assert.ok(
        SUMMARY_TRIPS.every((t, i) => i === 0 || t.km > SUMMARY_TRIPS[i - 1].km),
        'trasy idú od najkratšej',
    );
});

test('summaryModel: bez merania nie je', () => {
    assert.equal(summaryModel({ ...BASE, pv: null }, 'mesiac'), null);
});

test('summaryModel mesiac: súčet z kiosku, prepočty, hodnota a chýbajúce dni', () => {
    const m = /** @type {NonNullable<ReturnType<typeof summaryModel>>} */ (summaryModel(BASE, 'mesiac'));
    assert.equal(m.kick, 'September na streche');
    assert.equal(m.kwh, pv.monthEnergyKwh);
    assert.equal(m.days.length, 5, '1. až 5. september');
    assert.equal(m.days[4].best, true, 'dnešok z kiosku je jediný známy deň');
    const kwh = /** @type {number} */ (pv.monthEnergyKwh);
    assert.equal(m.rows[0].t, `${fmtSum(Math.round(kwh / EVERYDAY.phoneChargeKwh), 0)} nabití mobilu`);
    assert.equal(m.rows[1].t, `${fmtSum(Math.round(kwh * EVERYDAY.evKmPerKwh), 0)} km autom`);
    assert.ok(m.rows.some((r) => r.t.startsWith('Hodnota ~') && r.t.endsWith(' €')));
    assert.equal(m.rows.find((r) => r.t.startsWith('Najlepší deň'))?.t, 'Najlepší deň: dnes');
    assert.match(m.note, /^Za 4 dni appka čísla nemá – vtedy ju nikto neotvoril\. CO2eq za celý životný cyklus podľa Ember 2025/);
    // Uhlík v jednom riadku: úspora za mesiac a pod ňou splatený podiel dlhu panelov - z toho istého
    // výpočtu ako plagát.
    const f = carbonFacts(kwh, pv.cumulativeEnergyKwh, PLANT);
    const co2 = `${posterCo2Value(f.co2Kg)} CO2eq menej`;
    assert.deepEqual(m.rows.at(-1), {
        t: co2,
        s: `od spustenia panely splatili ${posterPayback(/** @type {number} */ (f.payback)).pct} % uhlíka zo svojej výroby`,
    });
    const splatene = summaryModel({ ...BASE, pv: { ...pv, cumulativeEnergyKwh: 1e6 } }, 'mesiac');
    assert.deepEqual(splatene?.rows.at(-1), { t: co2, s: 'uhlík z výroby panelov už je splatený' });
    const bezSuctu = summaryModel({ ...BASE, pv: { ...pv, cumulativeEnergyKwh: null } }, 'mesiac');
    assert.deepEqual(bezSuctu?.rows.at(-1), { t: co2, s: 'než zo siete SR, aj s uhlíkom z výroby panelov' }, 'bez súčtu len úspora');
    assert.doesNotMatch(bezSuctu?.note ?? '', /Výroba týchto panelov/);
});

test('summaryModel týždeň: súčet denníka s dneškom, najlepší deň menom a spustenia', () => {
    const dayLog = { '2026-08-30': 20, '2026-08-31': 25, '2026-09-01': 40, '2026-09-02': 10, '2026-09-03': 30, '2026-09-04': 5 };
    const launches = [
        { d: '2026-09-01', id: 'pracka', m: 700, sun: true },
        { d: '2026-09-04', id: 'susicka', m: 1200, sun: false },
        { d: '2026-08-20', id: 'pracka', m: 700, sun: true },
    ];
    const m = /** @type {NonNullable<ReturnType<typeof summaryModel>>} */ (summaryModel({ ...BASE, dayLog, launches }, 'tyzden'));
    const today = /** @type {number} */ (pv.dailyEnergyKwh);
    assert.equal(m.kick, 'Posledných 7 dní na streche');
    assert.equal(m.kwh, 20 + 25 + 40 + 10 + 30 + 5 + today);
    assert.equal(m.days.length, 7);
    assert.doesNotMatch(m.note, /appka čísla nemá/, 'v týždni nechýba žiadny deň');
    assert.equal(m.rows.find((r) => r.t.startsWith('Najlepší deň'))?.t, 'Najlepší deň: utorok', '1. 9. 2026 je utorok');
    const spustenia = m.rows.find((r) => r.t.startsWith('Na slnku'));
    assert.deepEqual(spustenia, { t: 'Na slnku si pustil/a 1×', s: 'z 2 spustení, zvyšok išiel zo siete' });
});

test('summaryModel: bez cien bez hodnoty, bez výroby bez prepočtov', () => {
    const m = summaryModel({ ...BASE, tariff: TARIFF }, 'mesiac');
    assert.ok(m && !m.rows.some((r) => r.t.startsWith('Hodnota')));
    const nula = summaryModel({ ...BASE, pv: { ...pv, dailyEnergyKwh: 0, monthEnergyKwh: 0 } }, 'mesiac');
    assert.deepEqual(
        nula?.rows.map((r) => r.t),
        ['Od spustenia panely splatili 12 % uhlíka'],
        'bez výroby obdobia ostáva len návratnosť od spustenia',
    );
});
