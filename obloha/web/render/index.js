// Jediné miesto, ktoré prekresľuje novú appku: obloha, hlavička a viditeľná karta.

import { PANELS } from '../../../shared/config.js';
import { skyNow } from '../../../shared/sky.js';
import { dashboard, isColumn, shows } from '../state.js';
import { renderHeader } from './header.js';
import { renderMozem } from './mozem.js';
import { renderImportOffer, renderNastavenie } from './nastavenie.js';
import { renderPoster } from './poster.js';
import { renderSedem } from './sedem.js';
import { renderStatistika } from './statistika.js';
import { renderTeraz } from './teraz.js';

/**
 * Obloha je pozadie celej stránky. Render zapíše dve farby, stmavený spodok a počasie na <html>; prechod
 * medzi farbami robí CSS (zaregistrované --s1 a --s2 v style.css), takže pri útlme pohybu ho
 * vypne to isté pravidlo ako všetky ostatné prechody.
 * @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom
 */
function renderSky(state, dom) {
    const sky = skyNow(state, state.liveSky);
    dom.root.style.setProperty('--s1', sky.top);
    dom.root.style.setProperty('--s2', sky.bottom);
    dom.root.style.setProperty('--s3', sky.shade);
    dom.root.dataset.sky = sky.weather ?? 'offline';
    // Pokojná obloha stojí: zapnutie ani vypnutie nemá prechod.
    dom.root.toggleAttribute('data-calm', !state.liveSky);
}

/**
 * Viditeľné karty. Rozloženie podľa šírky okna (`data-layout`) a prehľad so stĺpcami (`data-dash`)
 * sú na <html> - style.css podľa nich skladá stĺpce, hlavičku aj navigáciu, žiadna šírka v ňom nie
 * je natvrdo. V prehľade sú nadpisy kariet o úroveň nižšie pod spoločným nadpisom (čítačka) a
 * aktívny stĺpec je zvýraznený; navigácia naň vie presunúť fokus.
 * @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom
 */
function renderPanels(state, dom) {
    const dash = dashboard(state);
    dom.root.dataset.layout = state.layout;
    dom.root.toggleAttribute('data-dash', dash);
    dom.page.dataset.panel = state.panel;
    dom.page.dataset.dir = state.panelDir > 0 ? 'next' : 'prev';
    dom.dashTitle.classList.toggle('hidden', !dash);
    for (const p of PANELS) {
        const column = dash && isColumn(p);
        dom.panels[p].classList.toggle('hidden', !shows(state, p));
        dom.panels[p].toggleAttribute('data-on', column && p === state.panel);
        if (column) dom.panels[p].tabIndex = -1;
        else dom.panels[p].removeAttribute('tabindex');
        if (column) dom.titles[p].setAttribute('aria-level', '2');
        else dom.titles[p].removeAttribute('aria-level');
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
