// Stav (web/state.js): krok histórie, návrat naň, prehľad so
// stĺpcami a časti appky, ktoré obrazovka potrebuje.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SITE } from '../shared/config.js';
import {
    dashboard,
    initialState,
    layoutOf,
    navChange,
    navPrevFrom,
    navStep,
    navStepFrom,
    navStepOf,
    neededParts,
    panelChange,
    ready,
    sameNavStep,
    shows,
    zOznamenia,
} from '../web/state.js';

/** @typedef {import('../web/state.js').AppState} AppState */

const NOW = new Date('2026-09-05T11:00:00Z');

/** Stav s typickou strechou v SITE, prípadne so zmenami. @param {Partial<AppState>} [patch] @returns {AppState} */
function stateWith(patch = {}) {
    const s = initialState(NOW, { saved: null, site: SITE, dayLog: {}, online: true });
    return { ...s, panel: 'mozem', ...patch };
}

/** Úplný krok, ako ho appka zapisuje do histórie. @param {Partial<import('../web/state.js').NavStep>} [patch] */
const step = (patch = {}) => ({
    panel: /** @type {const} */ ('mozem'),
    preview: null,
    detail: null,
    setup: null,
    roof: 0,
    sheet: null,
    fold: null,
    vec: null,
    chip: null,
    ...patch,
});

test('initialState: bez nastavenia aj polohy appka nič nepozná, s polohou počíta s typickou strechou', () => {
    const none = initialState(NOW, { saved: null, site: null, dayLog: {}, online: false });
    assert.equal(none.known, 'nic');
    assert.equal(none.panel, 'terazky');
    assert.equal(none.layout, 'narrow');
    assert.deepEqual(none.parts, {});
    assert.equal(stateWith().known, 'poloha');
});

test('layoutOf: hranice šírky podľa LAYOUT_PX', () => {
    assert.equal(layoutOf(375), 'narrow');
    assert.equal(layoutOf(1023), 'narrow');
    assert.equal(layoutOf(1024), 'medium');
    assert.equal(layoutOf(1280), 'wide');
});

test('dashboard a shows: prehľad so stĺpcami len na širšej obrazovke a len na jeho kartách', () => {
    assert.equal(dashboard({ layout: 'narrow', panel: 'mozem' }), false);
    assert.equal(dashboard({ layout: 'medium', panel: 'mozem' }), true);
    assert.equal(dashboard({ layout: 'wide', panel: '7dni' }), true);
    assert.equal(dashboard({ layout: 'wide', panel: 'statistika' }), false);
    assert.equal(shows({ layout: 'wide', panel: 'mozem' }, '7dni'), true);
    assert.equal(shows({ layout: 'narrow', panel: 'mozem' }, '7dni'), false);
    assert.equal(shows({ layout: 'wide', panel: 'statistika' }, 'mozem'), false);
});

test('ready: karta v jadre je pripravená vždy, neskorá až po načítaní svojej časti', () => {
    assert.equal(ready({ parts: {} }, 'mozem'), true);
    assert.equal(ready({ parts: {} }, '7dni'), false);
    assert.equal(ready({ parts: { sedem: 'chyba' } }, '7dni'), false);
    assert.equal(ready({ parts: { sedem: 'ok' } }, '7dni'), true);
});

test('neededParts: karty na obrazovke a ponuka nastavenia z odkazu', () => {
    assert.deepEqual(neededParts(stateWith()), []);
    assert.deepEqual(neededParts(stateWith({ panel: '7dni' })), ['sedem']);
    // V prehľade je 7 dní vidieť aj z karty Môžem?.
    assert.deepEqual(neededParts(stateWith({ layout: 'wide' })), ['sedem']);
    assert.deepEqual(neededParts(stateWith({ panel: 'statistika' })), ['statistika']);
    const incoming = /** @type {any} */ ({});
    assert.deepEqual(neededParts(stateWith({ incoming })), ['nastavenie']);
    assert.deepEqual(neededParts(stateWith({ panel: 'nastavenie' })), ['nastavenie']);
});

