// Auto čisto zo slnka v telefóne (docs/navrhy/auto-mimo-planu.html, A1): pri prvej obnove dňa spočíta odhad na celý
// deň a zamrazí ho (cez deň sa nemení), po západe slnka ho raz prepíše skutočnosťou - výroba z nameranej krivky dneška,
// dom z hodín histórie Workera (pri Huawei Northbound) a bojler zo záznamu zásuvky. Výpočet je v shared/auto-slnko.js.

import { autoDnes, autoKrok, domDnes } from '../shared/auto-slnko.js';
import { daylightSpan, localDateKey, localMinutes } from '../shared/solar.js';
import { domProfil, naucenaPredpoved } from '../shared/ucenie.js';
import { historiaZWorkera } from './data.js';
import { loadAutoDen, saveAutoDen } from './storage.js';

/** Úložisko stavu, ako ho auto potrebuje. @typedef {import('./refresh.js').RefreshStore} Store */

/**
 * Ranný odhad či večerný prepis auta zo slnka, keď je na rade (autoKrok); inak len to, čo telefón dnes už má. Bez
 * predpovede či bez auta doma nič. Večer pri Huawei Northbound bez histórie z Workera počká na ďalšiu obnovu.
 * @param {Store} store @param {typeof fetch} [fetchImpl]
 */
export async function obnovAutoDen(store, fetchImpl = fetch) {
    const s = store.get();
    // `?? []`: starý web/state.js z cache po nasadení pole doma nemusí mať (CLAUDE.md, Nasadenie a cache).
    if (!s.forecast || !(s.doma ?? []).includes('auto')) return;
    const now = new Date();
    const tz = s.site.timezone;
    const d = localDateKey(now, tz);
    const ulozene = loadAutoDen();
    const krok = autoKrok(ulozene, { d, nowMin: localMinutes(now, tz), zapad: daylightSpan(s.site, d).to });
    if (!krok) {
        if (ulozene && JSON.stringify(ulozene) !== JSON.stringify(s.autoDen ?? null)) store.setState({ autoDen: ulozene });
        return;
    }
    const dom = krok === 'vecer' ? await domVecer(store, d, fetchImpl) : null;
    if (dom === undefined) return;
    // Predpoveď s učením, tak ako ju kreslí appka (sNaucenim vo web/render/index.js).
    const teraz = { ...store.get(), now };
    const input = { ...teraz, forecast: naucenaPredpoved(teraz.forecast, teraz.ucenie) };
    const autoDen = { d, ...autoDnes(input, dom), vecer: krok === 'vecer' };
    saveAutoDen(autoDen);
    store.setState({ autoDen });
}

/**
 * Spotreba domu dneška `d` po hodinách na večerný prepis (domDnes): pri Huawei Northbound z histórie Workera, inak
 * naučený profil. Keď história neprišla, undefined - prepis počká na ďalšiu obnovu.
 * @param {Store} store @param {string} d @param {typeof fetch} fetchImpl @returns {Promise<number[] | undefined>}
 */
async function domVecer(store, d, fetchImpl) {
    const s = store.get();
    const dni = s.zdroj?.sposob === 'huawei-northbound' ? await historiaZWorkera(s.zdroj.pecat, fetchImpl) : [];
    return dni ? domDnes(domProfil(s.ucenie, d), dni, s.bezi ?? [], d) : undefined;
}
