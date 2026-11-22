// Oznámenie o konci programu (docs/navrhy/spotrebic-koniec-opakovanie.html): po „Nastaviť“, „Nebeží“ a „Vrátiť“
// (docs/navrhy/spotrebic-cas-nastavenie.html) objedná vo Workeri push s textom na čas konca behu, alebo ho zruší. Text skladá jadro
// (koniecNotice) z plánu dňa v chvíli objednania. Či oznámenie príde, povie stav `koniecOznam`.

import { beziaci } from '../shared/bezi.js';
import { WORKER_KONIEC_URL } from '../shared/config.js';
import { koniecNotice } from '../shared/oznamenia.js';
import { localDateKey, localMinutes, localToUtc } from '../shared/solar.js';
import { odberSTextom, posliSOdberom } from './oznamenia.js';

/** @typedef {import('./state.js').Store} Store */

/**
 * Objedná oznámenie o konci behu spotrebiča `id` (alebo ho zruší, keď nebeží) po „Nastaviť“, „Nebeží“ či „Vrátiť“.
 * Po prvom nastavení behu (`pytaj`) s otázkou na povolenie - ide z ťuknutia.
 * @param {Store} store @param {string} id @param {boolean} [pytaj]
 */
export function objednajKoniec(store, id, pytaj = false) {
    void posli(store, id, pytaj);
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
