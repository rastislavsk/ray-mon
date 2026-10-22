// Huawei FusionSolar, Northbound API (verzia V6): účet len na čítanie, ktorý zriaďuje inštalatér.
// Podľa oficiálnej referencie SmartPVMS Plant V600R024C10 Northbound Interface Reference-V6
// (https://support.huawei.com/enterprise/en/doc/EDOC1100316809), overené proti najnovšej SmartPVMS
// 26.2.0 Northbound API Reference (EDOC1100589815): adresy, prevod odpovedí na formát `pv`
// a chybové kódy. Sieť je vo Workeri (worker/src/zdroje.js).
//
// Huawei prísne obmedzuje dopyty: prihlásenie 5-krát za 10 minút (token platí 30 minút), dáta
// v reálnom čase raz za 5 minút. Worker preto token drží v pečati a meria raz za 5 minút.

import { KIOSK } from './config.js';
import { isObj } from './valid.js';
import { VyrobcaChyba } from './vyrobca.js';

/** @typedef {import('./kiosk.js').PvData} PvData */

/** Cesty rozhrania a chybové kódy z „Error Code List“. */
export const NB = {
    login: '/thirdData/login',
    stations: '/thirdData/stations',
    // Starší zoznam elektrární (kapitola Historical Interfaces) - záloha, keď nový účet nemá povolený.
    stationsOld: '/thirdData/getStationList',
    devList: '/thirdData/getDevList',
    devReal: '/thirdData/getDevRealKpi',
    stationReal: '/thirdData/getStationRealKpi',
    // Typy zariadení, ktoré sú meniče: string inverter, residential inverter a menič s batériou
    // (PV&ESS, od SmartPVMS 26.2.0). Všetky posielajú active_power, day_cap a total_cap.
    inverterTypes: [1, 38, 23093],
    // Token je platný 30 minút; Worker ho vymení o niečo skôr, nech nevyprší počas merania.
    tokenMs: 25 * 60 * 1000,
    notLoggedIn: 305,
    tooFrequent: 407,
    // Zlé meno či heslo, zablokovaný či vypršaný účet (20400), obmedzené prihlásenie (20403),
    // neexistujúci, zakázaný či vypršaný systém (20001-20003), chýbajúce oprávnenie (401).
    badLogin: [401, 20001, 20002, 20003, 20400, 20403],
};

/** Chyba rozhrania s kódom `failCode`; údaje zamietajú len kódy prihlásenia, ostatné sú výpadok. @param {number} failCode */
const chyba = (failCode) => new VyrobcaChyba('Huawei Northbound failCode', failCode, NB.badLogin.includes(failCode));

/**
 * Server FusionSolar z toho, čo človek zadal (adresa alebo len meno servera, napr.
 * `eu5.fusionsolar.huawei.com`), alebo null. Len servery FusionSolar - ten istý zoznam ako
 * pri kiosku, aby sa z Workera nedala spraviť proxy na čokoľvek iné.
 * @param {unknown} input @returns {string | null}
 */
export function nbServer(input) {
    if (typeof input !== 'string') return null;
    const text = input.trim().toLowerCase();
    if (!text || text.length > 200) return null;
    /** @type {URL} */ let url;
    try {
        url = new URL(text.includes('://') ? text : `https://${text}`);
    } catch {
        return null;
    }
    const host = url.hostname;
    const ok = host === KIOSK.hostSuffix || host.endsWith(`.${KIOSK.hostSuffix}`);
    return url.protocol === 'https:' && ok && !url.port ? host : null;
}

/** `data` z obálky odpovede; neúspech hádže s kódom chyby. @param {unknown} json */
function data(json) {
    if (!isObj(json)) throw chyba(-1);
    const o = /** @type {Record<string, unknown>} */ (json);
    if (o.success !== true) throw chyba(typeof o.failCode === 'number' ? o.failCode : -1);
    return o.data;
}

/** Overí odpoveď prihlásenia (token je v hlavičke, nie v tele). @param {unknown} json */
export function checkNbLogin(json) {
    data(json);
}

/**
 * Elektrárne na účte: id a meno. Nové rozhranie (stations) ich má v `data.list` ako `plantCode`
 * a `plantName`; staršie (getStationList) v `data` (bez stránkovania) alebo `data.list` ako
 * `stationCode` a `stationName`.
 * @param {unknown} json @returns {Array<{ plant: string, nazov: string }>}
 */
