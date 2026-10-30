// Karta Teraz súčasnej appky v rozložení karty Teraz z novej appky: číslo kW s riadkami pod ním, štítky a veta
// o teraz, Plán dňa ako plagát (docs/navrhy/terazky-plan-dna.html, možnosť A; večer na ďalší deň,
// plan-dna-zajtra.html), graf dňa s pásom
// plánu a náhľad iného času. Pás odporúčaní kreslí karta Dnes (render/mozem.js). Všetko počíta shared/teraz.js - ten istý model ako
// v novej appke, takže obe povedia to isté - a texty sú v shared/messages-core.js. Tu sa len
// zapisuje do DOM. Farbu čísla a pozadia dáva style.css podľa data-tier (render/header.js).

import { escapeHtml } from '../../shared/format.js';
import { PLAN_DNA_NOW, PLAN_DNA_TITLE, voiceTexts } from '../../shared/messages-core.js';
import { terazModel } from '../../shared/teraz.js';
import { dayChartHtml, legendHtml, readoutHtml } from '../day-chart.js';
import { writeHtml } from '../memo.js';

/** @typedef {import('../../shared/teraz.js').TerazModel} Model */
/** @typedef {import('../dom.js').Dom} Dom */

/** Pevné texty karty v tóne appky. @param {import('../state.js').AppState} state */
const textsOf = (state) => voiceTexts(state.voice).TERAZ_TEXTS;

/** @param {HTMLElement} el @param {boolean} on */
const show = (el, on) => el.classList.toggle('hidden', !on);

/** Číslo a riadky pod ním. @param {import('../state.js').AppState} state @param {Model} m @param {Dom} dom */
function renderHead(state, m, dom) {
    // Len „Teraz“, počas náhľadu „O 12:15“ - čas a miesto ukazuje hlavička, ako v novej appke.
    dom.tzTitle.textContent = m.title;
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
    dom.tzRetry.textContent = textsOf(state).retry;
}

/**
 * Graf, „Späť na teraz“ a zoznam pod grafom: prvý riadok legendy, po otvorení farby pásu,
 * hodnoty v čase bodu grafu a nápis. @param {Model} m @param {boolean} open @param {Dom} dom
 * @param {ReturnType<typeof textsOf>} TERAZ_TEXTS
 */
function renderChart(m, open, dom, TERAZ_TEXTS) {
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

/** Štítky a veta o teraz pod číslom. @param {Model} m @param {Dom} dom */
function renderSay(m, dom) {
    show(dom.tzSay, !!m.say);
    if (!m.say) return;
    writeHtml(
        dom.tzChips,
        m.say.chips.map((c) => `<span class="tz-chip" data-tone="${c.tone}">${escapeHtml(c.text)}</span>`).join(''),
        'tz-chips',
    );
    dom.tzSayText.textContent = m.say.text;
}

/**
 * Plán dňa ako plagát: veta, čo ide teraz, očíslované riadky (spotrebič, čas alebo „teraz“, prečo)
 * a pätka. Bez plánu (bez predpovede, nič doma) nie je. Zbalený ukáže len nadpis a vetu v hlavičke,
 * riadky a pätka sú až po otvorení (docs/navrhy/teraz-plan-rozbalovaci.html). Keď dnes na slnko
 * nejde nič, plagát je plán na ďalší deň so slnkom (`plan.next`): deň v nadpise, veta a riadky
 * o tom dni, dnešná lacná sieť jednou vetou nad riadkami (docs/navrhy/plan-dna-zajtra.html).
 * @param {Model['plan']} plan @param {boolean} open @param {Dom} dom
 */
function renderPlan(plan, open, dom) {
    show(dom.tzPlan, !!plan && plan.rows.length > 0);
    dom.tzPlanBtn.setAttribute('aria-expanded', String(open));
    show(dom.tzPlanBody, open);
    if (!plan || !plan.rows.length) return;
    const next = plan.next;
    // Dnešok a ďalší deň majú ten istý tvar: nadpis, veta, riadky a pätka.
    const v = next
        ? { ...next, title: `${escapeHtml(next.title)} <span class="tz-plan-day">${escapeHtml(next.day)}</span>` }
        : { ...plan, head: { ...plan.head, tonight: '' }, title: escapeHtml(PLAN_DNA_TITLE) };
    const rows = v.rows.map(
        (r, i) =>
            `<li data-tone="${r.tone}"><span class="tz-plan-n">${String(i + 1).padStart(2, '0')}</span>` +
            `<span class="tz-plan-what">${escapeHtml(r.name)}</span>` +
            `<span class="tz-plan-when">${r.now ? `<em>${escapeHtml(PLAN_DNA_NOW)}</em>` : escapeHtml(r.value)}</span>` +
            `<span class="tz-plan-why">${escapeHtml(r.why)}</span></li>`,
    );
    writeHtml(dom.tzPlanTitle, v.title, 'tz-plan-title');
    dom.tzPlanLead.textContent = v.head.lead;
    writeHtml(
        dom.tzPlanBody,
        (v.head.tonight ? `<p class="tz-plan-tonight">${escapeHtml(v.head.tonight)}</p>` : '') +
            `<ol class="tz-plan-rows">${rows.join('')}</ol><p class="tz-plan-note">${escapeHtml(v.note)}</p>`,
        'tz-plan',
    );
}

/** @param {import('../state.js').AppState} state @param {Dom} dom */
export function renderTerazky(state, dom) {
    const m = terazModel(state, { voice: state.voice, devices: state.doma });
    renderHead(state, m, dom);
    renderSay(m, dom);
    renderPlan(m.plan, state.tzPlanOpen, dom);
    renderChart(m, state.tzListOpen, dom, textsOf(state));
}
