// Poslucháče karty Štatistika novej appky: prepínač obdobia na plagáte, odkaz na plagát mesiaca
// z karty Môžem? a „Skúsiť znova“. Každý končí volaním setState; kreslí render/statistika.js.
// Výzvy do Nastavenia obsluhuje interactions.js.

import { STATS_PERIODS } from '../../shared/stats.js';
import { panelChange } from './state.js';

/** @typedef {import('./state.js').Store} Store */
/** @typedef {import('./dom.js').Dom} Dom */

/**
 * @param {Store} store @param {Dom} dom @param {(opts?: { skus?: boolean }) => Promise<void>} refresh obnova dát, tá istá ako pri štarte
 */
export function initStatistika(store, dom, refresh) {
    dom.stPoster.addEventListener('click', (e) => {
        const btn = e.target instanceof Element ? e.target.closest('[data-period]') : null;
        const period = btn instanceof HTMLElement && STATS_PERIODS.find((p) => p === btn.dataset.period);
        if (period) store.setState({ statsPeriod: period });
    });
    // Odkaz na karte Môžem?: karta Štatistika na mesiaci, jeden krok navigácie.
    dom.mzSummary.addEventListener('click', () =>
        store.setState({ ...panelChange(store.get().panel, 'statistika'), statsPeriod: 'mesiac' }),
    );
    dom.stRetry.addEventListener('click', () => {
        store.setState({ loading: true });
        // Ťukol človek: meranie sa opýta hneď, aj keď by inak čakalo na interval (shared/zdroje.js).
        refresh({ skus: true });
    });
}
