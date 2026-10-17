import { readFileSync } from 'node:fs';
import { PLANT, SITE } from '../shared/config.js';
import { parseKiosk } from '../shared/kiosk.js';
import { buildForecast, localMinutes } from '../shared/solar.js';

/** Pevný čas testov: 5. 9. 2026 13:00 miestneho (11:00 UTC), rovnaký deň ako fixtures. */
export const FIXED_NOW = new Date('2026-09-05T11:00:00Z');

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
