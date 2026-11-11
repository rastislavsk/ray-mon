// Karta Teraz (docs/navrhy/teraz-navrh-2.html): veľké číslo kW teraz, čo zapnúť (riadok nad dlaždicami,
// dlaždice toho, čo ide teraz, skupiny riadkov), panel s vysvetlením, detail spotrebiča a výzvy. Graf
// dňa je v paneli karty Dnes (render/graf.js). Všetko počíta shared/teraz.js a texty sú v
// shared/messages.js - tu sa len zapisuje do DOM.

import { escapeHtml } from '../../shared/format.js';
import { hlavickaModel, stavRiadok } from '../../shared/hlavicka.js';
import { PLAN_DNA_NOTE, TERAZ_PAS_ISTOTA, voiceTexts } from '../../shared/messages-core.js';
import { terazModel } from '../../shared/teraz.js';
import { hviezdySvg, mesiacSvg, pocasieHtml, pocasieStav } from '../pocasie.js';
import { dashboard, shows } from '../state.js';
import { vecIcon, weatherIcon } from './icons.js';
import { dialog, setHtml, setText, show } from './write.js';

/** @typedef {import('../../shared/teraz.js').TerazModel} Model */
/** @typedef {import('../dom.js').Dom} Dom */
/** @typedef {ReturnType<typeof voiceTexts>} Texts pevné texty v tóne appky */

/** Texty bubliny, keď riadok bublinu nemá. */
const BEZ_BUBLINY = { nadpis: '', text: '', tlacidlo: '' };

/** Riadok stavu merania hovorí vždy o teraz - zvolený čas je len v grafe dňa. */
const TERAZ = { preview: false, source: '' };

/**
 * Riadok stavu merania pod číslom (shared/hlavicka.js, stavRiadok): bodka, čas a slovo, a bublina
 * s vysvetlením, keď je otvorená. Tvar bodky drží data-tone na tlačidle.
 * @param {import('../state.js').AppState} state @param {Dom} dom
 */
function renderStav(state, dom) {
    const r = stavRiadok(hlavickaModel(state, state.voice), TERAZ);
    show(dom.stav, !!r);
    const { text, tone, toneText, tip } = r ?? { text: '', tone: 'off', toneText: '', tip: null };
    setText(dom.status, text);
    setText(dom.tone, toneText);
    dom.live.dataset.tone = tone;
    dom.live.disabled = !tip;
    const open = state.stavTip && !!tip;
    dom.stav.classList.toggle('open', open);
    dom.live.setAttribute('aria-expanded', String(open));
    show(dom.tip, open);
    show(dom.tipBg, open);
    const t = tip ?? BEZ_BUBLINY;
    setText(dom.tipTitle, t.nadpis);
    setText(dom.tipText, t.text);
    setText(dom.tipBtn, t.tlacidlo);
    show(dom.tipBtn, !!t.tlacidlo);
}

/** Ikona spotrebiča v kruhu dlaždice. @param {string} id */
const ikona = (id) => `<span class="dl-ico" aria-hidden="true">${vecIcon(id)}</span>`;

/**
 * Čo zapnúť: riadok nad dlaždicami (bodka, odkiaľ ide prúd, pri ničom aj cena siete), dlaždice toho,
 * čo ide teraz (alebo najbližšia vec s rámom) a skupiny riadkov. Dlaždica aj riadok nesú `data-vec`,
 * ťuknutie otvorí detail spotrebiča. Bez Plánu dňa (bez predpovede, nič doma) nie je.
 * @param {Model['co']} co @param {Dom} dom
 */
function renderCo(co, dom) {
    show(dom.tzCo, !!co);
    if (!co) return;
    const h = co.hore;
    dom.tzOkoBod.dataset.tone = h.bod;
    setHtml(dom.tzOkoT, `${escapeHtml(h.oko.text)}${h.oko.sub ? ` <span>· ${escapeHtml(h.oko.sub)}</span>` : ''}`);
    show(dom.tzOkoPod, !!h.bezSlnka);
    setText(dom.tzOkoPod, h.bezSlnka);
    show(dom.tzPas, !!co.pas);
    setHtml(dom.tzPas, (co.pas ?? []).map(pasDenHtml).join(''));
    renderVyhlad(co.vyhlad, dom);
    const dlazdice = h.dlazdice.map(
        (d) =>
            `<button type="button" class="dl${d.cela ? ' cela' : ''}" data-tone="${d.tone}" data-vec="${d.id}">${ikona(d.id)}` +
            `<span><b>${escapeHtml(d.name)}</b><small>${escapeHtml(d.sub)}</small></span></button>`,
    );
    const p = h.dalsi;
    const dalsi = p
        ? `<button type="button" class="dl cela" data-tone="next" data-cheap="${p.tone === 'cheap'}" data-vec="${p.id}">${ikona(p.id)}` +
          `<span><span class="velky">${escapeHtml(p.cas)}</span><b>${escapeHtml(p.name)}</b><small>${escapeHtml(p.sub)}</small></span></button>`
        : '';
    setHtml(dom.tzDlazdice, dlazdice.join('') + dalsi);
    show(dom.tzDlazdice, dlazdice.length > 0 || !!p);
    setHtml(dom.tzSkupiny, co.skupiny.map(skupinaHtml).join(''));
}

