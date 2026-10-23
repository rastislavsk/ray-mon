// Karta Teraz v novej appke „Živá obloha“ (obloha/) a karta Terazky súčasnej appky - obe majú to
// isté rozloženie, každá vo vlastných farbách. Výkon, pásmo a odporúčanie sú z heroModel (aj náhľad
// iného času cez `previewMinutes`), plán dňa z dayPlan, krátke odpovede spotrebičov z deviceShorts.
// Tu sa to len skladá - číslo, graf dňa s pásom plánu a pás odporúčaní. Čisté funkcie,
// čas aj dáta prichádzajú v parametroch. Texty sú v shared/messages.js.

import { interpolate, realCurveBoundary } from './chart-model.js';
import { installedKw, MOZEM_ITEMS, powerThresholds } from './config.js';
import { chartLegend, dayChartModel, planCells, slotTone } from './day-chart.js';
import { dayPlan } from './day-plan.js';
import { weekDayName } from './format.js';
import { heroModel } from './hero-model.js';
import {
    terazChartText,
    terazClearText,
    terazLaterText,
    terazNoteText,
    terazPreviewTime,
    terazPreviewTitle,
    terazSliderText,
    terazSourceText,
    terazTodayText,
    terazTypicalText,
    terazWindowText,
    voiceTexts,
} from './messages-core.js';
import { deviceShorts, planWindows } from './mozem.js';
import { offlineLead, pvStatus } from './mozem-sky.js';
import { pristupModel } from './pristup.js';
import { localDateKey } from './solar.js';

/**
 * @typedef {import('./day-plan.js').PlanInput & { zdroj: unknown, loading: boolean,
 *   known: import('./settings.js').Known, previewMinutes: number | null,
 *   pristup?: import('./pristup.js').Odmietnutie | null }} TerazInput
 * @typedef {import('./day-chart.js').Tone} Tone
 */

/**
 * Model karty Teraz. `kind`: `ask` (appka nepozná polohu), `loading` (prvé načítanie),
 * `offline` (bez predpovede), `ok`. Pri známej polohe bez panelov (`known: 'poloha'`) karta
 * počíta s typickou strechou, ktorú má vo vstupe (typicalSettings), a priznáva to (`estimate`).
 * @param {TerazInput} input
 * @param {{ online?: boolean, voice?: import('./messages.js').Voice }} [opts]
 *   či má telefón internet (veta bez dát) a tón hlášok
 */
export function terazModel(input, { online = true, voice = 'drzy' } = {}) {
    const TERAZ_TEXTS = voiceTexts(voice).TERAZ_TEXTS;
    const estimate = input.known === 'poloha';
    if (input.known === 'nic') return { ...empty('ask', estimate), ask: true };
    if (!input.forecast) {
        if (input.loading) return { ...empty('loading', estimate), sub: TERAZ_TEXTS.loading };
        return { ...empty('offline', estimate), num: '–', sub: offlineLead(input, online, voice), retry: true };
    }
    // Meranie, ktoré mlčí, heroModel za výkon „teraz“ nepovažuje (freshPowerKw) - číslo je vtedy
    // odhad z krivky dňa a riadok pod ním povie, odkedy meranie mlčí.
    const hero = heroModel(input, voice);
    const now = input.previewMinutes === null ? hero : heroModel({ ...input, previewMinutes: null }, voice);
    const plan = dayPlan(input);
    const note = estimate ? null : noteOf(input, now, voice);
    return {
        ...empty('ok', estimate),
        ...headOf(input, hero, { estimate, note, voice }),
        note,
        guess: estimate,
        chart: chartOf(input, plan, hero, now, voice),
        // Čas náhľadu je v grafe pri čiare, pod grafom ostáva len tlačidlo „Späť na teraz“.
        hint: hero.preview ? { text: '', reset: true } : { text: TERAZ_TEXTS.hint, reset: false },
        cards: cardsOf(input, plan, hero, now),
    };
}

