// Počasie v pozadí karty Teraz (docs/navrhy/teraz-pocasie-2.html): vrstvy kresby pre obe appky.
// Čo je vidno, rozhoduje web/pocasie.css podľa data-wx a data-noc na nosiči, farby a polohu
// mesiaca každá appka vo svojom style.css. Stav počasia počíta shared/pocasie.js (terazModel).
// Neutrálny modul: nesiaha na DOM ani na stav appky, len skladá HTML a atribúty.

import { HVIEZDY } from '../shared/config.js';

/** Delenie fázy Mesiaca: pol dňa. Jemnejšie by kresba prepisovala vrstvy (a reštartovala pohyb) pri každom prekreslení. */
const FAZY = 59;

/**
 * Mesiac vo fáze `faza` (0 nov, 0,5 spln): osvetlená časť ohraničená polkruhom a polelipsou
 * terminátora, neosvetlená len tušená. Na severnej pologuli dorastá sprava a ubúda zľava, na
 * južnej (`juh`) naopak - kresba je zrkadlová.
 * @param {number} faza @param {boolean} juh
 */
function mesiacSvg(faza, juh) {
    const rx = (Math.abs(Math.cos(2 * Math.PI * faza)) * 23).toFixed(1);
    const ubuda = faza > 0.5;
    const kosak = faza < 0.25 || faza > 0.75;
    const okraj = ubuda ? 0 : 1;
    const hrana = ubuda === kosak ? 1 : 0;
    return (
        '<svg viewBox="0 0 46 46"><circle class="wx-moon-dark" cx="23" cy="23" r="23"/>' +
        `<path class="wx-moon-lit"${juh ? ' transform="matrix(-1 0 0 1 46 0)"' : ''} d="M23 0A23 23 0 0 ${okraj} 23 46A${rx} 23 0 0 ${hrana} 23 0z"/></svg>`
    );
}

/**
 * Vrstvy kresby: rozptýlené svetlo, mesiac a hviezdy, slnko s lúčmi, oblaky a zrážky (tie
 * v obale, ktorý končí nad vetou pod číslom). Pri tej istej fáze Mesiaca je HTML to isté.
 * Hviezdy do vrstiev .wx-stars a .wx-stars2 zapisuje render zvlášť (hviezdySvg), aby ich posun
 * nereštartoval pohyb oblakov.
 * @param {number} faza fáza Mesiaca 0-1 @param {boolean} [juh] južná pologuľa - starší modul ho nepošle
 */
export function pocasieHtml(faza, juh = false) {
    const f = (Math.round(faza * FAZY) % FAZY) / FAZY;
    return (
        '<i class="wx-diffuse"></i><i class="wx-moonglow"></i><i class="wx-stars"></i><i class="wx-stars2"></i>' +
        `<i class="wx-moon">${mesiacSvg(f, juh === true)}</i>` +
        '<i class="wx-halo"></i><i class="wx-rays wx-r2"></i><i class="wx-rays wx-r1"></i><i class="wx-flare"></i>' +
        '<i class="wx-deck"></i><i class="wx-cloud wx-c2"></i><i class="wx-cloud wx-c1"></i><i class="wx-cloud wx-c3"></i>' +
        '<div class="wx-prec"><i class="wx-rain wx-rain2"></i><i class="wx-rain wx-rain1"></i>' +
        '<i class="wx-snow wx-snow1"></i><i class="wx-snow wx-snow2"></i></div>'
    );
}

/**
 * Čo kresba ukáže: zrážky prebijú jas (pri daždi je obloha zatiahnutá, aj keď je oblačnosť
 * hraničná). @param {import('../shared/pocasie.js').Pocasie} p @returns {string}
 */
export const pocasieStav = (p) => p.zrazky ?? p.jas;

/**
 * Skutočné hviezdy (shared/hviezdy.js) ako SVG vrstvy: párne do prvej, nepárne do druhej, aby
 * blikali striedavo ako hviezdy z CSS. Pole sa roztiahne na celú vrstvu (slice), takže jednotka
 * má na telefóne aj na počítači podobne veľa pixelov a úzka obrazovka ukáže užší výsek oblohy.
 * Jasnejšia hviezda je väčšia a plnšia.
 * @param {import('../shared/hviezdy.js').Hviezda[]} zoznam @returns {[string, string]}
 */
export function hviezdySvg(zoznam) {
    const kruhy = zoznam.map((h) => {
        const r = Math.max(0.2, 0.46 - 0.07 * h.mag).toFixed(2);
        const a = Math.min(1, Math.max(0.6, 1 - 0.1 * h.mag)).toFixed(2);
        return `<circle cx="${h.x}" cy="${h.y}" r="${r}" opacity="${a}"/>`;
    });
    const svg = (/** @type {number} */ zvysok) =>
        `<svg viewBox="0 0 ${HVIEZDY.sirka} ${HVIEZDY.vyska}" preserveAspectRatio="xMidYMid slice">` +
        kruhy.filter((_, i) => i % 2 === zvysok).join('') +
        '</svg>';
    return [svg(0), svg(1)];
}
