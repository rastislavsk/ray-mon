// Teplota vody v bojleri (docs/navrhy/bojler-teplota.html, T1 + P1): zásuvka ju číta z teplomera Shelly v domácej
// sieti a posiela s každým hlásením. Worker si drží body (pridajTeplotu) a appke dá dnešné (teplotyDna); appka z nich
// kreslí krivku v paneli Bojler dnes (krivkaVody). Čisté funkcie - čas a dáta dostanú.

import { BOJLER } from './config.js';
import { fmt1 } from './format.js';
import { localDateKey, localMinutes } from './solar.js';

const MIN = 60 * 1000;

/**
 * Body teploty vo Workeri: [minúta od 1970, teplota v desatinách °C].
 * @typedef {Array<[number, number]>} BodyVody
 */

/**
 * Teplota od zásuvky, alebo null: len číslo, ktoré môže voda v bojleri mať (snímač bez spojenia hlási nezmysly).
 * Zaokrúhlená na desatiny.
 * @param {unknown} t @returns {number | null}
 */
export function teplotaZ(t) {
    if (typeof t !== 'number' || !Number.isFinite(t) || t < -20 || t > 110) return null;
    return Math.round(t * 10) / 10;
}

/**
 * Body s novou teplotou: bod pribudne, len keď od posledného prešlo aspoň BOJLER.vodaKrokMin minút. Staršie ako
 * BOJLER.vodaDni dní odpadnú. Keď nepribudlo nič, vráti to isté pole - Worker potom nič nezapisuje.
 * @param {BodyVody} body @param {number | null} t @param {number} nowMs @returns {BodyVody}
 */
export function pridajTeplotu(body, t, nowMs) {
    const min = Math.floor(nowMs / MIN);
    const posledny = body[body.length - 1];
    if (t === null || (posledny && min - posledny[0] < BOJLER.vodaKrokMin)) return body;
    const od = min - BOJLER.vodaDni * 24 * 60;
    return [...body.filter(([m]) => m > od), [min, Math.round(t * 10)]];
}

/**
 * Dnešné body pre appku: [minúta dňa, °C].
 * @param {BodyVody} body @param {Date} now @param {string} tz @returns {Array<[number, number]>}
 */
export function teplotyDna(body, now, tz) {
    const dnes = localDateKey(now, tz);
    return body
        .map(([m, t]) => ({ d: new Date(m * MIN), t: t / 10 }))
        .filter((b) => localDateKey(b.d, tz) === dnes)
        .map((b) => [localMinutes(b.d, tz), b.t]);
}

/**
 * Posledná teplota, keď nie je staršia ako BOJLER.tichoMin (inak zásuvka teplomer nečíta), alebo null.
 * @param {{ voda?: { t: number, at: number } | null }} b @param {number} nowMs
 */
export const vodaTeraz = (b, nowMs) => (b.voda && nowMs - b.voda.at <= BOJLER.tichoMin * MIN ? b.voda : null);

/** Teplota ako „68 °C“. @param {number} t */
export const stupne = (t) => `${Math.round(t)} °C`;

/**
 * Hranica teploty (docs/navrhy/bojler-hranica.html): celé °C od BOJLER.vodaMinC do BOJLER.vodaMaxC, inak null (nie je).
 * @param {unknown} h @returns {number | null}
 */
export const hranicaZ = (h) => (typeof h === 'number' && Number.isInteger(h) && h >= BOJLER.vodaMinC && h <= BOJLER.vodaMaxC ? h : null);

/**
 * Hranica o krok vyššie (`smer` 1) či nižšie (-1): z vypnutej nahor BOJLER.vodaStartC, pod BOJLER.vodaMinC vypnutá.
 * @param {number | null} h @param {1 | -1} smer @returns {number | null}
 */
export function posunHranicu(h, smer) {
    if (h === null) return smer > 0 ? BOJLER.vodaStartC : null;
    if (smer < 0 && h <= BOJLER.vodaMinC) return null;
    return Math.min(BOJLER.vodaMaxC, h + smer);
}

/**
 * Stráženie hranice: je voda nahriata na hranicu? Od hranice áno, kým neklesne na hranicu mínus BOJLER.vodaHystC; medzi
 * tým ostáva, ako bolo (`nad`). Bez hranice či bez teploty (teplomer mlčí) nie - vtedy stráži len termostat. To isté
 * pravidlo má skript zásuvky (shared/bojler-skript.js), aby strážil aj bez Workera.
 * @param {boolean} nad @param {number | null} t @param {number | null} hranica
 */
export function strazVodu(nad, t, hranica) {
    if (hranica === null || t === null) return false;
    if (t >= hranica) return true;
    return t > hranica - BOJLER.vodaHystC && nad;
}

// Krivka: šírka = minúty dňa / 5, výška v jednotkách viewBoxu; medzera dlhšia ako MEDZERA_MIN preruší čiaru.
const W = 288;
const H = 96;
const MEDZERA_MIN = 20;

/**
 * Krivka teploty dnes v paneli Bojler dnes (P1): úseky čiary a plochy pod ňou vo viewBoxe W × H, čiara hranice
 * (`hranica`, bez nej nie je), bod teraz s teplotou a veta pre čítačku. Os hodín pod ňou kreslí pás behov (rovnaká šírka dňa). Menej ako dva body null.
 * @param {Array<[number, number]>} teploty [minúta dňa, °C] @param {number | null} hranica
 */
export function krivkaVody(teploty, hranica) {
    if (teploty.length < 2) return null;
    const hodnoty = teploty.map(([, t]) => t);
    const dole = Math.min(30, Math.floor((Math.min(...hodnoty) - 2) / 5) * 5);
    const hore = Math.max(70, Math.ceil((Math.max(...hodnoty) + 2) / 5) * 5);
    const x = (/** @type {number} */ m) => Math.round((m / (24 * 60)) * W * 10) / 10;
    const y = (/** @type {number} */ t) => Math.round(((hore - t) / (hore - dole)) * H * 10) / 10;
    /** @type {Array<Array<[number, number]>>} */ const useky = [];
    teploty.forEach((b, i) => {
        if (i === 0 || b[0] - teploty[i - 1][0] > MEDZERA_MIN) useky.push([b]);
        else useky[useky.length - 1].push(b);
    });
    const ciara = (/** @type {Array<[number, number]>} */ u) => u.map(([m, t], i) => `${i ? 'L' : 'M'}${x(m)} ${y(t)}`).join('');
    const [mPosl, tPosl] = teploty[teploty.length - 1];
    return {
        w: W,
        h: H,
        ciary: useky.map(ciara),
        plochy: useky.map((u) => `${ciara(u)}L${x(u[u.length - 1][0])} ${H}L${x(u[0][0])} ${H}Z`),
        ciel: hranica !== null && hranica > dole && hranica < hore ? { y: y(hranica), text: `hranica ${stupne(hranica)}` } : null,
        bod: { x: x(mPosl), y: y(tPosl), text: stupne(tPosl) },
        popis: `Teplota vody dnes od ${fmt1(Math.min(...hodnoty))} do ${fmt1(Math.max(...hodnoty))} °C, naposledy ${fmt1(tPosl)} °C.`,
    };
}
