// Auto sa nabíja (docs/navrhy/auto-nabija.html): stav z meraní, dlaždica, panel a texty oznámení (shared/auto-nabija.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    AUTO_NABIJA_TEXTS,
    AUTO_ZACIATOK,
    autoDetail,
    autoDlazdicaNabija,
    autoInfoZ,
    autoTiche,
    krokAuta,
    nabijaSa,
} from '../shared/auto-nabija.js';
import { ALL_DAYS, ALL_MONTHS, AUTO_NABIJA, SITE, TARIFF } from '../shared/config.js';
import { autoZmenaText } from '../shared/messages-oznamenia.js';

const MIN = 60000;
const TZ = SITE.timezone;
const T0 = Date.parse('2026-11-24T12:00:00Z'); // 13:00 SEČ

/**
 * Prejde merania [minúta od T0, dom bez bojlera kW, dodávka do siete kW] a vráti posledný stav a všetky zmeny.
 * @param {Array<[number, number | null, number]>} merania @param {import('../shared/auto-nabija.js').StavAuta | null} [od]
 */
function prejdi(merania, od = null) {
    let stav = od;
    /** @type {import('../shared/auto-nabija.js').ZmenaAuta[]} */ const zmeny = [];
    for (const [m, domKw, sietKw] of merania) {
        const r = krokAuta(stav, { at: T0 + m * MIN, domKw, sietKw });
        stav = r.stav;
        if (r.zmena) zmeny.push(r.zmena);
    }
    return { stav: /** @type {import('../shared/auto-nabija.js').StavAuta} */ (stav), zmeny };
}

test('nabíjanie: začne po dvoch meraniach nad 4,1 kW, výkon auta je dom mínus dom pred ním', () => {
    const { stav, zmeny } = prejdi([
        [0, 0.5, 2],
        [5, 7.7, -2.2],
        [10, 7.7, -2.2],
    ]);
    assert.equal(zmeny.length, 1);
    const z = zmeny[0];
    assert.equal(z.zacal, true);
    assert.equal(z.beh.m, T0 + 5 * MIN, 'začiatok je prvé meranie nad prahom');
    assert.equal(z.beh.k, null);
    assert.equal(z.beh.kw, 7.2);
    // 5 min pri 7,2 kW = 600 Wh, zo siete 2,2 kW = 183,3 Wh.
    assert.equal(z.beh.wh, 600);
    assert.equal(z.beh.whSiet, 183.3);
    assert.equal(z.slnkoKw, 5);
    assert.equal(stav.behy.length, 1);
});

test('nabíjanie: jedno meranie nad prahom (rúra) nič nezačne, ani meranie po medzere', () => {
    const kratke = prejdi([
        [0, 0.5, 2],
        [5, 5, 0],
        [10, 0.6, 2],
    ]);
    assert.equal(kratke.zmeny.length, 0);
    assert.equal(kratke.stav.behy.length, 0);
    const medzera = prejdi([
        [0, 0.5, 2],
        [5, 7.5, 0],
        [40, 7.5, 0],
    ]);
    assert.equal(medzera.zmeny.length, 0, 'medzi meraniami vyše AUTO_NABIJA.medzeraMin - počíta sa odznova');
    assert.equal(prejdi([[45, 7.5, 0]], medzera.stav).zmeny.length, 1);
});

test('nabíjanie: skončí po dvoch meraniach pod 3,5 kW, koniec je prvé z nich; energia za medzeru sa nepripočíta', () => {
    const zac = prejdi([
        [0, 0.5, 0],
        [5, 7.5, 0],
        [10, 7.5, 0],
        [15, 7.5, 0],
    ]);
    assert.equal(zac.stav.behy[0].wh, 1166.6, 'dva úseky po 5 min pri 7 kW (583,3 Wh)');
    const pokles = prejdi(
        [
            [20, 3.8, 0],
            [25, 3, 0],
            [30, 7.5, 0],
            [35, 3, 0],
        ],
        zac.stav,
    );
    assert.equal(pokles.zmeny.length, 0, 'jedno meranie pod prahom nestačí');
    const koniec = prejdi([[40, 0.6, 3]], pokles.stav);
    assert.equal(koniec.zmeny.length, 1);
    const beh = koniec.zmeny[0].beh;
    assert.equal(koniec.zmeny[0].zacal, false);
    assert.equal(beh.k, T0 + 35 * MIN);
    assert.equal(beh.kw, 0);
    assert.equal(koniec.stav.zakladKw, 0.6);
    // Bez medzery: 10 - 15 (7 kW), 15 - 20 (3,3 kW, nad 3,5 kW dom), 25 - 30 (7 kW).
    assert.equal(beh.wh, 2024.9);
    assert.deepEqual(
        beh.q.map((x) => x[0]),
        [1166.6, 858.3],
    );
    const poMedzere = prejdi(
        [
            [20, 7.5, 0],
            [60, 7.5, 0],
        ],
        zac.stav,
    );
    assert.equal(poMedzere.stav.behy[0].wh, 1749.9, 'úsek 20 - 60 min sa nepripočíta');
});

