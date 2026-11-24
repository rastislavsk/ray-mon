import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOJLER, HISTORIA } from '../shared/config.js';
import {
    domBezBojlera,
    parsePredpovedHist,
    pridajBehy,
    sBojlerom,
    snimkaPredpovede,
    zapisMeranie,
    zlucBehy,
    zlucSnimky,
} from '../shared/historia.js';
import { addDays } from '../shared/solar.js';

const TZ = 'Europe/Bratislava';
// 5. 9. 2026 10:00 miestneho času (UTC+2).
const T0 = Date.UTC(2026, 8, 5, 8, 0);
const min = (/** @type {number} */ m) => T0 + m * 60000;

test('domBezBojlera: výroba mínus dodávka, bez bojlera, ktorý práve hreje a ozval sa nedávno', () => {
    assert.equal(domBezBojlera(3, 1.2, null, T0), 1.8);
    assert.equal(domBezBojlera(0.5, -1, undefined, T0), 1.5, 'odber zo siete patrí domu');
    assert.equal(domBezBojlera(4, 0.2, { kontaktAt: T0, rele: true, w: 2000 }, T0), 1.8);
    assert.equal(domBezBojlera(4, 0.2, { kontaktAt: T0, rele: false, w: 2000 }, T0), 3.8, 'relé vypnuté');
    const stary = { kontaktAt: T0 - (BOJLER.tichoMin + 1) * 60000, rele: true, w: 2000 };
    assert.equal(domBezBojlera(4, 0.2, stary, T0), 3.8, 'zásuvka mlčí - jej príkon nepoznáme');
    assert.equal(domBezBojlera(1, 1.5, null, T0), 0, 'nikdy pod nulu');
    assert.equal(domBezBojlera(null, 1, null, T0), null);
    assert.equal(domBezBojlera(2, null, null, T0), null, 'bez elektromera');
});

test('zapisMeranie: merania hodiny sa zbierajú, nová hodina uzavrie predošlú do súhrnu dňa', () => {
    /** @type {any} */ let s = { hodina: null, dni: [] };
    const zapis = (/** @type {number} */ m, /** @type {number | null} */ v, /** @type {number | null} */ dom) =>
        (s = zapisMeranie(s, { at: min(m), tz: TZ, vyrobaKw: v, domKw: dom }));
    zapis(0, 3, 0.4);
    zapis(5, 3.2, 0.5);
    const dni = s.dni;
    zapis(5, 9, 9);
    assert.equal(s.hodina.v.length, 2, 'meranie, ktoré nie je novšie, sa nepočíta');
    zapis(10, 3.4, 2.4);
    zapis(15, null, null);
    assert.equal(s.dni, dni, 'kým hodina beží, história je tá istá');
    zapis(60, 4, 0.3);
    assert.notEqual(s.dni, dni);
    assert.equal(s.dni.length, 1);
    assert.equal(s.dni[0].d, '2026-09-05');
    assert.deepEqual(s.dni[0].h[10], [3.2, 0.5, 3], 'priemer výroby, medián domu (krátky ohrev 2,4 kW nepohne)');
    assert.equal(s.dni[0].h[11], null, 'bežiaca hodina ešte nie je v histórii');
    assert.deepEqual([s.hodina.hod, s.hodina.v], [11, [4]]);
    // Hodina bez elektromera: dom null.
    zapis(125, 1, null);
    assert.deepEqual(s.dni[0].h[11], [4, 0.3, 1]);
    zapis(185, 0.5, 0.2);
    assert.deepEqual(s.dni[0].h[12], [1, null, 1]);
});

test('zapisMeranie: nový deň začne nový záznam, drží sa najviac HISTORIA.dni dní', () => {
    /** @type {any} */ let s = { hodina: null, dni: [] };
    for (let d = 0; d < HISTORIA.dni + 3; d++) {
        s = zapisMeranie(s, { at: min(d * 1440), tz: TZ, vyrobaKw: 2, domKw: 0.4 });
        s = zapisMeranie(s, { at: min(d * 1440 + 60), tz: TZ, vyrobaKw: 2, domKw: 0.4 });
    }
    assert.equal(s.dni.length, HISTORIA.dni);
    assert.equal(s.dni.at(-1).d, addDays('2026-09-05', HISTORIA.dni + 2));
    assert.ok(s.dni.every((/** @type {any} */ x, /** @type {number} */ i) => i === 0 || s.dni[i - 1].d < x.d));
});

test('sBojlerom: energia behov dňa a či bojler na konci držal termostat, aj do dňa bez meraní', () => {
    const den = (/** @type {number | null} */ hotovo) => ({
        den: '2026-09-05',
        behy: [
            { od: 600, do: 640, wh: 1300.4, whSiet: 0, e0: 0, hrejeMin: 40 },
            { od: 700, do: 760, wh: 900, whSiet: 100, e0: 0, hrejeMin: 30 },
        ],
        hotovo,
        posledneAt: 0,
    });
    const dni = sBojlerom([], den(760));
    assert.deepEqual(dni, [{ d: '2026-09-05', h: Array(24).fill(null), b: { wh: 2200, hotovo: true } }]);
    /** @type {any} */ const s = zapisMeranie(zapisMeranie({ hodina: null, dni: [] }, { at: min(0), tz: TZ, vyrobaKw: 1, domKw: 1 }), {
        at: min(60),
        tz: TZ,
        vyrobaKw: 1,
        domKw: 1,
    });
    const spolu = sBojlerom(s.dni, den(null));
    assert.deepEqual(spolu[0].b, { wh: 2200, hotovo: false });
    assert.deepEqual(spolu[0].h[10], [1, 1, 1], 'hodiny ostanú');
});

