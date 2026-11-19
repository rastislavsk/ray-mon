// Plán dňa: dnešné slnko rozvrhnuté medzi spotrebiče jeden po druhom (poradie a väzby v PLAN_DNA)
// ako rozpočet - pre každú minútu dňa výkon, ktorý ešte ostáva (výroba bez spotreby domu a bez
// spotrebičov, ktoré už v pláne sú). Spotrebič sa zmestí, keď počas ohrevu ostáva aspoň jeho
// príkon; zvyšok programu si z rozpočtu len odpočíta svoj malý odber. Odber a voľný výkon
// počíta tak isto ako odpovede karty Môžem? (shared/mozem.js). Čisté funkcie bez DOM; texty
// skladá shared/messages-core.js. Návrh: docs/navrhy/plan-dna-rozpocet.html; poradie, ktoré
// zmestí na slnko najviac: docs/navrhy/plan-dna-poradie.html. Čo sa dnes nezmestí, rozvrhne
// ten istý výpočet na ďalšie dni predpovede; sušička ide vždy v ten istý deň po práčke
// (docs/navrhy/terazky-plan-dna.html). Čo človek zapol („Už beží“, shared/bezi.js) a ešte beží, plán nerozvrhuje:
// beží od skutočného štartu a berie si svoj odber z rozpočtu, sušička čaká na skutočný koniec prania
// (docs/navrhy/teraz-bezi-spotrebic.html). Čo dobehlo, plán ponúkne znova - za deň sa perie aj viackrát
// (docs/navrhy/spotrebic-koniec-opakovanie.html). Bojler, ktorý riadi zásuvka, ide pred všetkými: plán odsimuluje, kedy ho
// zásuvka zapne a kedy dohreje, a ostatné spotrebiče dostanú zvyšok (docs/navrhy/plan-dna-zive-data.html, krok 3).

import { daSaZapisat } from './bezi.js';
import { simulujBojler } from './bojler.js';
import { DEVICES, MOZEM_ITEMS, PLAN_DNA, TARIFF_LIMITS } from './config.js';
import { forecastDayPlan } from './day-plan.js';
import { weekDayName } from './format.js';
import { bandAt, scheduleFor } from './tariff.js';
import { planDnaRowText, PLAN_DNA_NOTE, planTileText } from './messages-core.js';
import { dayCtx, freeKw, kmOf, programDraw } from './mozem-jadro.js';
import { NB } from './huawei-nb.js';
import { addDays, localDateKey } from './solar.js';
import { bojlerRiadeny } from './teraz-bojler.js';
import { potrebaBojlera } from './ucenie.js';

/** @typedef {import('./mozem-jadro.js').DayCtx} DayCtx */
/** @typedef {import('./mozem-jadro.js').LaterDay} LaterDay */
/** @typedef {(typeof MOZEM_ITEMS)[number]} MozemItem */
/**
 * Miesto spotrebiča v pláne: na slnku od `start` (auto do `end`, s km a cenou tej energie zo
 * siete), v lacnom pásme od `start` do konca toho pásma `end` (cez polnoc viac než 24 h), iný deň
 * od `day.start` do `end` (`after`: po čom v ten deň ide), alebo tento týždeň nie. `podiel`: koľko
 * energie programu v tom čase dá slnko, 0 až 1 (podielSlnka) - na slnku nemusí byť celý, stačí, keď
 * slnko pokryje ohrevy. `poBojleri`: domáci spotrebič na slnku, ktorý by bez bojlera riadeného zásuvkou išiel skôr.
 * @typedef {{ id: string, kind: 'sun', start: number, end: number, after: string | null,
 *     km: number | null, save: number | null, currency: string, podiel: number, poBojleri?: boolean }
 *   | { id: string, kind: 'cheap', start: number, end: number, podiel: number }
 *   | { id: string, kind: 'later', day: LaterDay, end: number, after: string | null, podiel: number }
 *   | { id: string, kind: 'none' }} PlanRow
 */
/** Miesto na slnku v jednom dni. @typedef {Extract<PlanRow, { kind: 'sun' }>} SunRow */
/**
 * Bojler, ktorý riadi zásuvka, v pláne dňa: kedy zapne (keď teraz nehreje), kedy dohreje (null, keď dnes nie) a či je
 * voda už nahriata. @typedef {{ zapne: number | null, dohreje: number | null, nahriaty: boolean }} BojlerPlan
 */
