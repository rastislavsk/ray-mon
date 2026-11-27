// Nabíjanie auta (docs/navrhy/auto-nabija.html): pri Huawei Northbound odhaduje Durable Object účtu, či sa auto nabíja
// (shared/auto-nabija.js). Appka si stav a behy vezme cez Worker `/auto` pri každej obnove dát a pri pushi o nabíjaní;
// prepínače v paneli Auto prihlásia či odhlásia odber tohto telefónu (`/auto-oznamenia`) zvlášť pre začiatok a koniec.
// Voľba patrí telefónu (AUTO_OZNAM_STORAGE_KEY); kreslí ju render/teraz.js. Iné zdroje merania Durable Object nemajú.

import { WORKER_AUTO_OZNAM_URL } from '../shared/config.js';
import { stavAuta } from './data.js';
import { odberSTextom, posliSOdberom } from './oznamenia.js';
import { saveAutoOznam } from './storage.js';

/**
 * Stav, ktorý modul potrebuje.
 * @typedef {{ get: () => { zdroj: import('../shared/zdroje.js').Zdroj | null, autoOznam?: { z: boolean, k: boolean },
 *   autoOznamStav?: 'uklada' | 'zakazane' | 'chyba' | null },
 *   setState: (patch: { autoNabija?: import('../shared/auto-nabija.js').AutoInfo | null, autoOznam?: { z: boolean, k: boolean },
 *   autoOznamStav?: 'uklada' | 'zakazane' | 'chyba' | null }) => void }} Store
 */

/** Poradie dopytov: odpoveď staršieho dopytu, ktorá príde po novšom, už nič neprepíše. */
let poslany = 0;

/**
 * Stav nabíjania z Workera. Pri inom zdroji merania nič; keď Worker neodpovie, ostáva posledný stav (nabíjanie
 * po AUTO_NABIJA.platnostMin bez merania appka aj tak neukáže). Nikdy nehádže.
 * @param {Store} store
 */
export async function obnovAuto(store) {
    const { zdroj } = store.get();
    if (zdroj?.sposob !== 'huawei-northbound') return;
    const cislo = ++poslany;
    const r = await stavAuta(zdroj.pecat);
    const teraz = store.get().zdroj;
    if (!r || cislo !== poslany || teraz?.sposob !== zdroj.sposob || teraz.nazov !== zdroj.nazov) return;
    store.setState({ autoNabija: r.auto });
}

/**
 * Prepínač oznámení o začiatku (`z`) či konci (`k`) nabíjania: zapnutie si vypýta povolenie a odber, Worker ho uloží;
 * až potom je zapnuté. Vypnutie oboch odber vo Workeri zruší - telefón bez odberu či povolenia ho tam nemá, je vypnuté
 * hneď. Čo zlyhá, povie `autoOznamStav`.
 * @param {Store} store @param {'z' | 'k'} druh @param {boolean} on
 */
export async function zmenOznamAuta(store, druh, on) {
    const { autoOznam = { z: false, k: false } } = store.get();
    await nastavOznamAuta(store, { ...autoOznam, [druh]: on }, on);
}

/**
 * Vypne oba odbery naraz - keď človek v Čo máš doma elektromobil vypne (docs/navrhy/nastavenie-co-mas-doma.html, P1).
 * @param {Store} store
 */
export async function vypniOznamAuta(store) {
    const o = store.get().autoOznam;
    if (o && (o.z || o.k)) await nastavOznamAuta(store, { z: false, k: false }, false);
}

/**
 * Uloží voľbu `novy` vo Workeri a v telefóne. `on`: zapína sa - smie si vypýtať povolenie.
 * @param {Store} store @param {{ z: boolean, k: boolean }} novy @param {boolean} on
 */
async function nastavOznamAuta(store, novy, on) {
    const { zdroj, autoOznamStav = null } = store.get();
    if (!zdroj || autoOznamStav === 'uklada') return;
    const zapnute = novy.z || novy.k;
    store.setState({ autoOznamStav: 'uklada' });
    const odber = await odberSTextom(on);
    const hotovo = () => {
        saveAutoOznam(novy);
        store.setState({ autoOznam: novy, autoOznamStav: null });
    };
    if (odber === null || typeof odber === 'string') {
        if (!zapnute) return hotovo();
        store.setState({ autoOznamStav: odber === 'zakazane' ? 'zakazane' : 'chyba' });
        return;
    }
    if (await posliSOdberom(WORKER_AUTO_OZNAM_URL, { pecat: zdroj.pecat, ...odber, ...novy })) return hotovo();
    store.setState({ autoOznamStav: 'chyba' });
}

/**
 * Pri štarte: zapnuté oznámenia pošle Workeru znova - push služba mohla odber medzičasom vymeniť. Bez povolenia sa nepýta.
 * @param {Store} store
 */
export async function obnovOznamAuta(store) {
    const { zdroj, autoOznam } = store.get();
    if (!zdroj || !autoOznam || !(autoOznam.z || autoOznam.k)) return;
    const odber = await odberSTextom(false);
    if (odber && typeof odber !== 'string') await posliSOdberom(WORKER_AUTO_OZNAM_URL, { pecat: zdroj.pecat, ...odber, ...autoOznam });
}
