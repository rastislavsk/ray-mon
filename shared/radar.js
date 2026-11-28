// Karta Radar: čas, os, farby a podkladová mapa. Čisté funkcie, čas vstupuje ako parameter.
// Návrh: docs/navrhy/radar.html.

import { MINUTES_PER_DAY, RADAR } from './config.js';
import { bajtNaDbz } from './radar-data.js';

/** @typedef {'2h' | 'dnes' | 'zajtra'} RadarRozsah */
export const RADAR_ROZSAHY = /** @type {const} */ (['2h', 'dnes', 'zajtra']);

/** @param {number} v */
const p2 = (v) => String(v).padStart(2, '0');

/** Meno snímky OPERA v UTC. @param {number} ms */
export function radarTag(ms) {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}`;
}

/** Posledný krok snímok najneskôr v danej chvíli. @param {number} ms */
export const radarKrok = (ms) => Math.floor(ms / (RADAR.krokMin * 60000)) * RADAR.krokMin * 60000;

/**
 * Či sa oplatí obnoviť snímky: ďalšia po najnovšej už mala byť zverejnená a od posledného pokusu
 * prešlo aspoň `obnovaPokusMs`. Bez snímky (prvé načítanie ešte beží) nie.
 * @param {number} najnovsiaMs čas najnovšej snímky na osi, 0 = žiadna
 * @param {number} pokusMs kedy sa obnova naposledy spustila
 * @param {number} nowMs
 */
export function obnovitRadar(najnovsiaMs, pokusMs, nowMs) {
    if (!najnovsiaMs) return false;
    const dalsia = najnovsiaMs + (RADAR.krokMin + RADAR.zverejnenieMin) * 60000;
    return nowMs >= dalsia && nowMs - pokusMs >= RADAR.obnovaPokusMs;
}

/** Počet krokov osi za minulosť a za celé dve hodiny dopredu aj dozadu. */
export const krokovMinulost = RADAR.minulostMin / RADAR.krokMin;
export const krokovSpolu = krokovMinulost + RADAR.buducnostMin / RADAR.krokMin;

/** Čas zo zarovnaných minút. @param {number} ms @param {number} posunMin posun miestneho času od UTC */
export function hhmm(ms, posunMin) {
    const m = Math.round(ms / 60000) + posunMin;
    const d = ((m % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    return `${p2(Math.floor(d / 60))}:${p2(d % 60)}`;
}

/**
 * Popisy osi. `teraz` je poloha „teraz“ v krokoch osi, v rozsahu Zajtra null.
 * @param {RadarRozsah} rozsah @param {number} terazMs čas poslednej snímky
 * @param {number} polnocMs začiatok dnešného dňa @param {number} posunMin
 * @returns {{ pocet: number, teraz: number | null, znacky: Array<{ poz: number, text: string, hlavna?: true }> }}
 */
export function osRadaru(rozsah, terazMs, polnocMs, posunMin) {
    if (rozsah === '2h') {
        const n = krokovMinulost;
        /** @param {number} poz */
        const cas = (poz) => hhmm(terazMs + (poz - n) * RADAR.krokMin * 60000, posunMin);
        return {
            pocet: krokovSpolu,
            teraz: n,
            znacky: [
                { poz: 0, text: cas(0) },
                { poz: n / 2, text: cas(n / 2) },
                { poz: n, text: 'Teraz', hlavna: true },
                { poz: (n * 3) / 2, text: cas((n * 3) / 2) },
                { poz: 2 * n, text: cas(2 * n) },
            ],
        };
    }
    const hodiny = [0, 6, 12, 18, 23].map((h) => ({ poz: h, text: `${h}:00` }));
    return { pocet: 23, teraz: rozsah === 'dnes' ? Math.max(0, Math.min(23, (terazMs - polnocMs) / 3600000)) : null, znacky: hodiny };
}

/** @param {number} min */
function trvanie(min) {
    if (min < 60) return `${min} min`;
    const zvysok = min % 60;
    return `${Math.floor(min / 60)} h${zvysok ? ` ${zvysok} min` : ''}`;
}

/**
 * Čo karta píše k zobrazenej chvíli. V rozsahu 2 h je vek každej snímky aj predpovede od chvíle `nowMs`, nie od
 * najnovšej snímky - tá je stará aspoň čas zverejnenia (docs/navrhy/radar-obnova.html, D1). `meska`: najnovšia
 * snímka je staršia ako `RADAR.meskaMin` (D3).
 * @param {RadarRozsah} rozsah @param {number} poz poloha na osi
 * @param {{ terazMs: number, polnocMs: number, posunMin: number, nowMs: number }} c najnovšia snímka, polnoc, posun miestneho času, teraz
 */
export function popisChvile(rozsah, poz, { terazMs, polnocMs, posunMin, nowMs }) {
    if (rozsah === '2h') {
        const krokov = Math.round(poz) - krokovMinulost;
        const ms = terazMs + krokov * RADAR.krokMin * 60000;
        const cas = hhmm(ms, posunMin);
        const min = Math.round((ms - nowMs) / 60000);
        if (krokov <= 0) {
            const meska = krokov === 0 && nowMs - terazMs > RADAR.meskaMin * 60000;
            return { cas, druh: `Pred ${trvanie(Math.max(1, -min))} · meranie`, predpoved: false, meska };
        }
        const druh = min > 0 ? `O ${trvanie(min)}` : min < 0 ? `Pred ${trvanie(-min)}` : 'Teraz';
        return { cas, druh: `${druh} · predpoveď`, predpoved: true, meska: false };
    }
    const den = rozsah === 'dnes' ? 0 : 1;
    const ms = polnocMs + (den * 24 + Math.round(poz)) * 3600000;
    return { cas: hhmm(ms, posunMin), druh: `${rozsah === 'dnes' ? 'Dnes' : 'Zajtra'} · predpoveď modelu`, predpoved: true, meska: false };
}

/** @typedef {0 | 1 | 2} TypZrazok dážď, dážď so snehom, sneh */

/** Palety podľa typu zrážok, v poradí `TypZrazok`. */
const PALETY = [RADAR.farby, RADAR.farbyZmiesane, RADAR.farbySneh];

/** Typ zrážok z podielu snehu 0–1 (docs/navrhy/radar-sneh.html). @param {number} podiel @returns {TypZrazok} */
export const typZrazok = (podiel) => (podiel >= RADAR.sneh.snehOd ? 2 : podiel >= RADAR.sneh.zmiesaneOd ? 1 : 0);

/**
 * Farba a krytie sily zrážok pre daný dBZ.
 * @param {number} dbz @param {TypZrazok} [typ] @returns {[number, number, number, number]} RGB 0–255, krytie 0–1
 */
export function farbaDbz(dbz, typ = 0) {
    const s = PALETY[typ];
    let i = 0;
    while (i < s.length - 2 && dbz > s[i + 1].dbz) i++;
    const a = s[i];
    const b = s[i + 1];
    const t = Math.max(0, Math.min(1, (dbz - a.dbz) / (b.dbz - a.dbz)));
    /** @param {string} hex */
    const rgb = (hex) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
    const [ca, cb] = [rgb(a.farba), rgb(b.farba)];
    return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t, a.krytie + (b.krytie - a.krytie) * t];
}

/** Farba pásu osi: bajt 0 je bez zrážok. @param {number} b @param {TypZrazok} [typ] */
export function farbaBajtu(b, typ = 0) {
    const [r, g, bl] = farbaDbz(bajtNaDbz(Math.max(1, b)), typ);
    return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(bl)})`;
}

