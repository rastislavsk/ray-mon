import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doplnSucty, parseSucty, suctyZdroj } from '../shared/sucty.js';

/** Meranie Fox ESS: dnes, mesiac a celkovo, rok nie. @param {Partial<import('../shared/kiosk.js').PvData>} [o] */
const pv = (o = {}) => ({
    realTimePowerKw: 3.1,
    dailyEnergyKwh: 21.4,
    monthEnergyKwh: 512.6,
    yearEnergyKwh: null,
    cumulativeEnergyKwh: 9384.2,
    stationName: null,
    realCurveToday: [],
    updatedAt: '2026-10-22T11:00:00Z',
    ...o,
});
const FOX = suctyZdroj({ sposob: 'foxess-kluc', pecat: 'x', nazov: 'Dvorany' });

test('rok bez súčtu od výrobcu: od začiatku dňa prvého merania, ďalej z prírastku celkovej výroby', () => {
    const prve = doplnSucty(null, FOX, pv(), '2026-10-22', '13:00');
    assert.equal(prve.pv.yearEnergyKwh, 21.4, 'celkovo mínus dnes = začiatok dneška');
    assert.equal(prve.pv.monthEnergyKwh, 512.6, 'mesiac od výrobcu ostáva');
    assert.deepEqual(prve.pv.od, { rok: '2026-10-22' });
    const druhe = doplnSucty(prve.sucty, FOX, pv({ dailyEnergyKwh: 30, cumulativeEnergyKwh: 9392.8 }), '2026-10-22', '15:00');
    assert.equal(druhe.pv.yearEnergyKwh, 30);
    const zajtra = doplnSucty(druhe.sucty, FOX, pv({ dailyEnergyKwh: 5, cumulativeEnergyKwh: 9405 }), '2026-10-23', '10:00');
    assert.equal(zajtra.pv.yearEnergyKwh, 42.2);
    assert.deepEqual(zajtra.pv.od, { rok: '2026-10-22' });
});

test('to isté meranie dvakrát (druhá appka) dá ten istý výsledok', () => {
    const a = doplnSucty(null, FOX, pv(), '2026-10-22', '13:00');
    const b = doplnSucty(a.sucty, FOX, pv(), '2026-10-22', '13:00');
    assert.deepEqual(b, a);
});

test('nový rok: posledné meranie v poslednom dni starého je jeho začiatok, „od“ zmizne', () => {
    const dec = doplnSucty(null, FOX, pv({ dailyEnergyKwh: 2, cumulativeEnergyKwh: 10000 }), '2026-12-31', '15:00');
    const jan = doplnSucty(
        dec.sucty,
        FOX,
        pv({ dailyEnergyKwh: 3, monthEnergyKwh: 3, cumulativeEnergyKwh: 10003.5 }),
        '2027-01-01',
        '12:00',
    );
    assert.equal(jan.pv.yearEnergyKwh, 3.5);
    assert.equal(jan.pv.od, undefined);
    // Appka potom do 5. 1. neotvorená: začiatok roka je stále posledné meranie z 31. 12.
    const neskor = doplnSucty(dec.sucty, FOX, pv({ dailyEnergyKwh: 3, cumulativeEnergyKwh: 10020 }), '2027-01-05', '12:00');
    assert.equal(neskor.pv.yearEnergyKwh, 20);
    assert.equal(neskor.pv.od, undefined);
    // Bez merania v poslednom dni roka: od prvého dňa, keď appka merala.
    const skor = doplnSucty(null, FOX, pv({ dailyEnergyKwh: 2, cumulativeEnergyKwh: 10000 }), '2026-12-20', '15:00');
    const po = doplnSucty(skor.sucty, FOX, pv({ dailyEnergyKwh: 3, cumulativeEnergyKwh: 10020 }), '2027-01-05', '12:00');
    assert.equal(po.pv.yearEnergyKwh, 3);
    assert.deepEqual(po.pv.od, { rok: '2027-01-05' });
    // Prvé meranie v prvý deň roka siaha na jeho začiatok.
    const prvy = doplnSucty(null, FOX, pv({ dailyEnergyKwh: 3, cumulativeEnergyKwh: 10020 }), '2027-01-01', '12:00');
    assert.equal(prvy.pv.od, undefined);
});

