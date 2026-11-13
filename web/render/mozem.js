// Karta Dnes (kódové meno mozem, doteraz Môžem?): oblúk slnka, veľké slovo, čo dá
// strecha za celý deň a výzvy (docs/navrhy/dnes-a-teraz.html). Zvyšok sa mení s časťou dňa - ráno
// plán, cez deň odpočet okna na veľké veci, večer ako dopadol dnešok a zajtrajšok (docs/navrhy/dnes-tri-smery.html,
// smer C). Pod číslami pás kariet na posúvanie a vysvetlenie odznaku triedy dňa (docs/navrhy/dnes-upravy.html),
// v páse Predpoveď a Graf dňa, ktorý otvorí panel s grafom (docs/navrhy/dnes-predpoved-graf.html, render/graf.js).
// Všetko počíta shared/mozem-sky.js a shared/dnes-faza.js, texty sú v shared/messages.js - tu sa len
// zapisuje do DOM.

import { denVysvetlenie, dnesFaza } from '../../shared/dnes-faza.js';
import { escapeHtml } from '../../shared/format.js';
import { DNES_TEXTS, voiceTexts } from '../../shared/messages-core.js';
import { mozemSkyModel } from '../../shared/mozem-sky.js';
import { syncBodky } from '../mozem-karty.js';
import { sunArcSvg } from '../sun-arc.js';
import { shows } from '../state.js';
import { vecIcon, weatherIcon } from './icons.js';
import { dialog, setHtml, setText, show } from './write.js';

/** @typedef {import('../../shared/mozem-sky.js').MozemSkyModel} Model */
/** @typedef {import('../../shared/dnes-faza.js').DnesFaza} DnesFaza */
/** @typedef {import('../../shared/dnes-faza.js').Karta} Karta */
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

/** Čas alebo úsek časov vo vete („17:30“, „07:15 – 17:30“). */
const CAS = /\d\d:\d\d(?: – \d\d:\d\d)?/g;

/**
 * Veta s časmi okna tučne - čas je údaj, ktorý oko hľadá (docs/navrhy/dnes-upravy.html, bod 3).
 * @param {HTMLElement} el @param {string} text
 */
function setTimes(el, text) {
    setHtml(
        el,
        escapeHtml(text).replace(CAS, (t) => `<strong class="cas">${t}</strong>`),
    );
}

/** Hlavná časť karty. @param {Model} m @param {Dom} dom @param {import('../../shared/messages.js').Voice} voice */
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
const NIC = { faza: 'den', chip: '', kick: '', count: null, grade: null, line: '', karty: [], tomorrow: null };

/**
 * Čo sa mení s časťou dňa: odznak s triedou dňa, riadok nad slovom, odpočet či ako dopadol dnešok
 * a veta o okne či predpovedi. @param {DnesFaza} d @param {Model} m @param {Dom} dom
 */
function renderFaza(d, m, dom) {
    show(dom.mzChip, !!d.chip);
    setText(dom.mzChipText, d.chip);
    if (m.den) dom.mzChipText.dataset.cls = m.den.cls;
    show(dom.mzKick, !!d.kick);
    setText(dom.mzKick, d.kick);
    // Cez deň s odpočtom a večer s tým, ako dopadol dnešok, je slovo menšie - hlavné je číslo pod ním.
    dom.mzWord.classList.toggle('sm', !!(d.count || d.grade));
    show(dom.mzCount, !!d.count);
    setText(dom.mzCountVal, d.count ? d.count.value : '');
    setTimes(dom.mzCountText, d.count ? d.count.text : '');
    show(dom.mzGrade, !!d.grade);
    setText(dom.mzGradeLabel, d.grade ? d.grade.label : '');
    setText(dom.mzGradeVal, d.grade ? d.grade.value : '');
    // Večer povie namerané presne riadok s číslom - veta „Dnes zo strechy asi…“ by ho opakovala.
    show(dom.mzDayLead, !d.grade);
    show(dom.mzLine, !!d.line);
    setTimes(dom.mzLine, d.line);
}

