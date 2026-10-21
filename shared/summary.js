// Súhrn na zdieľanie v karte Môžem?: týždeň, mesiac alebo rok na streche v jednotkách, ktoré pozná
// každý (nabitia mobilu, km autom), najlepší deň, hodnota podľa tarify, koľko toho človek
// pustil na slnku a úspora CO2eq s uhlíkovou návratnosťou panelov (shared/carbon.js). Čisté funkcie; texty skladá shared/messages.js.
//
// Mesačný a ročný súčet je presný z kiosku. Týždeň, stĺpce dní a mesiacov stoja na denníku
// (shared/daylog.js), ktorý si appka vedie sama - deň, keď nebola otvorená, v ňom chýba a súhrn to povie.

import { carbonFacts } from './carbon.js';
import { EVERYDAY } from './config.js';
import { lastDays, monthDays, yearDays } from './daylog.js';
import { monthCount, sunRuns } from './launches.js';
import { summaryTexts } from './messages.js';
import { addDays, localDateKey } from './solar.js';
import { longPrice, MONTHS } from './stats.js';

/** @typedef {import('./config.js').SummaryPeriod} SummaryPeriod */
// Obdobia v poradí prepínača - jedno miesto pravdy je config.js.
export { SUMMARY_PERIODS } from './config.js';

/**
 * @typedef {import('./stats.js').StatsInput & { launches: import('./launches.js').Launch[],
 *   dayLog: import('./daylog.js').DayLog, plant: import('./config.js').Plant }} SummaryInput
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
 * @param {import('./daylog.js').DayLog} dayLog @param {number | null} live @param {string} today @param {SummaryPeriod} period
 */
export function periodDays(dayLog, live, today, period) {
    const log = live === null ? dayLog : { ...dayLog, [today]: Math.max(live, dayLog[today] ?? 0) };
    if (period === 'tyzden') return lastDays(log, today, 7);
    return period === 'rok' ? yearDays(log, today) : monthDays(log, today);
}

/**
 * Najlepší deň zo zoznamu dní (deň bez čísla sa nepočíta), alebo null. Pri rovnakej výrobe skorší.
 * @param {Array<{ date: string, kwh: number | null }>} days @returns {{ date: string, kwh: number } | null}
 */
export function bestOf(days) {
    /** @type {{ date: string, kwh: number } | null} */ let best = null;
    for (const d of days) if (d.kwh !== null && (!best || d.kwh > best.kwh)) best = { date: d.date, kwh: d.kwh };
    return best;
}

/**
 * Mesiace roka pre stĺpce: súčet dní z denníka (null, keď z mesiaca nie je ani jeden), `partial`,
 * keď niektorý deň chýba - stĺpec je potom nižší, než mesiac naozaj bol -, a `future` pre mesiace,
 * ktoré ešte len prídu. `frac` je výška voči najlepšiemu mesiacu.
 * @param {Array<{ date: string, kwh: number | null }>} days dni roka po dnešok (yearDays) @param {string} today
 */
export function yearMonths(days, today) {
    const sums = Array.from({ length: 12 }, (_, i) => {
        const month = `${today.slice(0, 4)}-${String(i + 1).padStart(2, '0')}`;
        const inMonth = days.filter((d) => d.date.startsWith(month));
        const known = inMonth.filter((d) => d.kwh !== null);
        return {
            month,
            kwh: known.length ? known.reduce((s, d) => s + /** @type {number} */ (d.kwh), 0) : null,
            partial: known.length > 0 && known.length < inMonth.length,
            future: month > today.slice(0, 7),
        };
    });
    const max = Math.max(0, ...sums.map((m) => m.kwh ?? 0));
    return sums.map((m) => ({
        ...m,
        frac: m.kwh === null || max <= 0 ? null : m.kwh / max,
        best: max > 0 && m.kwh === max,
    }));
}

/**
 * Súčet obdobia: mesiac a rok má kiosk presne, týždeň len denník, v ktorom môže deň chýbať.
 * @param {import('./kiosk.js').PvData} pv @param {SummaryPeriod} period @param {number} knownSum súčet známych dní
 */
function periodKwh(pv, period, knownSum) {
    if (period === 'mesiac') return pv.monthEnergyKwh ?? knownSum;
    return period === 'rok' ? (pv.yearEnergyKwh ?? knownSum) : knownSum;
}

/**
 * Spustenia v období: posledných 7 dní, tento mesiac alebo tento rok.
 * @param {import('./launches.js').Launch[]} list @param {SummaryPeriod} period @param {string} today
 */
function periodLaunches(list, period, today) {
    if (period === 'tyzden') return weekCount(list, today);
    return monthCount(list, today.slice(0, period === 'rok' ? 4 : 7));
}

/**
 * Model súhrnu, alebo null bez živého merania - súčty posiela len kiosk. `facts` sú čísla, z ktorých
 * sú poskladané riadky (summaryTexts) - plagát novej appky (shared/statistika.js) ich ukazuje inak.
 * Rok má navyše `months` - stĺpce mesiacov namiesto dní.
 * @param {SummaryInput} input @param {SummaryPeriod} period @param {import('./messages.js').Voice} [voice] tón riadkov
 */
export function summaryModel(input, period, voice = 'drzy') {
    const { pv } = input;
    if (!pv) return null;
    const today = localDateKey(input.now, input.site.timezone);
    const days = periodDays(input.dayLog, pv.dailyEnergyKwh ?? null, today, period);
    const known = /** @type {Array<{ date: string, kwh: number }>} */ (days.filter((d) => d.kwh !== null));
    const kwh = periodKwh(
        pv,
        period,
        known.reduce((s, d) => s + d.kwh, 0),
    );
    const best = bestOf(known);
    const max = best ? best.kwh : 0;
    const price = longPrice(input);
    const facts = {
        period,
        month: MONTHS[Number(today.slice(5, 7)) - 1],
        year: today.slice(0, 4),
        kwh,
        phones: kwh / EVERYDAY.phoneChargeKwh,
        km: kwh * EVERYDAY.evKmPerKwh,
        best: best && max > 0 ? { date: best.date, kwh: max, today: best.date === today } : null,
        value: price === null ? null : kwh * price,
        currency: input.tariff.currency,
        launches: periodLaunches(input.launches, period, today),
        // Prania zo slnka - zápisy „Pustil/a som“ práčky v dňoch obdobia.
        washes: sunRuns(input.launches, 'pracka', days[0].date, today),
        missing: days.length - known.length,
        ...carbonFacts(kwh, pv.cumulativeEnergyKwh ?? null, input.plant),
    };
    return {
        period,
        kwh,
        days: days.map((d) => ({
            date: d.date,
            frac: d.kwh === null || max <= 0 ? null : d.kwh / max,
            best: !!best && d.date === best.date,
        })),
        months: period === 'rok' ? yearMonths(days, today) : null,
        facts,
        ...summaryTexts(facts, voice),
    };
}

/** @typedef {NonNullable<ReturnType<typeof summaryModel>>['facts']} SummaryFacts */
/** @typedef {ReturnType<typeof yearMonths>} YearMonths */