/**
 * Farby podľa bajtu ako textúra 256 × 3 (RGBA): riadok na každý typ zrážok, prvý bod je priehľadný.
 * @returns {Uint8Array}
 */
export function dazdLut() {
    const out = new Uint8Array(256 * 4 * PALETY.length);
    for (const typ of /** @type {TypZrazok[]} */ ([0, 1, 2]))
        for (let i = 1; i < 256; i++) {
            const [r, g, b, a] = farbaDbz(bajtNaDbz(i), typ);
            out.set([Math.round(r), Math.round(g), Math.round(b), Math.round(a * 255)], (typ * 256 + i) * 4);
        }
    return out;
}

/** Legenda typu zrážok ako prechod CSS. @param {TypZrazok} typ */
export const legendaPrechod = (typ) =>
    `linear-gradient(90deg, ${PALETY[typ]
        .slice(1, -1)
        .map((f) => f.farba)
        .join(', ')})`;

const MENO = ['coalesce', ['get', 'name:sk'], ['get', 'name:latin'], ['get', 'name']];

/** Názvy: mestá pod bodom, ostatné v strede. @param {any} l */
function napis(l) {
    const mesto = /city/.test(l.id);
    const layout = { ...l.layout, 'text-field': MENO, 'text-anchor': mesto ? 'top' : 'center', 'text-offset': mesto ? [0, 0.55] : [0, 0] };
    for (const k of ['text-variable-anchor', 'text-radial-offset', 'icon-image']) delete layout[k];
    return { ...l, layout, paint: { 'text-color': RADAR.mapa.text, 'text-halo-color': RADAR.mapa.textOkraj, 'text-halo-width': 1.2 } };
}

