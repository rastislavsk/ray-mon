// Poslucháče karty Teraz novej appky: náhľad iného času na grafe (prst, kurzor, klávesnica),
// „Späť na teraz“, „Skúsiť znova“ a stránka pásu odporúčaní. Každý končí volaním setState
// (alebo krokom v histórii); kreslí render/teraz.js. Pravidlá dotyku sú v CLAUDE.md, časť
// Dotyk a kurzor: rozhoduje typ vstupu, nie druh udalosti.

import { localMinutes } from '../../shared/solar.js';
import { bindDayScrub, stripPage } from '../../web/teraz-gestures.js';
import { stepBack } from './nav-back.js';
import { shows } from './state.js';

/** @typedef {import('./state.js').Store} Store */
/** @typedef {import('./dom.js').Dom} Dom */

/** Je na obrazovke graf? Bez predpovede (a bez polohy) náhľad nie je čoho. @param {import('./state.js').AppState} s */
const hasChart = (s) => shows(s, 'terazky') && s.known !== 'nic' && !!s.forecast;

/**
 * @param {Store} store @param {Dom} dom @param {(opts?: { skus?: boolean }) => Promise<void>} refresh obnova dát, tá istá ako pri štarte
 */
export function initTeraz(store, dom, refresh) {
    bindDayScrub(dom.tzChart, {
        active: () => hasChart(store.get()),
        current: () => store.get().terazPreview,
        nowMin: () => localMinutes(store.get().now, store.get().site.timezone),
        // Náhľad robí z Teraz aktívny stĺpec prehľadu (na telefóne Teraz aktívna je).
        preview: (min) => store.setState({ terazPreview: min, panel: 'terazky' }),
        reset: () => stepBack(store, { terazPreview: null }),
    });
    dom.tzReset.addEventListener('click', () => {
        stepBack(store, { terazPreview: null });
        // Tlačidlo po návrate zmizne; fokus ostane na grafe, z ktorého sa dá pokračovať.
        dom.tzChart.focus();
    });
    dom.tzListBtn.addEventListener('click', () => store.setState({ tzListOpen: !store.get().tzListOpen }));
    dom.tzRetry.addEventListener('click', () => {
        store.setState({ loading: true });
        // Ťukol človek: meranie sa opýta hneď, aj keď by inak čakalo na interval (shared/zdroje.js).
        refresh({ skus: true });
    });
    dom.tzStrip.addEventListener(
        'scroll',
        () => {
            const page = stripPage(dom.tzStrip);
            if (page !== store.get().terazPage) store.setState({ terazPage: page });
        },
        { passive: true },
    );
}
