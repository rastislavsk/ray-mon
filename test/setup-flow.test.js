import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANT, SETUP, SITE, TARIFF, TARIFF_TEMPLATES } from '../shared/config.js';
import { shareUrl, toUser, typicalSettings } from '../shared/settings.js';
import { emptySettings } from '../shared/setup.js';
import * as flow from '../shared/setup-flow.js';
import { scheduleRuns, slotsOf } from '../shared/tariff.js';

const KIOSK = 'https://region01eu5.fusionsolar.huawei.com/pvmswebsite/nologin/assets/build/index.html#/kiosk?kk=Abc123xyz';
const OWNER = { site: SITE, plant: PLANT, tariff: TARIFF, kiosk: KIOSK };
const NOW = new Date('2026-09-05T11:00:00Z');

/** Stav sprievodcu pre test: uložená elektráreň (alebo iné `known`) a zmeny navrch.
 * @param {Partial<import('../shared/setup-flow.js').SetupState>} [patch] @returns {import('../shared/setup-flow.js').SetupState} */
function state(patch = {}) {
    const known = patch.known ?? 'elektraren';
    const start = known === 'elektraren' ? OWNER : known === 'poloha' ? typicalSettings(SITE) : emptySettings();
    return { now: NOW, known, ...start, ...flow.setupInit(start, known), ...patch };
}

/** Použije zmenu na stav, ako setState. @param {import('../shared/setup-flow.js').SetupState} s @param {any} patch */
const apply = (s, patch) => ({ ...s, ...patch });

test('setupInit: bez polohy začína otázkou na ňu, inak prehľad; kiosk zapne meranie', () => {
    assert.equal(flow.setupInit(emptySettings(), 'nic').setupStep, 'lokalita');
    assert.equal(flow.setupInit(OWNER, 'elektraren').setupStep, null);
    assert.equal(flow.setupInit(OWNER, 'elektraren').setupLive, true);
    assert.equal(flow.setupInit({ ...OWNER, kiosk: '' }, 'elektraren').setupLive, false);
});

test('setupDraft: bez merania bez kiosku, s celkovým výkonom dopočíta výkon panelu', () => {
    const s = state({ setupLive: false });
    assert.equal(flow.setupDraft(s).kiosk, '');
    const kwp = flow.setupDraft(state({ setupKwp: 12 }));
    assert.equal(kwp.plant.panelWp, 500);
    assert.deepEqual(flow.savedSettings(s), OWNER);
});

test('isWelcome a setupReady: poloha pri prvom otvorení, odkaz len s nastavením', () => {
    assert.equal(flow.isWelcome(state({ known: 'nic' }), 'lokalita'), true);
    assert.equal(flow.isWelcome(state(), 'lokalita'), false);
    assert.equal(flow.setupReady(state()), false);
    assert.equal(flow.setupReady(state({ setupStep: 'odkaz', setupLink: 'https://example.com' })), false);
    assert.equal(flow.setupReady(state({ setupStep: 'odkaz', setupLink: shareUrl('https://x.sk/', OWNER, true) })), true);
    assert.equal(flow.setupReady(state({ setupStep: 'suhrn' })), true);
});

test('výber polohy: nedotknutá plocha na južnej pologuli sa otočí na sever, zoznam sa zavrie', () => {
    const sydney = { ...SITE, name: 'Sydney', lat: -33.9, lon: 151.2, timezone: 'Australia/Sydney' };
    const s = state({ known: 'nic', geo: { status: 'done', results: [{ site: sydney, detail: '' }] } });
    const p = flow.pickPlace(s, 0);
    assert.equal(p.settingsDraft?.site.name, 'Sydney');
    assert.equal(p.settingsDraft?.plant.strings[0].azimuthDeg, 0);
    assert.equal(p.geo?.status, 'idle');
    assert.deepEqual(flow.pickPlace(s, 5), { geo: { status: 'idle', results: [] } });
    // Upravenú plochu nechá tak.
    const own = flow.pickPlace(state({ geo: s.geo }), 0);
    assert.deepEqual(own.settingsDraft?.plant.strings, PLANT.strings);
});

