// Mesiac: kde naozaj stojí a v akej je fáze. Nízkopresný výpočet zo skrátených radov Astronomical
// Almanac (poloha do 0,4°, fáza do hodiny, overené voči astronomy-engine na rokoch 2026-2035).
// Čisté funkcie, čas aj poloha prichádzajú v parametroch.

import { HVIEZDY } from './config.js';
import { hviezdnyCas, naOblohe, premietni } from './hviezdy.js';

/** Sklon ekliptiky v stupňoch. */
const EKLIPTIKA = 23.44;
const sin = (/** @type {number} */ deg) => Math.sin((deg * Math.PI) / 180);
const cos = (/** @type {number} */ deg) => Math.cos((deg * Math.PI) / 180);
const stupne = (/** @type {number} */ rad) => (rad * 180) / Math.PI;
const do360 = (/** @type {number} */ deg) => ((deg % 360) + 360) % 360;

/** Z dĺžky a šírky na ekliptike na rovníkové súradnice. @param {number} l @param {number} b */
function rovnikove(l, b) {
    const ra = stupne(Math.atan2(sin(l) * cos(EKLIPTIKA) - (sin(b) / cos(b)) * sin(EKLIPTIKA), cos(l)));
    return { ra: do360(ra), dec: stupne(Math.asin(sin(b) * cos(EKLIPTIKA) + cos(b) * sin(EKLIPTIKA) * sin(l))) };
}

/** Ekliptické dĺžky Mesiaca a Slnka, šírka a paralaxa Mesiaca v stupňoch. @param {Date} date */
function efemerida(date) {
    const T = (date.getTime() - Date.UTC(2000, 0, 1, 12)) / 86400000 / 36525;
    const a = 135.0 + 477198.87 * T;
    const b = 259.3 - 413335.36 * T;
    const c = 235.7 + 890534.22 * T;
    const d = 269.9 + 954397.74 * T;
    const g = 357.5 + 35999.05 * T;
    return {
        dlzka:
            218.32 +
            481267.881 * T +
            6.29 * sin(a) -
            1.27 * sin(b) +
            0.66 * sin(c) +
            0.21 * sin(d) -
            0.19 * sin(g) -
            0.11 * sin(186.5 + 966404.03 * T),
        sirka:
            5.13 * sin(93.3 + 483202.02 * T) +
            0.28 * sin(228.2 + 960400.89 * T) -
            0.28 * sin(318.3 + 6003.15 * T) -
            0.17 * sin(217.6 - 407332.21 * T),
        paralaxa: 0.9508 + 0.0518 * cos(a) + 0.0095 * cos(b) + 0.0078 * cos(c) + 0.0028 * cos(d),
        slnko: 280.46 + 36000.77 * T + 1.915 * sin(g) + 0.02 * sin(2 * g),
    };
}

/** @param {{ dlzka: number, slnko: number }} e */
const fazaZ = (e) => do360(e.dlzka - e.slnko) / 360;

/**
 * Fáza Mesiaca 0-1 (0 nov, 0,25 prvá štvrť, 0,5 spln, 0,75 posledná štvrť): uhol medzi Mesiacom a
 * Slnkom na ekliptike. @param {Date} date
 */
export const mesiacFaza = (date) => fazaZ(efemerida(date));

/**
 * Kde je Mesiac nad miestom `lat`, `lon`: výška nad obzorom (s paralaxou, pri obzore skoro 1°),
 * azimut od severu cez východ a fáza. `uhol` hovorí, kam ukazuje osvetlená strana: stupne proti
 * smeru hodinových ručičiek od zvislice, teda k Slnku.
 * @param {Date} date @param {number} lat @param {number} lon
 * @returns {{ vyska: number, azimut: number, faza: number, uhol: number }}
 */
export function mesiacNaOblohe(date, lat, lon) {
    const e = efemerida(date);
    const m = rovnikove(e.dlzka, e.sirka);
    const s = rovnikove(e.slnko, 0);
    const lst = hviezdnyCas(date, lon);
    const { vyska, azimut } = naOblohe(m.ra, m.dec, lst, lat);
    const kSlnku = stupne(Math.atan2(cos(s.dec) * sin(s.ra - m.ra), sin(s.dec) * cos(m.dec) - cos(s.dec) * sin(m.dec) * cos(s.ra - m.ra)));
    const h = lst - m.ra;
    const zvislica = stupne(Math.atan2(sin(h), (sin(lat) / cos(lat)) * cos(m.dec) - sin(m.dec) * cos(h)));
    return { vyska: vyska - e.paralaxa * cos(vyska), azimut, faza: fazaZ(e), uhol: do360(kSlnku - zvislica) };
}

/** @typedef {{ x: number, y: number, faza: number, uhol: number, stlmeny: boolean }} MesiacVPoli */

/**
 * Mesiac v poli pohľadu rovnakým premietaním ako hviezdy. Null, keď je mimo poľa - appka ho vtedy
 * nekreslí. `stlmeny` je Mesiac za textom karty (HVIEZDY.text), ktorý by inak zhoršil čitateľnosť.
 * @param {{ vyska: number, azimut: number, faza: number, uhol: number }} m Mesiac nad obzorom
 * @returns {MesiacVPoli | null}
 */
export function mesiacVPoli({ vyska, azimut, faza, uhol }) {
    const { x, y } = premietni(vyska, azimut);
    const r = HVIEZDY.mesiacR;
    if (x < 0 || x > HVIEZDY.sirka || y < -r) return null;
    return {
        x: Math.round(x * 10) / 10,
        y: Math.round(y * 10) / 10,
        faza,
        uhol: Math.round(uhol),
        stlmeny: HVIEZDY.text.some((t) => x - r < t.x && y + r > t.od && y - r < t.po),
    };
}
