// Poslucháče karty Terazky: náhľad iného času na grafe dňa (prst, kurzor, klávesnica - spoločné
// s kartou Teraz novej appky, web/teraz-gestures.js), „Späť na teraz“, zoznam pod grafom, „Skúsiť znova“
// a stránka pásu odporúčaní. Každý končí volaním setState; kreslí render/terazky.js.

import { localMinutes } from '../shared/solar.js';
import { bindDayScrub, stripPage } from './teraz-gestures.js';

/** @typedef {import('./state.js').Store} Store */
/** @typedef {import('./dom.js').Dom} Dom */

/** Je na obrazovke graf? Bez predpovede (a bez polohy) náhľad nie je čoho. @param {import('./state.js').AppState} s */
const hasChart = (s) => s.panel === 'terazky' && s.known !== 'nic' && !!s.forecast;

/**
 * Náhľad času nie je krok navigácie (Späť sa naň nevracia, viď navStep vo web/state.js), takže
 * návrat na teraz je obyčajná zmena stavu.
 * @param {Store} store @param {Dom} dom @param {(opts?: { skus?: boolean }) => Promise<void>} refresh obnova dát, tá istá ako pri štarte
 */
export function initTerazky(store, dom, refresh) {
    bindDayScrub(dom.tzChart, {
        active: () => hasChart(store.get()),
        current: () => store.get().previewMinutes,
        nowMin: () => localMinutes(store.get().now, store.get().site.timezone),
        preview: (min) => store.setState({ previewMinutes: min }),
        reset: () => store.setState({ previewMinutes: null }),
    });
    dom.tzReset.addEventListener('click', () => {
        store.setState({ previewMinutes: null });
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
