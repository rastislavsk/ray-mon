// Obnova dát a hodiny. Nevie nič o kartách ani o DOM - pracuje s poľami stavu, ktoré majú
// obe appky (súčasná vo web/ aj nová v obloha/), takže dáta, meranie aj denník výroby
// idú v oboch tou istou cestou.

import { REFRESH, STALE_PV_MS } from '../shared/config.js';
import { recordDay } from '../shared/daylog.js';
import { localDateKey, localMinutes } from '../shared/solar.js';
import { loadData } from './data.js';
import { saveDayLog } from './storage.js';

/**
 * Polia stavu, ktoré obnova číta a zapisuje.
 * @typedef {{
 *   now: Date,
 *   known: import('../shared/settings.js').Known,
 *   site: import('../shared/config.js').Site,
 *   plant: import('../shared/config.js').Plant,
 *   kiosk: string,
 *   pv: import('../shared/kiosk.js').PvData | null,
 *   forecast: import('../shared/solar.js').Forecast | null,
 *   loading: boolean,
 *   dayLog: import('../shared/daylog.js').DayLog,
 * }} RefreshState
 * @typedef {{ get: () => RefreshState, setState: (patch: Partial<RefreshState>) => void }} RefreshStore
 */

/**
 * Meranie po obnove dát. Keď kiosk raz neodpovie, ostáva posledné meranie - appka inak na
 * minútu preskočila na odhad, z grafu zmizla nameraná krivka a o minútu sa všetko vrátilo.
 * Najviac však STALE_PV_MS od stiahnutia: staršie meranie by sa tvárilo ako výkon "teraz".
 * Bez kiosku (`pvFailed` je false) sa nemá čo nechávať.
 * @param {import('../shared/kiosk.js').PvData | null} prev
 * @param {{ pv: import('../shared/kiosk.js').PvData | null, pvFailed: boolean }} result @param {Date} now
 */
export function nextPv(prev, result, now) {
    if (result.pv || !result.pvFailed || !prev) return result.pv;
    return now.getTime() - Date.parse(prev.updatedAt) <= STALE_PV_MS ? prev : null;
}

/**
 * Obnova dát pre elektráreň, ktorá je práve v stave. Beží najviac jedna naraz: kým sa
 * sťahuje, ďalšie volanie (minútový časovač, návrat z pozadia) dostane tú istú rozbehnutú -
 * inak by sa pri pomalej sieti požiadavky hromadili a staršia odpoveď mohla prepísať novšiu.
 * Nová elektráreň (uložené nastavenie) čakať nemusí, jej obnova sa rozbehne hneď.
 * @param {RefreshStore} store @returns {() => Promise<void>}
 */
export function createRefresh(store) {
    /** @type {{ site: object, plant: object, kiosk: string, promise: Promise<void> } | null} */
    let bezi = null;
    /** @param {Pick<import('../shared/settings.js').Settings, 'site' | 'plant' | 'kiosk'>} s */
    const obnov = async ({ site, plant, kiosk }) => {
        const result = await loadData({ site, plant, kiosk }, new Date());
        // Kým sa dáta sťahovali, používateľ mohol uložiť inú elektráreň. Tieto patria k starej.
        const teraz = store.get();
        if (teraz.site !== site || teraz.plant !== plant || teraz.kiosk !== kiosk) return;
        const now = new Date();
        const pv = nextPv(teraz.pv, result, now);
        // Denník dní pre súhrn: kiosk posiela len súčet dneška, dni si appka odkladá sama.
        const dayLog = result.pv
            ? recordDay(teraz.dayLog, localDateKey(now, site.timezone), localMinutes(now, site.timezone), result.pv.dailyEnergyKwh)
            : teraz.dayLog;
        if (dayLog !== teraz.dayLog) saveDayLog(dayLog);
        store.setState({ pv, forecast: result.forecast, loading: false, now, dayLog });
    };
    return () => {
        // Kým appka nepozná polohu, nie je pre čo sťahovať.
        if (store.get().known === 'nic') return Promise.resolve();
        const { site, plant, kiosk } = store.get();
        if (bezi && bezi.site === site && bezi.plant === plant && bezi.kiosk === kiosk) return bezi.promise;
        const promise = obnov({ site, plant, kiosk }).finally(() => {
            if (bezi && bezi.promise === promise) bezi = null;
        });
        bezi = { site, plant, kiosk, promise };
        return promise;
    };
}

/**
 * Hodiny každú minútu, obnova dát a návrat z pozadia. V skrytej karte sa nerobí nič -
 * po návrate ju dobehne visibilitychange.
 * @param {RefreshStore} store @param {() => Promise<void>} refresh
 */
export function startTicks(store, refresh) {
    setInterval(() => !document.hidden && store.setState({ now: new Date() }), REFRESH.clockMs);
    setInterval(() => !document.hidden && refresh(), REFRESH.dataMs);
    document.addEventListener('visibilitychange', () => !document.hidden && refresh());
}
