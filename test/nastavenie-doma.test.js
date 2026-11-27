import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOJLER } from '../shared/config.js';
import { DOMA_TEXTS, domaSekcia, domaUcinne, listText, NS_OKNA, zamknuteVeci } from '../shared/nastavenie-doma.js';

const NOW = new Date('2026-11-26T09:30:00Z');
const MIN = 60 * 1000;
const nic = { stav: /** @type {const} */ ('nic'), text: '', schranka: false };

/** @param {any} [patch] @returns {any} */
const stav = (patch = {}) => ({
    zdroj: { sposob: 'huawei-northbound' },
    doma: ['pracka', 'umyvacka', 'bojler', 'auto', 'klima'],
    now: NOW,
    site: { timezone: 'Europe/Bratislava' },
    voice: 'drzy',
    appSheet: null,
    bojler: null,
    bojlerPrahy: { zapKw: 2.3, vypKw: 2 },
    bojlerSkript: nic,
    ...patch,
});

/** Bojler, ktorý zásuvka riadi (ozvala sa pred minútou). @param {any} [patch] */
const bojler = (patch = {}) => ({
    kontaktAt: NOW.getTime() - MIN,
    rele: false,
    w: 0,
    prebytokKw: 1.4,
    prahy: { zapKw: 2.3, vypKw: 2 },
    rucne: false,
    behy: [],
    ...patch,
});

/** @param {any} m @param {string} id */
const vec = (m, id) => m.veci.find((/** @type {any} */ v) => v.id === id);

test('domaSekcia: veci s prepínačom, pripojenia len pri zapnutej veci a Huawei Northbound', () => {
    const m = domaSekcia(stav(), 'Čo máš doma');
    assert.equal(m.title, 'Čo máš doma');
    assert.deepEqual(
        m.veci.map((/** @type {any} */ v) => [v.id, v.name, v.on]),
        [
            ['pracka', 'Práčka', true],
            ['umyvacka', 'Umývačka', true],
            ['susicka', 'Sušička', false],
            ['auto', 'Elektromobil', true],
            ['bojler', 'Bojler', true],
            ['klima', 'Klimatizácia', true],
        ],
    );
    assert.equal(m.hint, 'Práčka, umývačka, elektromobil, bojler a klimatizácia');
    assert.equal(m.note, DOMA_TEXTS.note);
    // L1: vypnutá sušička zásuvku nemá.
    assert.deepEqual(vec(m, 'susicka').pripojenia, []);
    assert.deepEqual(
        vec(m, 'pracka').pripojenia.map((/** @type {any} */ p) => [p.okno, p.label, p.stav.text]),
        [['zasuvka:pracka', 'Zásuvka Shelly', 'nepripojená']],
    );
    assert.deepEqual(
        vec(m, 'bojler').pripojenia.map((/** @type {any} */ p) => [p.okno, p.stav.text]),
        [
            ['bojler', 'nepripojené'],
            ['teplomer', 'nepripojený'],
        ],
    );
    assert.deepEqual(vec(m, 'klima').pripojenia[0].stav, { tone: 'wait', text: 'nepripojená' });
    assert.deepEqual(vec(m, 'auto').pripojenia[0].stav, { tone: 'wait', text: 'vypnuté' });
    assert.equal(m.okno, null);
    // Iné meranie: zoznam bez pripojení.
    const kiosk = domaSekcia(stav({ zdroj: { sposob: 'huawei-kiosk' } }), 'x');
    assert.ok(kiosk.veci.every((/** @type {any} */ v) => v.pripojenia.length === 0));
    assert.equal(domaSekcia(stav({ doma: [] }), 'x').hint, 'zatiaľ nič');
    assert.equal(domaSekcia(stav({ voice: 'slusny', doma: ['pracka'] }), 'x').veci[0].name, 'Práčka');
});

test('domaSekcia: stav pripojení - zásuvka beží, oznámenia auta, teplomer, a čo sa neozýva v podnadpise', () => {
    const zasuvky = {
        pracka: { at: NOW.getTime() - MIN, w: 1900, bezi: true },
        umyvacka: { at: NOW.getTime() - 2 * MIN, w: 2, bezi: false },
    };
    const m = domaSekcia(stav({ zasuvky, autoOznam: { z: true, k: false } }), 'x');
    assert.deepEqual(vec(m, 'pracka').pripojenia[0].stav, { tone: 'ok', text: 'beží · 1,9 kW' });
    assert.deepEqual(vec(m, 'umyvacka').pripojenia[0].stav, { tone: 'ok', text: 'ozvala sa o 10:28' });
    assert.deepEqual(vec(m, 'auto').pripojenia[0].stav, { tone: 'ok', text: 'začiatok' });
    assert.equal(domaSekcia(stav({ autoOznam: { z: false, k: true } }), 'x').veci[3].pripojenia[0].stav.text, 'koniec');
    assert.equal(domaSekcia(stav({ autoOznam: { z: true, k: true } }), 'x').veci[3].pripojenia[0].stav.text, 'začiatok a koniec');
    // Teplomer: kým nemá teplotu, čaká; s teplotou a hranicou ok.
    const tp = { on: true, ip: '10.10.10.50' };
    const caka = domaSekcia(stav({ teplomer: tp, bojler: bojler() }), 'x');
    assert.equal(vec(caka, 'bojler').pripojenia[1].stav.tone, 'wait');
    const voda = { t: 54, at: NOW.getTime() - MIN };
    const teplo = domaSekcia(stav({ teplomer: tp, bojler: bojler({ voda, hranica: 60 }) }), 'x');
    assert.deepEqual(vec(teplo, 'bojler').pripojenia[1].stav, { tone: 'ok', text: 'voda 54 °C o 10:29 · hriať do 60 °C' });
    const bezHranice = domaSekcia(stav({ teplomer: tp, bojler: bojler({ voda }) }), 'x');
    assert.deepEqual(vec(bezHranice, 'bojler').pripojenia[1].stav, { tone: 'ok', text: 'voda 54 °C o 10:29' });
    // L10: čo sa neozýva, povie podnadpis.
    const ticho = { pracka: { at: NOW.getTime() - 3 * 24 * 60 * MIN, w: 0, bezi: false } };
    assert.match(domaSekcia(stav({ zasuvky: ticho }), 'x').hint, / · Práčka sa neozýva$/);
    const klima = { at: NOW.getTime() - 60 * MIN };
    assert.match(domaSekcia(stav({ zasuvky: ticho, klima }), 'x').hint, / · 2 sa neozývajú$/);
});

