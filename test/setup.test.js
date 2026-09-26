import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANT, SETTINGS_LIMITS, SITE, TARIFF } from '../shared/config.js';
import { checkSettings } from '../shared/settings.js';
import {
    emptySettings,
    newRoof,
    nextSetupPlace,
    prevSetupPlace,
    resolveDraft,
    SETUP_SECTIONS,
    SETUP_STEPS,
    setupSection,
    setupStepOk,
    totalPanels,
} from '../shared/setup.js';

const KIOSK = 'https://region01eu5.fusionsolar.huawei.com/pvmswebsite/nologin/assets/build/index.html#/kiosk?kk=Abc123xyz';
const DVORANY = { site: SITE, plant: PLANT, tariff: TARIFF, kiosk: '' };
const ok = (/** @type {any} */ at, draft = DVORANY, opts = {}) => setupStepOk(at, draft, { totalKwp: null, live: false, ...opts });

/** Prejde celého sprievodcu tlačidlom Ďalej a vráti poradie obrazoviek. @param {number} roofs */
function walk(roofs) {
    /** @type {string[]} */ const out = [];
    /** @type {import('../shared/setup.js').SetupPlace | null} */ let at = { step: 'start', roof: 0 };
    while (at) {
        out.push(`${at.step}${['smer', 'sklon', 'pocet'].includes(at.step) ? at.roof : ''}`);
        at = nextSetupPlace(at, roofs);
    }
    return out;
}

test('poradie obrazoviek: každá plocha má smer, sklon a počet, potom otázka na ďalšiu', () => {
    assert.deepEqual(walk(1), ['start', 'lokalita', 'panel', 'smer0', 'sklon0', 'pocet0', 'dalsia', 'menic', 'meranie', 'suhrn']);
    assert.deepEqual(walk(2), [
        'start',
        'lokalita',
        'panel',
        'smer0',
        'sklon0',
        'pocet0',
        'smer1',
        'sklon1',
        'pocet1',
        'dalsia',
        'menic',
        'meranie',
        'suhrn',
    ]);
    // Odkaz vedie rovno na zhrnutie - uloží sa až tam, po pohľade na to, čo sa preberá.
    assert.deepEqual(nextSetupPlace({ step: 'odkaz', roof: 0 }, 1), { step: 'suhrn', roof: 0 });
});

test('Späť je presný opak Ďalej, aj cez hranicu plôch', () => {
    for (const roofs of [1, 2, 3]) {
        /** @type {import('../shared/setup.js').SetupPlace | null} */ let at = { step: 'start', roof: 0 };
        while (at) {
            const next = nextSetupPlace(at, roofs);
            if (next) assert.deepEqual(prevSetupPlace(next, roofs), at, `${roofs} plochy: späť z ${next.step}${next.roof}`);
            at = next;
        }
    }
    assert.equal(prevSetupPlace({ step: 'start', roof: 0 }, 1), null, 'pred úvodom nie je nič');
    assert.deepEqual(prevSetupPlace({ step: 'odkaz', roof: 0 }, 1), { step: 'start', roof: 0 });
});

test('ukazovateľ postupu: šesť častí, plochy sú jedna, úvod a odkaz nie sú ani jedna', () => {
    assert.equal(SETUP_SECTIONS.length, 6);
    assert.equal(setupSection('lokalita'), 0);
    for (const step of /** @type {const} */ (['smer', 'sklon', 'pocet', 'dalsia'])) assert.equal(setupSection(step), 2);
    assert.equal(setupSection('suhrn'), 5);
    assert.equal(setupSection('start'), -1);
    assert.equal(setupSection('odkaz'), -1);
    const inSections = SETUP_SECTIONS.flatMap((s) => s.steps);
    assert.deepEqual(
        [...inSections, 'start', 'odkaz'].sort(),
        [...SETUP_STEPS].sort(),
        'každá obrazovka je v práve jednej časti alebo pred sprievodcom',
    );
});

