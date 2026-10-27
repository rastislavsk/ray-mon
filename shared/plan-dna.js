// Plán dňa: dnešné slnko rozvrhnuté medzi spotrebiče jeden po druhom (poradie a väzby v PLAN_DNA)
// ako rozpočet - pre každú minútu dňa výkon, ktorý ešte ostáva (výroba bez spotreby domu a bez
// spotrebičov, ktoré už v pláne sú). Spotrebič sa zmestí, keď počas ohrevu ostáva aspoň jeho
// príkon; zvyšok programu si z rozpočtu len odpočíta svoj malý odber. Odber a voľný výkon
// počíta tak isto ako odpovede karty Môžem? (shared/mozem.js). Čisté funkcie bez DOM; texty
// skladá shared/messages-core.js. Návrh: docs/navrhy/plan-dna-rozpocet.html; poradie, ktoré
// zmestí na slnko najviac: docs/navrhy/plan-dna-poradie.html. Čo sa dnes nezmestí, rozvrhne
// ten istý výpočet na ďalšie dni predpovede; sušička ide vždy v ten istý deň po práčke
// (docs/navrhy/terazky-plan-dna.html).

import { DEVICES, MOZEM_ITEMS, PLAN_DNA, TARIFF_LIMITS } from './config.js';
import { forecastDayPlan } from './day-plan.js';
import { weekDayName } from './format.js';
import { planDnaNextText, planDnaRowText, PLAN_DNA_NOTE, planTileText } from './messages-core.js';
import { dayCtx, freeKw, kmOf, programDraw } from './mozem.js';
import { daylightSpan } from './solar.js';

/** @typedef {import('./mozem.js').DayCtx} DayCtx */
/** @typedef {import('./mozem.js').LaterDay} LaterDay */
/** @typedef {(typeof MOZEM_ITEMS)[number]} MozemItem */
/**
 * Miesto spotrebiča v pláne: na slnku od `start` (auto do `end`, s km a cenou tej energie zo
 * siete), v lacnom pásme od `start`, iný deň od `day.start` do `end` (`after`: po čom v ten deň ide),
 * alebo tento týždeň nie.
 * @typedef {{ id: string, kind: 'sun', start: number, end: number, after: string | null,
 *     km: number | null, save: number | null, currency: string }
 *   | { id: string, kind: 'cheap', start: number }
 *   | { id: string, kind: 'later', day: LaterDay, end: number, after: string | null }
 *   | { id: string, kind: 'none' }} PlanRow
 */
/** Miesto na slnku v jednom dni. @typedef {Extract<PlanRow, { kind: 'sun' }>} SunRow */
/** Deň, ktorý sa plánuje: kontext, mena a rozpočet voľného výkonu po minútach. @typedef {{ ctx: DayCtx, currency: string, free: number[] }} Den */

const STEP = TARIFF_LIMITS.stepMin;
const DAY_MIN = 24 * 60;

/**
 * Najskorší štart od `from`, pri ktorom počas všetkých ohrevov ostáva v rozpočte aspoň odber
 * programu. Vráti štart, alebo null. Ohrev za polnocou sa nezmestí nikdy.
 * @param {Array<{ heavy: boolean, kw: number }>} draw @param {number[]} free @param {number} from
 */
function sunStart(draw, free, from) {
    for (let start = from; start < DAY_MIN; start += STEP) {
        if (draw.every(({ heavy, kw }, m) => !heavy || (free[start + m] ?? 0) >= kw)) return start;
    }
    return null;
}

/**
 * Úsek pre auto od `from`: najdlhší kus dňa, v ktorom po ostatných spotrebičoch ostáva výkon
 * aspoň na hranicu auta - auto tak chytí najviac km, nie prvú medzeru. Kratší než
 * PLAN_DNA.autoMinMin minút nestojí za zapojenie, vtedy null.
 * @param {number[]} free @param {number} minKw @param {number} from
 * @returns {[number, number] | null}
 */
