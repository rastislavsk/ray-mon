// Spotrebič beží (docs/navrhy/teraz-bezi-spotrebic.html, A + 1; docs/navrhy/spotrebic-koniec-opakovanie.html):
// zápisy „Už beží“ z detailu spotrebiča na karte Teraz. Zápis je jeden beh: deň, spotrebič, minúta dňa
// začiatku a konca. Spotrebič môže mať za deň viac behov, beží však vždy najviac jeden. Práčke a sušičke
// človek povie, koľko programu zostáva (BEZI.zvysok), umývačke, kedy ju zapol. Platí len v ten deň.
// Plán dňa z neho vie, čo už beží alebo dobehlo (shared/plan-dna.js). Overiť to appka nevie - je to na
// slovo. Čisté funkcie, úložisko rieši web/storage.js a čas prichádza v parametroch.

import { BEZI, MOZEM_ITEMS } from './config.js';
import { isObj } from './valid.js';

/**
 * Beh: miestny dátum `d` (YYYY-MM-DD), spotrebič `id` (z BEZI.veci), minúta dňa `m`, keď ho človek zapol,
 * a `k`, keď skončí (po polnoci viac než 24 h).
 * @typedef {{ id: string, d: string, m: number, k: number }} Zapis
 */

const DATUM = /^\d{4}-\d{2}-\d{2}$/;
const DEN_MIN = 24 * 60;

/** Dá sa spotrebič zapísať? @param {string} id */
export const daSaZapisat = (id) => BEZI.veci.includes(id);

/** Pýta sa appka pri spotrebiči na zvyšok programu (inak na čas zapnutia)? @param {string} id */
export const zoZvysku = (id) => BEZI.zvysok.includes(id);

/** Dĺžka programu spotrebiča v minútach (MOZEM_ITEMS). @param {string} id */
const dlzka = (id) => MOZEM_ITEMS.find((i) => i.id === id)?.runMin ?? 0;

/** Celé číslo v rozsahu. @param {unknown} x @param {number} od @param {number} po @returns {x is number} */
const cele = (x, od, po) => Number.isInteger(x) && /** @type {number} */ (x) >= od && /** @type {number} */ (x) <= po;

/**
 * Behy z úložiska. Dáta odtiaľ sú nedôveryhodné: čo nesedí, vypadne, zvyšok ostane. Zápis bez konca (zo
 * staršej appky) skončí po dĺžke programu. Ten istý spotrebič s tým istým začiatkom v ten istý deň je jeden beh,
 * platí posledný. Vráti ich podľa dňa a začiatku.
 * @param {unknown} raw @returns {Zapis[]}
 */
export function parseBezi(raw) {
    if (!Array.isArray(raw)) return [];
    /** @type {Zapis[]} */ const out = [];
    for (const x of raw) {
        if (!isObj(x)) continue;
        const { id, d, m, k } = /** @type {Record<string, unknown>} */ (x);
        if (typeof id !== 'string' || !daSaZapisat(id) || typeof d !== 'string' || !DATUM.test(d) || !cele(m, 0, DEN_MIN - 1)) continue;
        const koniec = k === undefined ? m + dlzka(id) : k;
        if (!cele(koniec, m + 1, m + DEN_MIN)) continue;
        const i = out.findIndex((z) => z.id === id && z.d === d && z.m === m);
        if (i >= 0) out.splice(i, 1);
        out.push({ id, d, m, k: koniec });
    }
    return out.sort((a, b) => (a.d === b.d ? a.m - b.m : a.d < b.d ? -1 : 1));
}

/** Beh spotrebiča `id` v deň `d`, ktorý o minúte `nowMin` ešte beží, alebo null. @param {Zapis[]} list @param {string} id @param {string} d @param {number} nowMin */
export const beziaci = (list, id, d, nowMin) => list.find((z) => z.id === id && z.d === d && nowMin < z.k) ?? null;

/**
 * „Už beží“: spotrebič `id` beží od `nowMin` v deň `d` a skončí po dĺžke programu. Beh, ktorý ešte beží, nahradí,
 * dobehnuté behy dňa nechá a zápisy iných dní zahodí - už nič neznamenajú. Vracia nový zoznam.
 * @param {Zapis[]} list @param {string} id @param {string} d @param {number} nowMin
 */
export function zapol(list, id, d, nowMin) {
    const ostane = list.filter((z) => z.d === d && !(z.id === id && nowMin < z.k));
    return [...ostane, { id, d, m: nowMin, k: nowMin + dlzka(id) }];
}

/** „Nebeží“: beh spotrebiča `id`, ktorý v deň `d` ešte beží, zmizne. @param {Zapis[]} list @param {string} id @param {string} d @param {number} nowMin */
export function zrus(list, id, d, nowMin) {
    return list.filter((z) => !(z.id === id && z.d === d && nowMin < z.k));
}

/**
 * − či + pri umývačke: čas zapnutia bežiaceho behu o BEZI.posunMin skôr (`smer` -1) či neskôr (1), koniec ide s ním.
 * Nikdy nie pred polnoc ani po teraz (`nowMin`) - zapol ho, nie zapne. Bez bežiaceho behu zoznam nezmení.
 * @param {Zapis[]} list @param {string} id @param {string} d @param {-1 | 1} smer @param {number} nowMin
 */
export function posun(list, id, d, smer, nowMin) {
    const b = beziaci(list, id, d, nowMin);
    return list.map((z) => {
        if (z !== b) return z;
        const m = Math.max(0, Math.min(nowMin, z.m + smer * BEZI.posunMin));
        return { ...z, m, k: m + (z.k - z.m) };
    });
}

/**
 * − či + pri práčke a sušičke: zvyšok programu bežiaceho behu o `o` minút (hodina či BEZI.krokMin). Zvyšok ostane
 * medzi BEZI.minZvysokMin a BEZI.maxZvysokMin od teraz. Začiatok je koniec bez dĺžky programu, nie pred polnoc
 * ani po teraz. Bez bežiaceho behu zoznam nezmení.
 * @param {Zapis[]} list @param {string} id @param {string} d @param {number} o @param {number} nowMin
 */
export function zvysok(list, id, d, o, nowMin) {
    const b = beziaci(list, id, d, nowMin);
    return list.map((z) => {
        if (z !== b) return z;
        const k = Math.max(nowMin + BEZI.minZvysokMin, Math.min(nowMin + BEZI.maxZvysokMin, z.k + o));
        return { ...z, k, m: Math.max(0, Math.min(nowMin, k - dlzka(id))) };
    });
}
