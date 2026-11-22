// Poslucháče karty Teraz: scéna toku energie, „Skúsiť znova“, deň v hrebeni týždňa, vysvetlenie riadku nad dlaždicami
// a detail spotrebiča aj so zápisom, že beží (docs/navrhy/teraz-bezi-spotrebic.html), nastavením času a bublinou po ňom
// (docs/navrhy/spotrebic-cas-nastavenie.html, A + D + P1) a oznámením o konci (docs/navrhy/spotrebic-koniec-opakovanie.html).
// Každý končí volaním setState (alebo krokom v histórii); kreslí render/teraz.js. Graf dňa je v paneli
// karty Dnes (mozem-interactions.js).

import { behyVeci, beziaci, nastav, navrhBehu, vratBehy, zoZvysku, zrus } from '../shared/bezi.js';
import { BEZI, BOJLER_ULOZENE_MS } from '../shared/config.js';
import { localDateKey, localMinutes } from '../shared/solar.js';
import { rytmusSBojlerom } from '../shared/zdroje.js';
import { zladBehy } from './bezi-spolocne.js';
import { ulozRezimBojlera } from './data.js';
import { zmenOznamBojlera } from './bojler-oznam.js';
import { objednajKoniec } from './koniec.js';
import { stepBack } from './nav-back.js';
import { initSheet } from './sheet.js';
import { loadRytmus, saveBezi, saveRytmus } from './storage.js';

/** @typedef {import('./state.js').Store} Store */
/** @typedef {import('./dom.js').Dom} Dom */

/**
 * @param {Store} store @param {Dom} dom @param {(opts?: { skus?: boolean }) => Promise<void>} refresh obnova dát, tá istá ako pri štarte
 */
export function initTeraz(store, dom, refresh) {
    // Vysvetlenie aj detail spotrebiča sú krok navigácie (robia z Teraz aktívny stĺpec prehľadu),
    // zatvorenie (Escape, ťuknutie vedľa) ten istý krok ako tlačidlo Späť.
    dom.tzScena.addEventListener('click', () => otvorTok(store, dom));
    dom.tzTok.addEventListener('click', () => otvorTok(store, dom));
    // Hrebeň týždňa: ťuknutie na deň ukáže jeho plán. Nie je to krok navigácie - Späť z karty odíde.
    dom.tzHrebenDni.addEventListener('click', (e) => {
        const btn = e.target instanceof Element ? e.target.closest('[data-den]') : null;
        if (btn instanceof HTMLElement) store.setState({ tzDen: Number(btn.dataset.den), panel: 'terazky' });
    });
    dom.tzCo.addEventListener('click', (e) => {
        const btn = e.target instanceof Element ? e.target.closest('[data-vec]') : null;
        // Hláška o neuloženom režime bojlera patrí len k ťuknutiu, po ktorom vznikla.
        // Neuložený čas z predchádzajúceho otvorenia neplatí.
        if (btn instanceof HTMLElement && btn.dataset.vec)
            store.setState({ tzVec: btn.dataset.vec, panel: 'terazky', bojlerRezim: null, vecNavrh: null });
    });
    initSheet(dom.tzVecSheet, () => stepBack(store, { tzVec: null }));
    initNastavenie(store, dom);
    // Bojler, ktorý riadi zásuvka, má namiesto detailu spotrebiča panel Bojler dnes - ten istý krok (tzVec).
    initSheet(dom.tzBojlerSheet, () => stepBack(store, { tzVec: null }));
    dom.tzBojlerRezim.addEventListener('click', (e) => {
        const btn = e.target instanceof Element ? e.target.closest('[data-bojler-rezim]') : null;
        if (btn instanceof HTMLElement) zmenRezim(store, btn.dataset.bojlerRezim === 'rucne');
    });
    dom.tzBojlerOznam.addEventListener('click', () => zmenOznamBojlera(store, !store.get().bojlerOznam));
    initSheet(dom.tzTokSheet, () => stepBack(store, { tzChip: null }));
    dom.tzRetry.addEventListener('click', () => {
        store.setState({ loading: true });
        // Ťukol človek: meranie sa opýta hneď, aj keď by inak čakalo na interval (shared/zdroje.js).
        refresh({ skus: true });
    });
}

