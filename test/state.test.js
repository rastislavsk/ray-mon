import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SITE, STALE_PV_MS } from '../shared/config.js';
import { typicalSettings } from '../shared/settings.js';
import {
    createStore,
    initialState,
    isWelcome,
    navChange,
    navPrevFrom,
    navStep,
    navStepFrom,
    nextPv,
    panelChange,
    sameNavStep,
    savedSettings,
    setupDraft,
} from '../web/state.js';

test('setState zlúči zmenu a zavolá odberateľa presne raz', () => {
    const store = createStore(initialState(new Date('2026-09-05T11:00:00Z'), { wide: false, tall: false }, { site: SITE }));
    let calls = 0;
    store.subscribe(() => calls++);
    store.setState({ panel: '7dni', weekSelDay: 3 });
    assert.equal(calls, 1);
    assert.equal(store.get().panel, '7dni');
    assert.equal(store.get().weekSelDay, 3);
    // Rozmery okna prichádzajú zvonku, stav si ich nedomýšľa.
    assert.equal(store.get().wide, false);
    assert.equal(store.get().tall, false);
});

test('rovnaké hodnoty nespustia prekreslenie, odhlásenie funguje', () => {
    const store = createStore(initialState(new Date(), { wide: true, tall: true }, { site: SITE }));
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.setState({ panel: 'terazky', wide: true });
    assert.equal(calls, 0);
    off();
    store.setState({ panel: 'nastavenie' });
    assert.equal(calls, 0);
});

test('stav nesie tarifu uloženého nastavenia a savedSettings ju vráti spolu s elektrárňou', () => {
    const settings = typicalSettings(SITE);
    const state = initialState(new Date(), { wide: false, tall: false }, { saved: settings });
    assert.equal(state.tariff, settings.tariff);
    assert.deepEqual(savedSettings(state), settings);
});

test('bez polohy appka začína otázkou na ňu v karte Nastavenie, s polohou vždy na karte Teraz', () => {
    const now = new Date();
    const layout = { wide: false, tall: false };
    const welcome = initialState(now, layout, {});
    assert.equal(welcome.known, 'nic');
    assert.equal(welcome.panel, 'nastavenie');
    assert.equal(welcome.setupStep, 'lokalita');
    assert.equal(welcome.site.name, '', 'poloha je prázdna, kým ju človek nevyberie');
    const site = initialState(now, layout, { site: SITE });
    assert.equal(site.known, 'poloha');
    assert.equal(site.plant.strings.length, 1, 'typická strecha v uloženej polohe');
    assert.equal(initialState(now, layout, { saved: typicalSettings(SITE), site: SITE }).known, 'elektraren', 'uložená elektráreň vyhrá');
    assert.equal(site.panel, 'terazky');
    assert.equal(initialState(now, layout, { saved: typicalSettings(SITE) }).panel, 'terazky');
    assert.equal(site.setupStep, null);
    assert.equal(isWelcome(welcome, welcome.setupStep), true);
    assert.equal(isWelcome(welcome, 'odkaz'), false, 'vloženie odkazu je bežná obrazovka sprievodcu');
    assert.equal(isWelcome(site, 'lokalita'), false, 'zmena polohy už nie je prvé otvorenie');
});

test('smer prechodu ide podľa poradia v navigácii, nie podľa toho, ako sa prepínalo', () => {
    assert.deepEqual(panelChange('terazky', '7dni'), {
        panel: '7dni',
        panelDir: 1,
        weekDetail: null,
        infoOpen: null,
        tzPlanOpen: false,
        tzListOpen: false,
        stavTip: false,
    });
    assert.deepEqual(panelChange('nastavenie', '7dni'), {
        panel: '7dni',
        panelDir: -1,
        weekDetail: null,
        infoOpen: null,
        tzPlanOpen: false,
        tzListOpen: false,
        stavTip: false,
    });
    assert.equal(panelChange('terazky', 'nastavenie').panelDir, 1);
    assert.equal(panelChange('nastavenie', 'terazky').panelDir, -1);
    assert.equal(panelChange('7dni', 'statistika').panelDir, 1);
    assert.equal(panelChange('nastavenie', 'statistika').panelDir, -1);
});