test('ručné súradnice berú zadané pásmo', () => {
    const p = flow.setCoords(state(), 48.1, 17.1, 'Europe/Bratislava');
    assert.deepEqual(p.settingsDraft?.site, {
        name: 'Vlastné súradnice',
        lat: 48.1,
        lon: 17.1,
        elevationM: 0,
        timezone: 'Europe/Bratislava',
    });
});

test('výkon panelu a meniča: tlačidlo, Iný, Neviem a písanie do poľa', () => {
    const s = state({ known: 'poloha', settingsDraft: emptySettings(SITE) });
    assert.deepEqual(flow.pickWp(s, 'other'), { setupPick: { wp: 'other', ac: 'chip' } });
    const guess = flow.pickWp(s, 'guess');
    assert.equal(guess.settingsDraft?.plant.panelWp, SETUP.guessPanelWp);
    assert.equal(guess.setupPick?.wp, 'guess');
    assert.equal(flow.pickWp(s, '450').settingsDraft?.plant.panelWp, 450);
    assert.equal(flow.typeWp(s, 412).setupPick?.wp, 'other');
    assert.deepEqual(flow.pickAc(s, 'other').setupPick, { wp: 'chip', ac: 'other' });
    // Neviem: menič ako panely, bez panelov najmenší povolený.
    assert.equal(flow.pickAc(state(), 'guess').settingsDraft?.plant.acLimitKw, 10);
    assert.equal(flow.pickAc(s, 'guess').settingsDraft?.plant.acLimitKw, 1);
    assert.equal(flow.pickAc(s, '8').settingsDraft?.plant.acLimitKw, 8);
    assert.equal(flow.typeAc(s, 6.5).settingsDraft?.plant.acLimitKw, 6.5);
});

test('prepínanie výkon panelu / celkový výkon prenesie, čo je známe', () => {
    const s = state();
    const kwp = flow.pickWpMode(s, 'kwp');
    assert.equal(kwp?.setupKwp, 10.44);
    assert.equal(flow.pickWpMode(apply(s, kwp), 'kwp'), null);
    const back = flow.pickWpMode(apply(s, { setupKwp: 12 }), 'panel');
    assert.equal(back?.settingsDraft?.plant.panelWp, 500);
    assert.equal(back?.setupKwp, null);
    // Nezmysel z celkového výkonu sa neprenesie.
    assert.equal(flow.pickWpMode(apply(s, { setupKwp: 1000 }), 'panel')?.settingsDraft?.plant.panelWp, PLANT.panelWp);
    assert.equal(flow.pickWpMode(s, 'panel'), null);
});

test('plochy: smer, kompas z klávesnice, sklon, počet a krok o panel', () => {
    const s = state({ setupRoof: 1 });
    assert.equal(flow.setAzimuth(s, 135).settingsDraft?.plant.strings[1].azimuthDeg, 135);
    assert.equal(flow.turnCompass(apply(s, flow.setAzimuth(s, 0)), -1).settingsDraft?.plant.strings[1].azimuthDeg, 315);
    assert.equal(flow.turnCompass(s, 1).settingsDraft?.plant.strings[1].azimuthDeg, 135);
    const tilt = flow.setTilt(s, 45, true);
    assert.equal(tilt.settingsDraft?.plant.strings[1].tiltDeg, 45);
    assert.equal(tilt.settingsRev, 1);
    assert.equal(flow.setTilt(s, 40, false).settingsRev, undefined);
    assert.equal(flow.setPanels(s, 9).settingsDraft?.plant.strings[1].panels, 9);
    assert.equal(flow.stepPanels(s, 1).settingsDraft?.plant.strings[1].panels, PLANT.strings[1].panels + 1);
    assert.equal(flow.stepPanels(apply(s, flow.setPanels(s, NaN)), -1).settingsDraft?.plant.strings[1].panels, 1);
});

test('pridanie a odstránenie plochy, najviac tri a aspoň jedna', () => {
    const s = state();
    const add = flow.addRoof(s);
    assert.equal(add?.settingsDraft?.plant.strings.length, 3);
    assert.equal(add?.setupStep, 'smer');
    assert.equal(add?.setupRoof, 2);
    assert.equal(flow.addRoof(apply(s, add)), null);
    const del = flow.deleteRoof(apply(s, { setupRoof: 1 }), 0);
    assert.equal(del?.settingsDraft?.plant.strings.length, 1);
    assert.equal(del?.setupRoof, 0);
    assert.equal(flow.deleteRoof(apply(s, del), 0), null);
});

