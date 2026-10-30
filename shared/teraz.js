// Karta Teraz v novej appke „Živá obloha“ (obloha/) a karta Teraz súčasnej appky - obe majú to
// isté rozloženie, každá vo vlastných farbách. Výkon, pásmo a odporúčanie sú z heroModel (aj náhľad
// iného času cez `previewMinutes`), plán dňa z dayPlan, odpoveď teraz a Plán dňa z mozemModel - tie isté
// ako na karte Dnes. Tu sa to len skladá - číslo, štítky s vetou, Plán dňa a graf dňa s pásom plánu.
// Dnešok a kedy lepšie (dnesCards) berie karta Dnes (shared/dnes-faza.js). Čisté funkcie,
// čas aj dáta prichádzajú v parametroch. Texty sú v shared/messages.js.

import { interpolate, realCurveBoundary } from './chart-model.js';
import { installedKw, powerThresholds } from './config.js';
import { chartKeys, dayChartModel, planCells, planLegend, slotTone } from './day-chart.js';
import { dayPlan } from './day-plan.js';
import { weekDayName } from './format.js';
import { heroModel } from './hero-model.js';
import {
    DAY_CHART_KEYS,
    terazBandNext,
    terazBandText,
    terazChartText,
    terazClearText,
    terazCloudText,
    terazKwText,
    terazLaterText,
    terazLimitFrom,
    terazLimitGap,
    terazNoteText,
    terazPreviewTime,
    terazPreviewTitle,
    terazReadoutWhen,
    terazSliderText,
    terazSourceText,
    terazTodayText,
    terazTypicalText,
    terazWindowText,
    voiceTexts,
} from './messages-core.js';
import { mozemModel, planWindows } from './mozem.js';
import { offlineLead, pvStatus } from './mozem-sky.js';
import { pristupModel } from './pristup.js';
import { daylightSpan, localDateKey } from './solar.js';

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
 * @param {{ online?: boolean, voice?: import('./messages.js').Voice, devices?: readonly string[] }} [opts]
 *   či má telefón internet (veta bez dát), tón hlášok a spotrebiče doma (s nimi ráta Plán dňa)
 */