/**
 * Karta Predpoveď (docs/navrhy/dnes-predpoved-graf.html, B): ikona a popis počasia, pod tým teplomer od
 * najnižšej po najvyššiu teplotu a oblačnosť dňa. Pásiky sú len obraz - čísla pri nich sú text.
 * @param {Extract<Karta, { kind: 'predpoved' }>} k
 */
function predpovedHtml(k) {
    const obl =
        k.oblacnost === null
            ? ''
            : `<p class="k-obl"><span>${escapeHtml(DNES_TEXTS.oblacnost)}</span>` +
              `<i aria-hidden="true"><b style="width:${k.oblacnost}%"></b></i><span>${k.oblacnost} %</span></p>`;
    return (
        `<div class="k-wx">${k.weather ? weatherIcon(k.weather) : ''}<p class="k-popis">${escapeHtml(k.popis)}</p></div>` +
        `<p class="k-teplo"><span><span class="sr">najnižšia </span>${escapeHtml(k.min)}</span><i aria-hidden="true"></i>` +
        `<span><span class="sr">najvyššia </span>${escapeHtml(k.max)}</span></p>${obl}`
    );
}

/**
 * Karta Graf dňa: celá karta je tlačidlo - ťuknutie kdekoľvek otvorí panel s grafom (render/graf.js).
 * Vidno len venovanie s leskom a šípku v obruči (docs/navrhy/dnes-graf-tajomno.html, D); meno „Graf dňa“
 * má len čítačka, aby vedela, čo ťuknutie otvorí.
 * @param {Extract<Karta, { kind: 'graf' }>} k
 */
function grafHtml(k) {
    return (
        `<button type="button" class="k-otvor" aria-haspopup="dialog"><span class="sr">${escapeHtml(k.title)} – </span>` +
        `<span class="k-obruc" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M7.5 4.5 13 10l-5.5 5.5"/></svg></span>` +
        `<span class="k-lesk">${escapeHtml(k.stitok)}</span></button>`
    );
}

/**
 * Jedna karta pásu: nadpis, veľká hodnota alebo obrázok a veta. Obrázky (stĺpce, teplomer) sú pre
 * čítačku skryté - to isté povie veta či text vedľa nich. @param {Karta} k
 */
function kartaHtml(k) {
    if (k.kind === 'graf') return `<section class="karta glass" data-kind="graf">${grafHtml(k)}</section>`;
    const head = `<h2 class="glass-ttl">${escapeHtml(k.title)}</h2>`;
    if (k.kind === 'predpoved') return `<section class="karta glass" data-kind="predpoved">${head}${predpovedHtml(k)}</section>`;
    const text = `<p class="k-text">${escapeHtml(k.text)}</p>`;
    const val = (/** @type {string} */ v) => `<p class="k-val">${escapeHtml(v)}</p>`;
    /** @type {string} */ let body;
    if (k.kind === 'nabehlo')
        body = `${val(k.value)}${k.pct === null ? '' : `<div class="bar" aria-hidden="true"><i style="width:${k.pct}%"></i></div>`}`;
    else if (k.kind === 'lepsie') body = val(k.value);
    else
        body =
            val(k.value) +
            `<div class="k-stlpce" aria-hidden="true">${k.stlpce
                .map((s) => `<i style="height:${Math.max(4, s.pct)}%"${s.max ? ' data-max' : ''}${s.preslo ? ' data-preslo' : ''}></i>`)
                .join('')}</div>`;
    return `<section class="karta glass" data-kind="${k.kind}">${head}${body}${text}</section>`;
}

/**
 * Pás kariet pod číslami a bodky pod ním (jedna karta bez bodiek), večer nad pásom zajtrajšok.
 * Ktorá bodka svieti, závisí od posunu pásu - nastaví ju syncBodky (aj pri posúvaní, mozem-interactions.js).
 * @param {DnesFaza} d @param {Dom} dom
 */
