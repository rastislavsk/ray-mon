// Hviezdy v noci na karte Teraz: kde na východnej oblohe nad elektrárňou v danej chvíli stoja najjasnejšie
// hviezdy (shared/hviezdy-data.js) a ktoré z nich oblaky a mesiac nechajú vidieť. Čisté funkcie, čas aj poloha prichádzajú v parametroch.

import { HVIEZDY } from './config.js';
import { HVIEZDY_DATA } from './hviezdy-data.js';

/** @typedef {{ x: number, y: number, mag: number }} Hviezda poloha v poli HVIEZDY (sirka × vyska, y nadol) */

const toRad = (/** @type {number} */ deg) => (deg * Math.PI) / 180;
const toDeg = (/** @type {number} */ rad) => (rad * 180) / Math.PI;

/** Juliánsky deň 2451545,0 (1. 1. 2000 12:00 UTC), od neho sa počíta hviezdny čas. */
const J2000_MS = Date.UTC(2000, 0, 1, 12);

/**
 * Miestny hviezdny čas v stupňoch (0-360): stredný greenwichský (IAU 1982, bez nutácie - na
 * kresbu stačí) posunutý o zemepisnú dĺžku. @param {Date} date @param {number} lonDeg
 */
export function hviezdnyCas(date, lonDeg) {
    const d = (date.getTime() - J2000_MS) / 86400000;
    const lst = (280.46061837 + 360.98564736629 * d + lonDeg) % 360;
    return lst < 0 ? lst + 360 : lst;
}

/**
 * Výška nad obzorom a azimut (od severu cez východ) hviezdy na rektascenzii a deklinácii
 * `raDeg`, `decDeg` pri miestnom hviezdnom čase `lstDeg` a zemepisnej šírke `latDeg`.
 * @param {number} raDeg @param {number} decDeg @param {number} lstDeg @param {number} latDeg
 * @returns {{ vyska: number, azimut: number }}
 */
export function naOblohe(raDeg, decDeg, lstDeg, latDeg) {
    const h = toRad(lstDeg - raDeg);
    const dec = toRad(decDeg);
    const lat = toRad(latDeg);
    const sinAlt = Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(h);
    const az = Math.atan2(-Math.cos(dec) * Math.sin(h), Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(h));
    return { vyska: toDeg(Math.asin(sinAlt)), azimut: (toDeg(az) + 360) % 360 };
}

/**
 * Najslabšia hviezda, ktorú vidno: oblaky a osvetlená časť mesiaca hranicu znižujú.
 * @param {number} oblacnost % @param {number} mesiac fáza 0-1 (0 nov, 0,5 spln)
 */
export function hranicaJasu(oblacnost, mesiac) {
    const osvetlene = (1 - Math.cos(2 * Math.PI * mesiac)) / 2;
    return HVIEZDY.magMax - (HVIEZDY.oblakyMag * oblacnost) / 100 - HVIEZDY.splnMag * osvetlene;
}

/**
 * Stereografické premietanie do poľa pohľadu na východ (`HVIEZDY.smer`): súhvezdia majú svoj tvar,
 * len k okrajom poľa rastú. Vľavo je sever, vpravo juh, na oboch pologuliach.
 * @param {number} vyska @param {number} azimut @returns {{ x: number, y: number }}
 */
export function premietni(vyska, azimut) {
    const sin0 = Math.sin(toRad(HVIEZDY.vyskaStredu));
    const cos0 = Math.cos(toRad(HVIEZDY.vyskaStredu));
    const alt = toRad(vyska);
    const daz = toRad(azimut - HVIEZDY.smer);
    const k = toDeg(2 / (1 + sin0 * Math.sin(alt) + cos0 * Math.cos(alt) * Math.cos(daz)));
    return {
        x: HVIEZDY.sirka / 2 + k * Math.cos(alt) * Math.sin(daz),
        y: HVIEZDY.vyska * HVIEZDY.stredY - k * (cos0 * Math.sin(alt) - sin0 * Math.cos(alt) * Math.cos(daz)),
    };
}

/**
 * Hviezdy v poli pohľadu nad miestom `lat`, `lon` v chvíli `chvila`, len tie, ktoré oblačnosť
 * `oblacnost` (%) a mesiac nechajú vidieť. Mesiac pod obzorom oblohu nerozjasní, volajúci vtedy
 * pošle `mesiac` 0.
 * @param {{ chvila: Date, lat: number, lon: number, oblacnost: number, mesiac: number }} vstup
 * @returns {Hviezda[]}
 */
export function hviezdy({ chvila, lat, lon, oblacnost, mesiac }) {
    const lst = hviezdnyCas(chvila, lon);
    const limit = hranicaJasu(oblacnost, mesiac);
    /** @type {Hviezda[]} */ const out = [];
    for (let i = 0; i < HVIEZDY_DATA.length; i += 3) {
        const mag = HVIEZDY_DATA[i + 2];
        if (mag > limit) continue;
        const { vyska, azimut } = naOblohe(HVIEZDY_DATA[i], HVIEZDY_DATA[i + 1], lst, lat);
        if (vyska < HVIEZDY.minVyska) continue;
        const { x, y } = premietni(vyska, azimut);
        if (x < 0 || x > HVIEZDY.sirka || y < 0 || y > HVIEZDY.vyska) continue;
        out.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, mag });
    }
    return out;
}
