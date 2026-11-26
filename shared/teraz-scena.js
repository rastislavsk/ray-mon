// Scéna toku energie na karte Teraz (docs/navrhy/teraz-tok-energie.html): koľko vyrábajú panely, koľko berie
// dom a kam ide sieť, a z toho koľko lúčov padá do panelov a koľko bodov beží po vedení. Čísla sú bez slov -
// čo znamenajú, hovorí miesto v scéne; slovami ich dostane len čítačka. Čistá funkcia, kreslí web/render/teraz-scena.js.

import { TERAZ_OKNA_SPANOK } from './config.js';
import { fmt1 } from './format.js';
import { localMinutes } from './solar.js';
import { tokSiete } from './teraz-bojler.js';

export const TERAZ_SCENA_TEXTS = {
    zoSlnka: 'Zo slnka',
    odhad: 'odhad',
    dom: 'dom berie',
    von: 'do siete ide',
    dnu: 'zo siete ide',
    nic: 'Panely teraz nevyrábajú',
    den: {
        zoSlnka: 'Za deň zo slnka asi',
        dom: 'dom spotrebuje',
        von: 'do siete pôjde',
        dnu: 'zo siete treba',
        nula: 'so sieťou vyjde na nulu',
    },
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
 * `cisla`: čo ukázať v scéne - každé číslo, ktoré appka pozná, aj nulové („0,0“); `k` pri sieti je smer, bez toku `nula`.
 * @param {{ vyrobaKw: number | null, odhad: boolean, sietKw: number | null }} v
 */
export function scenaModel({ vyrobaKw, odhad, sietKw }) {
    const kw = Math.max(0, Number.isFinite(vyrobaKw) ? /** @type {number} */ (vyrobaKw) : 0);
    const svieti = kw >= 0.05;
    const vyroba = svieti ? `${odhad ? '~' : ''}${fmt1(kw)}` : null;
    const dom = sietKw === null ? null : fmt1(Math.max(0, kw - sietKw));
    const tok = tokSiete(sietKw);
    const siet = tok && sietKw !== null ? { smer: tok.smer, kw: fmt1(Math.abs(sietKw)) } : null;
    return {
        vyroba,
        dom,
        siet,
        cisla: cislaOf(vyrobaKw, odhad, vyroba, dom, siet),
        luce: svieti ? medzi(Math.round(kw * 1.15), 1, LUCE_MAX) : 0,
        // Slabá výroba sú bledé čiarky.
        jas: svieti ? Math.round(Math.min(1, 0.35 + kw / 7) * 100) / 100 : 0,
        body: siet && sietKw !== null ? medzi(Math.ceil(Math.abs(sietKw) / 1.6), 1, BODY_MAX) : 0,
        popis: popisOf(vyroba, odhad, dom, siet),
    };
}

/**
 * Čísla v scéne. Bez elektromera je `dom` null a sieť sa nekreslí; s elektromerom a bez toku (`siet` null)
 * je pri elektrárni „0,0“ s kľúčom `nula`.
 * Výkon panelov, ktorý appka nepozná, sa neukáže, pod 0,05 kW je „0,0“.
 * @param {number | null} vyrobaKw @param {boolean} odhad @param {string | null} vyroba @param {string | null} dom
 * @param {{ smer: 'von' | 'dnu', kw: string } | null} siet
 */
function cislaOf(vyrobaKw, odhad, vyroba, dom, siet) {
    const nula = fmt1(0);
    const slnko = Number.isFinite(vyrobaKw) ? (vyroba ?? `${odhad ? '~' : ''}${nula}`) : null;
    const sietCislo = dom === null ? null : siet ? { k: siet.smer, kw: siet.kw } : { k: 'nula', kw: nula };
    return { slnko, dom, siet: sietCislo };
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

/**
 * Pole toku iného dňa (docs/navrhy/teraz-pole-ine-dni.html, B): to isté slnko → dom → sieť ako pri dnešku, len za celý
 * deň v celých kWh - výroba z predpovede, spotreba domu so spotrebičmi a bojlerom a sieť ako rozdiel (cez deň netto:
 * „do siete“ neznamená, že večer netreba nič zo siete). Čísla sa zaokrúhlia pred rozdielom, aby sedeli aj na pohľad.
 * Sieť je vždy aj nulová (`nula`). `luce` hovorí, či slnko do domu niečo dá.
 * @param {number} slnkoKwh @param {number} domKwh
 */
export function tokDnaModel(slnkoKwh, domKwh) {
    const T = TERAZ_SCENA_TEXTS.den;
    const slnko = Math.max(0, Math.round(slnkoKwh));
    const dom = Math.max(0, Math.round(domKwh));
    const rozdiel = slnko - dom;
    const k = /** @type {'von' | 'dnu' | 'nula'} */ (rozdiel > 0 ? 'von' : rozdiel < 0 ? 'dnu' : 'nula');
    const siet = String(Math.abs(rozdiel));
    return {
        cisla: { slnko: String(slnko), dom: String(dom), siet: { k, kw: siet } },
        luce: slnko > 0 ? 1 : 0,
        popis: `${T.zoSlnka} ${slnko} kWh, ${T.dom} ${dom} kWh, ${k === 'nula' ? T.nula : `${T[k]} ${siet} kWh`}`,
    };
}

/**
 * Svietia okná domu? V tme áno, akoby bol niekto doma, len v čase na spánok (TERAZ_OKNA_SPANOK) nie.
 * @param {boolean} noc @param {Date} now @param {string} tz
 */
export function oknaSvietia(noc, now, tz) {
    const min = localMinutes(now, tz);
    return noc && !(min >= TERAZ_OKNA_SPANOK.od && min < TERAZ_OKNA_SPANOK.do);
}
