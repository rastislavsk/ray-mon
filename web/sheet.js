// Panel zdola (dialog .sheet): zatvorenie tlačidlom, Escape a ťuknutím vedľa. Karta Teraz aj Dnes.

/**
 * Panel zdola: Zavrieť, Escape a ťuknutie vedľa (na stmavenú stránku trafí samotný dialóg, nie jeho
 * obsah) ho zavrú krokom späť. Escape dialóg nezavrie sám - zavrie ho render podľa stavu.
 * @param {HTMLDialogElement} d @param {HTMLElement} btn @param {() => void} close
 */
export function initSheet(d, btn, close) {
    d.addEventListener('click', (e) => e.target === d && close());
    d.addEventListener('cancel', (e) => {
        e.preventDefault();
        close();
    });
    btn.addEventListener('click', close);
}
