import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POCASIE } from '../shared/config.js';
import { jasZMerania, pocasie } from '../shared/pocasie.js';
import { moonPhase } from '../shared/solar.js';

const NOW = new Date('2026-09-05T19:30:00Z');
/** @param {number | null} cloud @param {import('../shared/solar.js').Precip} [precip] */
const hodina = (cloud, precip) => ({ hour: 12, kw: 1, cloud, precip });

test('jasZMerania: podiel z jasnej oblohy delí na jasno, polooblačno a zamračené', () => {
    const m = (/** @type {number} */ kw) => jasZMerania({ kw, clearKw: 8, installedKw: 10 });
    assert.equal(m(8 * POCASIE.jasno), 'jasno');
    assert.equal(m(8 * POCASIE.jasno - 0.01), 'polojasno');
    assert.equal(m(8 * POCASIE.zamracene), 'polojasno');
    assert.equal(m(8 * POCASIE.zamracene - 0.01), 'zamracene');
});

test('jasZMerania: pri nízkom slnku a bez merania o oblakoch nič nehovorí', () => {
    assert.equal(jasZMerania({ kw: 0.1, clearKw: 1.4, installedKw: 10 }), null, 'jasná obloha by dala menej ako 15 %');
    assert.equal(jasZMerania({ kw: NaN, clearKw: 8, installedKw: 10 }), null);
    assert.equal(jasZMerania(null), null);
});

test('pocasie: jas a zrážky z hodiny predpovede, noc a fáza Mesiaca', () => {
    assert.deepEqual(pocasie({ point: hodina(80, 'dazd'), noc: false, now: NOW, merane: null }), {
        jas: 'zamracene',
        zrazky: 'dazd',
        noc: false,
        mesiac: moonPhase(NOW),
    });
    // Hodina bez poľa zrážok (staršia predpoveď) je bez zrážok.
    assert.equal(pocasie({ point: hodina(10), noc: true, now: NOW, merane: null })?.zrazky, null);
});

test('pocasie: meranie prebije jas predpovede, nie zrážky; v noci sa meraniu neverí', () => {
    const merane = { kw: 1, clearKw: 8, installedKw: 10 };
    const p = pocasie({ point: hodina(5, 'sneh'), noc: false, now: NOW, merane });
    assert.equal(p?.jas, 'zamracene', 'predpoveď hovorí jasno, menič dáva osminu');
    assert.equal(p?.zrazky, 'sneh');
    assert.equal(pocasie({ point: hodina(5), noc: true, now: NOW, merane })?.jas, 'jasno');
    // Neisté meranie (nízke slnko) nechá jas z predpovede.
    assert.equal(pocasie({ point: hodina(50), noc: false, now: NOW, merane: { ...merane, clearKw: 1 } })?.jas, 'polojasno');
});

test('pocasie: bez hodiny predpovede alebo bez oblačnosti nie je', () => {
    assert.equal(pocasie({ point: undefined, noc: false, now: NOW, merane: null }), null);
    assert.equal(pocasie({ point: hodina(null), noc: false, now: NOW, merane: null }), null);
});
