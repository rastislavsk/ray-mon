// „Zdieľať do story“: súhrn ako obrázok 1080 × 1920 (formát story), nakreslený v prehliadači
// a poslaný systémovému zdieľaniu telefónu. Kde zdieľanie súborov nie je (desktop), obrázok sa
// stiahne. Žiadny server - obrázok nikam neodchádza bez toho, aby ho človek sám poslal.
//
// Model súhrnu je ten istý ako na obrazovke (shared/summary.js), takže obrázok a obrazovka
// nemôžu hovoriť dve rôzne čísla.

import { fmtSum } from '../shared/format.js';
import { summaryModel } from '../shared/summary.js';
import { shareFile } from './share-file.js';

const W = 1080;
const H = 1920;
const PAD = 90;

/**
 * Farby a písma plagátu z tokenov v style.css. Plagát na obrazovke (.summary) a obrázok tak
 * nemôžu mať dve rôzne palety - zmena v CSS sa prejaví v oboch.
 * @typedef {{ green: string, amber: string, red: string, mid: number, ink: string, sans: string, mono: string }} Look
 * @returns {Look}
 */
function look() {
    const css = getComputedStyle(document.documentElement);
    const token = (/** @type {string} */ name) => css.getPropertyValue(name).trim();
    return {
        green: token('--green'),
        amber: token('--amber'),
        red: token('--red'),
        mid: parseFloat(token('--poster-mid')) / 100,
        ink: token('--ink-on-color'),
        sans: token('--font-body'),
        mono: token('--font-mono'),
    };
}

/**
 * Rozdelí text na riadky do danej šírky.
 * @param {CanvasRenderingContext2D} ctx @param {string} text @param {number} width
 */
function wrap(ctx, text, width) {
    /** @type {string[]} */ const lines = [];
    let line = '';
    for (const word of text.split(' ')) {
        const next = line ? `${line} ${word}` : word;
        if (line && ctx.measureText(next).width > width) {
            lines.push(line);
            line = word;
        } else line = next;
    }
    if (line) lines.push(line);
    return lines;
}

/**
 * Nakreslí súhrn na plátno.
 * @param {CanvasRenderingContext2D} ctx @param {NonNullable<ReturnType<typeof summaryModel>>} m @param {string} site @param {Look} t
 */
function draw(ctx, m, site, t) {
    const bg = ctx.createLinearGradient(0, 0, W * 0.6, H);
    bg.addColorStop(0, t.green);
    bg.addColorStop(t.mid, t.amber);
    bg.addColorStop(1, t.red);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = t.ink;
    ctx.textBaseline = 'alphabetic';
    ctx.font = `700 44px ${t.mono}`;
    ctx.fillText(m.kick.toUpperCase(), PAD, 200);
    const num = fmtSum(Math.round(m.kwh), 0);
    // Štvorciferné číslo s „kWh“ by sa pri plnej veľkosti nezmestilo - písmo sa zmenší.
    let size = 300;
    ctx.font = `700 ${size}px ${t.sans}`;
    while (size > 120 && ctx.measureText(num).width > W - 2 * PAD - 200) {
        size -= 20;
        ctx.font = `700 ${size}px ${t.sans}`;
    }
    ctx.fillText(num, PAD - 12, 480);
    const numW = ctx.measureText(num).width;
    ctx.font = `700 80px ${t.sans}`;
    ctx.fillText('kWh', PAD + numW + 10, 480);
    let y = 600;
    for (const [i, r] of m.rows.entries()) {
        ctx.fillRect(PAD, y, W - 2 * PAD, 5);
        ctx.font = `700 40px ${t.mono}`;
        ctx.fillText(`0${i + 1}`, PAD, y + 80);
        ctx.font = `700 60px ${t.sans}`;
        const lines = wrap(ctx, r.t, W - 2 * PAD - 110);
        lines.forEach((l, j) => ctx.fillText(l, PAD + 110, y + 80 + j * 68));
        ctx.font = `500 40px ${t.sans}`;
        const sub = wrap(ctx, r.s, W - 2 * PAD - 110);
        sub.forEach((l, j) => ctx.fillText(l, PAD + 110, y + 80 + lines.length * 68 + 4 + j * 48));
        y += 102 + lines.length * 68 + sub.length * 48;
    }
    ctx.font = `700 36px ${t.mono}`;
    ctx.fillText(`RAY-MON · ${site}`.toUpperCase(), PAD, H - 110);
}

/**
 * Obrázok súhrnu ako súbor PNG, alebo null, keď súhrn nie je (bez merania).
 * @param {import('./state.js').AppState} state
 * @returns {Promise<File | null>}
 */
export async function summaryImage(state) {
    const m = summaryModel(state, state.summaryPeriod);
    if (!m) return null;
    const t = look();
    // Písma sú v stránke načítané lenivo - plátno by bez nich kreslilo náhradným písmom.
    await Promise.all([document.fonts.load(`700 100px ${t.sans}`), document.fonts.load(`700 40px ${t.mono}`)]).catch(() => undefined);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    draw(ctx, m, state.site.name, t);
    const blob = await new Promise((done) => canvas.toBlob(done, 'image/png'));
    return blob ? new File([/** @type {Blob} */ (blob)], `ray-mon-${m.period}.png`, { type: 'image/png' }) : null;
}

/**
 * Pošle obrázok súhrnu systémovému zdieľaniu; kde to nejde, stiahne ho. Zrušené zdieľanie nie je
 * chyba - človek si to len rozmyslel.
 * @param {import('./state.js').AppState} state
 */
export async function shareSummary(state) {
    const file = await summaryImage(state);
    if (file) await shareFile(file);
}
