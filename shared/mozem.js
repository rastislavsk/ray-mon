// Karta Môžem?: jednoduchá odpoveď pre celú rodinu - môžem teraz zapnúť práčku, a keď nie,
// tak kedy. Čisté funkcie bez DOM. Stojí na pláne dňa (shared/day-plan.js), takže „áno“ tu
// je tá istá zelená ako v grafe dňa na karte Teraz; ďalšie dni berie z predpovede.
// Texty skladá shared/messages.js, tu sa len počíta.

import {
    DEVICES,
    EVERYDAY,
    HOUSE_BASE_KW,
    installedKw,
    MOZEM_GROUPS,
    MOZEM_ITEMS,
    PLAN_DNA,
    powerThresholds,
    TARIFF_LIMITS,
} from './config.js';
import { dayPlan } from './day-plan.js';
import { freshPowerKw, pvFreshness } from './hero-model.js';
import { pad2, weekDayName } from './format.js';
import { co2SavedKg } from './carbon.js';
import {
    denWord,
    dnesDayText,
    MOZEM_GROUP_NAMES,
    mozemHeroText,
    mozemItemText,
    mozemListTitle,
    mozemStripText,
    mozemTileNote,
    mozemTileValue,
    planDnaHeadText,
    planGroupNote,
    planTileText,
    voiceTexts,
} from './messages-core.js';
import { daylightSpan, localDateKey, localMinutes, sunUp } from './solar.js';
import { bandAt, scheduleFor } from './tariff.js';
// Kruhový import: plan-dna.js stojí na výpočtoch odtiaľto, karta zas na Pláne dňa. Obe strany
// sa volajú až za behu, nie pri načítaní modulu, takže to ES moduly zvládnu.
import { planDnaModel } from './plan-dna.js';
import { denFaza, denSlovo, denTrieda, rannaFor } from './den-trieda.js';

/** @typedef {import('./day-plan.js').PlanSlot} PlanSlot */
/** @typedef {import('./day-plan.js').PlanInput} PlanInput */
/** @typedef {import('./messages.js').Voice} Voice */
/** Pás dňa v širokej dlaždici: geometria (stripGeometry) a veta do panelu skupiny. @typedef {ReturnType<typeof stripGeometry> & { text: string }} Strip */
/** @typedef {{ from: number, to: number }} Window úsek dňa v minútach od polnoci, `to` je bez neho */
/** @typedef {'go' | 'wait' | 'slabo' | 'none' | 'offline' | 'loading' | 'bezpanelov'} MozemState */
/**
 * Najbližší iný deň, keď slnko stačí: meno pre text („Zajtra“, „Pondelok“), poradie v predpovedi
 * (1 = zajtra) a kedy začína.
 * @typedef {{ name: string, index: number, start: number }} LaterDay
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
        if (w) return { day: { name: weekDayName(day.date, index), index, start: w.from }, weakSkipped };
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
 * @param {(typeof MOZEM_ITEMS)[number]} item @param {number} powerKw
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
 * @param {(typeof MOZEM_ITEMS)[number]} item @param {(typeof DEVICES)[number]} device @param {DayCtx} ctx
 */
export const sunMinKw = (item, device, ctx) => (item.runMin === null ? ctx.th.highKw : device.powerKw) + HOUSE_BASE_KW;

/**
 * Odpoveď pre spotrebič: teraz áno, neskôr dnes, lacno zo siete, iný deň, alebo nie.
 * Neskoršie slnko ešte dnes vyhrá nad lacnou sieťou - teraz by sa platilo, potom nie.
 * @param {(typeof MOZEM_ITEMS)[number]} item @param {DayCtx} ctx @returns {Answer}
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

/** Koniec posledného ťažkého úseku programu v minútach od štartu. @param {(typeof MOZEM_ITEMS)[number]} item */
const heatEnd = (item) => Math.max(...(item.heat ?? [[0, item.runMin ?? 0]]).map(([, to]) => to));

