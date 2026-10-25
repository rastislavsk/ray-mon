// Fox ESS Open API (https://www.foxesscloud.com/public/i18n/en/OpenApiDocument.html): podpis
// požiadavky a prevod odpovedí na formát `pv`. Sieť je vo Workeri (worker/src/zdroje.js).

import { krivkaZBodov } from './krivka.js';
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
    // História meniča za najviac 24 hodín (priebeh dňa). Limit 1440 dopytov denne na menič je
    // spoločný so živým meraním.
    history: '/op/v0/device/history/query',
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

/**
 * Čas bodu histórie v ms. Dokumentácia hovorí len „utc time“; živé meranie má formát
 * `yyyy-MM-dd HH:mm:ss zZ` (napr. `2024-01-10 15:20:01 CET+0100`). Posun za časom sa preto
 * použije, keď je, inak je čas v UTC. @param {unknown} text @returns {number}
 */
export function foxCas(text) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:.*?([+-])(\d{2}):?(\d{2}))?/.exec(String(text));
    if (!m) return NaN;
    const [y, mo, d, h, mi, sec] = m.slice(1, 7).map((v) => Number(v ?? 0));
    const posun = m[7] ? (m[7] === '-' ? -1 : 1) * (Number(m[8]) * 60 + Number(m[9])) : 0;
    return Date.UTC(y, mo - 1, d, h, mi, sec) - posun * 60 * 1000;
}

/**
 * Priebeh dňa z „history/query“: `pvPower` (kW, vo W sa prepočíta) v čase bodu.
 * @param {unknown} json @param {Date} now @param {string} tz @returns {import('./krivka.js').Krivka}
 */
export function parseFoxHistory(json, now, tz) {
    const r = result(json);
    const device = Array.isArray(r) ? r[0] : null;
    const datas =
        isObj(device) && Array.isArray(/** @type {any} */ (device).datas) ? /** @type {any[]} */ (/** @type {any} */ (device).datas) : [];
    const pv = datas.find((d) => isObj(d) && d.variable === 'pvPower');
    const nasobok = pv?.unit === 'W' ? 0.001 : 1;
    const body = Array.isArray(pv?.data) ? /** @type {any[]} */ (pv.data).filter(isObj) : [];
    return krivkaZBodov(
        body.map((b) => {
            const kw = num(b.value);
            return { t: foxCas(b.time), kw: kw === null ? null : kw * nasobok };
        }),
        now,
        tz,
    );
}