/**
 * Nadpis, číslo a dva riadky pod ním: odkiaľ výkon je a koľko z jasnej oblohy. Pri typickej
 * streche „~“ a veta, že to nie je vlastná strecha. Počas náhľadu nadpis namiesto „Teraz“ povie
 * čas, ku ktorému číslo patrí - text sa mení, riadok ostáva, aby sa graf pod prstom nepohol.
 * Keď je pod číslom pás odhadu (`note`), riadok „odhad z predpovede“ by ho len opakoval.
 * @param {TerazInput} input @param {ReturnType<typeof heroModel>} hero
 * @param {{ estimate: boolean, note: ReturnType<typeof noteOf>, voice: import('./messages.js').Voice }} o
 */
function headOf(input, hero, { estimate, note, voice }) {
    const title = hero.preview ? terazPreviewTitle(hero.minutes) : voiceTexts(voice).TERAZ_TEXTS.title;
    if (estimate) {
        const num = Number.isFinite(hero.power) ? `~${hero.powerText}` : hero.powerText;
        return { title, num, source: '', sub: terazTypicalText(installedKw(input.plant), voice) };
    }
    const source = !hero.source || (note && hero.source === 'forecast') ? '' : terazSourceText(hero.source);
    return { title, num: hero.powerText, source, sub: clearSub(input, hero) };
}

/**
 * Pás pod číslom, keď appka teraz nemá údaje z meniča a číslo je odhad z predpovede: bez merania
 * vedie k jeho pripojeniu, pri odmietnutom prístupe povie prečo a vedie k oprave
 * (shared/pristup.js), keď meranie mlčí, povie odkedy. Rozhoduje výkon teraz, nie náhľad - pás
 * počas ťahania po grafe ostáva, aby sa graf pod prstom nepohol. Inak null. `btn` je text
 * tlačidla, prázdny bez tlačidla; `znova`: tlačidlo vedie k opätovnému pripojeniu, nie k prvému.
 * @param {TerazInput} input @param {ReturnType<typeof heroModel>} now
 * @param {import('./messages.js').Voice} voice
 */
function noteOf(input, now, voice) {
    if (now.source !== 'forecast') return null;
    const T = voiceTexts(voice).TERAZ_TEXTS;
    if (!input.zdroj) return { title: T.noteTitle, text: T.noteText, btn: T.noteBtn, znova: false };
    const zdroj = /** @type {import('./zdroje.js').Zdroj} */ (input.zdroj);
    const p = pristupModel({ zdroj, pristup: input.pristup ?? null, now: input.now, timezone: input.site.timezone });
    const riadok = p && p.druh === 'neplati' ? p.riadok : '';
    const text = terazNoteText({ since: pvStatus(input).since, riadok }, voice);
    return { title: T.noteTitle, text, btn: riadok ? T.noteAgainBtn : '', znova: !!riadok };
}

/** Karta bez grafu a odporúčaní. @param {'ask' | 'loading' | 'offline' | 'ok'} kind @param {boolean} estimate */
function empty(kind, estimate) {
    return {
        kind,
        estimate,
        ask: false,
        title: voiceTexts().TERAZ_TEXTS.title,
        num: '',
        source: '',
        sub: '',
        note: /** @type {ReturnType<typeof noteOf>} */ (null),
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
    if (hero.isNight || !(clear > 0)) return voiceTexts().TERAZ_TEXTS.night;
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
 * @param {import('./messages.js').Voice} voice
 */
function chartOf(input, plan, hero, now, voice) {
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
        limitText: voiceTexts().TERAZ_TEXTS.limit,
        preview: hero.preview ? { min: hero.minutes, kw: hero.power, text: terazPreviewTime(hero.minutes) } : null,
        voice,
    });
    const windows = (/** @type {Tone} */ t) => planWindows(plan, (s) => slotTone(s) === t);
    return {
        ...geo,
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
        legend: chartLegend(planCells(plan)),
    };
}

/**
 * Pás odporúčaní: odporúčanie pre zvolený čas, spotrebiče s krátkymi odpoveďami karty Môžem?, dnešok a kedy bude lepšie.
 * @param {TerazInput} input @param {import('./day-plan.js').PlanSlot[]} plan
 * @param {ReturnType<typeof heroModel>} hero @param {ReturnType<typeof heroModel>} now
 */
function cardsOf(input, plan, hero, now) {
    const shorts = deviceShorts(input);
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
 * Karta Kedy lepšie: ešte dnes (waitTime z heroModel)
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
