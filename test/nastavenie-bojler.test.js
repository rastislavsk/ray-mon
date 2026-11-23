// Nastavenie › Bojler na prebytky (shared/nastavenie-bojler.js) a prahy a stav bojlera z Workera (shared/bojler.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bojlerInfoZ, posunPrahy } from '../shared/bojler.js';
import { BOJLER, SITE } from '../shared/config.js';
import { BOJLER_TEXTS, bojlerSekcia, teplomerZ } from '../shared/nastavenie-bojler.js';

const NOW = new Date('2026-11-15T11:00:00Z'); // 12:00 SEČ
const MIN = 60000;
const NB = { sposob: 'huawei-northbound' };
const PRAHY = { zapKw: 2.3, vypKw: 2 };
const NIC = /** @type {const} */ ({ stav: 'nic', text: '', schranka: false });
/** @param {object} [o] */
const stav = (o = {}) => ({
    zdroj: NB,
    doma: ['bojler'],
    bojler: null,
    bojlerPrahy: PRAHY,
    bojlerSkript: NIC,
    now: NOW,
    site: SITE,
    voice: /** @type {const} */ ('drzy'),
    ...o,
});
const info = (/** @type {object} */ o = {}) => ({
    kontaktAt: NOW.getTime() - MIN,
    rele: true,
    w: 2210,
    prebytokKw: 2.6,
    prahy: PRAHY,
    den: null,
    ...o,
});

test('sekcia len pri Huawei Northbound a s bojlerom doma', () => {
    assert.equal(bojlerSekcia(stav({ zdroj: { sposob: 'huawei-kiosk' } })), null);
    assert.equal(bojlerSekcia(stav({ zdroj: null })), null);
    assert.equal(bojlerSekcia(stav({ doma: ['pracka'] })), null);
    const s = bojlerSekcia(stav());
    assert.ok(s);
    assert.deepEqual(
        s.prahy.map((p) => [p.label, p.value, p.menej, p.viac]),
        [
            ['Zapni od', '2,3 kW', true, true],
            ['Vypni pod', '2,0 kW', true, true],
        ],
    );
    assert.deepEqual(s.stav, { tone: 'wait', text: BOJLER_TEXTS.nikdy });
    assert.equal(s.kroky.length, 5);
    assert.equal(s.sprava, null);
});

test('stav zásuvky: hreje, čaká s prebytkom, nahriata, mlčí včera', () => {
    const t = (/** @type {object} */ o) => /** @type {any} */ (bojlerSekcia(stav({ bojler: info(o) }))).stav;
    assert.deepEqual(t({}), { tone: 'ok', text: '11:59 · hreje 2,2 kW' });
    assert.deepEqual(t({ rele: false, w: 0, prebytokKw: 1.1 }), { tone: 'ok', text: '11:59 · čaká na prebytok (teraz 1,1 kW)' });
    assert.deepEqual(t({ rele: false, w: 0, prebytokKw: null }), { tone: 'ok', text: '11:59 · čaká na prebytok' });
    assert.deepEqual(t({ w: 2 }), { tone: 'ok', text: '11:59 · voda nahriata' });
    assert.deepEqual(t({ kontaktAt: NOW.getTime() - 20 * MIN }), { tone: 'stale', text: 'neozvala sa od 11:40' });
    assert.deepEqual(t({ kontaktAt: NOW.getTime() - 24 * 60 * MIN }), { tone: 'stale', text: 'neozvala sa od 14. 11. 12:00' });
});

test('iné prahy v zásuvke, príprava skriptu a vykanie', () => {
    const ine = /** @type {any} */ (bojlerSekcia(stav({ bojler: info({ prahy: { zapKw: 2.5, vypKw: 2.1 } }) })));
    assert.equal(ine.ine, 'Zásuvka má prahy 2,5 a 2,1 kW. Skopíruj skript znova.');
    const s = (/** @type {object} */ sk, voice = 'drzy') =>
        /** @type {any} */ (bojlerSekcia(stav({ bojlerSkript: { ...NIC, ...sk }, voice })));
    assert.deepEqual([s({ stav: 'robim' }).robim, s({ stav: 'robim' }).sprava.text], [true, BOJLER_TEXTS.robim]);
    assert.deepEqual(s({ stav: 'chyba' }).sprava, { text: BOJLER_TEXTS.chyba[0], chyba: true });
    const hotovo = s({ stav: 'hotovo', text: 'kod', schranka: true });
    assert.deepEqual([hotovo.sprava.text, hotovo.skript], [BOJLER_TEXTS.hotovo[0], '']);
    const rucne = s({ stav: 'hotovo', text: 'kod', schranka: false }, 'slusny');
    assert.deepEqual([rucne.sprava.text, rucne.skript, rucne.tlacidlo], [BOJLER_TEXTS.rucne[1], 'kod', BOJLER_TEXTS.tlacidlo[1]]);
    assert.equal(rucne.kroky[0], BOJLER_TEXTS.kroky[0][1]);
    // Na kraji rozsahu sa ďalej nedá.
    const kraj = /** @type {any} */ (bojlerSekcia(stav({ bojlerPrahy: { zapKw: BOJLER.maxKw, vypKw: BOJLER.minKw } })));
    assert.deepEqual(
        kraj.prahy.map((/** @type {any} */ p) => [p.menej, p.viac]),
        [
            [true, false],
            [false, true],
        ],
    );
});

