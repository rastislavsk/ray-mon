// Prekresľuj len to, čo sa naozaj zmenilo.
//
// Zápis do DOM označí prvok za "špinavý" aj vtedy, keď doň zapíšeš to isté, čo tam už je.
// Účet za to nepríde hneď - príde, keď si niekto najbližšie vypýta rozmery (napríklad
// interactions.js pri ďalšom kroku ťahania bežca), lebo vtedy musí prehliadač layout
// dopočítať. Pri ťahaní tak jeden zbytočný zápis zdražel každý ďalší pohyb prsta.
//
// Tieto pomôcky si preto pamätajú, čo samy naposledy videli, a nič z DOM nečítajú - okrem
// `activeElement` vo writeHtml, ktorý layout nepočíta.
//
// Pozor: kto do prvku raz zapisuje cez writeHtml, musí tak robiť vždy. Zápis okolo pamäte
// (napr. priame `innerHTML = ''`) by si memo nevšimlo a ďalší zápis rovnakého obsahu by
// preskočilo - prvok by ostal prázdny.

/** Zhodujú sa všetky kľúče? Porovnáva sa identita, nie obsah. @param {unknown[]} a @param {unknown[]} b */
export function sameKeys(a, b) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** @type {Map<string, unknown[]>} */
const lastKeys = new Map();

/**
 * Zmenil sa niektorý z kľúčov od posledného volania s týmto názvom? Prvé volanie je vždy `true`.
 * @param {string} name @param {unknown[]} keys
 */
export function changedKeys(name, keys) {
    const prev = lastKeys.get(name);
    if (prev && sameKeys(prev, keys)) return false;
    lastKeys.set(name, keys);
    return true;
}

/** To isté pre jedinú hodnotu. @param {string} name @param {unknown} value */
export function changed(name, value) {
    return changedKeys(name, [value]);
}

/** Prvky, na ktorých môže stáť fokus klávesnice. */
const FOCUSABLE = 'button, a[href], input, [tabindex]';

/**
 * Zapíše HTML len vtedy, keď sa líši od naposledy zapísaného. Nezmenený obsah tak nezhodí
 * fokus - prepísaný innerHTML by tlačidlo, na ktorom človek z klávesnice stojí, zmazal
 * s každým tiknutím hodín.
 *
 * Keď sa obsah naozaj zmení (napr. vybraný deň v prepínači), fokus sa vráti na prvok na tom
 * istom mieste v poradí. Čítanie `activeElement` layout nepočíta, takže neplatí za neho
 * nič z toho, kvôli čomu tento modul existuje.
 * @param {Element} el @param {string} html @param {string} name
 * @returns {boolean} zapísalo sa? Nové polia formulára potom treba naplniť.
 */
export function writeHtml(el, html, name) {
    if (!changed(name, html)) return false;
    const active = document.activeElement;
    const index = active && el.contains(active) ? Array.from(el.querySelectorAll(FOCUSABLE)).indexOf(active) : -1;
    el.innerHTML = html;
    const next = index >= 0 ? el.querySelectorAll(FOCUSABLE)[index] : null;
    if (next instanceof HTMLElement) next.focus({ preventScroll: true });
    return true;
}
