// Karta Štatistika novej appky: plagát obdobia - prepínač, veľké číslo kWh, obrázok dní, očíslované
// riadky a poznámka - a pod ním výzvy. Odkaz na plagát mesiaca na karte Môžem? kreslí tiež. Všetko
// počíta shared/statistika.js (plagát shared/summary.js, ten istý ako v súčasnej appke) a texty sú
// v shared/messages.js - tu sa len zapisuje do DOM.

import { escapeHtml, monthNameShort } from '../../../shared/format.js';
import { statsLinkText, voiceTexts } from '../../../shared/messages.js';
import { neplatiOf } from '../../../shared/pristup.js';
import { STATS_PERIODS } from '../../../shared/stats.js';
import { statistikaModel } from '../../../shared/statistika.js';
import { summaryModel } from '../../../shared/summary.js';
import { shows } from '../state.js';
import { setHtml, setText, show } from './write.js';

/** @typedef {import('../dom.js').Dom} Dom */
/** @typedef {ReturnType<typeof voiceTexts>} Texts pevné texty v tóne appky */
/** @typedef {Texts['STATISTIKA_TEXTS']} T */
/** @typedef {import('../../../shared/summary.js').SummaryModel} Summary */

/** Prepínač obdobia na plagáte; bez merania sa dá vybrať len dnešok. @param {Summary} m @param {T} T */
const segHtml = (m, T) =>
    `<div class="seg pseg" role="group" aria-label="${escapeHtml(T.periodsLabel)}">` +
    STATS_PERIODS.map(
        (p) =>
            `<button type="button" data-period="${p}" aria-pressed="${p === m.period}"${!m.periods && p !== 'dnes' ? ' disabled' : ''}>` +
            `${escapeHtml(T.periods[p])}</button>`,
    ).join('') +
    '</div>';

/**
 * Obrázok pod veľkým číslom: pás, štvorčeky dní mesiaca, stĺpce mesiacov roka. Chýbajúci deň či
 * mesiac je len obrys, mesiac s chýbajúcimi dňami má prerušovaný obrys, budúci deň tenký obrys.
 * @param {NonNullable<Summary['viz']>} viz
 */
function vizHtml(viz) {
    if (viz.kind === 'meter')
        return (
            `<div class="pmeter"><div class="ptrack" aria-hidden="true"><i style="width:${viz.pct}%"></i></div>` +
            `<p><span>${escapeHtml(viz.left)}</span><span>${escapeHtml(viz.right)}</span></p></div>`
        );
    if (viz.kind === 'days')
        return (
            '<div class="pcal" aria-hidden="true">' +
            viz.days
                .map((d) =>
                    d.future
                        ? '<i class="future"></i>'
                        : d.frac === null
                          ? '<i class="missing"></i>'
                          : `<i style="opacity:${(0.15 + d.frac * 0.85).toFixed(2)}"></i>`,
                )
                .join('') +
            '</div>'
        );
    return (
        '<div class="cols" aria-hidden="true">' +
        viz.months
            .map((m) => {
                const cls = m.frac === null && !m.future ? 'missing' : [m.best ? 'best' : '', m.partial ? 'partial' : ''].join(' ').trim();
                const h = m.future ? 0 : m.frac === null ? 30 : Math.max(4, Math.round(m.frac * 100));
                return `<span><i${cls ? ` class="${cls}"` : ''} style="height:${h}%"></i>${escapeHtml(monthNameShort(m.month).charAt(0))}</span>`;
            })
            .join('') +
        '</div>'
    );
}

/** Plagát obdobia. @param {Summary} m @param {T} T */
function posterHtml(m, T) {
    const kwh = `${m.big} kWh`;
    const rows = m.rows
        .map((r, i) => `<p class="prow"><b>0${i + 1}</b><span>${escapeHtml(r.t)}<small>${escapeHtml(r.s)}</small></span></p>`)
        .join('');
    return (
        segHtml(m, T) +
        (m.heading ? `<h2>${escapeHtml(m.heading)}</h2>` : '') +
        `<p class="pn${m.kind === 'estimate' ? ' est' : ''}" style="--n:${kwh.length}">${escapeHtml(kwh)}</p>` +
        (m.viz ? vizHtml(m.viz) : '') +
        (rows ? `<div class="prows">${rows}</div>` : '') +
        (m.note ? `<p class="pnote">${escapeHtml(m.note)}</p>` : '')
    );
}

