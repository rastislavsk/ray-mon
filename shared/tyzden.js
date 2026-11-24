// Týždeň na karte Teraz (docs/navrhy/teraz-vyhlad-alternativy.html, C s radami z B): pás dní - počasie
// a okná nad hranicou veľkých spotrebičov pre dni predpovede vedľa seba -, plán zvoleného dňa a núdzový čas
// pre spotrebič, ktorý sa v ten deň na slnko nezmestí: kedy ho to stojí najmenej zo siete. Každý deň
// rozvrhuje ten istý výpočet ako Plán dňa (shared/plan-dna.js), sám za seba a s rozpočtom slnka od
// polnoci. Čisté funkcie bez DOM, texty skladá shared/messages-core.js.

import { MINUTES_PER_DAY, PLAN_DNA, PREDPOVED_HODINY, TARIFF_LIMITS, TYZDEN } from './config.js';
import { forecastDayPlan } from './day-plan.js';
import { dayNameShort, weekDayName } from './format.js';
import { planDnaRowText, terazNudzaText, terazRiadokText, terazVecText } from './messages-core.js';
import { dayCtx, programDraw } from './mozem-jadro.js';
import { cheapFrom, chosen, najlepsiDen, podielDrahy, podielSlnka, vec, volne } from './plan-dna.js';
import { skyWeather } from './sky.js';
import { localDateKey } from './solar.js';

/** @typedef {import('./mozem-jadro.js').DayCtx} DayCtx */
/** @typedef {import('./plan-dna.js').SunRow} SunRow */
/** @typedef {import('./messages.js').Voice} Voice */
/**
 * Núdzový čas spotrebiča: štart a koniec (null, keď je to jedno), podiel programu zo slnka (0 až 1,
 * pri aute null), koľko z neho pôjde zo siete v drahom pásme (`draha`, podielDrahy; bez času 0) a odkiaľ rada je - deň
 * s kúskom slnka, lacné pásmo, aspoň mimo drahého, alebo nič z toho.
 * @typedef {{ id: string, start: number | null, end: number | null, podiel: number | null, draha: number,
 *   zdroj: 'slnko' | 'lacna' | 'bezna' | 'siet' }} Nudza
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
 * Pás dní (docs/navrhy/teraz-pas-dni.html): pre každý deň počasie (podľa priemernej oblačnosti), či deň
 * aspoň chvíľu prekročí hranicu veľkých spotrebičov (`nad`) a kedy (`okna`, začiatok a koniec 0 až 1
 * na osi dnešného svetla), a „teraz“ na tej istej osi (mimo dňa null). Všetky dni idú na os dnešného
 * svetla - dĺžka dňa sa za týždeň zmení o pár minút. Menej ako dva dni pás nie je.
 * @param {DenTyzdna[]} dni
 */
