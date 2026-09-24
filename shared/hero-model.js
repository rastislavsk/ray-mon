// Model hlavnej karty (ciferník, verdikt, spotrebiče) pre daný čas dňa.
// Rovnaká logika pre živé "teraz" aj pre náhľad iného času; líši sa len zdroj výkonu.

import { installedKw } from './config.js';
import { dayKwAt, realCurveBoundary } from './chart-model.js';
import { minutesToTimeStr, pad2 } from './format.js';
import { localMinutes } from './solar.js';
import { getSlotMessage } from './messages.js';
import { autoTier, deviceStates, productionLevel, smartTier, windowAt, windowsFor } from './tariff.js';

/**
 * @typedef {{ now: Date, season: import('./config.js').Season, pv: import('./kiosk.js').PvData | null,
 *   forecast: import('./solar.js').Forecast | null, previewMinutes: number | null,
 *   site: import('./config.js').Site, plant: import('./config.js').Plant }} HeroInput
 */

/** Minúta dňa v čase lokality. @param {Date} date @param {string} timezone */
export function minutesOfDay(date, timezone) {
    return localMinutes(date, timezone);
}

/**
 * Výkon pre danú minútu: naživo z kiosku, v náhľade z krivky dňa (namerané/predpoveď).
 * Bez živého merania je aj „teraz“ odhad z predpovede - appka tak funguje aj pre toho,
 * kto meranie nemá.
 * @param {HeroInput} state @param {number} minutes @param {number} nowMinutes
 */
function powerFor(state, minutes, nowMinutes) {
    if (state.previewMinutes === null && state.pv) return Number(state.pv.realTimePowerKw);
    return dayKwAt(minutes, state.pv ? state.pv.realCurveToday : null, state.forecast ? state.forecast.hourlyToday : null, nowMinutes);
}

/** "Lepšie bude o HH:00" - len naživo, mimo okna so spotrebičmi a keď predpoveď hlási silnejšie slnko. @param {HeroInput} state @param {boolean} hasDevices */
function waitTimeFor(state, hasDevices) {
    const f = state.forecast;
    if (state.previewMinutes !== null || hasDevices || !f || !f.strongerWindowAhead || !Number.isFinite(f.hoursAhead)) return null;
    const hour = Math.floor(minutesOfDay(state.now, state.site.timezone) / 60);
    return `${pad2((hour + Math.round(/** @type {number} */ (f.hoursAhead))) % 24)}:00`;
}

/** Ciferník: podiel inštalovaného výkonu a farba podľa pásma výroby. @param {number} power @param {number} kwp */
function dialFor(power, kwp) {
    const level = productionLevel(power);
    /** @type {Record<string, import('./config.js').Tier>} */ const tierByLevel = { niz: 'red', str: 'amber', vys: 'green' };
    return {
        fraction: Number.isFinite(power) ? Math.max(0, Math.min(1, power / kwp)) : 0,
        tier: level ? tierByLevel[level] : null,
    };
}

/** @param {HeroInput} state */
export function heroModel(state) {
    const nowMinutes = minutesOfDay(state.now, state.site.timezone);
    const preview = state.previewMinutes !== null;
    const minutes = preview ? /** @type {number} */ (state.previewMinutes) : nowMinutes;
    const power = powerFor(state, minutes, nowMinutes);
    // Okná pokrývajú celý deň (overené testom); fallback je len poistka proti chybnému configu.
    const win = windowAt(minutes, state.season) || windowsFor(state.season)[0];
    const tier = win.status;
    const isNight = !!win.night;
    const message = (isNight ? null : getSlotMessage(tier, power, state.forecast)) || { headline: win.title, body: win.sub };
    const deviceTier = smartTier(tier, power, null);
    const measured = (() => {
        const boundary = realCurveBoundary(state.pv ? state.pv.realCurveToday : null, nowMinutes);
        return boundary !== null && minutes <= boundary;
    })();

    return {
        minutes,
        preview,
        power,
        tier,
        accent: smartTier(tier, power),
        isNight,
        message,
        devices: deviceStates(minutes, state.season).map((d) => ({
            ...d,
            tier: d.name === 'Auto' ? autoTier(minutes, tier, power) : deviceTier,
        })),
        waitTime: waitTimeFor(state, !!win.devices),
        dial: dialFor(power, installedKw(state.plant)),
        powerText: Number.isFinite(power) ? power.toFixed(2) : '–',
        unitText: preview ? (measured ? 'kW (merané)' : 'kW (odhad)') : state.pv ? 'kW teraz' : 'kW (odhad)',
        previewLabel: preview ? `Náhľad · ${minutesToTimeStr(minutes)}` : null,
    };
}
