// Bojler na prebytky: rozhodovanie s hysterézou a záznam dňa (shared/bojler.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bojlerStav, PAMAT_ZACIATOK, prahyZ, prebytokBezBojlera, rozhodni, suctyDna, zaznamenaj, zmenaOhrevu } from '../shared/bojler.js';
import { BOJLER } from '../shared/config.js';

const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 10, 15, 9, 0); // 10:00 SEČ
const PRAHY = { zapKw: 2.3, vypKw: 2.0 };

/**
 * Pustí rozhodovanie cez merania po 5 minútach (zásuvka sa pýta každú minútu) a vráti, kedy bolo
 * relé zapnuté. Relé poslúchne rozhodnutie hneď, príkon zapnutého bojlera je 2200 W.
 * @param {number[]} exportKw dodávka do siete bez bojlera v jednotlivých meraniach
 */
function simuluj(exportKw) {
    let pamat = PAMAT_ZACIATOK;
    let rele = false;
    /** @type {boolean[]} */ const stav = [];
    exportKw.forEach((bez, i) => {
        for (let m = 0; m < 5; m++) {
            const now = T0 + (i * 5 + m) * MIN;
            const w = rele ? 2200 : 0;
            const r = rozhodni(pamat, { rele, w, sietKw: bez - w / 1000, meranieAt: T0 + i * 5 * MIN, now, prahy: PRAHY });
            pamat = r.pamat;
            rele = r.zapni;
        }
        stav.push(rele);
    });
    return stav;
}

test('prebytok bez bojlera: dodávka do siete a k nej príkon zapnutého bojlera', () => {
    assert.equal(prebytokBezBojlera(0.1, true, 2200), 2.3);
    assert.equal(prebytokBezBojlera(-1.4, false, 2200), -1.4, 'vypnuté relé nič neberie');
    assert.equal(prebytokBezBojlera(1, true, -5), 1);
});

test('prahy zo skriptu: v rozsahu a s medzerou, inak predvolené', () => {
    const pred = { zapKw: BOJLER.zapKw, vypKw: BOJLER.vypKw };
    assert.deepEqual(prahyZ({ zapKw: 2.5, vypKw: 2.3 }), { zapKw: 2.5, vypKw: 2.3 });
    assert.deepEqual(prahyZ({ zapKw: 2.3, vypKw: 2.2 }), pred, 'medzera menšia než 0,2');
    assert.deepEqual(prahyZ({ zapKw: 9, vypKw: 2 }), pred);
    assert.deepEqual(prahyZ(null), pred);
    assert.deepEqual(prahyZ({ zapKw: '2', vypKw: 1 }), pred);
});

test('zapne po dvoch meraniach nad 2,3 kW, vypne po dvoch pod 2,0 kW (bez bojlera)', () => {
    // 2,4 kW dvakrát: zapne v druhom meraní. Potom 2,1 kW drží, 1,9 vypne v druhom meraní pod prahom.
    assert.deepEqual(simuluj([1, 2.4, 2.4, 2.1, 2.1, 1.9, 1.9, 1.9]), [false, false, true, true, true, true, false, false]);
    // Jedno meranie nad prahom nestačí.
    assert.deepEqual(simuluj([2.5, 1, 2.5, 1]), [false, false, false, false]);
});

test('beží aspoň 15 minút a po vypnutí čaká aspoň 10 minút', () => {
    // Hneď po zapnutí prebytok spadne: dve merania pod prahom (10 min) nestačia, vypne až po 15 min.
    const r = simuluj([2.5, 2.5, 0, 0, 0]);
    assert.deepEqual(r, [false, true, true, true, false]);
    // Pauza: vypnuté o 10:25 (koniec 5. merania), ďalšie zapnutie najskôr o 10:35.
    let pamat = { ...PAMAT_ZACIATOK, rele: false, zmenaAt: T0, nad: 1, meranieAt: T0 };
    const zap = (/** @type {number} */ now, /** @type {number} */ meranieAt) =>
        rozhodni(pamat, { rele: false, w: 0, sietKw: 3, meranieAt, now, prahy: PRAHY });
    const skoro = zap(T0 + 5 * MIN, T0 + 5 * MIN);
    assert.equal(skoro.zapni, false, 'dve merania, ale len 5 min od vypnutia');
    pamat = skoro.pamat;
    assert.equal(zap(T0 + 10 * MIN, T0 + 5 * MIN).zapni, true, 'to isté meranie, už 10 min');
});

