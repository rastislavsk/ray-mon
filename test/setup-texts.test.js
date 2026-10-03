import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANT, SITE, TARIFF, TARIFF_TEMPLATES } from '../shared/config.js';
import { editTabs, listText, nastavenieModel, nastavenieRows, setupCta } from '../shared/nastavenie.js';
import { typicalSettings } from '../shared/settings.js';
import { emptySettings, SETUP_STEPS } from '../shared/setup.js';
import { setupInit } from '../shared/setup-flow.js';
import * as T from '../shared/setup-texts.js';
import { fixtureData, FIXED_NOW } from './helpers.js';

const KIOSK = 'https://region01eu5.fusionsolar.huawei.com/pvmswebsite/nologin/assets/build/index.html#/kiosk?kk=Abc123xyz';
const OWNER = { site: SITE, plant: PLANT, tariff: TARIFF, kiosk: KIOSK };

/** @param {any} [patch] @returns {any} */
function state(patch = {}) {
    const known = patch.known ?? 'elektraren';
    const start = known === 'elektraren' ? OWNER : known === 'poloha' ? typicalSettings(SITE) : emptySettings();
    return { now: FIXED_NOW, known, ...start, ...setupInit(start, known), pv: null, loading: false, ...patch };
}

test('texty obrazoviek: privítanie, celkový výkon, tri plochy a menič s výkonom panelov', () => {
    assert.equal(T.textsFor(state({ known: 'nic' }), OWNER, 'lokalita').title, 'Kde máš elektráreň?');
    assert.equal(T.textsFor(state(), OWNER, 'lokalita').title, 'Kde je tvoja elektráreň?');
    assert.equal(T.textsFor(state({ setupKwp: 10 }), OWNER, 'panel').title, 'Aký výkon má celá elektráreň?');
    const three = { ...OWNER, plant: { ...PLANT, strings: [...PLANT.strings, PLANT.strings[0]] } };
    assert.equal(T.textsFor(state(), three, 'dalsia').title, 'Tri plochy sú maximum');
    assert.match(T.textsFor(state(), OWNER, 'menic').lead, /^Panely majú spolu 10,44 kWp\./);
    assert.match(T.textsFor(state(), emptySettings(), 'menic').lead, /^Výkon meniča/);
    assert.equal(T.textsFor(state(), OWNER, 'suhrn').title, 'Skontroluj a ulož');
});

test('riadok nad postupom, postup a riadok nad titulkom', () => {
    assert.equal(T.stepLabel(state({ known: 'nic' }), 'lokalita'), 'Vitaj');
    assert.equal(T.stepLabel(state(), 'smer'), 'Krok 3 z 7 · Strecha');
    assert.equal(T.stepLabel(state({ setupReturn: 'prehlad' }), 'menic'), 'Úprava · Menič');
    assert.equal(T.stepLabel(state(), 'odkaz'), 'Nastavenie z odkazu');
    assert.equal(T.stepLabel(state(), 'start'), 'Moja elektráreň');
    assert.equal(T.progressSection(state(), 'ceny'), 5);
    assert.equal(T.progressSection(state({ setupReturn: 'suhrn' }), 'ceny'), -1);
    assert.equal(T.subText(state(), OWNER, 'sklon', 1), 'Plocha 2 z 2');
    assert.equal(T.subText(state(), emptySettings(), 'sklon', 0), 'Plocha 1');
    const wk = { ...TARIFF, schedules: [TARIFF.schedules[0], { ...TARIFF.schedules[0], days: [6, 7] }] };
    assert.equal(T.subText(state({ setupSched: 1 }), { ...OWNER, tariff: wk }, 'rozvrh', 0), 'Rozvrh · Víkend');
    assert.equal(T.subText(state(), OWNER, 'menic', 0), '');
});

