// Obnova dát a hodiny. Nevie nič o kartách ani o DOM - pracuje s poľami stavu, ktoré majú
// obe appky (súčasná vo web/ aj nová v obloha/), takže dáta, meranie aj denník výroby
// idú v oboch tou istou cestou.

import { REFRESH, STALE_PV_MS } from '../shared/config.js';
import { recordDay } from '../shared/daylog.js';
import { localDateKey, localMinutes } from '../shared/solar.js';
import { keptForecast, loadData } from './data.js';
import { saveDayLog, saveSettings } from './storage.js';

/**
 * Polia stavu, ktoré obnova číta a zapisuje.
 * @typedef {{
 *   now: Date,
 *   known: import('../shared/settings.js').Known,
 *   site: import('../shared/config.js').Site,
 *   plant: import('../shared/config.js').Plant,
 *   tariff: import('../shared/config.js').Tariff,
 *   zdroj: import('../shared/zdroje.js').Zdroj | null,
 *   pv: import('../shared/kiosk.js').PvData | null,
 *   forecast: import('../shared/solar.js').Forecast | null,
 *   loading: boolean,
 *   dayLog: import('../shared/daylog.js').DayLog,
 * }} RefreshState
 * @typedef {{ get: () => RefreshState, setState: (patch: Partial<RefreshState>) => void }} RefreshStore
 */

/**
 * Meranie po obnove dát. Keď menič raz neodpovie, ostáva posledné meranie - appka inak na
 * minútu preskočila na odhad, z grafu zmizla nameraná krivka a o minútu sa všetko vrátilo.
 * Najviac však STALE_PV_MS od stiahnutia: staršie meranie by sa tvárilo ako výkon "teraz".
 * Bez pripojeného merania (`pvFailed` je false) sa nemá čo nechávať.
 * @param {import('../shared/kiosk.js').PvData | null} prev
 * @param {{ pv: import('../shared/kiosk.js').PvData | null, pvFailed: boolean }} result @param {Date} now
 */
export function nextPv(prev, result, now) {
    if (result.pv || !result.pvFailed || !prev) return result.pv;
    return now.getTime() - Date.parse(prev.updatedAt) <= STALE_PV_MS ? prev : null;
}

/**
 * Nový zapečatený prístup od Workera (obnovený token, alebo zapečatený holý odkaz na kiosk
 * z nastavení spred zapečatenia) uloží appka namiesto starého. Mení sa len pečať, meranie je
 * to isté - preto sa zapíše rovno do uloženého nastavenia, bez prepočtu.
 * @param {RefreshState} teraz @param {string} pecat @returns {Partial<RefreshState>}
 */
function newPecat(teraz, pecat) {
    if (!teraz.zdroj || teraz.known !== 'elektraren' || teraz.zdroj.pecat === pecat) return {};
    const zdroj = { ...teraz.zdroj, pecat };
    saveSettings({ site: teraz.site, plant: teraz.plant, tariff: teraz.tariff, zdroj });
    return { zdroj };
}

/**
 * Obnova dát pre elektráreň, ktorá je práve v stave. Beží najviac jedna naraz: kým sa
 * sťahuje, ďalšie volanie (minútový časovač, návrat z pozadia) dostane tú istú rozbehnutú -
 * inak by sa pri pomalej sieti požiadavky hromadili a staršia odpoveď mohla prepísať novšiu.
 * Nová elektráreň (uložené nastavenie) čakať nemusí, jej obnova sa rozbehne hneď.
 * @param {RefreshStore} store @returns {() => Promise<void>}
 */
export function createRefresh(store) {
    /** @type {{ site: object, plant: object, zdroj: object | null, promise: Promise<void> } | null} */
    let bezi = null;
    /** @param {Pick<import('../shared/settings.js').Settings, 'site' | 'plant' | 'zdroj'>} s */
    const obnov = async ({ site, plant, zdroj }) => {
        // Kým sa sťahuje, appka ukáže predpoveď z počasia, ktoré už má (po otvorení z prehliadača) -
        // inak by odpoveď čakala na sieť. Meranie sa neodkladá, to príde až so sieťou.
        if (!store.get().forecast) {
            const forecast = keptForecast({ site, plant }, new Date());
            if (forecast) store.setState({ forecast });
        }
        const result = await loadData({ site, plant, zdroj }, new Date());
        // Kým sa dáta sťahovali, používateľ mohol uložiť inú elektráreň. Tieto patria k starej.
        const teraz = store.get();
        if (teraz.site !== site || teraz.plant !== plant || teraz.zdroj !== zdroj) return;
        const now = new Date();
        const pv = nextPv(teraz.pv, result, now);
        // Denník dní pre súhrn: menič posiela len súčet dneška, dni si appka odkladá sama.
        const dayLog = result.pv
            ? recordDay(teraz.dayLog, localDateKey(now, site.timezone), localMinutes(now, site.timezone), result.pv.dailyEnergyKwh)
            : teraz.dayLog;
        if (dayLog !== teraz.dayLog) saveDayLog(dayLog);
        const pecat = result.pecat ? newPecat(teraz, result.pecat) : {};
        store.setState({ pv, forecast: result.forecast, loading: false, now, dayLog, ...pecat });
    };
    return () => {
        // Kým appka nepozná polohu, nie je pre čo sťahovať.
        if (store.get().known === 'nic') return Promise.resolve();
        const { site, plant, zdroj } = store.get();
        if (bezi && bezi.site === site && bezi.plant === plant && bezi.zdroj === zdroj) return bezi.promise;
        const promise = obnov({ site, plant, zdroj }).finally(() => {
            if (bezi && bezi.promise === promise) bezi = null;
        });
        bezi = { site, plant, zdroj, promise };
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
