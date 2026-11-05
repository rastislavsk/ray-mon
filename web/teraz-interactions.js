// Poslucháče karty Teraz: náhľad iného času na grafe (prst, kurzor, klávesnica),
// „Späť na teraz“, „Skúsiť znova“, stránka pásu odporúčaní a panel štítka pod číslom. Každý končí
// volaním setState (alebo krokom v histórii); kreslí render/teraz.js. Pravidlá dotyku sú v CLAUDE.md, časť
// Dotyk a kurzor: rozhoduje typ vstupu, nie druh udalosti.

import { localMinutes } from '../shared/solar.js';
import { bindDayScrub } from './teraz-gestures.js';
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
    // Otvorený Plán dňa aj zoznam pod grafom sú krok navigácie: Späť ich zbalí a zbalenie hlavičkou
    // ide tou istou cestou. Otvorenie robí z Teraz aktívny stĺpec prehľadu, ako náhľad.
    dom.tzListBtn.addEventListener('click', () => {
        if (store.get().tzListOpen) stepBack(store, { tzListOpen: false });
        else store.setState({ tzListOpen: true, panel: 'terazky' });
    });
    dom.tzPlanBtn.addEventListener('click', () => {
        if (store.get().tzPlanOpen) stepBack(store, { tzPlanOpen: false });
        else store.setState({ tzPlanOpen: true, panel: 'terazky' });
    });
    initChipSheet(store, dom);
    dom.tzRetry.addEventListener('click', () => {
        store.setState({ loading: true });
        // Ťukol človek: meranie sa opýta hneď, aj keď by inak čakalo na interval (shared/zdroje.js).
        refresh({ skus: true });
    });
}

/**
 * Štítky pod číslom a ich panel. Otvorenie je krok navigácie (robí z Teraz aktívny stĺpec prehľadu,
 * ako náhľad), zatvorenie (Zavrieť, Escape, ťuknutie vedľa) ten istý krok ako tlačidlo Späť.
 * @param {Store} store @param {Dom} dom
 */
function initChipSheet(store, dom) {
    dom.tzChips.addEventListener('click', (e) => {
        const btn = e.target instanceof Element ? e.target.closest('[data-chip]') : null;
        const key = btn instanceof HTMLElement ? btn.dataset.chip : undefined;
        if (key === 'stav' || key === 'siet') store.setState({ tzChip: key, panel: 'terazky' });
    });
    const close = () => stepBack(store, { tzChip: null });
    const d = dom.tzChipSheet;
    // Ťuknutie vedľa panelu (na stmavenú stránku) trafí samotný dialóg, nie jeho obsah.
    d.addEventListener('click', (e) => e.target === d && close());
    // Escape: dialóg zavrie render podľa stavu, nie prehliadač sám.
    d.addEventListener('cancel', (e) => {
        e.preventDefault();
        close();
    });
    dom.tzChipClose.addEventListener('click', close);
}