test('nabíjanie: bez merania domu nič, staré behy po AUTO_NABIJA.dni dňoch preč', () => {
    const r = krokAuta(AUTO_ZACIATOK, { at: T0, domKw: null, sietKw: 1 });
    assert.equal(r.stav, AUTO_ZACIATOK);
    const stary = { m: T0 - 9 * 24 * 60 * MIN, k: T0 - 9 * 24 * 60 * MIN + 60 * MIN, wh: 7000, whSiet: 0, kw: 0, q: [] };
    const s = krokAuta({ ...AUTO_ZACIATOK, at: T0 - MIN, behy: [stary] }, { at: T0, domKw: 0.5, sietKw: 1 }).stav;
    assert.deepEqual(s.behy, []);
    assert.equal(krokAuta(s, { at: T0, domKw: 9, sietKw: 0 }).stav, s, 'meranie s tým istým časom nič nemení');
});

test('oznámenie v noci potichu (N3)', () => {
    assert.equal(autoTiche(Date.parse('2026-11-24T21:30:00Z'), TZ), true, '22:30');
    assert.equal(autoTiche(Date.parse('2026-11-24T04:30:00Z'), TZ), true, '5:30');
    assert.equal(autoTiche(Date.parse('2026-11-24T05:00:00Z'), TZ), false, '6:00');
    assert.equal(autoTiche(T0, TZ), false);
});

const BEH = {
    m: T0 - 60 * MIN,
    k: null,
    wh: 7200,
    whSiet: 2700,
    kw: 7.2,
    q: /** @type {Array<[number, number]>} */ ([
        [1800, 0],
        [1800, 900],
        [1800, 900],
        [1800, 900],
    ]),
};

test('odpoveď Workera: platná prejde, pokazená je null', () => {
    assert.deepEqual(autoInfoZ({ at: T0, behy: [BEH] }), { at: T0, behy: [BEH] });
    assert.equal(autoInfoZ(null), null);
    assert.equal(autoInfoZ({ at: 'x', behy: [] }), null);
    assert.equal(autoInfoZ({ at: T0, behy: [{ ...BEH, q: [[1]] }] }), null);
    assert.equal(autoInfoZ({ at: T0, behy: [{ ...BEH, k: 'x' }] }), null);
    assert.equal(autoInfoZ({ at: T0, behy: [{ ...BEH, wh: null }] }), null);
    assert.equal(autoInfoZ({ at: T0, behy: [1] }), null);
});

test('nabíja sa: len otvorený beh s čerstvým meraním', () => {
    const info = { at: T0, behy: [BEH] };
    assert.equal(nabijaSa(info, T0 + 5 * MIN), BEH);
    assert.equal(nabijaSa(info, T0 + (AUTO_NABIJA.platnostMin + 1) * MIN), null, 'bez meraní appka nevie');
    assert.equal(nabijaSa({ at: T0, behy: [{ ...BEH, k: T0 }] }, T0), null);
    assert.equal(nabijaSa(null, T0), null);
    assert.equal(nabijaSa({ at: T0, behy: [] }, T0), null);
});

test('dlaždica počas nabíjania (T2): km behu, od kedy, výkon a podiel slnka', () => {
    assert.deepEqual(autoDlazdicaNabija(BEH, TZ), {
        velky: '+40',
        za: 'km',
        meno: 'Auto',
        odr: ['asi sa nabíja od 12:00', '≈ 7,2 kW'],
        podiel: 63,
        zapnuty: 'nabija',
    });
    assert.equal(autoDlazdicaNabija({ ...BEH, wh: 0 }, TZ).podiel, null);
});

/** VT 12:00 - 12:30, inak NT. @type {import('../shared/config.js').Tariff} */
const VT = {
    ...TARIFF,
    bands: [
        { id: 'nt', name: 'NT', level: 'lacna', price: 0.1 },
        { id: 'vt', name: 'VT', level: 'draha', price: 0.2 },
    ],
    schedules: [
        {
            days: ALL_DAYS,
            months: ALL_MONTHS,
            changes: [
                { from: '00:00', band: 'nt' },
                { from: '12:00', band: 'vt' },
                { from: '12:30', band: 'nt' },
            ],
        },
    ],
};

