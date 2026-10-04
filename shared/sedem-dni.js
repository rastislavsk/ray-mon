// Karta 7 dní v novej appke „Živá obloha“ (obloha/). Nahrádza kartu 7 dní súčasnej appky
// a počíta to isté: súčty a najlepší deň z weekStatsModel, kWh v riadkoch z weekListModel,
// okno na veľké veci z plánu dňa (dnešok presne dayPlan, ako na kartách Môžem? a Teraz), farby
// hodín z dayHourTiers, hlášky z dayDetailMessage a weekMessage. Tu sa to len skladá pre nový
// vzhľad - prehľad dní ako predpoveď počasia, detail dňa s grafom z day-chart.js a detail
// týždňa. Čisté funkcie, čas aj dáta prichádzajú v parametroch. Texty sú v shared/messages.js.

import {
    bestDayIndex,
    dayKwAt,
    HOUR_RANGE,
    realCurveBoundary,
    usePct,
    visibleHours,
    WEEK_HOURS,
    weekListModel,
    weekStatsModel,
} from './chart-model.js';
import { installedKw, powerThresholds } from './config.js';
import { dayChartModel, planCells, planLegend, slotTone } from './day-chart.js';
import { dayHourTiers, forecastDayPlan } from './day-plan.js';
import { dateParts, dayNameShort, fmt1, fmtSum, weekDayLong, weekDayName, weekDayShort } from './format.js';
import {
    dayChartText,
    sedemBarsText,
    sedemClearText,
    sedemDayMessage,
    sedemGuessText,
    sedemHeatText,
    sedemRangeText,
    sedemRowText,
    sedemSumText,
    sedemTitle,
    sedemWindowTile,
    SKY_WORDS,
    voiceTexts,
    weekMessage,
} from './messages.js';
import { planWindows } from './mozem.js';
import { offlineLead } from './mozem-sky.js';
import { skyWeather } from './sky.js';
import { localDateKey, localMinutes } from './solar.js';
import { todayCard } from './teraz.js';

/**
 * @typedef {import('./day-plan.js').PlanInput & { kiosk: string, loading: boolean,
 *   known: import('./settings.js').Known }} SedemInput
 * @typedef {SedemInput & { forecast: import('./solar.js').Forecast }} SedemData vstup s predpoveďou
 * @typedef {import('./solar.js').ForecastDay} ForecastDay
 * @typedef {{ from: number, to: number }} Window úsek dňa v minútach
 */

/** Úsek dňa, na ktorý sa kreslí pás okna v riadku: produkčné okno grafov (HOUR_RANGE). */
const SPAN = { from: HOUR_RANGE.min * 60, to: HOUR_RANGE.max * 60 };

/** Zaokrúhlenie na desatinu - kratší zápis, oko rozdiel nevidí. @param {number} v */
const r1 = (v) => Math.round(v * 10) / 10;

/**
 * Meno dňa v riadku: „Dnes“, „Zajtra“, potom skratka s dňom v mesiaci („So 4.“), ako
 * v predpovedi počasia. @param {string} date @param {number} index
 */
export function rowName(date, index) {
    return index < 2 ? weekDayShort(date, index) : `${dayNameShort(date)} ${dateParts(date).day}.`;
}

/**
 * Počasie dňa pre ikonu a slovo: z priemernej oblačnosti dňa tou istou hranicou ako obloha
 * (skyWeather). Bez oblačnosti v dátach null - ikona ani slovo sa nevymýšľajú.
 * @param {{ cloudAvgPct: number | null }} day @returns {import('./sky.js').SkyWeather | null}
 */
export function dayWeather(day) {
    return day.cloudAvgPct === null ? null : skyWeather(day.cloudAvgPct);
}

/** Okná na veľké veci: zelené úseky plánu dňa. @param {import('./day-plan.js').PlanSlot[]} plan @returns {Window[]} */
export function sunWindows(plan) {
    return planWindows(plan, (s) => s.tier === 'green');
}

/** Hlavné okno dňa: najdlhšie, pri rovnakej dĺžke skoršie. @param {Window[]} windows @returns {Window | null} */
export function mainWindow(windows) {
    return windows.reduce((best, w) => (!best || w.to - w.from > best.to - best.from ? w : best), /** @type {Window | null} */ (null));
}

