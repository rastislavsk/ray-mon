// Karta Teraz (docs/navrhy/teraz-navrh-2.html): veľké číslo kW teraz, čo zapnúť (riadok nad dlaždicami,
// dlaždice toho, čo ide teraz, skupiny riadkov), panel s vysvetlením, detail spotrebiča a výzvy. Graf
// dňa je v paneli karty Dnes (render/graf.js). Všetko počíta shared/teraz.js a texty sú v
// shared/messages.js - tu sa len zapisuje do DOM.

import { escapeHtml } from '../../shared/format.js';
import { hlavickaModel, stavRiadok } from '../../shared/hlavicka.js';
import { PLAN_DNA_NOTE, TERAZ_HREBEN, TERAZ_PAS_ISTOTA, voiceTexts } from '../../shared/messages-core.js';
import { terazModel } from '../../shared/teraz.js';
import { hviezdySvg, mesiacSvg, pocasieHtml, pocasieStav } from '../pocasie.js';
import { dashboard, shows } from '../state.js';
import { vecIcon } from './icons.js';
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

/** Rozmery hrebeňa v jednotkách SVG: šírka, výška, os (spodok kriviek) a výška najvyššieho bodu. */
const HREBEN = { w: 322, h: 92, os: 70, vyska: 60 };

/**
 * Krivka jedného dňa ako uzavretá plocha nad osou: body spojené oblúkmi cez stredy úsečiek.
 * @param {number[]} body výšky 0 až 1 @param {number} x0 ľavý kraj stĺpca dňa @param {number} sirka šírka stĺpca
 */
function plochaDna(body, x0, sirka) {
    const p = body.map((v, i) => [x0 + 3 + (i * (sirka - 6)) / (body.length - 1), HREBEN.os - v * HREBEN.vyska]);
    const r = (/** @type {number} */ n) => Math.round(n * 10) / 10;
    let d = `M${r(p[0][0])},${HREBEN.os}L${r(p[0][0])},${r(p[0][1])}`;
    for (let i = 1; i < p.length - 1; i++)
        d += `Q${r(p[i][0])},${r(p[i][1])} ${r((p[i][0] + p[i + 1][0]) / 2)},${r((p[i][1] + p[i + 1][1]) / 2)}`;
    const k = p[p.length - 1];
    return `${d}L${r(k[0])},${r(k[1])}L${r(k[0])},${HREBEN.os}Z`;
}

/**
 * Hrebeň týždňa (docs/navrhy/teraz-vyhlad-alternativy.html, C): krivky dní vedľa seba, čo je nad hranicou
 * veľkých spotrebičov zlaté, pod ňou sivomodré (len 4 dni: ďalšie sú príliš nepresné),
 * biela bodka je teraz. Pod každým dňom je tlačidlo cez celý stĺpec - ťuknutie ukáže plán toho dňa.
 * @param {Model['hreben']} h @param {Dom} dom
 */
function renderHreben(h, dom) {
    show(dom.tzHreben, !!h);
    if (!h) return;
    const sirka = HREBEN.w / h.dni.length;
    const y = HREBEN.os - h.hranica * HREBEN.vyska;
    const dni = h.dni.map((d, i) => `<path d="${plochaDna(d.body, i * sirka, sirka)}"/>`).join('');
    const t = h.teraz;
    const teraz = t ? `<circle class="hr-teraz" cx="${3 + t.x * (sirka - 6)}" cy="${HREBEN.os - t.y * HREBEN.vyska}" r="3.5"/>` : '';
    setHtml(
        dom.tzHrebenSvg,
        `<svg viewBox="0 0 ${HREBEN.w} ${HREBEN.h}"><defs><clipPath id="tz-hreben-nad"><rect width="${HREBEN.w}" height="${y}"/></clipPath></defs>` +
            `<g class="hr-pod">${dni}</g><g class="hr-nad" clip-path="url(#tz-hreben-nad)">${dni}</g>` +
            `<line class="hr-hranica" x1="0" x2="${HREBEN.w}" y1="${y}" y2="${y}"/><line class="hr-os" x1="0" x2="${HREBEN.w}" y1="${HREBEN.os}" y2="${HREBEN.os}"/>${teraz}</svg>`,
    );
    dom.tzHrebenDni.setAttribute('aria-label', TERAZ_HREBEN.label);
    // Zvolený deň nie je v HTML tlačidiel - ťuknutie ich tak neprepíše a fokus ostane, kde bol.
    setHtml(
        dom.tzHrebenDni,
        h.dni
            .map(
                (d, i) =>
                    // Meno dňa a či slnko stačí je pre čítačku za skratkou - prístupné meno tak obsahuje to, čo je vidno.
                    `<button type="button" data-den="${i}"${i === 0 ? ' data-dnes' : ''}${d.nad ? ' data-nad' : ''}>${escapeHtml(d.den)}` +
                    `<span class="sr"> – ${escapeHtml(d.nad ? d.name : `${d.name}, ${TERAZ_HREBEN.pod}`)}</span></button>`,
            )
            .join(''),
    );
    Array.from(dom.tzHrebenDni.children).forEach((b, i) => b.setAttribute('aria-pressed', String(i === h.zvoleny)));
}

