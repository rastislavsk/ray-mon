// Karta Teraz a bojler na prebytky: smer toku, dlaždica a panel Bojler dnes (shared/teraz-bojler.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_DAYS, ALL_MONTHS, SITE, TARIFF } from '../shared/config.js';
import {
    bojlerDetail,
    bojlerDlazdica,
    bojlerDrahaDnes,
    bojlerRiadeny,
    TERAZ_BOJLER_TEXTS,
    tokDetail,
    tokSiete,
} from '../shared/teraz-bojler.js';

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

/** VT 13:00 - 14:00, inak NT. @type {import('../shared/config.js').Tariff} */
const VT = {
    ...TARIFF,
    schedules: [
        {
            days: ALL_DAYS,
            months: ALL_MONTHS,
            changes: [
                { from: '00:00', band: 'nt' },
                { from: '13:00', band: 'vt' },
                { from: '14:00', band: 'nt' },
            ],
        },
    ],
};

test('dlaždica Bojler: červená časť pásika - odber zo siete behov v drahom pásme, bez štvrťhodín rozložený na čas behu', () => {
    const vt = VT;
    // Druhý beh 12:30 - 14:00 (teraz) vzal zo siete 220 Wh, dve tretiny jeho času je VT: 147 Wh z 3850 Wh dňa.
    assert.equal(bojlerDrahaDnes(info(), NOW, TZ, vt), 4);
    assert.equal(bojlerDrahaDnes(info(), NOW, TZ, TARIFF), 0, 'cez deň NT');
    assert.equal(bojlerDrahaDnes(info({ den: null }), NOW, TZ, vt), 0, 'dnes nehrial');
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

test('Čo riadi bojler? (Shelly / Ray-mon): riadok pod nadpisom a prepínač s popisom', () => {
    const auto = bojlerDetail(info(), NOW, TZ);
    assert.deepEqual(auto.rezim, { rucne: false, popis: 'Zapne pri prebytku od 2,3 kW, vypne pod 2,0 kW.' });
    const r = bojlerDetail(info({ rucne: true }), NOW, TZ);
    // Kto bojler riadi, ukáže prepínač v tom istom paneli - riadok stavu to neopakuje.
    assert.equal(r.pod, 'Hreje od 12:30');
    assert.equal(r.rezim.rucne, true);
    assert.match(r.rezim.popis, /appke Shelly/);
    assert.deepEqual(
        [TERAZ_BOJLER_TEXTS.rezim.nazov, TERAZ_BOJLER_TEXTS.rezim.rucne, TERAZ_BOJLER_TEXTS.rezim.appka],
        ['Čo riadi bojler?', 'Shelly', 'Ray-mon'],
    );
    assert.deepEqual(
        [TERAZ_BOJLER_TEXTS.rezim.ulozene(true), TERAZ_BOJLER_TEXTS.rezim.ulozene(false)],
        ['Uložené · riadi Shelly', 'Uložené · riadi Ray-mon'],
    );
    const vyp = bojlerDetail(info({ rucne: true, rele: false, w: 0, den: { ...DEN, behy: [DEN.behy[0]] } }), NOW, TZ);
    assert.equal(vyp.pod, 'Vypnutý od 11:25');
    assert.equal(bojlerDetail(info({ rucne: true, rele: false, w: 0, den: null }), NOW, TZ).pod, 'Vypnutý');
    assert.equal(bojlerDetail(info({ den: null }), NOW, TZ).pod, 'Hreje');
});

test('panel Bojler dnes (A): pás na osi 0 - 24 h, energia podľa zdroja a behy', () => {
    const d = bojlerDetail(info(), NOW, TZ);
    assert.equal(d.nadpis, 'Bojler dnes');
    assert.equal(d.pod, 'Hreje od 12:30');
    // Bez tarify (či pri jednosadzbovej) je sieť jedna časť.
    assert.deepEqual(
        d.energia.map((c) => [c.tone, c.v, c.l]),
        [
            ['slnko', '3,6 kWh', 'slnko'],
            ['siet', '0,2 kWh', 'sieť'],
        ],
    );
    assert.equal(d.hrial, '2× zapnutý · hrial 1 h 45 min');
    assert.equal(d.behyNadpis, 'Behy dnes');
    assert.deepEqual(d.behy, [
        {
            cas: '10:40 – 11:25',
            kwh: '1,6 kWh',
            casti: [
                { tone: 'slnko', wh: 1650 },
                { tone: 'siet', wh: 0 },
            ],
            sr: '1,6 kWh zo slnka',
        },
        {
            cas: '12:30 – teraz',
            kwh: '2,2 kWh',
            casti: [
                { tone: 'slnko', wh: 1980 },
                { tone: 'siet', wh: 220 },
            ],
            sr: '2,0 kWh zo slnka, 0,2 kWh zo siete',
        },
    ]);
    // Pás 0-24 h ako krivka teploty: prvý beh celý zo slnka, druhý zo slnka a na konci 10 % zo siete; teraz 14:00.
    assert.equal(d.pas.teraz, 58.33);
    assert.deepEqual(
        d.pas.useky.map((u) => u.tone),
        ['slnko', 'slnko', 'siet'],
    );
    assert.deepEqual(d.pas.useky[0], { left: 44.44, width: 3.13, tone: 'slnko' });
    assert.deepEqual(
        d.pas.ticks.map((t) => t.label),
        ['0', '6', '12', '18', '24'],
    );
    // Tarifa s drahým pásmom: tretia časť VT, bez štvrťhodín odhadom (dve tretiny druhého behu sú VT).
    const vt = bojlerDetail(info(), NOW, TZ, null, VT);
    assert.deepEqual(
        vt.energia.map((c) => [c.tone, c.v, c.l]),
        [
            ['slnko', '3,6 kWh', 'slnko'],
            ['siet', '0,1 kWh', 'sieť'],
            ['vt', '0,1 kWh', 'sieť vo VT'],
        ],
    );
    assert.equal(vt.behy[1].sr, '2,0 kWh zo slnka, 0,1 kWh zo siete, 0,1 kWh zo siete vo VT');
});

test('panel so štvrťhodinami (D2): VT presne, sieť na páse tam, kde naozaj bola', () => {
    // Beh 12:30 - teraz (14:00) po štvrťhodinách, zo siete len 13:15 - 13:30 a 13:45 - 14:00 (obe VT).
    const q = /** @type {Array<[number, number]>} */ ([
        [370, 0],
        [370, 0],
        [370, 0],
        [370, 120],
        [370, 0],
        [350, 100],
    ]);
    const beh = { od: 750, do: null, wh: 2200, whSiet: 220, e0: 2650, hrejeMin: 60, q };
    const b = info({ den: { ...DEN, behy: [DEN.behy[0], beh] } });
    const d = bojlerDetail(b, NOW, TZ, null, VT);
    assert.deepEqual(
        d.energia.map((c) => c.v),
        ['3,6 kWh', '0,0 kWh', '0,2 kWh'],
    );
    assert.equal(bojlerDrahaDnes(b, NOW, TZ, VT), 6, 'všetkých 220 Wh zo siete bolo vo VT');
    assert.equal(bojlerDrahaDnes(b, NOW, TZ, TARIFF), 0);
    // Na páse: prvý beh, slnko druhého, VT na konci štvrťhodiny 13:15, slnko, VT na konci poslednej.
    assert.deepEqual(
        d.pas.useky.map((u) => u.tone),
        ['slnko', 'slnko', 'vt', 'slnko', 'vt'],
    );
    // Štvrťhodina bez energie (voda nahriata) je sivá.
    const nahriata = bojlerDetail(info({ den: { ...DEN, behy: [{ ...beh, q: [...q.slice(0, 5), [0, 0]] }] } }), NOW, TZ);
    assert.equal(nahriata.pas.useky.at(-1)?.tone, 'hotovo');
    // Bez drahého pásma je to bežná sieť.
    assert.deepEqual(
        bojlerDetail(b, NOW, TZ, null, TARIFF).pas.useky.map((u) => u.tone),
        ['slnko', 'slnko', 'siet', 'slnko', 'siet'],
    );
});

test('panel: nahriata voda, mlčiaca zásuvka a deň bez behov', () => {
    const hotovo = bojlerDetail(info({ w: 2, den: { ...DEN, hotovo: 835 } }), NOW, TZ);
    assert.equal(hotovo.pod, 'Voda nahriata o 13:55');
    // Relé ostalo zapnuté, beh je otvorený: koniec je čas nahriatia, nie „teraz“.
    assert.equal(hotovo.behy[1].cas, '12:30 – 13:55');
    assert.equal(bojlerDetail(info({ w: 2 }), NOW, TZ).behy[1].cas, '12:30 – teraz', 'nahriatie bez času v zázname');
    assert.deepEqual(hotovo.pas.useky.at(-1)?.tone, 'hotovo');
    const mlci = bojlerDetail(info({ kontaktAt: NOW.getTime() - 20 * MIN }), NOW, TZ);
    assert.deepEqual([mlci.pod, mlci.behy[1].cas], ['Zásuvka sa neozýva od 13:40', '12:30 – 13:40']);
    const vcera = bojlerDetail(info({ kontaktAt: NOW.getTime() - 22 * 60 * MIN }), NOW, TZ);
    assert.equal(vcera.pod, 'Zásuvka sa neozýva od 14. 11. 16:00');
    const caka = bojlerDetail(info({ rele: false, w: 0, den: { ...DEN, behy: [DEN.behy[0]] } }), NOW, TZ);
    assert.equal(caka.pod, 'Čaká na prebytok');
    const nic = bojlerDetail(info({ rele: false, w: 0, den: null }), NOW, TZ);
    assert.deepEqual([nic.pod, nic.behy, nic.hrial, nic.energia.map((c) => c.v)], ['Dnes ešte nehrial', [], '', ['0,0 kWh', '0,0 kWh']]);
    // Na osi 0 - 24 h je teraz vždy, aj večer.
    assert.equal(bojlerDetail(info({ den: null }), new Date('2026-11-15T20:00:00Z'), TZ).pas.teraz, 87.5);
});

test('teplomer (T1): veľké číslo je teplota vody, kým ju zásuvka hlási; nahriata má kWh zo slnka v odrážke', () => {
    const voda = { t: 52.4, at: NOW.getTime() - MIN };
    assert.equal(bojlerDlazdica(info({ voda }), NOW, TZ).velky, '52 °C');
    assert.equal(bojlerDlazdica(info({ voda, rele: false, w: 0 }), NOW, TZ).velky, '52 °C');
    assert.equal(bojlerDlazdica(info({ voda, rucne: true }), NOW, TZ).velky, '52 °C');
    const hotovo = bojlerDlazdica(info({ voda, w: 3, den: { ...DEN, hotovo: 835 } }), NOW, TZ);
    assert.deepEqual([hotovo.velky, hotovo.odr], ['52 °C', ['nahriata o 13:55', 'dnes 3,6 kWh zo slnka']]);
    // Stará teplota (teplomer mlčí) sa neukáže, mlčiaca zásuvka ukazuje ticho ako vždy.
    assert.equal(bojlerDlazdica(info({ voda: { t: 52, at: NOW.getTime() - 20 * MIN } }), NOW, TZ).velky, '2,2 kW');
    assert.equal(bojlerDlazdica(info({ voda, kontaktAt: NOW.getTime() - 18 * MIN }), NOW, TZ).velky, '18 min');
});

test('teplomer (P1): krivka v paneli a plán s teplotou vody', () => {
    const voda = { t: 47.6, at: NOW.getTime() - MIN };
    const teploty = /** @type {Array<[number, number]>} */ ([
        [600, 44],
        [605, 44.5],
        [835, 47.6],
    ]);
    const d = bojlerDetail(info({ voda, teploty, rele: false, w: 0 }), NOW, TZ, { zapne: 870, dohreje: 900, nahriaty: false });
    // Teplotu vody ukáže krivka, riadok stavu ju neopakuje.
    assert.deepEqual([d.pod, d.plan], ['Čaká na prebytok', 'dohreje okolo 15:00']);
    assert.equal(d.voda?.bod.text, '48 °C');
    const nedohreje = bojlerDetail(info({ voda }), NOW, TZ, { zapne: null, dohreje: null, nahriaty: false });
    assert.equal(nedohreje.plan, 'slnko ho dnes asi nedohreje');
    assert.equal(nedohreje.voda, null, 'bez bodov krivka nie je');
    assert.equal(bojlerDetail(info(), NOW, TZ, { zapne: null, dohreje: 900, nahriaty: false }).plan, 'dohreje okolo 15:00');
    assert.equal(bojlerDetail(info(), NOW, TZ, { zapne: null, dohreje: 900, nahriaty: true }).plan, '');
});

test('hranica teploty: nahriata na hranicu na dlaždici aj v paneli, čiara hranice na krivke', () => {
    const voda = { t: 60.2, at: NOW.getTime() - MIN };
    const b = info({ voda, rele: false, w: 0, nahriata: true, hranica: 60 });
    const dl = bojlerDlazdica(b, NOW, TZ);
    assert.deepEqual([dl.velky, dl.odr[0]], ['60 °C', 'nahriata na 60 °C']);
    const teploty = /** @type {Array<[number, number]>} */ ([
        [800, 58],
        [805, 60.2],
    ]);
    const d = bojlerDetail({ ...b, teploty }, NOW, TZ);
    assert.equal(d.pod, 'Voda nahriata na 60 °C');
    assert.equal(d.voda?.ciel?.text, 'hranica 60 °C');
});
