// Hlavička: RAY-MON a pod ním miesto elektrárne - to isté ako súčasná appka (shared/hlavicka.js).
// Bez zadaných panelov je vpravo biely štítok „Zadaj panely ›“, ktorý otvorí kartu Nastavenie.
// Bodka a čas merania sú v riadku pod číslom karty Teraz (render/teraz.js).

import { hlavickaModel, pripojenieBublina } from '../../../shared/hlavicka.js';
import { shows } from '../state.js';
import { voiceTexts } from '../../../shared/messages-core.js';

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
export function renderHeader(state, dom) {
    const m = hlavickaModel(state, state.voice);
    dom.place.textContent = m.place;
    dom.setup.classList.toggle('hidden', !m.setup);
    dom.setup.textContent = voiceTexts(state.voice).HEADER_TEXTS.setup;
    renderPripojene(state, dom);
}

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
function renderPripojene(state, dom) {
    const b = pripojenieOf(state);
    dom.pripojene.classList.toggle('hidden', !b);
    dom.pripojeneTitle.textContent = b?.nadpis ?? '';
    dom.pripojeneText.textContent = b?.text ?? '';
}

/**
 * Bublina „Meranie pripojené“: keď je vidieť karta Teraz (aj ako stĺpec prehľadu), ktorá práve
 * prestala ukazovať odhad. Inak počká. Zhasne ju web/interactions.js. @param {import('../state.js').AppState} state
 */
export function pripojenieOf(state) {
    return shows(state, 'terazky') ? pripojenieBublina({ ...state, caka: state.meranieBublina }) : null;
}
