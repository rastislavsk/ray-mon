// Učenie Plánu dňa z histórie (docs/navrhy/plan-dna-ucenie.html, rozhodnuté 19. 11. 2026: tabuľky s váhou podľa veku).
// Pri Huawei Northbound model počíta Worker (Durable Object účtu, raz za deň) a telefóny domácnosti ho dostanú hotový
// (docs/navrhy/ucenie-vo-workeri.html, 24. 11. 2026); telefón s iným zdrojom merania ho počíta sám. Nie je to neurónová sieť, ale pár desiatok čísel z histórie jednej domácnosti:
// a) o koľko sa strecha líši od predpovede podľa hodiny a oblačnosti, b) spotreba domu bez spotrebičov po hodinách
// v pracovný deň a cez víkend, c) koľko energie potrebuje bojler podľa teploty dňa. Model nemá vlastný stav - každý
// deň sa prepočíta z histórie (shared/historia.js), takže „Začať odznova“ len posunie deň, od ktorého sa učí. Bez
// histórie vráti presne predvolené hodnoty. Čisté funkcie, čas a dáta prichádzajú v parametroch.

import { HISTORIA, HOUSE_BASE_KW, MOZEM_ITEMS, PLAN_ZIVE, UCENIE } from './config.js';
import { addDays } from './solar.js';
import { DATE_RE, isObj } from './valid.js';

/** @typedef {import('./historia.js').DenHistorie} DenHistorie */
/** @typedef {import('./historia.js').SnimkaPredpovede} SnimkaPredpovede */
/**
 * Čo sa appka naučila: z koľkých dní (\`dni\`) a od ktorého (\`od\`, null = odjakživa), násobok predpovede po
 * triedach oblačnosti a hodinách (\`oprava[trieda][hodina]\`, 1 = bez opravy), spotreba domu po hodinách (kW) v pracovný
 * deň a cez víkend a potreba bojlera (Wh) po pásmach teploty a za všetky dni (null = nenaučené).
 * @typedef {{ dni: number, od: string | null, oprava: number[][], dom: { prac: number[], vik: number[] },
 *   bojler: { pasma: Array<number | null>, vsetky: number | null } }} Naucene
 */

/** @param {number} x @param {number[]} rozsah */
const orez = (x, [od, po]) => Math.min(po, Math.max(od, x));
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

/** Trieda oblačnosti: 0 jasno, 1 polojasno, 2 zamračené. @param {number} pct */
export const triedaOblacnosti = (pct) => (pct < UCENIE.oblacnost[0] ? 0 : pct < UCENIE.oblacnost[1] ? 1 : 2);
/** Pásmo teploty dňa pre bojler: 0 zima, 1 prechodné, 2 teplo. @param {number} c */
const pasmoTeploty = (c) => (c < UCENIE.teploty[0] ? 0 : c < UCENIE.teploty[1] ? 1 : 2);
/** Je deň (YYYY-MM-DD) víkend? @param {string} d */
export const vikend = (d) => [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay());

/** Vážený priemer v políčkach tabuľky: súčet váh, vážených hodnôt a počet dní. */
function tabulka() {
    return { w: 0, x: 0, n: 0 };
}

/**
 * Model učenia z histórie. Počítajú sa dokončené dni pred dneškom, nie staršie než HISTORIA.dni a nie pred \`od\`.
 * @param {{ dni: DenHistorie[], snimky: SnimkaPredpovede[], behy: import('./bezi.js').Zapis[], today: string, od: string | null }} h
 * @returns {Naucene}
 */
