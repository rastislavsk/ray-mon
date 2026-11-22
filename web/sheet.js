// Panel zdola (dialog .sheet): zatvorenie krížikom, Escape a ťuknutím vedľa. Karty Teraz, Dnes aj Nastavenie.

const SVG = 'http://www.w3.org/2000/svg';

/**
 * Krížik vpravo hore (docs/navrhy/zatvaranie-popupov.html, V2 + K3). Dáva ho sem, nie do HTML, aby ho mal
 * každý panel a nový naň nezabudol. Ide na koniec obsahu: dialóg pri otvorení zameria prvý ovládač
 * a ten má ostať ten istý ako bez krížika.
 * @param {HTMLDialogElement} d
 */
function krizik(d) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sheet-x';
    btn.setAttribute('aria-label', 'Zavrieť');
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', 'M6 6l12 12M18 6L6 18');
    svg.append(path);
    btn.append(svg);
    (d.firstElementChild ?? d).append(btn);
    return btn;
}

/**
 * Panel zdola: krížik, Escape a ťuknutie vedľa (na stmavenú stránku trafí samotný dialóg, nie jeho obsah)
 * ho zavrú krokom späť, rovnako ako tlačidlo Späť - nový krok by Späť zatvorený panel znovu otvoril.
 * Escape dialóg nezavrie sám - zavrie ho render podľa stavu.
 * @param {HTMLDialogElement} d @param {() => void} close
 */
export function initSheet(d, close) {
    krizik(d).addEventListener('click', close);
    d.addEventListener('click', (e) => e.target === d && close());
    d.addEventListener('cancel', (e) => {
        e.preventDefault();
        close();
    });
}