test('panel Auto počas nabíjania: riadok stavu, beh, energia podľa zdroja s VT, os a súčty', () => {
    const now = new Date(T0);
    const vcera = {
        m: T0 - 24 * 60 * MIN,
        k: T0 - 23 * 60 * MIN,
        wh: 6000,
        whSiet: 6000,
        kw: 0,
        q: /** @type {Array<[number, number]>} */ ([[6000, 6000]]),
    };
    const d = autoDetail(
        { at: T0, behy: [vcera, BEH] },
        { now, tz: TZ, tariff: VT, slnko: { kwh: 13.4, km: 80 }, vyroba: Array.from({ length: 96 }, (_, i) => (i > 30 && i < 66 ? 3 : 0)) },
    );
    assert.equal(d.nabija, true);
    assert.equal(d.pod, 'Asi sa nabíja od 12:00 · ≈ 7,2 kW');
    assert.equal(d.beh?.km, '+40');
    assert.equal(d.beh?.kedy, AUTO_NABIJA_TEXTS.vTomto);
    assert.equal(d.beh?.slnko, '63 % zo slnka');
    assert.deepEqual(
        d.beh?.energia.map((c) => [c.tone, c.wh]),
        [
            ['slnko', 4500],
            ['siet', 1800],
            ['vt', 900],
        ],
    );
    assert.equal(d.behy.length, 2);
    assert.equal(d.behy[0].cas, 'dnes 12:00');
    assert.equal(d.behy[1].cas, 'včera 13:00');
    assert.equal(d.behy[1].km, '30 km');
    assert.match(d.behy[1].sr, /6,0 kWh zo siete/);
    assert.deepEqual(d.slnkoDnes, { l: 'Slnko by dnes dalo', v: '~80 km · 13,4 kWh' });
    assert.equal(d.tyzden.v, '~20 km · ušetrené ≈ 0,72 €', '4,5 kWh zo slnka, 2,7 kWh v VT po 0,2 a 1,8 kWh v NT po 0,1');
    assert.ok(d.os.krivka?.startsWith('M0 40'));
    assert.equal(d.os.teraz, 54.17);
    assert.ok(d.os.useky.some((u) => u.tone === 'vt'));
    assert.ok(d.os.useky.every((u) => u.left >= 0 && u.left + u.width <= 100.01));
    assert.match(d.poznamka, /nad 4,1 kW/);
});

test('panel Auto po nabíjaní a bez behov', () => {
    const now = new Date(T0 + 3 * 60 * MIN);
    const hotovy = { ...BEH, k: T0 };
    const d = autoDetail({ at: T0 + 3 * 60 * MIN, behy: [hotovy] }, { now, tz: TZ, tariff: null, slnko: null, vyroba: null });
    assert.equal(d.nabija, false);
    assert.equal(d.pod, 'Nenabíja sa · naposledy dnes 13:00');
    assert.equal(d.beh?.kedy, '12:00 – 13:00');
    assert.deepEqual(
        d.beh?.energia.map((c) => c.tone),
        ['slnko', 'siet'],
    );
    assert.equal(d.os.krivka, null);
    assert.equal(d.slnkoDnes, null);
    assert.equal(d.tyzden.v, '~20 km', 'bez tarify bez úspory');
    const prazdny = autoDetail({ at: T0, behy: [] }, { now, tz: TZ, tariff: null, slnko: null, vyroba: [0, 0] });
    assert.equal(prazdny.pod, 'Nenabíja sa');
    assert.equal(prazdny.beh, null);
    assert.equal(prazdny.os.krivka, null);
    const stary = autoDetail(
        { at: T0, behy: [{ ...BEH, m: T0 - 3 * 24 * 60 * MIN, k: T0 - 3 * 24 * 60 * MIN + 60 * MIN }] },
        { now, tz: TZ, tariff: null, slnko: null, vyroba: null },
    );
    assert.equal(stary.pod, 'Nenabíja sa · naposledy So 14:00');
    const bezMerania = autoDetail({ at: T0 - 60 * MIN, behy: [BEH] }, { now, tz: TZ, tariff: null, slnko: null, vyroba: null });
    assert.equal(bezMerania.nabija, false, 'otvorený beh bez meraní sa neukáže ako nabíjanie');
    assert.equal(bezMerania.beh, null);
});

test('texty oznámení o nabíjaní', () => {
    assert.deepEqual(autoZmenaText({ zacal: true, beh: BEH, slnkoKw: 3.6 }, TZ), {
        title: 'Auto sa asi nabíja',
        body: 'Od 12:00, ≈ 7,2 kW. Slnko teraz dáva asi 50 %.',
    });
    assert.match(autoZmenaText({ zacal: true, beh: BEH, slnkoKw: 7.2 }, TZ).body, /Celé teraz zo slnka/);
    assert.match(autoZmenaText({ zacal: true, beh: BEH, slnkoKw: 0 }, TZ).body, /Teraz zo siete/);
    assert.match(autoZmenaText({ zacal: true, beh: { ...BEH, kw: 0 }, slnkoKw: 0 }, TZ).body, /Teraz zo siete/);
    assert.deepEqual(autoZmenaText({ zacal: false, beh: { ...BEH, k: T0 }, slnkoKw: 0 }, TZ), {
        title: 'Auto sa prestalo nabíjať',
        body: 'Asi je nabité. 12:00 – 13:00, 7,2 kWh ≈ 40 km, 63 % zo slnka.',
    });
    assert.equal(
        autoZmenaText({ zacal: false, beh: { ...BEH, k: T0, wh: 0, whSiet: 0 }, slnkoKw: 0 }, TZ).body,
        'Asi je nabité. 12:00 – 13:00, 0,0 kWh, 0 % zo slnka.',
    );
});
