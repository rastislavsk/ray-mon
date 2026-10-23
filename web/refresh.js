// Obnova dát a hodiny. Nevie nič o kartách ani o DOM - pracuje s poľami stavu, ktoré majú
// obe appky (súčasná vo web/ aj nová v obloha/), takže dáta, meranie aj denník výroby
// idú v oboch tou istou cestou.

import { REFRESH, STALE_PV_MS } from '../shared/config.js';
import { recordDay } from '../shared/daylog.js';
import { minutesToTimeStr } from '../shared/format.js';
import { neplati, odmietnute, znovaDue } from '../shared/pristup.js';
import { localDateKey, localMinutes } from '../shared/solar.js';
import { doplnSucty, suctyZdroj } from '../shared/sucty.js';
import { dalsiRytmus, pvDue, rytmusOf } from '../shared/zdroje.js';
import { keptForecast, loadData } from './data.js';
import {
    loadOdmietnutie,
    loadRytmus,
    loadSettings,
    loadSucty,
    saveDayLog,
    saveOdmietnutie,
    saveRytmus,
    saveSettings,
    saveSucty,
} from './storage.js';

/**
 * Polia stavu, ktoré obnova číta a zapisuje.
 * @typedef {{
 *   now: Date,
 *   known: import('../shared/settings.js').Known,
 *   site: import('../shared/config.js').Site,
 *   plant: import('../shared/config.js').Plant,
 *   tariff: import('../shared/config.js').Tariff,
 *   zdroj: import('../shared/zdroje.js').Zdroj | null,
 *   pristup: import('../shared/pristup.js').Odmietnutie | null,
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
 * Meranie od Workera so súčtami, ktoré výrobca neposlal (rok, mesiac, pri Victrone dnešok),
 * dopočítanými z celkovej výroby (shared/sucty.js). Čas merania, nie obnovy: meranie od druhej
 * appky mohlo prísť skôr. Kotvy sú spoločné pre obe appky, zapíšu sa hneď.
 * @param {import('../shared/kiosk.js').PvData | null} pv @param {import('../shared/zdroje.js').Zdroj | null} zdroj
 * @param {import('../shared/config.js').Site} site
 */