/**
 * Zelené úseky pásu v riadku dňa: poloha a šírka v % pásu, ktorý ide cez produkčné okno
 * (HOUR_RANGE). Čo je mimo, sa oreže; deň bez okna má pás prázdny.
 * @param {Window[]} windows @returns {Array<{ left: number, width: number }>}
 */
export function windowBand(windows) {
    const pct = (/** @type {number} */ min) => ((Math.max(SPAN.from, Math.min(SPAN.to, min)) - SPAN.from) / (SPAN.to - SPAN.from)) * 100;
    return windows.map((w) => ({ left: r1(pct(w.from)), width: r1(pct(w.to) - pct(w.from)) })).filter((b) => b.width > 0);
}

/** Je deň v predpovedi dnešok? Po polnoci pred obnovou dát predpoveď začína ešte včerajškom. @param {SedemInput} input @param {ForecastDay} day */
const isToday = (input, day) => day.date === localDateKey(input.now, input.site.timezone);

/**
 * Prehľad karty. `kind`: `ask` (appka nepozná polohu), `loading` (prvé načítanie), `offline`
 * (bez predpovede), `ok`. Pri známej polohe bez panelov (`known: 'poloha'`) karta počíta
 * s typickou strechou, ktorú má vo vstupe, a priznáva to (`estimate`). Bez internetu ukazuje
 * poslednú známu predpoveď, ak nejakú má (`lastKnown`).
 * @param {SedemInput} input @param {{ online?: boolean, voice?: import('./messages.js').Voice }} [opts] či má telefón
 *   internet a tón hlášok
 */
export function sedemModel(input, { online = true, voice = 'drzy' } = {}) {
    const SEDEM_TEXTS = voiceTexts(voice).SEDEM_TEXTS;
    const estimate = input.known === 'poloha';
    const base = {
        kind: /** @type {'ask' | 'loading' | 'offline' | 'ok'} */ ('ok'),
        estimate,
        title: SEDEM_TEXTS.question,
        sum: '',
        sub: '',
        retry: false,
        ask: false,
        guess: /** @type {string | null} */ (null),
        rows: /** @type {ReturnType<typeof rowsOf>} */ ([]),
    };
    if (input.known === 'nic') return { ...base, kind: /** @type {const} */ ('ask'), ask: true };
    if (!input.forecast || !input.forecast.days.length) {
        if (input.loading) return { ...base, kind: /** @type {const} */ ('loading'), sub: SEDEM_TEXTS.loading };
        return { ...base, kind: /** @type {const} */ ('offline'), sub: offlineLead(input, online, voice), retry: true };
    }
    const data = /** @type {SedemData} */ (input);
    const days = data.forecast.days;
    const windows = days.map((_, i) => sunWindows(forecastDayPlan(data, i)));
    const stats = weekStatsModel(days, data.pv, data.forecast.tomorrowSunny);
    const best = bestDayIndex(days);
    const list = weekListModel(days, -1);
    return {
        ...base,
        title: sedemTitle(windows.some((w) => w.length) ? list[best].name : null),
        sum: sedemSumText({ totalKwh: stats.totalKwh, lastKnown: !online, estimate }),
        guess: estimate ? sedemGuessText(installedKw(data.plant), voice) : null,
        rows: rowsOf(days, list, windows, best, estimate),
    };
}

/**
 * Riadky dní: meno, počasie, zelený pás okna, kWh (tie isté celé kWh ako rebríček súčasnej
 * appky, weekListModel) a celé znenie pre čítačku.
 * @param {ForecastDay[]} days @param {ReturnType<typeof weekListModel>} list @param {Window[][]} windows
 * @param {number} best najlepší deň @param {boolean} estimate
 */
function rowsOf(days, list, windows, best, estimate) {
    return days.map((d, i) => {
        const weather = dayWeather(d);
        const word = weather ? SKY_WORDS[weather] : null;
        return {
            index: i,
            name: rowName(d.date, i),
            weather,
            kwh: `${estimate ? '~' : ''}${list[i].kwh} kWh`,
            band: windowBand(windows[i]),
            best: i === best,
            label: sedemRowText({ name: list[i].name, word, kwh: list[i].kwh, windows: windows[i], best: i === best, estimate }),
        };
    });
}

