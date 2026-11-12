import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_DNA, PLANT, SITE, TARIFF } from '../shared/config.js';
import { vyhladNoticeText } from '../shared/messages.js';
import { planNotice, swNotice } from '../shared/oznamenia.js';
import { dniVyhladu, prvyBeh, vyhladOznamenia, vyhladZmena } from '../shared/vyhlad.js';
import { fixture, fixtureData } from './helpers.js';

const DEVICES = [...PLAN_DNA.devices];
/** Miestny čas 5. 9. 2026 (sobota) v Bratislave. @param {string} hm */
const at = (hm) => new Date(`2026-09-05T${hm}:00+02:00`);
const RANO = at('09:00');

/**
 * Predpoveď z fixtures, v ktorej sú dané dni zamračené (výroba stiahnutá na 5 %).
 * @param {string[]} zamracene dátumy @param {Date} [now]
 */
function predpoved(zamracene, now = RANO) {
    const f = fixtureData(now).forecast;
    if (!f) throw new Error('fixtures nemajú predpoveď');
    const k = (/** @type {string} */ date) => (zamracene.includes(date) ? 0.05 : 1);
    return {
        ...f,
        // Dnešok plán dňa berie z hodín dneška, ďalšie dni z `days`.
        hourlyToday: f.hourlyToday.map((p) => ({ ...p, kw: p.kw * k(f.days[0].date) })),
        days: f.days.map((d) => ({
            ...d,
            hourly: d.hourly.map((p) => ({ ...p, kw: p.kw * k(d.date) })),
            peakKw: d.peakKw * k(d.date),
            kwhTotal: d.kwhTotal * k(d.date),
        })),
    };
}
/** Vstup ako v service workeri. @param {string[]} zamracene @param {Date} [now] */
const input = (zamracene, now = RANO) => ({ now, site: SITE, plant: PLANT, tariff: TARIFF, pv: null, forecast: predpoved(zamracene, now) });

/** Deň v zozname dní výhľadu. @param {string} name @param {number} index @param {boolean} slnko */
const den = (name, index, slnko) => ({ name, date: `2026-09-${String(5 + index).padStart(2, '0')}`, index, slnko });

test('dniVyhladu: dnes so slnkom, zamračené dni bez neho; bez spotrebičov alebo predpovede nič', () => {
    const v = dniVyhladu(input(['2026-09-07', '2026-09-08']), DEVICES);
    assert.equal(v.dnes, true);
    assert.deepEqual(
        v.dni.slice(0, 4).map((d) => [d.name, d.index, d.slnko]),
        [
            ['Zajtra', 1, true],
            ['Pondelok', 2, false],
            ['Utorok', 3, false],
            ['Streda', 4, true],
        ],
    );
    assert.deepEqual(dniVyhladu(input([]), []), { dnes: false, dni: [] });
    assert.deepEqual(dniVyhladu({ ...input([]), forecast: null }, DEVICES), { dnes: false, dni: [] });
});

test('prvyBeh: prvé dni bez slnka za sebou a deň pred nimi', () => {
    assert.equal(prvyBeh([den('Zajtra', 1, true)]), null);
    assert.deepEqual(prvyBeh([den('Zajtra', 1, false), den('Pondelok', 2, true)]), {
        name: 'Zajtra',
        date: '2026-09-06',
        index: 1,
        pocet: 1,
        pred: null,
    });
    const b = prvyBeh([den('Zajtra', 1, true), den('Pondelok', 2, false), den('Utorok', 3, false)]);
    assert.deepEqual([b?.name, b?.pocet, b?.pred], ['Pondelok', 2, 'Zajtra'], 'koniec predpovede beh ukončí');
});

