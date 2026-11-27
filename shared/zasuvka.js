// Spotrebič na zásuvke Shelly (docs/navrhy/pracka-zasuvka.html, A + U1 + K2 + S2): z minútových hlásení zásuvky
// (príkon a počítadlo energie) rozozná beh práčky, sušičky či umývačky. Beh ide do spoločných behov „Už beží“
// (shared/bezi.js) - kým beží, s koncom podľa typickej dĺžky, po skončení so skutočným. Zásuvka nič neprepína.
// Čisté funkcie: Durable Object účtu (worker/src/ucet.js) drží stav a čas dáva v parametroch.

import { MINUTES_PER_DAY, MOZEM_ITEMS, ZASUVKA } from './config.js';
import { localDateKey, localMinutes } from './solar.js';
import { isObj } from './valid.js';

const MIN = 60 * 1000;

/** ID zariadenia Shelly (napr. shellyplugmg3-8cbfea9a1b2c): len písmená, číslice a pomlčky. */
const ID_ZARIADENIA = /^[A-Za-z0-9-]{1,64}$/;

/**
 * Beh, ktorý práve beží: začiatok (ms), počítadlo energie na začiatku (Wh), miestny deň a minúta začiatku, posledná
 * chvíľa s príkonom (ms) a prvá chvíľa pod prahom (ms), kým príkon znova nestúpne.
 * @typedef {{ at: number, e0: number, d: string, m: number, nad: number, pod: number | null }} BehZasuvky
 */
/**
 * Stav jednej zásuvky: zariadenie, posledné hlásenie (čas, príkon W, energia Wh), hlásenia nad prahom za sebou pred
 * začiatkom behu (`nad`, prvé z nich `od` s energiou `e0`), beh a dokončené behy (dĺžka v minútach, energia Wh).
 * @typedef {{ id: string, at: number, w: number, e: number, nad: number, od: number | null, e0: number,
 *   beh: BehZasuvky | null, behy: Array<{ min: number, wh: number }> }} StavZasuvky
 */
/** Hlásenie zásuvky: zariadenie, čas, príkon (W) a počítadlo energie (Wh). @typedef {{ id: string, at: number, w: number, e: number }} Hlasenie */
/** Stav zásuvky pre appku: posledné hlásenie, príkon a či spotrebič beží. @typedef {{ at: number, w: number, bezi: boolean }} ZasuvkaInfo */

/** Konečné číslo. @param {unknown} v @returns {v is number} */
const cislo = (v) => typeof v === 'number' && Number.isFinite(v);

/** Môže byť spotrebič na zásuvke? @param {unknown} vec @returns {vec is string} */
export const vecZasuvky = (vec) => typeof vec === 'string' && ZASUVKA.veci.includes(vec);

/**
 * Hlásenie od skriptu (nedôveryhodné): zariadenie, príkon a energia, inak null.
 * @param {{ id: unknown, w: unknown, e: unknown }} raw @param {number} at @returns {Hlasenie | null}
 */
export function hlasenieZ(raw, at) {
    if (typeof raw.id !== 'string' || !ID_ZARIADENIA.test(raw.id) || !cislo(raw.w) || !cislo(raw.e)) return null;
    return { id: raw.id, at, w: Math.max(0, raw.w), e: Math.max(0, raw.e) };
}

/** Medián. @param {number[]} a */
function median(a) {
    const s = [...a].sort((x, y) => x - y);
    const i = Math.floor(s.length / 2);
    return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
}

/**
 * Typická dĺžka behu spotrebiča (min): medián posledných behov zo zásuvky, kým ich nie je ZASUVKA.typMinBehov, program
 * z MOZEM_ITEMS. @param {string} vec @param {StavZasuvky['behy']} behy
 */
export function typickaDlzka(vec, behy) {
    if (behy.length >= ZASUVKA.typMinBehov) return Math.round(median(behy.map((b) => b.min)));
    return MOZEM_ITEMS.find((i) => i.id === vec)?.runMin ?? 60;
}

/** Celé minúty medzi dvoma chvíľami (ms). @param {number} od @param {number} po */
const minut = (od, po) => Math.round((po - od) / MIN);

/**
 * Výsledok kroku: nový stav, beh na zápis do spoločných behov (beží alebo práve skončil), beh na zmazanie (príliš
 * krátky) a skončený beh na oznámenie (dĺžka v min, energia Wh).
 * @typedef {{ stav: StavZasuvky, zapis: import('./bezi.js').Zapis | null, zrus: import('./bezi.js').Zapis | null,
 *   skoncil: { min: number, wh: number } | null }} KrokZasuvky
 */

