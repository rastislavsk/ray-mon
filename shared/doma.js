// Čo má človek doma: spotrebiče, s ktorými ráta Plán dňa aj ranné oznámenie. Voľba telefónu,
// spoločná, uložená pod DOMA_STORAGE_KEY. Čisté funkcie bez DOM a úložiska.

import { MOZEM_ITEMS, PLAN_DNA } from './config.js';
import { isObj } from './valid.js';

/**
 * Čo sa dá vybrať: veci karty Môžem?, ktoré majú spotrebič, a klimatizácia - tá v Pláne dňa nie je, appka ju len sleduje
 * (docs/navrhy/klima-daikin.html, docs/navrhy/nastavenie-co-mas-doma.html).
 */
export const DOMA_DEVICES = [...MOZEM_ITEMS.filter((i) => i.device).map((i) => i.id), 'klima'];

/** Verzia uloženej voľby: od 2 pozná klimatizáciu (staršia ju nemohla mať, appka ju raz doplní podľa adresy). */
const DOMA_VERZIA = 2;

/**
 * Pred prvou voľbou: spotrebiče plánu dňa a auto - to v pláne nie je, ale karta Teraz ukáže, koľko by dalo slnko
 * (docs/navrhy/auto-mimo-planu.html). @returns {string[]}
 */
export const domaDefault = () => [...PLAN_DNA.devices, 'auto'];

/**
 * Spotrebiče z poľa v uloženom JSON: len známe, každý raz. Keď pole nie je, null.
 * @param {unknown} list @returns {string[] | null}
 */
function devicesOf(list) {
    if (!Array.isArray(list)) return null;
    return [...new Set(list.map(String).filter((d) => DOMA_DEVICES.includes(d)))];
}

/** @param {string | null} raw @returns {unknown} */
function jsonOf(raw) {
    try {
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

/**
 * Uložená voľba `{ devices, v }` (JSON z úložiska). Poškodená alebo chýbajúca je predvolená. Voľba spred verzie 2 klimatizáciu
 * poznať nemohla: kto má zadanú jej adresu (`klimaAdresa`), ten ju má.
 * @param {string | null} raw @param {boolean} [klimaAdresa] @returns {string[]}
 */
export function parseDoma(raw, klimaAdresa = false) {
    const v = jsonOf(raw);
    const devices = (isObj(v) && devicesOf(v.devices)) || domaDefault();
    const stara = !isObj(v) || v.v !== DOMA_VERZIA;
    return stara && klimaAdresa && !devices.includes('klima') ? [...devices, 'klima'] : devices;
}

/**
 * Spotrebiče zo starého nastavenia oznámení - kým nemali vlastné miesto, boli v ňom (`devices`).
 * Bez nich null: nie je čo presunúť.
 * @param {string | null} rawOznamenia @returns {string[] | null}
 */
export function domaZOznameni(rawOznamenia) {
    const v = jsonOf(rawOznamenia);
    return isObj(v) ? devicesOf(v.devices) : null;
}

/** Voľba v tvare na uloženie. @param {readonly string[]} devices */
export const domaToStored = (devices) => ({ devices: [...devices], v: DOMA_VERZIA });

/** Pridá či uberie spotrebič. @param {readonly string[]} devices @param {string} id @returns {string[]} */
export const prepniSpotrebic = (devices, id) => (devices.includes(id) ? devices.filter((d) => d !== id) : [...devices, id]);
