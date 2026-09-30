// Karta Môžem?: jedno veľké slovo, pás dneška, veci v mriežke a hláška. Celý obsah skladá
// render do #mozem-body - v index.html je len nosič, takže zmena vnútri karty nepotrebuje dve
// nasadenia (viď CLAUDE.md). Počíta shared/mozem.js, texty sú v shared/messages.js.

import { HOUR_RANGE } from '../../shared/chart-model.js';
import { escapeHtml, hourLabel, minutesToTimeStr } from '../../shared/format.js';
import { mozemModel } from '../../shared/mozem.js';
import { summaryModel } from '../../shared/summary.js';
import { localMinutes } from '../../shared/solar.js';
import { MOZEM_ICONS, MOZEM_MARKS } from '../icons.js';
import { changed, writeHtml } from '../memo.js';
import { summaryHtml, summaryLinkHtml } from './suhrn.js';

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
 * Hlášky ako pás na listovanie - ten istý kolotoč (.pager), aký má karta Terazky pod ciferníkom.
 * Posúva a prichytáva prehliadač, ťuknutie na hlášku posunie pás na ďalšiu. Jediná hláška
 * (načítava sa) je bez bodiek a pás nemá kam ísť.
 *
 * Stránka v HTML nie je - ani aktívna bodka (tú prepína renderMozem triedou). Inak by každé
 * listovanie prepísalo celý obsah karty a prepis uprostred plynulého posunu pás zastaví.
 * @param {MozemModel} m
 */
function quipsHtml(m) {
    const pages = m.quips
        .map(
            (q) =>
                `<div class="pager-page"><button type="button" class="mozem-quip" data-mozem-quip aria-label="Ďalšia hláška: ${escapeHtml(q)}"><q>${escapeHtml(q)}</q></button></div>`,
        )
        .join('');
    const dots =
        m.quips.length > 1
            ? `<div class="pager-dots mozem-quip-dots">${m.quips
                  .map(
                      (_, i) =>
                          `<button type="button" class="pager-dot" data-mozem-quip-dot="${i}" aria-label="Hláška ${i + 1} z ${m.quips.length}"></button>`,
                  )
                  .join('')}</div>`
            : '';
    return `<div class="pager mozem-quips" data-mozem-quips role="group" aria-label="Hlášky, potiahni do strán" tabindex="0">${pages}</div>${dots}`;
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
        quipsHtml(m)
    );
}

/** Posun pásu hlášok v nosiči, null = pás tam nie je (súhrn, prvé vykreslenie). @param {HTMLElement} body */
function quipScroll(body) {
    const pager = body.querySelector('[data-mozem-quips]');
    return pager ? pager.scrollLeft : null;
}

/**
 * Po prepísaní obsahu stojí nový pás hlášok na prvej stránke. Obsah sa prepisuje aj sám
 * od seba (hodiny v hlavičke každú minútu), takže bez tohto by hláška pod rukou odskočila
 * na hlášku dňa. Posun je okamžitý, nie plynulý - človek nemá vidieť, že sa pás vymenil.
 *
 * Pozíciu drží prehliadač, takže prednosť má posun starého pásu. Stránka zo stavu doň
 * dobehne až po ustálení (PAGER_SETTLE_MS) - ťuknutie na vec hneď po listovaní by pás
 * podľa nej vrátil späť. Stav platí len vtedy, keď starý pás nebol (návrat zo súhrnu).
 * @param {HTMLElement} body @param {number | null} left posun starého pásu @param {number} page stránka zo stavu
 */
function keepQuipPage(body, left, page) {
    const pager = body.querySelector('[data-mozem-quips]');
    if (!(pager instanceof HTMLElement)) return;
    const pages = pager.querySelectorAll('.pager-page');
    const target = pages[page];
    const byState = target instanceof HTMLElement ? target.offsetLeft - /** @type {HTMLElement} */ (pages[0]).offsetLeft : 0;
    const to = left ?? byState;
    if (to) pager.scrollTo({ left: to, behavior: 'instant' });
}

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
export function renderMozem(state, dom) {
    // Súhrn je obrazovka tej istej karty, v tom istom nosiči - ako detail dňa v karte 7 dní.
    if (state.mozemSummary)
        return writeHtml(dom.mozemBody, summaryHtml(summaryModel(state, state.summaryPeriod), state.summaryPeriod), 'mozemBody');
    const m = mozemModel(state, state.mozemQuip, state.launches);
    const kick = `Teraz · ${minutesToTimeStr(localMinutes(state.now, state.site.timezone))} · ${state.site.name}`;
    const html = mozemHtml(m, state.mozemOpen, kick) + summaryLinkHtml(summaryModel(state, 'mesiac'));
    /** @type {number | null} */ let left = null;
    const wrote = writeHtml(dom.mozemBody, html, 'mozemBody', () => (left = quipScroll(dom.mozemBody)));
    if (wrote) keepQuipPage(dom.mozemBody, left, m.quipPage);
    if (wrote || changed('mozemQuipPage', m.quipPage))
        dom.mozemBody.querySelectorAll('[data-mozem-quip-dot]').forEach((dot, i) => dot.classList.toggle('active', i === m.quipPage));
}
