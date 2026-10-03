// Pošle súbor systémovému zdieľaniu telefónu; kde zdieľanie súborov nie je (desktop), súbor sa
// stiahne. Žiadny server - súbor nikam neodchádza bez toho, aby ho človek sám poslal. Neutrálny
// modul: zdieľa ním súhrn súčasná appka (web/share-image.js) aj plagát nová (obloha/).

/**
 * Zrušené zdieľanie nie je chyba - človek si to len rozmyslel.
 * @param {File} file
 */
export async function shareFile(file) {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'RAY-MON' }).catch(() => undefined);
        return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
