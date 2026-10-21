import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carbonFacts, carbonPayback, co2SavedKg, panelDebtKg, solarG } from '../shared/carbon.js';
import { CARBON, installedKw, PLANT } from '../shared/config.js';
import { posterCarbonNote, posterCo2Value, posterPayback } from '../shared/messages.js';

test('solarG: dlh kWp rozpočítaný na výrobu v SR za celý život, menej ako sieť', () => {
    assert.equal(solarG(), (CARBON.debtKgPerKwp * 1000) / (CARBON.yieldKwhPerKwp * CARBON.lifeYears));
    assert.equal(Math.round(solarG()), 30);
    assert.ok(solarG() < CARBON.gridG, 'inak by strecha uhlík pridávala');
});

test('co2SavedKg: sieť mínus slnko, obe za celý životný cyklus', () => {
    assert.equal(co2SavedKg(1000), CARBON.gridG - solarG());
    assert.equal(co2SavedKg(0), 0);
});

test('panelDebtKg: dlh kWp (panely, menič, montáž) úmerne výkonu', () => {
    assert.equal(panelDebtKg(PLANT), CARBON.debtKgPerKwp * installedKw(PLANT));
    const half = { ...PLANT, strings: PLANT.strings.map((s) => ({ ...s, panels: s.panels / 2 })) };
    assert.equal(panelDebtKg(half), panelDebtKg(PLANT) / 2);
});

test('carbonPayback: celé kWh siete voči dlhu, bez súčtu alebo panelov null', () => {
    const debtKg = panelDebtKg(PLANT);
    assert.ok(Math.abs(/** @type {number} */ (carbonPayback((debtKg * 1000) / CARBON.gridG, PLANT)) - 1) < 1e-9);
    assert.equal(carbonPayback(0, PLANT), 0);
    assert.equal(carbonPayback(null, PLANT), null);
    assert.equal(carbonPayback(5000, { ...PLANT, strings: [] }), null);
    // Za celý život panelov sa splatí viac, než stáli - rozdiel je čistá úspora.
    const lifeKwh = CARBON.yieldKwhPerKwp * CARBON.lifeYears * installedKw(PLANT);
    assert.ok(Math.abs(lifeKwh * (CARBON.gridG / 1000) - debtKg - co2SavedKg(lifeKwh)) < 1e-6);
});

test('carbonFacts: faktory so zdrojmi pre poznámku, bez súčtu bez dlhu', () => {
    const f = carbonFacts(168, 21500, PLANT);
    assert.deepEqual(f.carbon, { gridG: 95, gridSource: 'Ember 2025', pvG: 30, pvSource: 'IEA PVPS 2023', lifeYears: 30 });
    assert.equal(f.debtT, panelDebtKg(PLANT) / 1000);
    assert.deepEqual(carbonFacts(168, null, PLANT), { ...f, payback: null, debtT: null });
});

test('texty uhlíka na plagáte', () => {
    assert.equal(posterCo2Value(8.06), '~8,1 kg');
    assert.equal(posterCo2Value(38.4), '~38 kg');
    assert.deepEqual(posterPayback(0.129), { pct: 12, paid: false });
    assert.deepEqual(posterPayback(0.999), { pct: 99, paid: false }, 'splatené až naozaj');
    assert.deepEqual(posterPayback(1.4), { pct: 100, paid: true });
    const c = { gridG: 95, gridSource: 'Ember 2025', pvG: 30, pvSource: 'IEA PVPS 2023', lifeYears: 30 };
    assert.equal(
        posterCarbonNote({ ...c, debtT: null }),
        'CO2eq za celý životný cyklus: kWh zo siete SR 95 g (Ember 2025), zo slnka 30 g (IEA PVPS 2023, prepočítané na výrobu v SR).',
    );
    assert.match(
        posterCarbonNote({ ...c, debtT: 10.96 }),
        /Výroba týchto panelov aj s meničom stála asi 11,0 t CO2eq, rozpočítaná na 30 rokov prevádzky\.$/,
    );
});
