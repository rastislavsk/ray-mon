// Živá obloha: dve farby pozadia novej appky (obloha/) z času dňa, východu a západu slnka
// v polohe elektrárne a oblačnosti z predpovede. Čas aj dáta dostáva parametrom.

import { SKY } from './config.js';
import { over, parseColor, textContrast } from './contrast.js';
import { localDateKey, localMinutes, sunTimes } from './solar.js';

/**
 * Počasie na oblohe. Dážď zatiaľ nie je - appka zrážky nesťahuje.
 * @typedef {'jasno' | 'polojasno' | 'zamracene'} SkyWeather
 * @typedef {{ weather: SkyWeather | null, top: string, bottom: string, shade: string }} Sky `weather` null = bez dát,
 *   `shade` farba stmaveného spodku (skyShade)
 */

// Výšky, v ktorých sa meria kontrast textu na oblohe: od vrchu (0) po spodok obrazovky (1).
const HEIGHTS = Array.from({ length: 51 }, (_, i) => i / 50);
const WHITE = parseColor('#fff');

/**
 * Farba pozadia vo výške `t` obrazovky (0 hore, 1 dole): prechod oblohy a cez neho stmavený
 * spodok. Text, ktorý leží priamo na oblohe, má pod sebou práve toto.
 * @param {{ top: string, bottom: string, shade: string }} sky @param {number} t
 * @returns {import('./contrast.js').Rgb}
 */
export function skyAt({ top, bottom, shade }, t) {
    const [a, b, s] = [top, bottom, shade].map(parseColor);
    const sky = /** @type {import('./contrast.js').Rgb} */ ([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t));
    return over([s[0], s[1], s[2], s[3] * t], sky);
}

/**
 * Stmavený spodok pre oblohu s farbami `top` a `bottom`: farba SKY.shade s najmenšou
 * priehľadnosťou (po stotinách), pri ktorej má biely text kontrast aspoň SKY.shadeContrast
 * v každej výške obrazovky. Tmavá obloha (noc, pokojná) ju nepotrebuje vôbec, svetlý obzor
 * ráno najviac. Spodok sa tak stmaví len toľko, koľko treba, a nálada oblohy ostane.
 * @param {string} top @param {string} bottom @returns {string} farba `rgba(…)` pre CSS
 */
export function skyShade(top, bottom) {
    const [r, g, b] = parseColor(SKY.shade);
    const shade = (/** @type {number} */ a) => `rgba(${r}, ${g}, ${b}, ${a / 100})`;
    const enough = (/** @type {number} */ a) =>
        HEIGHTS.every((t) => textContrast(WHITE, skyAt({ top, bottom, shade: shade(a) }, t)) >= SKY.shadeContrast);
    // Čím sýtejší spodok, tým väčší kontrast bieleho textu - stačí pol delenia.
    let [lo, hi] = [0, 100];
    while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (enough(mid)) hi = mid;
        else lo = mid + 1;
    }
    return shade(lo);
}

/** Obloha s farbami `top` a `bottom` aj so stmaveným spodkom. @param {SkyWeather | null} weather @param {string} top @param {string} bottom @returns {Sky} */
const sky = (weather, top, bottom) => ({ weather, top, bottom, shade: skyShade(top, bottom) });

/** Počasie z oblačnosti v %. @param {number} cloudPct @returns {SkyWeather} */
export function skyWeather(cloudPct) {
    if (cloudPct < SKY.clearPct) return 'jasno';
    return cloudPct < SKY.overcastPct ? 'polojasno' : 'zamracene';
}

/** @param {string} hex `#rrggbb` @returns {number[]} */
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** @param {number[]} a @param {number[]} b @param {number} f 0 = a, 1 = b */
const mix = (a, b, f) => a.map((v, i) => Math.round(v + (b[i] - v) * f));

/** Sivá s rovnakým jasom (luma podľa Rec. 709). @param {number[]} c */
const naSivu = ([r, g, b]) => {
    const y = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    return [y, y, y];
};

/** @param {number[]} c */
const css = (c) => `rgb(${c.join(', ')})`;

/**
 * Hodina dňa z návrhu, ktorá zodpovedá minúte `minute`. Návrh má slnko vždy od 7:00 do 18:30;
 * appka do toho premietne skutočný východ a západ, každý úsek (noc pred východom, deň, večer
 * po západe) natiahne alebo stlačí rovnomerne. Kde slnko v ten deň nevyjde alebo nezapadne
 * (polárna noc, polárny deň), ostáva čas z hodín - obloha návrhu je na to dosť dobrá.
 * @param {number} minute minúta dňa v pásme lokality @param {{ rise: number | null, set: number | null }} sun
 */
function designHour(minute, sun) {
    const t = minute / 60;
    if (sun.rise === null || sun.set === null || sun.rise <= 0 || sun.rise >= sun.set) return t;
    const rise = sun.rise / 60;
    const set = sun.set / 60;
    if (t <= rise) return (t * SKY.riseH) / rise;
    if (t <= set) return SKY.riseH + ((t - rise) * (SKY.setH - SKY.riseH)) / (set - rise);
    return SKY.setH + ((t - set) * (24 - SKY.setH)) / (24 - set);
}

