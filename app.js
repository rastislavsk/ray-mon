// Štart appky: DOM, stav, prekreslenie pri každej zmene, poslucháče, prvé načítanie dát.

import { incomingSettings, readLink } from './shared/settings.js';
import { collectDom } from './web/dom.js';
import { initInteractions, isTall } from './web/interactions.js';
import { render } from './web/render/index.js';
import { dropOldStored, initUrlMirror, loadDayLog, loadOdmietnutie, loadSettings, loadSite, loadStartPanel } from './web/settings-store.js';
import { createStore, initialState } from './web/state.js';

// Jediná šírka, o ktorej appka vie: od 768 px kreslí grafy na skutočný rozmer karty.
// Zvyšok rozloženia (vrátane desktopu od 1024 px) rieši CSS samo.
const mq = { wide: window.matchMedia('(min-width: 768px)') };
const dom = collectDom();
const now = new Date();
// Dáta, ktoré appka už nepoužíva (zápisy „Pustil/a som“), v telefóne nenechávame.
dropOldStored();
// Uložená elektráreň; bez nej aspoň poloha (typická strecha), bez nej appka začne otázkou na polohu.
const saved = loadSettings();
const site = saved ? null : loadSite();
// Odkaz s nastavením (#nastavenie=…): appka ho ponúkne prevziať, sama ho neuloží. V adrese
// ostáva, kým sa človek nerozhodne (viď initUrlMirror); to isté, čo je už uložené, sa neponúka.
// Odkaz, ktorý appka nevie prevziať, nezmizne potichu - ponuka povie prečo (linkError).
const link = readLink(location.hash);
const linked = link?.settings ?? null;
const incoming = incomingSettings(linked, saved);
const layout = { wide: mq.wide.matches, tall: isTall() };
// Karta, na ktorej sa appka otvára: voľba tohto telefónu, inak z odkazu pre rodinu (&prva=…).
const startPanel = loadStartPanel(location.hash);
const store = createStore({
    ...initialState(now, layout, { saved, site, incoming, startPanel }),
    dayLog: loadDayLog(),
    pristup: loadOdmietnutie(),
    linkError: link?.error ?? null,
});

initUrlMirror(store);
store.subscribe((state) => render(state, dom));
const refresh = initInteractions(store, dom, mq);
render(store.get(), dom);
refresh();
