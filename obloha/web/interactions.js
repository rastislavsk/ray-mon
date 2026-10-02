// Poslucháče novej appky. Každý končí volaním setState; nikto tu nekreslí do DOM.

import { PANELS } from '../../shared/config.js';
import { initSwipeGesture } from '../../web/gesture.js';
import { trackHistory } from '../../web/nav-history.js';
import { createRefresh, startTicks } from '../../web/refresh.js';
import { initMozem } from './mozem-interactions.js';
import { navChange, navStep, navStepFrom, nextPanel, panelChange, sameNavStep } from './state.js';

/** @typedef {import('./state.js').Store} Store */
/** @typedef {import('./dom.js').Dom} Dom */

/**
 * Navigácia, štítok „Zadaj panely ›“ a výzvy na karte Môžem? (všetky vedú do Nastavenia),
 * listovanie prstom a tlačidlo Späť. @param {Store} store @param {Dom} dom
 */
function initNavigation(store, dom) {
    const go = (/** @type {import('./state.js').Panel} */ to) => store.setState(panelChange(store.get().panel, to));
    for (const p of PANELS) dom.navs[p].addEventListener('click', () => go(p));
    for (const btn of [dom.setup, dom.mzGuessBtn, dom.mzAskBtn]) btn.addEventListener('click', () => go('nastavenie'));
    initSwipeGesture(dom.page, {
        // Kým je otvorený panel veci, ťah nad ním kartu neprepína.
        enabled: () => !store.get().mozemItem,
        onSwipe: (dx) => {
            const to = nextPanel(store.get().panel, dx < 0 ? 1 : -1);
            if (to) go(to);
        },
    });
    trackHistory(store, {
        step: navStep,
        same: sameNavStep,
        parse: navStepFrom,
        change: (s, step) => navChange(s.panel, step),
    });
}

/** @param {Store} store @param {Dom} dom @returns {() => Promise<void>} obnova dát */
export function initInteractions(store, dom) {
    initNavigation(store, dom);
    const refresh = createRefresh(store);
    initMozem(store, dom, refresh);
    startTicks(store, refresh);
    // Bez internetu karta Môžem? povie, prečo nemá dáta; keď sa vráti, dáta sa hneď obnovia.
    window.addEventListener('offline', () => store.setState({ online: false }));
    window.addEventListener('online', () => {
        store.setState({ online: true });
        refresh();
    });
    return refresh;
}
