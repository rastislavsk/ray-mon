// Nameraná krivka dňa (`realCurveToday`) z historických dát výrobcu meniča. Body z rozhrania sa
// zlúčia do dnešnej krivky v pásme elektrárne a Worker ju drží v pečati: rozhranie s históriou sa
// pýta najviac raz za KRIVKA.ms, medzitým appka dostane zapečatenú krivku a za ňou aktuálny výkon,
// nech čiara v grafe dňa dôjde až k „teraz“. Čisté funkcie, čas prichádza v parametri.

import { localDateKey, localMinutes } from './solar.js';

/** Ako často sa Worker pýta na priebeh dňa - Huawei pri jednom meniči dovolí raz za 10 minút. */
export const KRIVKA = { ms: 15 * 60 * 1000 };

/**
 * Zapečatená krivka dňa: dátum v pásme elektrárne a body `[minúta dňa, kW]` - krátky zápis, nech je
 * pečať malá (dopyt appky do Workera má limit).
 * @typedef {{ den: string, body: Array<[number, number]> }} Krivka
 */

/**
 * Dnešná krivka z bodov rozhrania: čas v ms a výkon v kW. Body v tom istom čase (viac meničov) sa
 * sčítajú, body bez výkonu a z iného dňa než dnes (v pásme `tz`) sa vynechajú.
 * @param {Array<{ t: number, kw: number | null }>} body @param {Date} now @param {string} tz @returns {Krivka}
 */
export function krivkaZBodov(body, now, tz) {
    const den = localDateKey(now, tz);
    /** @type {Map<number, number>} */ const sum = new Map();
    for (const { t, kw } of body) {
        if (kw === null || !Number.isFinite(kw) || !Number.isFinite(t) || localDateKey(new Date(t), tz) !== den) continue;
        sum.set(t, (sum.get(t) ?? 0) + kw);
    }
    return {
        den,
        body: [...sum.entries()]
            .sort(([a], [b]) => a - b)
            .map(([t, kw]) => /** @type {[number, number]} */ ([localMinutes(new Date(t), tz), Math.round(kw * 1000) / 1000])),
    };
}

/**
 * Dnešná krivka pre appku (`realCurveToday`): zapečatené body a za nimi aktuálny výkon. Krivka
 * z iného dňa (po polnoci) sa nepoužije.
 * @param {Krivka | null | undefined} krivka @param {number | null} kw aktuálny výkon @param {Date} now @param {string} tz
 * @returns {Array<{ hour: number, kw: number }>}
 */
export function krivkaDnes(krivka, kw, now, tz) {
    if (!krivka || krivka.den !== localDateKey(now, tz) || !Array.isArray(krivka.body) || !krivka.body.length) return [];
    const hour = (/** @type {number} */ min) => Number((min / 60).toFixed(4));
    const body = krivka.body.map(([min, v]) => ({ hour: hour(min), kw: v }));
    const teraz = localMinutes(now, tz);
    if (kw !== null && teraz > krivka.body[krivka.body.length - 1][0]) body.push({ hour: hour(teraz), kw });
    return body;
}

/** Dnešná polnoc v pásme elektrárne (ms) - začiatok dopytu na priebeh dňa. @param {Date} now @param {string} tz */
export function polnoc(now, tz) {
    return now.getTime() - localMinutes(now, tz) * 60 * 1000 - now.getUTCSeconds() * 1000 - now.getUTCMilliseconds();
}
