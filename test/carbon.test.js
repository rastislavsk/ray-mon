import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carbonPayback, co2SavedKg, panelDebtKg } from '../shared/carbon.js';
import { CARBON, installedKw, PLANT } from '../shared/config.js';
import { posterCarbonNote, posterCo2Value, posterPayback } from '../shared/messages.js';

test('co2SavedKg: sieť mínus panely, obe za celý životný cyklus', () => {
    assert.equal(co2SavedKg(1000), CARBON.gridG - CARBON.pvG);
    assert.equal(co2SavedKg(0), 0);
    assert.ok(CARBON.pvG < CARBON.gridG, 'inak by strecha uhlík pridávala');
});

test('panelDebtKg: solárny faktor × výroba za celý život, úmerne kWp', () => {
    const kwp = installedKw(PLANT);
    assert.equal(panelDebtKg(PLANT), (CARBON.pvG * CARBON.yieldKwhPerKwp * CARBON.lifeYears * kwp) / 1000);
    const half = { ...PLANT, strings: PLANT.strings.map((s) => ({ ...s, panels: s.panels / 2 })) };
    assert.equal(panelDebtKg(half), panelDebtKg(PLANT) / 2);
});

test('carbonPayback: celé kWh siete voči dlhu, bez súčtu alebo panelov null', () => {
    const debtKg = panelDebtKg(PLANT);
    assert.equal(carbonPayback((debtKg * 1000) / CARBON.gridG, PLANT), 1);
    assert.equal(carbonPayback(0, PLANT), 0);
    assert.equal(carbonPayback(null, PLANT), null);
    assert.equal(carbonPayback(5000, { ...PLANT, strings: [] }), null);
    // Za celý život panelov sa splatí viac, než stáli - rozdiel je čistá úspora.
    const lifeKwh = CARBON.yieldKwhPerKwp * CARBON.lifeYears * installedKw(PLANT);
    assert.ok(Math.abs(lifeKwh * (CARBON.gridG / 1000) - debtKg - co2SavedKg(lifeKwh)) < 1e-6);
});

test('texty uhlíka na plagáte', () => {
    assert.equal(posterCo2Value(8.06), '~8,1 kg');
    assert.equal(posterCo2Value(38.4), '~38 kg');
    assert.deepEqual(posterPayback(0.129), { pct: 12, paid: false });
    assert.deepEqual(posterPayback(0.999), { pct: 99, paid: false }, 'splatené až naozaj');
    assert.deepEqual(posterPayback(1.4), { pct: 100, paid: true });
    const c = { gridG: 95, pvG: 47, source: 'Ember 2025', lifeYears: 30 };
    assert.equal(
        posterCarbonNote({ ...c, debtT: null }),
        'CO2eq za celý životný cyklus podľa Ember 2025: kWh zo siete SR 95 g, zo slnka 47 g.',
    );
    assert.match(posterCarbonNote({ ...c, debtT: 16.9 }), /stála asi 16,9 t CO2eq, rozpočítaná na 30 rokov prevádzky\.$/);
});
