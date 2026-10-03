// Zápis do DOM pre render funkcie novej appky: len keď sa niečo naozaj mení.

/** Zapíše text, len keď sa líši - nezmenený zápis by prvok zbytočne označil na prepočet. @param {HTMLElement} el @param {string} text */
export function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
}

/** @type {WeakMap<Element, string>} */
const written = new WeakMap();

/** innerHTML len pri zmene: nezmenený obsah tak nezhodí fokus ani posun. @param {Element} el @param {string} html */
export function setHtml(el, html) {
    if (written.get(el) === html) return;
    written.set(el, html);
    el.innerHTML = html;
}

/** @param {HTMLElement} el @param {boolean} on */
export const show = (el, on) => el.classList.toggle('hidden', !on);