export function naucene({ dni, snimky, behy, today, od }) {
    const zaciatok = addDays(today, -HISTORIA.dni);
    const platny = (/** @type {string} */ d) => d < today && d >= zaciatok && (!od || d >= od);
    const oprava = [0, 1, 2].map(() => Array.from({ length: 24 }, tabulka));
    const dom = { prac: Array.from({ length: 24 }, tabulka), vik: Array.from({ length: 24 }, tabulka) };
    /** @type {Array<{ wh: number, t: number | null }>} */ const bojler = [];
    /** @type {Set<string>} */ const pouzite = new Set();
    for (const w of dni.filter((x) => platny(x.d))) {
        const vaha = 2 ** (-(Date.parse(today) - Date.parse(w.d)) / 86400000 / UCENIE.polcasDni);
        const s = snimky.find((x) => x.d === w.d) ?? null;
        if (opravaDna(oprava, w, s, vaha) + domDna(vikend(w.d) ? dom.vik : dom.prac, w, behy, vaha) > 0) pouzite.add(w.d);
        if (w.b?.hotovo) {
            bojler.push({ wh: w.b.wh, t: s?.t ?? null });
            pouzite.add(w.d);
        }
    }
    const priemer = (/** @type {{ w: number, x: number, n: number }} */ p, /** @type {number} */ inak, /** @type {number[]} */ rozsah) =>
        p.n >= UCENIE.minDni ? r3(orez(p.x / p.w, rozsah)) : inak;
    return {
        dni: pouzite.size,
        od,
        oprava: oprava.map((riadok) => riadok.map((p) => priemer(p, 1, UCENIE.oprava))),
        dom: {
            prac: dom.prac.map((p) => priemer(p, HOUSE_BASE_KW, [PLAN_ZIVE.domMin, PLAN_ZIVE.domMax])),
            vik: dom.vik.map((p) => priemer(p, HOUSE_BASE_KW, [PLAN_ZIVE.domMin, PLAN_ZIVE.domMax])),
        },
        bojler: potrebaZDni(bojler),
    };
}

/**
 * Pomer meranie / predpoveď dňa do tabuľky opravy: hodiny po snímke predpovede, s predpoveďou aspoň UCENIE.minKw
 * a dosť meraniami. Vráti počet použitých hodín.
 * @param {Array<Array<{ w: number, x: number, n: number }>>} t @param {DenHistorie} w @param {SnimkaPredpovede | null} s @param {number} vaha
 */
function opravaDna(t, w, s, vaha) {
    if (!s) return 0;
    let n = 0;
    w.h.forEach((x, hod) => {
        const f = s.k[hod];
        const c = s.c[hod];
        if (!x || x[0] === null || x[2] < UCENIE.minMerani || f === null || f < UCENIE.minKw || c === null || hod * 60 < s.m) return;
        const p = t[triedaOblacnosti(c)][hod];
        p.w += vaha;
        p.x += vaha * orez(x[0] / f, UCENIE.pomer);
        p.n++;
        n++;
    });
    return n;
}

/**
 * Spotreba domu dňa do tabuľky: hodiny s dosť meraniami, bez hodín, keď bežal spotrebič z „Už beží“ (jeho odber
 * by sa rátal ako dom). Vráti počet použitých hodín.
 * @param {Array<{ w: number, x: number, n: number }>} t @param {DenHistorie} w @param {import('./bezi.js').Zapis[]} behy @param {number} vaha
 */
function domDna(t, w, behy, vaha) {
    const dnes = behy.filter((z) => z.d === w.d);
    let n = 0;
    w.h.forEach((x, hod) => {
        if (!x || x[1] === null || x[2] < UCENIE.minMerani) return;
        if (dnes.some((z) => z.m < (hod + 1) * 60 && z.k > hod * 60)) return;
        t[hod].w += vaha;
        t[hod].x += vaha * x[1];
        t[hod].n++;
        n++;
    });
    return n;
}

/**
 * Potreba bojlera z dní, keď ho vypol termostat (vtedy dostal celú dennú potrebu): medián po pásmach teploty a za
 * všetky dni, každý od UCENIE.minDniBojler dní.
 * @param {Array<{ wh: number, t: number | null }>} dni
 */
