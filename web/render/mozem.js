// Karta Dnes (kódové meno mozem): hore veľký výkon zvoleného času na živej oblohe a posuvník dňa s odtlačkom bežca
// na teraz (docs/navrhy/dnes-obloha-posuvnik.html, A, docs/navrhy/dnes-tlacidlo-teraz.html, T4c), pod ním pás dlaždíc -
// Dnes (odznak a veľké slovo), Veľké veci, Zo strechy, večer Zajtra a karty časti dňa (docs/navrhy/dnes-tri-smery.html,
// docs/navrhy/dnes-upravy.html), po jednej alebo po dvoch na dlaždici (docs/navrhy/dnes-nizsie-dlazdice.html, D). Všetko počíta
// shared/mozem-sky.js, shared/dnes-faza.js a shared/dnes-nebo.js, texty sú v shared/messages.js - tu sa len
// zapisuje do DOM.

import { denVysvetlenie, dnesFaza, dnesKarty } from '../../shared/dnes-faza.js';
import { dnesNeboModel } from '../../shared/dnes-nebo.js';
import { escapeHtml } from '../../shared/format.js';
import { DNES_TEXTS, voiceTexts } from '../../shared/messages-core.js';
import { mozemSkyModel } from '../../shared/mozem-sky.js';
import { syncBodky } from '../mozem-karty.js';
import { dashboard, shows } from '../state.js';
import { kartaIcon, vecIcon, weatherIcon } from './icons.js';
import { kresliPocasie } from './teraz.js';
import { dialog, setHtml, setText, show } from './write.js';

/** @typedef {import('../../shared/mozem-sky.js').MozemSkyModel} Model */
/** @typedef {import('../../shared/dnes-faza.js').Karta} Karta */
/** @typedef {import('../../shared/dnes-nebo.js').DnesNebo} Nebo */
/** @typedef {import('../dom.js').Dom} Dom */

/**
 * Veľkosť veľkého slova v dlaždici Dnes či Zajtra v px podľa jeho dĺžky: krátke slovo najväčšie, dlhé (aj tri riadky)
 * také, aby sa zmestilo do nízkej dlaždice (docs/navrhy/dnes-nizsie-dlazdice.html). Na úzkom
 * displeji ho štýl zmenší ešte podľa najdlhšieho slova v ňom (`--word-len`), aby sa nikdy neorezalo.
 * @param {string} word
 */
export function wordSize(word) {
    return word.length <= 7 ? 46 : word.length <= 11 ? 38 : word.length <= 16 ? 32 : 26;
}

/**
 * Šírka textu v znakoch, verzálka ako 1,3 malého písmena - pre veľkosť hlášky v CSS (docs/navrhy/dnes-dlazdica-dnes.html, B).
 * @param {string} t
 */
const sirka = (t) => [...t].reduce((n, ch) => n + (ch !== ch.toLowerCase() ? 1.3 : 1), 0);

/**
 * Atribút style veľkého slova: veľkosť podľa dĺžky, najdlhšie slovo v ňom (`--word-len`, `--word-w`) a šírka celej
 * hlášky (`--text-w`) - z nich štýl vyberie najväčšie písmo, pri ktorom sa hláška zmestí na jeden až tri riadky.
 * @param {string} word
 */
const wordStyle = (word) => {
    const slova = word.split(/\s+/);
    return (
        `--word:${wordSize(word)}px;--word-len:${Math.max(1, ...slova.map((w) => w.length))};` +
        `--word-w:${Math.max(1, ...slova.map(sirka))};--text-w:${Math.max(1, sirka(word))}`
    );
};

/** Čas alebo úsek časov vo vete („17:30“, „07:15 – 17:30“). */
const CAS = /\d\d:\d\d(?: – \d\d:\d\d)?/g;

/** Veta s časmi okna tučne - čas je údaj, ktorý oko hľadá (docs/navrhy/dnes-upravy.html, bod 3). @param {string} text */
const sCasmi = (text) => escapeHtml(text).replace(CAS, (t) => `<strong class="cas">${t}</strong>`);

