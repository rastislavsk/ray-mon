import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAYLOG, EVERYDAY, PLANT, SITE, TARIFF } from '../shared/config.js';
import { lastDays, monthDays, parseDayLog, recordDay, yearDays } from '../shared/daylog.js';
import { fmt1, fmtSum } from '../shared/format.js';
import { carbonFacts, carbonPayback, co2SavedKg } from '../shared/carbon.js';
import { plural, posterCo2Value, posterPayback, STATISTIKA_TEXTS, SUMMARY_TRIPS, suctyOdNote } from '../shared/messages.js';
import { bestOf, bigText, kwhText, restToday, summaryModel, yearMonths } from '../shared/summary.js';
import { FIXED_NOW, fixtureData } from './helpers.js';

const { pv, forecast } = fixtureData();
/** Tarifa Dvorian s cenami: NT lacné, VT drahé. */
const PRICED = { ...TARIFF, bands: TARIFF.bands.map((b) => ({ ...b, price: b.id === 'nt' ? 0.14 : 0.19 })) };
const BASE = {
    now: FIXED_NOW,
    site: SITE,
    plant: PLANT,
    tariff: PRICED,
    zdroj: { sposob: 'huawei-kiosk', pecat: 'v1.test-pecat-0123456789', nazov: '' },
    loading: false,
    pv,
    forecast,
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
    const year = yearDays(log, '2026-09-05');
    assert.equal(year.length, 248, '1. 1. až 5. 9. 2026');
    assert.equal(year[0].date, '2026-01-01');
    assert.equal(year.at(-1)?.date, '2026-09-05');
    assert.equal(yearDays({}, '2028-12-31').length, 366, 'priestupný rok');
});

