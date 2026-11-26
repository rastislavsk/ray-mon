// Oznámenie o konci behu spotrebiča na zásuvke Shelly (docs/navrhy/pracka-zasuvka.html): vypínač v detaile spotrebiča
// prihlási či odhlási odber tohto telefónu vo Workeri. Durable Object účtu ho zobudí pushom, keď zásuvka nameria koniec
// behu (worker/src/ucet.js). Voľba patrí telefónu (ZASUVKA_OZNAM_STORAGE_KEY) a platí pre všetky zásuvky; kreslí ju
// render/teraz.js. Rovnako ako oznámenia bojlera (web/bojler-oznam.js).

import { WORKER_SPOTREBIC_OZNAM_URL } from '../shared/config.js';
import { odberSTextom, posliSOdberom } from './oznamenia.js';
import { saveZasuvkaOznam } from './storage.js';

/** @typedef {import('./state.js').Store} Store */

/**
 * Vypínač: zapnutie si vypýta povolenie a odber, Worker ho uloží; až potom je zapnuté. Vypnutie odber vo Workeri zruší -
 * telefón bez odberu či bez povolenia ho tam nemá, je vypnuté hneď. Čo zlyhá, povie `zasuvkaOznamStav`.
 * @param {Store} store @param {boolean} on
 */
export async function zmenOznamZasuvky(store, on) {
    const { zdroj, zasuvkaOznamStav } = store.get();
    if (!zdroj || zasuvkaOznamStav === 'uklada') return;
    store.setState({ zasuvkaOznamStav: 'uklada' });
    const odber = await odberSTextom(on);
    const hotovo = () => {
        saveZasuvkaOznam(on);
        store.setState({ zasuvkaOznam: on, zasuvkaOznamStav: null });
    };
    if (odber === null || typeof odber === 'string') {
        if (!on) return hotovo();
        store.setState({ zasuvkaOznamStav: odber === 'zakazane' ? 'zakazane' : 'chyba' });
        return;
    }
    if (await posliSOdberom(WORKER_SPOTREBIC_OZNAM_URL, { pecat: zdroj.pecat, ...odber, on })) return hotovo();
    store.setState({ zasuvkaOznamStav: 'chyba' });
}

/**
 * Pri štarte: zapnuté oznámenie pošle Workeru znova - push služba mohla odber medzičasom vymeniť. Bez povolenia sa nepýta.
 * @param {Store} store
 */
export async function obnovOznamZasuvky(store) {
    const { zdroj, zasuvkaOznam } = store.get();
    if (!zasuvkaOznam || !zdroj) return;
    const odber = await odberSTextom(false);
    if (odber && typeof odber !== 'string') await posliSOdberom(WORKER_SPOTREBIC_OZNAM_URL, { pecat: zdroj.pecat, ...odber, on: true });
}
