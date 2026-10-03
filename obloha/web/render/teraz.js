// Karta Teraz novej appky: veľké číslo kW a veta pod ním, graf dňa s pásom plánu, náhľad iného
// času, pás odporúčaní do strán a výzvy. Všetko počíta shared/teraz.js (nad heroModel a dayPlan,
// tými istými ako karta Terazky súčasnej appky) a texty sú v shared/messages.js - tu sa len
// zapisuje do DOM.

import { escapeHtml } from '../../../shared/format.js';
import { TERAZ_TEXTS } from '../../../shared/messages.js';
import { DAY_CHART } from '../../../shared/day-chart.js';
import { terazModel } from '../../../shared/teraz.js';
import { setHtml, setText, show } from './write.js';

/** @typedef {import('../../../shared/teraz.js').TerazModel} Model */
/** @typedef {NonNullable<Model['chart']>} Chart */
/** @typedef {import('../dom.js').Dom} Dom */

/**
 * Graf dňa ako SVG: predpoveď (plocha), nameraná krivka (biela čiara), hranica veľkých
 * spotrebičov, pás plánu, hodiny, „teraz“ a náhľad so štítkom. Farby pásu sú v style.css podľa
 * `data-tone`; `data-from` nesie začiatok bunky (minúta dňa).
 * @param {Chart} c
 */
function chartSvg(c) {
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
    const now = `<line x1="${c.now.x}" x2="${c.now.x}" y1="14" y2="130" class="dc-now"/>${dot(c.now.y, c.now.x, 5, 'dc-now-dot')}`;
    const p = c.preview;
    const preview = p
        ? `<line x1="${p.x}" x2="${p.x}" y1="${C.top - 2}" y2="130" class="dc-prev"/>${dot(p.y, p.x, 6, 'dc-prev-dot')}` +
          `<rect x="${p.pill.x}" y="2" width="${p.pill.w}" height="18" rx="9" class="dc-pill"/>` +
          `<text x="${p.pill.x + p.pill.w / 2}" y="14.5" class="dc-pill-t">${escapeHtml(p.pill.text)}</text>`
        : '';
    return (
        `<svg viewBox="0 0 ${C.w} ${C.h}" aria-hidden="true">` +
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

/** Graf, legenda pod pásom a nápis s tlačidlom „Späť na teraz“. @param {Model} m @param {Dom} dom */
function renderChart(m, dom) {
    show(dom.tzPlot, !!m.chart);
    if (!m.chart) return;
    const c = m.chart;
    setHtml(dom.tzChart, chartSvg(c));
    dom.tzChart.setAttribute('aria-label', TERAZ_TEXTS.slider);
    dom.tzChart.setAttribute('aria-valuenow', String(c.value));
    dom.tzChart.setAttribute('aria-valuetext', c.valueText);
    setText(dom.tzChartDesc, c.desc);
    setHtml(dom.tzLegend, c.legend.map((l) => `<span data-tone="${l.tone}">${escapeHtml(l.text)}</span>`).join(''));
    setText(dom.tzHint, m.hint.text);
    show(dom.tzReset, m.hint.reset);
    setText(dom.tzReset, TERAZ_TEXTS.reset);
}

/** Pás odporúčaní a bodky pod ním. Pás listuje prehliadač, bodka ukazuje stránku zo stavu. @param {Model} m @param {number} page @param {Dom} dom */
function renderCards(m, page, dom) {
    show(dom.tzRecs, !!m.cards);
    if (!m.cards) return;
    const k = m.cards;
    dom.tzStrip.setAttribute('aria-label', TERAZ_TEXTS.strip);
    setText(dom.tzNowHead, k.now.head);
    setText(dom.tzNowBody, k.now.body);
    setText(dom.tzDevicesTitle, TERAZ_TEXTS.devices);
    setHtml(dom.tzDevices, k.devices.map((d) => `${escapeHtml(d.name)} <b>${escapeHtml(d.short)}</b>`).join(' · '));
    setText(dom.tzTodayTitle, TERAZ_TEXTS.today);
    setText(dom.tzToday, k.today.line);
    show(/** @type {HTMLElement} */ (dom.tzTodayBar.parentElement), k.today.pct !== null);
    dom.tzTodayBar.style.width = `${k.today.pct ?? 0}%`;
    setText(dom.tzWindow, k.today.window);
    setText(dom.tzLaterTitle, TERAZ_TEXTS.later);
    setText(dom.tzLater, k.later);
    [...dom.tzDots.children].forEach((dot, i) => dot.classList.toggle('on', i === page));
}

/** @param {import('../state.js').AppState} state @param {Dom} dom */
export function renderTeraz(state, dom) {
    if (state.panel !== 'terazky') return;
    const m = terazModel({ ...state, previewMinutes: state.terazPreview }, { launches: state.launches, online: state.online });
    show(dom.tzNum, m.num !== '');
    dom.tzNum.classList.toggle('est', m.estimate);
    setText(dom.tzNumVal, m.num);
    show(dom.tzSrc, m.source !== '');
    setText(dom.tzSrc, m.source);
    show(dom.tzSub, m.sub !== '');
    setText(dom.tzSub, m.sub);
    show(dom.tzRetry, m.retry);
    setText(dom.tzRetry, TERAZ_TEXTS.retry);
    show(dom.tzGuess, m.guess);
    setText(dom.tzGuessTitle, TERAZ_TEXTS.guessTitle);
    setText(dom.tzGuessText, TERAZ_TEXTS.guessText);
    setText(dom.tzGuessBtn, TERAZ_TEXTS.guessBtn);
    show(dom.tzAsk, m.ask);
    setText(dom.tzAskTitle, TERAZ_TEXTS.askTitle);
    setText(dom.tzAskText, TERAZ_TEXTS.askText);
    setText(dom.tzAskBtn, TERAZ_TEXTS.askBtn);
    renderChart(m, dom);
    renderCards(m, state.terazPage, dom);
}
