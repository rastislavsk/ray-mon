// Karta Teraz v novej appke „Živá obloha“ (obloha/). Nahrádza kartu Terazky súčasnej appky
// a počíta to isté: výkon, pásmo a odporúčanie z heroModel (aj náhľad iného času cez
// `previewMinutes`), plán dňa z dayPlan, krátke odpovede spotrebičov z deviceShorts. Tu sa to
// len skladá pre nový vzhľad - číslo, graf dňa s pásom plánu a pás odporúčaní. Čisté funkcie,
// čas aj dáta prichádzajú v parametroch. Texty sú v shared/messages.js.

import { interpolate, realCurveBoundary } from './chart-model.js';
import { installedKw, MOZEM_ITEMS, powerThresholds } from './config.js';
import { dayChartModel, planCells, planLegend, slotTone } from './day-chart.js';
import { dayPlan } from './day-plan.js';
import { weekDayName } from './format.js';
import { heroModel, pvFreshness } from './hero-model.js';
import {
    TERAZ_TEXTS,
    terazChartText,
    terazClearText,
    terazLaterText,
    terazPillText,
    terazPreviewText,
    terazSliderText,
    terazSourceText,
    terazTodayText,
    terazTypicalText,
    terazWindowText,
} from './messages.js';
import { deviceShorts, planWindows } from './mozem.js';
import { offlineLead, pvStatus } from './mozem-sky.js';
import { localDateKey } from './solar.js';

/**
 * @typedef {import('./day-plan.js').PlanInput & { kiosk: string, loading: boolean,
 *   known: import('./settings.js').Known, previewMinutes: number | null }} TerazInput
 * @typedef {import('./day-chart.js').Tone} Tone
 */

/**
 * Vstup pre výpočty karty. Meranie, ktoré mlčí (pvFreshness), už nie je výkon „teraz“: karta
 * vtedy ráta z krivky dňa (nameraná časť, potom predpoveď) a povie, že je to odhad. Plán dňa
 * aj odporúčania tak stoja na predpovedi, nie na čísle spred hodiny. Pri čerstvom meraní je
 * vstup nezmenený - karta ukazuje presne to, čo karta Terazky súčasnej appky.
 * @param {TerazInput} input
 */
export function terazInput(input) {
    const pv = input.pv;
    if (!pv || !pvFreshness({ now: input.now, pv, site: input.site }).stale) return input;
    return { ...input, pv: { ...pv, realTimePowerKw: null } };
}

/**
 * Model karty Teraz. `kind`: `ask` (appka nepozná polohu), `loading` (prvé načítanie),
 * `offline` (bez predpovede), `ok`. Pri známej polohe bez panelov (`known: 'poloha'`) karta
 * počíta s typickou strechou, ktorú má vo vstupe (typicalSettings), a priznáva to (`estimate`).
 * @param {TerazInput} input
 * @param {{ launches?: import('./launches.js').Launch[], online?: boolean }} [opts] zápisy „Pustil/a som“
 *   (krátke odpovede spotrebičov) a či má telefón internet (veta bez dát)
 */
export function terazModel(input, { launches = [], online = true } = {}) {
    const estimate = input.known === 'poloha';
    if (input.known === 'nic') return { ...empty('ask', estimate), ask: true };
    if (!input.forecast) {
        if (input.loading) return { ...empty('loading', estimate), sub: TERAZ_TEXTS.loading };
        return { ...empty('offline', estimate), num: '–', sub: offlineLead(input, online), retry: true };
    }
    const base = terazInput(input);
    const hero = heroModel(base);
    const now = base.previewMinutes === null ? hero : heroModel({ ...base, previewMinutes: null });
    const plan = dayPlan(base);
    return {
        ...empty('ok', estimate),
        ...headOf(input, base, hero, estimate),
        guess: estimate,
        chart: chartOf(base, plan, hero, now),
        hint: hero.preview ? { text: terazPreviewText(hero.minutes), reset: true } : { text: TERAZ_TEXTS.hint, reset: false },
        cards: cardsOf(base, plan, hero, now, launches),
    };
}

