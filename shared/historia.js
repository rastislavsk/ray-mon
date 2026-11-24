// Zber histórie pre učenie Plánu dňa (docs/navrhy/plan-dna-ucenie.html, docs/navrhy/ucenie-vo-workeri.html).
// Worker (Durable Object účtu Huawei, worker/src/ucet.js) skladá z meraní každých 5 minút hodinové súhrny výroby
// a spotreby domu bez bojlera a na konci dňa bojlera jeho energiu a či ho termostat vypol. Telefón si drží snímku
// predpovede na každý deň a behy z „Už beží“ (shared/bezi.js), ktoré inak po dni zahodí. Čisté funkcie - čas
// a dáta prichádzajú ako parametre, úložisko rieši volajúci.

import { BOJLER, HISTORIA } from './config.js';
import { parseBezi } from './bezi.js';
import { addDays, localDateKey, localMinutes } from './solar.js';
import { DATE_RE, isObj } from './valid.js';

/**
 * Hodina, ktorá sa práve zbiera: miestny dátum `d`, hodina `hod`, čas posledného merania `t` (ms) a merania
 * výroby `v` a domu `dom` v kW.
 * @typedef {{ d: string, hod: number, t: number, v: number[], dom: number[] }} Hodina
 */
/** Súhrn hodiny: priemer výroby, medián domu (kW, bez merania null) a počet meraní. @typedef {[number | null, number | null, number]} SuhrnHodiny */
/**
 * Deň histórie: dátum, 24 hodín (bez merania null) a bojler - energia ohrevu vo Wh (aj zo siete) a či ho na
 * konci dňa držal vypnutý termostat (voda nahriata). Bez zásuvky `b` null.
 * @typedef {{ d: string, h: Array<SuhrnHodiny | null>, b: { wh: number, hotovo: boolean } | null }} DenHistorie
 */
/**
 * Snímka predpovede dňa: dátum, minúta dňa, keď ju telefón videl, výkon `k` (kW) a oblačnosť `c` (%) po hodinách
 * a priemerná teplota dňa `t` (°C).
 * @typedef {{ d: string, m: number, k: Array<number | null>, c: Array<number | null>, t: number | null }} SnimkaPredpovede
 */

const MIN = 60 * 1000;

/** @param {number} x */
const r3 = (x) => Math.round(x * 1000) / 1000;
/** @param {unknown} x @returns {x is number} */
const cislo = (x) => typeof x === 'number' && Number.isFinite(x);

/** @param {number[]} a */
function median(a) {
    const s = [...a].sort((x, y) => x - y);
    const i = Math.floor(s.length / 2);
    return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
}

/**
 * Spotreba domu bez bojlera v kW: výroba mínus dodávka do siete (záporná je odber), bez toho, čo práve berie bojler.
 * Bojler sa odpočíta, len keď sa zásuvka ozvala za posledných BOJLER.tichoMin. Bez výroby či elektromera null.
 * @param {number | null | undefined} vyrobaKw @param {number | null | undefined} sietKw
 * @param {{ kontaktAt: number, rele: boolean, w: number } | null | undefined} bojler @param {number} now ms
 */
export function domBezBojlera(vyrobaKw, sietKw, bojler, now) {
    if (!cislo(vyrobaKw) || !cislo(sietKw)) return null;
    const hreje = bojler && bojler.rele && now - bojler.kontaktAt <= BOJLER.tichoMin * MIN ? Math.max(0, bojler.w) / 1000 : 0;
    return r3(Math.max(0, vyrobaKw - sietKw - hreje));
}

/** Najnovších HISTORIA.dni záznamov podľa dátumu. @template {{ d: string }} T @param {T[]} a @returns {T[]} */
const najnovsie = (a) => [...a].sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : 0)).slice(-HISTORIA.dni);

/** Deň `d` z histórie (kópia), alebo prázdny. @param {DenHistorie[]} dni @param {string} d @returns {DenHistorie} */
function den(dni, d) {
    const x = dni.find((z) => z.d === d);
    return x ? { ...x, h: [...x.h] } : { d, h: Array.from({ length: 24 }, () => null), b: null };
}

