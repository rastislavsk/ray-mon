// Kroky navigácie v histórii prehliadača, aby tlačidlo Späť vracalo o krok v appke. Nevie, čo
// krok je - to mu povie volajúci (web/interactions.js, web/nav-back.js). Adresa sa nemení;
// položka histórie je len značka s krokom navigácie a jej poradím `i`.
//
// Poradie položiek: 0 je položka, na ktorej appka štartovala - Späť na ňu ukáže bublinu
// a ďalšie Späť appku zavrie. 1 je karta Teraz, nad ňou kroky. Späť najprv zatvára, čo je
// otvorené na karte, kde človek je (detail, panel, okno, krok sprievodcu). Keď by sa vrátilo
// na inú kartu, skočí rovno na Teraz (1) a z holej karty Teraz na štartovú položku (bublina),
// rozhodnuté 27. 11. 2026. Ku kartám, na ktorých človek bol predtým, sa Späť nevracia.
//
// Každá položka pribúda pri ťuknutí. Chrome položku pridanú bez neho (napr. pri Späť) pri ďalšom
// Späť preskočí a appka by sa zavrela priskoro - to sa stalo riešeniu so strážnou položkou (#501).
// Skok dozadu (history.go) je v poriadku, nič nepridáva.

/**
 * Čo spraví Späť, ktoré prišlo na položku `i`: na štartovej položke bublina, z holej karty Teraz
 * skok na štartovú položku, na položku inej karty skok na Teraz, inak návrat na krok. Dopredu
 * (`i` nad položkou, z ktorej sa odišlo) je vždy len návrat na krok.
 * @param {number} i položka, na ktorú sa prišlo @param {number} z položka, z ktorej sa odišlo
 * @param {{ doma: boolean, inaKarta: boolean }} kde stál človek na holej karte Teraz? je položka `i` z inej karty?
 * @returns {'bublina' | 'start' | 'teraz' | 'krok'}
 */
export function kamSpat(i, z, { doma, inaKarta }) {
    if (i <= 0) return 'bublina';
    if (i >= z) return 'krok';
    if (doma) return 'start';
    return i > 1 && inaKarta ? 'teraz' : 'krok';
}

/** Poradie položky histórie; cudzia či štartová položka je 0. @param {unknown} raw */
function poradie(raw) {
    const i = raw && typeof raw === 'object' ? /** @type {{ i?: unknown }} */ (raw).i : 0;
    return typeof i === 'number' && Number.isInteger(i) && i > 0 ? i : 0;
}

/**
 * Každá zmena kroku navigácie pridá položku do histórie a `popstate` ju vráti tou istou cestou
 * ako klik - jediným setState.
 * @template S, N
 * @param {{ get: () => S, setState: (patch: Partial<S>) => void, subscribe: (fn: (state: S, prev: S) => void) => unknown }} store
 * @param {{ step: (state: S) => N, same: (a: N, b: N) => boolean, parse: (raw: unknown) => N | null,
 *   change: (state: S, step: N) => Partial<S>, home: (state: S) => N, karta: (step: N) => string, kraj: () => void }} nav
 *   krok zo stavu, ich porovnanie, krok z položky histórie (cudzia položka je null), zmena stavu pri návrate na krok,
 *   krok karty Teraz, karta kroku (Späť na inú kartu skočí na Teraz) a čo ukázať na štartovej položke (bublinu pred zatvorením)
 */
export function trackHistory(store, { step, same, parse, change, home, karta, kraj }) {
    // Kým sa appka vracia späť, nesmie ten istý krok zapísať do histórie znovu - inak by
    // sa Späť zacyklilo na dvoch položkách a z appky by sa nedalo odísť.
    let vraciaSa = false;
    // Kým beží skok (history.go), popstate, ktoré ho spustilo, nič nevracia.
    let skace = false;
    // Po obnovení stránky stojí prehliadač na položke z minulého načítania - jej poradie ostáva.
    let i = poradie(history.state);

    history.replaceState({ step: step(store.get()), i }, '');
    store.subscribe((state, prev) => {
        if (vraciaSa || same(step(state), step(prev))) return;
        // Prvý krok zo štartovej položky: pod neho príde Teraz, aby Späť skončil na ňom a štartová
        // položka ostala na bublinu. Obe položky pribudnú v tom istom ťuknutí.
        if (i === 0) history.pushState({ step: home(prev), i: ++i }, '');
        // `prev` hovorí, odkiaľ sa sem prišlo - podľa neho vie appka, či smie ísť cez históriu.
        history.pushState({ step: step(state), prev: step(prev), i: ++i }, '');
    });

    window.addEventListener('popstate', (e) => {
        const to = parse(e.state);
        // Cudzia položka (napr. odkaz s nastavením otvorený v tej istej karte mení len časť za
        // mriežkou) nie je krok appky - Späť sa pri nej správa ako bez appky.
        if (!to) return;
        const z = i;
        i = poradie(e.state);
        if (skace) skace = false;
        else {
            const tu = step(store.get());
            const kam = kamSpat(i, z, { doma: same(tu, home(store.get())), inaKarta: karta(to) !== karta(tu) });
            if (kam === 'start' || kam === 'teraz') {
                skace = true;
                history.go((kam === 'start' ? 0 : 1) - i);
                return;
            }
        }
        vraciaSa = true;
        // Rovnaká cesta ako pri kliku na navigáciu: jediný setState, jediné prekreslenie.
        store.setState(change(store.get(), to));
        vraciaSa = false;
        if (i === 0) kraj();
    });
}
