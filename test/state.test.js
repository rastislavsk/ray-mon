import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STALE_PV_MS } from '../shared/config.js';
import { demoSettings } from '../shared/settings.js';
import {
    createStore,
    initialState,
    navChange,
    navPrevFrom,
    navStep,
    navStepFrom,
    nextPanel,
    nextPv,
    nextWeekDay,
    panelChange,
    sameNavStep,
    savedSettings,
    setupDraft,
} from '../web/state.js';

test('setState zlúči zmenu a zavolá odberateľa presne raz', () => {
    const store = createStore(
        initialState(new Date('2026-09-05T11:00:00Z'), { wide: false, tall: false }, { settings: demoSettings(), demo: true }),
    );
    let calls = 0;
    store.subscribe(() => calls++);
    store.setState({ panel: '7dni', weekSelDay: 3 });
    assert.equal(calls, 1);
    assert.equal(store.get().panel, '7dni');
    assert.equal(store.get().weekSelDay, 3);
    assert.equal(store.get().verdictPage, 0, 'verdikt začína na prvej stránke');
    // Rozmery okna prichádzajú zvonku, stav si ich nedomýšľa.
    assert.equal(store.get().wide, false);
    assert.equal(store.get().tall, false);
});

test('rovnaké hodnoty nespustia prekreslenie, odhlásenie funguje', () => {
    const store = createStore(initialState(new Date(), { wide: true, tall: true }, { settings: demoSettings(), demo: true }));
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.setState({ panel: 'terazky', wide: true });
    assert.equal(calls, 0);
    off();
    store.setState({ panel: 'nastavenie' });
    assert.equal(calls, 0);
});

test('stav nesie tarifu uloženého nastavenia a savedSettings ju vráti spolu s elektrárňou', () => {
    const settings = demoSettings();
    const state = initialState(new Date(), { wide: false, tall: false }, { settings, demo: true });
    assert.equal(state.tariff, settings.tariff);
    assert.deepEqual(savedSettings(state), settings);
});

test('poradie kariet pri listovaní prstom: na kraji sa nezacyklí', () => {
    assert.equal(nextPanel('terazky', 1), '7dni');
    assert.equal(nextPanel('7dni', 1), 'nastavenie');
    assert.equal(nextPanel('nastavenie', 1), 'info');
    assert.equal(nextPanel('info', 1), null, 'za poslednou kartou už nič nie je');
    assert.equal(nextPanel('7dni', -1), 'terazky');
    assert.equal(nextPanel('terazky', -1), null, 'pred prvou kartou už nič nie je');
});

test('poradie dní v detaile dňa: na kraji týždňa sa nezacyklí', () => {
    assert.equal(nextWeekDay(0, 1, 7), 1);
    assert.equal(nextWeekDay(5, 1, 7), 6);
    assert.equal(nextWeekDay(6, 1, 7), null, 'za posledným dňom týždňa už nič nie je');
    assert.equal(nextWeekDay(3, -1, 7), 2);
    assert.equal(nextWeekDay(0, -1, 7), null, 'pred prvým dňom už nič nie je - von vedie šípka späť');
    assert.equal(nextWeekDay(0, 1, 0), null, 'bez dát nie je kam listovať');
});

test('smer prechodu ide podľa poradia v navigácii, nie podľa toho, ako sa prepínalo', () => {
    assert.deepEqual(panelChange('terazky', '7dni'), { panel: '7dni', panelDir: 1, weekDetail: null, infoOpen: null });
    assert.deepEqual(panelChange('nastavenie', '7dni'), { panel: '7dni', panelDir: -1, weekDetail: null, infoOpen: null });
    assert.equal(panelChange('terazky', 'nastavenie').panelDir, 1);
    assert.equal(panelChange('nastavenie', 'terazky').panelDir, -1);
});

