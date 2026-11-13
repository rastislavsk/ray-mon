// Týždeň na karte Teraz (docs/navrhy/teraz-vyhlad-alternativy.html, C s radami z B): hrebeň - krivky
// výkonu dní predpovede vedľa seba s hranicou veľkých spotrebičov -, plán zvoleného dňa a núdzový čas
// pre spotrebič, ktorý sa v ten deň na slnko nezmestí: kedy ho to stojí najmenej zo siete. Každý deň
// rozvrhuje ten istý výpočet ako Plán dňa (shared/plan-dna.js), sám za seba a s rozpočtom slnka od
// polnoci. Čisté funkcie bez DOM, texty skladá shared/messages-core.js.

import { DEVICES, MINUTES_PER_DAY, MOZEM_ITEMS, PLAN_DNA, PREDPOVED_HODINY, TARIFF_LIMITS, TYZDEN } from './config.js';
import { forecastDayPlan } from './day-plan.js';
import { dayNameShort, weekDateLabel, weekDayName } from './format.js';
import { planDnaRowText, terazDenHlavickaText, terazNudzaText, terazRiadokText, terazSkupinaText, terazVecText } from './messages-core.js';
import { dayCtx, freeKw, programDraw } from './mozem-jadro.js';
import { cheapFrom, chosen, najlepsiDen } from './plan-dna.js';
import { localDateKey } from './solar.js';

/** @typedef {import('./mozem-jadro.js').DayCtx} DayCtx */
/** @typedef {import('./plan-dna.js').SunRow} SunRow */
/** @typedef {import('./messages.js').Voice} Voice */
/**
 * Núdzový čas spotrebiča: štart a koniec (null, keď je to jedno), podiel programu zo slnka (0 až 1,
 * pri aute null) a odkiaľ rada je - deň s kúskom slnka, lacné pásmo, aspoň mimo drahého, alebo nič z toho.
 * @typedef {{ id: string, start: number | null, end: number | null, podiel: number | null, zdroj: 'slnko' | 'lacna' | 'bezna' | 'siet' }} Nudza
 */
/** Deň týždňa: deň predpovede, poradie od dneška, meno, jeho kontext a čo sa v ňom zmestí na slnko. @typedef {ReturnType<typeof dniTyzdna>[number]} DenTyzdna */

const STEP = TARIFF_LIMITS.stepMin;

/**
 * Dni od dneška: každý so svojím plánom a tým, čo sa v ňom zmestí na slnko (dnes od teraz, iný deň
 * od polnoci). Len keď predpoveď začína dneškom - inak by poradie dňa nesedelo - a je čo plánovať.
 * @param {import('./day-plan.js').PlanInput} input @param {readonly string[]} devices
 */
export function dniTyzdna(input, devices) {
    const { forecast } = input;
    const list = chosen(devices);
    if (!forecast || !list.length || forecast.days[0]?.date !== localDateKey(input.now, input.site.timezone)) return [];
    const ctx = dayCtx(input);
    return forecast.days.slice(0, TYZDEN.dni).map((day, index) => {
        const dctx =
            index === 0
                ? ctx
                : { ...ctx, nowMin: 0, plan: forecastDayPlan({ ...input, forecast }, index), weakToday: day.peakKw < ctx.th.weakPeakKw };
        return { day, index, name: weekDayName(day.date, index), ctx: dctx, slnko: najlepsiDen(dctx, input.tariff.currency, list) };
    });
}

/**
 * Hrebeň týždňa: pre každý deň krivka výkonu od východu po západ (`body`, 0 až 1 z najvyššieho bodu
 * týždňa), či deň aspoň chvíľu prekročí hranicu veľkých spotrebičov (`nad`), výška tej hranice
 * a „teraz“ na dnešnej krivke (mimo dňa null). Všetky dni idú na os dnešného svetla - dĺžka dňa sa
 * za týždeň zmení o pár minút. Menej ako dva dni hrebeň nie je.
 * @param {DenTyzdna[]} dni
 */
