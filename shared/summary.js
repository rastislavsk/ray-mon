// Plagát obdobia na karte Štatistika v oboch appkách: dnes, mesiac, rok alebo celý čas na streche
// v jednotkách, ktoré pozná každý (nabitia mobilu, km autom), najlepší deň, hodnota podľa tarify
// a úspora CO2eq s uhlíkovou návratnosťou panelov (shared/carbon.js). Bez merania dnešok
// z predpovede. Čisté funkcie; texty skladá shared/messages.js.
//
// Súčty sú z merania (statsModel) - od výrobcu, alebo dopočítané z celkovej výroby (shared/sucty.js),
// vtedy možno len od prvého merania (`od`). Štvorčeky dní a stĺpce mesiacov stoja na denníku
// (shared/daylog.js), ktorý si appka vedie sama - deň, keď nebola otvorená, v ňom chýba a plagát to povie.

import { carbonFacts } from './carbon.js';
import { EVERYDAY } from './config.js';
import { fmt1, fmtSum } from './format.js';
import { monthDays, yearDays } from './daylog.js';
import { summaryEstimateTexts, summaryMeter, summaryTexts } from './messages.js';
import { localDateKey, localMinutes } from './solar.js';
import { longPrice, MONTHS, statsModel } from './stats.js';
import { menoZnacky } from './zdroje.js';

/** @typedef {import('./stats.js').StatsPeriod} StatsPeriod */

/**
 * @typedef {import('./stats.js').StatsInput & {
 *   dayLog: import('./daylog.js').DayLog, plant: import('./config.js').Plant }} SummaryInput
 * @typedef {{ kind: 'meter', pct: number, left: string, right: string }
 *   | { kind: 'days', days: Array<{ date: string, frac: number | null, future: boolean }> }
 *   | { kind: 'months', months: YearMonths }} SummaryViz
 * @typedef {{ status: 'live' | 'loading' | 'offline' | 'none', priced: boolean, kind: 'live' | 'estimate' | 'none',
 *   period: StatsPeriod, periods: boolean, kick: string, heading: string, kwh: number | null, big: string,
 *   viz: SummaryViz | null, rows: Array<{ t: string, s: string }>, note: string,
 *   facts: import('./messages.js').SummaryFacts | null }} SummaryModel
 */

/**
 * Dni mesiaca či roka z denníka po dnešok. Dnešok berie z kiosku, aj keď ho denník ešte nemá
 * (zapisuje sa až od rána, viď DAYLOG). Dnešok a celý čas dni nemajú.
 * @param {import('./daylog.js').DayLog} dayLog @param {number | null} live @param {string} today @param {StatsPeriod} period
 */
export function periodDays(dayLog, live, today, period) {
    if (period !== 'mesiac' && period !== 'rok') return [];
    const log = live === null ? dayLog : { ...dayLog, [today]: Math.max(live, dayLog[today] ?? 0) };
    return period === 'rok' ? yearDays(log, today) : monthDays(log, today);
}

/**
 * Najlepší deň zo zoznamu dní, alebo null. Na porovnanie treba aspoň dva dni s číslom - z jedného
 * by „najlepší“ nič nehovoril. Pri rovnakej výrobe skorší.
 * @param {Array<{ date: string, kwh: number | null }>} days @returns {{ date: string, kwh: number } | null}
 */