test('nový používateľ nezačína ničím vymysleným: bez lokality, bez výkonov, zhrnutie by neprešlo', () => {
    const empty = emptySettings();
    assert.equal(empty.site.name, '');
    assert.ok(Number.isNaN(empty.plant.panelWp) && Number.isNaN(empty.plant.acLimitKw));
    assert.equal(empty.plant.strings.length, 1);
    assert.equal(empty.plant.albedo, PLANT.albedo, 'odborné parametre z config.js');
    assert.ok(checkSettings(empty).errors.length > 0);
    assert.equal(ok({ step: 'lokalita', roof: 0 }, empty), false);
    assert.equal(ok({ step: 'panel', roof: 0 }, empty), false);
    assert.equal(ok({ step: 'menic', roof: 0 }, empty), false);
    // Smer, sklon a počet majú rozumné východisko - dá sa rovno pokračovať.
    for (const step of ['smer', 'sklon', 'pocet']) assert.equal(ok({ step, roof: 0 }, empty), true, step);
});

test('nová plocha smeruje k rovníku', () => {
    assert.equal(newRoof(48).azimuthDeg, 180);
    assert.equal(newRoof(-33).azimuthDeg, 0);
});

test('každá obrazovka kontroluje len to, na čo sa pýta', () => {
    assert.equal(ok({ step: 'lokalita', roof: 0 }), true);
    assert.equal(ok({ step: 'lokalita', roof: 0 }, { ...DVORANY, site: { ...SITE, timezone: 'Mars/Olympus' } }), false);
    assert.equal(ok({ step: 'panel', roof: 0 }, { ...DVORANY, plant: { ...PLANT, panelWp: 50 } }), false);
    assert.equal(ok({ step: 'panel', roof: 0 }, DVORANY, { totalKwp: 10.44 }), true, 'celkový výkon namiesto panelu');
    assert.equal(ok({ step: 'panel', roof: 0 }, DVORANY, { totalKwp: 0 }), false);
    assert.equal(ok({ step: 'panel', roof: 0 }, DVORANY, { totalKwp: NaN }), false);
    const strmy = { ...DVORANY, plant: { ...PLANT, strings: [{ panels: 2.5, azimuthDeg: 180, tiltDeg: 95 }] } };
    assert.equal(ok({ step: 'sklon', roof: 0 }, strmy), false);
    assert.equal(ok({ step: 'pocet', roof: 0 }, strmy), false, 'počet panelov je celé číslo');
    assert.equal(ok({ step: 'pocet', roof: 5 }), false, 'plocha, ktorá neexistuje');
    assert.equal(ok({ step: 'menic', roof: 0 }, { ...DVORANY, plant: { ...PLANT, acLimitKw: 0 } }), false);
    // Meranie: bez neho je jedno, čo je v poli; s ním musí byť odkaz kiosk FusionSolar.
    assert.equal(ok({ step: 'meranie', roof: 0 }, { ...DVORANY, kiosk: 'nezmysel' }), true);
    assert.equal(ok({ step: 'meranie', roof: 0 }, { ...DVORANY, kiosk: 'nezmysel' }, { live: true }), false);
    assert.equal(ok({ step: 'meranie', roof: 0 }, { ...DVORANY, kiosk: KIOSK }, { live: true }), true);
    assert.equal(ok({ step: 'suhrn', roof: 0 }), true);
    assert.equal(ok({ step: 'suhrn', roof: 0 }, emptySettings()), false);
});

test('celkový výkon: výkon panelu sa dopočíta z panelov na všetkých plochách', () => {
    assert.equal(totalPanels(DVORANY), 24);
    assert.equal(resolveDraft(DVORANY, null), DVORANY, 'bez celkového výkonu sa nemení nič');
    const r = resolveDraft(DVORANY, 10.44);
    assert.equal(r.plant.panelWp, 435);
    assert.deepEqual(checkSettings(r).errors, []);
    // Na desatinu wattu, aby súčet plôch sedel so zadaným výkonom.
    assert.equal(resolveDraft(DVORANY, 10).plant.panelWp, 416.7);
    // Nezmyselný pomer (3 panely na 10 kWp) nejde ďalej - obrazovka s plochami to ohlási.
    const tri = { ...DVORANY, plant: { ...PLANT, strings: [{ panels: 3, azimuthDeg: 180, tiltDeg: 35 }] } };
    const zly = resolveDraft(tri, 10.44);
    assert.ok(zly.plant.panelWp > SETTINGS_LIMITS.panelWp.max);
    assert.equal(ok({ step: 'dalsia', roof: 0 }, zly), false);
    assert.equal(ok({ step: 'dalsia', roof: 0 }, r), true);
    assert.ok(
        Number.isNaN(
            resolveDraft({ ...tri, plant: { ...tri.plant, strings: [{ ...tri.plant.strings[0], panels: NaN }] } }, 5).plant.panelWp,
        ),
    );
});
