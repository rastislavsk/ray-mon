// Štart novej appky: DOM, stav z uloženého nastavenia (to isté, čo číta súčasná appka),
// prekreslenie pri každej zmene, poslucháče, prvé načítanie dát.

import { sameSettings, settingsFromLink } from '../shared/settings.js';
import { initUrlMirror } from '../web/settings-store.js';
import { createStore } from '../web/store.js';
import { loadDayLog, loadLaunches, loadLook, loadSettings, loadSite, loadStartPanel } from '../web/storage.js';
import { collectDom } from './web/dom.js';
import { initInteractions } from './web/interactions.js';
import { initParts, preloadParts } from './web/parts.js';
import { render } from './web/render/index.js';
import { initialState, layoutOf } from './web/state.js';
// Ostatné moduly jadra: app.js ich nevolá, ale importuje priamo, aby ich prehliadač začal sťahovať
// naraz s ostatnými - inak by o každej úrovni importov zistil až po stiahnutí tej predchádzajúcej
// (bez build kroku je to otáčka siete na úroveň). Poradie vyhodnotenia sa nemení: všetky už
// importujú moduly vyššie. Zoznam drží zhodný so stromom importov test/obloha-imports.test.js.
import '../shared/chart-model.js';
import '../shared/config.js';
import '../shared/contrast.js';
import '../shared/day-chart.js';
import '../shared/day-plan.js';
import '../shared/daylog.js';
import '../shared/format.js';
import '../shared/hero-model.js';
import '../shared/kiosk.js';
import '../shared/launches.js';
import '../shared/messages-core.js';
import '../shared/mozem-sky.js';
import '../shared/mozem.js';
import '../shared/schema.js';
import '../shared/setup-flow.js';
import '../shared/setup.js';
import '../shared/sky.js';
import '../shared/solar.js';
import '../shared/tariff.js';
import '../shared/teraz.js';
import '../shared/valid.js';
import '../web/data.js';
import '../web/gesture.js';
import '../web/nav-history.js';
import '../web/refresh.js';
import './web/mozem-interactions.js';
import './web/nav-back.js';
import './web/render/day-chart.js';
import './web/render/header.js';
import './web/render/mozem.js';
import './web/render/teraz.js';
import './web/render/write.js';
import './web/teraz-interactions.js';

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
// Karty 7 dní, Štatistika a Nastavenie sa sťahujú až keď treba (web/parts.js). Prvé vykreslenie
// počká len na tie, ktoré úvodná obrazovka ukazuje - na telefóne na žiadnu.
await initParts(store, dom, refresh);
store.subscribe((state) => render(state, dom));
render(store.get(), dom);
refresh();
preloadParts(store, dom, refresh);
