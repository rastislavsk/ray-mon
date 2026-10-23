// Graf dňa - ten istý na karte Teraz (Terazky) v oboch appkách aj v detaile dňa na karte 7 dní novej
// appky. Geometriu aj polohu popiskov počíta shared/day-chart.js, tu sa len skladá značkovanie:
// oblačnosť, krivky a pás v SVG, ktoré sa s grafom zväčšuje, a popisky ako HTML nad ním - tie majú
// na každej šírke tú istú veľkosť v px. Čistý reťazec bez DOM, preto neutrálny modul (CLAUDE.md); farby dáva style.css appky.

import { escapeHtml } from '../shared/format.js';
import { DAY_CHART } from '../shared/day-chart.js';

/** @typedef {ReturnType<typeof import('../shared/day-chart.js').dayChartModel>} Chart */

/** Zaokrúhlenie percent na stotiny - kratší zápis. @param {number} v */
const r2 = (v) => Math.round(v * 100) / 100;

/** Vodorovná poloha v % šírky grafu. @param {number} x jednotky viewBoxu */
const pctX = (x) => `${r2((x / DAY_CHART.w) * 100)}%`;

/** Zvislá poloha v % výšky grafu. @param {number} y jednotky viewBoxu */
const pctY = (y) => `${r2((y / DAY_CHART.h) * 100)}%`;

/** Vrch čiary náhľadu: tesne pod riadkom oblačnosti, nad ním je čas (aj na najužšom grafe). */
const MARK_TOP = DAY_CHART.cloudY - 2;

/** Spodok čiary náhľadu: tesne pod pásom plánu. */
const MARK_BOTTOM = DAY_CHART.bandY + DAY_CHART.bandH + 2;

/** Poloha nápisu hranice ako premenné pre style.css. @param {string} key @param {import('../shared/day-chart.js').Spot} s */
const spotVars = (key, s) => `--${key}x:${pctX(s.x)};--${key}y:${pctY(s.y)};--${key}a:${s.end ? '-100%' : '0%'}`;

/** Vodorovná poloha nápisu so šírkou `w` px vystredeného na `x`, no celého v grafe (CSS clamp). @param {number} x @param {number} w */
const clampX = (x, w) => `clamp(${w / 2 + 2}px, ${pctX(x)}, calc(100% - ${w / 2 + 2}px))`;

/**
 * Sýtosť bunky oblačnosti: jasno je len naznačené, ale viditeľné (riadok tam je), zamračené takmer plné.
 * @param {number} pct
 */
const cloudOpacity = (pct) => r2(0.12 + (Math.min(100, Math.max(0, pct)) / 100) * 0.8);

/**
 * Popisky nad SVG: čísla osi kW, hodiny pod pásom plánu, nápis hranice veľkých spotrebičov tam, kde
 * ho model položil (spodkom na `y`, zarovnaný začiatkom alebo koncom; na úzkom a na širokom grafe
 * inde - vyberá style.css podľa šírky grafu), čas náhľadu (alebo „teraz“) spodkom nad riadkom
 * oblačnosti a nápis okna pod zátvorkou, oba vystredené, no celé v grafe.
 * @param {Chart} c
 */
function labelsHtml(c) {
    const C = DAY_CHART;
    const axis =
        c.grid.map((g) => `<span class="dc-y" style="left:${pctX(C.left - 4)};top:${pctY(g.y)}">${g.label}</span>`).join('') +
        `<span class="dc-y dc-unit" style="left:${pctX(C.left - 4)};top:${pctY(C.top - 14)}">kW</span>`;
    const ticks = c.ticks
        .map((t) => `<span class="dc-t" style="left:${pctX(t.x)};top:${pctY(C.bandY + C.bandH)}">${t.label}</span>`)
        .join('');
    const l = c.limitAt;
    const limit = `<span class="dc-limit-t" style="${spotVars('n', l.narrow)};${spotVars('w', l.wide)}">${escapeHtml(c.limitText)}</span>`;
    const m = c.mark;
    const time = m
        ? `<span class="dc-at-t" style="left:${clampX(m.x, m.label.w)};top:${pctY(MARK_TOP)}">${escapeHtml(m.label.text)}</span>`
        : '';
    const w = c.windowLabel;
    const win = w ? `<span class="dc-win-t" style="left:${clampX(w.x, w.w)};top:${pctY(C.winY + 3)}">${escapeHtml(w.text)}</span>` : '';
    return axis + ticks + limit + time + win;
}

