// Uhlík vyrobenej elektriny: o koľko kg CO2eq menej, než keby ju vyrobila sieť, a koľko uhlíka,
// ktorý stála výroba panelov, už elektráreň splatila. Faktory sú v config.js (CARBON). Čisté funkcie.

import { CARBON, installedKw } from './config.js';

/**
 * Slnečný faktor v g CO2eq na kWh vyrobenú v SR: dlh kWp rozpočítaný na jeho výrobu za celý život.
 * Na severe je vyšší než na juhu - rovnaké panely tam vyrobia menej.
 */
export const solarG = () => (CARBON.debtKgPerKwp * 1000) / (CARBON.yieldKwhPerKwp * CARBON.lifeYears);

/**
 * Čistá úspora v kg CO2eq: kWh zo siete SR mínus kWh zo slnka, obe za celý životný cyklus -
 * panely nie sú zadarmo, ich výrobu tu každá kWh spláca svojím dielom.
 * @param {number} kwh
 */
export const co2SavedKg = (kwh) => (kwh * (CARBON.gridG - solarG())) / 1000;

/** Uhlíkový dlh elektrárne v kg CO2eq: panely, menič a montáž, úmerne kWp. @param {import('./config.js').Plant} plant */
export const panelDebtKg = (plant) => CARBON.debtKgPerKwp * installedKw(plant);

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

/**
 * Uhlík do súhrnu: úspora CO2eq za obdobie, podiel splateného dlhu panelov a dlh v tonách (oba
 * null bez súčtu od spustenia) a faktory, s ktorými sa počíta - pre poznámku pod súhrnom.
 * @param {number} kwh výroba obdobia @param {number | null} cumulativeKwh @param {import('./config.js').Plant} plant
 */
export function carbonFacts(kwh, cumulativeKwh, plant) {
    const payback = carbonPayback(cumulativeKwh, plant);
    const { gridG, gridSource, pvSource, lifeYears } = CARBON;
    return {
        co2Kg: co2SavedKg(kwh),
        payback,
        debtT: payback === null ? null : panelDebtKg(plant) / 1000,
        carbon: { gridG, gridSource, pvG: Math.round(solarG()), pvSource, lifeYears },
    };
}
