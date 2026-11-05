import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRISTUP, SITE } from '../shared/config.js';
import { hlavickaModel, obnovaMerania, pripojenieBublina, stavRiadok } from '../shared/hlavicka.js';
import { odmietnute } from '../shared/pristup.js';
import { FIXED_NOW, fixtureData } from './helpers.js';

const { pv, forecast } = fixtureData();
const at = (/** @type {string} */ hm) => {
    const d = new Date(FIXED_NOW);
    const [h, m] = hm.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    return d;
};
const NB = { sposob: 'huawei-northbound', pecat: 'v1.AbCdEfGhIjKlMnOpQrStUvWxYz012345', nazov: 'Dvorany' };
const cerstve = { ...pv, updatedAt: at('13:10').toISOString() };
/** @type {import('../shared/hlavicka.js').HlavickaVstup} */
const base = {
    known: 'elektraren',
    loading: false,
    now: at('13:10'),
    pv: cerstve,
    forecast,
    site: SITE,
    zdroj: /** @type {any} */ (NB),
    pristup: null,
};
const model = (/** @type {Partial<typeof base>} */ s, /** @type {any} */ voice) => hlavickaModel({ ...base, ...s }, voice);

test('hlavička: miesto, čas merania a bodka - v oboch appkách to isté', () => {
    const m = model({});
    assert.equal(m.place, SITE.name);
    assert.equal(m.status, '13:00 · živé meranie');
    assert.equal(m.tone, 'live');
    assert.equal(m.toneText, '', 'riadok to povie slovom');
    assert.equal(m.setup, false);
    assert.equal(m.tip?.nadpis, 'Živé meranie');
    assert.equal(m.tip?.znova, false);
    assert.equal(model({ site: { ...SITE, name: '' } }).place, '', 'bez lokality prázdne, RAY-MON stojí nad ním');
});

test('hlavička: zastarané a spiace meranie čas so slovom, bez merania len slovo', () => {
    const stare = model({ now: at('13:30'), pv: { ...cerstve, updatedAt: at('13:30').toISOString() } });
    assert.equal(stare.status, '13:00 · zastarané');
    assert.equal(stare.tone, 'stale');
    assert.equal(stare.toneText, 'meranie zastarané');
    assert.equal(model({ now: at('16:40') }).status, '13:00 · bez spojenia');
    const noc = model({ now: at('23:10'), pv: { ...cerstve, realTimePowerKw: null, updatedAt: at('23:10').toISOString() } });
    assert.equal(noc.status, '13:00 · menič spí');
    assert.equal(noc.tone, 'live');
    assert.equal(model({ pv: null }).status, 'meranie nedostupné');
    const odhad = model({ pv: null, zdroj: null });
    assert.equal(odhad.status, 'odhad z predpovede');
    assert.equal(odhad.tone, 'odhad');
    assert.equal(odhad.toneText, '');
    assert.equal(odhad.tip?.tlacidlo, 'Pripojiť meranie ›');
    assert.match(model({ pv: null, zdroj: null }, 'slusny').tip?.text ?? '', /pripojte ho v Nastavení/);
});

test('hlavička: prístup, ktorý výrobca prestal prijímať', () => {
    let o = odmietnute(null, /** @type {any} */ (NB), at('13:00'), 'prihlasenie:20400', false);
    for (let i = 1; i < PRISTUP.odmietnutia; i++) o = odmietnute(o, /** @type {any} */ (NB), at('13:00'), 'prihlasenie:20400', false);
    const m = model({ pv: null, pristup: o });
    assert.equal(m.status, 'meranie treba pripojiť znova');
    assert.equal(m.toneText, 'prístup k meraniu neplatí');
    assert.equal(m.tip?.znova, true);
});

test('hlavička: bez panelov výzva, pri načítaní a bez dát slovo bez bubliny', () => {
    for (const known of /** @type {const} */ (['nic', 'poloha'])) {
        const m = model({ known, loading: true });
        assert.equal(m.setup, true, known);
        assert.equal(m.tip, null);
    }
    const nacitavam = model({ loading: true });
    assert.deepEqual([nacitavam.status, nacitavam.tone, nacitavam.tip], ['načítavam…', 'off', null]);
    const bezDat = model({ pv: null, forecast: null });
    assert.deepEqual([bezDat.status, bezDat.tone, bezDat.tip], ['bez dát', 'off', null]);
});

