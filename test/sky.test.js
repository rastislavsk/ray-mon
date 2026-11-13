import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SITE, SKY } from '../shared/config.js';
import { skyColors, skyNav, skyNow, skyShade, skyWeather } from '../shared/sky.js';
import { localToUtc, solarPosition, sunTimes } from '../shared/solar.js';
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
const DEN = '2026-09-05';
const SUN = sunTimes(SITE, DEN);
/** Okamih miestneho času h:m v deň `den` nad Dvoranmi. */
const v = (/** @type {number} */ h, m = 0, den = DEN) => localToUtc(den, h * 60 + m, SITE.timezone);
/** Okamih minúty dňa `min` (napr. východ zo sunTimes). @param {number | null} min */
const vMin = (min, den = DEN) => localToUtc(den, /** @type {number} */ (min), SITE.timezone);
/** Výška slnka nad Dvoranmi v okamihu `t` (°). @param {Date} t */
const vyska = (t) => solarPosition(t, SITE.lat, SITE.lon).elevationDeg;
/** Prvý okamih od `od` po minútach, keď slnko klesne (večer) či stúpne (ráno) cez výšku `e`. */
function prechod(/** @type {Date} */ od, /** @type {number} */ e, rano = false) {
    for (let t = od.getTime(); t < od.getTime() + 86400000; t += 60000) {
        const [a, b] = [vyska(new Date(t)), vyska(new Date(t + 60000))];
        if (rano ? a < e && b >= e : a > e && b <= e) return new Date(t + 60000);
    }
    throw new Error(`slnko neprejde ${e}°`);
}

test('skyWeather: tri stavy podľa oblačnosti', () => {
    assert.equal(skyWeather(0), 'jasno');
    assert.equal(skyWeather(SKY.clearPct - 1), 'jasno');
    assert.equal(skyWeather(SKY.clearPct), 'polojasno');
    assert.equal(skyWeather(SKY.overcastPct - 1), 'polojasno');
    assert.equal(skyWeather(SKY.overcastPct), 'zamracene');
    assert.equal(skyWeather(100), 'zamracene');
});

test('skyColors: o polnoci je najhlbšia noc, v noci je obloha tmavá', () => {
    const polnoc = skyColors(v(0), SITE, 'jasno');
    assert.deepEqual([polnoc.top, polnoc.bottom], [css(SKY.keys[0][1]), css(SKY.keys[0][2])]);
    const noc = skyColors(v(23), SITE, 'jasno');
    const poludnie = skyColors(v(13), SITE, 'jasno');
    assert.ok(jas(noc.top) < 15 && jas(noc.bottom) < 25, `noc ${noc.top} ${noc.bottom}`);
    assert.ok(jas(poludnie.bottom) > 3 * jas(noc.bottom));
});

test('skyColors: ráno pri skutočnom východe slnka je obloha návrhu o 7:00', () => {
    const vychod = skyColors(vMin(SUN.rise), SITE, 'jasno');
    const kluc = SKY.keys.find((k) => k[0] === SKY.riseH);
    assert.ok(kluc);
    assert.deepEqual([vychod.top, vychod.bottom], [css(kluc[1]), css(kluc[2])]);
});

test('skyColors: poludnie je modré, svetlejšie dole', () => {
    const { top, bottom } = skyColors(v(13), SITE, 'jasno');
    const [r, , b] = (top.match(/\d+/g) || []).map(Number);
    assert.ok(b > r + 100, `modrá hore: ${top}`);
    assert.ok(jas(bottom) > jas(top));
});

test('skyColors: večer pri západe slnka je obloha návrhu medzi 18:00 a 19:30, dole teplá', () => {
    const zapad = skyColors(vMin(SUN.set), SITE, 'jasno');
    const [r, , b] = (zapad.bottom.match(/\d+/g) || []).map(Number);
    assert.ok(r > b, `oranžová dole: ${zapad.bottom}`);
    assert.notEqual(zapad.top, skyColors(v(13), SITE, 'jasno').top);
});

