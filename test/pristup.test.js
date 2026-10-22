import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRISTUP } from '../shared/config.js';
import { dniDoKonca, neplati, neplatiOf, odmietnute, parseOdmietnutie, pristupModel, znovaDue } from '../shared/pristup.js';
import { SPOSOBY } from '../shared/zdroje.js';

const NOW = new Date('2026-10-21T12:00:00Z');
const PECAT = 'v1.AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const NB = { sposob: 'huawei-northbound', pecat: PECAT, nazov: 'Dvorany' };
const DEN = 24 * 60 * 60 * 1000;
const TZ = 'Europe/Bratislava';
/** @param {number} ms */
const o = (ms) => new Date(NOW.getTime() + ms);

test('odmietnute: počíta sa za sebou pre ten istý prístup, nový prístup začína od jednej', () => {
    const a = odmietnute(null, NB, NOW, 'prihlasenie:20400', false);
    assert.deepEqual(a, { pecat: PECAT, n: 1, at: NOW.getTime(), kod: 'prihlasenie:20400', skusene: false });
    const b = odmietnute(a, NB, o(60_000), '', true);
    assert.deepEqual([b.n, b.skusene, b.kod], [2, true, '']);
    assert.equal(odmietnute(b, { ...NB, pecat: 'v1.Ina' + PECAT.slice(6) }, NOW, '', false).n, 1, 'nové pripojenie');
});

test('neplati: až po PRISTUP.odmietnutia odmietnutiach a len pre pripojený prístup', () => {
    const a = odmietnute(null, NB, NOW, '', false);
    assert.equal(neplati(a, NB), PRISTUP.odmietnutia <= 1);
    const b = odmietnute(a, NB, NOW, '', false);
    assert.equal(neplati(b, NB), true);
    assert.equal(neplati(b, { ...NB, pecat: 'v1.Ina' }), false, 'iný prístup');
    assert.equal(neplati(b, null), false);
    assert.equal(neplati(null, NB), false);
});

test('znovaDue: po prvom odmietnutí interval spôsobu, potom raz za hodinu; bez odmietnutia rozhoduje bežný interval', () => {
    const a = odmietnute(null, NB, NOW, '', false);
    const interval = /** @type {any} */ (SPOSOBY.find((s) => s.id === NB.sposob)).intervalMs;
    assert.equal(znovaDue(a, NB, o(60_000)), false);
    assert.equal(znovaDue(a, NB, o(interval)), true);
    const b = odmietnute(a, NB, NOW, '', false);
    assert.equal(znovaDue(b, NB, o(interval)), false, 'po usúdení, že prístup neplatí, nie každých 5 minút');
    assert.equal(znovaDue(b, NB, o(PRISTUP.skusMs)), true);
    assert.equal(znovaDue(b, { ...NB, pecat: 'v1.Ina' }, NOW), null);
    assert.equal(znovaDue(null, NB, NOW), null);
});

test('parseOdmietnutie: z úložiska len platný tvar', () => {
    const a = odmietnute(null, NB, NOW, 'x', true);
    assert.deepEqual(parseOdmietnutie(JSON.parse(JSON.stringify(a))), a);
    assert.deepEqual(parseOdmietnutie({ pecat: PECAT, n: 2, at: 5 }), { pecat: PECAT, n: 2, at: 5, kod: '', skusene: false });
    for (const bad of [null, 'x', { pecat: '', n: 1, at: 1 }, { pecat: PECAT, n: 1.5, at: 1 }, { pecat: PECAT, n: 1, at: 'x' }])
        assert.equal(parseOdmietnutie(bad), null, JSON.stringify(bad));
});

