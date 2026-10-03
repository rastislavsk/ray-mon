// Poslucháče novej appky. Každý končí volaním setState; nikto tu nekreslí do DOM.

import { PANELS } from '../../shared/config.js';
import { initSwipeGesture } from '../../web/gesture.js';
import { trackHistory } from '../../web/nav-history.js';
import { createRefresh, startTicks } from '../../web/refresh.js';
import { setupStart } from '../../shared/setup-flow.js';
import { initMozem } from './mozem-interactions.js';
import { initNastavenie } from './nastavenie-interactions.js';
import { closeDetail, initSedem } from './sedem-interactions.js';
import { initStatistika } from './statistika-interactions.js';
import { initTeraz } from './teraz-interactions.js';
import { navChange, navStep, navStepFrom, panelChange, sameNavStep, swipeTarget } from './state.js';

/** @typedef {import('./state.js').Store} Store */
/** @typedef {import('./dom.js').Dom} Dom */

/**
 * Navigácia, štítok „Zadaj panely ›“ a výzvy na kartách (všetky vedú do Nastavenia), listovanie
 * prstom (karty, v detaile karty 7 dní dni) a tlačidlo Späť. @param {Store} store @param {Dom} dom
 */
function initNavigation(store, dom) {
    const go = (/** @type {import('./state.js').Panel} */ to) => store.setState(panelChange(store.get().panel, to));
    for (const p of PANELS) dom.navs[p].addEventListener('click', () => go(p));
    const toSetup = [dom.setup, dom.mzGuessBtn, dom.mzAskBtn, dom.tzGuessBtn, dom.tzAskBtn, dom.sdGuessBtn, dom.sdAskBtn];
    toSetup.push(dom.stAskBtn, dom.stSetupBtn, dom.stMeasureBtn, dom.stPricesBtn);
    // Kto pozná len polohu, ide rovno na krok sprievodcu s panelmi. Sú to dva kroky navigácie -
    // Späť z panelov vráti do prehľadu Nastavenia, ako keby ich otvoril odtiaľ.
    const toPanels = () => {
        if (store.get().panel !== 'nastavenie') go('nastavenie');
        if (store.get().known === 'poloha') store.setState(setupStart(store.get()));
    };
    for (const btn of toSetup) btn.addEventListener('click', toPanels);
    initSwipeGesture(dom.page, {
        // Kým je otvorený panel veci alebo plagát, ťah nad nimi kartu neprepína.
        enabled: () => !store.get().mozemItem && !store.get().poster,
        onSwipe: (dx) => {
            const to = swipeTarget(store.get(), dx);
            if (to === 'back') closeDetail(store);
            else if (to) store.setState(to);
        },
    });
    trackHistory(store, {
        step: navStep,
        same: sameNavStep,
        parse: navStepFrom,
        change: navChange,
    });
}

/** @param {Store} store @param {Dom} dom @returns {() => Promise<void>} obnova dát */
export function initInteractions(store, dom) {
    initNavigation(store, dom);
    const refresh = createRefresh(store);
    initMozem(store, dom, refresh);
    initTeraz(store, dom, refresh);
    initSedem(store, dom, refresh);
    initStatistika(store, dom, refresh);
    initNastavenie(store, dom, refresh);
    startTicks(store, refresh);
    // Bez internetu karty povedia, prečo nemajú dáta; keď sa vráti, dáta sa hneď obnovia.
    window.addEventListener('offline', () => store.setState({ online: false }));
    window.addEventListener('online', () => {
        store.setState({ online: true });
        refresh();
    });
    return refresh;
}
