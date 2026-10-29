// Oblúk slnka nad veľkým slovom karty Dnes - v oboch appkách. Polohu slnka, okno a časy počíta
// sunArc v shared/mozem-sky.js, tu sa len skladá SVG. Farby idú cez CSS triedy, každá appka
// ich má vo vlastnom štýle.

import { minutesToTimeStr } from '../shared/format.js';

/** @typedef {ReturnType<typeof import('../shared/mozem-sky.js').sunArc>} SunArc */

// Oblúk v súradniciach návrhu: polovica elipsy nad obzorom, východ vľavo, západ vpravo.
const ARC = { cx: 160, cy: 118, rx: 140, ry: 88 };
const MOON = { x: 262, y: 42 };

/** Bod na oblúku, 0 = východ, 1 = západ. @param {number} f */
function arcPoint(f) {
    const a = Math.PI * (1 - f);
    return `${(ARC.cx + ARC.rx * Math.cos(a)).toFixed(1)} ${(ARC.cy - ARC.ry * Math.sin(a)).toFixed(1)}`;
}

/**
 * Oblúk slnka: prerušovaná dráha, zelený úsek dnešného okna, slnko na dráhe (v noci mesiac)
 * a časy východu a západu. Bez dát je slnko len sivý kruh a okno nie je.
 * @param {SunArc} arc @param {boolean} off
 */
export function sunArcSvg(arc, off) {
    const { cx, cy, rx, ry } = ARC;
    const win =
        arc.win && arc.win.to > arc.win.from
            ? `<path class="arc-win" d="M${arcPoint(arc.win.from)} A${rx} ${ry} 0 0 1 ${arcPoint(arc.win.to)}"/>`
            : '';
    const at = arc.sun === null ? `${MOON.x} ${MOON.y}` : arcPoint(arc.sun);
    const body = off
        ? '<circle r="12" class="arc-off"/>'
        : arc.sun === null
          ? '<circle r="11" class="arc-moon"/><circle cx="6" cy="-4" r="9" class="arc-moon-cut"/>'
          : '<circle r="24" class="arc-glow"/><circle r="13" class="arc-sun"/>';
    const label = (/** @type {number | null} */ m, /** @type {number} */ x) =>
        m === null ? '' : `<text x="${x}" y="130" class="arc-t">${minutesToTimeStr(m)}</text>`;
    return (
        `<svg viewBox="0 0 320 132"><path class="arc-path" d="M${cx - rx} ${cy} A${rx} ${ry} 0 0 1 ${cx + rx} ${cy}"/>${win}` +
        `<line x1="0" y1="${cy}" x2="320" y2="${cy}" class="arc-ground"/>${label(arc.rise, cx - rx)}${label(arc.set, cx + rx)}` +
        `<g transform="translate(${at})">${body}</g></svg>`
    );
}
