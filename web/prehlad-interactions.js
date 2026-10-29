// Prehľad karty Nastavenie súčasnej appky: Čo máš doma, Oznámenia, Vzhľad a Vymazať údaje.
// Voľby skladá render (render/prehlad.js), poslucháč sedí na ich obale. Zapnutie, vypnutie
// a uloženie oznámení je spoločné s novou appkou (web/oznamenia.js), rovnako úložisko spotrebičov
// a vzhľadu (web/storage.js) - voľby platia v oboch appkách.

import { VOICES } from '../shared/config.js';
import { prepniSpotrebic } from '../shared/doma.js';
import { backTo } from './history.js';
import { nastavOznamenia, vypniOznamenia } from './oznamenia.js';
import { clearStored, saveDoma, saveLook } from './storage.js';

/** @typedef {import('./state.js').Store} Store */
/** @typedef {import('./dom.js').Dom} Dom */

/** Súčasná appka je v koreni, tam leží aj jej service worker (sw.js). */
const APP = './';

/** @param {Store} store @param {Dom} dom */
export function initPrehlad(store, dom) {
    initDoma(store, dom);
    initOznamenia(store, dom);
    initVzhlad(store, dom);
    initClearData(store, dom);
}

/** Čo máš doma: spotrebič pridá či uberie a uloží. @param {Store} store @param {Dom} dom */
function initDoma(store, dom) {
    dom.domaBody.addEventListener('change', (e) => {
        const id = /** @type {HTMLInputElement} */ (e.target).dataset.doma;
        if (!id) return;
        const doma = prepniSpotrebic(store.get().doma, id);
        saveDoma(doma);
        store.setState({ doma });
    });
}

/** Oznámenia: prepínač a hodina. @param {Store} store @param {Dom} dom */
function initOznamenia(store, dom) {
    dom.oznamBody.addEventListener('change', async (e) => {
        const input = /** @type {HTMLInputElement} */ (e.target);
        const s = store.get();
        // Kým sa zapína, ďalšia zmena by sa po dobehnutí prepísala starou voľbou.
        if (s.oznamStav === 'caka') return;
        /** @type {Partial<import('../shared/oznamenia.js').Oznamenia>} */ let zmena = {};
        if (input.matches('[data-oznam-on]')) zmena = { on: input.checked };
        else if (input.dataset.oznamHour) zmena = { hour: Number(input.dataset.oznamHour) };
        else return;
        if (zmena.on || (zmena.hour !== undefined && s.oznamenia.on)) store.setState({ oznamStav: 'caka' });
        store.setState(await nastavOznamenia(s.oznamenia, zmena, { app: APP, timeZone: s.site.timezone }));
    });
}

/** Vzhľad: tón hlášok (spoločný s novou appkou) a farba pozadia. @param {Store} store @param {Dom} dom */
function initVzhlad(store, dom) {
    dom.vzhladBody.addEventListener('change', (e) => {
        const input = /** @type {HTMLInputElement} */ (e.target);
        const voice = VOICES.find((v) => v === input.dataset.voice);
        /** @type {Partial<Pick<import('./state.js').AppState, 'voice' | 'bgTint'>>} */
        const zmena = voice ? { voice } : input.matches('[data-farba]') ? { bgTint: input.checked } : {};
        if (!Object.keys(zmena).length) return;
        saveLook(zmena);
        store.setState(zmena);
    });
}

/**
 * „Vymazať údaje“: rozbalenie položky je prvý krok, tlačidlo Vymazať potvrdenie, Nechať tak ju
 * zbalí. Po vymazaní sa stránka obnoví a appka naštartuje ako pri prvom otvorení - jednoduchšie
 * a istejšie než skladať čistý stav ručne. Adresu treba vyčistiť tiež: nesie uložené nastavenie
 * (initUrlMirror) a appka by ho po obnovení ponúkla prevziať.
 * @param {Store} store @param {Dom} dom
 */
function initClearData(store, dom) {
    dom.clearCancel.addEventListener('click', () => backTo(store, { infoOpen: null }));
    dom.clearData.addEventListener('click', async () => {
        // Aj ranné oznámenie: inak by Worker telefón budil ďalej s nastavením, ktoré už nie je.
        await vypniOznamenia();
        clearStored();
        history.replaceState(null, '', location.pathname + location.search);
        location.reload();
    });
}