test('kiosk sa uloží bez medzier', () => {
    assert.equal(flow.setKiosk(state(), `  ${KIOSK} `).settingsDraft?.kiosk, KIOSK);
});

test('typ sadzby: iný typ dá šablónu so starou menou, ten istý nechá úpravy, Neviem je jedna cena', () => {
    const s = state();
    const viac = flow.pickKind(s, 'viac');
    assert.equal(viac?.settingsDraft?.tariff.bands.length, 3);
    assert.equal(viac?.settingsDraft?.tariff.currency, TARIFF.currency);
    assert.deepEqual(flow.pickKind(s, 'dvoj'), { setupDunno: false });
    assert.equal(flow.pickKind(s, 'dunno')?.settingsDraft?.tariff.bands.length, 1);
    assert.equal(flow.pickKind(s, 'dunno')?.setupDunno, true);
    assert.equal(flow.pickKind(s, 'spot'), null);
});

test('pásma: pridať do štyroch, zmazať (úseky prevezme sused), úroveň, meno a cena', () => {
    const s = apply(state(), flow.pickKind(state(), 'viac'));
    const four = apply(s, flow.addBand(s));
    assert.equal(four.settingsDraft.tariff.bands.length, 4);
    assert.equal(apply(four, flow.addBand(four)).settingsDraft.tariff.bands.length, 4);
    assert.equal(flow.deleteBand(s, 'p1'), null);
    const id = four.settingsDraft.tariff.bands[0].id;
    const del = flow.deleteBand(apply(four, { setupBrush: id }), id);
    assert.equal(del?.settingsDraft?.tariff.bands.length, 3);
    assert.equal(del?.setupBrush, null);
    assert.ok(!slotsOf(/** @type {any} */ (del).settingsDraft.tariff.schedules[0]).includes(id));
    assert.equal(flow.deleteBand(four, 'nic'), null);
});

test('pásma: úroveň, meno, cena a mena', () => {
    const s = apply(state(), flow.pickKind(state(), 'viac'));
    assert.equal(flow.setLevel(s, 'p1', 'lacna').settingsDraft?.tariff.bands.find((b) => b.id === 'p1')?.level, 'lacna');
    assert.equal(flow.setBandName(s, 'p1', ' Špička ').settingsDraft?.tariff.bands.find((b) => b.id === 'p1')?.name, 'Špička');
    assert.equal(flow.setBandPrice(s, 'p1', 0.2).settingsDraft?.tariff.bands.find((b) => b.id === 'p1')?.price, 0.2);
    assert.equal(flow.setBandPrice(s, 'p1', NaN).settingsDraft?.tariff.bands.find((b) => b.id === 'p1')?.price, null);
    assert.equal(flow.setCurrency(s, 'Kč').settingsDraft?.tariff.currency, 'Kč');
    assert.equal(flow.setCurrency(s, '').settingsDraft?.tariff.currency, TARIFF.currency);
});

test('rozvrh: šablóny, maľovanie po kruhu, úsek z formulára a zmazanie úseku', () => {
    const s = state();
    const t = (/** @type {any} */ p) => p.settingsDraft.tariff;
    assert.deepEqual(t(flow.applyTemplate(s, 'all')).schedules[0].changes, [{ from: '00:00', band: 'nt' }]);
    assert.deepEqual(t(flow.applyTemplate(s, 'noc8')).schedules[0].changes, TARIFF_TEMPLATES.dvoj.schedules[0].changes);
    assert.deepEqual(t(flow.applyTemplate(s, '20h')).schedules[0].changes, TARIFF.schedules[0].changes);
    // Maľuje sa najdrahším pásmom, kým človek nevyberie iné.
    assert.equal(flow.brushOf(s, TARIFF).id, 'vt');
    assert.equal(flow.brushOf(apply(s, { setupBrush: 'nt' }), TARIFF).id, 'nt');
    const all = apply(s, flow.applyTemplate(s, 'all'));
    const painted = t(flow.paintRing(all, 4, 7));
    assert.deepEqual(slotsOf(painted.schedules[0]).slice(3, 9), ['nt', 'vt', 'vt', 'vt', 'vt', 'nt']);
    // Cez polnoc: od 23:00 do 01:00 (úsek sa počíta od začiatku, cez polnoc v jednom kuse).
    const run = t(flow.setRun(all, 92, 4, 'vt'));
    assert.deepEqual(
        scheduleRuns(run, run.schedules[0]).map((r) => [r.startMin, r.min, r.band.id]),
        [
            [60, 1320, 'nt'],
            [1380, 120, 'vt'],
        ],
    );
    assert.equal(flow.setRun(all, 1.5, 4, 'vt'), null);
    assert.equal(flow.setRun(all, 1, 4, 'iné'), null);
    const runs = apply(all, { settingsDraft: { ...all.settingsDraft, tariff: run } });
    const del = t(flow.deleteRun(runs, 1));
    assert.equal(scheduleRuns(del, del.schedules[0]).length, 1);
    assert.equal(flow.deleteRun(all, 0), null);
    assert.equal(flow.schedIndex({ setupSched: 5 }, TARIFF), 0);
});