/**
 * Deň v páse dní (docs/navrhy/teraz-viac-dni-bez-slnka.html, A): dnes bez ikony, zamračený deň s oblakom,
 * deň so slnkom zlatý. `--i` je poradie - dni sa pri zobrazení odkryjú zľava.
 * @param {NonNullable<NonNullable<Model['co']>['pas']>[number]} d @param {number} i
 */
const pasDenHtml = (d, i) =>
    `<span data-druh="${d.druh}" style="--i:${i}">` +
    `${d.druh === 'dnes' ? '' : weatherIcon(d.druh === 'slnko' ? 'jasno' : 'zamracene')}${escapeHtml(d.den)}` +
    `${d.pod ? `<small>${escapeHtml(d.pod)}</small>` : ''}</span>`;

/**
 * Využi dnešok (docs/navrhy/vyhlad-dni-bez-slnka.html): slovo s výhľadom a pás dní od dneška - dnes
 * a dni so slnkom zlaté, dni bez slnka s oblakom. Ten istý pás ako pri dňoch bez slnka.
 * @param {NonNullable<Model['co']>['vyhlad']} v @param {Dom} dom
 */
function renderVyhlad(v, dom) {
    show(dom.tzVyhlad, !!v);
    setHtml(dom.tzVyhladT, v ? `${escapeHtml(v.text)} <span>· ${escapeHtml(v.sub)}</span>` : '');
    setHtml(
        dom.tzVyhladPas,
        (v?.dni ?? [])
            .map(
                (d, i) =>
                    `<span data-druh="${d.slnko ? 'slnko' : 'oblak'}"${d.dnes ? ' data-dnes' : ''} style="--i:${i}">` +
                    `${weatherIcon(d.slnko ? 'jasno' : 'zamracene')}${escapeHtml(d.den)}</span>`,
            )
            .join(''),
    );
}

/** Riadok skupiny: veľký čas, ikona, meno a doplnok. @param {NonNullable<Model['co']>['skupiny'][number]['riadky'][number]} r */
const riadokHtml = (r) =>
    `<button type="button" class="ri" data-kind="${r.kind}" data-vec="${r.id}"><span class="velky">${escapeHtml(r.cas)}</span>` +
    `<span class="ri-ico" aria-hidden="true">${vecIcon(r.id)}</span>` +
    `<span><b>${escapeHtml(r.name)}</b><small>${escapeHtml(r.info)}</small></span></button>`;

/**
 * Skupina riadkov. Iný deň je karta s hlavičkou (deň, dátum, pri prvej či dnes slnko už nestačí,
 * docs/navrhy/teraz-iny-den.html, 2B), aby sa jeho časy nečítali ako dnešné.
 * @param {NonNullable<Model['co']>['skupiny'][number]} g
 */
function skupinaHtml(g) {
    const riadky = g.riadky.map(riadokHtml).join('');
    if (!g.karta) return `<h2 class="co-h">${escapeHtml(g.nazov)}</h2><div class="riadky">${riadky}</div>`;
    const pod = [g.karta.datum, g.karta.pozn].filter(Boolean).map(escapeHtml).join(' · ');
    return `<section class="den-karta"><div class="den-karta-h"><h2>${escapeHtml(g.nazov)}</h2><span>${pod}</span></div>${riadky}</section>`;
}

/**
 * Os dňa v detaile spotrebiča (docs/navrhy/teraz-iny-den.html, 1A): tenká os, na nej plný úsek
 * spotrebiča (zo slnka zelený, z lacnej siete modrý), pri dnešku biela čiara „teraz“, pod tým hodiny.
 * Všetko v % osi, takže sa naťahuje so šírkou panelu.
 * @param {NonNullable<Model['os']>} os @param {NonNullable<Model['veci'][number]['slot']>} slot
 */
