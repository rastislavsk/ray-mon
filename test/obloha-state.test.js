// Stav novej appky (obloha/web/state.js): krok histórie, návrat naň, ťah prstom, prehľad so
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
    nextPanel,
    ready,
    sameNavStep,
    shows,
    swipeTarget,
} from '../obloha/web/state.js';

/** @typedef {import('../obloha/web/state.js').AppState} AppState */

const NOW = new Date('2026-09-05T11:00:00Z');

/** Stav s typickou strechou v SITE, prípadne so zmenami. @param {Partial<AppState>} [patch] @returns {AppState} */
function stateWith(patch = {}) {
    const s = initialState(NOW, { saved: null, site: SITE, startPanel: 'mozem', dayLog: {}, launches: [], online: true });
    return { ...s, ...patch };
}

/** Predpoveď s daným počtom dní - swipeTarget z nej číta len dĺžku. @param {number} n */
const forecastOf = (n) => /** @type {any} */ ({ days: Array.from({ length: n }, () => ({})) });

/** Úplný krok, ako ho appka zapisuje do histórie. @param {Partial<import('../obloha/web/state.js').NavStep>} [patch] */
const step = (patch = {}) => ({
    panel: /** @type {const} */ ('mozem'),
    item: null,
    preview: null,
    detail: null,
    poster: null,
    setup: null,
    roof: 0,
    sheet: null,
    ...patch,
});

test('initialState: bez nastavenia aj polohy appka nič nepozná, s polohou počíta s typickou strechou', () => {
    const none = initialState(NOW, { saved: null, site: null, startPanel: 'terazky', dayLog: {}, launches: [], online: false });
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

test('nextPanel: na kraji sa listovanie nezacyklí', () => {
    assert.equal(nextPanel('mozem', 1), 'terazky');
    assert.equal(nextPanel('mozem', -1), null);
    assert.equal(nextPanel('nastavenie', 1), null);
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

test('neededParts: karty na obrazovke, plagát a ponuka nastavenia z odkazu', () => {
    assert.deepEqual(neededParts(stateWith()), []);
    assert.deepEqual(neededParts(stateWith({ panel: '7dni' })), ['sedem']);
    // V prehľade je 7 dní vidieť aj z karty Môžem?.
    assert.deepEqual(neededParts(stateWith({ layout: 'wide' })), ['sedem']);
    assert.deepEqual(neededParts(stateWith({ poster: 'mesiac' })), ['statistika']);
    const incoming = /** @type {any} */ ({});
    assert.deepEqual(neededParts(stateWith({ incoming })), ['nastavenie']);
    assert.deepEqual(neededParts(stateWith({ panel: 'nastavenie' })), ['nastavenie']);
});

test('navStep → navStepOf: krok prežije cestu cez históriu', () => {
    const s = stateWith({ panel: 'terazky', terazPreview: 600 });
    assert.deepEqual(navStepOf(navStep(s)), navStep(s));
    const dash = stateWith({ layout: 'wide', panel: '7dni', weekDetail: 'day', poster: 'tyzden' });
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
    assert.equal(navStepOf({ panel: 'mozem', item: 'raketa' }), null);
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
    // Plagát len Môžem? a Štatistike.
    assert.equal(field({ panel: 'terazky', poster: 'tyzden' }, 'poster'), null);
    assert.equal(field({ panel: 'statistika', poster: 'tyzden' }, 'poster'), 'tyzden');
    assert.equal(field({ panel: 'mozem', poster: 'storočie' }, 'poster'), null);
    // Okno sekcie Appka len Nastaveniu.
    assert.equal(field({ panel: 'mozem', sheet: 'share' }, 'sheet'), null);
    assert.equal(field({ panel: 'nastavenie', sheet: 'reset' }, 'sheet'), 'reset');
    // Prehľad poznajú len jeho karty.
    assert.equal(field({ panel: 'statistika', dash: true }, 'dash'), undefined);
    assert.equal(field({ panel: 'mozem', dash: 'áno' }, 'dash'), undefined);
    // Panel veci aj skupiny vecí.
    assert.equal(field({ panel: 'mozem', item: 'bojler' }, 'item'), 'bojler');
    assert.equal(field({ panel: 'mozem', item: 'velke' }, 'item'), 'velke');
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

test('navChange: v prehľade návrat na krok prehľadu nechá aktívny stĺpec', () => {
    const wide = stateWith({ layout: 'wide', panel: 'terazky' });
    assert.equal(navChange(wide, step({ panel: 'mozem', dash: true })).panel, 'terazky');
    assert.equal(navChange(wide, step({ panel: 'mozem' })).panel, 'mozem');
    // Na úzkej obrazovke krok prehľadu vráti jeho kartu.
    assert.equal(navChange(stateWith({ panel: 'terazky' }), step({ panel: 'mozem', dash: true })).panel, 'mozem');
});

test('swipeTarget: na telefóne listuje karty, na kraji nikam', () => {
    assert.equal(/** @type {any} */ (swipeTarget(stateWith(), -50)).panel, 'terazky');
    assert.equal(swipeTarget(stateWith(), 50), null);
    assert.equal(/** @type {any} */ (swipeTarget(stateWith({ panel: 'terazky' }), 50)).panel, 'mozem');
    assert.equal(swipeTarget(stateWith({ panel: 'nastavenie' }), -50), null);
});

test('swipeTarget: počas sprievodcu nastavením nevedie nikam', () => {
    assert.equal(swipeTarget(stateWith({ panel: 'nastavenie', setupStep: 'lokalita' }), 50), null);
});

test('swipeTarget: v detaile dňa listuje dni, z kraja doprava vedie späť do prehľadu', () => {
    const day = (/** @type {number} */ weekDay) => stateWith({ panel: '7dni', weekDetail: 'day', weekDay, forecast: forecastOf(7) });
    assert.deepEqual(swipeTarget(day(2), -50), { weekDay: 3 });
    assert.deepEqual(swipeTarget(day(2), 50), { weekDay: 1 });
    assert.equal(swipeTarget(day(0), 50), 'back');
    assert.equal(swipeTarget(day(6), -50), null);
    const week = stateWith({ panel: '7dni', weekDetail: 'week', forecast: forecastOf(7) });
    assert.equal(swipeTarget(week, 50), 'back');
    assert.equal(swipeTarget(week, -50), null);
    // Bez predpovede detail nie je čo listovať - ťah listuje karty.
    assert.equal(/** @type {any} */ (swipeTarget(stateWith({ panel: '7dni', weekDetail: 'day' }), 50)).panel, 'terazky');
});

test('swipeTarget: v prehľade karty nelistuje, dni len ťahom v stĺpci 7 dní', () => {
    const wide = stateWith({ layout: 'wide', panel: 'mozem', weekDetail: 'day', weekDay: 2, forecast: forecastOf(7) });
    assert.deepEqual(swipeTarget(wide, -50, '7dni'), { weekDay: 3 });
    assert.equal(swipeTarget(wide, -50, 'mozem'), null);
    assert.equal(swipeTarget(wide, -50), null);
    assert.equal(swipeTarget(stateWith({ layout: 'wide' }), -50, 'mozem'), null);
});
