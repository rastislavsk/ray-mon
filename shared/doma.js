// Čo má človek doma: spotrebiče, s ktorými ráta Plán dňa aj ranné oznámenie. Voľba telefónu,
// spoločná pre obe appky, uložená pod DOMA_STORAGE_KEY. Čisté funkcie bez DOM a úložiska.

import { MOZEM_ITEMS, PLAN_DNA } from './config.js';

/** Spotrebiče, ktoré sa dajú vybrať: veci karty Môžem?, ktoré majú spotrebič. */
export const DOMA_DEVICES = MOZEM_ITEMS.filter((i) => i.device).map((i) => i.id);

/** Pred prvou voľbou: spotrebiče plánu dňa. @returns {string[]} */
export const domaDefault = () => [...PLAN_DNA.devices];

/**
 * Spotrebiče z poľa v uloženom JSON: len známe, každý raz. Keď pole nie je, null.
 * @param {unknown} list @returns {string[] | null}
 */
function devicesOf(list) {
    if (!Array.isArray(list)) return null;
    return [...new Set(list.map(String).filter((d) => DOMA_DEVICES.includes(d)))];
}

/** @param {string | null} raw @returns {any} */
function jsonOf(raw) {
    try {
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

/**
 * Uložená voľba `{ devices }` (JSON z úložiska). Poškodená alebo chýbajúca je predvolená.
 * @param {string | null} raw @returns {string[]}
 */
export function parseDoma(raw) {
    const v = jsonOf(raw);
    return (v && typeof v === 'object' && devicesOf(v.devices)) || domaDefault();
}

/**
 * Spotrebiče zo starého nastavenia oznámení - kým nemali vlastné miesto, boli v ňom (`devices`).
 * Bez nich null: nie je čo presunúť.
 * @param {string | null} rawOznamenia @returns {string[] | null}
 */
export function domaZOznameni(rawOznamenia) {
    const v = jsonOf(rawOznamenia);
    return v && typeof v === 'object' ? devicesOf(v.devices) : null;
}

/** Voľba v tvare na uloženie. @param {readonly string[]} devices */
export const domaToStored = (devices) => ({ devices: [...devices] });

/** Pridá či uberie spotrebič. @param {readonly string[]} devices @param {string} id @returns {string[]} */
export const prepniSpotrebic = (devices, id) => (devices.includes(id) ? devices.filter((d) => d !== id) : [...devices, id]);