function osHtml(os, slot) {
    const now = slot.dnes && os.now !== null ? `<i class="os-teraz" style="left:${os.now}%"></i>` : '';
    const ticks = os.ticks.map((t) => `<span class="os-t" style="left:${t.at}%">${t.label}</span>`).join('');
    return (
        `<div class="os"><i class="os-ciara"></i>` +
        `<i class="os-usek" data-tone="${slot.tone}" style="left:${slot.left}%;width:${slot.width}%"></i>${now}${ticks}</div>`
    );
}

/**
 * Vysvetlenie riadku nad dlaždicami (docs/navrhy/teraz-odznaky-vysvetlenie.html): pre odpoveď aj cenu
 * siete štítok, nadpis, čo platí teraz a čo to znamená. Otvorené, kým je v stave a karta má čo vysvetliť.
 * @param {import('../state.js').AppState} state @param {Model | null} m @param {Dom} dom @param {Texts['TERAZ_TEXTS']} T
 */
function renderChipSheet(state, m, dom, T) {
    const chips = state.tzChip && m ? m.chips.filter((c) => c.info) : [];
    if (chips.length) {
        setText(dom.tzChipTitle, m?.co?.hore.oko.text ?? chips[0].info.title);
        setHtml(
            dom.tzChipBody,
            chips
                .map(
                    (c) =>
                        `<section class="chip-info"><span class="chip" data-tone="${c.tone}">${escapeHtml(c.text)}</span>` +
                        `<h3>${escapeHtml(c.info.title)}</h3>${c.info.now ? `<p>${escapeHtml(c.info.now)}</p>` : ''}` +
                        `<p class="q">${escapeHtml(T.chipWhy)}</p><p class="dim">${escapeHtml(c.info.why)}</p></section>`,
                )
                .join('') + (m?.co?.pas ? `<p class="istota">${escapeHtml(TERAZ_PAS_ISTOTA)}</p>` : ''),
        );
        setText(dom.tzChipClose, T.chipClose);
    }
    dialog(dom.tzChipSheet, chips.length > 0, () => (shows(state, 'terazky') ? dom.tzOko : null));
}

/**
 * Detail spotrebiča: ikona, meno, kedy a odkiaľ, od-do (pri inom dni aj deň), jeho úsek na osi dňa,
 * prečo práve vtedy a že naraz ide len toľko, koľko strecha utiahne. Otvorený, kým je v stave
 * a spotrebič je v pláne.
 * @param {import('../state.js').AppState} state @param {Model | null} m @param {Dom} dom @param {Texts['TERAZ_TEXTS']} T
 */
function renderVecSheet(state, m, dom, T) {
    const v = state.tzVec && m ? (m.veci.find((x) => x.id === state.tzVec) ?? null) : null;
    if (v && m?.os) {
        dom.tzVecSheet.dataset.tone = v.tone;
        setHtml(dom.tzVecIco, vecIcon(v.id));
        setText(dom.tzVecName, v.name);
        setText(dom.tzVecKedy, v.kedy);
        // Čas iného dňa nikdy bez dňa - inak by sa čítal ako dnešný.
        setHtml(dom.tzVecCas, `${v.den ? `<span class="vec-den">${escapeHtml(v.den)}</span>` : ''}${escapeHtml(v.cas)}`);
        show(dom.tzVecPas, !!v.slot);
        setHtml(dom.tzVecPas, v.slot ? osHtml(m.os, v.slot) : '');
        setText(dom.tzVecWhy, v.why);
        setText(dom.tzVecNote, PLAN_DNA_NOTE);
        setText(dom.tzVecClose, T.chipClose);
    }
    const id = state.tzVec;
    dialog(dom.tzVecSheet, !!v, () => (shows(state, 'terazky') && id ? dom.tzCo.querySelector(`[data-vec="${id}"]`) : null));
}

/**
 * Pásik pod číslom: koľko z jasnej oblohy. V noci nie je (null).
 * @param {Model['jas']} jas @param {Dom} dom
 */
function renderJas(jas, dom) {
    show(dom.tzJas, !!jas);
    dom.tzJas.classList.toggle('prazdny', jas?.pct === null);
    dom.tzJas.style.setProperty('--jas', String((jas?.pct ?? 0) / 100));
    setText(dom.tzJasLabel, jas?.label ?? '');
    setText(dom.tzJasText, jas?.text ?? '');
}

