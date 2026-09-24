// Uloženie nastavenia elektrárne v prehliadači. Každý telefón má vlastné, žiadny server.
// localStorage môže chýbať alebo hádzať (súkromné okno, zakázané úložisko) - appka potom
// ukáže ukážku a uloženie ohlási ako neúspešné.

import { SETTINGS_STORAGE_KEY } from '../shared/config.js';
import { parseStoredSettings, toUser } from '../shared/settings.js';

/** @returns {import('../shared/settings.js').Settings | null} */
export function loadSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
        return raw ? parseStoredSettings(JSON.parse(raw)) : null;
    } catch {
        return null;
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
