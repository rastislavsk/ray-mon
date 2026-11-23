// Karta Dnes (kódové meno mozem): hore veľký výkon zvoleného času na živej oblohe a posuvník dňa s odtlačkom bežca
// na teraz (docs/navrhy/dnes-obloha-posuvnik.html, A, docs/navrhy/dnes-tlacidlo-teraz.html, T4c), pod ním pás dlaždíc -
// Dnes (odznak a veľké slovo), Veľké veci, Dnes zo strechy, večer Zajtra a karty časti dňa (docs/navrhy/dnes-tri-smery.html,
// docs/navrhy/dnes-upravy.html), medzi nimi Graf dňa, ktorý otvorí panel s grafom (render/graf.js). Všetko počíta
// shared/mozem-sky.js, shared/dnes-faza.js a shared/dnes-nebo.js, texty sú v shared/messages.js - tu sa len
// zapisuje do DOM.

import { denVysvetlenie, dnesFaza, dnesKarty } from '../../shared/dnes-faza.js';
import { dnesNeboModel } from '../../shared/dnes-nebo.js';
import { escapeHtml } from '../../shared/format.js';
import { DNES_TEXTS, voiceTexts } from '../../shared/messages-core.js';
import { mozemSkyModel } from '../../shared/mozem-sky.js';
import { syncBodky } from '../mozem-karty.js';
import { dashboard, shows } from '../state.js';
import { vecIcon, weatherIcon } from './icons.js';
import { kresliPocasie } from './teraz.js';
import { dialog, setHtml, setText, show } from './write.js';

/** @typedef {import('../../shared/mozem-sky.js').MozemSkyModel} Model */
/** @typedef {import('../../shared/dnes-faza.js').Karta} Karta */
/** @typedef {import('../../shared/dnes-nebo.js').DnesNebo} Nebo */
/** @typedef {import('../dom.js').Dom} Dom */

/**
 * Veľkosť veľkého slova v dlaždici Dnes či Zajtra v px podľa jeho dĺžky: krátke slovo najväčšie. Na úzkom
 * displeji ho štýl zmenší ešte podľa najdlhšieho slova v ňom (`--word-len`), aby sa nikdy neorezalo.
 * @param {string} word
 */
export function wordSize(word) {
    return word.length <= 7 ? 46 : word.length <= 11 ? 38 : 32;
}

/** Atribút style veľkého slova: veľkosť podľa dĺžky a najdlhšie slovo v ňom. @param {string} word */
const wordStyle = (word) => `--word:${wordSize(word)}px;--word-len:${Math.max(1, ...word.split(/\s+/).map((w) => w.length))}`;

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
    if (k.kind === 'dnes' || k.kind === 'zajtra' || k.kind === 'strecha' || k.kind === 'velke')
        return `<section class="karta glass" data-kind="${k.kind}">${head}${dnesnyHtml(k)}</section>`;
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
 * Dlaždice z polí, ktoré boli nad pásom (docs/navrhy/dnes-obloha-posuvnik.html, A): odznak s triedou dňa ako
 * tlačidlo na jej vysvetlenie (`data-trieda`), veľké slovo, odpočet či veta s časmi tučne a čo dá strecha.
 * @param {Extract<Karta, { kind: 'dnes' | 'zajtra' | 'strecha' | 'velke' }>} k
 */
function dnesnyHtml(k) {
    const text = (/** @type {string} */ t) => (t ? `<p class="k-text">${sCasmi(t)}</p>` : '');
    if (k.kind === 'velke') return `${k.value ? `<p class="k-val">${escapeHtml(k.value)}</p>` : ''}${text(k.text)}`;
    if (k.kind === 'strecha') {
        // Jednotka je menšia ako číslo.
        const val = escapeHtml(k.value).replace(/ kWh$/, ' <small>kWh</small>');
        const eq = k.eq.map((e) => `<li><b>${escapeHtml(e.value)}</b><span>${escapeHtml(e.label)}</span></li>`).join('');
        return `<p class="k-val">${val}</p>${text(k.text)}<ul class="eq">${eq}</ul>`;
    }
    const kedy = k.kind === 'dnes' ? 'dnes' : 'zajtra';
    const chip = k.chip
        ? `<button type="button" class="chip-tap" data-trieda="${kedy}" aria-haspopup="dialog">` +
          `<span class="chip info"${k.cls ? ` data-cls="${k.cls}"` : ''}>${escapeHtml(k.chip)}</span></button>`
        : '';
    // Slovo dneška je v páse raz - nesie id, podľa ktorého ho nájdu testy a odkazy v komentároch (#mz-word).
    const id = kedy === 'dnes' ? ' id="mz-word"' : '';
    return `${chip}<p${id} class="k-slovo" style="${wordStyle(k.word)}">${escapeHtml(k.word)}</p>${text(k.text)}`;
}

/**
 * Pás kariet pod posuvníkom a bodky pod ním (jedna karta bez bodiek).
 * Ktorá bodka svieti, závisí od posunu pásu - nastaví ju syncBodky (aj pri posúvaní, mozem-interactions.js).
 * @param {Karta[]} k @param {Dom} dom
 */
function renderKarty(k, dom) {
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
