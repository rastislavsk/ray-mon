import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SITE, SKY } from '../shared/config.js';
import {
    CONTRAST_LARGE,
    CONTRAST_TEXT,
    contrastRatio,
    contrastTarget,
    luminance,
    over,
    parseColor,
    textContrast,
} from '../shared/contrast.js';
import { skyAt, skyColors, skyNow, skyShade } from '../shared/sky.js';
import { sunTimes } from '../shared/solar.js';
import { FIXED_NOW, fixtureData } from './helpers.js';

const WHITE = parseColor('#fff');
const BLACK = /** @type {import('../shared/contrast.js').Rgb} */ ([0, 0, 0]);

test('parseColor: zápisy z CSS aj z getComputedStyle', () => {
    assert.deepEqual(parseColor('#fff'), [255, 255, 255, 1]);
    assert.deepEqual(parseColor('#0B1430'), [11, 20, 48, 1]);
    assert.deepEqual(parseColor('rgb(23, 103, 201)'), [23, 103, 201, 1]);
    assert.deepEqual(parseColor('rgba(8, 16, 40, 0.3)'), [8, 16, 40, 0.3]);
    assert.deepEqual(parseColor(' rgb(5 10 30 / 0.4) '), [5, 10, 30, 0.4]);
    assert.deepEqual(parseColor('transparent'), [0, 0, 0, 0]);
    assert.throws(() => parseColor('color(srgb 1 1 1)'), /Neznáma farba/);
});

test('luminance a contrastRatio: hodnoty z WCAG', () => {
    assert.equal(luminance([255, 255, 255]), 1);
    assert.equal(luminance(BLACK), 0);
    assert.equal(contrastRatio([255, 255, 255], BLACK), 21);
    assert.equal(contrastRatio(BLACK, [255, 255, 255]), 21);
    // #767676 na bielej je známa hranica 4,5 : 1, #777 tesne pod ňou.
    assert.ok(contrastRatio([0x76, 0x76, 0x76], [255, 255, 255]) >= 4.5);
    assert.ok(contrastRatio([0x77, 0x77, 0x77], [255, 255, 255]) < 4.5);
});

test('over a textContrast: polopriehľadná farba na nepriehľadnej', () => {
    assert.deepEqual(over([255, 255, 255, 0.5], BLACK), [127.5, 127.5, 127.5]);
    assert.deepEqual(over([10, 20, 30, 0], [1, 2, 3]), [1, 2, 3]);
    assert.equal(textContrast(WHITE, BLACK), 21);
    assert.equal(textContrast([255, 255, 255, 0], BLACK), 1);
});

test('contrastTarget: veľký text od 24 px, tučný už od 19 px', () => {
    assert.equal(contrastTarget(16, 400), CONTRAST_TEXT);
    assert.equal(contrastTarget(23.9, 400), CONTRAST_TEXT);
    assert.equal(contrastTarget(24, 400), CONTRAST_LARGE);
    assert.equal(contrastTarget(19, 600), CONTRAST_TEXT);
    assert.equal(contrastTarget(19, 700), CONTRAST_LARGE);
    assert.equal(contrastTarget(18.5, 900), CONTRAST_TEXT);
});

test('skyShade: tmavá obloha stmavenie nepotrebuje, svetlý obzor áno', () => {
    assert.equal(skyShade(...SKY.calm), 'rgba(5, 10, 30, 0)');
    const rano = skyColors(8 * 60, sunTimes(SITE, '2026-09-05'), 'jasno');
    const poludnie = skyColors(13 * 60, sunTimes(SITE, '2026-09-05'), 'jasno');
    const alpha = (/** @type {string} */ c) => parseColor(c)[3];
    assert.ok(alpha(rano.shade) > alpha(poludnie.shade));
    assert.ok(alpha(poludnie.shade) > 0);
    // Najmenšie stmavenie, ktoré stačí: o stotinu menej by už biely text niekde neprešiel.
    const menej = `rgba(5, 10, 30, ${alpha(poludnie.shade) - 0.01})`;
    const heights = Array.from({ length: 51 }, (_, i) => i / 50);
    assert.ok(heights.some((t) => textContrast(WHITE, skyAt({ ...poludnie, shade: menej }, t)) < SKY.shadeContrast));
});

test('skyShade: na úplne bielej oblohe nestačí nič, spodok je celý tmavý', () => {
    assert.equal(skyShade('#ffffff', '#ffffff'), 'rgba(5, 10, 30, 1)');
});