test('riadok stavu pod číslom karty Teraz: stav merania, v náhľade odkiaľ je číslo, bez panelov nie je', () => {
    const h = model({});
    assert.deepEqual(stavRiadok(h, { preview: false, source: '' }), {
        text: '13:00 · živé meranie',
        tone: 'live',
        toneText: '',
        tip: h.tip,
    });
    // Náhľad iného času: čas merania by vedľa čísla z inej chvíle klamal - bez bodky a bez bubliny.
    assert.deepEqual(stavRiadok(h, { preview: true, source: 'namerané' }), { text: 'namerané', tone: 'nahlad', toneText: '', tip: null });
    assert.equal(stavRiadok(model({ known: 'poloha' }), { preview: false, source: '' }), null);
    const stare = model({ now: at('13:30'), pv: { ...cerstve, updatedAt: at('13:30').toISOString() } });
    assert.equal(stavRiadok(stare, { preview: false, source: '' })?.toneText, 'meranie zastarané');
});

test('bublina po pripojení: až keď prvé meranie prišlo, v noci že menič spí', () => {
    const bublina = (/** @type {Partial<typeof base>} */ s, /** @type {'' | 'pripojene' | 'obnovene'} */ caka = 'pripojene') =>
        pripojenieBublina({ ...base, ...s, caka });
    assert.deepEqual(bublina({}), { nadpis: 'Meranie pripojené', text: 'Huawei · Dvorany – čísla sú odteraz z meniča' });
    const noc = bublina({ now: at('23:10'), pv: { ...cerstve, realTimePowerKw: null, updatedAt: at('23:10').toISOString() } });
    assert.equal(noc?.text, 'Huawei · Dvorany – menič teraz spí, prvé namerané čísla budú ráno');
    assert.equal(bublina({}, ''), null, 'už ukázaná sa nevráti');
    assert.equal(bublina({ pv: null }), null, 'meranie ešte neprišlo - počká');
    assert.equal(
        bublina({ now: at('13:30'), pv: { ...cerstve, updatedAt: at('13:30').toISOString() } }),
        null,
        'zastarané meranie nie je pripojenie',
    );
    assert.equal(bublina({ zdroj: null }), null, 'bez merania nie je čo ohlásiť');
    const bezMena = bublina({ zdroj: /** @type {any} */ ({ ...NB, sposob: 'neznamy', nazov: '' }) });
    assert.equal(bezMena?.text, 'Čísla sú odteraz z meniča');
});

test('meranie sa obnovilo: z výpadku po dokončenom pokuse späť na živé, nie pri štarte ani do noci', () => {
    const pokusAt = at('13:10').getTime();
    const zive = { ...base, pokusAt };
    // Menič mlčal (dáta chodia, krivka stojí od 13:00), teraz je meranie znova živé.
    const mlci = { ...base, now: at('13:40'), pv: { ...cerstve, updatedAt: at('13:40').toISOString() }, pokusAt: at('13:40').getTime() };
    assert.equal(obnovaMerania(mlci, zive), true);
    // Meranie neprišlo (pokus zlyhal), teraz prišlo.
    assert.equal(obnovaMerania({ ...base, pv: null, pokusAt }, zive), true);
    // Pri štarte (bez pokusu) a pri načítaní nová elektráreň - to nie je výpadok.
    assert.equal(obnovaMerania({ ...base, pv: null, pokusAt: 0 }, zive), false);
    assert.equal(obnovaMerania({ ...base, pv: null, pokusAt, loading: true }, zive), false);
    // Iné meranie má vlastnú bublinu; obnovený token (nová pečať) je to isté meranie.
    assert.equal(obnovaMerania({ ...base, pv: null, pokusAt, zdroj: /** @type {any} */ ({ ...NB, nazov: 'Chata' }) }, zive), false);
    assert.equal(obnovaMerania({ ...base, pv: null, pokusAt, zdroj: /** @type {any} */ ({ ...NB, pecat: `${NB.pecat}x` }) }, zive), true);
    // Živé ostalo živé, a výpadok, ktorý sa skončil nocou, nie je obnova.
    assert.equal(obnovaMerania(zive, zive), false);
    const noc = { ...base, now: at('23:10'), pv: { ...cerstve, realTimePowerKw: null, updatedAt: at('23:10').toISOString() }, pokusAt };
    assert.equal(obnovaMerania({ ...base, pv: null, pokusAt }, noc), false);
    // Bublina: nadpis a veta o návrate; v noci sa neukáže (meranie sa nevrátilo).
    assert.deepEqual(pripojenieBublina({ ...zive, caka: 'obnovene' }), {
        nadpis: 'Meranie sa obnovilo',
        text: 'Huawei · Dvorany – čísla sú znova z meniča',
    });
    assert.equal(pripojenieBublina({ ...noc, caka: 'obnovene' }), null);
});
