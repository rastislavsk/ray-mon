// Karta Teraz a bojler na prebytky: smer toku, dlaždica a panel Bojler dnes (shared/teraz-bojler.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SITE } from '../shared/config.js';
import { bojlerDetail, bojlerDlazdica, bojlerRiadeny, TERAZ_BOJLER_TEXTS, tokDetail, tokSiete } from '../shared/teraz-bojler.js';

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
    rucne: false,
    ...o,
});

test('smer toku: do siete, zo siete, okolo nuly a bez elektromera nič', () => {
    assert.deepEqual(tokSiete(0.4), { smer: 'von', kw: '0,4 kW', slovo: 'do siete' });
    assert.deepEqual(tokSiete(-1.409), { smer: 'dnu', kw: '1,4 kW', slovo: 'zo siete' });
    assert.equal(tokSiete(0.02), null);
    assert.equal(tokSiete(null), null);
    assert.equal(tokSiete(undefined), null);
});

test('panel Elektrina teraz: panely, dom a sieť, bodky rýchlejšie pri väčšom toku', () => {
    const at = NOW.getTime() - 2 * MIN;
    /** @param {number | null} vyrobaKw @param {number} sietKw */
    const detail = (vyrobaKw, sietKw) =>
        /** @type {NonNullable<ReturnType<typeof tokDetail>>} */ (tokDetail({ vyrobaKw, sietKw, meraneAt: at }, NOW, TZ));
    const von = detail(6.4, 2.4);
    assert.deepEqual(
        von.uzly.map((u) => [u.id, u.kw, u.l]),
        [
            ['slnko', '6,4 kW', 'panely'],
            ['dom', '4,0 kW', 'dom'],
            ['stlp', '2,4 kW', 'do siete'],
        ],
    );
    assert.equal(von.smer, 'von');
    assert.equal(von.popis, 'panely 6,4 kW, dom 4,0 kW, do siete 2,4 kW');
    assert.equal(von.pod, 'meranie elektromera o 13:58');
    // Odber: dom berie zo slnka aj zo siete.
    const dnu = detail(0.8, -1.2);
    assert.deepEqual([dnu.smer, dnu.uzly[1].kw, dnu.uzly[2].l], ['dnu', '2,0 kW', 'zo siete']);
    assert.ok(von.krokSiet < dnu.krokSiet, '2,4 kW tečie rýchlejšie ako 1,2 kW');
    assert.equal(detail(20, 15).krokSiet, 0.35, 'najrýchlejšie');
    // V noci po prvom vedení nič netečie, výroba bez údaja je nula.
    const noc = detail(null, -0.3);
    assert.deepEqual([noc.krokSlnko, noc.uzly[0].kw, noc.uzly[1].kw], [null, '0,0 kW', '0,3 kW']);
    assert.equal(tokDetail({ vyrobaKw: 3, sietKw: 0.01, meraneAt: at }, NOW, TZ), null);
    assert.equal(tokDetail({ vyrobaKw: 3, sietKw: null, meraneAt: at }, NOW, TZ), null);
});

test('riadi zásuvka: len keď sa ozvala za posledný deň', () => {
    assert.equal(bojlerRiadeny(null, NOW), false);
    assert.equal(bojlerRiadeny(info(), NOW), true);
    assert.equal(bojlerRiadeny(info({ kontaktAt: NOW.getTime() - 25 * 60 * MIN }), NOW), false);
});

test('dlaždica: hreje zo slnka, hreje so sieťou, čaká, nahriata, mlčí - meno Bojler a odrážky', () => {
    assert.deepEqual(bojlerDlazdica(info(), NOW, TZ), {
        tone: 'go',
        riadi: 'bezi',
        rezim: 'appka',
        velky: '2,2 kW',
        meno: 'Bojler',
        odr: ['hreje zo slnka', 'od 12:30'],
        podiel: 94,
    });
    const oblak = bojlerDlazdica(info({ prebytokKw: 1.2, den: null }), NOW, TZ);
    assert.deepEqual([oblak.tone, oblak.odr], ['next', ['hreje aj zo siete']]);
    // Pásik: koľko dnes išlo zo slnka; kým dnes nehrial, je prázdny.
    assert.equal(oblak.podiel, null);
    // Veľké číslo je odber bojlera, prebytok, pri ktorom zapne, je v odrážke.
    assert.deepEqual(bojlerDlazdica(info({ rele: false, w: 0, prebytokKw: -0.4 }), NOW, TZ), {
        tone: 'next',
        riadi: 'caka',
        rezim: 'appka',
        velky: '0 kW',
        meno: 'Bojler',
        odr: ['čaká na slnko', 'zapne pri 2,3 kW'],
        podiel: 94,
    });
    const hotovo = bojlerDlazdica(info({ w: 3, den: { ...DEN, hotovo: 835 } }), NOW, TZ);
    assert.deepEqual([hotovo.tone, hotovo.velky, hotovo.odr], ['tiche', '3,6 kWh', ['nahriata o 13:55', 'dnes zo slnka']]);
    // Záznam zo včera sa nepočíta.
    const vcera = bojlerDlazdica(info({ w: 3, den: { ...DEN, den: '2026-11-14' } }), NOW, TZ);
    assert.deepEqual([vcera.velky, vcera.odr], ['0,0 kWh', ['nahriata', 'dnes zo slnka']]);
    // Tichá zásuvka: režim nevieme, značka v rohu nie je.
    assert.deepEqual(bojlerDlazdica(info({ kontaktAt: NOW.getTime() - 18 * MIN }), NOW, TZ), {
        tone: 'chyba',
        riadi: 'mlci',
        rezim: null,
        velky: '18 min',
        meno: 'Bojler',
        odr: ['zásuvka mlčí', 'skript alebo Wi-Fi'],
        podiel: 94,
    });
    assert.equal(bojlerDlazdica(info({ kontaktAt: NOW.getTime() - 130 * MIN }), NOW, TZ).velky, '2 h');
});