function sSuctami(pv, zdroj, site) {
    if (!pv || !zdroj) return pv;
    const at = new Date(pv.updatedAt);
    const cas = minutesToTimeStr(localMinutes(at, site.timezone));
    const { pv: plne, sucty } = doplnSucty(loadSucty(), suctyZdroj(zdroj), pv, localDateKey(at, site.timezone), cas);
    if (sucty) saveSucty(sucty);
    return plne;
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
 * Odmietnutý prístup po obnove: ďalšie odmietnutie sa pripočíta, úspešné meranie ho zmaže,
 * výpadok (ani jedno) ho nechá. Zapíše sa aj do úložiska, aby appka po otvorení neskúšala zlé
 * heslo hneď znova. Bez merania, ktoré sa pýtalo, nie je čo meniť (undefined).
 * @param {RefreshState} teraz @param {import('./data.js').DataResult} result @param {Date} now @param {boolean} skus
 * @returns {Partial<RefreshState>}
 */
function nextPristup(teraz, result, now, skus) {
    if (!teraz.zdroj) return {};
    if (result.odmietnute !== null) {
        const pristup = odmietnute(teraz.pristup, teraz.zdroj, now, result.odmietnute, skus);
        saveOdmietnutie(pristup);
        return { pristup };
    }
    if (!result.pv || !teraz.pristup) return {};
    saveOdmietnutie(null);
    return { pristup: null };
}

/**
 * Meranie a odmietnutý prístup po obnove, ktorá sa na meranie pýtala. Keď prístup neplatí,
 * posledné meranie sa už nevráti - nenechá sa tváriť ako „teraz“.
 * @param {RefreshState} teraz @param {import('./data.js').DataResult} result @param {Date} now @param {boolean} skus
 * @returns {Partial<RefreshState>}
 */
function nextMeranie(teraz, result, now, skus) {
    const pristup = nextPristup(teraz, result, now, skus);
    const zamietnute = !!pristup.pristup && neplati(pristup.pristup, teraz.zdroj);
    return { pv: zamietnute ? null : nextPv(teraz.pv, result, now), ...pristup };
}

/**
 * Pýtať sa teraz na meranie? Výrobca obmedzuje dopyty a jeho cloud dáta obnovuje po svojom: kým
 * meranie nie je staršie než interval spôsobu (shared/zdroje.js), ostáva posledné a Worker sa
 * nepýta. Po odmietnutom prístupe rozhoduje, kedy to skúsiť znova (shared/pristup.js), a „Skúsiť
 * znova“ (`skus`) sa pýta hneď.
 * `lastAt` je posledný dopyt v tomto prehliadači - aj z druhej appky (Rytmus v shared/zdroje.js).
 * @param {RefreshState} s @param {import('../shared/zdroje.js').Zdroj | null} zdroj @param {boolean} skus @param {number} lastAt
 */
function pvNow(s, zdroj, skus, lastAt) {
    if (!zdroj || skus) return true;
    const at = new Date();
    return znovaDue(s.pristup, zdroj, at, lastAt) ?? pvDue(zdroj, s.pv, at, lastAt);
}

/**
 * Čo medzitým zapísala druhá appka v tom istom prehliadači: obnovený prístup (nová pečať
 * v uloženom nastavení toho istého merania) a odmietnutie. Appka ich prevezme pred dopytom -
 * so starým tokenom by sa Huawei prihlásila znova a druhej appke by prihlásenie zrušila.
 * @param {RefreshState} s @returns {Partial<RefreshState>}
 */
function zUloziska(s) {
    const ulozeny = s.known === 'elektraren' && s.zdroj ? loadSettings()?.zdroj : null;
    const ten = ulozeny && s.zdroj && ulozeny.sposob === s.zdroj.sposob && ulozeny.nazov === s.zdroj.nazov;
    const zdroj = ten && ulozeny.pecat !== s.zdroj?.pecat ? { zdroj: ulozeny } : {};
    const odm = loadOdmietnutie();
    const pristup = odm && JSON.stringify(odm) !== JSON.stringify(s.pristup) ? { pristup: odm } : {};
    return { ...zdroj, ...pristup };
}

/**
 * Meranie, keď sa appka nepýtala: novšie z toho, čo má, a čo medzitým namerala druhá appka.
 * Keď prístup neplatí, nič.
 * @param {RefreshState} teraz @param {import('../shared/zdroje.js').Rytmus | null} rytmus
 */
function bezDopytu(teraz, rytmus) {
    const ine = rytmus?.pv;
    if (!ine || neplati(teraz.pristup, teraz.zdroj)) return { pv: teraz.pv };
    const novsie = !teraz.pv || Date.parse(ine.updatedAt) > Date.parse(teraz.pv.updatedAt);
    return { pv: novsie ? sSuctami(ine, teraz.zdroj, teraz.site) : teraz.pv };
}

/**
 * Dáta pre elektráreň; meranie len vtedy, keď je naň čas (pvNow). Dopyt sa do spoločného rytmu
 * zapíše hneď, nie až s odpoveďou - druhá appka sa tak medzitým nepýta tiež.
 * @param {RefreshState} s @param {Pick<import('../shared/settings.js').Settings, 'site' | 'plant' | 'zdroj'>} settings @param {boolean} skus
 */
async function stiahni(s, settings, skus) {
    const { zdroj } = settings;
    const rytmus = rytmusOf(loadRytmus(), zdroj);
    const due = pvNow(s, zdroj, skus, rytmus?.at ?? 0);
    if (due && zdroj) saveRytmus(dalsiRytmus(rytmus, zdroj, new Date(), null));
    const result = await loadData({ ...settings, zdroj: due ? zdroj : null }, new Date());
    if (due && zdroj && result.pv) saveRytmus(dalsiRytmus(rytmus, zdroj, new Date(), result.pv));
    return { due, rytmus, result };
}

/**
 * Obnova dát pre elektráreň, ktorá je práve v stave. Beží najviac jedna naraz: kým sa
 * sťahuje, ďalšie volanie (minútový časovač, návrat z pozadia) dostane tú istú rozbehnutú -
 * inak by sa pri pomalej sieti požiadavky hromadili a staršia odpoveď mohla prepísať novšiu.
 * Nová elektráreň (uložené nastavenie) čakať nemusí, jej obnova sa rozbehne hneď. `skus` je
 * „Skúsiť znova“: na meranie sa opýta hneď, aj keď by inak po odmietnutí čakala.
 * @param {RefreshStore} store @returns {(opts?: { skus?: boolean }) => Promise<void>}
 */
export function createRefresh(store) {
    /** @type {{ site: object, plant: object, zdroj: object | null, promise: Promise<void> } | null} */
    let bezi = null;
    /** @param {Pick<import('../shared/settings.js').Settings, 'site' | 'plant' | 'zdroj'>} s @param {boolean} skus */
    const obnov = async ({ site, plant, zdroj }, skus) => {
        // Kým sa sťahuje, appka ukáže predpoveď z počasia, ktoré už má (po otvorení z prehliadača) -
        // inak by odpoveď čakala na sieť. Meranie sa neodkladá, to príde až so sieťou.
        if (!store.get().forecast) {
            const forecast = keptForecast({ site, plant }, new Date());
            if (forecast) store.setState({ forecast });
        }
        const stiahnute = await stiahni(store.get(), { site, plant, zdroj }, skus);
        const { due, rytmus } = stiahnute;
        const result = { ...stiahnute.result, pv: sSuctami(stiahnute.result.pv, zdroj, site) };
        // Kým sa dáta sťahovali, používateľ mohol uložiť inú elektráreň. Tieto patria k starej.
        const teraz = store.get();
        if (teraz.site !== site || teraz.plant !== plant || teraz.zdroj !== zdroj) return;
        const now = new Date();
        const meranie = due ? nextMeranie(teraz, result, now, skus) : bezDopytu(teraz, rytmus);
        // Denník dní pre súhrn: menič posiela len súčet dneška, dni si appka odkladá sama (Victron
        // dnešok neposiela - je dopočítaný z celkovej výroby, sSuctami).
        const dayLog = result.pv
            ? recordDay(teraz.dayLog, localDateKey(now, site.timezone), localMinutes(now, site.timezone), result.pv.dailyEnergyKwh)
            : teraz.dayLog;
        if (dayLog !== teraz.dayLog) saveDayLog(dayLog);
        const pecat = result.pecat ? newPecat(teraz, result.pecat) : {};
        store.setState({ forecast: result.forecast, loading: false, now, dayLog, ...pecat, ...meranie });
    };
    return ({ skus = false } = {}) => {
        // Kým appka nepozná polohu, nie je pre čo sťahovať.
        if (store.get().known === 'nic') return Promise.resolve();
        const prevzate = zUloziska(store.get());
        if (Object.keys(prevzate).length) store.setState(prevzate);
        const { site, plant, zdroj } = store.get();
        if (bezi && bezi.site === site && bezi.plant === plant && bezi.zdroj === zdroj) return bezi.promise;
        const promise = obnov({ site, plant, zdroj }, skus).finally(() => {
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