/**
 * Detail dňa: nadpis s počasím, tri čísla (kWh, špička, okno), graf dňa s pásom plánu (pri
 * dnešku so značkou „teraz“ a nameranou krivkou), čo už nabehlo, strop jasnej oblohy, cena zo
 * siete a hláška. Čísla sú tie isté ako v detaile dňa súčasnej appky (kWh a špička na desatinu).
 * @param {SedemData} input @param {number} index deň v `forecast.days` @param {import('./messages.js').Voice} [voice] tón hlášky
 */
export function sedemDayModel(input, index, voice = 'drzy') {
    const SEDEM_TEXTS = voiceTexts(voice).SEDEM_TEXTS;
    const days = input.forecast.days;
    const day = days[index];
    const th = powerThresholds(input.plant);
    const plan = forecastDayPlan(input, index);
    const windows = sunWindows(plan);
    const weather = dayWeather(day);
    const today = isToday(input, day);
    const nowMin = today ? localMinutes(input.now, input.site.timezone) : null;
    return {
        index,
        first: index === 0,
        last: index === days.length - 1,
        title: weekDayLong(day.date, index),
        weather,
        sub: [weather ? SKY_WORDS[weather] : '', input.known === 'poloha' ? SEDEM_TEXTS.typical : ''].filter(Boolean).join(' · '),
        nums: [
            { value: fmt1(day.kwhTotal), label: SEDEM_TEXTS.kwhDay },
            { value: Number.isFinite(day.peakKw) ? fmt1(day.peakKw) : '–', label: SEDEM_TEXTS.kwPeak },
            sedemWindowTile(mainWindow(windows)),
        ],
        chart: chartOf(input, day, plan, nowMin),
        done: nowMin === null ? '' : todayCard(input, plan, nowMin).line,
        clear: sedemClearText(day.clearKwhTotal, usePct(day)),
        message: sedemDayMessage(visibleHours(day.hourly), th, windows.length > 0, voice),
    };
}

/**
 * Graf dňa z kroku 3 (day-chart.js): predpoveď dňa, pri dnešku nameraná krivka a „teraz“,
 * hranica veľkých spotrebičov, pás plánu s legendou a popis pre čítačku.
 * @param {SedemData} input @param {ForecastDay} day @param {import('./day-plan.js').PlanSlot[]} plan @param {number | null} nowMin
 */
function chartOf(input, day, plan, nowMin) {
    const curve = nowMin !== null && input.pv ? input.pv.realCurveToday : [];
    const hourly = nowMin !== null ? input.forecast.hourlyToday : day.hourly;
    const nowKw = nowMin === null ? NaN : dayKwAt(nowMin, curve, hourly, nowMin);
    const tone = (/** @type {number} */ min) => slotTone(plan[Math.floor(min / plan[0].min)]);
    const windows = (/** @type {import('./day-chart.js').Tone} */ t) => planWindows(plan, (s) => slotTone(s) === t);
    return {
        ...dayChartModel({
            plan,
            hourly,
            real: curve,
            boundary: nowMin === null ? null : realCurveBoundary(curve, nowMin),
            nowMin,
            nowKw,
            limitKw: powerThresholds(input.plant).lowKw,
            limitText: voiceTexts().TERAZ_TEXTS.limit,
            preview: null,
        }),
        legend: planLegend(planCells(plan)),
        desc: dayChartText({
            now: nowMin === null ? null : { min: nowMin, kwText: Number.isFinite(nowKw) ? fmt1(nowKw) : '–', tone: tone(nowMin) },
            sun: windows('sun'),
            cheap: windows('cheap'),
            costly: windows('costly'),
        }),
    };
}

/** Rozmery stĺpcov týždňa (viewBox) podľa návrhu: stĺpce od `top` po `base`, pod nimi mená dní. */
export const WEEK_BARS = { w: 320, h: 122, left: 10, right: 310, base: 100, height: 80, labelY: 116 };

/** Rozmery mapy hodina × deň (viewBox): vľavo mená dní, hore hodiny, riadok na deň. */
export const WEEK_HEAT = { w: 320, padL: 46, top: 18, rowH: 15, gap: 2 };

/**
 * Detail týždňa: rozsah dátumov, tri čísla (kWh spolu, na deň, najlepší deň - tie isté ako
 * súhrn karty 7 dní súčasnej appky), stĺpce dní, mapa hodina × deň, popisy pre čítačku
 * a hláška o najsilnejšom dni (weekMessage).
 * @param {SedemData} input @param {import('./messages.js').Voice} [voice]
 */
