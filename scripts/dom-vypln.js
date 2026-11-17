// Výplň domu pre scénu na karte Teraz: img/dom-vypln.png leží pod čiarovou kresbou img/dom.png a robí z nej
// plný dom (steny a strecha svetlé asi ako elektráreň, tmavé okná a panely, modrý strom a auto). Plný dom zakryje dážď, sneh
// aj oblaky za sebou (docs/navrhy/teraz-scena-zem.html, počasie B). Nie je súčasťou behu appky - výsledok
// leží v repozitári a stránka ho servíruje tak, ako je.
//
// Zopakovanie (keď sa zmení kresba img/dom.png - semienka nižšie treba vtedy skontrolovať):
//
//   node scripts/dom-vypln.js
//
// Kresba sa rozdelí na plochy ohraničené čiarami. Plocha, ktorá siaha na horný, ľavý alebo dolný okraj, je
// okolie domu a ostane priehľadná (pravý okraj kresby dom odrezáva, preto sa nepočíta). Každá ďalšia plocha
// dostane farbu podľa semienka, ktoré v nej leží, inak farbu strechy. Čiary samotné dostanú farbu strechy -
// kreslí sa cez ne biela kresba. Počíta to Chromium z Playwrightu (vývojová závislosť), lebo vie čítať aj
// zapisovať PNG.

import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

/** Farby plôch (RGB). */
const FARBY = {
    strecha: [206, 216, 233],
    stena: [188, 201, 222],
    tien: [160, 177, 204],
    okno: [45, 85, 151],
    panel: [28, 47, 99],
    strom: [61, 112, 187],
    auto: [92, 136, 200],
};

/** Semienka: bod kresby (px) a farba plochy, v ktorej leží. */
const SEMIENKA = [
    // Panely na streche.
    ...[
        [172, 157],
        [215, 169],
        [258, 181],
        [304, 194],
        [136, 228],
        [179, 242],
        [222, 256],
        [267, 271],
    ].map((p) => [p, 'panel']),
    // Okná na štíte a vo vikieri, sklo auta.
    ...[
        [60, 310],
        [76, 316],
        [62, 338],
        [78, 345],
        [110, 329],
        [126, 335],
        [110, 357],
        [128, 364],
        [354, 304],
        [388, 316],
        [422, 327],
        [421, 543],
    ].map((p) => [p, 'okno']),
    [[230, 450], 'strom'],
    [[403, 583], 'auto'],
    [[508, 551], 'auto'],
    // Steny: štít, stena pod prístreškom, štít pri komíne.
    ...[
        [166, 360],
        [330, 418],
        [382, 416],
        [238, 100],
    ].map((p) => [p, 'stena']),
    // Tienisté strany: komín, strecha za komínom, bok vikiera, podmurovka.
    ...[
        [326, 94],
        [352, 117],
        [478, 305],
        [100, 400],
    ].map((p) => [p, 'tien']),
];

/**
 * Výplň v prehliadači: označí plochy, zafarbí ich a vráti PNG ako data URL.
 * @param {{ src: string, farby: Record<string, number[]>, semienka: [number[], string][] }} v
 */
async function vypln({ src, farby, semienka }) {
    const img = new Image();
    img.src = src;
    await img.decode();
    const W = img.width;
    const H = img.height;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const x = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
    x.drawImage(img, 0, 0);
    const a = x.getImageData(0, 0, W, H).data;
    const ciara = (/** @type {number} */ i) => a[i * 4 + 3] > 40;
    // Plochy medzi čiarami (4-susedstvo); okolie[id] hovorí, či plocha siaha na okraj (je mimo domu).
    const plocha = new Int32Array(W * H).fill(-1);
    /** @type {boolean[]} */
    const okolie = [];
    /** Susedia pixelu i v kresbe. @param {number} i @param {number} k @param {number} y */
    const susedia = (i, k, y) => [k > 0 ? i - 1 : -1, k < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
    /** Zaplaví plochu od pixelu s a vráti, či siaha na okraj. @param {number} s @param {number} id */
    const zaplav = (s, id) => {
        let kraj = false;
        const q = [s];
        plocha[s] = id;
        while (q.length) {
            const i = /** @type {number} */ (q.pop());
            const k = i % W;
            const y = (i - k) / W;
            kraj ||= k === 0 || y === 0 || y === H - 1;
            for (const j of susedia(i, k, y))
                if (j >= 0 && !ciara(j) && plocha[j] < 0) {
                    plocha[j] = id;
                    q.push(j);
                }
        }
        return kraj;
    };
    for (let s = 0; s < W * H; s++) if (!ciara(s) && plocha[s] < 0) okolie.push(zaplav(s, okolie.length));
    /** @type {Map<number, number[]>} */
    const farbaPlochy = new Map();
    for (const [[k, y], f] of semienka) farbaPlochy.set(plocha[y * W + k], farby[f]);
    const o = x.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
        const p = plocha[i];
        if (p >= 0 && okolie[p]) continue;
        const f = (p >= 0 && farbaPlochy.get(p)) || farby.strecha;
        o.data.set([f[0], f[1], f[2], 255], i * 4);
    }
    x.putImageData(o, 0, 0);
    return c.toDataURL('image/png');
}

const kresba = await readFile(new URL('../img/dom.png', import.meta.url));
const browser = await chromium.launch();
try {
    const page = await browser.newPage();
    const url = await page.evaluate(vypln, { src: `data:image/png;base64,${kresba.toString('base64')}`, farby: FARBY, semienka: SEMIENKA });
    await writeFile(new URL('../img/dom-vypln.png', import.meta.url), Buffer.from(url.split(',')[1], 'base64'));
    console.log('hotovo: img/dom-vypln.png');
} finally {
    await browser.close();
}
