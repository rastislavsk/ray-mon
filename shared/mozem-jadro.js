// Výpočty dňa, na ktorých stojí karta Môžem? (shared/mozem.js) aj Plán dňa (shared/plan-dna.js):
// okná so slnkom, kontext dňa a odpoveď pre jednu vec. Čisté funkcie bez DOM. Sú zvlášť od modelu
// karty, aby Plán dňa a trieda dňa nemuseli importovať kartu, ktorá importuje ich.

import { DEVICES, EVERYDAY, HOUSE_BASE_KW, powerThresholds, TARIFF_LIMITS } from './config.js';
import { dayPlan } from './day-plan.js';
import { weekDayName } from './format.js';
import { daylightSpan, localDateKey, localMinutes } from './solar.js';
import { bandAt, scheduleFor } from './tariff.js';

/** @typedef {(typeof import('./config.js').MOZEM_ITEMS)[number]} MozemItem */
/** @typedef {import('./day-plan.js').PlanSlot} PlanSlot */
/** @typedef {import('./day-plan.js').PlanInput} PlanInput */
/** @typedef {import('./messages.js').Voice} Voice */
/** @typedef {{ from: number, to: number }} Window úsek dňa v minútach od polnoci, `to` je bez neho */
/**
 * Najbližší iný deň, keď slnko stačí: meno pre text („Zajtra“, „Pondelok“), poradie v predpovedi
 * (1 = zajtra) a kedy začína.
 * @typedef {{ name: string, date: string, index: number, start: number }} LaterDay
 */
/**
 * Odpoveď pre jednu vec. Pri `go` je `until` posledný štart, pri ktorom ťažké úseky programu
 * (`heat` v MOZEM_ITEMS) ešte chytia slnko, a `share` podiel energie programu pusteného teraz,
 * ktorý pokryje strecha (pri aute null).
 * @typedef {{ kind: 'go', end: number, until: number, km: number | null, share: number | null }
 *   | { kind: 'wait', start: number }
 *   | { kind: 'cheap', next: LaterDay | null }
 *   | { kind: 'later', day: LaterDay, weakSkipped: boolean }
 *   | { kind: 'none' } | { kind: 'unk' }} Answer
 */
/**
 * Čo o dni vie celá karta - vstup pre texty.
 * `span` je deň so slnkom (daylightSpan) - os pásu dňa, tá istá ako os grafu dňa na karte Teraz.
 * @typedef {{ nowMin: number, span: import('./solar.js').Span, plan: PlanSlot[], th: import('./config.js').PowerThresholds, draha: boolean,
 *   cheap: boolean, price: number | null, currency: string, weakToday: boolean,
 *   later: Array<{ day: import('./solar.js').ForecastDay, index: number }> }} DayCtx
 */

const SLOT_H = TARIFF_LIMITS.stepMin / 60;
/** Najmenší podiel programu zo slnka, pri ktorom karta ešte povie „teraz“. */
const MIN_SUN_SHARE = 0.5;

/**
 * Súvislé úseky plánu dňa, v ktorých platí podmienka.
 * @param {PlanSlot[]} plan @param {(s: PlanSlot) => boolean} ok @returns {Window[]}
 */
