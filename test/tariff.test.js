import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_PLANT, PLANT, powerThresholds } from '../shared/config.js';
import {
    autoTier,
    deviceStates,
    isInWindow,
    productionLevel,
    seasonFor,
    smartTier,
    stripSegments,
    windowAt,
    windowsFor,
} from '../shared/tariff.js';

const m = (/** @type {number} */ h, /** @type {number} */ min = 0) => h * 60 + min;
const th = powerThresholds(PLANT);

test('seasonFor: marec až október leto, inak zima', () => {
    assert.equal(seasonFor(new Date(2026, 2, 1)), 'summer');
    assert.equal(seasonFor(new Date(2026, 9, 31)), 'summer');
    assert.equal(seasonFor(new Date(2026, 10, 1)), 'winter');
    assert.equal(seasonFor(new Date(2026, 1, 15)), 'winter');
});

test('isInWindow zvláda okno cez polnoc', () => {
    assert.ok(isInWindow(m(2), '23:30', '07:30'));
    assert.ok(isInWindow(m(23, 45), '23:30', '07:30'));
    assert.ok(!isInWindow(m(7, 30), '23:30', '07:30'));
    assert.ok(isInWindow(m(10, 30), '10:30', '17:30'));
    assert.ok(!isInWindow(m(17, 30), '10:30', '17:30'));
});

test('windowAt: leto 12:00 green, 19:00 amber, 08:00 red, 02:00 nočné amber; zima 15:00 amber', () => {
    assert.equal(windowAt(m(12), 'summer')?.status, 'green');
    assert.equal(windowAt(m(19), 'summer')?.status, 'amber');
    assert.equal(windowAt(m(8), 'summer')?.status, 'red');
    assert.equal(windowAt(m(2), 'summer')?.night, true);
    assert.equal(windowAt(m(15), 'winter')?.status, 'amber');
    assert.equal(windowAt(m(15), 'summer')?.status, 'green');
});

test('okná pokrývajú celý deň bez dier a prekryvov v oboch sezónach', () => {
    for (const season of /** @type {const} */ (['summer', 'winter'])) {
        for (let minute = 0; minute < 1440; minute++) {
            const hits = windowsFor(season).filter((w) => isInWindow(minute, w.start, w.end));
            assert.equal(hits.length, 1, `${season} ${minute}: ${hits.length} okien`);
        }
    }
});

test('stripSegments: súčet 1440 minút a rovnaký vzor ako pôvodná appka', () => {
    const summer = stripSegments('summer');
    assert.equal(
        summer.reduce((s, x) => s + x.min, 0),
        1440,
    );
    assert.deepEqual(
        summer.map((s) => `${s.min}${s.cls[0]}`),
        ['450a', '60r', '60a', '60r', '420g', '180a', '60r', '60a', '60r', '30a'],
    );
    assert.deepEqual(
        stripSegments('winter').map((s) => `${s.min}${s.cls[0]}`),
        ['450a', '60r', '60a', '60r', '240g', '360a', '60r', '60a', '60r', '30a'],
    );
});

test('powerThresholds: Dvorany majú 2 / 4 / 1,5 kW, iná elektráreň v pomere najvyššieho výkonu', () => {
    assert.deepEqual(th, { lowKw: 2, highKw: 4, marginKw: 1.5 });
    // Ukážka: 12 × 435 Wp = 5,2 kWp, menič 5 kW -> polovica Dvorian (10 kW).
    assert.deepEqual(powerThresholds(DEMO_PLANT), { lowKw: 1, highKw: 2, marginKw: 0.75 });
    // Menič menší než panely: rozhoduje menič, inak by vysoká výroba nebola nikdy.
    const smallInverter = powerThresholds({ ...PLANT, acLimitKw: 3 });
    assert.ok(smallInverter.highKw < 3);
    // Menič väčší než panely: rozhodujú panely (24 × 250 Wp = 6 kWp).
    assert.equal(powerThresholds({ ...PLANT, panelWp: 250, acLimitKw: 20 }).highKw, 2.4);
});

test('productionLevel a smartTier používajú hranice elektrárne', () => {
    assert.equal(productionLevel(NaN, th), null);
    assert.equal(productionLevel(th.lowKw - 0.01, th), 'niz');
    assert.equal(productionLevel(th.lowKw, th), 'str');
    assert.equal(productionLevel(th.highKw, th), 'vys');
    assert.equal(smartTier('red', NaN, th), 'red');
    assert.equal(smartTier('red', NaN, th, null), null);
    assert.equal(smartTier('red', th.lowKw, th), 'green');
    assert.equal(smartTier('red', 0.5, th), 'red');
    assert.equal(smartTier('amber', 0.5, th), 'amber');
    assert.equal(smartTier('green', 0.5, th), 'amber');
    // Pri menšej elektrárni je rovnaký výkon „viac“.
    assert.equal(productionLevel(2.5, powerThresholds(DEMO_PLANT)), 'vys');
});

test('autoTier: noc amber, slabé slnko red, silné slnko + lacná sieť green', () => {
    assert.equal(autoTier(m(1), 'amber', 0, th), 'amber');
    assert.equal(autoTier(m(12), 'green', 1, th), 'red');
    assert.equal(autoTier(m(12), 'green', th.highKw, th), 'green');
    assert.equal(autoTier(m(8), 'red', th.highKw, th), 'amber');
});

test('deviceStates: v zelenom okne go, mimo wait, v zime sušička a umývačka no', () => {
    const summerNoon = deviceStates(m(12), 'summer');
    assert.ok(summerNoon.every((d) => d.state === 'go'));
    assert.ok(deviceStates(m(20), 'summer').every((d) => d.state === 'wait'));
    const winter = Object.fromEntries(deviceStates(m(12), 'winter').map((d) => [d.name, d.state]));
    assert.deepEqual(winter, { Práčka: 'go', Sušička: 'no', Umývačka: 'no', Auto: 'go', Bojler: 'go' });
    assert.equal(summerNoon.find((d) => d.name === 'Auto')?.powerKw, 11);
});
