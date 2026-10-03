// Poslucháče karty Nastavenie novej appky. Sprievodcu (aj riadky prehľadu, ktoré otvárajú jeho
// kroky) obsluhuje web/setup-wiring.js - ten istý kód ako v súčasnej appke. Tu je len to, čím sa
// nová appka líši: krok späť cez jej históriu, karta po odložení panelov, Escape a ponuka
// prevziať nastavenie z otvoreného odkazu. A sekcie Vzhľad a Appka: živá obloha, tón hlášok,
// úvodná karta, Zdieľať appku a Nastaviť celé znova.

import { VOICES } from '../../shared/config.js';
import { parseStartPanel } from '../../shared/settings.js';
import { backAction } from '../../shared/setup-flow.js';
import { applySettings, initSetupWiring, runSetupAction } from '../../web/setup-wiring.js';
import { clearStored, saveLook, saveStartPanel } from '../../web/storage.js';
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
    initLook(store, dom);
    initAppSheets(store, dom);
}

/**
 * Vzhľad: tón a živá obloha sa ukladajú pod vlastný kľúč novej appky (vzhlad-v1), úvodná karta
 * do toho istého kľúča ako v súčasnej appke - voľba platí v oboch.
 * @param {Store} store @param {Dom} dom
 */
function initLook(store, dom) {
    /** @param {Partial<Pick<import('./state.js').AppState, 'voice' | 'liveSky'>>} patch */
    const look = (patch) => {
        const s = { ...store.get(), ...patch };
        saveLook({ voice: s.voice, liveSky: s.liveSky });
        store.setState(patch);
    };
    dom.nsLiveSky.addEventListener('click', () => look({ liveSky: !store.get().liveSky }));
    dom.nsVoice.addEventListener('click', (e) => {
        const btn = e.target instanceof Element ? e.target.closest('[data-voice]') : null;
        const voice = btn instanceof HTMLElement && VOICES.find((v) => v === btn.dataset.voice);
        if (voice) look({ voice });
    });
    dom.nsStart.addEventListener('click', (e) => {
        const btn = e.target instanceof Element ? e.target.closest('[data-start]') : null;
        const panel = btn instanceof HTMLElement ? parseStartPanel(btn.dataset.start) : null;
        if (!panel) return;
        saveStartPanel(panel);
        store.setState({ startPanel: panel });
    });
}

/**
 * Okná sekcie Appka. Otvorenie je krok navigácie, zatvorenie (krížik, Escape, ťuknutie vedľa, Nechať
 * tak) ten istý krok ako tlačidlo Späť. Nastaviť celé znova po potvrdení zmaže všetko uložené
 * a obnoví stránku - appka naštartuje ako pri prvom otvorení, rovnako ako „Vymazať údaje“ v súčasnej
 * appke. Adresu treba vyčistiť tiež: nesie uložené nastavenie a appka by ho po obnovení ponúkla prevziať.
 * @param {Store} store @param {Dom} dom
 */
function initAppSheets(store, dom) {
    const close = () => stepBack(store, { appSheet: null });
    dom.nsShare.addEventListener('click', () => store.setState({ appSheet: 'share' }));
    dom.nsReset.addEventListener('click', () => store.setState({ appSheet: 'reset' }));
    for (const d of [dom.nsShareSheet, dom.nsResetSheet]) {
        // Ťuknutie vedľa okna (na stmavenú stránku) trafí samotný dialóg, nie jeho obsah.
        d.addEventListener('click', (e) => e.target === d && close());
        // Escape: dialóg zavrie render podľa stavu, nie prehliadač sám.
        d.addEventListener('cancel', (e) => {
            e.preventDefault();
            close();
        });
    }
    dom.nsShareX.addEventListener('click', close);
    dom.nsResetCancel.addEventListener('click', close);
    dom.nsShareSettings.addEventListener('change', () => store.setState({ shareSettings: dom.nsShareSettings.checked }));
    dom.nsShareKiosk.addEventListener('change', () => store.setState({ shareKiosk: dom.nsShareKiosk.checked }));
    dom.nsResetOk.addEventListener('click', () => {
        clearStored();
        history.replaceState(null, '', location.pathname + location.search);
        location.reload();
    });
}
