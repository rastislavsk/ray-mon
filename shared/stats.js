// Karta Štatistika: koľko elektráreň vyrobila za dnes, mesiac, rok a celý čas a akú hodnotu
// má tá elektrina podľa tarify. Čisté funkcie bez DOM.
//
// Súčty posiela kiosk (pv), rozpis po pásmach tarify sa ráta z krivky: dnešok z nameranej,
// dlhšie obdobia (kiosk ich má len ako súčet) z predpovede - do ktorých pásiem padá výroba.
// „Hodnota“ je to, čo by za túto elektrinu človek zaplatil zo siete. Koľko z nej spotreboval
// sám, appka nevie - kiosk hlási len výrobu.

import { MINUTES_PER_DAY } from './config.js';
import { localDateKey } from './solar.js';
import { weekStatsModel } from './chart-model.js';
import { bandAt, scheduleFor } from './tariff.js';

/** @typedef {'dnes' | 'mesiac' | 'rok' | 'spolu'} StatsPeriod */
/** @typedef {import('./config.js').Tariff} Tariff */

/** Obdobia v poradí prepínača. @type {StatsPeriod[]} */
export const STATS_PERIODS = ['dnes', 'mesiac', 'rok', 'spolu'];

// Mesiac v nominatíve (riadok) a v lokáli (nadpis „Vyrobené v septembri“).
export const MONTHS = [
    'január',
    'február',
    'marec',
    'apríl',
    'máj',
    'jún',
    'júl',
    'august',
    'september',
    'október',
    'november',
    'december',
];
const MONTHS_IN = [
    'januári',
    'februári',
    'marci',
    'apríli',
    'máji',
    'júni',
    'júli',
    'auguste',
    'septembri',
    'októbri',
    'novembri',
    'decembri',
];

/**
 * Výroba po pásmach tarify v jeden miestny deň: kWh v každom pásme (kľúč je id pásma).
 * Energia medzi dvoma bodmi krivky je lichobežník, pásmo sa berie v strede úseku. Slúži
 * nameranej krivke z kiosku (body po 5 min) aj hodinovej predpovedi rovnako.
 * @param {Array<{ hour: number, kw: number }>} points @param {Tariff} tariff @param {string} dateKey
 * @returns {Map<string, number>}
 */
export function energyByBand(points, tariff, dateKey) {
    const schedule = scheduleFor(tariff, dateKey);
    /** @type {Map<string, number>} */ const out = new Map();
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        const hours = b.hour - a.hour;
        if (!(hours > 0) || !Number.isFinite(a.kw) || !Number.isFinite(b.kw)) continue;
        const mid = Math.min(((a.hour + b.hour) / 2) * 60, MINUTES_PER_DAY - 1);
        const id = bandAt(tariff, schedule, mid).id;
        out.set(id, (out.get(id) || 0) + ((a.kw + b.kw) / 2) * hours);
    }
    return out;
}

/**
 * Priemerná cena kWh pri danom rozložení výroby do pásiem, alebo null: bez výroby, alebo keď
 * niektoré pásmo nemá cenu (kto zadal len časť cien, nedostane polovičné eurá).
 * @param {Map<string, number>} byBand @param {Tariff} tariff @returns {number | null}
 */
export function averagePrice(byBand, tariff) {
    if (tariff.bands.some((b) => b.price === null)) return null;
    let kwh = 0;
    let money = 0;
    for (const [id, e] of byBand) {
        const band = tariff.bands.find((b) => b.id === id);
        kwh += e;
        money += e * /** @type {number} */ (band ? band.price : 0);
    }
    return kwh > 0 ? money / kwh : null;
}

/** Spojí rozpisy viacerých dní. @param {Array<Map<string, number>>} maps */
function sumMaps(maps) {
    /** @type {Map<string, number>} */ const out = new Map();
    for (const m of maps) for (const [id, e] of m) out.set(id, (out.get(id) || 0) + e);
    return out;
}

/**
 * @typedef {{ now: Date, site: import('./config.js').Site, tariff: Tariff, kiosk: string, loading: boolean,
 *   pv: import('./kiosk.js').PvData | null, forecast: import('./solar.js').Forecast | null }} StatsInput
 * @typedef {{ period: StatsPeriod, label: string, heading: string, kwh: number | null, value: number | null, perDay: number | null }} StatsEntry
 */

/** kWh × cena, alebo null, keď jedno z nich chýba. @param {number | null} kwh @param {number | null} price */
const valueOf = (kwh, price) => (kwh === null || price === null ? null : kwh * price);

