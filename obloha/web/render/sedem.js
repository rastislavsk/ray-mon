// Karta 7 dní novej appky: prehľad dní ako predpoveď počasia (nadpis s najlepším dňom, súčet
// týždňa, riadky so zeleným pásom okna), detail dňa s grafom z karty Teraz a detail týždňa so
// stĺpcami a mapou hodina × deň. Všetko počíta shared/sedem-dni.js (nad modelmi karty 7 dní
// súčasnej appky) a texty sú v shared/messages.js - tu sa len zapisuje do DOM.

import { escapeHtml } from '../../../shared/format.js';
import { SEDEM_TEXTS } from '../../../shared/messages.js';
import { sedemDayModel, sedemModel, sedemWeekModel, WEEK_BARS, WEEK_HEAT } from '../../../shared/sedem-dni.js';
import { dayChartSvg, legendHtml } from './day-chart.js';
import { weatherIcon } from './icons.js';
import { setHtml, setText, show } from './write.js';

/** @typedef {import('../dom.js').Dom} Dom */
/** @typedef {import('../state.js').AppState} AppState */
/** @typedef {import('../../../shared/sedem-dni.js').SedemData} SedemData */

/**
 * Riadky dní. Riadok je tlačidlo s celým znením pre čítačku; zelený pás má toľko úsekov, koľko
 * okien deň má, bez okna je prázdny. Ikona je ozdoba, deň bez oblačnosti v dátach ju nemá.
 * @param {import('../../../shared/sedem-dni.js').SedemModel['rows']} rows
 */
function rowsHtml(rows) {
    return rows
        .map(
            (r) =>
                `<button type="button" class="day${r.best ? ' best' : ''}" data-day="${r.index}" aria-label="${escapeHtml(r.label)}">` +
                `<span class="dn">${escapeHtml(r.name)}</span>` +
                (r.weather ? weatherIcon(r.weather) : '<span class="wi"></span>') +
                `<span class="rng">${r.band.map((b) => `<i style="left:${b.left}%;width:${b.width}%"></i>`).join('')}</span>` +
                `<em>${escapeHtml(r.kwh)}</em></button>`,
        )
        .join('');
}

/** Tri čísla v detaile: veľké číslo a popisok pod ním. @param {Array<{ value: string, label: string }>} nums */
const numsHtml = (nums) => nums.map((n) => `<div><b>${escapeHtml(n.value)}</b>${escapeHtml(n.label)}</div>`).join('');

/** Prehľad dní, výzvy a stavy bez dát. @param {ReturnType<typeof sedemModel>} m @param {Dom} dom */
function renderList(m, dom) {
    const ok = m.kind === 'ok';
    show(dom.sdTitle, m.kind !== 'ask');
    setText(dom.sdTitle, m.title);
    show(dom.sdSum, ok);
    setText(dom.sdSumText, m.sum);
    show(dom.sdSub, m.sub !== '');
    setText(dom.sdSub, m.sub);
    show(dom.sdRetry, m.retry);
    setText(dom.sdRetry, SEDEM_TEXTS.retry);
    show(dom.sdAsk, m.ask);
    setText(dom.sdAskTitle, SEDEM_TEXTS.askTitle);
    setText(dom.sdAskText, SEDEM_TEXTS.askText);
    setText(dom.sdAskBtn, SEDEM_TEXTS.askBtn);
    show(dom.sdGuess, m.guess !== null);
    setText(dom.sdGuessTitle, SEDEM_TEXTS.guessTitle);
    setText(dom.sdGuessText, m.guess ?? '');
    setText(dom.sdGuessBtn, SEDEM_TEXTS.guessBtn);
    show(dom.sdDays, ok);
    dom.sdDays.classList.toggle('est', m.estimate);
    setHtml(dom.sdDays, rowsHtml(m.rows));
    show(dom.sdHint, ok);
    setText(dom.sdHint, SEDEM_TEXTS.hint);
}

/** Detail dňa. @param {SedemData} data @param {number} index @param {Dom} dom */
function renderDay(data, index, dom) {
    const d = sedemDayModel(data, index);
    setText(dom.sdDayBackText, SEDEM_TEXTS.back);
    setText(dom.sdDayTitle, d.title);
    setHtml(dom.sdDayIcon, d.weather ? weatherIcon(d.weather) : '');
    show(dom.sdDaySub, d.sub !== '');
    setText(dom.sdDaySub, d.sub);
    dom.sdDayNums.classList.toggle('est', data.known === 'poloha');
    setHtml(dom.sdDayNums, numsHtml(d.nums));
    setHtml(dom.sdDayChart, dayChartSvg(d.chart));
    dom.sdDayChart.setAttribute('aria-label', d.chart.desc);
    setHtml(dom.sdDayLegend, legendHtml(d.chart.legend));
    for (const [el, text] of /** @type {const} */ ([
        [dom.sdDayDone, d.done],
        [dom.sdDayClear, d.clear],
        [dom.sdDayPrice, d.price ?? ''],
    ])) {
        show(el, text !== '');
        setText(el, text);
    }
    show(dom.sdDayFacts, !!(d.done || d.clear || d.price));
    setText(dom.sdDayMsgTitle, d.message.title);
    setText(dom.sdDayMsgBody, d.message.body);
    setText(dom.sdDayHint, SEDEM_TEXTS.dayHint);
}

