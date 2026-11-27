import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARBON, PLANT, SITE, TARIFF } from '../shared/config.js';
import { solarG } from '../shared/carbon.js';
import { BUBLINY, dnesBublina } from '../shared/dnes-bubliny.js';
import { dnesFaza } from '../shared/dnes-faza.js';
import { akoKebyAko, DNES_BUBLINY, DNES_TEXTS, dnesBublinaTitle } from '../shared/messages.js';
import { mozemSkyModel } from '../shared/mozem-sky.js';
import { sunTimes } from '../shared/solar.js';
import { fixtureData, pvAt } from './helpers.js';

/** Miestny čas 5. 9. 2026 v Bratislave (letný čas). @param {string} hm */
const at = (hm) => new Date(`2026-09-05T${hm}:00+02:00`);

/** Vstup karty: Dvorany s kioskom a fixtures v danej chvíli. @param {Date} now @param {object} [extra] */
function input(now, extra = {}) {
    const { forecast } = fixtureData(now);
    return /** @type {Parameters<typeof dnesFaza>[0] & { loading: boolean, known: 'elektraren' }} */ ({
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
    });
}

/** Bublina tak, ako ju skladá appka (render/mozem.js). @param {import('../shared/dnes-bubliny.js').Bublina} kind @param {ReturnType<typeof input>} i */
function bublina(kind, i) {
    const sky = mozemSkyModel(i);
    const d = dnesFaza(i, sky.den, sky.window);
    return { sky, d, b: dnesBublina(kind, i, sky, d) };
}

test('bublina Veľké veci: okno na osi, teraz a veci z Plánu dňa; večer nie je', () => {
    const i = input(at('13:00'));
    const { sky, b } = bublina('velke', i);
    assert.ok(b?.kind === 'velke' && sky.window && sky.plan);
    assert.deepEqual(b.okno, { od: sky.window.from, do: sky.window.to });
    assert.equal(b.nowMin, 13 * 60);
    assert.equal(b.q, DNES_TEXTS.velke);
    assert.equal(b.title, dnesBublinaTitle({ kind: 'velke', okno: b.okno, stav: 'go' }));
    assert.match(b.title, /^Slnko na veľké veci do \d\d:\d\d$/);
    assert.deepEqual(b.den, sunTimes(SITE, '2026-09-05'));
    const dnes = sky.plan.rows.filter((r) => r.kind === 'sun' || r.kind === 'siet' || r.kind === 'cheap');
    assert.deepEqual(
        b.veci.map((v) => v.id),
        dnes.map((r) => r.id),
    );
    assert.ok(b.veci.length > 0 && b.veci.every((v) => /^\d\d:\d\d$/.test(v.cas)));
    assert.equal(b.pozn, DNES_BUBLINY.planDna);
    // Ráno pred oknom: od - do.
    const rano = bublina('velke', input(at('05:30'))).b;
    assert.ok(rano?.kind === 'velke' && rano.okno);
    assert.match(rano.title, /^Okno na veľké veci \d\d:\d\d – \d\d:\d\d$/);
    assert.equal(bublina('velke', input(at('20:30'))).b, null);
});

test('nadpis Veľkých vecí bez okna a po ňom', () => {
    assert.equal(dnesBublinaTitle({ kind: 'velke', okno: null, stav: 'koniec' }), 'Dnes bez okna na veľké veci');
    assert.equal(dnesBublinaTitle({ kind: 'velke', okno: { od: 540, do: 1050 }, stav: 'koniec' }), 'Okno na veľké veci 09:00 – 17:30');
});

test('bublina Zo strechy: cez deň nabehlo a ešte príde s čiarou teraz, večer namerané a predpoveď', () => {
    const i = input(at('13:00'));
    const { sky, b } = bublina('strecha', i);
    assert.ok(b?.kind === 'strecha' && sky.day && i.pv && i.forecast);
    assert.equal(b.title, `${sky.day.value} za celý deň`);
    assert.deepEqual(
        b.cisla.map((c) => c.label),
        [DNES_BUBLINY.nabehlo, DNES_BUBLINY.ePride],
    );
    assert.equal(b.cisla[0].value, i.pv.dailyEnergyKwh?.toFixed(1).replace('.', ','));
    assert.equal(b.nowMin, 13 * 60);
    assert.equal(b.predpoved.length, i.forecast.hourlyToday.length);
    assert.equal(b.namerane.length, i.pv.realCurveToday.length);
    const v = bublina('strecha', input(at('20:30')));
    assert.ok(v.b?.kind === 'strecha' && v.d?.grade);
    assert.equal(v.b.title, `Dnes nabehlo ${v.d.grade}`);
    assert.equal(v.b.nowMin, null);
    assert.deepEqual(
        v.b.cisla.map((c) => c.label),
        [DNES_BUBLINY.predpoved],
    );
});

test('bublina Ako keby: tie isté čísla ako pole a z čoho sa rátajú', () => {
    const { sky, b } = bublina('eq', input(at('13:00')));
    assert.ok(b?.kind === 'eq' && sky.day);
    assert.equal(b.title, `${sky.day.value} zo strechy je ako`);
    assert.deepEqual(
        b.riadky.map((r) => r.value),
        sky.day.eq.map((e) => e.value),
    );
    assert.equal(b.riadky[0].ako, 'jedno nabitie je asi 15 Wh');
    assert.equal(b.riadky[1].ako, 'elektrické auto prejde asi 6 km na kWh');
    assert.equal(
        b.riadky[2].ako,
        `sieť SR má asi ${CARBON.gridG} g CO2 na kWh (${CARBON.gridSource}), panely asi ${Math.round(solarG())} g`,
    );
    assert.equal(akoKebyAko('nic', { gridG: 1, solarG: 1, zdroj: '' }), '');
});

