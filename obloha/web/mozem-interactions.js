// Poslucháče karty Môžem? novej appky: panel veci či skupiny, rozbalenie Plánu dňa a „Skúsiť znova“.
// Každý končí volaním setState (alebo krokom v histórii); kreslí render/mozem.js.

import { stepBack } from './nav-back.js';

/** @typedef {import('./state.js').Store} Store */
/** @typedef {import('./dom.js').Dom} Dom */

/** Zatvorenie panelu veci (krížik, Escape, ťuknutie vedľa) - ten istý krok ako tlačidlo Späť. @param {Store} store */
function closeSheet(store) {
    stepBack(store, { mozemItem: null });
}

/**
 * @param {Store} store @param {Dom} dom @param {(opts?: { skus?: boolean }) => Promise<void>} refresh obnova dát, tá istá ako pri štarte
 */
export function initMozem(store, dom, refresh) {
    dom.mzItems.addEventListener('click', (e) => {
        const row = e.target instanceof Element ? e.target.closest('[data-item]') : null;
        // Panel robí z Môžem? aktívny stĺpec prehľadu (na telefóne je Môžem? aktívna karta).
        if (row instanceof HTMLElement && row.dataset.item) store.setState({ mozemItem: row.dataset.item, panel: 'mozem' });
    });
    dom.mzPlanMore.addEventListener('click', () => store.setState({ mozemPlanOpen: !store.get().mozemPlanOpen }));
    dom.mzSheetX.addEventListener('click', () => closeSheet(store));
    // Ťuknutie vedľa panelu (na stmavenú stránku) trafí samotný dialóg, nie jeho obsah.
    dom.mzSheet.addEventListener('click', (e) => e.target === dom.mzSheet && closeSheet(store));
    // Escape (aj systémové „zavrieť“): dialóg zavrie render podľa stavu, nie prehliadač sám.
    dom.mzSheet.addEventListener('cancel', (e) => {
        e.preventDefault();
        closeSheet(store);
    });
    // Skúsiť znova je to isté načítanie ako pri štarte; kým beží, karta pokojne čaká.
    dom.mzRetry.addEventListener('click', () => {
        store.setState({ loading: true });
        // Ťukol človek: meranie sa opýta hneď, aj keď by inak čakalo na interval (shared/zdroje.js).
        refresh({ skus: true });
    });
}
