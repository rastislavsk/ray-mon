import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HVIEZDY } from '../shared/config.js';
import { hranicaJasu, hviezdnyCas, hviezdy, naOblohe, premietni } from '../shared/hviezdy.js';
import { HVIEZDY_DATA } from '../shared/hviezdy-data.js';

const NITRA = { lat: 48.48, lon: 18.12 };
const RIO = { lat: -22.91, lon: -43.17 };
const QUITO = { lat: 0, lon: -78.5 };
const POLARKA = { ra: 37.95, dec: 89.26 };
const SIRIUS = { ra: 101.29, dec: -16.72, mag: -1.46 };
const BETELGEUZA = { ra: 88.79, dec: 7.41, mag: 0.5 };
const RIGEL = { ra: 78.63, dec: -8.2, mag: 0.12 };
const MINTAKA = { ra: 83.0, dec: -0.3, mag: 2.23 };

/** Chvíľa, keď je miestny hviezdny čas na dĺžke `lon` rovný `lst` (presne na kresbu). @param {number} lst @param {number} lon */
function chvilaPri(lst, lon) {
    const t0 = new Date('2026-11-01T00:00:00Z');
    const posun = (((lst - hviezdnyCas(t0, lon)) % 360) + 360) % 360;
    return new Date(t0.getTime() + (posun / 360.98564736629) * 86400000);
}

/** @param {{ x: number, y: number, mag: number }[]} zoznam @param {number} mag */
const najdi = (zoznam, mag) => zoznam.find((h) => h.mag === mag);

/** Chvíľa, keď hviezda stúpa a stojí presne na východe nad `miesto` (s presnosťou na minútu). @param {{ ra: number, dec: number }} s @param {{ lat: number, lon: number }} miesto */
function naVychode(s, miesto) {
    const t0 = new Date('2026-11-01T00:00:00Z').getTime();
    for (let m = 0; m < 1440; m++) {
        const t = new Date(t0 + m * 60000);
        const { vyska, azimut } = naOblohe(s.ra, s.dec, hviezdnyCas(t, miesto.lon), miesto.lat);
        if (vyska > HVIEZDY.minVyska && Math.abs(azimut - 90) < 0.5) return t;
    }
    throw new Error('hviezda nestojí na východe');
}

test('hviezdnyCas: zhoda s príkladom Meeusa a posun o dĺžku', () => {
    // Meeus, Astronomical Algorithms, príklad 12.a: 10. 4. 1987 0h UT, GMST 13h10m46,3668s.
    const t = new Date(Date.UTC(1987, 3, 10));
    assert.ok(Math.abs(hviezdnyCas(t, 0) - 197.693195) < 0.001);
    assert.ok(Math.abs(hviezdnyCas(t, -170) - 27.693195) < 0.001, 'západná dĺžka ide do 0-360');
});

test('naOblohe: Polárka stojí na severe vo výške zemepisnej šírky, z Ria ju nevidno', () => {
    for (const hodina of [0, 6, 12, 18]) {
        const lst = hviezdnyCas(new Date(Date.UTC(2026, 10, 1, hodina)), NITRA.lon);
        const p = naOblohe(POLARKA.ra, POLARKA.dec, lst, NITRA.lat);
        assert.ok(Math.abs(p.vyska - NITRA.lat) < 1, `výška ${p.vyska}`);
        assert.ok(p.azimut < 1.5 || p.azimut > 358.5, `azimut ${p.azimut}`);
        assert.ok(naOblohe(POLARKA.ra, POLARKA.dec, lst, RIO.lat).vyska < 0);
    }
});

test('naOblohe: hviezda na poludníku je na juhu vo výške 90° − šírka + deklinácia, na východe vychádza', () => {
    const p = naOblohe(SIRIUS.ra, SIRIUS.dec, SIRIUS.ra, NITRA.lat);
    assert.ok(Math.abs(p.vyska - (90 - NITRA.lat + SIRIUS.dec)) < 1e-9);
    assert.ok(Math.abs(p.azimut - 180) < 1e-9);
    // Šesť hodín pred kulmináciou je hviezda na nebeskom rovníku presne na východe.
    const v = naOblohe(0, 0, -90, NITRA.lat);
    assert.ok(Math.abs(v.vyska) < 1e-9 && Math.abs(v.azimut - 90) < 1e-9);
});

