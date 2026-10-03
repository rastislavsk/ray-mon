// Poslucháče karty 7 dní novej appky: otvorenie detailu dňa a týždňa, návrat do prehľadu
// („‹ 7 dní“, Escape) a „Skúsiť znova“. Každý končí volaním setState (alebo krokom v histórii);
// kreslí render/sedem.js. Ťah do strán v detaile (susedný deň, späť do prehľadu) rozhoduje
// swipeTarget v state.js, tlačidlo Späť v telefóne trackHistory - detail je krok navigácie.

import { stepBack } from './nav-back.js';

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
        if (row instanceof HTMLElement) store.setState({ weekDetail: 'day', weekDay: Number(row.dataset.day) });
    });
    dom.sdSum.addEventListener('click', () => store.setState({ weekDetail: 'week' }));
    for (const btn of [dom.sdDayBack, dom.sdWeekBack]) btn.addEventListener('click', () => closeDetail(store));
    // Escape v detaile robí to isté ako „‹ 7 dní“. Na iných kartách si Escape berú ich prvky.
    document.addEventListener('keydown', (e) => {
        const s = store.get();
        if (e.key !== 'Escape' || s.panel !== '7dni' || !s.weekDetail) return;
        e.preventDefault();
        closeDetail(store);
    });
    dom.sdRetry.addEventListener('click', () => {
        store.setState({ loading: true });
        refresh();
    });
}
