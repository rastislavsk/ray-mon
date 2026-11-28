// Spoločná kostra panelov dlaždíc karty Teraz (docs/navrhy/teraz-panely-zladenie.html, C + súčet, 28. 11. 2026):
// spotrebič, bojler, auto a klíma majú rovnaké veci na rovnakom mieste - hlava, veľké číslo, os 0 - 24 h, akcia,
// Energia dnes so súčtom, potom zbalené behy, 14 dní, nastavenie a prečo. Tu sú texty kostry a výpočty, ktoré
// panely zdieľajú. Čisté funkcie.

import { fmt1 } from './format.js';

export const PANEL_TEXTS = {
    energia: 'Energia dnes',
    behy: 'Behy',
    nabijania: 'Nabíjania',
    dni14: 'Posledných 14 dní',
    nastavenie: 'Nastavenie',
    preco: 'Prečo práve vtedy',
    precoAsi: 'Prečo „asi“',
    zapnute: 'zapnuté',
    vypnute: 'vypnuté',
    /** Riadok pod energiou spotrebiča bez merania: koľkokrát dnes a že je to odhad. */
    odhad: (/** @type {number} */ n) => `${n}× dnes · odhad podľa typického programu`,
    /** Koľko behov dnes - vpravo v zbalenom riadku Behy. */
    dnes: (/** @type {number} */ n) => `${n} dnes`,
    /** Zdroje energie: slnko, sieť a sieť v drahom pásme tarify - vo všetkých paneloch rovnako. */
    zdroj: { slnko: 'slnko', siet: 'sieť', vt: 'drahá sieť' },
    /** To isté pre čítačku. */
    zdrojSr: { slnko: 'zo slnka', siet: 'zo siete', vt: 'zo siete v drahom pásme' },
};

/** @typedef {'slnko' | 'siet' | 'vt'} Ton */

/**
 * Časti energie podľa zdroja: Wh (šírka v pásiku), kWh textom, popis a to isté pre čítačku. Bez drahého pásma
 * v tarife (`sVt` false) je sieť jedna časť.
 * @param {{ slnko: number, siet: number, vt: number }} e @param {boolean} sVt
 */
export function casti(e, sVt) {
    const T = PANEL_TEXTS;
    const tony = /** @type {Ton[]} */ (sVt ? ['slnko', 'siet', 'vt'] : ['slnko', 'siet']);
    return tony.map((tone) => {
        const wh = Math.max(0, tone === 'siet' && !sVt ? e.siet + e.vt : e[tone]);
        return { tone, wh, v: `${fmt1(wh / 1000)} kWh`, l: T.zdroj[tone], sr: T.zdrojSr[tone] };
    });
}

/**
 * Súčet energie vpravo v riadku Energia dnes, „4,5 kWh“ - zo zaokrúhlených častí, aby 3,6 a 0,2 dali 3,8, nie 3,9.
 * @param {Array<{ wh: number }>} c časti podľa zdroja (casti)
 */
export const spoluKwh = (c) => `${fmt1(c.reduce((sum, x) => sum + Math.round(x.wh / 100), 0) / 10)} kWh`;

/**
 * Krivka výroby dneška nad osou panelu (plocha v SVG 0 - 96 × 0 - 40, štvrťhodiny), bez výroby null.
 * @param {number[] | null} vyroba kW po štvrťhodinách od polnoci
 */
export function krivkaVyroby(vyroba) {
    const max = vyroba ? Math.max(...vyroba) : 0;
    if (!vyroba || !(max > 0)) return null;
    const y = (/** @type {number} */ kw) => Math.round((40 - (kw / max) * 36) * 10) / 10;
    return `M0 40${vyroba.map((kw, i) => ` L${i + 0.5} ${y(kw)}`).join('')} L96 40 Z`;
}
