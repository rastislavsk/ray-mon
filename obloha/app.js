// Štart novej appky: DOM, stav z uloženého nastavenia (to isté, čo číta súčasná appka),
// prekreslenie pri každej zmene, poslucháče, prvé načítanie dát.

import { incomingSettings, linkHash, readLink } from '../shared/settings.js';
import { initUrlMirror } from '../web/settings-store.js';
import { createStore } from '../web/store.js';
import {
    dropOldStored,
    loadDayLog,
    loadRanna,
    loadLook,
    loadOdmietnutie,
    loadOznamenia,
    loadSettings,
    loadSite,
    loadStartPanel,
    loadVlastnaAdresa,
    loadVymazane,
} from '../web/storage.js';
import { initOznamZosulad, initOznamZrkadlo, oznamStav } from '../web/oznamenia.js';
import { collectDom } from './web/dom.js';
import { initInteractions } from './web/interactions.js';
import { initParts, preloadParts } from './web/parts.js';
import { render } from './web/render/index.js';
import { initialState, layoutOf } from './web/state.js';

const dom = collectDom();
// Uložená elektráreň; bez nej aspoň poloha (typická strecha).
const saved = loadSettings();
const site = saved ? null : loadSite();
// Odkaz s nastavením (#nastavenie=…): appka ho ponúkne prevziať, sama ho neuloží - ako súčasná
// appka. To isté, čo je už uložené, sa neponúka.
// Odkaz, ktorý appka nevie prevziať, nezmizne potichu - ponuka povie prečo (linkError). Adresa,
// ktorú appka v tejto karte zapísala sama, odkazom nie je - po obnovení nesie staré nastavenie.
// Ani vlastná adresa z histórie prehliadača, keď je uložené novšie alebo boli údaje vymazané.
const hash = linkHash(location.pathname, location.hash, loadVlastnaAdresa(), saved !== null || loadVymazane());
const link = readLink(hash);
const linked = link?.settings ?? null;
const incoming = incomingSettings(linked, saved);
// Dáta, ktoré appky už nepoužívajú (zápisy „Pustil/a som“), v telefóne nenechávame.
dropOldStored();
// Úvodná karta je voľba telefónu, spoločná so súčasnou appkou (prva-karta-v1).
const store = createStore(
    initialState(new Date(), {
        saved,
        site,
        incoming,
        linkError: link?.error ?? null,
        startPanel: loadStartPanel(hash),
        dayLog: loadDayLog(),
        ranna: loadRanna(),
        online: navigator.onLine,
        // Prístup k meraniu, ktorý výrobca odmietol - appka po otvorení neskúša zlé heslo hneď znova.
        pristup: loadOdmietnutie(),
        // Tón hlášok a živá obloha sú voľby len novej appky (vzhlad-v1).
        look: loadLook(),
        // Rozloženie podľa šírky okna (shared/config.js, LAYOUT_PX); pri jej zmene ho prepne interactions.js.
        layout: layoutOf(window.innerWidth),
        // Ranné oznámenie a spotrebiče doma - voľba telefónu, spoločná so súčasnou appkou (oznamenia-v1).
        oznamenia: loadOznamenia(),
        oznamStav: oznamStav(),
    }),
);

// Adresa nesie uložené nastavenie - appka pridaná na plochu iPhonu si ho tak prenesie zo Safari.
initUrlMirror(store);
// Service worker ranného oznámenia nevidí localStorage - appka mu nastavenie odkladá sama.
initOznamZrkadlo(store, 'obloha/');
initOznamZosulad(store);
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