export function hrebenModel(dni) {
    if (dni.length < 2) return null;
    const { span, th, nowMin, plan } = dni[0].ctx;
    const kwAt = (/** @type {DayCtx['plan']} */ p, /** @type {number} */ m) => {
        const kw = p[Math.min(p.length - 1, Math.floor(m / STEP))].kw;
        return Number.isFinite(kw) ? Math.max(0, kw) : 0;
    };
    const kw = dni.map((d) =>
        Array.from({ length: TYZDEN.body + 1 }, (_, i) => kwAt(d.ctx.plan, span.from + (i * (span.to - span.from)) / TYZDEN.body)),
    );
    const max = Math.max(th.lowKw * TYZDEN.nadHranicou, ...kw.flat());
    const r = (/** @type {number} */ v) => Math.round((v / max) * 1000) / 1000;
    const dnu = nowMin >= span.from && nowMin <= span.to;
    return {
        hranica: r(th.lowKw),
        teraz: dnu
            ? { x: Math.round(((nowMin - span.from) / (span.to - span.from)) * 1000) / 1000, y: Math.min(1, r(kwAt(plan, nowMin))) }
            : null,
        dni: dni.map((d, i) => ({
            den: dayNameShort(d.day.date),
            datum: weekDateLabel(d.day.date),
            name: d.name,
            body: kw[i].map(r),
            nad: d.ctx.plan.some((s) => !s.night && s.kw >= th.lowKw),
        })),
    };
}

/**
 * Najbližší ďalší deň, keď sa spotrebič `id` zmestí na slnko (null = v predpovedi už nie).
 * @param {DenTyzdna[]} dni @param {string} id
 */
export function dalsieSlnko(dni, id) {
    const d = dni.slice(1).find((x) => x.slnko.some((r) => r.id === id));
    return d ? { name: d.name, index: d.index } : null;
}

/**
 * Voľný výkon dňa po minútach bez toho, čo si už vzali spotrebiče na slnku (`slnko`).
 * @param {DayCtx} ctx @param {SunRow[]} slnko
 */
function volne(ctx, slnko) {
    const free = Array.from({ length: MINUTES_PER_DAY }, (_, m) => freeKw(ctx, m));
    for (const r of slnko) {
        const { item, device } = vec(r.id);
        const draw = item.runMin === null ? null : programDraw(item, device.powerKw);
        for (let m = r.start; m < Math.min(r.end, MINUTES_PER_DAY); m++) {
            free[m] = Math.max(0, free[m] - (draw ? (draw[m - r.start]?.kw ?? 0) : device.powerKw));
        }
    }
    return free;
}

/** Vec a jej spotrebič podľa id. @param {string} id */
function vec(id) {
    const item = /** @type {(typeof MOZEM_ITEMS)[number]} */ (MOZEM_ITEMS.find((i) => i.id === id));
    return { item, device: /** @type {(typeof DEVICES)[number]} */ (DEVICES.find((d) => d.name === item.device)) };
}

/**
 * Núdzové časy pre veci `ids`, ktoré sa v deň `ctx` na slnko nezmestia: kedy ich to stojí najmenej
 * zo siete. Vec, ktorá na niečo čaká (sušička na práčku), ide až po nej. Každá si zo zvyšného slnka
 * odpočíta svoje, ďalšia dostane, čo ostane. Vráti ich podľa času, bez času na konci.
 * @param {DayCtx} ctx @param {SunRow[]} slnko čo v ten deň ide na slnku @param {readonly string[]} ids
 * @returns {Nudza[]}
 */
export function nudzoveCasy(ctx, slnko, ids) {
    const free = volne(ctx, slnko);
    const from0 = Math.ceil(ctx.nowMin / STEP) * STEP;
    /** @type {Record<string, number>} */ const ends = Object.fromEntries(slnko.map((r) => [r.id, r.end]));
    return PLAN_DNA.order
        .filter((id) => ids.includes(id))
        .map((id) => {
            const n = nudzovyCas(id, ctx, free, Math.max(from0, ends[PLAN_DNA.after[id] ?? ''] ?? 0));
            if (n.end !== null) ends[id] = n.end;
            return n;
        })
        .sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity));
}

/** Váha ceny pásma, keď tarifa ceny nemá: lacné pásmo je lacnejšie než bežné a to než drahé. */
const VAHA = /** @type {Record<string, number>} */ ({ lacna: 1, bezna: 2, draha: 3 });

/**
 * Núdzový čas jednej veci od `from`; čo si vezme zo slnka, odpočíta z `free`. Radšej cez deň: štart,
 * pri ktorom slnko pokryje z programu najviac, keď je to aspoň TYZDEN.minPodiel. Inak štart, pri
 * ktorom to, čo slnko nepokryje, stojí zo siete najmenej (cena pásma × odber zo siete) - tam idú
 * rovno auto a bojler (cheapGrid). Keď je cena celý deň rovnaká, čas s tým málom slnka, čo je,
 * a bez slnka je to jedno (`start` null).
 * @param {string} id @param {DayCtx} ctx @param {number[]} free voľný výkon po minútach @param {number} from
 * @returns {Nudza}
 */