export function planWindows(plan, ok) {
    /** @type {Window[]} */ const out = [];
    for (const s of plan) {
        if (!ok(s)) continue;
        const last = out[out.length - 1];
        if (last && last.to === s.startMin) last.to += s.min;
        else out.push({ from: s.startMin, to: s.startMin + s.min });
    }
    return out;
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
 * Kedy iný deň slnko stačí: od prvej po poslednú hodinu predpovede nad hranicou výkonu.
 * @param {import('./solar.js').ForecastDay} day @param {number} minKw @returns {Window | null}
 */
export function dayWindow(day, minKw) {
    const hours = day.hourly.filter((p) => p.kw >= minKw).map((p) => p.hour);
    return hours.length ? { from: Math.min(...hours) * 60, to: Math.max(...hours) * 60 } : null;
}

/** Spotrebič z DEVICES k veci karty. @param {string | null} name */
const deviceOf = (name) => DEVICES.find((d) => d.name === name) || null;

/**
 * Najbližší iný deň, keď slnko spotrebič pokryje. Slabý deň preskočí spotrebiče, ktoré sa
 * v slabý deň neodporúčajú (weakDay v DEVICES).
 * @param {DayCtx} ctx @param {number} minKw @param {boolean} weakOk
 * @returns {{ day: LaterDay | null, weakSkipped: boolean }}
 */
export function laterDay(ctx, minKw, weakOk) {
    let weakSkipped = false;
    for (const { day, index } of ctx.later) {
        if (!weakOk && day.peakKw < ctx.th.weakPeakKw) {
            weakSkipped = true;
            continue;
        }
        const w = dayWindow(day, minKw);
        if (w) return { day: { name: weekDayName(day.date, index), date: day.date, index, start: w.from }, weakSkipped };
    }
    return { day: null, weakSkipped };
}

/**
 * Koľko km auto chytí zo slnka od teraz do konca okna: výkon plánu, najviac príkon nabíjačky.
 * @param {DayCtx} ctx @param {number} end @param {number} powerKw
 */
export function kmFromSun(ctx, end, powerKw) {
    const kwh = ctx.plan
        .filter((s) => s.startMin + s.min > ctx.nowMin && s.startMin < end && Number.isFinite(s.kw))
        .reduce((sum, s) => sum + Math.min(Math.max(0, s.kw - HOUSE_BASE_KW), powerKw) * SLOT_H, 0);
    return kmOf(kwh);
}

/** Km z energie pre auto, zaokrúhlené nadol na desiatky. @param {number} kwh */
export const kmOf = (kwh) => Math.floor((kwh * EVERYDAY.evKmPerKwh) / 10) * 10;

/**
 * Odber programu po minútach od štartu: ťažké úseky (`heat`) berú plný príkon, zvyšok `runKwh`
 * sa rozloží rovnomerne na ostatný čas.
 * @param {MozemItem} item @param {number} powerKw
 * @returns {Array<{ heavy: boolean, kw: number }>}
 */
export function programDraw(item, powerKw) {
    const runMin = item.runMin ?? 0;
    const heat = item.heat ?? [[0, runMin]];
    const heavyMin = heat.reduce((sum, [from, to]) => sum + to - from, 0);
    const lightMin = runMin - heavyMin;
    const lightKw = lightMin > 0 ? Math.max(0, (item.runKwh ?? 0) - (powerKw * heavyMin) / 60) / (lightMin / 60) : 0;
    return Array.from({ length: runMin }, (_, m) => {
        const heavy = heat.some(([from, to]) => m >= from && m < to);
        return { heavy, kw: heavy ? powerKw : lightKw };
    });
}

/**
 * Výkon, ktorý v minúte dňa ostáva spotrebičom: výroba z plánu dňa bez spotreby domu.
 * Mimo plánu alebo bez údaja 0.
 * @param {DayCtx} ctx @param {number} m
 */
export function freeKw(ctx, m) {
    const slot = ctx.plan[Math.floor(m / TARIFF_LIMITS.stepMin)];
    return slot && Number.isFinite(slot.kw) ? Math.max(0, slot.kw - HOUSE_BASE_KW) : 0;
}

/**
 * Od akej výroby slnko spotrebič utiahne: nad spotrebou domu musí ostať jeho príkon, pri aute
 * silné slnko (highKw) - nabíjačka pod ním ťahá zo siete.
 * @param {MozemItem} item @param {(typeof DEVICES)[number]} device @param {DayCtx} ctx
 */
export const sunMinKw = (item, device, ctx) => (item.runMin === null ? ctx.th.highKw : device.powerKw) + HOUSE_BASE_KW;

/**
 * Odpoveď pre spotrebič: teraz áno, neskôr dnes, lacno zo siete, iný deň, alebo nie.
 * Neskoršie slnko ešte dnes vyhrá nad lacnou sieťou - teraz by sa platilo, potom nie.
 * @param {MozemItem} item @param {DayCtx} ctx @returns {Answer}
 */
export function itemAnswer(item, ctx) {
    const device = deviceOf(item.device);
    if (!device) return { kind: 'unk' };
    const minKw = sunMinKw(item, device, ctx);
    const usable = device.weakDay || !ctx.weakToday;
    const today = usable ? todayAnswer(item, device.powerKw, minKw, ctx) : null;
    if (today) return today;
    const later = laterDay(ctx, minKw, device.weakDay);
    if (device.cheapGrid && ctx.cheap) return { kind: 'cheap', next: later.day };
    return later.day ? { kind: 'later', day: later.day, weakSkipped: later.weakSkipped || !usable } : { kind: 'none' };
}

/** Koniec posledného ťažkého úseku programu v minútach od štartu. @param {MozemItem} item */
const heatEnd = (item) => Math.max(...(item.heat ?? [[0, item.runMin ?? 0]]).map(([, to]) => to));

/**
 * Koľko energie programu pusteného o `start` pokryje strecha (0 až 1): minúta sa ráta, keď
 * výroba nad spotrebou domu pokryje celý odber programu v nej (programDraw). Po konci plánu dňa
 * už slnko nie je.
 * @param {MozemItem} item @param {number} powerKw @param {DayCtx} ctx @param {number} start
 */
export function sunShare(item, powerKw, ctx, start) {
    let sun = 0;
    let all = 0;
    programDraw(item, powerKw).forEach(({ kw }, m) => {
        all += kw;
        if (freeKw(ctx, start + m) >= kw) sun += kw;
    });
    return all > 0 ? sun / all : 1;
}

/**
 * Odpoveď z dnešného plánu: slnko stačí teraz, alebo príde ešte dnes. Inak null.
 * @param {MozemItem} item @param {number} powerKw @param {number} minKw @param {DayCtx} ctx
 * @returns {Answer | null}
 */
function todayAnswer(item, powerKw, minKw, ctx) {
    const windows = planWindows(ctx.plan, (s) => Number.isFinite(s.kw) && s.kw >= minKw);
    const cur = windows.find((w) => w.from <= ctx.nowMin && ctx.nowMin < w.to);
    if (cur) {
        if (item.runMin === null) return { kind: 'go', end: cur.to, until: cur.to, km: kmFromSun(ctx, cur.to, powerKw), share: null };
        const share = sunShare(item, powerKw, ctx, ctx.nowMin);
        // Keď by strecha nepokryla ani polovicu, „áno“ by klamalo - odpovedá iný deň alebo lacná sieť.
        if (share < MIN_SUN_SHARE) return null;
        return { kind: 'go', end: cur.to, until: cur.to - heatEnd(item), km: null, share };
    }
    const next = windows.find((w) => w.from > ctx.nowMin);
    return next ? { kind: 'wait', start: next.from } : null;
}

/** Cena behu zo siete teraz, alebo null bez ceny. @param {MozemItem} item @param {DayCtx} ctx */
export function itemCost(item, ctx) {
    const device = deviceOf(item.device);
    if (!device || ctx.price === null) return null;
    return (item.runKwh ?? device.powerKw) * ctx.price;
}

/**
 * Kontext dňa pre odpovede a texty.
 * @param {PlanInput} input @returns {DayCtx}
 */
export function dayCtx(input) {
    const { now, site, tariff, forecast } = input;
    const nowMin = localMinutes(now, site.timezone);
    const today = localDateKey(now, site.timezone);
    const band = bandAt(tariff, scheduleFor(tariff, today), nowMin);
    const days = forecast ? forecast.days : [];
    const th = powerThresholds(input.plant);
    return {
        nowMin,
        span: daylightSpan(site, today),
        plan: dayPlan(input),
        th,
        draha: band.level === 'draha',
        cheap: band.level === 'lacna',
        price: band.price,
        currency: tariff.currency,
        weakToday: !!days[0] && days[0].date === today && days[0].peakKw < th.weakPeakKw,
        later: days.map((day, index) => ({ day, index })).filter((x) => x.day.date > today),
    };
}
