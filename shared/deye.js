// DeyeCloud OpenAPI (https://developer.deyecloud.com/start, špecifikácia
// https://eu1-developer.deyecloud.com/v2/api-docs): adresy a prevod odpovedí na formát `pv`.
// Sieť a SHA-256 hesla sú vo Workeri (worker/src/zdroje.js).
//
// Majiteľ si na portáli Deye sám vytvorí aplikáciu (AppId, AppSecret). Token „osobného
// používateľa“ z e-mailu a hesla platí 60 dní; heslo appka neukladá, po vypršaní treba Deye
// pripojiť znova. Dátové centrum je európske (pre zariadenia v Európe, Afrike a Ázii).
//
// Jednotky výkonu ani výroby špecifikácia neuvádza. Výroba je v kWh (tak ju DeyeCloud ukazuje);
// výkon sa porovná s inštalovaným výkonom elektrárne (kWp): hodnota vyššia než jeho dvojnásobok
// nemôže byť v kW, je vo wattoch.

import { isObj } from './valid.js';
import { VyrobcaChyba } from './vyrobca.js';

/** @typedef {import('./kiosk.js').PvData} PvData */

/** Server a cesty OpenAPI. Worker sa pýta len tohto servera. */
export const DEYE = {
    base: 'https://eu1-developer.deyecloud.com',
    /** @param {string} appId */
    token: (appId) => `/v1.0/account/token?appId=${encodeURIComponent(appId)}`,
    stations: '/v1.0/station/list',
    latest: '/v1.0/station/latest',
    history: '/v1.0/station/history',
    // Token platí 60 dní.
    tokenMs: 60 * 24 * 60 * 60 * 1000,
};

/** Overí obálku odpovede (`success: true`); inak hádže s kódom. @param {unknown} json */
function ok(json) {
    if (!isObj(json) || /** @type {any} */ (json).success !== true)
        throw new VyrobcaChyba('DeyeCloud', isObj(json) ? String(/** @type {any} */ (json).code ?? '') : '');
    return /** @type {Record<string, any>} */ (json);
}

/** Token z odpovede /account/token. @param {unknown} json */
export function parseDeyeToken(json) {
    const t = ok(json).accessToken;
    if (typeof t !== 'string' || !t) throw new VyrobcaChyba('DeyeCloud', 'token');
    return t;
}

/**
 * Elektrárne na účte: id, meno, inštalovaný výkon (kWp, na určenie jednotky výkonu), časové
 * pásmo (na „dnes“) a výkon.
 * @param {unknown} json @returns {Array<{ id: number, nazov: string, kwp: number | null, tz: string, power: number | null }>}
 */
export function parseDeyeStations(json) {
    const list = ok(json).stationList;
    return (Array.isArray(list) ? list : [])
        .filter((s) => isObj(s) && Number.isSafeInteger(s.id))
        .map((s) => ({
            id: s.id,
            nazov: typeof s.name === 'string' ? s.name : '',
            kwp: num(s.installedCapacity),
            tz: typeof s.regionTimezone === 'string' ? s.regionTimezone : '',
            power: num(s.generationPower),
        }));
}

const num = (/** @type {unknown} */ v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Výkon z /station/latest (`generationPower`, jednotka podľa vysvetlenia hore). @param {unknown} json */
export const parseDeyeLatest = (json) => num(ok(json).generationPower);

/**
 * Dnešná výroba (kWh) z /station/history s granularitou dňa: `generationValue` prvého dňa.
 * @param {unknown} json @returns {number | null}
 */
export function parseDeyeDay(json) {
    const o = ok(json);
    const items = Array.isArray(o.stationDataItems) ? o.stationDataItems : [];
    return items.length && isObj(items[0]) ? num(items[0].generationValue) : null;
}

/**
 * Výkon v kW. Hodnota vyššia než dvojnásobok inštalovaného výkonu je vo wattoch; bez
 * inštalovaného výkonu sa nedá rozhodnúť a výkon ostáva prázdny.
 * @param {number | null} power @param {number | null} kwp
 */
export function deyeKw(power, kwp) {
    if (power === null || kwp === null || kwp <= 0) return null;
    return power > kwp * 2 ? power / 1000 : power;
}

/**
 * Dnešok a zajtrajšok v časovom pásme elektrárne (`yyyy-MM-dd`) pre /station/history - dni
 * od `startAt` po `endAt` (bez neho).
 * @param {Date} now @param {string} timeZone
 */
export function deyeToday(now, timeZone) {
    const day = (/** @type {Date} */ d) =>
        new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    return { startAt: day(now), endAt: day(new Date(now.getTime() + 24 * 60 * 60 * 1000)) };
}

/**
 * Meranie elektrárne.
 * @param {number | null} kw @param {number | null} dnes @param {string} nazov @param {Date} now @returns {PvData}
 */
export function deyePv(kw, dnes, nazov, now) {
    return {
        realTimePowerKw: kw,
        dailyEnergyKwh: dnes,
        monthEnergyKwh: null,
        yearEnergyKwh: null,
        cumulativeEnergyKwh: null,
        stationName: nazov || null,
        realCurveToday: [],
        measuredAt: now.toISOString(),
        updatedAt: now.toISOString(),
    };
}
