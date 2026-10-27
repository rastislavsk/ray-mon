// Plán dňa: dnešné slnko rozvrhnuté medzi spotrebiče jeden po druhom (poradie a väzby v PLAN_DNA)
// ako rozpočet - pre každú minútu dňa výkon, ktorý ešte ostáva (výroba bez spotreby domu a bez
// spotrebičov, ktoré už v pláne sú). Spotrebič sa zmestí, keď počas ohrevu ostáva aspoň jeho
// príkon; zvyšok programu si z rozpočtu len odpočíta svoj malý odber. Odber a voľný výkon
// počíta tak isto ako odpovede karty Môžem? (shared/mozem.js). Čisté funkcie bez DOM; texty
// skladá shared/messages-core.js. Návrh: docs/navrhy/plan-dna-rozpocet.html.

import { DEVICES, MOZEM_ITEMS, PLAN_DNA, TARIFF_LIMITS } from './config.js';
import { planDnaRowText, PLAN_DNA_NOTE } from './messages-core.js';
import { dayCtx, freeKw, kmOf, laterDay, programDraw, sunMinKw } from './mozem.js';

/** @typedef {import('./mozem.js').DayCtx} DayCtx */
/** @typedef {import('./mozem.js').LaterDay} LaterDay */
/** @typedef {(typeof MOZEM_ITEMS)[number]} MozemItem */
/**
 * Miesto spotrebiča v pláne: na slnku od `start` (auto do `end`, s km a cenou tej energie zo
 * siete), v lacnom pásme od `start`, iný deň, alebo tento týždeň nie.
 * @typedef {{ id: string, kind: 'sun', start: number, end: number, after: string | null,
 *     km: number | null, save: number | null, currency: string }
 *   | { id: string, kind: 'cheap', start: number }
 *   | { id: string, kind: 'later', day: LaterDay }
 *   | { id: string, kind: 'none' }} PlanRow
 */
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
 * Kam s vecou, ktorej sa dnes slnko neujde: auto a bojler (cheapGrid) do lacného pásma, ostatné
 * na iný deň so slnkom; keď taký nie je, aspoň do lacného pásma.
 * @param {MozemItem} item @param {(typeof DEVICES)[number]} device @param {DayCtx} ctx @param {number} from
 * @returns {PlanRow}
 */
function elsewhere(item, device, ctx, from) {
    const cheap = cheapFrom(ctx, from);
    if (device.cheapGrid && cheap !== null) return { id: item.id, kind: 'cheap', start: cheap };
    const day = laterDay(ctx, sunMinKw(item, device, ctx), device.weakDay).day;
    if (day) return { id: item.id, kind: 'later', day };
    return cheap !== null ? { id: item.id, kind: 'cheap', start: cheap } : { id: item.id, kind: 'none' };
}

/**
 * Plán dňa od teraz: pre každý spotrebič z `devices` (id vecí z MOZEM_ITEMS) miesto na slnku
 * v poradí PLAN_DNA, alebo kam inam. Vec, ktorá na niečo čaká (`after`), ide až po nej.
 * V slabý deň sa spotrebiče, ktoré sa vtedy neodporúčajú (weakDay), na slnko nedávajú.
 * @param {DayCtx} ctx @param {string} currency @param {readonly string[]} devices @returns {PlanRow[]}
 */
export function planDna(ctx, currency, devices) {
    /** @type {Den} */ const day = { ctx, currency, free: Array.from({ length: DAY_MIN }, (_, m) => freeKw(ctx, m)) };
    /** @type {Record<string, number>} */ const ends = {};
    const from0 = Math.ceil(ctx.nowMin / STEP) * STEP;
    return chosen(devices).map(({ item, device }) => {
        const after = PLAN_DNA.after[item.id] ?? null;
        const waits = after !== null && ends[after] !== undefined;
        const from = waits ? Math.max(from0, ends[after]) : from0;
        const row = device.weakDay || !ctx.weakToday ? onSun(item, device, from, day) : null;
        if (!row) return elsewhere(item, device, ctx, from);
        ends[item.id] = row.end;
        return { ...row, after: waits ? after : null };
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
 * Model bloku Plán dňa na karte Môžem? pre obe appky: riadky (čas, spotrebič, prečo) a pätka.
 * Bez predpovede alebo bez elektrárne null. Riadok, ktorého štart je teraz, má `now`.
 * @param {import('./day-plan.js').PlanInput & { known?: import('./settings.js').Known }} input
 * @param {{ devices?: readonly string[], voice?: import('./messages.js').Voice }} [opts]
 */
export function planDnaModel(input, { devices = PLAN_DNA.devices, voice = 'drzy' } = {}) {
    if (!input.forecast || input.known === 'nic') return null;
    const ctx = dayCtx(input);
    const now = Math.ceil(ctx.nowMin / STEP) * STEP;
    const rows = planDna(ctx, input.tariff.currency, devices)
        .sort((a, b) => rowOrder(a) - rowOrder(b))
        .map((row) => ({ ...row, ...planDnaRowText(row, voice), now: row.kind === 'sun' && row.start <= now }));
    return { rows, note: PLAN_DNA_NOTE };
}

/** Poradie riadkov v bloku: dnes podľa času (slnko aj lacné pásmo), potom iné dni, nakoniec „nie“. @param {PlanRow} row */
function rowOrder(row) {
    if (row.kind === 'sun' || row.kind === 'cheap') return row.start;
    return row.kind === 'later' ? DAY_MIN * (1 + row.day.index) + row.day.start : DAY_MIN * 99;
}
