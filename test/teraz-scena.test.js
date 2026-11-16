// Scéna toku energie na karte Teraz (shared/teraz-scena.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scenaModel, TERAZ_SCENA_TEXTS } from '../shared/teraz-scena.js';

test('scéna: prebytok do siete - výroba, dom, sieť von, lúče a body podľa kW', () => {
    const m = scenaModel({ vyrobaKw: 6.4, odhad: false, sietKw: 4.6 });
    assert.equal(m.vyroba, '6,4');
    assert.equal(m.dom, '1,8');
    assert.deepEqual(m.siet, { smer: 'von', kw: '4,6' });
    assert.equal(m.luce, 7);
    assert.equal(m.jas, 1);
    assert.equal(m.body, 3);
    assert.equal(m.popis, 'Zo slnka 6,4 kW, dom berie 1,8 kW, do siete ide 4,6 kW');
});

test('scéna: slabé slnko, dom berie zo siete', () => {
    const m = scenaModel({ vyrobaKw: 1.2, odhad: false, sietKw: -1.8 });
    assert.equal(m.dom, '3,0');
    assert.deepEqual(m.siet, { smer: 'dnu', kw: '1,8' });
    assert.equal(m.luce, 1);
    assert.equal(m.body, 2);
    assert.equal(m.popis, 'Zo slnka 1,2 kW, dom berie 3,0 kW, zo siete ide 1,8 kW');
});

test('scéna: noc - bez výroby a bez lúčov, dom zo siete', () => {
    const m = scenaModel({ vyrobaKw: 0, odhad: false, sietKw: -0.6 });
    assert.equal(m.vyroba, null);
    assert.equal(m.luce, 0);
    assert.equal(m.jas, 0);
    assert.equal(m.dom, '0,6');
    assert.equal(m.body, 1);
    assert.ok(m.popis.startsWith(TERAZ_SCENA_TEXTS.nic));
});

test('scéna: bez elektromera len výroba, odhad s vlnovkou, vedenie stojí', () => {
    const m = scenaModel({ vyrobaKw: 4.1, odhad: true, sietKw: null });
    assert.equal(m.vyroba, '~4,1');
    assert.equal(m.dom, null);
    assert.equal(m.siet, null);
    assert.equal(m.body, 0);
    assert.equal(m.popis, 'Zo slnka ~4,1 kW (odhad)');
});

test('scéna: tok okolo nuly nie je tok, výkon, ktorý appka nepozná, je nula', () => {
    const m = scenaModel({ vyrobaKw: null, odhad: false, sietKw: 0.02 });
    assert.equal(m.vyroba, null);
    assert.equal(m.siet, null);
    assert.equal(m.body, 0);
    assert.equal(m.dom, '0,0');
    assert.equal(scenaModel({ vyrobaKw: NaN, odhad: false, sietKw: null }).luce, 0);
});