test('krok navigácie pre tlačidlo Späť je karta, otvorený detail, obrazovka sprievodcu a položka Info, nič iné', () => {
    const state = initialState(new Date(), { wide: false, tall: false }, { settings: demoSettings(), demo: true });
    assert.deepEqual(navStep(state), { panel: 'terazky', weekDetail: null, setup: null, roof: 0, info: null });
    // Vybraný deň ani stránka verdiktu nie sú miesto v appke - Späť sa na ne nevracia.
    assert.ok(sameNavStep(navStep(state), navStep({ ...state, weekSelDay: 4, verdictPage: 2 })));
    assert.ok(!sameNavStep(navStep(state), navStep({ ...state, panel: '7dni' })));
    assert.ok(!sameNavStep(navStep(state), navStep({ ...state, weekDetail: 'day' })));
    // Detail dňa a detail týždňa sú dve rôzne miesta, nie jedno "otvorené".
    assert.ok(!sameNavStep(navStep({ ...state, weekDetail: 'day' }), navStep({ ...state, weekDetail: 'week' })));
    // Obrazovka sprievodcu aj plocha, ktorej sa týka, sú krok - Späť na telefóne vracia o ne.
    assert.ok(!sameNavStep(navStep(state), navStep({ ...state, setupStep: 'smer' })));
    assert.ok(!sameNavStep(navStep({ ...state, setupStep: 'smer' }), navStep({ ...state, setupStep: 'smer', setupRoof: 1 })));
    // Rozbalená položka karty Info je krok - Späť na telefóne ju zbalí a vráti na zoznam.
    assert.ok(!sameNavStep(navStep({ ...state, panel: 'info' }), navStep({ ...state, panel: 'info', infoOpen: 'share' })));
    assert.ok(!sameNavStep(navStep({ ...state, infoOpen: 'guide' }), navStep({ ...state, infoOpen: 'share' })));
    // Rozpísané údaje v sprievodcovi krokom nie sú.
    assert.ok(sameNavStep(navStep(state), navStep({ ...state, setupLink: 'x', setupKwp: 5 })));
});

test('Späť obnoví kartu aj otvorený detail, smer prechodu ide podľa poradia', () => {
    assert.deepEqual(navChange('nastavenie', { panel: '7dni', weekDetail: 'day', setup: null, roof: 0, info: null }), {
        panel: '7dni',
        panelDir: -1,
        weekDetail: 'day',
        setupStep: null,
        setupRoof: 0,
        infoOpen: null,
        setupReturn: null,
    });
    // Na rozdiel od panelChange sa detail nezatvára, ale nastavuje na to, čo v kroku bolo.
    assert.deepEqual(navChange('terazky', { panel: '7dni', weekDetail: 'week', setup: null, roof: 0, info: null }), {
        panel: '7dni',
        panelDir: 1,
        weekDetail: 'week',
        setupStep: null,
        setupRoof: 0,
        infoOpen: null,
        setupReturn: null,
    });
    // Späť v sprievodcovi: obrazovka a plocha. Úpravu jedného kroku ukončí až návrat na
    // zhrnutie alebo prehľad, nie krok medzi obrazovkami úpravy.
    const smer = navChange('nastavenie', { panel: 'nastavenie', weekDetail: null, setup: 'smer', roof: 1, info: null });
    assert.equal(smer.setupStep, 'smer');
    assert.equal(smer.setupRoof, 1);
    assert.equal('setupReturn' in smer, false);
    assert.equal(navChange('nastavenie', { panel: 'nastavenie', weekDetail: null, setup: 'suhrn', roof: 0, info: null }).setupReturn, null);
    // Späť v karte Info: položka sa nastaví na to, čo v kroku bolo (null = zoznam).
    assert.equal(navChange('info', { panel: 'info', weekDetail: null, setup: null, roof: 0, info: 'guide' }).infoOpen, 'guide');
    assert.equal(navChange('info', { panel: 'info', weekDetail: null, setup: null, roof: 0, info: null }).infoOpen, null);
});