function autoSpan(free, minKw, from) {
    /** @type {[number, number] | null} */ let best = null;
    let a = from;
    while (a < DAY_MIN) {
        while (a < DAY_MIN && free[a] < minKw) a++;
        let b = a;
        while (b < DAY_MIN && free[b] >= minKw) b++;
        if (b - a >= PLAN_DNA.autoMinMin && (!best || b - a > best[1] - best[0])) best = [a, b];
        a = b;
    }
    return best;
}

/** Prvá štvrťhodina lacného pásma od `from` do polnoci, alebo null. @param {DayCtx} ctx @param {number} from */
function cheapFrom(ctx, from) {
    const slot = ctx.plan.find((s) => s.startMin >= from && s.level === 'lacna');
    return slot ? slot.startMin : null;
}

/**
 * Plán dňa od teraz: pre každý spotrebič z `devices` (id vecí z MOZEM_ITEMS) miesto na slnku,
 * alebo kam inam. Dnešok rozvrhne najlepsiDen. Čo sa dnes nezmestí: auto a bojler (cheapGrid)
 * do lacného pásma, ostatné tým istým výpočtom na ďalšie dni predpovede (iný deň má rozpočet
 * slnka od polnoci). Čo sa nezmestí celý týždeň, ide aspoň do lacného pásma, inak tento týždeň
 * nie. Riadky sú v poradí PLAN_DNA.order.
 * @param {DayCtx} ctx @param {import('./day-plan.js').PlanInput} input @param {readonly string[]} devices
 * @returns {PlanRow[]}
 */
export function planDna(ctx, input, devices) {
    const list = chosen(devices);
    /** @type {Map<string, PlanRow>} */ const rows = new Map();
    const from0 = Math.ceil(ctx.nowMin / STEP) * STEP;
    for (const r of najlepsiDen(ctx, input.tariff.currency, list)) rows.set(r.id, r);
    const rest = list.filter(({ item, device }) => {
        if (rows.has(item.id)) return false;
        const cheap = device.cheapGrid ? cheapFrom(ctx, from0) : null;
        if (cheap !== null) rows.set(item.id, { id: item.id, kind: 'cheap', start: cheap });
        return cheap === null;
    });
    for (const { item } of ineDni(ctx, input, rest, rows)) {
        // V lacnom pásme ide sušička až po práčke, ak tam ide aj tá.
        const prev = rows.get(PLAN_DNA.after[item.id] ?? '');
        const from = prev?.kind === 'cheap' ? prev.start + (MOZEM_ITEMS.find((i) => i.id === prev.id)?.runMin ?? 0) : from0;
        const cheap = cheapFrom(ctx, from);
        rows.set(item.id, cheap !== null ? { id: item.id, kind: 'cheap', start: cheap } : { id: item.id, kind: 'none' });
    }
    return list.map(({ item }) => /** @type {PlanRow} */ (rows.get(item.id)));
}

/**
 * Ďalšie dni predpovede pre veci `rest`: každý deň tým istým rozvrhom ako dnešok, s rozpočtom
 * slnka od polnoci. Miesta zapíše do `rows` a vráti to, čo sa nezmestí celý týždeň.
 * @param {DayCtx} ctx @param {import('./day-plan.js').PlanInput} input
 * @param {ReturnType<typeof chosen>} rest @param {Map<string, PlanRow>} rows
 */
function ineDni(ctx, input, rest, rows) {
    const { forecast } = input;
    for (const { day, index } of ctx.later) {
        if (!rest.length || !forecast) break;
        const plan = forecastDayPlan({ ...input, forecast }, index);
        const dctx = { ...ctx, nowMin: 0, plan, weakToday: day.peakKw < ctx.th.weakPeakKw };
        for (const r of najlepsiDen(dctx, input.tariff.currency, rest)) {
            const at = { name: weekDayName(day.date, index), index, start: r.start };
            rows.set(r.id, { id: r.id, kind: 'later', day: at, end: r.end, after: r.after });
        }
        rest = rest.filter(({ item }) => !rows.has(item.id));
    }
    return rest;
}