test('skyColors: východ a západ sú ozajstné časy, nie pevné hodiny', () => {
    // O 7:00 je v júni dávno deň, v decembri ešte svitá.
    const leto = skyColors(v(7, 0, '2026-06-21'), SITE, 'jasno');
    const zima = skyColors(v(7, 0, '2026-12-21'), SITE, 'jasno');
    assert.ok(jas(leto.top) > jas(zima.top) + 20, `leto ${leto.top}, zima ${zima.top}`);
});

/** Farby kľúča návrhu o hodine `h`. @param {number} h */
const kluc = (h) => {
    const k = SKY.keys.find((x) => x[0] === h);
    assert.ok(k, `kľúč ${h}`);
    return [css(k[1]), css(k[2])];
};

test('skyColors: súmrak a noc podľa výšky slnka pod obzorom, v zime aj v lete', () => {
    for (const den of ['2026-12-21', '2026-06-21', DEN]) {
        const poludnie = v(12, 0, den);
        // -6° je súmrak, -12° noc a -18° najhlbšia noc - tak ako vonku, nie podľa hodín.
        for (const [e, h] of SKY.sumrak.vecer) {
            const t = prechod(poludnie, e);
            const { top, bottom } = skyColors(t, SITE, 'jasno');
            const [kt, kb] = kluc(h);
            assert.ok(Math.abs(jas(top) - jas(kt)) < 1.5 && Math.abs(jas(bottom) - jas(kb)) < 1.5, `${den} večer ${e}°: ${top} ${bottom}`);
        }
        const rano = prechod(v(0, 0, den), -6, true);
        const [rt] = kluc(5.5);
        assert.ok(Math.abs(jas(skyColors(rano, SITE, 'jasno').top) - jas(rt)) < 3, `${den} ráno -6°`);
    }
    // V decembri je noc (-12°) o 17-tej, v lete až pred 23-tou - obe sú tá istá nočná farba.
    const zima = prechod(v(12, 0, '2026-12-21'), -12);
    const leto = prechod(v(12, 0, '2026-06-21'), -12);
    assert.ok(zima.getTime() < v(17, 30, '2026-12-21').getTime(), `${zima.toISOString()}`);
    assert.ok(leto.getTime() > v(22, 0, '2026-06-21').getTime(), `${leto.toISOString()}`);
});

test('skyColors: súmrak sa mení plynule, bez skokov pri západe aj východe', () => {
    for (const den of ['2026-12-21', DEN]) {
        const sun = sunTimes(SITE, den);
        for (const okolo of [sun.set, sun.rise]) {
            let pred = skyColors(vMin(/** @type {number} */ (okolo) - 90, den), SITE, 'jasno');
            for (let m = -89; m <= 90; m++) {
                const teraz = skyColors(vMin(/** @type {number} */ (okolo) + m, den), SITE, 'jasno');
                assert.ok(Math.abs(jas(teraz.bottom) - jas(pred.bottom)) < 6, `${den} ${m} min: ${pred.bottom} → ${teraz.bottom}`);
                pred = teraz;
            }
        }
    }
});

test('skyColors: oblačnosť primieša sivú, zamračené viac než polojasno', () => {
    const jasno = skyColors(v(13), SITE, 'jasno');
    const polo = skyColors(v(13), SITE, 'polojasno');
    const zamr = skyColors(v(13), SITE, 'zamracene');
    assert.equal(jasno.weather, 'jasno');
    assert.equal(zamr.weather, 'zamracene');
    assert.ok(sytost(jasno.top) > sytost(polo.top) && sytost(polo.top) > sytost(zamr.top));
    assert.ok(sytost(jasno.bottom) > sytost(polo.bottom) && sytost(polo.bottom) > sytost(zamr.bottom));
});

