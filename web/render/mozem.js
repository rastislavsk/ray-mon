// Karta Môžem?: jedno veľké slovo a dlaždice skupín vecí; ťuknutie na dlaždicu otvorí
// panel veci či skupiny zospodu (ten istý ako v novej appke). Obsah karty skladá render
// do #mozem-body, panel je dialóg v index.html. Počíta shared/mozem.js, texty sú v shared/messages.js.

import { escapeHtml, minutesToTimeStr } from '../../shared/format.js';
import { MOZEM_SKY_TEXTS, NO_LIVE_FACT, PLAN_DNA_LESS, PLAN_DNA_NOW, PLAN_DNA_TITLE, planDnaMoreText } from '../../shared/messages.js';
import { mozemModel, mozemSheetOf } from '../../shared/mozem.js';
import { neplatiOf } from '../../shared/pristup.js';
import { localMinutes } from '../../shared/solar.js';
import { MOZEM_ICONS } from '../icons.js';
import { writeHtml } from '../memo.js';

/** @typedef {ReturnType<typeof mozemModel>} MozemModel */
/** @typedef {MozemModel['plan']} PlanModel */
/** @typedef {import('../dom.js').Dom} Dom */

/** Veľké slovo pod 10 znakov sa zmestí vo veľkom písme, dlhšie („NO NO, NOT YET“) dostane menšie. */
const LONG_WORD = 10;

/** Hlavička: kedy, kde, veľké slovo, veta a fakt. @param {MozemModel} m @param {string} kick */
function heroHtml(m, kick) {
    const fact = m.hero.factK
        ? `<div class="mozem-fact"><span>${escapeHtml(m.hero.factK)}</span><span>${escapeHtml(m.hero.factV)}</span></div>`
        : '';
    return (
        `<section class="mozem-hero st-${m.state}"><div class="mozem-kick">${escapeHtml(kick)}</div>` +
        `<p class="mozem-word${m.word.length >= LONG_WORD ? ' long' : ''}">${escapeHtml(m.word)}</p>` +
        `<p class="mozem-lead">${escapeHtml(m.hero.lead)}</p>${fact}</section>`
    );
}

/** @param {string} id */
const iconOf = (id) => MOZEM_ICONS[/** @type {keyof typeof MOZEM_ICONS} */ (id)] || '';

/** Pás dňa v širokej dlaždici: uplynulá časť okna stlmená. Čítačke nič nehovorí. @param {NonNullable<MozemModel['groups'][number]['bar']>} b */
function barHtml(b) {
    const end = b.left + b.width;
    const past = Math.max(0, Math.min(b.now, end) - b.left);
    const seg = (/** @type {number} */ from, /** @type {number} */ w, /** @type {string} */ cls) =>
        w > 0 ? `<i${cls} style="left:${from}%;width:${w}%"></i>` : '';
    return (
        `<div class="mozem-tile-bar" aria-hidden="true">${seg(b.left, past, ' class="past"')}${seg(b.left + past, b.width - past, '')}` +
        `<span style="left:${b.now}%"></span></div>` +
        `<div class="mozem-tile-ticks" aria-hidden="true">${b.ticks.map((t) => `<span>${t}</span>`).join('')}</div>`
    );
}

/** Dlaždica skupiny: celá je tlačidlo, ktoré otvorí panel veci či skupiny. @param {MozemModel['groups'][number]} g */
function tileHtml(g) {
    const icons = g.items.map(iconOf).join('');
    const name = `<span class="mozem-tile-name">${escapeHtml(g.name)}</span>`;
    const head = `<span class="mozem-tile-hd">${icons}${name}</span>`;
    const note = g.note ? `<small>${escapeHtml(g.note)}</small>` : '';
    return (
        `<button type="button" class="mozem-tile" data-mozem-item="${g.key}" data-size="${g.size}" data-tone="${g.tone}" aria-haspopup="dialog">` +
        `${head}<b>${escapeHtml(g.value)}</b>${note}${g.bar ? barHtml(g.bar) : ''}</button>`
    );
}

