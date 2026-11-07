// Karta Radar: čas, os, farby a podkladová mapa. Čisté funkcie, čas vstupuje ako parameter.
// Návrh: docs/navrhy/radar.html.

import { RADAR } from './config.js';
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

/** Počet krokov osi za minulosť a za celé dve hodiny dopredu aj dozadu. */
export const krokovMinulost = RADAR.minulostMin / RADAR.krokMin;
export const krokovSpolu = krokovMinulost + RADAR.buducnostMin / RADAR.krokMin;

/** Čas zo zarovnaných minút. @param {number} ms @param {number} posunMin posun miestneho času od UTC */
export function hhmm(ms, posunMin) {
    const m = Math.round(ms / 60000) + posunMin;
    const d = ((m % 1440) + 1440) % 1440;
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
 * Čo karta píše k zobrazenej chvíli.
 * @param {RadarRozsah} rozsah @param {number} poz poloha na osi @param {number} terazMs @param {number} polnocMs @param {number} posunMin
 * @returns {{ cas: string, druh: string, predpoved: boolean }}
 */
export function popisChvile(rozsah, poz, terazMs, polnocMs, posunMin) {
    if (rozsah === '2h') {
        const krokov = Math.round(poz) - krokovMinulost;
        const min = krokov * RADAR.krokMin;
        const cas = hhmm(terazMs + min * 60000, posunMin);
        if (min === 0) return { cas, druh: 'Teraz', predpoved: false };
        return min < 0
            ? { cas, druh: `Pred ${trvanie(-min)} · meranie`, predpoved: false }
            : { cas, druh: `O ${trvanie(min)} · predpoveď`, predpoved: true };
    }
    const den = rozsah === 'dnes' ? 0 : 1;
    const ms = polnocMs + (den * 24 + Math.round(poz)) * 3600000;
    return { cas: hhmm(ms, posunMin), druh: `${rozsah === 'dnes' ? 'Dnes' : 'Zajtra'} · predpoveď modelu`, predpoved: true };
}

/**
 * Farba a krytie sily zrážok pre daný dBZ.
 * @param {number} dbz @returns {[number, number, number, number]} RGB 0–255, krytie 0–1
 */
export function farbaDbz(dbz) {
    const s = RADAR.farby;
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

/** Farba pásu osi: bajt 0 je bez dažďa. @param {number} b */
export function farbaBajtu(b) {
    const [r, g, bl] = farbaDbz(bajtNaDbz(Math.max(1, b)));
    return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(bl)})`;
}

/** Farby podľa bajtu ako textúra 256 × 1 (RGBA). Prvý bod je priehľadný. @returns {Uint8Array} */
export function dazdLut() {
    const out = new Uint8Array(256 * 4);
    for (let i = 1; i < 256; i++) {
        const [r, g, b, a] = farbaDbz(bajtNaDbz(i));
        out.set([Math.round(r), Math.round(g), Math.round(b), Math.round(a * 255)], i * 4);
    }
    return out;
}

/** Legenda ako prechod CSS. */
export const legendaPrechod = () =>
    `linear-gradient(90deg, ${RADAR.farby
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

/** Farby čiar: hranice svetlejšie, cesty sotva viditeľné. @param {any} l */
function ciara(l) {
    if (/boundary|admin/i.test(l.id)) return { ...l, paint: { 'line-color': RADAR.mapa.hranica, 'line-width': 1 } };
    return /^(highway|road)/.test(l.id) ? { ...l, paint: { 'line-color': RADAR.mapa.cesta, 'line-width': 0.8 } } : l;
}

/** @param {any} l */
function vrstvaMapy(l) {
    if (l.id === 'background') return { ...l, paint: { 'background-color': RADAR.mapa.pevnina } };
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
    return { ...styl, layers: styl.layers.filter((/** @type {{ id: string }} */ l) => !prec.test(l.id)).map(vrstvaMapy) };
}

/**
 * Pás osi: stĺpce z hodnôt v bajtoch, výška odmocninová, aby bol vidieť aj slabý dážď.
 * @param {number[]} hodnoty @returns {Array<{ poz: number, vyska: number, bajt: number }>} poz a výška 0–1
 */
export function pasOsi(hodnoty) {
    return hodnoty.flatMap((bajt, i) =>
        bajt > 0 ? [{ poz: i / Math.max(1, hodnoty.length - 1), vyska: Math.sqrt(bajt / 255), bajt }] : [],
    );
}
