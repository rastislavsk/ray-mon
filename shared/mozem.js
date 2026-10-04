// Karta Môžem?: jednoduchá odpoveď pre celú rodinu - môžem teraz zapnúť práčku, a keď nie,
// tak kedy. Čisté funkcie bez DOM. Stojí na pláne dňa (shared/day-plan.js), takže „áno“ tu
// je tá istá zelená ako na dennom prstenci ciferníka; ďalšie dni berie z predpovede.
// Texty skladá shared/messages.js, tu sa len počíta.

import { DEVICES, EVERYDAY, MOZEM_ITEMS, powerThresholds, TARIFF_LIMITS } from './config.js';
import { HOUR_RANGE } from './chart-model.js';
import { dayPlan } from './day-plan.js';
import { weekDayName } from './format.js';
import { canLog, monthCount, runMinOf, runningLaunch } from './launches.js';
import {
    mozemCountText,
    mozemGlanceText,
    mozemHeroText,
    mozemItemText,
    mozemLogLabel,
    mozemRunningShort,
    mozemStripText,
    voiceTexts,
} from './messages-core.js';
import { localDateKey, localMinutes, sunUp } from './solar.js';
import { bandAt, scheduleFor } from './tariff.js';

/** @typedef {import('./day-plan.js').PlanSlot} PlanSlot */
/** @typedef {import('./day-plan.js').PlanInput} PlanInput */
/** @typedef {import('./messages.js').Voice} Voice */
/** @typedef {{ from: number, to: number }} Window úsek dňa v minútach od polnoci, `to` je bez neho */
/** @typedef {'go' | 'wait' | 'slabo' | 'none' | 'offline' | 'loading' | 'bezpanelov'} MozemState */
/**
 * Najbližší iný deň, keď slnko stačí: meno pre text („Zajtra“, „Pondelok“), poradie v predpovedi
 * (1 = zajtra) a kedy začína.
 * @typedef {{ name: string, index: number, start: number }} LaterDay
 */
/**
 * Odpoveď pre jednu vec. `cost` je cena behu zo siete teraz (pri aute hodina nabíjania), null
 * bez ceny v tarife.
 * @typedef {{ kind: 'go', end: number, until: number, km: number | null }
 *   | { kind: 'wait', start: number }
 *   | { kind: 'cheap', next: LaterDay | null }
 *   | { kind: 'later', day: LaterDay, weakSkipped: boolean }
 *   | { kind: 'none' } | { kind: 'unk' } | { kind: 'always' }} Answer
 */
/**
 * Čo o dni vie celá karta - vstup pre texty.
 * @typedef {{ nowMin: number, plan: PlanSlot[], th: import('./config.js').PowerThresholds, draha: boolean,
 *   cheap: boolean, price: number | null, currency: string, weakToday: boolean,
 *   later: Array<{ day: import('./solar.js').ForecastDay, index: number }> }} DayCtx
 */

const SLOT_H = TARIFF_LIMITS.stepMin / 60;

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
 * v slabý deň neodporúčajú (weakDay v DEVICES) - rovnako ako deviceStates.
 * @param {DayCtx} ctx @param {number} minKw @param {boolean} weakOk
 * @returns {{ day: LaterDay | null, weakSkipped: boolean }}
 */
function laterDay(ctx, minKw, weakOk) {
    let weakSkipped = false;
    for (const { day, index } of ctx.later) {
        if (!weakOk && day.peakKw < ctx.th.weakPeakKw) {
            weakSkipped = true;
            continue;
        }
        const w = dayWindow(day, minKw);
        if (w) return { day: { name: weekDayName(day.date, index), index, start: w.from }, weakSkipped };
    }
    return { day: null, weakSkipped };
}

/**
 * Koľko km auto chytí zo slnka od teraz do konca okna: výkon plánu, najviac príkon nabíjačky.
 * @param {DayCtx} ctx @param {number} end @param {number} powerKw
 */
function kmFromSun(ctx, end, powerKw) {
    const kwh = ctx.plan
        .filter((s) => s.startMin + s.min > ctx.nowMin && s.startMin < end && Number.isFinite(s.kw))
        .reduce((sum, s) => sum + Math.min(s.kw, powerKw) * SLOT_H, 0);
    return Math.floor((kwh * EVERYDAY.evKmPerKwh) / 10) * 10;
}

