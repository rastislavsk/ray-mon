// Fox ESS Open API (https://www.foxesscloud.com/public/i18n/en/OpenApiDocument.html): podpis
// požiadavky a prevod odpovedí na formát `pv`. Sieť je vo Workeri (worker/src/zdroje.js).

import { md5 } from './md5.js';
import { isObj } from './valid.js';
import { VyrobcaChyba } from './vyrobca.js';

/** @typedef {import('./kiosk.js').PvData} PvData */

/** Server a cesty Open API. Worker sa pýta len týchto. */
export const FOXESS = {
    base: 'https://www.foxesscloud.com',
    list: '/op/v0/device/list',
    real: '/op/v1/device/real/query',
    generation: '/op/v0/device/generation',
    // „Too many requests“ - výrobca neodpovedal na údaje, len pribrzdil.
    tooFrequent: 40400,
};

/**
 * Hlavičky požiadavky. Podpis je MD5 z cesty, kľúča a času v milisekundách, oddelených znakmi
 * `\r\n` - doslova, ako v ukážkovom kóde dokumentácie (`fr'{path}\r\n{token}\r\n{timestamp}'`).
 * @param {string} path @param {string} token @param {number} timestamp
 */
export function foxHeaders(path, token, timestamp) {
    return {
        token,
        timestamp: String(timestamp),
        signature: md5(`${path}\\r\\n${token}\\r\\n${timestamp}`),
        lang: 'en',
        'content-type': 'application/json',
        'user-agent': 'ray-mon',
    };
}

/** Chyba Fox ESS s číslom `errno`; „priveľa dopytov“ údaje nezamietlo, len pribrzdilo. @param {number} errno */
const chyba = (errno) => new VyrobcaChyba('Fox ESS errno', errno, errno !== FOXESS.tooFrequent);

/** `result` z obálky odpovede; nenulové `errno` hádže. @param {unknown} json */
function result(json) {
    if (!isObj(json)) throw chyba(-1);
    const o = /** @type {Record<string, unknown>} */ (json);
    if (o.errno !== 0) throw chyba(typeof o.errno === 'number' ? o.errno : -1);
    return o.result;
}

/**
 * Meniče na účte z odpovede zoznamu: sériové číslo a meno elektrárne.
 * @param {unknown} json @returns {Array<{ sn: string, nazov: string }>}
 */
export function parseFoxList(json) {
    const r = result(json);
    const data = isObj(r) && Array.isArray(/** @type {any} */ (r).data) ? /** @type {any[]} */ (/** @type {any} */ (r).data) : [];
    return data
        .filter((d) => isObj(d) && typeof d.deviceSN === 'string' && d.deviceSN)
        .map((d) => ({ sn: d.deviceSN, nazov: typeof d.stationName === 'string' ? d.stationName : '' }));
}

const num = (/** @type {unknown} */ v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Meranie z odpovedí „real/query“ (výkon panelov `pvPower` v kW) a „generation“ (dnes, mesiac
 * a celkovo v kWh). Ročný súčet ani krivku dňa tieto odpovede nemajú.
 * @param {unknown} realJson @param {unknown} genJson @param {string} nazov @param {Date} now @returns {PvData}
 */
export function parseFoxPv(realJson, genJson, nazov, now) {
    const real = result(realJson);
    const gen = /** @type {Record<string, unknown>} */ (result(genJson) ?? {});
    const device = Array.isArray(real) ? real[0] : null;
    const datas =
        isObj(device) && Array.isArray(/** @type {any} */ (device).datas) ? /** @type {any[]} */ (/** @type {any} */ (device).datas) : [];
    const pv = datas.find((d) => isObj(d) && d.variable === 'pvPower');
    return {
        realTimePowerKw: pv ? num(pv.value) : null,
        dailyEnergyKwh: num(gen.today),
        monthEnergyKwh: num(gen.month),
        yearEnergyKwh: null,
        cumulativeEnergyKwh: num(gen.cumulative),
        stationName: nazov || null,
        realCurveToday: [],
        measuredAt: now.toISOString(),
        updatedAt: now.toISOString(),
    };
}