test('vyhladZmena: zmizli, neskôr, skôr, dlhšie, kratšie; starý alebo dnešný výhľad sa neporovnáva', () => {
    const beh = (/** @type {string} */ date, /** @type {number} */ pocet) => ({ name: 'X', date, index: 2, pocet, pred: 'Zajtra' });
    const posledny = { date: '2026-09-08', pocet: 2 };
    assert.equal(vyhladZmena(null, beh('2026-09-08', 2), '2026-09-05'), null);
    assert.equal(vyhladZmena(posledny, beh('2026-09-08', 2), '2026-09-05'), null);
    assert.equal(vyhladZmena(posledny, null, '2026-09-05'), 'zmizli');
    assert.equal(vyhladZmena(posledny, beh('2026-09-09', 1), '2026-09-05'), 'neskor');
    assert.equal(vyhladZmena(posledny, beh('2026-09-07', 3), '2026-09-05'), 'skor');
    assert.equal(vyhladZmena(posledny, beh('2026-09-08', 4), '2026-09-05'), 'dlhsie');
    assert.equal(vyhladZmena(posledny, beh('2026-09-08', 1), '2026-09-05'), 'kratsie');
    assert.equal(vyhladZmena(posledny, null, '2026-09-08'), null, 'deň už prišiel');
});

test('vyhladNoticeText: výstraha s radou podľa toho, či je doma práčka, a zmeny v oboch tónoch', () => {
    const zajtra = { name: 'Zajtra', date: '2026-09-06', index: 1, pocet: 1, pred: null };
    const stvrtok = { name: 'Štvrtok', date: '2026-09-10', index: 5, pocet: 4, pred: 'Streda' };
    const v = (/** @type {object} */ o) => vyhladNoticeText({ beh: zajtra, zmena: null, predtym: null, dnes: true, pracka: true, ...o });
    assert.deepEqual(v({}), { title: 'Zajtra slnko nebude – oper dnes', uvod: '' });
    assert.equal(
        vyhladNoticeText({ beh: zajtra, zmena: null, predtym: null, dnes: true, pracka: false }, 'slusny')?.title,
        'Zajtra slnko nebude – využite dnešok',
    );
    assert.deepEqual(v({ beh: { ...zajtra, pocet: 3 } }), { title: 'Od zajtra 3 dni bez slnka', uvod: 'Oper dnes.' });
    assert.deepEqual(v({ beh: stvrtok }), { title: 'Od štvrtka 4 dni bez slnka', uvod: 'Veľké pranie stihni do stredy.' });
    assert.equal(
        vyhladNoticeText({ beh: stvrtok, zmena: null, predtym: null, dnes: true, pracka: false }, 'slusny')?.uvod,
        'Veľké veci stihnite do stredy.',
    );
    assert.deepEqual(v({ beh: { ...stvrtok, pocet: 5 }, zmena: 'neskor', predtym: 'Streda' }), {
        title: 'Lepšie: streda predsa so slnkom',
        uvod: 'Od štvrtka 5 dní bez slnka. Veľké pranie stihni do stredy.',
    });
    assert.equal(v({ zmena: 'skor' })?.title, 'Horšie: zamračí sa už zajtra');
    assert.equal(v({ beh: stvrtok, zmena: 'skor' })?.title, 'Horšie: zamračí sa už vo štvrtok');
    assert.equal(v({ beh: stvrtok, zmena: 'dlhsie' })?.title, 'Horšie: bez slnka 4 dni');
    assert.equal(v({ zmena: 'kratsie', dnes: false })?.title, 'Lepšie: bez slnka len 1 deň');
    assert.equal(v({ zmena: 'kratsie', dnes: false })?.uvod, 'Zajtra slnko nebude.', 'dnes bez slnka bez rady');
    assert.deepEqual(v({ beh: null, zmena: 'zmizli' }), {
        title: 'Lepšie: zamračené dni zmizli',
        uvod: 'Predpoveď už dni bez slnka nečaká.',
    });
    assert.equal(v({ beh: null }), null);
});

