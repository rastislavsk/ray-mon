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
