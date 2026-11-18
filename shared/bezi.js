// Spotrebič beží (docs/navrhy/teraz-bezi-spotrebic.html, A + 1): zápisy „Zapol som“ z detailu spotrebiča
// na karte Teraz. Zápis je deň, spotrebič a minúta dňa, keď ho človek zapol; platí len v ten deň.
// Plán dňa z neho vie, čo už beží alebo dobehlo (shared/plan-dna.js). Overiť to appka nevie - je to na
// slovo. Čisté funkcie, úložisko rieši web/storage.js a čas prichádza v parametroch.

import { BEZI } from './config.js';
import { isObj } from './valid.js';

/** Zápis: miestny dátum `d` (YYYY-MM-DD), spotrebič `id` (z BEZI.veci) a minúta dňa `m`, keď ho človek zapol. @typedef {{ id: string, d: string, m: number }} Zapis */

const DATUM = /^\d{4}-\d{2}-\d{2}$/;
const DEN_MIN = 24 * 60;

/** Dá sa spotrebič zapísať? @param {string} id */
export const daSaZapisat = (id) => BEZI.veci.includes(id);

/**
 * Zápisy z úložiska. Dáta odtiaľ sú nedôveryhodné: čo nesedí, vypadne, zvyšok ostane. Spotrebič má v jeden
 * deň najviac jeden zápis, platí posledný.
 * @param {unknown} raw @returns {Zapis[]}
 */
export function parseBezi(raw) {
    if (!Array.isArray(raw)) return [];
    /** @type {Zapis[]} */ const out = [];
    for (const x of raw) {
        if (!isObj(x)) continue;
        const { id, d, m } = /** @type {Record<string, unknown>} */ (x);
        if (typeof id !== 'string' || !daSaZapisat(id) || typeof d !== 'string' || !DATUM.test(d)) continue;
        if (!Number.isInteger(m) || /** @type {number} */ (m) < 0 || /** @type {number} */ (m) >= DEN_MIN) continue;
        const i = out.findIndex((z) => z.id === id && z.d === d);
        if (i >= 0) out.splice(i, 1);
        out.push({ id, d, m: /** @type {number} */ (m) });
    }
    return out;
}

/** Zápis spotrebiča `id` v deň `d`, alebo null. @param {Zapis[]} list @param {string} id @param {string} d */
export const zapisVeci = (list, id, d) => list.find((z) => z.id === id && z.d === d) ?? null;

/**
 * „Zapol som“: spotrebič `id` zapnutý v deň `d` o minúte `m`. Starší zápis toho spotrebiča v ten deň nahradí
 * a zápisy iných dní zahodí - už nič neznamenajú. Vracia nový zoznam.
 * @param {Zapis[]} list @param {string} id @param {string} d @param {number} m
 */
export function zapol(list, id, d, m) {
    return [...list.filter((z) => z.d === d && z.id !== id), { id, d, m }];
}

/** „Nebeží“: zápis spotrebiča `id` v deň `d` zmizne. @param {Zapis[]} list @param {string} id @param {string} d */
export function zrus(list, id, d) {
    return list.filter((z) => !(z.id === id && z.d === d));
}

/**
 * − či +: čas zapnutia spotrebiča `id` v deň `d` o BEZI.posunMin skôr (`smer` -1) či neskôr (1). Nikdy nie
 * pred polnoc ani po teraz (`nowMin`) - zapol ho, nie zapne. Bez zápisu zoznam nezmení.
 * @param {Zapis[]} list @param {string} id @param {string} d @param {-1 | 1} smer @param {number} nowMin
 */
export function posun(list, id, d, smer, nowMin) {
    return list.map((z) => (z.id === id && z.d === d ? { ...z, m: Math.max(0, Math.min(nowMin, z.m + smer * BEZI.posunMin)) } : z));
}
