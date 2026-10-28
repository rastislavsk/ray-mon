// Karta Teraz novej appky: veľké číslo kW a veta pod ním, štítky a veta o teraz, Plán dňa ako veta
// a časová os (docs/navrhy/terazky-plan-dna.html, možnosť B; večer na ďalší deň, plan-dna-zajtra.html), graf dňa s pásom plánu, náhľad iného
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
 * Časová os plánu: pás každého spotrebiča, hodiny pod osou, čiara teraz (pri ďalšom dni nie je)
 * a nad osou pruh s dňom, keď je os iného dňa (`strip`).
 * @param {Pick<NonNullable<Model['plan']>['lanes'], 'lanes' | 'ticks' | 'now'>} os @param {string} strip
 */
function axisHtml({ lanes, ticks, now }, strip) {
    const rows = lanes
        .map(
            (l) =>
                `<li><span class="tl-n">${escapeHtml(l.name)}</span><span class="tl-track">` +
                `<i style="left:${l.left}%;width:${Math.max(l.width, 1)}%"></i></span></li>`,
        )
        .join('');
    const axis = ticks.map((t) => `<span style="left:${t.at}%">${t.label}</span>`).join('');
    return (
        `<div class="tl" aria-hidden="true">` +
        (strip ? `<div class="tl-strip">${escapeHtml(strip)}</div>` : '') +
        `<ul>${rows}</ul><div class="tl-axis">${axis}</div>` +
        (now === null ? '' : `<span class="tl-now" style="--at:${now}"></span>`) +
        `</div>`
    );
}

/**
 * Plán dňa ako veta a časová os: čo ide teraz, ďalšie dve veci s časom, pás každého spotrebiča
 * na dnešnom slnku s čiarou teraz a hodinami pod osou. Čo dnes na slnko nejde, je pod osou
 * ako štítok s časom. Keď dnes na slnko nejde nič, plán ukáže ďalší deň so slnkom (`plan.next`):
 * deň v nadpise a nad osou, dnešnú lacnú sieť vetou, bez čiary teraz
 * (docs/navrhy/plan-dna-zajtra.html, návrh 1). Bez plánu (bez predpovede, nič doma) nie je.
 * Zbalený ukáže len nadpis a vetu v hlavičke, zvyšok je až po otvorení
 * (docs/navrhy/teraz-plan-rozbalovaci.html).
 * @param {Model['plan']} plan @param {boolean} open @param {Dom} dom
 */
function renderPlan(plan, open, dom) {
    show(dom.tzPlan, !!plan && plan.rows.length > 0);
    dom.tzPlanBtn.setAttribute('aria-expanded', String(open));
    show(dom.tzPlanBody, open);
    if (!plan || !plan.rows.length) return setHtml(dom.tzPlanBody, '');
    const next = plan.next;
    // Dnešok a ďalší deň majú ten istý tvar: nadpis, veta, os so štítkami a pätka.
    const v = next
        ? { ...next, title: `${escapeHtml(next.title)} <span class="tl-day">${escapeHtml(next.day)}</span>` }
        : { ...plan, head: { ...plan.head, tonight: '' }, strip: '', title: escapeHtml(PLAN_DNA_TITLE) };
    const { head, lanes } = v;
    const chips = lanes.others.map((o) => `<span class="tl-chip">${escapeHtml(o.name)} · ${escapeHtml(o.value)}</span>`).join('');
    setHtml(dom.tzPlanTitle, v.title);
    setText(dom.tzPlanLead, head.lead);
    setHtml(
        dom.tzPlanBody,
        (head.tonight ? `<p class="tl-tonight">${escapeHtml(head.tonight)}</p>` : '') +
            (head.then ? `<p class="tl-then">${escapeHtml(head.then)}</p>` : '') +
            (lanes.lanes.length ? axisHtml(lanes, v.strip) : '') +
            (chips ? `<div class="tl-chips">${chips}</div>` : '') +
            `<p class="tl-note">${escapeHtml(v.note)}</p>`,
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
    renderPlan(m.plan, state.tzPlanOpen, dom);
    renderChart(m, state.tzListOpen, dom, TERAZ_TEXTS);
}
