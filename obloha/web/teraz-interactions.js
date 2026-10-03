// Poslucháče karty Teraz novej appky: náhľad iného času na grafe (prst, kurzor, klávesnica),
// „Späť na teraz“, „Skúsiť znova“ a stránka pásu odporúčaní. Každý končí volaním setState
// (alebo krokom v histórii); kreslí render/teraz.js. Pravidlá dotyku sú v CLAUDE.md, časť
// Dotyk a kurzor: rozhoduje typ vstupu, nie druh udalosti.

import { MINUTES_PER_DAY, PREVIEW, SWIPE } from '../../shared/config.js';
import { chartMinutes } from '../../shared/day-chart.js';
import { localMinutes } from '../../shared/solar.js';
import { stepBack } from './nav-back.js';

/** @typedef {import('./state.js').Store} Store */
/** @typedef {import('./dom.js').Dom} Dom */

/** Koľko px musí prst prejsť, kým je jasné, či ide do strán (náhľad) alebo zvislo (posun stránky). */
const AXIS_PX = 8;

/** Posledná štvrťhodina dňa - najďalej, kam náhľad siaha. */
const LAST = MINUTES_PER_DAY - PREVIEW.keyStepMin;

/** Je na karte graf? Bez predpovede (a bez polohy) náhľad nie je čoho. @param {import('./state.js').AppState} s */
const hasChart = (s) => s.panel === 'terazky' && s.known !== 'nic' && !!s.forecast;

/**
 * Náhľad v čase pod prstom či kurzorom. Čas sa počíta z polohy v SVG grafu (nie v jeho rámčeku
 * so sklom), tým istým meradlom, akým graf kreslí (chartMinutes).
 * @param {Store} store @param {Dom} dom @param {number} clientX
 */
function previewAt(store, dom, clientX) {
    if (!hasChart(store.get())) return;
    const svg = dom.tzChart.querySelector('svg');
    const box = (svg || dom.tzChart).getBoundingClientRect();
    const min = chartMinutes((clientX - box.left) / (box.width || 1));
    if (store.get().terazPreview !== min) store.setState({ terazPreview: min });
}

/**
 * Prst. Vodorovný ťah po grafe ukazuje náhľad za prstom; zvislý patrí prehliadaču, ktorý posúva
 * stránku (`touch-action: pan-y`), a náhľad nezapne. Ťuknutie bez pohybu ukáže náhľad v tom
 * čase a nechá ho svietiť. Listovanie kariet ťahom nad grafom nebeží (`.day-scrub` je úchytka
 * vo web/gesture.js), takže ťah do strán kartu neprepne.
 * @param {Store} store @param {Dom} dom
 */
function bindTouch(store, dom) {
    /** @type {{ x: number, y: number, scrollY: number, axis: 'x' | 'y' | null } | null} */
    let start = null;
    const chart = dom.tzChart;
    chart.addEventListener(
        'touchstart',
        (e) => {
            start =
                e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, scrollY: window.scrollY, axis: null } : null;
        },
        { passive: true },
    );
    chart.addEventListener(
        'touchmove',
        (e) => {
            if (!start || e.touches.length !== 1) return void (start = null);
            const t = e.touches[0];
            const dx = t.clientX - start.x;
            const dy = t.clientY - start.y;
            if (!start.axis && Math.hypot(dx, dy) >= AXIS_PX) start.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
            if (start.axis === 'x') previewAt(store, dom, t.clientX);
        },
        { passive: true },
    );
    chart.addEventListener('touchcancel', () => (start = null), { passive: true });
    chart.addEventListener('touchend', (e) => {
        const from = start;
        start = null;
        if (!from || from.axis || e.changedTouches.length !== 1) return;
        const t = e.changedTouches[0];
        // Posunutá stránka znamená, že gesto si vzal prehliadač - aj keď prst prešiel málo.
        if (window.scrollY === from.scrollY && Math.hypot(t.clientX - from.x, t.clientY - from.y) < SWIPE.minDistPx)
            previewAt(store, dom, t.clientX);
    });
}

/**
 * Kurzor a pero: stlačiť a ťahať. Prst sem nepatrí - po ťuknutí prehliadač dopošle aj kurzorové
 * udalosti a tie by náhľad posunuli druhýkrát.
 * @param {Store} store @param {Dom} dom
 */
function bindPointer(store, dom) {
    const chart = dom.tzChart;
    let drag = false;
    chart.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch' || e.button !== 0) return;
        drag = true;
        chart.setPointerCapture(e.pointerId);
        previewAt(store, dom, e.clientX);
    });
    chart.addEventListener('pointermove', (e) => e.pointerType !== 'touch' && drag && previewAt(store, dom, e.clientX));
    for (const type of ['pointerup', 'pointercancel']) chart.addEventListener(type, () => (drag = false));
}

/**
 * Klávesnica: graf je posúvač času. Šípky posúvajú po štvrťhodinách (PREVIEW.keyStepMin), Home
 * a End na kraje dňa, Escape vráti teraz.
 * @param {Store} store @param {Dom} dom
 */
function bindKeys(store, dom) {
    dom.tzChart.addEventListener('keydown', (e) => {
        const s = store.get();
        if (!hasChart(s)) return;
        if (e.key === 'Escape') {
            if (s.terazPreview === null) return;
            e.preventDefault();
            return stepBack(store, { terazPreview: null });
        }
        const step = PREVIEW.keyStepMin;
        const from = s.terazPreview ?? Math.floor(localMinutes(s.now, s.site.timezone) / step) * step;
        /** @type {Record<string, number>} */
        const to = { ArrowLeft: from - step, ArrowDown: from - step, ArrowRight: from + step, ArrowUp: from + step, Home: 0, End: LAST };
        if (!(e.key in to)) return;
        e.preventDefault();
        store.setState({ terazPreview: Math.max(0, Math.min(LAST, to[e.key])) });
    });
}

/**
 * Stránka pásu odporúčaní, na ktorej pás stojí. Karty sú užšie než pás (vidno kus ďalšej),
 * takže sa stránka počíta z kroku medzi kartami; posledná sa celá ku kraju nedostane, preto
 * platí aj koniec posunu.
 * @param {HTMLElement} strip
 */
function stripPage(strip) {
    const cards = strip.children;
    if (cards.length < 2) return 0;
    if (strip.scrollLeft >= strip.scrollWidth - strip.clientWidth - 2) return cards.length - 1;
    const step = /** @type {HTMLElement} */ (cards[1]).offsetLeft - /** @type {HTMLElement} */ (cards[0]).offsetLeft;
    return Math.min(cards.length - 1, Math.max(0, Math.round(strip.scrollLeft / (step || 1))));
}

/**
 * @param {Store} store @param {Dom} dom @param {() => Promise<void>} refresh obnova dát, tá istá ako pri štarte
 */
export function initTeraz(store, dom, refresh) {
    bindTouch(store, dom);
    bindPointer(store, dom);
    bindKeys(store, dom);
    dom.tzReset.addEventListener('click', () => {
        stepBack(store, { terazPreview: null });
        // Tlačidlo po návrate zmizne; fokus ostane na grafe, z ktorého sa dá pokračovať.
        dom.tzChart.focus();
    });
    dom.tzRetry.addEventListener('click', () => {
        store.setState({ loading: true });
        refresh();
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
