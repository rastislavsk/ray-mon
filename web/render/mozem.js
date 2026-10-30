// Karta Dnes (kódové meno mozem, doteraz Môžem?): dráha slnka a plagát s veľkým slovom, ktorý sa
// mení s časťou dňa (smer C v docs/navrhy/dnes-tri-smery.html) - ráno plán, cez deň odpočet okna
// na veľké veci, večer vysvedčenie dneška a pod ním zajtrajšok. Pod plagátom čo dá strecha za celý
// deň a kedy bude lepšie. Všetko skladá render do #mozem-body; počíta shared/mozem.js
// a shared/dnes-faza.js, texty sú v shared/messages.js.

import { escapeHtml } from '../../shared/format.js';
import { DNES_TEXTS } from '../../shared/messages-core.js';
import { dnesFaza } from '../../shared/dnes-faza.js';
import { sunArc } from '../../shared/mozem-sky.js';
import { mozemModel } from '../../shared/mozem.js';
import { writeHtml } from '../memo.js';
import { sunArcSvg } from '../sun-arc.js';

/** @typedef {ReturnType<typeof mozemModel>} MozemModel */
/** @typedef {import('../../shared/dnes-faza.js').DnesFaza} DnesFaza */
/** @typedef {import('../dom.js').Dom} Dom */

/** Veľké slovo: písmo sa zmenší podľa najdlhšieho slova a dĺžky hlášky (style.css). @param {string} word @param {string} cls */
function wordHtml(word, cls) {
    const len = Math.max(1, ...word.split(/\s+/).map((w) => w.length));
    return `<p class="mozem-word${cls}" style="--word-len: ${len}; --word-chars: ${Math.max(1, word.length)}">${escapeHtml(word)}</p>`;
}

/** Čo dá strecha za celý deň - tri čísla ako zoznam. @param {NonNullable<MozemModel['day']>} day */
const eqHtml = (day) =>
    `<ul class="mozem-eq">${day.eq.map((e) => `<li><b>${escapeHtml(e.value)}</b><span>${escapeHtml(e.label)}</span></li>`).join('')}</ul>`;

/**
 * Čo dá strecha za celý deň, bez predpovede veta, prečo karta nevie viac. Večer vysvedčenie povie
 * namerané presne - veta „Dnes zo strechy asi…“ by ho opakovala.
 * @param {MozemModel} m @param {boolean} graded
 */
function dayHtml(m, graded) {
    if (!m.day) return `<p class="mozem-lead">${escapeHtml(m.hero.lead)}</p>`;
    return (graded ? '' : `<p class="mozem-lead">${escapeHtml(m.day.lead)}</p>`) + eqHtml(m.day);
}

/** Časť plagátu podľa časti dňa: odpočet, vysvedčenie, veta a koľko už nabehlo. @param {DnesFaza} d */
function fazaHtml(d) {
    const count = d.count ? `<p class="mozem-count"><b>${escapeHtml(d.count.value)}</b><span>${escapeHtml(d.count.text)}</span></p>` : '';
    const grade = d.grade ? `<p class="mozem-grade"><span>${escapeHtml(d.grade.label)}</span><b>${escapeHtml(d.grade.value)}</b></p>` : '';
    const line = d.line ? `<p class="mozem-line">${escapeHtml(d.line)}</p>` : '';
    const progress = d.progress
        ? `<p class="mozem-line">${escapeHtml(d.progress.text)}</p>` +
          (d.progress.pct === null ? '' : `<div class="mozem-bar" aria-hidden="true"><i style="width: ${d.progress.pct}%"></i></div>`)
        : '';
    return { top: count + grade, bottom: line + progress };
}

/**
 * Plagát: riadok časti dňa, veľké slovo, odpočet či vysvedčenie a čo dá strecha za celý deň. Cez deň s odpočtom je slovo menšie - hlavná je odpoveď, dokedy svieti.
 * @param {MozemModel} m @param {DnesFaza | null} d
 */
export function mozemHtml(m, d) {
    // Farba plagátu hovorí to isté čo slovo - o celom dni. Bez dát farba stavu (načítava sa, nie sú).
    const tone = m.den ? `den-${m.den.cls}` : `st-${m.state}`;
    const parts = d ? fazaHtml(d) : { top: '', bottom: '' };
    const kick = d?.kick ? `<div class="mozem-kick">${escapeHtml(d.kick)}</div>` : '';
    const small = d?.count || d?.grade ? ' sm' : '';
    return (
        `<section class="mozem-hero ${tone}">${kick}${wordHtml(m.word, small)}${parts.top}` +
        `${dayHtml(m, !!d?.grade)}${parts.bottom}</section>`
    );
}

/** Zajtrajšok (večer) a riadok Kedy lepšie pod plagátom. @param {DnesFaza | null} d */
function mozemMoreHtml(d) {
    if (!d) return '';
    const t = d.tomorrow;
    const tomorrow = t
        ? `<section class="mozem-tom den-${t.cls}"><div class="mozem-kick">${escapeHtml(t.kick)}</div>` +
          `${wordHtml(t.word, ' sm')}<p class="mozem-lead">${escapeHtml(t.text)}</p></section>`
        : '';
    const later = d.later
        ? `<p class="mozem-later"><span class="mozem-later-k">${escapeHtml(DNES_TEXTS.later)}</span><span>${escapeHtml(d.later)}</span></p>`
        : '';
    return tomorrow + later;
}

/** @param {import('../state.js').AppState} state @param {Dom} dom */
export function renderMozem(state, dom) {
    const m = mozemModel(state, { voice: state.voice, devices: state.doma, ranna: state.ranna });
    const d =
        m.state === 'loading' ? null : dnesFaza(state, m.den, m.facts ? m.facts.window : null, { voice: state.voice, devices: state.doma });
    // Nad plagátom dráha slnka s časom východu a západu - tá istá ako v novej appke.
    const arc = sunArcSvg(sunArc(state.now, state.site, m.facts ? m.facts.window : null), m.state === 'offline');
    writeHtml(dom.mozemBody, `<div class="mozem-arc" aria-hidden="true">${arc}</div>${mozemHtml(m, d)}${mozemMoreHtml(d)}`, 'mozemBody');
}