/** Dnešný dátum a minúta dňa podľa elektrárne. @param {import('./state.js').AppState} s @param {Date} now */
const dnes = (s, now) => ({ d: localDateKey(now, s.site.timezone), nowMin: localMinutes(now, s.site.timezone) });

/**
 * Nastavenie času v detaile spotrebiča (docs/navrhy/spotrebic-cas-nastavenie.html, A + D + P1). „Už beží“ len ukáže
 * nastavenie s návrhom (`vecNavrh`), kolieska a výber času menia návrh, uloží až „Nastaviť“. To aj „Nebeží“ zavrú
 * panel a ukážu bublinu s „Vrátiť“.
 * @param {Store} store @param {Dom} dom
 */
function initNastavenie(store, dom) {
    dom.tzVecZapol.addEventListener('click', () => {
        const s = store.get();
        const id = s.tzVec;
        if (!id) return;
        const { d, nowMin } = dnes(s, new Date());
        const b = navrhBehu(s.bezi ?? [], id, d, nowMin);
        store.setState({ vecNavrh: { id, min: zoZvysku(id) ? b.k - nowMin : b.m } });
    });
    for (const el of [dom.tzVecKh, dom.tzVecKm]) initKoleso(store, dom, el);
    // Výber času telefónu (D): hodnota „HH:MM“; prázdna (vymazaná v poli na počítači) nič nemení.
    dom.tzVecOd.addEventListener('input', () => {
        const [h, m] = dom.tzVecOd.value.split(':').map(Number);
        const id = store.get().tzVec;
        if (id && Number.isInteger(h) && Number.isInteger(m)) store.setState({ vecNavrh: { id, min: h * 60 + m } });
    });
    dom.tzVecOk.addEventListener('click', () => {
        const s = store.get();
        const id = s.tzVec;
        if (!id) return;
        const min = s.vecNavrh?.id === id ? s.vecNavrh.min : null;
        const { d, nowMin } = dnes(s, new Date());
        // Prvé nastavenie behu sa pýta na povolenie oznámení - ide z ťuknutia.
        hotovo(store, id, (list, den, m) => nastav(list, id, den, m, min), !beziaci(s.bezi ?? [], id, d, nowMin));
    });
    dom.tzVecZrus.addEventListener('click', () => {
        const id = store.get().tzVec;
        if (id) hotovo(store, id, (list, d, nowMin) => zrus(list, id, d, nowMin), false);
    });
    dom.vecBublinaVrat.addEventListener('click', () => {
        const b = store.get().vecBublina;
        if (!b) return;
        clearTimeout(bublinaTimer);
        store.setState({ vecBublina: null });
        zapis(store, b.id, (list) => vratBehy(list, b.id, b.d, b.behy));
    });
}

/** Ako dlho sa koliesko nesmie pohnúť, aby sa počítalo za zastavené (ms). */
const KOLESO_TICHO_MS = 150;

/**
 * Koliesko hodín či minút: posúva ho prehliadač sám (CSS scroll-snap), appka si hodnotu prečíta, keď sa zastaví - po
 * KOLESO_TICHO_MS bez posunu. Kým sa točí, má `data-toci` a prekreslenie ho nechá (render/teraz.js, polohaKolies).
 * Ťuknutie na číslo nad či pod stredom a šípky na klávesnici ho posunú.
 * @param {Store} store @param {Dom} dom @param {HTMLElement} el
 */
