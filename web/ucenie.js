// Učenie Plánu dňa v telefóne (docs/navrhy/plan-dna-ucenie.html): raz za deň stiahne históriu elektrárne z Workera
// (len Huawei Northbound) a z nej, snímok predpovede a behov prepočíta, čo sa appka naučila (shared/ucenie.js). Model
// ide do stavu; karty ho vidia cez render (naučená predpoveď) a Plán dňa (spotreba domu, potreba bojlera).

import { localDateKey } from '../shared/solar.js';
import { naucene } from '../shared/ucenie.js';
import { stiahniHistoriu } from './data.js';
import { loadUcenie, saveHistoria, saveUcenieOd } from './storage.js';

/** Úložisko stavu, ako ho učenie potrebuje. @typedef {import('./refresh.js').RefreshStore} Store */

/**
 * Prepočíta model učenia. Históriu z Workera stiahne, keď nie je z dneška a appka meria cez Huawei Northbound - inak
 * použije, čo má.
 * @param {Store} store @param {typeof fetch} [fetchImpl]
 */
export async function obnovUcenie(store, fetchImpl = fetch) {
    const s = store.get();
    const today = localDateKey(new Date(), s.site.timezone);
    const vstup = loadUcenie();
    let historia = vstup.historia;
    if (historia?.d !== today && s.zdroj?.sposob === 'huawei-northbound') {
        const dni = await stiahniHistoriu(s.zdroj.pecat, fetchImpl);
        if (dni) {
            historia = { d: today, dni };
            saveHistoria(historia);
        }
    }
    const model = naucene({ dni: historia?.dni ?? [], snimky: vstup.snimky, behy: vstup.behy, today, od: vstup.od });
    if (JSON.stringify(model) !== JSON.stringify(store.get().ucenie)) store.setState({ ucenie: model });
}

/** „Začať odznova“ v Nastavení: appka sa učí až od dneška. @param {Store} store */
export function zacniOdznova(store) {
    saveUcenieOd(localDateKey(new Date(), store.get().site.timezone));
    return obnovUcenie(store);
}
