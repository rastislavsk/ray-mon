// Poslucháče karty Nastavenie novej appky. Sprievodcu (aj riadky prehľadu, ktoré otvárajú jeho
// kroky) obsluhuje web/setup-wiring.js - ten istý kód ako v súčasnej appke. Tu je len to, čím sa
// nová appka líši: krok späť cez jej históriu, karta po odložení panelov, Escape a ponuka
// prevziať nastavenie z otvoreného odkazu. Zbaľovanie sekcií a sekcie Čo máš doma, Oznámenia,
// Vzhľad a Appka: spotrebiče, ranný plán dňa, tón hlášok, živá obloha, Zdieľať appku a Vymazať údaje.

import { VOICES } from '../../shared/config.js';
import { backAction } from '../../shared/setup-flow.js';
import { applySettings, initSetupWiring, runSetupAction } from '../../web/setup-wiring.js';
import { prepniSpotrebic } from '../../shared/doma.js';
import { nastavOznamenia, vypniOznamenia } from '../../web/oznamenia.js';
import { clearStored, saveDoma, saveLook } from '../../web/storage.js';
import { stepBack } from './nav-back.js';
import { NS_FOLDS, panelChange } from './state.js';

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
    dom.importDecline.addEventListener('click', () => store.setState({ incoming: null, linkError: null }));
    initFolds(store, dom);
    initDoma(store, dom);
    initLook(store, dom);
    initOznam(store, dom);
    initAppSheets(store, dom);
}

/**
 * Zbaliteľné sekcie (Elektráreň, Čo máš doma, Oznámenia, Vzhľad, Appka). Rozbalenie je krok navigácie, zbalenie
 * nadpisom ten istý krok ako tlačidlo Späť - inak by sekcia ostala v histórii a Späť by ju znovu rozbalilo.
 * @param {Store} store @param {Dom} dom
 */
function initFolds(store, dom) {
    for (const f of dom.nsFolds) {
        const key = NS_FOLDS.find((k) => k === f.key);
        if (!key) continue;
        f.head.addEventListener('click', () => {
            if (store.get().nsOpen === key) stepBack(store, { nsOpen: null });
            else store.setState({ nsOpen: key });
        });
    }
}

/** Nová appka je v obloha/, má tam aj vlastný service worker (obloha/sw.js). */
const APP = 'obloha/';

/**
 * Čo máš doma: spotrebič pridá či uberie a uloží - spoločné so súčasnou appkou (doma-v1).
 * @param {Store} store @param {Dom} dom
 */
function initDoma(store, dom) {
    dom.nsDoma.addEventListener('click', (e) => {
        const btn = e.target instanceof Element ? e.target.closest('[data-device]') : null;
        if (!(btn instanceof HTMLElement) || !btn.dataset.device) return;
        const doma = prepniSpotrebic(store.get().doma, btn.dataset.device);
        saveDoma(doma);
        store.setState({ doma });
    });
}

/**
 * Oznámenia: prepínač a hodina. Zapnutie, vypnutie a uloženie je spoločné so súčasnou appkou
 * (web/oznamenia.js), voľba platí v oboch.
 * @param {Store} store @param {Dom} dom
 */
function initOznam(store, dom) {
    /** @param {Partial<import('../../shared/oznamenia.js').Oznamenia>} zmena */
    const nastav = async (zmena) => {
        const s = store.get();
        // Kým sa zapína, ďalšia zmena by sa po dobehnutí prepísala starou voľbou.
        if (s.oznamStav === 'caka') return;
        if (zmena.on || (zmena.hour !== undefined && s.oznamenia.on)) store.setState({ oznamStav: 'caka' });
        store.setState(await nastavOznamenia(s.oznamenia, zmena, { app: APP, timeZone: s.site.timezone }));
    };
    dom.nsOznam.addEventListener('click', () => nastav({ on: !store.get().oznamenia.on }));
    dom.nsOznamHour.addEventListener('click', (e) => {
        const btn = e.target instanceof Element ? e.target.closest('[data-hour]') : null;
        if (btn instanceof HTMLElement) nastav({ hour: Number(btn.dataset.hour) });
    });
}

/**
 * Vzhľad (vzhlad-v1): tón je spoločný so súčasnou appkou, živá obloha len tejto. Ukladá sa len
 * zmena - farbu pozadia súčasnej appky táto nepozná a nesmie ju prepísať.
 * @param {Store} store @param {Dom} dom
 */
function initLook(store, dom) {
    /** @param {Partial<Pick<import('./state.js').AppState, 'voice' | 'liveSky'>>} patch */
    const look = (patch) => {
        saveLook(patch);
        store.setState(patch);
    };
    dom.nsLiveSky.addEventListener('click', () => look({ liveSky: !store.get().liveSky }));
    dom.nsVoice.addEventListener('click', (e) => {
        const btn = e.target instanceof Element ? e.target.closest('[data-voice]') : null;
        const voice = btn instanceof HTMLElement && VOICES.find((v) => v === btn.dataset.voice);
        if (voice) look({ voice });
    });
}

/**
 * Okná sekcie Appka. Otvorenie je krok navigácie, zatvorenie (krížik, Escape, ťuknutie vedľa, Nechať
 * tak) ten istý krok ako tlačidlo Späť. Vymazať údaje po potvrdení zmaže všetko uložené
 * a obnoví stránku - appka naštartuje ako pri prvom otvorení, rovnako ako v súčasnej appke. Adresu treba vyčistiť tiež: nesie uložené nastavenie a appka by ho po obnovení ponúkla prevziať.
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
    dom.nsResetOk.addEventListener('click', async () => {
        // Aj ranné oznámenie: inak by Worker telefón budil ďalej s nastavením, ktoré už nie je.
        await vypniOznamenia();
        clearStored();
        history.replaceState(null, '', location.pathname + location.search);
        location.reload();
    });
}