/** Dlaždice skupín vecí s nadpisom; kým sa načítava, nie sú. @param {MozemModel} m */
function tilesHtml(m) {
    if (!m.list) return '';
    return (
        `<section class="mozem-tiles-box" aria-labelledby="mozem-tiles-ttl"><h3 id="mozem-tiles-ttl" class="mozem-tiles-ttl">${escapeHtml(m.list.title)}</h3>` +
        `<div class="mozem-tiles${m.list.estimate ? ' est' : ''}">${m.groups.map(tileHtml).join('')}</div></section>`
    );
}

/**
 * Plán dňa pod dlaždicami: čas, spotrebič a prečo. Bez plánu (načítava sa, bez predpovede) nie je.
 * Zbalený ukáže len prvý riadok (čo je na rade) a tlačidlo, ktoré rozbalí ostatné aj s pätkou.
 * @param {PlanModel} plan @param {boolean} open
 */
function planHtml(plan, open) {
    if (!plan || !plan.rows.length) return '';
    const more = plan.rows.length - 1;
    const shown = open || !more ? plan.rows : plan.rows.slice(0, 1);
    const rows = shown.map(
        (r) =>
            `<li data-tone="${r.tone}"><span class="mozem-plan-t">${escapeHtml(r.time)}</span>` +
            `<span class="mozem-plan-n">${escapeHtml(r.name)}${r.now ? `<em>${escapeHtml(PLAN_DNA_NOW)}</em>` : ''}</span>` +
            `<span class="mozem-plan-w">${escapeHtml(r.why)}</span></li>`,
    );
    return (
        `<section class="mozem-plan" aria-labelledby="mozem-plan-ttl"><h3 id="mozem-plan-ttl" class="mozem-plan-ttl">${escapeHtml(PLAN_DNA_TITLE)}</h3>` +
        `<div class="mozem-plan-box"><ol id="mozem-plan-list" class="mozem-plan-list${shown.length < plan.rows.length ? ' zbaleny' : ''}">${rows.join('')}</ol>` +
        (open || !more ? `<p class="mozem-plan-note">${escapeHtml(plan.note)}</p>` : '') +
        (more
            ? `<button type="button" class="mozem-plan-more" data-mozem-plan aria-expanded="${open}" aria-controls="mozem-plan-list">` +
              `<span>${escapeHtml(open ? PLAN_DNA_LESS : planDnaMoreText(more))}</span><span class="tz-chev" aria-hidden="true"></span></button>`
            : '') +
        `</div></section>`
    );
}

/**
 * Hlavná obrazovka karty z modelu. `kick` je riadok nad slovom („Teraz · 13:00 · Dvorany“),
 * `plan` plán dňa pod dlaždicami, `planOpen` či je rozbalený.
 * @param {MozemModel} m @param {string} kick @param {PlanModel} [plan] @param {boolean} [planOpen]
 */
export function mozemHtml(m, kick, plan = null, planOpen = false) {
    return heroHtml(m, kick) + tilesHtml(m) + (m.list ? planHtml(plan, planOpen) : '');
}

/** Riadky panelu skupiny: meno, krátka odpoveď a prečo. @param {MozemModel['items']} rows */
function rowsHtml(rows) {
    return rows
        .map(
            (it) =>
                `<div class="mozem-sheet-row"><h3>${escapeHtml(it.name)}<span data-tone="${it.tone}">${escapeHtml(it.short)}</span></h3>` +
                `<p>${escapeHtml(it.text)}</p></div>`,
        )
        .join('');
}

/** Dlaždica, ktorej panel je práve otvorený - po zatvorení sa fokus vráti na ňu. @type {string | null} */
let shown = null;