/**
 * Koľko energie programu pusteného o `start` pokryje strecha (0 až 1): minúta sa ráta, keď
 * výroba nad spotrebou domu pokryje celý odber programu v nej (programDraw). Po konci plánu dňa
 * už slnko nie je.
 * @param {(typeof MOZEM_ITEMS)[number]} item @param {number} powerKw @param {DayCtx} ctx @param {number} start
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
 * @param {(typeof MOZEM_ITEMS)[number]} item @param {number} powerKw @param {number} minKw @param {DayCtx} ctx
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

/** Cena behu zo siete teraz, alebo null bez ceny. @param {(typeof MOZEM_ITEMS)[number]} item @param {DayCtx} ctx */
export function itemCost(item, ctx) {
    const device = deviceOf(item.device);
    if (!device || ctx.price === null) return null;
    return (item.runKwh ?? device.powerKw) * ctx.price;
}

/**
 * Poloha úseku a značky „teraz“ na páse dňa v percentách jeho šírky. Pás je deň so slnkom
 * (daylightSpan), aby hovoril o tých istých hodinách ako graf dňa na karte Teraz; `from` a `to`
 * sú jeho kraje pre popisky.
 * @param {Window | null} w @param {number} nowMin @param {import('./solar.js').Span} span
 */
export function stripGeometry(w, nowMin, span) {
    const a = span.from;
    const b = span.to;
    const pct = (/** @type {number} */ m) => Math.round(Math.max(0, Math.min(1, (m - a) / (b - a))) * 1000) / 10;
    const geo = { left: w ? pct(w.from) : 0, width: w ? Math.round((pct(w.to) - pct(w.from)) * 10) / 10 : 0, now: pct(nowMin) };
    return { ...geo, from: a, to: b };
}

/**
 * Stav karty podľa Plánu dňa: niečo z plánu ide teraz, príde ešte dnes na slnku, alebo dnes už
 * nič - vtedy slabý deň, keď dnes zelená vôbec nebola (`sunState` podľa slnka, dayState).
 * @param {PlanDnaRow[]} rows @param {MozemState} sunState @returns {MozemState}
 */
function planState(rows, sunState) {
    const sun = rows.filter((r) => r.kind === 'sun');
    if (sun.some((r) => r.now)) return 'go';
    if (sun.length) return 'wait';
    return sunState === 'slabo' ? 'slabo' : 'none';
}

/**
 * Čo z plánu povie veta pod veľkým slovom: čo ide teraz, najbližšie ďalšie na slnku a prvé
 * v lacnom pásme. @param {PlanDnaRow[]} rows riadky podľa času
 * @returns {import('./messages-core.js').PlanHero}
 */
function planHero(rows) {
    const next = rows.find((r) => r.kind === 'sun' && !r.now);
    const cheap = rows.find((r) => r.kind === 'cheap');
    return {
        now: rows.filter((r) => r.kind === 'sun' && r.now).map((r) => r.name),
        next: next && next.kind === 'sun' ? { name: next.name, start: next.start } : null,
        cheap: cheap && cheap.kind === 'cheap' ? { name: cheap.name, start: cheap.start } : null,
    };
}

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

/**
 * Čo veľké slovo povie o celom dni: trieda dňa, časť dňa a zmena oproti rannej triede. Večer
 * hodnotí len namerané - bez nameranej krivky dneška ostáva ranná hláška.
 * @param {PlanInput} input @param {readonly string[]} devices @param {import('./den-trieda.js').RannaTrieda | null | undefined} ranna
 */
function denOf(input, devices, ranna) {
    const measured = !!input.pv && input.pv.realCurveToday.length > 0;
    const rano = rannaFor(ranna, localDateKey(input.now, input.site.timezone), devices);
    return denSlovo(denTrieda(input, devices), denFaza(input), rano, measured);
}

/** Hlavička karty bez predpovede: panely nie sú zadané, načítava sa, alebo dáta nie sú.
 * @param {boolean} loading @param {boolean} noPanels @param {Voice} voice */
