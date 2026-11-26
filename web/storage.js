// Uloženie nastavenia elektrárne v prehliadači. Každý telefón má vlastné, žiadny server.
// Nevie nič o stave appky.
// localStorage môže chýbať alebo hádzať (súkromné okno, zakázané úložisko) - appka potom
// sa spýta na polohu ako pri prvom otvorení a uloženie ohlási ako neúspešné.

import {
    ADRESA_SESSION_KEY,
    BEHY_HIST_STORAGE_KEY,
    BEZI_STORAGE_KEY,
    BEZI_CAKA_STORAGE_KEY,
    AUTO_OZNAM_STORAGE_KEY,
    BOJLER_OZNAM_STORAGE_KEY,
    ZASUVKA_OZNAM_STORAGE_KEY,
    DAYLOG_STORAGE_KEY,
    DOMA_STORAGE_KEY,
    HISTORIA_STORAGE_KEY,
    BOJLER_STORAGE_KEY,
    TEPLOMER_STORAGE_KEY,
    KLIMA_STORAGE_KEY,
    LOOK_STORAGE_KEY,
    MERANIE_STORAGE_KEY,
    OLD_STORAGE_KEYS,
    ODBER_STORAGE_KEY,
    OZNAMENIA_STORAGE_KEY,
    PREDPOVED_HIST_STORAGE_KEY,
    PRISTUP_STORAGE_KEY,
    RADAR,
    RADAR_MODEL_STORAGE_KEY,
    RADAR_STORAGE_KEY,
    RANNA_TRIEDA_STORAGE_KEY,
    AUTO_DEN_STORAGE_KEY,
    SETTINGS_STORAGE_KEY,
    SITE_STORAGE_KEY,
    STORAGE_KEYS,
    SUCTY_STORAGE_KEY,
    TRASY_STORAGE_KEY,
    UCENIE_OD_STORAGE_KEY,
    UCENIE_WORKER_STORAGE_KEY,
    VYMAZANE_STORAGE_KEY,
    WEATHER_STORAGE_KEY,
} from '../shared/config.js';
import { autoDenZ } from '../shared/auto-slnko.js';
import { parseBezi, parseCaka } from '../shared/bezi.js';
import { prahyZ } from '../shared/bojler.js';
import { parseDayLog } from '../shared/daylog.js';
import { parsePredpovedHist, pridajBehy, snimkaPredpovede } from '../shared/historia.js';
import { parseHistoria, nauceneZ } from '../shared/ucenie.js';
import { DATE_RE, isObj } from '../shared/valid.js';
import { domaToStored, domaZOznameni, parseDoma } from '../shared/doma.js';
import { teplomerZ } from '../shared/nastavenie-bojler.js';
import { klimaNastZ } from '../shared/nastavenie-klima.js';
import { parseRanna } from '../shared/den-trieda.js';
import { parseOznamenia } from '../shared/oznamenia.js';
import { parseUlozenyModel } from '../shared/radar-data.js';
import { parseOdmietnutie } from '../shared/pristup.js';
import { parseRytmus } from '../shared/zdroje.js';
import { parseStoredWeather } from '../shared/schema.js';
import { parseSucty } from '../shared/sucty.js';
import { parseTrasy } from '../shared/trasy.js';
import { DEFAULT_LOOK, lookToStored, parseLook, parseStoredSettings, parseStoredSite, toUser } from '../shared/settings.js';

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
/**
 * Voľby karty Radar. Sú len v tomto prehliadači, do odkazu s nastavením nepatria.
 * @returns {{ radarOblaky: boolean, radarRychlost: 1 | 2 | 3 }}
 */
export function loadRadar() {
    try {
        const o = JSON.parse(read(RADAR_STORAGE_KEY) ?? '{}');
        return { radarOblaky: o?.oblaky !== false, radarRychlost: RADAR.rychlosti.find((r) => r === o?.rychlost) ?? 1 };
    } catch {
        return { radarOblaky: true, radarRychlost: 1 };
    }
}

/** Uložený model pre výrez, ak ešte platí. @param {number} nowMs @param {string} kluc */
export function loadRadarModel(nowMs, kluc) {
    try {
        return parseUlozenyModel(JSON.parse(read(RADAR_MODEL_STORAGE_KEY) ?? 'null'), nowMs, kluc);
    } catch {
        return null;
    }
}

