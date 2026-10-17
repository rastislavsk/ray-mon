// Poslucháče karty Môžem?: zoznam vecí, rozbalenie veci, „Pustil/a som“ a súhrn na
// zdieľanie. Každý končí volaním setState (alebo krokom v histórii cez backTo), kreslí
// web/render/mozem.js.

import { toggleLaunch } from '../shared/launches.js';
import { localDateKey, localMinutes } from '../shared/solar.js';
import { SUMMARY_PERIODS } from '../shared/summary.js';
import { backTo } from './history.js';
import { saveLaunches } from './settings-store.js';
import { shareSummary } from './share-image.js';

/** @typedef {import('./state.js').Store} Store */
/** @typedef {import('./dom.js').Dom} Dom */

/**
 * „Pustil/a som“: zapíše spustenie v tomto telefóne (kým beží, druhé ťuknutie ho zruší).
 * Čas a dátum sú lokality elektrárne, ako všetko ostatné v appke.
 * @param {Store} store @param {string} id @param {boolean} sun
 */
function logLaunch(store, id, sun) {
    const s = store.get();
    const entry = { d: localDateKey(s.now, s.site.timezone), id, m: localMinutes(s.now, s.site.timezone), sun };
    const launches = toggleLaunch(s.launches, entry);
    saveLaunches(launches);
    store.setState({ launches });
}

/**
 * Karta Môžem?: riadok „Čo môžem“ otvorí zoznam vecí, ťuknutie na vec v ňom ju rozbalí (druhé
 * zbalí). Rozbalenie je nastavenie vnútri karty, nie krok navigácie - Späť sa naň nevracia.
 * @param {Store} store @param {Dom} dom
 */
export function initMozem(store, dom) {
    dom.mozemBody.addEventListener('click', (e) => {
        const target = /** @type {HTMLElement} */ (e.target);
        // Zoznam vecí je obrazovka karty ako súhrn: otvorenie je krok navigácie, šípka späť
        // ten istý krok ako tlačidlo Späť. Otvára sa vždy zbalený.
        if (target.closest('[data-mozem-list]')) return store.setState({ mozemList: true, mozemOpen: null });
        if (target.closest('[data-mozem-list-back]')) return backTo(store, { mozemList: false });
        const item = target.closest('[data-mozem-item]');
        if (item instanceof HTMLElement) {
            const id = item.dataset.mozemItem || null;
            return store.setState({ mozemOpen: store.get().mozemOpen === id ? null : id });
        }
        const log = target.closest('[data-mozem-log]');
        if (log instanceof HTMLElement) return logLaunch(store, log.dataset.mozemLog || '', log.dataset.sun === '1');
        onSummaryClick(store, target);
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
