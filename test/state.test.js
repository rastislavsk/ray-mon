// Stav (web/state.js): tlačidlo Späť, prehľad so
// stĺpcami a časti appky, ktoré obrazovka potrebuje.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SITE } from '../shared/config.js';
import { backAction } from '../shared/setup-flow.js';
import { dashboard, initialState, layoutOf, neededParts, panelChange, ready, shows, spatZmena, zOznamenia } from '../web/state.js';

/** @typedef {import('../web/state.js').AppState} AppState */

const NOW = new Date('2026-09-05T11:00:00Z');

/** Stav s typickou strechou v SITE, prípadne so zmenami. @param {Partial<AppState>} [patch] @returns {AppState} */
function stateWith(patch = {}) {
    const s = initialState(NOW, { saved: null, site: SITE, dayLog: {}, online: true });
    return { ...s, panel: 'mozem', ...patch };
}

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

test('spatZmena: na karte Teraz, keď nie je nič otvorené, Späť appku zavrie', () => {
    assert.equal(spatZmena(stateWith({ panel: 'terazky' })), null);
    // V prehľade so stĺpcami je domovom celý prehľad, nech je aktívny ktorýkoľvek stĺpec.
    assert.equal(spatZmena(stateWith({ layout: 'wide', panel: 'mozem' })), null);
    assert.equal(spatZmena(stateWith({ layout: 'wide', panel: '7dni' })), null);
});

test('spatZmena: z inej karty vedie Späť na Teraz, nie na kartu, kde bol človek predtým', () => {
    for (const panel of /** @type {const} */ (['mozem', 'radar', '7dni', 'statistika', 'nastavenie'])) {
        assert.deepEqual(spatZmena(stateWith({ panel })), panelChange(panel, 'terazky'));
    }
    // Štatistika a Nastavenie sú aj na širokej obrazovke samostatná stránka.
    assert.equal(spatZmena(stateWith({ layout: 'wide', panel: 'statistika' }))?.panel, 'terazky');
});

test('spatZmena: najprv zavrie, čo je otvorené - vždy jednu vec, zvnútra von', () => {
    /** @param {Partial<AppState>} patch */
    const po = (patch) => {
        const s = stateWith(patch);
        return { ...s, ...spatZmena(s) };
    };
    assert.equal(po({ panel: 'terazky', stavTip: true, tzVec: 'pracka' }).stavTip, false);
    assert.equal(po({ panel: 'terazky', stavTip: true, tzVec: 'pracka' }).tzVec, 'pracka');
    assert.equal(po({ panel: 'terazky', tzCisla: 'tuk' }).tzCisla, null);
    // Čísla, ktoré sa ukázali samy po príchode na Teraz, nikto neotvoril: Späť z Teraz appku zavrie.
    assert.equal(spatZmena(stateWith({ panel: 'terazky', tzCisla: 'prichod' })), null);
    assert.equal(po({ panel: 'terazky', tzVec: 'pracka', tzDen: 2 }).tzVec, null);
    assert.equal(po({ panel: 'terazky', tzVec: 'pracka', tzDen: 2 }).tzDen, 2);
    assert.equal(po({ panel: 'terazky', tzChip: 'stav' }).tzChip, null);
    // Iný deň v páse dní: Späť vráti dnešok, až ďalšie zavrie appku.
    const den = po({ panel: 'terazky', tzDen: 3 });
    assert.equal(den.tzDen, 0);
    assert.equal(spatZmena(den), null);
    assert.equal(po({ mzChip: 'zajtra' }).mzChip, null);
    // Graf dňa sa zavrie aj so zvoleným časom.
    const graf = po({ mzGraf: true, terazPreview: 600 });
    assert.equal(graf.mzGraf, false);
    assert.equal(graf.terazPreview, null);
    assert.equal(graf.panel, 'mozem');
    assert.equal(po({ panel: '7dni', weekDetail: 'day' }).weekDetail, null);
    assert.equal(po({ panel: '7dni', weekDetail: 'day' }).panel, '7dni');
    assert.equal(po({ panel: 'nastavenie', nsOpen: 'vzhlad', appSheet: 'share' }).appSheet, null);
    assert.equal(po({ panel: 'nastavenie', nsOpen: 'vzhlad', appSheet: 'share' }).nsOpen, 'vzhlad');
    assert.equal(po({ panel: 'nastavenie', nsOpen: 'vzhlad' }).nsOpen, null);
    // V prehľade so stĺpcami zavrie aj to, čo je otvorené v inom než aktívnom stĺpci.
    assert.equal(po({ layout: 'wide', panel: 'mozem', weekDetail: 'week' }).weekDetail, null);
});

test('spatZmena: v sprievodcovi ide o obrazovku späť ako jeho tlačidlo Späť', () => {
    const s = stateWith({ panel: 'nastavenie', setupStep: 'sklon', setupRoof: 0 });
    assert.deepEqual(spatZmena(s), /** @type {any} */ (backAction(s)).patch);
    // Kým appka nepozná polohu, otázka na ňu patrí karte - Späť z nej ide na Teraz.
    const nic = initialState(NOW, { saved: null, site: null, dayLog: {}, online: true });
    const lokalita = { ...nic, panel: /** @type {const} */ ('nastavenie') };
    assert.equal(lokalita.setupStep, 'lokalita');
    assert.equal(spatZmena(lokalita)?.panel, 'terazky');
    assert.equal(spatZmena({ ...lokalita, setupStep: 'start' })?.setupStep, 'lokalita');
    // Sprievodca nechaný otvorený na inej karte tú kartu nezdrží.
    assert.equal(spatZmena(stateWith({ panel: 'radar', setupStep: 'sklon' }))?.panel, 'terazky');
});

test('sekcie Nastavenia a okná na kartách: pri štarte zatvorené, s kartou sa zatvoria', () => {
    const s = stateWith();
    assert.equal(s.nsOpen, null);
    assert.equal(s.tzVec, null);
    assert.equal(s.tzChip, null);
    for (const k of /** @type {const} */ (['nsOpen', 'tzVec', 'tzChip', 'mzChip', 'weekDetail', 'appSheet'])) {
        assert.equal(panelChange('terazky', 'mozem')[k], null);
    }
    assert.equal(panelChange('mozem', 'terazky').mzGraf, false);
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
    // Obrys nie je nič, čo by Späť zatváralo, a s kartou zhasne, aj keď ešte čakal na dáta.
    assert.equal(spatZmena(po), null);
    assert.equal(panelChange('terazky', 'mozem').tzObrys, false);
    assert.equal(stateWith().tzObrys, false);
});