function emptyHead(loading, noPanels, voice) {
    /** @type {'bezpanelov' | 'loading' | 'offline'} */ const state = noPanels ? 'bezpanelov' : loading ? 'loading' : 'offline';
    const hero = mozemHeroText(state, null, voice);
    return { state, word: voiceTexts(voice).MOZEM_WORDS[state], hero, say: hero.lead, strip: null };
}

/**
 * Model karty Môžem?. `known`: čo appka o elektrárni vie
 * (bez neho uložená elektráreň). Pri známej polohe bez panelov (`poloha`) karta odpovedá
 * z typickej strechy, ktorú má vo vstupe (typicalSettings), a model to priznáva v `estimate` -
 * v oboch appkách. Bez polohy (`nic`) neodpovedá.
 *
 * `facts` sú údaje dňa (null bez odpovede): cena siete teraz, dnešné okno so slnkom (to isté
 * ako pás dňa v dlaždici), živý výkon (null bez merania) a výkon z plánu dňa. `list` je nadpis dlaždíc
 * vecí (null, kým sa načítava) a `groups` dlaždice skupín - obe appky ich kreslia rovnako.
 * Stav, veta pod veľkým slovom aj dlaždice sa riadia Plánom dňa (`plan`), takže karta nikde
 * nepovie nič iné než plán. Karty Teraz v oboch appkách kreslia plán s vetou nad ním (`planHead`), pod číslom
 * štítky (`chips`) a len tú časť vety, ktorá plán neopakuje (`say`). Karta Dnes ukazuje, čo dá
 * strecha za celý deň (`day`, null bez predpovede na dnešok).
 * @param {PlanInput & { loading: boolean, known?: import('./settings.js').Known }} input
 * Veľké slovo hovorí o celom dni (`den`: trieda, časť dňa a zmena oproti rannej triede `ranna`,
 * shared/den-trieda.js), veta pod ním o tom, čo teraz.
 * @param {{ voice?: Voice, devices?: readonly string[], ranna?: import('./den-trieda.js').RannaTrieda | null }} [opts]
 *   `voice` tón textov, `devices` spotrebiče doma, `ranna` trieda dňa, ktorú appka videla ráno (platí len pre dnešok a tie isté spotrebiče)
 */
export function mozemModel(input, { voice = 'drzy', devices = PLAN_DNA.devices, ranna } = {}) {
    const known = input.known || 'elektraren';
    const estimate = known === 'poloha';
    const noPanels = known === 'nic';
    const ctx = input.forecast && !noPanels ? dayCtx(input) : null;
    const items = mozemItems(input, ctx, voice);
    const plan = ctx ? planDnaModel(input, { devices, voice }) : null;
    const rows = plan ? plan.rows : [];
    const head = ctx
        ? dayHead(input, ctx, voice, estimate ? installedKw(input.plant) : null, { rows, den: denOf(input, devices, ranna) })
        : { ...emptyHead(input.loading, noPanels, voice), facts: null, den: null };
    return {
        ...head,
        chips: chipsOf(head.state, head.facts, voice),
        day: dnesDayModel(input, ctx),
        estimate,
        items,
        plan,
        planHead: planDnaHeadText(rows),
        // Kým sa načítava, karta nič netvrdí - dlaždice nie sú.
        list: head.state === 'loading' ? null : { title: mozemListTitle(estimate), estimate },
        groups: planGroups(items, head.strip, rows),
    };
}

/** @typedef {ReturnType<typeof planDnaModel>} MozemModelPlan */
/** @typedef {NonNullable<MozemModelPlan>['rows'][number]} PlanDnaRow */

/**
 * Dlaždice skupín podľa Plánu dňa: skupina bez spotrebiča doma sa neukáže. Veľká odpoveď patrí
 * tomu, čo je v pláne na rade najskôr; pri viacerých veciach riadok pod ňou vymenuje všetky
 * s časom z plánu (planGroupNote) a panel skupiny ukáže ich časy z plánu. Polovičná dlaždica,
 * ktorej chýba pár, ide na celú šírku. Bez plánu (nič doma, dáta nie sú) dlaždice z odpovedí vecí.
 * @param {ReturnType<typeof mozemItems>} items @param {Strip | null} strip @param {PlanDnaRow[]} rows riadky plánu podľa času
 */