/** Simulácia zásuvky nad voľným výkonom. @typedef {(free: number[]) => ReturnType<typeof simulujBojler>} SimBojler */
/**
 * Riadok bloku Plán dňa: miesto v pláne s textami (planDnaRowText), `now` keď ide teraz, a `value` - čas tak, ako ho povie dlaždica.
 * @typedef {PlanRow & ReturnType<typeof planDnaRowText> & { now: boolean, value: string }} PlanDnaRow
 */
/**
 * Spotrebič, ktorý človek zapol („Zapol som“): beží (`run`) alebo dnes už dobehol (`done`), od `start` do `end`.
 * `podiel`: koľko energie programu dalo či dá slnko, 0 až 1.
 * @typedef {{ id: string, kind: 'run' | 'done', start: number, end: number, podiel: number }} BehRow
 */
/** Úsek dňa, ktorý si spotrebič berie z rozpočtu slnka. @typedef {{ id: string, start: number, end: number }} Usek */
/** Deň, ktorý sa plánuje: kontext, mena a rozpočet voľného výkonu po minútach. @typedef {{ ctx: DayCtx, currency: string, free: number[] }} Den */
/**
 * S čím deň už ráta: čo beží či dobehlo (`pred`, behy), koniec prania, na ktoré vec čaká (`cakaj`, mokre), a čo si
 * berie bojler riadený zásuvkou (`rezerva`, kW po minútach).
 * @typedef {{ pred?: Usek[], cakaj?: Record<string, number>, rezerva?: number[] | null }} Uz
 */

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

/**
 * Podiel energie programu `draw` pusteného o `start`, ktorý pokryje voľný výkon `free` (0 až 1).
 * Za polnocou slnko nie je. Ten istý výpočet ako pri núdzovom čase (shared/tyzden.js).
 * @param {Array<{ kw: number }>} draw @param {number[]} free @param {number} start
 */
export function podielSlnka(draw, free, start) {
    let all = 0;
    let sun = 0;
    draw.forEach(({ kw }, m) => {
        all += kw;
        sun += Math.min(kw, Math.max(0, free[start + m] ?? 0));
    });
    return all > 0 ? sun / all : 0;
}

/** Vec a jej spotrebič podľa id. @param {string} id */
export function vec(id) {
    const item = /** @type {MozemItem} */ (MOZEM_ITEMS.find((i) => i.id === id));
    return { item, device: /** @type {(typeof DEVICES)[number]} */ (DEVICES.find((d) => d.name === item.device)) };
}

/**
 * Voľný výkon dňa po minútach bez toho, čo si už vzali spotrebiče na slnku či bežiace (`slnko`) a bojler (`rezerva`,
 * kW po minútach).
 * @param {DayCtx} ctx @param {Usek[]} slnko @param {number[] | null} [rezerva]
 */
export function volne(ctx, slnko, rezerva = null) {
    const free = Array.from({ length: DAY_MIN }, (_, m) => freeKw(ctx, m) - (rezerva?.[m] ?? 0));
    for (const r of slnko) {
        const { item, device } = vec(r.id);
        const draw = item.runMin === null ? null : programDraw(item, device.powerKw);
        for (let m = r.start; m < Math.min(r.end, DAY_MIN); m++) {
            free[m] = Math.max(0, free[m] - (draw ? (draw[m - r.start]?.kw ?? 0) : device.powerKw));
        }
    }
    return free;
}

/** Odber veci v lacnom pásme po minútach: program, auto príkonom nabíjačky po celý úsek. @param {Extract<PlanRow, { kind: 'cheap' }>} r */
function cheapDraw(r) {
    const { item, device } = vec(r.id);
    return item.runMin === null
        ? Array.from({ length: r.end - r.start }, () => ({ kw: device.powerKw }))
        : programDraw(item, device.powerKw);
}

/** Prvá štvrťhodina lacného pásma od `from` do polnoci, alebo null. @param {DayCtx} ctx @param {number} from */
export function cheapFrom(ctx, from) {
    const slot = ctx.plan.find((s) => s.startMin >= from && s.level === 'lacna');
    return slot ? slot.startMin : null;
}

/**
 * Riadok v lacnom pásme od `start` (alebo null, keď lacné pásmo do polnoci nie je): koniec je prvá
 * štvrťhodina, ktorá už lacná nie je. Pásmo, ktoré siaha do polnoci, pokračuje podľa rozvrhu
 * ďalšieho dňa (víkend môže mať iný) - koniec je potom viac než 24 h. Celý zajtrajšok lacný končí
 * o polnoci zajtra.
 * @param {string} id @param {number | null} start @param {DayCtx} ctx @param {import('./day-plan.js').PlanInput} input
 * @returns {PlanRow | null}
 */
