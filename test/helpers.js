import { readFileSync } from 'node:fs';
import { PLANT, SITE } from '../shared/config.js';
import { parseKiosk } from '../shared/kiosk.js';
import { voiceTexts } from '../shared/messages.js';
import { buildForecast, localMinutes } from '../shared/solar.js';

/** Pevný čas testov: 5. 9. 2026 13:00 miestneho (11:00 UTC), rovnaký deň ako fixtures. */
export const FIXED_NOW = new Date('2026-09-05T11:00:00Z');

/**
 * Každé veľké slovo karty Dnes v danom tóne: o celom dni (DEN_WORDS) aj bez dát (MOZEM_WORDS).
 * @param {import('../shared/messages.js').Voice} voice @returns {string[]}
 */
export function bigWords(voice) {
    const { DEN_WORDS, MOZEM_WORDS } = voiceTexts(voice);
    return [...new Set([...Object.values(DEN_WORDS).flatMap((g) => Object.values(g)), ...Object.values(MOZEM_WORDS)])];
}

export const fixture = (/** @type {string} */ name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

export function fixtureData(now = FIXED_NOW) {
    return { pv: parseKiosk(fixture('kiosk.json'), now), forecast: buildForecast(fixture('open-meteo.json'), now, SITE, PLANT) };
}

/**
 * Meranie z kiosku tak, ako by prišlo v danej chvíli 5. 9. 2026: krivka dneška po tú chvíľu,
 * výkon teraz z jej posledného bodu (keď je čerstvý, inak 0 - večer a v noci menič nevyrába)
 * a čas stiahnutia. Fixture je snímka o 13:00; ráno by inak ukazovala poludňajší výkon.
 * @param {Date} now
 */
export function pvAt(now) {
    const pv = parseKiosk(fixture('kiosk.json'), now);
    const hours = localMinutes(now, SITE.timezone) / 60;
    const curve = pv.realCurveToday.filter((p) => p.hour <= hours);
    const last = curve[curve.length - 1];
    return { ...pv, realCurveToday: curve, realTimePowerKw: last && hours - last.hour <= 0.25 ? last.kw : 0 };
}

/**
 * Podvrhne QR knižnicu z CDN (v testoch sa nenačíta): kód kreslí ako prvok s `data-qr` a odkaz
 * dlhší než `maxLen` odmietne výnimkou ako skutočná knižnica pri prekročení kapacity kódu.
 * Úroveň opravy chýb, s ktorou appka kód vytvorila, zapíše do `globalThis.qrLevels`.
 * @param {import('@playwright/test').Page} page @param {number} maxLen
 */
export async function podvrhniQr(page, maxLen) {
    await page.addInitScript((max) => {
        /** @type {number[]} */ const levels = [];
        const g = /** @type {any} */ (globalThis);
        g.qrLevels = levels;
        g.QRCode = class {
            /** @param {HTMLElement} el @param {{ text?: string, correctLevel: number }} o */
            constructor(el, o) {
                this.el = el;
                levels.push(o.correctLevel);
                if (o.text) this.makeCode(o.text);
            }
            /** @param {string} text */
            makeCode(text) {
                if (text.length > max) throw new Error('code length overflow');
                const d = document.createElement('div');
                d.dataset.qr = text;
                this.el.replaceChildren(d);
            }
        };
        g.QRCode.CorrectLevel = { L: 1, M: 0, Q: 3, H: 2 };
    }, maxLen);
}

/**
 * Falošný fetch: odpovede podľa URL, null = výpadok. Zapisuje, čo sa volalo.
 * @param {Record<string, unknown>} routes
 */
export function fakeFetch(routes) {
    /** @type {string[]} */ const calls = [];
    const impl = /** @type {typeof fetch} */ (
        /** @type {unknown} */ (
            async (/** @type {string} */ url) => {
                calls.push(url);
                const body = routes[url];
                if (body === undefined || body === null) return { ok: false, status: 500, json: async () => ({}) };
                return { ok: true, status: 200, json: async () => body };
            }
        )
    );
    return { impl, calls };
}

/**
 * Falošný localStorage na globalThis, ako ho vidí web/storage.js. Vráti zapísané hodnoty
 * a upratanie, ktoré ho zas odstráni.
 */
export function fakeStorage() {
    /** @type {Map<string, string>} */ const saved = new Map();
    /** @type {any} */ (globalThis).localStorage = {
        getItem: (/** @type {string} */ k) => saved.get(k) ?? null,
        setItem: (/** @type {string} */ k, /** @type {string} */ v) => saved.set(k, String(v)),
        removeItem: (/** @type {string} */ k) => saved.delete(k),
    };
    return { saved, restore: () => delete (/** @type {any} */ (globalThis).localStorage) };
}

/**
 * Stavový riadok telefónu (meta theme-color) a vrchný riadok stránky pod ním. Android pod stavový
 * riadok stránku nepustí, len ho zafarbí, takže tieto dve farby musia nadväzovať. Vráti najväčší
 * rozdiel jednej zložky (0-255) medzi theme-color a priemernou farbou vrchného riadku obrazovky.
 * @param {import('@playwright/test').Page} page @returns {Promise<number>}
 */
export async function rozdielStavovehoRiadku(page) {
    const width = page.viewportSize()?.width ?? 0;
    const png = await page.screenshot({ clip: { x: 0, y: 0, width, height: 1 } });
    return page.evaluate(async (b64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const ctx = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d'));
        ctx.canvas.width = img.width;
        ctx.canvas.height = 1;
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, img.width, 1).data;
        const vrch = [0, 1, 2].map((i) => d.filter((_, j) => j % 4 === i).reduce((a, b) => a + b, 0) / img.width);
        // Canvas prepíše akýkoľvek zápis farby (#hex, rgb(…)) na #rrggbb.
        ctx.fillStyle = /** @type {HTMLMetaElement} */ (document.querySelector('meta[name="theme-color"]')).content;
        const meta = String(ctx.fillStyle);
        const farba = [1, 3, 5].map((i) => parseInt(meta.slice(i, i + 2), 16));
        return Math.max(...farba.map((v, i) => Math.abs(v - vrch[i])));
    }, png.toString('base64'));
}
