// Spotrebič na zásuvke Shelly (docs/navrhy/pracka-zasuvka.html): rozoznanie behu z minútových hlásení a skript zásuvky.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { WORKER_SPOTREBIC_URL, ZASUVKA } from '../shared/config.js';
import { skriptZasuvky } from '../shared/zasuvka-skript.js';
import {
    hlasenieZ,
    infoZasuviek,
    krokZasuvky,
    meria,
    prijmiZasuvku,
    prikonZasuviekKw,
    typickaDlzka,
    vecZasuvky,
    zasuvkyZ,
} from '../shared/zasuvka.js';

const TZ = 'Europe/Bratislava';
const MIN = 60 * 1000;
/** 26. 11. 2026 10:00 miestneho času. */
const T0 = Date.parse('2026-11-26T09:00:00Z');
const ID = 'shellyplugmg3-abc123';

/**
 * Pustí hlásenia (príkon W po minútach od T0, energia rastie s príkonom) a vráti posledný stav a všetky výsledky.
 * @param {number[]} watty @param {import('../shared/zasuvka.js').StavZasuvky | null} [zaciatok]
 */
function pust(watty, zaciatok = null, vec = 'pracka') {
    let stav = zaciatok;
    let e = 1000;
    /** @type {import('../shared/zasuvka.js').KrokZasuvky[]} */ const kroky = [];
    watty.forEach((w, i) => {
        e += w / 60;
        const r = krokZasuvky(vec, stav, { id: ID, at: T0 + i * MIN, w, e }, TZ);
        kroky.push(r);
        stav = r.stav;
    });
    return { stav, kroky, posledny: kroky[kroky.length - 1] };
}

test('hlasenieZ: zariadenie, príkon a energia, inak null', () => {
    assert.deepEqual(hlasenieZ({ id: ID, w: 2100.5, e: 5 }, T0), { id: ID, at: T0, w: 2100.5, e: 5 });
    assert.deepEqual(hlasenieZ({ id: ID, w: -3, e: -1 }, T0), { id: ID, at: T0, w: 0, e: 0 });
    assert.equal(hlasenieZ({ id: 'zle id!', w: 1, e: 1 }, T0), null);
    assert.equal(hlasenieZ({ id: ID, w: '1', e: 1 }, T0), null);
    assert.equal(hlasenieZ({ id: ID, w: 1, e: Infinity }, T0), null);
    assert.equal(vecZasuvky('pracka'), true);
    assert.equal(vecZasuvky('bojler'), false);
});

test('krokZasuvky: beh začne po ZASUVKA.potvrdenie hláseniach nad prahom, od prvého z nich', () => {
    const { kroky, stav } = pust([2, 2, 2000, 2000]);
    assert.equal(kroky[2].zapis, null, 'jedno hlásenie nad prahom ešte nie je beh');
    // Začal o 10:02, koniec podľa programu práčky (120 min).
    assert.deepEqual(kroky[3].zapis, { id: 'pracka', d: '2026-11-26', m: 10 * 60 + 2, k: 12 * 60 + 2 });
    assert.equal(stav?.beh?.at, T0 + 2 * MIN);
    assert.deepEqual(infoZasuviek({ pracka: /** @type {any} */ (stav) }), { pracka: { at: T0 + 3 * MIN, w: 2000, bezi: true } });
    // Jedno hlásenie nad prahom a potom pod ním nič nezačne.
    assert.equal(pust([2000, 3, 2000, 3]).stav?.beh, null);
});

