// Trieda celého dňa pre veľké slovo karty Dnes: ráno z predpovede, cez deň z nameraného
// a predpovede na zvyšok, večer z nameraného (docs/navrhy/dnes-hlasky-dna.html). Počíta ten
// istý rozvrh ako Plán dňa, len od polnoci - koľko spotrebičov sa za celý deň zmestí na slnko.
// Čisté funkcie bez DOM; úložisko rannej triedy rieši web/refresh.js.

import { DEN_TRIEDA, PLAN_DNA } from './config.js';
import { forecastDayPlan } from './day-plan.js';
import { dayCtx } from './mozem.js';
import { chosen, najlepsiDen } from './plan-dna.js';
import { localDateKey, localMinutes, sunTimes } from './solar.js';
import { DATE_RE } from './valid.js';

/** @typedef {'vyborny' | 'dobry' | 'slaby' | 'nanic'} DenTrieda */
/** @typedef {'rano' | 'den' | 'vecer'} DenFaza */
/** Ranná trieda dňa: dátum, spotrebiče, pre ktoré platí, a či už je po východe slnka (potom sa nemení).
 * @typedef {{ date: string, devices: string, cls: DenTrieda, final: boolean }} RannaTrieda */

/** Triedy od najlepšej. @type {readonly DenTrieda[]} */
export const DEN_TRIEDY = ['vyborny', 'dobry', 'slaby', 'nanic'];

/** Silný deň - zmestia sa všetky spotrebiče (karta Kedy lepšie na karte Dnes). @param {DenTrieda} cls */
export const silnyDen = (cls) => cls === 'vyborny' || cls === 'dobry';

/**
 * Trieda celého dnešného dňa (DEN_TRIEDA). Plán dňa už má namerané pred „teraz“ a predpoveď po
 * ňom, takže ráno je to predpoveď, cez deň oboje a po západe namerané.
 * @param {import('./day-plan.js').PlanInput} input @param {readonly string[]} devices spotrebiče doma
 * @returns {DenTrieda}
 */
export function denTrieda(input, devices) {
    return rozbor(dnesCtx(input), input.tariff.currency, devices).cls;
}

/**
 * Trieda iného dňa predpovede (`index` v `forecast.days`, napr. zajtrajška na karte Dnes večer):
 * ten istý výpočet z plánu toho dňa, ako ho rozvrhuje Plán dňa (shared/plan-dna.js, ineDni).
 * @param {import('./day-plan.js').PlanInput & { forecast: import('./solar.js').Forecast }} input @param {number} index
 * @param {readonly string[]} devices spotrebiče doma @returns {DenTrieda}
 */
export function denTriedaDna(input, index, devices) {
    return rozbor(dnaCtx(input, index), input.tariff.currency, devices).cls;
}

/**
 * Trieda dňa aj s tým, ktoré veľké veci sa v ten deň zmestia na slnko - vysvetlenie odznaku na karte
 * Dnes (docs/navrhy/dnes-upravy.html). `index` null je dnešok (ako denTrieda), inak deň predpovede
 * (ako denTriedaDna). Bez spotrebičov doma ráta s predvolenými, tak ako trieda.
 * @param {import('./day-plan.js').PlanInput} input @param {readonly string[]} devices @param {number | null} [index]
 * @returns {{ cls: DenTrieda, veci: { id: string, ok: boolean }[] }}
 */
export function denTriedaVeci(input, devices, index = null) {
    const ctx = index === null || !input.forecast ? dnesCtx(input) : dnaCtx({ ...input, forecast: input.forecast }, index);
    return rozbor(ctx, input.tariff.currency, devices);
}

/** Kontext dneška od polnoci. @param {import('./day-plan.js').PlanInput} input */
const dnesCtx = (input) => ({ ...dayCtx(input), nowMin: 0 });

/**
 * Kontext iného dňa predpovede od polnoci, z jeho plánu.
 * @param {import('./day-plan.js').PlanInput & { forecast: import('./solar.js').Forecast }} input @param {number} index
 */
function dnaCtx(input, index) {
    const ctx = dayCtx(input);
    const day = input.forecast.days[index];
    return { ...ctx, nowMin: 0, plan: forecastDayPlan(input, index), weakToday: day.peakKw < ctx.th.weakPeakKw };
}

/**
 * Trieda dňa z jeho kontextu (rozpočet slnka od polnoci): koľko spotrebičov sa za deň zmestí na slnko,
 * a ktoré to sú.
 * @param {import('./mozem.js').DayCtx} ctx @param {string} currency @param {readonly string[]} devices
 * @returns {{ cls: DenTrieda, veci: { id: string, ok: boolean }[] }}
 */
