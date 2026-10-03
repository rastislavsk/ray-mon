// Výroba písma novej appky „Živá obloha“: jeden súbor woff2 s Archivom len so znakmi, ktoré appka
// naozaj píše, s oboma osami (wdth, wght). Nahrádza dve podmnožiny Google Fonts (latin a latin-ext),
// ktoré slovenčina potrebuje naraz a ktoré spolu mali 176 kB. Nie je súčasťou behu appky - výsledok
// leží v repozitári (fonts/archivo-obloha.woff2) a stránka ho servíruje tak, ako je.
//
// Zopakovanie (napr. keď texty dostanú nový znak - ohlási to test/font-subset.test.js):
//
//   npm install --no-save subset-font@2.9.0
//   node scripts/font-subset.js
//
// subset-font je HarfBuzz (hb-subset) skompilovaný do WebAssembly - ten istý nástroj, ktorým robí
// podmnožiny Google Fonts. Zdroj je pôvodný súbor z repozitára google/fonts na pevnom commite,
// overený hashom, takže výsledok je na každom stroji bajtovo rovnaký. Licencia ostáva OFL
// (fonts/OFL-Archivo.txt).

import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const SOURCE =
    'https://raw.githubusercontent.com/google/fonts/95f4904fc8bcf26d3420fe315560c96417c6dec7/ofl/archivo/Archivo%5Bwdth,wght%5D.ttf';
const SOURCE_SHA256 = '0e094a7d3c7c4c25cf1310c4b30014f1dae9332220b1c2c88f4fa996f0b05053';
const TARGET = 'fonts/archivo-obloha.woff2';

/** Celá tlačiteľná ASCII (číslice, latinka, interpunkcia). */
const ASCII = Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i)).join('');

/**
 * Znaky v podmnožine. Slovenská a česká abeceda celá (aj písmená, ktoré texty dnes nemajú - mená
 * obcí), k tomu typografia a značky, ktoré appka píše. Čo tu nie je, vykreslí záložné písmo.
 */
export const CHARS = [
    ASCII,
    // Nedeliteľná medzera a úzka nedeliteľná medzera (čísla s jednotkami).
    '\u00a0\u202f',
    'áäčďéěíĺľňóôŕřšťúůýž',
    'ÁÄČĎÉĚÍĹĽŇÓÔŔŘŠŤÚŮÝŽ',
    // Časté v menách obcí na juhu a v cudzích menách; lacné.
    'öüőűÖÜŐŰ',
    '°×·²–—‘’‚“„…‹›«»€→←↑↓−≈±',
    // Meny v Nastavení (shared/config.js, CURRENCIES): £ a zł.
    '£ł',
].join('');

/** @param {Uint8Array} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function main() {
    // Balík nie je v package.json (je potrebný raz za čas) - inštaluje sa podľa návodu hore.
    const { default: subsetFont } = await import(/** @type {string} */ ('subset-font'));
    const res = await fetch(SOURCE);
    if (!res.ok) throw new Error(`Zdroj sa nestiahol: ${res.status}`);
    const source = Buffer.from(await res.arrayBuffer());
    if (sha256(source) !== SOURCE_SHA256) throw new Error('Zdroj má iný hash, než aký skript čaká.');
    const woff2 = await subsetFont(source, CHARS, {
        targetFormat: 'woff2',
        // Len vlastnosti, ktoré appka potrebuje (kerning, ligatúry, diakritika, tabuľkové číslice pre
        // font-variant-numeric). Ostatné (kapitálky, alternatívne tvary) by pribalili glyfy navyše.
        keepFeatures: ['kern', 'liga', 'calt', 'ccmp', 'locl', 'mark', 'mkmk', 'tnum', 'case', 'rlig', 'rvrn'],
        // Hinty na vysokom rozlíšení telefónov nepomôžu, len pridajú bajty.
        noHinting: true,
    });
    await writeFile(TARGET, woff2);
    console.log(`${TARGET}: ${woff2.length} B, sha256 ${sha256(woff2)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
