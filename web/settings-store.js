// Uloženie nastavenia elektrárne v prehliadači. Každý telefón má vlastné, žiadny server.
// localStorage môže chýbať alebo hádzať (súkromné okno, zakázané úložisko) - appka potom
// ukáže ukážku a uloženie ohlási ako neúspešné.

import { SETTINGS_STORAGE_KEY, START_PANELS, START_STORAGE_KEY } from '../shared/config.js';
import { parseStartPanel, parseStoredSettings, shareHash, startFromLink, toUser } from '../shared/settings.js';
import { savedSettings } from './state.js';

/** @returns {import('../shared/settings.js').Settings | null} */
export function loadSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
        return raw ? parseStoredSettings(JSON.parse(raw)) : null;
    } catch {
        return null;
    }
}

/**
 * Adresa v prehliadači nesie vždy uložené nastavenie (`#nastavenie=…`, aj s kioskom), pri
 * ukážke je holá. Na iPhone totiž appka pridaná na plochu nevidí úložisko Safari - jediné,
 * čo si zo Safari prinesie, je adresa. Pri prvom spustení z plochy tak ponúkne nastavenie
 * prevziať, namiesto toho, aby ukázala ukážku. Kým čaká ponuka z otvoreného odkazu, adresa
 * nesie ten odkaz, aby sa dal pridať na plochu aj pred rozhodnutím.
 * @param {import('./state.js').Store} store
 */
export function initUrlMirror(store) {
    /** @param {import('./state.js').AppState} s */
    const mirror = (s) => {
        if (s.incoming) return;
        // Aj prvá karta: appka pridaná na plochu iPhonu si ju inak z Safari neprenesie.
        const hash = shareHash(s.demo ? null : savedSettings(s), true, s.startPanel);
        if (location.hash !== hash) history.replaceState(history.state, '', location.pathname + location.search + hash);
    };
    mirror(store.get());
    store.subscribe(mirror);
}

/**
 * Karta, na ktorej sa appka na tomto telefóne otvára. Uložená voľba vyhrá; bez nej platí
 * karta z odkazu (`&prva=…`) a tá sa rovno uloží - kto dostal odkaz pre rodinu, nemusí nič
 * nastavovať. Odkaz tak vlastnú voľbu nikdy neprepíše.
 * @param {string} hash časť adresy za mriežkou @returns {import('../shared/settings.js').StartPanel}
 */
export function loadStartPanel(hash) {
    /** @type {unknown} */ let raw = null;
    try {
        raw = localStorage.getItem(START_STORAGE_KEY);
    } catch {
        /* úložisko nie je - platí odkaz alebo predvolená karta */
    }
    const stored = parseStartPanel(raw);
    if (stored) return stored;
    const linked = startFromLink(hash);
    if (linked) saveStartPanel(linked);
    return linked || START_PANELS[0];
}

/** @param {import('../shared/settings.js').StartPanel} panel @returns {boolean} podarilo sa? */
export function saveStartPanel(panel) {
    try {
        localStorage.setItem(START_STORAGE_KEY, panel);
        return true;
    } catch {
        return false;
    }
}

/** @param {import('../shared/settings.js').Settings} settings @returns {boolean} podarilo sa? */
export function saveSettings(settings) {
    try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(toUser(settings)));
        return true;
    } catch {
        return false;
    }
}