function rozbor(ctx, currency, devices) {
    const own = chosen(devices);
    const list = own.length ? own : chosen(PLAN_DNA.devices);
    const rows = najlepsiDen(ctx, currency, list);
    const veci = list.map(({ item }) => ({ id: item.id, ok: rows.some((r) => r.id === item.id) }));
    const fit = rows.length;
    if (!fit) return { cls: 'nanic', veci };
    if (fit < list.length) return { cls: 'slaby', veci };
    // Rezerva na mrak: zmestia sa všetky, aj keby strecha dala len časť výkonu?
    const slabsi = { ...ctx, plan: ctx.plan.map((s) => ({ ...s, kw: s.kw * DEN_TRIEDA.reserve })) };
    return { cls: najlepsiDen(slabsi, currency, list).length === list.length ? 'vyborny' : 'dobry', veci };
}

/**
 * Časť dňa: pred východom slnka ráno, po západe večer, medzi nimi deň. Keď slnko v ten deň
 * nevyjde alebo nezapadne (polárny deň či noc), je celý deň deň.
 * @param {{ now: Date, site: import('./config.js').Site }} input @returns {DenFaza}
 */
export function denFaza({ now, site }) {
    const { rise, set } = sunTimes(site, localDateKey(now, site.timezone));
    const m = localMinutes(now, site.timezone);
    if (rise !== null && m < rise) return 'rano';
    if (set !== null && m >= set) return 'vecer';
    return 'den';
}

/** Spotrebiče ako kľúč rannej triedy - poradie nerozhoduje. @param {readonly string[]} devices */
const devicesKey = (devices) => [...devices].sort().join(',');

/**
 * Zapíše rannú triedu dneška. Do východu slnka sa prepisuje (predpoveď sa v noci ešte mení),
 * po ňom ostáva posledná zapísaná - s ňou sa potom porovnáva. Kto appku dnes otvorí až po
 * východe, má rannú triedu z prvého otvorenia. Iný deň alebo iné spotrebiče začínajú odznova.
 * Vracia ten istý objekt, keď sa nič nezmenilo.
 * @param {RannaTrieda | null} prev @param {{ date: string, devices: readonly string[], cls: DenTrieda, faza: DenFaza }} now
 * @returns {RannaTrieda}
 */
export function recordRanna(prev, { date, devices, cls, faza }) {
    const key = devicesKey(devices);
    const final = faza !== 'rano';
    if (!prev || prev.date !== date || prev.devices !== key) return { date, devices: key, cls, final };
    if (prev.final) return prev;
    if (final) return { ...prev, final };
    return prev.cls === cls ? prev : { ...prev, cls };
}

/**
 * Ranná trieda pre dnešok a tieto spotrebiče, inak null.
 * @param {RannaTrieda | null | undefined} r @param {string} date @param {readonly string[]} devices
 */
export function rannaFor(r, date, devices) {
    return r && r.date === date && r.devices === devicesKey(devices) ? r.cls : null;
}

/** Ranná trieda z úložiska; čo nesedí, je null. @param {unknown} raw @returns {RannaTrieda | null} */
export function parseRanna(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const r = /** @type {Record<string, unknown>} */ (raw);
    if (typeof r.date !== 'string' || !DATE_RE.test(r.date) || typeof r.devices !== 'string') return null;
    if (!DEN_TRIEDY.includes(/** @type {DenTrieda} */ (r.cls))) return null;
    return { date: r.date, devices: r.devices, cls: /** @type {DenTrieda} */ (r.cls), final: r.final === true };
}

/**
 * Čo povie veľké slovo: trieda dňa, časť dňa a či sa deň oproti rannej triede zlepšil či pokazil.
 * Zmenu hlási len cez deň. Večer hodnotí namerané - bez merania ostáva ranná hláška.
 * @param {DenTrieda} cls @param {DenFaza} faza @param {DenTrieda | null} ranna @param {boolean} measured
 * @returns {{ cls: DenTrieda, faza: DenFaza, change: 'lepsi' | 'horsi' | null }}
 */
export function denSlovo(cls, faza, ranna, measured) {
    const f = faza === 'vecer' && !measured ? 'rano' : faza;
    const change = f === 'den' && ranna && ranna !== cls ? (DEN_TRIEDY.indexOf(cls) < DEN_TRIEDY.indexOf(ranna) ? 'lepsi' : 'horsi') : null;
    return { cls, faza: f, change };
}