/**
 * Dve farby oblohy (hore a dole) v danej minúte dňa. Počasie primieša sivú, cez deň naplno
 * a v noci len štvrtinou - tmavá obloha je tmavá aj zamračená. Potom stratí časť farebného
 * odtieňa (SKY.sivost): zamračená je sivá, svetlá cez deň a tmavá v noci. Koľko z oboch, určuje
 * zamračenosť 0-1 plynule (modrosivá obloha podľa sily oblačnosti); bez nej platí stred stavu
 * `weather` (jasno 0, polojasno 0,5, zamračené 1). Bez počasia (`null`, appka nemá dáta) je obloha sivá.
 * @param {number} minute minúta dňa v pásme lokality (0-1439)
 * @param {{ rise: number | null, set: number | null }} sun východ a západ ako minúta dňa (sunTimes)
 * @param {SkyWeather | null} weather
 * @param {number} [zamracenost] 0 (jasno) až 1 (zamračené), viď shared/pocasie.js
 * @returns {Sky}
 */
export function skyColors(minute, sun, weather, zamracenost) {
    if (!weather) return sky(weather, SKY.offline[0], SKY.offline[1]);
    const t = designHour(minute, sun);
    let i = 0;
    while (SKY.keys[i + 1][0] < t) i++;
    const [ha, a1, a2] = SKY.keys[i];
    const [hb, b1, b2] = SKY.keys[i + 1];
    const f = (t - ha) / (hb - ha);
    const top = mix(rgb(a1), rgb(b1), f);
    const bottom = mix(rgb(a2), rgb(b2), f);
    const { riseH, setH } = SKY;
    const day = t >= riseH - 1 && t <= setH + 1 ? Math.sin((Math.PI * (t - riseH + 1)) / (setH - riseH + 2)) : 0;
    const z = zamracenost ?? STRED[weather];
    const cf = podlaZamracenosti(SKY.cloudMix, z) * Math.max(0.25, Math.min(1, day));
    const siva = podlaZamracenosti(SKY.sivost, z);
    const farba = (/** @type {number[]} */ c, /** @type {string} */ mrak) => {
        const m = mix(c, rgb(mrak), cf);
        return css(mix(m, naSivu(m), siva));
    };
    return sky(weather, farba(top, SKY.cloud[0]), farba(bottom, SKY.cloud[1]));
}

/** Zamračenosť, ktorú má stav počasia, keď ju appka nepozná presnejšie. */
const STRED = { jasno: 0, polojasno: 0.5, zamracene: 1 };

/**
 * Hodnota pre zamračenosť `z` medzi hodnotami pre jasno (0), polojasno (0,5) a zamračené (1).
 * @param {Record<SkyWeather, number>} tab @param {number} z
 */
function podlaZamracenosti(tab, z) {
    if (z <= 0.5) return tab.jasno + (tab.polojasno - tab.jasno) * (z / 0.5);
    return tab.polojasno + (tab.zamracene - tab.polojasno) * ((z - 0.5) / 0.5);
}

/**
 * Obloha pre stav appky v tejto chvíli. Kým appka nepozná polohu, alebo dáta nie sú (a už sa
 * ani nesťahujú), je sivá. Kým sa prvé dáta sťahujú, ukazuje čas dňa bez počasia - sivé
 * bliknutie pri každom otvorení by klamalo, že dáta chýbajú. Počasie je to isté ako v kresbe
 * na karte Teraz (`teraz`, pocasieTeraz v shared/teraz.js): jas a zamračenosť z merania alebo
 * z predpovede, pri daždi či snehu zamračené. Bez neho je oblačnosť z hodiny predpovede, v ktorej
 * teraz sme, a bez nej len čas dňa. Vypnutá živá obloha (live = false) stojí
 * v pokojných tmavých farbách (SKY.calm) a nemení sa s časom ani počasím - bez dát je ale sivá ako vždy.
 * @param {{ now: Date, known: import('./settings.js').Known, site: import('./config.js').Site,
 *   forecast: import('./solar.js').Forecast | null, loading: boolean }} state
 * @param {boolean} [live] živá obloha (Nastavenie › Vzhľad)
 * @param {Pick<import('./pocasie.js').Pocasie, 'jas' | 'zamracenost' | 'zrazky'> | null} [teraz]
 * @returns {Sky}
 */
export function skyNow({ now, known, site, forecast, loading }, live = true, teraz = null) {
    const offline = { rise: null, set: null };
    if (known === 'nic' || (!forecast && !loading)) return skyColors(0, offline, null);
    const minute = localMinutes(now, site.timezone);
    const weather = teraz ? (teraz.zrazky ? 'zamracene' : teraz.jas) : zPredpovede(forecast, minute);
    if (!live) return sky(weather, SKY.calm[0], SKY.calm[1]);
    return skyColors(minute, sunTimes(site, localDateKey(now, site.timezone)), weather, teraz?.zamracenost);
}

/**
 * Stav počasia z oblačnosti hodiny predpovede, v ktorej je minúta `minute`; bez nej jasno.
 * @param {import('./solar.js').Forecast | null} forecast @param {number} minute
 * @returns {SkyWeather}
 */
function zPredpovede(forecast, minute) {
    const cloud = forecast?.hourlyToday.find((h) => h.hour === Math.floor(minute / 60))?.cloud ?? null;
    return cloud === null ? 'jasno' : skyWeather(cloud);
}
