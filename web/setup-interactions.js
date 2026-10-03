// Karta Nastavenie: poslucháče prehľadu elektrárne a sprievodcu jej nastavením. Sprievodcu
// obsluhuje web/setup-wiring.js (ten istý kód ako v novej appke), čo ktoré tlačidlo urobí, je
// v shared/setup-flow.js; kreslí web/render/nastavenie.js. Tu je len to, čím sa súčasná appka
// líši: krok späť cez jej históriu a karta po odložení panelov.

import { backTo } from './history.js';
import { initSetupWiring } from './setup-wiring.js';
import { panelChange } from './state.js';

export { applySettings } from './setup-wiring.js';
export { setupStart, stepEdit } from '../shared/setup-flow.js';

/** @typedef {import('./state.js').Store} Store */
/** @typedef {import('./dom.js').Dom} Dom */

/** Karta Nastavenie: prehľad a sprievodca. @param {Store} store @param {Dom} dom @param {() => Promise<void>} refresh */
export function initSetup(store, dom, refresh) {
    initSetupWiring(
        store,
        {
            back: (patch) => backTo(store, patch),
            refresh,
            // „Teraz nie, ukáž predpoveď“ otvorí kartu 7 dní.
            skip: () => panelChange(store.get().panel, '7dni'),
        },
        { ...dom, root: dom.setup },
    );
}