test('navStep → navStepOf: krok prežije cestu cez históriu', () => {
    const s = stateWith({ panel: 'terazky', terazPreview: 600 });
    assert.deepEqual(navStepOf(navStep(s)), navStep(s));
    const dash = stateWith({ layout: 'wide', panel: '7dni', weekDetail: 'day' });
    assert.deepEqual(navStepOf(navStep(dash)), navStep(dash));
    assert.equal(navStep(dash).dash, true);
    assert.deepEqual(navStepFrom({ step: navStep(s) }), navStep(s));
    assert.deepEqual(navPrevFrom({ prev: navStep(dash) }), navStep(dash));
    assert.equal(navStepFrom(null), null);
    assert.equal(navPrevFrom('x'), null);
});

test('navStepOf: položka zo skoršej verzie mala za krok len kartu', () => {
    assert.deepEqual(navStepOf('7dni'), step({ panel: '7dni' }));
});

test('navStepOf: cudzia hodnota je null', () => {
    assert.equal(navStepOf(null), null);
    assert.equal(navStepOf(42), null);
    assert.equal(navStepOf({ panel: 'neexistuje' }), null);
    assert.equal(navStepOf({ panel: 'nastavenie', setup: 'neexistuje' }), null);
    assert.equal(navStepOf({ panel: 'nastavenie', setup: 'lokalita', roof: -1 }), null);
    assert.equal(navStepOf({ panel: 'nastavenie', setup: 'lokalita', roof: 1.5 }), null);
});

/** Pole kroku z položky histórie; pri cudzej hodnote undefined. @param {unknown} raw @param {string} key */
const field = (raw, key) => /** @type {any} */ (navStepOf(raw))?.[key];

test('navStepOf: časť kroku, ktorá nepatrí karte, sa zahodí', () => {
    // Náhľad mimo dňa nie je náhľad.
    assert.equal(field({ panel: 'terazky', preview: 1440 }, 'preview'), null);
    assert.equal(field({ panel: 'terazky', preview: -1 }, 'preview'), null);
    assert.equal(field({ panel: 'terazky', preview: 0 }, 'preview'), 0);
    // Detail patrí len karte 7 dní, v prehľade ktorémukoľvek stĺpcu.
    assert.equal(field({ panel: 'mozem', detail: 'day' }, 'detail'), null);
    assert.equal(field({ panel: 'mozem', detail: 'day', dash: true }, 'detail'), 'day');
    assert.equal(field({ panel: '7dni', detail: 'mesiac' }, 'detail'), null);
    // Plagát v dialógu zanikol - položka zo staršej verzie, ktorá ho nesie, vráti kartu bez neho.
    assert.deepEqual(navStepOf({ panel: 'statistika', poster: 'mesiac' }), step({ panel: 'statistika' }));
    // Okno sekcie Appka len Nastaveniu.
    assert.equal(field({ panel: 'mozem', sheet: 'share' }, 'sheet'), null);
    assert.equal(field({ panel: 'nastavenie', sheet: 'reset' }, 'sheet'), 'reset');
    // Prehľad poznajú len jeho karty.
    assert.equal(field({ panel: 'statistika', dash: true }, 'dash'), undefined);
    assert.equal(field({ panel: 'mozem', dash: 'áno' }, 'dash'), undefined);
    // Panel veci karty Môžem? zanikol s jej dlaždicami - položka, ktorá ho nesie, vráti kartu.
    assert.deepEqual(navStepOf({ panel: 'mozem', item: 'bojler' }), step({ panel: 'mozem' }));
    // Plán dňa a zoznam pod grafom karty Teraz zanikli s jej prestavbou.
    assert.deepEqual(navStepOf({ panel: 'terazky', plan: true, legend: true }), step({ panel: 'terazky' }));
});

test('sameNavStep: v prehľade je prepnutie stĺpca ten istý krok, posun náhľadu tiež', () => {
    assert.ok(sameNavStep(step({ panel: 'mozem', dash: true }), step({ panel: '7dni', dash: true })));
    assert.ok(!sameNavStep(step({ panel: 'mozem' }), step({ panel: '7dni' })));
    assert.ok(sameNavStep(step({ preview: 600 }), step({ preview: 700 })));
    assert.ok(!sameNavStep(step({ preview: 600 }), step()));
});