export function terazModel(input, { online = true, voice = 'drzy', devices } = {}) {
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
    // Štítky a veta hovoria o teraz, nie o náhľade - pod prstom sa nemenia, aby sa graf nepohol.
    const m = mozemModel(input, { voice, devices });
    return {
        ...empty('ok', estimate),
        ...headOf(input, hero, { estimate, note, voice }),
        note,
        guess: estimate,
        chart: chartOf(input, plan, hero, now),
        // Čas náhľadu je v grafe pri čiare, pod grafom ostáva len tlačidlo „Späť na teraz“.
        hint: hero.preview ? { text: '', reset: true } : { text: TERAZ_TEXTS.hint, reset: false },
        say: { chips: m.chips, text: m.say },
        plan: m.plan && m.planHead ? { ...m.plan, head: m.planHead } : null,
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
        say: /** @type {{ chips: import('./mozem.js').Chip[], text: string } | null} */ (null),
        plan: /** @type {(NonNullable<import('./mozem.js').MozemModelPlan> & { head: { lead: string, then: string } }) | null} */ (null),
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
 */
function chartOf(input, plan, hero, now) {
    const tone = (/** @type {number} */ min) => slotTone(plan[Math.floor(min / plan[0].min)]);
    const curve = input.pv ? input.pv.realCurveToday : [];
    const limitKw = powerThresholds(input.plant).lowKw;
    const span = daylightSpan(input.site, localDateKey(input.now, input.site.timezone));
    const geo = dayChartModel({
        span,
        plan,
        hourly: input.forecast ? input.forecast.hourlyToday : [],
        real: curve,
        boundary: realCurveBoundary(curve, now.minutes),
        nowMin: now.minutes,
        nowKw: now.power,
        limitKw,
        limitText: voiceTexts().TERAZ_TEXTS.limit,
        preview: hero.preview ? { min: hero.minutes, kw: hero.power, text: terazPreviewTime(hero.minutes) } : null,
    });
    const windows = (/** @type {Tone} */ t) => planWindows(plan, (s) => slotTone(s) === t);
    return {
        ...geo,
        desc: terazChartText({
            span,
            nowMin: now.minutes,
            kwText: now.powerText,
            tone: tone(now.minutes),
            sun: windows('sun'),
            cheap: windows('cheap'),
            costly: windows('costly'),
        }),
        // Hodnota posúvača ostáva v jeho rozsahu aj v noci, keď je „teraz“ mimo osi; čas povie valueText.
        value: Math.min(geo.range.max, Math.max(geo.range.min, hero.minutes)),
        valueText: terazSliderText(hero.minutes, hero.preview, hero.powerText, tone(hero.minutes)),
        // Zoznam pod grafom: zatvorený ukáže prvý riadok legendy (čiary a oblačnosť), otvorený pod ním
        // farby pásu a hodnoty vo zvolenom čase.
        keys: chartKeys(),
        bands: planLegend(planCells(plan, span)),
        readout: readoutOf(input, plan, hero, limitKw),
    };
}

/**
 * Hodnoty v čase, na ktorom je bod grafu (teraz, alebo náhľad): výkon ako veľké číslo, predpoveď
 * a oblačnosť tak, ako ich kreslí graf (čiara predpovede medzi hodinami, oblačnosť po celých
 * hodinách), odstup od hranice veľkých spotrebičov a úsek pásu plánu, v ktorom čas je.
 * `tone` je kľúč vzorky pre CSS appky (`data-tone`), ten istý ako v legende.
 * @param {TerazInput} input @param {import('./day-plan.js').PlanSlot[]} plan
 * @param {ReturnType<typeof heroModel>} hero @param {number} limitKw
 */
function readoutOf(input, plan, hero, limitKw) {
    const min = hero.minutes;
    const hourly = input.forecast ? input.forecast.hourlyToday : [];
    const forecastKw = hourly.length ? interpolate(hourly, min / 60, 'kw') : NaN;
    const hour = hourly.find((p) => p.hour === Math.floor(min / 60));
    const cloud = hour && Number.isFinite(hour.cloud) ? /** @type {number} */ (hour.cloud) : null;
    const step = plan[0].min;
    const tone = slotTone(plan[Math.floor(min / step)]);
    const span = /** @type {{ from: number, to: number }} */ (
        planWindows(plan, (s) => slotTone(s) === tone).find((w) => w.from <= min && min < w.to)
    );
    const after = plan[span.to / step];
    return {
        when: terazReadoutWhen(min, hero.preview),
        rows: [
            { tone: 'power', text: DAY_CHART_KEYS.power, sub: '', value: terazKwText(hero.power) },
            { tone: 'forecast', text: DAY_CHART_KEYS.forecast, sub: '', value: terazKwText(forecastKw) },
            { tone: 'cloud', text: DAY_CHART_KEYS.cloud, sub: '', value: terazCloudText(cloud) },
            {
                tone: 'limit',
                text: voiceTexts().TERAZ_TEXTS.limit,
                sub: terazLimitFrom(limitKw),
                value: terazLimitGap(hero.power, limitKw),
            },
            { tone, text: terazBandText(tone, span.to), sub: terazBandNext(after ? slotTone(after) : null), value: '' },
        ],
    };
}

/**
 * Dnešok (predpoveď, koľko už nabehlo, okno na veľké veci) a kedy bude lepšie - z toho skladá
 * kartu Dnes shared/dnes-faza.js. Bez predpovede null.
 * @param {TerazInput} input @param {import('./messages.js').Voice} [voice]
 */
export function dnesCards(input, voice = 'drzy') {
    if (!input.forecast) return null;
    const now = heroModel({ ...input, previewMinutes: null }, voice);
    return { today: todayCard(input, dayPlan(input), now.minutes), later: laterCard(input, now) };
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
        ...dayDone(day, done, measured),
        window: terazWindowText(window, !ahead && !!window),
    };
}

/**
 * Čo z predpovede dneška už nabehlo: čísla pre kartu Dnes cez deň (shared/dnes-faza.js) - predpoveď
 * dňa (null bez nej), nabehnuté a či je namerané -, riadok a percento pre pás. Bez predpovede na dnešok prázdne.
 * @param {import('./solar.js').ForecastDay | null} day @param {number} done @param {boolean} measured
 */
function dayDone(day, done, measured) {
    if (!day) return { forecastKwh: null, doneKwh: done, measured, line: '', pct: null };
    return {
        forecastKwh: day.kwhTotal,
        doneKwh: done,
        measured,
        line: terazTodayText({ forecastKwh: day.kwhTotal, doneKwh: done, measured }),
        pct: day.kwhTotal > 0 ? Math.min(100, Math.round((100 * done) / day.kwhTotal)) : null,
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
