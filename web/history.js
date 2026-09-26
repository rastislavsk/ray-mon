// Tlačidlo Späť (mobil, tablet, aj šípka v prehliadači) vracia o krok v appke, nie rovno
// preč zo stránky. Každý krok navigácie - prepnutie karty, otvorenie detailu dňa - pridá
// položku do histórie prehliadača; Späť ju vyberie a appka sa vráti tam, kde bola.
//
// Appka pritom nemení adresu: položky histórie sú len značky s krokom navigácie, aby
// odkaz na appku ostal jeden (zdieľa sa na karte Nastavenie) a neťahal si za sebou, na
// ktorej karte kto naposledy stál.
//
// Zatvorenie appky sa nikde nevynucuje a ani nedá: stránka sa sama zavrieť nevie a
// dvojitý stlačok Späť je zvyk natívnych androidových appiek, nie webu. Vychádza to
// však narovnako - keď sa Späť vyčerpajú kroky v appke, ďalší stlačok ju opustí, čo je
// v nainštalovanej appke (PWA) jej zatvorenie.

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
 * Krok späť v sprievodcovi nastavením (tlačidlo „Späť“ a „Späť na zhrnutie“). Keď appka do
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
    // Kým sa appka vracia späť, nesmie ten istý krok zapísať do histórie znovu - inak by
    // sa Späť zacyklilo na dvoch položkách a z appky by sa nedalo odísť.
    let vraciaSa = false;

    history.replaceState({ step: navStep(store.get()) }, '');
    store.subscribe((state, prev) => {
        if (vraciaSa || sameNavStep(navStep(state), navStep(prev))) return;
        // `prev` hovorí, odkiaľ sa sem prišlo - podľa neho backTo vie, či smie ísť cez históriu.
        history.pushState({ step: navStep(state), prev: navStep(prev) }, '');
    });

    window.addEventListener('popstate', (e) => {
        const step = navStepFrom(e.state);
        if (!step) return;
        vraciaSa = true;
        // Rovnaká cesta ako pri kliku na navigáciu: jediný setState, jediné prekreslenie.
        store.setState(navChange(store.get().panel, step));
        vraciaSa = false;
    });
}