function renderKarty(d, dom) {
    const k = d.karty;
    show(dom.mzKarty, k.length > 0);
    dom.mzKarty.setAttribute('aria-label', DNES_TEXTS.karty);
    setHtml(dom.mzKarty, k.map(kartaHtml).join(''));
    show(dom.mzBodky, k.length > 1);
    const zapisane = setHtml(
        dom.mzBodky,
        k.length > 1
            ? k.map((x, i) => `<button type="button" data-i="${i}" aria-label="${escapeHtml(x.title)}" tabindex="-1"></button>`).join('')
            : '',
    );
    if (zapisane) syncBodky(dom.mzKarty, dom.mzBodky);
    const t = d.tomorrow;
    show(dom.mzTom, !!t);
    setText(dom.mzTomChipText, t ? t.chip : '');
    if (t) dom.mzTomChipText.dataset.cls = t.cls;
    setWord(dom.mzTomWord, t ? t.word : '');
    setTimes(dom.mzTomText, t ? t.text : '');
}

/** Značka pri veci vo vysvetlení odznaku: fajka, keď sa zmestí, inak pomlčka. @param {boolean} ok */
const znacka = (ok) =>
    `<svg class="znacka" viewBox="0 0 16 16" aria-hidden="true"><path d="${ok ? 'M4 8.5l2.6 2.6L12 5.6' : 'M5 8h6'}"/></svg>`;

/**
 * Vysvetlenie odznaku triedy dňa: otvorené, kým je v stave a je čo vysvetliť (dnešok s predpoveďou,
 * zajtrajšok v predpovedi). @param {import('../state.js').AppState} state @param {Dom} dom
 */
function renderTrieda(state, dom) {
    const kedy = state.mzChip;
    const v = kedy && state.forecast ? denVysvetlenie(state, kedy, { voice: state.voice, devices: state.doma }) : null;
    if (v) {
        setText(dom.mzTriedaChip, v.chip);
        dom.mzTriedaChip.dataset.cls = v.cls;
        setText(dom.mzTriedaTitle, v.title);
        setText(dom.mzTriedaText, v.text);
        setHtml(
            dom.mzTriedaVeci,
            v.veci
                .map(
                    (x) =>
                        `<li data-ok="${x.ok}"><span class="vec-ico">${vecIcon(x.id)}${znacka(x.ok)}</span>${escapeHtml(x.name)}` +
                        `<span class="sr">${x.ok ? ': zmestí sa' : ': nezmestí sa'}</span></li>`,
                )
                .join(''),
        );
        setText(dom.mzTriedaQ, v.stupnicaTitle);
        setHtml(
            dom.mzTriedaStupnica,
            v.stupnica
                .map(
                    (s) =>
                        `<li data-cls="${s.cls}"${s.on ? ' aria-current="true"' : ''}><i aria-hidden="true"></i><b>${escapeHtml(s.label)}</b>` +
                        `<span>${escapeHtml(s.pop)}</span></li>`,
                )
                .join(''),
        );
        setText(dom.mzTriedaNote, v.note);
    }
    dialog(dom.mzTriedaSheet, !!v, () => (!shows(state, 'mozem') ? null : kedy === 'zajtra' ? dom.mzTomChip : dom.mzChip));
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
    renderTrieda(state, dom);
    if (!shows(state, 'mozem')) return renderAnnounce(null, dom);
    const m = mozemSkyModel(state, { online: state.online, voice: state.voice, devices: state.doma, ranna: state.ranna });
    const d = m.ask || m.state === 'loading' ? null : dnesFaza(state, m.den, m.window, { voice: state.voice, devices: state.doma });
    renderCard(m, dom, state.voice);
    renderFaza(d ?? NIC, m, dom);
    renderKarty(d ?? NIC, dom);
    renderAnnounce(m, dom);
}
