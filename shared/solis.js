// SolisCloud Platform API V2.0 (https://oss.soliscloud.com/templet/SolisCloud%20Platform%20API%20Document%20V2.0.pdf):
// podpis požiadavky a prevod odpovede na formát `pv`. Sieť a HMAC sú vo Workeri (worker/src/zdroje.js).
//
// Kľúč (API ID a API Secret) si majiteľ vypýta od podpory Solis, potom ho nájde v SolisCloud
// (Account → Basic Settings → API Management). Dáta sa podľa dokumentácie obnovujú raz za 5 minút.

import { md5 } from './md5.js';
import { isObj } from './valid.js';
import { VyrobcaChyba } from './vyrobca.js';

/** @typedef {import('./kiosk.js').PvData} PvData */

/** Server (aj s portom z dokumentácie) a cesta zoznamu elektrární. */
export const SOLIS = { base: 'https://www.soliscloud.com:13333', stations: '/v1/api/userStationList', contentType: 'application/json' };

/** MD5 textu ako base64 (hlavička Content-MD5). @param {string} text */
export function md5Base64(text) {
    const hex = md5(text);
    return btoa(String.fromCharCode(...Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16))));
}

const DNI = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MESIACE = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dve = (/** @type {number} */ n) => String(n).padStart(2, '0');

/** Hlavička Date vo formáte z dokumentácie (`EEE, d MMM yyyy HH:mm:ss 'GMT'`). @param {Date} now */
export function solisDate(now) {
    const t = `${dve(now.getUTCHours())}:${dve(now.getUTCMinutes())}:${dve(now.getUTCSeconds())}`;
    return `${DNI[now.getUTCDay()]}, ${now.getUTCDate()} ${MESIACE[now.getUTCMonth()]} ${now.getUTCFullYear()} ${t} GMT`;
}

/**
 * Hlavičky požiadavky bez podpisu a text, ktorý sa podpíše (HmacSHA1 s API Secret, výsledok
 * v base64 ide do `Authorization: API {apiId}:{sign}`).
 * @param {string} path @param {string} body @param {Date} now
 */
export function solisRequest(path, body, now) {
    const contentMd5 = md5Base64(body);
    const date = solisDate(now);
    return {
        headers: { 'content-md5': contentMd5, 'content-type': SOLIS.contentType, date },
        toSign: ['POST', contentMd5, SOLIS.contentType, date, path].join('\n'),
    };
}

/** Násobok na kW či kWh podľa jednotky z odpovede (`powerStr`, `dayEnergyStr` …). */
const NA_KILO = { W: 0.001, kW: 1, MW: 1000, GW: 1e6, Wh: 0.001, kWh: 1, MWh: 1000, GWh: 1e6 };

/** Hodnota v kW či kWh, alebo null pri neznámej jednotke. @param {unknown} v @param {unknown} unit */
function kilo(v, unit) {
    const k = typeof unit === 'string' ? NA_KILO[/** @type {keyof typeof NA_KILO} */ (unit)] : undefined;
    return typeof v === 'number' && Number.isFinite(v) && k !== undefined ? v * k : null;
}

/**
 * Elektrárne na účte zo zoznamu userStationList: id (ako text - čísla sú dlhšie, než JavaScript
 * presne udrží), meno a meranie.
 * @param {unknown} json @param {Date} now @returns {Array<{ id: string, nazov: string, pv: PvData }>}
 */
export function parseSolisStations(json, now) {
    // Úspech je `code: "0"`; príklad v dokumentácii pole `success` nemá, preto rozhoduje kód.
    if (!isObj(json) || String(/** @type {any} */ (json).code) !== '0')
        // Kód chyby je `code` v odpovedi, napr. I0012 zlý účet.
        throw new VyrobcaChyba('SolisCloud', isObj(json) ? String(/** @type {any} */ (json).code ?? '') : '');
    const page = /** @type {any} */ (json).data?.page;
    const records = Array.isArray(page?.records) ? /** @type {any[]} */ (page.records) : [];
    return records
        .filter((r) => isObj(r) && r.id !== undefined && r.id !== null)
        .map((r) => {
            const nazov = typeof r.stationName === 'string' ? r.stationName : '';
            return {
                id: String(r.id),
                nazov,
                pv: {
                    realTimePowerKw: kilo(r.power, r.powerStr),
                    dailyEnergyKwh: kilo(r.dayEnergy, r.dayEnergyStr),
                    monthEnergyKwh: kilo(r.monthEnergy, r.monthEnergyStr),
                    yearEnergyKwh: kilo(r.yearEnergy, r.yearEnergyStr),
                    cumulativeEnergyKwh: kilo(r.allEnergy, r.allEnergyStr),
                    stationName: nazov || null,
                    realCurveToday: [],
                    measuredAt: now.toISOString(),
                    updatedAt: now.toISOString(),
                },
            };
        });
}