test('krokZasuvky (K2): krátka pauza na začiatku programu beh neskončí, krátka pauza po typickej dĺžke áno', () => {
    // 20 min pranie, 10 min pauza (namáčanie), pranie ďalej: jeden beh.
    const pauza = pust([...Array(20).fill(500), ...Array(10).fill(3), ...Array(5).fill(500)]);
    assert.ok(pauza.stav?.beh, 'beh trvá');
    assert.equal(pauza.kroky.filter((k) => k.skoncil).length, 0);
    // Program 90 min (aspoň 0,7 × 120), potom ticho: skončí po ZASUVKA.pauzaMin minútach, koniec je prvá chvíľa pod prahom.
    const hotovo = pust([...Array(90).fill(500), ...Array(ZASUVKA.pauzaMin + 1).fill(2)]);
    const k = hotovo.kroky.findIndex((x) => x.skoncil);
    assert.equal(k, 90 + ZASUVKA.pauzaMin);
    assert.deepEqual(hotovo.kroky[k].zapis, { id: 'pracka', d: '2026-11-26', m: 600, k: 690 });
    assert.equal(hotovo.kroky[k].skoncil?.min, 90);
    assert.ok(Math.abs((hotovo.kroky[k].skoncil?.wh ?? 0) - 750) <= 9, 'energia behu z počítadla');
    assert.deepEqual(hotovo.stav?.behy, [hotovo.kroky[k].skoncil]);
    assert.equal(hotovo.stav?.beh, null);
});

test('krokZasuvky (K2): dlhá pauza skončí beh vždy, krátky beh sa zmaže', () => {
    const dlha = pust([...Array(20).fill(500), ...Array(ZASUVKA.dlhaPauzaMin + 1).fill(0)]);
    const k = dlha.kroky.find((x) => x.skoncil);
    assert.equal(k?.skoncil?.min, 20);
    // 3 minúty nad prahom (napr. otvorenie dvierok so svetlom) - beh sa zapísal, po konci zmizne.
    const kratky = pust([100, 100, 100, ...Array(ZASUVKA.dlhaPauzaMin + 1).fill(0)]);
    assert.ok(kratky.kroky[1].zapis);
    const z = kratky.kroky.find((x) => x.zrus);
    assert.deepEqual(z?.zrus, { id: 'pracka', d: '2026-11-26', m: 600, k: 603 });
    assert.equal(z?.skoncil, null);
    assert.deepEqual(kratky.stav?.behy, []);
});

test('krokZasuvky: bežiaci beh dlhší než typický sa predlžuje, typická dĺžka z behov zásuvky', () => {
    const behy = [
        { min: 40, wh: 300 },
        { min: 50, wh: 400 },
        { min: 60, wh: 500 },
    ];
    assert.equal(typickaDlzka('pracka', behy.slice(0, 2)), 120, 'pod ZASUVKA.typMinBehov program z MOZEM_ITEMS');
    assert.equal(typickaDlzka('pracka', behy), 50);
    assert.equal(typickaDlzka('susicka', [...behy, { min: 70, wh: 1 }]), 55);
    const zac = { id: ID, at: T0 - MIN, w: 0, e: 1000, nad: 0, od: null, e0: 1000, beh: null, behy };
    const r = pust(Array(70).fill(500), zac);
    // Začal o 10:00, typicky 50 min - po 69 minútach koniec o minútu po teraz.
    assert.deepEqual(r.posledny.zapis, { id: 'pracka', d: '2026-11-26', m: 600, k: 670 });
    // Po typickej dĺžke stačí krátka pauza (0,7 × 50 = 35 min behu).
    const k = pust([...Array(40).fill(500), ...Array(ZASUVKA.pauzaMin + 1).fill(0)], zac);
    assert.equal(k.kroky.find((x) => x.skoncil)?.skoncil?.min, 40);
});

test('krokZasuvky: medzera v hláseniach uzavrie beh poslednou chvíľou s príkonom', () => {
    const { stav } = pust(Array(30).fill(500));
    const e = /** @type {any} */ (stav).e;
    const r = krokZasuvky('pracka', stav, { id: ID, at: T0 + (29 + ZASUVKA.tichoMin + 1) * MIN, w: 0, e }, TZ);
    assert.deepEqual(r.zapis, { id: 'pracka', d: '2026-11-26', m: 600, k: 629 });
    assert.equal(r.skoncil?.min, 29);
    assert.equal(r.stav.beh, null);
    // Bez behu medzera len vynuluje počítanie nad prahom.
    const nad = krokZasuvky('pracka', null, { id: ID, at: T0, w: 500, e: 1 }, TZ).stav;
    const po = krokZasuvky('pracka', nad, { id: ID, at: T0 + (ZASUVKA.tichoMin + 1) * MIN, w: 500, e: 2 }, TZ);
    assert.equal(po.stav.beh, null);
    assert.equal(po.stav.nad, 1);
});

