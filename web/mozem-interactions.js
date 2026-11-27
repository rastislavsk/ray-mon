// Poslucháče karty Dnes (kódové meno mozem): „Skúsiť znova“, posuvník dňa hore a odtlačok bežca na teraz
// (docs/navrhy/dnes-tlacidlo-teraz.html, T4c), bubliny polí dlaždíc a pás kariet.
// Každý končí volaním setState (alebo krokom v histórii); kreslí render/mozem.js.
// Pravidlá dotyku sú v CLAUDE.md, časť Dotyk a kurzor: rozhoduje typ vstupu, nie druh udalosti.

import { BUBLINY } from '../shared/dnes-bubliny.js';
import { dnesOsMinuta } from '../shared/dnes-nebo.js';
import { localMinutes } from '../shared/solar.js';
import { bindKarty } from './mozem-karty.js';
import { sledujObzor } from './mozem-obzor.js';
import { stepBack } from './nav-back.js';
import { initSheet } from './sheet.js';
import { shows } from './state.js';
import { bindDayScrub } from './teraz-gestures.js';

/** Polia karty Dnes, na ktoré sa dá ťuknúť. @type {readonly import('./state.js').MzChip[]} */
const MZ_BUBLINY = ['dnes', 'zajtra', ...BUBLINY];

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
    // Bublina poľa je krok navigácie (robí z Dnes aktívny stĺpec prehľadu), zatvorenie ten istý krok ako tlačidlo Späť.
    // Ťuká sa na celú polovicu dlaždice (`data-bublina`, docs/navrhy/dnes-bubliny-poli.html, V3); dlaždice kreslí render -
    // poslucháč je na páse. Dnes a Zajtra otvoria vysvetlenie triedy dňa, ostatné polia svoju bublinu.
    dom.mzKarty.addEventListener('click', (e) => {
        const btn = e.target instanceof Element ? e.target.closest('[data-bublina]') : null;
        const kind = btn instanceof HTMLElement ? btn.dataset.bublina : null;
        const chip = MZ_BUBLINY.find((c) => c === kind);
        if (chip) store.setState({ mzChip: chip, panel: 'mozem' });
    });
    initSheet(dom.mzTriedaSheet, () => stepBack(store, { mzChip: null }));
    initSheet(dom.mzBublinaSheet, () => stepBack(store, { mzChip: null }));
    bindKarty(dom.mzKarty, dom.mzBodky, [dom.mzPasSpat, dom.mzPasDalej]);
    sledujObzor(dom.panels.mozem, dom.mzOs, dom.wx);
    initOs(store, dom);
}

/**
 * Posuvník dňa hore na karte: prst, kurzor aj klávesnica posúvajú bežec po dni, blízko teraz sa prilepí na teraz
 * (dnesOsMinuta). Ťuknutie na odtlačok bežca ho vráti na teraz. Zvolený čas nie je krok navigácie.
 * @param {Store} store @param {Dom} dom
 */
function initOs(store, dom) {
    const nowMin = () => localMinutes(store.get().now, store.get().site.timezone);
    bindDayScrub(dom.mzOs, {
        active: () => {
            const s = store.get();
            return shows(s, 'mozem') && s.known !== 'nic' && !!s.forecast;
        },
        current: () => store.get().mzCas ?? null,
        nowMin,
        preview: (min) => store.setState({ mzCas: min, panel: 'mozem' }),
        reset: () => store.setState({ mzCas: null }),
        naCas: (rel) => dnesOsMinuta(rel, nowMin()),
    });
    dom.mzOdtlacok.addEventListener('click', () => {
        store.setState({ mzCas: null });
        // Odtlačok po návrate zmizne; fokus ostane na posuvníku, z ktorého sa dá pokračovať.
        dom.mzOs.focus();
    });
}