/**
 * Čo zapnúť: pri dnešku riadok nad dlaždicami (bodka, odkiaľ ide prúd, pri ničom aj cena siete) a dlaždice
 * toho, čo ide teraz (alebo najbližšia vec s rámom), pri inom dni jeho hlavička; pod tým skupiny riadkov
 * zvoleného dňa. Dlaždica aj riadok nesú `data-vec`, ťuknutie otvorí detail spotrebiča. Bez Plánu dňa
 * (bez predpovede, nič doma) nie je.
 * @param {Model['co']} co @param {Dom} dom
 */
function renderCo(co, dom) {
    show(dom.tzCo, !!co);
    if (!co) return;
    const h = co.hore;
    const dnes = !co.den;
    show(dom.tzDen, !dnes);
    setText(dom.tzDenNazov, co.den?.nazov ?? '');
    setText(dom.tzDenPod, co.den?.pod ?? '');
    show(dom.tzOko, dnes);
    dom.tzOkoBod.dataset.tone = h.bod;
    setHtml(dom.tzOkoT, `${escapeHtml(h.oko.text)}${h.oko.sub ? ` <span>· ${escapeHtml(h.oko.sub)}</span>` : ''}`);
    show(dom.tzOkoPod, dnes && !!h.bezSlnka);
    setText(dom.tzOkoPod, h.bezSlnka);
    const dlazdice = h.dlazdice.map(
        (d) =>
            `<button type="button" class="dl${d.cela ? ' cela' : ''}" data-tone="${d.tone}" data-vec="${d.id}">${ikona(d.id)}` +
            `<span><b>${escapeHtml(d.name)}</b><small>${escapeHtml(d.sub)}</small>` +
            `${d.potom ? `<em class="potom"${d.potom.dlho ? ' data-dlho' : ''}>${escapeHtml(d.potom.text)}</em>` : ''}</span></button>`,
    );
    const p = h.dalsi;
    const dalsi = p
        ? `<button type="button" class="dl cela" data-tone="next" data-cheap="${p.tone === 'cheap'}" data-vec="${p.id}">${ikona(p.id)}` +
          `<span><span class="velky">${escapeHtml(p.cas)}</span><b>${escapeHtml(p.name)}</b><small>${escapeHtml(p.sub)}</small></span></button>`
        : '';
    setHtml(dom.tzDlazdice, dlazdice.join('') + dalsi);
    show(dom.tzDlazdice, dnes && (dlazdice.length > 0 || !!p));
    setHtml(dom.tzSkupiny, co.skupiny.map(skupinaHtml).join(''));
}

/**
 * Riadok skupiny: veľký čas, ikona, meno a doplnok; pri núdzovom čase pásik, koľko programu dá slnko
 * (zlatá) a koľko sieť (modrá). @param {NonNullable<Model['co']>['skupiny'][number]['riadky'][number]} r
 */
const riadokHtml = (r) =>
    `<button type="button" class="ri" data-kind="${r.kind}" data-vec="${r.id}"><span class="velky">${escapeHtml(r.cas)}</span>` +
    `<span class="ri-ico" aria-hidden="true">${vecIcon(r.id)}</span>` +
    `<span><b>${escapeHtml(r.name)}</b>${r.podiel === null ? '' : `<i class="podiel" style="--s:${r.podiel}%"></i>`}` +
    `<small>${escapeHtml(r.info)}</small></span></button>`;

/** Skupina riadkov s nadpisom. @param {NonNullable<Model['co']>['skupiny'][number]} g */
const skupinaHtml = (g) => `<h2 class="co-h">${escapeHtml(g.nazov)}</h2><div class="riadky">${g.riadky.map(riadokHtml).join('')}</div>`;

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
                .join('') + (m?.co?.dlho ? `<p class="istota">${escapeHtml(TERAZ_PAS_ISTOTA)}</p>` : ''),
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
    const m = terazModel(
        { ...state, previewMinutes: null },
        // `?? 0`: starý web/state.js z cache po nasadení pole tzDen nemá (CLAUDE.md, Nasadenie a cache).
        { online: state.online, voice: state.voice, devices: state.doma, den: state.tzDen ?? 0 },
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
    renderHreben(m.co ? m.hreben : null, dom);
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
