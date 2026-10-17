// QR kód s odkazom na appku pre okno Zdieľať v oboch appkách. Knižnica je z CDN a nepovinná
// (index.html ju načíta s `defer`), takže kým nie je, kód nie je. Neutrálny modul: nesiaha na
// stav appky, len do prvku, ktorý dostane.

/**
 * Kreslič QR kódu do jedného prvku. Vráti funkciu, ktorá do neho nakreslí odkaz a povie, či sa
 * to podarilo: `null`, keď knižnica ešte nie je načítaná (skúsi sa pri ďalšom prekreslení),
 * `false`, keď je odkaz dlhší, než kód unesie - odkaz s nastavením elektrárne má aj vyše tisíc
 * znakov. Knižnica vtedy hodí výnimku, ktorá nesmie prerušiť prekreslenie; appka potom ukáže
 * len odkaz. Rovnaký odkaz sa nekreslí znova, ani ten, ktorý sa nezmestil.
 * @returns {(el: HTMLElement, url: string) => boolean | null}
 */
export function qrPainter() {
    /** @type {any} */
    let qr = null;
    let lastUrl = '';
    let ok = false;
    return (el, url) => {
        const QRCode = /** @type {any} */ (globalThis).QRCode;
        if (typeof QRCode === 'undefined') return null;
        if (url === lastUrl) return ok;
        lastUrl = url;
        try {
            // Bez textu v konštruktore - kreslí až makeCode, takže výnimku hodí len ono.
            qr ??= new QRCode(el, {
                width: 256,
                height: 256,
                colorDark: '#000000',
                colorLight: '#ffffff',
                // Stredná oprava chýb: kód unesie skoro dvakrát dlhší odkaz než pri najvyššej (H).
                correctLevel: QRCode.CorrectLevel.M,
            });
            qr.makeCode(url);
            ok = true;
        } catch {
            ok = false;
        }
        return ok;
    };
}
