// Graf dňa v paneli zdola na karte Dnes (docs/navrhy/dnes-predpoved-graf.html, predtým karta Deň na karte
// Teraz): hore výkon a odkiaľ je, vpravo čas - teraz alebo zvolený. Pod tým krivka dňa (posúvač času),
// legenda a pätka s radou alebo „Späť na teraz“. Pozadie je obloha zvoleného času. Model je grafModel
// v shared/teraz.js, otvára ho karta Graf dňa v páse (render/mozem.js) - tu sa len zapisuje do DOM.

import { escapeHtml } from '../../shared/format.js';
import { DAY_CHART_KEYS, TERAZ_TONES, voiceTexts } from '../../shared/messages-core.js';
import { skyNow } from '../../shared/sky.js';
import { grafModel } from '../../shared/teraz.js';
import { dayChartHtml } from '../day-chart.js';
import { shows } from '../state.js';
import { kresliPocasie } from './teraz.js';
import { dialog, setHtml, setText, show } from './write.js';

/** @typedef {NonNullable<ReturnType<typeof grafModel>>} Model */
/** @typedef {import('../dom.js').Dom} Dom */

/** Legenda pod krivkou: farba a slovo. @param {Array<[string, string]>} items */
const legHtml = (items) => items.map(([l, t]) => `<span><i data-l="${l}"></i>${escapeHtml(t)}</span>`).join('');

/**
 * Obsah panelu: odčítanie, krivka (posúvač času), legenda a pätka.
 * @param {Model} g @param {Dom} dom @param {import('../../shared/messages.js').Voice} voice
 */
function renderObsah(g, dom, voice) {
    const T = voiceTexts(voice).TERAZ_TEXTS;
    const { den: d, chart: c } = g;
    const k = d.citanie;
    setHtml(
        dom.grCitanie,
        `<p class="c-kw"><b>${escapeHtml(k.kw)}</b><span>${escapeHtml(k.zdroj)}</span></p><p class="c-cas">${escapeHtml(k.cas)}</p>`,
    );
    setHtml(dom.grChart, dayChartHtml(c));
    dom.grChart.setAttribute('aria-label', T.slider);
    dom.grChart.setAttribute('aria-valuemin', String(c.range.min));
    dom.grChart.setAttribute('aria-valuemax', String(c.range.max));
    dom.grChart.setAttribute('aria-valuenow', String(c.value));
    dom.grChart.setAttribute('aria-valuetext', k.veta);
    setText(dom.grChartDesc, c.desc);
    setHtml(
        dom.grLeg,
        legHtml([
            ['power', DAY_CHART_KEYS.power],
            ['forecast', DAY_CHART_KEYS.forecast],
            ['limit', T.limit],
            ['go', TERAZ_TONES.sun],
            ['cheap', TERAZ_TONES.cheap],
            ['costly', TERAZ_TONES.costly],
        ]),
    );
    show(dom.grHint, !d.zvolene);
    setText(dom.grHint, T.hint);
    show(dom.grReset, d.zvolene);
    setText(dom.grReset, T.reset);
}

/**
 * Obloha zvoleného času za grafom (docs/navrhy/teraz-navrh-2.html): farby neba z toho istého výpočtu ako
 * pozadie appky (skyNow v tej chvíli) a tá istá kresba počasia - slnko podľa času na oblúku panelu,
 * oblaky, dážď, sneh, hviezdy a Mesiac. Farby prelína CSS (zaregistrované --d1 až --d3). S vypnutou
 * živou oblohou (Nastavenie › Vzhľad) je panel tmavý ako ostatné.
 * @param {import('../state.js').AppState} state @param {Model} g @param {Dom} dom
 */
function renderNebo(state, g, dom) {
    const p = state.liveSky ? g.pocasie : null;
    dom.grDen.classList.toggle('nebo', !!p);
    show(dom.grWx, !!p);
    if (!p) return;
    const sky = skyNow({ ...state, previewMinutes: state.terazPreview }, true, p);
    dom.grDen.style.setProperty('--d1', sky.top);
    dom.grDen.style.setProperty('--d2', sky.bottom);
    dom.grDen.style.setProperty('--d3', sky.shade);
    kresliPocasie(dom.grWx, p);
    const s = g.den.slnko;
    dom.grWx.style.setProperty('--wx-sx', s ? `${s.x}%` : '50%');
    dom.grWx.style.setProperty('--wx-sy', s ? `${s.y}%` : '130%');
}

/**
 * Panel s grafom dňa: otvorený, kým je v stave, karta Dnes je vidieť a je z čoho kresliť. Zatvorený
 * vráti fokus na kartu Graf dňa v páse. @param {import('../state.js').AppState} state @param {Dom} dom
 */
export function renderGraf(state, dom) {
    const open = state.mzGraf && shows(state, 'mozem');
    const g = open ? grafModel({ ...state, previewMinutes: state.terazPreview }, { voice: state.voice, devices: state.doma }) : null;
    if (g) {
        renderObsah(g, dom, state.voice);
        renderNebo(state, g, dom);
    }
    dialog(dom.grSheet, !!g, () => (shows(state, 'mozem') ? dom.mzKarty.querySelector('[data-kind="graf"] button') : null));
}
