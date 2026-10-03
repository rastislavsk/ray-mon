// Kontrast textu podľa WCAG 2.2: relatívny jas farby a pomer dvoch jasov. Čisté funkcie nad
// farbami v sRGB - používa ich živá obloha novej appky (koľko stmaviť spodok, shared/sky.js)
// aj testy, ktoré merajú text na oblohe a na skle.

/**
 * Farba v sRGB, zložky 0-255.
 * @typedef {[number, number, number]} Rgb
 */
/**
 * Farba s priehľadnosťou, `a` 0-1.
 * @typedef {[number, number, number, number]} Rgba
 */

// Cieľ WCAG AA: bežný text 4,5 : 1, veľký text 3 : 1. Veľký je od 24 px, tučný už od 19 px.
export const CONTRAST_TEXT = 4.5;
export const CONTRAST_LARGE = 3;

/**
 * Farba z CSS zápisu `#rgb`, `#rrggbb`, `rgb(…)`, `rgba(…)` alebo `transparent` - tak, ako ju
 * vráti getComputedStyle aj ako ju píše style.css.
 * @param {string} css @returns {Rgba}
 */
export function parseColor(css) {
    const s = css.trim().toLowerCase();
    if (s === 'transparent') return [0, 0, 0, 0];
    if (s.startsWith('#')) {
        const hex = s.length === 4 ? [...s.slice(1)].map((c) => c + c).join('') : s.slice(1);
        const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
        return [r, g, b, 1];
    }
    const m = s.match(/^rgba?\(([^)]+)\)$/);
    if (!m) throw new Error(`Neznáma farba: ${css}`);
    const [r, g, b, a = 1] = m[1]
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map(Number);
    return [r, g, b, a];
}

/**
 * Farba `top` s priehľadnosťou položená na nepriehľadnú `bottom` (skladanie v sRGB, ako to robí
 * prehliadač pri bežnom prekrytí).
 * @param {Rgba} top @param {Rgb} bottom @returns {Rgb}
 */
export function over(top, bottom) {
    const a = top[3];
    const mix = (/** @type {number} */ i) => top[i] * a + bottom[i] * (1 - a);
    return [mix(0), mix(1), mix(2)];
}

/** Relatívny jas farby podľa WCAG, 0 = čierna, 1 = biela. @param {Rgb} rgb */
export function luminance(rgb) {
    const [r, g, b] = rgb.map((c) => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Kontrast dvoch nepriehľadných farieb, 1 až 21. @param {Rgb} a @param {Rgb} b */
export function contrastRatio(a, b) {
    const [x, y] = [luminance(a), luminance(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * Kontrast textu (aj polopriehľadného) na nepriehľadnom pozadí.
 * @param {Rgba} text @param {Rgb} background
 */
export const textContrast = (text, background) => contrastRatio(over(text, background), background);

/**
 * Najmenší kontrast, ktorý text danej veľkosti potrebuje.
 * @param {number} px veľkosť písma v CSS pixeloch @param {number} weight hrúbka (400 bežné, 700 tučné)
 */
export const contrastTarget = (px, weight) => (px >= 24 || (px >= 19 && weight >= 700) ? CONTRAST_LARGE : CONTRAST_TEXT);
