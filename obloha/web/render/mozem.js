// Karta Dnes novej appky (kódové meno mozem, doteraz Môžem?): oblúk slnka, veľké slovo, čo dá
// strecha za celý deň, výzvy a pás odporúčaní (docs/navrhy/dnes-a-teraz.html). Všetko počíta
// shared/mozem-sky.js a shared/teraz.js, texty sú v shared/messages.js - tu sa len zapisuje do DOM.

import { escapeHtml, minutesToTimeStr } from '../../../shared/format.js';
import { voiceTexts } from '../../../shared/messages-core.js';
import { mozemSkyModel } from '../../../shared/mozem-sky.js';
import { dnesCards } from '../../../shared/teraz.js';
import { shows } from '../state.js';
import { setHtml, setText, show } from './write.js';

/** @typedef {import('../../../shared/mozem-sky.js').MozemSkyModel} Model */
/** @typedef {import('../dom.js').Dom} Dom */

/**
 * Veľkosť veľkého slova v px podľa jeho dĺžky, ako v návrhu: krátke slovo najväčšie. Na úzkom
 * displeji ho štýl zmenší ešte podľa najdlhšieho slova v ňom (`--word-len`), aby sa nikdy
 * neorezalo. @param {string} word
 */
export function wordSize(word) {
    return word.length <= 7 ? 66 : word.length <= 11 ? 50 : 42;
}

// Oblúk v súradniciach návrhu: polovica elipsy nad obzorom, východ vľavo, západ vpravo.
const ARC = { cx: 160, cy: 118, rx: 140, ry: 88 };
const MOON = { x: 262, y: 42 };

/** Bod na oblúku, 0 = východ, 1 = západ. @param {number} f */
function arcPoint(f) {
    const a = Math.PI * (1 - f);
    return `${(ARC.cx + ARC.rx * Math.cos(a)).toFixed(1)} ${(ARC.cy - ARC.ry * Math.sin(a)).toFixed(1)}`;
}

/**
 * Oblúk slnka: prerušovaná dráha, zelený úsek dnešného okna, slnko na dráhe (v noci mesiac)
 * a časy východu a západu. Bez dát je slnko len sivý kruh a okno nie je.
 * @param {NonNullable<Model['arc']>} arc @param {boolean} off
 */
function arcSvg(arc, off) {
    const { cx, cy, rx, ry } = ARC;
    const win =
        arc.win && arc.win.to > arc.win.from
            ? `<path class="arc-win" d="M${arcPoint(arc.win.from)} A${rx} ${ry} 0 0 1 ${arcPoint(arc.win.to)}"/>`
            : '';
    const at = arc.sun === null ? `${MOON.x} ${MOON.y}` : arcPoint(arc.sun);
    const body = off
        ? '<circle r="12" class="arc-off"/>'
        : arc.sun === null
          ? '<circle r="11" class="arc-moon"/><circle cx="6" cy="-4" r="9" class="arc-moon-cut"/>'
          : '<circle r="24" class="arc-glow"/><circle r="13" class="arc-sun"/>';
    const label = (/** @type {number | null} */ m, /** @type {number} */ x) =>
        m === null ? '' : `<text x="${x}" y="130" class="arc-t">${minutesToTimeStr(m)}</text>`;
    return (
        `<svg viewBox="0 0 320 132"><path class="arc-path" d="M${cx - rx} ${cy} A${rx} ${ry} 0 0 1 ${cx + rx} ${cy}"/>${win}` +
        `<line x1="0" y1="${cy}" x2="320" y2="${cy}" class="arc-ground"/>${label(arc.rise, cx - rx)}${label(arc.set, cx + rx)}` +
        `<g transform="translate(${at})">${body}</g></svg>`
    );
}

