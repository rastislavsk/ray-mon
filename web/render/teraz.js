// Karta Teraz (docs/navrhy/teraz-navrh-2.html): veľké číslo kW teraz, čo zapnúť (riadok nad dlaždicami,
// dlaždice toho, čo ide teraz, skupiny riadkov), karta Deň s krivkou a výkonom zvoleného
// času, panel s vysvetlením, detail spotrebiča a výzvy. Číslo hore ostáva teraz, zvolený čas je len
// v karte Deň. Všetko počíta shared/teraz.js a texty sú v shared/messages.js - tu sa len zapisuje do DOM.

import { DAY_CHART } from '../../shared/day-chart.js';
import { escapeHtml } from '../../shared/format.js';
import { hlavickaModel, stavRiadok } from '../../shared/hlavicka.js';
import { DAY_CHART_KEYS, PLAN_DNA_NOTE, TERAZ_TONES, voiceTexts } from '../../shared/messages-core.js';
import { skyNow } from '../../shared/sky.js';
import { terazModel } from '../../shared/teraz.js';
import { dayChartHtml } from '../day-chart.js';
import { hviezdySvg, mesiacSvg, pocasieHtml, pocasieStav } from '../pocasie.js';
import { dashboard, shows } from '../state.js';
import { vecIcon } from './icons.js';
import { setHtml, setText, show } from './write.js';

/** @typedef {import('../../shared/teraz.js').TerazModel} Model */
/** @typedef {import('../dom.js').Dom} Dom */
/** @typedef {ReturnType<typeof voiceTexts>} Texts pevné texty v tóne appky */

/** Texty bubliny, keď riadok bublinu nemá. */
const BEZ_BUBLINY = { nadpis: '', text: '', tlacidlo: '' };

/** Riadok stavu merania hovorí vždy o teraz - zvolený čas je len v karte Deň. */
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
    setHtml(
        dom.tzSkupiny,
        co.skupiny
            .map(
                (g) =>
                    `<h2 class="co-h">${escapeHtml(g.nazov)}</h2><div class="riadky">` +
                    g.riadky
                        .map(
                            (r) =>
                                `<button type="button" class="ri" data-kind="${r.kind}" data-vec="${r.id}"><span class="velky">${escapeHtml(r.cas)}</span>` +
                                `<span class="ri-ico" aria-hidden="true">${vecIcon(r.id)}</span>` +
                                `<span><b>${escapeHtml(r.name)}</b><small>${escapeHtml(r.info)}</small></span></button>`,
                        )
                        .join('') +
                    '</div>',
            )
            .join(''),
    );
}

/** Vodorovná poloha na osi grafu (viewBox DAY_CHART) pre % osi pásu - pás a krivka majú tú istú os. @param {number} pct */
const pasX = (pct) => Math.round((DAY_CHART.left + (pct / 100) * (DAY_CHART.right - DAY_CHART.left)) * 10) / 10;

/** Poloha v % šírky pásu pre bod viewBoxu `x`. @param {number} x */
const pasPct = (x) => `${Math.round((x / DAY_CHART.w) * 10000) / 100}%`;

/** Rozmery pásu v px: slnko, sieť. */
const PAS = { h: 58, sunY: 22, sunH: 22, netY: 48, netH: 6 };

/**
 * Pás dňa v detaile spotrebiča: slnko a sieť po úsekoch na tej istej osi ako krivka karty Deň (DAY_CHART),
 * prejdená časť stlmená, teraz biela čiara a zvýraznený úsek spotrebiča (`slot`, v % osi).
 * Výška je v px, šírka sa naťahuje (preserveAspectRatio none, čiary bez zmeny hrúbky).
 * @param {NonNullable<Model['den']>['pas']} pas @param {{ left: number, width: number }} slot
 */
