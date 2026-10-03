// Karta Teraz novej appky: veľké číslo kW a veta pod ním, graf dňa s pásom plánu, náhľad iného
// času, pás odporúčaní do strán a výzvy. Všetko počíta shared/teraz.js (nad heroModel a dayPlan,
// tými istými ako karta Terazky súčasnej appky) a texty sú v shared/messages.js - tu sa len
// zapisuje do DOM.

import { escapeHtml } from '../../../shared/format.js';
import { voiceTexts } from '../../../shared/messages-core.js';
import { terazModel } from '../../../shared/teraz.js';
import { dayChartHtml, legendHtml } from './day-chart.js';
import { shows } from '../state.js';
import { setHtml, setText, show } from './write.js';

/** @typedef {import('../../../shared/teraz.js').TerazModel} Model */
/** @typedef {import('../dom.js').Dom} Dom */
/** @typedef {ReturnType<typeof voiceTexts>} Texts pevné texty v tóne appky */

/** Graf, legenda pod pásom a nápis s tlačidlom „Späť na teraz“. @param {Model} m @param {Dom} dom @param {Texts['TERAZ_TEXTS']} TERAZ_TEXTS */
function renderChart(m, dom, TERAZ_TEXTS) {
    show(dom.tzPlot, !!m.chart);
    if (!m.chart) return;
    const c = m.chart;
    setHtml(dom.tzChart, dayChartHtml(c));
    dom.tzChart.setAttribute('aria-label', TERAZ_TEXTS.slider);
    dom.tzChart.setAttribute('aria-valuenow', String(c.value));
    dom.tzChart.setAttribute('aria-valuetext', c.valueText);
    setText(dom.tzChartDesc, c.desc);
    setHtml(dom.tzLegend, legendHtml(c.legend));
    setText(dom.tzHint, m.hint.text);
    show(dom.tzReset, m.hint.reset);
    setText(dom.tzReset, TERAZ_TEXTS.reset);
}

/** Pás odporúčaní a bodky pod ním. Pás listuje prehliadač, bodka ukazuje stránku zo stavu. @param {Model} m @param {number} page @param {Dom} dom
 * @param {Texts['TERAZ_TEXTS']} TERAZ_TEXTS */
function renderCards(m, page, dom, TERAZ_TEXTS) {
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
    if (!shows(state, 'terazky')) return;
    const TERAZ_TEXTS = voiceTexts(state.voice).TERAZ_TEXTS;
    const m = terazModel(
        { ...state, previewMinutes: state.terazPreview },
        { launches: state.launches, online: state.online, voice: state.voice },
    );
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
    renderChart(m, dom, TERAZ_TEXTS);
    renderCards(m, state.terazPage, dom, TERAZ_TEXTS);
}
