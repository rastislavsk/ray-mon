// Karta Môžem?: jedno veľké slovo, pás dneška a riadok „Čo môžem“; spotrebiče v dlaždiciach
// sú o ťuknutie ďalej, na obrazovke so zoznamom. Celý obsah skladá render do #mozem-body,
// v index.html je len nosič. Počíta shared/mozem.js, texty sú v shared/messages.js.

import { HOUR_RANGE } from '../../shared/chart-model.js';
import { escapeHtml, hourLabel, minutesToTimeStr } from '../../shared/format.js';
import { MOZEM_ANYTIME, mozemTileNote } from '../../shared/messages.js';
import { mozemModel } from '../../shared/mozem.js';
import { summaryModel } from '../../shared/summary.js';
import { localMinutes } from '../../shared/solar.js';
import { ICON_NEXT, MOZEM_ICONS, MOZEM_MARKS } from '../icons.js';
import { writeHtml } from '../memo.js';
import { backButtonHtml, summaryHtml, summaryLinkHtml } from './suhrn.js';

/** @typedef {ReturnType<typeof mozemModel>} MozemModel */

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

/** Pás dneška: úsek so slnkom, prešlý čas šrafovaný, značka „teraz“. @param {MozemModel} m */
function stripHtml(m) {
    const s = m.strip;
    if (!s) return '';
    const win = s.width > 0 ? `<i class="mozem-win st-${m.state}" style="left:${s.left}%;width:${s.width}%"></i>` : '';
    return (
        `<div class="mozem-strip"><div class="mozem-strip-top" aria-hidden="true"><span>${hourLabel(HOUR_RANGE.min)}</span><span>dnes</span><span>${hourLabel(HOUR_RANGE.max)}</span></div>` +
        `<div class="mozem-track" aria-hidden="true">${win}<i class="mozem-past" style="width:${s.now}%"></i><i class="mozem-now" style="left:${s.now}%"></i></div>` +
        `<p class="mozem-strip-lbl">${escapeHtml(s.text)}</p></div>`
    );
}

/** @param {string} id */
const iconOf = (id) => MOZEM_ICONS[/** @type {keyof typeof MOZEM_ICONS} */ (id)] || '';

/**
 * Dlaždica spotrebiča: ikona, značka odpovede, meno, veľká odpoveď a pod ňou odkiaľ pôjde prúd
 * (kým vec beží, nič - odpoveď to povie sama). Farbu dlaždice dáva `data-tone`.
 * @param {MozemModel['items'][number]} it @param {boolean} open
 */
function tileHtml(it, open) {
    const mark = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${MOZEM_MARKS[it.tone]}"/></svg>`;
    const note = it.log?.pressed ? '' : mozemTileNote(it.answer);
    return (
        `<button type="button" class="mozem-item${open ? ' open' : ''}" data-mozem-item="${it.id}" data-tone="${it.tone}" aria-expanded="${open}"` +
        `${open ? ' aria-controls="mozem-more"' : ''}><span class="mozem-ico">${iconOf(it.id)}</span>` +
        `<span class="mozem-mark tone-${it.tone}">${mark}</span>` +
        `<span class="mozem-t"><b>${escapeHtml(it.name)}</b><span class="tone-${it.tone}">${escapeHtml(it.short)}</span>` +
        `${note ? `<small>${escapeHtml(note)}</small>` : ''}</span></button>`
    );
}

/** Rozbalenie veci cez celú šírku: čo robiť, prečo, vysvetlenie a zápis. @param {MozemModel['items'][number]} it */
function moreHtml(it) {
    const extra = it.extra ? `<p class="mozem-extra">${escapeHtml(it.extra)}</p>` : '';
    const log = it.log
        ? `<button type="button" class="mozem-log" data-mozem-log="${it.id}" data-sun="${it.log.sun ? 1 : 0}" aria-pressed="${it.log.pressed}">${escapeHtml(it.log.label)}</button>`
        : '';
    return `<div class="mozem-more" id="mozem-more" role="region" aria-label="${escapeHtml(it.name)}"><b>${escapeHtml(it.head)}</b><p>${escapeHtml(it.text)}</p>${extra}${log}</div>`;
}

/**
 * Mriežka dlaždíc po dvoch. Rozbalenie ide za riadok, v ktorom je otvorená dlaždica - za ňu
 * samu by rozdelilo dvojicu a druhú dlaždicu odsunulo pod seba.
 * @param {MozemModel['items']} devices @param {string | null} open
 */
function tilesHtml(devices, open) {
    const at = devices.findIndex((it) => it.id === open);
    const after = at < 0 ? -1 : Math.min(at | 1, devices.length - 1);
    return devices.map((it, i) => tileHtml(it, i === at) + (i === after ? moreHtml(devices[at]) : '')).join('');
}

/**
 * Pás dneška nad dlaždicami na plnej farbe stavu: čo platí a dokedy, okno so slnkom, prešlý čas
 * šrafovaný, odpočet a veta, koľko spotrebičov ide hneď. Bez pásu dneška (bez dát) nie je.
 * @param {MozemModel} m
 */