/**
 * Odhora: oblačnosť po hodinách, mriežka osi kW, plocha pod krivkou dňa (sýta nad hranicou veľkých
 * spotrebičov, jemná pod ňou), hranica, predpoveď (prerušovaná) a meranie (plná čiara), pás plánu,
 * zátvorky okna na veľké spotrebiče, „teraz“ (len pri dnešku: bod na krivke a stlmené bunky pásu,
 * ktoré už prešli) a čiara náhľadu, nad tým popisky. Farby sú v style.css appky; pás podľa
 * `data-tone`, `data-from` nesie začiatok bunky (minúta dňa).
 * @param {Chart} c
 */
export function dayChartHtml(c) {
    const C = DAY_CHART;
    const m = c.mark;
    const clouds = c.clouds
        .map(
            (b) =>
                `<rect x="${b.x}" y="${C.cloudY}" width="${b.w}" height="${C.cloudH}" rx="2.5" fill-opacity="${cloudOpacity(b.cloud)}"` +
                ` class="dc-cloud${m && m.hour === b.hour ? ' dc-cloud-on' : ''}" data-hour="${b.hour}"/>`,
        )
        .join('');
    const grid = c.grid.map((g) => `<line x1="${C.left}" x2="${C.right}" y1="${g.y}" y2="${g.y}" class="dc-grid"/>`).join('');
    const cells = c.cells
        .map(
            (b) =>
                `<rect x="${b.x}" y="${C.bandY}" width="${b.w}" height="${C.bandH}" rx="2" data-tone="${b.tone}" data-from="${b.from}"` +
                `${b.past ? ' class="dc-past"' : ''}/>`,
        )
        .join('');
    // Zátvorka nad každým oknom: vodorovná čiara s krátkymi nožičkami hore k pásu.
    const windows = c.windows
        .map((w) => {
            const a = r2(w.x0 + 1);
            const b = r2(w.x1 - 1);
            return `<path d="M${a} ${C.winY - 3} L${a} ${C.winY} L${b} ${C.winY} L${b} ${C.winY - 3}" class="dc-win"/>`;
        })
        .join('');
    const dot = (/** @type {number | null} */ y, /** @type {number} */ x, /** @type {number} */ r, /** @type {string} */ cls) =>
        y === null ? '' : `<circle cx="${x}" cy="${y}" r="${r}" class="${cls}"/>`;
    const n = c.now;
    // „Teraz“ je bod na krivke - nameraná krivka v ňom končí, v páse ho ukazujú stlmené bunky.
    const now = n ? dot(n.y, n.x, 4, 'dc-now-dot') : '';
    // Čiara náhľadu (bez náhľadu stojí na „teraz“) od oblačnosti po pás plánu; bunka pásu pod ňou je
    // zvýraznená (väčšia, s okrajom), pri náhľade aj bod na krivke.
    const mark = m
        ? `<line x1="${m.x}" x2="${m.x}" y1="${MARK_TOP}" y2="${MARK_BOTTOM}" class="dc-prev"/>` +
          (m.preview ? dot(m.y, m.x, 5.5, 'dc-prev-dot') : '') +
          `<rect x="${m.cell.x - 1}" y="${C.bandY - 3}" width="${r2(m.cell.w + 2)}" height="${C.bandH + 6}" rx="3" data-tone="${m.cell.tone}" class="dc-cell-on"/>`
        : '';
    return (
        '<div class="dc-box" aria-hidden="true">' +
        `<svg class="dc" viewBox="0 0 ${C.w} ${C.h}">` +
        clouds +
        grid +
        (c.under ? `<path d="${c.under}" class="dc-under"/>` : '') +
        (c.over ? `<path d="${c.over}" class="dc-over"/>` : '') +
        `<line x1="${C.left}" x2="${C.right}" y1="${c.limitY}" y2="${c.limitY}" class="dc-limit"/>` +
        (c.forecast ? `<path d="${c.forecast}" class="dc-fc"/>` : '') +
        (c.real ? `<path d="${c.real}" class="dc-real"/>` : '') +
        cells +
        windows +
        mark +
        now +
        '</svg>' +
        labelsHtml(c) +
        '</div>'
    );
}

/** Legenda pod pásom plánu: farba a slovo. @param {Array<{ tone: string, text: string }>} legend */
export function legendHtml(legend) {
    return legend.map((l) => `<span data-tone="${l.tone}">${escapeHtml(l.text)}</span>`).join('');
}