test('bublina Predpoveď: šesť hodín medzi východom a západom s ikonou a teplotou; večer zajtrajšok', () => {
    const i = input(at('13:00'));
    const { d, b } = bublina('predpoved', i);
    const k = d?.karty.find((x) => x.kind === 'predpoved');
    assert.ok(b?.kind === 'predpoved' && k?.kind === 'predpoved');
    assert.equal(b.q, DNES_TEXTS.predpoved);
    assert.equal(b.title, `${k.popis}, ${k.min} až ${k.max}`);
    const { rise, set } = sunTimes(SITE, '2026-09-05');
    assert.ok(rise !== null && set !== null);
    assert.equal(b.hodiny.length, 6);
    assert.ok(b.hodiny.every((h) => h.hour * 60 >= rise && h.hour * 60 <= set));
    assert.ok(b.hodiny.every((h) => /^-?\d+°$/.test(h.temp ?? '')));
    assert.ok(b.hodiny.every((h) => h.weather));
    const v = bublina('predpoved', input(at('20:30'))).b;
    assert.ok(v?.kind === 'predpoved');
    assert.equal(v.q, DNES_TEXTS.predpovedZajtra);
});

test('bublina Predpoveď: zrážky slovom, hodina bez teploty (staršia predpoveď) bez čísla', () => {
    const i = input(at('13:00'));
    assert.ok(i.forecast);
    const days = i.forecast.days.map((d, n) =>
        n === 0
            ? { ...d, hourly: d.hourly.map((h) => ({ ...h, temp: undefined, precip: /** @type {const} */ ('dazd'), cloud: null })) }
            : d,
    );
    const { b } = bublina('predpoved', { ...i, forecast: { ...i.forecast, days } });
    assert.ok(b?.kind === 'predpoved');
    assert.ok(b.hodiny.every((h) => h.temp === null && h.weather === null && h.zrazky === DNES_BUBLINY.zrazky.dazd));
    assert.equal(b.pozn, '');
});

test('bublina Oblačnosť: hodiny dňa a najviac oblakov v nadpise', () => {
    const i = input(at('13:00'));
    const { b } = bublina('oblacnost', i);
    assert.ok(b?.kind === 'oblacnost' && i.forecast);
    const day = i.forecast.days[0];
    const max = b.hodiny.reduce((a, h) => (h.pct > a.pct ? h : a));
    assert.equal(b.title, dnesBublinaTitle({ kind: 'oblacnost', priemer: /** @type {number} */ (day.cloudAvgPct), max }));
    assert.ok(b.hodiny.length >= 10);
    assert.equal(dnesBublinaTitle({ kind: 'oblacnost', priemer: 40, max: { pct: 40, hour: 9 } }), 'Priemerne 40 %');
    const bez = { ...i, forecast: { ...i.forecast, days: i.forecast.days.map((d) => ({ ...d, cloudAvgPct: null })) } };
    assert.equal(dnesBublina('oblacnost', bez, mozemSkyModel(bez), dnesFaza(bez, mozemSkyModel(bez).den, null)), null);
});

test('bublina Najviac slnka: tie isté hodiny ako stĺpce poľa, s kW', () => {
    const { d, b } = bublina('slnko', input(at('13:00')));
    const k = d?.karty.find((x) => x.kind === 'slnko');
    assert.ok(b?.kind === 'slnko' && k?.kind === 'slnko');
    assert.equal(b.title, `${k.value}, ${k.text}`);
    assert.deepEqual(
        b.stlpce.map((s) => [s.hour, s.max, s.preslo]),
        k.stlpce.map((s) => [s.hour, s.max, s.preslo]),
    );
    const top = b.stlpce.find((s) => s.max);
    assert.ok(top && b.stlpce.every((s) => s.kw <= top.kw));
    assert.equal(bublina('slnko', input(at('20:30'))).b, null, 'večer pole nie je');
});

test('bublina Kedy lepšie: dni predpovede a najsilnejší v nadpise', () => {
    const i = input(at('13:00'));
    const { b } = bublina('lepsie', i);
    assert.ok(b?.kind === 'lepsie' && i.forecast);
    assert.equal(b.dni.length, i.forecast.days.length);
    assert.equal(b.dni[0].name, 'Dnes');
    assert.equal(b.dni.filter((x) => x.max).length, 1);
    const best = b.dni.findIndex((x) => x.max);
    assert.ok(b.title.startsWith(`Najviac dá ${best === 0 ? 'dnešok' : best === 1 ? 'zajtrajšok' : ''}`));
    // Najsilnejší dnešok a zajtrajšok.
    const days = i.forecast.days;
    const s = (/** @type {number} */ n) => ({
        ...i,
        forecast: { ...i.forecast, days: days.map((d, k) => ({ ...d, kwhTotal: k === n ? 999 : 1 })) },
    });
    assert.match(bublina('lepsie', s(0)).b?.title ?? '', /^Najviac dá dnešok, ~999 kWh$/);
    assert.match(bublina('lepsie', s(1)).b?.title ?? '', /^Najviac dá zajtrajšok/);
});

test('bublina bez časti dňa či predpovede nie je; každé pole má model', () => {
    const i = input(at('13:00'));
    const sky = mozemSkyModel(i);
    assert.equal(dnesBublina('velke', i, sky, null), null);
    assert.equal(dnesBublina('lepsie', { ...i, forecast: null }, sky, dnesFaza(i, sky.den, sky.window)), null);
    const d = dnesFaza(i, sky.den, sky.window);
    for (const k of BUBLINY) assert.ok(dnesBublina(k, i, sky, d), k);
});
