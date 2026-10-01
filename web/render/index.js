// Jediné miesto, ktoré prekresľuje UI: vždy hlavičku a viditeľné karty, nič iné.

import { PANELS } from '../dom.js';
import { powerState } from '../state.js';
import { renderHeader } from './header.js';
import { renderMozem } from './mozem.js';
import { renderImportOffer, renderNastavenie } from './nastavenie.js';
import { renderSedemdni } from './sedemdni.js';
import { renderStatistika } from './statistika.js';
import { renderTerazky } from './terazky.js';
import { renderInfo } from './zdielat.js';

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
function renderPanels(state, dom) {
    dom.page.dataset.panel = state.panel;
    // Smer posledného prechodu; z neho si CSS vyberie, z ktorej strany kartu prisunie.
    dom.page.dataset.dir = state.panelDir > 0 ? 'next' : 'prev';
    // Otázka na polohu pri prvom otvorení je jediná obrazovka - ostatné karty ešte nič nevedia.
    dom.bottomnav.classList.toggle('hidden', state.known === 'nic');
    // Bez zadaných panelov sú karty o výkone sivé (viď .no-panels v style.css).
    const noPanels = state.known !== 'elektraren';
    dom.panels.terazky.classList.toggle('no-panels', noPanels);
    dom.panels.mozem.classList.toggle('no-panels', noPanels);
    for (const p of PANELS) {
        dom.panels[p].classList.toggle('hidden', p !== state.panel);
        dom.navs[p].classList.toggle('active', p === state.panel);
        if (p === state.panel) dom.navs[p].setAttribute('aria-current', 'page');
        else dom.navs[p].removeAttribute('aria-current');
    }
}

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
export function render(state, dom) {
    renderHeader(state, dom);
    renderPanels(state, dom);
    renderImportOffer(state, dom);
    if (state.panel === 'mozem') renderMozem(state, dom);
    if (state.panel === 'terazky') renderTerazky(powerState(state), dom);
    if (state.panel === '7dni') renderSedemdni(state, dom);
    if (state.panel === 'statistika') renderStatistika(state, dom);
    if (state.panel === 'nastavenie') {
        renderNastavenie(state, dom);
        // Návod a zdieľanie sú v karte Nastavenie (sekcia Appka), kedysi mali kartu Info.
        renderInfo(state, dom);
    }
}