test('hranicaJasu: oblaky a osvetlený mesiac skryjú slabé hviezdy', () => {
    assert.equal(hranicaJasu(0, 0), HVIEZDY.magMax);
    assert.ok(Math.abs(hranicaJasu(100, 0) - (HVIEZDY.magMax - HVIEZDY.oblakyMag)) < 1e-9);
    assert.ok(Math.abs(hranicaJasu(0, 0.5) - (HVIEZDY.magMax - HVIEZDY.splnMag)) < 1e-9);
    assert.ok(hranicaJasu(0, 0.25) < hranicaJasu(0, 0) && hranicaJasu(0, 0.25) > hranicaJasu(0, 0.5), 'štvrť je medzi');
});

/** Posun hviezdy `s` v poli za dve hodiny, od chvíle na východe. @param {typeof RIGEL} s @param {{ lat: number, lon: number }} miesto */
function vychadza(s, miesto) {
    const t = naVychode(s, miesto);
    const pri = (/** @type {Date} */ chvila) => najdi(hviezdy({ chvila, ...miesto, oblacnost: 0, mesiac: 0 }), s.mag);
    const b = pri(t);
    const neskor = pri(new Date(t.getTime() + 2 * 3600000));
    if (!b || !neskor) throw new Error('hviezda mimo poľa');
    assert.ok(Math.abs(b.x - HVIEZDY.sirka / 2) < 1.5, `x ${b.x}`);
    assert.ok(neskor.y < b.y - 10, 'stúpa');
    return neskor.x - b.x;
}

test('hviezdy: pohľad na východ - stúpajúca hviezda je v strede, sever vľavo', () => {
    assert.ok(vychadza(BETELGEUZA, NITRA) > 5, 'na severe ide k juhu, doprava');
    assert.ok(vychadza(RIGEL, RIO) < -5, 'na juhu ide k severu, doľava');
    assert.ok(Math.abs(vychadza(MINTAKA, QUITO)) < 2, 'na rovníku rovno hore');
});

test('hviezdy: všetko je v poli, hviezda na západe tam nepatrí', () => {
    const t = chvilaPri(BETELGEUZA.ra + 75, NITRA.lon);
    const z = hviezdy({ chvila: t, ...NITRA, oblacnost: 0, mesiac: 0 });
    for (const h of z) assert.ok(h.x >= 0 && h.x <= HVIEZDY.sirka && h.y >= 0 && h.y <= HVIEZDY.vyska);
    assert.equal(najdi(z, BETELGEUZA.mag), undefined);
});

test('premietni: obzor je pri spodnom okraji poľa, stred poľa vo výške vyskaStredu', () => {
    const obzor = premietni(HVIEZDY.minVyska, HVIEZDY.smer);
    assert.ok(Math.abs(obzor.x - HVIEZDY.sirka / 2) < 1e-9);
    assert.ok(obzor.y > HVIEZDY.vyska - 3 && obzor.y <= HVIEZDY.vyska);
    assert.ok(Math.abs(premietni(HVIEZDY.vyskaStredu, HVIEZDY.smer).y - HVIEZDY.vyska * HVIEZDY.stredY) < 1e-9);
});

test('hviezdy: oblaky a spln ich ubúdajú, pod obzorom nie sú', () => {
    const t = new Date('2026-11-01T21:00:00Z');
    const pocet = (/** @type {number} */ oblacnost, /** @type {number} */ mesiac) =>
        hviezdy({ chvila: t, ...NITRA, oblacnost, mesiac }).length;
    assert.ok(pocet(0, 0) > 30, `jasno ${pocet(0, 0)}`);
    assert.ok(pocet(50, 0) < pocet(0, 0));
    assert.ok(pocet(0, 0.5) < pocet(0, 0));
    assert.ok(pocet(100, 0.5) <= pocet(50, 0));
    // Žiadna slabšia, ako dovolí hranica.
    for (const h of hviezdy({ chvila: t, ...NITRA, oblacnost: 40, mesiac: 0.3 })) assert.ok(h.mag <= hranicaJasu(40, 0.3));
});

test('hviezdy-data: trojice v rozsahu, zoradené od najjasnejšej, do magnitúdy 3,5', () => {
    assert.equal(HVIEZDY_DATA.length % 3, 0);
    for (let i = 0; i < HVIEZDY_DATA.length; i += 3) {
        assert.ok(HVIEZDY_DATA[i] >= 0 && HVIEZDY_DATA[i] < 360);
        assert.ok(Math.abs(HVIEZDY_DATA[i + 1]) <= 90);
        assert.ok(HVIEZDY_DATA[i + 2] <= HVIEZDY.magMax);
        if (i) assert.ok(HVIEZDY_DATA[i + 2] >= HVIEZDY_DATA[i - 1]);
    }
});
