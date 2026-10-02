// Tlačidlo Späť (mobil, tablet, aj šípka v prehliadači) vracia o krok v appke, nie rovno
// preč zo stránky. Každý krok navigácie - prepnutie karty, otvorenie detailu dňa, rozbalenie
// položky v sekcii Appka karty Nastavenie, popupu s návodom k ciferníku - pridá položku do histórie prehliadača; Späť ju vyberie a appka sa
// vráti tam, kde bola.
//
// Appka pritom nemení adresu: položky histórie sú len značky s krokom navigácie, aby
// odkaz na appku ostal jeden (zdieľa sa na karte Nastavenie) a neťahal si za sebou, na
// ktorej karte kto naposledy stál.
//
// Zatvorenie appky sa nikde nevynucuje a ani nedá: stránka sa sama zavrieť nevie a
// dvojitý stlačok Späť je zvyk natívnych androidových appiek, nie webu. Vychádza to
// však narovnako - keď sa Späť vyčerpajú kroky v appke, ďalší stlačok ju opustí, čo je
// v nainštalovanej appke (PWA) jej zatvorenie.

import { trackHistory } from './nav-history.js';
import { navChange, navPrevFrom, navStep, navStepFrom, sameNavStep } from './state.js';

/**
 * Návrat z detailu do prehľadu dní - šípkou v hlavičke detailu aj ťahom doprava. Je to ten
 * istý krok ako tlačidlo Späť, tak ide aj tou istou cestou: `history.back()` vyberie položku
 * detailu a popstate nižšie zmení stav. Keby sa namiesto toho zapísal nový krok (prehľad),
 * ostal by detail v histórii za ním a Späť na telefóne by ho znovu otvorilo.
 *
 * Detail sa dá otvoriť len z prehľadu dní, takže položka pred ním je vždy prehľad. Keď
 * aktuálna položka histórie detail nie je (nepatrí appke, alebo nesedí so stavom), zmena
 * ide priamo cez setState ako doteraz.
 * @param {import('./state.js').Store} store
 */
export function closeDetail(store) {
    const step = navStepFrom(history.state);
    if (step && step.weekDetail && sameNavStep(step, navStep(store.get()))) history.back();
    else store.setState({ weekDetail: null });
}

/**
 * Krok späť v sprievodcovi nastavením (tlačidlo „Späť“ a „Späť na zhrnutie“) a zbalenie
 * položky v sekcii Appka aj zatvorenie popupu s návodom k ciferníku. Keď appka do
 * aktuálnej položky histórie prišla práve z cieľového kroku, je to ten istý krok ako tlačidlo
 * Späť na telefóne a ide cez `history.back()` - rovnako ako closeDetail vyššie. Inak (skok
 * zo zhrnutia, cudzia položka) sa krok zapíše ako nový.
 * @param {import('./state.js').Store} store @param {Partial<import('./state.js').AppState>} patch
 */
export function backTo(store, patch) {
    const state = store.get();
    const here = navStepFrom(history.state);
    const prev = navPrevFrom(history.state);
    if (here && prev && sameNavStep(here, navStep(state)) && sameNavStep(prev, navStep({ ...state, ...patch }))) history.back();
    else store.setState(patch);
}

/** @param {import('./state.js').Store} store */
export function initHistory(store) {
    // Zápis do histórie je spoločný s novou appkou (web/nav-history.js); `prev` v položke
    // potrebuje backTo vyššie.
    trackHistory(store, {
        step: navStep,
        same: sameNavStep,
        parse: navStepFrom,
        change: (state, step) => navChange(state.panel, step),
    });
}
