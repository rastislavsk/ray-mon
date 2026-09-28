// Súhrn na zdieľanie v karte Môžem?: týždeň alebo mesiac na streche ako plagát. Obsah skladá
// render karty (render/mozem.js) do toho istého nosiča #mozem-body. Počíta shared/summary.js.

import { dayNameShort, escapeHtml, fmtSum } from '../../shared/format.js';
import { SUMMARY_PERIODS } from '../../shared/summary.js';

/** @typedef {NonNullable<ReturnType<typeof import('../../shared/summary.js').summaryModel>>} SummaryModel */

const PERIOD_LABELS = { tyzden: 'Týždeň', mesiac: 'Mesiac' };

/** Týždeň ako stĺpce, mesiac ako mriežka štvorčekov. Chýbajúci deň je len obrys. @param {SummaryModel} m */
function vizHtml(m) {
    if (m.period === 'tyzden') {
        const bars = m.days
            .map((d) => {
                const h = d.frac === null ? 30 : Math.max(4, Math.round(d.frac * 100));
                const cls = d.frac === null ? ' missing' : d.best ? ' best' : '';
                return `<span><i class="${cls.trim()}" style="height:${h}%"></i>${escapeHtml(dayNameShort(d.date))}</span>`;
            })
            .join('');
        return `<div class="summary-bars" aria-hidden="true">${bars}</div>`;
    }
    const cells = m.days
        .map((d) => (d.frac === null ? '<i class="missing"></i>' : `<i style="opacity:${(0.15 + d.frac * 0.85).toFixed(2)}"></i>`))
        .join('');
    return `<div class="summary-cal" aria-hidden="true">${cells}</div>`;
}

/**
 * Obrazovka súhrnu. Bez merania (kiosk neodpovedá) povie, na čo čaká.
 * @param {SummaryModel | null} m @param {import('../../shared/summary.js').SummaryPeriod} period
 */
export function summaryHtml(m, period) {
    const seg = SUMMARY_PERIODS.map(
        (p) => `<button type="button" data-summary-period="${p}" aria-pressed="${p === period}">${PERIOD_LABELS[p]}</button>`,
    ).join('');
    const top =
        `<div class="summary-top"><button type="button" class="summary-back" data-summary-back>` +
        `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>Späť</button>` +
        `<div class="seg" role="group" aria-label="Obdobie">${seg}</div></div>`;
    if (!m)
        return `<section class="summary">${top}<p class="summary-note">Súhrn skladá čísla zo živého merania. Keď kiosk odpovie, ukáže sa.</p></section>`;
    const rows = m.rows
        .map((r, i) => `<div class="summary-row"><b>0${i + 1}</b><span>${escapeHtml(r.t)}<small>${escapeHtml(r.s)}</small></span></div>`)
        .join('');
    return (
        `<section class="summary">${top}<h2 class="summary-kick">${escapeHtml(m.kick)}</h2>` +
        `<p class="summary-big">${fmtSum(Math.round(m.kwh), 0)}<small> kWh</small></p>${vizHtml(m)}` +
        `<div class="summary-rows">${rows}</div>` +
        (m.note ? `<p class="summary-note">${escapeHtml(m.note)}</p>` : '') +
        `<button type="button" class="summary-share" data-summary-share>` +
        `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7.5 7.5L12 3l4.5 4.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>` +
        `Zdieľať do story</button></section>`
    );
}

/** Odkaz na súhrn na konci karty; bez merania nie je. @param {SummaryModel | null} m */
export function summaryLinkHtml(m) {
    if (!m) return '';
    return (
        `<button type="button" class="summary-link" data-mozem-summary><span><small>Súhrn na zdieľanie</small>` +
        `${escapeHtml(m.kick)}: ${fmtSum(Math.round(m.kwh), 0)} kWh. Pozri čísla.</span>` +
        `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>`
    );
}
