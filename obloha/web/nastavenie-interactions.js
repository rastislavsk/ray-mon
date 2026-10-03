// Poslucháče karty Nastavenie novej appky. Sprievodcu (aj riadky prehľadu, ktoré otvárajú jeho
// kroky) obsluhuje web/setup-wiring.js - ten istý kód ako v súčasnej appke. Tu je len to, čím sa
// nová appka líši: krok späť cez jej históriu, karta po odložení panelov, Escape a ponuka
// prevziať nastavenie z otvoreného odkazu.

import { backAction } from '../../shared/setup-flow.js';
import { applySettings, initSetupWiring, runSetupAction } from '../../web/setup-wiring.js';
import { stepBack } from './nav-back.js';
import { panelChange } from './state.js';

/** @typedef {import('./state.js').Store} Store */
/** @typedef {import('./dom.js').Dom} Dom */

/**
 * @param {Store} store @param {Dom} dom @param {() => Promise<void>} refresh obnova dát, tá istá ako pri štarte
 */
export function initNastavenie(store, dom, refresh) {
    const app = {
        back: (/** @type {import('../../shared/setup-flow.js').SetupPatch} */ patch) => stepBack(store, patch),
        refresh,
        // „Teraz nie, ukáž predpoveď“ otvorí kartu 7 dní, ako v súčasnej appke.
        skip: () => panelChange(store.get().panel, '7dni'),
    };
    initSetupWiring(store, app, { ...dom, root: dom.setupRoot });
    // Escape v sprievodcovi je to isté ako jeho tlačidlo Späť: o obrazovku späť, z prvej do prehľadu.
    document.addEventListener('keydown', (e) => {
        const s = store.get();
        if (e.key !== 'Escape' || e.defaultPrevented || s.panel !== 'nastavenie' || !s.setupStep) return;
        e.preventDefault();
        runSetupAction(store, app, backAction(s));
    });
    dom.importAccept.addEventListener('click', () => {
        const s = store.get();
        if (!s.incoming) return;
        // Kto odkaz otvoril ako prvý, otázku na polohu už nepotrebuje.
        applySettings(store, s.incoming, refresh, { incoming: null, ...(s.known === 'nic' ? { setupStep: null } : {}) });
    });
    dom.importDecline.addEventListener('click', () => store.setState({ incoming: null }));
}
