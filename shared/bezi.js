// Spotrebič beží (docs/navrhy/teraz-bezi-spotrebic.html, A + 1; docs/navrhy/spotrebic-koniec-opakovanie.html;
// docs/navrhy/spotrebic-cas-nastavenie.html):
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

/** Číslo v rozsahu. @param {number} x @param {number} od @param {number} po */
const medzi = (x, od, po) => Math.max(od, Math.min(po, x));

/**
 * Beh, ktorý by uložilo „Nastaviť“ v detaile spotrebiča (docs/navrhy/spotrebic-cas-nastavenie.html, A + D) v deň `d`
 * o minúte `nowMin`. `min` je to, čo človek nastavil: pri práčke a sušičke zvyšok programu v minútach (od
 * BEZI.minZvysokMin do BEZI.maxZvysokMin, začiatok je koniec bez dĺžky programu), pri umývačke minúta dňa zapnutia
 * (nie pred polnoc ani po teraz - zapol ju, nie zapne; koniec po dĺžke programu, pri bežiacom behu po jeho dĺžke).
 * Bez `min` vráti bežiaci beh, a keď nebeží, beh od teraz po dĺžke programu.
 * @param {Zapis[]} list @param {string} id @param {string} d @param {number} nowMin @param {number | null} [min]
 * @returns {Zapis}
 */
export function navrhBehu(list, id, d, nowMin, min = null) {
    const b = beziaci(list, id, d, nowMin);
    if (zoZvysku(id)) {
        const k = nowMin + medzi(min ?? (b ? b.k - nowMin : dlzka(id)), BEZI.minZvysokMin, BEZI.maxZvysokMin);
        return { id, d, m: medzi(k - dlzka(id), 0, nowMin), k };
    }
    const m = medzi(min ?? (b ? b.m : nowMin), 0, nowMin);
    return { id, d, m, k: m + (b ? b.k - b.m : dlzka(id)) };
}

/**
 * „Nastaviť“: beh spotrebiča `id` podľa navrhBehu - bežiaci nahradí, dobehnuté behy dňa nechá a zápisy iných dní
 * zahodí, už nič neznamenajú. Vracia nový zoznam.
 * @param {Zapis[]} list @param {string} id @param {string} d @param {number} nowMin @param {number | null} min
 */
export function nastav(list, id, d, nowMin, min) {
    const b = beziaci(list, id, d, nowMin);
    return [...list.filter((z) => z.d === d && z !== b), navrhBehu(list, id, d, nowMin, min)];
}

/** „Nebeží“: beh spotrebiča `id`, ktorý v deň `d` ešte beží, zmizne. @param {Zapis[]} list @param {string} id @param {string} d @param {number} nowMin */
export function zrus(list, id, d, nowMin) {
    return list.filter((z) => !(z.id === id && z.d === d && nowMin < z.k));
}

/**
 * „Vrátiť“ v bubline po nastavení: behy spotrebiča `id` v deň `d` budú zas `behy` (tie, ktoré mal pred zmenou).
 * @param {Zapis[]} list @param {string} id @param {string} d @param {Zapis[]} behy
 */
export function vratBehy(list, id, d, behy) {
    return parseBezi([...list.filter((z) => !(z.id === id && z.d === d)), ...behy]);
}

// Spoločné behy telefónov domácnosti (docs/navrhy/bezi-spolocne.html): telefón po zmene pošle Workeru behy toho
// spotrebiča v ten deň (Zmena), Worker ich zapíše do spoločného zoznamu (zapisZmeny) a vráti ho. Telefón ho prevezme
// (prevezmi) okrem spotrebičov, ktorých zmenu Worker ešte nepotvrdil (Caka) - tie ostanú z telefónu a pôjdu znova.

/**
 * Zmena jedného spotrebiča: všetky jeho behy v deň `d` tak, ako ich má telefón.
 * @typedef {{ id: string, d: string, behy: Zapis[] }} Zmena
 */

/** Spotrebič, ktorého zmenu Worker ešte nepotvrdil. @typedef {{ id: string, d: string }} Caka */

/** Behy spotrebiča `id` v deň `d`. @param {Zapis[]} list @param {string} id @param {string} d */
export const behyVeci = (list, id, d) => list.filter((z) => z.id === id && z.d === d);

/** Je to spotrebič a deň, ktoré sa dajú zapísať? @param {unknown} id @param {unknown} d @returns {boolean} */
const vecDna = (id, d) => typeof id === 'string' && daSaZapisat(id) && typeof d === 'string' && DATUM.test(d);

/**
 * Nepotvrdené zmeny z úložiska telefónu; čo nesedí, vypadne, každý spotrebič a deň raz.
 * @param {unknown} raw @returns {Caka[]}
 */
export function parseCaka(raw) {
    if (!Array.isArray(raw)) return [];
    /** @type {Caka[]} */ const out = [];
    for (const x of raw) {
        if (!isObj(x) || !vecDna(x.id, x.d) || out.some((c) => c.id === x.id && c.d === x.d)) continue;
        out.push({ id: /** @type {string} */ (x.id), d: /** @type {string} */ (x.d) });
    }
    return out;
}

/**
 * Worker: zmeny od telefónu (nedôveryhodné) do spoločného zoznamu. Behy spotrebiča v deň zmeny nahradí behmi zo zmeny,
 * dni pred `d` (dnešok telefónu) zahodí. Najviac jedna zmena na spotrebič - viac ich telefón neposiela.
 * @param {unknown} list doterajší spoločný zoznam @param {unknown} zmeny @param {string} d @returns {Zapis[]}
 */
export function zapisZmeny(list, zmeny, d) {
    let out = parseBezi(list);
    for (const z of Array.isArray(zmeny) ? zmeny.slice(0, BEZI.veci.length) : []) {
        if (!isObj(z) || !vecDna(z.id, z.d)) continue;
        const id = /** @type {string} */ (z.id);
        const den = /** @type {string} */ (z.d);
        out = [...out.filter((b) => !(b.id === id && b.d === den)), ...behyVeci(parseBezi(z.behy), id, den)];
    }
    return parseBezi(out.filter((b) => b.d >= d));
}

/**
 * Telefón: spoločné behy dňa `d` od Workera (nedôveryhodné). Spotrebiče, ktorých zmenu Worker ešte nepotvrdil (`caka`),
 * ostanú tak, ako ich má telefón.
 * @param {Zapis[]} lokalne @param {unknown} spolocne @param {Caka[]} caka @param {string} d @returns {Zapis[]}
 */
export function prevezmi(lokalne, spolocne, caka, d) {
    const moje = new Set(caka.filter((c) => c.d === d).map((c) => c.id));
    const zWorkera = parseBezi(spolocne).filter((z) => z.d === d && !moje.has(z.id));
    return parseBezi([...zWorkera, ...lokalne.filter((z) => z.d === d && moje.has(z.id))]);
}
