import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../web/store.js';

test('createStore: zmena zavolá odberateľov raz, rovnaké hodnoty nič', () => {
    const store = createStore({ a: 1, b: 'x' });
    /** @type {Array<[number, number]>} */ const volania = [];
    store.subscribe((s, prev) => volania.push([s.a, prev.a]));
    store.setState({ a: 1 });
    assert.equal(volania.length, 0);
    store.setState({ a: 2, b: 'x' });
    assert.deepEqual(volania, [[2, 1]]);
    assert.deepEqual(store.get(), { a: 2, b: 'x' });
});

test('createStore: odhlásenie zavolané dvakrát nezmaže iného odberateľa', () => {
    const store = createStore({ a: 0 });
    /** @type {string[]} */ const kto = [];
    const odhlas = store.subscribe(() => kto.push('prvy'));
    store.subscribe(() => kto.push('druhy'));
    odhlas();
    odhlas();
    store.setState({ a: 1 });
    assert.deepEqual(kto, ['druhy']);
});