test('pristupModel: odmietnutý prístup povie prečo, na každom mieste svojou vetou', () => {
    const b = odmietnute(odmietnute(null, NB, NOW, '', false), NB, NOW, 'prihlasenie:20400', false);
    const m = pristupModel({ zdroj: NB, pristup: b, now: NOW, timezone: TZ });
    assert.ok(m && m.druh === 'neplati');
    assert.equal(m.riadok, 'Huawei prestal prijímať prístup');
    assert.equal(m.stav, 'Huawei · prístup neplatí');
    assert.equal(m.karta.text, `${SPOSOBY[0].neplati} Kým meranie nepripojíš, appka ukazuje odhad z predpovede.`);
    assert.equal(m.karta.skus, '');
    assert.equal(m.sprievodca.nadpis, 'Pripoj Huawei znova');
    assert.match(
        m.sprievodca.uvod,
        /^Huawei prestal prijímať meno a heslo API účtu \(kód 20400\)\. .* napríklad v Shelly, odhlás ho tam\.$/,
    );
    assert.deepEqual(neplatiOf({ zdroj: NB, pristup: b, now: NOW, site: { timezone: TZ } }), m);
    // „Skúsiť znova“ nepomohlo: povie to.
    const skus = odmietnute(b, NB, NOW, '', true);
    const ms = pristupModel({ zdroj: NB, pristup: skus, now: NOW, timezone: TZ });
    assert.equal(ms?.karta.skus, 'Huawei prístup stále neprijíma. Skús to znova o hodinu, alebo meranie pripoj znova.');
    assert.equal(ms?.druh === 'neplati' && ms.sprievodca.uvod, SPOSOBY[0].neplati, 'bez kódu len dôvod');
    // Jedno odmietnutie ešte nič.
    assert.equal(pristupModel({ zdroj: NB, pristup: odmietnute(null, NB, NOW, '', false), now: NOW, timezone: TZ }), null);
    assert.equal(pristupModel({ zdroj: null, pristup: b, now: NOW, timezone: TZ }), null);
    assert.equal(pristupModel({ zdroj: { ...NB, sposob: 'neznamy' }, pristup: b, now: NOW, timezone: TZ }), null);
    assert.equal(neplatiOf({ zdroj: NB, pristup: null, now: NOW, site: { timezone: TZ } }), null);
});

test('pristupModel: Deye pripomenie obnovu týždeň vopred, po vypršaní povie, že vypršal', () => {
    const deye = { sposob: 'deye-aplikacia', pecat: PECAT, nazov: 'Chata', platiDo: o(5 * DEN - 60_000).toISOString() };
    const m = pristupModel({ zdroj: deye, pristup: null, now: NOW, timezone: TZ });
    assert.ok(m && m.druh === 'vyprsi');
    assert.equal(m.karta.nadpis, 'Prístup od Deye vyprší o 5 dní');
    assert.equal(m.stav, 'Deye · platí do 26. 10.');
    assert.equal(m.karta.tlacidlo, 'Obnoviť prístup');
    assert.match(m.sprievodca.uvod, /^Prístup od Deye vyprší o 5 dní\. Deye dáva prístup na 60 dní/);
    /** @param {number} ms */
    const nadpis = (ms) =>
        pristupModel({ zdroj: { ...deye, platiDo: o(ms).toISOString() }, pristup: null, now: NOW, timezone: TZ })?.karta.nadpis;
    assert.equal(nadpis(DEN), 'Prístup od Deye vyprší o 1 deň');
    assert.equal(nadpis(3 * DEN), 'Prístup od Deye vyprší o 3 dni');
    assert.equal(nadpis(-DEN), 'Prístup od Deye vyprší dnes');
    assert.equal(nadpis(8 * DEN), undefined, 'viac než týždeň vopred nič');
    assert.equal(dniDoKonca({ ...NB }, NOW), null, 'bez dátumu nič');
    // Kiosk či Huawei dátum nemajú; obnova je len pri spôsobe, ktorý ju pozná.
    assert.equal(pristupModel({ zdroj: { ...NB, platiDo: deye.platiDo }, pristup: null, now: NOW, timezone: TZ }), null);
    // Vypršaný a odmietnutý: dôvod je vypršanie, nie zmazaná aplikácia.
    const vyprsany = { ...deye, platiDo: o(-DEN).toISOString() };
    const b = odmietnute(odmietnute(null, vyprsany, NOW, '', false), vyprsany, NOW, '', false);
    const v = pristupModel({ zdroj: vyprsany, pristup: b, now: NOW, timezone: TZ });
    assert.ok(v?.karta.text.startsWith('Prístup od Deye vypršal.'));
    const zmazany = pristupModel({ zdroj: deye, pristup: odmietnute(b, deye, NOW, '', false), now: NOW, timezone: TZ });
    assert.equal(zmazany?.druh, 'neplati');
    assert.ok(zmazany?.karta.text.startsWith('Deye prestal prijímať prístup.'), 'ešte nemal vypršať');
});

test('katalóg: každý spôsob vie povedať, prečo prístup mohol prestať platiť', () => {
    for (const s of SPOSOBY) assert.ok(s.neplati.endsWith('.') && s.neplati.length > 20, s.id);
    const deye = SPOSOBY.find((s) => s.id === 'deye-aplikacia');
    assert.deepEqual(deye?.obnova?.pola, ['heslo']);
});
