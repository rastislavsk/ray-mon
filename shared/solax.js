// SolaX Cloud, API pre koncových používateľov (SolaxCloud User Monitoring API V6.1,
// https://www.solaxcloud.com/user_api/SolaxCloud_User_Monitoring_API_V6.1.pdf): adresa dát
// a prevod odpovede na formát `pv`. Sieť je vo Workeri (worker/src/zdroje.js).

import { isObj } from './valid.js';

/** @typedef {import('./kiosk.js').PvData} PvData */

/** Server a cesta API. Worker sa pýta len tejto adresy. */
export const SOLAX = { api: 'https://www.solaxcloud.com/proxyApp/proxy/api/getRealtimeInfo.do' };

/**
 * Adresa dát z tokenu a registračného čísla modulu, alebo null, keď nemajú tvar z dokumentácie
 * (token 23 alebo 24 znakov, registračné číslo 10). Tolerantne k písmenám aj číslam.
 * @param {unknown} token @param {unknown} sn @returns {string | null}
 */
export function solaxUrl(token, sn) {
    if (typeof token !== 'string' || typeof sn !== 'string') return null;
    if (!/^[A-Za-z0-9]{20,40}$/.test(token) || !/^[A-Za-z0-9]{6,20}$/.test(sn)) return null;
    return `${SOLAX.api}?tokenId=${token}&sn=${sn}`;
}

const num = (/** @type {unknown} */ v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Meranie z odpovede. Výkon panelov je súčet `powerdc1`-`powerdc4` (W, strana panelov); keď ich
 * menič neposiela, výkon na výstupe `acpower`. Výroba dnes a celkovo je `yieldtoday` a `yieldtotal`
 * (kWh). Neúspešná odpoveď (`success: false`, napr. zlý token) hádže.
 * @param {unknown} json @param {Date} now @returns {PvData}
 */
export function parseSolax(json, now) {
    if (!isObj(json) || /** @type {any} */ (json).success !== true || !isObj(/** @type {any} */ (json).result))
        throw new Error('SolaX: neúspešná odpoveď');
    const r = /** @type {Record<string, unknown>} */ (/** @type {any} */ (json).result);
    const dc = ['powerdc1', 'powerdc2', 'powerdc3', 'powerdc4'].map((k) => num(r[k])).filter((v) => v !== null);
    const watts = dc.length ? dc.reduce((a, b) => a + b, 0) : num(r.acpower);
    return {
        realTimePowerKw: watts === null ? null : watts / 1000,
        dailyEnergyKwh: num(r.yieldtoday),
        monthEnergyKwh: null,
        yearEnergyKwh: null,
        cumulativeEnergyKwh: num(r.yieldtotal),
        stationName: null,
        realCurveToday: [],
        measuredAt: now.toISOString(),
        updatedAt: now.toISOString(),
    };
}
