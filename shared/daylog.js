// Denník výroby po dňoch: dátum → kWh. Kiosk posiela len súčty, dni si appka odkladá sama pri
// každej obnove merania (web/interactions.js). Čisté funkcie - úložisko rieši web/settings-store.js.

import { DAYLOG } from './config.js';
import { addDays } from './solar.js';

/** @typedef {Record<string, number>} DayLog miestny dátum `YYYY-MM-DD` → vyrobené kWh */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Denník z úložiska. Čo nesedí (zlý dátum, záporné alebo nečíselné kWh), vypadne. Drží sa
 * najviac DAYLOG.limit najnovších dní.
 * @param {unknown} raw @returns {DayLog}
 */
export function parseDayLog(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const entries = Object.entries(raw).filter(([d, v]) => DATE_RE.test(d) && typeof v === 'number' && Number.isFinite(v) && v >= 0);
    return Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : 1)).slice(-DAYLOG.limit));
}

/**
 * Zapíše dnešnú výrobu. Súčet dňa len rastie, takže platí vyšší z dvoch - výpadok alebo
 * oneskorená odpoveď kiosku tak zapísaný deň nezníži. Pred DAYLOG.fromMin sa nezapisuje nič.
 * Vracia ten istý objekt, keď sa nič nezmenilo.
 * @param {DayLog} log @param {string} date @param {number} nowMin @param {number | null | undefined} kwh
 */
export function recordDay(log, date, nowMin, kwh) {
    if (nowMin < DAYLOG.fromMin || typeof kwh !== 'number' || !Number.isFinite(kwh) || kwh < 0) return log;
    if (log[date] !== undefined && log[date] >= kwh) return log;
    return parseDayLog({ ...log, [date]: kwh });
}

/**
 * Posledných `count` dní až po dnešok (vrátane), najstarší prvý. Deň, keď appka nebola otvorená,
 * má `kwh: null`.
 * @param {DayLog} log @param {string} today @param {number} count
 * @returns {Array<{ date: string, kwh: number | null }>}
 */
export function lastDays(log, today, count) {
    return Array.from({ length: count }, (_, i) => {
        const date = addDays(today, i - count + 1);
        return { date, kwh: log[date] ?? null };
    });
}

/**
 * Dni mesiaca od prvého po dnešok.
 * @param {DayLog} log @param {string} today @returns {Array<{ date: string, kwh: number | null }>}
 */
export function monthDays(log, today) {
    return lastDays(log, today, Number(today.slice(8, 10)));
}