function pasHtml(pas, slot) {
    const rect = (/** @type {{ left: number, width: number, l: string }} */ u, /** @type {number} */ y, /** @type {number} */ h) =>
        `<rect x="${pasX(u.left)}" y="${y}" width="${Math.max(0.5, pasX(u.left + u.width) - pasX(u.left))}" height="${h}" data-l="${u.l}"/>`;
    const sun = pas.slnko.filter((u) => u.l !== 'noc').map((u) => rect(u, PAS.sunY, PAS.sunH));
    const net = pas.siet.map((u) => rect(u, PAS.netY, PAS.netH));
    const nowX = pas.now === null ? null : pasX(pas.now);
    const past =
        nowX === null
            ? ''
            : `<rect x="${DAY_CHART.left}" y="${PAS.sunY}" width="${nowX - DAY_CHART.left}" height="${PAS.netY + PAS.netH - PAS.sunY}" class="pas-past"/>`;
    const nowLine = nowX === null ? '' : `<line x1="${nowX}" x2="${nowX}" y1="${PAS.sunY - 3}" y2="${PAS.h}" class="pas-now"/>`;
    const slotEl = `<rect x="${pasX(slot.left)}" y="${PAS.sunY}" width="${pasX(slot.left + slot.width) - pasX(slot.left)}" height="${PAS.sunH}" rx="4" class="pas-slot"/>`;
    const ticks = pas.ticks.map((t) => `<span class="pas-t" style="left:${pasPct(pasX(t.at))}">${t.label}</span>`).join('');
    return (
        `<div class="pas-box" aria-hidden="true"><svg class="pas" viewBox="0 0 ${DAY_CHART.w} ${PAS.h}" preserveAspectRatio="none">` +
        `<rect x="${DAY_CHART.left}" y="${PAS.sunY}" width="${DAY_CHART.right - DAY_CHART.left}" height="${PAS.sunH}" class="pas-noc"/>` +
        sun.join('') +
        net.join('') +
        past +
        slotEl +
        nowLine +
        `</svg>${ticks}</div>`
    );
}

/** Legenda pod krivkou: farba a slovo. @param {Array<[string, string]>} items */
const legHtml = (items) => items.map(([l, t]) => `<span><i data-l="${l}"></i>${escapeHtml(t)}</span>`).join('');

/**
 * Karta Deň: hore výkon a odkiaľ je (meranie alebo odhad z predpovede) a vpravo čas - teraz alebo
 * zvolený. Pod tým krivka dňa (posúvač času), legenda a pätka s radou alebo „Späť na teraz“.
 * Bez predpovede nie je.
 * @param {Model} m @param {Dom} dom @param {Texts['TERAZ_TEXTS']} T
 */
function renderDen(m, dom, T) {
    const d = m.den;
    const c = m.chart;
    show(dom.tzDen, !!d && !!c);
    if (!d || !c) return;
    const k = d.citanie;
    setHtml(
        dom.tzCitanie,
        `<p class="c-kw"><b>${escapeHtml(k.kw)}</b><span>${escapeHtml(k.zdroj)}</span></p><p class="c-cas">${escapeHtml(k.cas)}</p>`,
    );
    setHtml(dom.tzChart, dayChartHtml(c));
    dom.tzChart.setAttribute('aria-label', T.slider);
    dom.tzChart.setAttribute('aria-valuemin', String(c.range.min));
    dom.tzChart.setAttribute('aria-valuemax', String(c.range.max));
    dom.tzChart.setAttribute('aria-valuenow', String(c.value));
    dom.tzChart.setAttribute('aria-valuetext', k.veta);
    setText(dom.tzChartDesc, c.desc);
    setHtml(
        dom.tzLeg,
        legHtml([
            ['power', DAY_CHART_KEYS.power],
            ['forecast', DAY_CHART_KEYS.forecast],
            ['limit', T.limit],
            ['go', TERAZ_TONES.sun],
            ['cheap', TERAZ_TONES.cheap],
            ['costly', TERAZ_TONES.costly],
        ]),
    );
    show(dom.tzHint, !d.zvolene);
    setText(dom.tzHint, T.hint);
    show(dom.tzReset, d.zvolene);
    setText(dom.tzReset, T.reset);
}

