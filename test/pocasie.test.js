import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HVIEZDY, POCASIE, SKY } from '../shared/config.js';
import { hviezdy } from '../shared/hviezdy.js';
import { jasZMerania, pocasie } from '../shared/pocasie.js';
import { moonPhase } from '../shared/solar.js';

const NOW = new Date('2026-09-05T19:32:00Z');
const NITRA = { lat: 48.48, lon: 18.12 };
/** @param {number | null} cloud @param {import('../shared/solar.js').Precip} [precip] @param {number} [mm] */
const hodina = (cloud, precip, mm) => ({ hour: 12, kw: 1, cloud, precip, ...(mm === undefined ? {} : { mm }) });

test('jasZMerania: podiel z jasnej oblohy delí na jasno, polooblačno a zamračené', () => {
    const m = (/** @type {number} */ kw) => jasZMerania({ kw, clearKw: 8, installedKw: 10 });
    assert.equal(m(8 * POCASIE.jasno), 'jasno');
    assert.equal(m(8 * POCASIE.jasno - 0.01), 'polojasno');
    assert.equal(m(8 * POCASIE.zamracene), 'polojasno');
    assert.equal(m(8 * POCASIE.zamracene - 0.01), 'zamracene');
});

test('jasZMerania: pri nízkom slnku a bez merania o oblakoch nič nehovorí', () => {
    assert.equal(jasZMerania({ kw: 0.1, clearKw: 1.4, installedKw: 10 }), null, 'jasná obloha by dala menej ako 15 %');
    assert.equal(jasZMerania({ kw: NaN, clearKw: 8, installedKw: 10 }), null);
    assert.equal(jasZMerania(null), null);
});

test('pocasie: jas a zrážky z hodiny predpovede, noc a fáza Mesiaca', () => {
    assert.deepEqual(pocasie({ point: hodina(80, 'dazd'), noc: false, chvila: NOW, site: NITRA, merane: null }), {
        jas: 'zamracene',
        zamracenost: 1,
        zrazky: 'dazd',
        dazd: 'dazd',
        noc: false,
        mesiac: moonPhase(NOW),
        juh: false,
        hviezdy: null,
    });
    // Hodina bez poľa zrážok (staršia predpoveď) je bez zrážok.
    assert.equal(pocasie({ point: hodina(10), noc: true, chvila: NOW, site: NITRA, merane: null })?.zrazky, null);
});

test('pocasie: sila dažďa podľa úhrnu za hodinu, zrážky z hodiny, ktorá sa končí po chvíli', () => {
    const { dazdMm, dazdSila } = POCASIE;
    const sila = (/** @type {number | undefined} */ mm) =>
        pocasie({ point: hodina(90), zrazkyPoint: hodina(90, 'dazd', mm), noc: false, chvila: NOW, site: NITRA, merane: null })?.dazd;
    assert.equal(sila(dazdMm), 'mrholenie');
    assert.equal(sila(dazdSila.slaby - 0.1), 'mrholenie');
    assert.equal(sila(dazdSila.slaby), 'slaby');
    assert.equal(sila(dazdSila.dazd), 'dazd');
    assert.equal(sila(dazdSila.silny - 0.1), 'dazd');
    assert.equal(sila(dazdSila.silny), 'silny');
    assert.equal(sila(undefined), 'dazd', 'staršia predpoveď z cache úhrn nemá');
    // Dážď sa začne až v hodine, ktorá sa končí po chvíli - kresba ho už ukáže, oblačnosť je z tejto.
    const p = pocasie({ point: hodina(40), zrazkyPoint: hodina(90, 'dazd', 3), noc: false, chvila: NOW, site: NITRA, merane: null });
    assert.deepEqual([p?.jas, p?.zrazky, p?.dazd], ['polojasno', 'dazd', 'dazd']);
    // Sneh sila dažďa nie je.
    assert.equal(pocasie({ point: hodina(90, 'sneh'), noc: false, chvila: NOW, site: NITRA, merane: null })?.dazd, null);
});

