// Dlaždice spotrebičov na karte Teraz v dvoch stĺpcoch (docs/navrhy/teraz-dlazdice-stlpce.html, B): vľavo
// práčka so sušičkou ako dvojica polovičných dlaždíc a umývačka, vpravo bojler a pod ním auto.

import { TERAZ_STLPCE } from './config.js';

/**
 * Rozdelí dlaždice do stĺpcov. `veci` prichádzajú v poradí karty (čo beží podľa štartu, čo ide teraz, potom
 * podľa času, čo dobehlo na koniec) - ľavý stĺpec to poradie drží: blok sa radí podľa svojej prvej veci
 * a v dvojici ide hore tá, ktorá je v poradí skôr (čo beží, nad tým, čo len príde). Pravý stĺpec má pevné
 * poradie. Blok bez vecí nie je; z dvojice, ktorej druhá vec chýba, ostane jedna celá dlaždica.
 * @template {{ id: string }} T
 * @param {T[]} veci
 * @returns {{ lavy: T[][], pravy: T[][] }}
 */
export function stlpceDlazdic(veci) {
    /** @param {readonly string[]} ids */
    const blok = (ids) => veci.filter((v) => ids.includes(v.id));
    const znamy = [...TERAZ_STLPCE.lavy, ...TERAZ_STLPCE.pravy].flat();
    const lavy = [...TERAZ_STLPCE.lavy.map(blok), ...veci.filter((v) => !znamy.includes(v.id)).map((v) => [v])]
        .filter((b) => b.length)
        .sort((a, b) => veci.indexOf(a[0]) - veci.indexOf(b[0]));
    const pravy = TERAZ_STLPCE.pravy.map(blok).filter((b) => b.length);
    return { lavy, pravy };
}

/**
 * Polovičná dlaždica dvojice má miesto len na jednu odrážku: prvú, alebo odznak, kedy bude slnko, ktorý ju nahradí.
 * @template {{ odr: string[], potom?: unknown }} T
 * @param {T} d
 * @returns {T}
 */
export const polovicaDlazdice = (d) => ({ ...d, odr: d.potom ? [] : d.odr.slice(0, 1) });