test('vyhladOznamenia: upozorní o toľko dní vopred, koľko ich je bez slnka, najviac 3', () => {
    const v = (/** @type {string[]} */ z) => vyhladOznamenia(input(z), DEVICES, null);
    assert.equal(v(['2026-09-06']).text?.title, 'Zajtra slnko nebude – oper dnes');
    assert.deepEqual(v(['2026-09-06']).vyhlad, { date: '2026-09-06', pocet: 1 });
    // Jeden deň bez slnka pozajtra: ešte nie.
    assert.deepEqual(v(['2026-09-07']), { text: null, vyhlad: null });
    // Dva dni pozajtra: áno; tri dni o 3 dni: áno; dva dni o 3 dni: ešte nie.
    assert.equal(v(['2026-09-07', '2026-09-08']).text?.title, 'Od pondelka 2 dni bez slnka');
    assert.equal(v(['2026-09-08', '2026-09-09', '2026-09-10']).text?.title, 'Od utorka 3 dni bez slnka');
    assert.equal(v(['2026-09-08', '2026-09-09']).text, null);
    // Štyri dni o 4 dni: najviac 3 dni vopred.
    assert.equal(v(['2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12']).text, null);
    // Dnes bez slnka: výstraha nie (dnes niet čo presunúť).
    assert.equal(v(['2026-09-05', '2026-09-06']).text, null);
});

test('vyhladOznamenia: zmena oproti poslednému výhľadu, potom ticho, kým ten deň nepríde', () => {
    const posledny = { date: '2026-09-07', pocet: 2 };
    const lepsie = vyhladOznamenia(input(['2026-09-08']), DEVICES, posledny);
    assert.equal(lepsie.text?.title, 'Lepšie: pondelok predsa so slnkom');
    assert.equal(lepsie.text?.uvod, 'V utorok slnko nebude. Veľké pranie stihni do pondelka.');
    assert.deepEqual(lepsie.vyhlad, { date: '2026-09-08', pocet: 1 });
    const zmizli = vyhladOznamenia(input([]), DEVICES, posledny);
    assert.equal(zmizli.text?.title, 'Lepšie: zamračené dni zmizli');
    assert.equal(zmizli.vyhlad, null);
    // Ten istý výhľad, ktorý ešte nie je na rade: nič, ale pamätá si ho.
    const neskor = { date: '2026-09-09', pocet: 1 };
    assert.deepEqual(vyhladOznamenia(input(['2026-09-09']), DEVICES, neskor), { text: null, vyhlad: neskor });
    // Výhľad z minulosti sa zabudne.
    assert.deepEqual(vyhladOznamenia(input([]), DEVICES, { date: '2026-09-05', pocet: 1 }), { text: null, vyhlad: null });
});

test('ranné oznámenie: výhľad v nadpise, dnešok v texte; service worker vráti, čo si zapamätať', () => {
    const n = planNotice(input(['2026-09-06', '2026-09-07']), { devices: DEVICES });
    assert.equal(n.title, 'Od zajtra 2 dni bez slnka');
    assert.match(n.body, /^Oper dnes\. Dnes slnko do \d\d:\d\d\. Práčka /);
    assert.deepEqual(n.vyhlad, { date: '2026-09-06', pocet: 2 });
    const bez = planNotice(input([]), { devices: DEVICES });
    assert.match(bez.title, /^Dnes slnko/);
    assert.equal(bez.vyhlad, null);
    // Service worker: počasie z fixtures, zamračená nedeľa.
    const weather = structuredClone(fixture('open-meteo.json'));
    const keys = ['shortwave_radiation_instant', 'direct_normal_irradiance_instant', 'diffuse_radiation_instant'];
    for (const [i, t] of weather.hourly.time.entries()) if (t.startsWith('2026-09-06')) for (const k of keys) weather.hourly[k][i] *= 0.05;
    /** @type {import('../shared/oznamenia.js').Zrkadlo} */
    const z = { site: SITE, plant: PLANT, tariff: TARIFF, devices: DEVICES, voice: 'drzy', app: './', hour: 9 };
    const rano = swNotice(z, [], weather, RANO, null);
    assert.equal(rano.title, 'Zajtra slnko nebude – oper dnes');
    assert.deepEqual(rano.vyhlad, { date: '2026-09-06', pocet: 1 });
    const pripomienka = swNotice(z, [{ id: 'pracka', at: at('10:30').toISOString() }], weather, at('10:30'), rano.vyhlad);
    assert.equal(pripomienka.reminder, true);
    assert.deepEqual(pripomienka.vyhlad, rano.vyhlad, 'pripomienka výhľad nemení');
});
