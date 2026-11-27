// Klimatizácia Daikin s lokálnym API (docs/navrhy/klima-daikin.html, cesta A). Skript na Shelly v domácej sieti
// (shared/klima-skript.js) posiela Workerovi surové odpovede adaptéra (`ret=OK,htemp=22.0,...`), Durable Object účtu
// z nich skladá stav (`kl:`), bod každých KLIMA.bodKrokMin minút (`kt:`) a pre appku k dnešným hodinám energie aj to,
// koľko z nich bolo zo slnka (slnkoKlimy). Čisté funkcie - čas a dáta dostanú.

import { KLIMA, MINUTES_PER_DAY } from './config.js';
import { localDateKey, localMinutes } from './solar.js';
import { DATE_RE, isObj } from './valid.js';

const MIN = 60 * 1000;

/**
 * Stav klimatizácie, ktorý drží Worker a dostane appka. Energia je vo Wh (kúrenie aj chladenie spolu `k`, z toho
 * chladenie `c`). `hod`: dnešné hodiny podľa hodín adaptéra (hodina sa zapíše až po skončení), `vcera` súčet včerajška,
 * `dni` 14 dní (prvý je dnešok), `rok` mesiace tohto (`k`, `c`) a minulého roka (`kMin`, `cMin`).
 * @typedef {{ at: number, pow: boolean, rezim: Rezim, stempC: number | null, domaC: number | null, vonkuC: number | null,
 *   hz: number | null, w: number | null, ventilator: string | null, lamely: boolean | null, chyba: number | null,
 *   behMin: number | null, hod: { d: string, k: number[], c: number[] } | null, vcera: number | null,
 *   dni: { d: string, k: number[], c: number[] } | null,
 *   rok: { r: number, k: number[], c: number[], kMin: number[], cMin: number[] } | null,
 *   wifi: number | null, fw: string | null }} KlimaInfo
 */
/** @typedef {'kurenie' | 'chladenie' | 'auto' | 'susenie' | 'ventilator'} Rezim */
/** Body vo Workeri: [minúta od 1970, teplota doma a vonku v desatinách °C (null), príkon v W (null)]. @typedef {Array<[number, number | null, number | null, number | null]>} BodyKlimy */
/** Dnešné body pre appku: [minúta dňa, °C doma, °C vonku, W]. @typedef {Array<[number, number | null, number | null, number | null]>} BodyDna */
/** Hodina energie zo slnka a zo siete vo Wh (bez merania elektrárne null). @typedef {[number, number] | null} HodinaZdroja */

/** Režimy adaptéra (`mode`): 0, 1, 7 automaticky, 2 sušenie, 3 chladenie, 4 kúrenie, 6 ventilátor. @type {Record<string, Rezim>} */
const REZIMY = { 0: 'auto', 1: 'auto', 7: 'auto', 2: 'susenie', 3: 'chladenie', 4: 'kurenie', 6: 'ventilator' };

/**
 * Hodnoty z odpovede adaptéra (`ret=OK,kluc=hodnota,...`), alebo null, keď odpoveď nie je OK. Hodnoty ostanú reťazce.
 * @param {unknown} text @returns {Record<string, string> | null}
 */
export function daikin(text) {
    if (typeof text !== 'string' || !text.startsWith('ret=OK')) return null;
    /** @type {Record<string, string>} */ const o = {};
    for (const kus of text.split(',')) {
        const i = kus.indexOf('=');
        if (i > 0) o[kus.slice(0, i)] = kus.slice(i + 1);
    }
    return o;
}

