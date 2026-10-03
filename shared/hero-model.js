// Model hlavnej karty (ciferník, verdikt, spotrebiče) pre daný čas dňa.
// Rovnaká logika pre živé "teraz" aj pre náhľad iného času; líši sa len zdroj výkonu.

import { installedKw, powerThresholds, STALE_PV_MS, STALE_PV_SUN_DEG } from './config.js';
import { dayKwAt, realCurveBoundary } from './chart-model.js';
import { minutesToTimeStr, pad2 } from './format.js';
import { localMinutes, solarPosition } from './solar.js';
import { planAt } from './day-plan.js';
import { getSlotMessage, NIGHT_MESSAGES, PRICE_MESSAGES } from './messages.js';
import { autoTier, deviceStates, productionLevel, smartTier } from './tariff.js';

/**
 * @typedef {{ now: Date, tariff: import('./config.js').Tariff, pv: import('./kiosk.js').PvData | null,
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
 * a noc bez merania normálne. Bez bodu krivky zostáva čas stiahnutia. `label` je bez času -
 * hlavička ukazuje čas a slovo v dvoch riadkoch.
 * @param {{ now: Date, pv: import('./kiosk.js').PvData, site: import('./config.js').Site }} state
 * @returns {{ label: string, time: string, stale: boolean }}
 */
export function pvFreshness({ now, pv, site }) {
    const nowMinutes = localMinutes(now, site.timezone);
    const updated = new Date(pv.updatedAt);
    const fetchStale = now.getTime() - updated.getTime() > STALE_PV_MS;
    const measured = realCurveBoundary(pv.realCurveToday, nowMinutes);
    const windowStart = new Date(now.getTime() - STALE_PV_MS);
    const sunUp = solarPosition(windowStart, site.lat, site.lon).elevationDeg > STALE_PV_SUN_DEG;
    const silent = sunUp && (measured === null || (nowMinutes - measured) * 60000 > STALE_PV_MS);
    const time = minutesToTimeStr(measured === null ? localMinutes(updated, site.timezone) : measured);
    return {
        label: measured === null ? 'aktualizované' : 'meranie',
        time,
        stale: fetchStale || silent,
    };
}

/**
 * Stav živého merania do riadku v Nastavení: bodka (tone) a krátky text. Bez kiosku null -
 * kto meranie nechce, tomu nič nechýba.
 * @param {{ now: Date, pv: import('./kiosk.js').PvData | null, site: import('./config.js').Site, kiosk: string, loading: boolean }} state
 * @returns {{ tone: 'ok' | 'stale' | 'off' | 'wait', text: string } | null}
 */
export function liveStatus({ now, pv, site, kiosk, loading }) {
    if (!kiosk) return null;
    if (!pv) return loading ? { tone: 'wait', text: 'pripájam…' } : { tone: 'off', text: 'nepripojené' };
    const { time, stale } = pvFreshness({ now, pv, site });
    return stale ? { tone: 'stale', text: `zastarané · ${time}` } : { tone: 'ok', text: `pripojené · ${time}` };
}

/** "Lepšie bude o HH:00" - len naživo, keď slnko ešte nepokrýva veľké spotrebiče a predpoveď hlási silnejšie. @param {HeroInput} state @param {boolean} sunny */
function waitTimeFor(state, sunny) {
    const f = state.forecast;
    if (state.previewMinutes !== null || sunny || !f || !f.strongerWindowAhead || !Number.isFinite(f.hoursAhead)) return null;
    const hour = Math.floor(localMinutes(state.now, state.site.timezone) / 60);
    return `${pad2((hour + Math.round(/** @type {number} */ (f.hoursAhead))) % 24)}:00`;
}

/**
 * Výkon do stredu ciferníka: dve desatinné miesta, no najviac päť znakov. Šesť („100.00“) sa
 * medzi prstence nezmestí (viď .dial-num .val v style.css), preto od 100 kW ostáva jedno.
 * Bodka je tu zámerne, hoci zvyšok appky píše desatinnú čiarku: veľké číslo ako na displeji
 * meniča s ňou vyzerá lepšie. Čiarku sme skúsili (#180) a vrátili.
 * @param {number} kw
 */
function dialText(kw) {
    const text = kw.toFixed(2);
    return text.length > 5 ? kw.toFixed(1) : text;
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

/**
 * Jednotka pod číslom v ciferníku: odkiaľ výkon je. Bez výkonu (žiadne dáta, panely nie sú
 * zadané) stojí v ciferníku pomlčka - tá nie je odhad.
 * @param {number} power @param {boolean} live @param {boolean} measured
 */
function unitFor(power, live, measured) {
    if (!Number.isFinite(power)) return 'kW';
    return live ? 'kW teraz' : measured ? 'kW (merané)' : 'kW (odhad)';
}

/**
 * Odkiaľ výkon je - to isté ako `unitFor`, len ako hodnota (karta Teraz novej appky ho píše
 * vlastnými slovami). @param {number} power @param {boolean} live @param {boolean} measured
 * @returns {'live' | 'measured' | 'forecast' | null}
 */
function sourceFor(power, live, measured) {
    if (!Number.isFinite(power)) return null;
    return live ? 'live' : measured ? 'measured' : 'forecast';
}

/** @param {HeroInput} state */
export function heroModel(state) {
    const nowMinutes = localMinutes(state.now, state.site.timezone);
    const preview = state.previewMinutes !== null;
    const minutes = preview ? /** @type {number} */ (state.previewMinutes) : nowMinutes;
    const live = livePower(state);
    const power = powerFor(state, live, minutes, nowMinutes);
    const th = powerThresholds(state.plant);
    // Štvrťhodina plánu dňa: pásmo tarify a farba z krivky dňa. Pozadie (tier) sa tak zhoduje
    // so segmentom pod bežcom na prstenci; bodka (accent) počíta so živým výkonom.
    const slot = planAt(state, minutes);
    const level = slot.level;
    const message = slot.night ? NIGHT_MESSAGES[level] : getSlotMessage(level, power, state.forecast, th) || PRICE_MESSAGES[level];
    const deviceTier = smartTier(level, power, th, null);
    // Slabý deň: dnešná špička nedosiahne ani jeho hranicu, slnko veľké spotrebiče nepokryje.
    const today = state.forecast ? state.forecast.days[0] : null;
    const weakDay = !!today && today.peakKw < th.weakPeakKw;
    const boundary = realCurveBoundary(state.pv ? state.pv.realCurveToday : null, nowMinutes);
    const measured = boundary !== null && minutes <= boundary;

    return {
        minutes,
        preview,
        power,
        tier: slot.tier,
        band: slot.band,
        accent: smartTier(level, power, th),
        isNight: slot.night,
        message,
        devices: deviceStates(slot, weakDay).map((d) => ({
            ...d,
            tier: d.name === 'Auto' ? autoTier(level, power, th) : deviceTier,
        })),
        waitTime: waitTimeFor(state, slot.tier === 'green'),
        dial: dialFor(power, installedKw(state.plant), th),
        powerText: Number.isFinite(power) ? dialText(power) : '–',
        unitText: unitFor(power, live !== null, measured),
        source: sourceFor(power, live !== null, measured),
        previewLabel: preview ? `Náhľad · ${minutesToTimeStr(minutes)}` : null,
    };
}
