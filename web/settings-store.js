// Uloženie nastavenia elektrárne v prehliadači. Každý telefón má vlastné, žiadny server.
// localStorage môže chýbať alebo hádzať (súkromné okno, zakázané úložisko) - appka potom
// ukáže ukážku a uloženie ohlási ako neúspešné.

import { SETTINGS_STORAGE_KEY } from '../shared/config.js';
import { parseStoredSettings, shareHash, toUser } from '../shared/settings.js';

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
        const hash = shareHash(s.demo ? null : { site: s.site, plant: s.plant, kiosk: s.kiosk }, true);
        if (location.hash !== hash) history.replaceState(history.state, '', location.pathname + location.search + hash);
    };
    mirror(store.get());
    store.subscribe(mirror);
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
