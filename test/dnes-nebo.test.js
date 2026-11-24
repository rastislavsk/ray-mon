import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DNES_OS, HVIEZDY, PLANT, SITE, TARIFF } from '../shared/config.js';
import { fmt1 } from '../shared/format.js';
import { dnesNeboModel, dnesOsMinuta } from '../shared/dnes-nebo.js';
import { heroModel } from '../shared/hero-model.js';
import { hm, terazSourceText } from '../shared/messages.js';
import { localDateKey, sunTimes } from '../shared/solar.js';
import { pocasieTeraz } from '../shared/teraz.js';
import { fixtureData, pvAt } from './helpers.js';

/** Miestny čas 5. 9. 2026 v Bratislave (letný čas). @param {string} t */
const at = (t) => new Date(`2026-09-05T${t}:00+02:00`);
/** Minúta dňa z „HH:MM“. @param {string} t */
const min = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

/**
 * Vstup karty: Dvorany s kioskom a fixtures v danej chvíli. @param {Date} now @param {object} [extra]
 * @returns {Parameters<typeof dnesNeboModel>[0]}
 */
function input(now, extra = {}) {
    const { forecast } = fixtureData(now);
    return {
        now,
        site: SITE,
        plant: PLANT,
        tariff: TARIFF,
        zdroj: { sposob: 'huawei-kiosk', pecat: 'v1.test-pecat-0123456789', nazov: '' },
        loading: false,
        known: 'elektraren',
        pv: pvAt(now),
        forecast,
        ...extra,
    };
}

test('teraz: výkon z toho istého výpočtu ako karta Teraz, odkiaľ je, bežec na teraz a deň od východu po západ', () => {
    const i = input(at('13:00'));
    const n = dnesNeboModel(i, null);
    assert.ok(n);
    const hero = heroModel({ ...i, previewMinutes: null });
    assert.equal(n.druh, 'teraz');
    assert.equal(n.kw, fmt1(hero.power));
    assert.equal(n.slovo, 'Teraz');
    assert.equal(hero.source, 'live');
    assert.equal(n.cas, '13:00');
    assert.equal(n.veta, `Teraz 13:00, ${fmt1(hero.power)} kW`);
    assert.deepEqual(n.pocasie, pocasieTeraz({ ...i, previewMinutes: null }, HVIEZDY.dnes));
    const { rise, set } = sunTimes(SITE, localDateKey(i.now, SITE.timezone));
    assert.ok(rise !== null && set !== null);
    assert.equal(n.os.vychod, hm(rise));
    assert.equal(n.os.zapad, hm(set));
    assert.equal(n.os.min, min('13:00'));
    assert.equal(n.os.bezec, n.os.teraz);
    assert.equal(n.os.zvolene, false);
    assert.ok(n.os.den.od > 20 && n.os.den.od < n.os.den.do && n.os.den.do < 90);
    assert.ok(n.slnko && n.slnko.f > 0.4 && n.slnko.f < 0.7 && n.slnko.h > 0.9, JSON.stringify(n.slnko));
});

test('iný čas: dozadu namerané, dopredu predpoveď, bežec v ňom a teraz ostáva na mieste', () => {
    const i = input(at('13:00'));
    const rano = dnesNeboModel(i, min('09:00'));
    assert.ok(rano);
    assert.equal(rano.druh, 'namerane');
    assert.equal(rano.slovo, 'Namerané');
    assert.equal(rano.cas, '09:00');
    assert.equal(rano.kw, fmt1(heroModel({ ...i, previewMinutes: min('09:00') }).power));
    assert.equal(rano.os.zvolene, true);
    assert.equal(rano.os.bezec, 37.5);
    assert.equal(rano.os.teraz, Math.round((min('13:00') / 1440) * 1000) / 10);
    const poobede = dnesNeboModel(i, min('16:00'));
    assert.equal(poobede?.druh, 'predpoved');
    assert.equal(poobede?.slovo, 'Predpoveď');
    assert.equal(poobede?.veta, `Predpoveď 16:00, ${fmt1(heroModel({ ...i, previewMinutes: min('16:00') }).power)} kW`);
    // V noci slnko nie je.
    const noc = dnesNeboModel(i, min('23:00'));
    assert.equal(noc?.slnko, null);
    assert.equal(noc?.pocasie?.noc, true);
    // Hviezdy a Mesiac sú v poli karty Dnes: obzor na čiare posuvníka, hore zenit.
    assert.equal(noc?.pocasie?.pole, HVIEZDY.dnes);
});

test('typická strecha je odhad s vlnovkou; bez polohy a bez predpovede nič', () => {
    const n = dnesNeboModel(input(at('13:00'), { known: 'poloha', pv: null, zdroj: null }), null);
    assert.match(n?.kw ?? '', /^~\d/);
    // Odhad sa na rozdiel od živého merania píše aj slovami.
    assert.equal(n?.cas, `13:00 · ${terazSourceText('forecast')}`);
    assert.equal(dnesNeboModel(input(at('13:00'), { known: 'nic' }), null), null);
    assert.equal(dnesNeboModel(input(at('13:00'), { forecast: null }), null), null);
});

test('polárny deň bez východu a západu: svetlo dňa bez časov', () => {
    const arctic = { ...SITE, lat: 78.2, lon: 15.6, timezone: 'Arctic/Longyearbyen' };
    const n = dnesNeboModel(input(new Date('2026-06-21T10:00:00Z'), { site: arctic }), null);
    assert.ok(n);
    assert.equal(n.os.vychod, '');
    assert.equal(n.os.zapad, '');
    assert.deepEqual(n.os.den, { od: 0, do: 100 });
});

test('posuvník: miesto na krok minút, kraje dňa a blízko teraz prilepené na teraz', () => {
    const teraz = min('13:00');
    assert.equal(dnesOsMinuta(0.5, teraz), 720);
    assert.equal(dnesOsMinuta(-0.2, teraz), 0);
    assert.equal(dnesOsMinuta(1, teraz), 1440 - DNES_OS.krokMin);
    assert.equal(dnesOsMinuta(0.3751, teraz), 540);
    assert.equal(dnesOsMinuta((teraz + DNES_OS.prilepMin) / 1440, teraz), null);
    assert.equal(dnesOsMinuta((teraz - DNES_OS.prilepMin - DNES_OS.krokMin) / 1440, teraz), teraz - DNES_OS.prilepMin - DNES_OS.krokMin);
});