function bandHtml(m) {
    const b = m.band;
    const s = m.strip;
    if (!b || !s) return '';
    const win = s.width > 0 ? `<i class="mozem-band-win" style="left:${s.left}%;width:${s.width}%"></i>` : '';
    return (
        `<div class="mozem-band st-${m.state}"><p class="mozem-band-top"><b>${escapeHtml(b.label)}</b>` +
        `${b.value ? `<span>${escapeHtml(b.value)}</span>` : ''}</p>` +
        `<div class="mozem-band-track" aria-hidden="true">${win}<i class="mozem-band-past" style="width:${s.now}%"></i></div>` +
        `<p class="mozem-band-ticks"><span aria-hidden="true">${hourLabel(HOUR_RANGE.min)}</span><span>${escapeHtml(b.mid)}</span>` +
        `<span aria-hidden="true">${hourLabel(HOUR_RANGE.max)}</span></p><p class="mozem-band-text">${escapeHtml(b.text)}</p></div>`
    );
}

/** Blok Kedykoľvek: bežné veci, na ktoré slnko netreba, s prerušovaným obrysom. @param {MozemModel} m */
function anytimeHtml(m) {
    const things = m.anytime.map((a) => `<span>${iconOf(a.id)}${escapeHtml(a.name)}</span>`).join('');
    return (
        `<div class="mozem-anytime"><div class="mozem-anytime-row"><h4>${escapeHtml(MOZEM_ANYTIME.title)}</h4>${things}</div>` +
        `<p>${escapeHtml(MOZEM_ANYTIME.text)}</p></div>`
    );
}

/** Spotrebiče - dlaždice zoznamu; veci, na ktoré slnko netreba, sú v bloku Kedykoľvek. @param {MozemModel} m */
const devicesOf = (m) => m.items.filter((it) => it.answer.kind !== 'always');

/**
 * Riadok, ktorý otvára zoznam vecí: koľko ide hneď, bodka za každú vec vo farbe jej odpovede
 * a výnimky slovom. Ikony sú až v zozname, karta ostáva čistá.
 * @param {MozemModel} m
 */
function glanceHtml(m) {
    const pips = devicesOf(m)
        .map((it) => `<i class="tone-${it.tone}"></i>`)
        .join('');
    return (
        `<button type="button" class="mozem-glance" data-mozem-list><span class="mozem-glance-t"><small>Čo môžem</small>` +
        `<b>${escapeHtml(m.glance.title)}</b><span class="mozem-glance-sub"><span class="mozem-pips" aria-hidden="true">${pips}</span>` +
        `${escapeHtml(m.glance.sub)}</span></span>${ICON_NEXT}</button>`
    );
}

/**
 * Hlavná obrazovka karty z modelu. `kick` je riadok nad slovom („Teraz · 13:00 · Dvorany“).
 * @param {MozemModel} m @param {string} kick
 */
export function mozemHtml(m, kick) {
    return heroHtml(m, kick) + stripHtml(m) + glanceHtml(m);
}

/**
 * Obrazovka so zoznamom vecí (variant C v docs/navrhy/mozem-co-mozem-c.html): šípka späť,
 * nadpis, pás dneška, dlaždice spotrebičov, blok Kedykoľvek a zápisy. `open` je rozbalená vec.
 * @param {MozemModel} m @param {string | null} open @param {string} kick
 */
export function mozemListHtml(m, open, kick) {
    return (
        `<section class="mozem-list">${backButtonHtml('mozem-back', 'data-mozem-list-back')}` +
        `<h3 class="mozem-list-title">Čo môžem</h3><p class="mozem-list-kick">${escapeHtml(kick)}</p>` +
        `${bandHtml(m)}<div class="mozem-grid">${tilesHtml(devicesOf(m), open)}</div>${anytimeHtml(m)}` +
        (m.count ? `<p class="mozem-count">${escapeHtml(m.count)}</p>` : '') +
        `</section>`
    );
}

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
export function renderMozem(state, dom) {
    // Súhrn je obrazovka tej istej karty, v tom istom nosiči - ako detail dňa v karte 7 dní.
    if (state.mozemSummary)
        return writeHtml(dom.mozemBody, summaryHtml(summaryModel(state, state.summaryPeriod), state.summaryPeriod), 'mozemBody');
    const m = mozemModel(state, 0, state.launches);
    const kick = `Teraz · ${minutesToTimeStr(localMinutes(state.now, state.site.timezone))} · ${state.site.name}`;
    // Zoznam vecí je druhá obrazovka karty v tom istom nosiči, rovnako ako súhrn.
    if (state.mozemList) return writeHtml(dom.mozemBody, mozemListHtml(m, state.mozemOpen, kick), 'mozemBody');
    writeHtml(dom.mozemBody, mozemHtml(m, kick) + summaryLinkHtml(summaryModel(state, 'mesiac')), 'mozemBody');
}