/**
 * Otvorí alebo zavrie dialóg podľa stavu; pri zatvorení vráti fokus na prvok, ktorý ho otvoril.
 * @param {HTMLDialogElement} d @param {boolean} open @param {() => Element | null} opener
 */
function dialog(d, open, opener) {
    if (open && !d.open) d.showModal();
    else if (!open && d.open) {
        d.close();
        const btn = opener();
        if (btn instanceof HTMLElement) btn.focus();
    }
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
                .join(''),
        );
        setText(dom.tzChipClose, T.chipClose);
    }
    dialog(dom.tzChipSheet, chips.length > 0, () => (shows(state, 'terazky') ? dom.tzOko : null));
}

/**
 * Detail spotrebiča: ikona, meno, kedy a odkiaľ, od-do, jeho úsek na páse dňa (keď ide dnes),
 * prečo práve vtedy a že naraz ide len toľko, koľko strecha utiahne. Otvorený, kým je v stave
 * a spotrebič je v pláne.
 * @param {import('../state.js').AppState} state @param {Model | null} m @param {Dom} dom @param {Texts['TERAZ_TEXTS']} T
 */
function renderVecSheet(state, m, dom, T) {
    const v = state.tzVec && m ? (m.veci.find((x) => x.id === state.tzVec) ?? null) : null;
    if (v && m?.den) {
        dom.tzVecSheet.dataset.tone = v.tone;
        setHtml(dom.tzVecIco, vecIcon(v.id));
        setText(dom.tzVecName, v.name);
        setText(dom.tzVecKedy, v.kedy);
        setText(dom.tzVecCas, v.cas);
        show(dom.tzVecPas, !!v.slot);
        setHtml(dom.tzVecPas, v.slot ? pasHtml(m.den.pas, v.slot) : '');
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
    const m = terazModel(
        { ...state, previewMinutes: state.terazPreview },
        { online: state.online, voice: state.voice, devices: state.doma },
    );
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
    renderDen(m, dom, T);
    renderDenNebo(state, m, dom);
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
 * Karta Deň má oblohu zvoleného času (docs/navrhy/teraz-navrh-2.html): farby neba z toho istého
 * výpočtu ako pozadie appky (skyNow v tej chvíli) a tá istá kresba počasia - slnko podľa času na
 * oblúku karty, oblaky, dážď, sneh, hviezdy a Mesiac. Farby prelína CSS (zaregistrované --d1 až --d3).
 * S vypnutou živou oblohou (Nastavenie › Vzhľad) je karta sklo ako ostatné.
 * @param {import('../state.js').AppState} state @param {Model} m @param {Dom} dom
 */
function renderDenNebo(state, m, dom) {
    const p = state.liveSky && m.den ? m.pocasieDen : null;
    dom.tzDen.classList.toggle('nebo', !!p);
    show(dom.tzDenWx, !!p);
    if (!p || !m.den) return;
    const sky = skyNow({ ...state, previewMinutes: state.terazPreview }, true, p);
    dom.tzDen.style.setProperty('--d1', sky.top);
    dom.tzDen.style.setProperty('--d2', sky.bottom);
    dom.tzDen.style.setProperty('--d3', sky.shade);
    kresliPocasie(dom.tzDenWx, p);
    const s = m.den.slnko;
    dom.tzDenWx.style.setProperty('--wx-sx', s ? `${s.x}%` : '50%');
    dom.tzDenWx.style.setProperty('--wx-sy', s ? `${s.y}%` : '130%');
}

/**
 * Kresba počasia do nosiča `el` (pozadie karty, karta Deň): vrstvy, stav, sila dažďa, noc, skutočné
 * hviezdy a Mesiac. @param {HTMLElement} el @param {import('../../shared/pocasie.js').Pocasie} p
 */
function kresliPocasie(el, p) {
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