test('súčet od výrobcu má prednosť a posunie kotvu (Huawei rok raz za pár hodín)', () => {
    const s = doplnSucty(null, FOX, pv({ yearEnergyKwh: 4100 }), '2026-10-22', '13:00');
    assert.equal(s.pv.yearEnergyKwh, 4100);
    assert.equal(s.pv.od, undefined);
    const potom = doplnSucty(s.sucty, FOX, pv({ cumulativeEnergyKwh: 9390.2 }), '2026-10-22', '14:00');
    assert.equal(potom.pv.yearEnergyKwh, 4106);
    assert.equal(potom.pv.od, undefined);
});

test('SolaX a Victron: mesiac aj rok z celkovej výroby; Victron aj dnešok', () => {
    const solax = doplnSucty(null, 'solax-token|', pv({ monthEnergyKwh: null }), '2026-10-22', '13:00');
    assert.equal(solax.pv.monthEnergyKwh, 21.4);
    assert.deepEqual(solax.pv.od, { rok: '2026-10-22', mesiac: '2026-10-22' });
    const V = 'victron-token|Chata';
    const bezDna = pv({ dailyEnergyKwh: null, monthEnergyKwh: null });
    const v1 = doplnSucty(null, V, bezDna, '2026-10-22', '09:12');
    assert.equal(v1.pv.dailyEnergyKwh, 0);
    assert.deepEqual(v1.pv.od, { rok: '2026-10-22', mesiac: '2026-10-22', den: '09:12' });
    const v2 = doplnSucty(v1.sucty, V, { ...bezDna, cumulativeEnergyKwh: 9390 }, '2026-10-22', '13:00');
    assert.equal(v2.pv.dailyEnergyKwh, 5.8);
    assert.equal(v2.pv.yearEnergyKwh, 5.8);
    // Večer po 21:00 je začiatok zajtrajška; poobede ešte nie.
    const vecer = doplnSucty(v2.sucty, V, { ...bezDna, cumulativeEnergyKwh: 9391 }, '2026-10-22', '21:30');
    const rano = doplnSucty(vecer.sucty, V, { ...bezDna, cumulativeEnergyKwh: 9393 }, '2026-10-23', '10:00');
    assert.equal(rano.pv.dailyEnergyKwh, 2);
    assert.equal(rano.pv.od?.den, undefined);
    const poobede = doplnSucty(v2.sucty, V, { ...bezDna, cumulativeEnergyKwh: 9393 }, '2026-10-23', '10:00');
    assert.equal(poobede.pv.od?.den, '10:00');
});

test('bez celkovej výroby (Deye) nič; iné meranie alebo pokles celkovej výroby začne odznova', () => {
    const deye = pv({ cumulativeEnergyKwh: null, monthEnergyKwh: null });
    assert.deepEqual(doplnSucty(null, 'deye-aplikacia|', deye, '2026-10-22', '13:00'), { pv: deye, sucty: null });
    const fox = doplnSucty(null, FOX, pv(), '2026-10-22', '13:00');
    const ine = doplnSucty(fox.sucty, 'solax-token|', pv({ cumulativeEnergyKwh: 50, dailyEnergyKwh: 4 }), '2026-10-23', '13:00');
    assert.equal(ine.pv.yearEnergyKwh, 4);
    assert.deepEqual(ine.pv.od, { rok: '2026-10-23' });
    const pokles = doplnSucty(fox.sucty, FOX, pv({ cumulativeEnergyKwh: 100, dailyEnergyKwh: 4 }), '2026-10-23', '13:00');
    assert.equal(pokles.pv.yearEnergyKwh, 4);
});

test('parseSucty: platné kotvy prejdú, čokoľvek iné je null', () => {
    const { sucty } = doplnSucty(null, FOX, pv(), '2026-10-22', '13:00');
    assert.deepEqual(parseSucty(JSON.parse(JSON.stringify(sucty))), sucty);
    assert.equal(parseSucty(null), null);
    assert.equal(parseSucty({ ...sucty, rok: { kluc: '2026' } }), null);
    assert.equal(parseSucty({ ...sucty, posledne: { den: '2026-10-22', cas: '13:00', cum: 'x' } }), null);
    assert.equal(parseSucty({ zdroj: FOX }), null);
});
