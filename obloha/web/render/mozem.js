// Karta Dnes novej appky (kódové meno mozem, doteraz Môžem?): oblúk slnka, veľké slovo, čo dá
// strecha za celý deň a výzvy (docs/navrhy/dnes-a-teraz.html). Zvyšok sa mení s časťou dňa - ráno
// plán, cez deň odpočet okna na veľké veci, večer vysvedčenie a zajtrajšok (docs/navrhy/dnes-tri-smery.html,
// smer C). Všetko počíta shared/mozem-sky.js a shared/dnes-faza.js, texty sú v shared/messages.js -
// tu sa len zapisuje do DOM.

import { dnesFaza } from '../../../shared/dnes-faza.js';
import { escapeHtml } from '../../../shared/format.js';
import { DNES_TEXTS, voiceTexts } from '../../../shared/messages-core.js';
import { mozemSkyModel } from '../../../shared/mozem-sky.js';
import { sunArcSvg } from '../../../web/sun-arc.js';
import { shows } from '../state.js';
import { setHtml, setText, show } from './write.js';

/** @typedef {import('../../../shared/mozem-sky.js').MozemSkyModel} Model */
/** @typedef {import('../../../shared/dnes-faza.js').DnesFaza} DnesFaza */
/** @typedef {import('../dom.js').Dom} Dom */

/**
 * Veľkosť veľkého slova v px podľa jeho dĺžky, ako v návrhu: krátke slovo najväčšie. Na úzkom
 * displeji ho štýl zmenší ešte podľa najdlhšieho slova v ňom (`--word-len`), aby sa nikdy
 * neorezalo. @param {string} word
 */
export function wordSize(word) {
    return word.length <= 7 ? 66 : word.length <= 11 ? 50 : 42;
}

/** Veľké slovo: veľkosť podľa dĺžky, na úzkom displeji podľa najdlhšieho slova. @param {HTMLElement} el @param {string} word */
function setWord(el, word) {
    setText(el, word);
    el.style.setProperty('--word', `${wordSize(word)}px`);
    el.style.setProperty('--word-len', String(Math.max(1, ...word.split(/\s+/).map((w) => w.length))));
}

/** Hlavná časť karty. @param {Model} m @param {Dom} dom @param {import('../../../shared/messages.js').Voice} voice */
function renderCard(m, dom, voice) {
    const MOZEM_SKY_TEXTS = voiceTexts(voice).MOZEM_SKY_TEXTS;
    show(dom.mzArc, !!m.arc);
    if (m.arc) setHtml(dom.mzArc, sunArcSvg(m.arc, m.state === 'offline'));
    show(dom.mzAnswer, !m.ask);
    setWord(dom.mzWord, m.word);
    // S predpoveďou na dnešok namiesto vety čo dá strecha za celý deň.
    show(dom.mzLead, !m.day);
    setText(dom.mzLead, m.day ? '' : m.lead);
    show(dom.mzDay, !!m.day);
    setText(dom.mzDayLead, m.day ? m.day.lead : '');
    setHtml(
        dom.mzDayEq,
        m.day ? m.day.eq.map((e) => `<li><b>${escapeHtml(e.value)}</b><span>${escapeHtml(e.label)}</span></li>`).join('') : '',
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

/** Karta bez častí podľa časti dňa (načítava sa, dáta nie sú, poloha chýba). @type {DnesFaza} */
const NIC = { faza: 'den', chip: '', kick: '', count: null, progress: null, grade: null, line: '', later: '', tomorrow: null };

/**
 * Čo sa mení s časťou dňa: štítok s triedou dňa, riadok nad slovom, odpočet či vysvedčenie
 * a pod číslami veta o okne a koľko už nabehlo. @param {DnesFaza} d @param {Model} m @param {Dom} dom
 */
function renderFaza(d, m, dom) {
    show(dom.mzChip, !!d.chip);
    setText(dom.mzChip, d.chip);
    if (m.den) dom.mzChip.dataset.cls = m.den.cls;
    show(dom.mzKick, !!d.kick);
    setText(dom.mzKick, d.kick);
    // Cez deň s odpočtom a večer s vysvedčením je slovo menšie - hlavné je číslo pod ním.
    dom.mzWord.classList.toggle('sm', !!(d.count || d.grade));
    show(dom.mzCount, !!d.count);
    setText(dom.mzCountVal, d.count ? d.count.value : '');
    setText(dom.mzCountText, d.count ? d.count.text : '');
    show(dom.mzGrade, !!d.grade);
    setText(dom.mzGradeLabel, d.grade ? d.grade.label : '');
    setText(dom.mzGradeVal, d.grade ? d.grade.value : '');
    // Večer povie namerané presne vysvedčenie - veta „Dnes zo strechy asi…“ by ho opakovala.
    show(dom.mzDayLead, !d.grade);
    const p = d.progress;
    show(dom.mzMore, !!(d.line || p));
    show(dom.mzLine, !!d.line);
    setText(dom.mzLine, d.line);
    show(dom.mzProgress, !!p);
    setText(dom.mzProgress, p ? p.text : '');
    show(dom.mzBar, !!p && p.pct !== null);
    dom.mzBarVal.style.width = `${p?.pct ?? 0}%`;
}

/** Večer zajtrajšok, inak riadok Kedy lepšie. @param {DnesFaza} d @param {Dom} dom */
function renderMore(d, dom) {
    const t = d.tomorrow;
    show(dom.mzTom, !!t);
    setText(dom.mzTomChip, t ? t.chip : '');
    if (t) dom.mzTomChip.dataset.cls = t.cls;
    setWord(dom.mzTomWord, t ? t.word : '');
    setText(dom.mzTomText, t ? t.text : '');
    show(dom.mzLater, !!d.later);
    setText(dom.mzLaterTitle, DNES_TEXTS.later);
    setText(dom.mzLaterText, d.later);
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
    // Odpoveď je stav aj veľké slovo - slovo o celom dni sa mení aj vtedy, keď stav nie.
    const before = dom.mzLive.dataset.state;
    const now = `${m.state} ${m.word}`;
    dom.mzLive.dataset.state = now;
    if (before && before !== now) setText(dom.mzLive, `${m.word}. ${m.lead}`);
}

/** @param {import('../state.js').AppState} state @param {Dom} dom */
export function renderMozem(state, dom) {
    if (!shows(state, 'mozem')) return renderAnnounce(null, dom);
    const m = mozemSkyModel(state, { online: state.online, voice: state.voice, devices: state.doma, ranna: state.ranna });
    const d = m.ask || m.state === 'loading' ? null : dnesFaza(state, m.den, m.window, { voice: state.voice, devices: state.doma });
    renderCard(m, dom, state.voice);
    renderFaza(d ?? NIC, m, dom);
    renderMore(d ?? NIC, dom);
    renderAnnounce(m, dom);
}
