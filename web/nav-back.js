// Zatvorenie niečoho, čo bolo krokom navigácie (panel veci na karte Môžem?, náhľad iného času
// na karte Teraz), krížikom či tlačidlom v appke. Je to ten istý krok ako tlačidlo Späť.

import { navPrevFrom, navStep, navStepFrom, sameNavStep } from './state.js';

/**
 * Otvorenie bolo krokom navigácie, takže zatvorenie ide cez `history.back()` - keby sa zapísal
 * nový krok, Späť na telefóne by to znovu otvorilo. Keď aktuálna položka histórie nesedí
 * (cudzia, iný krok), zmena ide priamo cez setState.
 * @param {import('./state.js').Store} store @param {Partial<import('./state.js').AppState>} patch stav po zatvorení
 */
export function stepBack(store, patch) {
    const state = store.get();
    const here = navStepFrom(history.state);
    const prev = navPrevFrom(history.state);
    if (here && prev && sameNavStep(here, navStep(state)) && sameNavStep(prev, navStep({ ...state, ...patch }))) history.back();
    else store.setState(patch);
}

/** Návrat z detailu karty 7 dní do prehľadu dní - ten istý krok ako tlačidlo Späť. @param {import('./state.js').Store} store */
export function closeDetail(store) {
    stepBack(store, { weekDetail: null });
}