export function hrebenModel(dni) {
    if (dni.length < 2) return null;
    const { span, th, nowMin } = dni[0].ctx;
    const x = (/** @type {number} */ m) => Math.round(((m - span.from) / (span.to - span.from)) * 1000) / 1000;
    /** Úseky dňa nad hranicou, orezané na os svetla a zlúčené. @param {DayCtx['plan']} plan */
    const okna = (plan) => {
        /** @type {Array<[number, number]>} */ const o = [];
        for (const s of plan) {
            if (s.night || !(s.kw >= th.lowKw)) continue;
            const od = Math.max(span.from, s.startMin);
            const po = Math.min(span.to, s.startMin + s.min);
            if (po <= od) continue;
            const last = o[o.length - 1];
            if (last && last[1] === od) last[1] = po;
            else o.push([od, po]);
        }
        return o.map(([od, po]) => ({ zac: x(od), kon: x(po) }));
    };
    return {
        teraz: nowMin >= span.from && nowMin <= span.to ? x(nowMin) : null,
        dni: dni.map((d) => ({
            den: dayNameShort(d.day.date),
            name: d.name,
            pocasie: d.day.cloudAvgPct === null ? null : skyWeather(d.day.cloudAvgPct),
            nad: d.ctx.plan.some((s) => !s.night && s.kw >= th.lowKw),
            okna: okna(d.ctx.plan),
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
 * Núdzové časy pre veci `ids`, ktoré sa v deň `ctx` na slnko nezmestia: kedy ich to stojí najmenej
 * zo siete. Vec, ktorá na niečo čaká (sušička na práčku), ide hneď po jej konci, aj zo siete. Každá si zo zvyšného slnka
 * odpočíta svoje, ďalšia dostane, čo ostane. Vráti ich podľa času, bez času na konci.
 * @param {DayCtx} ctx @param {import('./plan-dna.js').Usek[]} slnko čo v ten deň ide na slnku (aj čo človek zapol)
 * @param {readonly string[]} ids
 * @returns {Nudza[]}
 */
export function nudzoveCasy(ctx, slnko, ids) {
    const free = volne(ctx, slnko);
    const from0 = Math.ceil(ctx.nowMin / STEP) * STEP;
    /** @type {Record<string, number>} */ const ends = Object.fromEntries(slnko.map((r) => [r.id, r.end]));
    return PLAN_DNA.order
        .filter((id) => ids.includes(id))
        .map((id) => {
            const after = PLAN_DNA.after[id];
            // Sušička ide hneď po práčke (aj zo siete); keď práčka čas nemá, nemá ho ani ona.
            const n =
                after && ids.includes(after) && ends[after] === undefined
                    ? { id, start: null, end: null, podiel: 0, draha: 0, zdroj: /** @type {const} */ ('siet') }
                    : after && ends[after] !== undefined
                      ? hnedPo(id, ctx, free, Math.max(from0, ends[after]))
                      : nudzovyCas(id, ctx, free, from0);
            if (n.end !== null) ends[id] = n.end;
            return n;
        })
        .sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity));
}

/**
 * Vec pustená presne o `start` (sušička hneď po práčke): podiel slnka a odkiaľ pôjde. Odpočíta z `free`.
 * @param {string} id @param {DayCtx} ctx @param {number[]} free @param {number} start @returns {Nudza}
 */
function hnedPo(id, ctx, free, start) {
    const { item, device } = vec(id);
    const draw = programDraw(item, device.powerKw);
    const podiel = podielSlnka(draw, free, start);
    const draha = podielDrahy(draw, free, start, ctx.plan);
    draw.forEach(({ kw }, m) => (free[start + m] = Math.max(0, (free[start + m] ?? 0) - kw)));
    const vLacnom = ctx.plan[Math.floor(start / STEP) % ctx.plan.length]?.level === 'lacna';
    const zdroj = podiel >= TYZDEN.minPodiel ? 'slnko' : vLacnom ? 'lacna' : 'bezna';
    return { id, start, end: start + draw.length, podiel, draha, zdroj };
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
    const lacna = cheapFrom(ctx, from, device.cheapGrid ? PLAN_DNA.autoMinMin : 0);
    /** @type {Nudza} */ const jedno = { id, start: null, end: null, podiel: item.runMin === null ? null : 0, draha: 0, zdroj: 'siet' };
    // Auto: lacné pásmo až do jeho konca, inak je to jedno - kúsok slnka nabíjačku neutiahne.
    if (item.runMin === null)
        return lacna === null ? jedno : { id, start: lacna, end: lacnaDo(ctx, lacna), podiel: null, draha: 0, zdroj: 'lacna' };
    const draw = programDraw(item, device.powerKw);
    const cena = (/** @type {DayCtx['plan'][number]} */ slot) => slot.band.price ?? VAHA[slot.level];
    const jednaCena = ctx.plan.every((slot) => cena(slot) === cena(ctx.plan[0]));
    const v = vyber(starty(draw, ctx, free, from), { lacnaSiet: device.cheapGrid, jednaCena });
    // Program do polnoci nedobehne: ostáva lacné pásmo, ktoré pokračuje cez polnoc.
    if (!v) return lacna === null ? jedno : { id, start: lacna, end: lacna + draw.length, podiel: 0, draha: 0, zdroj: 'lacna' };
    if (v.zdroj === 'siet') return jedno;
    const vLacnom = ctx.plan[v.start / STEP].level === 'lacna';
    if (v.zdroj === 'rovnako' && !vLacnom) return jedno;
    const draha = podielDrahy(draw, free, v.start, ctx.plan);
    draw.forEach(({ kw }, m) => (free[v.start + m] = Math.max(0, free[v.start + m] - kw)));
    return {
        id,
        start: v.start,
        end: v.start + draw.length,
        podiel: v.podiel,
        draha,
        zdroj: v.zdroj === 'slnko' ? 'slnko' : vLacnom ? 'lacna' : 'bezna',
    };
}

/**
 * Možné štarty programu od `from` po štvrťhodinách (program musí dobehnúť do polnoci): podiel
 * energie, ktorý pokryje slnko, a cena toho, čo pôjde zo siete (bez cien v tarife váha pásma).
 * @param {Array<{ kw: number }>} draw @param {DayCtx} ctx @param {number[]} free @param {number} from
 */
function starty(draw, ctx, free, from) {
    /** @type {Array<{ start: number, podiel: number, cena: number }>} */ const out = [];
    for (let start = from; start + draw.length <= MINUTES_PER_DAY; start += STEP) {
        let cena = 0;
        draw.forEach(({ kw }, m) => {
            const slot = ctx.plan[Math.floor((start + m) / STEP)];
            cena += (kw - Math.min(kw, free[start + m])) * (slot.band.price ?? VAHA[slot.level]);
        });
        out.push({ start, podiel: podielSlnka(draw, free, start), cena });
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
 * Riadok a detail núdzového času: veľký čas, doplnok a podiel slnka v % pre pásik (auto v lacnom pásme 0),
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
            odr: t.odr,
            podiel: Math.round((n.podiel ?? 0) * 100),
            draha: Math.round(n.draha * 100),
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
 * Plán iného dňa pre kartu Teraz: spotrebiče do mriežky - najprv čo ide v ten deň zo slnka, potom čo aspoň
 * najmenej zo siete - a detaily spotrebičov pre panel. Hláška nad nimi je trieda dňa (shared/teraz.js).
 * @param {DenTyzdna} d @param {readonly string[]} devices @param {Voice} [voice]
 */
export function denInyModel(d, devices, voice = 'drzy') {
    const { span } = d.ctx;
    const den = { name: d.name, date: d.day.date, index: d.index };
    const slnko = [...d.slnko]
        .sort((a, b) => a.start - b.start)
        .map((r) => {
            const t = planDnaRowText(r, voice);
            /** @type {import('./plan-dna.js').PlanRow & { name: string, why: string }} */
            const row = {
                id: r.id,
                kind: 'later',
                day: { ...den, start: r.start },
                end: r.end,
                after: r.after,
                podiel: r.podiel,
                draha: r.draha,
                name: t.name,
                why: t.why,
            };
            const u = usek(span, r.start, r.end);
            return {
                riadok: {
                    id: r.id,
                    name: t.name,
                    kind: /** @type {'later' | 'nudza'} */ ('later'),
                    ...terazRiadokText(row),
                    podiel: Math.round(r.podiel * 100),
                    draha: Math.round(r.draha * 100),
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
    return {
        riadky: [...slnko, ...nudza].map((x) => x.riadok),
        veci: [...slnko, ...nudza].map((x) => x.detail),
    };
}