/**
 * Najlepší rozvrh jedného dňa: v poradí PLAN_DNA.order, kým iné poradie domácich spotrebičov
 * nedá zreteľne lepší plán (lepsi); auto ide vždy posledné. Vráti len to, čo sa v ten deň
 * zmestí na slnko.
 * @param {DayCtx} ctx @param {string} currency @param {ReturnType<typeof chosen>} list @returns {SunRow[]}
 */
function najlepsiDen(ctx, currency, list) {
    const home = list.filter(({ item }) => item.runMin !== null);
    const auto = list.filter(({ item }) => item.runMin === null);
    let best = rozvrh(ctx, currency, list);
    for (const order of poradia(home)) {
        const cand = rozvrh(ctx, currency, [...order, ...auto]);
        if (lepsi(cand, best)) best = cand;
    }
    return best.rows;
}

/**
 * Rozvrh jedného dňa v danom poradí. Vec, ktorá na niečo čaká (`after`, sušička na práčku), ide
 * až po nej a v ten istý deň: keď sa po nej nezmestí, nejde v ten deň ani jedna a rozvrh sa
 * spraví znova bez nich - inak by mokrá bielizeň čakala na sušičku do ďalšieho dňa. V slabý deň
 * sa spotrebiče, ktoré sa vtedy neodporúčajú (weakDay), na slnko nedávajú. Vráti miesta na slnku
 * a to, čím sa plány porovnávajú: koľko vecí je na slnku, kWh domácich spotrebičov zo siete a km auta.
 * @param {DayCtx} ctx @param {string} currency @param {ReturnType<typeof chosen>} list
 * @returns {{ rows: SunRow[], sun: number, gridKwh: number, km: number }}
 */
function rozvrh(ctx, currency, list) {
    /** @type {Den} */ const day = { ctx, currency, free: Array.from({ length: DAY_MIN }, (_, m) => freeKw(ctx, m)) };
    /** @type {Record<string, number>} */ const ends = {};
    const from0 = Math.ceil(ctx.nowMin / STEP) * STEP;
    /** @type {SunRow[]} */ const rows = [];
    for (const { item, device } of list) {
        const after = waitsFor(item.id, list);
        if (after && ends[after] === undefined) continue;
        const from = after ? Math.max(from0, ends[after]) : from0;
        const row = device.weakDay || !ctx.weakToday ? onSun(item, device, from, day) : null;
        if (!row && after)
            return rozvrh(
                ctx,
                currency,
                list.filter(({ item: i }) => i.id !== item.id && i.id !== after),
            );
        if (!row) continue;
        ends[item.id] = row.end;
        rows.push({ ...row, after });
    }
    // Rozpočet ide pod nulu len tam, kde odber programu prevýši výrobu - to je odber zo siete.
    const gridKwh = day.free.reduce((sum, kw) => sum + Math.max(0, -kw), 0) / 60;
    return { rows, sun: rows.length, gridKwh, km: rows.reduce((sum, r) => sum + (r.km ?? 0), 0) };
}

/** Na čo vec `id` čaká, keď je to v zozname, inak null. @param {string} id @param {ReturnType<typeof chosen>} list */
function waitsFor(id, list) {
    const after = PLAN_DNA.after[id];
    return after && list.some(({ item }) => item.id === after) ? after : null;
}

/**
 * Je plán `a` zreteľne lepší než `b`? Viac vecí na slnku, inak aspoň o PLAN_DNA.betterKwh menej
 * zo siete, inak aspoň o PLAN_DNA.betterKm viac km pre auto.
 * @param {ReturnType<typeof rozvrh>} a @param {ReturnType<typeof rozvrh>} b
 */
function lepsi(a, b) {
    if (a.sun !== b.sun) return a.sun > b.sun;
    if (Math.abs(a.gridKwh - b.gridKwh) >= PLAN_DNA.betterKwh) return a.gridKwh < b.gridKwh;
    return a.km - b.km >= PLAN_DNA.betterKm;
}