/** @param {number} at @param {string} kluc @param {import('../shared/radar-data.js').RadarModel} model */
export function saveRadarModel(at, kluc, model) {
    write(RADAR_MODEL_STORAGE_KEY, JSON.stringify({ at, kluc, model }));
}

/** @param {boolean} oblaky @param {number} rychlost */
export function saveRadar(oblaky, rychlost) {
    write(RADAR_STORAGE_KEY, JSON.stringify({ oblaky, rychlost }));
}

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

/** Zmaže kľúče, ktoré appka už nepoužíva (OLD_STORAGE_KEYS). Volá sa pri štarte. */
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

/** Vzhľad (tón hlášok, živá obloha, farba pozadia); bez úložiska predvolený. @returns {import('../shared/settings.js').Look} */
export function loadLook() {
    return readJson(LOOK_STORAGE_KEY, parseLook, DEFAULT_LOOK);
}

/**
 * Zmena vzhľadu. Zvyšok sa prečíta z úložiska - voľbu, ktorú má len druhá appka (živá obloha,
 * farba pozadia), táto appka nepozná a nesmie ju prepísať.
 * @param {Partial<import('../shared/settings.js').Look>} zmena @returns {boolean} podarilo sa?
 */
export function saveLook(zmena) {
    return write(LOOK_STORAGE_KEY, JSON.stringify(lookToStored({ ...loadLook(), ...zmena })));
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

/** Posledný dopyt na meranie (Rytmus v shared/zdroje.js); bez úložiska null. @returns {import('../shared/zdroje.js').Rytmus | null} */
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

/** Trasy autom z domu (TRASY_STORAGE_KEY, shared/trasy.js); bez úložiska null. @returns {import('../shared/trasy.js').UlozeneTrasy | null} */
export function loadTrasy() {
    return readJson(TRASY_STORAGE_KEY, parseTrasy, null);
}

/** @param {import('../shared/trasy.js').UlozeneTrasy} t @returns {boolean} podarilo sa? */
export function saveTrasy(t) {
    return write(TRASY_STORAGE_KEY, JSON.stringify(t));
}

/** Trieda dňa, ktorú appka dnes videla ráno (RANNA_TRIEDA_STORAGE_KEY); bez úložiska null. @returns {import('../shared/den-trieda.js').RannaTrieda | null} */
export function loadRanna() {
    return readJson(RANNA_TRIEDA_STORAGE_KEY, parseRanna, null);
}

/** @param {import('../shared/den-trieda.js').RannaTrieda} r @returns {boolean} podarilo sa? */
export function saveRanna(r) {
    return write(RANNA_TRIEDA_STORAGE_KEY, JSON.stringify(r));
}

/** Auto zo slnka dnes (AUTO_DEN_STORAGE_KEY, web/auto-den.js); bez úložiska null. @returns {import('../shared/auto-slnko.js').AutoDen | null} */
export function loadAutoDen() {
    return readJson(AUTO_DEN_STORAGE_KEY, autoDenZ, null);
}

/** @param {import('../shared/auto-slnko.js').AutoDen} a @returns {boolean} podarilo sa? */
export function saveAutoDen(a) {
    return write(AUTO_DEN_STORAGE_KEY, JSON.stringify(a));
}

/** Ranné oznámenie (OZNAMENIA_STORAGE_KEY); bez úložiska predvolené. @returns {import('../shared/oznamenia.js').Oznamenia} */
export function loadOznamenia() {
    return parseOznamenia(read(OZNAMENIA_STORAGE_KEY));
}

/** @param {import('../shared/oznamenia.js').Oznamenia} o @returns {boolean} podarilo sa? */
export function saveOznamenia(o) {
    return write(OZNAMENIA_STORAGE_KEY, JSON.stringify(o));
}

/** Kedy appka naposledy poslala odber Workeru (ms); nikdy alebo bez úložiska 0. */
export function loadOdberAt() {
    const at = Number(read(ODBER_STORAGE_KEY));
    return Number.isFinite(at) ? at : 0;
}

/** @param {number} at */
export function saveOdberAt(at) {
    return write(ODBER_STORAGE_KEY, String(at));
}

/**
 * Spotrebiče doma (DOMA_STORAGE_KEY); bez úložiska predvolené. Kým vlastné miesto nemali, boli
 * v nastavení oznámení - odtiaľ sa pri prvom načítaní raz presunú, aby nikto neprišiel o voľbu.
 * @returns {string[]}
 */
export function loadDoma() {
    const raw = read(DOMA_STORAGE_KEY);
    if (raw !== null) return parseDoma(raw);
    const stare = domaZOznameni(read(OZNAMENIA_STORAGE_KEY));
    if (!stare) return parseDoma(null);
    saveDoma(stare);
    return stare;
}

/** @param {readonly string[]} devices @returns {boolean} podarilo sa? */
export function saveDoma(devices) {
    return write(DOMA_STORAGE_KEY, JSON.stringify(domaToStored(devices)));
}

/** Čo človek zapol („Už beží“, BEZI_STORAGE_KEY, shared/bezi.js); bez úložiska nič. @returns {import('../shared/bezi.js').Zapis[]} */
export function loadBezi() {
    return readJson(BEZI_STORAGE_KEY, parseBezi, []);
}

/**
 * Uloží behy a pripíše ich do histórie behov pre učenie Plánu dňa (BEHY_HIST_STORAGE_KEY, shared/historia.js) -
 * `bezi-v1` drží len dnešok.
 * @param {import('../shared/bezi.js').Zapis[]} list @param {string} today @returns {boolean} podarilo sa?
 */
export function saveBezi(list, today) {
    const hist = readJson(BEHY_HIST_STORAGE_KEY, parseBezi, /** @type {import('../shared/bezi.js').Zapis[]} */ ([]));
    write(BEHY_HIST_STORAGE_KEY, JSON.stringify(pridajBehy(hist, list, today)));
    return write(BEZI_STORAGE_KEY, JSON.stringify(list));
}

/** Spotrebiče, ktorých zmenu „Už beží“ Worker ešte nepotvrdil (shared/bezi.js); bez úložiska nič. @returns {import('../shared/bezi.js').Caka[]} */
export function loadBeziCaka() {
    return readJson(BEZI_CAKA_STORAGE_KEY, parseCaka, []);
}

/** @param {import('../shared/bezi.js').Caka[]} caka @returns {boolean} podarilo sa? */
export function saveBeziCaka(caka) {
    return write(BEZI_CAKA_STORAGE_KEY, JSON.stringify(caka));
}

/**
 * Vstupy učenia Plánu dňa (shared/ucenie.js): história z Workera stiahnutá v deň `d`, snímky predpovede, behy a od
 * ktorého dňa sa appka učí („Začať odznova“). Bez úložiska prázdne.
 * @returns {{ historia: { d: string, dni: import('../shared/historia.js').DenHistorie[] } | null,
 *   snimky: import('../shared/historia.js').SnimkaPredpovede[], behy: import('../shared/bezi.js').Zapis[], od: string | null }}
 */
export function loadUcenie() {
    const historia = readJson(
        HISTORIA_STORAGE_KEY,
        (/** @type {any} */ x) => (x && typeof x.d === 'string' && DATE_RE.test(x.d) ? { d: x.d, dni: parseHistoria(x.dni) } : null),
        null,
    );
    const od = read(UCENIE_OD_STORAGE_KEY);
    return {
        historia,
        snimky: readJson(PREDPOVED_HIST_STORAGE_KEY, parsePredpovedHist, []),
        behy: readJson(BEHY_HIST_STORAGE_KEY, parseBezi, []),
        od: od && DATE_RE.test(od) ? od : null,
    };
}

/**
 * Model učenia od Workera (UCENIE_WORKER_STORAGE_KEY, web/ucenie.js): deň a meranie (`z`, názov zdroja), keď prišiel,
 * či Worker dostal dnešnú snímku predpovede (`s`), či telefón nahral svoje dáta (`n`), čaká „Začať odznova“ (`o`).
 * @typedef {{ d: string, z: string, s: boolean, n: boolean, o: boolean, model: import('../shared/ucenie.js').Naucene | null }} UcenieWorkera
 */

/** @returns {UcenieWorkera | null} */
export function loadUcenieWorkera() {
    return readJson(
        UCENIE_WORKER_STORAGE_KEY,
        (/** @type {any} */ x) =>
            x && typeof x.d === 'string' && typeof x.z === 'string'
                ? { d: x.d, z: x.z, s: x.s === true, n: x.n === true, o: x.o === true, model: nauceneZ(x.model) }
                : null,
        null,
    );
}

/** @param {UcenieWorkera} u @returns {boolean} podarilo sa? */
export function saveUcenieWorkera(u) {
    return write(UCENIE_WORKER_STORAGE_KEY, JSON.stringify(u));
}

/** Od ktorého dňa sa appka učí. @param {string} d @returns {boolean} podarilo sa? */
export function saveUcenieOd(d) {
    return write(UCENIE_OD_STORAGE_KEY, d);
}

/**
 * Snímka dnešnej predpovede pre učenie Plánu dňa (PREDPOVED_HIST_STORAGE_KEY, shared/historia.js), keď ešte nie je.
 * @param {import('../shared/solar.js').Forecast | null} forecast @param {string} date @param {number} nowMin
 */
export function zapisSnimkuPredpovede(forecast, date, nowMin) {
    const hist = readJson(
        PREDPOVED_HIST_STORAGE_KEY,
        parsePredpovedHist,
        /** @type {import('../shared/historia.js').SnimkaPredpovede[]} */ ([]),
    );
    const nova = snimkaPredpovede(hist, forecast, date, nowMin);
    if (nova !== hist) write(PREDPOVED_HIST_STORAGE_KEY, JSON.stringify(nova));
}

/**
 * Oznámenia o nabíjaní auta na tomto telefóne (AUTO_OZNAM_STORAGE_KEY): začiatok `z`, koniec `k`; bez úložiska vypnuté.
 * @returns {{ z: boolean, k: boolean }}
 */
export function loadAutoOznam() {
    return readJson(
        AUTO_OZNAM_STORAGE_KEY,
        (v) => (isObj(v) && typeof v.z === 'boolean' && typeof v.k === 'boolean' ? { z: v.z, k: v.k } : { z: false, k: false }),
        { z: false, k: false },
    );
}

/** @param {{ z: boolean, k: boolean }} o @returns {boolean} podarilo sa? */
export function saveAutoOznam(o) {
    return write(AUTO_OZNAM_STORAGE_KEY, JSON.stringify({ z: o.z, k: o.k }));
}

/** Oznámenia bojlera na tomto telefóne zapnuté (BOJLER_OZNAM_STORAGE_KEY); bez úložiska nie. */
export function loadBojlerOznam() {
    return readJson(BOJLER_OZNAM_STORAGE_KEY, (v) => v === true, false);
}

/** @param {boolean} on @returns {boolean} podarilo sa? */
export function saveBojlerOznam(on) {
    return write(BOJLER_OZNAM_STORAGE_KEY, JSON.stringify(on));
}

/** Oznámenie o konci behu zo zásuvky na tomto telefóne zapnuté (ZASUVKA_OZNAM_STORAGE_KEY); bez úložiska nie. */
export function loadZasuvkaOznam() {
    return readJson(ZASUVKA_OZNAM_STORAGE_KEY, (v) => v === true, false);
}

/** @param {boolean} on @returns {boolean} podarilo sa? */
export function saveZasuvkaOznam(on) {
    return write(ZASUVKA_OZNAM_STORAGE_KEY, JSON.stringify(on));
}

/** Prahy bojlera (BOJLER_STORAGE_KEY); bez úložiska či pokazené predvolené. @returns {import('../shared/bojler.js').Prahy} */
export function loadBojlerPrahy() {
    try {
        return prahyZ(JSON.parse(read(BOJLER_STORAGE_KEY) ?? 'null'));
    } catch {
        return prahyZ(null);
    }
}

/** @param {import('../shared/bojler.js').Prahy} prahy @returns {boolean} podarilo sa? */
export function saveBojlerPrahy(prahy) {
    return write(BOJLER_STORAGE_KEY, JSON.stringify(prahy));
}

/** Teplomer v bojleri (TEPLOMER_STORAGE_KEY): či ho človek má a adresa; bez úložiska vypnutý. */
export function loadTeplomer() {
    return readJson(TEPLOMER_STORAGE_KEY, teplomerZ, teplomerZ(null));
}

/** @param {import('../shared/nastavenie-bojler.js').Teplomer} t @returns {boolean} podarilo sa? */
export function saveTeplomer(t) {
    return write(TEPLOMER_STORAGE_KEY, JSON.stringify(t));
}

/** Adresa klimatizácie v domácej sieti (KLIMA_STORAGE_KEY, docs/navrhy/klima-daikin.html); bez úložiska prázdna. */
export function loadKlimaNast() {
    return readJson(KLIMA_STORAGE_KEY, klimaNastZ, klimaNastZ(null));
}

/** @param {{ ip: string }} k @returns {boolean} podarilo sa? */
export function saveKlimaNast(k) {
    return write(KLIMA_STORAGE_KEY, JSON.stringify(k));
}