/**
 * Odpoveď pre spotrebič: teraz áno, neskôr dnes, lacno zo siete, iný deň, alebo nie.
 * Neskoršie slnko ešte dnes vyhrá nad lacnou sieťou - teraz by sa platilo, potom nie.
 * @param {(typeof MOZEM_ITEMS)[number]} item @param {DayCtx} ctx @returns {Answer}
 */
export function itemAnswer(item, ctx) {
    const device = deviceOf(item.device);
    if (!device) return { kind: 'always' };
    const minKw = item.runMin === null ? ctx.th.highKw : ctx.th.lowKw;
    const usable = device.weakDay || !ctx.weakToday;
    const today = usable ? todayAnswer(item, device.powerKw, minKw, ctx) : null;
    if (today) return today;
    const later = laterDay(ctx, minKw, device.weakDay);
    if (device.cheapGrid && ctx.cheap) return { kind: 'cheap', next: later.day };
    return later.day ? { kind: 'later', day: later.day, weakSkipped: later.weakSkipped || !usable } : { kind: 'none' };
}

/**
 * Odpoveď z dnešného plánu: slnko stačí teraz, alebo príde ešte dnes. Inak null.
 * @param {(typeof MOZEM_ITEMS)[number]} item @param {number} powerKw @param {number} minKw @param {DayCtx} ctx
 * @returns {Answer | null}
 */
function todayAnswer(item, powerKw, minKw, ctx) {
    const windows = planWindows(ctx.plan, (s) => Number.isFinite(s.kw) && s.kw >= minKw);
    const cur = windows.find((w) => w.from <= ctx.nowMin && ctx.nowMin < w.to);
    if (cur) {
        if (item.runMin === null) return { kind: 'go', end: cur.to, until: cur.to, km: kmFromSun(ctx, cur.to, powerKw) };
        return { kind: 'go', end: cur.to, until: cur.to - item.runMin, km: null };
    }
    const next = windows.find((w) => w.from > ctx.nowMin);
    return next ? { kind: 'wait', start: next.from } : null;
}

/** Cena behu zo siete teraz, alebo null bez ceny. @param {(typeof MOZEM_ITEMS)[number]} item @param {DayCtx} ctx */
export function itemCost(item, ctx) {
    const device = deviceOf(item.device);
    if (!device || ctx.price === null) return null;
    return (item.runKwh ?? device.powerKw) * ctx.price;
}

/**
 * Poloha úseku a značky „teraz“ na páse dňa v percentách jeho šírky. Pás je produkčné okno
 * grafov (HOUR_RANGE), aby hovoril o tých istých hodinách ako karta 7 dní.
 * @param {Window | null} w @param {number} nowMin
 */
export function stripGeometry(w, nowMin) {
    const a = HOUR_RANGE.min * 60;
    const b = HOUR_RANGE.max * 60;
    const pct = (/** @type {number} */ m) => Math.round(Math.max(0, Math.min(1, (m - a) / (b - a))) * 1000) / 10;
    return { left: w ? pct(w.from) : 0, width: w ? Math.round((pct(w.to) - pct(w.from)) * 10) / 10 : 0, now: pct(nowMin) };
}

/** Deň od epochy - hláška sa tak mení každý deň aj bez ťukania. @param {string} dateKey */
const dayNumber = (dateKey) => Math.round(Date.parse(`${dateKey}T00:00:00Z`) / 86400000);

/**
 * Stav celej karty: zelená teraz, slnko príde ešte dnes, dnes vôbec (slabý deň), už nie.
 * @param {Window[]} windows @param {number} nowMin @param {boolean} sun
 * @returns {{ state: MozemState, window: Window | null }}
 */
function dayState(windows, nowMin, sun) {
    const cur = windows.find((w) => w.from <= nowMin && nowMin < w.to);
    if (cur) return { state: 'go', window: cur };
    const next = windows.find((w) => w.from > nowMin);
    if (next) return { state: 'wait', window: next };
    const last = windows.filter((w) => w.to <= nowMin).pop() || null;
    return { state: !last && sun ? 'slabo' : 'none', window: last };
}

/**
 * Kontext dňa pre odpovede a texty.
 * @param {PlanInput} input @returns {DayCtx}
 */