/** Predpoveď s jedným dňom. @param {string} date */
const predpoved = (date) =>
    /** @type {any} */ ({
        days: [
            {
                date,
                tempMinC: 4,
                tempMaxC: 13,
                hourly: [
                    { hour: 9, kw: 1.23456, cloud: 40 },
                    { hour: 12, kw: 3.5, cloud: null },
                    { hour: 24, kw: 0, cloud: 0 },
                    { hour: 10.5, kw: 2, cloud: 0 },
                ],
            },
        ],
    });

test('snimkaPredpovede: prvá predpoveď dňa od rána, raz za deň, len dnešok', () => {
    const D = '2026-09-05';
    assert.deepEqual(snimkaPredpovede([], predpoved(D), D, HISTORIA.snimkaOdMin - 1), [], 'ešte skoro ráno');
    assert.deepEqual(snimkaPredpovede([], null, D, 600), []);
    assert.deepEqual(snimkaPredpovede([], predpoved('2026-09-06'), D, 600), [], 'dnešok v predpovedi nie je');
    const h = snimkaPredpovede([], predpoved(D), D, 600);
    assert.equal(h.length, 1);
    assert.deepEqual([h[0].d, h[0].m, h[0].t], [D, 600, 8.5]);
    assert.deepEqual([h[0].k[9], h[0].c[9], h[0].k[12], h[0].c[12], h[0].k[10]], [1.235, 40, 3.5, null, null]);
    assert.equal(snimkaPredpovede(h, predpoved(D), D, 900), h, 'druhá predpoveď dňa už nie');
    const bezTeploty = /** @type {any} */ (predpoved(D));
    bezTeploty.days[0].tempMinC = null;
    assert.equal(snimkaPredpovede([], bezTeploty, D, 600)[0].t, null);
});

test('parsePredpovedHist: z úložiska len platné snímky, jedna na deň, najviac HISTORIA.dni', () => {
    const ok = snimkaPredpovede([], predpoved('2026-09-05'), '2026-09-05', 600)[0];
    assert.deepEqual(parsePredpovedHist(null), []);
    assert.deepEqual(
        parsePredpovedHist([
            ok,
            { ...ok, m: 900 },
            null,
            { ...ok, d: '5. 9.' },
            { ...ok, m: 1.5 },
            { ...ok, k: [1, 2] },
            { ...ok, c: Array(24).fill('x') },
            { ...ok, d: '2026-09-04', t: 'teplo' },
            { ...ok, d: '2026-09-03', t: null },
        ]),
        [{ ...ok, d: '2026-09-03', t: null }, ok],
    );
    const vela = Array.from({ length: HISTORIA.dni + 5 }, (_, i) => ({ ...ok, d: addDays('2026-01-01', i) }));
    assert.equal(parsePredpovedHist(vela).length, HISTORIA.dni);
});

test('pridajBehy: dnešné behy podľa zápisu „Už beží“ (aj zrušený zmizne), staršie ostanú HISTORIA.dni dní', () => {
    const D = '2026-09-05';
    const vcera = { id: 'pracka', d: addDays(D, -1), m: 600, k: 720 };
    const stary = { id: 'pracka', d: addDays(D, -HISTORIA.dni), m: 600, k: 720 };
    const dnes = { id: 'umyvacka', d: D, m: 700, k: 850 };
    const h = pridajBehy([stary, vcera, { id: 'susicka', d: D, m: 500, k: 590 }], [dnes], D);
    assert.deepEqual(h, [vcera, dnes]);
});

test('zlucSnimky: Worker berie prvú snímku dňa, nič po dnešku ani staršie než HISTORIA.dni, nezmysly vypadnú', () => {
    const D = '2026-09-05';
    const ok = snimkaPredpovede([], predpoved(D), D, 600)[0];
    const vcera = { ...ok, d: addDays(D, -1) };
    const stara = { ...ok, d: addDays(D, -HISTORIA.dni - 1) };
    const zajtra = { ...ok, d: addDays(D, 1) };
    assert.deepEqual(zlucSnimky(undefined, [ok, vcera, stara, zajtra, null, { ...ok, k: 'x' }], D), [vcera, ok]);
    assert.deepEqual(zlucSnimky([vcera], [{ ...vcera, m: 900 }], D), [vcera], 'snímku, ktorú má, nič neprepíše');
    assert.deepEqual(zlucSnimky([vcera], 'x', D), [vcera]);
    const vela = [...Array.from({ length: HISTORIA.dni + 1 }, () => null), ok];
    assert.deepEqual(zlucSnimky([], vela, D), [], 'viac než HISTORIA.dni + 1 snímok Worker neprijme');
});

test('zlucBehy: behy z histórie telefónu len pred dneškom a HISTORIA.dni dní, ten istý beh ostane z Workera', () => {
    const D = '2026-09-05';
    const vcera = { id: 'pracka', d: addDays(D, -1), m: 600, k: 720 };
    const stary = { id: 'pracka', d: addDays(D, -HISTORIA.dni - 1), m: 600, k: 720 };
    const dnes = { id: 'umyvacka', d: D, m: 700, k: 850 };
    assert.deepEqual(zlucBehy([dnes], [vcera, stary, dnes, { ...dnes, d: addDays(D, -2), k: 900 }, 'x'], D), [
        { ...dnes, d: addDays(D, -2), k: 900 },
        vcera,
        dnes,
    ]);
    assert.deepEqual(zlucBehy([vcera], [{ ...vcera, k: 800 }], D), [vcera], 'Worker má prednosť');
    assert.deepEqual(zlucBehy(undefined, null, D), []);
});
