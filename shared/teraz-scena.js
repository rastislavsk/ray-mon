// Scéna toku energie na karte Teraz (docs/navrhy/teraz-tok-energie.html): koľko vyrábajú panely, koľko berie
// dom a kam ide sieť, a z toho koľko lúčov padá do panelov a koľko bodov beží po vedení. Čísla sú bez slov -
// čo znamenajú, hovorí miesto v scéne; slovami ich dostane len čítačka. Čistá funkcia, kreslí web/render/teraz-scena.js.

import { fmt1 } from './format.js';
import { tokSiete } from './teraz-bojler.js';

export const TERAZ_SCENA_TEXTS = {
    zoSlnka: 'Zo slnka',
    odhad: 'odhad',
    dom: 'dom berie',
    von: 'do siete ide',
    dnu: 'zo siete ide',
    nic: 'Panely teraz nevyrábajú',
};

/** Najviac lúčov do panelov a bodov na vedení naraz. */
const LUCE_MAX = 7;
const BODY_MAX = 3;

/** @param {number} n @param {number} od @param {number} po */
const medzi = (n, od, po) => Math.max(od, Math.min(po, n));

/**
 * Model scény. `vyrobaKw` je výkon panelov teraz (z merania, inak z predpovede - vtedy `odhad`), `sietKw` je
 * meranie elektromera (kladné dodávka do siete), bez elektromera alebo pri starom meraní null. Dom je výroba
 * mínus dodávka (plus odber) - batériu appka nepozná, preto ho bez elektromera nevie.
 * `luce`: počet lúčov (0 pri nule) a `jas` ich sila, `body`: počet bodov na vedení (0 bez toku), `popis`: veta pre čítačku.
 * @param {{ vyrobaKw: number | null, odhad: boolean, sietKw: number | null }} v
 */
export function scenaModel({ vyrobaKw, odhad, sietKw }) {
    const kw = Number.isFinite(vyrobaKw) ? Math.max(0, /** @type {number} */ (vyrobaKw)) : 0;
    const svieti = kw >= 0.05;
    const vyroba = svieti ? `${odhad ? '~' : ''}${fmt1(kw)}` : null;
    const dom = sietKw === null ? null : fmt1(Math.max(0, kw - sietKw));
    const tok = tokSiete(sietKw);
    const siet = tok && sietKw !== null ? { smer: tok.smer, kw: fmt1(Math.abs(sietKw)) } : null;
    return {
        vyroba,
        dom,
        siet,
        luce: svieti ? medzi(Math.round(kw * 1.15), 1, LUCE_MAX) : 0,
        // Slabá výroba sú bledé čiarky.
        jas: svieti ? Math.round(Math.min(1, 0.35 + kw / 7) * 100) / 100 : 0,
        body: siet && sietKw !== null ? medzi(Math.ceil(Math.abs(sietKw) / 1.6), 1, BODY_MAX) : 0,
        popis: popisOf(vyroba, odhad, dom, siet),
    };
}

/**
 * Veta pre čítačku: „Zo slnka 6,4 kW, dom berie 1,8 kW, do siete ide 4,6 kW“.
 * @param {string | null} vyroba @param {boolean} odhad @param {string | null} dom
 * @param {{ smer: 'von' | 'dnu', kw: string } | null} siet
 */
function popisOf(vyroba, odhad, dom, siet) {
    const T = TERAZ_SCENA_TEXTS;
    const casti = [vyroba ? `${T.zoSlnka} ${vyroba} kW${odhad ? ` (${T.odhad})` : ''}` : T.nic];
    if (dom) casti.push(`${T.dom} ${dom} kW`);
    if (siet) casti.push(`${T[siet.smer]} ${siet.kw} kW`);
    return casti.join(', ');
}