/** Stĺpce dní ako SVG: najlepší zelený, ostatné biele priesvitné, nad stĺpcom kWh. @param {ReturnType<typeof sedemWeekModel>['bars']} bars */
function barsSvg(bars) {
    const B = WEEK_BARS;
    const cols = bars
        .map(
            (b) =>
                `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="5" class="wb${b.best ? ' best' : ''}"/>` +
                `<text x="${b.cx}" y="${b.y - 6}" class="wb-v">${escapeHtml(b.value)}</text>` +
                `<text x="${b.cx}" y="${B.labelY}" class="wb-n">${escapeHtml(b.name)}</text>`,
        )
        .join('');
    return `<svg viewBox="0 0 ${B.w} ${B.h}" aria-hidden="true">${cols}</svg>`;
}

/** Mapa hodina × deň ako SVG. @param {ReturnType<typeof sedemWeekModel>['heat']} h */
function heatSvg(h) {
    const hours = h.hours.map((t) => `<text x="${t.x}" y="10" class="hm-t">${t.label}</text>`).join('');
    const days = h.days.map((t) => `<text x="0" y="${t.y}" class="hm-d">${escapeHtml(t.label)}</text>`).join('');
    const cells = h.cells
        .map(
            (c) =>
                `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="3" class="hc${c.sun ? ' sun' : ''}" fill-opacity="${c.opacity}"/>`,
        )
        .join('');
    return `<svg viewBox="0 0 ${WEEK_HEAT.w} ${h.h}" aria-hidden="true">${hours}${days}${cells}</svg>`;
}

/** Detail týždňa. @param {SedemData} data @param {Dom} dom */
function renderWeek(data, dom) {
    const w = sedemWeekModel(data);
    setText(dom.sdWeekBackText, SEDEM_TEXTS.back);
    setText(dom.sdWeekTitle, SEDEM_TEXTS.weekTitle);
    setText(dom.sdWeekRange, w.range);
    dom.sdWeekNums.classList.toggle('est', data.known === 'poloha');
    setHtml(dom.sdWeekNums, numsHtml(w.nums));
    setText(dom.sdBarsTitle, SEDEM_TEXTS.bars);
    setHtml(dom.sdBars, barsSvg(w.bars));
    dom.sdBars.setAttribute('aria-label', w.barsText);
    setText(dom.sdHeatTitle, SEDEM_TEXTS.heat);
    setHtml(dom.sdHeat, heatSvg(w.heat));
    dom.sdHeat.setAttribute('aria-label', w.heatText);
    setText(dom.sdHeatNote, SEDEM_TEXTS.heatNote);
    setText(dom.sdWeekMsgTitle, w.message.title);
    setText(dom.sdWeekMsgBody, w.message.body);
    setText(dom.sdWeekHint, SEDEM_TEXTS.weekHint);
}

/**
 * Odkiaľ sa otvorený detail otvoril: riadok dňa (index) alebo súčet týždňa, a posun prehľadu
 * v tej chvíli. Po návrate (‹ 7 dní, Späť, Escape, ťah) sa prehľad posunie, kde bol, a fokus
 * sa vráti na to tlačidlo. @type {{ from: number | 'week', y: number } | null}
 */
let opened = null;

/**
 * Otvorenie a zatvorenie detailu: detail začína hore s fokusom na „‹ 7 dní“, prehľad sa po
 * návrate vráti na svoje miesto.
 * @param {AppState} state @param {'day' | 'week' | null} detail @param {Dom} dom
 */
function moveFocus(state, detail, dom) {
    if (detail && !opened) {
        opened = { from: detail === 'week' ? 'week' : state.weekDay, y: window.scrollY };
        window.scrollTo(0, 0);
        (detail === 'week' ? dom.sdWeekBack : dom.sdDayBack).focus({ preventScroll: true });
    } else if (!detail && opened) {
        const { from, y } = opened;
        opened = null;
        window.scrollTo(0, y);
        const to = from === 'week' ? dom.sdSum : dom.sdDays.querySelector(`[data-day="${from}"]`);
        if (to instanceof HTMLElement) to.focus({ preventScroll: true });
    }
}

/** @param {AppState} state @param {Dom} dom */
export function renderSedem(state, dom) {
    // Detail patrí karte 7 dní; s inou kartou sa zatvára a návrat na pôvodné miesto prepadá.
    if (state.panel !== '7dni') return void (opened = null);
    const m = sedemModel(state, { online: state.online });
    // Detail má zmysel len s predpoveďou; bez nej ostáva prehľad so stavom karty.
    const data = m.kind === 'ok' ? /** @type {SedemData} */ (state) : null;
    const detail = data ? state.weekDetail : null;
    show(dom.sdList, !detail);
    show(dom.sdDay, detail === 'day');
    show(dom.sdWeek, detail === 'week');
    renderList(m, dom);
    if (data && detail === 'day') renderDay(data, Math.min(state.weekDay, data.forecast.days.length - 1), dom);
    if (data && detail === 'week') renderWeek(data, dom);
    moveFocus(state, detail, dom);
}