function cheapRow(id, start, ctx, input) {
    if (start === null) return null;
    let end = start;
    while (end < DAY_MIN && ctx.plan[end / STEP].level === 'lacna') end += STEP;
    if (end === DAY_MIN) {
        const { tariff, now, site } = input;
        const schedule = scheduleFor(tariff, addDays(localDateKey(now, site.timezone), 1));
        let m = 0;
        while (m < DAY_MIN && bandAt(tariff, schedule, m).level === 'lacna') m += STEP;
        end += m;
    }
    return { id, kind: 'cheap', start, end, podiel: 0 };
}

/**
 * Behy z `devices`, ktoré človek dnes zapol („Už beží“, `input.bezi`), podľa začiatku: beží, alebo už dobehol,
 * s podielom slnka z rozpočtu dňa. Zápisy iných dní a spotrebičov, ktoré plán nemá, nič neznamenajú.
 * Zápis zo staršej appky z cache po nasadení nemá koniec - skončí po dĺžke programu.
 * @param {DayCtx} ctx @param {import('./day-plan.js').PlanInput} input @param {readonly string[]} devices
 * @returns {BehRow[]}
 */
export function behy(ctx, input, devices) {
    const dnes = localDateKey(input.now, input.site.timezone);
    const free = Array.from({ length: DAY_MIN }, (_, m) => freeKw(ctx, m));
    return (input.bezi ?? [])
        .filter((z) => z.d === dnes && devices.includes(z.id) && daSaZapisat(z.id))
        .sort((a, b) => a.m - b.m)
        .map((z) => {
            const { item, device } = vec(z.id);
            const end = z.k ?? z.m + /** @type {number} */ (item.runMin);
            const kind = ctx.nowMin < end ? /** @type {const} */ ('run') : /** @type {const} */ ('done');
            return { id: z.id, kind, start: z.m, end, podiel: podielSlnka(programDraw(item, device.powerKw), free, z.m) };
        });
}

/**
 * Na čo už vec čaká z behov (`pred`, podľa začiatku): sušička na pranie, ktoré beží či dobehlo a ešte ho nesušila
 * (jej posledný beh začal pred jeho koncom). Vráti koniec toho prania podľa veci, ktorá naň čaká.
 * @param {Usek[]} pred @returns {Record<string, number>}
 */
function mokre(pred) {
    /** @type {Record<string, number>} */ const out = {};
    for (const [id, after] of Object.entries(PLAN_DNA.after)) {
        const a = pred.filter((b) => b.id === after).at(-1);
        const ja = pred.filter((b) => b.id === id).at(-1);
        if (a && (!ja || ja.start < a.end)) out[id] = a.end;
    }
    return out;
}

/**
 * Plán dňa od teraz: pre každý spotrebič z `devices` (id vecí z MOZEM_ITEMS) miesto na slnku,
 * alebo kam inam. Dnešok rozvrhne najlepsiDen. Čo sa dnes nezmestí: auto a bojler (cheapGrid)
 * do lacného pásma, ostatné tým istým výpočtom na ďalšie dni predpovede (iný deň má rozpočet
 * slnka od polnoci). Čo sa nezmestí celý týždeň, ide aspoň do lacného pásma, inak tento týždeň
 * nie. Riadky sú v poradí PLAN_DNA.order. Čo človek dnes zapol a ešte beží (behy), riadok nemá: nerozvrhuje sa,
 * len si berie z rozpočtu slnka. Čo dobehlo, dostane ďalší čas. Sušička ide hneď po praní, ktoré ešte nesušila
 * (mokre), aj zo siete.
 * @param {DayCtx} ctx @param {import('./day-plan.js').PlanInput} input @param {readonly string[]} devices
 * @returns {PlanRow[]}
 */
export function planDna(ctx, input, devices) {
    return planDnaCely(ctx, input, devices).rows;
}

/**
 * Plán dňa (planDna) a k nemu bojler, ktorý riadi zásuvka (bojlerPlanu) - ten riadok nemá, ide pred všetkými.
 * @param {DayCtx} ctx @param {import('./day-plan.js').PlanInput} input @param {readonly string[]} devices
 * @returns {{ rows: PlanRow[], bojler: BojlerPlan | null }}
 */
