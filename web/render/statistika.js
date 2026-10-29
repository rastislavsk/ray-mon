// Karta Štatistika: plagát obdobia - dnes, mesiac, rok alebo celý čas na streche - v prechode farieb
// stavu, s prepínačom obdobia, veľkým číslom, obrázkom dní a očíslovanými riadkami. Bez merania
// dnešok z predpovede. Celý obsah karty skladá render do #stats-body, v index.html sú len nosiče.
// Počíta shared/summary.js.

import { installedKw } from '../../shared/config.js';
import { escapeHtml, kwpText, monthNameShort } from '../../shared/format.js';
import { EMPTY_MESSAGES, STATISTIKA_TEXTS, voiceTexts } from '../../shared/messages.js';
import { neplatiOf } from '../../shared/pristup.js';
import { STATS_PERIODS } from '../../shared/stats.js';
import { summaryModel } from '../../shared/summary.js';
import { SETUP_ICONS } from '../icons.js';
import { writeHtml } from '../memo.js';

/** @typedef {import('../../shared/summary.js').SummaryModel} SummaryModel */

/** Výzva, ktorá vedie do Nastavenia (data-stats-go, viď initStats vo web/interactions.js).
 * @param {string} go krok sprievodcu, alebo `nastavenie` pre samotnú kartu @param {string} title @param {string} text */
function goHtml(go, title, text) {
    return (
        `<button type="button" class="choice stats-go" data-stats-go="${go}">` +
        `<span class="t"><b>${escapeHtml(title)}</b><span>${escapeHtml(text)}</span></span>${SETUP_ICONS.chevron}</button>`
    );
}

/** Prepínač obdobia na plagáte; bez merania sa dá vybrať len dnešok. @param {SummaryModel} m */
function segHtml(m) {
    const buttons = STATS_PERIODS.map(
        (p) =>
            `<button type="button" data-stats-period="${p}" aria-pressed="${p === m.period}"${!m.periods && p !== 'dnes' ? ' disabled' : ''}>` +
            `${STATISTIKA_TEXTS.periods[p]}</button>`,
    ).join('');
    return `<div class="seg" role="group" aria-label="${STATISTIKA_TEXTS.periodsLabel}">${buttons}</div>`;
}

/**
 * Obrázok pod veľkým číslom: pás (dnešok voči predpovedi, splatený uhlík panelov), mesiac ako
 * mriežka štvorčekov, rok ako 12 stĺpcov mesiacov. Chýbajúci deň aj mesiac je len obrys,
 * mesiac, v ktorom niektorý deň chýba, má stĺpec s prerušovaným obrysom (je nižší, než mesiac
 * naozaj bol), deň či mesiac, ktorý ešte len príde, je tenký obrys, resp. bez stĺpca.
 * @param {NonNullable<SummaryModel['viz']>} viz
 */
function vizHtml(viz) {
    if (viz.kind === 'meter')
        return (
            `<div class="summary-meter"><div class="summary-track" aria-hidden="true"><i style="width:${viz.pct}%"></i></div>` +
            `<p><span>${escapeHtml(viz.left)}</span><span>${escapeHtml(viz.right)}</span></p></div>`
        );
    if (viz.kind === 'days') {
        const cells = viz.days
            .map((d) =>
                d.future
                    ? '<i class="future"></i>'
                    : d.frac === null
                      ? '<i class="missing"></i>'
                      : `<i style="opacity:${(0.15 + d.frac * 0.85).toFixed(2)}"></i>`,
            )
            .join('');
        return `<div class="summary-cal" aria-hidden="true">${cells}</div>`;
    }
    const bars = viz.months
        .map((m) => {
            const cls = m.future
                ? 'future'
                : m.frac === null
                  ? 'missing'
                  : [m.best ? 'best' : '', m.partial ? 'partial' : ''].join(' ').trim();
            const h = m.future ? 0 : m.frac === null ? 30 : Math.max(4, Math.round(m.frac * 100));
            return `<span><i class="${cls}" style="height:${h}%"></i>${escapeHtml(monthNameShort(m.month))}</span>`;
        })
        .join('');
    return `<div class="summary-bars year" aria-hidden="true">${bars}</div>`;
}

/** Plagát obdobia; bez čísel (meranie ani predpoveď) prázdny. @param {SummaryModel} m */
function posterHtml(m) {
    if (m.kind === 'none') return '';
    const est = m.kind === 'estimate';
    const rows = m.rows
        .map((r, i) => `<div class="summary-row"><b>0${i + 1}</b><span>${escapeHtml(r.t)}<small>${escapeHtml(r.s)}</small></span></div>`)
        .join('');
    return (
        `<section class="summary${est ? ' est' : ''}">${segHtml(m)}` +
        (m.heading ? `<h3 class="summary-kick">${escapeHtml(m.heading)}</h3>` : '') +
        `<p class="summary-big" style="--n:${m.big.length}">${escapeHtml(m.big)}<small> kWh</small></p>${m.viz ? vizHtml(m.viz) : ''}` +
        (rows ? `<div class="summary-rows">${rows}</div>` : '') +
        (m.note ? `<p class="summary-note">${escapeHtml(m.note)}</p>` : '') +
        `</section>`
    );
}

/** Obsah karty podľa toho, čo appka o elektrárni vie. `neplati` je veta namiesto „meranie
 * neodpovedá“, keď výrobca prístup odmietol (shared/pristup.js).
 * @param {SummaryModel} m @param {boolean} noPanels @param {string | null} [neplati] @param {typeof STATISTIKA_TEXTS} [T] texty v tóne appky */
export function statsHtml(m, noPanels, neplati = null, T = STATISTIKA_TEXTS) {
    if (m.status === 'loading') return `<p class="stats-note">Načítavam…</p>`;
    const poster = posterHtml(m) || `<p class="stats-note">${escapeHtml(EMPTY_MESSAGES.forecast.body)}</p>`;
    // Bez zadaných panelov: namiesto výziev na ceny a meranie jediná - nastaviť si ich.
    if (noPanels)
        return poster + goHtml('nastavenie', 'Nastav si svoje panely', 'Štatistika je o tvojej elektrárni, nie o typickej streche.');
    const prices = m.priced ? '' : goHtml('ceny', T.pricesTitle, T.pricesText);
    if (m.kind === 'live') return poster + prices;
    const live =
        m.status === 'offline'
            ? `<p class="stats-note">${escapeHtml(neplati ?? 'Živé meranie teraz neodpovedá. Súčty za mesiac, rok a celý čas sa ukážu, keď sa spojenie obnoví.')}</p>`
            : goHtml('meranie', 'Pripojiť živé meranie', 'Súčty za mesiac, rok a celý čas posiela menič, keď ho pripojíš.');
    return poster + live + prices;
}

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
export function renderStatistika(state, dom) {
    dom.statsSub.textContent = `${state.site.name} · ${kwpText(installedKw(state.plant))}`;
    const neplati = neplatiOf(state)?.statistika ?? null;
    const m = summaryModel(state, state.statsPeriod, state.voice);
    writeHtml(dom.statsBody, statsHtml(m, state.known !== 'elektraren', neplati, voiceTexts(state.voice).STATISTIKA_TEXTS), 'statsBody');
}
