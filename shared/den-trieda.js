// Trieda celého dňa pre veľké slovo karty Dnes: ráno z predpovede, cez deň z nameraného
// a predpovede na zvyšok, večer z nameraného (docs/navrhy/dnes-hlasky-dna.html). Počíta ten
// istý rozvrh ako Plán dňa, len od polnoci - koľko spotrebičov sa za celý deň zmestí na slnko.
// Čisté funkcie bez DOM; úložisko rannej triedy rieši web/refresh.js.

import { DEN_TRIEDA, PLAN_DNA } from './config.js';
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

/**
 * Trieda celého dnešného dňa (DEN_TRIEDA). Plán dňa už má namerané pred „teraz“ a predpoveď po
 * ňom, takže ráno je to predpoveď, cez deň oboje a po západe namerané.
 * @param {import('./day-plan.js').PlanInput} input @param {readonly string[]} devices spotrebiče doma
 * @returns {DenTrieda}
 */
export function denTrieda(input, devices) {
    const ctx = { ...dayCtx(input), nowMin: 0 };
    const own = chosen(devices);
    const list = own.length ? own : chosen(PLAN_DNA.devices);
    const currency = input.tariff.currency;
    const fit = najlepsiDen(ctx, currency, list).length;
    if (!fit) return 'nanic';
    if (fit < list.length) return 'slaby';
    // Rezerva na mrak: zmestia sa všetky, aj keby strecha dala len časť výkonu?
    const slabsi = { ...ctx, plan: ctx.plan.map((s) => ({ ...s, kw: s.kw * DEN_TRIEDA.reserve })) };
    return najlepsiDen(slabsi, currency, list).length === list.length ? 'vyborny' : 'dobry';
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
