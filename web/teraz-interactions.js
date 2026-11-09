// Poslucháče karty Teraz: zvolený čas v karte Deň (prst, kurzor, klávesnica po krivke),
// „Späť na teraz“, „Skúsiť znova“, vysvetlenie riadku nad dlaždicami a detail
// spotrebiča. Každý končí volaním setState (alebo krokom v histórii); kreslí render/teraz.js. Pravidlá
// dotyku sú v CLAUDE.md, časť Dotyk a kurzor: rozhoduje typ vstupu, nie druh udalosti.

import { localMinutes } from '../shared/solar.js';
import { bindDayScrub } from './teraz-gestures.js';
import { stepBack } from './nav-back.js';
import { initSheet } from './sheet.js';
import { panelChange, shows } from './state.js';

/** @typedef {import('./state.js').Store} Store */
/** @typedef {import('./dom.js').Dom} Dom */

/** Je na obrazovke karta Deň? Bez predpovede (a bez polohy) nie je čo posúvať. @param {import('./state.js').AppState} s */
const hasDay = (s) => shows(s, 'terazky') && s.known !== 'nic' && !!s.forecast;

/**
 * @param {Store} store @param {Dom} dom @param {(opts?: { skus?: boolean }) => Promise<void>} refresh obnova dát, tá istá ako pri štarte
 */
export function initTeraz(store, dom, refresh) {
    bindDayScrub(dom.tzChart, {
        active: () => hasDay(store.get()),
        current: () => store.get().terazPreview,
        nowMin: () => localMinutes(store.get().now, store.get().site.timezone),
        // Zvolený čas robí z Teraz aktívny stĺpec prehľadu (na telefóne Teraz aktívna je).
        preview: (min) => store.setState({ terazPreview: min, panel: 'terazky' }),
        reset: () => stepBack(store, { terazPreview: null }),
    });
    dom.tzReset.addEventListener('click', () => {
        stepBack(store, { terazPreview: null });
        // Tlačidlo po návrate zmizne; fokus ostane na posúvači, z ktorého sa dá pokračovať.
        dom.tzChart.focus();
    });
    // Vysvetlenie aj detail spotrebiča sú krok navigácie (robia z Teraz aktívny stĺpec prehľadu),
    // zatvorenie (Zavrieť, Escape, ťuknutie vedľa) ten istý krok ako tlačidlo Späť.
    dom.tzOko.addEventListener('click', () => store.setState({ tzChip: 'stav', panel: 'terazky' }));
    // Využi dnešok: dni dopredu sú na karte 7 dní.
    dom.tzVyhlad.addEventListener('click', () => store.setState(panelChange(store.get().panel, '7dni')));
    dom.tzCo.addEventListener('click', (e) => {
        const btn = e.target instanceof Element ? e.target.closest('[data-vec]') : null;
        if (btn instanceof HTMLElement && btn.dataset.vec) store.setState({ tzVec: btn.dataset.vec, panel: 'terazky' });
    });
    initSheet(dom.tzChipSheet, dom.tzChipClose, () => stepBack(store, { tzChip: null }));
    initSheet(dom.tzVecSheet, dom.tzVecClose, () => stepBack(store, { tzVec: null }));
    dom.tzRetry.addEventListener('click', () => {
        store.setState({ loading: true });
        // Ťukol človek: meranie sa opýta hneď, aj keď by inak čakalo na interval (shared/zdroje.js).
        refresh({ skus: true });
    });
}