test('skyColors: v noci mení oblačnosť oblohu menej než cez deň', () => {
    // Koľkou časťou cesty od jasnej farby k sivej mrakov je polojasná obloha (0 = vôbec, 1 = celá).
    const podiel = (/** @type {Date} */ t) => {
        const [j, z, s] = [skyColors(t, SITE, 'jasno').top, skyColors(t, SITE, 'polojasno').top, css(SKY.cloud[0])].map((c) =>
            (c.match(/\d+/g) || []).map(Number),
        );
        return Math.hypot(...z.map((x, i) => x - j[i])) / Math.hypot(...s.map((x, i) => x - j[i]));
    };
    assert.ok(Math.abs(podiel(v(13)) - SKY.cloudMix.polojasno) < 0.02, `poludnie ${podiel(v(13))}`);
    assert.ok(podiel(v(1)) < podiel(v(13)) / 2, `noc ${podiel(v(1))}`);
});

test('skyColors: zamračená obloha je sivá cez deň aj v noci, v noci tmavšia', () => {
    const den = skyColors(v(13), SITE, 'zamracene');
    const noc = skyColors(v(1), SITE, 'zamracene');
    for (const c of [den.top, den.bottom, noc.top, noc.bottom]) assert.equal(sytost(c), 0, c);
    const jas = (/** @type {string} */ c) => Number((c.match(/\d+/) || ['0'])[0]);
    assert.ok(jas(noc.top) < jas(den.top) / 2, `${noc.top} vs ${den.top}`);
});

test('skyColors: bez dát je obloha sivá', () => {
    const { shade, nav, ...farby } = skyColors(v(13), SITE, null);
    assert.deepEqual(farby, { weather: null, top: SKY.offline[0], bottom: SKY.offline[1] });
    assert.equal(shade, skyShade(...SKY.offline));
    assert.equal(nav, skyNav(SKY.offline[1]));
});

