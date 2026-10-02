// Štart novej appky: DOM, stav z uloženého nastavenia (to isté, čo číta súčasná appka),
// prekreslenie pri každej zmene, poslucháče, prvé načítanie dát.

import { createStore } from '../web/store.js';
import { loadDayLog, loadLaunches, loadSettings, loadSite, loadStartPanel } from '../web/storage.js';
import { collectDom } from './web/dom.js';
import { initInteractions } from './web/interactions.js';
import { render } from './web/render/index.js';
import { initialState } from './web/state.js';

const dom = collectDom();
// Uložená elektráreň; bez nej aspoň poloha (typická strecha).
const saved = loadSettings();
const site = saved ? null : loadSite();
// Úvodná karta je voľba telefónu, spoločná so súčasnou appkou (prva-karta-v1), rovnako ako
// zápisy „Pustil/a som“ (spustenia-v1).
const store = createStore(
    initialState(new Date(), {
        saved,
        site,
        startPanel: loadStartPanel(location.hash),
        dayLog: loadDayLog(),
        launches: loadLaunches(),
        online: navigator.onLine,
    }),
);

store.subscribe((state) => render(state, dom));
const refresh = initInteractions(store, dom);
render(store.get(), dom);
refresh();
