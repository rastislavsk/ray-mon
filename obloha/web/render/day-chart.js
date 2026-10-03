// Graf dňa ako SVG - ten istý na karte Teraz aj v detaile dňa na karte 7 dní. Geometriu počíta
// shared/day-chart.js, tu sa len skladá značkovanie.

import { escapeHtml } from '../../../shared/format.js';
import { DAY_CHART } from '../../../shared/day-chart.js';

/**
 * @typedef {ReturnType<typeof import('../../../shared/day-chart.js').dayChartModel> & { limitText: string }} Chart
 */

/**
 * Predpoveď (plocha), nameraná krivka (biela čiara), hranica veľkých spotrebičov, pás plánu,
 * hodiny, „teraz“ (len pri dnešku) a náhľad so štítkom. Farby pásu sú v style.css podľa
 * `data-tone`; `data-from` nesie začiatok bunky (minúta dňa).
 * @param {Chart} c
 */
export function dayChartSvg(c) {
    const C = DAY_CHART;
    const cells = c.cells
        .map(
            (b) =>
                `<rect x="${b.x}" y="${C.bandY}" width="${b.w}" height="${C.bandH}" rx="2" data-tone="${b.tone}" data-from="${b.from}"/>`,
        )
        .join('');
    const ticks = c.ticks.map((t) => `<text x="${t.x}" y="${C.tickY}" class="dc-t">${t.label}</text>`).join('');
    const dot = (/** @type {number | null} */ y, /** @type {number} */ x, /** @type {number} */ r, /** @type {string} */ cls) =>
        y === null ? '' : `<circle cx="${x}" cy="${y}" r="${r}" class="${cls}"/>`;
    const n = c.now;
    const now = n ? `<line x1="${n.x}" x2="${n.x}" y1="14" y2="130" class="dc-now"/>${dot(n.y, n.x, 5, 'dc-now-dot')}` : '';
    const p = c.preview;
    const preview = p
        ? `<line x1="${p.x}" x2="${p.x}" y1="${C.top - 2}" y2="130" class="dc-prev"/>${dot(p.y, p.x, 6, 'dc-prev-dot')}` +
          `<rect x="${p.pill.x}" y="2" width="${p.pill.w}" height="18" rx="9" class="dc-pill"/>` +
          `<text x="${p.pill.x + p.pill.w / 2}" y="14.5" class="dc-pill-t">${escapeHtml(p.pill.text)}</text>`
        : '';
    return (
        `<svg class="dc" viewBox="0 0 ${C.w} ${C.h}" aria-hidden="true">` +
        (c.area ? `<path d="${c.area}" class="dc-area"/>` : '') +
        (c.real ? `<path d="${c.real}" class="dc-real"/>` : '') +
        `<line x1="${C.left}" x2="${C.right}" y1="${c.limitY}" y2="${c.limitY}" class="dc-limit"/>` +
        `<text x="${C.right - 2}" y="${c.limitY - 4}" class="dc-limit-t">${escapeHtml(c.limitText)}</text>` +
        cells +
        ticks +
        now +
        preview +
        '</svg>'
    );
}

/** Legenda pod pásom plánu: farba a slovo. @param {Array<{ tone: string, text: string }>} legend */
export function legendHtml(legend) {
    return legend.map((l) => `<span data-tone="${l.tone}">${escapeHtml(l.text)}</span>`).join('');
}