test('yearMonths: súčet známych dní, neúplný, prázdny a budúci mesiac, najlepší', () => {
    const days = yearDays({ '2026-01-01': 2, '2026-02-10': 5, '2026-07-31': 9 }, '2026-09-05').map((d) =>
        // Celý júl v denníku, okrem neho len pár dní.
        d.date.startsWith('2026-07') ? { ...d, kwh: 10 } : d,
    );
    const m = yearMonths(days, '2026-09-05');
    assert.equal(m.length, 12);
    assert.deepEqual(m[0], { month: '2026-01', kwh: 2, partial: true, future: false, frac: 2 / 310, best: false });
    assert.equal(m[6].kwh, 310);
    assert.equal(m[6].partial, false, 'júl je celý');
    assert.equal(m[6].best, true);
    assert.deepEqual([m[2].kwh, m[2].frac, m[2].partial], [null, null, false], 'marec bez jediného dňa');
    assert.deepEqual([m[8].future, m[9].future], [false, true], 'september beží, október ešte len príde');
    assert.ok(yearMonths(yearDays({}, '2026-09-05'), '2026-09-05').every((x) => x.frac === null && !x.best));
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

test('bestOf: najvyšší deň, deň bez čísla sa nepočíta, pri rovnosti skorší, z jedného dňa nič', () => {
    assert.deepEqual(
        bestOf([
            { date: '2026-09-01', kwh: 20 },
            { date: '2026-09-02', kwh: null },
            { date: '2026-09-03', kwh: 35.5 },
            { date: '2026-09-04', kwh: 35.5 },
        ]),
        { date: '2026-09-03', kwh: 35.5 },
    );
    assert.equal(bestOf([{ date: '2026-09-01', kwh: 20 }]), null, 'len jeden deň - nie je s čím porovnať');
    assert.equal(
        bestOf([
            { date: '2026-09-01', kwh: 0 },
            { date: '2026-09-02', kwh: 0 },
        ]),
        null,
        'bez výroby',
    );
});

test('bigText a kwhText: do 100 kWh s desatinou, potom celé; bez súčtu pomlčka', () => {
    assert.equal(bigText(31.74), '31,7');
    assert.equal(bigText(168.2), '168');
    assert.equal(bigText(9112.4), fmtSum(9112, 0));
    assert.equal(bigText(null), '–');
    assert.equal(kwhText(null), '–');
    assert.equal(kwhText(9112.4), fmtSum(9112.4, 1));
});

test('posterCo2Value: kg s desatinou, kg celé, od tony tony', () => {
    assert.equal(posterCo2Value(8.06), '~8,1 kg');
    assert.equal(posterCo2Value(38.4), '~38 kg');
    assert.equal(posterCo2Value(1340), '~1,3 t');
});

test('summaryModel: bez merania dnešok z predpovede, bez predpovede nič', () => {
    const m = summaryModel({ ...BASE, zdroj: null, pv: null }, 'rok');
    const today = forecast.days[0];
    assert.equal(m.kind, 'estimate');
    assert.equal(m.status, 'none');
    assert.equal(m.period, 'dnes', 'ostatné obdobia posiela len menič');
    assert.equal(m.periods, false);
    assert.equal(m.heading, 'Dnes podľa predpovede');
    assert.equal(m.big, `~${fmt1(today.kwhTotal)}`);
    assert.equal(m.rows[0].t, `~${fmtSum(Math.round(today.kwhTotal / EVERYDAY.phoneChargeKwh), 0)} nabití mobilu`);
    assert.equal(m.rows[1].t, `~${fmtSum(Math.round(today.kwhTotal * EVERYDAY.evKmPerKwh), 0)} km autom`);
    assert.match(m.rows[2].t, /^Hodnota ~\d+,\d\d €$/);
    assert.equal(m.viz, null);
    assert.equal(m.note, '');
    assert.equal(summaryModel({ ...BASE, pv: null }, 'mesiac').status, 'offline', 'meranie zadané, ale neodpovedá');
    const nic = summaryModel({ ...BASE, zdroj: null, pv: null, forecast: { ...forecast, days: [] } }, 'dnes');
    assert.equal(nic.kind, 'none');
    assert.deepEqual(nic.rows, []);
});

test('summaryModel dnes: súčet z kiosku, pás voči predpovedi a koľko ešte do večera', () => {
    const m = summaryModel(BASE, 'dnes');
    const kwh = /** @type {number} */ (pv.dailyEnergyKwh);
    assert.equal(m.kind, 'live');
    assert.equal(m.periods, true);
    assert.equal(m.kick, 'Dnes na streche');
    assert.equal(m.big, fmt1(kwh));
    const pct = Math.round((100 * kwh) / forecast.days[0].kwhTotal);
    assert.deepEqual(m.viz, { kind: 'meter', pct, left: `z predpovede ${fmt1(forecast.days[0].kwhTotal)} kWh`, right: `${pct} %` });
    const rest = /** @type {NonNullable<ReturnType<typeof restToday>>} */ (restToday(BASE, '2026-09-05', kwh));
    assert.ok(rest.kwh > 1 && rest.kwh < forecast.days[0].kwhTotal, 'o 13:00 ostáva kus dňa');
    assert.deepEqual(
        m.rows.map((r) => r.t.replace(/(?<![A-Z])\d+(?:[\s,]\d+)*/g, '#')),
        ['# nabití mobilu', '# km autom', 'Do večera ešte ~# kWh', 'Hodnota ~# €', '~# kg CO2eq menej'],
    );
    assert.equal(m.rows[2].s, `podľa predpovede, spolu by bolo ~${fmt1(kwh + rest.kwh)} kWh`);
    assert.ok(m.note.startsWith(STATISTIKA_TEXTS.note), 'veta o hodnote');
    const vecer = { ...BASE, now: new Date('2026-09-05T19:00:00Z') };
    assert.equal(restToday(vecer, '2026-09-05', kwh), null, 'večer už nič');
});

test('summaryModel mesiac: súčet z kiosku, štvorčeky do konca mesiaca, prepočty, hodnota a chýbajúce dni', () => {
    const m = summaryModel(BASE, 'mesiac');
    const kwh = /** @type {number} */ (pv.monthEnergyKwh);
    assert.equal(m.kick, 'September na streche');
    assert.equal(m.kwh, kwh);
    assert.equal(m.big, '168');
    const days = m.viz?.kind === 'days' ? m.viz.days : [];
    assert.equal(days.length, 30, 'celý september');
    assert.equal(days.filter((d) => d.future).length, 25, '6. až 30. ešte len príde');
    assert.equal(days[4].frac, 1, 'dnešok z kiosku je jediný známy deň');
    assert.equal(m.rows[0].t, `${fmtSum(Math.round(kwh / EVERYDAY.phoneChargeKwh), 0)} nabití mobilu`);
    assert.equal(m.rows[1].t, `${fmtSum(Math.round(kwh * EVERYDAY.evKmPerKwh), 0)} km autom`);
    assert.ok(!m.rows.some((r) => r.t.startsWith('Najlepší deň')), 'z jedného dňa najlepší nie je');
    const value = m.rows.find((r) => r.t.startsWith('Hodnota ~'));
    assert.match(value?.s ?? '', /^toľko by sme za to dali sieti · v priemere \d+,\d\d € za deň$/);
    assert.ok(m.note.startsWith('Za 4 dni appka čísla nemá – vtedy ju nikto neotvoril. Hodnota je to, čo by si'), m.note);
    assert.match(m.note, /CO2eq za celý životný cyklus: kWh zo siete SR 95 g \(Ember 2025\)/);
    // Uhlík v jednom riadku: úspora za mesiac a pod ňou splatený podiel dlhu panelov.
    const f = carbonFacts(kwh, pv.cumulativeEnergyKwh, PLANT);
    const co2 = `${posterCo2Value(f.co2Kg)} CO2eq menej`;
    assert.deepEqual(m.rows.at(-1), {
        t: co2,
        s: `od spustenia panely splatili ${posterPayback(/** @type {number} */ (f.payback)).pct} % uhlíka zo svojej výroby`,
    });
    const splatene = summaryModel({ ...BASE, pv: { ...pv, cumulativeEnergyKwh: 1e6 } }, 'mesiac');
    assert.deepEqual(splatene.rows.at(-1), { t: co2, s: 'uhlík z výroby panelov už je splatený' });
    const bezSuctu = summaryModel({ ...BASE, pv: { ...pv, cumulativeEnergyKwh: null } }, 'mesiac');
    assert.deepEqual(bezSuctu.rows.at(-1), { t: co2, s: 'než zo siete SR, aj s uhlíkom z výroby panelov' }, 'bez súčtu len úspora');
    assert.doesNotMatch(bezSuctu.note, /Výroba týchto panelov/);
    const sDennikom = summaryModel({ ...BASE, dayLog: { '2026-09-01': 20, '2026-09-03': 35.5 } }, 'mesiac');
    assert.deepEqual(sDennikom.rows[2], { t: 'Najlepší deň: 3. 9.', s: `${fmt1(35.5)} kWh za jediný deň` });
});

test('summaryModel rok: súčet z kiosku, mesiace z denníka, najlepší deň roka a trasa okolo Zeme', () => {
    const dayLog = { '2026-06-14': 63.2, '2026-07-02': 50, '2025-12-31': 99 };
    const m = summaryModel({ ...BASE, dayLog }, 'rok');
    assert.equal(m.kick, 'Rok 2026 na streche');
    assert.equal(m.kwh, pv.yearEnergyKwh);
    const months = m.viz?.kind === 'months' ? m.viz.months : [];
    assert.equal(months.length, 12);
    assert.equal(months.find((x) => x.best)?.month, '2026-06', 'jún má najviac zo známych dní');
    assert.equal(m.rows.find((r) => r.t.startsWith('Najlepší deň'))?.t, 'Najlepší deň: 14. 6.', 'minulý rok sa nepočíta');
    assert.equal(m.rows.find((r) => r.t.endsWith('km autom'))?.s, 'raz okolo Zeme');
    assert.match(m.note, /^Za 245 dní appka čísla nemá/);
    const bezRoka = summaryModel({ ...BASE, dayLog, pv: { ...pv, yearEnergyKwh: null } }, 'rok');
    assert.equal(bezRoka.kwh, 63.2 + 50 + /** @type {number} */ (pv.dailyEnergyKwh), 'bez súčtu z kiosku súčet denníka');
    assert.ok(
        bezRoka.rows.some((r) => r.t.startsWith('Hodnota ~')),
        'aj súčet denníka má hodnotu',
    );
});

test('summaryModel spolu: súčet od spustenia, pás splateného uhlíka, dlh panelov a viackrát okolo Zeme', () => {
    const m = summaryModel(BASE, 'spolu');
    const kwh = /** @type {number} */ (pv.cumulativeEnergyKwh);
    assert.equal(m.kick, 'Od spustenia na streche');
    assert.equal(m.kwh, kwh);
    const payback = posterPayback(/** @type {number} */ (carbonPayback(kwh, PLANT)));
    assert.deepEqual(m.viz, { kind: 'meter', pct: payback.pct, left: 'uhlík z výroby panelov', right: `${payback.pct} % splatené` });
    assert.equal(m.rows[1].s, 'trikrát okolo Zeme');
    assert.ok(!m.rows.some((r) => r.t.startsWith('Najlepší deň')));
    assert.deepEqual(m.rows.at(-1), {
        t: `${posterCo2Value(co2SavedKg(kwh))} CO2eq menej`,
        s: 'výroba panelov aj meniča stála ~11,0 t CO2eq',
    });
    const splatene = summaryModel({ ...BASE, pv: { ...pv, cumulativeEnergyKwh: 1e6 } }, 'spolu');
    assert.equal(splatene.viz?.kind === 'meter' && splatene.viz.right, 'splatený');
    assert.equal(splatene.rows[1].s, `${Math.floor((1e6 * EVERYDAY.evKmPerKwh) / 40000)}-krát okolo Zeme`);
    const bez = summaryModel({ ...BASE, pv: { ...pv, cumulativeEnergyKwh: null } }, 'spolu');
    assert.equal(bez.big, '–');
    assert.deepEqual(bez.rows, []);
});

test('summaryModel: súčet od prvého merania má „od“ v nadpise a vetu v poznámke', () => {
    const fox = {
        ...BASE,
        zdroj: { sposob: 'foxess-kluc', pecat: 'v1.test-pecat-0123456789', nazov: '' },
        pv: { ...pv, od: { rok: '2026-09-05' } },
    };
    const rok = summaryModel(fox, 'rok');
    assert.equal(rok.heading, 'Rok 2026 na streche od 5. 9.');
    assert.equal(rok.kick, 'Rok 2026 na streche', 'odkaz z Môžem? ostáva bez „od“');
    assert.ok(rok.note.startsWith(suctyOdNote('Fox ESS', { rok: '2026-09-05' })), rok.note);
    assert.doesNotMatch(rok.note, /appka čísla nemá/, 'dni pred prvým meraním nechýbajú');
    assert.equal(summaryModel(fox, 'mesiac').heading, 'September na streche', 'mesiac výrobca posiela');
});

test('summaryModel: bez cien bez hodnoty, bez výroby bez prepočtov', () => {
    const m = summaryModel({ ...BASE, tariff: TARIFF }, 'mesiac');
    assert.equal(m.priced, false);
    assert.ok(!m.rows.some((r) => r.t.startsWith('Hodnota')));
    assert.doesNotMatch(m.note, /Hodnota je/);
    const nula = summaryModel({ ...BASE, pv: { ...pv, dailyEnergyKwh: 0, monthEnergyKwh: 0 } }, 'mesiac');
    assert.deepEqual(
        nula.rows.map((r) => r.t),
        ['Od spustenia panely splatili 18 % uhlíka'],
        'bez výroby obdobia ostáva len návratnosť od spustenia',
    );
});