test('navChange: návrat na krok vráti kartu aj s tým, čo bolo otvorené', () => {
    const back = navChange(stateWith({ panel: 'mozem' }), step({ panel: '7dni', detail: 'day' }));
    assert.equal(back.panel, '7dni');
    assert.equal(back.panelDir, 1);
    assert.equal(back.weekDetail, 'day');
    assert.equal(back.setupReturn, null, 'návrat mimo sprievodcu ukončí úpravu jedného kroku');
    // Náhľad, ktorý už beží, ostane, kde ho prst nechal.
    assert.equal(navChange(stateWith({ panel: 'terazky', terazPreview: 900 }), step({ panel: 'terazky', preview: 600 })).terazPreview, 900);
    assert.equal(navChange(stateWith({ panel: 'mozem' }), step({ panel: 'terazky', preview: 600 })).terazPreview, 600);
    // Krok uprostred sprievodcu úpravu neukončí.
    assert.ok(!('setupReturn' in navChange(stateWith(), step({ panel: 'nastavenie', setup: 'lokalita' }))));
    assert.equal(navChange(stateWith(), step({ panel: 'nastavenie', setup: 'suhrn' })).setupReturn, null);
});

test('sekcie Nastavenia: pri štarte zbalené, rozbalená je krok navigácie, s kartou sa zbalí', () => {
    assert.equal(stateWith().nsOpen, null);
    const open = stateWith({ panel: 'nastavenie', nsOpen: 'vzhlad' });
    assert.equal(navStep(open).fold, 'vzhlad');
    assert.deepEqual(navStepOf(navStep(open)), navStep(open));
    // Rozbalenie je nový krok - Späť sekciu zbalí, iná sekcia je tiež nový krok.
    assert.ok(!sameNavStep(navStep(open), navStep({ ...open, nsOpen: null })));
    assert.ok(!sameNavStep(navStep(open), navStep({ ...open, nsOpen: 'doma' })));
    // Sekcia patrí len karte Nastavenie; neznáma sa zahodí, položka zo skoršej verzie ju nemá.
    assert.equal(field({ panel: 'mozem', fold: 'vzhlad' }, 'fold'), null);
    assert.equal(field({ panel: 'nastavenie', fold: 'hacker' }, 'fold'), null);
    assert.equal(field({ panel: 'nastavenie' }, 'fold'), null);
    // Späť na krok so zbalenou sekciou ju zbalí, na krok s rozbalenou ju rozbalí.
    assert.equal(navChange(open, step({ panel: 'nastavenie' })).nsOpen, null);
    assert.equal(navChange(stateWith({ panel: 'nastavenie' }), step({ panel: 'nastavenie', fold: 'oznamenia' })).nsOpen, 'oznamenia');
    // Iná karta sekciu zbalí.
    assert.equal(panelChange('nastavenie', 'mozem').nsOpen, null);
});

test('detail spotrebiča na karte Teraz: otvorený je krok navigácie, Späť a iná karta ho zavrú', () => {
    assert.equal(stateWith().tzVec, null);
    const open = stateWith({ panel: 'terazky', tzVec: 'pracka' });
    assert.equal(navStep(open).vec, 'pracka');
    assert.deepEqual(navStepOf(navStep(open)), navStep(open));
    // Otvorenie je nový krok, iný spotrebič tiež - Späť ho zavrie.
    assert.ok(!sameNavStep(navStep(open), navStep({ ...open, tzVec: null })));
    assert.ok(!sameNavStep(navStep(open), navStep({ ...open, tzVec: 'auto' })));
    // Patrí karte Teraz, v prehľade ktorémukoľvek stĺpcu; cudzia vec detail nemá.
    assert.equal(field({ panel: 'mozem', vec: 'pracka' }, 'vec'), null);
    assert.equal(field({ panel: 'mozem', vec: 'pracka', dash: true }, 'vec'), 'pracka');
    assert.equal(field({ panel: 'terazky', vec: 'raketa' }, 'vec'), null);
    assert.equal(field({ panel: 'terazky' }, 'vec'), null);
    assert.equal(navChange(open, step({ panel: 'terazky' })).tzVec, null);
    assert.equal(navChange(stateWith({ panel: 'terazky' }), step({ panel: 'terazky', vec: 'auto' })).tzVec, 'auto');
    assert.equal(panelChange('terazky', 'mozem').tzVec, null);
});