function planGroups(items, strip, rows) {
    if (!rows.length) return groupsOf(items, strip);
    const shown = MOZEM_GROUPS.flatMap((g) => {
        const own = rows.filter((r) => g.items.includes(r.id));
        return own.length ? [{ g, own }] : [];
    });
    const halves = shown.filter(({ g }) => g.size === 'half');
    const lonely = halves.length % 2 ? halves[halves.length - 1].g : null;
    return shown.map(({ g, own }) => {
        const first = planTileText(own[0]);
        const name = MOZEM_GROUP_NAMES[/** @type {keyof typeof MOZEM_GROUP_NAMES} */ (g.id)];
        const base = { id: g.id, size: g === lonely ? 'wide' : g.size, name, items: g.items, value: first.value, tone: first.tone };
        if (own.length === 1) return { ...base, key: own[0].id, note: first.note, bar: null, sheet: null };
        const tiles = own.map((r) => ({ id: r.id, name: r.name, ...planTileText(r) }));
        const sheetRows = tiles.flatMap((t) => {
            const it = items.find((i) => i.id === t.id);
            return it ? [{ ...it, short: t.short, tone: t.tone }] : [];
        });
        return {
            ...base,
            key: g.id,
            note: planGroupNote(tiles),
            bar: g.size === 'wide' ? barOf(strip) : null,
            sheet: { title: `${name}: ${first.value}`, lead: strip?.text ?? '', rows: sheetRows },
        };
    });
}

/** Poradie odpovedí od najlepšej: dlaždica skupiny ukáže najlepšiu odpoveď svojich vecí. */
const RANK = { go: 0, wait: 1, cheap: 2, later: 3, none: 4, unk: 5 };

/**
 * Dlaždice skupín (MOZEM_GROUPS): jedna odpoveď za skupinu. `key` je to, čo ťuknutie otvorí -
 * pri jednej veci jej panel, pri viacerých panel skupiny so zoznamom vecí. Pri viacerých veciach
 * riadok pod odpoveďou vymenuje tie, ktoré odpovedajú inak; pri jednej veci povie,
 * odkiaľ pôjde prúd. Široká dlaždica má pás dňa s oknom slnka.
 * @param {ReturnType<typeof mozemItems>} items @param {Strip | null} strip
 */
function groupsOf(items, strip) {
    return MOZEM_GROUPS.map((g) => {
        const own = items.filter((it) => g.items.includes(it.id));
        const best = own.reduce((a, b) => (RANK[b.answer.kind] < RANK[a.answer.kind] ? b : a));
        const name = MOZEM_GROUP_NAMES[/** @type {keyof typeof MOZEM_GROUP_NAMES} */ (g.id)];
        const value = mozemTileValue(best.answer, best.short);
        const base = { id: g.id, size: g.size, name, items: g.items };
        if (own.length === 1) {
            return { ...base, key: best.id, value, tone: best.tone, note: mozemTileNote(best.answer), bar: null, sheet: null };
        }
        const note = own
            .filter((it) => it.tone !== best.tone)
            .map((it) => `${it.name} ${it.short}`)
            .join(' · ');
        return {
            ...base,
            key: g.id,
            value,
            tone: best.tone,
            note,
            bar: g.size === 'wide' ? barOf(strip) : null,
            sheet: { title: `${name}: ${value}`, lead: strip?.text ?? '', rows: own },
        };
    });
}