test('výnimky: víkend a časť roka sa prepínajú, mesiace aspoň jeden a nie všetky', () => {
    const s = state();
    const wk = apply(s, flow.toggleException(s, 'weekend'));
    assert.deepEqual(wk.settingsDraft.tariff.schedules[1].days, [6, 7]);
    const both = apply(wk, flow.toggleException(wk, 'season'));
    assert.equal(both.settingsDraft.tariff.schedules.length, 3);
    assert.equal(apply(both, flow.toggleException(both, 'weekend')).settingsDraft.tariff.schedules.length, 2);
    assert.equal(apply(both, flow.toggleException(both, 'none')).settingsDraft.tariff.schedules.length, 1);
    const jan = apply(both, flow.toggleMonth(both, 1));
    assert.deepEqual(jan.settingsDraft.tariff.schedules[2].months, [1, 6, 7, 8, 9]);
    const less = apply(jan, flow.toggleMonth(jan, 6));
    assert.deepEqual(less.settingsDraft.tariff.schedules[2].months, [1, 7, 8, 9]);
    // Plná tarifa ďalšiu výnimku nepridá.
    const base = TARIFF.schedules[0];
    const season = (/** @type {number[]} */ months) => ({ days: [1, 2, 3, 4, 5, 6, 7], months, changes: base.changes });
    const full = state({ settingsDraft: { ...OWNER, tariff: { ...TARIFF, schedules: [base, season([1]), season([2]), season([3])] } } });
    assert.equal(flow.toggleException(full, 'weekend').settingsDraft?.tariff.schedules.length, 4);
    // Posledný mesiac výnimky ostáva.
    const one = state({ settingsDraft: { ...OWNER, tariff: { ...TARIFF, schedules: [base, season([5])] } } });
    assert.deepEqual(flow.toggleMonth(one, 5).settingsDraft?.tariff.schedules[1].months, [5]);
});

test('úrovne podľa cien', () => {
    const s = state();
    const priced = apply(s, flow.setBandPrice(apply(s, flow.setBandPrice(s, 'nt', 0.3)), 'vt', 0.1));
    const levels = flow.applyAutoLevels(priced).settingsDraft?.tariff.bands.map((b) => [b.id, b.level]);
    assert.deepEqual(levels, [
        ['nt', 'draha'],
        ['vt', 'lacna'],
    ]);
    assert.deepEqual(flow.applyAutoLevels(s).settingsDraft?.tariff, TARIFF);
});

test('setupStart: nová strecha bez typickej, rozpísaná ostáva', () => {
    const s = state({ known: 'poloha' });
    const start = flow.setupStart(s);
    assert.equal(start.setupStep, 'panel');
    assert.ok(Number.isNaN(start.settingsDraft?.plant.panelWp));
    const again = flow.setupStart(apply(s, { settingsDraft: { ...s.settingsDraft, plant: { ...PLANT } } }));
    assert.equal(again.settingsDraft, undefined);
});