function planDnaCely(ctx, input, devices) {
    const sim = bojlerPlanu(ctx, input);
    const pred = behy(ctx, input, devices);
    const list = chosen(devices).filter(
        ({ item }) => !(sim && item.id === 'bojler') && !pred.some((b) => b.id === item.id && b.kind === 'run'),
    );
    /** @type {Map<string, PlanRow>} */ const rows = new Map();
    const from0 = Math.ceil(ctx.nowMin / STEP) * STEP;
    const cakaj = mokre(pred);
    const { slnko, boj } = sim
        ? bojlerPrvy(ctx, input.tariff.currency, list, { pred, cakaj }, sim)
        : { slnko: najlepsiDen(ctx, input.tariff.currency, list, { pred, cakaj }), boj: null };
    for (const r of slnko) rows.set(r.id, r);
    const rest = list.filter(({ item, device }) => {
        if (rows.has(item.id)) return false;
        const cheap = device.cheapGrid ? cheapRow(item.id, cheapFrom(ctx, from0), ctx, input) : null;
        if (cheap) rows.set(item.id, cheap);
        return !cheap;
    });
    for (const { item } of ineDni(ctx, input, rest, rows)) {
        // V lacnom pásme ide sušička až po práčke, ak tam ide aj tá.
        const prev = rows.get(PLAN_DNA.after[item.id] ?? '');
        const from = prev?.kind === 'cheap' ? prev.start + (MOZEM_ITEMS.find((i) => i.id === prev.id)?.runMin ?? 0) : from0;
        rows.set(item.id, cheapRow(item.id, cheapFrom(ctx, from), ctx, input) ?? { id: item.id, kind: 'none' });
    }
    // Lacné pásmo môže byť aj cez deň: podiel z toho slnka, čo ostane po veciach na slnku a bojleri.
    const free = volne(ctx, [...pred, ...slnko], boj?.odber);
    return {
        rows: list.map(({ item }) => {
            const r = /** @type {PlanRow} */ (rows.get(item.id));
            return r.kind === 'cheap' ? { ...r, podiel: podielSlnka(cheapDraw(r), free, r.start) } : r;
        }),
        bojler: boj ? { zapne: boj.zapne, dohreje: boj.dohreje, nahriaty: boj.nahriaty } : null,
    };
}

/**
 * Simulácia bojlera, ktorý riadi zásuvka (bojlerRiadeny), pre dnešok - alebo null. Potrebuje toľko, koľko sa appka
 * naučila pri teplote dneška (potrebaBojlera), a meria sa ako Huawei, raz za NB.meranieMs.
 * @param {DayCtx} ctx @param {import('./day-plan.js').PlanInput} input @returns {SimBojler | null}
 */
function bojlerPlanu(ctx, input) {
    const b = input.bojler;
    if (!b || !bojlerRiadeny(b, input.now)) return null;
    const { device } = vec('bojler');
    const dnes = input.forecast?.days.find((d) => d.date === localDateKey(input.now, input.site.timezone));
    const teplota = dnes && dnes.tempMinC !== null && dnes.tempMaxC !== null ? (dnes.tempMinC + dnes.tempMaxC) / 2 : null;
    const o = {
        nowMin: ctx.nowMin,
        now: input.now.getTime(),
        dnes: localDateKey(input.now, input.site.timezone),
        potrebaWh: potrebaBojlera(input.ucenie, teplota),
        kw: device.powerKw,
        krokMin: NB.meranieMs / 60000,
    };
    return (free) => simulujBojler(free, b, o);
}

/**
 * Dnešok s bojlerom pred všetkými (docs/navrhy/plan-dna-zive-data.html, krok 3 a sušička hneď po práčke). Najprv
 * bojler nad tým, čo ostane po bežiacich spotrebičoch - z toho čas prania. Práčka a sušička potom idú natvrdo: sušička
 * mokrú bielizeň nenechá čakať a keď ide počas ohrevu, prebytok bez bojlera klesne a zásuvka bojler sama vypne. Bojler
 * sa preto odsimuluje znova nad tým, čo po praní ostane, a ostatné spotrebiče dostanú zvyšok. Domáci spotrebič, ktorý
 * by bez bojlera išiel skôr a na nič nečaká (sušička je „po práčke“), má `poBojleri`.
 * @param {DayCtx} ctx @param {string} currency @param {ReturnType<typeof chosen>} list
 * @param {{ pred: BehRow[], cakaj: Record<string, number> }} uz @param {SimBojler} sim
 */