/**
 * Panel, ktorý otvára ťuknutie na dlaždicu (`key` dlaždice, v appke uložený v stave): skupina so
 * zoznamom vecí, alebo jedna vec. Iné id (napr. zo starého kroku v histórii) nič neotvorí.
 * @param {{ groups: ReturnType<typeof groupsOf>, items: ReturnType<typeof mozemItems> }} m @param {string | null} key
 * @returns {{ key: string, group: NonNullable<ReturnType<typeof groupsOf>[number]['sheet']> } | { key: string, item: ReturnType<typeof mozemItems>[number] } | null}
 */
export function mozemSheetOf(m, key) {
    if (!key) return null;
    const sheet = m.groups.find((g) => g.key === key)?.sheet;
    if (sheet) return { key, group: sheet };
    const item = m.items.find((it) => it.id === key);
    return item ? { key, item } : null;
}

/**
 * Pás dňa v dlaždici: okno slnka a „teraz“ v percentách dňa so slnkom (stripGeometry) a pod ním
 * časy kraja, stredu a konca. Bez okna pás nie je.
 * @param {Strip | null} strip
 */
function barOf(strip) {
    if (!strip || !strip.width) return null;
    const label = (/** @type {number} */ m) => `${Math.floor(m / 60)}:${pad2(m % 60)}`;
    const ticks = [strip.from, (strip.from + strip.to) / 2, strip.to].map(label);
    return { left: strip.left, width: strip.width, now: strip.now, ticks };
}

/**
 * Veci karty s odpoveďou. Bez predpovede (`ctx` null) karta o žiadnej nevie. Pri
 * veci ostáva aj odpoveď (`answer`) - z nej nová appka skladá dlaždice skupín.
 * @param {PlanInput} input @param {DayCtx | null} ctx @param {Voice} [voice]
 */
function mozemItems(input, ctx, voice = 'drzy') {
    return MOZEM_ITEMS.map((item) => {
        /** @type {Answer} */ const answer = ctx ? itemAnswer(item, ctx) : { kind: 'unk' };
        const text = mozemItemText(item, answer, ctx && { ctx, cost: itemCost(item, ctx) }, voice);
        return { id: item.id, ...text, title: `${text.name}: ${text.short}`, answer };
    });
}

/**
 * Hlavička karty: stav, veľké slovo a veta podľa Plánu dňa, pás dňa pre dlaždicu podľa slnka
 * (zelenej). `typicalKwp` je výkon typickej strechy, keď appka panely nepozná (null s vlastnými panelmi).
 * @param {PlanInput} input @param {DayCtx} ctx @param {Voice} voice @param {number | null} typicalKwp
 * @param {{ rows: PlanDnaRow[], den: ReturnType<typeof denOf> }} day riadky Plánu dňa (bez spotrebičov doma
 *   prázdne - vtedy stav podľa slnka) a čo veľké slovo povie o celom dni
 */
function dayHead(input, ctx, voice, typicalKwp, { rows, den }) {
    const general = planWindows(ctx.plan, (s) => s.tier === 'green');
    const sun = dayState(general, ctx.nowMin, sunUp(input.now, input.site));
    const { window } = sun;
    const state = rows.length ? planState(rows, sun.state) : sun.state;
    const nextDay = laterDay(ctx, ctx.th.lowKw, true).day;
    const facts = heroFacts(input, ctx);
    const slot = ctx.plan[Math.floor(ctx.nowMin / TARIFF_LIMITS.stepMin)];
    const plan = rows.length ? planHero(rows) : null;
    const sunLeft = sun.state === 'go' || sun.state === 'wait';
    const data = { ctx, window, nextDay, ...facts, typicalKwp, plan, sunLeft };
    return {
        state,
        word: denWord(den, voice),
        den,
        hero: mozemHeroText(state, data, voice),
        // Tá istá veta bez spotrebičov a časov - tie povie Plán dňa hneď pod ňou.
        say: mozemHeroText(state, { ...data, plan: null }, voice).lead,
        strip: { ...stripGeometry(window, ctx.nowMin, ctx.span), text: mozemStripText(sun.state, { ctx, window, nextDay }) },
        facts: {
            level: slot.level,
            window,
            liveKw: facts.live ? facts.kwNow : null,
            planKw: Number.isFinite(slot.kw) ? slot.kw : 0,
        },
    };
}

