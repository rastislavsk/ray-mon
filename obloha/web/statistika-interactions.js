// Poslucháče karty Štatistika a plagátu novej appky: prepínač obdobia, otvorenie plagátu (aj
// z odkazu na karte Môžem?), jeho zatvorenie (Zavrieť, Escape, ťuknutie vedľa), „Zdieľať do story“
// a „Skúsiť znova“. Každý končí volaním setState (alebo krokom v histórii); kreslí
// render/statistika.js a render/poster.js. Výzvy do Nastavenia obsluhuje interactions.js.

import { STATS_PERIODS } from '../../shared/stats.js';
import { posterModel } from '../../shared/statistika.js';
import { SUMMARY_PERIODS } from '../../shared/summary.js';
import { shareFile } from '../../web/share-file.js';
import { stepBack } from './nav-back.js';
import { posterImage } from './poster-image.js';

/** @typedef {import('./state.js').Store} Store */
/** @typedef {import('./dom.js').Dom} Dom */

/** Zatvorenie plagátu - ten istý krok ako tlačidlo Späť. @param {Store} store */
function closePoster(store) {
    stepBack(store, { poster: null });
}

/** Obrázok plagátu do systémového zdieľania, na počítači stiahnutie. @param {Store} store */
async function sharePoster(store) {
    const s = store.get();
    const m = s.poster && posterModel(s, s.poster, s.voice);
    const file = m && (await posterImage(m));
    if (file) await shareFile(file);
}

/**
 * @param {Store} store @param {Dom} dom @param {() => Promise<void>} refresh obnova dát, tá istá ako pri štarte
 */
export function initStatistika(store, dom, refresh) {
    dom.stSeg.addEventListener('click', (e) => {
        const btn = e.target instanceof Element ? e.target.closest('[data-period]') : null;
        const period = btn instanceof HTMLElement && STATS_PERIODS.find((p) => p === btn.dataset.period);
        if (period) store.setState({ statsPeriod: period });
    });
    dom.stPosters.addEventListener('click', (e) => {
        const btn = e.target instanceof Element ? e.target.closest('[data-poster]') : null;
        const period = btn instanceof HTMLElement && SUMMARY_PERIODS.find((p) => p === btn.dataset.poster);
        if (period) store.setState({ poster: period });
    });
    // Odkaz na karte Môžem? otvára mesiac, ako súhrn v súčasnej appke.
    dom.mzSummary.addEventListener('click', () => store.setState({ poster: 'mesiac' }));
    dom.posterClose.addEventListener('click', () => closePoster(store));
    // Ťuknutie vedľa karty (na stmavenú stránku) trafí samotný dialóg, nie jeho obsah.
    dom.poster.addEventListener('click', (e) => e.target === dom.poster && closePoster(store));
    // Escape (aj systémové „zavrieť“): dialóg zavrie render podľa stavu, nie prehliadač sám.
    dom.poster.addEventListener('cancel', (e) => {
        e.preventDefault();
        closePoster(store);
    });
    dom.posterShare.addEventListener('click', () => sharePoster(store));
    dom.stRetry.addEventListener('click', () => {
        store.setState({ loading: true });
        refresh();
    });
}
