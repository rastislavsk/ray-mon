// Živá obloha: dve farby pozadia novej appky (obloha/) z času dňa, východu a západu slnka
// v polohe elektrárne a oblačnosti z predpovede. Čas aj dáta dostáva parametrom.

import { SKY } from './config.js';
import { localDateKey, localMinutes, sunTimes } from './solar.js';

/**
 * Počasie na oblohe. Dážď zatiaľ nie je - appka zrážky nesťahuje.
 * @typedef {'jasno' | 'polojasno' | 'zamracene'} SkyWeather
 * @typedef {{ weather: SkyWeather | null, top: string, bottom: string }} Sky `weather` null = bez dát
 */

/** Počasie z oblačnosti v %. @param {number} cloudPct @returns {SkyWeather} */
export function skyWeather(cloudPct) {
    if (cloudPct < SKY.clearPct) return 'jasno';
    return cloudPct < SKY.overcastPct ? 'polojasno' : 'zamracene';
}

/** @param {string} hex `#rrggbb` @returns {number[]} */
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** @param {number[]} a @param {number[]} b @param {number} f 0 = a, 1 = b */
const mix = (a, b, f) => a.map((v, i) => Math.round(v + (b[i] - v) * f));

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
 * a v noci len štvrtinou - tmavá obloha je tmavá aj zamračená. Bez počasia (`null`, appka
 * nemá dáta) je obloha sivá.
 * @param {number} minute minúta dňa v pásme lokality (0-1439)
 * @param {{ rise: number | null, set: number | null }} sun východ a západ ako minúta dňa (sunTimes)
 * @param {SkyWeather | null} weather
 * @returns {Sky}
 */
export function skyColors(minute, sun, weather) {
    if (!weather) return { weather, top: SKY.offline[0], bottom: SKY.offline[1] };
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
    const cf = SKY.cloudMix[weather] * Math.max(0.25, Math.min(1, day));
    return { weather, top: css(mix(top, rgb(SKY.cloud[0]), cf)), bottom: css(mix(bottom, rgb(SKY.cloud[1]), cf)) };
}

/**
 * Obloha pre stav appky v tejto chvíli. Kým appka nepozná polohu, alebo dáta nie sú (a už sa
 * ani nesťahujú), je sivá. Kým sa prvé dáta sťahujú, ukazuje čas dňa bez počasia - sivé
 * bliknutie pri každom otvorení by klamalo, že dáta chýbajú. Oblačnosť je z hodiny predpovede,
 * v ktorej teraz sme; bez nej ostáva len čas dňa.
 * @param {{ now: Date, known: import('./settings.js').Known, site: import('./config.js').Site,
 *   forecast: import('./solar.js').Forecast | null, loading: boolean }} state
 * @returns {Sky}
 */
export function skyNow({ now, known, site, forecast, loading }) {
    const offline = { rise: null, set: null };
    if (known === 'nic' || (!forecast && !loading)) return skyColors(0, offline, null);
    const minute = localMinutes(now, site.timezone);
    const sun = sunTimes(site, localDateKey(now, site.timezone));
    const hour = Math.floor(minute / 60);
    const cloud = forecast?.hourlyToday.find((h) => h.hour === hour)?.cloud ?? null;
    return skyColors(minute, sun, cloud === null ? 'jasno' : skyWeather(cloud));
}
