// Karta Štatistika a plagát v novej appke „Živá obloha“ (obloha/). Počíta to isté ako karta
// Štatistika a súhrn súčasnej appky: súčty, hodnotu podľa tarify a dnešok voči predpovedi
// statsModel, plagát summaryModel, prepočty na mobily a kilometre EVERYDAY. Tu sa to len skladá
// pre nový vzhľad. Navyše: bez živého merania obdobia z denníka výroby (logSum) a najlepší deň
// mesiaca. Čisté funkcie, čas aj dáta prichádzajú v parametroch. Texty sú v shared/messages.js.

import { EVERYDAY, installedKw } from './config.js';
import { logSum } from './daylog.js';
import { fmtSum, kwpText } from './format.js';
import { pvFreshness } from './hero-model.js';
import {
    posterBestDay,
    posterButtonText,
    statsBestText,
    statsHeroSub,
    statsProgressText,
    statsValueText,
    STATISTIKA_TEXTS,
} from './messages.js';
import { offlineLead } from './mozem-sky.js';
import { localDateKey } from './solar.js';
import { MONTHS_IN, STATS_PERIODS, statsModel } from './stats.js';
import { bestOf, periodDays, SUMMARY_PERIODS, summaryModel } from './summary.js';

/**
 * @typedef {import('./summary.js').SummaryInput & { known: import('./settings.js').Known,
 *   plant: import('./config.js').Plant }} StatistikaInput
 * @typedef {import('./stats.js').StatsPeriod} StatsPeriod
 * @typedef {import('./summary.js').SummaryPeriod} SummaryPeriod
 * @typedef {{ period: StatsPeriod, name: string, kwh: number | null, sub: string, estimate: boolean, value: number | null }} Entry
 */

/** kWh do textu ako v súčasnej appke: „31,7“, od tisíc „9 112“; bez údaja pomlčka. @param {number | null} kwh */
export const kwhText = (kwh) => (kwh === null ? '–' : fmtSum(kwh, 1));

/**
 * Obdobia karty. So živým meraním súčty z kiosku (statsModel). Bez neho dnešok z predpovede
 * (odhad) a mesiac, rok a „spolu“ ako súčet dní, ktoré si appka zapísala do denníka výroby.
 * @param {StatistikaInput} input @param {ReturnType<typeof statsModel>} s @param {string} today
 * @returns {Record<StatsPeriod, Entry>}
 */
function entriesOf(input, s, today) {
    const live = s.status === 'live';
    const time = input.pv ? pvFreshness({ now: input.now, pv: input.pv, site: input.site }).time : '';
    const month = MONTHS_IN[Number(today.slice(5, 7)) - 1];
    const byPeriod = Object.fromEntries([s.hero, ...s.rows].map((e) => [e.period, e]));
    const prefix = { dnes: today, mesiac: today.slice(0, 8), rok: today.slice(0, 5), spolu: '' };
    /** @param {StatsPeriod} period @returns {Entry} */
    const entry = (period) => {
        const e = byPeriod[period];
        if (live) {
            const sub = statsHeroSub(period, { source: 'live', time, month, days: 0 });
            return { period, name: e.label, kwh: e.kwh, sub, estimate: false, value: e.value };
        }
        if (period === 'dnes') {
            const f = s.forecastToday;
            const sub = statsHeroSub(period, { source: 'forecast', time, month, days: 0 });
            return { period, name: e.label, kwh: f ? f.kwh : null, sub, estimate: true, value: f ? f.value : null };
        }
        const log = logSum(input.dayLog, prefix[period]);
        const name = period === 'spolu' ? STATISTIKA_TEXTS.logAll : e.label;
        const sub = statsHeroSub(period, { source: 'log', time, month, days: log.days });
        return { period, name, kwh: log.kwh, sub, estimate: true, value: null };
    };
    return { dnes: entry('dnes'), mesiac: entry('mesiac'), rok: entry('rok'), spolu: entry('spolu') };
}

/**
 * Najlepší deň mesiaca z denníka výroby (dnešok aj zo živého merania, ako v súhrne). Na
 * porovnanie treba aspoň dva zapísané dni - z jedného by „najlepší“ nič nehovoril.
 * @param {StatistikaInput} input @param {string} today
 * @returns {{ date: string, kwh: number, today: boolean } | null}
 */
export function monthBest(input, today) {
    const days = periodDays(input.dayLog, input.pv?.dailyEnergyKwh ?? null, today, false);
    const best = bestOf(days);
    if (!best || best.kwh <= 0 || days.filter((d) => d.kwh !== null).length < 2) return null;
    return { ...best, today: best.date === today };
}

/**
 * Dnešok voči predpovedi: pás (0 - 100 %) a veta. Len pri dnešku so živým meraním.
 * @param {ReturnType<typeof statsModel>} s
 */
function progressOf({ progress, forecastToday }) {
    if (!progress || !forecastToday) return null;
    return { pct: Math.max(0, Math.min(100, progress.pct)), text: statsProgressText(progress.pct, forecastToday.kwh) };
}

/** „To je ako“: nabitia mobilu a km elektrickým autom (EVERYDAY). Bez výroby nič. @param {number | null} kwh */
function equivOf(kwh) {
    if (kwh === null || !(kwh > 0)) return null;
    return {
        phones: `${fmtSum(Math.round(kwh / EVERYDAY.phoneChargeKwh), 0)}×`,
        km: `${fmtSum(Math.round(kwh * EVERYDAY.evKmPerKwh), 0)} km`,
    };
}

