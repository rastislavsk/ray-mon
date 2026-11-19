// Tlačidlo Späť (web/nav-history.js): čo spraví Späť podľa poradia položky histórie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPAT } from '../shared/config.js';
import { kamSpat } from '../web/nav-history.js';

test('kamSpat: štartová položka ukáže bublinu, ďalšie Späť appku zavrie', () => {
    assert.equal(kamSpat(0, 0), 'bublina');
    assert.equal(kamSpat(0, 20), 'bublina');
});

test('kamSpat: posledných SPAT.krokov krokov sa vráti, ďalšie Späť skočí na Teraz', () => {
    const vrch = 20;
    for (let n = 1; n <= SPAT.krokov; n++) assert.equal(kamSpat(vrch - n, vrch), 'krok');
    assert.equal(kamSpat(vrch - SPAT.krokov - 1, vrch), 'teraz');
    assert.equal(kamSpat(2, vrch), 'teraz');
});

test('kamSpat: Teraz (položka 1) je cieľ skoku, nikdy neskáče', () => {
    assert.equal(kamSpat(1, 20), 'krok');
    assert.equal(kamSpat(1, 2), 'krok');
});

test('kamSpat: pri menej krokoch Späť ide po nich až na Teraz', () => {
    assert.equal(kamSpat(3, 4), 'krok');
    assert.equal(kamSpat(2, 4), 'krok');
});