test('bez elektromera, so starým meraním či po ručnom prepnutí', () => {
    const v = { rele: true, w: 2200, sietKw: 1, meranieAt: T0, now: T0, prahy: PRAHY };
    assert.equal(rozhodni(PAMAT_ZACIATOK, { ...v, sietKw: null }).zapni, false);
    const stare = rozhodni(PAMAT_ZACIATOK, { ...v, now: T0 + 16 * MIN });
    assert.deepEqual([stare.zapni, stare.prebytokKw], [false, null]);
    // Ručne zapnuté relé: čas zmeny je teraz, takže beží aspoň 15 minút aj pri slabom prebytku.
    let pamat = PAMAT_ZACIATOK;
    for (let i = 0; i < 3; i++) {
        const r = rozhodni(pamat, { ...v, sietKw: -2, meranieAt: T0 + i * 5 * MIN, now: T0 + i * 5 * MIN });
        pamat = r.pamat;
        assert.equal(r.zapni, true, `meranie ${i}`);
    }
    assert.equal(rozhodni(pamat, { ...v, sietKw: -2, meranieAt: T0 + 15 * MIN, now: T0 + 15 * MIN }).zapni, false);
    // To isté meranie znova nezvýši počítadlo.
    const a = rozhodni(PAMAT_ZACIATOK, { ...v, rele: false, w: 0, sietKw: 3 });
    const b = rozhodni(a.pamat, { ...v, rele: false, w: 0, sietKw: 3, now: T0 + MIN });
    assert.deepEqual([a.pamat.nad, b.pamat.nad], [1, 1]);
});

test('ručný režim: relé ostane, ako je - pri slabom aj silnom prebytku a so starým meraním', () => {
    const v = { rele: true, w: 2200, sietKw: -2, meranieAt: T0, now: T0, prahy: PRAHY, rucne: true };
    let pamat = PAMAT_ZACIATOK;
    for (let i = 0; i < 6; i++) {
        const r = rozhodni(pamat, { ...v, meranieAt: T0 + i * 5 * MIN, now: T0 + i * 5 * MIN });
        pamat = r.pamat;
        assert.equal(r.zapni, true, `zapnutý ručne, meranie ${i}`);
    }
    assert.equal(pamat.pod, 6, 'počítanie beží ďalej');
    // Po návrate k riadeniu appka vypne hneď - prebytok bol dlho pod prahom a beh trval dosť.
    assert.equal(rozhodni(pamat, { ...v, rucne: false, meranieAt: T0 + 30 * MIN, now: T0 + 30 * MIN }).zapni, false);
    const vyp = rozhodni(PAMAT_ZACIATOK, { ...v, rele: false, w: 0, sietKw: 5 });
    assert.equal(vyp.zapni, false, 'vypnutý ručne ostane vypnutý aj pri prebytku');
    assert.equal(rozhodni(PAMAT_ZACIATOK, { ...v, now: T0 + 30 * MIN }).zapni, true, 'staré meranie ho v ručnom režime nevypne');
});