test('tlačidlá dole podľa kroku a úpravy', () => {
    const f = (/** @type {any} */ s, /** @type {any} */ step, ready = true) => T.footModel(s, OWNER, step, ready);
    assert.equal(f(state({ known: 'nic' }), 'lokalita').next, 'Nastaviť panely');
    assert.equal(f(state({ known: 'nic' }), 'lokalita').backShown, false);
    assert.equal(f(state(), 'dalsia').next, 'Nie, to je všetko');
    assert.equal(f(state({ setupLive: false }), 'meranie').next, 'Preskočiť');
    assert.equal(f(state(), 'meranie').next, 'Ďalej');
    assert.equal(f(state(), 'start').back, 'Neskôr');
    assert.equal(f(state({ setupReturn: 'suhrn' }), 'menic').next, 'Späť na zhrnutie');
    // Úprava z prehľadu bez zmeny sa uložiť nedá.
    const edit = f(state({ setupReturn: 'prehlad' }), 'menic');
    assert.deepEqual([edit.next, edit.nextOff, edit.back, edit.close], ['Uložiť zmenu', true, 'Zrušiť', 'Zrušiť úpravu']);
    assert.equal(f(state(), 'ceny', false).nextOff, true);
});

test('hlásenia: vyhľadávanie, kiosk, menič a dopočítaný výkon panelu', () => {
    assert.equal(T.geoNote({ status: 'loading', results: [] }), 'Hľadám…');
    assert.match(String(T.geoNote({ status: 'error', results: [] })), /nefunguje/);
    assert.match(String(T.geoNote({ status: 'done', results: [] })), /Nič som nenašiel/);
    assert.equal(T.geoNote({ status: 'idle', results: [] }), null);
    assert.equal(T.kioskNote('', false), null);
    assert.equal(T.kioskNote(KIOSK, true)?.err, false);
    assert.equal(T.kioskNote('x', false)?.err, true);
    assert.equal(T.menicModel(OWNER, 10).note?.text, 'Menič je o trochu menší než panely. To je bežné a skoro nič to nestojí.');
    assert.equal(T.menicModel(OWNER, 12).note?.text, 'Menič zvládne plný výkon panelov.');
    assert.match(String(T.menicModel(OWNER, 5).note?.text), /orezávať špičky na 5 kW/);
    assert.equal(T.menicModel(emptySettings(), NaN).note, null);
    assert.equal(T.derivedNote(state(), OWNER), null);
    assert.equal(T.derivedNote(state({ setupKwp: 10.44 }), OWNER)?.text, 'Spolu 24 panelov a 10,44 kWp, teda 435 Wp na panel.');
    assert.equal(T.derivedNote(state({ setupKwp: 10 }), { ...OWNER, plant: { ...PLANT, panelWp: 3480 } })?.err, true);
});

test('polia, výkony a kvalita smeru', () => {
    assert.equal(T.fieldText(7.5), '7,5');
    assert.equal(T.fieldText(NaN), '');
    assert.equal(T.fieldText(null), '');
    assert.equal(T.kwText(10), '10 kW');
    assert.equal(T.dirName(100), '100°');
    assert.equal(T.effectivePick('chip', 412, [400, 435]), 'other');
    assert.equal(T.effectivePick('chip', 435, [400, 435]), 'chip');
    assert.deepEqual(T.quality(0.97), { label: 'Výborné', tier: 'green', pct: 97 });
    assert.equal(T.quality(0.9).label, 'Dobré');
    assert.equal(T.quality(0.75).tier, 'amber');
    assert.equal(T.quality(0.5).tier, 'red');
    assert.equal(T.panelsLine(state(), OWNER, 0).strong, '6,96 kWp');
    assert.match(T.panelsLine(state({ setupKwp: 10 }), OWNER, 0).text, /dopočítam/);
    assert.deepEqual(T.panelsLine(state(), emptySettings(SITE), 0), { text: '', strong: '' });
    assert.deepEqual(T.roofRows(OWNER)[1], { az: 90, title: 'Plocha 2 · Východ', sub: '40° · 8 panelov · 3,48 kWp' });
});

test('poloha a odkaz: východ a západ slnka, čo je v odkaze, ponuka prevziať', () => {
    const c = T.placeCard(OWNER, FIXED_NOW);
    assert.equal(c?.date, 'dnes, 5. 9.');
    assert.match(String(c?.rise), /^\d\d:\d\d$/);
    assert.equal(T.placeCard(emptySettings(), FIXED_NOW), null);
    assert.deepEqual(T.linkPreview(OWNER), {
        name: SITE.name,
        kwp: '10,44 kWp',
        meta: '2 plochy (juh, východ) · 24 panelov · menič 10 kW · so živým meraním',
    });
    assert.match(T.linkPreview({ ...OWNER, kiosk: '', plant: { ...PLANT, strings: [PLANT.strings[0]] } }).meta, /^1 plocha \(juh\)/);
    assert.equal(T.importOfferText(OWNER, 'nic'), 'Dvorany nad Nitrou · 10,44 kWp · so živým meraním.');
    assert.match(T.importOfferText({ ...OWNER, kiosk: '' }, 'elektraren'), /kWp\. Nahradí tvoje doterajšie nastavenie\.$/);
});

