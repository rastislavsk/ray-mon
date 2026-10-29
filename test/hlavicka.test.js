import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRISTUP, SITE } from '../shared/config.js';
import { hlavickaModel } from '../shared/hlavicka.js';
import { odmietnute } from '../shared/pristup.js';
import { FIXED_NOW, fixtureData } from './helpers.js';

const { pv, forecast } = fixtureData();
const at = (/** @type {string} */ hm) => {
    const d = new Date(FIXED_NOW);
    const [h, m] = hm.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    return d;
};
const NB = { sposob: 'huawei-northbound', pecat: 'v1.AbCdEfGhIjKlMnOpQrStUvWxYz012345', nazov: 'Dvorany' };
const cerstve = { ...pv, updatedAt: at('13:10').toISOString() };
/** @type {import('../shared/hlavicka.js').HlavickaVstup} */
const base = {
    known: 'elektraren',
    loading: false,
    now: at('13:10'),
    pv: cerstve,
    forecast,
    site: SITE,
    zdroj: /** @type {any} */ (NB),
    pristup: null,
};
const model = (/** @type {Partial<typeof base>} */ s, /** @type {any} */ voice) => hlavickaModel({ ...base, ...s }, voice);

test('hlavička: miesto, čas merania a bodka - v oboch appkách to isté', () => {
    const m = model({});
    assert.equal(m.place, SITE.name);
    assert.equal(m.status, '13:00');
    assert.equal(m.tone, 'live');
    assert.equal(m.toneText, 'živé meranie');
    assert.equal(m.setup, false);
    assert.equal(m.tip?.nadpis, 'Živé meranie');
    assert.equal(m.tip?.znova, false);
    assert.equal(model({ site: { ...SITE, name: '' } }).place, '', 'bez lokality prázdne, RAY-MON stojí nad ním');
});

test('hlavička: zastarané a spiace meranie čas so slovom, bez merania len slovo', () => {
    const stare = model({ now: at('13:30'), pv: { ...cerstve, updatedAt: at('13:30').toISOString() } });
    assert.equal(stare.status, '13:00 · zastarané');
    assert.equal(stare.tone, 'stale');
    assert.equal(stare.toneText, 'meranie zastarané');
    assert.equal(model({ now: at('16:40') }).status, '13:00 · bez spojenia');
    const noc = model({ now: at('23:10'), pv: { ...cerstve, realTimePowerKw: null, updatedAt: at('23:10').toISOString() } });
    assert.equal(noc.status, '13:00 · menič spí');
    assert.equal(noc.tone, 'live');
    assert.equal(model({ pv: null }).status, 'meranie nedostupné');
    const odhad = model({ pv: null, zdroj: null });
    assert.equal(odhad.status, 'odhad z predpovede');
    assert.equal(odhad.tone, 'odhad');
    assert.equal(odhad.toneText, '');
    assert.equal(odhad.tip?.tlacidlo, 'Pripojiť meranie ›');
    assert.match(model({ pv: null, zdroj: null }, 'slusny').tip?.text ?? '', /pripojte ho v Nastavení/);
});

test('hlavička: prístup, ktorý výrobca prestal prijímať', () => {
    let o = odmietnute(null, /** @type {any} */ (NB), at('13:00'), 'prihlasenie:20400', false);
    for (let i = 1; i < PRISTUP.odmietnutia; i++) o = odmietnute(o, /** @type {any} */ (NB), at('13:00'), 'prihlasenie:20400', false);
    const m = model({ pv: null, pristup: o });
    assert.equal(m.status, 'meranie treba pripojiť znova');
    assert.equal(m.toneText, 'prístup k meraniu neplatí');
    assert.equal(m.tip?.znova, true);
});

test('hlavička: bez panelov výzva, pri načítaní a bez dát slovo bez bubliny', () => {
    for (const known of /** @type {const} */ (['nic', 'poloha'])) {
        const m = model({ known, loading: true });
        assert.equal(m.setup, true, known);
        assert.equal(m.tip, null);
    }
    const nacitavam = model({ loading: true });
    assert.deepEqual([nacitavam.status, nacitavam.tone, nacitavam.tip], ['načítavam…', 'off', null]);
    const bezDat = model({ pv: null, forecast: null });
    assert.deepEqual([bezDat.status, bezDat.tone, bezDat.tip], ['bez dát', 'off', null]);
});
