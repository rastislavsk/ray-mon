// Poslucháče karty Štatistika: prepínač obdobia na plagáte a „Skúsiť znova“. Každý končí volaním setState; kreslí render/statistika.js.
// Výzvy do Nastavenia obsluhuje interactions.js. Trasy autom z domu pre podnadpis „km autom“ sa
// stiahnu, keď je karta na obrazovke a pre túto polohu ich appka ešte nemá.

import { STATS_PERIODS } from '../shared/stats.js';
import { trasyPre, zaokruhli } from '../shared/trasy.js';
import { stiahniTrasy } from './data.js';
import { shows } from './state.js';
import { saveTrasy } from './storage.js';

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
    dom.stRetry.addEventListener('click', () => {
        store.setState({ loading: true });
        // Ťukol človek: meranie sa opýta hneď, aj keď by inak čakalo na interval (shared/zdroje.js).
        refresh({ skus: true });
    });
    store.subscribe(() => trasyKeTreba(store));
    trasyKeTreba(store);
}

/** Polohy, pre ktoré sa appka v tejto karte prehliadača na trasy už pýtala - pri výpadku to skúsi až po otvorení znova. */
const pytane = new Set();

/**
 * Stiahne trasy autom pre polohu v stave, keď je Štatistika na obrazovke a trasy pre ňu chýbajú.
 * Pre jednu polohu najviac raz; odpoveď k inej polohe (človek ju medzitým zmenil) sa zahodí.
 * @param {Store} store
 */
async function trasyKeTreba(store) {
    const s = store.get();
    if (s.known === 'nic' || !shows(s, 'statistika') || trasyPre(s.trasy, s.site)) return;
    const p = zaokruhli(s.site);
    const kluc = `${p.lat},${p.lon}`;
    if (pytane.has(kluc)) return;
    pytane.add(kluc);
    const trasy = await stiahniTrasy(s.site);
    if (!trasy || !trasyPre(trasy, store.get().site)) return;
    saveTrasy(trasy);
    store.setState({ trasy });
}
