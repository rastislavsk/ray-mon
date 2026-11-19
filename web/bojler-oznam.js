// Oznámenia bojlera (docs/navrhy/spotrebic-koniec-opakovanie.html): vypínač v paneli Bojler dnes prihlási či odhlási odber
// tohto telefónu vo Workeri. Durable Object účtu ho pri každej zmene ohrevu zobudí pushom s textom (worker/src/ucet.js).
// Voľba patrí telefónu (BOJLER_OZNAM_STORAGE_KEY); kreslí ju render/teraz.js.

import { WORKER_BOJLER_OZNAM_URL } from '../shared/config.js';
import { odberSTextom, posliSOdberom } from './oznamenia.js';
import { saveBojlerOznam } from './storage.js';

/** @typedef {import('./state.js').Store} Store */

/**
 * Vypínač: zapnutie si vypýta povolenie a odber, Worker ho uloží; až potom je zapnuté. Vypnutie odber vo Workeri zruší -
 * telefón bez odberu či bez povolenia ho tam nemá, je vypnuté hneď. Čo zlyhá, povie `bojlerOznamStav`.
 * @param {Store} store @param {boolean} on
 */
export async function zmenOznamBojlera(store, on) {
    const { zdroj, bojlerOznamStav } = store.get();
    if (!zdroj || bojlerOznamStav === 'uklada') return;
    store.setState({ bojlerOznamStav: 'uklada' });
    const odber = await odberSTextom(on);
    const hotovo = () => {
        saveBojlerOznam(on);
        store.setState({ bojlerOznam: on, bojlerOznamStav: null });
    };
    if (odber === null || typeof odber === 'string') {
        if (!on) return hotovo();
        store.setState({ bojlerOznamStav: odber === 'zakazane' ? 'zakazane' : 'chyba' });
        return;
    }
    if (await posliSOdberom(WORKER_BOJLER_OZNAM_URL, { pecat: zdroj.pecat, ...odber, on })) return hotovo();
    store.setState({ bojlerOznamStav: 'chyba' });
}

/**
 * Pri štarte: zapnuté oznámenia pošle Workeru znova - push služba mohla odber medzičasom vymeniť. Bez povolenia sa nepýta.
 * @param {Store} store
 */
export async function obnovOznamBojlera(store) {
    const { zdroj, bojlerOznam } = store.get();
    if (!bojlerOznam || !zdroj) return;
    const odber = await odberSTextom(false);
    if (odber && typeof odber !== 'string') await posliSOdberom(WORKER_BOJLER_OZNAM_URL, { pecat: zdroj.pecat, ...odber, on: true });
}
