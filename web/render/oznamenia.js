// Položka Oznámenia v sekcii Appka karty Nastavenie: ranný plán dňa (zapnúť, hodina), spotrebiče
// doma a čo s oznámeniami telefón vie. Voľby skladá tento render, poslucháč sedí na karte
// (interactions.js, initOznamenia). Texty sú v jadre (oznameniaTexts), rovnaké ako v novej appke.

import { MOZEM_ITEM_TEXTS, oznameniaTexts } from '../../shared/messages.js';
import { OZNAMENIA } from '../../shared/config.js';
import { OZNAMENIA_DEVICES } from '../../shared/oznamenia.js';
import { escapeHtml } from '../../shared/format.js';
import { writeHtml } from '../memo.js';

/**
 * Hláška pod prepínačom: prečo sa oznámenia nedajú zapnúť, alebo že sa zapínajú. Bez polohy appka
 * nemá z čoho rátať.
 * @param {import('../state.js').AppState} state
 */
function stavText(state) {
    const T = oznameniaTexts();
    if (state.known === 'nic') return T.stav.bezElektrarne;
    return T.stav[state.oznamStav];
}

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
export function renderOznamenia(state, dom) {
    const T = oznameniaTexts();
    const o = state.oznamenia;
    dom.oznamTitle.textContent = T.title;
    dom.oznamHint.textContent = T.hint;
    const stav = stavText(state);
    const blocked = state.known === 'nic' || ['plocha', 'nepodporuje', 'zakazane', 'caka'].includes(state.oznamStav);
    const check = (
        /** @type {string} */ attr,
        /** @type {boolean} */ on,
        /** @type {string} */ label,
        type = 'checkbox',
        disabled = false,
    ) =>
        `<label class="check-row"><input type="${type}" ${attr}${on ? ' checked' : ''}${disabled ? ' disabled' : ''} /><span>${escapeHtml(label)}</span></label>`;
    const hours = OZNAMENIA.hours.map((h) => check(`name="oznam-hour" data-oznam-hour="${h}"`, h === o.hour, `${h}:00`, 'radio')).join('');
    const devices = OZNAMENIA_DEVICES.map((id) =>
        check(`data-oznam-device="${id}"`, o.devices.includes(id), MOZEM_ITEM_TEXTS[id].name),
    ).join('');
    writeHtml(
        dom.oznamBody,
        `<div class="share-options">${check('data-oznam-on', o.on, T.switchLabel, 'checkbox', blocked && !o.on)}</div>` +
            (stav ? `<p class="oznam-stav" role="status">${escapeHtml(stav)}</p>` : '') +
            `<p class="oznam-lead">${escapeHtml(T.lead)}</p>` +
            `<div class="group-lbl">${escapeHtml(T.when)}</div><div class="share-options oznam-hours" role="radiogroup" aria-label="${escapeHtml(T.when)}">${hours}</div>` +
            `<div class="group-lbl">${escapeHtml(T.devices)}</div><div class="share-options">${devices}</div>` +
            `<p class="oznam-note">${escapeHtml(T.privacy)}</p>`,
        'oznamBody',
    );
}
