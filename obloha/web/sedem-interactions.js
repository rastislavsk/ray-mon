// Poslucháče karty 7 dní novej appky: otvorenie detailu dňa a týždňa, návrat do prehľadu
// (šípka späť, Escape), listovanie dní v detaile dňa a „Skúsiť znova“. Každý končí volaním
// setState (alebo krokom v histórii); kreslí render/sedem.js. Tlačidlo Späť v telefóne rieši
// trackHistory - detail je krok navigácie, deň v ňom nie.

import { initDayPager } from '../../web/day-pager.js';
import { closeDetail } from './nav-back.js';
import { render } from './render/index.js';
import { shows } from './state.js';

/** @typedef {import('./state.js').Store} Store */
/** @typedef {import('./dom.js').Dom} Dom */

/**
 * Listovanie dní v detaile dňa (web/day-pager.js, to isté ako v súčasnej appke): ťah prstom,
 * čipy dní a šípky na klávesnici. Susedný deň kreslí počas ťahu ten istý render ako deň na
 * obrazovke - na chvíľu so susedným dňom v stave, potom znova so skutočným. V prehľade so
 * stĺpcami listuje len ťah v stĺpci 7 dní - pás je v ňom.
 * @param {Store} store @param {Dom} dom
 */
function initDays(store, dom) {
    const pager = initDayPager({
        area: dom.sdDayPager,
        keys: dom.sdDay,
        track: dom.sdDayTrack,
        day: () => {
            const s = store.get();
            const count = s.forecast?.days.length ?? 0;
            if (!shows(s, '7dni') || s.weekDetail !== 'day' || !count) return null;
            return { index: Math.min(s.weekDay, count - 1), count };
        },
        snapshot: (days) => {
            const s = store.get();
            const out = days.map((weekDay) => {
                render({ ...s, weekDay }, dom);
                return /** @type {HTMLElement} */ (dom.sdDayTrack.cloneNode(true));
            });
            render(s, dom);
            return out;
        },
        commit: (weekDay) => store.setState({ weekDay }),
    });
    dom.sdDayStrip.addEventListener('click', (e) => {
        const chip = e.target instanceof Element ? e.target.closest('[data-day]') : null;
        if (chip instanceof HTMLElement) pager.goTo(Number(chip.dataset.day));
    });
}

/**
 * @param {Store} store @param {Dom} dom @param {(opts?: { skus?: boolean }) => Promise<void>} refresh obnova dát, tá istá ako pri štarte
 */
export function initSedem(store, dom, refresh) {
    initDays(store, dom);
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
        if (s.mozemItem || s.appSheet) return;
        e.preventDefault();
        closeDetail(store);
    });
    dom.sdRetry.addEventListener('click', () => {
        store.setState({ loading: true });
        // Ťukol človek: meranie sa opýta hneď, aj keď by inak čakalo na interval (shared/zdroje.js).
        refresh({ skus: true });
    });
}
