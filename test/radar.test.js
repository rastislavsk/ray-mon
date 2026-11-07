import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RADAR, radarModelUrl } from '../shared/config.js';
import {
    bajtNaDbz,
    blokyParam,
    dazdVBode,
    dbzNaBajt,
    hdf5Bloky,
    laea,
    mapaBodov,
    mercX,
    mercY,
    mmNaDbz,
    modelBody,
    modelSnimky,
    oblastBlokov,
    ocisti,
    pohyb,
    pohybBajty,
    radarBloky,
    telaBlokov,
    vlozBlok,
    vyrez,
    zjemni,
} from '../shared/radar-data.js';
import {
    dazdLut,
    farbaBajtu,
    farbaDbz,
    hhmm,
    krokovMinulost,
    krokovSpolu,
    legendaPrechod,
    osRadaru,
    pasOsi,
    popisChvile,
    radarKrok,
    radarTag,
    upravStyl,
} from '../shared/radar.js';

const CAS = Date.UTC(2026, 10, 7, 7, 30);
const POLNOC = Date.UTC(2026, 10, 6, 23, 0);

test('laea: rohy mriežky OPERA zo zadania súboru', () => {
    const [c1, r1] = laea(-10.4345768386404, 31.7462153182675);
    assert.ok(Math.abs(c1) < 0.01 && Math.abs(r1 - RADAR.riadky) < 0.01);
    const [c2, r2] = laea(57.8119647501499, 67.6210371071631);
    assert.ok(Math.abs(c2 - RADAR.stlpce) < 0.01 && Math.abs(r2) < 0.01);
});

test('radarBloky: Slovensko má bloky, miesto mimo Európy nie', () => {
    const bloky = radarBloky(48.48, 18.12);
    assert.ok(bloky && bloky.length >= 2 && bloky.length <= 4);
    assert.ok(bloky.every((b) => b.row % RADAR.blokRiadky === 0 && b.col % RADAR.blokStlpce === 0));
    assert.equal(blokyParam([{ row: 2280, col: 1760 }]), '2280_1760');
    assert.equal(radarBloky(-33.9, 151.2), null);
});

test('oblastBlokov: výrez obsahuje polohu a mapa bodov mieri do plochy', () => {
    const [lat, lon] = [48.48, 18.12];
    const o = oblastBlokov(/** @type {NonNullable<ReturnType<typeof radarBloky>>} */ (radarBloky(lat, lon)));
    assert.ok(mercX(lon) > o.x0 && mercX(lon) < o.x1 && mercY(lat) > o.y0 && mercY(lat) < o.y1);
    const mapa = mapaBodov(o);
    assert.equal(mapa.length, o.w * o.h);
    assert.ok(mapa.filter((v) => v >= 0).length > mapa.length / 2);
    assert.ok(mapa.every((v) => v < o.pw * o.ph));
});

test('bajty sily: pod prahom nič, nad ním tam a späť', () => {
    assert.equal(dbzNaBajt(-9999000), 0);
    assert.equal(dbzNaBajt(RADAR.dbz.prah - 0.1), 0);
    assert.equal(dbzNaBajt(1000), 255);
    assert.ok(Math.abs(bajtNaDbz(dbzNaBajt(35)) - 35) < 0.2);
    assert.equal(mmNaDbz(0), 0);
    assert.ok(Math.abs(mmNaDbz(1) - 23) < 0.1);
});

test('hdf5Bloky: nájde B-tree dát, preskočí iné TREE a bez neho vráti null', () => {
    const buf = new ArrayBuffer(200);
    const b = new Uint8Array(buf);
    const v = new DataView(buf);
    /** @param {number} o @param {number} typ */
    const tree = (o, typ) => {
        b.set([84, 82, 69, 69, typ, 0], o);
        v.setUint16(o + 6, 1, true);
    };
    tree(10, 0);
    tree(50, 1);
    v.setUint32(74, 1234, true);
    v.setBigUint64(82, 760n, true);
    v.setBigUint64(90, 880n, true);
    v.setBigUint64(106, 9999n, true);
    assert.deepEqual(hdf5Bloky(buf), [{ size: 1234, row: 760, col: 880, addr: 9999 }]);
    assert.equal(hdf5Bloky(new ArrayBuffer(100)), null);
});

test('hdf5Bloky: odrezaný index je null', () => {
    const buf = new ArrayBuffer(60);
    new Uint8Array(buf).set([84, 82, 69, 69, 1, 0], 0);
    new DataView(buf).setUint16(6, 10, true);
    assert.equal(hdf5Bloky(buf), null);
});

test('telaBlokov: rozloží odpoveď Workera', () => {
    const meta = new TextEncoder().encode(JSON.stringify([{ row: 0, col: 880, size: 3 }]));
    const buf = new ArrayBuffer(4 + meta.length + 3);
    new DataView(buf).setUint32(0, meta.length, true);
    new Uint8Array(buf).set(meta, 4);
    new Uint8Array(buf).set([7, 8, 9], 4 + meta.length);
    const [b] = telaBlokov(buf);
    assert.deepEqual([b.row, b.col, [...b.data]], [0, 880, [7, 8, 9]]);
});

