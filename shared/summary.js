// Súhrn na zdieľanie v karte Môžem?: týždeň alebo mesiac na streche v jednotkách, ktoré pozná
// každý (nabitia mobilu, km autom), najlepší deň, hodnota podľa tarify a koľko toho človek
// pustil na slnku. Čisté funkcie; texty skladá shared/messages.js.
//
// Mesačný súčet je presný z kiosku. Týždeň a stĺpce dní stoja na denníku (shared/daylog.js),
// ktorý si appka vedie sama - deň, keď nebola otvorená, v ňom chýba a súhrn to povie.

import { EVERYDAY } from './config.js';
import { lastDays, monthDays } from './daylog.js';
import { monthCount } from './launches.js';
import { summaryTexts } from './messages.js';
import { addDays, localDateKey } from './solar.js';
import { longPrice, MONTHS } from './stats.js';

/** @typedef {'tyzden' | 'mesiac'} SummaryPeriod */
/** Obdobia v poradí prepínača. @type {SummaryPeriod[]} */
export const SUMMARY_PERIODS = ['tyzden', 'mesiac'];

/**
 * @typedef {import('./stats.js').StatsInput & { launches: import('./launches.js').Launch[],
 *   dayLog: import('./daylog.js').DayLog }} SummaryInput
 */

/** Spustenia v posledných 7 dňoch. @param {import('./launches.js').Launch[]} list @param {string} today */
function weekCount(list, today) {
    const from = addDays(today, -6);
    const inWeek = list.filter((x) => x.d >= from && x.d <= today);
    return { all: inWeek.length, sun: inWeek.filter((x) => x.sun).length };
}

/**
 * Dni obdobia z denníka. Dnešok berie z kiosku, aj keď ho denník ešte nemá (zapisuje sa až od
 * rána, viď DAYLOG).
 * @param {import('./daylog.js').DayLog} dayLog @param {number | null} live @param {string} today @param {boolean} week
 */
function periodDays(dayLog, live, today, week) {
    const log = live === null ? dayLog : { ...dayLog, [today]: Math.max(live, dayLog[today] ?? 0) };
    return week ? lastDays(log, today, 7) : monthDays(log, today);
}

/**
 * Model súhrnu, alebo null bez živého merania - súčty posiela len kiosk.
 * @param {SummaryInput} input @param {SummaryPeriod} period
 */
export function summaryModel(input, period) {
    const { pv } = input;
    if (!pv) return null;
    const today = localDateKey(input.now, input.site.timezone);
    const week = period === 'tyzden';
    const days = periodDays(input.dayLog, pv.dailyEnergyKwh ?? null, today, week);
    const known = /** @type {Array<{ date: string, kwh: number }>} */ (days.filter((d) => d.kwh !== null));
    const knownSum = known.reduce((s, d) => s + d.kwh, 0);
    // Mesiac má kiosk presne; týždeň len denník, v ktorom môže deň chýbať.
    const kwh = week ? knownSum : (pv.monthEnergyKwh ?? knownSum);
    const best = known.reduce((b, d) => (!b || d.kwh > b.kwh ? d : b), /** @type {{ date: string, kwh: number } | null} */ (null));
    const max = best ? best.kwh : 0;
    const price = longPrice(input);
    const month = MONTHS[Number(today.slice(5, 7)) - 1];
    return {
        period,
        kwh,
        days: days.map((d) => ({
            date: d.date,
            frac: d.kwh === null || max <= 0 ? null : d.kwh / max,
            best: !!best && d.date === best.date,
        })),
        ...summaryTexts({
            period,
            month,
            kwh,
            phones: kwh / EVERYDAY.phoneChargeKwh,
            km: kwh * EVERYDAY.evKmPerKwh,
            best: best && max > 0 ? { date: best.date, kwh: max, today: best.date === today } : null,
            value: price === null ? null : kwh * price,
            currency: input.tariff.currency,
            launches: week ? weekCount(input.launches, today) : monthCount(input.launches, today.slice(0, 7)),
            missing: days.length - known.length,
        }),
    };
}