test('záznam dňa: behy, energia z počítadla, podiel zo siete, nahriata voda a nový deň', () => {
    const tz = 'Europe/Bratislava';
    const v = (/** @type {number} */ min, /** @type {object} */ o) => ({
        now: new Date(T0 + min * MIN),
        tz,
        rele: true,
        w: 2200,
        energiaWh: 1000,
        sietKw: 0.1,
        ...o,
    });
    let den = zaznamenaj(null, v(0, { rele: false, w: 0 }));
    assert.deepEqual(den.behy, []);
    den = zaznamenaj(den, v(1, {}));
    assert.equal(den.behy.length, 1);
    assert.equal(den.behy[0].od, 10 * 60 + 1);
    // 30 minút z toho 10 so záporným meraním (odber 1 kW): zo siete ide 1 kW, nie celý bojler.
    for (let m = 2; m <= 31; m++) den = zaznamenaj(den, v(m, { energiaWh: 1000 + ((m - 1) * 2200) / 60, sietKw: m > 21 ? -1 : 0.1 }));
    assert.equal(Math.round(den.behy[0].wh), 1100);
    assert.equal(Math.round(den.behy[0].whSiet), Math.round((10 * 1000) / 60));
    assert.equal(Math.round(den.behy[0].hrejeMin), 30);
    // Termostat vypol: relé zapnuté, príkon ~0.
    den = zaznamenaj(den, v(32, { w: 3, energiaWh: 2140 }));
    assert.equal(den.hotovo, 10 * 60 + 32);
    assert.equal(bojlerStav({ kontaktAt: T0, rele: true, w: 3, prebytokKw: 2, prahy: PRAHY, den }, T0), 'hotovo');
    den = zaznamenaj(den, v(40, { rele: false, w: 0, energiaWh: 2140 }));
    assert.equal(den.behy[0].do, 10 * 60 + 40);
    assert.equal(den.hotovo, 10 * 60 + 32, 'po vypnutí ostane');
    den = zaznamenaj(den, v(50, { energiaWh: 2140 }));
    assert.equal(den.behy.length, 2, 'druhé zapnutie');
    den = zaznamenaj(den, v(51, { energiaWh: 2180 }));
    assert.equal(den.hotovo, null, 'znova hreje');
    const s = suctyDna(den);
    assert.equal(s.zapnuti, 2);
    assert.equal(Math.round(s.sietKwh * 1000), Math.round((10 * 1000) / 60));
    assert.ok(Math.abs(s.slnkoKwh + s.sietKwh - 1.18) < 0.01);
    // Polnoc: bežiaci beh pokračuje v novom dni od 0:00, starý deň sa zahodí.
    const noc = zaznamenaj(den, { ...v(0, { energiaWh: 5000 }), now: new Date(Date.UTC(2026, 10, 15, 23, 1)) });
    assert.equal(noc.den, '2026-11-16');
    assert.deepEqual([noc.behy.length, noc.behy[0].od, noc.hotovo], [1, 0, null]);
    const noc2 = zaznamenaj({ ...den, behy: [] }, { ...v(0, { rele: false }), now: new Date(Date.UTC(2026, 10, 15, 23, 1)) });
    assert.deepEqual(noc2.behy, []);
});

test('zmena ohrevu pre oznámenie: zapol, vypol a prečo; bez zmeny či prvé hlásenie nič', () => {
    /** @param {number} min @param {boolean} rele @param {number} w @param {boolean} [rucne] @returns {import('../shared/bojler.js').BojlerInfo} */
    const b = (min, rele, w, rucne = false) => ({
        kontaktAt: min * 60000,
        rele,
        w,
        prebytokKw: 2.4,
        prahy: { zapKw: 2.3, vypKw: 2 },
        den: null,
        rucne,
    });
    assert.equal(zmenaOhrevu(null, b(1, true, 2000)), null);
    assert.equal(zmenaOhrevu(b(1, true, 2000), b(2, true, 1900)), null);
    assert.equal(zmenaOhrevu(b(1, false, 0), b(2, true, 10)), null, 'relé zapnuté, ale voda nahriata - nehreje');
    assert.deepEqual(zmenaOhrevu(b(1, false, 0), b(2, true, 2000)), { zapol: true, dovod: 'appka', kw: 2.4 });
    assert.deepEqual(zmenaOhrevu(b(1, true, 2000), b(2, false, 0)), { zapol: false, dovod: 'appka', kw: 2.4 });
    assert.equal(zmenaOhrevu(b(1, true, 2000), b(2, true, 20))?.dovod, 'termostat');
    assert.equal(zmenaOhrevu(b(1, true, 20), b(2, true, 2000))?.dovod, 'termostat');
    assert.equal(zmenaOhrevu(b(1, false, 0, true), b(2, true, 2000, true))?.dovod, 'rucne');
    assert.equal(zmenaOhrevu(b(1, true, 2000, true), b(2, false, 0, true))?.dovod, 'rucne');
    assert.equal(zmenaOhrevu(b(1, true, 2000), b(2 + BOJLER.tichoMin, false, 0))?.dovod, 'spojenie');
    assert.equal(zmenaOhrevu(b(1, false, 0), b(2 + BOJLER.tichoMin, true, 2000))?.dovod, 'appka', 'zapnutie po výpadku je appka');
});

test('stav dlaždice: mlčí, hreje, nahriata, čaká', () => {
    const b = { kontaktAt: T0, rele: true, w: 2200, prebytokKw: 2.5, prahy: PRAHY, den: null, rucne: false };
    assert.equal(bojlerStav(b, T0 + MIN), 'hreje');
    assert.equal(bojlerStav({ ...b, rele: false }, T0), 'caka');
    assert.equal(bojlerStav({ ...b, rele: false, rucne: true }, T0), 'vypnuty');
    assert.equal(bojlerStav(b, T0 + 16 * MIN), 'mlci');
});
