// Poslucháče karty Môžem?: panel veci či skupiny a rozbalenie Plánu dňa. Každý končí volaním setState (alebo krokom
// v histórii cez backTo), kreslí web/render/mozem.js.

import { backTo } from './history.js';

/** @typedef {import('./state.js').Store} Store */
/** @typedef {import('./dom.js').Dom} Dom */

/**
 * Karta Môžem?: dlaždica otvorí panel veci či skupiny zospodu. Otvorenie je krok navigácie,
 * zatvorenie (krížik, Escape, ťuknutie vedľa) ten istý krok ako tlačidlo Späť.
 * @param {Store} store @param {Dom} dom
 */
export function initMozem(store, dom) {
    dom.mozemBody.addEventListener('click', (e) => {
        const target = /** @type {HTMLElement} */ (e.target);
        const tile = target.closest('[data-mozem-item]');
        if (tile instanceof HTMLElement && tile.dataset.mozemItem) store.setState({ mozemItem: tile.dataset.mozemItem });
        if (target.closest('[data-mozem-plan]')) store.setState({ mozemPlanOpen: !store.get().mozemPlanOpen });
    });
    const close = () => backTo(store, { mozemItem: null });
    dom.mozemSheetX.addEventListener('click', close);
    // Ťuknutie vedľa panelu (na stmavenú stránku) trafí samotný dialóg, nie jeho obsah.
    dom.mozemSheet.addEventListener('click', (e) => e.target === dom.mozemSheet && close());
    // Escape (aj systémové „zavrieť“): dialóg zavrie render podľa stavu, nie prehliadač sám.
    dom.mozemSheet.addEventListener('cancel', (e) => {
        e.preventDefault();
        close();
    });
}