/**
 * Uzavrie beh v chvíli `koniec` s energiou `e` (Wh): skutočný zápis, alebo pri behu kratšom než ZASUVKA.minBehMin jeho
 * zmazanie. @param {string} vec @param {StavZasuvky} s @param {BehZasuvky} beh @param {number} koniec @param {number} e
 * @returns {Omit<KrokZasuvky, 'stav'> & { behy: StavZasuvky['behy'] }}
 */
function uzavri(vec, s, beh, koniec, e) {
    const min = minut(beh.at, koniec);
    const zapis = { id: vec, d: beh.d, m: beh.m, k: beh.m + Math.min(MINUTES_PER_DAY, Math.max(1, min)) };
    if (min < ZASUVKA.minBehMin) return { zapis: null, zrus: zapis, skoncil: null, behy: s.behy };
    const hotovy = { min, wh: Math.round(Math.max(0, e - beh.e0)) };
    return { zapis, zrus: null, skoncil: hotovy, behy: [...s.behy, hotovy].slice(-ZASUVKA.typBehov) };
}

/**
 * Jedno hlásenie zásuvky spotrebiča `vec` (K2). Bez behu: príkon aspoň ZASUVKA.zapW v ZASUVKA.potvrdenie hláseniach za
 * sebou začne beh od prvého z nich. Počas behu: príkon pod prahom aspoň ZASUVKA.pauzaMin minút ho skončí, keď trval
 * aspoň ZASUVKA.podielTyp typickej dĺžky (inak je to pauza programu), po ZASUVKA.dlhaPauzaMin minútach vždy; koniec je
 * prvá chvíľa pod prahom. Medzera v hláseniach nad ZASUVKA.tichoMin beh uzavrie poslednou chvíľou s príkonom. Bežiaci beh
 * sa zapisuje s koncom podľa typickej dĺžky, najskôr o minútu po teraz.
 * @param {string} vec @param {StavZasuvky | null} stary @param {Hlasenie} h @param {string} tz @returns {KrokZasuvky}
 */
export function krokZasuvky(vec, stary, h, tz) {
    const { s: poTichu, out } = poMedzere(vec, stary, h);
    const s = { ...poTichu, id: h.id, at: h.at, w: h.w, e: h.e };
    const r = s.beh ? vBehu(vec, s, s.beh, h) : bezBehu(s, stary, h, tz);
    if (!r.beh) return { ...out, ...r.vysledok, stav: r.stav };
    const k = r.beh.m + Math.min(MINUTES_PER_DAY, Math.max(typickaDlzka(vec, r.stav.behy), minut(r.beh.at, h.at) + 1));
    return { ...out, stav: r.stav, zapis: { id: vec, d: r.beh.d, m: r.beh.m, k } };
}

/**
 * Stav pred hlásením: po medzere nad ZASUVKA.tichoMin uzavretý beh (poslednou chvíľou s príkonom) a vynulované počítanie.
 * @param {string} vec @param {StavZasuvky | null} stary @param {Hlasenie} h
 * @returns {{ s: StavZasuvky, out: Omit<KrokZasuvky, 'stav'> }}
 */
function poMedzere(vec, stary, h) {
    const out = { zapis: null, zrus: null, skoncil: null };
    if (!stary) return { s: { id: h.id, at: h.at, w: 0, e: h.e, nad: 0, od: null, e0: h.e, beh: null, behy: [] }, out };
    if (h.at - stary.at <= ZASUVKA.tichoMin * MIN) return { s: stary, out };
    const ticho = { ...stary, beh: null, nad: 0, od: null };
    if (!stary.beh) return { s: ticho, out };
    const { behy, ...u } = uzavri(vec, stary, stary.beh, stary.beh.nad, stary.e);
    return { s: { ...ticho, behy }, out: u };
}

/**
 * Krok bez behu: hlásenia nad prahom za sebou; po ZASUVKA.potvrdenie z nich beh od prvého.
 * @param {StavZasuvky} s @param {StavZasuvky | null} stary @param {Hlasenie} h @param {string} tz
 * @returns {{ stav: StavZasuvky, beh: BehZasuvky | null, vysledok?: Partial<KrokZasuvky> }}
 */
