import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_DNA } from '../shared/config.js';
import { DOMA_DEVICES, domaDefault, domaToStored, domaZOznameni, parseDoma, prepniSpotrebic } from '../shared/doma.js';

const DEVICES = [...PLAN_DNA.devices];

test('parseDoma: predvolené spotrebiče plánu, neznáme a dvojité zahodí, poškodené nahradí', () => {
    assert.deepEqual(domaDefault(), DEVICES);
    assert.deepEqual(DOMA_DEVICES, ['pracka', 'umyvacka', 'susicka', 'auto', 'bojler']);
    assert.deepEqual(parseDoma(null), DEVICES);
    assert.deepEqual(parseDoma('{zle'), DEVICES);
    assert.deepEqual(parseDoma('"text"'), DEVICES);
    assert.deepEqual(parseDoma(JSON.stringify({ devices: 'pracka' })), DEVICES);
    assert.deepEqual(parseDoma(JSON.stringify({ devices: ['pracka', 'tv', 'pracka', 'bojler'] })), ['pracka', 'bojler']);
    // Nič doma je platná voľba, nie poškodená.
    assert.deepEqual(parseDoma(JSON.stringify({ devices: [] })), []);
    assert.deepEqual(parseDoma(JSON.stringify(domaToStored(['auto']))), ['auto']);
});

test('domaZOznameni: spotrebiče zo staršieho nastavenia oznámení, bez nich null', () => {
    assert.deepEqual(domaZOznameni(JSON.stringify({ on: true, hour: 7, devices: ['pracka', 'tv'] })), ['pracka']);
    assert.deepEqual(domaZOznameni(JSON.stringify({ on: true, hour: 7, devices: [] })), []);
    assert.equal(domaZOznameni(JSON.stringify({ on: true, hour: 7 })), null);
    assert.equal(domaZOznameni(null), null);
    assert.equal(domaZOznameni('{zle'), null);
    assert.equal(domaZOznameni('42'), null);
});

test('prepniSpotrebic pridá a uberie', () => {
    assert.deepEqual(prepniSpotrebic(DEVICES, 'bojler'), [...DEVICES, 'bojler']);
    assert.deepEqual(
        prepniSpotrebic(DEVICES, 'auto'),
        DEVICES.filter((d) => d !== 'auto'),
    );
});
