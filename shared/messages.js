// Všetky texty pre používateľa - spoločný vstup. Čisté funkcie bez DOM.
//
// Texty sú v troch súboroch, aby nová appka (obloha/) pri štarte nesťahovala texty kariet, ktoré
// nie sú vidieť: messages-core.js (hlášky, Môžem?, Teraz, hlavička), messages-sedem.js (7 dní,
// denné a týždenné hlášky) a messages-statistika.js (Štatistika, plagát, súhrn). Jadro novej
// appky importuje messages-core.js priamo; ostatní (súčasná appka, karty novej appky načítané
// neskôr, testy) berú všetko odtiaľto.
//
// Tón hlášok: drzý (predvolený, ním hovorí súčasná appka) a slušný, ktorý vyká a je vecný - voľba
// v novej appke (obloha/). Tón je parameter `voice` textových funkcií (posledný, predvolený drzý)
// a pevné texty v oboch tónoch vracia voiceTexts. Slušná varianta stojí pri drzej; kde text
// nikoho neoslovuje a nemá postoj (čísla, časy, popisky), je jeden pre oba tóny.

import { voiceTexts as coreTexts } from './messages-core.js';
import { sedemTexts } from './messages-sedem.js';
import { statistikaTexts } from './messages-statistika.js';

export * from './messages-core.js';
export * from './messages-sedem.js';
export * from './messages-statistika.js';

/** @typedef {import('./messages-core.js').Voice} Voice tón hlášok */
/** @typedef {import('./messages-core.js').Message} Message */

/** Pevné texty drzého tónu - tie isté objekty, ktoré používa súčasná appka. */
const DRZY = { ...coreTexts('drzy'), SEDEM_TEXTS: sedemTexts('drzy'), STATISTIKA_TEXTS: statistikaTexts('drzy') };

/** @type {typeof DRZY} */
const SLUSNY = { ...coreTexts('slusny'), SEDEM_TEXTS: sedemTexts('slusny'), STATISTIKA_TEXTS: statistikaTexts('slusny') };

/** Pevné texty v danom tóne, všetkých kariet; oba tóny majú tie isté kľúče. @param {Voice} [voice] */
export function voiceTexts(voice = 'drzy') {
    return voice === 'slusny' ? SLUSNY : DRZY;
}
