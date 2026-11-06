import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HVIEZDY, SITE } from '../shared/config.js';
import { premietni } from '../shared/hviezdy.js';
import { mesiacFaza, mesiacNaOblohe, mesiacVPoli } from '../shared/mesiac.js';

const RIO = { lat: -22.91, lon: -43.17 };

// Výška, azimut a fáza z knižnice astronomy-engine (nezávislý výpočet), SITE a Rio de Janeiro.
const REFERENCIA = [
    { iso: '2026-11-24T19:30:00Z', miesto: SITE, vyska: 45.97, azimut: 103.5, faza: 0.5075 },
    { iso: '2026-11-07T04:30:00Z', miesto: SITE, vyska: 5.96, azimut: 116.4, faza: 0.9322 },
    { iso: '2027-01-13T16:30:00Z', miesto: SITE, vyska: 38.99, azimut: 209.22, faza: 0.1785 },
    { iso: '2027-06-20T22:00:00Z', miesto: SITE, vyska: 10.28, azimut: 147.59, faza: 0.5577 },
    { iso: '2027-01-13T16:30:00Z', miesto: RIO, vyska: 43.78, azimut: 62.28, faza: 0.1785 },
    { iso: '2027-06-20T22:00:00Z', miesto: RIO, vyska: 2.76, azimut: 114.37, faza: 0.5577 },
];

test('mesiacNaOblohe: poloha a fáza do pol stupňa od nezávislého výpočtu', () => {
    for (const r of REFERENCIA) {
        const m = mesiacNaOblohe(new Date(r.iso), r.miesto.lat, r.miesto.lon);
        assert.ok(Math.abs(m.vyska - r.vyska) < 0.5, `${r.iso} výška ${m.vyska}, má byť ${r.vyska}`);
        assert.ok(
            Math.abs(m.azimut - r.azimut) < 0.5 / Math.cos((r.vyska * Math.PI) / 180),
            `${r.iso} azimut ${m.azimut}, má byť ${r.azimut}`,
        );
        assert.ok(Math.abs(m.faza - r.faza) < 0.002, `${r.iso} fáza ${m.faza}, má byť ${r.faza}`);
    }
});

test('mesiacFaza: nov, spln a štvrte v skutočných chvíľach', () => {
    /** Vzdialenosť od cieľa po kružnici fáz. @param {string} iso @param {number} ciel */
    const odchylka = (iso, ciel) => Math.abs(((mesiacFaza(new Date(iso)) - ciel + 1.5) % 1) - 0.5);
    assert.ok(odchylka('2026-11-09T07:02:42Z', 0) < 0.002);
    assert.ok(odchylka('2026-11-24T14:54:04Z', 0.5) < 0.002);
    assert.ok(odchylka('2027-01-15T20:35:05Z', 0.25) < 0.002);
    assert.ok(odchylka('2027-01-29T10:56:06Z', 0.75) < 0.002);
});

test('mesiacNaOblohe: osvetlená strana ukazuje k Slnku', () => {
    // Ráno pred východom Slnka je Slnko pod obzorom vľavo od Mesiaca: dole vľavo, 90-180° od zvislice.
    const rano = mesiacNaOblohe(new Date('2026-11-07T04:30:00Z'), SITE.lat, SITE.lon);
    assert.ok(rano.uhol > 90 && rano.uhol < 180, `ráno ${rano.uhol}`);
    // Večer po západe je Slnko vpravo od Mesiaca: dole vpravo, 180-270°.
    const vecer = mesiacNaOblohe(new Date('2027-01-13T16:30:00Z'), SITE.lat, SITE.lon);
    assert.ok(vecer.uhol > 180 && vecer.uhol < 270, `večer ${vecer.uhol}`);
});

test('mesiacVPoli: v poli je tam, kam ho dá premietanie hviezd, mimo neho nie je', () => {
    const m = { vyska: 30, azimut: 100, faza: 0.5, uhol: 200 };
    const p = premietni(30, 100);
    const v = mesiacVPoli(m);
    assert.ok(v && Math.abs(v.x - p.x) < 0.06 && Math.abs(v.y - p.y) < 0.06);
    assert.equal(v?.faza, 0.5);
    assert.equal(v?.uhol, 200);
    // Na západe je za chrbtom, vysoko na juhozápade nad horným okrajom.
    assert.equal(mesiacVPoli({ ...m, azimut: 280 }), null);
    assert.equal(mesiacVPoli({ ...m, vyska: 60, azimut: 230 }), null);
});

test('mesiacVPoli: za textom karty je stlmený, inde nie', () => {
    /** Mesiac s polohou v poli (x, y), azimut a výška z obráteného hľadania. @param {number} x @param {number} y */
    function na(x, y) {
        for (let vyska = 3; vyska < 88; vyska += 0.25) {
            for (let azimut = 0; azimut < 220; azimut += 0.25) {
                const p = premietni(vyska, azimut);
                if (Math.abs(p.x - x) < 1 && Math.abs(p.y - y) < 1) return { vyska, azimut, faza: 0.5, uhol: 0 };
            }
        }
        throw new Error('bod mimo oblohy');
    }
    assert.equal(mesiacVPoli(na(60, 60))?.stlmeny, true, 'za číslom');
    assert.equal(mesiacVPoli(na(100, 100))?.stlmeny, true, 'za riadkom stavu');
    assert.equal(mesiacVPoli(na(130, 60))?.stlmeny, false, 'vpravo od čísla');
    assert.ok(HVIEZDY.text.length > 0);
});
