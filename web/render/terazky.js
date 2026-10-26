// Karta Terazky v rozložení karty Teraz z novej appky: číslo kW s riadkami pod ním, graf dňa s pásom
// plánu, náhľad iného času a pás odporúčaní. Všetko počíta shared/teraz.js - ten istý model ako
// v novej appke, takže obe povedia to isté - a texty sú v shared/messages-core.js. Tu sa len
// zapisuje do DOM. Farbu čísla a pozadia dáva style.css podľa data-tier (render/header.js).

import { escapeHtml, minutesToTimeStr } from '../../shared/format.js';
import { voiceTexts } from '../../shared/messages-core.js';
import { localMinutes } from '../../shared/solar.js';
import { terazModel } from '../../shared/teraz.js';
import { dayChartHtml, legendHtml, readoutHtml } from '../day-chart.js';
import { writeHtml } from '../memo.js';

/** @typedef {import('../../shared/teraz.js').TerazModel} Model */
/** @typedef {import('../dom.js').Dom} Dom */

const TERAZ_TEXTS = voiceTexts().TERAZ_TEXTS;

/** @param {HTMLElement} el @param {boolean} on */
const show = (el, on) => el.classList.toggle('hidden', !on);

/**
 * Riadok nad číslom: „Teraz · 08:13 · Dvorany“, počas náhľadu „O 12:15 · Dvorany“ - čas je už
 * v nadpise modelu. To isté ako riadok nad slovom na karte Môžem?.
 * @param {import('../state.js').AppState} state @param {Model} m
 */
function kick(state, m) {
    const time = state.previewMinutes === null ? ` · ${minutesToTimeStr(localMinutes(state.now, state.site.timezone))}` : '';
    return `${m.title}${time} · ${state.site.name}`;
}

/** Číslo a riadky pod ním. @param {import('../state.js').AppState} state @param {Model} m @param {Dom} dom */
function renderHead(state, m, dom) {
    dom.tzTitle.textContent = kick(state, m);
    show(dom.tzNum, m.num !== '');
    dom.tzNum.classList.toggle('est', m.estimate);
    dom.tzNumVal.textContent = m.num;
    show(dom.tzSrc, m.source !== '');
    dom.tzSrc.textContent = m.source;
    show(dom.tzSub, m.sub !== '');
    dom.tzSub.textContent = m.sub;
    show(dom.tzNote, !!m.note);
    dom.tzNoteTitle.textContent = m.note?.title ?? '';
    dom.tzNoteText.textContent = m.note?.text ?? '';
    show(dom.tzNoteBtn, !!m.note?.btn);
    dom.tzNoteBtn.textContent = m.note?.btn ?? '';
    dom.tzNoteBtn.toggleAttribute('data-pristup-go', !!m.note?.znova);
    show(dom.tzRetry, m.retry);
    dom.tzRetry.textContent = TERAZ_TEXTS.retry;
}

/**
 * Graf, „Späť na teraz“ a zoznam pod grafom: prvý riadok legendy, po otvorení farby pásu,
 * hodnoty v čase bodu grafu a nápis. @param {Model} m @param {boolean} open @param {Dom} dom
 */
function renderChart(m, open, dom) {
    show(dom.tzPlot, !!m.chart);
    if (!m.chart) return;
    const c = m.chart;
    writeHtml(dom.tzChart, dayChartHtml(c), 'tz-chart');
    dom.tzChart.setAttribute('aria-label', TERAZ_TEXTS.slider);
    dom.tzChart.setAttribute('aria-valuemin', String(c.range.min));
    dom.tzChart.setAttribute('aria-valuemax', String(c.range.max));
    dom.tzChart.setAttribute('aria-valuenow', String(c.value));
    dom.tzChart.setAttribute('aria-valuetext', c.valueText);
    dom.tzChartDesc.textContent = c.desc;
    writeHtml(dom.tzLegend, legendHtml(c.keys), 'tz-legend');
    dom.tzListBtn.setAttribute('aria-expanded', String(open));
    show(dom.tzListBody, open);
    writeHtml(dom.tzBands, legendHtml(c.bands), 'tz-bands');
    dom.tzWhen.textContent = c.readout.when;
    writeHtml(dom.tzValues, readoutHtml(c.readout.rows), 'tz-values');
    dom.tzHint.textContent = m.hint.text;
    show(dom.tzReset, m.hint.reset);
    dom.tzReset.textContent = TERAZ_TEXTS.reset;
}

/** Pás odporúčaní a bodky pod ním. Pás listuje prehliadač, bodka ukazuje stránku zo stavu.
 * @param {Model} m @param {number} page @param {Dom} dom */
function renderCards(m, page, dom) {
    show(dom.tzRecs, !!m.cards);
    if (!m.cards) return;
    const k = m.cards;
    dom.tzStrip.setAttribute('aria-label', TERAZ_TEXTS.strip);
    dom.tzNowHead.textContent = k.now.head;
    dom.tzNowBody.textContent = k.now.body;
    dom.tzDevicesTitle.textContent = TERAZ_TEXTS.devices;
    writeHtml(dom.tzDevices, k.devices.map((d) => `${escapeHtml(d.name)} <b>${escapeHtml(d.short)}</b>`).join(' · '), 'tz-devices');
    dom.tzTodayTitle.textContent = TERAZ_TEXTS.today;
    dom.tzToday.textContent = k.today.line;
    show(/** @type {HTMLElement} */ (dom.tzTodayBar.parentElement), k.today.pct !== null);
    dom.tzTodayBar.style.width = `${k.today.pct ?? 0}%`;
    dom.tzWindow.textContent = k.today.window;
    dom.tzLaterTitle.textContent = TERAZ_TEXTS.later;
    dom.tzLater.textContent = k.later;
    [...dom.tzDots.children].forEach((dot, i) => dot.classList.toggle('on', i === page));
}

/** @param {import('../state.js').AppState} state @param {Dom} dom */
export function renderTerazky(state, dom) {
    const m = terazModel(state);
    renderHead(state, m, dom);
    renderChart(m, state.tzListOpen, dom);
    renderCards(m, state.terazPage, dom);
}
