// Klimatizácia Daikin (docs/navrhy/klima-daikin.html): stav hlási skript na Shelly v domácej sieti do Durable Objectu účtu
// Huawei Northbound. Appka si ho vezme cez Worker `/klima-stav` pri každej obnove dát; dlaždicu a panel kreslí
// render/teraz.js. Iné zdroje merania Durable Object nemajú.

import { stavKlimy } from './data.js';

/**
 * Stav, ktorý modul potrebuje.
 * @typedef {{ get: () => { zdroj: import('../shared/zdroje.js').Zdroj | null },
 *   setState: (patch: { klima?: import('../shared/klima.js').KlimaStav | null }) => void }} Store
 */

/** Poradie dopytov: odpoveď staršieho dopytu, ktorá príde po novšom, už nič neprepíše. */
let poslany = 0;

/**
 * Stav klimatizácie z Workera. Pri inom zdroji merania nič; keď Worker neodpovie, ostáva posledný stav (dlaždica podľa
 * jeho veku povie, že klimatizácia mlčí). Nikdy nehádže.
 * @param {Store} store
 */
export async function obnovKlimu(store) {
    const { zdroj } = store.get();
    if (zdroj?.sposob !== 'huawei-northbound') return;
    const cislo = ++poslany;
    const r = await stavKlimy(zdroj.pecat);
    const teraz = store.get().zdroj;
    if (!r || cislo !== poslany || teraz?.sposob !== zdroj.sposob || teraz.nazov !== zdroj.nazov) return;
    store.setState({ klima: r.klima });
}
