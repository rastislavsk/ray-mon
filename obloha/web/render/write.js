// Zápis do DOM pre render funkcie novej appky: len keď sa niečo naozaj mení.

/** Zapíše text, len keď sa líši - nezmenený zápis by prvok zbytočne označil na prepočet. @param {HTMLElement} el @param {string} text */
export function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
}

/** @type {WeakMap<Element, string>} */
const written = new WeakMap();

/** Prvky, na ktorých môže stáť fokus klávesnice. */
const FOCUSABLE = 'button, a[href], input, select, [tabindex]';

/**
 * innerHTML len pri zmene: nezmenený obsah tak nezhodí fokus ani posun. Keď sa obsah naozaj zmení
 * (napr. stlačené tlačidlo vo výbere), fokus sa vráti na prvok na tom istom mieste v poradí.
 * @param {Element} el @param {string} html @returns {boolean} zapísalo sa? Nové polia treba naplniť.
 */
export function setHtml(el, html) {
    if (written.get(el) === html) return false;
    written.set(el, html);
    const active = document.activeElement;
    const index = active && el.contains(active) ? Array.from(el.querySelectorAll(FOCUSABLE)).indexOf(active) : -1;
    el.innerHTML = html;
    const next = index >= 0 ? el.querySelectorAll(FOCUSABLE)[index] : null;
    if (next instanceof HTMLElement) next.focus({ preventScroll: true });
    return true;
}

/** @param {HTMLElement} el @param {boolean} on */
export const show = (el, on) => el.classList.toggle('hidden', !on);
