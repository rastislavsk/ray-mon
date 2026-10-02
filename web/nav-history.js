// Kroky navigácie v histórii prehliadača, aby tlačidlo Späť vracalo o krok v appke. Nevie, čo
// krok je - to mu povie volajúci (súčasná appka vo web/history.js, nová v obloha/). Adresa sa
// nemení; položka histórie je len značka s krokom navigácie.

/**
 * Každá zmena kroku navigácie pridá položku do histórie a `popstate` ju vráti tou istou cestou
 * ako klik - jediným setState.
 * @template S, N
 * @param {{ get: () => S, setState: (patch: Partial<S>) => void, subscribe: (fn: (state: S, prev: S) => void) => unknown }} store
 * @param {{ step: (state: S) => N, same: (a: N, b: N) => boolean, parse: (raw: unknown) => N | null,
 *   change: (state: S, step: N) => Partial<S> }} nav krok zo stavu, ich porovnanie, krok z položky
 *   histórie (cudzia položka je null) a zmena stavu pri návrate na krok
 */
export function trackHistory(store, { step, same, parse, change }) {
    // Kým sa appka vracia späť, nesmie ten istý krok zapísať do histórie znovu - inak by
    // sa Späť zacyklilo na dvoch položkách a z appky by sa nedalo odísť.
    let vraciaSa = false;

    history.replaceState({ step: step(store.get()) }, '');
    store.subscribe((state, prev) => {
        if (vraciaSa || same(step(state), step(prev))) return;
        // `prev` hovorí, odkiaľ sa sem prišlo - podľa neho vie appka, či smie ísť cez históriu.
        history.pushState({ step: step(state), prev: step(prev) }, '');
    });

    window.addEventListener('popstate', (e) => {
        const to = parse(e.state);
        if (!to) return;
        vraciaSa = true;
        // Rovnaká cesta ako pri kliku na navigáciu: jediný setState, jediné prekreslenie.
        store.setState(change(store.get(), to));
        vraciaSa = false;
    });
}