test('vlozBlok a vyrez: hodnota sa dostane z bloku na správne miesto', () => {
    const o = { x0: 0, y0: 0, x1: 1, y1: 1, w: 2, h: 1, riadok: 0, stlpec: 0, pw: RADAR.blokStlpce, ph: RADAR.blokRiadky };
    const blok = new Float64Array(RADAR.blokRiadky * RADAR.blokStlpce).fill(-9999000);
    blok[2 * RADAR.blokStlpce + 3] = 40;
    const plocha = new Uint8Array(o.pw * o.ph);
    vlozBlok(blok, 0, 0, plocha, o);
    const f = vyrez(plocha, Int32Array.from([2 * o.pw + 3, -1]), o);
    assert.equal(f[0], dbzNaBajt(40));
    assert.equal(f[1], 0);
});

test('ocisti: súvislý dážď ostane, osamelý bod a malý ostrov zmiznú', () => {
    const w = 60;
    const h = 40;
    const f = new Uint8Array(w * h);
    for (let y = 5; y < 20; y++) for (let x = 5; x < 25; x++) f[y * w + x] = 50;
    f[30 * w + 40] = 200;
    for (let y = 30; y < 33; y++) for (let x = 10; x < 13; x++) f[y * w + x] = 50;
    const g = ocisti(f, w, h);
    assert.equal(g[10 * w + 10], 50);
    assert.equal(g[30 * w + 40], 0);
    assert.equal(g[31 * w + 11], 0);
});

test('pohyb: nájde posun pásu dažďa, v miestach bez dažďa dá priemer', () => {
    const w = 200;
    const h = 120;
    /** @param {number} posun */
    const pas = (posun) => {
        const f = new Uint8Array(w * h);
        for (let y = 40; y < 80; y++) for (let x = 60 + posun; x < 120 + posun; x++) f[y * w + x] = 120;
        return f;
    };
    const p = pohyb([[pas(0), pas(8)]], w, h, 4);
    const stred = Math.round(60 / p.g) * p.gx + Math.round(90 / p.g);
    assert.ok(Math.abs(p.dx[stred] - 2) < 0.6, `dx ${p.dx[stred]}`);
    assert.ok(Math.abs(p.dy[stred]) < 0.3);
    const b = pohybBajty(p);
    assert.equal(b.length, p.dx.length * 2);
    assert.ok(b[stred * 2] > 127);
});

test('pohyb: bez dažďa stojí na mieste', () => {
    const f = new Uint8Array(100 * 80);
    const p = pohyb([[f, f]], 100, 80, 4);
    assert.ok(p.dx.every((v) => v === 0) && p.dy.every((v) => v === 0));
});

test('dazdVBode: najsilnejšie okolie a kraj obrázka', () => {
    const o = { w: 10, h: 10 };
    const f = new Uint8Array(100);
    f[55] = 90;
    assert.equal(dazdVBode(f, /** @type {any} */ (o), [4, 4], 1), 90);
    assert.equal(dazdVBode(f, /** @type {any} */ (o), [0, 0], 1), 0);
    assert.equal(dazdVBode(f, /** @type {any} */ (o), [-5, 50]), 0);
});

test('modelBody a adresa modelu', () => {
    const o = oblastBlokov([{ row: 2280, col: 1760 }]);
    const body = modelBody(o);
    assert.equal(body.length, RADAR.modelBodyX * RADAR.modelBodyY);
    assert.ok(body[0].lat > body[body.length - 1].lat);
    assert.ok(body[0].lon < body[RADAR.modelBodyX - 1].lon);
    const u = radarModelUrl(body.slice(0, 2));
    assert.match(u, /latitude=[\d.]+,[\d.]+&longitude=/);
    assert.match(u, /models=icon_eu/);
});

test('modelSnimky: poskladá hodiny a cudziu odpoveď odmietne', () => {
    const n = RADAR.modelBodyX * RADAR.modelBodyY;
    const bod = { hourly: { time: [100, 3700], precipitation: [1, null], cloud_cover: [50, 60] } };
    const m = modelSnimky(Array.from({ length: n }, () => bod));
    assert.deepEqual(m?.casy, [100000, 3700000]);
    assert.equal(m?.dazd[1][0], 0);
    assert.equal(m?.oblaky[1][0], 60);
    assert.equal(modelSnimky({ hourly: {} }), null);
    assert.equal(modelSnimky(Array.from({ length: n }, () => ({}))), null);
    assert.equal(modelSnimky(Array.from({ length: n }, (_, i) => (i ? { hourly: { time: [1] } } : bod))), null);
});

test('zjemni: zachová rozsah a roztiahne mriežku', () => {
    const o = zjemni([0, 0, 100, 100], 2, 2, 4);
    assert.equal(o.length, 64);
    assert.equal(o[0], 0);
    assert.equal(o[63], 100);
});