/** @param {import('../state.js').AppState} state @param {Dom} dom */
export function renderTeraz(state, dom) {
    const T = voiceTexts(state.voice).TERAZ_TEXTS;
    renderStav(state, dom);
    if (!shows(state, 'terazky')) {
        renderChipSheet(state, null, dom, T);
        renderVecSheet(state, null, dom, T);
        return;
    }
    const m = terazModel({ ...state, previewMinutes: null }, { online: state.online, voice: state.voice, devices: state.doma });
    renderPocasie(state, m, dom);
    setText(dom.tzTitle, m.title);
    show(dom.tzNum, m.num !== '');
    dom.tzNum.classList.toggle('est', m.estimate);
    setText(dom.tzNumVal, m.num);
    renderJas(m.jas, dom);
    show(dom.tzSub, m.sub !== '');
    setText(dom.tzSub, m.sub);
    show(dom.tzNote, !!m.note);
    setText(dom.tzNoteTitle, m.note?.title ?? '');
    setText(dom.tzNoteText, m.note?.text ?? '');
    show(dom.tzNoteBtn, !!m.note?.btn);
    setText(dom.tzNoteBtn, m.note?.btn ?? '');
    show(dom.tzRetry, m.retry);
    setText(dom.tzRetry, T.retry);
    show(dom.tzGuess, m.guess);
    setText(dom.tzGuessTitle, T.guessTitle);
    setText(dom.tzGuessText, T.guessText);
    setText(dom.tzGuessBtn, T.guessBtn);
    show(dom.tzAsk, m.ask);
    setText(dom.tzAskTitle, T.askTitle);
    setText(dom.tzAskText, T.askText);
    setText(dom.tzAskBtn, T.askBtn);
    renderCo(m.co, dom);
    // Obrys po ťuknutí na oznámenie: CSS ho spustí, až keď je čo zapnúť naozaj vidieť. `=== true`: starý
    // web/state.js z cache po nasadení pole nemá (CLAUDE.md, Nasadenie a cache).
    dom.tzCo.toggleAttribute('data-obrys', state.tzObrys === true);
    renderChipSheet(state, m, dom, T);
    renderVecSheet(state, m, dom, T);
}

/**
 * Počasie v pozadí karty (docs/navrhy/teraz-pocasie-2.html), vždy teraz. Bez dát o počasí nie je, s vypnutou
 * živou oblohou (Nastavenie › Vzhľad) tiež - kto ju vypol, chcel pokoj. V prehľade so stĺpcami
 * nie je: vrstva siaha cez celú šírku obrazovky, nie len cez stĺpec Teraz.
 * @param {import('../state.js').AppState} state @param {Model} m @param {Dom} dom
 */
function renderPocasie(state, m, dom) {
    const p = state.liveSky && !dashboard(state) ? m.pocasie : null;
    show(dom.wx, !!p);
    if (p) kresliPocasie(dom.wx, p);
}

/**
 * Kresba počasia do nosiča `el` (pozadie karty, panel s grafom dňa): vrstvy, stav, sila dažďa, noc, skutočné
 * hviezdy a Mesiac. @param {HTMLElement} el @param {import('../../shared/pocasie.js').Pocasie} p
 */
export function kresliPocasie(el, p) {
    setHtml(el, pocasieHtml());
    el.dataset.wx = pocasieStav(p);
    // Sila dažďa (docs/navrhy/dazd-sily.html); staršie jadro z cache ju nepošle - kresba ukáže bežný dážď.
    if (p.dazd) el.dataset.dazd = p.dazd;
    else delete el.dataset.dazd;
    el.toggleAttribute('data-noc', p.noc);
    // Skutočné hviezdy do vlastných vrstiev, mimo HTML počasia - ich posun nereštartuje oblaky.
    // Bez nich (cez deň, alebo staršie jadro z cache po nasadení) ostanú hviezdy z CSS.
    const ma = Array.isArray(p.hviezdy);
    el.toggleAttribute('data-hviezdy', ma);
    const [a, b] = ma ? hviezdySvg(/** @type {import('../../shared/hviezdy.js').Hviezda[]} */ (p.hviezdy)) : ['', ''];
    const vrstvy = el.querySelectorAll('.wx-stars, .wx-stars2');
    setHtml(vrstvy[0], a);
    setHtml(vrstvy[1], b);
    // Mesiac len vtedy, keď naozaj stojí v poli pohľadu; rovnako mimo HTML počasia.
    const [svetlo, mesiac] = p.mesiac ? mesiacSvg(p.mesiac) : ['', ''];
    const luna = el.querySelectorAll('.wx-moonglow, .wx-moon');
    setHtml(luna[0], svetlo);
    setHtml(luna[1], mesiac);
    el.toggleAttribute('data-mesiac-stlmeny', p.mesiac?.stlmeny === true);
}