function bojlerPrvy(ctx, currency, list, { pred, cakaj }, sim) {
    const prve = najlepsiDen(ctx, currency, list, { pred, cakaj, rezerva: sim(volne(ctx, pred)).odber });
    const pranie = Object.entries(PLAN_DNA.after).flat();
    const pevne = prve.filter((r) => pranie.includes(r.id)).sort((a, b) => a.start - b.start);
    const boj = sim(volne(ctx, [...pred, ...pevne]));
    const rest = list.filter(({ item }) => !pevne.some((r) => r.id === item.id));
    const ostatne = najlepsiDen(ctx, currency, rest, { pred: [...pred, ...pevne], cakaj, rezerva: boj.odber });
    // Podiel slnka prania: bojler mu ustúpi, berie z toho, čo ostane po bežiacich spotrebičoch.
    /** @type {Den} */ const den = { ctx, currency, free: volne(ctx, pred) };
    const prane = pevne.map((r) => {
        const { item, device } = vec(r.id);
        return { ...r, podiel: polozit(item, device, r.start, den).podiel };
    });
    const bez = najlepsiDen(ctx, currency, list, { pred, cakaj });
    const slnko = [...prane, ...ostatne].map((r) => {
        const b = bez.find((x) => x.id === r.id);
        return r.km === null && !r.after && b && r.start > b.start ? { ...r, poBojleri: true } : r;
    });
    return { slnko, boj };
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
            const at = { name: weekDayName(day.date, index), date: day.date, index, start: r.start };
            rows.set(r.id, { id: r.id, kind: 'later', day: at, end: r.end, after: r.after, podiel: r.podiel });
        }
        rest = rest.filter(({ item }) => !rows.has(item.id));
    }
    return rest;
}

/**
 * Najlepší rozvrh jedného dňa: v poradí PLAN_DNA.order, kým iné poradie domácich spotrebičov
 * nedá zreteľne lepší plán (lepsi); auto ide vždy posledné. Vráti len to, čo sa v ten deň
 * zmestí na slnko. `pred`: čo už beží či dobehlo (behy) - berie si z rozpočtu. `cakaj`: koniec prania, na ktoré
 * vec už čaká (mokre).
 * @param {DayCtx} ctx @param {string} currency @param {ReturnType<typeof chosen>} list @param {Uz} [uz]
 * @returns {SunRow[]}
 */
export function najlepsiDen(ctx, currency, list, uz = {}) {
    const u = { pred: [], cakaj: {}, rezerva: null, ...uz };
    const home = list.filter(({ item }) => item.runMin !== null);
    const auto = list.filter(({ item }) => item.runMin === null);
    let best = rozvrh(ctx, currency, list, u);
    for (const order of poradia(home)) {
        const cand = rozvrh(ctx, currency, [...order, ...auto], u);
        if (lepsi(cand, best)) best = cand;
    }
    return best.rows;
}

/**
 * Rozvrh jedného dňa v danom poradí. Vec, ktorá na niečo čaká (`after`, sušička na práčku), ide
 * hneď po jej konci v ten istý deň, aj keď ju slnko neutiahne (podiel povie, koľko zo siete): práčka
 * so sušičkou sú jeden blok a o mieste na slnku rozhoduje práčka. V slabý deň
 * sa spotrebiče, ktoré sa vtedy neodporúčajú (weakDay), na slnko nedávajú. Vráti miesta na slnku
 * a to, čím sa plány porovnávajú: koľko vecí je na slnku, kWh domácich spotrebičov zo siete a km auta.
 * Čo už beží či dobehlo (`pred`), si z rozpočtu berie od svojho štartu. Vec, ktorá už čaká na pranie (`cakaj`), ide
 * po jeho konci - nie až po ďalšom.
 * @param {DayCtx} ctx @param {string} currency @param {ReturnType<typeof chosen>} list @param {Required<Uz>} uz
 * @returns {{ rows: SunRow[], sun: number, gridKwh: number, km: number }}
 */
