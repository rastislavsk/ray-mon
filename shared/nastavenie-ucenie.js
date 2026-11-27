// Nastavenie › Učenie z histórie (docs/navrhy/plan-dna-ucenie.html, variant B): z koľkých dní sa appka
// učí, čo sa naučila - strecha oproti predpovedi za jasna a spotreba domu v pracovný deň ako malé grafy, potreba
// bojlera - a „Začať odznova“. Čistá funkcia nad modelom učenia (shared/ucenie.js); kreslí web/render/nastavenie.js.

import { UCENIE } from './config.js';
import { fmt1 } from './format.js';
import { dniSlovo } from './messages-zaklad.js';
import { potrebaBojlera } from './ucenie.js';

/** @typedef {import('./ucenie.js').Naucene} Naucene */

/** Texty sekcie. */
export const UCENIE_TEXTS = {
    nazov: 'Učenie z histórie',
    // dniSlovo je pre 1 a viac dní, nula je „0 dní“.
    dni: (/** @type {number} */ n) => `${n} ${n === 0 ? 'dní' : dniSlovo(n)}`,
    zatial: `Appka si pamätá, ako dni naozaj dopadli. Od ${UCENIE.minDni} dní začne podľa toho opravovať predpoveď a plán.`,
    strecha: 'Strecha oproti predpovedi (jasno)',
    strechaPopis: 'Oprava predpovede za jasna po hodinách od 7:00 do 17:00: nad čiarou strecha dáva viac, pod ňou menej.',
    dom: 'Dom bez spotrebičov · pracovný deň',
    domPopis: 'Spotreba domu bez spotrebičov po hodinách v pracovný deň.',
    domMax: (/** @type {string} */ kw, /** @type {number} */ hod) => `najviac ${kw} kW o ${hod}:00`,
    bojlerNic: `Bojler: zatiaľ ráta s ${fmt1(potrebaBojlera(null, null) / 1000)} kWh za deň.`,
    bojler: (/** @type {string[]} */ casti) => `Bojler ${casti.join(' · ')}`,
    pasma: ['pod 5 °C', '5 – 15 °C', 'nad 15 °C'],
    kwh: (/** @type {number} */ wh) => `~${fmt1(wh / 1000)} kWh`,
    odznova: 'Začať odznova',
};

/** Hodiny grafu strechy (od 7:00 do 17:00). */
const HODINY = Array.from({ length: 11 }, (_, i) => 7 + i);
/** Rozmery malých grafov vo viewBoxe. */
const G = { w: 260, h: 70, stred: 35, mierka: 70 };

/**
 * Sekcia Učenie z histórie (vlastná sekcia karty Nastavenie, docs/navrhy/nastavenie-co-mas-doma.html). Kým appka model nemá,
 * je to 0 dní s vysvetlením. Grafy sú, až keď sa appka z UCENIE.minDni dní naučila.
 * @param {{ ucenie: Naucene | null, doma: readonly string[] }} state
 */
export function ucenieSekcia({ ucenie, doma }) {
    const T = UCENIE_TEXTS;
    if (!ucenie) return { nazov: T.nazov, dni: T.dni(0), zatial: T.zatial, grafy: null, bojler: '', odznova: T.odznova };
    const naucene = ucenie.dni >= UCENIE.minDni;
    return {
        nazov: T.nazov,
        dni: T.dni(ucenie.dni),
        zatial: naucene ? '' : T.zatial,
        // Grafy až keď je čo ukázať - dovtedy by boli ploché.
        grafy: naucene
            ? {
                  strecha: { nazov: T.strecha, popis: T.strechaPopis, stlpce: stlpceStrechy(ucenie.oprava[0]) },
                  dom: { nazov: T.dom, popis: T.domPopis, ...krivkaDomu(ucenie.dom.prac) },
              }
            : null,
        bojler: doma.includes('bojler') ? bojlerText(ucenie) : '',
        odznova: T.odznova,
    };
}

/**
 * Stĺpce opravy za jasna: od stredovej čiary hore (strecha dáva viac, `viac`) či dole, výška podľa rozdielu od 1.
 * @param {number[]} oprava násobky po hodinách
 */
function stlpceStrechy(oprava) {
    const sirka = G.w / HODINY.length;
    return HODINY.map((hod, i) => {
        const d = Math.max(-0.5, Math.min(0.5, oprava[hod] - 1));
        const h = Math.round(Math.abs(d) * G.mierka * 10) / 10;
        return { x: Math.round(i * sirka + 2), w: Math.round(sirka - 4), y: d >= 0 ? G.stred - h : G.stred, h, viac: d >= 0, hod };
    });
}

/** Krivka spotreby domu po hodinách (body čiary vo viewBoxe) a jej najvyššia hodina. @param {number[]} dom kW po hodinách */
function krivkaDomu(dom) {
    const max = Math.max(...dom, 0.5);
    const body = dom.map((kw, hod) => `${Math.round((hod / 23) * G.w)},${Math.round(G.h - 6 - (kw / max) * (G.h - 16))}`).join(' ');
    const hod = dom.indexOf(Math.max(...dom));
    return { body, popisMax: UCENIE_TEXTS.domMax(fmt1(dom[hod]), hod) };
}

/** Potreba bojlera, ktorú sa appka naučila, po pásmach teploty, inak za všetky dni. @param {Naucene} n */
function bojlerText(n) {
    const T = UCENIE_TEXTS;
    const casti = n.bojler.pasma.flatMap((wh, i) => (wh === null ? [] : [`${T.pasma[i]} ${T.kwh(wh)}`]));
    if (casti.length) return T.bojler(casti);
    return n.bojler.vsetky === null ? T.bojlerNic : T.bojler([T.kwh(n.bojler.vsetky)]);
}