test('pocasie: meranie prebije jas predpovede, nie zrážky; v noci sa meraniu neverí', () => {
    const merane = { kw: 1, clearKw: 8, installedKw: 10 };
    const p = pocasie({ point: hodina(5, 'sneh'), noc: false, chvila: NOW, site: NITRA, merane });
    assert.equal(p?.jas, 'zamracene', 'predpoveď hovorí jasno, menič dáva osminu');
    assert.equal(p?.zrazky, 'sneh');
    assert.equal(pocasie({ point: hodina(5), noc: true, chvila: NOW, site: NITRA, merane })?.jas, 'jasno');
    // Neisté meranie (nízke slnko) nechá jas z predpovede.
    assert.equal(pocasie({ point: hodina(50), noc: false, chvila: NOW, site: NITRA, merane: { ...merane, clearKw: 1 } })?.jas, 'polojasno');
});

test('pocasie: zamračenosť plynule z merania, inak z predpovede; zrážky sú zatiahnuté', () => {
    const { clearPct, overcastPct } = SKY;
    const zPred = (/** @type {number} */ cloud) =>
        pocasie({ point: hodina(cloud), noc: false, chvila: NOW, site: NITRA, merane: null })?.zamracenost;
    assert.equal(zPred(clearPct), 0);
    assert.equal(zPred((clearPct + overcastPct) / 2), 0.5);
    assert.equal(zPred(overcastPct), 1);
    assert.equal(zPred(100), 1);
    // Meranie prebije predpoveď: slnko pri predpovedi „zamračené“ je jasno, polovica cesty je stred.
    const zMer = (/** @type {number} */ podiel, cloud = 90) =>
        pocasie({ point: hodina(cloud), noc: false, chvila: NOW, site: NITRA, merane: { kw: 8 * podiel, clearKw: 8, installedKw: 10 } })
            ?.zamracenost;
    assert.equal(zMer(POCASIE.jasno), 0);
    assert.ok(Math.abs(/** @type {number} */ (zMer((POCASIE.jasno + POCASIE.zamracene) / 2)) - 0.5) < 1e-9);
    assert.equal(zMer(POCASIE.zamracene / 2, 0), 1);
    // V noci sa meraniu neverí a pri daždi či snehu je zatiahnuté, aj keď slnko svieti.
    const merane = { kw: 8, clearKw: 8, installedKw: 10 };
    assert.equal(pocasie({ point: hodina(90), noc: true, chvila: NOW, site: NITRA, merane })?.zamracenost, 1);
    assert.equal(pocasie({ point: hodina(10, 'sneh'), noc: false, chvila: NOW, site: NITRA, merane })?.zamracenost, 1);
});

test('pocasie: bez hodiny predpovede alebo bez oblačnosti nie je', () => {
    assert.equal(pocasie({ point: undefined, noc: false, chvila: NOW, site: NITRA, merane: null }), null);
    assert.equal(pocasie({ point: hodina(null), noc: false, chvila: NOW, site: NITRA, merane: null }), null);
});

/** Hviezdy v noci pri oblačnosti `cloud` v chvíli `chvila` nad miestom `site`. @param {number} cloud @param {Date} chvila */
function nocne(cloud, chvila = NOW, site = NITRA) {
    const p = pocasie({ point: hodina(cloud), noc: true, chvila, site, merane: null });
    assert.ok(p && p.hviezdy);
    return { juh: p.juh, hviezdy: p.hviezdy };
}

test('pocasie: v noci hviezdy z chvíle zaokrúhlenej na krok, oblaky ich ubudnú', () => {
    const noc = nocne(0).hviezdy;
    const krok = HVIEZDY.krokMin * 60000;
    const t = new Date(Math.round(NOW.getTime() / krok) * krok);
    assert.deepEqual(noc, hviezdy({ chvila: t, ...NITRA, oblacnost: 0, mesiac: moonPhase(t) }));
    assert.ok(noc.length > 0);
    // Minúta vedľa v tom istom kroku dá tie isté hviezdy - kresba sa neprepisuje.
    assert.deepEqual(nocne(0, new Date(NOW.getTime() + 60000)).hviezdy, noc);
    assert.ok(nocne(60).hviezdy.length < noc.length);
});

test('pocasie: na južnej pologuli je kosáčik obrátený, rovník je ako sever', () => {
    assert.equal(nocne(0).juh, false);
    assert.equal(nocne(0, NOW, { lat: -22.91, lon: -43.17 }).juh, true);
    assert.equal(nocne(0, NOW, { lat: 0, lon: -78.5 }).juh, false);
});
