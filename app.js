// Štart appky: DOM, stav, prekreslenie pri každej zmene, poslucháče, prvé načítanie dát.

import { sameSettings, settingsFromLink, typicalSettings } from './shared/settings.js';
import { collectDom } from './web/dom.js';
import { initInteractions, isTall } from './web/interactions.js';
import { render } from './web/render/index.js';
import { initUrlMirror, loadDayLog, loadLaunches, loadSettings, loadSite, loadStartPanel } from './web/settings-store.js';
import { createStore, initialState } from './web/state.js';

// Jediná šírka, o ktorej appka vie: od 768 px kreslí grafy na skutočný rozmer karty.
// Zvyšok rozloženia (vrátane desktopu od 1024 px) rieši CSS samo.
const mq = { wide: window.matchMedia('(min-width: 768px)') };
const dom = collectDom();
const now = new Date();
// Uložená elektráreň; bez nej aspoň poloha (typická strecha), bez nej appka začne otázkou na polohu.
const saved = loadSettings();
const site = saved ? null : loadSite();
// Odkaz s nastavením (#nastavenie=…): appka ho ponúkne prevziať, sama ho neuloží. V adrese
// ostáva, kým sa človek nerozhodne (viď initUrlMirror); to isté, čo je už uložené, sa neponúka.
const linked = settingsFromLink(location.hash);
const incoming = linked && !(saved && sameSettings(linked, saved)) ? linked : null;
const layout = { wide: mq.wide.matches, tall: isTall() };
const settings = saved || (site ? typicalSettings(site) : null);
// Karta, na ktorej sa appka otvára: voľba tohto telefónu, inak z odkazu pre rodinu (&prva=…).
const startPanel = loadStartPanel(location.hash);
const store = createStore({
    ...initialState(now, layout, { settings, demo: !saved, incoming, startPanel }),
    launches: loadLaunches(),
    dayLog: loadDayLog(),
});

initUrlMirror(store);
store.subscribe((state) => render(state, dom));
const refresh = initInteractions(store, dom, mq);
render(store.get(), dom);
refresh();
