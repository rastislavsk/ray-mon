// Graf dňa - ten istý na karte Teraz aj v detaile dňa na karte 7 dní. Geometriu aj polohu popiskov
// počíta shared/day-chart.js, tu sa len skladá značkovanie: krivky a pás v SVG, ktoré sa s grafom
// zväčšuje, a popisky ako HTML nad ním - tie majú na každej šírke tú istú veľkosť v px.

import { escapeHtml } from '../../../shared/format.js';
import { DAY_CHART } from '../../../shared/day-chart.js';

/** @typedef {ReturnType<typeof import('../../../shared/day-chart.js').dayChartModel>} Chart */

/** Zaokrúhlenie percent na stotiny - kratší zápis. @param {number} v */
const r2 = (v) => Math.round(v * 100) / 100;

/** Vodorovná poloha v % šírky grafu. @param {number} x jednotky viewBoxu */
const pctX = (x) => `${r2((x / DAY_CHART.w) * 100)}%`;

/** Zvislá poloha v % výšky grafu. @param {number} y jednotky viewBoxu */
const pctY = (y) => `${r2((y / DAY_CHART.h) * 100)}%`;

/** Poloha nápisu hranice ako premenné pre style.css. @param {string} key @param {import('../../../shared/day-chart.js').Spot} s */
const spotVars = (key, s) => `--${key}x:${pctX(s.x)};--${key}y:${pctY(s.y)};--${key}a:${s.end ? '-100%' : '0%'}`;

/**
 * Popisky nad SVG: hodiny pod pásom plánu, nápis hranice veľkých spotrebičov tam, kde ho model
 * položil (spodkom na `y`, zarovnaný začiatkom alebo koncom; na úzkom a na širokom grafe inde -
 * vyberá style.css podľa šírky grafu), a štítok náhľadu vystredený nad časom, no celý v grafe
 * (CSS clamp - šírka grafu v px je známa až tu v prehliadači).
 * @param {Chart} c
 */
function labelsHtml(c) {
    const C = DAY_CHART;
    const ticks = c.ticks
        .map((t) => `<span class="dc-t" style="left:${pctX(t.x)};top:${pctY(C.bandY + C.bandH)}">${t.label}</span>`)
        .join('');
    const l = c.limitAt;
    const limit = `<span class="dc-limit-t" style="${spotVars('n', l.narrow)};${spotVars('w', l.wide)}">${escapeHtml(c.limitText)}</span>`;
    const p = c.preview;
    const pill = p
        ? `<span class="dc-pill-t" style="left:clamp(2px, calc(${pctX(p.x)} - ${p.pill.w / 2}px), calc(100% - ${p.pill.w + 2}px));` +
          `width:${p.pill.w}px">${escapeHtml(p.pill.text)}</span>`
        : '';
    return ticks + limit + pill;
}

/**
 * Predpoveď (plocha), nameraná krivka (biela čiara), hranica veľkých spotrebičov, pás plánu,
 * „teraz“ (len pri dnešku) a náhľad, nad tým popisky. Farby pásu sú v style.css podľa
 * `data-tone`; `data-from` nesie začiatok bunky (minúta dňa).
 * @param {Chart} c
 */
export function dayChartHtml(c) {
    const C = DAY_CHART;
    const cells = c.cells
        .map(
            (b) =>
                `<rect x="${b.x}" y="${C.bandY}" width="${b.w}" height="${C.bandH}" rx="2" data-tone="${b.tone}" data-from="${b.from}"/>`,
        )
        .join('');
    const dot = (/** @type {number | null} */ y, /** @type {number} */ x, /** @type {number} */ r, /** @type {string} */ cls) =>
        y === null ? '' : `<circle cx="${x}" cy="${y}" r="${r}" class="${cls}"/>`;
    const n = c.now;
    const now = n ? `<line x1="${n.x}" x2="${n.x}" y1="14" y2="130" class="dc-now"/>${dot(n.y, n.x, 5, 'dc-now-dot')}` : '';
    const p = c.preview;
    // Čiara náhľadu ide až hore pod štítok - ten má pevnú výšku v px, takže na širokom grafe siaha nižšie.
    const preview = p ? `<line x1="${p.x}" x2="${p.x}" y1="1" y2="130" class="dc-prev"/>${dot(p.y, p.x, 6, 'dc-prev-dot')}` : '';
    return (
        '<div class="dc-box" aria-hidden="true">' +
        `<svg class="dc" viewBox="0 0 ${C.w} ${C.h}">` +
        (c.area ? `<path d="${c.area}" class="dc-area"/>` : '') +
        (c.real ? `<path d="${c.real}" class="dc-real"/>` : '') +
        `<line x1="${C.left}" x2="${C.right}" y1="${c.limitY}" y2="${c.limitY}" class="dc-limit"/>` +
        cells +
        now +
        preview +
        '</svg>' +
        labelsHtml(c) +
        '</div>'
    );
}

/** Legenda pod pásom plánu: farba a slovo. @param {Array<{ tone: string, text: string }>} legend */
export function legendHtml(legend) {
    return legend.map((l) => `<span data-tone="${l.tone}">${escapeHtml(l.text)}</span>`).join('');
}
