// Časť appky načítaná neskôr (web/parts.js): karta Nastavenie so sprievodcom a ponuka prevziať
// nastavenie z otvoreného odkazu - kreslenie a poslucháče.

import { renderImportOffer, renderNastavenie } from './render/nastavenie.js';

export { initNastavenie as init } from './nastavenie-interactions.js';

/** @param {import('./state.js').AppState} state @param {import('./dom.js').Dom} dom */
export function render(state, dom) {
    renderNastavenie(state, dom);
    renderImportOffer(state, dom);
}
