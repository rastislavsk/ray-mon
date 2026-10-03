// Poslucháče karty 7 dní novej appky: otvorenie detailu dňa a týždňa, návrat do prehľadu
// („‹ 7 dní“, Escape) a „Skúsiť znova“. Každý končí volaním setState (alebo krokom v histórii);
// kreslí render/sedem.js. Ťah do strán v detaile (susedný deň, späť do prehľadu) rozhoduje
// swipeTarget v state.js, tlačidlo Späť v telefóne trackHistory - detail je krok navigácie.

import { stepBack } from './nav-back.js';
import { shows } from './state.js';

/** @typedef {import('./state.js').Store} Store */
/** @typedef {import('./dom.js').Dom} Dom */

/** Návrat z detailu do prehľadu dní - ten istý krok ako tlačidlo Späť. @param {Store} store */
export function closeDetail(store) {
    stepBack(store, { weekDetail: null });
}

/**
 * @param {Store} store @param {Dom} dom @param {() => Promise<void>} refresh obnova dát, tá istá ako pri štarte
 */
export function initSedem(store, dom, refresh) {
    dom.sdDays.addEventListener('click', (e) => {
        const row = e.target instanceof Element ? e.target.closest('[data-day]') : null;
        // Detail robí zo 7 dní aktívny stĺpec prehľadu (na telefóne je 7 dní aktívna karta).
        if (row instanceof HTMLElement) store.setState({ weekDetail: 'day', weekDay: Number(row.dataset.day), panel: '7dni' });
    });
    dom.sdSum.addEventListener('click', () => store.setState({ weekDetail: 'week', panel: '7dni' }));
    for (const btn of [dom.sdDayBack, dom.sdWeekBack]) btn.addEventListener('click', () => closeDetail(store));
    // Escape v detaile robí to isté ako „‹ 7 dní“. Na iných kartách si Escape berú ich prvky - v
    // prehľade so stĺpcami aj graf karty Teraz (náhľad) a otvorený dialóg, ktorý zavrie najprv seba.
    document.addEventListener('keydown', (e) => {
        const s = store.get();
        if (e.key !== 'Escape' || e.defaultPrevented || !shows(s, '7dni') || !s.weekDetail) return;
        if (s.mozemItem || s.poster || s.appSheet) return;
        e.preventDefault();
        closeDetail(store);
    });
    dom.sdRetry.addEventListener('click', () => {
        store.setState({ loading: true });
        refresh();
    });
}