/** História s nahradeným dňom. @param {DenHistorie[]} dni @param {DenHistorie} novy */
const sDnom = (dni, novy) => najnovsie([...dni.filter((z) => z.d !== novy.d), novy]);

/**
 * Meranie do histórie. Meranie v novej hodine uzavrie tú predošlú do súhrnu jej dňa. Meranie, ktoré nie je novšie
 * než posledné, sa nepočíta. Vracia novú hodinu a históriu dní - tú istú, keď sa žiadna hodina neuzavrela (volajúci
 * podľa toho vie, či ju treba zapísať).
 * @param {{ hodina: Hodina | null, dni: DenHistorie[] }} stav
 * @param {{ at: number, tz: string, vyrobaKw: number | null | undefined, domKw: number | null }} m
 * @returns {{ hodina: Hodina, dni: DenHistorie[] }}
 */
export function zapisMeranie({ hodina, dni }, { at, tz, vyrobaKw, domKw }) {
    const d = localDateKey(new Date(at), tz);
    const hod = Math.floor(localMinutes(new Date(at), tz) / 60);
    if (hodina && at <= hodina.t) return { hodina, dni };
    const v = cislo(vyrobaKw) ? [r3(Math.max(0, vyrobaKw))] : [];
    const dom = cislo(domKw) ? [domKw] : [];
    if (hodina && hodina.d === d && hodina.hod === hod) {
        return { hodina: { ...hodina, t: at, v: [...hodina.v, ...v], dom: [...hodina.dom, ...dom] }, dni };
    }
    return { hodina: { d, hod, t: at, v, dom }, dni: hodina ? uzavri(dni, hodina) : dni };
}

/** História s uzavretou hodinou. @param {DenHistorie[]} dni @param {Hodina} h */
function uzavri(dni, h) {
    const x = den(dni, h.d);
    const n = Math.max(h.v.length, h.dom.length);
    const v = h.v.length ? r3(h.v.reduce((s, k) => s + k, 0) / h.v.length) : null;
    x.h[h.hod] = [v, h.dom.length ? r3(median(h.dom)) : null, n];
    return sDnom(dni, x);
}

/**
 * Deň bojlera do histórie, keď sa jeho záznam dňa skončil (shared/bojler.js `Den`): energia všetkých behov a či
 * bojler na konci dňa držal vypnutý termostat.
 * @param {DenHistorie[]} dni @param {import('./bojler.js').Den} bojlerDen
 */
export function sBojlerom(dni, bojlerDen) {
    const x = den(dni, bojlerDen.den);
    x.b = { wh: Math.round(bojlerDen.behy.reduce((s, b) => s + b.wh, 0)), hotovo: bojlerDen.hotovo !== null };
    return sDnom(dni, x);
}

/**
 * Snímka predpovede na dnešok (`date`), keď ju telefón ešte nemá a je aspoň HISTORIA.snimkaOdMin. Bez dňa
 * v predpovedi či bez zmeny vráti tú istú históriu.
 * @param {SnimkaPredpovede[]} hist @param {import('./solar.js').Forecast | null} forecast @param {string} date @param {number} nowMin
 * @returns {SnimkaPredpovede[]}
 */
export function snimkaPredpovede(hist, forecast, date, nowMin) {
    if (nowMin < HISTORIA.snimkaOdMin || hist.some((s) => s.d === date)) return hist;
    const day = forecast?.days.find((x) => x.date === date);
    if (!day) return hist;
    /** @type {Array<number | null>} */ const k = Array.from({ length: 24 }, () => null);
    /** @type {Array<number | null>} */ const c = Array.from({ length: 24 }, () => null);
    for (const p of day.hourly) {
        if (!Number.isInteger(p.hour) || p.hour < 0 || p.hour > 23) continue;
        k[p.hour] = r3(p.kw);
        c[p.hour] = p.cloud;
    }
    const t = cislo(day.tempMinC) && cislo(day.tempMaxC) ? Math.round(((day.tempMinC + day.tempMaxC) / 2) * 10) / 10 : null;
    return najnovsie([...hist, { d: date, m: nowMin, k, c, t }]);
}

