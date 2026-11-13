// Panel zdola (dialog .sheet): zatvorenie Escape a ťuknutím vedľa. Karta Teraz aj Dnes.

/**
 * Panel zdola: Escape a ťuknutie vedľa (na stmavenú stránku trafí samotný dialóg, nie jeho obsah) ho
 * zavrú krokom späť, rovnako ako tlačidlo Späť. Tlačidlo Zavrieť panely nemajú - bolo by navyše.
 * Escape dialóg nezavrie sám - zavrie ho render podľa stavu.
 * @param {HTMLDialogElement} d @param {() => void} close
 */
export function initSheet(d, close) {
    d.addEventListener('click', (e) => e.target === d && close());
    d.addEventListener('cancel', (e) => {
        e.preventDefault();
        close();
    });
}
