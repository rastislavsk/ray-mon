// Poslucháče karty Dnes (kódové meno mozem): „Skúsiť znova“, vysvetlenie odznaku triedy dňa
// a pás kariet. Odznak končí volaním setState (alebo krokom v histórii); kreslí render/mozem.js.

import { bindKarty } from './mozem-karty.js';
import { stepBack } from './nav-back.js';
import { initSheet } from './sheet.js';

/** @typedef {import('./state.js').Store} Store */
/** @typedef {import('./dom.js').Dom} Dom */

/**
 * @param {Store} store @param {Dom} dom @param {(opts?: { skus?: boolean }) => Promise<void>} refresh obnova dát, tá istá ako pri štarte
 */
export function initMozem(store, dom, refresh) {
    // Skúsiť znova je to isté načítanie ako pri štarte; kým beží, karta pokojne čaká.
    dom.mzRetry.addEventListener('click', () => {
        store.setState({ loading: true });
        // Ťukol človek: meranie sa opýta hneď, aj keď by inak čakalo na interval (shared/zdroje.js).
        refresh({ skus: true });
    });
    // Vysvetlenie odznaku je krok navigácie (robí z Dnes aktívny stĺpec prehľadu), zatvorenie ten istý
    // krok ako tlačidlo Späť.
    dom.mzChip.addEventListener('click', () => store.setState({ mzChip: 'dnes', panel: 'mozem' }));
    dom.mzTomChip.addEventListener('click', () => store.setState({ mzChip: 'zajtra', panel: 'mozem' }));
    initSheet(dom.mzTriedaSheet, dom.mzTriedaClose, () => stepBack(store, { mzChip: null }));
    bindKarty(dom.mzKarty, dom.mzBodky);
}
