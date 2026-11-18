// Poslucháče karty Teraz: scéna toku energie, „Skúsiť znova“, deň v hrebeni týždňa, vysvetlenie riadku nad dlaždicami
// a detail spotrebiča.
// Každý končí volaním setState (alebo krokom v histórii); kreslí render/teraz.js. Graf dňa je v paneli
// karty Dnes (mozem-interactions.js).

import { BOJLER_ULOZENE_MS, TERAZ_CISLA_MS } from '../shared/config.js';
import { rytmusSBojlerom } from '../shared/zdroje.js';
import { ulozRezimBojlera } from './data.js';
import { initSheet } from './sheet.js';
import { loadRytmus, saveRytmus } from './storage.js';

/** @typedef {import('./state.js').Store} Store */
/** @typedef {import('./dom.js').Dom} Dom */

/**
 * @param {Store} store @param {Dom} dom @param {(opts?: { skus?: boolean }) => Promise<void>} refresh obnova dát, tá istá ako pri štarte
 */
export function initTeraz(store, dom, refresh) {
    // Vysvetlenie aj detail spotrebiča robia z Teraz aktívny stĺpec prehľadu.
    dom.tzOko.addEventListener('click', () => store.setState({ tzChip: 'stav', panel: 'terazky' }));
    dom.tzScena.addEventListener('click', () => tukniNaScenu(store, dom));
    // Pás dní: ťuknutie na deň ukáže jeho plán. Späť vráti dnešok (spatZmena vo web/state.js).
    dom.tzHrebenDni.addEventListener('click', (e) => {
        const btn = e.target instanceof Element ? e.target.closest('[data-den]') : null;
        if (btn instanceof HTMLElement) store.setState({ tzDen: Number(btn.dataset.den), panel: 'terazky' });
    });
    dom.tzCo.addEventListener('click', (e) => {
        const btn = e.target instanceof Element ? e.target.closest('[data-vec]') : null;
        // Hláška o neuloženom režime bojlera patrí len k ťuknutiu, po ktorom vznikla.
        if (btn instanceof HTMLElement && btn.dataset.vec) store.setState({ tzVec: btn.dataset.vec, panel: 'terazky', bojlerRezim: null });
    });
    initSheet(dom.tzChipSheet, () => store.setState({ tzChip: null }));
    initSheet(dom.tzVecSheet, () => store.setState({ tzVec: null }));
    // Bojler, ktorý riadi zásuvka, má namiesto detailu spotrebiča panel Bojler dnes - to isté pole tzVec.
    initSheet(dom.tzBojlerSheet, () => store.setState({ tzVec: null }));
    dom.tzBojlerRezim.addEventListener('click', (e) => {
        const btn = e.target instanceof Element ? e.target.closest('[data-bojler-rezim]') : null;
        if (btn instanceof HTMLElement) zmenRezim(store, btn.dataset.bojlerRezim === 'rucne');
    });
    initSheet(dom.tzTokSheet, () => store.setState({ tzChip: null }));
    dom.tzRetry.addEventListener('click', () => {
        store.setState({ loading: true });
        // Ťukol človek: meranie sa opýta hneď, aj keď by inak čakalo na interval (shared/zdroje.js).
        refresh({ skus: true });
    });
}

/** Čakanie na zhasnutie čísel v scéne. @type {ReturnType<typeof setTimeout> | undefined} */
let cislaTimer;

/**
 * Ťuknutie na scénu toku energie (docs/navrhy/teraz-tok-energie.html): prvé ukáže čísla v scéne na TERAZ_CISLA_MS.
 * Ďalšie, kým svietia, otvorí panel Elektrina teraz - ten istý krok ako vysvetlenie (tzChip) -, keď meranie
 * elektromera hovorí, kam tečie sieť (data-tok, render/teraz.js); bez neho čísla skryje.
 * @param {Store} store @param {Dom} dom
 */
function tukniNaScenu(store, dom) {
    clearTimeout(cislaTimer);
    if (store.get().tzCisla) {
        store.setState(dom.tzScena.hasAttribute('data-tok') ? { tzCisla: false, tzChip: 'tok', panel: 'terazky' } : { tzCisla: false });
        return;
    }
    store.setState({ tzCisla: true, panel: 'terazky' });
    cislaTimer = setTimeout(() => {
        if (store.get().tzCisla) store.setState({ tzCisla: false });
    }, TERAZ_CISLA_MS);
}

/** Čakanie na zhasnutie „Uložené“ pod prepínačom režimu bojlera. @type {ReturnType<typeof setTimeout> | undefined} */
let ulozeneTimer;

/**
 * Prepínač režimu bojlera: hneď ukáže nový režim a uloží ho vo Workeri; keď sa nepodarí, vráti pôvodný
 * a povie to. Keď Worker uloženie potvrdí, ukáže na BOJLER_ULOZENE_MS „Uložené“.
 * @param {Store} store @param {boolean} rucne
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
    store.setState({ bojler: novy, bojlerRezim: 'ulozene' });
    clearTimeout(ulozeneTimer);
    ulozeneTimer = setTimeout(() => {
        if (store.get().bojlerRezim === 'ulozene') store.setState({ bojlerRezim: null });
    }, BOJLER_ULOZENE_MS);
}