export function parseNbStations(json) {
    const d = data(json);
    const list = Array.isArray(d)
        ? d
        : isObj(d) && Array.isArray(/** @type {any} */ (d).list)
          ? /** @type {any[]} */ (/** @type {any} */ (d).list)
          : [];
    return list
        .filter(isObj)
        .map((p) => ({ plant: p.plantCode ?? p.stationCode, nazov: p.plantName ?? p.stationName }))
        .filter((p) => typeof p.plant === 'string' && p.plant)
        .map((p) => ({ plant: p.plant, nazov: typeof p.nazov === 'string' ? p.nazov : '' }));
}

/**
 * Meniče elektrární zo zoznamu zariadení, po elektrárňach a typoch: `{ plantCode: { 1: [id…] } }`.
 * @param {unknown} json @returns {Record<string, Record<string, number[]>>}
 */
export function parseNbDevices(json) {
    const d = data(json);
    /** @type {Record<string, Record<string, number[]>>} */ const out = {};
    for (const dev of Array.isArray(d) ? d : []) {
        if (!isObj(dev) || !NB.inverterTypes.includes(dev.devTypeId) || !Number.isSafeInteger(dev.id)) continue;
        const plant = typeof dev.stationCode === 'string' ? dev.stationCode : '';
        const byType = (out[plant] ??= {});
        (byType[dev.devTypeId] ??= []).push(dev.id);
    }
    return out;
}

/**
 * Číslo z hodnoty dátovej položky. Huawei ich podľa typu v referencii posiela ako čísla, no
 * v príkladoch reálnych dát elektrárne ako text (`"day_power":"10000"`) - prijme sa oboje.
 * Prázdny text a `N/A` (neplatná hodnota) sú null.
 * @param {unknown} v @returns {number | null}
 */
function num(v) {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/**
 * Výkon meničov (`active_power`, kW) a ich dnešná a celková výroba (`day_cap`, `total_cap`,
 * kWh) z odpovedí getDevRealKpi (jedna na typ meniča), sčítané cez meniče s id z `ids` - jedna
 * odpoveď nesie meniče všetkých elektrární naraz. Čo neposlal ani jeden, je null.
 * @param {unknown[]} jsons @param {number[]} ids @returns {{ kw: number | null, day: number | null, total: number | null }}
 */
export function parseNbDevReal(jsons, ids) {
    const rows = jsons.flatMap((json) => {
        const d = data(json);
        return Array.isArray(d) ? d : [];
    });
    const maps = rows.filter((x) => isObj(x) && ids.includes(x.devId) && isObj(x.dataItemMap)).map((x) => x.dataItemMap);
    /** @param {string} key */
    const sum = (key) => {
        const v = maps.map((m) => num(m[key])).filter((x) => x !== null);
        return v.length ? v.reduce((a, b) => a + b, 0) : null;
    };
    return { kw: sum('active_power'), day: sum('day_cap'), total: sum('total_cap') };
}

/**
 * Výroba elektrárne z getStationRealKpi: dnes, mesiac a celkovo (`day_power`, `month_power`,
 * `total_power`, kWh). @param {unknown} json @param {string} plant
 * @returns {{ day: number | null, month: number | null, total: number | null }}
 */
export function parseNbStationReal(json, plant) {
    const d = data(json);
    const row = (Array.isArray(d) ? d : []).find((x) => isObj(x) && x.stationCode === plant);
    const m = row && isObj(row.dataItemMap) ? row.dataItemMap : {};
    return { day: num(m.day_power), month: num(m.month_power), total: num(m.total_power) };
}

/**
 * Meranie elektrárne: výkon z meničov, súčty z elektrárne (keď ich neposlala, z meničov).
 * @param {{ kw: number | null, day: number | null, total: number | null }} dev
 * @param {{ day: number | null, month: number | null, total: number | null }} station
 * @param {string} nazov @param {Date} now @returns {PvData}
 */
export function nbPv(dev, station, nazov, now) {
    return {
        realTimePowerKw: dev.kw,
        dailyEnergyKwh: station.day ?? dev.day,
        monthEnergyKwh: station.month,
        yearEnergyKwh: null,
        cumulativeEnergyKwh: station.total ?? dev.total,
        stationName: nazov || null,
        realCurveToday: [],
        updatedAt: now.toISOString(),
    };
}
