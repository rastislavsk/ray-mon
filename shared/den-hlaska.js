// Hláška iného dňa na karte Teraz namiesto mena dňa a dátumu (docs/navrhy/teraz-hlaska-dna.html, A + N, spôsob 1):
// keď pre deň platí niečo nové, čo dlaždice ani pásik nepovedia (najlepší deň, posledné či prvé slnko, dážď, sneh,
// mráz), povie sa to; inak trieda dňa. Deň bez slnka je deň triedy nanič - nezmestí sa naň zo slnka nič, rovnako ako
// pri výhľade v rannom oznámení (shared/vyhlad.js). Čisté funkcie bez DOM.

import { HLASKA_DNA } from './config.js';
import { denTriedaDna, denTriedaVeci, silnyDen } from './den-trieda.js';

/** @typedef {import('./den-trieda.js').DenTrieda} DenTrieda */
/**
 * Deň predpovede pre hlášku: trieda, kWh celého dňa, hodiny svetla (slnko nad obzorom), z nich s dažďom a so snehom,
 * a najvyššia teplota.
 * @typedef {{ cls: DenTrieda, kwh: number, svetlo: number, dazd: number, sneh: number, tempMaxC: number | null }} DenHlasky
 */
/**
 * Čo hláška povie: `trieda` (A) alebo jedna z nových vecí (N); `pocet` je počet dní bez slnka pri `posledne` a `konecne`.
 * @typedef {{ druh: 'najlepsi' | 'posledne' | 'konecne' | 'prsi' | 'sneh' | 'mraz' | 'trieda', cls: DenTrieda, pocet: number }} Hlaska
 */

/**
 * Všetky dni predpovede (0 = dnes, od polnoci) tak, ako ich hláška potrebuje.
 * @param {import('./day-plan.js').PlanInput & { forecast: import('./solar.js').Forecast }} input @param {readonly string[]} devices
 * @returns {DenHlasky[]}
 */
export function dniHlasky(input, devices) {
    return input.forecast.days.map((day, i) => {
        const svetlo = day.hourly.filter((h) => h.clearKw > 0);
        return {
            cls: i === 0 ? denTriedaVeci(input, devices).cls : denTriedaDna(input, i, devices),
            kwh: day.kwhTotal,
            svetlo: svetlo.length,
            dazd: svetlo.filter((h) => h.precip === 'dazd').length,
            sneh: svetlo.filter((h) => h.precip === 'sneh').length,
            tempMaxC: day.tempMaxC,
        };
    });
}

/** Koľko dní bez slnka ide za sebou od `od` krokom `krok` (1 dopredu, -1 dozadu). @param {DenHlasky[]} dni @param {number} od @param {number} krok */
function bezSlnka(dni, od, krok) {
    let n = 0;
    for (let i = od; i >= 0 && i < dni.length && dni[i].cls === 'nanic'; i += krok) n++;
    return n;
}

/**
 * Hláška dňa `index` (1 = zajtra). Nové veci idú v poradí priority, prvá, ktorá platí, vyhrá.
 * @param {DenHlasky[]} dni @param {number} index @returns {Hlaska}
 */
export function hlaskaDna(dni, index) {
    const d = dni[index];
    const najviac = Math.max(...dni.map((x) => x.kwh));
    if (silnyDen(d.cls) && d.kwh === najviac && dni.findIndex((x) => x.kwh === najviac) === index)
        return { druh: 'najlepsi', cls: d.cls, pocet: 0 };
    return slnkoOkolo(dni, index) ?? { druh: pocasieDna(d), cls: d.cls, pocet: 0 };
}

/**
 * Deň so slnkom pred dňami bez slnka alebo po nich, inak null.
 * @param {DenHlasky[]} dni @param {number} index @returns {Hlaska | null}
 */
function slnkoOkolo(dni, index) {
    const { cls } = dni[index];
    if (cls === 'nanic') return null;
    const po = bezSlnka(dni, index + 1, 1);
    if (po >= HLASKA_DNA.bezDni) return { druh: 'posledne', cls, pocet: po };
    const pred = bezSlnka(dni, index - 1, -1);
    return pred >= HLASKA_DNA.bezDni ? { druh: 'konecne', cls, pocet: pred } : null;
}

/** Dážď, sneh či mráz, inak trieda dňa. @param {DenHlasky} d @returns {Hlaska['druh']} */
function pocasieDna(d) {
    if (d.svetlo > 0 && d.dazd >= d.svetlo * HLASKA_DNA.dazdPodiel) return 'prsi';
    if (d.sneh >= HLASKA_DNA.snehHodin) return 'sneh';
    if (silnyDen(d.cls) && d.tempMaxC !== null && d.tempMaxC <= HLASKA_DNA.mrazC) return 'mraz';
    return 'trieda';
}