/**
 * Panel veci či skupiny: texty a otvorenie či zatvorenie dialógu podľa stavu. Po zatvorení
 * (krížik, Escape, Späť) sa fokus vráti na dlaždicu, z ktorej sa panel otvoril.
 * @param {ReturnType<typeof mozemSheetOf>} open @param {Dom} dom
 */
function renderSheet(open, dom) {
    if (!open) {
        if (dom.mozemSheet.open) dom.mozemSheet.close();
        const tile = shown && dom.mozemBody.querySelector(`[data-mozem-item="${shown}"]`);
        shown = null;
        if (tile instanceof HTMLElement) tile.focus();
        return;
    }
    dom.mozemSheetX.setAttribute('aria-label', MOZEM_SKY_TEXTS.close);
    if ('group' in open) groupSheet(open.group, dom);
    else itemSheet(open.item, dom);
    if (!dom.mozemSheet.open) dom.mozemSheet.showModal();
    shown = open.key;
}

/** Text prvku panelu; prázdny prvok sa skryje. @param {HTMLElement} el @param {string} text */
function put(el, text) {
    el.textContent = text;
    el.classList.toggle('hidden', !text);
}

/** Panel skupiny: nadpis, veta o slnku a veci skupiny. @param {NonNullable<MozemModel['groups'][number]['sheet']>} group @param {Dom} dom */
function groupSheet(group, dom) {
    put(dom.mozemSheetTitle, group.title);
    put(dom.mozemSheetLead, group.lead);
    dom.mozemSheetRows.innerHTML = rowsHtml(group.rows);
    dom.mozemSheetRows.classList.remove('hidden');
    for (const el of [dom.mozemSheetDoQ, dom.mozemSheetDo, dom.mozemSheetWhyQ, dom.mozemSheetWhy, dom.mozemSheetMoreQ, dom.mozemSheetMore])
        put(el, '');
}

/** Panel veci: čo robiť, prečo a otázka s odpoveďou. @param {MozemModel['items'][number]} it @param {Dom} dom */
function itemSheet(it, dom) {
    put(dom.mozemSheetTitle, it.title);
    put(dom.mozemSheetLead, '');
    dom.mozemSheetRows.innerHTML = '';
    dom.mozemSheetRows.classList.add('hidden');
    put(dom.mozemSheetDoQ, MOZEM_SKY_TEXTS.sheetDo);
    put(dom.mozemSheetDo, it.head);
    put(dom.mozemSheetWhyQ, MOZEM_SKY_TEXTS.sheetWhy);
    put(dom.mozemSheetWhy, it.text);
    put(dom.mozemSheetMoreQ, it.more ? it.more.q : '');
    put(dom.mozemSheetMore, it.more ? it.more.a : '');
}

/** Model karty pre stav appky. @param {import('../state.js').AppState} state */
function modelOf(state) {
    const model = mozemModel(state, { devices: state.oznamenia.devices });
    // Meranie je pripojené, len výrobca prestal prijímať prístup - nie „bez merania“ (shared/pristup.js).
    const neplati = model.hero.factK === NO_LIVE_FACT && !!neplatiOf(state);
    return neplati ? { ...model, hero: { ...model.hero, factK: 'meranie neplatí' } } : model;
}

/** Panel veci patrí karte Môžem?; keď nie je na obrazovke, je vždy zatvorený. @param {Dom} dom */
export function closeMozemSheet(dom) {
    renderSheet(null, dom);
}

/** @param {import('../state.js').AppState} state @param {Dom} dom */
export function renderMozem(state, dom) {
    const m = modelOf(state);
    const kick = `Teraz · ${minutesToTimeStr(localMinutes(state.now, state.site.timezone))} · ${state.site.name}`;
    writeHtml(dom.mozemBody, mozemHtml(m, kick, m.plan, state.mozemPlanOpen), 'mozemBody');
    renderSheet(mozemSheetOf(m, state.mozemItem), dom);
}