test('tarifa: mená rozvrhov, hodiny pásiem, šablóny a kontrola cien', () => {
    const base = TARIFF.schedules[0];
    const t = {
        ...TARIFF,
        schedules: [
            base,
            { ...base, days: [6, 7] },
            { ...base, months: [6, 7, 8] },
            { ...base, months: [1, 3] },
            { ...base, days: [1, 2] },
        ],
    };
    assert.deepEqual(
        t.schedules.map((_, i) => T.schedLabel(t, i)),
        ['Pracovné dni', 'Víkend', 'Jún – august', 'Jan, mar', 'Výnimka 4'],
    );
    assert.equal(T.schedDetail(t, 0), 'keď neplatí výnimka');
    assert.equal(T.schedDetail(t, 1), 'So – Ne · celý rok');
    assert.equal(T.schedDetail(t, 4), 'Po, Ut · celý rok');
    assert.equal(T.schedDetail({ ...t, schedules: [base, { ...base, days: [1, 2, 3, 4, 5] }] }, 1), 'Po – Pi · celý rok');
    assert.equal(T.schedLabel({ ...t, schedules: [base, { ...base, months: [6] }] }, 0), 'Zvyšok roka');
    assert.equal(T.schedLabel(TARIFF, 0), 'Každý deň');
    assert.equal(T.schedDetail(TARIFF, 0), 'každý deň · celý rok');
    assert.equal(T.bandHoursText(TARIFF, base), 'NT 20 h · VT 4 h');
    assert.equal(T.scheduleTemplates(TARIFF).length, 3);
    assert.equal(T.scheduleTemplates(TARIFF_TEMPLATES.viac).length, 1);
    assert.match(T.priceCheck(TARIFF_TEMPLATES.jedna).text, /jednej cene/);
    assert.match(T.priceCheck(TARIFF).text, /Bez cien/);
    const half = { ...TARIFF, bands: [{ ...TARIFF.bands[0], price: 0.1 }, TARIFF.bands[1]] };
    assert.match(T.priceCheck(half).text, /Doplň ceny/);
    const ok = {
        ...TARIFF,
        bands: [
            { ...TARIFF.bands[0], price: 0.1 },
            { ...TARIFF.bands[1], price: 0.2 },
        ],
    };
    assert.deepEqual([T.priceCheck(ok).ok, T.priceCheck(ok).fix, T.priceCheck(ok).auto?.length], [true, false, 2]);
    const clash = {
        ...TARIFF,
        bands: [
            { ...TARIFF.bands[0], price: 0.3 },
            { ...TARIFF.bands[1], price: 0.2 },
        ],
    };
    assert.equal(T.priceCheck(clash).fix, true);
    assert.match(T.priceCheck(clash).text, /^Podľa cien by NT bolo drahé a VT bolo lacné, máš to inak\.$/);
});

test('karta elektrárne a riadky zhrnutia', () => {
    const h = T.plantHero(OWNER, FIXED_NOW);
    assert.equal(h?.kwp, 10.44);
    assert.deepEqual(h?.dirs, ['juh', 'východ']);
    assert.ok(Number(h?.clearKwh) > 0);
    assert.equal(T.plantHero(emptySettings(), FIXED_NOW), null);
    const rows = T.summaryRows(OWNER, state({ setupPick: { wp: 'guess', ac: 'guess' } }));
    assert.deepEqual(
        rows.map((r) => r.key),
        ['lokalita', 'panel', 'roof:0', 'roof:1', 'menic', 'meranie', 'tarifa'],
    );
    assert.equal(rows[1].guess, true);
    assert.equal(rows[4].guess, true);
    assert.equal(rows[6].extra, 'bez cien');
    const kwp = T.summaryRows({ ...emptySettings(), kiosk: '' }, state({ setupKwp: 5 }));
    assert.deepEqual([kwp[1].extra, kwp[1].guess, kwp[1].value, kwp[2].extra], ['dopočítané z 5,00 kWp', false, '–', '–']);
    assert.equal(kwp[0].value, '–');
});