test('restartSetup, openLink a stepEdit', () => {
    const s = state({ settingsDraft: emptySettings() });
    assert.deepEqual(flow.restartSetup(s).settingsDraft, OWNER);
    assert.equal(flow.restartSetup(s).setupStep, 'start');
    assert.equal(flow.openLink(s).setupStep, 'odkaz');
    const home = flow.stepEdit(s, 'roof:1', true);
    assert.deepEqual([home.setupStep, home.setupRoof, home.setupReturn], ['smer', 1, 'prehlad']);
    assert.deepEqual(home.settingsDraft, OWNER);
    const sum = flow.stepEdit(s, 'menic', false);
    assert.deepEqual([sum.setupStep, sum.setupReturn, sum.settingsDraft], ['menic', 'suhrn', undefined]);
});

test('closeAction: bez polohy späť na otázku, úprava z prehľadu sa zahodí', () => {
    assert.deepEqual(flow.closeAction(state({ known: 'nic', setupStep: 'odkaz' })), {
        type: 'back',
        patch: { setupStep: 'lokalita', setupReturn: null },
    });
    assert.deepEqual(flow.closeAction(state({ setupStep: 'panel' })), { type: 'patch', patch: { setupStep: null, setupReturn: null } });
    const edit = flow.closeAction(state({ setupStep: 'menic', setupReturn: 'prehlad', settingsDraft: emptySettings() }));
    assert.equal(edit.type, 'patch');
    assert.deepEqual(edit.type === 'patch' && edit.patch.settingsDraft, OWNER);
});

test('nextAction: poradie, uloženie polohy, uloženie celku, odkaz a zhrnutie', () => {
    assert.equal(flow.nextAction(state()), null);
    assert.deepEqual(flow.nextAction(state({ setupStep: 'sklon', setupRoof: 1 })), {
        type: 'patch',
        patch: { setupStep: 'pocet', setupRoof: 1 },
    });
    assert.deepEqual(flow.nextAction(state({ setupStep: 'panel', setupReturn: 'suhrn' })), {
        type: 'back',
        patch: { setupStep: 'suhrn', setupReturn: null },
    });
    const welcome = state({ known: 'nic', setupStep: 'lokalita', settingsDraft: { ...emptySettings(SITE) } });
    assert.deepEqual(flow.nextAction(welcome), { type: 'site', site: SITE, extra: { setupStep: 'panel' } });
    const poloha = state({ known: 'poloha', setupStep: 'lokalita', setupReturn: 'prehlad' });
    assert.deepEqual(flow.nextAction(poloha), { type: 'site', site: SITE, extra: { setupStep: null } });
    const save = flow.nextAction(state({ setupStep: 'suhrn' }));
    assert.equal(save?.type, 'save');
    const link = shareUrl('https://x.sk/', OWNER, true);
    const odkaz = flow.nextAction(state({ known: 'nic', setupStep: 'odkaz', setupLink: link }));
    assert.equal(odkaz?.type === 'patch' && odkaz.patch.setupStep, 'suhrn');
    assert.deepEqual(odkaz?.type === 'patch' && odkaz.patch.settingsDraft && toUser(odkaz.patch.settingsDraft), toUser(OWNER));
});

test('backAction: o obrazovku späť, z prvej zavrie sprievodcu', () => {
    assert.deepEqual(flow.backAction(state({ setupStep: 'smer', setupRoof: 1 })), {
        type: 'back',
        patch: { setupStep: 'pocet', setupRoof: 0 },
    });
    assert.deepEqual(flow.backAction(state({ setupStep: 'start' })), { type: 'patch', patch: { setupStep: null, setupReturn: null } });
    assert.equal(flow.backAction(state({ setupStep: 'tarifa', setupReturn: 'prehlad' }))?.type, 'patch');
    assert.equal(flow.backAction(state({ known: 'nic', setupStep: 'odkaz' }))?.type, 'back');
});

test('skipAction: len pri prvom otvorení s vybranou polohou', () => {
    assert.equal(flow.skipAction(state({ known: 'nic', setupStep: 'lokalita' })), null);
    const s = state({ known: 'nic', setupStep: 'lokalita', settingsDraft: emptySettings(SITE) });
    assert.deepEqual(flow.skipAction(s), { type: 'site', site: SITE, extra: { setupStep: null } });
    assert.equal(flow.skipAction(state({ setupStep: 'lokalita' })), null);
});