/**
 * Číslo a dva riadky pod ním: odkiaľ výkon je (a odkedy mlčí meranie) a koľko z jasnej oblohy.
 * Pri typickej streche „~“ a veta, že to nie je vlastná strecha.
 * @param {TerazInput} input pôvodný vstup @param {TerazInput} base vstup pre výpočty (terazInput)
 * @param {ReturnType<typeof heroModel>} hero @param {boolean} estimate
 */
function headOf(input, base, hero, estimate) {
    if (estimate) {
        const num = Number.isFinite(hero.power) ? `~${hero.powerText}` : hero.powerText;
        return { num, source: '', sub: terazTypicalText(installedKw(input.plant)) };
    }
    const pv = pvStatus(input);
    const silent = !hero.preview && !!input.kiosk && !pv.ok;
    return { num: hero.powerText, source: terazSourceText(hero.source, { silent, since: pv.since }), sub: clearSub(base, hero) };
}

/** Karta bez grafu a odporúčaní. @param {'ask' | 'loading' | 'offline' | 'ok'} kind @param {boolean} estimate */
function empty(kind, estimate) {
    return {
        kind,
        estimate,
        ask: false,
        num: '',
        source: '',
        sub: '',
        retry: false,
        guess: false,
        chart: /** @type {ReturnType<typeof chartOf> | null} */ (null),
        hint: { text: '', reset: false },
        cards: /** @type {ReturnType<typeof cardsOf> | null} */ (null),
    };
}

/**
 * Veta pod číslom: koľko z jasnej oblohy v tej chvíli. Jasná obloha je bezoblačný strop
 * predpovede dneška (`clearKw`), ten istý, z ktorého počíta percento využitia karta 7 dní.
 * V noci (plán dňa: slnko pod obzorom) ani strop nie je, je len veta o obzore.
 * @param {TerazInput} input @param {ReturnType<typeof heroModel>} hero
 */
function clearSub(input, hero) {
    const today = todayOf(input);
    const clear = today ? interpolate(today.hourly, hero.minutes / 60, 'clearKw') : 0;
    if (hero.isNight || !(clear > 0)) return TERAZ_TEXTS.night;
    if (!Number.isFinite(hero.power)) return '';
    return terazClearText(Math.min(100, Math.round((100 * hero.power) / clear)));
}

/** Dnešok v predpovedi, alebo null, keď predpoveď začína iným dňom (po polnoci pred obnovou). @param {import('./day-plan.js').PlanInput} input */
export function todayOf(input) {
    const day = input.forecast ? input.forecast.days[0] : null;
    return day && day.date === localDateKey(input.now, input.site.timezone) ? day : null;
}

/**
 * Graf dňa: geometria, popis pre čítačku a hodnota posúvača (čas, výkon, čo vtedy platí).
 * @param {TerazInput} input @param {import('./day-plan.js').PlanSlot[]} plan
 * @param {ReturnType<typeof heroModel>} hero zvolený čas (náhľad, inak teraz) @param {ReturnType<typeof heroModel>} now teraz
 */
function chartOf(input, plan, hero, now) {
    const tone = (/** @type {number} */ min) => slotTone(plan[Math.floor(min / plan[0].min)]);
    const curve = input.pv ? input.pv.realCurveToday : [];
    const geo = dayChartModel({
        plan,
        hourly: input.forecast ? input.forecast.hourlyToday : [],
        real: curve,
        boundary: realCurveBoundary(curve, now.minutes),
        nowMin: now.minutes,
        nowKw: now.power,
        limitKw: powerThresholds(input.plant).lowKw,
        preview: hero.preview
            ? { min: hero.minutes, kw: hero.power, text: terazPillText(hero.minutes, hero.power, tone(hero.minutes)) }
            : null,
    });
    const windows = (/** @type {Tone} */ t) => planWindows(plan, (s) => slotTone(s) === t);
    return {
        ...geo,
        limitText: TERAZ_TEXTS.limit,
        desc: terazChartText({
            nowMin: now.minutes,
            kwText: now.powerText,
            tone: tone(now.minutes),
            sun: windows('sun'),
            cheap: windows('cheap'),
            costly: windows('costly'),
        }),
        value: hero.minutes,
        valueText: terazSliderText(hero.minutes, hero.preview, hero.powerText, tone(hero.minutes)),
        legend: planLegend(planCells(plan)),
    };
}

