// Ovládanie karty Teraz, spoločné pre obe appky: graf dňa ako posúvač
// času (prst, kurzor, klávesnica) a stránka pásu odporúčaní. Neutrálny modul (CLAUDE.md) - stav
// nepozná, čo s časom spraviť, mu povie appka cez `ScrubHooks`. Pravidlá dotyku sú v CLAUDE.md,
// časť Dotyk a kurzor: rozhoduje typ vstupu, nie druh udalosti.

import { PREVIEW, SWIPE } from '../shared/config.js';
import { chartMinutes } from '../shared/day-chart.js';

/**
 * @typedef {{
 *   active: () => boolean,
 *   current: () => number | null,
 *   nowMin: () => number,
 *   preview: (min: number) => void,
 *   reset: () => void,
 * }} ScrubHooks
 * `active`: je graf na obrazovke (bez predpovede nie je čoho); `current`: čas náhľadu, null = teraz;
 * `nowMin`: minúta dňa teraz; `preview`: ukáž náhľad v tom čase; `reset`: späť na teraz.
 */

/** Koľko px musí prst prejsť, kým je jasné, či ide do strán (náhľad) alebo zvislo (posun stránky). */
const AXIS_PX = 8;

/**
 * Rozsah náhľadu: prvá a posledná štvrťhodina osi grafu. Render ho dáva do `aria-valuemin`
 * a `aria-valuemax` (chartRange v shared/day-chart.js) - stav appky tu netreba.
 * @param {HTMLElement} chart
 */
function rangeOf(chart) {
    return { min: Number(chart.getAttribute('aria-valuemin')), max: Number(chart.getAttribute('aria-valuemax')) };
}

/**
 * Náhľad v čase pod prstom či kurzorom. Čas sa počíta z polohy v SVG grafu (nie v jeho rámčeku),
 * tým istým meradlom, akým graf kreslí (chartMinutes na osi grafu).
 * @param {HTMLElement} chart @param {ScrubHooks} h @param {number} clientX
 */
function previewAt(chart, h, clientX) {
    if (!h.active()) return;
    const svg = chart.querySelector('svg');
    const box = (svg || chart).getBoundingClientRect();
    const r = rangeOf(chart);
    const min = chartMinutes((clientX - box.left) / (box.width || 1), { from: r.min, to: r.max + PREVIEW.keyStepMin });
    if (h.current() !== min) h.preview(min);
}

/**
 * Prst. Vodorovný ťah po grafe ukazuje náhľad za prstom; zvislý patrí prehliadaču, ktorý posúva
 * stránku (`touch-action: pan-y`), a náhľad nezapne. Ťuknutie bez pohybu ukáže náhľad v tom
 * čase a nechá ho svietiť.
 * @param {HTMLElement} chart @param {ScrubHooks} h
 */
function bindTouch(chart, h) {
    /** @type {{ x: number, y: number, scrollY: number, axis: 'x' | 'y' | null } | null} */
    let start = null;
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
            if (start.axis === 'x') previewAt(chart, h, t.clientX);
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
            previewAt(chart, h, t.clientX);
    });
}

/**
 * Kurzor a pero: stlačiť a ťahať. Prst sem nepatrí - po ťuknutí prehliadač dopošle aj kurzorové
 * udalosti a tie by náhľad posunuli druhýkrát.
 * @param {HTMLElement} chart @param {ScrubHooks} h
 */
function bindPointer(chart, h) {
    let drag = false;
    chart.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch' || e.button !== 0) return;
        drag = true;
        chart.setPointerCapture(e.pointerId);
        previewAt(chart, h, e.clientX);
    });
    chart.addEventListener('pointermove', (e) => e.pointerType !== 'touch' && drag && previewAt(chart, h, e.clientX));
    for (const type of ['pointerup', 'pointercancel']) chart.addEventListener(type, () => (drag = false));
}

/**
 * Klávesnica: graf je posúvač času. Šípky posúvajú po štvrťhodinách (PREVIEW.keyStepMin), Home
 * a End na kraje osi, Escape vráti teraz. Z noci (teraz mimo osi) skočí šípka na bližší kraj.
 * @param {HTMLElement} chart @param {ScrubHooks} h
 */
function bindKeys(chart, h) {
    chart.addEventListener('keydown', (e) => {
        if (!h.active()) return;
        if (e.key === 'Escape') {
            if (h.current() === null) return;
            e.preventDefault();
            return h.reset();
        }
        const step = PREVIEW.keyStepMin;
        const from = h.current() ?? Math.floor(h.nowMin() / step) * step;
        const r = rangeOf(chart);
        /** @type {Record<string, number>} */
        const to = {
            ArrowLeft: from - step,
            ArrowDown: from - step,
            ArrowRight: from + step,
            ArrowUp: from + step,
            Home: r.min,
            End: r.max,
        };
        if (!(e.key in to)) return;
        e.preventDefault();
        h.preview(Math.max(r.min, Math.min(r.max, to[e.key])));
    });
}

/** Graf dňa ako posúvač času: prst, kurzor aj klávesnica. @param {HTMLElement} chart @param {ScrubHooks} hooks */
export function bindDayScrub(chart, hooks) {
    bindTouch(chart, hooks);
    bindPointer(chart, hooks);
    bindKeys(chart, hooks);
}