/** Číslo z hodnoty adaptéra, alebo null (`-`, `--`, prázdne). @param {string | undefined} v */
function cislo(v) {
    if (v === undefined || v === '' || (v.startsWith('-') && !/^-\d/.test(v))) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/** Teplota v °C, keď je možná, inak null. @param {string | undefined} v */
function teplota(v) {
    const t = cislo(v);
    return t !== null && t >= KLIMA.minC && t <= KLIMA.maxC ? Math.round(t * 10) / 10 : null;
}

/** Rad energie (`12/12/10/...` po KLIMA.jednotkaWh) vo Wh, alebo null, keď nemá `n` čísel. @param {string | undefined} v @param {number} n */
function rad(v, n) {
    if (typeof v !== 'string') return null;
    const a = v.split('/').map((x) => cislo(x));
    if (a.length < n || a.slice(0, n).some((x) => x === null || x < 0)) return null;
    return a.slice(0, n).map((x) => /** @type {number} */ (x) * KLIMA.jednotkaWh);
}

/** Súčet dvoch radov (kúrenie a chladenie). @param {number[]} a @param {number[]} b */
const spolu = (a, b) => a.map((x, i) => x + b[i]);

/**
 * Hlásenie skriptu: odpovede adaptéra `s` (get_sensor_info), `c` (get_control_info) a niekedy aj `d` (get_day_power_ex),
 * `w` (get_week_power_ex), `t` (get_week_power, čas behu dnes), `r` (get_year_power_ex) a `b` (basic_info). Vráti nový
 * stav - čo hlásenie nemá, ostane zo starého - alebo null, keď chýba stav či teploty.
 * @param {any} raw @param {KlimaInfo | null | undefined} stary @param {number} nowMs @param {string} tz
 * @returns {KlimaInfo | null}
 */
export function zHlasenia(raw, stary, nowMs, tz) {
    const o = isObj(raw) ? raw : {};
    const s = daikin(o.s);
    const c = daikin(o.c);
    if (!s || !c || (c.pow !== '0' && c.pow !== '1')) return null;
    const dnes = localDateKey(new Date(nowMs), tz);
    const st = stary ?? null;
    /** Odpoveď, ktorá v hlásení nie je, je prázdna. @param {unknown} v */
    const odp = (v) => daikin(v) ?? {};
    return {
        at: nowMs,
        ...teraz(s, c),
        ...hodiny(odp(o.d), dnes, st),
        dni: dniZ(odp(o.w), dnes, st),
        behMin: behZ(odp(o.t), st),
        rok: rokZ(odp(o.r), Number(dnes.slice(0, 4)), st),
        ...zakladZ(odp(o.b), st),
    };
}

/**
 * Čo hlási klimatizácia práve teraz: zapnutá, režim, teploty, kompresor, príkon, ventilátor, lamely a chyba.
 * @param {Record<string, string>} s get_sensor_info @param {Record<string, string>} c get_control_info
 */
function teraz(s, c) {
    const mompow = cislo(s.mompow);
    const lamely = cislo(c.f_dir);
    return {
        pow: c.pow === '1',
        rezim: REZIMY[c.mode] ?? 'auto',
        stempC: teplota(c.stemp),
        domaC: teplota(s.htemp),
        vonkuC: teplota(s.otemp),
        hz: cislo(s.cmpfreq),
        w: mompow === null ? null : mompow * KLIMA.jednotkaWh,
        ventilator: c.f_rate || null,
        lamely: lamely === null ? null : lamely > 0,
        chyba: cislo(s.err),
    };
}

/**
 * Kúrenie a chladenie z dvojice radov odpovede (`heat`, `cool`) ako `k` (spolu) a `c` (chladenie), alebo null.
 * @param {Record<string, string>} o @param {string} heat @param {string} cool @param {number} n
 */
function par(o, heat, cool, n) {
    const h = rad(o[heat], n);
    const c = rad(o[cool], n);
    return h && c ? { k: spolu(h, c), c } : null;
}

/**
 * Dnešné hodiny a včerajšok z get_day_power_ex. Bez novej odpovede ostanú staré, len kým sú z dneška (inak by po
 * polnoci appka ukázala včerajšie hodiny ako dnešné).
 * @param {Record<string, string>} d @param {string} dnes @param {KlimaInfo | null} st
 */
function hodiny(d, dnes, st) {
    const p = par(d, 'curr_day_heat', 'curr_day_cool', 24);
    if (p) {
        const v = par(d, 'prev_1day_heat', 'prev_1day_cool', 24);
        return { hod: { d: dnes, ...p }, vcera: v ? v.k.reduce((a, b) => a + b, 0) : null };
    }
    const hod = st?.hod?.d === dnes ? st.hod : null;
    return { hod, vcera: hod ? (st?.vcera ?? null) : null };
}

/** 14 dní z get_week_power_ex (prvý je dnešok); starý len z dneška. @param {Record<string, string>} w @param {string} dnes @param {KlimaInfo | null} st */
function dniZ(w, dnes, st) {
    const p = par(w, 'week_heat', 'week_cool', 14);
    if (p) return { d: dnes, ...p };
    return st?.dni?.d === dnes ? st.dni : null;
}
/** Minúty behu dnes z get_week_power; bez odpovede staré. @param {Record<string, string>} t @param {KlimaInfo | null} st */
function behZ(t, st) {
    const m = cislo(t.today_runtime);
    return m !== null && m >= 0 ? m : (st?.behMin ?? null);
}

/** Mesiace tohto a minulého roka z get_year_power_ex; starý len z tohto roka. @param {Record<string, string>} r @param {number} rok @param {KlimaInfo | null} st */
function rokZ(r, rok, st) {
    const t = par(r, 'curr_year_heat', 'curr_year_cool', 12);
    const m = par(r, 'prev_year_heat', 'prev_year_cool', 12);
    if (t && m) return { r: rok, k: t.k, c: t.c, kMin: m.k, cMin: m.c };
    return st?.rok?.r === rok ? st.rok : null;
}
/** Signál Wi-Fi a firmvér z basic_info; bez odpovede staré. @param {Record<string, string>} b @param {KlimaInfo | null} st */
function zakladZ(b, st) {
    const wifi = cislo(b.radio1);
    const fw = /^[\d_]+$/.test(b.ver ?? '') ? b.ver.replace(/_/g, '.') : null;
    return { wifi: wifi ?? st?.wifi ?? null, fw: fw ?? st?.fw ?? null };
}

/**
 * Body s novým hlásením: bod pribudne, len keď od posledného prešlo aspoň KLIMA.bodKrokMin minút. Staršie ako
 * KLIMA.bodyDni dní odpadnú. Keď nepribudlo nič, vráti to isté pole - Worker potom nič nezapisuje.
 * @param {BodyKlimy} body @param {KlimaInfo} k @param {number} nowMs @returns {BodyKlimy}
 */
export function pridajBod(body, k, nowMs) {
    const min = Math.floor(nowMs / MIN);
    const posledny = body[body.length - 1];
    if (posledny && min - posledny[0] < KLIMA.bodKrokMin) return body;
    const od = min - KLIMA.bodyDni * MINUTES_PER_DAY;
    const d = (/** @type {number | null} */ t) => (t === null ? null : Math.round(t * 10));
    return [...body.filter(([m]) => m > od), [min, d(k.domaC), d(k.vonkuC), k.w]];
}

/**
 * Dnešné body pre appku: [minúta dňa, °C doma, °C vonku, W].
 * @param {BodyKlimy} body @param {Date} now @param {string} tz @returns {BodyDna}
 */
export function bodyDna(body, now, tz) {
    const dnes = localDateKey(now, tz);
    /** @type {BodyDna} */ const out = [];
    for (const [m, doma, vonku, w] of body) {
        const d = new Date(m * MIN);
        if (localDateKey(d, tz) === dnes)
            out.push([localMinutes(d, tz), doma === null ? null : doma / 10, vonku === null ? null : vonku / 10, w]);
    }
    return out;
}

/**
 * Koľko z dnešnej energie klimatizácie bolo zo slnka, po hodinách: zo slnka je to, čo ostalo z výroby po zvyšku domu
 * (klimatizácia ide pred bojlerom - ten berie len prebytok domu aj s ňou, shared/bojler.js), najviac celá hodina
 * klimatizácie. Hodina bez súhrnu elektrárne je null (appka ju ráta zo siete). Súhrn je priemer výroby a medián
 * domu bez bojlera v kW (shared/historia.js), za hodinu teda kWh.
 * @param {number[]} hodK Wh klimatizácie po hodinách @param {import('./historia.js').DenHistorie | null | undefined} den
 * @returns {HodinaZdroja[]}
 */
export function slnkoKlimy(hodK, den) {
    return hodK.map((wh, h) => {
        const s = den?.h[h];
        if (!s || s[0] === null || s[1] === null) return null;
        const prebytok = s[0] * 1000 - Math.max(0, s[1] * 1000 - wh);
        const slnko = Math.round(Math.min(wh, Math.max(0, prebytok)));
        return [slnko, wh - slnko];
    });
}

/**
 * Stav klimatizácie od Workera v telefóne, alebo null, keď nesedí. K stavu Worker pridá dnešné body (`body`) a zdroje
 * dnešných hodín (`zdroje`).
 * @typedef {KlimaInfo & { body: BodyDna, zdroje: HodinaZdroja[] }} KlimaStav
 * @param {unknown} raw @returns {KlimaStav | null}
 */
export function klimaStavZ(raw) {
    if (!isObj(raw) || typeof raw.at !== 'number' || typeof raw.pow !== 'boolean' || typeof raw.rezim !== 'string') return null;
    const n = (/** @type {unknown} */ v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const rezim = /** @type {Rezim} */ (raw.rezim);
    return {
        at: raw.at,
        pow: raw.pow,
        rezim: Object.values(REZIMY).includes(rezim) ? rezim : 'auto',
        stempC: n(raw.stempC),
        domaC: n(raw.domaC),
        vonkuC: n(raw.vonkuC),
        hz: n(raw.hz),
        w: n(raw.w),
        ventilator: typeof raw.ventilator === 'string' ? raw.ventilator : null,
        lamely: typeof raw.lamely === 'boolean' ? raw.lamely : null,
        chyba: n(raw.chyba),
        behMin: n(raw.behMin),
        hod: datovanyZ(raw.hod, 24),
        vcera: n(raw.vcera),
        dni: datovanyZ(raw.dni, 14),
        rok: rokStavZ(raw.rok),
        wifi: n(raw.wifi),
        fw: typeof raw.fw === 'string' ? raw.fw : null,
        body: Array.isArray(raw.body) ? raw.body.filter(bodOk) : [],
        zdroje: Array.isArray(raw.zdroje) && raw.zdroje.length === 24 ? raw.zdroje.map(zdrojZ) : [],
    };
}

/** Rad `n` konečných čísel, inak null. @param {unknown} v @param {number} n @returns {number[] | null} */
const radZ = (v, n) => (Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? v : null);

/** Hodiny či dni s dátumom (`d`, `k`, `c` s `n` číslami), inak null. @param {unknown} o @param {number} n */
function datovanyZ(o, n) {
    if (!isObj(o) || typeof o.d !== 'string' || !DATE_RE.test(o.d)) return null;
    const k = radZ(o.k, n);
    const c = radZ(o.c, n);
    return k && c ? { d: o.d, k, c } : null;
}

/** Mesiace roka (`r`, `k`, `c`, `kMin`, `cMin` po 12 číslach), inak null. @param {unknown} o */
function rokStavZ(o) {
    if (!isObj(o) || typeof o.r !== 'number') return null;
    const [k, c, kMin, cMin] = [o.k, o.c, o.kMin, o.cMin].map((v) => radZ(v, 12));
    return k && c && kMin && cMin ? { r: o.r, k, c, kMin, cMin } : null;
}
/** @param {unknown} b @returns {b is [number, number | null, number | null, number | null]} */
const bodOk = (b) =>
    Array.isArray(b) &&
    b.length === 4 &&
    typeof b[0] === 'number' &&
    b.slice(1).every((x) => x === null || (typeof x === 'number' && Number.isFinite(x)));

/** @param {unknown} z @returns {HodinaZdroja} */
const zdrojZ = (z) =>
    Array.isArray(z) && z.length === 2 && z.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0) ? [z[0], z[1]] : null;

/** Je hlásenie čerstvé (skript sa ozval za posledných KLIMA.tichoMin minút)? @param {{ at: number }} k @param {number} nowMs */
export const klimaSpojena = (k, nowMs) => nowMs - k.at <= KLIMA.tichoMin * MIN;

/** Ukázať dlaždicu? Kým sa skript ozval za posledných KLIMA.ukazHod hodín. @param {{ at: number } | null | undefined} k @param {number} nowMs */
export const klimaUkaz = (k, nowMs) => !!k && nowMs - k.at < KLIMA.ukazHod * 60 * MIN;
