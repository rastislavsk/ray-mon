// Poslucháče karty Teraz: scéna toku energie, „Skúsiť znova“, deň v hrebeni týždňa, vysvetlenie riadku nad dlaždicami
// a detail spotrebiča aj so zápisom, že beží (docs/navrhy/teraz-bezi-spotrebic.html).
// Každý končí volaním setState (alebo krokom v histórii); kreslí render/teraz.js. Graf dňa je v paneli
// karty Dnes (mozem-interactions.js).

import { posun, zapol, zrus } from '../shared/bezi.js';
import { BOJLER_ULOZENE_MS, TERAZ_CISLA_MS } from '../shared/config.js';
import { localDateKey, localMinutes } from '../shared/solar.js';
import { rytmusSBojlerom } from '../shared/zdroje.js';
import { ulozRezimBojlera } from './data.js';
import { initSheet } from './sheet.js';
import { loadRytmus, saveBezi, saveRytmus } from './storage.js';

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
    dom.tzVecZapol.addEventListener('click', () => zapis(store, (list, id, d, m) => zapol(list, id, d, m)));
    dom.tzVecSkor.addEventListener('click', () => zapis(store, (list, id, d, m) => posun(list, id, d, -1, m)));
    dom.tzVecNeskor.addEventListener('click', () => zapis(store, (list, id, d, m) => posun(list, id, d, 1, m)));
    dom.tzVecZrus.addEventListener('click', () => zapis(store, (list, id, d) => zrus(list, id, d)));
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

/**
 * Zápis spotrebiča otvoreného v detaile (shared/bezi.js): zmena dostane dnešný dátum a minútu dňa podľa elektrárne,
 * uloží sa v telefóne a appka hneď prepočíta plán - aj s teraz, aby čas zapnutia bol tá chvíľa, nie posledná obnova.
 * @param {Store} store
 * @param {(list: import('../shared/bezi.js').Zapis[], id: string, d: string, m: number) => import('../shared/bezi.js').Zapis[]} zmena
 */
function zapis(store, zmena) {
    const s = store.get();
    if (!s.tzVec) return;
    const now = new Date();
    const tz = s.site.timezone;
    // `?? []`: starý web/state.js z cache po nasadení pole bezi nemá.
    const bezi = zmena(s.bezi ?? [], s.tzVec, localDateKey(now, tz), localMinutes(now, tz));
    saveBezi(bezi);
    store.setState({ bezi, now });
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