test('prijmiZasuvku, meria, prikonZasuviekKw, zasuvkyZ', () => {
    const s = /** @type {any} */ ({ id: ID, at: T0, w: 2000 });
    assert.equal(prijmiZasuvku(null, { id: 'ine', at: T0, w: 0, e: 0 }), true);
    assert.equal(prijmiZasuvku(s, { id: ID, at: T0 + MIN, w: 0, e: 0 }), true);
    assert.equal(prijmiZasuvku(s, { id: 'ine', at: T0 + MIN, w: 0, e: 0 }), false, 'iná zásuvka, kým sa prvá ozýva');
    assert.equal(prijmiZasuvku(s, { id: 'ine', at: T0 + (ZASUVKA.tichoMin + 1) * MIN, w: 0, e: 0 }), true);
    const info = { pracka: { at: T0, w: 2000, bezi: true } };
    assert.equal(meria(info, 'pracka', T0 + ZASUVKA.ozyvaMin * MIN), true);
    assert.equal(meria(info, 'pracka', T0 + (ZASUVKA.ozyvaMin + 1) * MIN), false);
    assert.equal(meria(info, 'susicka', T0), false);
    assert.equal(meria(undefined, 'pracka', T0), false);
    assert.equal(prikonZasuviekKw({ pracka: s, susicka: { ...s, at: T0 - 60 * MIN } }, T0), 2);
    assert.equal(prikonZasuviekKw(undefined, T0), 0);
    assert.deepEqual(zasuvkyZ({ pracka: { at: T0, w: 5, bezi: 1 }, bojler: { at: T0, w: 1 }, susicka: { at: 'x', w: 1 } }), {
        pracka: { at: T0, w: 5, bezi: false },
    });
    assert.deepEqual(zasuvkyZ(null), {});
});

test('skriptZasuvky: každú minútu pošle príkon a energiu, relé neprepína; zlý vstup null', () => {
    const PECAT = 'v1.abc_DEF-123.xyz';
    const kod = /** @type {string} */ (skriptZasuvky({ url: WORKER_SPOTREBIC_URL, pecat: PECAT, vec: 'pracka' }));
    assert.match(kod, /^\/\/ Práčka na zásuvke/);
    assert.doesNotMatch(kod, /=>|Switch\.Set/);
    const z = { apower: 2100.4, aenergy: { total: 5000.5 } };
    /** @type {any[]} */ const dopyty = [];
    /** @type {Array<() => void>} */ const casovace = [];
    const Shelly = {
        getDeviceInfo: () => ({ id: ID }),
        getComponentStatus: () => ({ ...z }),
        call: (/** @type {string} */ m, /** @type {any} */ p, /** @type {any} */ cb) => {
            assert.equal(m, 'HTTP.POST');
            assert.ok(p.body.length > 0);
            dopyty.push({ url: p.url, telo: JSON.parse(p.body) });
            cb({ code: 200, body: '{"ok":true}' }, 0, '');
        },
    };
    vm.runInNewContext(kod, {
        Shelly,
        Timer: { set: (/** @type {number} */ _ms, /** @type {boolean} */ _o, /** @type {() => void} */ f) => casovace.push(f) },
        JSON,
    });
    assert.deepEqual(dopyty, [{ url: WORKER_SPOTREBIC_URL, telo: { pecat: PECAT, id: ID, vec: 'pracka', w: 2100.4, e: 5000.5 } }]);
    z.apower = 3;
    casovace.forEach((f) => f());
    assert.equal(dopyty[1].telo.w, 3);
    assert.equal(skriptZasuvky({ url: WORKER_SPOTREBIC_URL, pecat: "x'y", vec: 'pracka' }), null);
    assert.equal(skriptZasuvky({ url: 'http://x', pecat: PECAT, vec: 'pracka' }), null);
    assert.equal(skriptZasuvky({ url: WORKER_SPOTREBIC_URL, pecat: PECAT, vec: 'bojler' }), null);
});