function bezBehu(s, stary, h, tz) {
    if (h.w < ZASUVKA.zapW) return { stav: { ...s, nad: 0, od: null }, beh: null };
    const od = s.od ?? h.at;
    const e0 = s.od === null ? (stary?.e ?? h.e) : s.e0;
    if (s.nad + 1 < ZASUVKA.potvrdenie) return { stav: { ...s, nad: s.nad + 1, od, e0 }, beh: null };
    const beh = { at: od, e0, d: localDateKey(new Date(od), tz), m: localMinutes(new Date(od), tz), nad: h.at, pod: null };
    return { stav: { ...s, nad: 0, od: null, e0: h.e, beh }, beh };
}

/**
 * Krok počas behu (K2): príkon nad prahom beh drží; pod ním aspoň ZASUVKA.pauzaMin minút ho skončí, keď trval aspoň
 * ZASUVKA.podielTyp typickej dĺžky, po ZASUVKA.dlhaPauzaMin minútach vždy - koniec je prvá chvíľa pod prahom.
 * @param {string} vec @param {StavZasuvky} s @param {BehZasuvky} beh @param {Hlasenie} h
 * @returns {{ stav: StavZasuvky, beh: BehZasuvky | null, vysledok?: Partial<KrokZasuvky> }}
 */
function vBehu(vec, s, beh, h) {
    if (h.w >= ZASUVKA.zapW) {
        const dalej = { ...beh, nad: h.at, pod: null };
        return { stav: { ...s, beh: dalej }, beh: dalej };
    }
    const pod = beh.pod ?? h.at;
    const ticho = minut(pod, h.at);
    const dlhy = minut(beh.at, pod) >= ZASUVKA.podielTyp * typickaDlzka(vec, s.behy);
    if (ticho >= ZASUVKA.dlhaPauzaMin || (ticho >= ZASUVKA.pauzaMin && dlhy)) {
        const { behy, ...vysledok } = uzavri(vec, s, beh, pod, h.e);
        return { stav: { ...s, beh: null, behy }, beh: null, vysledok };
    }
    const pauza = { ...beh, pod };
    return { stav: { ...s, beh: pauza }, beh: pauza };
}

/**
 * Smie hlásiť toto zariadenie? Kým sa iné zariadenie toho istého spotrebiča ozýva (ZASUVKA.tichoMin), nie - spotrebič
 * meria jedna zásuvka. @param {StavZasuvky | null} stav @param {Hlasenie} h
 */
export const prijmiZasuvku = (stav, h) => !stav || stav.id === h.id || h.at - stav.at > ZASUVKA.tichoMin * MIN;

/**
 * Stav zásuviek pre appku z toho, čo drží Durable Object: posledné hlásenie, príkon a či beží.
 * @param {Record<string, StavZasuvky>} zasuvky @returns {Record<string, ZasuvkaInfo>}
 */
export const infoZasuviek = (zasuvky) =>
    Object.fromEntries(Object.entries(zasuvky).map(([vec, s]) => [vec, { at: s.at, w: s.w, bezi: !!s.beh }]));

/**
 * Stav zásuviek od Workera (nedôveryhodný): len spotrebiče zo ZASUVKA.veci s číslami, inak prázdny.
 * @param {unknown} raw @returns {Record<string, ZasuvkaInfo>}
 */
export function zasuvkyZ(raw) {
    if (!isObj(raw)) return {};
    /** @type {Record<string, ZasuvkaInfo>} */ const out = {};
    for (const [vec, z] of Object.entries(raw)) {
        if (!vecZasuvky(vec) || !isObj(z) || !cislo(z.at) || !cislo(z.w)) continue;
        out[vec] = { at: z.at, w: z.w, bezi: z.bezi === true };
    }
    return out;
}

/**
 * Meria spotrebič zásuvka (ozvala sa pred najviac ZASUVKA.ozyvaMin minútami)? Vtedy appka pri ňom nemá „Už beží“ (U1).
 * @param {Record<string, ZasuvkaInfo> | undefined} zasuvky @param {string} vec @param {number} now
 */
export const meria = (zasuvky, vec, now) => {
    const z = zasuvky?.[vec];
    return !!z && now - z.at <= ZASUVKA.ozyvaMin * MIN;
};

/**
 * Príkon spotrebičov na zásuvkách, ktoré sa ozývajú (kW) - do spotreby domu nepatrí, ako bojler.
 * @param {Record<string, StavZasuvky> | undefined} zasuvky @param {number} now
 */
export const prikonZasuviekKw = (zasuvky, now) =>
    Object.values(zasuvky ?? {}).reduce((sum, z) => sum + (now - z.at <= ZASUVKA.ozyvaMin * MIN ? z.w / 1000 : 0), 0);
