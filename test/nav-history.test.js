// Tlačidlo Späť (web/nav-history.js): čo spraví Späť podľa položky histórie a toho, kde človek stojí.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kamSpat } from '../web/nav-history.js';

const kde = (/** @type {Partial<{ doma: boolean, inaKarta: boolean }>} */ o = {}) => ({ doma: false, inaKarta: false, ...o });

test('kamSpat: štartová položka ukáže bublinu, ďalšie Späť appku zavrie', () => {
    assert.equal(kamSpat(0, 1, kde()), 'bublina');
    assert.equal(kamSpat(0, 1, kde({ doma: true, inaKarta: true })), 'bublina');
});

test('kamSpat: na tej istej karte Späť zatvára krok po kroku', () => {
    assert.equal(kamSpat(7, 8, kde()), 'krok');
    assert.equal(kamSpat(2, 3, kde()), 'krok');
});

test('kamSpat: položka inej karty skočí na Teraz, nech bolo krokov koľkokoľvek', () => {
    assert.equal(kamSpat(7, 8, kde({ inaKarta: true })), 'teraz');
    assert.equal(kamSpat(2, 3, kde({ inaKarta: true })), 'teraz');
});

test('kamSpat: Teraz (položka 1) je cieľ skoku, nikdy neskáče na Teraz', () => {
    assert.equal(kamSpat(1, 2, kde({ inaKarta: true })), 'krok');
    assert.equal(kamSpat(1, 2, kde()), 'krok');
});

test('kamSpat: z holej karty Teraz ide Späť na štartovú položku (bublina)', () => {
    assert.equal(kamSpat(5, 6, kde({ doma: true, inaKarta: true })), 'start');
    assert.equal(kamSpat(1, 2, kde({ doma: true })), 'start');
});

test('kamSpat: Dopredu je vždy len návrat na krok', () => {
    assert.equal(kamSpat(3, 2, kde({ doma: true, inaKarta: true })), 'krok');
    assert.equal(kamSpat(2, 1, kde({ doma: true, inaKarta: true })), 'krok');
});