test('L5b: bojler, ktorý riadi zásuvka, a klimatizácia, ktorej Shelly sa ozval, sa vypnúť nedajú', () => {
    const s = stav({ doma: ['pracka'], bojler: bojler(), klima: { at: NOW.getTime() - MIN } });
    assert.deepEqual(Object.keys(zamknuteVeci(s)), ['bojler', 'klima']);
    assert.deepEqual(domaUcinne(s), ['pracka', 'bojler', 'klima']);
    const m = domaSekcia(s, 'x');
    assert.deepEqual([vec(m, 'bojler').on, vec(m, 'bojler').zamknute], [true, DOMA_TEXTS.zamknute.bojler]);
    assert.deepEqual([vec(m, 'klima').on, vec(m, 'klima').zamknute], [true, DOMA_TEXTS.zamknute.klima]);
    assert.equal(vec(m, 'pracka').zamknute, '');
    assert.equal(vec(m, 'bojler').pripojenia[0].stav.tone, 'ok');
    // Zásuvka, ktorá mlčí dlhšie než BOJLER.riadenyHod, bojler nedrží.
    const dlho = bojler({ kontaktAt: NOW.getTime() - (BOJLER.riadenyHod * 60 + 1) * MIN });
    assert.deepEqual(zamknuteVeci(stav({ bojler: dlho })), {});
});

test('okno veci: nadpis, časť, oznámenia (P3) a obsah; bez veci či pri inom meraní nie je', () => {
    assert.ok(NS_OKNA.includes('zasuvka:susicka'));
    const z = domaSekcia(stav({ appSheet: 'zasuvka:pracka', zasuvkaOznam: true, zasuvkaOznamStav: 'uklada' }), 'x').okno;
    assert.ok(z);
    assert.deepEqual([z.title, z.cast, z.busy, z.chyba], ['Práčka › Zásuvka Shelly', 'zasuvka', true, '']);
    assert.deepEqual(
        z.prepinace.map((p) => [p.key, p.on, p.small]),
        [['zasuvka', true, DOMA_TEXTS.zasuvkaOznamPozn]],
    );
    assert.ok(z.zasuvka && !z.bojler && !z.klima);
    // Sušička je vypnutá - jej okno nie je.
    assert.equal(domaSekcia(stav({ appSheet: 'zasuvka:susicka' }), 'x').okno, null);
    assert.equal(domaSekcia(stav({ appSheet: 'share' }), 'x').okno, null);
    assert.equal(domaSekcia(stav({ appSheet: 'bojler', zdroj: { sposob: 'huawei-kiosk' } }), 'x').okno, null);
});

/** Okno veci zo stavu; test spadne, keď nie je. @param {any} patch */
function okno(patch) {
    const o = domaSekcia(stav(patch), 'x').okno;
    assert.ok(o);
    return o;
}

test('okno veci: bojler (riadenie, teplomer), auto a klimatizácia', () => {
    const b = okno({ appSheet: 'bojler', bojlerOznam: false, bojlerOznamStav: 'zakazane' });
    assert.deepEqual([b.title, b.cast, b.chyba], ['Bojler › Riadenie zo zásuvky', 'bojler', 'Oznámenia appka nemá povolené.']);
    assert.ok(b.bojler);
    const t = okno({ appSheet: 'teplomer' });
    assert.deepEqual([t.title, t.cast, t.prepinace.length, !!t.bojler], ['Bojler › Teplomer', 'teplomer', 0, true]);
    // Zamknutý bojler má okno, aj keď ho človek v zozname nemá.
    assert.ok(okno({ doma: [], appSheet: 'bojler', bojler: bojler() }).bojler);
    const a = okno({ appSheet: 'auto', autoOznam: { z: false, k: true }, autoOznamStav: 'chyba' });
    assert.deepEqual(
        a.prepinace.map((p) => [p.key, p.on]),
        [
            ['z', false],
            ['k', true],
        ],
    );
    assert.equal(a.chyba, 'Nepodarilo sa uložiť. Skús to znova.');
    const k = okno({ appSheet: 'klima' });
    assert.deepEqual([k.title, k.prepinace.length, !!k.klima], ['Klimatizácia › Shelly, ktoré ju číta', 0, true]);
});

test('listText: zoznam slovom', () => {
    assert.equal(listText([]), '');
    assert.equal(listText(['juh', 'východ']), 'juh a východ');
});