/** Výzvy a stavy bez čísel: bez polohy, bez panelov, načítavanie, bez dát. @param {import('../../../shared/statistika.js').StatistikaModel} m @param {Dom} dom @param {T} T */
function renderStates(m, dom, T) {
    show(dom.stSub, m.sub !== '');
    setText(dom.stSub, m.sub);
    show(dom.stRetry, m.retry);
    setText(dom.stRetry, T.retry);
    show(dom.stAsk, m.kind === 'ask');
    setText(dom.stAskTitle, T.askTitle);
    setText(dom.stAskText, T.askText);
    setText(dom.stAskBtn, T.askBtn);
    // Biela výzva bez panelov; tlačidlo pri každom vstupe na kartu trikrát zapulzuje (CSS animácia
    // sa spustí vždy, keď sa prvok ukáže) a zastaví sa.
    show(dom.stSetup, m.kind === 'setup');
    setText(dom.stSetupTitle, T.setupTitle);
    setText(dom.stSetupText, T.setupText);
    setText(dom.stSetupBtn, T.setupBtn);
    setText(dom.stLaterTitle, T.laterTitle);
    setText(dom.stLaterText, T.laterText);
}

/** Výzvy pod plagátom: meranie a ceny. `neplati` je veta namiesto „meranie neodpovedá“, keď výrobca
 * prístup odmietol (shared/pristup.js).
 * @param {import('../../../shared/statistika.js').StatistikaModel} m @param {Dom} dom @param {T} T @param {string | null} neplati */
function renderCtas(m, dom, T, neplati) {
    show(dom.stMeasureOff, m.measure === 'off');
    setText(dom.stMeasureOff, neplati ?? T.measureOff);
    show(dom.stMeasure, m.measure === 'ask');
    setText(dom.stMeasureTitle, T.measureTitle);
    setText(dom.stMeasureText, T.measureText);
    setText(dom.stMeasureBtn, T.measureBtn);
    show(dom.stPrices, m.prices);
    setText(dom.stPricesTitle, T.pricesTitle);
    setText(dom.stPricesText, T.pricesText);
    setText(dom.stPricesBtn, T.pricesBtn);
}

/** Odkaz na karte Môžem?: mesiac na streche, vedie na plagát v Štatistike. Bez merania nie je. @param {import('../state.js').AppState} state @param {Dom} dom */
function renderMozemLink(state, dom) {
    const link = shows(state, 'mozem') ? summaryModel(state, 'mesiac', state.voice) : null;
    const on = !!link && link.kind === 'live' && link.kwh !== null;
    show(dom.mzSummary, on);
    setText(dom.mzSummaryText, on ? statsLinkText(link.kick, /** @type {number} */ (link.kwh)) : '');
}

/** @param {import('../state.js').AppState} state @param {Dom} dom */
export function renderStatistika(state, dom) {
    renderMozemLink(state, dom);
    if (state.panel !== 'statistika') return;
    const T = voiceTexts(state.voice).STATISTIKA_TEXTS;
    const m = statistikaModel(state, state.statsPeriod, { online: state.online, voice: state.voice });
    renderStates(m, dom, T);
    show(dom.stBody, m.kind === 'ok');
    if (m.kind !== 'ok') return;
    show(dom.stPoster, !!m.summary);
    dom.stPoster.classList.toggle('est', m.summary?.kind === 'estimate');
    setHtml(dom.stPoster, m.summary ? posterHtml(m.summary, T) : '');
    renderCtas(m, dom, T, neplatiOf(state)?.statistika ?? null);
}