test('krok navigácie pre tlačidlo Späť je karta, otvorený detail, obrazovka sprievodcu a položka Info, nič iné', () => {
    const state = initialState(new Date(), { wide: false, tall: false }, { site: SITE });
    assert.deepEqual(navStep(state), {
        panel: 'terazky',
        weekDetail: null,
        setup: null,
        roof: 0,
        info: null,
        plan: false,
        legend: false,
    });
    // Vybraný deň, stránka pásu odporúčaní ani náhľad času nie sú miesto v appke - Späť sa na ne nevracia.
    assert.ok(sameNavStep(navStep(state), navStep({ ...state, weekSelDay: 4, previewMinutes: 600 })));
    assert.ok(!sameNavStep(navStep(state), navStep({ ...state, panel: '7dni' })));
    assert.ok(!sameNavStep(navStep(state), navStep({ ...state, weekDetail: 'day' })));
    // Detail dňa a detail týždňa sú dve rôzne miesta, nie jedno "otvorené".
    assert.ok(!sameNavStep(navStep({ ...state, weekDetail: 'day' }), navStep({ ...state, weekDetail: 'week' })));
    // Obrazovka sprievodcu aj plocha, ktorej sa týka, sú krok - Späť na telefóne vracia o ne.
    assert.ok(!sameNavStep(navStep(state), navStep({ ...state, setupStep: 'smer' })));
    assert.ok(!sameNavStep(navStep({ ...state, setupStep: 'smer' }), navStep({ ...state, setupStep: 'smer', setupRoof: 1 })));
    // Rozbalená položka sekcie Appka je krok - Späť na telefóne ju zbalí a vráti na zoznam.
    assert.ok(!sameNavStep(navStep({ ...state, panel: 'nastavenie' }), navStep({ ...state, panel: 'nastavenie', infoOpen: 'share' })));
    assert.ok(!sameNavStep(navStep({ ...state, infoOpen: null }), navStep({ ...state, infoOpen: 'share' })));
    // Rozpísané údaje v sprievodcovi krokom nie sú.
    assert.ok(sameNavStep(navStep(state), navStep({ ...state, setupLink: 'x', setupKwp: 5 })));
});

test('Späť obnoví kartu aj otvorený detail, smer prechodu ide podľa poradia', () => {
    assert.deepEqual(
        navChange('nastavenie', {
            panel: '7dni',
            weekDetail: 'day',
            setup: null,
            roof: 0,
            info: null,
            plan: false,
            legend: false,
        }),
        {
            panel: '7dni',
            panelDir: -1,
            weekDetail: 'day',
            setupStep: null,
            setupRoof: 0,
            infoOpen: null,
            tzPlanOpen: false,
            tzListOpen: false,
            stavTip: false,
            setupReturn: null,
        },
    );
    // Na rozdiel od panelChange sa detail nezatvára, ale nastavuje na to, čo v kroku bolo.
    assert.deepEqual(
        navChange('terazky', {
            panel: '7dni',
            weekDetail: 'week',
            setup: null,
            roof: 0,
            info: null,
            plan: false,
            legend: false,
        }),
        {
            panel: '7dni',
            panelDir: 1,
            weekDetail: 'week',
            setupStep: null,
            setupRoof: 0,
            infoOpen: null,
            tzPlanOpen: false,
            tzListOpen: false,
            stavTip: false,
            setupReturn: null,
        },
    );
    // Späť v sprievodcovi: obrazovka a plocha. Úpravu jedného kroku ukončí až návrat na
    // zhrnutie alebo prehľad, nie krok medzi obrazovkami úpravy.
    const smer = navChange('nastavenie', {
        panel: 'nastavenie',
        weekDetail: null,
        setup: 'smer',
        roof: 1,
        info: null,
        plan: false,
        legend: false,
    });
    assert.equal(smer.setupStep, 'smer');
    assert.equal(smer.setupRoof, 1);
    assert.equal('setupReturn' in smer, false);
    assert.equal(
        navChange('nastavenie', {
            panel: 'nastavenie',
            weekDetail: null,
            setup: 'suhrn',
            roof: 0,
            info: null,
            plan: false,
            legend: false,
        }).setupReturn,
        null,
    );
    // Späť v karte Info: položka sa nastaví na to, čo v kroku bolo (null = zoznam).
    assert.equal(
        navChange('nastavenie', {
            panel: 'nastavenie',
            weekDetail: null,
            setup: null,
            roof: 0,
            info: 'share',
            plan: false,
            legend: false,
        }).infoOpen,
        'share',
    );
    assert.equal(
        navChange('nastavenie', {
            panel: 'nastavenie',
            weekDetail: null,
            setup: null,
            roof: 0,
            info: null,
            plan: false,
            legend: false,
        }).infoOpen,
        null,
    );
});

test('Plán dňa: pri štarte zbalený, otvorený je krok navigácie, s kartou sa zbalí', () => {
    const state = initialState(new Date(), { wide: false, tall: false }, { site: SITE });
    assert.equal(state.tzPlanOpen, false);
    const open = { ...state, tzPlanOpen: true };
    assert.equal(navStep(open).plan, true);
    // Otvorenie je nový krok - Späť ho zbalí.
    assert.ok(!sameNavStep(navStep(state), navStep(open)));
    assert.deepEqual(navStepFrom({ step: navStep(open) }), navStep(open));
    // Plán patrí len karte Teraz; položka zo staršej verzie ho nemá - plán je zbalený.
    /** @type {import('../web/state.js').NavStep} */
    const krok = { panel: 'mozem', weekDetail: null, setup: null, roof: 0, info: null, plan: false, legend: false };
    assert.equal(navStepFrom({ step: { ...krok, plan: true } })?.plan, false);
    assert.equal(navStepFrom({ step: { ...krok, panel: 'terazky', plan: 'áno' } })?.plan, false);
    assert.equal(navStepFrom({ step: { panel: 'terazky', weekDetail: null } })?.plan, false);
    // Späť na krok so zbaleným plánom ho zbalí, na krok s otvoreným ho otvorí; iná karta ho zbalí.
    assert.equal(navChange('terazky', { ...krok, panel: 'terazky' }).tzPlanOpen, false);
    assert.equal(navChange('mozem', { ...krok, panel: 'terazky', plan: true }).tzPlanOpen, true);
    assert.equal(panelChange('terazky', 'mozem').tzPlanOpen, false);
});