/**
 * Čísla do hlavičky: výkon teraz (živý len z čerstvého merania, inak z plánu), odkedy meranie
 * mlčí (null, keď nemlčí alebo nie je), či je dnešok nameraný, a výroba dnes a zajtra.
 * @param {PlanInput} input @param {DayCtx} ctx
 */
function heroFacts(input, ctx) {
    const slot = ctx.plan[Math.floor(ctx.nowMin / TARIFF_LIMITS.stepMin)];
    const live = freshPowerKw(input);
    const tomorrow = ctx.later.find((x) => x.index === 1);
    return {
        live: live !== null,
        silentSince: silentSince(input),
        ...todayFacts(input),
        kwNow: live ?? (slot && Number.isFinite(slot.kw) ? slot.kw : 0),
        tomorrowKwh: tomorrow ? tomorrow.day.kwhTotal : null,
    };
}

/** Odkedy meranie mlčí (čas posledného merania), alebo null, keď nemlčí alebo nie je. @param {PlanInput} input */
function silentSince({ now, pv, site }) {
    if (!pv) return null;
    const fresh = pvFreshness({ now, pv, site });
    return fresh.stale ? fresh.time : null;
}

/** Výroba dnes: z merania, inak z predpovede - a ktoré to je. @param {PlanInput} input */
function todayFacts({ pv, forecast }) {
    const kwh = pv ? pv.dailyEnergyKwh : null;
    if (Number.isFinite(kwh)) return { measured: true, todayKwh: /** @type {number} */ (kwh) };
    return { measured: false, todayKwh: forecast?.days[0]?.kwhTotal ?? null };
}

/** @typedef {{ text: string, tone: 'go' | 'plain' | 'cheap' | 'costly' }} Chip */

/**
 * Štítky k odpovedi: stav (ÁNO, NESKÔR…) a lacná či drahá sieť teraz. Bez údajov dňa len stav.
 * @param {MozemState} state @param {{ level: import('./config.js').PriceLevel } | null} facts @param {Voice} voice
 * @returns {Chip[]}
 */
function chipsOf(state, facts, voice) {
    const MOZEM_CHIPS = voiceTexts(voice).MOZEM_CHIPS;
    /** @type {Chip[]} */ const chips = [];
    if (MOZEM_CHIPS[state]) chips.push({ text: MOZEM_CHIPS[state], tone: state === 'go' ? 'go' : 'plain' });
    if (facts?.level === 'lacna') chips.push({ text: MOZEM_CHIPS.lacna, tone: 'cheap' });
    if (facts?.level === 'draha') chips.push({ text: MOZEM_CHIPS.draha, tone: 'costly' });
    return chips;
}

/**
 * Čo dá strecha za celý dnešok: predpoveď dňa, a keď už meranie nabehlo viac, to nabehnuté.
 * V jednotkách, ktoré pozná každý (tie isté prepočty ako Štatistika). Bez predpovede na dnešok null.
 * @param {PlanInput} input
 */
export function dnesDay({ now, site, pv, forecast }) {
    const day = forecast?.days.find((d) => d.date === localDateKey(now, site.timezone));
    if (!day) return null;
    const measured = pv && Number.isFinite(pv.dailyEnergyKwh) ? /** @type {number} */ (pv.dailyEnergyKwh) : 0;
    const kwh = Math.max(day.kwhTotal, measured);
    return { kwh, phones: kwh / EVERYDAY.phoneChargeKwh, km: kwh * EVERYDAY.evKmPerKwh, co2Kg: co2SavedKg(kwh) };
}

/** Texty dneška pre kartu Dnes; bez odpovede karty (`ctx` null) či predpovede na dnešok null. @param {PlanInput} input @param {DayCtx | null} ctx */
function dnesDayModel(input, ctx) {
    const d = ctx && dnesDay(input);
    return d ? dnesDayText(d) : null;
}
