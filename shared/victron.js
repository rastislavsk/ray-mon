// Victron VRM API v2 (https://vrm-api-docs.victronenergy.com/): adresy a prevod odpovedí na
// formát `pv`. Sieť je vo Workeri (worker/src/zdroje.js).
//
// Výkon panelov sa skladá z posledných hodnôt diagnostiky podľa ciest D-Bus z oficiálneho popisu
// Venus OS (https://github.com/victronenergy/venus/wiki/dbus): solárne nabíjače `/Yield/Power`
// (W) a PV meniče `/Ac/Power` (W); celková výroba z `/Yield/System` a `/Ac/Energy/Forward` (kWh).
// Dnešnú výrobu dokumentácia jednoznačne nepomenúva, preto ostáva prázdna.

import { krivkaZBodov } from './krivka.js';
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
    /**
     * Výroba panelov po 15 minútach (kWh za interval) od `start` po `end` (unix sekundy).
     * @param {number} idSite @param {number} start @param {number} end
     */
    solarYield: (idSite, start, end) => `/installations/${idSite}/stats?type=solar_yield&interval=15mins&start=${start}&end=${end}`,
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
        measuredAt: now.toISOString(),
        updatedAt: now.toISOString(),
    };
}

/**
 * Priebeh dňa zo štatistiky `solar_yield` po 15 minútach: `records` má pod každým kódom
 * (výroba do batérie, spotreby, siete …) body `[čas, kWh]`. Súčet kódov v tom istom čase je výroba
 * panelov za 15 minút, štvornásobok je priemerný výkon v kW. Čas je v ms, v sekundách sa prijme tiež.
 * @param {unknown} json @param {Date} now @param {string} tz @returns {import('./krivka.js').Krivka}
 */
export function parseVictronYield(json, now, tz) {
    if (!ok(json)) throw new Error('Victron: stats bez success');
    const records = /** @type {any} */ (json).records;
    const series = isObj(records) ? Object.values(records).filter(Array.isArray) : [];
    const body = series.flatMap((rows) =>
        /** @type {unknown[]} */ (rows)
            .filter((r) => Array.isArray(r) && r.length >= 2)
            .map((r) => {
                const [t, kwh] = /** @type {[unknown, unknown]} */ (r);
                const ts = Number(t);
                const v = typeof kwh === 'number' && Number.isFinite(kwh) ? kwh * 4 : null;
                return { t: ts < 1e12 ? ts * 1000 : ts, kw: v };
            }),
    );
    return krivkaZBodov(body, now, tz);
}