function dayCtx(input) {
    const { now, site, tariff, forecast } = input;
    const nowMin = localMinutes(now, site.timezone);
    const today = localDateKey(now, site.timezone);
    const band = bandAt(tariff, scheduleFor(tariff, today), nowMin);
    const days = forecast ? forecast.days : [];
    const th = powerThresholds(input.plant);
    return {
        nowMin,
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

/** Hlavička karty bez predpovede: panely nie sú zadané, načítava sa, alebo dáta nie sú.
 * @param {boolean} loading @param {boolean} noPanels @param {number} page @param {Voice} voice */
function emptyHead(loading, noPanels, page, voice) {
    /** @type {MozemState} */ const state = noPanels ? 'bezpanelov' : loading ? 'loading' : 'offline';
    return {
        state,
        word: voiceTexts(voice).MOZEM_WORDS[state],
        hero: mozemHeroText(state, null, voice),
        strip: null,
        ...quipsOf(state, 0, page, voice),
    };
}

/** @template T @param {T[]} list @param {number} i */
const pick = (list, i) => list[((i % list.length) + list.length) % list.length];

/**
 * Hlášky stavu ako pás na listovanie: sada otočená tak, že prvá je hláška dňa, a stránka, na
 * ktorej človek stojí (`quipPage`), s jej textom (`quip`).
 * @param {MozemState} state @param {number} day číslo dňa, podľa neho sa hlášky striedajú
 * @param {number} page stránka zo stavu appky; mimo sady sa točí dokola
 * @param {Voice} voice
 */
function quipsOf(state, day, page, voice) {
    const set = voiceTexts(voice).MOZEM_QUIPS[state];
    const quips = set.map((_, i) => pick(set, day + i));
    const quipPage = ((page % quips.length) + quips.length) % quips.length;
    return { quips, quipPage, quip: quips[quipPage] };
}

/**
 * Model karty Môžem?. `quipPage` je stránka v páse hlášok (0 = hláška dňa),
 * `launches` zápisy „Pustil/a som“ z tohto telefónu. `known`: čo appka o elektrárni vie
 * (bez neho uložená elektráreň). Bez zadaných panelov karta neodpovedá, aj keby predpoveď pre
 * typickú strechu mala - to je správanie súčasnej appky. Nová appka (obloha/) s `guess`
 * odpovedá pri známej polohe z typickej strechy, ktorú má vo vstupe (typicalSettings), a model
 * to priznáva v `estimate`.
 *
 * `facts` sú údaje dňa pre nový vzhľad (null bez odpovede): cena siete teraz, dnešné okno
 * so slnkom (to isté ako pás dneška), živý výkon (null bez merania) a výkon z plánu dňa.
 * @param {PlanInput & { loading: boolean, known?: import('./settings.js').Known }} input @param {number} [quipPage]
 * @param {import('./launches.js').Launch[]} [launches] @param {{ guess?: boolean, voice?: Voice, list?: typeof MOZEM_ITEMS }} [opts]
 *   `voice` tón hlášok, `list` veci karty (nová appka má aj bojler, MOZEM_SKY_ITEMS)
 */
export function mozemModel(input, quipPage = 0, launches = [], { guess = false, voice = 'drzy', list } = {}) {
    const known = input.known || 'elektraren';
    const estimate = guess && known === 'poloha';
    const noPanels = known !== 'elektraren' && !estimate;
    const ctx = input.forecast && !noPanels ? dayCtx(input) : null;
    const items = mozemItems(input, launches, ctx, voice, list);
    const month = localDateKey(input.now, input.site.timezone).slice(0, 7);
    return {
        ...(ctx ? dayHead(input, ctx, quipPage, voice) : { ...emptyHead(input.loading, noPanels, quipPage, voice), facts: null }),
        estimate,
        items,
        glance: mozemGlanceText(items),
        count: mozemCountText(monthCount(launches, month), voice),
    };
}

/**
 * Veci karty s odpoveďou a zápismi spustení: pri spotrebiči tlačidlo „Pustil/a som“ (s tým, či
 * svieti slnko) a kým beží, krátka odpoveď „beží do …“. Bez predpovede (`ctx` null) spotrebič
 * nevie a ostatné idú vždy. Pri veci ostáva aj odpoveď (`answer`) a krátka odpoveď bez behu
 * (`base`) - z nich nová appka skladá dlaždice skupín.
 * @param {PlanInput} input @param {import('./launches.js').Launch[]} launches @param {DayCtx | null} ctx @param {Voice} [voice]
 * @param {typeof MOZEM_ITEMS} [list] veci karty
 */
function mozemItems(input, launches, ctx, voice = 'drzy', list = MOZEM_ITEMS) {
    const today = localDateKey(input.now, input.site.timezone);
    const nowMin = localMinutes(input.now, input.site.timezone);
    return list.map((item) => {
        /** @type {Answer} */ const answer = ctx ? itemAnswer(item, ctx) : deviceOf(item.device) ? { kind: 'unk' } : { kind: 'always' };
        const text = mozemItemText(item, answer, ctx && { ctx, cost: itemCost(item, ctx) }, voice);
        const it = { id: item.id, ...text, answer, base: text.short };
        if (!canLog(it.id)) return { ...it, log: null };
        const running = runningLaunch(launches, it.id, today, nowMin);
        const isAuto = it.id === 'auto';
        return {
            ...it,
            short: running ? mozemRunningShort(isAuto, running.m + runMinOf(it.id)) : it.short,
            log: { sun: it.tone === 'go', pressed: !!running, label: mozemLogLabel(it.tone, isAuto, running, voice) },
        };
    });
}

/** Hlavička karty z plánu dňa: stav, veľké slovo, veta, pás dneška a hlášky. @param {PlanInput} input @param {DayCtx} ctx @param {number} quipPage @param {Voice} voice */
function dayHead(input, ctx, quipPage, voice) {
    const general = planWindows(ctx.plan, (s) => s.tier === 'green');
    const { state, window } = dayState(general, ctx.nowMin, sunUp(input.now, input.site));
    const nextDay = laterDay(ctx, ctx.th.lowKw, true).day;
    const facts = heroFacts(input, ctx);
    const slot = ctx.plan[Math.floor(ctx.nowMin / TARIFF_LIMITS.stepMin)];
    return {
        state,
        word: voiceTexts(voice).MOZEM_WORDS[state],
        hero: mozemHeroText(state, { ctx, window, nextDay, ...facts }, voice),
        strip: { ...stripGeometry(window, ctx.nowMin), text: mozemStripText(state, { ctx, window, nextDay }) },
        ...quipsOf(state, dayNumber(localDateKey(input.now, input.site.timezone)), quipPage, voice),
        facts: {
            level: slot.level,
            window,
            liveKw: facts.live ? facts.kwNow : null,
            planKw: Number.isFinite(slot.kw) ? slot.kw : 0,
        },
    };
}

/**
 * Čísla do hlavičky: výkon teraz (živý, inak z plánu), či je meranie, a výroba dnes a zajtra.
 * @param {PlanInput} input @param {DayCtx} ctx
 */
function heroFacts(input, ctx) {
    const { pv, forecast } = input;
    const slot = ctx.plan[Math.floor(ctx.nowMin / TARIFF_LIMITS.stepMin)];
    const live = pv && Number.isFinite(pv.realTimePowerKw) ? /** @type {number} */ (pv.realTimePowerKw) : null;
    const days = forecast ? forecast.days : [];
    const tomorrow = ctx.later.find((x) => x.index === 1);
    return {
        live: live !== null,
        kwNow: live ?? (slot && Number.isFinite(slot.kw) ? slot.kw : 0),
        todayKwh: pv && Number.isFinite(pv.dailyEnergyKwh) ? /** @type {number} */ (pv.dailyEnergyKwh) : (days[0]?.kwhTotal ?? null),
        tomorrowKwh: tomorrow ? tomorrow.day.kwhTotal : null,
    };
}

/**
 * Krátke odpovede karty Môžem? („do 14:45“, „o 10:00“, „beží do …“) podľa názvu spotrebiča
 * z DEVICES - pre tooltip spotrebiča na karte Terazky. Počíta len veci, nie celú kartu.
 * Spotrebič, ktorý na karte Môžem? nie je (bojler), tu chýba.
 * @param {PlanInput} input @param {import('./launches.js').Launch[]} [launches] @returns {Record<string, string>}
 */
export function deviceShorts(input, launches = []) {
    const items = mozemItems(input, launches, input.forecast ? dayCtx(input) : null);
    /** @type {Record<string, string>} */ const out = {};
    for (const { id, device } of MOZEM_ITEMS) {
        const it = items.find((x) => x.id === id);
        if (device && it) out[device] = it.short;
    }
    return out;
}