test('karta Deň: krivka či pás je voľba telefónu, nie krok navigácie', () => {
    assert.equal(stateWith().tzKrivka, false);
    const s = initialState(NOW, { saved: null, site: SITE, dayLog: {}, online: true, tzKrivka: true });
    assert.equal(s.tzKrivka, true);
    assert.deepEqual(navStep(s), navStep({ ...s, tzKrivka: false }));
    assert.equal('tzKrivka' in panelChange('terazky', 'mozem'), false);
});

test('ťuknutie na oznámenie: Teraz s obrysom okolo toho, čo zapnúť, inak sa všetko zavrie', () => {
    const s = stateWith({ panel: '7dni', weekDetail: 'day', terazPreview: 600, tzChip: 'stav', tzVec: 'pracka', stavTip: true });
    const po = { ...s, ...zOznamenia(s) };
    assert.equal(po.panel, 'terazky');
    assert.equal(po.panelDir, -1);
    assert.equal(po.tzVec, null);
    assert.equal(po.tzObrys, true);
    assert.equal(po.weekDetail, null);
    assert.equal(po.terazPreview, null);
    assert.equal(po.tzChip, null);
    assert.equal(po.stavTip, false);
    // Obrys nie je krok navigácie a s kartou zhasne, aj keď ešte čakal na dáta.
    assert.deepEqual(navStep(po), navStep({ ...po, tzObrys: false }));
    assert.equal(panelChange('terazky', 'mozem').tzObrys, false);
    assert.equal(stateWith().tzObrys, false);
});

test('panel štítka na karte Teraz: otvorený je krok navigácie, Späť a iná karta ho zavrú', () => {
    assert.equal(stateWith().tzChip, null);
    const open = stateWith({ panel: 'terazky', tzChip: 'stav' });
    assert.equal(navStep(open).chip, 'stav');
    assert.deepEqual(navStepOf(navStep(open)), navStep(open));
    assert.ok(!sameNavStep(navStep(open), navStep({ ...open, tzChip: null })));
    assert.ok(!sameNavStep(navStep(open), navStep({ ...open, tzChip: 'siet' })));
    // Patrí karte Teraz, v prehľade so stĺpcami ktorémukoľvek stĺpcu; cudzia hodnota panel nemá.
    assert.equal(field({ panel: 'mozem', chip: 'stav' }, 'chip'), null);
    assert.equal(field({ panel: 'mozem', chip: 'stav', dash: true }, 'chip'), 'stav');
    assert.equal(field({ panel: 'terazky', chip: 'iny' }, 'chip'), null);
    assert.equal(field({ panel: 'terazky' }, 'chip'), null);
    assert.equal(navChange(open, step({ panel: 'terazky' })).tzChip, null);
    assert.equal(navChange(stateWith({ panel: 'terazky' }), step({ panel: 'terazky', chip: 'siet' })).tzChip, 'siet');
    assert.equal(panelChange('terazky', 'mozem').tzChip, null);
});

test('navChange: v prehľade návrat na krok prehľadu nechá aktívny stĺpec', () => {
    const wide = stateWith({ layout: 'wide', panel: 'terazky' });
    assert.equal(navChange(wide, step({ panel: 'mozem', dash: true })).panel, 'terazky');
    assert.equal(navChange(wide, step({ panel: 'mozem' })).panel, 'mozem');
    // Na úzkej obrazovke krok prehľadu vráti jeho kartu.
    assert.equal(navChange(stateWith({ panel: 'terazky' }), step({ panel: 'mozem', dash: true })).panel, 'mozem');
});
