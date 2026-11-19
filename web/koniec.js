// Oznámenie o konci programu (docs/navrhy/spotrebic-koniec-opakovanie.html): po zápise „Už beží“, zmene zvyšku či času
// zapnutia a po „Nebeží“ objedná vo Workeri push s textom na čas konca behu, alebo ho zruší. Text skladá jadro
// (koniecNotice) z plánu dňa v chvíli objednania. Či oznámenie príde, povie stav `koniecOznam`.

import { beziaci } from '../shared/bezi.js';
import { PUSH_TEXT, WORKER_KONIEC_URL } from '../shared/config.js';
import { koniecNotice } from '../shared/oznamenia.js';
import { localDateKey, localMinutes, localToUtc } from '../shared/solar.js';
import { odberSTextom, posliSOdberom } from './oznamenia.js';

/** @typedef {import('./state.js').Store} Store */

/** Objednávky, ktoré čakajú na koniec ťukania na − a +, podľa spotrebiča. @type {Map<string, ReturnType<typeof setTimeout>>} */
const cakaju = new Map();

/**
 * Objedná oznámenie o konci behu spotrebiča `id` (alebo ho zruší, keď nebeží). Po „Už beží“ (`pytaj`) hneď a s otázkou
 * na povolenie - ide z ťuknutia. Po − a + až po PUSH_TEXT.cakajMs bez ďalšej zmeny, po „Nebeží“ hneď (`hned`).
 * @param {Store} store @param {string} id @param {{ pytaj?: boolean, hned?: boolean }} [o]
 */
export function objednajKoniec(store, id, { pytaj = false, hned = false } = {}) {
    clearTimeout(cakaju.get(id));
    cakaju.delete(id);
    if (pytaj || hned) {
        void posli(store, id, pytaj);
        return;
    }
    cakaju.set(
        id,
        setTimeout(() => {
            cakaju.delete(id);
            void posli(store, id, false);
        }, PUSH_TEXT.cakajMs),
    );
}

/**
 * Pošle Workeru čas konca a text oznámenia, alebo bez času zrušenie. Telefón bez odberu, ktorý sa nepýta, nič neposiela.
 * @param {Store} store @param {string} id @param {boolean} pytaj
 */
async function posli(store, id, pytaj) {
    const odber = await odberSTextom(pytaj);
    if (odber === null) return;
    if (typeof odber === 'string') {
        store.setState({ koniecOznam: { id, stav: odber } });
        return;
    }
    const s = store.get();
    const now = new Date();
    const tz = s.site.timezone;
    const d = localDateKey(now, tz);
    // `?? []`: starý web/state.js z cache po nasadení pole bezi nemá.
    const beh = beziaci(s.bezi ?? [], id, d, localMinutes(now, tz));
    const text = beh ? koniecNotice({ ...s, now }, { id, devices: s.doma }) : null;
    const ok = await posliSOdberom(WORKER_KONIEC_URL, {
        ...odber,
        id,
        at: beh ? localToUtc(d, beh.k, tz).toISOString() : null,
        ...(text ?? {}),
    });
    if (beh) store.setState({ koniecOznam: { id, stav: ok ? 'ok' : 'chyba' } });
}