test('prehľad novej appky: výzva len bez panelov, riadky a karta strechy', () => {
    assert.equal(listText(['juh']), 'juh');
    assert.equal(listText(['juh', 'východ', 'západ']), 'juh, východ a západ');
    const cta = setupCta(state({ known: 'poloha' }));
    assert.equal(cta?.title, 'Ešte 6 krokov a appka bude tvoja');
    assert.deepEqual(cta?.steps, [true, false, false, false, false, false, false]);
    assert.equal(cta?.stepsLabel, 'Hotový 1 zo 7 krokov');
    assert.equal(setupCta(state()), null);
    const { pv } = fixtureData();
    const m = nastavenieModel(state({ pv }));
    assert.equal(m.hero?.kwp, '10,44');
    assert.equal(m.hero?.line, '24 panelov · juh a východ · menič 10 kW');
    assert.match(String(m.hero?.clear), /^za jasného dňa okolo \d+ kWh$/);
    assert.deepEqual(
        m.rows.map((r) => [r.label, r.value, r.edit, r.start]),
        [
            ['Poloha', SITE.name, 'lokalita', false],
            ['Panely', '2 plochy · 435 Wp', 'panel', false],
            ['Živé meranie', 'pripojené · 13:00', 'meranie', false],
            ['Tarifa', '2 pásma · lacno 20 h', 'tarifa', false],
        ],
    );
    assert.equal(nastavenieRows(state({ kiosk: '' }))[2].value, 'bez merania, odhad z predpovede');
    const poloha = nastavenieModel(state({ known: 'poloha' }));
    assert.equal(poloha.hero, null);
    assert.deepEqual(
        poloha.rows.map((r) => [r.value, r.edit, r.start]),
        [
            [SITE.name, 'lokalita', false],
            ['nezadané', null, true],
            ['nepripojené, nepovinné', null, true],
            ['nezadaná', null, true],
        ],
    );
    assert.deepEqual(poloha.warnings, []);
    const one = nastavenieRows(state({ plant: { ...PLANT, strings: [PLANT.strings[0]], panelWp: NaN } }));
    assert.equal(one[1].value, '1 plocha · – Wp');
});

test('záložky pri úprave z prehľadu: panely, plocha a tarifa', () => {
    const edit = state({ setupReturn: 'prehlad' });
    const roof = editTabs(edit, OWNER, 'sklon');
    assert.deepEqual(
        roof.group?.map((t) => [t.step, t.on]),
        [
            ['panel', false],
            ['dalsia', true],
            ['menic', false],
        ],
    );
    assert.equal(roof.roof, true);
    assert.equal(roof.tariff, null);
    const tariff = editTabs(edit, OWNER, 'rozvrh');
    assert.deepEqual(
        tariff.tariff?.map((t) => t.label),
        ['Typ', 'Rozvrh', 'Výnimky', 'Ceny'],
    );
    assert.equal(tariff.group, null);
    // Zo zhrnutia sprievodcu len kroky plochy, bez skupiny panelov.
    assert.equal(editTabs(state({ setupReturn: 'suhrn' }), OWNER, 'smer').group, null);
    assert.deepEqual(editTabs(state(), OWNER, 'smer'), { group: null, roof: false, tariff: null });
});

test('sprievodca v novej appke nespomína ciferník ani prstenec, v súčasnej pri tarife áno', () => {
    const s = state();
    const draft = s.settingsDraft;
    const dial = /ciferník|prstenec|prstenc/i;
    for (const step of SETUP_STEPS) {
        const t = T.textsFor(s, draft, step, false);
        assert.doesNotMatch(`${t.title} ${t.lead}`, dial, step);
    }
    assert.doesNotMatch(T.TARIFF_DUNNO_PLAN, dial);
    const one = { ...TARIFF, bands: [TARIFF.bands[0]] };
    assert.doesNotMatch(T.priceCheck(one, false).text, dial);
    assert.match(T.textsFor(s, draft, 'tarifa', false).lead, /pás plánu dňa/);
    // Súčasná appka ostáva pri ciferníku.
    assert.match(T.textsFor(s, draft, 'tarifa').lead, /zafarbí ciferník/);
    assert.match(T.TARIFF_DUNNO, /ciferník/);
    assert.match(T.priceCheck(one).text, /ciferník/);
});
