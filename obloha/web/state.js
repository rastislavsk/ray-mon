// Stav novej appky: jeden objekt, mení sa len cez setState (web/store.js) a prekresľuje len
// cez render (render/index.js). Polia o elektrárni a dátach sú tie isté ako v súčasnej appke,
// takže ich plní ten istý kód (web/refresh.js, web/storage.js).

import { MOZEM_ITEMS, PANELS } from '../../shared/config.js';
import { typicalSettings } from '../../shared/settings.js';
import { emptySettings } from '../../shared/setup.js';

/**
 * Stav. `mozemItem` je vec karty Môžem?, ktorej panel je otvorený (null = žiadny), `mozemQuip`
 * stránka hlášok, `launches` zápisy „Pustil/a som“ (to isté úložisko ako v súčasnej appke)
 * a `online`, či má telefón internet - podľa toho karta bez dát povie prečo.
 * @typedef {(typeof PANELS)[number]} Panel
 * @typedef {import('../../web/refresh.js').RefreshState & {
 *   panel: Panel,
 *   panelDir: 1 | -1,
 *   tariff: import('../../shared/config.js').Tariff,
 *   launches: import('../../shared/launches.js').Launch[],
 *   mozemItem: string | null,
 *   mozemQuip: number,
 *   online: boolean,
 * }} AppState
 * @typedef {ReturnType<typeof import('../../web/store.js').createStore<AppState>>} Store
 */
/**
 * Krok navigácie, na ktorý sa dá vrátiť tlačidlom Späť: karta a otvorený panel veci.
 * @typedef {{ panel: Panel, item: string | null }} NavStep
 */

/**
 * @param {Date} now
 * @param {{ saved: import('../../shared/settings.js').Settings | null, site: import('../../shared/config.js').Site | null,
 *   startPanel: import('../../shared/settings.js').StartPanel, dayLog: import('../../shared/daylog.js').DayLog,
 *   launches: import('../../shared/launches.js').Launch[], online: boolean }} start
 *   uložené nastavenie, bez neho uložená poloha (appka počíta s typickou strechou v nej), karta,
 *   na ktorej sa appka na tomto telefóne otvára, denník výroby, zápisy spustení a internet
 * @returns {AppState}
 */
export function initialState(now, { saved, site, startPanel, dayLog, launches, online }) {
    const start = saved || (site ? typicalSettings(site) : emptySettings());
    return {
        now,
        panel: startPanel,
        // Smer posledného prechodu medzi kartami: 1 dopredu v poradí navigácie, -1 späť.
        panelDir: 1,
        known: saved ? 'elektraren' : site ? 'poloha' : 'nic',
        site: start.site,
        plant: start.plant,
        tariff: start.tariff,
        kiosk: start.kiosk,
        pv: null,
        forecast: null,
        // Kým beží prvé načítanie, chýbajúce dáta nie sú chyba.
        loading: true,
        dayLog,
        launches,
        mozemItem: null,
        mozemQuip: 0,
        online,
    };
}

/**
 * Zmena karty aj so smerom podľa poradia v navigácii. Panel veci patrí karte Môžem?, s ňou sa zatvorí.
 * @param {Panel} from @param {Panel} to
 */
export function panelChange(from, to) {
    return {
        panel: to,
        panelDir: /** @type {1 | -1} */ (PANELS.indexOf(to) < PANELS.indexOf(from) ? -1 : 1),
        mozemItem: /** @type {string | null} */ (null),
    };
}

/**
 * Susedná karta v poradí navigácie, alebo null na kraji - listovanie sa nezacyklí.
 * @param {Panel} panel @param {1 | -1} dir 1 = ďalšia, -1 = predchádzajúca @returns {Panel | null}
 */
export function nextPanel(panel, dir) {
    return PANELS[PANELS.indexOf(panel) + dir] ?? null;
}

/** @param {AppState} state @returns {NavStep} */
export function navStep(state) {
    return { panel: state.panel, item: state.mozemItem };
}

/** @param {NavStep} a @param {NavStep} b */
export function sameNavStep(a, b) {
    return a.panel === b.panel && a.item === b.item;
}

/**
 * Krok z hodnoty v položke histórie (`step` alebo `prev`). Cudzia hodnota je null a Späť sa
 * pri nej správa ako predtým - odíde zo stránky.
 * @param {unknown} raw @returns {NavStep | null}
 */
export function navStepOf(raw) {
    // Položka zo skoršej verzie appky mala za krok len kartu.
    if (typeof raw === 'string') raw = { panel: raw };
    if (!raw || typeof raw !== 'object') return null;
    const { panel, item } = /** @type {{ panel?: unknown, item?: unknown }} */ (raw);
    const p = PANELS.find((x) => x === panel);
    if (!p) return null;
    if (item === null || item === undefined) return { panel: p, item: null };
    return MOZEM_ITEMS.some((i) => i.id === item) ? { panel: p, item: /** @type {string} */ (item) } : null;
}

/** Krok, na ktorom položka histórie stojí. @param {unknown} raw */
export const navStepFrom = (raw) => navStepOf(raw && typeof raw === 'object' ? /** @type {{ step?: unknown }} */ (raw).step : null);

/** Krok, z ktorého sa do položky histórie prišlo. @param {unknown} raw */
export const navPrevFrom = (raw) => navStepOf(raw && typeof raw === 'object' ? /** @type {{ prev?: unknown }} */ (raw).prev : null);

/** Návrat na krok z histórie (tlačidlo Späť): karta aj panel veci tak, ako boli. @param {Panel} from @param {NavStep} step */
export function navChange(from, step) {
    return { ...panelChange(from, step.panel), mozemItem: step.item };
}
