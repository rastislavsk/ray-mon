// Počasie v pozadí karty Teraz (docs/navrhy/teraz-pocasie-2.html): aký jas (jasno, polooblačno,
// zamračené), či prší alebo sneží, či je noc, v akej fáze je Mesiac a ktoré hviezdy svietia.
// Obe appky ho kreslia po svojom, odpoveď je jedna. Čisté funkcie, čas aj dáta prichádzajú
// v parametroch.

import { HVIEZDY, POCASIE } from './config.js';
import { hviezdy } from './hviezdy.js';
import { skyWeather } from './sky.js';
import { moonPhase } from './solar.js';

/**
 * @typedef {'mrholenie' | 'slaby' | 'dazd' | 'silny'} DazdSila
 * @typedef {{ jas: import('./sky.js').SkyWeather, zrazky: import('./solar.js').Precip, dazd: DazdSila | null, noc: boolean,
 *   mesiac: number, juh: boolean, hviezdy: import('./hviezdy.js').Hviezda[] | null }} Pocasie
 *   `dazd` sila dažďa, keď prší (docs/navrhy/dazd-sily.html); `mesiac` fáza 0-1 (moonPhase); `juh`
 *   elektráreň je na južnej pologuli (kosáčik dorastá zľava); `hviezdy` v noci skutočná obloha
 *   nad elektrárňou (shared/hviezdy.js), cez deň null
 */

/**
 * Sila dažďa z úhrnu za hodinu (hranice POCASIE.dazdSila). Hodina zo staršej predpovede v cache
 * úhrn nemá - vtedy je to bežný dážď, ako ho kresba ukazovala doteraz.
 * @param {import('./solar.js').HourPoint} h @returns {DazdSila | null}
 */
function silaDazda(h) {
    if (h.precip !== 'dazd') return null;
    const { slaby, dazd, silny } = POCASIE.dazdSila;
    if (!Number.isFinite(h.mm)) return 'dazd';
    const mm = /** @type {number} */ (h.mm);
    if (mm >= silny) return 'silny';
    if (mm >= dazd) return 'dazd';
    return mm >= slaby ? 'slaby' : 'mrholenie';
}

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
 * Počasie v zvolenej chvíli karty (`chvila`, aj v náhľade iného času). Oblačnosť je z hodiny
 * predpovede (`point`), zrážky z hodiny `zrazkyPoint`: Open-Meteo dáva pri hodine úhrn za
 * hodinu, ktorá sa v nej končí, takže o 14:20 patrí k hodine 15:00 (bez nej z `point`). Keď
 * appka v tej chvíli meria, jas berie z merania (rozhodnutie z 1. 11. 2026 - predpoveď sa môže
 * mýliť, meranie nie), zrážky vždy z predpovede. Mesiac
 * a hviezdy sú z chvíle zaokrúhlenej na HVIEZDY.krokMin minút. Bez hodiny predpovede alebo bez
 * oblačnosti v nej null - kresba netvrdí počasie, ktoré appka nepozná.
 * @param {{ point: import('./solar.js').HourPoint | undefined, zrazkyPoint?: import('./solar.js').HourPoint,
 *   noc: boolean, chvila: Date,
 *   site: { lat: number, lon: number },
 *   merane: { kw: number, clearKw: number, installedKw: number } | null }} vstup
 * @returns {Pocasie | null}
 */
export function pocasie({ point, zrazkyPoint, noc, chvila, site, merane }) {
    if (!point || point.cloud === null) return null;
    const jas = (!noc && jasZMerania(merane)) || skyWeather(point.cloud);
    const krok = HVIEZDY.krokMin * 60000;
    const t = new Date(Math.round(chvila.getTime() / krok) * krok);
    const mesiac = moonPhase(t);
    return {
        jas,
        zrazky: (zrazkyPoint ?? point).precip ?? null,
        dazd: silaDazda(zrazkyPoint ?? point),
        noc,
        mesiac,
        juh: site.lat < 0,
        hviezdy: noc ? hviezdy({ chvila: t, lat: site.lat, lon: site.lon, oblacnost: point.cloud, mesiac }) : null,
    };
}
