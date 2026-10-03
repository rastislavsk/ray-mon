// Časť appky načítaná neskôr (web/parts.js): karta Štatistika a plagát na zdieľanie (aj s odkazom
// naň na karte Môžem? a kreslením obrázka) - kreslenie a poslucháče.

import { renderPoster } from './render/poster.js';
import { renderStatistika } from './render/statistika.js';

export { initStatistika as init } from './statistika-interactions.js';

/** @param {import('./state.js').AppState} state @param {import('./dom.js').Dom} dom */
export function render(state, dom) {
    renderStatistika(state, dom);
    renderPoster(state, dom);
}
