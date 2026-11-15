// Karta Teraz a bojler na prebytky: smer toku, dlaždica a panel Bojler dnes (shared/teraz-bojler.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SITE } from '../shared/config.js';
import { bojlerDetail, bojlerDlazdica, bojlerRiadeny, tokSiete } from '../shared/teraz-bojler.js';

const NOW = new Date('2026-11-15T13:00:00Z'); // 14:00 SEČ
const MIN = 60000;
const TZ = SITE.timezone;
const PRAHY = { zapKw: 2.3, vypKw: 2 };
/** Dva behy: prvý zo slnka, druhý beží od 12:30 a časť bola zo siete. */
const DEN = {
    den: '2026-11-15',
    behy: [
        { od: 640, do: 685, wh: 1650, whSiet: 0, e0: 1000, hrejeMin: 45 },
        { od: 750, do: null, wh: 2200, whSiet: 220, e0: 2650, hrejeMin: 60 },
    ],
    hotovo: null,
    posledneAt: NOW.getTime() - MIN,
};
const info = (/** @type {object} */ o = {}) => ({
    kontaktAt: NOW.getTime() - MIN,
    rele: true,
    w: 2210,
    prebytokKw: 2.6,
    prahy: PRAHY,
    den: DEN,
    ...o,
});

test('smer toku: do siete, zo siete, okolo nuly a bez elektromera nič', () => {
    assert.deepEqual(tokSiete(0.4), { smer: 'von', text: '↑ do siete 0,4 kW' });
    assert.deepEqual(tokSiete(-1.409), { smer: 'dnu', text: '↓ zo siete 1,4 kW' });
    assert.equal(tokSiete(0.02), null);
    assert.equal(tokSiete(null), null);
    assert.equal(tokSiete(undefined), null);
});

test('riadi zásuvka: len keď sa ozvala za posledný deň', () => {
    assert.equal(bojlerRiadeny(null, NOW), false);
    assert.equal(bojlerRiadeny(info(), NOW), true);
    assert.equal(bojlerRiadeny(info({ kontaktAt: NOW.getTime() - 25 * 60 * MIN }), NOW), false);
});

test('dlaždica: hreje zo slnka, hreje so sieťou, čaká, nahriata, mlčí', () => {
    assert.deepEqual(bojlerDlazdica(info(), NOW, TZ), {
        tone: 'go',
        riadi: 'bezi',
        velky: '2,2 kW',
        meno: 'Hreje zo slnka',
        sub: 'prebytok 2,6 kW · od 12:30',
    });
    const oblak = bojlerDlazdica(info({ prebytokKw: 1.2, den: null }), NOW, TZ);
    assert.deepEqual([oblak.tone, oblak.meno, oblak.sub], ['next', 'Hreje', 'prebytok 1,2 kW']);
    assert.deepEqual(bojlerDlazdica(info({ rele: false, w: 0, prebytokKw: -0.4 }), NOW, TZ), {
        tone: 'next',
        riadi: 'caka',
        velky: '0,0 kW',
        meno: 'Čaká na slnko',
        sub: 'prebytok teraz · zapne od 2,3',
    });
    assert.equal(bojlerDlazdica(info({ rele: false, prebytokKw: null }), NOW, TZ).velky, '–');
    const hotovo = bojlerDlazdica(info({ w: 3, den: { ...DEN, hotovo: 835 } }), NOW, TZ);
    assert.deepEqual([hotovo.tone, hotovo.velky, hotovo.sub], ['tiche', '3,6 kWh', 'dnes zo slnka · hotovo 13:55']);
    // Záznam zo včera sa nepočíta.
    const vcera = bojlerDlazdica(info({ w: 3, den: { ...DEN, den: '2026-11-14' } }), NOW, TZ);
    assert.deepEqual([vcera.velky, vcera.sub], ['0,0 kWh', 'dnes zo slnka']);
    assert.deepEqual(bojlerDlazdica(info({ kontaktAt: NOW.getTime() - 18 * MIN }), NOW, TZ), {
        tone: 'chyba',
        riadi: 'mlci',
        velky: '18 min',
        meno: 'Zásuvka mlčí',
        sub: 'bez spojenia so zásuvkou',
    });
    assert.equal(bojlerDlazdica(info({ kontaktAt: NOW.getTime() - 130 * MIN }), NOW, TZ).velky, '2 h');
});

test('panel Bojler dnes: pás, čísla a behy', () => {
    const d = bojlerDetail(info(), NOW, TZ);
    assert.equal(d.nadpis, 'Bojler dnes');
    assert.equal(d.pod, 'hreje od 12:30');
    assert.deepEqual(
        d.cisla.map((c) => c.v),
        ['2×', '1 h 45 min', '3,6 kWh', '0,2 kWh'],
    );
    assert.deepEqual(d.behy, [
        { cas: '10:40 – 11:25', tone: 'slnko', info: 'zo slnka' },
        { cas: '12:30 – teraz', tone: 'siet', info: '0,2 kWh zo siete' },
    ]);
    // Pás 6-18 h: prvý beh celý zo slnka, druhý zo slnka a na konci 10 % zo siete; teraz 14:00.
    assert.equal(d.pas.teraz, 66.67);
    assert.deepEqual(
        d.pas.useky.map((u) => u.tone),
        ['slnko', 'slnko', 'siet'],
    );
    assert.deepEqual(d.pas.useky[0], { left: 38.89, width: 6.25, tone: 'slnko' });
    assert.deepEqual(
        d.pas.ticks.map((t) => t.label),
        ['6', '9', '12', '15', '18'],
    );
});

test('panel: nahriata voda, mlčiaca zásuvka a deň bez behov', () => {
    const hotovo = bojlerDetail(info({ w: 2, den: { ...DEN, hotovo: 835 } }), NOW, TZ);
    assert.equal(hotovo.pod, 'voda nahriata o 13:55');
    assert.equal(hotovo.behy[1].info, '0,2 kWh zo siete · nahriata 13:55');
    assert.deepEqual(hotovo.pas.useky.at(-1)?.tone, 'hotovo');
    assert.equal(bojlerDetail(info({ kontaktAt: NOW.getTime() - 20 * MIN }), NOW, TZ).pod, 'zásuvka sa neozvala od 13:40');
    const vcera = bojlerDetail(info({ kontaktAt: NOW.getTime() - 22 * 60 * MIN }), NOW, TZ);
    assert.equal(vcera.pod, 'zásuvka sa neozvala od 14. 11. 16:00');
    const caka = bojlerDetail(info({ rele: false, w: 0, den: { ...DEN, behy: [DEN.behy[0]] } }), NOW, TZ);
    assert.equal(caka.pod, 'čaká na prebytok');
    const nic = bojlerDetail(info({ rele: false, w: 0, den: null }), NOW, TZ);
    assert.deepEqual([nic.pod, nic.behy, nic.cisla[0].v, nic.cisla[1].v], ['dnes ešte nehrial', [], '0×', '0 min']);
    const noc = bojlerDetail(info({ den: null }), new Date('2026-11-15T20:00:00Z'), TZ);
    assert.equal(noc.pas.teraz, null);
});
