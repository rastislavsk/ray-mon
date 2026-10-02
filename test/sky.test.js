import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SITE, SKY } from '../shared/config.js';
import { skyColors, skyNow, skyWeather } from '../shared/sky.js';
import { sunTimes } from '../shared/solar.js';
import { FIXED_NOW, fixtureData } from './helpers.js';

/** Farba `#rrggbb` z konfigurácie tak, ako ju vracia skyColors. @param {string} hex */
const css = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
/** Jas farby `rgb(r, g, b)` (0-255), na porovnanie svetlejšej a tmavšej oblohy. @param {string} c */
const jas = (c) => {
    const [r, g, b] = (c.match(/\d+/g) || []).map(Number);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** Sýtosť farby: rozdiel najsilnejšej a najslabšej zložky. Sivá ju má nízku. @param {string} c */
const sytost = (c) => {
    const v = (c.match(/\d+/g) || []).map(Number);
    return Math.max(...v) - Math.min(...v);
};

// 5. 9. 2026 v Dvoranoch: východ 6:09, západ 19:24.
const SUN = sunTimes(SITE, '2026-09-05');
const hm = (/** @type {number} */ h, m = 0) => h * 60 + m;

test('skyWeather: tri stavy podľa oblačnosti', () => {
    assert.equal(skyWeather(0), 'jasno');
    assert.equal(skyWeather(SKY.clearPct - 1), 'jasno');
    assert.equal(skyWeather(SKY.clearPct), 'polojasno');
    assert.equal(skyWeather(SKY.overcastPct - 1), 'polojasno');
    assert.equal(skyWeather(SKY.overcastPct), 'zamracene');
    assert.equal(skyWeather(100), 'zamracene');
});

test('skyColors: polnoc je prvý kľúč návrhu, v noci je obloha tmavá', () => {
    const polnoc = skyColors(0, SUN, 'jasno');
    assert.deepEqual([polnoc.top, polnoc.bottom], [css(SKY.keys[0][1]), css(SKY.keys[0][2])]);
    const noc = skyColors(hm(23), SUN, 'jasno');
    const poludnie = skyColors(hm(13), SUN, 'jasno');
    assert.ok(jas(noc.top) < 30 && jas(noc.bottom) < 50, `noc ${noc.top} ${noc.bottom}`);
    assert.ok(jas(poludnie.bottom) > 3 * jas(noc.bottom));
});

test('skyColors: ráno pri skutočnom východe slnka je obloha návrhu o 7:00', () => {
    const vychod = skyColors(/** @type {number} */ (SUN.rise), SUN, 'jasno');
    const kluc = SKY.keys.find((k) => k[0] === SKY.riseH);
    assert.ok(kluc);
    assert.deepEqual([vychod.top, vychod.bottom], [css(kluc[1]), css(kluc[2])]);
});

test('skyColors: poludnie je modré, svetlejšie dole', () => {
    const { top, bottom } = skyColors(hm(13), SUN, 'jasno');
    const [r, , b] = (top.match(/\d+/g) || []).map(Number);
    assert.ok(b > r + 100, `modrá hore: ${top}`);
    assert.ok(jas(bottom) > jas(top));
});

test('skyColors: večer pri západe slnka je obloha návrhu medzi 18:00 a 19:30, dole teplá', () => {
    const zapad = skyColors(/** @type {number} */ (SUN.set), SUN, 'jasno');
    const [r, , b] = (zapad.bottom.match(/\d+/g) || []).map(Number);
    assert.ok(r > b, `oranžová dole: ${zapad.bottom}`);
    assert.notEqual(zapad.top, skyColors(hm(13), SUN, 'jasno').top);
});

test('skyColors: východ a západ sú ozajstné časy, nie pevné hodiny', () => {
    // O 7:00 je v júni dávno deň, v decembri ešte svitá.
    const leto = skyColors(hm(7), sunTimes(SITE, '2026-06-21'), 'jasno');
    const zima = skyColors(hm(7), sunTimes(SITE, '2026-12-21'), 'jasno');
    assert.ok(jas(leto.top) > jas(zima.top) + 20, `leto ${leto.top}, zima ${zima.top}`);
});

test('skyColors: oblačnosť primieša sivú, zamračené viac než polojasno', () => {
    const jasno = skyColors(hm(13), SUN, 'jasno');
    const polo = skyColors(hm(13), SUN, 'polojasno');
    const zamr = skyColors(hm(13), SUN, 'zamracene');
    assert.equal(jasno.weather, 'jasno');
    assert.equal(zamr.weather, 'zamracene');
    assert.ok(sytost(jasno.top) > sytost(polo.top) && sytost(polo.top) > sytost(zamr.top));
    assert.ok(sytost(jasno.bottom) > sytost(polo.bottom) && sytost(polo.bottom) > sytost(zamr.bottom));
});

test('skyColors: v noci mení oblačnosť oblohu menej než cez deň', () => {
    // Koľkou časťou cesty od jasnej farby k sivej mrakov je zamračená obloha (0 = vôbec, 1 = celá).
    const podiel = (/** @type {number} */ min) => {
        const [j, z, s] = [skyColors(min, SUN, 'jasno').top, skyColors(min, SUN, 'zamracene').top, css(SKY.cloud[0])].map((c) =>
            (c.match(/\d+/g) || []).map(Number),
        );
        return Math.hypot(...z.map((v, i) => v - j[i])) / Math.hypot(...s.map((v, i) => v - j[i]));
    };
    assert.ok(Math.abs(podiel(hm(13)) - SKY.cloudMix.zamracene) < 0.02, `poludnie ${podiel(hm(13))}`);
    assert.ok(podiel(hm(1)) < podiel(hm(13)) / 2, `noc ${podiel(hm(1))}`);
});

test('skyColors: bez dát je obloha sivá', () => {
    assert.deepEqual(skyColors(hm(13), SUN, null), { weather: null, top: SKY.offline[0], bottom: SKY.offline[1] });
});

test('skyColors: bez východu a západu (polárna noc či deň) ide obloha podľa hodín', () => {
    const polarna = skyColors(hm(12), { rise: null, set: null }, 'jasno');
    const kluc = SKY.keys.find((k) => k[0] === 12);
    assert.ok(kluc);
    assert.equal(polarna.top, css(kluc[1]));
});

test('skyNow: oblačnosť z hodiny predpovede, v ktorej teraz sme', () => {
    const { forecast } = fixtureData();
    const base = { now: FIXED_NOW, known: /** @type {const} */ ('elektraren'), site: SITE, loading: false };
    const hodina = forecast.hourlyToday.find((h) => h.hour === 13);
    assert.ok(hodina && hodina.cloud !== null);
    const sky = skyNow({ ...base, forecast });
    assert.equal(sky.weather, skyWeather(hodina.cloud));
    // Ten istý čas so zamračenou hodinou je sivší.
    const mraky = { ...forecast, hourlyToday: forecast.hourlyToday.map((h) => ({ ...h, cloud: 100 })) };
    assert.equal(skyNow({ ...base, forecast: mraky }).weather, 'zamracene');
    // Hodina bez údaja o oblačnosti: len čas dňa.
    const bez = { ...forecast, hourlyToday: forecast.hourlyToday.map((h) => ({ ...h, cloud: null })) };
    assert.equal(skyNow({ ...base, forecast: bez }).weather, 'jasno');
});

test('skyNow: bez dát sivá, počas prvého načítania čas dňa bez počasia', () => {
    const base = { now: FIXED_NOW, site: SITE, forecast: null };
    assert.equal(skyNow({ ...base, known: 'elektraren', loading: false }).weather, null);
    assert.equal(skyNow({ ...base, known: 'nic', loading: true }).weather, null);
    const nacitava = skyNow({ ...base, known: 'poloha', loading: true });
    assert.equal(nacitava.weather, 'jasno');
    assert.notEqual(nacitava.top, SKY.offline[0]);
});