/** Hodnoty po hodinách z úložiska: 24 čísel či null. @param {unknown} a @returns {a is Array<number | null>} */
const hodiny = (a) => Array.isArray(a) && a.length === 24 && a.every((x) => x === null || cislo(x));

/**
 * Snímky predpovede z úložiska. Dáta odtiaľ sú nedôveryhodné: čo nesedí, vypadne.
 * @param {unknown} raw @returns {SnimkaPredpovede[]}
 */
export function parsePredpovedHist(raw) {
    if (!Array.isArray(raw)) return [];
    /** @type {SnimkaPredpovede[]} */ const out = [];
    for (const x of raw) {
        if (!isObj(x)) continue;
        const { d, m, k, c, t } = /** @type {Record<string, unknown>} */ (x);
        if (typeof d !== 'string' || !DATE_RE.test(d) || !Number.isInteger(m) || !hodiny(k) || !hodiny(c)) continue;
        if (t !== null && !cislo(t)) continue;
        if (!out.some((s) => s.d === d)) out.push({ d, m: /** @type {number} */ (m), k, c, t });
    }
    return najnovsie(out);
}

/**
 * História behov po zápise „Už beží“: dnešné behy nahradí tými, čo sú v `bezi` (človek mohol beh aj zrušiť),
 * staršie nechá a drží len HISTORIA.dni dní po dnešok.
 * @param {import('./bezi.js').Zapis[]} hist @param {import('./bezi.js').Zapis[]} bezi @param {string} today
 */
export function pridajBehy(hist, bezi, today) {
    const od = addDays(today, 1 - HISTORIA.dni);
    return parseBezi([...hist.filter((z) => z.d !== today), ...bezi.filter((z) => z.d === today)]).filter((z) => z.d >= od);
}

// Učenie vo Workeri (docs/navrhy/ucenie-vo-workeri.html, B + S1 + B1 + O1 + P1): Durable Object účtu Huawei drží
// snímky predpovede a behy za HISTORIA.dni dní, ktoré mu posielajú telefóny. Dáta od telefónu sú nedôveryhodné.

/** Najviac behov, ktoré Worker od telefónu naraz prijme (60 dní, tri spotrebiče, pár behov denne). */
const MAX_BEHOV = 600;

/**
 * Worker: snímky od telefónu k tým, ktoré už má. Platí prvá snímka dňa - tú, čo Worker má, nič neprepíše. Snímky
 * po dnešku (`today`) a staršie než HISTORIA.dni dní vypadnú.
 * @param {unknown} stare @param {unknown} nove @param {string} today @returns {SnimkaPredpovede[]}
 */
export function zlucSnimky(stare, nove, today) {
    const od = addDays(today, -HISTORIA.dni);
    const prijate = Array.isArray(nove) ? nove.slice(0, HISTORIA.dni + 1) : [];
    return parsePredpovedHist([...(Array.isArray(stare) ? stare : []), ...prijate]).filter((s) => s.d >= od && s.d <= today);
}

/**
 * Worker: behy z histórie telefónu (behy-hist-v1, z čias, keď si ich telefóny nezdieľali) k spoločným behom. Prijme
 * len dni pred dneškom - dnešok ide cez /bezi - a nie staršie než HISTORIA.dni. Ten istý beh (spotrebič, deň a
 * začiatok) ostane ten, čo Worker už má.
 * @param {unknown} stare @param {unknown} nove @param {string} today @returns {import('./bezi.js').Zapis[]}
 */
export function zlucBehy(stare, nove, today) {
    const od = addDays(today, -HISTORIA.dni);
    const prijate = parseBezi(Array.isArray(nove) ? nove.slice(0, MAX_BEHOV) : []).filter((z) => z.d < today && z.d >= od);
    return parseBezi([...prijate, ...parseBezi(stare)]);
}