/**
 * Pás odporúčaní: to isté, čo pás pod ciferníkom v súčasnej appke - odporúčanie pre zvolený
 * čas, spotrebiče s krátkymi odpoveďami karty Môžem?, dnešok a kedy bude lepšie.
 * @param {TerazInput} input @param {import('./day-plan.js').PlanSlot[]} plan
 * @param {ReturnType<typeof heroModel>} hero @param {ReturnType<typeof heroModel>} now
 * @param {import('./launches.js').Launch[]} launches
 */
function cardsOf(input, plan, hero, now, launches) {
    const shorts = deviceShorts(input, launches);
    return {
        now: { head: hero.message.headline, body: hero.message.body },
        devices: MOZEM_ITEMS.filter((it) => it.device && shorts[it.device]).map((it) => ({
            name: /** @type {string} */ (it.device),
            short: shorts[/** @type {string} */ (it.device)],
        })),
        today: todayCard(input, plan, now.minutes),
        later: laterCard(input, now),
    };
}

/**
 * Karta Dnešok: predpoveď dňa, koľko už nabehlo (z kiosku, bez neho podľa predpovede) a okno
 * na veľké veci - zelený úsek plánu, ten istý ako na páse a na karte Môžem? (prebieha, príde,
 * alebo posledný, ktorý už bol). Riadok o predpovedi a o tom, čo už nabehlo, ukazuje aj detail
 * dneška na karte 7 dní.
 * @param {import('./day-plan.js').PlanInput} input @param {import('./day-plan.js').PlanSlot[]} plan @param {number} nowMin
 */
export function todayCard(input, plan, nowMin) {
    const windows = planWindows(plan, (s) => s.tier === 'green');
    const ahead = windows.find((w) => w.to > nowMin) || null;
    const window = ahead || windows[windows.length - 1] || null;
    const day = todayOf(input);
    const kwh = input.pv ? input.pv.dailyEnergyKwh : null;
    const measured = kwh !== null && Number.isFinite(kwh);
    const done = measured ? /** @type {number} */ (kwh) : day ? soFar(day.hourly, nowMin) : 0;
    return {
        line: day ? terazTodayText({ forecastKwh: day.kwhTotal, doneKwh: done, measured }) : '',
        pct: day && day.kwhTotal > 0 ? Math.min(100, Math.round((100 * done) / day.kwhTotal)) : null,
        window: terazWindowText(window, !ahead && !!window),
    };
}

/**
 * Koľko z predpovede dneška už nabehlo. Hodnota hodiny je výkon v jej celú hodinu, a tak
 * zastupuje polhodinu pred ňou aj po nej - súčet celého dňa je potom presne `kwhTotal`.
 * @param {Array<{ hour: number, kw: number }>} hourly @param {number} nowMin
 */
function soFar(hourly, nowMin) {
    return hourly.reduce((sum, p) => sum + p.kw * Math.max(0, Math.min(1, (nowMin - (p.hour * 60 - 30)) / 60)), 0);
}

/**
 * Karta Kedy lepšie: ešte dnes (waitTime z heroModel, ako „Lepšie bude o“ v súčasnej appke)
 * a najbližší silný deň - špička aspoň po hornú hranicu výkonu, tú istú, od ktorej predpoveď
 * hlási „zajtra slnečno“.
 * @param {TerazInput} input @param {ReturnType<typeof heroModel>} now
 */
function laterCard(input, now) {
    const th = powerThresholds(input.plant);
    const days = input.forecast ? input.forecast.days : [];
    const today = todayOf(input);
    const nextIndex = days.findIndex((d, i) => i > 0 && d.peakKw >= th.highKw);
    const next = nextIndex > 0 ? { name: weekDayName(days[nextIndex].date, nextIndex), kwh: days[nextIndex].kwhTotal } : null;
    return terazLaterText({ wait: now.waitTime, todayStrong: !!today && today.peakKw >= th.highKw, next });
}

/** @typedef {ReturnType<typeof terazModel>} TerazModel */