function potrebaZDni(dni) {
    const z = (/** @type {number[]} */ a) => (a.length >= UCENIE.minDniBojler ? Math.round(orez(median(a), UCENIE.bojlerWh)) : null);
    return {
        pasma: [0, 1, 2].map((p) => z(dni.filter((x) => x.t !== null && pasmoTeploty(x.t) === p).map((x) => x.wh))),
        vsetky: z(dni.map((x) => x.wh)),
    };
}

/** Potreba bojlera, kým sa appka nenaučí: energia programu bojlera z MOZEM_ITEMS. */
const PREDVOLENA_POTREBA_WH = (MOZEM_ITEMS.find((i) => i.id === 'bojler')?.runKwh ?? 0) * 1000;

/**
 * Koľko Wh potrebuje bojler v deň s teplotou \`tempC\`: naučené pre to pásmo, inak za všetky dni, inak predvolené.
 * @param {Naucene | null | undefined} n @param {number | null} tempC
 */
export function potrebaBojlera(n, tempC) {
    const pasmo = n && cislo(tempC) ? n.bojler.pasma[pasmoTeploty(tempC)] : null;
    return pasmo ?? n?.bojler.vsetky ?? PREDVOLENA_POTREBA_WH;
}

/** Spotreba domu po hodinách v deň \`d\` (YYYY-MM-DD), naučená, inak HOUSE_BASE_KW. @param {Naucene | null | undefined} n @param {string} d */
export function domProfil(n, d) {
    return n ? (vikend(d) ? n.dom.vik : n.dom.prac) : Array.from({ length: 24 }, () => HOUSE_BASE_KW);
}

/**
 * Predpoveď opravená tým, čo sa appka naučila (a): výkon každej hodiny krát násobok jej hodiny a oblačnosti, v dni
 * nikdy nad bezoblačný strop (\`clearKw\`) - iba ak ho prekročila už predpoveď. Súčty dní sa prepočítajú. Bez učenia
 * či bez opravy tá istá predpoveď.
 * @param {import('./solar.js').Forecast | null} forecast @param {Naucene | null | undefined} n
 * @returns {import('./solar.js').Forecast | null}
 */
export function naucenaPredpoved(forecast, n) {
    if (!forecast || !n || n.oprava.every((r) => r.every((k) => k === 1))) return forecast;
    /** @template {import('./solar.js').HourPoint & { clearKw?: number }} T @param {T} p @returns {T} */
    const bod = (p) => {
        const k = p.cloud === null ? 1 : n.oprava[triedaOblacnosti(p.cloud)][Math.floor(p.hour) % 24];
        const kw = p.kw * k;
        return { ...p, kw: r3(p.clearKw === undefined ? kw : Math.min(kw, Math.max(p.kw, p.clearKw))) };
    };
    const days = forecast.days.map((d) => {
        const hourly = d.hourly.map(bod);
        const peak = hourly.reduce((best, h) => (h.kw > best.kw ? h : best), hourly[0] ?? { hour: null, kw: 0 });
        return {
            ...d,
            hourly,
            kwhTotal: Math.round(hourly.reduce((sum, h) => sum + h.kw, 0) * 10) / 10,
            peakKw: Math.round(peak.kw * 100) / 100,
            peakHour: peak.hour,
        };
    });
    return { ...forecast, hourlyToday: forecast.hourlyToday.map(bod), hourlyTomorrow: forecast.hourlyTomorrow.map(bod), days };
}

/** Súhrn hodiny z úložiska či od Workera. @param {unknown} x */
const suhrn = (x) =>
    x === null ||
    (Array.isArray(x) && x.length === 3 && (x[0] === null || cislo(x[0])) && (x[1] === null || cislo(x[1])) && Number.isInteger(x[2]));

/**
 * História dní od Workera či z úložiska. Dáta sú nedôveryhodné: deň, ktorý nesedí, vypadne.
 * @param {unknown} raw @returns {DenHistorie[]}
 */
