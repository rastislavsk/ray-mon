// Poslucháče karty Môžem?: panel veci či skupiny a súhrn na zdieľanie. Každý končí volaním setState (alebo krokom v histórii cez backTo), kreslí
// web/render/mozem.js.

import { SUMMARY_PERIODS } from '../shared/summary.js';
import { backTo } from './history.js';
import { shareSummary } from './share-image.js';

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
        if (tile instanceof HTMLElement && tile.dataset.mozemItem) return store.setState({ mozemItem: tile.dataset.mozemItem });
        onSummaryClick(store, target);
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

/**
 * Súhrn na zdieľanie: otvorenie je krok navigácie, šípka späť ten istý krok ako tlačidlo Späť
 * (backTo), obdobie je nastavenie vnútri obrazovky, zdieľanie pošle obrázok systému.
 * @param {Store} store @param {HTMLElement} target
 */
function onSummaryClick(store, target) {
    if (target.closest('[data-mozem-summary]')) return store.setState({ mozemSummary: true });
    if (target.closest('[data-summary-back]')) return backTo(store, { mozemSummary: false });
    const period = target.closest('[data-summary-period]');
    if (period instanceof HTMLElement) {
        const p = SUMMARY_PERIODS.find((x) => x === period.dataset.summaryPeriod);
        return p && store.setState({ summaryPeriod: p });
    }
    if (target.closest('[data-summary-share]')) shareSummary(store.get());
}
