// Plán dňa: dnešné slnko rozvrhnuté medzi spotrebiče jeden po druhom, aby sa ich ohrevy
// neprekrývali (poradie a väzby v PLAN_DNA). Stojí na pláne dňa a profiloch odberu ako odpovede
// karty Môžem? (shared/mozem.js) - „áno“ je tá istá zelená. Čisté funkcie bez DOM; texty skladá
// shared/messages-core.js.

import { DEVICES, MOZEM_ITEMS, PLAN_DNA, TARIFF_LIMITS } from './config.js';
import { planDnaRowText, PLAN_DNA_NOTE } from './messages-core.js';
import { dayCtx, kmFromSun, laterDay, planWindows } from './mozem.js';

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

const STEP = TARIFF_LIMITS.stepMin;
const DAY_MIN = 24 * 60;

/** Slnko stačí na plný príkon v tejto minúte dňa. @param {DayCtx} ctx @param {number} m */
function strong(ctx, m) {
    const slot = ctx.plan[Math.floor(m / STEP)];
    return !!slot && Number.isFinite(slot.kw) && slot.kw >= ctx.th.lowKw;
}

/** Minúta patrí do niektorého úseku. @param {Array<[number, number]>} spans @param {number} m */
const inSpans = (spans, m) => spans.some(([from, to]) => m >= from && m < to);

/**
 * Najskorší štart od `from`, pri ktorom všetky ohrevy programu chytia slnko a neprekryjú sa
 * s ohrevmi vecí, ktoré už v pláne sú. Vráti štart a ohrevy v minútach dňa, alebo null.
 * @param {MozemItem} item @param {DayCtx} ctx @param {number} from @param {Array<[number, number]>} busy
 */
function sunStart(item, ctx, from, busy) {
    const heat = item.heat ?? [[0, item.runMin ?? 0]];
    for (let start = from; start < DAY_MIN; start += STEP) {
        /** @type {Array<[number, number]>} */ const spans = heat.map(([a, b]) => [start + a, start + b]);
        const ok = spans.every(([a, b]) => {
            for (let m = a; m < b; m++) if (!strong(ctx, m) || inSpans(busy, m)) return false;
            return true;
        });
        if (ok) return { start, spans };
    }
    return null;
}

/**
 * Úsek silného slnka pre auto od `from`: najdlhší kus okna nad hranicou auta (highKw), v ktorom
 * nebeží ohrev inej veci - auto tak chytí najviac km, nie prvú medzeru medzi ohrevmi. Kratší
 * než PLAN_DNA.autoMinMin minút nestojí za zapojenie, vtedy null.
 * @param {DayCtx} ctx @param {number} from @param {Array<[number, number]>} busy
 * @returns {[number, number] | null}
 */
function autoSpan(ctx, from, busy) {
    /** @type {[number, number] | null} */ let best = null;
    for (const w of planWindows(ctx.plan, (s) => Number.isFinite(s.kw) && s.kw >= ctx.th.highKw)) {
        let a = Math.max(w.from, from);
        while (a < w.to) {
            while (a < w.to && inSpans(busy, a)) a++;
            let b = a;
            while (b < w.to && !inSpans(busy, b)) b++;
            if (b - a >= PLAN_DNA.autoMinMin && (!best || b - a > best[1] - best[0])) best = [a, b];
            a = b;
        }
    }
    return best;
}

/**
 * Koľko by energia, ktorú auto chytí zo slnka v úseku, stála zo siete (podľa pásma v každej
 * štvrťhodine). Bez ceny v niektorom pásme null.
 * @param {DayCtx} ctx @param {[number, number]} span @param {number} powerKw
 */
function gridValue(ctx, [a, b], powerKw) {
    let sum = 0;
    for (const s of ctx.plan) {
        const overlap = Math.min(b, s.startMin + s.min) - Math.max(a, s.startMin);
        if (overlap <= 0 || !Number.isFinite(s.kw)) continue;
        if (s.band.price === null) return null;
        sum += Math.min(s.kw, powerKw) * (overlap / 60) * s.band.price;
    }
    return sum;
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
    const day = laterDay(ctx, item.runMin === null ? ctx.th.highKw : ctx.th.lowKw, device.weakDay).day;
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
    const day = { ctx, currency, busy: /** @type {Array<[number, number]>} */ ([]) };
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
 * Miesto na slnku od `from`: auto dostane úsek silného slnka, ostatné najskorší štart, pri ktorom
 * ohrevy chytia slnko. Obsadené ohrevy pridá do `day.busy`. Bez miesta null.
 * @param {MozemItem} item @param {(typeof DEVICES)[number]} device @param {number} from
 * @param {{ ctx: DayCtx, currency: string, busy: Array<[number, number]> }} day
 */
function onSun(item, device, from, { ctx, currency, busy }) {
    const base = { id: item.id, kind: /** @type {const} */ ('sun'), after: /** @type {string | null} */ (null), currency };
    if (item.runMin === null) {
        const span = autoSpan(ctx, from, busy);
        if (!span) return null;
        busy.push(span);
        const km = kmFromSun({ ...ctx, nowMin: span[0] }, span[1], device.powerKw);
        return { ...base, start: span[0], end: span[1], km, save: gridValue(ctx, span, device.powerKw) };
    }
    const hit = sunStart(item, ctx, from, busy);
    if (!hit) return null;
    busy.push(...hit.spans);
    return { ...base, start: hit.start, end: hit.start + item.runMin, km: null, save: null };
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
