// Karta Teraz novej appky: veľké číslo kW a veta pod ním, štítky a veta o teraz, Plán dňa ako veta
// a časová os (docs/navrhy/terazky-plan-dna.html, možnosť B), graf dňa s pásom plánu, náhľad iného
// času a výzvy. Pás odporúčaní kreslí karta Dnes (render/mozem.js). Všetko počíta shared/teraz.js (nad heroModel a dayPlan,
// tými istými ako karta Terazky súčasnej appky) a texty sú v shared/messages.js - tu sa len
// zapisuje do DOM.

import { escapeHtml } from '../../../shared/format.js';
import { PLAN_DNA_TITLE, voiceTexts } from '../../../shared/messages-core.js';
import { terazModel } from '../../../shared/teraz.js';
import { dayChartHtml, legendHtml, readoutHtml } from '../../../web/day-chart.js';
import { shows } from '../state.js';
import { setHtml, setText, show } from './write.js';

/** @typedef {import('../../../shared/teraz.js').TerazModel} Model */
/** @typedef {import('../dom.js').Dom} Dom */
/** @typedef {ReturnType<typeof voiceTexts>} Texts pevné texty v tóne appky */

/**
 * Graf, „Späť na teraz“ a zoznam pod grafom: prvý riadok legendy, po otvorení farby pásu,
 * hodnoty v čase bodu grafu a nápis.
 * @param {Model} m @param {boolean} open @param {Dom} dom @param {Texts['TERAZ_TEXTS']} TERAZ_TEXTS
 */
function renderChart(m, open, dom, TERAZ_TEXTS) {
    show(dom.tzPlot, !!m.chart);
    if (!m.chart) return;
    const c = m.chart;
    setHtml(dom.tzChart, dayChartHtml(c));
    dom.tzChart.setAttribute('aria-label', TERAZ_TEXTS.slider);
    dom.tzChart.setAttribute('aria-valuemin', String(c.range.min));
    dom.tzChart.setAttribute('aria-valuemax', String(c.range.max));
    dom.tzChart.setAttribute('aria-valuenow', String(c.value));
    dom.tzChart.setAttribute('aria-valuetext', c.valueText);
    setText(dom.tzChartDesc, c.desc);
    setHtml(dom.tzLegend, legendHtml(c.keys));
    dom.tzListBtn.setAttribute('aria-expanded', String(open));
    show(dom.tzListBody, open);
    setHtml(dom.tzBands, legendHtml(c.bands));
    setText(dom.tzWhen, c.readout.when);
    setHtml(dom.tzValues, readoutHtml(c.readout.rows));
    setText(dom.tzHint, m.hint.text);
    show(dom.tzReset, m.hint.reset);
    setText(dom.tzReset, TERAZ_TEXTS.reset);
}

/** Štítky a veta o teraz pod číslom. @param {Model} m @param {Dom} dom */
function renderSay(m, dom) {
    show(dom.tzSay, !!m.say);
    setHtml(
        dom.tzChips,
        m.say ? m.say.chips.map((c) => `<span class="chip" data-tone="${c.tone}">${escapeHtml(c.text)}</span>`).join('') : '',
    );
    setText(dom.tzSayText, m.say ? m.say.text : '');
}

/**
 * Plán dňa ako veta a časová os: čo ide teraz, ďalšie dve veci s časom, pás každého spotrebiča
 * na dnešnom slnku s čiarou teraz a hodinami pod osou. Čo dnes na slnko nejde, je pod osou
 * ako štítok s časom. Bez plánu (bez predpovede, nič doma) nie je.
 * @param {Model['plan']} plan @param {Dom} dom
 */
function renderPlan(plan, dom) {
    show(dom.tzPlan, !!plan && plan.rows.length > 0);
    if (!plan || !plan.rows.length) return setHtml(dom.tzPlan, '');
    const { lanes, others, ticks, now } = plan.lanes;
    const rows = lanes
        .map(
            (l) =>
                `<li><span class="tl-n">${escapeHtml(l.name)}</span><span class="tl-track">` +
                `<i style="left:${l.left}%;width:${Math.max(l.width, 1)}%"></i></span></li>`,
        )
        .join('');
    const axis = ticks.map((t) => `<span style="left:${t.at}%">${t.label}</span>`).join('');
    const chips = others.map((o) => `<span class="tl-chip">${escapeHtml(o.name)} · ${escapeHtml(o.value)}</span>`).join('');
    setHtml(
        dom.tzPlan,
        `<h2 id="tz-plan-title" class="glass-ttl">${escapeHtml(PLAN_DNA_TITLE)}</h2>` +
            `<p class="tl-lead">${escapeHtml(plan.head.lead)}</p>` +
            (plan.head.then ? `<p class="tl-then">${escapeHtml(plan.head.then)}</p>` : '') +
            (lanes.length
                ? `<div class="tl" aria-hidden="true"><ul>${rows}</ul><div class="tl-axis">${axis}</div><span class="tl-now" style="--at:${now}"></span></div>`
                : '') +
            (chips ? `<div class="tl-chips">${chips}</div>` : '') +
            `<p class="tl-note">${escapeHtml(plan.note)}</p>`,
    );
}

/** @param {import('../state.js').AppState} state @param {Dom} dom */
export function renderTeraz(state, dom) {
    if (!shows(state, 'terazky')) return;
    const TERAZ_TEXTS = voiceTexts(state.voice).TERAZ_TEXTS;
    const m = terazModel(
        { ...state, previewMinutes: state.terazPreview },
        { online: state.online, voice: state.voice, devices: state.oznamenia.devices },
    );
    setText(dom.tzTitle, m.title);
    show(dom.tzNum, m.num !== '');
    dom.tzNum.classList.toggle('est', m.estimate);
    setText(dom.tzNumVal, m.num);
    show(dom.tzSrc, m.source !== '');
    setText(dom.tzSrc, m.source);
    show(dom.tzSub, m.sub !== '');
    setText(dom.tzSub, m.sub);
    show(dom.tzNote, !!m.note);
    setText(dom.tzNoteTitle, m.note?.title ?? '');
    setText(dom.tzNoteText, m.note?.text ?? '');
    show(dom.tzNoteBtn, !!m.note?.btn);
    setText(dom.tzNoteBtn, m.note?.btn ?? '');
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
    renderSay(m, dom);
    renderPlan(m.plan, dom);
    renderChart(m, state.tzListOpen, dom, TERAZ_TEXTS);
}
