// Karta Môžem? novej appky: oblúk slnka, štítky, veľké slovo a veta, fakt v mobiloch, výzvy,
// zoznam šiestich vecí, riadok o mesiaci, hláška a panel veci zospodu. Všetko počíta
// shared/mozem-sky.js a texty sú v shared/messages.js - tu sa len zapisuje do DOM.

import { escapeHtml, minutesToTimeStr } from '../../../shared/format.js';
import { voiceTexts } from '../../../shared/messages.js';
import { mozemSkyModel } from '../../../shared/mozem-sky.js';
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

/** Riadky vecí: meno a krátka odpoveď vo farbe; celý riadok je tlačidlo, ktoré otvorí panel. @param {Model['items']} items */
function itemsHtml(items) {
    return items
        .map(
            (it) =>
                `<button type="button" class="app" data-item="${it.id}" aria-haspopup="dialog"><span>${escapeHtml(it.name)}</span>` +
                `<b data-tone="${it.running ? 'run' : it.tone}">${escapeHtml(it.short)}</b></button>`,
        )
        .join('');
}

/** Hlavná časť karty. @param {Model} m @param {Dom} dom @param {import('../../../shared/messages.js').Voice} voice */
function renderCard(m, dom, voice) {
    const MOZEM_SKY_TEXTS = voiceTexts(voice).MOZEM_SKY_TEXTS;
    show(dom.mzArc, !!m.arc);
    if (m.arc) setHtml(dom.mzArc, arcSvg(m.arc, m.state === 'offline'));
    show(dom.mzAnswer, !m.ask);
    setHtml(dom.mzChips, m.chips.map((c) => `<span class="chip" data-tone="${c.tone}">${escapeHtml(c.text)}</span>`).join(''));
    show(dom.mzChips, m.chips.length > 0);
    setText(dom.mzWord, m.word);
    dom.mzWord.style.setProperty('--word', `${wordSize(m.word)}px`);
    dom.mzWord.style.setProperty('--word-len', String(Math.max(1, ...m.word.split(/\s+/).map((w) => w.length))));
    setText(dom.mzLead, m.lead);
    show(dom.mzPhones, !!m.phones);
    setText(dom.mzPhonesText, m.phones);
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
    show(dom.mzList, !!m.list);
    dom.mzList.classList.toggle('est', !!m.list?.estimate);
    setText(dom.mzListTitle, m.list ? m.list.title : '');
    setHtml(dom.mzItems, m.list ? itemsHtml(m.items) : '');
    show(dom.mzCount, !!m.count);
    setText(dom.mzCount, m.count);
    show(dom.mzQuip, !!m.quip);
    setText(dom.mzQuipText, m.quip);
    setText(dom.mzQuipHint, MOZEM_SKY_TEXTS.quipHint);
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

/** Vec, ktorej panel je práve otvorený - po zatvorení sa fokus vráti na jej riadok. @type {string | null} */
let shown = null;

/**
 * Panel veci: texty a otvorenie či zatvorenie dialógu podľa stavu. Po zatvorení (krížik,
 * Escape, Späť) sa fokus vráti na riadok, z ktorého sa panel otvoril.
 * @param {Model['items'][number] | null} it @param {Dom} dom @param {import('../../../shared/messages.js').Voice} [voice]
 */
function renderSheet(it, dom, voice) {
    const MOZEM_SKY_TEXTS = voiceTexts(voice).MOZEM_SKY_TEXTS;
    if (!it) {
        if (dom.mzSheet.open) dom.mzSheet.close();
        const row = shown && dom.mzItems.querySelector(`[data-item="${shown}"]`);
        shown = null;
        if (row instanceof HTMLElement) row.focus();
        return;
    }
    dom.mzSheetX.setAttribute('aria-label', MOZEM_SKY_TEXTS.close);
    setText(dom.mzSheetTitle, it.title);
    setText(dom.mzSheetDoQ, MOZEM_SKY_TEXTS.sheetDo);
    setText(dom.mzSheetDo, it.head);
    setText(dom.mzSheetWhyQ, MOZEM_SKY_TEXTS.sheetWhy);
    setText(dom.mzSheetWhy, it.text);
    show(dom.mzSheetMoreQ, !!it.more);
    show(dom.mzSheetMore, !!it.more);
    setText(dom.mzSheetMoreQ, it.more ? it.more.q : '');
    setText(dom.mzSheetMore, it.more ? it.more.a : '');
    show(dom.mzSheetLog, !!it.log);
    if (it.log) {
        setText(dom.mzSheetLog, it.log.label);
        dom.mzSheetLog.classList.toggle('ghost', it.log.pressed);
        dom.mzSheetLog.dataset.sun = it.log.sun ? '1' : '0';
    }
    if (!dom.mzSheet.open) dom.mzSheet.showModal();
    shown = it.id;
}

/** @param {import('../state.js').AppState} state @param {Dom} dom */
export function renderMozem(state, dom) {
    // Panel veci patrí karte Môžem?; keď nie je na obrazovke, je vždy zatvorený.
    if (!shows(state, 'mozem')) {
        renderAnnounce(null, dom);
        return renderSheet(null, dom);
    }
    const m = mozemSkyModel(state, { quip: state.mozemQuip, launches: state.launches, online: state.online, voice: state.voice });
    renderCard(m, dom, state.voice);
    renderAnnounce(m, dom);
    renderSheet(m.items.find((it) => it.id === state.mozemItem) || null, dom, state.voice);
}
