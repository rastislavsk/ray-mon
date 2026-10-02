// Poslucháče novej appky. Každý končí volaním setState; nikto tu nekreslí do DOM.

import { PANELS } from '../../shared/config.js';
import { initSwipeGesture } from '../../web/gesture.js';
import { trackHistory } from '../../web/nav-history.js';
import { createRefresh, startTicks } from '../../web/refresh.js';
import { nextPanel, panelChange, panelFromHistory } from './state.js';

/** @typedef {import('./state.js').Store} Store */
/** @typedef {import('./dom.js').Dom} Dom */

/** Navigácia, štítok „Zadaj panely ›“, listovanie prstom a tlačidlo Späť. @param {Store} store @param {Dom} dom */
function initNavigation(store, dom) {
    const go = (/** @type {import('./state.js').Panel} */ to) => store.setState(panelChange(store.get().panel, to));
    for (const p of PANELS) dom.navs[p].addEventListener('click', () => go(p));
    dom.setup.addEventListener('click', () => go('nastavenie'));
    initSwipeGesture(dom.page, {
        enabled: () => true,
        onSwipe: (dx) => {
            const to = nextPanel(store.get().panel, dx < 0 ? 1 : -1);
            if (to) go(to);
        },
    });
    trackHistory(store, {
        step: (s) => s.panel,
        same: (a, b) => a === b,
        parse: panelFromHistory,
        change: (s, panel) => panelChange(s.panel, panel),
    });
}

/** @param {Store} store @param {Dom} dom @returns {() => Promise<void>} obnova dát */
export function initInteractions(store, dom) {
    initNavigation(store, dom);
    const refresh = createRefresh(store);
    startTicks(store, refresh);
    return refresh;
}
