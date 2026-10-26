// Položka Oznámenia v sekcii Appka karty Nastavenie: ranný plán dňa (zapnúť, hodina), spotrebiče
// doma a čo s oznámeniami telefón vie. Voľby skladá tento render, poslucháč sedí na karte
// (oznamenia-interactions.js). Texty aj to, čo je zamknuté, sú v jadre (oznameniaTexts,
// oznamOvladanie), rovnaké ako v novej appke.

import { MOZEM_ITEM_TEXTS, oznameniaTexts } from '../../shared/messages.js';
import { OZNAMENIA } from '../../shared/config.js';
import { OZNAMENIA_DEVICES, oznamOvladanie } from '../../shared/oznamenia.js';
import { escapeHtml } from '../../shared/format.js';
import { writeHtml } from '../memo.js';

/**
 * Riadok so zaškrtávacím políčkom alebo prepínačom.
 * @param {string} attr @param {boolean} on @param {string} label @param {'checkbox' | 'radio'} type @param {boolean} disabled
 */
const check = (attr, on, label, type, disabled) =>
    `<label class="check-row"><input type="${type}" ${attr}${on ? ' checked' : ''}${disabled ? ' disabled' : ''} /><span>${escapeHtml(label)}</span></label>`;

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
export function renderOznamenia(state, dom) {
    const T = oznameniaTexts();
    const o = state.oznamenia;
    const ui = oznamOvladanie(state.known, state.oznamStav, o.on);
    const stav = T.stav[ui.stav];
    dom.oznamTitle.textContent = T.title;
    dom.oznamHint.textContent = T.hint;
    const hours = OZNAMENIA.hours
        .map((h) => check(`name="oznam-hour" data-oznam-hour="${h}"`, h === o.hour, `${h}:00`, 'radio', ui.busy))
        .join('');
    const devices = OZNAMENIA_DEVICES.map((id) =>
        check(`data-oznam-device="${id}"`, o.devices.includes(id), MOZEM_ITEM_TEXTS[id].name, 'checkbox', ui.busy),
    ).join('');
    writeHtml(
        dom.oznamBody,
        `<div class="share-options">${check('data-oznam-on', o.on, T.switchLabel, 'checkbox', ui.blocked)}</div>` +
            (stav ? `<p class="oznam-stav" role="status">${escapeHtml(stav)}</p>` : '') +
            `<p class="oznam-lead">${escapeHtml(T.lead)}</p>` +
            `<div class="group-lbl">${escapeHtml(T.when)}</div><div class="share-options oznam-hours" role="radiogroup" aria-label="${escapeHtml(T.when)}">${hours}</div>` +
            `<div class="group-lbl">${escapeHtml(T.devices)}</div><div class="share-options">${devices}</div>` +
            `<p class="oznam-note">${escapeHtml(T.privacy)}</p>`,
        'oznamBody',
    );
}
