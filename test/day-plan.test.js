import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_DAYS, ALL_MONTHS, PLANT, SITE, TARIFF } from '../shared/config.js';
import { dayRingModel } from '../shared/chart-model.js';
import { dayPlan, planAt } from '../shared/day-plan.js';
import { FIXED_NOW, fixtureData } from './helpers.js';

const { pv, forecast } = fixtureData();
const input = { now: FIXED_NOW, tariff: TARIFF, site: SITE, plant: PLANT, pv, forecast };
const m = (/** @type {number} */ h, /** @type {number} */ min = 0) => h * 60 + min;
/** Jedna cena celý deň. @type {import('../shared/config.js').Tariff} */
const FLAT = {
    currency: '€',
    bands: [{ id: 'j', name: 'Cena', level: 'bezna', price: null }],
    schedules: [{ days: ALL_DAYS, months: ALL_MONTHS, changes: [{ from: '00:00', band: 'j' }] }],
};

test('planAt: v slnečnom poludní zelená, v noci farba ceny a noc', () => {
    const noon = planAt(input, m(13, 5));
    assert.equal(noon.startMin, m(13));
    assert.equal(noon.min, 15);
    assert.equal(noon.tier, 'green');
    assert.equal(noon.night, false);
    const night = planAt(input, m(2));
    assert.equal(night.level, 'lacna');
    assert.equal(night.tier, 'amber');
    assert.equal(night.night, true);
    const vt = planAt(input, m(21));
    assert.equal(vt.band.id, 'vt');
    assert.equal(vt.tier, 'red', 'VT večer bez slnka je červené');
});

test('planAt: bez dát ostáva len farba ceny, zelená nie je nikde', () => {
    const bare = { ...input, pv: null, forecast: null };
    assert.ok(Number.isNaN(planAt(bare, m(13)).kw));
    assert.equal(planAt(bare, m(13)).tier, 'amber');
    assert.ok(dayPlan(bare).every((s) => s.tier !== 'green'));
});

test('dayPlan: 96 štvrťhodín od polnoci, zelená len cez deň', () => {
    const plan = dayPlan(input);
    assert.equal(plan.length, 96);
    assert.equal(plan[0].startMin, 0);
    assert.equal(plan[95].startMin, m(23, 45));
    const green = plan.filter((s) => s.tier === 'green');
    assert.ok(green.length > 0);
    assert.ok(green.every((s) => !s.night && s.kw >= 2));
});

test('dayRingModel: susedné štvrťhodiny s rovnakou farbou sú jeden oblúk', () => {
    const ring = dayRingModel(dayPlan(input));
    assert.ok(ring.length > 1 && ring.length < 96);
    for (let i = 1; i < ring.length; i++) assert.notEqual(ring[i].cls, ring[i - 1].cls);
    // Jedna cena a bez dát: celý deň je sivý. Sú to dva polkruhy - jeden oblúk s totožnými
    // koncami by sa nevykreslil.
    const flat = dayRingModel(dayPlan({ ...input, tariff: FLAT, pv: null, forecast: null }));
    assert.equal(flat.length, 2);
    assert.ok(flat.every((a) => a.cls === 'grey' && a.large === 0));
    assert.ok(Math.abs(flat[0].start.x - flat[0].end.x) < 1e-9 && Math.abs(flat[0].start.y - flat[0].end.y) > 200);
});
