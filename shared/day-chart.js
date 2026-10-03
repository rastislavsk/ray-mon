// Graf dňa novej appky (obloha/) na karte Teraz aj v detaile dňa na karte 7 dní: krivka výroby
// od polnoci do polnoci, hranica veľkých spotrebičov, značka „teraz“ a náhľad iného času, pod
// grafom pás plánu po polhodinách.
// Čistá geometria v súradniciach SVG (viewBox DAY_CHART.w × DAY_CHART.h) podľa návrhu
// (docs/navrhy/smer-b-obloha.html, `dayChart`). Plán aj výkon prichádzajú hotové z day-plan.js
// a hero-model.js - tu sa nič nepočíta inak, len kreslí.

import { MINUTES_PER_DAY, PREVIEW } from './config.js';
import { TERAZ_TONES } from './messages.js';

/** Čo platí v danej štvrťhodine plánu: slnko stačí, lacná sieť, drahá sieť, inak bežná cena. @typedef {'sun' | 'cheap' | 'costly' | 'plain'} Tone */
/** @typedef {{ from: number, to: number, tone: Tone }} Cell bunka pásu plánu, minúty dňa */

/**
 * Rozmery grafu: vodorovne od `left` po `right` je celý deň, zvislo od `top` (najvyšší výkon
 * stupnice) po `base` (nula). Pod nulou pás plánu a popisky hodín, nad `top` štítok náhľadu.
 */
export const DAY_CHART = { w: 320, h: 150, left: 10, right: 310, top: 24, base: 112, bandY: 120, bandH: 9, tickY: 144, cellMin: 30 };

/** Hodiny, ktoré majú pod grafom popisok. */
const TICK_HOURS = [0, 6, 12, 18, 24];

/** Zaokrúhlenie súradnice na desatinu - kratší zápis SVG, oko rozdiel nevidí. @param {number} v */
const r1 = (v) => Math.round(v * 10) / 10;

/**
 * Farba štvrťhodiny plánu. Zelená je tá istá ako na dennom prstenci súčasnej appky (`tier`
 * zo smartTier), modrá a červená cena pásma tarify.
 * @param {{ tier: import('./config.js').Tier | null, level: import('./config.js').PriceLevel }} slot @returns {Tone}
 */
export function slotTone(slot) {
    if (slot.tier === 'green') return 'sun';
    if (slot.level === 'lacna') return 'cheap';
    if (slot.level === 'draha') return 'costly';
    return 'plain';
}

/**
 * Pás plánu po polhodinách. Bunka má farbu štvrťhodiny v jej strede (druhej z dvoch) - jedno
 * pravidlo pre všetky bunky, nie väčšina ani priemer.
 * @param {import('./day-plan.js').PlanSlot[]} plan celý deň po štvrťhodinách (dayPlan) @returns {Cell[]}
 */
export function planCells(plan) {
    const step = plan[0].min;
    return Array.from({ length: MINUTES_PER_DAY / DAY_CHART.cellMin }, (_, i) => {
        const from = i * DAY_CHART.cellMin;
        const mid = plan[Math.floor((from + DAY_CHART.cellMin / 2) / step)];
        return { from, to: from + DAY_CHART.cellMin, tone: slotTone(mid) };
    });
}

/**
 * Legenda pod pásom plánu: farby, ktoré v páse naozaj sú, slovom a v pevnom poradí - aby farba
 * nebola jediný nosič významu. @param {Array<{ tone: Tone }>} cells
 */
export function planLegend(cells) {
    const order = /** @type {Tone[]} */ (['sun', 'cheap', 'costly', 'plain']);
    return order.filter((t) => cells.some((c) => c.tone === t)).map((tone) => ({ tone, text: TERAZ_TONES[tone] }));
}

/** Bunka pásu, do ktorej padne minúta dňa. @param {Cell[]} cells @param {number} min */
export function cellAt(cells, min) {
    return cells[Math.min(cells.length - 1, Math.max(0, Math.floor(min / DAY_CHART.cellMin)))];
}