function initKoleso(store, dom, el) {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let ticho;
    const hodnota = (/** @type {HTMLElement} */ k) => Number(k.getAttribute('aria-valuenow'));
    /** Nová hodnota tohto kolieska, druhé ostane. @param {number} v */
    const nastavKoleso = (v) => {
        const id = store.get().tzVec;
        if (!id) return;
        const x = Math.max(0, Math.min(Number(el.getAttribute('aria-valuemax')), v));
        const [h, m] = el === dom.tzVecKh ? [x, hodnota(dom.tzVecKm)] : [hodnota(dom.tzVecKh), x];
        store.setState({ vecNavrh: { id, min: h * 60 + m } });
    };
    el.addEventListener(
        'scroll',
        () => {
            clearTimeout(ticho);
            const krok = el.firstElementChild instanceof HTMLElement ? el.firstElementChild.offsetHeight : 0;
            // Na hodnote zo stavu ho dalo prekreslenie (alebo sa naň človek vrátil) - nič sa nemení.
            if (!krok || Math.abs(el.scrollTop - hodnota(el) * krok) <= 1) {
                delete el.dataset.toci;
                return;
            }
            el.dataset.toci = '1';
            ticho = setTimeout(() => {
                delete el.dataset.toci;
                nastavKoleso(Math.round(el.scrollTop / krok));
            }, KOLESO_TICHO_MS);
        },
        { passive: true },
    );
    el.addEventListener('click', (e) => {
        const i = e.target instanceof Element ? [...el.children].indexOf(e.target) : -1;
        if (i >= 0) nastavKoleso(i);
    });
    el.addEventListener('keydown', (e) => {
        const o = /** @type {Record<string, number>} */ ({ ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 })[e.key];
        if (!o) return;
        e.preventDefault();
        nastavKoleso(hodnota(el) + o);
    });
}

/** Čakanie na zhasnutie bubliny po nastavení. @type {ReturnType<typeof setTimeout> | undefined} */
let bublinaTimer;

/**
 * „Nastaviť“ či „Nebeží“: zapíše zmenu, zavrie panel (ten istý krok ako tlačidlo Späť) a ukáže na BEZI.bublinaMs
 * bublinu - s behmi pred zmenou pre „Vrátiť“ a s koncom behu po nej.
 * @param {Store} store @param {string} id
 * @param {(list: import('../shared/bezi.js').Zapis[], d: string, nowMin: number) => import('../shared/bezi.js').Zapis[]} zmena
 * @param {boolean} pytaj
 */
function hotovo(store, id, zmena, pytaj) {
    const s = store.get();
    const { d, nowMin } = dnes(s, new Date());
    const behy = behyVeci(s.bezi ?? [], id, d);
    const po = zapis(store, id, (list) => zmena(list, d, nowMin), pytaj);
    const novy = po.find((z) => z.id === id && z.d === d && !behy.includes(z)) ?? null;
    stepBack(store, { tzVec: null });
    /** @type {import('./state.js').VecBublina} */
    const b = { id, d, behy, k: novy ? novy.k : null };
    store.setState({ vecBublina: b, vecNavrh: null, koniecOznam: null });
    clearTimeout(bublinaTimer);
    bublinaTimer = setTimeout(() => {
        if (store.get().vecBublina === b) store.setState({ vecBublina: null });
    }, BEZI.bublinaMs);
}

/**
 * Zápis spotrebiča `id` (shared/bezi.js): zmena dostane dnešný dátum podľa elektrárne, uloží sa v telefóne a appka hneď
 * prepočíta plán - aj s teraz. Potom objedná či zruší oznámenie o konci (web/koniec.js) a pošle zmenu ostatným telefónom
 * domácnosti (web/bezi-spolocne.js). Vráti nový zoznam behov.
 * @param {Store} store @param {string} id
 * @param {(list: import('../shared/bezi.js').Zapis[]) => import('../shared/bezi.js').Zapis[]} zmena
 * @param {boolean} [pytaj]
 */
function zapis(store, id, zmena, pytaj = false) {
    const s = store.get();
    const now = new Date();
    const { d } = dnes(s, now);
    // `?? []`: starý web/state.js z cache po nasadení pole bezi nemá.
    const bezi = zmena(s.bezi ?? []);
    saveBezi(bezi, d);
    store.setState({ bezi, now });
    objednajKoniec(store, id, pytaj);
    void zladBehy(store, { id, d });
    return bezi;
}

/**
 * Ťuknutie na scénu toku energie alebo na pole toku pod pásom dní (docs/navrhy/teraz-pole-noc-bezi.html, 1A): otvorí
 * panel Elektrina teraz - ten istý krok ako vysvetlenie (tzChip) -, keď meranie elektromera hovorí, kam tečie sieť
 * (data-tok, render/teraz.js). Bez neho len urobí z Teraz aktívny stĺpec prehľadu.
 * @param {Store} store @param {Dom} dom
 */
function otvorTok(store, dom) {
    store.setState(dom.tzScena.hasAttribute('data-tok') ? { tzChip: 'tok', panel: 'terazky' } : { panel: 'terazky' });
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
