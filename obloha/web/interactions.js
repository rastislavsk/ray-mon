// Poslucháče novej appky. Každý končí volaním setState; nikto tu nekreslí do DOM.

import { LAYOUT_PX, PANELS } from '../../shared/config.js';
import { trackHistory } from '../../web/nav-history.js';
import { createRefresh, startTicks } from '../../web/refresh.js';
import { setupStart } from '../../shared/setup-flow.js';
import { initMozem } from './mozem-interactions.js';
import { initTeraz } from './teraz-interactions.js';
import { dashboard, isColumn, layoutOf, navChange, navStep, navStepFrom, panelChange, sameNavStep } from './state.js';

/** @typedef {import('./state.js').Store} Store */
/** @typedef {import('./dom.js').Dom} Dom */

/**
 * Navigácia, štítok „Zadaj panely ›“ a výzvy na kartách (všetky vedú do Nastavenia) a tlačidlo
 * Späť. Karty sa ťahom prsta nelistujú, len ťuknutím v navigácii (dni v detaile karty 7 dní
 * listuje web/day-pager.js, viď sedem-interactions.js). V prehľade so stĺpcami navigácia
 * neprepína obrazovku, ale presunie fokus na stĺpec (a stránku k nemu, keď nie je vidieť).
 * @param {Store} store @param {Dom} dom
 */
function initNavigation(store, dom) {
    const go = (/** @type {import('./state.js').Panel} */ to) => {
        if (dashboard(store.get()) && isColumn(to)) {
            // Len iný aktívny stĺpec: panel veci, náhľad aj detail v ostatných stĺpcoch ostávajú.
            store.setState({ panel: to });
            dom.panels[to].focus();
            // Nie je to krok navigácie, no položka histórie si stĺpec pamätá - Späť zo Štatistiky či
            // Nastavenia sa tak vráti na stĺpec, z ktorého človek odišiel.
            history.replaceState({ ...history.state, step: navStep(store.get()) }, '');
            return;
        }
        store.setState(panelChange(store.get().panel, to));
        if (dashboard(store.get())) dom.panels[to].focus();
    };
    for (const p of PANELS) dom.navs[p].addEventListener('click', () => go(p));
    const toSetup = [dom.setup, dom.mzGuessBtn, dom.mzAskBtn, dom.tzGuessBtn, dom.tzAskBtn, dom.tzNoteBtn, dom.sdGuessBtn, dom.sdAskBtn];
    toSetup.push(dom.stAskBtn, dom.stSetupBtn, dom.stMeasureBtn, dom.stPricesBtn, dom.tipBtn);
    // Kto pozná len polohu, ide rovno na krok sprievodcu s panelmi. Sú to dva kroky navigácie -
    // Späť z panelov vráti do prehľadu Nastavenia, ako keby ich otvoril odtiaľ.
    const toPanels = () => {
        if (store.get().panel !== 'nastavenie') go('nastavenie');
        if (store.get().known === 'poloha') store.setState(setupStart(store.get()));
    };
    for (const btn of toSetup) btn.addEventListener('click', toPanels);
    trackHistory(store, {
        step: navStep,
        same: sameNavStep,
        parse: navStepFrom,
        change: navChange,
    });
}

/**
 * Bublina s vysvetlením stavu merania: ťuknutie na bodku a čas ju otvorí aj zavrie, ťuknutie
 * kamkoľvek mimo nej (priehľadná vrstva pod ňou, aby nič pod bublinou nespustilo) a Escape ju
 * zavrú. Tlačidlo v nej vedie do Nastavenia (initNavigation) a bublinu tiež zavrie.
 * @param {Store} store @param {Dom} dom
 */
function initStavTip(store, dom) {
    const close = () => store.setState({ stavTip: false });
    dom.live.addEventListener('click', () => store.setState({ stavTip: !store.get().stavTip }));
    dom.tipBg.addEventListener('click', close);
    dom.tipBtn.addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !store.get().stavTip) return;
        close();
        dom.live.focus();
    });
}

/**
 * Rozloženie podľa šírky okna: pri otočení tabletu či zmene okna sa prepne hneď. Stav (otvorený
 * detail, náhľad, sprievodca) sa pri tom nemení, mení sa len to, čo je kde.
 * @param {Store} store
 */
function initLayout(store) {
    const update = () => store.setState({ layout: layoutOf(window.innerWidth) });
    for (const px of Object.values(LAYOUT_PX)) window.matchMedia(`(min-width: ${px}px)`).addEventListener('change', update);
}

/**
 * Poslucháče jadra appky. Karty 7 dní, Štatistika a Nastavenie majú vlastné, prihlási ich
 * web/parts.js, keď sa ich kód načíta.
 * @param {Store} store @param {Dom} dom @returns {() => Promise<void>} obnova dát
 */
export function initInteractions(store, dom) {
    initNavigation(store, dom);
    initStavTip(store, dom);
    initLayout(store);
    const refresh = createRefresh(store);
    initMozem(store, dom, refresh);
    initTeraz(store, dom, refresh);
    startTicks(store, refresh);
    // Bez internetu karty povedia, prečo nemajú dáta; keď sa vráti, dáta sa hneď obnovia.
    window.addEventListener('offline', () => store.setState({ online: false }));
    window.addEventListener('online', () => {
        store.setState({ online: true });
        refresh();
    });
    return refresh;
}
