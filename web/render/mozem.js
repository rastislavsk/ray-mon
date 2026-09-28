// Karta Môžem?: jedno veľké slovo, pás dneška, veci v mriežke a hláška. Celý obsah skladá
// render do #mozem-body - v index.html je len nosič, takže zmena vnútri karty nepotrebuje dve
// nasadenia (viď CLAUDE.md). Počíta shared/mozem.js, texty sú v shared/messages.js.

import { HOUR_RANGE } from '../../shared/chart-model.js';
import { escapeHtml, hourLabel, minutesToTimeStr } from '../../shared/format.js';
import { mozemModel } from '../../shared/mozem.js';
import { localMinutes } from '../../shared/solar.js';
import { MOZEM_ICONS, MOZEM_MARKS } from '../icons.js';
import { writeHtml } from '../memo.js';

/** @typedef {ReturnType<typeof mozemModel>} MozemModel */

/** Veľké slovo pod 10 znakov sa zmestí vo veľkom písme, dlhšie („Dnes už nie.“) dostane menšie. */
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

/** Vec v mriežke; rozbalená má pod sebou vysvetlenie cez celú šírku. @param {MozemModel['items'][number]} it @param {boolean} open */
function itemHtml(it, open) {
    const mark = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${MOZEM_MARKS[it.tone]}"/></svg>`;
    const btn =
        `<button type="button" class="mozem-item${open ? ' open' : ''}" data-mozem-item="${it.id}" aria-expanded="${open}">` +
        `<span class="mozem-ico">${MOZEM_ICONS[/** @type {keyof typeof MOZEM_ICONS} */ (it.id)] || ''}</span>` +
        `<span class="mozem-t"><b>${escapeHtml(it.name)}</b><span class="tone-${it.tone}">${escapeHtml(it.short)}</span></span>` +
        `<span class="mozem-mark tone-${it.tone}">${mark}</span></button>`;
    if (!open) return btn;
    const extra = it.extra ? `<p class="mozem-extra">${escapeHtml(it.extra)}</p>` : '';
    const log = it.log
        ? `<button type="button" class="mozem-log" data-mozem-log="${it.id}" data-sun="${it.log.sun ? 1 : 0}" aria-pressed="${it.log.pressed}">${escapeHtml(it.log.label)}</button>`
        : '';
    return `${btn}<div class="mozem-more" role="region" aria-label="${escapeHtml(it.name)}"><b>${escapeHtml(it.head)}</b><p>${escapeHtml(it.text)}</p>${extra}${log}</div>`;
}

/**
 * Obsah karty z modelu. `open` je rozbalená vec, `kick` riadok nad slovom („Teraz · 13:00 · Dvorany“).
 * @param {MozemModel} m @param {string | null} open @param {string} kick
 */
export function mozemHtml(m, open, kick) {
    const items = m.items.map((it) => itemHtml(it, it.id === open)).join('');
    return (
        heroHtml(m, kick) +
        stripHtml(m) +
        `<div class="mozem-lbl"><span>Čo môžem</span><span>ťukni</span></div><div class="mozem-grid">${items}</div>` +
        (m.count ? `<p class="mozem-count">${escapeHtml(m.count)}</p>` : '') +
        `<button type="button" class="mozem-quip" data-mozem-quip aria-label="Ďalšia hláška: ${escapeHtml(m.quip)}"><q>${escapeHtml(m.quip)}</q>` +
        `<small aria-hidden="true">ťukni pre ďalšiu</small></button>`
    );
}

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
export function renderMozem(state, dom) {
    const m = mozemModel(state, state.mozemQuip, state.launches);
    const kick = `Teraz · ${minutesToTimeStr(localMinutes(state.now, state.site.timezone))} · ${state.site.name}`;
    writeHtml(dom.mozemBody, mozemHtml(m, state.mozemOpen, kick), 'mozemBody');
}