/** Výzvy a „Skúsiť znova“ pod pásom. @param {Model} m @param {Dom} dom @param {import('../../shared/messages.js').Voice} voice */
function renderCard(m, dom, voice) {
    const MOZEM_SKY_TEXTS = voiceTexts(voice).MOZEM_SKY_TEXTS;
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
 * Hore výkon a čo je to za číslo, pod ním posuvník dňa: deň od východu po západ, ich časy, bežec v zvolenom
 * čase a odtlačok na teraz, keď bežec odíde. Bez predpovede (a bez polohy) ani jedno nie je.
 * @param {Nebo | null} n @param {Dom} dom
 */
function renderNebo(n, dom) {
    show(dom.mzNebo, !!n);
    show(dom.mzOsObal, !!n);
    if (!n) return;
    setHtml(dom.mzKw, `<b>${escapeHtml(n.kw)}</b><small>kW</small>`);
    dom.mzStav.dataset.druh = n.druh;
    setHtml(dom.mzStav, `<i aria-hidden="true"></i><b>${escapeHtml(n.slovo)}</b><span>${escapeHtml(n.cas)}</span>`);
    const o = n.os;
    dom.mzOs.setAttribute('aria-label', DNES_TEXTS.os);
    dom.mzOs.setAttribute('aria-valuenow', String(o.min));
    dom.mzOs.setAttribute('aria-valuetext', n.veta);
    dom.mzOs.style.setProperty('--od', `${o.den.od}%`);
    dom.mzOs.style.setProperty('--do', `${o.den.do}%`);
    dom.mzOs.style.setProperty('--bezec', `${o.bezec}%`);
    setText(dom.mzOsVychod, o.vychod);
    setText(dom.mzOsZapad, o.zapad);
    dom.mzOdtlacok.style.setProperty('--teraz', `${o.teraz}%`);
    dom.mzOdtlacok.setAttribute('aria-label', DNES_TEXTS.naTeraz);
    show(dom.mzOdtlacok, o.zvolene);
}

/**
 * Kresba počasia za kartou (#wx) a slnko na nej v zvolenom čase; farby neba z tej istej chvíle píše
 * render/index.js. S vypnutou živou oblohou a v prehľade so stĺpcami nie je - ako na karte Teraz.
 * @param {import('../state.js').AppState} state @param {Nebo | null} n @param {Dom} dom
 */
function renderPocasie(state, n, dom) {
    const p = state.liveSky && !dashboard(state) && n ? n.pocasie : null;
    show(dom.wx, !!p);
    if (!p || !n) return;
    kresliPocasie(dom.wx, p);
    dom.wx.toggleAttribute('data-dnes', true);
    dom.wx.style.setProperty('--mz-f', String(n.slnko ? n.slnko.f : 0.5));
    dom.wx.style.setProperty('--mz-h', String(n.slnko ? n.slnko.h : -1));
}

/**
 * Karta Predpoveď (docs/navrhy/dnes-predpoved-graf.html, B): ikona a popis počasia, pod tým teplomer od
 * najnižšej po najvyššiu teplotu. Pásik je len obraz - čísla pri ňom sú text.
 * @param {Extract<Karta, { kind: 'predpoved' }>} k
 */
function predpovedHtml(k) {
    return (
        `<div class="k-wx">${k.weather ? weatherIcon(k.weather) : ''}<p class="k-popis">${escapeHtml(k.popis)}</p></div>` +
        `<p class="k-teplo"><span><span class="sr">najnižšia </span>${escapeHtml(k.min)}</span><i aria-hidden="true"></i>` +
        `<span><span class="sr">najvyššia </span>${escapeHtml(k.max)}</span></p>`
    );
}

/**
 * Obsah jednej karty pod jej nadpisom: veľká hodnota alebo obrázok a krátky riadok. Obrázky (stĺpce, pásiky,
 * ikony) sú pre čítačku skryté - to isté povie text vedľa nich. @param {Karta} k
 */
function obsahHtml(k) {
    const text = (/** @type {string} */ t) => (t ? `<p class="k-text">${sCasmi(t)}</p>` : '');
    const val = (/** @type {string} */ v) => (v ? `<p class="k-val">${escapeHtml(v).replace(/ kWh$/, ' <small>kWh</small>')}</p>` : '');
    const bar = (/** @type {number | null} */ pct) =>
        pct === null ? '' : `<div class="bar" aria-hidden="true"><i style="width:${pct}%"></i></div>`;
    if (k.kind === 'dnes') return `<p id="mz-word" class="k-slovo" style="${wordStyle(k.word)}">${escapeHtml(k.word)}</p>${text(k.text)}`;
    if (k.kind === 'predpoved') return predpovedHtml(k);
    if (k.kind === 'oblacnost') return `<p class="k-val k-ikona">${weatherIcon('zamracene')}${escapeHtml(k.value)}</p>${bar(k.pct)}`;
    if (k.kind === 'eq')
        return `<ul class="eq">${k.eq
            .map((e) => `<li>${kartaIcon(e.ikona)}<b>${escapeHtml(e.value)}</b><span class="sr"> ${escapeHtml(e.label)}</span></li>`)
            .join('')}</ul>`;
    if (k.kind === 'strecha') return `${val(k.value)}${bar(k.pct)}${text(k.text)}`;
    if (k.kind === 'slnko')
        return (
            val(k.value) +
            `<div class="k-stlpce" aria-hidden="true">${k.stlpce
                .map((x) => `<i style="height:${Math.max(4, x.pct)}%"${x.max ? ' data-max' : ''}${x.preslo ? ' data-preslo' : ''}></i>`)
                .join('')}</div>${text(k.text)}`
        );
    return `${val(k.value)}${text(k.text)}`;
}

/**
 * Nadpis karty. Pri Dnes a Zajtra je za ním šípka › vo farbe triedy dňa - tlačidlo na jej vysvetlenie (`data-trieda`),
 * ktoré pokryje aj nadpis; trieda slovom je pre čítačku (docs/navrhy/dnes-dlazdica-dnes.html, B).
 * @param {Karta} k
 */
function nadpisHtml(k) {
    const head = `<h2 class="glass-ttl">${escapeHtml(k.title)}</h2>`;
    if ((k.kind !== 'dnes' && k.kind !== 'zajtra') || !k.chip) return head;
    return (
        `<div class="k-hlava">${head}<button type="button" class="chip-tap" data-trieda="${k.kind}"${k.cls ? ` data-cls="${k.cls}"` : ''}` +
        ` aria-haspopup="dialog"><span class="k-sip" aria-hidden="true">›</span><span class="sr">${escapeHtml(k.chip)}</span></button></div>`
    );
}

/**
 * Dlaždica pásu (docs/navrhy/dnes-nizsie-dlazdice.html, D): jedna karta, alebo dvojica vedľa seba s tenkou čiarou
 * medzi nimi. Každá karta má svoj nadpis a `data-kind`. Slovo dneška nesie id, podľa ktorého ho nájdu testy (#mz-word).
 * @param {Karta[]} d
 */
function dlazdicaHtml(d) {
    const cast = (/** @type {Karta} */ k) => `<div class="cast" data-kind="${k.kind}">${nadpisHtml(k)}${obsahHtml(k)}</div>`;
    // Dlaždica s dneškom: hláška na celú šírku hore, druhá karta riadkom dole (docs/navrhy/dnes-dlazdica-dnes.html, B).
    const dnes = d.length > 1 && d[0].kind === 'dnes' ? ' data-dnes' : '';
    return `<section class="karta glass"${d.length > 1 ? ' data-dvoj' : ''}${dnes}>${d.map(cast).join('<i class="deli" aria-hidden="true"></i>')}</section>`;
}

/**
 * Pás dlaždíc pod posuvníkom a pod ním bodky so šípkami (jedna dlaždica bez nich).
 * Ktorá bodka svieti, závisí od posunu pásu - nastaví ju syncBodky (aj pri posúvaní, mozem-interactions.js).
 * @param {Karta[][]} k @param {Dom} dom
 */
function renderKarty(k, dom) {
    show(dom.mzKarty, k.length > 0);
    dom.mzKarty.setAttribute('aria-label', DNES_TEXTS.karty);
    setHtml(dom.mzKarty, k.map(dlazdicaHtml).join(''));
    show(dom.mzPasOvladanie, k.length > 1);
    dom.mzPasSpat.setAttribute('aria-label', DNES_TEXTS.pasSpat);
    dom.mzPasDalej.setAttribute('aria-label', DNES_TEXTS.pasDalej);
    const zapisane = setHtml(dom.mzBodky, k.length > 1 ? k.map(() => '<i></i>').join('') : '');
    if (zapisane) syncBodky(dom.mzKarty, dom.mzBodky, [dom.mzPasSpat, dom.mzPasDalej]);
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
    // Zatvorené vráti fokus na odznak v dlaždici, z ktorej sa otvorilo.
    dialog(dom.mzTriedaSheet, !!v, () => (shows(state, 'mozem') ? dom.mzKarty.querySelector(`[data-trieda="${kedy}"]`) : null));
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
    // `?? null`: starý web/state.js z cache po nasadení pole mzCas nemá (CLAUDE.md, Nasadenie a cache).
    const n = m.ask ? null : dnesNeboModel(state, state.mzCas ?? null, state.voice);
    renderCard(m, dom, state.voice);
    renderNebo(n, dom);
    renderPocasie(state, n, dom);
    renderKarty(m.ask ? [] : dnesKarty(m, d), dom);
    renderAnnounce(m, dom);
}
