// Stav novej appky: jeden objekt, mení sa len cez setState (web/store.js) a prekresľuje len
// cez render (render/index.js). Polia o elektrárni a dátach sú tie isté ako v súčasnej appke,
// takže ich plní ten istý kód (web/refresh.js, web/storage.js).

import { PANELS } from '../../shared/config.js';
import { typicalSettings } from '../../shared/settings.js';
import { emptySettings } from '../../shared/setup.js';

/**
 * @typedef {(typeof PANELS)[number]} Panel
 * @typedef {import('../../web/refresh.js').RefreshState & {
 *   panel: Panel,
 *   panelDir: 1 | -1,
 * }} AppState
 * @typedef {ReturnType<typeof import('../../web/store.js').createStore<AppState>>} Store
 */

/**
 * @param {Date} now
 * @param {{ saved: import('../../shared/settings.js').Settings | null, site: import('../../shared/config.js').Site | null,
 *   startPanel: import('../../shared/settings.js').StartPanel, dayLog: import('../../shared/daylog.js').DayLog }} start
 *   uložené nastavenie, bez neho uložená poloha (appka počíta s typickou strechou v nej), karta,
 *   na ktorej sa appka na tomto telefóne otvára, a denník výroby
 * @returns {AppState}
 */
export function initialState(now, { saved, site, startPanel, dayLog }) {
    const start = saved || (site ? typicalSettings(site) : emptySettings());
    return {
        now,
        panel: startPanel,
        // Smer posledného prechodu medzi kartami: 1 dopredu v poradí navigácie, -1 späť.
        panelDir: 1,
        known: saved ? 'elektraren' : site ? 'poloha' : 'nic',
        site: start.site,
        plant: start.plant,
        kiosk: start.kiosk,
        pv: null,
        forecast: null,
        // Kým beží prvé načítanie, chýbajúce dáta nie sú chyba.
        loading: true,
        dayLog,
    };
}

/** Zmena karty aj so smerom podľa poradia v navigácii. @param {Panel} from @param {Panel} to */
export function panelChange(from, to) {
    return { panel: to, panelDir: /** @type {1 | -1} */ (PANELS.indexOf(to) < PANELS.indexOf(from) ? -1 : 1) };
}

/**
 * Susedná karta v poradí navigácie, alebo null na kraji - listovanie sa nezacyklí.
 * @param {Panel} panel @param {1 | -1} dir 1 = ďalšia, -1 = predchádzajúca @returns {Panel | null}
 */
export function nextPanel(panel, dir) {
    return PANELS[PANELS.indexOf(panel) + dir] ?? null;
}

/**
 * Karta z položky histórie (krok navigácie je zatiaľ len karta). Cudzia položka je null
 * a Späť sa pri nej správa ako predtým - odíde zo stránky.
 * @param {unknown} raw @returns {Panel | null}
 */
export function panelFromHistory(raw) {
    const step = raw && typeof raw === 'object' ? /** @type {{ step?: unknown }} */ (raw).step : null;
    return PANELS.find((p) => p === step) ?? null;
}
