// Poslucháče karty Dnes (kódové meno mozem): „Skúsiť znova“, posuvník dňa hore a odtlačok bežca na teraz
// (docs/navrhy/dnes-tlacidlo-teraz.html, T4c), vysvetlenie odznaku triedy dňa, pás kariet a panel s grafom dňa -
// zvolený čas v ňom (prst, kurzor, klávesnica po krivke) a „Späť na teraz“.
// Každý končí volaním setState (alebo krokom v histórii); kreslí render/mozem.js a render/graf.js.
// Pravidlá dotyku sú v CLAUDE.md, časť Dotyk a kurzor: rozhoduje typ vstupu, nie druh udalosti.

import { dnesOsMinuta } from '../shared/dnes-nebo.js';
import { localMinutes } from '../shared/solar.js';
import { bindKarty } from './mozem-karty.js';
import { stepBack } from './nav-back.js';
import { initSheet } from './sheet.js';
import { shows } from './state.js';
import { bindDayScrub } from './teraz-gestures.js';

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
    // Odznak je v dlaždici Dnes (dnešok) či Zajtra (`data-trieda`), dlaždice kreslí render - poslucháč je na páse.
    dom.mzKarty.addEventListener('click', (e) => {
        const btn = e.target instanceof Element ? e.target.closest('[data-trieda]') : null;
        const kedy = btn instanceof HTMLElement ? btn.dataset.trieda : null;
        if (kedy === 'dnes' || kedy === 'zajtra') store.setState({ mzChip: kedy, panel: 'mozem' });
    });
    initSheet(dom.mzTriedaSheet, () => stepBack(store, { mzChip: null }));
    bindKarty(dom.mzKarty, dom.mzBodky, [dom.mzPasSpat, dom.mzPasDalej]);
    initOs(store, dom);
    initGraf(store, dom);
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

/**
 * Graf dňa: ťuknutie kdekoľvek na kartu Graf dňa v páse otvorí panel (krok navigácie, zatvorenie ťuknutím
 * vedľa, Escape a Späť), v ňom krivka ako posúvač času a „Späť na teraz“.
 * @param {Store} store @param {Dom} dom
 */
function initGraf(store, dom) {
    dom.mzKarty.addEventListener('click', (e) => {
        if (e.target instanceof Element && e.target.closest('[data-kind="graf"]')) store.setState({ mzGraf: true, panel: 'mozem' });
    });
    // Zatvorenie vráti aj zvolený čas na teraz - otvorený graf ukáže vždy teraz.
    initSheet(dom.grSheet, () => stepBack(store, { mzGraf: false, terazPreview: null }));
    bindDayScrub(dom.grChart, {
        active: () => {
            const s = store.get();
            return s.mzGraf && shows(s, 'mozem') && s.known !== 'nic' && !!s.forecast;
        },
        current: () => store.get().terazPreview,
        nowMin: () => localMinutes(store.get().now, store.get().site.timezone),
        preview: (min) => store.setState({ terazPreview: min, panel: 'mozem' }),
        // Zvolený čas nie je krok navigácie (NavStep) - návrat na teraz ide priamo cez setState.
        reset: () => store.setState({ terazPreview: null }),
    });
    dom.grReset.addEventListener('click', () => {
        store.setState({ terazPreview: null });
        // Tlačidlo po návrate zmizne; fokus ostane na posúvači, z ktorého sa dá pokračovať.
        dom.grChart.focus();
    });
}