function rozvrh(ctx, currency, list, { pred, cakaj, rezerva }) {
    /** @type {Den} */ const day = { ctx, currency, free: volne(ctx, pred, rezerva) };
    /** @type {Record<string, number>} */ const ends = {};
    const from0 = Math.ceil(ctx.nowMin / STEP) * STEP;
    /** @type {SunRow[]} */ const rows = [];
    for (const { item, device } of list) {
        const mokra = cakaj[item.id];
        const after = mokra === undefined ? waitsFor(item.id, list) : PLAN_DNA.after[item.id];
        const od = mokra ?? (after ? ends[after] : undefined);
        if (after && od === undefined) continue;
        // Sušička ide hneď po práčke, aj keď ju slnko neutiahne - mokrá bielizeň nečaká.
        const row = after
            ? polozit(item, device, Math.max(from0, /** @type {number} */ (od)), day)
            : device.weakDay || !ctx.weakToday
              ? onSun(item, device, from0, day)
              : null;
        if (!row) continue;
        ends[item.id] = row.end;
        rows.push({ ...row, after });
    }
    // Rozpočet ide pod nulu len tam, kde odber programu prevýši výrobu - to je odber zo siete.
    const gridKwh = day.free.reduce((sum, kw) => sum + Math.max(0, -kw), 0) / 60;
    return { rows, sun: rows.length, gridKwh, km: rows.reduce((sum, r) => sum + (r.km ?? 0), 0) };
}

/**
 * Na čo vec `id` čaká, keď je to v zozname, inak null.
 * @param {string} id @param {ReturnType<typeof chosen>} list
 */
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
export function chosen(devices) {
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
        // Auto berie zo slnka len to, čo je - je celé zo slnka.
        return { ...base, start: span[0], end: span[1], km: kmOf(kwh), save, podiel: 1 };
    }
    const draw = programDraw(item, device.powerKw);
    const start = sunStart(draw, free, from);
    return start === null ? null : polozit(item, device, start, { ctx, currency, free });
}

/**
 * Domáci spotrebič pustený presne o `start`: podiel slnka a odpočítanie odberu z rozpočtu (pod nulu
 * to ide tam, kde ho slnko neutiahne - to je odber zo siete).
 * @param {MozemItem} item @param {(typeof DEVICES)[number]} device @param {number} start @param {Den} day
 * @returns {SunRow}
 */
function polozit(item, device, start, { currency, free }) {
    const draw = programDraw(item, device.powerKw);
    const podiel = podielSlnka(draw, free, start);
    draw.forEach(({ kw }, m) => {
        if (start + m < DAY_MIN) free[start + m] -= kw;
    });
    const runMin = /** @type {number} */ (item.runMin);
    return { id: item.id, kind: 'sun', after: null, currency, start, end: start + runMin, km: null, save: null, podiel };
}

/**
 * Model bloku Plán dňa: riadky (čas, spotrebič, prečo), pätka a časová os dneška
 * (`lanes`). Bez predpovede alebo bez elektrárne null. Riadok, ktorého štart je teraz, má `now`,
 * `value` je jeho čas tak, ako ho povie dlaždica (planTileText: „teraz“, „o 15:00“, „zajtra 07:30“). `behy` je to,
 * čo človek dnes zapol (beží alebo dobehlo), s menom spotrebiča - riadok Plánu dňa nemá. `bojler`: čo urobí bojler, ktorý
 * riadi zásuvka (BojlerPlan), inak null.
 * @param {import('./day-plan.js').PlanInput & { known?: import('./settings.js').Known }} input
 * @param {{ devices?: readonly string[], voice?: import('./messages.js').Voice }} [opts]
 */
export function planDnaModel(input, { devices = PLAN_DNA.devices, voice = 'drzy' } = {}) {
    if (!input.forecast || input.known === 'nic') return null;
    const ctx = dayCtx(input);
    const now = Math.ceil(ctx.nowMin / STEP) * STEP;
    const cely = planDnaCely(ctx, input, devices);
    const rows = cely.rows
        .sort((a, b) => rowOrder(a) - rowOrder(b))
        .map((row) => ({ ...row, ...planDnaRowText(row, voice), now: row.kind === 'sun' && row.start <= now }))
        .map((row) => ({ ...row, value: planTileText(row).value }));
    const beh = behy(ctx, input, devices).map((b) => ({ ...b, name: vec(b.id).device.name }));
    return { rows, note: PLAN_DNA_NOTE, behy: beh, bojler: cely.bojler };
}

/** Poradie riadkov v bloku: dnes podľa času (slnko aj lacné pásmo), potom iné dni, nakoniec „nie“. @param {PlanRow} row */
function rowOrder(row) {
    if (row.kind === 'sun' || row.kind === 'cheap') return row.start;
    return row.kind === 'later' ? DAY_MIN * (1 + row.day.index) + row.day.start : DAY_MIN * 99;
}