/**
 * Všetky poradia vecí, v ktorých vec s `after` ide až po tej, na ktorú čaká.
 * @template {{ item: MozemItem }} T @param {T[]} list @returns {T[][]}
 */
function poradia(list) {
    if (list.length <= 1) return [list];
    return list.flatMap((x, i) => {
        const rest = list.filter((_, j) => j !== i);
        const waits = rest.some(({ item }) => item.id === PLAN_DNA.after[x.item.id]);
        return waits ? [] : poradia(rest).map((p) => [x, ...p]);
    });
}

/** Vybrané veci v poradí PLAN_DNA, každá so svojím spotrebičom. @param {readonly string[]} devices */
function chosen(devices) {
    return PLAN_DNA.order.flatMap((id) => {
        const item = MOZEM_ITEMS.find((i) => i.id === id);
        const device = item && DEVICES.find((d) => d.name === item.device);
        return item && device && devices.includes(id) ? [{ item, device }] : [];
    });
}

/**
 * Miesto na slnku od `from` a jeho odpočítanie z rozpočtu: auto dostane úsek silného slnka a berie
 * z neho všetko až po príkon nabíjačky (km a cenu tej energie zo siete), ostatné najskorší štart,
 * pri ktorom sa ohrevy zmestia. Bez miesta null.
 * @param {MozemItem} item @param {(typeof DEVICES)[number]} device @param {number} from @param {Den} day
 */
function onSun(item, device, from, { ctx, currency, free }) {
    const base = { id: item.id, kind: /** @type {const} */ ('sun'), after: /** @type {string | null} */ (null), currency };
    if (item.runMin === null) {
        // Rozpočet už je bez spotreby domu, takže hranica je samotné silné slnko.
        const span = autoSpan(free, ctx.th.highKw, from);
        if (!span) return null;
        let kwh = 0;
        /** @type {number | null} */ let save = 0;
        for (let m = span[0]; m < span[1]; m++) {
            const take = Math.min(free[m], device.powerKw);
            const price = ctx.plan[Math.floor(m / STEP)].band.price;
            kwh += take / 60;
            save = save === null || price === null ? null : save + (take / 60) * price;
            free[m] -= take;
        }
        return { ...base, start: span[0], end: span[1], km: kmOf(kwh), save };
    }
    const draw = programDraw(item, device.powerKw);
    const start = sunStart(draw, free, from);
    if (start === null) return null;
    draw.forEach(({ kw }, m) => {
        if (start + m < DAY_MIN) free[start + m] -= kw;
    });
    return { ...base, start, end: start + item.runMin, km: null, save: null };
}

/**
 * Model bloku Plán dňa pre obe appky: riadky (čas, spotrebič, prečo), pätka a časová os dneška
 * (`lanes`). Bez predpovede alebo bez elektrárne null. Riadok, ktorého štart je teraz, má `now`,
 * `value` je jeho čas tak, ako ho povie dlaždica (planTileText: „teraz“, „o 15:00“, „zajtra 07:30“).
 * @param {import('./day-plan.js').PlanInput & { known?: import('./settings.js').Known }} input
 * @param {{ devices?: readonly string[], voice?: import('./messages.js').Voice }} [opts]
 */
export function planDnaModel(input, { devices = PLAN_DNA.devices, voice = 'drzy' } = {}) {
    if (!input.forecast || input.known === 'nic') return null;
    const ctx = dayCtx(input);
    const now = Math.ceil(ctx.nowMin / STEP) * STEP;
    const rows = planDna(ctx, input, devices)
        .sort((a, b) => rowOrder(a) - rowOrder(b))
        .map((row) => ({ ...row, ...planDnaRowText(row, voice), now: row.kind === 'sun' && row.start <= now }))
        .map((row) => ({ ...row, value: planTileText(row).value }));
    return { rows, note: PLAN_DNA_NOTE, lanes: planLanes(rows, ctx.span, ctx.nowMin), next: planNextDay(rows, ctx, input.site) };
}

