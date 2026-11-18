// Tlačidlo Späť na telefóne. Nad položkou histórie, na ktorej appka stojí, drží jednu strážnu
// položku - ale len kým je čo vrátiť. Späť ju zoberie a appka spraví krok späť sama (čo to je,
// rozhoduje volajúci: spatZmena vo web/state.js). Keď už nie je kam, strážna položka nepribudne
// a ďalšie Späť appku zavrie. Adresa sa nemení.

/** Značka strážnej položky v `history.state`. */
const STRAZ = 'spat';

/** Stojí prehliadač na strážnej položke? */
function naStrazi() {
    const h = /** @type {unknown} */ (history.state);
    return !!h && typeof h === 'object' && /** @type {Record<string, unknown>} */ (h)[STRAZ] === true;
}

/**
 * Strážna položka je v histórii práve vtedy, keď má Späť čo urobiť. Pribudne pri zmene stavu,
 * ktorá niečo otvorí (to je vždy po ťuknutí - Chrome položku pridanú bez neho pri Späť preskočí),
 * a appka ju sama zoberie, keď sa všetko zavrie inak (krížikom, navigáciou na Teraz).
 * @template S
 * @param {{ get: () => S, setState: (patch: Partial<S>) => void, subscribe: (fn: (state: S) => void) => unknown }} store
 * @param {(state: S) => Partial<S> | null} spat krok späť; null = nie je kam, Späť appku zavrie
 */
export function strazSpat(store, spat) {
    // Kým beží history.back(), ktorým appka strážnu položku zobrala sama, popstate nie je Späť.
    let berie = false;
    /** @param {S} state */
    const zlad = (state) => {
        if (berie) return;
        const treba = spat(state) !== null;
        if (treba && !naStrazi()) history.pushState({ [STRAZ]: true }, '');
        else if (!treba && naStrazi()) {
            berie = true;
            history.back();
        }
    };
    // Po obnovení stránky môže prehliadač stáť na strážnej položke z minulého načítania. Tá už nič
    // nestráži a history.back() by z nej viedlo do minulého načítania (stránka by sa načítala znova).
    if (naStrazi()) history.replaceState(null, '');
    // Položky histórie nie sú stránky: kam sa posunúť, rozhoduje appka (napr. návrat z detailu dňa na
    // riadok, web/render/sedem.js). Prehliadač by po Späť vrátil posun, aký bol pri strážnej položke.
    history.scrollRestoration = 'manual';
    store.subscribe(zlad);
    window.addEventListener('popstate', () => {
        if (berie) berie = false;
        // Na strážnu položku sa dá prísť aj tlačidlom Dopredu - to nie je krok späť.
        else if (!naStrazi()) {
            const zmena = spat(store.get());
            if (zmena) store.setState(zmena);
        }
        // Zmena stavu strážnu položku vráti sama; toto platí, keď sa nič nezmenilo alebo appka práve brala.
        zlad(store.get());
    });
}
