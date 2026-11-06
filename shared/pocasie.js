// Počasie v pozadí karty Teraz (docs/navrhy/teraz-pocasie-2.html): aký jas (jasno, polooblačno,
// zamračené), či prší alebo sneží, či je noc, kde je Mesiac a ktoré hviezdy svietia.
// Čisté funkcie, čas aj dáta prichádzajú
// v parametroch.

import { HVIEZDY, POCASIE, SKY } from './config.js';
import { hviezdy } from './hviezdy.js';
import { mesiacNaOblohe, mesiacVPoli } from './mesiac.js';
import { skyWeather } from './sky.js';

/**
 * @typedef {'mrholenie' | 'slaby' | 'dazd' | 'silny'} DazdSila
 * @typedef {{ jas: import('./sky.js').SkyWeather, zamracenost: number, zrazky: import('./solar.js').Precip, dazd: DazdSila | null,
 *   noc: boolean, mesiac: import('./mesiac.js').MesiacVPoli | null, hviezdy: import('./hviezdy.js').Hviezda[] | null }} Pocasie
 *   `zamracenost` 0 (jasno) až 1 (zamračené) z toho istého zdroja ako `jas`, pri zrážkach 1 - podľa nej
 *   je modrosivá Obloha (docs/navrhy/obloha-farba-podla-pocasia.html);
 *   `dazd` sila dažďa, keď prší (docs/navrhy/dazd-sily.html); `mesiac` v noci skutočný Mesiac v poli pohľadu
 *   (shared/mesiac.js), null keď tam nie je; `hviezdy` v noci skutočná obloha nad elektrárňou
 *   (shared/hviezdy.js), cez deň null
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
    const podiel = podielZMerania(merane);
    if (podiel === null) return null;
    if (podiel >= POCASIE.jasno) return 'jasno';
    return podiel < POCASIE.zamracene ? 'zamracene' : 'polojasno';
}

/** Podiel z jasnej oblohy, keď o oblakoch niečo hovorí (jasZMerania), inak null. @param {Parameters<typeof jasZMerania>[0]} merane */
function podielZMerania(merane) {
    if (!merane || !Number.isFinite(merane.kw) || !(merane.clearKw >= POCASIE.istyPodiel * merane.installedKw)) return null;
    return merane.kw / merane.clearKw;
}

/** @param {number} x */
const do01 = (x) => Math.min(1, Math.max(0, x));

/**
 * Zamračenosť 0-1 z toho istého zdroja ako jas (pocasie): z podielu merania medzi hranicami
 * POCASIE.jasno (0) a POCASIE.zamracene (1), inak z oblačnosti predpovede medzi SKY.clearPct (0)
 * a SKY.overcastPct (1). Pri daždi či snehu je obloha zatiahnutá - 1.
 * @param {number} cloud oblačnosť z predpovede (%) @param {number | null} podiel z merania, null = nemeria
 * @param {boolean} zrazky
 */
function zamracenostZ(cloud, podiel, zrazky) {
    if (zrazky) return 1;
    if (podiel !== null) return do01((POCASIE.jasno - podiel) / (POCASIE.jasno - POCASIE.zamracene));
    return do01((cloud - SKY.clearPct) / (SKY.overcastPct - SKY.clearPct));
}

/**
 * Mesiac na kresbe (cez deň a pod obzorom nie je) a fáza, ktorou rozjasňuje oblohu: pod obzorom 0.
 * @param {Date} t @param {boolean} noc @param {{ lat: number, lon: number }} site
 */
function mesiacVNoci(t, noc, site) {
    const m = noc ? mesiacNaOblohe(t, site.lat, site.lon) : null;
    if (!m || m.vyska < HVIEZDY.minVyska) return { mesiac: null, jasOblohy: 0 };
    return { mesiac: mesiacVPoli(m), jasOblohy: m.faza };
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
    const podiel = noc ? null : podielZMerania(merane);
    const jas = (!noc && jasZMerania(merane)) || skyWeather(point.cloud);
    const zrazky = (zrazkyPoint ?? point).precip ?? null;
    const krok = HVIEZDY.krokMin * 60000;
    const t = new Date(Math.round(chvila.getTime() / krok) * krok);
    const { mesiac, jasOblohy } = mesiacVNoci(t, noc, site);
    return {
        jas,
        zamracenost: zamracenostZ(point.cloud, podiel, zrazky !== null),
        zrazky,
        dazd: silaDazda(zrazkyPoint ?? point),
        noc,
        mesiac,
        hviezdy: noc ? hviezdy({ chvila: t, lat: site.lat, lon: site.lon, oblacnost: point.cloud, mesiac: jasOblohy }) : null,
    };
}