function nudzovyCas(id, ctx, free, from) {
    const { item, device } = vec(id);
    const lacna = cheapFrom(ctx, from);
    /** @type {Nudza} */ const jedno = { id, start: null, end: null, podiel: item.runMin === null ? null : 0, zdroj: 'siet' };
    // Auto: lacné pásmo až do jeho konca, inak je to jedno - kúsok slnka nabíjačku neutiahne.
    if (item.runMin === null) return lacna === null ? jedno : { id, start: lacna, end: lacnaDo(ctx, lacna), podiel: null, zdroj: 'lacna' };
    const draw = programDraw(item, device.powerKw);
    const cena = (/** @type {DayCtx['plan'][number]} */ slot) => slot.band.price ?? VAHA[slot.level];
    const jednaCena = ctx.plan.every((slot) => cena(slot) === cena(ctx.plan[0]));
    const v = vyber(starty(draw, ctx, free, from), { lacnaSiet: device.cheapGrid, jednaCena });
    // Program do polnoci nedobehne: ostáva lacné pásmo, ktoré pokračuje cez polnoc.
    if (!v) return lacna === null ? jedno : { id, start: lacna, end: lacna + draw.length, podiel: 0, zdroj: 'lacna' };
    if (v.zdroj === 'siet') return jedno;
    const vLacnom = ctx.plan[v.start / STEP].level === 'lacna';
    if (v.zdroj === 'rovnako' && !vLacnom) return jedno;
    draw.forEach(({ kw }, m) => (free[v.start + m] = Math.max(0, free[v.start + m] - kw)));
    return {
        id,
        start: v.start,
        end: v.start + draw.length,
        podiel: v.podiel,
        zdroj: v.zdroj === 'slnko' ? 'slnko' : vLacnom ? 'lacna' : 'bezna',
    };
}

/**
 * Možné štarty programu od `from` po štvrťhodinách (program musí dobehnúť do polnoci): podiel
 * energie, ktorý pokryje slnko, a cena toho, čo pôjde zo siete (bez cien v tarife váha pásma).
 * @param {Array<{ kw: number }>} draw @param {DayCtx} ctx @param {number[]} free @param {number} from
 */
function starty(draw, ctx, free, from) {
    const all = draw.reduce((sum, { kw }) => sum + kw, 0);
    /** @type {Array<{ start: number, podiel: number, cena: number }>} */ const out = [];
    for (let start = from; start + draw.length <= MINUTES_PER_DAY; start += STEP) {
        let sun = 0;
        let cena = 0;
        draw.forEach(({ kw }, m) => {
            const slot = ctx.plan[Math.floor((start + m) / STEP)];
            const zoSlnka = Math.min(kw, free[start + m]);
            sun += zoSlnka;
            cena += (kw - zoSlnka) * (slot.band.price ?? VAHA[slot.level]);
        });
        out.push({ start, podiel: all > 0 ? sun / all : 0, cena });
    }
    return out;
}

/**
 * Ktorý štart poradiť (pri zhode skorší, pri cene radšej medzi PREDPOVED_HODINY) a prečo: `slnko` - cez deň s kúskom slnka, `cena` - najmenej
 * zo siete, `rovnako` - zvyšok dňa stojí všade rovnako, `siet` - je to jedno. Bez možností null.
 * @param {ReturnType<typeof starty>} moznosti
 * @param {{ lacnaSiet: boolean, jednaCena: boolean }} o vec, ktorá ide rovno za cenou (cheapGrid), a sieť s jednou cenou celý deň
 */
function vyber(moznosti, { lacnaSiet, jednaCena }) {
    if (!moznosti.length) return null;
    const slnko = moznosti.reduce((a, b) => (b.podiel > a.podiel + 1e-9 ? b : a));
    if (!lacnaSiet && slnko.podiel >= TYZDEN.minPodiel) return { ...slnko, zdroj: /** @type {const} */ ('slnko') };
    if (jednaCena) return { ...slnko, zdroj: slnko.podiel > 0 ? /** @type {const} */ ('slnko') : /** @type {const} */ ('siet') };
    const min = Math.min(...moznosti.map((m) => m.cena));
    const lacne = moznosti.filter((m) => m.cena - min < 1e-9);
    // Pri rovnakej cene radšej v hodinách, keď je človek hore, než o polnoci.
    const lacno = lacne.find((m) => m.start >= PREDPOVED_HODINY.od * 60 && m.start < PREDPOVED_HODINY.do * 60) ?? lacne[0];
    if (lacno.podiel >= TYZDEN.minPodiel) return { ...lacno, zdroj: /** @type {const} */ ('slnko') };
    // Zvyšok dňa stojí všade rovnako: radiť čas má zmysel, len keď je to lacné pásmo (rozhodne volajúci).
    return { ...lacno, zdroj: lacne.length < moznosti.length ? /** @type {const} */ ('cena') : /** @type {const} */ ('rovnako') };
}

