// Victron VRM API v2 (https://vrm-api-docs.victronenergy.com/): adresy a prevod odpovedí na
// formát `pv`. Sieť je vo Workeri (worker/src/zdroje.js).
//
// Výkon panelov sa skladá z posledných hodnôt diagnostiky podľa ciest D-Bus z oficiálneho popisu
// Venus OS (https://github.com/victronenergy/venus/wiki/dbus): solárne nabíjače `/Yield/Power`
// (W) a PV meniče `/Ac/Power` (W); celková výroba z `/Yield/System` a `/Ac/Energy/Forward` (kWh).
// Dnešnú výrobu dokumentácia jednoznačne nepomenúva, preto ostáva prázdna.

import { isObj } from './valid.js';

/** @typedef {import('./kiosk.js').PvData} PvData */

/** Server API a cesty. Worker sa pýta len tohto servera. */
export const VICTRON = {
    base: 'https://vrmapi.victronenergy.com/v2',
    me: '/users/me',
    /** @param {number} idUser */
    installations: (idUser) => `/users/${idUser}/installations`,
    /** Posledné hodnoty všetkých zariadení inštalácie. @param {number} idSite */
    diagnostics: (idSite) => `/installations/${idSite}/diagnostics?count=1000`,
};

/** Hlavičky s prístupovým tokenom (formát `Token <token>`). @param {string} token */
export const victronHeaders = (token) => ({ 'x-authorization': `Token ${token}` });

/** @param {unknown} json */
const ok = (json) => isObj(json) && /** @type {any} */ (json).success === true;

/** Id prihláseného používateľa z `/users/me`, alebo null. @param {unknown} json @returns {number | null} */
export function parseVictronMe(json) {
    const id = ok(json) && isObj(/** @type {any} */ (json).user) ? /** @type {any} */ (json).user.id : null;
    return Number.isInteger(id) ? id : null;
}

/** Inštalácie používateľa: id a meno. @param {unknown} json @returns {Array<{ idSite: number, nazov: string }>} */
export function parseVictronSites(json) {
    const records =
        ok(json) && Array.isArray(/** @type {any} */ (json).records) ? /** @type {any[]} */ (/** @type {any} */ (json).records) : [];
    return records
        .filter((r) => isObj(r) && Number.isInteger(r.idSite))
        .map((r) => ({ idSite: r.idSite, nazov: typeof r.name === 'string' ? r.name : '' }));
}

/** Cesty D-Bus, z ktorých sa skladá výkon (W) a celková výroba (kWh), podľa typu zariadenia. */
const POWER = { solarcharger: '/Yield/Power', pvinverter: '/Ac/Power' };
const TOTAL = { solarcharger: '/Yield/System', pvinverter: '/Ac/Energy/Forward' };

/**
 * Súčet hodnôt danej cesty cez všetky zariadenia; null, keď ju nemá ani jedno.
 * @param {any[]} records @param {Record<string, string>} paths
 */
function sumOf(records, paths) {
    const values = records
        .filter((r) => isObj(r) && paths[r.dbusServiceType] === r.dbusPath)
        .map((r) => Number(r.rawValue))
        .filter((v) => Number.isFinite(v));
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
}

/**
 * Meranie z diagnostiky inštalácie. Neúspešná odpoveď hádže.
 * @param {unknown} json @param {string} nazov @param {Date} now @returns {PvData}
 */
export function parseVictronPv(json, nazov, now) {
    if (!ok(json) || !Array.isArray(/** @type {any} */ (json).records)) throw new Error('Victron: neúspešná odpoveď');
    const records = /** @type {any[]} */ (/** @type {any} */ (json).records);
    const watts = sumOf(records, POWER);
    return {
        realTimePowerKw: watts === null ? null : watts / 1000,
        dailyEnergyKwh: null,
        monthEnergyKwh: null,
        yearEnergyKwh: null,
        cumulativeEnergyKwh: sumOf(records, TOTAL),
        stationName: nazov || null,
        realCurveToday: [],
        updatedAt: now.toISOString(),
    };
}