export function parseHistoria(raw) {
    if (!Array.isArray(raw)) return [];
    return /** @type {DenHistorie[]} */ (
        raw.filter((x) => {
            if (!isObj(x)) return false;
            const { d, h, b } = /** @type {Record<string, unknown>} */ (x);
            const bOk =
                b === null || (isObj(b) && cislo(/** @type {any} */ (b).wh) && typeof (/** @type {any} */ (b).hotovo) === 'boolean');
            return typeof d === 'string' && DATE_RE.test(d) && Array.isArray(h) && h.length === 24 && h.every(suhrn) && bOk;
        })
    ).slice(-HISTORIA.dni);
}

/** @param {unknown} a @param {number} n @returns {a is number[]} */
const cisla = (a, n) => Array.isArray(a) && a.length === n && a.every(cislo);
/** @param {unknown} x @returns {x is number | null} */
const cisloAleboNic = (x) => x === null || cislo(x);

/** Má model od Workera či z úložiska tvar Naucene? @param {unknown} raw */
function tvarNaucene(raw) {
    if (!isObj(raw)) return false;
    const { dni, od, oprava, dom, bojler } = /** @type {Record<string, any>} */ (raw);
    const odOk = od === null || DATE_RE.test(String(od));
    const opravaOk = Array.isArray(oprava) && oprava.length === 3 && oprava.every((r) => cisla(r, 24));
    const domOk = isObj(dom) && cisla(dom.prac, 24) && cisla(dom.vik, 24);
    return Number.isInteger(dni) && dni >= 0 && odOk && opravaOk && domOk && tvarBojlera(bojler);
}

/** @param {unknown} b */
function tvarBojlera(b) {
    if (!isObj(b)) return false;
    const { pasma, vsetky } = /** @type {Record<string, unknown>} */ (b);
    return Array.isArray(pasma) && pasma.length === 3 && pasma.every(cisloAleboNic) && cisloAleboNic(vsetky);
}

/**
 * Model od Workera či z úložiska telefónu (docs/navrhy/ucenie-vo-workeri.html). Dáta sú nedôveryhodné: čo nesedí,
 * je null - appka vtedy počíta sama. Hodnoty sa orežú na rozsahy, aké dáva naucene.
 * @param {unknown} raw @returns {Naucene | null}
 */
export function parseNaucene(raw) {
    if (!tvarNaucene(raw)) return null;
    const { dni, od, oprava, dom, bojler } = /** @type {Naucene} */ (raw);
    const domKw = (/** @type {number[]} */ a) => a.map((x) => orez(x, [PLAN_ZIVE.domMin, PLAN_ZIVE.domMax]));
    const wh = (/** @type {number | null} */ x) => (x === null ? null : orez(x, UCENIE.bojlerWh));
    return {
        dni,
        od,
        oprava: oprava.map((r) => r.map((/** @type {number} */ k) => orez(k, UCENIE.oprava))),
        dom: { prac: domKw(dom.prac), vik: domKw(dom.vik) },
        bojler: { pasma: bojler.pasma.map(wh), vsetky: wh(bojler.vsetky) },
    };
}

/**
 * Od ktorého dňa sa domácnosť učí („Začať odznova“), keď ho Worker drží: neskorší z toho, čo má, a čo poslal telefón
 * pri prechode (jeho ucenie-od-v1). Deň po dnešku (`today`) či nezmysel sa neráta.
 * @param {unknown} stare @param {unknown} zTelefonu @param {string} today @returns {string | null}
 */
export function spolocneOd(stare, zTelefonu, today) {
    const den = (/** @type {unknown} */ x) => (typeof x === 'string' && DATE_RE.test(x) && x <= today ? x : null);
    const a = den(stare);
    const b = den(zTelefonu);
    return a && b ? (a > b ? a : b) : (a ?? b);
}
