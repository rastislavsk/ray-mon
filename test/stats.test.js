import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SITE, TARIFF } from '../shared/config.js';
import { averagePrice, energyByBand, STATS_PERIODS, statsModel } from '../shared/stats.js';
import { FIXED_NOW, fixtureData } from './helpers.js';

const { pv, forecast } = fixtureData();
/** Tarifa Dvorian s cenami: NT lacné, VT drahé. */
const PRICED = { ...TARIFF, bands: TARIFF.bands.map((b) => ({ ...b, price: b.id === 'nt' ? 0.14 : 0.19 })) };
const OWNER = { now: FIXED_NOW, site: SITE, tariff: PRICED, kiosk: 'kiosk', loading: false, pv, forecast };

test('energyByBand: lichobežník po úsekoch, pásmo v strede úseku', () => {
    // 07:30 - 08:30 je VT, 12:00 - 13:00 NT.
    const byBand = energyByBand(
        [
            { hour: 7.5, kw: 1 },
            { hour: 8.5, kw: 1 },
            { hour: 12, kw: 2 },
            { hour: 13, kw: 4 },
        ],
        TARIFF,
        '2026-09-05',
    );
    // Úsek 07:30 - 08:30 je celý VT (1 kWh). Úsek 08:30 - 12:00 má stred o 10:15, teda tiež VT
    // (09:30 - 10:30), a pripočíta sa celý: (1 + 2) / 2 × 3,5 h. Úsek 12:00 - 13:00 je NT.
    assert.equal(byBand.get('vt'), 1 + ((1 + 2) / 2) * 3.5);
    assert.equal(byBand.get('nt'), (2 + 4) / 2);
});

test('energyByBand: úseky naspäť v čase a chýbajúce hodnoty sa preskočia', () => {
    const byBand = energyByBand(
        [
            { hour: 12, kw: 2 },
            { hour: 11, kw: 2 },
            { hour: 13, kw: NaN },
        ],
        TARIFF,
        '2026-09-05',
    );
    assert.equal(byBand.size, 0);
});

test('averagePrice: vážený priemer, bez výroby alebo bez všetkých cien null', () => {
    const byBand = new Map([
        ['nt', 3],
        ['vt', 1],
    ]);
    assert.equal(averagePrice(byBand, PRICED), (3 * 0.14 + 1 * 0.19) / 4);
    assert.equal(averagePrice(new Map(), PRICED), null);
    assert.equal(averagePrice(byBand, TARIFF), null, 'Dvorany bez cien');
    const partly = { ...PRICED, bands: [PRICED.bands[0], { ...PRICED.bands[1], price: null }] };
    assert.equal(averagePrice(byBand, partly), null, 'polovičné ceny nedajú polovičné eurá');
});

test('statsModel: dnešok z kiosku ocenený podľa pásiem nameranej krivky', () => {
    const m = statsModel(OWNER, 'dnes');
    assert.equal(m.status, 'live');
    assert.equal(m.priced, true);
    assert.equal(m.currency, '€');
    assert.equal(m.hero.kwh, pv.dailyEnergyKwh);
    const price = averagePrice(energyByBand(pv.realCurveToday, PRICED, '2026-09-05'), PRICED);
    assert.equal(m.hero.value, /** @type {number} */ (pv.dailyEnergyKwh) * /** @type {number} */ (price));
    // Ráno padlo do drahého VT, zvyšok do NT - cena je niekde medzi nimi.
    assert.ok(/** @type {number} */ (price) > 0.14 && /** @type {number} */ (price) < 0.19);
    assert.deepEqual(
        m.rows.map((r) => r.period),
        ['mesiac', 'rok', 'spolu'],
    );
    assert.deepEqual(m.progress, { realKwh: pv.dailyEnergyKwh, pct: Math.round((100 * 31.7) / forecast.days[0].kwhTotal) });
});

