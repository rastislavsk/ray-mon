// Texty pre používateľa, ktoré appka potrebuje hneď pri štarte - vstup jadra. Samotné texty sú
// po kartách: messages-zaklad.js (tón, hlášky podľa výroby a ceny, spoločné tvary), messages-mozem.js
// (karta Dnes, Plán dňa, hlavička), messages-teraz.js a messages-oznamenia.js. Závisia len jedným
// smerom: základ <- mozem <- teraz, oznamenia; tu sa skladajú pevné texty podľa tónu. Texty karty 7 dní (a denné a týždenné hlášky) sú
// v messages-sedem.js, Štatistiky a súhrnu v messages-statistika.js - appka ich sťahuje, až
// keď tie karty načíta (web/parts.js). Spoločný vstup do všetkých textov je messages.js.
// Čisté funkcie bez DOM.
//
// Tón hlášok: drzý (predvolený) a slušný, ktorý vyká a je vecný - voľba
//. Tón je parameter `voice` textových funkcií (posledný, predvolený drzý)
// a pevné texty v oboch tónoch vracia voiceTexts. Slušná varianta stojí pri drzej; kde text
// nikoho neoslovuje a nemá postoj (čísla, časy, popisky), je jeden pre oba tóny.

import {
    DEN_WORDS,
    DEN_WORDS_SLUSNE,
    HEADER_TEXTS,
    HEADER_TEXTS_SLUSNE,
    MOZEM_CHIPS,
    MOZEM_CHIPS_SLUSNE,
    MOZEM_ITEM_TEXTS,
    MOZEM_ITEM_TEXTS_SLUSNE,
    MOZEM_SKY_TEXTS,
    MOZEM_SKY_TEXTS_SLUSNE,
    MOZEM_UNKNOWN,
    MOZEM_UNKNOWN_SLUSNE,
    MOZEM_WORDS,
    MOZEM_WORDS_SLUSNE,
} from './messages-mozem.js';
import { TERAZ_TEXTS, TERAZ_TEXTS_SLUSNE } from './messages-teraz.js';
import {
    NIGHT_MESSAGES,
    NIGHT_MESSAGES_SLUSNE,
    PRICE_MESSAGES,
    PRICE_MESSAGES_SLUSNE,
    SLOT_MESSAGES,
    SLOT_MESSAGES_SLUSNE,
    polite,
} from './messages-zaklad.js';

export * from './messages-zaklad.js';
export * from './messages-mozem.js';
export * from './messages-oznamenia.js';
export * from './messages-teraz.js';

// ---- Pevné texty podľa tónu ---------------------------------------------------------

/** Pevné texty drzého tónu. Celé (aj s kartami 7 dní a Štatistika) vracia voiceTexts v messages.js. */
const DRZY = {
    SLOT_MESSAGES,
    NIGHT_MESSAGES,
    PRICE_MESSAGES,
    MOZEM_WORDS,
    DEN_WORDS,
    MOZEM_ITEM_TEXTS,
    MOZEM_UNKNOWN,
    MOZEM_CHIPS,
    MOZEM_SKY_TEXTS,
    HEADER_TEXTS,
    TERAZ_TEXTS,
};

/** @type {typeof DRZY} */
const SLUSNY = {
    SLOT_MESSAGES: SLOT_MESSAGES_SLUSNE,
    NIGHT_MESSAGES: NIGHT_MESSAGES_SLUSNE,
    PRICE_MESSAGES: PRICE_MESSAGES_SLUSNE,
    MOZEM_WORDS: MOZEM_WORDS_SLUSNE,
    DEN_WORDS: DEN_WORDS_SLUSNE,
    MOZEM_ITEM_TEXTS: MOZEM_ITEM_TEXTS_SLUSNE,
    MOZEM_UNKNOWN: MOZEM_UNKNOWN_SLUSNE,
    MOZEM_CHIPS: MOZEM_CHIPS_SLUSNE,
    MOZEM_SKY_TEXTS: MOZEM_SKY_TEXTS_SLUSNE,
    HEADER_TEXTS: HEADER_TEXTS_SLUSNE,
    TERAZ_TEXTS: TERAZ_TEXTS_SLUSNE,
};

/** Pevné texty jadra v danom tóne; oba tóny majú tie isté kľúče. @param {import('./messages-zaklad.js').Voice} [voice] */
export function voiceTexts(voice = 'drzy') {
    return polite(voice) ? SLUSNY : DRZY;
}