/**
 * Model karty pre zvolené obdobie. `kind`: `ask` (appka nepozná polohu), `setup` (poloha bez
 * panelov - štatistika je o vlastnej elektrárni, nie o typickej streche), `loading` (prvé
 * načítanie), `offline` (nie je meranie ani predpoveď), `ok`. Pri `ok` bez živého merania
 * `measure` hovorí, či ide výzva pripojiť meranie (`ask`), alebo veta, že neodpovedá (`off`).
 * @param {StatistikaInput} input @param {StatsPeriod} period @param {{ online?: boolean }} [opts] či má telefón internet
 */
export function statistikaModel(input, period, { online = true } = {}) {
    const base = emptyModel();
    if (input.known === 'nic') return { ...base, kind: /** @type {const} */ ('ask') };
    if (input.known === 'poloha') return { ...base, kind: /** @type {const} */ ('setup'), sub: STATISTIKA_TEXTS.setupSub };
    const s = statsModel(input, period);
    if (s.status === 'loading') return { ...base, kind: /** @type {const} */ ('loading'), sub: STATISTIKA_TEXTS.loading };
    if (!input.pv && !input.forecast)
        return { ...base, kind: /** @type {const} */ ('offline'), sub: offlineLead(input, online), retry: true };
    return { ...base, ...numbersOf(input, s, period) };
}

/** Model bez čísel - z neho vychádza každý stav karty. */
function emptyModel() {
    return {
        kind: /** @type {'ask' | 'setup' | 'loading' | 'offline' | 'ok'} */ ('ok'),
        sub: '',
        retry: false,
        hero: /** @type {Entry | null} */ (null),
        value: /** @type {string | null} */ (null),
        progress: /** @type {{ pct: number, text: string } | null} */ (null),
        equiv: /** @type {{ phones: string, km: string } | null} */ (null),
        rows: /** @type {Entry[]} */ ([]),
        best: /** @type {{ title: string, text: string } | null} */ (null),
        note: '',
        measure: /** @type {'ask' | 'off' | null} */ (null),
        prices: false,
        posters: /** @type {Array<{ period: SummaryPeriod, label: string }>} */ ([]),
    };
}

/**
 * Čísla karty, keď je z čoho počítať (meranie alebo aspoň predpoveď).
 * @param {StatistikaInput} input @param {ReturnType<typeof statsModel>} s @param {StatsPeriod} period
 */
function numbersOf(input, s, period) {
    const today = localDateKey(input.now, input.site.timezone);
    const all = entriesOf(input, s, today);
    const hero = all[period];
    const live = s.status === 'live';
    const best = monthBest(input, today);
    return {
        sub: kwpText(installedKw(input.plant)),
        hero,
        value: hero.value === null ? null : statsValueText(hero.value, s.currency, hero.estimate),
        progress: progressOf(s),
        equiv: equivOf(hero.kwh),
        rows: STATS_PERIODS.filter((p) => p !== period).map((p) => all[p]),
        best: best && statsBestText(best),
        note: live && s.priced ? STATISTIKA_TEXTS.note : '',
        measure: /** @type {'ask' | 'off' | null} */ (live ? null : s.status === 'offline' ? 'off' : 'ask'),
        prices: !s.priced,
        posters: live ? posterButtons(input) : [],
    };
}

/** @typedef {ReturnType<typeof statistikaModel>} StatistikaModel */

/**
 * Tlačidlá plagátu: obe obdobia súhrnu, mesiac prvý ako v návrhu. Plagát skladá čísla zo
 * živého merania - bez neho nie je čo zdieľať a tlačidlá nie sú.
 * @param {import('./summary.js').SummaryInput} input
 */
function posterButtons(input) {
    return [...SUMMARY_PERIODS].reverse().flatMap((period) => {
        const m = summaryModel(input, period);
        return m ? [{ period, label: posterButtonText(m.kick) }] : [];
    });
}

/**
 * Plagát na zdieľanie: nadpis s miestom, veľké kWh, stĺpce dní, štyri čísla (a hodnota podľa
 * tarify, keď sú ceny) a poznámka o dňoch, ktoré v denníku chýbajú. Čísla sú tie isté ako
 * v súhrne súčasnej appky (summaryModel). Bez živého merania null.
 * @param {import('./summary.js').SummaryInput} input @param {SummaryPeriod} period
 */
export function posterModel(input, period) {
    const m = summaryModel(input, period);
    if (!m) return null;
    const f = m.facts;
    const T = STATISTIKA_TEXTS;
    /** @type {Array<{ value: string, label: string }>} */ const tiles = [];
    if (f.kwh > 0) {
        tiles.push({ value: `${fmtSum(Math.round(f.phones), 0)}×`, label: T.posterPhones });
        tiles.push({ value: `${fmtSum(Math.round(f.km), 0)} km`, label: T.posterKm });
    }
    if (f.best) tiles.push({ value: posterBestDay(f.best), label: `najlepší deň, ${kwhText(f.best.kwh)} kWh` });
    if (f.washes) tiles.push({ value: `${f.washes}×`, label: T.posterWashes });
    if (f.value !== null && f.kwh > 0) tiles.push({ value: `~${fmtSum(f.value, 0)} ${f.currency}`, label: T.posterValue });
    return {
        period,
        kick: m.kick,
        title: input.site.name ? `${m.kick} · ${input.site.name}` : m.kick,
        total: m.kwh,
        kwh: `${fmtSum(Math.round(m.kwh), 0)} kWh`,
        // Výška stĺpca v % najlepšieho dňa, deň bez čísla null (kreslí sa len obrys).
        cols: m.days.map((d) => ({ date: d.date, h: d.frac === null ? null : Math.max(4, Math.round(d.frac * 100)), best: d.best })),
        tiles,
        note: m.note,
        foot: T.posterFoot,
    };
}

/** @typedef {NonNullable<ReturnType<typeof posterModel>>} PosterModel */
