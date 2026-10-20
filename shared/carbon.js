// Uhlík vyrobenej elektriny: o koľko kg CO2eq menej, než keby ju vyrobila sieť, a koľko uhlíka,
// ktorý stála výroba panelov, už elektráreň splatila. Faktory sú v config.js (CARBON). Čisté funkcie.

import { CARBON, installedKw } from './config.js';

/**
 * Čistá úspora v kg CO2eq: kWh zo siete SR mínus kWh zo slnka, obe za celý životný cyklus -
 * panely nie sú zadarmo, ich výrobu tu každá kWh spláca svojím dielom.
 * @param {number} kwh
 */
export const co2SavedKg = (kwh) => (kwh * (CARBON.gridG - CARBON.pvG)) / 1000;

/** Uhlíkový dlh panelov v kg CO2eq: solárny faktor × výroba za celý život elektrárne. @param {import('./config.js').Plant} plant */
export const panelDebtKg = (plant) => (CARBON.pvG * CARBON.yieldKwhPerKwp * CARBON.lifeYears * installedKw(plant)) / 1000;

/**
 * Koľko z dlhu panelov už výroba od spustenia splatila (1 = celý), alebo null bez súčtu z kiosku.
 * Spláca ho celá kWh siete, ktorú strecha nahradila (`gridG`); co2SavedKg je ten istý účet
 * rozpočítaný na každú kWh za celý život panelov.
 * @param {number | null} cumulativeKwh @param {import('./config.js').Plant} plant
 */
export function carbonPayback(cumulativeKwh, plant) {
    const debt = panelDebtKg(plant);
    if (cumulativeKwh === null || debt <= 0) return null;
    return (cumulativeKwh * CARBON.gridG) / 1000 / debt;
}