/** Vodorovná poloha minúty dňa. @param {number} min */
export const chartX = (min) => DAY_CHART.left + (min / MINUTES_PER_DAY) * (DAY_CHART.right - DAY_CHART.left);

/**
 * Minúta dňa pre miesto na grafe, zaokrúhlená na krok náhľadu (štvrťhodina, ako šípky na
 * klávesnici). Mimo kriviek sa drží krajov dňa.
 * @param {number} rel poloha od ľavého okraja grafu ako podiel jeho šírky (0 až 1)
 */
export function chartMinutes(rel) {
    const step = PREVIEW.keyStepMin;
    const frac = (rel * DAY_CHART.w - DAY_CHART.left) / (DAY_CHART.right - DAY_CHART.left);
    const min = Math.round((Math.max(0, Math.min(1, frac)) * MINUTES_PER_DAY) / step) * step;
    return Math.min(min, MINUTES_PER_DAY - step);
}

/**
 * Geometria grafu dňa.
 * @param {{ plan: import('./day-plan.js').PlanSlot[], hourly: Array<{ hour: number, kw: number }>,
 *   real: Array<{ hour: number, kw: number }>, boundary: number | null, nowMin: number | null, nowKw: number,
 *   limitKw: number, preview: { min: number, kw: number, text: string } | null }} d `hourly` predpoveď
 *   dňa, `real` nameraná krivka (kreslí sa po `boundary`, posledný nameraný bod), `nowMin` značka
 *   „teraz“ (null = iný deň než dnešok, značka nie je), `limitKw` hranica veľkých spotrebičov,
 *   `preview` náhľad iného času so štítkom
 */
export function dayChartModel({ plan, hourly, real, boundary, nowMin, nowKw, limitKw, preview }) {
    const C = DAY_CHART;
    const measured = boundary === null ? [] : real.filter((p) => p.hour * 60 <= boundary);
    const kws = [limitKw, ...hourly.map((p) => p.kw), ...measured.map((p) => p.kw), nowMin === null ? 0 : nowKw, preview ? preview.kw : 0];
    // Stupnica s rezervou nad najvyšším bodom, aby krivka nenarážala na štítok náhľadu.
    const max = Math.max(...kws.filter(Number.isFinite)) * 1.1 || 1;
    const y = (/** @type {number} */ kw) => r1(C.base - (Math.max(0, kw) / max) * (C.base - C.top));
    const x = (/** @type {number} */ min) => r1(chartX(min));
    const pts = (/** @type {Array<{ hour: number, kw: number }>} */ list) => list.map((p) => `${x(p.hour * 60)} ${y(p.kw)}`).join(' L');
    const last = hourly[hourly.length - 1];
    const area = hourly.length
        ? `M${x(0)} ${C.base} L${pts(hourly)} L${x(MINUTES_PER_DAY)} ${y(last.kw)} L${x(MINUTES_PER_DAY)} ${C.base}Z`
        : '';
    const cellW = r1(chartX(C.cellMin) - chartX(0) - 0.8);
    const at = (/** @type {number} */ min, /** @type {number} */ kw) => ({ x: x(min), y: Number.isFinite(kw) ? y(kw) : null });
    return {
        area,
        real: measured.length > 1 ? `M${pts(measured)}` : '',
        limitY: y(limitKw),
        cells: planCells(plan).map((c) => ({ ...c, x: x(c.from), w: cellW })),
        ticks: TICK_HOURS.map((h) => ({ x: x(h * 60), label: String(h) })),
        now: nowMin === null ? null : at(nowMin, nowKw),
        preview: preview ? { ...at(preview.min, preview.kw), pill: pillAt(chartX(preview.min), preview.text) } : null,
    };
}

/**
 * Štítok náhľadu nad grafom: vystredený nad časom, no celý v grafe. Šírka z počtu znakov
 * (písmo 14 jednotiek, aby malo aj na úzkom displeji 12 px - ~7,8 jednotky na znak).
 * @param {number} cx @param {string} text
 */
function pillAt(cx, text) {
    const w = text.length * 7.8 + 18;
    return { x: r1(Math.min(Math.max(cx - w / 2, 4), DAY_CHART.w - 4 - w)), w: r1(w), text };
}
