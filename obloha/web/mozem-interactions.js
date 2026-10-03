// Poslucháče karty Môžem? novej appky: panel veci, „Pustil/a som“, hláška a „Skúsiť znova“.
// Každý končí volaním setState (alebo krokom v histórii); kreslí render/mozem.js.

import { toggleLaunch } from '../../shared/launches.js';
import { localDateKey, localMinutes } from '../../shared/solar.js';
import { saveLaunches } from '../../web/storage.js';
import { stepBack } from './nav-back.js';

/** @typedef {import('./state.js').Store} Store */
/** @typedef {import('./dom.js').Dom} Dom */

/** Zatvorenie panelu veci (krížik, Escape, ťuknutie vedľa) - ten istý krok ako tlačidlo Späť. @param {Store} store */
function closeSheet(store) {
    stepBack(store, { mozemItem: null });
}

/**
 * „Pustil/a som“: zapíše spustenie v tomto telefóne do toho istého úložiska a v tom istom
 * formáte ako súčasná appka (kým vec beží, druhé ťuknutie zápis zruší). Čas a dátum sú
 * lokality elektrárne.
 * @param {Store} store @param {boolean} sun svietilo slnko?
 */
function logLaunch(store, sun) {
    const s = store.get();
    if (!s.mozemItem) return;
    const entry = { d: localDateKey(s.now, s.site.timezone), id: s.mozemItem, m: localMinutes(s.now, s.site.timezone), sun };
    const launches = toggleLaunch(s.launches, entry);
    saveLaunches(launches);
    store.setState({ launches });
}

/**
 * @param {Store} store @param {Dom} dom @param {() => Promise<void>} refresh obnova dát, tá istá ako pri štarte
 */
export function initMozem(store, dom, refresh) {
    dom.mzItems.addEventListener('click', (e) => {
        const row = e.target instanceof Element ? e.target.closest('[data-item]') : null;
        if (row instanceof HTMLElement && row.dataset.item) store.setState({ mozemItem: row.dataset.item });
    });
    dom.mzSheetX.addEventListener('click', () => closeSheet(store));
    // Ťuknutie vedľa panelu (na stmavenú stránku) trafí samotný dialóg, nie jeho obsah.
    dom.mzSheet.addEventListener('click', (e) => e.target === dom.mzSheet && closeSheet(store));
    // Escape (aj systémové „zavrieť“): dialóg zavrie render podľa stavu, nie prehliadač sám.
    dom.mzSheet.addEventListener('cancel', (e) => {
        e.preventDefault();
        closeSheet(store);
    });
    dom.mzSheetLog.addEventListener('click', () => logLaunch(store, dom.mzSheetLog.dataset.sun === '1'));
    dom.mzQuip.addEventListener('click', () => store.setState({ mozemQuip: store.get().mozemQuip + 1 }));
    // Skúsiť znova je to isté načítanie ako pri štarte; kým beží, karta pokojne čaká.
    dom.mzRetry.addEventListener('click', () => {
        store.setState({ loading: true });
        refresh();
    });
}
