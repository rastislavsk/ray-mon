// Karta Dnes (kódové meno mozem, doteraz Môžem?): veľké slovo a čo dá strecha za celý deň, pod tým
// pás odporúčaní - dnešok a kedy bude lepšie (docs/navrhy/dnes-a-teraz.html). Hlavičku skladá render
// do #mozem-body, pás je stály nosič v index.html. Počíta shared/mozem.js a shared/teraz.js,
// texty sú v shared/messages.js.

import { escapeHtml, minutesToTimeStr } from '../../shared/format.js';
import { voiceTexts } from '../../shared/messages-core.js';
import { mozemModel } from '../../shared/mozem.js';
import { localMinutes } from '../../shared/solar.js';
import { dnesCards } from '../../shared/teraz.js';
import { writeHtml } from '../memo.js';

/** @typedef {ReturnType<typeof mozemModel>} MozemModel */
/** @typedef {import('../dom.js').Dom} Dom */

const TERAZ_TEXTS = voiceTexts().TERAZ_TEXTS;

/** Veľké slovo pod 10 znakov sa zmestí vo veľkom písme, dlhšie („NO NO, NOT YET“) dostane menšie. */
const LONG_WORD = 10;

/**
 * Hlavička: kedy, kde, veľké slovo a pod ním čo dá strecha za celý deň. Bez predpovede na dnešok
 * (načítava sa, dáta nie sú, panely nezadané) namiesto toho veta, prečo karta nevie viac.
 * @param {MozemModel} m @param {string} kick
 */
export function mozemHtml(m, kick) {
    const day = m.day
        ? `<p class="mozem-lead">${escapeHtml(m.day.lead)}</p><div class="mozem-eq">` +
          m.day.eq.map((e) => `<div><b>${escapeHtml(e.value)}</b><span>${escapeHtml(e.label)}</span></div>`).join('') +
          '</div>'
        : `<p class="mozem-lead">${escapeHtml(m.hero.lead)}</p>`;
    return (
        `<section class="mozem-hero st-${m.state}"><div class="mozem-kick">${escapeHtml(kick)}</div>` +
        `<p class="mozem-word${m.word.length >= LONG_WORD ? ' long' : ''}">${escapeHtml(m.word)}</p>${day}</section>`
    );
}

/** @param {HTMLElement} el @param {boolean} on */
const show = (el, on) => el.classList.toggle('hidden', !on);

/** Pás odporúčaní a bodky pod ním. Pás listuje prehliadač, bodka ukazuje stránku zo stavu.
 * @param {ReturnType<typeof dnesCards>} k @param {number} page @param {Dom} dom */
function renderCards(k, page, dom) {
    show(dom.tzRecs, !!k);
    if (!k) return;
    dom.tzStrip.setAttribute('aria-label', TERAZ_TEXTS.strip);
    dom.tzTodayTitle.textContent = TERAZ_TEXTS.today;
    dom.tzToday.textContent = k.today.line;
    show(/** @type {HTMLElement} */ (dom.tzTodayBar.parentElement), k.today.pct !== null);
    dom.tzTodayBar.style.width = `${k.today.pct ?? 0}%`;
    dom.tzWindow.textContent = k.today.window;
    dom.tzLaterTitle.textContent = TERAZ_TEXTS.later;
    dom.tzLater.textContent = k.later;
    [...dom.tzDots.children].forEach((dot, i) => dot.classList.toggle('on', i === page));
}

/** @param {import('../state.js').AppState} state @param {Dom} dom */
export function renderMozem(state, dom) {
    const m = mozemModel(state, { devices: state.oznamenia.devices });
    const kick = `Dnes · ${minutesToTimeStr(localMinutes(state.now, state.site.timezone))} · ${state.site.name}`;
    writeHtml(dom.mozemBody, mozemHtml(m, kick), 'mozemBody');
    renderCards(m.state === 'loading' ? null : dnesCards(state), state.terazPage, dom);
}
