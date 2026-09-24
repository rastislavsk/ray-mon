// Štart appky: DOM, stav, prekreslenie pri každej zmene, poslucháče, prvé načítanie dát.

import { demoSettings } from './shared/settings.js';
import { seasonFor } from './shared/tariff.js';
import { collectDom } from './web/dom.js';
import { initInteractions, isTall } from './web/interactions.js';
import { render } from './web/render/index.js';
import { loadSettings } from './web/settings-store.js';
import { createStore, initialState } from './web/state.js';

// Jediná šírka, o ktorej appka vie: od 768 px kreslí grafy na skutočný rozmer karty.
// Zvyšok rozloženia (vrátane desktopu od 1024 px) rieši CSS samo.
const mq = { wide: window.matchMedia('(min-width: 768px)') };
const dom = collectDom();
const now = new Date();
// Kto si ešte nič neuložil, vidí ukážku.
const saved = loadSettings();
const layout = { wide: mq.wide.matches, tall: isTall() };
const store = createStore(initialState(now, seasonFor(now), layout, saved || demoSettings(), !saved));

store.subscribe((state) => render(state, dom));
const refresh = initInteractions(store, dom, mq);
render(store.get(), dom);
refresh();
