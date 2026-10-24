// Listovanie dní v detaile dňa karty 7 dní: kam sa pás po pustení prsta presunie, ako sa poddá
// na kraji a ako dlho dobieha. Čisté výpočty bez DOM a hodín - čas aj polohu prsta dostávajú
// ako parametre. Prst, transform a kópie susedných dní má web/day-pager.js, spoločný pre obe appky.

import { DAY_PAGER } from './config.js';

/** @typedef {{ t: number, x: number }} Sample poloha prsta (px) v čase (ms) */

/**
 * Rozhodol pohyb prsta, čo gesto je? `null` = ešte nie (pohyb je pod prahom), inak listovanie
 * dní (`'x'`), alebo scroll po stránke (`'y'`), ktorý patrí prehliadaču.
 * @param {number} dx @param {number} dy
 * @returns {'x' | 'y' | null}
 */
export function pagerAxis(dx, dy) {
    if (Math.hypot(dx, dy) < DAY_PAGER.lockPx) return null;
    return Math.abs(dx) > DAY_PAGER.axisRatio * Math.abs(dy) ? 'x' : 'y';
}

/**
 * Posun pásu za prstom. Kým je kam listovať, ide 1:1; za prvým a posledným dňom sa pás len
 * poddá (gumička) a nikdy nie viac než o `rubberMax` šírky.
 * @param {number} dx posun prsta, záporný = doľava (na ďalší deň)
 * @param {number} width šírka pásu (jeden deň)
 * @param {{ prev: boolean, next: boolean }} has je deň pred / za aktuálnym?
 */
export function pagerOffset(dx, width, has) {
    const step = width + DAY_PAGER.gapPx;
    const free = dx > 0 ? (has.prev ? step : 0) : has.next ? step : 0;
    const over = Math.abs(dx) - free;
    if (over <= 0) return dx;
    const r = Math.min(DAY_PAGER.rubberMax * width, width * (1 - 1 / ((over / width) * DAY_PAGER.rubberK + 1)));
    return Math.sign(dx) * (free + r);
}

/**
 * Rýchlosť prsta (px/ms) z posledných `velocityMs` ťahu. Kladná = doprava.
 * @param {Sample[]} samples v poradí, ako prišli
 */
export function pagerVelocity(samples) {
    const last = samples[samples.length - 1];
    if (!last) return 0;
    const from = samples.find((s) => last.t - s.t <= DAY_PAGER.velocityMs) ?? last;
    const first = from === last && samples.length > 1 ? samples[samples.length - 2] : from;
    return last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
}

/**
 * Kam pás po pustení prsta dobehne: -1 = predchádzajúci deň, 1 = ďalší, 0 = ostane. Rýchly švih
 * rozhodne sám (opačným smerom ťah zruší), inak sa listuje, keď prst prešiel aspoň `commit` šírky.
 * @param {number} offset posun pásu pri pustení (px, záporný = doľava)
 * @param {number} velocity px/ms, kladná = doprava
 * @param {number} width šírka pásu
 * @param {{ prev: boolean, next: boolean }} has
 * @returns {-1 | 0 | 1}
 */
export function pagerTarget(offset, velocity, width, has) {
    /** @type {-1 | 0 | 1} */
    let dir = 0;
    if (Math.abs(velocity) > DAY_PAGER.flickPxMs) {
        // Švih proti smeru, ktorým je pás posunutý, ťah ruší.
        if (Math.sign(velocity) === Math.sign(offset) || offset === 0) dir = velocity < 0 ? 1 : -1;
    } else if (Math.abs(offset) > DAY_PAGER.commit * width) dir = offset < 0 ? 1 : -1;
    if (dir === 1 && !has.next) return 0;
    if (dir === -1 && !has.prev) return 0;
    return dir;
}

/**
 * Ako dlho pás dobieha po pustení (ms): kratšia zvyšná dráha, kratší dojazd.
 * @param {number} distance zvyšná dráha (px) @param {number} width šírka pásu
 */
export function pagerSettleMs(distance, width) {
    const k = width > 0 ? Math.min(1, Math.abs(distance) / width) : 1;
    return Math.round(DAY_PAGER.minMs + (DAY_PAGER.maxMs - DAY_PAGER.minMs) * k);
}