test('položka histórie sa číta len ak naozaj nesie krok navigácie', () => {
    const krok = (/** @type {object} */ x) => ({ panel: '7dni', weekDetail: null, setup: null, roof: 0, info: null, ...x });
    assert.deepEqual(navStepFrom({ step: krok({ weekDetail: 'day' }) }), krok({ weekDetail: 'day' }));
    assert.deepEqual(navStepFrom({ step: krok({ weekDetail: 'week' }) }), krok({ weekDetail: 'week' }));
    assert.deepEqual(
        navStepFrom({ step: krok({ panel: 'nastavenie', setup: 'pocet', roof: 2 }) }),
        krok({ panel: 'nastavenie', setup: 'pocet', roof: 2 }),
    );
    assert.deepEqual(navStepFrom({ step: krok({ panel: 'info', info: 'share' }) }), krok({ panel: 'info', info: 'share' }));
    assert.equal(navStepFrom({ step: krok({ panel: 'info', info: 'neznama' }) }), null, 'položka Info, ktorá neexistuje');
    // Položka zo staršej verzie appky sprievodcu ani položky Info nepozná - je to prehľad karty.
    assert.deepEqual(navStepFrom({ step: { panel: '7dni', weekDetail: null } }), krok({}));
    assert.equal(navStepFrom({ step: krok({ setup: 'neznamy' }) }), null, 'obrazovka, ktorá neexistuje');
    assert.equal(navStepFrom({ step: krok({ roof: -1 }) }), null, 'plocha mimo poradia');
    // Odkiaľ sa do položky prišlo, nesie `prev` - podľa neho ide „Späť“ v sprievodcovi cez históriu.
    assert.deepEqual(navPrevFrom({ step: krok({}), prev: krok({ setup: 'start' }) }), krok({ setup: 'start' }));
    assert.equal(navPrevFrom({ step: krok({}) }), null);
    assert.equal(navPrevFrom(null), null);
    assert.equal(navStepFrom(null), null, 'cudzia položka bez stavu');
    assert.equal(navStepFrom({ scrollTop: 10 }), null, 'položka od niekoho iného');
    assert.equal(navStepFrom({ step: { panel: 'neznama', weekDetail: null } }), null, 'karta, ktorá už neexistuje');
    assert.equal(navStepFrom({ step: { panel: '7dni' } }), null, 'neúplný krok');
    // Položka zo staršej verzie appky nesie true/false - tú už appka prečítať nevie.
    assert.equal(navStepFrom({ step: { panel: '7dni', weekDetail: true } }), null, 'krok zo staršej verzie');
});

test('nextPv: pri výpadku kiosku ostáva posledné meranie, no nie staršie než STALE_PV_MS', () => {
    const t0 = new Date('2026-09-05T11:00:00Z');
    const stare = /** @type {import('../shared/kiosk.js').PvData} */ ({ realTimePowerKw: 5, updatedAt: t0.toISOString() });
    const nove = /** @type {import('../shared/kiosk.js').PvData} */ ({ realTimePowerKw: 6, updatedAt: t0.toISOString() });
    const o = (/** @type {number} */ ms) => new Date(t0.getTime() + ms);
    assert.equal(nextPv(stare, { pv: nove, pvFailed: false }, o(60_000)), nove, 'nové meranie vyhráva');
    assert.equal(nextPv(stare, { pv: null, pvFailed: true }, o(60_000)), stare, 'jedna nevydarená minúta');
    assert.equal(nextPv(stare, { pv: null, pvFailed: true }, o(STALE_PV_MS)), stare, 'presne na hranici ešte áno');
    assert.equal(nextPv(stare, { pv: null, pvFailed: true }, o(STALE_PV_MS + 1)), null, 'staršie by sa tvárilo ako "teraz"');
    assert.equal(nextPv(stare, { pv: null, pvFailed: false }, o(60_000)), null, 'bez kiosku sa nemá čo nechávať');
    assert.equal(nextPv(null, { pv: null, pvFailed: true }, o(60_000)), null);
});

test('setupDraft: bez živého merania sa kiosk neukladá, celkový výkon sa rozpočíta na panel', () => {
    const kiosk = 'https://region01eu5.fusionsolar.huawei.com/pvmswebsite/nologin/assets/build/index.html#/kiosk?kk=Abc123xyz';
    const base = demoSettings();
    const state = initialState(new Date(), { wide: false, tall: false }, { settings: { ...base, kiosk }, demo: false });
    assert.equal(state.setupLive, true, 'uložený kiosk znamená, že meranie človek chce');
    assert.equal(setupDraft(state).kiosk, kiosk);
    assert.equal(setupDraft({ ...state, setupLive: false }).kiosk, '');
    // Ukážka má 12 panelov: 6 kWp je 500 Wp na panel.
    assert.equal(setupDraft({ ...state, setupKwp: 6 }).plant.panelWp, 500);
    assert.equal(setupDraft(state).plant.panelWp, base.plant.panelWp, 'bez celkového výkonu ostáva zadaný výkon panelu');
});
