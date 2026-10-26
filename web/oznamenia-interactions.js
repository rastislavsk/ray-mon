// Položka Oznámenia v karte Nastavenie súčasnej appky: prepínač, hodina a spotrebiče doma. Voľby
// skladá render (render/oznamenia.js), poslucháč sedí na ich obale. Zapnutie, vypnutie a uloženie
// je spoločné s novou appkou (web/oznamenia.js).

import { nastavOznamenia, prepniSpotrebic } from './oznamenia.js';

/** Súčasná appka je v koreni, tam leží aj service worker. */
const ROOT = './';

/** @param {import('./state.js').Store} store @param {import('./dom.js').Dom} dom */
export function initOznamenia(store, dom) {
    dom.oznamBody.addEventListener('change', async (e) => {
        const input = /** @type {HTMLInputElement} */ (e.target);
        const s = store.get();
        /** @type {Partial<import('../shared/oznamenia.js').Oznamenia>} */ let zmena = {};
        if (input.matches('[data-oznam-on]')) zmena = { on: input.checked };
        else if (input.dataset.oznamHour) zmena = { hour: Number(input.dataset.oznamHour) };
        else if (input.dataset.oznamDevice) zmena = prepniSpotrebic(s.oznamenia, input.dataset.oznamDevice);
        else return;
        if (zmena.on) store.setState({ oznamStav: 'caka' });
        store.setState(await nastavOznamenia(s.oznamenia, zmena, { root: ROOT, timeZone: s.site.timezone }));
    });
}
