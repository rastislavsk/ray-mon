// Štart novej appky: DOM, stav z uloženého nastavenia (to isté, čo číta súčasná appka),
// prekreslenie pri každej zmene, poslucháče, prvé načítanie dát.

import { sameSettings, settingsFromLink } from '../shared/settings.js';
import { initUrlMirror } from '../web/settings-store.js';
import { createStore } from '../web/store.js';
import { loadDayLog, loadLaunches, loadLook, loadSettings, loadSite, loadStartPanel } from '../web/storage.js';
import { collectDom } from './web/dom.js';
import { initInteractions } from './web/interactions.js';
import { render } from './web/render/index.js';
import { initialState, layoutOf } from './web/state.js';

const dom = collectDom();
// Uložená elektráreň; bez nej aspoň poloha (typická strecha).
const saved = loadSettings();
const site = saved ? null : loadSite();
// Odkaz s nastavením (#nastavenie=…): appka ho ponúkne prevziať, sama ho neuloží - ako súčasná
// appka. To isté, čo je už uložené, sa neponúka.
const linked = settingsFromLink(location.hash);
const incoming = linked && !(saved && sameSettings(linked, saved)) ? linked : null;
// Úvodná karta je voľba telefónu, spoločná so súčasnou appkou (prva-karta-v1), rovnako ako
// zápisy „Pustil/a som“ (spustenia-v1).
const store = createStore(
    initialState(new Date(), {
        saved,
        site,
        incoming,
        startPanel: loadStartPanel(location.hash),
        dayLog: loadDayLog(),
        launches: loadLaunches(),
        online: navigator.onLine,
        // Tón hlášok a živá obloha sú voľby len novej appky (vzhlad-v1).
        look: loadLook(),
        // Rozloženie podľa šírky okna (shared/config.js, LAYOUT_PX); pri jej zmene ho prepne interactions.js.
        layout: layoutOf(window.innerWidth),
    }),
);

// Adresa nesie uložené nastavenie - appka pridaná na plochu iPhonu si ho tak prenesie zo Safari.
initUrlMirror(store);
// Poslucháči (aj zápis krokov do histórie) sa prihlásia pred prekreslením: nový krok sa tak zapíše
// skôr, než render posunie stránku (detail karty 7 dní začína hore). Prehliadač si pri zápise
// pamätá posun opúšťanej položky a po Späť ho obnoví - musí to byť posun prehľadu, nie nula.
const refresh = initInteractions(store, dom);
store.subscribe((state) => render(state, dom));
render(store.get(), dom);
refresh();