export function sedemWeekModel(input, voice = 'drzy') {
    const SEDEM_TEXTS = voiceTexts(voice).SEDEM_TEXTS;
    const days = input.forecast.days;
    const stats = weekStatsModel(days, input.pv, input.forecast.tomorrowSunny);
    const best = bestDayIndex(days);
    const list = weekListModel(days, -1);
    const typical = input.known === 'poloha' ? ` · ${SEDEM_TEXTS.typical}` : '';
    const heat = heatOf(input, days);
    return {
        range: sedemRangeText(days[0].date, days[days.length - 1].date) + typical,
        nums: [
            { value: fmtSum(Math.round(stats.totalKwh), 0), label: SEDEM_TEXTS.kwhSum },
            { value: fmt1(stats.avgKwh), label: SEDEM_TEXTS.kwhAvg },
            { value: stats.best.label, label: SEDEM_TEXTS.best },
        ],
        bars: barsOf(days, list, best),
        barsText: sedemBarsText(
            list.map((r) => ({ name: r.name, kwh: r.kwh })),
            list[best].name,
        ),
        heat: heat.model,
        heatText: sedemHeatText(heat.green),
        message: weekMessage(days),
    };
}

/**
 * Stĺpce dní: výška podľa najlepšieho dňa, nad stĺpcom celé kWh, pod ním skratka dňa.
 * @param {ForecastDay[]} days @param {ReturnType<typeof weekListModel>} list @param {number} best
 */
function barsOf(days, list, best) {
    const B = WEEK_BARS;
    const slot = (B.right - B.left) / days.length;
    const w = r1(slot - 8);
    const max = days[best].kwhTotal;
    return days.map((d, i) => {
        const h = r1(max > 0 ? (d.kwhTotal / max) * B.height : 0);
        const x = r1(B.left + i * slot + 4);
        return {
            x,
            y: r1(B.base - h),
            w,
            h,
            cx: r1(x + w / 2),
            best: i === best,
            value: String(list[i].kwh),
            name: weekDayShort(d.date, i),
        };
    });
}

/**
 * Mapa hodina × deň: políčko na hodinu produkčného okna (WEEK_HOURS). Zelené, keď v tú hodinu
 * slnko stačí na veľké spotrebiče (dayHourTiers, tá istá logika ako plán dňa), inak biele;
 * sýtosť podľa výkonu voči najsilnejšej hodine týždňa.
 * @param {SedemData} input @param {ForecastDay[]} days
 */
function heatOf(input, days) {
    const H = WEEK_HEAT;
    const cw = (H.w - H.padL) / WEEK_HOURS.length;
    const kwAt = days.map((d) => new Map(d.hourly.map((p) => [p.hour, p.kw])));
    const max = Math.max(0.4, ...kwAt.flatMap((m) => WEEK_HOURS.map((h) => m.get(h) ?? 0)));
    const tiers = days.map((d) => {
        const t = dayHourTiers(d, input.tariff, input.plant);
        return new Map(d.hourly.map((p, i) => [p.hour, t[i]]));
    });
    const green = days.map((d, r) => ({ name: weekDayName(d.date, r), hours: WEEK_HOURS.filter((h) => tiers[r].get(h) === 'green') }));
    const cells = days.flatMap((_, r) =>
        WEEK_HOURS.map((h, c) => {
            const f = (kwAt[r].get(h) ?? 0) / max;
            const sun = tiers[r].get(h) === 'green';
            return {
                x: r1(H.padL + c * cw),
                y: H.top + r * (H.rowH + H.gap),
                w: r1(cw - H.gap),
                h: H.rowH,
                sun,
                opacity: Math.round((sun ? 0.45 + 0.55 * f : 0.06 + 0.45 * f) * 100) / 100,
            };
        }),
    );
    return {
        green,
        model: {
            h: H.top + days.length * (H.rowH + H.gap),
            cells,
            hours: WEEK_HOURS.filter((h) => h % 3 === 0).map((h) => ({ x: r1(H.padL + (h - WEEK_HOURS[0]) * cw), label: String(h) })),
            days: days.map((d, r) => ({ y: H.top + r * (H.rowH + H.gap) + 11, label: weekDayShort(d.date, r) })),
        },
    };
}

/** @typedef {ReturnType<typeof sedemModel>} SedemModel */
/** @typedef {ReturnType<typeof sedemDayModel>} SedemDayModel */
/** @typedef {ReturnType<typeof sedemWeekModel>} SedemWeekModel */