test('zoznam pod grafom (legenda): otvorený je krok navigácie, Späť a iná karta ho zbalia', () => {
    const state = initialState(new Date(), { wide: false, tall: false }, { site: SITE });
    assert.equal(state.tzListOpen, false);
    const open = { ...state, tzListOpen: true };
    assert.equal(navStep(open).legend, true);
    assert.ok(!sameNavStep(navStep(state), navStep(open)));
    assert.deepEqual(navStepFrom({ step: navStep(open) }), navStep(open));
    /** @type {import('../web/state.js').NavStep} */
    const krok = { panel: 'terazky', weekDetail: null, setup: null, roof: 0, info: null, plan: false, legend: false };
    assert.equal(navStepFrom({ step: { ...krok, panel: 'mozem', legend: true } })?.legend, false);
    assert.equal(navStepFrom({ step: { panel: 'terazky', weekDetail: null } })?.legend, false);
    assert.equal(navChange('terazky', krok).tzListOpen, false);
    assert.equal(navChange('mozem', { ...krok, legend: true }).tzListOpen, true);
    assert.equal(panelChange('terazky', 'mozem').tzListOpen, false);
});

test('položka histórie sa číta len ak naozaj nesie krok navigácie', () => {
    const krok = (/** @type {object} */ x) => ({
        panel: '7dni',
        weekDetail: null,
        setup: null,
        roof: 0,
        info: null,
        plan: false,
        legend: false,
        ...x,
    });
    // Položka zo staršej verzie s otvoreným súhrnom na zdieľanie (presunul sa do Štatistiky) vráti kartu bez neho.
    assert.deepEqual(navStepFrom({ step: krok({ panel: 'mozem', summary: true }) }), krok({ panel: 'mozem' }));
    // Panel veci karty Môžem? zanikol s jej dlaždicami - položka, ktorá ho nesie, vráti kartu.
    assert.deepEqual(navStepFrom({ step: krok({ panel: 'mozem', item: 'velke' }) }), krok({ panel: 'mozem' }));
    // Položka zo staršej verzie so zrušeným zoznamom vecí sa vráti na kartu.
    assert.deepEqual(navStepFrom({ step: { ...krok({ panel: 'mozem' }), list: true } }), krok({ panel: 'mozem' }));
    // Položka zo staršej verzie s otvoreným popupom k ciferníku (zanikol) vráti kartu bez neho.
    assert.deepEqual(navStepFrom({ step: { ...krok({ panel: 'terazky' }), guide: true } }), krok({ panel: 'terazky' }));
    assert.deepEqual(navStepFrom({ step: krok({ weekDetail: 'day' }) }), krok({ weekDetail: 'day' }));
    assert.deepEqual(navStepFrom({ step: krok({ weekDetail: 'week' }) }), krok({ weekDetail: 'week' }));
    assert.deepEqual(
        navStepFrom({ step: krok({ panel: 'nastavenie', setup: 'pocet', roof: 2 }) }),
        krok({ panel: 'nastavenie', setup: 'pocet', roof: 2 }),
    );
    for (const info of ['plant', 'oznamenia', 'share', 'clear'])
        assert.deepEqual(navStepFrom({ step: krok({ panel: 'nastavenie', info }) }), krok({ panel: 'nastavenie', info }), info);
    assert.equal(navStepFrom({ step: krok({ panel: 'nastavenie', info: 'neznama' }) }), null, 'položka, ktorá neexistuje');
    // Položka histórie zo staršej verzie so zrušenou kartou Info je cudzia - Späť odíde zo stránky.
    assert.equal(navStepFrom({ step: krok({ panel: 'info', info: 'share' }) }), null, 'zrušená karta Info');
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

test('setupDraft: bez živého merania sa pripojenie neukladá, celkový výkon sa rozpočíta na panel', () => {
    const zdroj = { sposob: 'huawei-kiosk', pecat: 'v1.AbCdEfGhIjKlMnOpQrStUvWxYz012345', nazov: 'Dvorany' };
    const base = typicalSettings(SITE);
    const state = initialState(new Date(), { wide: false, tall: false }, { saved: { ...base, zdroj } });
    assert.equal(state.setupLive, true, 'pripojené meranie znamená, že ho človek chce');
    assert.deepEqual(setupDraft(state).zdroj, zdroj);
    assert.equal(setupDraft({ ...state, setupLive: false }).zdroj, null);
    // Typická strecha má 12 panelov: 6 kWp je 500 Wp na panel.
    assert.equal(setupDraft({ ...state, setupKwp: 6 }).plant.panelWp, 500);
    assert.equal(setupDraft(state).plant.panelWp, base.plant.panelWp, 'bez celkového výkonu ostáva zadaný výkon panelu');
});