test('skyAt: hore čistá obloha, dole cez ňu stmavený spodok', () => {
    const sky = { top: '#000000', bottom: '#ffffff', shade: 'rgba(0, 0, 0, 0.5)' };
    assert.deepEqual(skyAt(sky, 0), [0, 0, 0]);
    assert.deepEqual(skyAt(sky, 1), [127.5, 127.5, 127.5]);
});

test('skyNow: aj vypnutá živá obloha a obloha bez dát majú stmavený spodok', () => {
    const { forecast } = fixtureData();
    const base = { now: FIXED_NOW, known: /** @type {const} */ ('elektraren'), site: SITE, forecast, loading: false };
    assert.equal(skyNow(base, false).shade, skyShade(...SKY.calm));
    assert.equal(skyNow({ ...base, forecast: null }).shade, skyShade(...SKY.offline));
});

/**
 * Farby čitateľnosti z :root v obloha/style.css - tie isté, ktoré kreslí appka.
 * @returns {Record<string, string>}
 */
function cssTokens() {
    const css = readFileSync(new URL('../obloha/style.css', import.meta.url), 'utf8');
    const root = css.match(/:root\s*{([^}]*)}/)?.[1] ?? '';
    return Object.fromEntries([...root.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

/**
 * Každá obloha, akú appka vie ukázať: každá štvrťhodina dňa (najdlhší, jesenný aj najkratší deň)
 * × jasno, polojasno, zamračené; k tomu vypnutá živá obloha a sivá bez dát.
 * @returns {Array<{ name: string, sky: import('../shared/sky.js').Sky }>}
 */
function everySky() {
    const out = [];
    for (const date of ['2026-06-21', '2026-09-05', '2026-12-21']) {
        const sun = sunTimes(SITE, date);
        for (const weather of /** @type {const} */ (['jasno', 'polojasno', 'zamracene'])) {
            for (let m = 0; m < 1440; m += 15) {
                const hm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
                out.push({ name: `${date} ${hm} ${weather}`, sky: skyColors(m, sun, weather) });
            }
        }
    }
    const { forecast } = fixtureData();
    const base = { now: FIXED_NOW, known: /** @type {const} */ ('elektraren'), site: SITE, forecast, loading: false };
    out.push({ name: 'živá obloha vypnutá', sky: skyNow(base, false) });
    out.push({ name: 'bez dát', sky: skyNow({ ...base, forecast: null }) });
    return out;
}

test('čitateľnosť: každý text na každej oblohe dňa, v každej výške obrazovky, aspoň 4,5 : 1', () => {
    const t = cssTokens();
    for (const key of ['--glass', '--bar', '--dim', '--yes', '--cheap-text', '--costly-text']) assert.ok(t[key], `${key} chýba v :root`);
    // Text priamo na oblohe je biely. Na skle a na páse navigácie aj tlmený a farebný.
    const onSky = { biely: '#fff' };
    const onGlass = { biely: '#fff', tlmený: t['--dim'], zelený: t['--yes'], modrý: t['--cheap-text'], červený: t['--costly-text'] };
    const layers = { obloha: null, sklo: t['--glass'], navigácia: t['--bar'] };
    const skies = everySky();
    assert.equal(skies.length, 3 * 3 * 96 + 2);
    const heights = Array.from({ length: 21 }, (_, i) => i / 20);
    /**
     * Texty, ktoré na danom pozadí neprejdú. @param {string} where @param {import('../shared/contrast.js').Rgb} bg
     * @param {Record<string, string>} texts
     */
    const slabe = (where, bg, texts) =>
        Object.entries(texts)
            .map(([text, c]) => ({ text, ratio: textContrast(parseColor(c), bg) }))
            .filter((x) => x.ratio < CONTRAST_TEXT)
            .map((x) => `${where}: ${x.text} text ${x.ratio.toFixed(2)} : 1`);
    const zle = skies.flatMap(({ name, sky }) =>
        heights.flatMap((h) =>
            Object.entries(layers).flatMap(([layer, color]) => {
                const bare = skyAt(sky, h);
                return color
                    ? slabe(`${name}, výška ${h}, ${layer}`, over(parseColor(color), bare), onGlass)
                    : slabe(`${name}, výška ${h}, ${layer}`, bare, onSky);
            }),
        ),
    );
    assert.deepEqual(zle.slice(0, 20), []);
});
