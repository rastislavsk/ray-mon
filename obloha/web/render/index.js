// Jediné miesto, ktoré prekresľuje novú appku: obloha, hlavička a viditeľná karta.

import { PANELS } from '../../../shared/config.js';
import { skyNow } from '../../../shared/sky.js';
import { renderHeader } from './header.js';
import { renderMozem } from './mozem.js';
import { renderImportOffer, renderNastavenie } from './nastavenie.js';
import { renderPoster } from './poster.js';
import { renderSedem } from './sedem.js';
import { renderStatistika } from './statistika.js';
import { renderTeraz } from './teraz.js';

/**
 * Obloha je pozadie celej stránky. Render zapíše len dve farby a počasie na <html>; prechod
 * medzi farbami robí CSS (zaregistrované --s1 a --s2 v style.css), takže pri útlme pohybu ho
 * vypne to isté pravidlo ako všetky ostatné prechody.
 * @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom
 */
function renderSky(state, dom) {
    const sky = skyNow(state, state.liveSky);
    dom.root.style.setProperty('--s1', sky.top);
    dom.root.style.setProperty('--s2', sky.bottom);
    dom.root.dataset.sky = sky.weather ?? 'offline';
    // Pokojná obloha stojí: zapnutie ani vypnutie nemá prechod.
    dom.root.toggleAttribute('data-calm', !state.liveSky);
}

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
function renderPanels(state, dom) {
    dom.page.dataset.panel = state.panel;
    dom.page.dataset.dir = state.panelDir > 0 ? 'next' : 'prev';
    for (const p of PANELS) {
        dom.panels[p].classList.toggle('hidden', p !== state.panel);
        if (p === state.panel) dom.navs[p].setAttribute('aria-current', 'page');
        else dom.navs[p].removeAttribute('aria-current');
    }
}

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
export function render(state, dom) {
    renderSky(state, dom);
    renderHeader(state, dom);
    renderPanels(state, dom);
    renderMozem(state, dom);
    renderTeraz(state, dom);
    renderSedem(state, dom);
    renderStatistika(state, dom);
    renderPoster(state, dom);
    renderNastavenie(state, dom);
    renderImportOffer(state, dom);
}
