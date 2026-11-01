// Počasie v pozadí karty Teraz (docs/navrhy/teraz-pocasie-2.html): aký jas (jasno, polooblačno,
// zamračené), či prší alebo sneží, či je noc, v akej fáze je Mesiac a ktoré hviezdy svietia.
// Obe appky ho kreslia po svojom, odpoveď je jedna. Čisté funkcie, čas aj dáta prichádzajú
// v parametroch.

import { HVIEZDY, POCASIE } from './config.js';
import { hviezdy } from './hviezdy.js';
import { skyWeather } from './sky.js';
import { moonPhase } from './solar.js';

/**
 * @typedef {{ jas: import('./sky.js').SkyWeather, zrazky: import('./solar.js').Precip, noc: boolean, mesiac: number,
 *   juh: boolean, hviezdy: import('./hviezdy.js').Hviezda[] | null }} Pocasie
 *   `mesiac` fáza 0-1 (moonPhase); `juh` elektráreň je na južnej pologuli (kosáčik dorastá zľava);
 *   `hviezdy` v noci skutočná obloha nad elektrárňou (shared/hviezdy.js), cez deň null
 */

/**
 * Jas z merania: koľko z jasnej oblohy zostava naozaj dáva. Keď by jasná obloha dala menej ako
 * POCASIE.istyPodiel výkonu zostavy (ráno, večer, v zime), podiel o oblakoch nehovorí - null.
 * @param {{ kw: number, clearKw: number, installedKw: number } | null} merane
 * @returns {import('./sky.js').SkyWeather | null}
 */
export function jasZMerania(merane) {
    if (!merane || !Number.isFinite(merane.kw) || !(merane.clearKw >= POCASIE.istyPodiel * merane.installedKw)) return null;
    const podiel = merane.kw / merane.clearKw;
    if (podiel >= POCASIE.jasno) return 'jasno';
    return podiel < POCASIE.zamracene ? 'zamracene' : 'polojasno';
}

/**
 * Počasie v zvolenej chvíli karty (`chvila`, aj v náhľade iného času). Oblačnosť a zrážky sú
 * z hodiny predpovede (`point`); keď appka v tej chvíli meria, jas berie z merania (rozhodnutie
 * z 1. 11. 2026 - predpoveď sa môže mýliť, meranie nie), zrážky vždy z predpovede. Mesiac
 * a hviezdy sú z chvíle zaokrúhlenej na HVIEZDY.krokMin minút. Bez hodiny predpovede alebo bez
 * oblačnosti v nej null - kresba netvrdí počasie, ktoré appka nepozná.
 * @param {{ point: import('./solar.js').HourPoint | undefined, noc: boolean, chvila: Date,
 *   site: { lat: number, lon: number },
 *   merane: { kw: number, clearKw: number, installedKw: number } | null }} vstup
 * @returns {Pocasie | null}
 */
export function pocasie({ point, noc, chvila, site, merane }) {
    if (!point || point.cloud === null) return null;
    const jas = (!noc && jasZMerania(merane)) || skyWeather(point.cloud);
    const krok = HVIEZDY.krokMin * 60000;
    const t = new Date(Math.round(chvila.getTime() / krok) * krok);
    const mesiac = moonPhase(t);
    return {
        jas,
        zrazky: point.precip ?? null,
        noc,
        mesiac,
        juh: site.lat < 0,
        hviezdy: noc ? hviezdy({ chvila: t, lat: site.lat, lon: site.lon, oblacnost: point.cloud, mesiac }) : null,
    };
}