/**
 * Priemerné ceny výroby. Dnešok podľa nameranej krivky - každý úsek za cenu svojho pásma.
 * Dlhšie obdobia má kiosk len ako súčet, tie dostanú cenu podľa toho, do ktorých pásiem (aj
 * víkendových a sezónnych výnimiek) padá výroba najbližších dní z predpovede. Keď jedno
 * z nich chýba, zastúpi ho druhé.
 * @param {StatsInput} input @param {string} today
 */
function prices({ tariff, pv, forecast }, today) {
    const days = forecast ? forecast.days : [];
    const fromForecast = averagePrice(sumMaps(days.map((d) => energyByBand(d.hourly, tariff, d.date))), tariff);
    const fromCurve = averagePrice(energyByBand(pv ? pv.realCurveToday : [], tariff, today), tariff);
    return { today: fromCurve ?? fromForecast, long: fromForecast ?? fromCurve };
}

/**
 * Priemerná cena kWh pre dlhšie obdobia (mesiac, rok) - tá istá, akou karta Štatistika oceňuje
 * súčty z kiosku. Null, keď tarifa ceny nemá.
 * @param {StatsInput} input
 */
export function longPrice(input) {
    return prices(input, localDateKey(input.now, input.site.timezone)).long;
}

/**
 * Súčty z kiosku po obdobiach, s hodnotou a pri mesiaci a roku priemerom na deň (dnešok sa
 * ráta celý, hoci ešte beží).
 * @param {import('./kiosk.js').PvData | null} pv @param {string} today @param {{ today: number | null, long: number | null }} price
 * @returns {Record<StatsPeriod, StatsEntry>}
 */
function entries(pv, today, price) {
    const [year, month, day] = today.split('-').map(Number);
    const dayOfYear = Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 86400000) + 1;
    const d = pv?.dailyEnergyKwh ?? null;
    const m = pv?.monthEnergyKwh ?? null;
    const y = pv?.yearEnergyKwh ?? null;
    const all = pv?.cumulativeEnergyKwh ?? null;
    const monthName = MONTHS[month - 1];
    return {
        dnes: { period: 'dnes', label: 'Dnes', heading: 'Vyrobené dnes', kwh: d, value: valueOf(d, price.today), perDay: null },
        mesiac: {
            period: 'mesiac',
            label: monthName.charAt(0).toUpperCase() + monthName.slice(1),
            heading: `Vyrobené v ${MONTHS_IN[month - 1]}`,
            kwh: m,
            value: valueOf(m, price.long),
            perDay: m === null ? null : m / day,
        },
        rok: {
            period: 'rok',
            label: `Rok ${year}`,
            heading: `Vyrobené v roku ${year}`,
            kwh: y,
            value: valueOf(y, price.long),
            perDay: y === null ? null : y / dayOfYear,
        },
        spolu: {
            period: 'spolu',
            label: 'Od spustenia',
            heading: 'Vyrobené od spustenia',
            kwh: all,
            value: valueOf(all, price.long),
            perDay: null,
        },
    };
}

/**
 * Čo karta môže ukázať: `live` súčty z kiosku, `loading` prvé sťahovanie ešte beží, `offline`
 * kiosk je zadaný, ale neodpovedá, `none` bez kiosku (vrátane appky bez zadaných panelov).
 * @param {StatsInput} input @returns {'live' | 'loading' | 'offline' | 'none'}
 */
function statusOf({ pv, loading, kiosk }) {
    if (pv) return 'live';
    if (loading) return 'loading';
    return kiosk ? 'offline' : 'none';
}

/**
 * Model karty pre zvolené obdobie. Bez merania ostáva dnešok podľa predpovede (`forecastToday`).
 * @param {StatsInput} input @param {StatsPeriod} period
 */
export function statsModel(input, period) {
    const { tariff, pv, forecast } = input;
    const today = localDateKey(input.now, input.site.timezone);
    const all = entries(pv, today, prices(input, today));
    const days = forecast ? forecast.days : [];
    const todayForecast = days.find((d) => d.date === today) || null;
    return {
        status: statusOf(input),
        priced: !tariff.bands.some((b) => b.price === null),
        currency: tariff.currency,
        hero: all[period],
        rows: STATS_PERIODS.filter((p) => p !== period).map((p) => all[p]),
        // Dnešok voči predpovedi - ten istý výpočet ako bublina Dnes na karte 7 dní.
        // Počíta s dneškom na prvom mieste predpovede, preto len vtedy, keď tam naozaj je.
        progress: period === 'dnes' && todayForecast && todayForecast === days[0] ? weekStatsModel(days, pv, false).progress : null,
        forecastToday: todayForecast && {
            kwh: todayForecast.kwhTotal,
            value: valueOf(todayForecast.kwhTotal, averagePrice(energyByBand(todayForecast.hourly, tariff, today), tariff)),
        },
    };
}
