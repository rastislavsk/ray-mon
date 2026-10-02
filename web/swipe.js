// Listovanie potiahnutím prsta (mobil, tablet): karty, a v detaile dňa dni v týždni. Gesto
// len rozhodne, čo je na rade; zmenu robí setState ako všetko ostatné, takže sa to od kliku
// na navigáciu nelíši. Či ťah vôbec bol listovaním, rozhoduje web/gesture.js (ten istý kód
// používa aj nová appka v obloha/); tu je len to, kam v tejto appke vedie.

import { initSwipeGesture } from './gesture.js';
import { closeDetail } from './history.js';
import { nextPanel, nextWeekDay, panelChange } from './state.js';

/** @typedef {import('./state.js').Store} Store */
/** @typedef {import('./dom.js').Dom} Dom */

/** Cieľ gesta "späť do prehľadu dní". Nie je to zmena stavu, ale krok v histórii (closeDetail). */
const SPAT = /** @type {const} */ ('spat');

/** Kam gesto vedie: buď na susedný deň (v detaile dňa), alebo späť do prehľadu dní, alebo
 * na susednú kartu, alebo nikam (koniec poradia dní, kraj poradia kariet).
 *
 * Detail je podobrazovka karty 7 dní a ťah ju neopúšťa - v detaile dňa listuje dni, tak ako
 * inde listuje karty. Ťah doprava je pritom všade v appke krok späť, takže keď už listovať
 * nie je kam (prvý deň, alebo detail týždňa, kde je jediná obrazovka), vedie tam, kam šípka
 * v hlavičke detailu: do prehľadu dní. Doľava sa na poslednom dni nedeje nič - vpred z detailu
 * cesta nevedie. Na širokej obrazovke detail neexistuje (viď renderSedemdni), tam sa ťahom
 * prepína karta.
 * @param {import('./state.js').AppState} state @param {number} dx */
function targetFor(state, dx) {
    if (state.panel === '7dni' && state.weekDetail && !state.wide) {
        const spat = dx > 0 ? SPAT : null;
        if (state.weekDetail !== 'day') return spat;
        const dir = /** @type {1 | -1} */ (dx < 0 ? 1 : -1);
        const den = nextWeekDay(state.weekSelDay, dir, state.forecast?.days.length ?? 0);
        // Smer ide do stavu s dňom: podľa neho sa detail prisunie z tej strany, ktorou sa
        // listovalo - to isté, čo panelChange robí pre karty.
        return den === null ? spat : { weekSelDay: den, weekDayDir: dir };
    }
    const panel = nextPanel(state.panel, dx < 0 ? 1 : -1);
    return panel ? panelChange(state.panel, panel) : null;
}

/** @param {Store} store @param {Dom} dom @param {() => void} hideTooltips zavrie tooltipy grafov */
export function initSwipe(store, dom, hideTooltips) {
    initSwipeGesture(dom.page, {
        // Otázka na polohu pri prvom otvorení nemá kam listovať - ostatné karty ešte nič nevedia.
        enabled: () => store.get().known !== 'nic',
        onSwipe: (dx) => {
            const patch = targetFor(store.get(), dx);
            if (!patch) return;
            // Tooltip grafu ostal otvorený pod prstom - po odchode z karty (aj po prelistovaní
            // na iný deň) ukazuje hodnotu, ktorá už pod ním nie je.
            hideTooltips();
            if (patch === SPAT) closeDetail(store);
            else store.setState(patch);
        },
    });
}
