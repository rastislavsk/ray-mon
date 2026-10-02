// Uloženie nastavenia elektrárne v prehliadači. Každý telefón má vlastné, žiadny server.
// Nevie nič o stave appky, takže ho rovnakým kódom a v rovnakom formáte používa súčasná
// appka aj nová (obloha/) - obe bežia na tej istej doméne a čítajú to isté úložisko.
// localStorage môže chýbať alebo hádzať (súkromné okno, zakázané úložisko) - appka potom
// sa spýta na polohu ako pri prvom otvorení a uloženie ohlási ako neúspešné.

import {
    DAYLOG_STORAGE_KEY,
    LAUNCH_STORAGE_KEY,
    SETTINGS_STORAGE_KEY,
    SITE_STORAGE_KEY,
    START_PANELS,
    START_STORAGE_KEY,
    STORAGE_KEYS,
} from '../shared/config.js';
import { parseDayLog } from '../shared/daylog.js';
import { parseLaunches } from '../shared/launches.js';
import { parseStartPanel, parseStoredSettings, parseStoredSite, startFromLink, toUser } from '../shared/settings.js';

/** Hodnota z localStorage; keď nie je, alebo úložisko chýba či hádže, null. @param {string} key */
function read(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

/** @param {string} key @param {string} value @returns {boolean} podarilo sa? */
function write(key, value) {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch {
        return false;
    }
}

/**
 * JSON z localStorage, skontrolovaný funkciou `parse`. Keď nie je alebo sa nedá prečítať,
 * `fallback` - appka sa vtedy správa, akoby nič uložené nebolo.
 * @template T @param {string} key @param {(raw: unknown) => T} parse @param {T} fallback @returns {T}
 */
function readJson(key, parse, fallback) {
    const raw = read(key);
    if (!raw) return fallback;
    try {
        return parse(JSON.parse(raw));
    } catch {
        return fallback;
    }
}

/** @returns {import('../shared/settings.js').Settings | null} */
export function loadSettings() {
    return readJson(SETTINGS_STORAGE_KEY, parseStoredSettings, null);
}

/** Samotná poloha - kto ju zadal, no panely ešte nie. @returns {import('../shared/config.js').Site | null} */
export function loadSite() {
    return readJson(SITE_STORAGE_KEY, parseStoredSite, null);
}

/** @param {import('../shared/config.js').Site} site @returns {boolean} podarilo sa? */
export function saveSite(site) {
    return write(SITE_STORAGE_KEY, JSON.stringify(site));
}

/**
 * Karta, na ktorej sa appka na tomto telefóne otvára. Uložená voľba vyhrá; bez nej platí
 * karta z odkazu (`&prva=…`) a tá sa rovno uloží - kto dostal odkaz pre rodinu, nemusí nič
 * nastavovať. Odkaz tak vlastnú voľbu nikdy neprepíše.
 * @param {string} hash časť adresy za mriežkou @returns {import('../shared/settings.js').StartPanel}
 */
export function loadStartPanel(hash) {
    // Bez úložiska platí odkaz alebo predvolená karta.
    const stored = parseStartPanel(read(START_STORAGE_KEY));
    if (stored) return stored;
    const linked = startFromLink(hash);
    if (linked) saveStartPanel(linked);
    return linked || START_PANELS[0];
}

/** @param {import('../shared/settings.js').StartPanel} panel @returns {boolean} podarilo sa? */
export function saveStartPanel(panel) {
    return write(START_STORAGE_KEY, panel);
}

/** Zápisy „Pustil/a som“ z tohto telefónu; bez úložiska prázdny zoznam. @returns {import('../shared/launches.js').Launch[]} */
export function loadLaunches() {
    return readJson(LAUNCH_STORAGE_KEY, parseLaunches, []);
}

/** @param {import('../shared/launches.js').Launch[]} list @returns {boolean} podarilo sa? */
export function saveLaunches(list) {
    return write(LAUNCH_STORAGE_KEY, JSON.stringify(list));
}

/** @param {import('../shared/settings.js').Settings} settings @returns {boolean} podarilo sa? */
export function saveSettings(settings) {
    return write(SETTINGS_STORAGE_KEY, JSON.stringify(toUser(settings)));
}

/** Denník výroby po dňoch pre súhrn; bez úložiska prázdny. @returns {import('../shared/daylog.js').DayLog} */
export function loadDayLog() {
    return readJson(DAYLOG_STORAGE_KEY, parseDayLog, {});
}

/** @param {import('../shared/daylog.js').DayLog} log @returns {boolean} podarilo sa? */
export function saveDayLog(log) {
    return write(DAYLOG_STORAGE_KEY, JSON.stringify(log));
}

/**
 * Zmaže všetko, čo appka v tomto prehliadači uložila. Len vlastné kľúče, nie celé úložisko:
 * appky na GitHub Pages toho istého autora zdieľajú jednu doménu, a teda aj localStorage.
 */
export function clearStored() {
    for (const key of STORAGE_KEYS) {
        try {
            localStorage.removeItem(key);
        } catch {
            // Bez úložiska nie je čo mazať.
        }
    }
}