/** Hlavná časť karty. @param {Model} m @param {Dom} dom @param {import('../../../shared/messages.js').Voice} voice */
function renderCard(m, dom, voice) {
    const MOZEM_SKY_TEXTS = voiceTexts(voice).MOZEM_SKY_TEXTS;
    show(dom.mzArc, !!m.arc);
    if (m.arc) setHtml(dom.mzArc, arcSvg(m.arc, m.state === 'offline'));
    show(dom.mzAnswer, !m.ask);
    setText(dom.mzWord, m.word);
    dom.mzWord.style.setProperty('--word', `${wordSize(m.word)}px`);
    dom.mzWord.style.setProperty('--word-len', String(Math.max(1, ...m.word.split(/\s+/).map((w) => w.length))));
    // S predpoveďou na dnešok namiesto vety čo dá strecha za celý deň.
    show(dom.mzLead, !m.day);
    setText(dom.mzLead, m.day ? '' : m.lead);
    show(dom.mzDay, !!m.day);
    setText(dom.mzDayLead, m.day ? m.day.lead : '');
    setHtml(
        dom.mzDayEq,
        m.day ? m.day.eq.map((e) => `<div><b>${escapeHtml(e.value)}</b><span>${escapeHtml(e.label)}</span></div>`).join('') : '',
    );
    show(dom.mzRetry, m.retry);
    setText(dom.mzRetry, MOZEM_SKY_TEXTS.retry);
    show(dom.mzGuess, !!m.guess);
    setText(dom.mzGuessTitle, MOZEM_SKY_TEXTS.guessTitle);
    setText(dom.mzGuessText, m.guess);
    setText(dom.mzGuessBtn, MOZEM_SKY_TEXTS.guessBtn);
    show(dom.mzAsk, m.ask);
    setText(dom.mzAskTitle, MOZEM_SKY_TEXTS.askTitle);
    setText(dom.mzAskText, MOZEM_SKY_TEXTS.askText);
    setText(dom.mzAskBtn, MOZEM_SKY_TEXTS.askBtn);
}

/**
 * Ohlásenie pre čítačku (role="status"): len keď sa odpoveď zmení sama - časom alebo novým
 * meraním, napr. z POČKAJ na ÁNO. Nie každú minútu, nie pri načítaní ani pri návrate na kartu,
 * vtedy čítačka prečíta kartu aj tak. Predchádzajúcu odpoveď si pamätá prvok ohlásenia.
 * @param {Model | null} m null = karta nie je vidieť @param {Dom} dom
 */
function renderAnnounce(m, dom) {
    if (!m) {
        delete dom.mzLive.dataset.state;
        setText(dom.mzLive, '');
        return;
    }
    if (m.state === 'loading' || m.ask) return;
    const before = dom.mzLive.dataset.state;
    dom.mzLive.dataset.state = m.state;
    if (before && before !== m.state) setText(dom.mzLive, `${m.word}. ${m.lead}`);
}

/**
 * Pás odporúčaní a bodky pod ním. Pás listuje prehliadač, bodka ukazuje stránku zo stavu.
 * @param {ReturnType<typeof dnesCards>} k @param {number} page @param {Dom} dom @param {import('../../../shared/messages.js').Voice} voice
 */
function renderCards(k, page, dom, voice) {
    const TERAZ_TEXTS = voiceTexts(voice).TERAZ_TEXTS;
    show(dom.tzRecs, !!k);
    if (!k) return;
    dom.tzStrip.setAttribute('aria-label', TERAZ_TEXTS.strip);
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
export function renderMozem(state, dom) {
    if (!shows(state, 'mozem')) return renderAnnounce(null, dom);
    const m = mozemSkyModel(state, { online: state.online, voice: state.voice, devices: state.oznamenia.devices });
    renderCard(m, dom, state.voice);
    renderAnnounce(m, dom);
    renderCards(
        m.ask || m.state === 'loading' ? null : dnesCards({ ...state, previewMinutes: null }, state.voice),
        state.terazPage,
        dom,
        state.voice,
    );
}
