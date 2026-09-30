// Vstup stránky: načíta appku a keď sa jej moduly nezídu, raz obnoví stránku so súbormi
// priamo zo servera.
//
// GitHub Pages posiela každý súbor s max-age=600 bez revalidácie, takže prehliadač po nasadení
// vie až desať minút miešať nové súbory so starými z cache. Keď nový modul importuje export,
// ktorý starý modul v cache ešte nemá, celý graf modulov spadne pri linkovaní („does not
// provide an export named …“) a app.js sa vôbec nespustí. To isté sa stane, keď nový dom.js
// hľadá prvok, ktorý staré index.html nemá. Obyčajné obnovenie stránky nepomôže - prehliadač
// pri ňom overí len samotnú stránku, moduly vezme znova z cache.
//
// Tento súbor preto nesmie nič importovať staticky: musí sa spustiť, aj keď je zvyšok
// grafu rozbitý.

const KEY = 'ray-mon-obnova';

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
    const line = document.getElementById('pv-updated');
    if (line) line.textContent = 'appka sa nenačítala, skús to o chvíľu';
}

import('./app.js').then(loaded, recover);