test('posun prahov: krok 0,1 kW, rozsah a medzera medzi zapnutím a vypnutím', () => {
    assert.deepEqual(posunPrahy(PRAHY, 'zapKw', 1), { zapKw: 2.4, vypKw: 2 });
    assert.deepEqual(posunPrahy(PRAHY, 'vypKw', -1), { zapKw: 2.3, vypKw: 1.9 });
    // Vypnutie nahor až po zapnutie: zapnutie sa posunie s ním.
    assert.deepEqual(posunPrahy({ zapKw: 2.3, vypKw: 2.1 }, 'vypKw', 1), { zapKw: 2.4, vypKw: 2.2 });
    assert.deepEqual(posunPrahy({ zapKw: 2.3, vypKw: 2.1 }, 'zapKw', -1), { zapKw: 2.2, vypKw: 2 });
    assert.deepEqual(posunPrahy({ zapKw: BOJLER.maxKw, vypKw: 2 }, 'zapKw', 1), { zapKw: BOJLER.maxKw, vypKw: 2 });
    assert.deepEqual(posunPrahy({ zapKw: 0.7, vypKw: BOJLER.minKw }, 'zapKw', -1), { zapKw: 0.7, vypKw: BOJLER.minKw });
    assert.deepEqual(posunPrahy({ zapKw: BOJLER.maxKw, vypKw: 4.8 }, 'vypKw', 1), { zapKw: BOJLER.maxKw, vypKw: 4.8 });
});

test('stav bojlera z Workera: kontrola tvaru, záznam dňa len s platnými behmi', () => {
    assert.equal(bojlerInfoZ(null), null);
    assert.equal(bojlerInfoZ({ kontaktAt: 'x', rele: true, w: 1 }), null);
    const beh = { od: 600, do: null, wh: 100, whSiet: 5, e0: 1, hrejeMin: 3 };
    const b = bojlerInfoZ({
        kontaktAt: 1,
        rele: true,
        w: 2200,
        prebytokKw: 'x',
        prahy: { zapKw: 2.5, vypKw: 2.2 },
        den: { den: '2026-11-15', behy: [beh, { od: 'x' }], hotovo: 700, posledneAt: 2 },
    });
    assert.deepEqual(b, {
        kontaktAt: 1,
        rele: true,
        w: 2200,
        prebytokKw: null,
        prahy: { zapKw: 2.5, vypKw: 2.2 },
        den: { den: '2026-11-15', behy: [beh], hotovo: 700, posledneAt: 2 },
        rucne: false,
    });
    assert.equal(bojlerInfoZ({ kontaktAt: 1, rele: false, w: 0, rucne: true })?.rucne, true);
    assert.equal(bojlerInfoZ({ kontaktAt: 1, rele: false, w: 0, prebytokKw: 1, den: { den: 5 } })?.den, null);
    assert.equal(bojlerInfoZ({ kontaktAt: 1, rele: false, w: 0, den: { den: 'd', behy: [], posledneAt: 1 } })?.den?.hotovo, null);
});

test('teplomer: prepínač, adresa a riadok so stavom teploty', () => {
    const tp = (/** @type {object} */ o) => /** @type {any} */ (bojlerSekcia(stav(o))).teplomer;
    assert.deepEqual(tp({}), {
        label: 'Mám teplomer v bojleri',
        small: 'zásuvka prečíta teplotu vody zo Shelly s Add-onom',
        on: false,
        ip: '',
        ipLabel: 'Adresa teplomera v domácej sieti',
        hesloLabel: 'Heslo teplomera (meno admin)',
        pozn: 'Heslo appka neuloží, ide len do skriptu zásuvky.',
    });
    const on = { teplomer: { on: true, ip: '10.10.10.50' } };
    assert.equal(tp({ ...on, bojler: info() }).small, 'zatiaľ bez teploty – vlož skript do zásuvky znova');
    assert.equal(tp({ ...on, bojler: info({ voda: { t: 60.5, at: NOW.getTime() - MIN } }) }).small, 'voda 61 °C o 11:59');
    assert.equal(
        tp({ ...on, bojler: info({ voda: { t: 60.5, at: NOW.getTime() - 40 * MIN } }) }).small,
        'neodpovedá od 11:20 – skontroluj adresu a heslo',
    );
    const chyba = /** @type {any} */ (bojlerSekcia(stav({ ...on, bojlerSkript: { stav: 'teplomer', text: '', schranka: false } })));
    assert.deepEqual(chyba.sprava, { text: 'Doplň adresu a heslo teplomera.', chyba: true });
    assert.deepEqual(teplomerZ({ on: true, ip: '10.10.10.50', heslo: 'x' }), { on: true, ip: '10.10.10.50' });
    assert.deepEqual(teplomerZ('nič'), { on: false, ip: '' });
});

test('stav bojlera z Workera: teplota vody a dnešné body len s platným tvarom', () => {
    const z = bojlerInfoZ({ ...info(), rucne: false, voda: { t: 60.5, at: 5 }, teploty: [[600, 44], [605, 'x'], [610]] });
    assert.deepEqual([z?.voda, z?.teploty], [{ t: 60.5, at: 5 }, [[600, 44]]]);
    const bez = bojlerInfoZ({ ...info(), voda: { t: '60' }, teploty: 'nie' });
    assert.equal(bez && 'voda' in bez, false);
    assert.equal(bez && 'teploty' in bez, false);
});
