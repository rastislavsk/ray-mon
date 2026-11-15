// Poslucháče karty Teraz: „Skúsiť znova“, deň v hrebeni týždňa, vysvetlenie riadku nad dlaždicami a detail spotrebiča.
// Každý končí volaním setState (alebo krokom v histórii); kreslí render/teraz.js. Graf dňa je v paneli
// karty Dnes (mozem-interactions.js).

import { rytmusSBojlerom } from '../shared/zdroje.js';
import { ulozRezimBojlera } from './data.js';
import { stepBack } from './nav-back.js';
import { initSheet } from './sheet.js';
import { loadRytmus, saveRytmus } from './storage.js';

/** @typedef {import('./state.js').Store} Store */
/** @typedef {import('./dom.js').Dom} Dom */

/**
 * @param {Store} store @param {Dom} dom @param {(opts?: { skus?: boolean }) => Promise<void>} refresh obnova dát, tá istá ako pri štarte
 */
export function initTeraz(store, dom, refresh) {
    // Vysvetlenie aj detail spotrebiča sú krok navigácie (robia z Teraz aktívny stĺpec prehľadu),
    // zatvorenie (Escape, ťuknutie vedľa) ten istý krok ako tlačidlo Späť.
    dom.tzOko.addEventListener('click', () => store.setState({ tzChip: 'stav', panel: 'terazky' }));
    // Smer toku v riadku stavu otvorí panel Elektrina teraz - ten istý krok ako vysvetlenie (tzChip).
    dom.tzTok.addEventListener('click', () => store.setState({ tzChip: 'tok', panel: 'terazky' }));
    // Hrebeň týždňa: ťuknutie na deň ukáže jeho plán. Nie je to krok navigácie - Späť z karty odíde.
    dom.tzHrebenDni.addEventListener('click', (e) => {
        const btn = e.target instanceof Element ? e.target.closest('[data-den]') : null;
        if (btn instanceof HTMLElement) store.setState({ tzDen: Number(btn.dataset.den), panel: 'terazky' });
    });
    dom.tzCo.addEventListener('click', (e) => {
        const btn = e.target instanceof Element ? e.target.closest('[data-vec]') : null;
        // Hláška o neuloženom režime bojlera patrí len k ťuknutiu, po ktorom vznikla.
        if (btn instanceof HTMLElement && btn.dataset.vec) store.setState({ tzVec: btn.dataset.vec, panel: 'terazky', bojlerRezim: null });
    });
    initSheet(dom.tzChipSheet, () => stepBack(store, { tzChip: null }));
    initSheet(dom.tzVecSheet, () => stepBack(store, { tzVec: null }));
    // Bojler, ktorý riadi zásuvka, má namiesto detailu spotrebiča panel Bojler dnes - ten istý krok (tzVec).
    initSheet(dom.tzBojlerSheet, () => stepBack(store, { tzVec: null }));
    dom.tzBojlerRezim.addEventListener('click', (e) => {
        const btn = e.target instanceof Element ? e.target.closest('[data-bojler-rezim]') : null;
        if (btn instanceof HTMLElement) zmenRezim(store, btn.dataset.bojlerRezim === 'rucne');
    });
    initSheet(dom.tzTokSheet, () => stepBack(store, { tzChip: null }));
    dom.tzRetry.addEventListener('click', () => {
        store.setState({ loading: true });
        // Ťukol človek: meranie sa opýta hneď, aj keď by inak čakalo na interval (shared/zdroje.js).
        refresh({ skus: true });
    });
}

/**
 * Prepínač režimu bojlera: hneď ukáže nový režim a uloží ho vo Workeri; keď sa nepodarí, vráti pôvodný
 * a povie to. @param {Store} store @param {boolean} rucne
 */
async function zmenRezim(store, rucne) {
    const { zdroj, bojler, bojlerRezim } = store.get();
    if (!zdroj || !bojler || bojler.rucne === rucne || bojlerRezim === 'uklada') return;
    store.setState({ bojler: { ...bojler, rucne }, bojlerRezim: 'uklada' });
    const r = await ulozRezimBojlera(zdroj.pecat, rucne);
    const teraz = store.get().bojler;
    if (!r) {
        store.setState({ bojler: teraz && { ...teraz, rucne: !rucne }, bojlerRezim: 'chyba' });
        return;
    }
    const novy = r.bojler ?? teraz;
    // Uložený rytmus nesie stav bojlera z posledného merania - po obnovení stránky by ukázal starý režim.
    const rytmus = novy && rytmusSBojlerom(loadRytmus(), zdroj, novy);
    if (rytmus) saveRytmus(rytmus);
    store.setState({ bojler: novy, bojlerRezim: null });
}
