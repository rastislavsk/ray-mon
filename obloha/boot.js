// Vstup novej appky: načíta ju a keď sa jej moduly nezídu, raz obnoví stránku so súbormi
// priamo zo servera. To isté ako koreňový boot.js (dôvody sú tam a v CLAUDE.md, časť
// o nasadení a cache) - nová appka importuje aj moduly zo shared/ a web/, ktoré sa menia
// s nasadeniami súčasnej appky, takže zmiešanú cache vie trafiť rovnako.
//
// Tento súbor nesmie nič importovať staticky: musí sa spustiť, aj keď je zvyšok grafu
// rozbitý. Preto ani nezdieľa kód s koreňovým boot.js.

const KEY = 'ray-mon-obloha-obnova';

/**
 * Prvý pokus o nápravu v tejto karte? Zároveň si ho zapíše, aby sa stránka neobnovovala
 * dokola, keď chyba nie je v cache. Bez sessionStorage sa radšej neobnovuje vôbec.
 */
function firstTry() {
    try {
        if (sessionStorage.getItem(KEY)) return false;
        sessionStorage.setItem(KEY, '1');
        return true;
    } catch {
        return false;
    }
}

function loaded() {
    try {
        sessionStorage.removeItem(KEY);
    } catch {
        // Bez sessionStorage nie je čo mazať.
    }
}

/** Vlastné skripty, ktoré prehliadač pri tomto načítaní použil - aj tie, ktoré vzal z cache. */
function ownScripts() {
    return performance
        .getEntriesByType('resource')
        .map((entry) => new URL(entry.name))
        .filter((url) => url.origin === location.origin && url.pathname.endsWith('.js'));
}

/** @param {unknown} err */
async function recover(err) {
    console.error(err);
    if (firstTry()) {
        try {
            // cache: 'reload' ide na server a odpoveď zapíše do cache namiesto starej verzie.
            await Promise.all(ownScripts().map((url) => fetch(url, { cache: 'reload' })));
            location.reload();
            return;
        } catch {
            // Server nedostupný (offline): obnovenie by ukázalo len chybovú stránku prehliadača.
        }
    }
    const line = document.getElementById('hdr-status');
    if (line) line.textContent = 'appka sa nenačítala, skús to o chvíľu';
}

import('./app.js').then(loaded, recover);

// Prázdny export len pre typovú kontrolu: bez neho by tsc bral súbor ako skript a jeho mená
// by sa bili s koreňovým boot.js. Prehliadač ho načítava ako modul tak či tak.
export {};
