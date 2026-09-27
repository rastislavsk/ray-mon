// Plán dňa: pre každú štvrťhodinu pásmo tarify, výkon FV a z toho farba. Z plánu čítajú
// ciferník (denný prstenec), pozadie stránky, texty odporúčaní aj spotrebiče - farba pod
// bežcom na prstenci a farba pozadia sú tak vždy to isté číslo. Čisté funkcie bez DOM.

import { MINUTES_PER_DAY, powerThresholds, TARIFF_LIMITS } from './config.js';
import { dayKwAt } from './chart-model.js';
import { localDateKey, localMinutes, sunUp } from './solar.js';
import { bandAt, scheduleFor, smartTier } from './tariff.js';

/**
 * @typedef {{ now: Date, tariff: import('./config.js').Tariff, site: import('./config.js').Site,
 *   plant: import('./config.js').Plant, pv: import('./kiosk.js').PvData | null,
 *   forecast: import('./solar.js').Forecast | null }} PlanInput
 */
/**
 * Štvrťhodina plánu. `kw` je výkon z krivky dňa (merané, potom predpoveď), nie živý údaj -
 * plán sa tak medzi dvoma meraniami nemení. `night` = slnko je pod obzorom.
 * @typedef {{ startMin: number, min: number, band: import('./config.js').Band, level: import('./config.js').PriceLevel,
 *   kw: number, tier: import('./config.js').Tier | null, night: boolean }} PlanSlot
 */

const SLOT = TARIFF_LIMITS.stepMin;

/**
 * Štvrťhodina plánu, do ktorej padne daná minúta dňa. Výkon sa berie v strede štvrťhodiny.
 * @param {PlanInput} input @param {number} minutes @returns {PlanSlot}
 */
export function planAt(input, minutes) {
    const { now, tariff, site, pv, forecast } = input;
    const startMin = Math.floor(minutes / SLOT) * SLOT;
    const nowMinutes = localMinutes(now, site.timezone);
    const band = bandAt(tariff, scheduleFor(tariff, localDateKey(now, site.timezone)), startMin);
    const mid = startMin + SLOT / 2;
    const kw = dayKwAt(mid, pv ? pv.realCurveToday : null, forecast ? forecast.hourlyToday : null, nowMinutes);
    const at = new Date(now.getTime() + (mid - nowMinutes) * 60000);
    return {
        startMin,
        min: SLOT,
        band,
        level: band.level,
        kw,
        tier: smartTier(band.level, kw, powerThresholds(input.plant)),
        night: !sunUp(at, site),
    };
}

/** Celý dnešný deň po štvrťhodinách, od 00:00. @param {PlanInput} input @returns {PlanSlot[]} */
export function dayPlan(input) {
    return Array.from({ length: MINUTES_PER_DAY / SLOT }, (_, i) => planAt(input, i * SLOT));
}

/**
 * Farba každej hodiny ľubovoľného dňa predpovede - stĺpce v detaile dňa na karte 7 dní.
 * Rovnaká logika ako plán dňa (smartTier): pásmo tarify v tej hodine toho dňa (aj s výnimkami
 * rozvrhu, víkend či sezóna) a výkon z predpovede. Farba stĺpca o 13:00 je tak tá istá, akú by
 * v ten deň o 13:00 mal ciferník.
 * @param {import('./solar.js').ForecastDay} day @param {import('./config.js').Tariff} tariff
 * @param {import('./config.js').Plant} plant @returns {Array<import('./config.js').Tier | null>} ako `day.hourly`
 */
export function dayHourTiers(day, tariff, plant) {
    const schedule = scheduleFor(tariff, day.date);
    const th = powerThresholds(plant);
    return day.hourly.map((p) => smartTier(bandAt(tariff, schedule, Math.min(p.hour * 60, MINUTES_PER_DAY - 1)).level, p.kw, th));
}
