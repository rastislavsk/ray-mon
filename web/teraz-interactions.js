// Poslucháče karty Teraz: „Skúsiť znova“, vysvetlenie riadku nad dlaždicami a detail spotrebiča.
// Každý končí volaním setState (alebo krokom v histórii); kreslí render/teraz.js. Graf dňa je v paneli
// karty Dnes (mozem-interactions.js).

import { stepBack } from './nav-back.js';
import { initSheet } from './sheet.js';
import { panelChange } from './state.js';

/** @typedef {import('./state.js').Store} Store */
/** @typedef {import('./dom.js').Dom} Dom */

/**
 * @param {Store} store @param {Dom} dom @param {(opts?: { skus?: boolean }) => Promise<void>} refresh obnova dát, tá istá ako pri štarte
 */
export function initTeraz(store, dom, refresh) {
    // Vysvetlenie aj detail spotrebiča sú krok navigácie (robia z Teraz aktívny stĺpec prehľadu),
    // zatvorenie (Zavrieť, Escape, ťuknutie vedľa) ten istý krok ako tlačidlo Späť.
    dom.tzOko.addEventListener('click', () => store.setState({ tzChip: 'stav', panel: 'terazky' }));
    // Využi dnešok: dni dopredu sú na karte 7 dní.
    dom.tzVyhlad.addEventListener('click', () => store.setState(panelChange(store.get().panel, '7dni')));
    dom.tzCo.addEventListener('click', (e) => {
        const btn = e.target instanceof Element ? e.target.closest('[data-vec]') : null;
        if (btn instanceof HTMLElement && btn.dataset.vec) store.setState({ tzVec: btn.dataset.vec, panel: 'terazky' });
    });
    initSheet(dom.tzChipSheet, dom.tzChipClose, () => stepBack(store, { tzChip: null }));
    initSheet(dom.tzVecSheet, dom.tzVecClose, () => stepBack(store, { tzVec: null }));
    dom.tzRetry.addEventListener('click', () => {
        store.setState({ loading: true });
        // Ťukol človek: meranie sa opýta hneď, aj keď by inak čakalo na interval (shared/zdroje.js).
        refresh({ skus: true });
    });
}