/** Farby čiar: rieky ako voda, hranice svetlejšie, cesty sotva viditeľné. @param {any} l */
function ciara(l) {
    if (/water/.test(l.id)) return { ...l, paint: { 'line-color': RADAR.mapa.voda, 'line-width': 1 } };
    if (/boundary|admin/i.test(l.id)) return { ...l, paint: { 'line-color': RADAR.mapa.hranica, 'line-width': 1 } };
    return /^(highway|road)/.test(l.id) ? { ...l, paint: { 'line-color': RADAR.mapa.cesta, 'line-width': 0.8 } } : l;
}

/** @param {any} l */
function vrstvaMapy(l) {
    if (l.source === 'ne2_shaded') return { ...l, layout: { ...l.layout, visibility: 'none' } };
    if (l.type === 'fill' && /water/.test(l.id)) return { ...l, paint: { 'fill-color': RADAR.mapa.voda } };
    if (l.type === 'line') return ciara(l);
    return l.type === 'symbol' && l.layout?.['text-field'] ? napis(l) : l;
}

/**
 * Tmavý štýl OpenFreeMap upravený pre kartu: bez bodov záujmu a drobností, s hranicami a mestami,
 * mená po slovensky.
 * @param {any} styl @returns {any}
 */
export function upravStyl(styl) {
    const prec =
        /poi|highway-name|road_shield|aeroway|housenumber|building|landuse|park|transit|rail|bridge|tunnel|highway_(minor|path|service)|place_(village|suburb|hamlet|other)|state|province|region|boundary_(3|4|5|6|7|8|disputed)|admin_sub|^road_(path|minor|service|link|pier|area)/i;
    // Pozadie mapy preč: pod mapou je obloha appky (css/radar.css).
    const ostava = (/** @type {{ id: string, type: string }} */ l) => l.type !== 'background' && !prec.test(l.id);
    return { ...styl, layers: styl.layers.filter(ostava).map(vrstvaMapy) };
}

/**
 * Pás osi: stĺpce z hodnôt v bajtoch, výška odmocninová, aby bol vidieť aj slabý dážď. Typ zrážok farbí stĺpec.
 * @param {number[]} hodnoty @param {TypZrazok[]} [typy]
 * @returns {Array<{ poz: number, vyska: number, bajt: number, typ: TypZrazok }>} poz a výška 0–1
 */
export function pasOsi(hodnoty, typy = []) {
    return hodnoty.flatMap((bajt, i) =>
        bajt > 0 ? [{ poz: i / Math.max(1, hodnoty.length - 1), vyska: Math.sqrt(bajt / 255), bajt, typ: typy[i] ?? 0 }] : [],
    );
}