/** Koniec lacného pásma, ktoré beží o `start`, najviac polnoc. @param {DayCtx} ctx @param {number} start */
function lacnaDo(ctx, start) {
    let end = start;
    while (end < MINUTES_PER_DAY && ctx.plan[end / STEP].level === 'lacna') end += STEP;
    return end;
}

/** Úsek na osi dňa v % (`span`), celý mimo osi null. @param {{ from: number, to: number }} span @param {number} od @param {number} po */
function usek(span, od, po) {
    if (po <= span.from || od >= span.to) return null;
    const pct = (/** @type {number} */ m) =>
        Math.round(((Math.max(span.from, Math.min(span.to, m)) - span.from) / (span.to - span.from)) * 1000) / 10;
    return { left: pct(od), width: Math.round((pct(po) - pct(od)) * 10) / 10 };
}

/**
 * Riadok a detail núdzového času: veľký čas, doplnok a podiel slnka v % pre pásik (pri aute null),
 * a pre panel spotrebiča kedy, od-do, prečo a úsek na osi dňa (zlatý s kúskom slnka, modrý zo siete).
 * @param {Nudza} n @param {{ name: string, span: { from: number, to: number }, den: string, potom: string | null }} o
 *   meno veci, os dňa, meno iného dňa (pri dnešku prázdne) a pri dnešku deň, keď pôjde celá zo slnka
 * @param {Voice} voice
 */
export function nudzaRiadok(n, { name, span, den, potom }, voice) {
    const t = terazNudzaText({ ...n, dnes: !den, potom }, voice);
    const u = n.start !== null && n.end !== null ? usek(span, n.start, n.end) : null;
    return {
        riadok: {
            id: n.id,
            name,
            kind: /** @type {const} */ ('nudza'),
            cas: t.cas,
            info: t.info,
            podiel: n.podiel === null ? null : Math.round(n.podiel * 100),
        },
        detail: {
            id: n.id,
            name,
            tone: '',
            den,
            kedy: t.kedy,
            cas: t.odDo,
            why: t.why,
            slot: u && { ...u, tone: n.zdroj === 'slnko' ? /** @type {const} */ ('part') : /** @type {const} */ ('cheap'), dnes: !den },
        },
    };
}

/**
 * Plán iného dňa pre kartu Teraz: hlavička (meno dňa, dátum, o koľko dní), skupiny riadkov - čo ide
 * v ten deň zo slnka a čo aspoň najmenej zo siete - a detaily spotrebičov pre panel.
 * @param {DenTyzdna} d @param {readonly string[]} devices @param {boolean} nad deň aspoň chvíľu nad hranicou
 * @param {Voice} [voice]
 */
export function denInyModel(d, devices, nad, voice = 'drzy') {
    const { span } = d.ctx;
    const den = { name: d.name, date: d.day.date, index: d.index };
    const slnko = [...d.slnko]
        .sort((a, b) => a.start - b.start)
        .map((r) => {
            const t = planDnaRowText(r, voice);
            /** @type {import('./plan-dna.js').PlanRow & { name: string, why: string }} */
            const row = { id: r.id, kind: 'later', day: { ...den, start: r.start }, end: r.end, after: r.after, name: t.name, why: t.why };
            const u = usek(span, r.start, r.end);
            return {
                riadok: {
                    id: r.id,
                    name: t.name,
                    kind: /** @type {'later' | 'nudza'} */ ('later'),
                    ...terazRiadokText(row),
                    podiel: /** @type {number | null} */ (null),
                },
                detail: {
                    id: r.id,
                    name: t.name,
                    tone: '',
                    den: d.name,
                    ...terazVecText(row, false),
                    slot: u && { ...u, tone: /** @type {'go' | 'cheap' | 'part'} */ ('go'), dnes: false },
                },
            };
        });
    const zvysok = chosen(devices)
        .map(({ item }) => item.id)
        .filter((id) => !d.slnko.some((r) => r.id === id));
    const nudza = nudzoveCasy(d.ctx, d.slnko, zvysok).map((n) =>
        nudzaRiadok(n, { name: planDnaRowText({ id: n.id, kind: 'none' }, voice).name, span, den: d.name, potom: null }, voice),
    );
    const skupina = (/** @type {'slnko' | 'nudza'} */ druh, /** @type {typeof slnko} */ r) =>
        r.length ? [{ nazov: terazSkupinaText({ druh }), riadky: r.map((x) => x.riadok) }] : [];
    return {
        hlavicka: terazDenHlavickaText({ date: d.day.date, index: d.index, nad }),
        skupiny: [...skupina('slnko', slnko), ...skupina('nudza', nudza)],
        veci: [...slnko, ...nudza].map((x) => x.detail),
    };
}
