// „Pustil/a som“ v karte Môžem?: zápisy spustení spotrebičov na tomto telefóne. Čo, kedy a či
// to bolo na slnku. Z nich karta ukáže „beží“ a mesačný súčet, neskôr súhrn na zdieľanie.
// Čisté funkcie - úložisko rieši web/settings-store.js.

import { LAUNCH, MOZEM_ITEMS } from './config.js';

/**
 * Jedno spustenie: miestny dátum, vec (id z MOZEM_ITEMS), minúta dňa a či svietilo slnko.
 * @typedef {{ d: string, id: string, m: number, sun: boolean }} Launch
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Veci, ktoré sa dajú spustiť - spotrebiče, nie hranie či fén. */
const LOGGABLE = new Set(MOZEM_ITEMS.filter((i) => i.device).map((i) => i.id));

/** Dá sa vec zapisovať? @param {string} id */
export const canLog = (id) => LOGGABLE.has(id);

/** Ako dlho vec po spustení beží (min). @param {string} id */
export function runMinOf(id) {
    const item = MOZEM_ITEMS.find((i) => i.id === id);
    return (item && item.runMin) || LAUNCH.autoRunMin;
}

/**
 * Zápisy z úložiska. Dáta odtiaľ sú nedôveryhodné: čo nesedí, vypadne, zvyšok ostane. Drží sa
 * najviac LAUNCH.limit posledných.
 * @param {unknown} raw @returns {Launch[]}
 */
export function parseLaunches(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter(
            (x) =>
                !!x &&
                typeof x === 'object' &&
                typeof x.d === 'string' &&
                DATE_RE.test(x.d) &&
                typeof x.id === 'string' &&
                canLog(x.id) &&
                Number.isInteger(x.m) &&
                x.m >= 0 &&
                x.m < 1440 &&
                typeof x.sun === 'boolean',
        )
        .map((x) => ({ d: x.d, id: x.id, m: x.m, sun: x.sun }))
        .slice(-LAUNCH.limit);
}

/**
 * Posledné spustenie veci, ktoré ešte beží, alebo null.
 * @param {Launch[]} list @param {string} id @param {string} today @param {number} nowMin
 */
export function runningLaunch(list, id, today, nowMin) {
    for (let i = list.length - 1; i >= 0; i--) {
        const x = list[i];
        if (x.id !== id || x.d !== today) continue;
        return nowMin >= x.m && nowMin < x.m + runMinOf(id) ? x : null;
    }
    return null;
}

/**
 * Ťuknutie na „Pustil/a som“: kým vec beží, druhé ťuknutie zápis zruší (preklep), inak pribudne
 * nový. Vracia nový zoznam, pôvodný sa nemení.
 * @param {Launch[]} list @param {Launch} entry
 */
export function toggleLaunch(list, entry) {
    const running = runningLaunch(list, entry.id, entry.d, entry.m);
    if (running) return list.filter((x) => x !== running);
    return [...list, entry].slice(-LAUNCH.limit);
}

/**
 * Spustenia v mesiaci: všetky a z nich na slnku.
 * @param {Launch[]} list @param {string} month `YYYY-MM`
 */
export function monthCount(list, month) {
    const inMonth = list.filter((x) => x.d.startsWith(`${month}-`));
    return { all: inMonth.length, sun: inMonth.filter((x) => x.sun).length };
}
