// Zápis do DOM pre render funkcie: len keď sa niečo naozaj mení.

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

/**
 * Otvorí alebo zavrie dialóg podľa stavu; pri zatvorení vráti fokus na prvok, ktorý ho otvoril.
 * @param {HTMLDialogElement} d @param {boolean} open @param {() => Element | null} opener
 */
export function dialog(d, open, opener) {
    if (open && !d.open) d.showModal();
    else if (!open && d.open) {
        d.close();
        const btn = opener();
        if (btn instanceof HTMLElement) btn.focus();
    }
}