test('čas: meno snímky je v UTC a krok ide dole', () => {
    assert.equal(radarTag(CAS), '20261107T0730');
    assert.equal(radarKrok(CAS + 4 * 60000), CAS);
    assert.equal(hhmm(CAS, 60), '08:30');
    assert.equal(hhmm(Date.UTC(2026, 10, 7, 23, 30), 60), '00:30');
    assert.equal(krokovSpolu, 2 * krokovMinulost);
});

test('osRadaru: dve hodiny dozadu aj dopredu', () => {
    const o = osRadaru('2h', CAS, POLNOC, 60);
    assert.equal(o.pocet, 48);
    assert.equal(o.teraz, 24);
    assert.deepEqual(
        o.znacky.map((z) => z.text),
        ['06:30', '07:30', 'Teraz', '09:30', '10:30'],
    );
});

test('osRadaru: Dnes má teraz, Zajtra nie', () => {
    assert.equal(osRadaru('dnes', CAS, POLNOC, 60).teraz, 8.5);
    assert.equal(osRadaru('zajtra', CAS, POLNOC, 60).teraz, null);
    assert.equal(osRadaru('dnes', CAS + 864e5, POLNOC, 60).teraz, 23);
});

test('popisChvile: meranie, teraz, predpoveď a model', () => {
    assert.deepEqual(popisChvile('2h', 24, CAS, POLNOC, 60), { cas: '08:30', druh: 'Teraz', predpoved: false });
    assert.deepEqual(popisChvile('2h', 12, CAS, POLNOC, 60), { cas: '07:30', druh: 'Pred 1 h · meranie', predpoved: false });
    assert.deepEqual(popisChvile('2h', 20, CAS, POLNOC, 60), { cas: '08:10', druh: 'Pred 20 min · meranie', predpoved: false });
    assert.deepEqual(popisChvile('2h', 41, CAS, POLNOC, 60), { cas: '09:55', druh: 'O 1 h 25 min · predpoveď', predpoved: true });
    assert.deepEqual(popisChvile('dnes', 12, CAS, POLNOC, 60), { cas: '12:00', druh: 'Dnes · predpoveď modelu', predpoved: true });
    assert.deepEqual(popisChvile('zajtra', 6, CAS, POLNOC, 60), { cas: '06:00', druh: 'Zajtra · predpoveď modelu', predpoved: true });
});

test('farby: rastú s dažďom, bez dažďa priehľadné', () => {
    assert.equal(farbaDbz(8)[3], 0);
    assert.equal(farbaDbz(70)[3], 1);
    const lut = dazdLut();
    assert.equal(lut.length, 1024);
    assert.equal(lut[3], 0);
    assert.ok(lut[255 * 4 + 3] === 255);
    assert.match(farbaBajtu(0), /^rgb\(/);
    assert.match(legendaPrechod(), /^linear-gradient\(90deg, #/);
});

test('upravStyl: drobnosti preč, mená po slovensky, farby appky', () => {
    const layers = [
        { id: 'background', type: 'background' },
        { id: 'ne', source: 'ne2_shaded', type: 'raster' },
        { id: 'water', type: 'fill' },
        { id: 'poi_r1', type: 'symbol' },
        { id: 'boundary_country', type: 'line' },
        { id: 'highway_motorway', type: 'line' },
        { id: 'other_line', type: 'line' },
        { id: 'place_city', type: 'symbol', layout: { 'text-field': 'x', 'text-variable-anchor': ['top'], 'icon-image': 'y' } },
        { id: 'place_country', type: 'symbol', layout: { 'text-field': 'x' } },
        { id: 'sym', type: 'symbol', layout: {} },
    ];
    const s = upravStyl({ version: 8, layers });
    /** @param {string} id */
    const l = (id) => s.layers.find((/** @type {{ id: string }} */ x) => x.id === id);
    assert.equal(l('poi_r1'), undefined);
    assert.equal(l('background').paint['background-color'], RADAR.mapa.pevnina);
    assert.equal(l('ne').layout.visibility, 'none');
    assert.equal(l('water').paint['fill-color'], RADAR.mapa.voda);
    assert.equal(l('boundary_country').paint['line-color'], RADAR.mapa.hranica);
    assert.equal(l('highway_motorway').paint['line-color'], RADAR.mapa.cesta);
    assert.equal(l('other_line').paint, undefined);
    assert.equal(l('place_city').layout['text-anchor'], 'top');
    assert.equal(l('place_city').layout['icon-image'], undefined);
    assert.equal(l('place_country').layout['text-anchor'], 'center');
    assert.deepEqual(l('place_country').layout['text-field'][1], ['get', 'name:sk']);
});

test('pasOsi: bez dažďa nič, sila ide do výšky', () => {
    assert.deepEqual(pasOsi([0, 0]), []);
    const p = pasOsi([0, 255]);
    assert.deepEqual(p, [{ poz: 1, vyska: 1, bajt: 255 }]);
});