/**
 * Plán na ďalší deň, keď dnes na slnko nejde nič (večer, zamračený deň): os prvého ďalšieho dňa,
 * v ktorom je niečo na slnku, s pásmi spotrebičov v ten deň a bez čiary teraz - teraz je dnes.
 * Čo ide dnes z lacnej siete, povie veta (`head.tonight`), ostatné dni a „nie“ sú v `others`.
 * Keď dnes niečo na slnku je, alebo žiadny deň predpovede, null.
 * Návrh: docs/navrhy/plan-dna-zajtra.html, návrh 1.
 * @param {Array<PlanRow & { name: string, value: string }>} rows
 * @param {DayCtx} ctx @param {import('./config.js').Site} site
 */
export function planNextDay(rows, ctx, site) {
    if (rows.some((r) => r.kind === 'sun')) return null;
    const later = rows.flatMap((r) => (r.kind === 'later' ? [{ ...r, start: r.day.start }] : []));
    const day = later.length ? ctx.later.find((x) => x.index === later[0].day.index) : null;
    if (!day) return null;
    const on = later.filter((r) => r.day.index === day.index).sort((a, b) => a.start - b.start);
    const cheap = rows.flatMap((r) => (r.kind === 'cheap' ? [{ name: r.name, start: r.start }] : []));
    const rest = rows.filter((r) => r.kind !== 'cheap' && !on.some((o) => o.id === r.id));
    return {
        ...planDnaNextText({ name: later[0].day.name, date: day.day.date, on, cheap }),
        lanes: {
            ...planAxis(on, daylightSpan(site, day.day.date)),
            others: rest.map((r) => ({ id: r.id, name: r.name, value: r.value })),
            now: null,
        },
    };
}

/**
 * Časová os Plánu dňa: pre každý spotrebič na dnešnom slnku pás od štartu po koniec programu,
 * os cez dnešné svetlo (daylightSpan) s hodinami po troch a čiara teraz - všetko v percentách
 * osi. Čo na slnko dnes nejde (iný deň, lacné pásmo, nie), je v `others` s časom z riadku plánu.
 * @param {Array<PlanRow & { name: string, value: string }>} rows
 * @param {{ from: number, to: number }} span @param {number} nowMin
 */
export function planLanes(rows, span, nowMin) {
    const pct = axisPct(span);
    const sun = rows.flatMap((r) => (r.kind === 'sun' ? [r] : []));
    const others = rows.filter((r) => r.kind !== 'sun').map((r) => ({ id: r.id, name: r.name, value: r.value }));
    return { ...planAxis(sun, span), others, now: /** @type {number | null} */ (pct(nowMin)) };
}

/** Minúta dňa ako % osi `span`, mimo osi na jej kraji. @param {{ from: number, to: number }} span */
const axisPct = (span) => (/** @type {number} */ m) =>
    Math.round(((Math.max(span.from, Math.min(span.to, m)) - span.from) / (span.to - span.from)) * 1000) / 10;

/**
 * Pásy spotrebičov na osi `span` a hodiny po troch pod ňou, v percentách osi.
 * @param {Array<{ id: string, name: string, start: number, end: number }>} items @param {{ from: number, to: number }} span
 */
function planAxis(items, span) {
    const pct = axisPct(span);
    const lanes = items.map((r) => ({ id: r.id, name: r.name, left: pct(r.start), width: pct(r.end) - pct(r.start) }));
    /** @type {Array<{ label: string, at: number }>} */ const ticks = [];
    for (let h = Math.ceil(span.from / 180) * 3; h * 60 <= span.to; h += 3) ticks.push({ label: String(h), at: pct(h * 60) });
    return { lanes, ticks };
}

/** Poradie riadkov v bloku: dnes podľa času (slnko aj lacné pásmo), potom iné dni, nakoniec „nie“. @param {PlanRow} row */
function rowOrder(row) {
    if (row.kind === 'sun' || row.kind === 'cheap') return row.start;
    return row.kind === 'later' ? DAY_MIN * (1 + row.day.index) + row.day.start : DAY_MIN * 99;
}
