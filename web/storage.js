// Uloženie nastavenia elektrárne v prehliadači. Každý telefón má vlastné, žiadny server.
// Nevie nič o stave appky, takže ho rovnakým kódom a v rovnakom formáte používa súčasná
// appka aj nová (obloha/) - obe bežia na tej istej doméne a čítajú to isté úložisko.
// localStorage môže chýbať alebo hádzať (súkromné okno, zakázané úložisko) - appka potom
// sa spýta na polohu ako pri prvom otvorení a uloženie ohlási ako neúspešné.

import {
    ADRESA_SESSION_KEY,
    DAYLOG_STORAGE_KEY,
    LOOK_STORAGE_KEY,
    MERANIE_STORAGE_KEY,
    OLD_STORAGE_KEYS,
    OZNAMENIA_STORAGE_KEY,
    PRISTUP_STORAGE_KEY,
    RANNA_TRIEDA_STORAGE_KEY,
    SETTINGS_STORAGE_KEY,
    SITE_STORAGE_KEY,
    START_PANELS,
    START_STORAGE_KEY,
    STORAGE_KEYS,
    SUCTY_STORAGE_KEY,
    VYMAZANE_STORAGE_KEY,
    WEATHER_STORAGE_KEY,
} from '../shared/config.js';
import { parseDayLog } from '../shared/daylog.js';
import { parseRanna } from '../shared/den-trieda.js';
import { parseOznamenia } from '../shared/oznamenia.js';
import { parseOdmietnutie } from '../shared/pristup.js';
import { parseRytmus } from '../shared/zdroje.js';
import { parseStoredWeather } from '../shared/schema.js';
import { parseSucty } from '../shared/sucty.js';
import {
    DEFAULT_LOOK,
    lookToStored,
    parseLook,
    parseStartPanel,
    parseStoredSettings,
    parseStoredSite,
    startFromLink,
    toUser,
} from '../shared/settings.js';

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

/** Adresa, ktorú appka v tejto karte naposledy zapísala (ADRESA_SESSION_KEY); bez nej null. */
export function loadVlastnaAdresa() {
    try {
        return sessionStorage.getItem(ADRESA_SESSION_KEY);
    } catch {
        return null;
    }
}

/** @param {string} adresa cesta a časť za mriežkou */
export function saveVlastnaAdresa(adresa) {
    try {
        sessionStorage.setItem(ADRESA_SESSION_KEY, adresa);
    } catch {
        // Bez sessionStorage appka po obnovení ponúkne aj vlastnú adresu, ako predtým.
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
 * Ostane len značka vymazania - adresa z histórie prehliadača potom staré nastavenie neponúkne.
 */
export function clearStored() {
    removeAll(STORAGE_KEYS);
    write(VYMAZANE_STORAGE_KEY, '1');
}

/** Vymazal tu niekto údaje (clearStored)? */
export function loadVymazane() {
    return read(VYMAZANE_STORAGE_KEY) !== null;
}

/** Zmaže kľúče, ktoré appka už nepoužíva (OLD_STORAGE_KEYS). Volajú ho obe appky pri štarte. */
export function dropOldStored() {
    removeAll(OLD_STORAGE_KEYS);
}

/** @param {readonly string[]} keys */
function removeAll(keys) {
    for (const key of keys) {
        try {
            localStorage.removeItem(key);
        } catch {
            // Bez úložiska nie je čo mazať.
        }
    }
}

/** Vzhľad novej appky (tón hlášok, živá obloha); bez úložiska predvolený. @returns {import('../shared/settings.js').Look} */
export function loadLook() {
    return readJson(LOOK_STORAGE_KEY, parseLook, DEFAULT_LOOK);
}

/** @param {import('../shared/settings.js').Look} look @returns {boolean} podarilo sa? */
export function saveLook(look) {
    return write(LOOK_STORAGE_KEY, JSON.stringify(lookToStored(look)));
}

/** Prístup k meraniu, ktorý výrobca odmietol (shared/pristup.js); bez úložiska null. @returns {import('../shared/pristup.js').Odmietnutie | null} */
export function loadOdmietnutie() {
    return readJson(PRISTUP_STORAGE_KEY, parseOdmietnutie, null);
}

/** Zapíše odmietnutie, null ho zmaže. @param {import('../shared/pristup.js').Odmietnutie | null} o @returns {boolean} podarilo sa? */
export function saveOdmietnutie(o) {
    if (o) return write(PRISTUP_STORAGE_KEY, JSON.stringify(o));
    try {
        localStorage.removeItem(PRISTUP_STORAGE_KEY);
        return true;
    } catch {
        return false;
    }
}

/** Posledný dopyt na meranie, spoločný pre obe appky (Rytmus v shared/zdroje.js); bez úložiska null. @returns {import('../shared/zdroje.js').Rytmus | null} */
export function loadRytmus() {
    return readJson(MERANIE_STORAGE_KEY, parseRytmus, null);
}

/** @param {import('../shared/zdroje.js').Rytmus} r @returns {boolean} podarilo sa? */
export function saveRytmus(r) {
    return write(MERANIE_STORAGE_KEY, JSON.stringify(r));
}

/** Kotvy súčtov, ktoré výrobca neposiela (shared/sucty.js); bez úložiska null. @returns {import('../shared/sucty.js').Sucty | null} */
export function loadSucty() {
    return readJson(SUCTY_STORAGE_KEY, parseSucty, null);
}

/** @param {import('../shared/sucty.js').Sucty} s @returns {boolean} podarilo sa? */
export function saveSucty(s) {
    return write(SUCTY_STORAGE_KEY, JSON.stringify(s));
}

/** Posledné stiahnuté počasie; bez úložiska null. @returns {import('../shared/schema.js').StoredWeather | null} */
export function loadStoredWeather() {
    return readJson(WEATHER_STORAGE_KEY, parseStoredWeather, null);
}

/** @param {import('../shared/schema.js').StoredWeather} weather @returns {boolean} podarilo sa? */
export function saveStoredWeather(weather) {
    return write(WEATHER_STORAGE_KEY, JSON.stringify(weather));
}

/** Trieda dňa, ktorú appka dnes videla ráno (RANNA_TRIEDA_STORAGE_KEY); bez úložiska null. @returns {import('../shared/den-trieda.js').RannaTrieda | null} */
export function loadRanna() {
    return readJson(RANNA_TRIEDA_STORAGE_KEY, parseRanna, null);
}

/** @param {import('../shared/den-trieda.js').RannaTrieda} r @returns {boolean} podarilo sa? */
export function saveRanna(r) {
    return write(RANNA_TRIEDA_STORAGE_KEY, JSON.stringify(r));
}

/** Ranné oznámenie a spotrebiče doma (OZNAMENIA_STORAGE_KEY); bez úložiska predvolené. @returns {import('../shared/oznamenia.js').Oznamenia} */
export function loadOznamenia() {
    return parseOznamenia(read(OZNAMENIA_STORAGE_KEY));
}

/** @param {import('../shared/oznamenia.js').Oznamenia} o @returns {boolean} podarilo sa? */
export function saveOznamenia(o) {
    return write(OZNAMENIA_STORAGE_KEY, JSON.stringify(o));
}
