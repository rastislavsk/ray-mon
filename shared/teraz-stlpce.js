// Dlaždice spotrebičov na karte Teraz v dvoch stĺpcoch (docs/navrhy/teraz-dlazdice-stlpce.html): vľavo práčka, sušička
// a umývačka, vpravo bojler, pod ním auto a klimatizácia. Všetky dlaždice sú celé - dvojicu práčky so sušičkou
// z polovičných dlaždíc (variant B) appka od 26. 11. 2026 nemá.

import { TERAZ_STLPCE } from './config.js';

/**
 * Rozdelí dlaždice do stĺpcov. `veci` prichádzajú v poradí karty (čo beží podľa štartu, čo ide teraz, potom
 * podľa času, čo dobehlo na koniec) - ľavý stĺpec to poradie drží, pravý má pevné poradie. Spotrebič, ktorý nie
 * je v žiadnom stĺpci, ide do ľavého.
 * @template {{ id: string }} T
 * @param {T[]} veci
 * @returns {{ lavy: T[], pravy: T[] }}
 */
export function stlpceDlazdic(veci) {
    /** @type {readonly string[]} */
    const pravyIds = TERAZ_STLPCE.pravy;
    const lavy = veci.filter((v) => !pravyIds.includes(v.id));
    const pravy = pravyIds.flatMap((id) => veci.filter((v) => v.id === id));
    return { lavy, pravy };
}