test('skyColors: polárny deň ide podľa hodín, polárna noc a biele noci podľa výšky slnka', () => {
    const SVALBARD = { ...SITE, lat: 78.2, lon: 15.6, timezone: 'Europe/Oslo' };
    const den = skyColors(localToUtc('2026-06-21', 12 * 60, SVALBARD.timezone), SVALBARD, 'jasno');
    assert.equal(den.top, kluc(12)[0]);
    // Polárna noc: slnko nevyjde, obloha je cez deň v súmraku, nie čierna ani denná.
    const noc = skyColors(localToUtc('2026-12-21', 12 * 60, SVALBARD.timezone), SVALBARD, 'jasno');
    assert.ok(jas(noc.top) < jas(kluc(19.5)[0]) + 2 && jas(noc.top) > jas(kluc(24)[0]), noc.top);
    // Biele noci (Helsinki v júni): slnko neklesne pod -12°, noc nepríde.
    const HELSINKI = { ...SITE, lat: 60.17, lon: 24.94, timezone: 'Europe/Helsinki' };
    const polnoc = skyColors(localToUtc('2026-06-21', 60, HELSINKI.timezone), HELSINKI, 'jasno');
    assert.ok(jas(polnoc.top) > jas(kluc(21)[0]) + 3, polnoc.top);
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

test('skyColors: zamračenosť mení nebo plynule od modrej po sivú, stavy sú jej stredy', () => {
    const z = (/** @type {number} */ x) => skyColors(v(13), SITE, 'polojasno', x);
    // Bez zamračenosti platí stred stavu: jasno 0, polojasno 0,5, zamračené 1.
    assert.deepEqual(z(0.5), skyColors(v(13), SITE, 'polojasno'));
    assert.equal(z(0).top, skyColors(v(13), SITE, 'jasno').top);
    assert.equal(z(1).top, skyColors(v(13), SITE, 'zamracene').top);
    // Čím zamračenejšie, tým menej modrej - bez skokov.
    const kroky = [0, 0.25, 0.5, 0.6, 0.75, 0.9, 1].map((x) => sytost(z(x).top));
    for (let i = 1; i < kroky.length; i++) assert.ok(kroky[i] < kroky[i - 1], `${kroky}`);
    assert.equal(kroky[kroky.length - 1], 0);
});

test('skyNow: pri náhľade iného času je nebo v tej chvíli', () => {
    const { forecast } = fixtureData();
    const base = { now: v(13), known: /** @type {const} */ ('elektraren'), site: SITE, loading: false, forecast };
    const vecer = skyNow({ ...base, previewMinutes: 21 * 60 + 30 }, true, { jas: 'jasno', zamracenost: 0, zrazky: null });
    assert.deepEqual(vecer, skyNow({ ...base, now: v(21, 30) }, true, { jas: 'jasno', zamracenost: 0, zrazky: null }));
    assert.deepEqual(skyNow({ ...base, previewMinutes: null }), skyNow(base));
});

test('skyNow: s počasím z karty Teraz rozhoduje ono, nie oblačnosť predpovede', () => {
    const { forecast } = fixtureData();
    const mraky = { ...forecast, hourlyToday: forecast.hourlyToday.map((h) => ({ ...h, cloud: 100 })) };
    const base = { now: FIXED_NOW, known: /** @type {const} */ ('elektraren'), site: SITE, loading: false, forecast: mraky };
    // Predpoveď hlási zamračené, meranie jasno: nebo je modré ako kresba.
    const slnko = skyNow(base, true, { jas: 'jasno', zamracenost: 0, zrazky: null });
    assert.equal(slnko.weather, 'jasno');
    assert.ok(sytost(slnko.top) > sytost(skyNow(base).top));
    // Pri daždi je zamračené, aj keď kresba ukazuje polojasno.
    assert.equal(skyNow(base, true, { jas: 'polojasno', zamracenost: 1, zrazky: 'dazd' }).weather, 'zamracene');
});

test('skyNow: bez dát sivá, počas prvého načítania čas dňa bez počasia', () => {
    const base = { now: FIXED_NOW, site: SITE, forecast: null };
    assert.equal(skyNow({ ...base, known: 'elektraren', loading: false }).weather, null);
    assert.equal(skyNow({ ...base, known: 'nic', loading: true }).weather, null);
    const nacitava = skyNow({ ...base, known: 'poloha', loading: true });
    assert.equal(nacitava.weather, 'jasno');
    assert.notEqual(nacitava.top, SKY.offline[0]);
});

test('skyNow: vypnutá živá obloha stojí v pokojných tmavých farbách, bez dát ostáva sivá', () => {
    const { forecast } = fixtureData();
    const base = { known: /** @type {const} */ ('elektraren'), site: SITE, loading: false, forecast };
    const at = (/** @type {string} */ hm) => new Date(`2026-09-05T${hm}:00+02:00`);
    const poludnie = skyNow({ ...base, now: at('13:00') }, false);
    const vecer = skyNow({ ...base, now: at('21:00') }, false);
    assert.deepEqual([poludnie.top, poludnie.bottom], SKY.calm);
    assert.deepEqual([vecer.top, vecer.bottom], SKY.calm);
    // Počasie ostáva známe, mení sa len farba.
    assert.equal(poludnie.weather, skyNow({ ...base, now: at('13:00') }).weather);
    // Zapnutá živá obloha je to isté ako bez parametra a cez deň iná.
    assert.deepEqual(skyNow({ ...base, now: at('13:00') }, true), skyNow({ ...base, now: at('13:00') }));
    assert.notEqual(skyNow({ ...base, now: at('13:00') }).top, SKY.calm[0]);
    const bezDat = skyNow({ ...base, forecast: null, now: at('13:00') }, false);
    assert.deepEqual([bezDat.top, bezDat.bottom, bezDat.weather], [...SKY.offline, null]);
});