test('ručný režim: dlaždica na skle bez rady so značkou ručne - hreje, voda nahriata, vypnutý; mlčí ako vždy', () => {
    const rucne = (/** @type {object} */ o = {}) => bojlerDlazdica(info({ rucne: true, ...o }), NOW, TZ);
    assert.deepEqual(rucne(), {
        tone: 'tiche',
        riadi: 'bezi',
        rezim: 'rucne',
        velky: '2,2 kW',
        meno: 'Bojler',
        odr: ['hreje', 'od 12:30'],
        podiel: 94,
    });
    assert.deepEqual(rucne({ den: null }).odr, ['hreje']);
    // Termostat vypol: veľké číslo je odber teraz, dnešné kWh spolu (zo slnka aj zo siete) v odrážke.
    assert.deepEqual(rucne({ w: 3 }), {
        tone: 'tiche',
        riadi: 'caka',
        rezim: 'rucne',
        velky: '0,0 kW',
        meno: 'Bojler',
        odr: ['nahriata', 'dnes 3,9 kWh'],
        podiel: 94,
    });
    assert.deepEqual(rucne({ w: 3, den: null }).odr, ['nahriata', 'dnes 0,0 kWh']);
    const vyp = { rele: false, w: 0, den: { ...DEN, behy: [DEN.behy[0]] } };
    assert.deepEqual(rucne(vyp), {
        tone: 'tiche',
        riadi: 'vyp',
        rezim: 'rucne',
        velky: '0 kW',
        meno: 'Bojler',
        odr: ['vypnutý', 'od 11:25'],
        podiel: 100,
    });
    assert.deepEqual(rucne({ rele: false, w: 0, den: null }).odr, ['vypnutý']);
    const ticho = rucne({ kontaktAt: NOW.getTime() - 18 * MIN });
    assert.deepEqual([ticho.rezim, ticho.odr[0]], [null, 'zásuvka mlčí']);
});

test('ručný režim v paneli: riadok pod nadpisom a prepínač s popisom', () => {
    const auto = bojlerDetail(info(), NOW, TZ);
    assert.deepEqual(auto.rezim, { rucne: false, popis: 'Zapne pri prebytku od 2,3 kW, vypne pod 2,0 kW.' });
    const r = bojlerDetail(info({ rucne: true }), NOW, TZ);
    assert.equal(r.pod, 'ručne · hreje od 12:30');
    assert.equal(r.rezim.rucne, true);
    assert.match(r.rezim.popis, /appke Shelly/);
    assert.deepEqual(
        [TERAZ_BOJLER_TEXTS.rezim.ulozene(true), TERAZ_BOJLER_TEXTS.rezim.ulozene(false)],
        ['Uložené · zapínaš ručne', 'Uložené · riadi appka'],
    );
    const vyp = bojlerDetail(info({ rucne: true, rele: false, w: 0, den: { ...DEN, behy: [DEN.behy[0]] } }), NOW, TZ);
    assert.equal(vyp.pod, 'ručne · vypnutý od 11:25');
    assert.equal(bojlerDetail(info({ rucne: true, rele: false, w: 0, den: null }), NOW, TZ).pod, 'ručne · vypnutý');
    assert.equal(bojlerDetail(info({ rucne: true, den: null }), NOW, TZ).pod, 'ručne · hreje');
    assert.equal(bojlerDetail(info({ den: null }), NOW, TZ).pod, 'hreje');
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
        { cas: '10:40 – 11:25', slnko: '1,6 kWh', siet: '0,0 kWh' },
        { cas: '12:30 – teraz', slnko: '2,0 kWh', siet: '0,2 kWh' },
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
    // Relé ostalo zapnuté, beh je otvorený: koniec je čas nahriatia, nie „teraz“.
    assert.equal(hotovo.behy[1].cas, '12:30 – 13:55');
    assert.equal(bojlerDetail(info({ w: 2 }), NOW, TZ).behy[1].cas, '12:30 – teraz', 'nahriatie bez času v zázname');
    assert.deepEqual(hotovo.pas.useky.at(-1)?.tone, 'hotovo');
    const mlci = bojlerDetail(info({ kontaktAt: NOW.getTime() - 20 * MIN }), NOW, TZ);
    assert.deepEqual([mlci.pod, mlci.behy[1].cas], ['zásuvka sa neozýva od 13:40', '12:30 – 13:40']);
    const vcera = bojlerDetail(info({ kontaktAt: NOW.getTime() - 22 * 60 * MIN }), NOW, TZ);
    assert.equal(vcera.pod, 'zásuvka sa neozýva od 14. 11. 16:00');
    const caka = bojlerDetail(info({ rele: false, w: 0, den: { ...DEN, behy: [DEN.behy[0]] } }), NOW, TZ);
    assert.equal(caka.pod, 'čaká na prebytok');
    const nic = bojlerDetail(info({ rele: false, w: 0, den: null }), NOW, TZ);
    assert.deepEqual([nic.pod, nic.behy, nic.cisla[0].v, nic.cisla[1].v], ['dnes ešte nehrial', [], '0×', '0 min']);
    const noc = bojlerDetail(info({ den: null }), new Date('2026-11-15T20:00:00Z'), TZ);
    assert.equal(noc.pas.teraz, null);
});