export function bestOf(days) {
    /** @type {{ date: string, kwh: number } | null} */ let best = null;
    let known = 0;
    for (const d of days) {
        if (d.kwh === null) continue;
        known++;
        if (!best || d.kwh > best.kwh) best = { date: d.date, kwh: d.kwh };
    }
    return known >= 2 && best && best.kwh > 0 ? best : null;
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
/** @typedef {ReturnType<typeof yearMonths>} YearMonths */

/**
 * Štvorčeky dní mesiaca: výška farby voči najlepšiemu dňu, chýbajúci deň null, dni do konca
 * mesiaca `future`.
 * @param {Array<{ date: string, kwh: number | null }>} days @param {string} today
 */
function monthCells(days, today) {
    const max = Math.max(0, ...days.map((d) => d.kwh ?? 0));
    const [y, m] = today.split('-').map(Number);
    const length = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cells = days.map((d) => ({ date: d.date, frac: d.kwh === null || max <= 0 ? null : d.kwh / max, future: false }));
    for (let day = days.length + 1; day <= length; day++)
        cells.push({ date: `${today.slice(0, 8)}${String(day).padStart(2, '0')}`, frac: null, future: true });
    return cells;
}

/**
 * Koľko ešte dnes vyrobí podľa predpovede: krivka dneška od tejto chvíle do večera (lichobežníky,
 * úsek, v ktorom práve sme, od teraz). Pod 0,1 kWh nič - deň je za nami.
 * @param {SummaryInput} input @param {string} today @param {number} kwh doteraz vyrobené
 */
export function restToday(input, today, kwh) {
    const day = input.forecast?.days.find((d) => d.date === today);
    if (!day) return null;
    const h = localMinutes(input.now, input.site.timezone) / 60;
    let rest = 0;
    for (let i = 1; i < day.hourly.length; i++) {
        const a = day.hourly[i - 1];
        const b = day.hourly[i];
        if (b.hour <= h || !(b.hour > a.hour)) continue;
        const from = Math.max(a.hour, h);
        const kwFrom = a.kw + ((b.kw - a.kw) * (from - a.hour)) / (b.hour - a.hour);
        rest += ((kwFrom + b.kw) / 2) * (b.hour - from);
    }
    return rest >= 0.1 ? { kwh: rest, total: kwh + rest } : null;
}

/** Veľké číslo: do 100 kWh s desatinou („18,4“), potom celé („9 112“); bez súčtu pomlčka. @param {number | null} kwh */
export const bigText = (kwh) => (kwh === null ? '–' : fmtSum(kwh < 100 ? Math.round(kwh * 10) / 10 : Math.round(kwh), kwh < 100 ? 1 : 0));

/** kWh do textu: „31,7“, od tisíc „9 112“; bez údaja pomlčka. @param {number | null} kwh */
export const kwhText = (kwh) => (kwh === null ? '–' : fmtSum(kwh, 1));

/**
 * Obrázok pod veľkým číslom: dnešok voči predpovedi, mesiac ako štvorčeky dní, rok ako stĺpce
 * mesiacov, celý čas ako splatený uhlík panelov.
 * @param {StatsPeriod} period @param {ReturnType<typeof statsModel>} s @param {Array<{ date: string, kwh: number | null }>} days
 * @param {string} today @param {number | null} payback @returns {SummaryViz | null}
 */
function vizOf(period, s, days, today, payback) {
    if (period === 'mesiac') return { kind: 'days', days: monthCells(days, today) };
    if (period === 'rok') return { kind: 'months', months: yearMonths(days, today) };
    if (period === 'spolu') return payback === null ? null : { kind: 'meter', ...summaryMeter({ payback }) };
    return s.progress && s.forecastToday
        ? { kind: 'meter', ...summaryMeter({ pct: s.progress.pct, forecastKwh: s.forecastToday.kwh }) }
        : null;
}

/**
 * Chýbajúce dni a súčet, ktorý nesiaha na začiatok obdobia (shared/sucty.js): taký je len od prvého
 * merania (`od`) a dni pred ním v denníku nechýbajú - appka vtedy meranie nemala. `znacka` do vety.
 * @param {SummaryInput} input @param {StatsPeriod} period @param {Array<{ date: string, kwh: number | null }>} days
 */
function odFacts(input, period, days) {
    const od = { dnes: input.pv?.od?.den, mesiac: input.pv?.od?.mesiac, rok: input.pv?.od?.rok, spolu: undefined }[period] ?? null;
    return {
        missing: days.filter((d) => d.kwh === null && (!od || d.date >= od)).length,
        od,
        znacka: input.zdroj ? menoZnacky(input.zdroj.sposob) : '',
    };
}

/**
 * Model plagátu obdobia pre kartu Štatistika. `status` a `priced` sú zo statsModel (načítava sa,
 * meranie neodpovedá, ceny v tarife). `kind`: `live` čísla zo živého merania, `estimate` bez neho
 * dnešok z predpovede (obdobie je vždy dnes, ostatné sa vybrať nedajú), `none` nie je z čoho.
 * `facts` sú čísla, z ktorých sú poskladané riadky.
 * @param {SummaryInput} input @param {StatsPeriod} period @param {import('./messages.js').Voice} [voice] tón poznámky
 * @returns {SummaryModel}
 */
export function summaryModel(input, period, voice = 'drzy') {
    const s = statsModel(input, period);
    const base = { status: s.status, priced: s.priced, viz: null, note: '', facts: null };
    const { pv } = input;
    if (pv && s.status === 'live') return { ...base, ...liveOf(input, pv, period, s, voice) };
    const f = s.forecastToday;
    if (!f)
        return {
            ...base,
            kind: /** @type {const} */ ('none'),
            period,
            periods: false,
            kick: '',
            heading: '',
            kwh: null,
            big: '',
            rows: [],
        };
    const t = summaryEstimateTexts({
        kwh: f.kwh,
        phones: f.kwh / EVERYDAY.phoneChargeKwh,
        km: f.kwh * EVERYDAY.evKmPerKwh,
        value: f.value,
        currency: s.currency,
    });
    return {
        ...base,
        kind: /** @type {const} */ ('estimate'),
        period: /** @type {StatsPeriod} */ ('dnes'),
        periods: false,
        kick: t.kick,
        heading: t.heading,
        kwh: f.kwh,
        big: `~${fmt1(f.kwh)}`,
        rows: t.rows,
    };
}

/**
 * Plagát zo živého merania. Mesiac a rok bez súčtu od výrobcu sčíta známe dni denníka.
 * @param {SummaryInput} input @param {import('./kiosk.js').PvData} pv @param {StatsPeriod} period
 * @param {ReturnType<typeof statsModel>} s @param {import('./messages.js').Voice} voice
 * @returns {Omit<SummaryModel, 'status' | 'priced'>}
 */
function liveOf(input, pv, period, s, voice) {
    const today = localDateKey(input.now, input.site.timezone);
    const days = periodDays(input.dayLog, pv.dailyEnergyKwh ?? null, today, period);
    const knownSum = days.reduce((sum, d) => sum + (d.kwh ?? 0), 0);
    const kwh = s.hero.kwh ?? (period === 'mesiac' || period === 'rok' ? knownSum : null);
    const head = { kind: /** @type {const} */ ('live'), period, periods: true, kwh, big: bigText(kwh) };
    const carbon = carbonFacts(kwh ?? 0, pv.cumulativeEnergyKwh ?? null, input.plant);
    const viz = vizOf(period, s, days, today, carbon.payback);
    if (kwh === null) return { ...head, kick: '', heading: '', viz, rows: [], note: '', facts: null };
    const facts = factsOf(input, { period, s, days, today, kwh, carbon });
    const t = summaryTexts(facts, voice);
    return { ...head, kick: t.kick, heading: t.heading, viz, rows: t.rows, note: t.note, facts };
}

/**
 * Hodnota podľa tarify: zo statsModel, pri súčte sčítanom z denníka za dlhodobú cenu. Bez cien null.
 * @param {SummaryInput} input @param {ReturnType<typeof statsModel>} s @param {number} kwh
 */
function valueOf(input, s, kwh) {
    if (s.hero.kwh !== null) return s.hero.value;
    const price = longPrice(input);
    return price === null ? null : kwh * price;
}

/**
 * Čísla riadkov plagátu.
 * @param {SummaryInput} input
 * @param {{ period: StatsPeriod, s: ReturnType<typeof statsModel>, days: Array<{ date: string, kwh: number | null }>, today: string,
 *   kwh: number, carbon: ReturnType<typeof carbonFacts> }} d
 * @returns {import('./messages.js').SummaryFacts}
 */
function factsOf(input, { period, s, days, today, kwh, carbon }) {
    const value = valueOf(input, s, kwh);
    const best = bestOf(days);
    const perDay = s.hero.perDay;
    return {
        period,
        month: MONTHS[Number(today.slice(5, 7)) - 1],
        year: today.slice(0, 4),
        kwh,
        phones: kwh / EVERYDAY.phoneChargeKwh,
        km: kwh * EVERYDAY.evKmPerKwh,
        best: best && { ...best, today: best.date === today },
        value,
        valuePerDay: value !== null && perDay !== null && kwh > 0 ? (value * perDay) / kwh : null,
        currency: input.tariff.currency,
        rest: period === 'dnes' ? restToday(input, today, kwh) : null,
        ...odFacts(input, period, days),
        ...carbon,
    };
}
