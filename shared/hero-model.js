// Model hlavnej karty (ciferník, verdikt, spotrebiče) pre daný čas dňa.
// Rovnaká logika pre živé "teraz" aj pre náhľad iného času; líši sa len zdroj výkonu.

import { installedKw, powerThresholds, STALE_PV_MS, STALE_PV_SUN_DEG } from './config.js';
import { dayKwAt, realCurveBoundary } from './chart-model.js';
import { fmt1, fmt2, minutesToTimeStr, pad2 } from './format.js';
import { localMinutes, solarPosition } from './solar.js';
import { getSlotMessage } from './messages.js';
import { autoTier, deviceStates, productionLevel, smartTier, windowAt, windowsFor } from './tariff.js';

/**
 * @typedef {{ now: Date, season: import('./config.js').Season, pv: import('./kiosk.js').PvData | null,
 *   forecast: import('./solar.js').Forecast | null, previewMinutes: number | null,
 *   site: import('./config.js').Site, plant: import('./config.js').Plant }} HeroInput
 */

/**
 * Živý výkon z kiosku, alebo null, keď ho niet: v náhľade iného času, bez kiosku, aj keď kiosk
 * výkon neposlal. Posledný prípad treba strážiť zvlášť - kontrakt `pv` null povoľuje
 * a Number(null) je 0, takže chýbajúci údaj by sa tváril ako nameraná nula.
 * @param {HeroInput} state @returns {number | null}
 */
function livePower(state) {
    const kw = state.previewMinutes === null && state.pv ? state.pv.realTimePowerKw : null;
    return Number.isFinite(kw) ? kw : null;
}

/**
 * Výkon pre danú minútu: naživo z kiosku, inak z krivky dňa (namerané/predpoveď) - v náhľade
 * aj „teraz“ bez živého výkonu. Appka tak funguje aj pre toho, kto meranie nemá.
 * @param {HeroInput} state @param {number | null} live @param {number} minutes @param {number} nowMinutes
 */
function powerFor(state, live, minutes, nowMinutes) {
    if (live !== null) return live;
    return dayKwAt(minutes, state.pv ? state.pv.realCurveToday : null, state.forecast ? state.forecast.hourlyToday : null, nowMinutes);
}

/**
 * Kedy menič naposledy meral a či je to priveľmi dávno. Čas merania je posledný bod dnešnej
 * krivky - "aktualizované" (čas stiahnutia) by pri výpadku meniča ďalej rástlo, krivka nie.
 * Mlčanie krivky je chyba, len keď slnko svietilo celé okno STALE_PV_MS; inak je večer
 * a noc bez merania normálne. Bez bodu krivky zostáva čas stiahnutia.
 * @param {{ now: Date, pv: import('./kiosk.js').PvData, site: import('./config.js').Site }} state
 * @returns {{ label: string, stale: boolean }}
 */
export function pvFreshness({ now, pv, site }) {
    const nowMinutes = localMinutes(now, site.timezone);
    const updated = new Date(pv.updatedAt);
    const fetchStale = now.getTime() - updated.getTime() > STALE_PV_MS;
    const measured = realCurveBoundary(pv.realCurveToday, nowMinutes);
    const windowStart = new Date(now.getTime() - STALE_PV_MS);
    const sunUp = solarPosition(windowStart, site.lat, site.lon).elevationDeg > STALE_PV_SUN_DEG;
    const silent = sunUp && (measured === null || (nowMinutes - measured) * 60000 > STALE_PV_MS);
    return {
        label:
            measured === null
                ? `aktualizované ${minutesToTimeStr(localMinutes(updated, site.timezone))}`
                : `meranie ${minutesToTimeStr(measured)}`,
        stale: fetchStale || silent,
    };
}

/** "Lepšie bude o HH:00" - len naživo, mimo okna so spotrebičmi a keď predpoveď hlási silnejšie slnko. @param {HeroInput} state @param {boolean} hasDevices */
function waitTimeFor(state, hasDevices) {
    const f = state.forecast;
    if (state.previewMinutes !== null || hasDevices || !f || !f.strongerWindowAhead || !Number.isFinite(f.hoursAhead)) return null;
    const hour = Math.floor(localMinutes(state.now, state.site.timezone) / 60);
    return `${pad2((hour + Math.round(/** @type {number} */ (f.hoursAhead))) % 24)}:00`;
}

/**
 * Výkon do stredu ciferníka so slovenskou desatinnou čiarkou, ako všade inde v appke: dve
 * desatinné miesta, no najviac päť znakov. Šesť („100,00“) sa medzi prstence nezmestí (viď
 * .dial-num .val v style.css), preto od 100 kW ostáva jedno.
 * @param {number} kw
 */
function dialText(kw) {
    const text = fmt2(kw);
    return text.length > 5 ? fmt1(kw) : text;
}

/**
 * Ciferník: podiel inštalovaného výkonu a farba podľa pásma výroby.
 * @param {number} power @param {number} kwp @param {import('./config.js').PowerThresholds} th
 */
function dialFor(power, kwp, th) {
    const level = productionLevel(power, th);
    /** @type {Record<string, import('./config.js').Tier>} */ const tierByLevel = { niz: 'red', str: 'amber', vys: 'green' };
    return {
        fraction: Number.isFinite(power) ? Math.max(0, Math.min(1, power / kwp)) : 0,
        tier: level ? tierByLevel[level] : null,
    };
}

/** @param {HeroInput} state */
export function heroModel(state) {
    const nowMinutes = localMinutes(state.now, state.site.timezone);
    const preview = state.previewMinutes !== null;
    const minutes = preview ? /** @type {number} */ (state.previewMinutes) : nowMinutes;
    const live = livePower(state);
    const power = powerFor(state, live, minutes, nowMinutes);
    const th = powerThresholds(state.plant);
    // Okná pokrývajú celý deň (overené testom); fallback je len poistka proti chybnému configu.
    const win = windowAt(minutes, state.season) || windowsFor(state.season)[0];
    const tier = win.status;
    const isNight = !!win.night;
    const message = (isNight ? null : getSlotMessage(tier, power, state.forecast, th)) || { headline: win.title, body: win.sub };
    const deviceTier = smartTier(tier, power, th, null);
    const measured = (() => {
        const boundary = realCurveBoundary(state.pv ? state.pv.realCurveToday : null, nowMinutes);
        return boundary !== null && minutes <= boundary;
    })();

    return {
        minutes,
        preview,
        power,
        tier,
        accent: smartTier(tier, power, th),
        isNight,
        message,
        devices: deviceStates(minutes, state.season).map((d) => ({
            ...d,
            tier: d.name === 'Auto' ? autoTier(minutes, tier, power, th) : deviceTier,
        })),
        waitTime: waitTimeFor(state, !!win.devices),
        dial: dialFor(power, installedKw(state.plant), th),
        powerText: Number.isFinite(power) ? dialText(power) : '–',
        unitText: live !== null ? 'kW teraz' : measured ? 'kW (merané)' : 'kW (odhad)',
        previewLabel: preview ? `Náhľad · ${minutesToTimeStr(minutes)}` : null,
    };
}