test('statsModel: mesiac, rok a celý čas zo súčtov kiosku, s priemerom na deň', () => {
    const mesiac = statsModel(OWNER, 'mesiac');
    assert.equal(mesiac.hero.label, 'September');
    assert.equal(mesiac.hero.heading, 'Vyrobené v septembri');
    assert.equal(mesiac.hero.kwh, pv.monthEnergyKwh);
    assert.equal(mesiac.hero.perDay, /** @type {number} */ (pv.monthEnergyKwh) / 5);
    assert.equal(mesiac.progress, null, 'pásik voči predpovedi patrí len k dnešku');

    const rok = statsModel(OWNER, 'rok');
    assert.equal(rok.hero.heading, 'Vyrobené v roku 2026');
    // 5. 9. 2026 je 248. deň roka.
    assert.equal(rok.hero.perDay, /** @type {number} */ (pv.yearEnergyKwh) / 248);

    const spolu = statsModel(OWNER, 'spolu');
    assert.equal(spolu.hero.kwh, pv.cumulativeEnergyKwh);
    assert.equal(spolu.hero.perDay, null);
    // Dlhé obdobia majú cenu z predpovede - tá istá pre mesiac, rok aj celý čas.
    const cena = (/** @type {typeof spolu} */ m) => /** @type {number} */ (m.hero.value) / /** @type {number} */ (m.hero.kwh);
    assert.ok(Math.abs(cena(mesiac) - cena(spolu)) < 1e-12);
    assert.ok(Math.abs(cena(rok) - cena(spolu)) < 1e-12);
});

test('statsModel: mesiac sa v nadpise skloňuje', () => {
    const at = (/** @type {string} */ iso) => statsModel({ ...OWNER, now: new Date(iso) }, 'mesiac').hero.heading;
    assert.equal(at('2026-01-15T10:00:00Z'), 'Vyrobené v januári');
    assert.equal(at('2026-03-15T10:00:00Z'), 'Vyrobené v marci');
    assert.equal(at('2026-08-15T10:00:00Z'), 'Vyrobené v auguste');
});

test('statsModel: bez cien sú len kWh', () => {
    const m = statsModel({ ...OWNER, tariff: TARIFF }, 'dnes');
    assert.equal(m.priced, false);
    assert.equal(m.hero.value, null);
    assert.ok(m.rows.every((r) => r.value === null));
    assert.equal(/** @type {NonNullable<typeof m.forecastToday>} */ (m.forecastToday).value, null);
});

test('statsModel: stav podľa merania a načítania', () => {
    assert.equal(statsModel({ ...OWNER, pv: null }, 'dnes').status, 'offline');
    assert.equal(statsModel({ ...OWNER, pv: null, loading: true }, 'dnes').status, 'loading');
    assert.equal(statsModel({ ...OWNER, pv: null, kiosk: '' }, 'dnes').status, 'none');
    const bez = statsModel({ ...OWNER, pv: null, kiosk: '' }, 'dnes');
    assert.equal(bez.hero.kwh, null);
    assert.equal(bez.progress, null);
});

test('statsModel: bez merania ostáva dnešok podľa predpovede, ocenený po hodinách', () => {
    const m = statsModel({ ...OWNER, pv: null, kiosk: '' }, 'dnes');
    const today = forecast.days[0];
    const price = averagePrice(energyByBand(today.hourly, PRICED, today.date), PRICED);
    assert.deepEqual(m.forecastToday, { kwh: today.kwhTotal, value: today.kwhTotal * /** @type {number} */ (price) });
    assert.equal(statsModel({ ...OWNER, forecast: null }, 'dnes').forecastToday, null);
});

test('statsModel: bez nameranej krivky sa dnešok ocení cenou z predpovede', () => {
    const m = statsModel({ ...OWNER, pv: { ...pv, realCurveToday: [] } }, 'dnes');
    const dlhe = statsModel(OWNER, 'spolu');
    const cena = (/** @type {typeof m} */ x) => /** @type {number} */ (x.hero.value) / /** @type {number} */ (x.hero.kwh);
    assert.ok(Math.abs(cena(m) - cena(dlhe)) < 1e-12);
});

test('STATS_PERIODS: poradie prepínača', () => {
    assert.deepEqual(STATS_PERIODS, ['dnes', 'mesiac', 'rok', 'spolu']);
});
