// Poslucháče sprievodcu nastavením, spoločné pre obe appky. Obrazovky sprievodcu majú v oboch
// appkách tie isté id a data- atribúty, takže ich obsluhuje ten istý kód; čo tlačidlo urobí,
// je v shared/setup-flow.js. Tu je len to, čo čistá funkcia nevie: pole formulára, prst na
// kruhu tarify, vyhľadávanie polohy a uloženie do prehliadača.
//
// Modul je neutrálny (pravidlo v CLAUDE.md): nesiaha na stav ani DOM žiadnej z appiek, všetko
// dostane od volajúceho - súčasná appka vo web/setup-interactions.js, nová v obloha/web/.

import { RING, minutesFromAngle } from '../shared/chart-model.js';
import { SEARCH_DEBOUNCE_MS, TARIFF_LIMITS } from '../shared/config.js';
import { checkSettings, typicalSettings } from '../shared/settings.js';
import * as flow from '../shared/setup-flow.js';
import { searchPlaces } from './data.js';
import { saveSettings, saveSite } from './storage.js';

/** @typedef {import('../shared/setup-flow.js').SetupState} SetupState */
/** @typedef {import('../shared/setup-flow.js').SetupPatch} SetupPatch */
/** @typedef {import('../shared/settings.js').Settings} Settings */
/** @typedef {{ get: () => SetupState, setState: (patch: SetupPatch) => void }} SetupStore */
/**
 * Čo sprievodca potrebuje od appky. `back` je krok späť (cez históriu, ak sa dá), `refresh`
 * stiahne dáta pre novú elektráreň, `skip` je zmena stavu pri odložení panelov („Teraz nie,
 * ukáž predpoveď“ - kam appka prejde).
 * @typedef {{ back: (patch: SetupPatch) => void, refresh: () => Promise<void>, skip: () => object }} SetupApp
 */
/**
 * Polia sprievodcu, ktoré appka v stránke má. Kruh tarify je `<svg>`, ktoré sa pri prekreslení
 * nemení (render píše len do jeho `<g>`), takže drží zachytený prst celý ťah.
 * @typedef {{ root: HTMLElement, wzLink: HTMLInputElement, wzPlace: HTMLInputElement, wzLat: HTMLInputElement,
 *   wzLon: HTMLInputElement, wzWp: HTMLInputElement, wzKwp: HTMLInputElement, wzTilt: HTMLInputElement,
 *   wzPanels: HTMLInputElement, wzAc: HTMLInputElement, wzKiosk: HTMLInputElement, wzIvalFrom: HTMLSelectElement,
 *   wzIvalTo: HTMLSelectElement, wzIvalBand: HTMLSelectElement, wzCompass: HTMLElement, wzTariffRing: Element }} SetupFields
 */

/** Číslo z poľa formulára; prijme aj desatinnú čiarku. Prázdne pole je NaN. @param {HTMLInputElement} input */
function numberOf(input) {
    const text = input.value.trim().replace(',', '.');
    return text === '' ? NaN : Number(text);
}

/**
 * Prepne appku na inú elektráreň a stiahne pre ňu predpoveď. Dáta starej elektrárne sa zahodia
 * hneď, aby sa ani na chvíľu nemiešali s novou. `known`: uložená elektráreň, alebo len poloha
 * (typická strecha).
 * @param {{ setState: (patch: any) => void }} store @param {Settings} next @param {'poloha' | 'elektraren'} known
 * @param {() => Promise<void>} refresh @param {object} extra
 */
function switchPlant(store, next, known, refresh, extra) {
    store.setState({
        site: next.site,
        plant: next.plant,
        tariff: next.tariff,
        kiosk: next.kiosk,
        known,
        pv: null,
        forecast: null,
        loading: true,
        now: new Date(),
        ...extra,
    });
    refresh();
}

/**
 * Uloží nastavenie do prehliadača, prepne naň appku a stiahne predpoveď pre novú elektráreň.
 * Volá ho aj prevzatie nastavenia z otvoreného odkazu. `extra` ide do toho istého setState -
 * môže v ňom byť aj zmena mimo sprievodcu (napr. karta).
 * @param {{ get: () => SetupState, setState: (patch: any) => void }} store @param {Settings} next
 * @param {() => Promise<void>} refresh @param {object} [extra]
 */
export function applySettings(store, next, refresh, extra = {}) {
    if (checkSettings(next).errors.length) return;
    if (!saveSettings(next)) {
        store.setState({ settingsNote: 'Uložiť sa nepodarilo. Prehliadač možno nepovoľuje ukladanie dát.' });
        return;
    }
    switchPlant(store, next, 'elektraren', refresh, {
        settingsDraft: next,
        settingsNote: 'Uložené. Prepočítavam predpoveď.',
        settingsRev: store.get().settingsRev + 1,
        setupLive: !!next.kiosk,
        ...extra,
    });
}

/**
 * Uloží samotnú polohu - kto panely ešte nepozná, uvidí aspoň predpoveď pre typickú strechu
 * v nej. Keď prehliadač ukladať nedovolí, appka pokračuje aj tak: polohu si pamätá do zatvorenia,
 * a nabudúce sa na ňu spýta znova.
 * @param {{ setState: (patch: any) => void }} store @param {import('../shared/config.js').Site} site
 * @param {() => Promise<void>} refresh @param {object} extra
 */
function applySite(store, site, refresh, extra) {
    saveSite(site);
    switchPlant(store, typicalSettings(site), 'poloha', refresh, { setupReturn: null, settingsNote: '', ...extra });
}

/** Vykoná, čo rozhodol shared/setup-flow.js. @param {SetupStore} store @param {SetupApp} app @param {import('../shared/setup-flow.js').SetupAction | null} action */
export function runSetupAction(store, app, action) {
    if (!action) return;
    if (action.type === 'back') app.back(action.patch);
    else if (action.type === 'patch') store.setState(action.patch);
    else if (action.type === 'site') applySite(store, action.site, app.refresh, action.extra);
    else applySettings(store, action.settings, app.refresh, action.extra);
}

/** Vyhľadávanie lokality: až keď človek chvíľu nepíše, a počíta sa len posledná odpoveď. @param {SetupStore} store */
function placeSearch(store) {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    let lastId = 0;
    return (/** @type {string} */ query) => {
        clearTimeout(timer);
        const id = ++lastId;
        if (query.length < 2) return store.setState({ geo: { status: 'idle', results: [] } });
        timer = setTimeout(async () => {
            store.setState({ geo: { status: 'loading', results: [] } });
            try {
                const results = await searchPlaces(query);
                if (id === lastId) store.setState({ geo: { status: 'done', results } });
            } catch {
                if (id === lastId) store.setState({ geo: { status: 'error', results: [] } });
            }
        }, SEARCH_DEBOUNCE_MS);
    };
}

/** Kam až od stredu oblúka (RING.rDay) prst maľuje, v jednotkách viewBoxu: dovnútra cez popisy
 * hodín, von cez rysky - prst netreba trafiť presne do tenkého oblúka. */
const PAINT_REACH = { in: 46, out: 30 };

/**
 * Maľovanie po kruhu rozvrhu: prst (alebo myš) prechádza štvrťhodinami a každú prefarbí pásmom,
 * ktorým sa maľuje. Pointer udalosti so zachytením - kruh je úchytka na ťahanie (touch-action:
 * none), takže ani prst nič iné nerobí a po ťuknutí tu nečaká žiadny tooltip.
 * @param {SetupStore} store @param {Element} ring
 */
function initRingPaint(store, ring) {
    // Šírka viewBoxu kruhu (index.html) - prevod pixelov na jednotky, v ktorých je RING.
    const viewW = Number((ring.getAttribute('viewBox') || '').split(' ')[2]);
    /** @type {number | null} */ let last = null;
    /** Štvrťhodina pod prstom, alebo null mimo prstenca. @param {PointerEvent} e */
    const slotAt = (e) => {
        const box = ring.getBoundingClientRect();
        const dx = e.clientX - (box.left + box.width / 2);
        const dy = e.clientY - (box.top + box.height / 2);
        const dist = (Math.hypot(dx, dy) * viewW) / box.width;
        if (dist < RING.rDay - PAINT_REACH.in || dist > RING.rDay + PAINT_REACH.out) return null;
        return Math.floor(minutesFromAngle(dx, dy) / TARIFF_LIMITS.stepMin);
    };
    /** @param {number} slot */
    const paint = (slot) => {
        store.setState(flow.paintRing(store.get(), last ?? slot, slot));
        last = slot;
    };
    ring.addEventListener('pointerdown', (e) => {
        const pe = /** @type {PointerEvent} */ (e);
        const slot = slotAt(pe);
        if (slot === null) return;
        e.preventDefault();
        ring.setPointerCapture(pe.pointerId);
        last = null;
        paint(slot);
    });
    ring.addEventListener('pointermove', (e) => {
        if (last === null) return;
        const slot = slotAt(/** @type {PointerEvent} */ (e));
        if (slot !== null && slot !== last) paint(slot);
    });
    const end = () => (last = null);
    ring.addEventListener('pointerup', end);
    ring.addEventListener('pointercancel', end);
}

/**
 * Klik v sprievodcovi. Tabuľka dvojíc (selektor, akcia) namiesto reťaze podmienok - prvý zásah
 * vyhrá. Tlačidlá v prekresľovaných častiach nesú data- atribúty, pevné majú id. Akcia vráti
 * zmenu stavu (alebo null, keď nie je čo meniť) - okrem pohybu, ten ide cez runSetupAction.
 * @param {SetupStore} store @param {SetupApp} app @param {SetupFields} f
 * @returns {Array<[string, (el: HTMLElement, s: SetupState) => SetupPatch | null | void]>}
 */
function clickActions(store, app, f) {
    const run = (/** @type {import('../shared/setup-flow.js').SetupAction | null} */ a) => runSetupAction(store, app, a);
    const num = (/** @type {string | undefined} */ v) => Number(v);
    return [
        ['#wz-next', (_, s) => run(flow.nextAction(s))],
        ['#wz-back', (_, s) => run(flow.backAction(s))],
        ['#wz-close', (_, s) => run(flow.closeAction(s))],
        ['[data-setup-go]', (el, s) => (el.dataset.setupGo === 'odkaz' ? flow.openLink(s) : flow.setupStart(s))],
        ['[data-setup-restart]', (_, s) => flow.restartSetup(s)],
        [
            '[data-setup-later]',
            (_, s) => {
                const a = flow.skipAction(s);
                if (a && a.type === 'site') applySite(store, a.site, app.refresh, { ...app.skip(), ...a.extra });
            },
        ],
        ['[data-setup-edit]', (el, s) => flow.stepEdit(s, el.dataset.setupEdit || '', s.setupStep === null)],
        ['[data-setup-tab]', (el) => ({ setupStep: /** @type {any} */ (el.dataset.setupTab) })],
        ['[data-geo]', (el, s) => flow.pickPlace(s, num(el.dataset.geo))],
        ['[data-setup-wpmode]', (el, s) => flow.pickWpMode(s, el.dataset.setupWpmode || '')],
        ['[data-setup-wp]', (el, s) => flow.pickWp(s, el.dataset.setupWp || '')],
        ['[data-setup-ac]', (el, s) => flow.pickAc(s, el.dataset.setupAc || '')],
        ['[data-setup-az]', (el, s) => flow.setAzimuth(s, num(el.dataset.setupAz))],
        ['[data-setup-tilt]', (el, s) => flow.setTilt(s, num(el.dataset.setupTilt), true)],
        ['[data-setup-step]', (el, s) => flow.stepPanels(s, num(el.dataset.setupStep))],
        ['[data-setup-roof-edit]', (el) => ({ setupStep: 'smer', setupRoof: num(el.dataset.setupRoofEdit) })],
        ['[data-setup-roof-del]', (el, s) => flow.deleteRoof(s, num(el.dataset.setupRoofDel))],
        ['#wz-roof-add', (_, s) => flow.addRoof(s)],
        ['[data-setup-live]', (el) => ({ setupLive: el.dataset.setupLive === 'yes' })],
        ['[data-setup-kind]', (el, s) => flow.pickKind(s, el.dataset.setupKind || '')],
        [
            '[data-setup-level]',
            (el, s) =>
                flow.setLevel(
                    s,
                    el.dataset.setupBand || '',
                    /** @type {import('../shared/config.js').PriceLevel} */ (el.dataset.setupLevel),
                ),
        ],
        ['[data-setup-band-del]', (el, s) => flow.deleteBand(s, el.dataset.setupBandDel || '')],
        ['#wz-band-add', (_, s) => flow.addBand(s)],
        ['[data-setup-sched-edit]', (el) => ({ setupSched: num(el.dataset.setupSchedEdit), setupStep: 'rozvrh' })],
        ['[data-setup-sched]', (el) => ({ setupSched: num(el.dataset.setupSched) })],
        ['[data-setup-brush]', (el) => ({ setupBrush: el.dataset.setupBrush || null })],
        ['[data-setup-tpl]', (el, s) => flow.applyTemplate(s, el.dataset.setupTpl || '')],
        ['[data-setup-run-del]', (el, s) => flow.deleteRun(s, num(el.dataset.setupRunDel))],
        ['#wz-ival-set', (_, s) => flow.setRun(s, Number(f.wzIvalFrom.value), Number(f.wzIvalTo.value), f.wzIvalBand.value)],
        ['[data-setup-exc]', (el, s) => flow.toggleException(s, el.dataset.setupExc || '')],
        ['[data-setup-month]', (el, s) => flow.toggleMonth(s, num(el.dataset.setupMonth))],
        ['[data-setup-cur]', (el, s) => flow.setCurrency(s, el.dataset.setupCur || '')],
        ['[data-setup-autolevels]', (_, s) => flow.applyAutoLevels(s)],
    ];
}

/**
 * Písanie do polí sprievodcu. Hodnota ide do rozpísaného nastavenia; pole samo sa neprepisuje
 * (render ho prepíše len pri zmene settingsRev), takže kurzor ostáva, kde je.
 * @param {SetupFields} f @param {(q: string) => void} search
 * @returns {Map<HTMLElement, (t: HTMLInputElement, s: SetupState) => SetupPatch | void>}
 */
function inputActions(f, search) {
    /** Ručné súradnice berú časové pásmo telefónu - kto ich zadáva, je zvyčajne doma. */
    const coords = (/** @type {HTMLInputElement} */ _, /** @type {SetupState} */ s) =>
        flow.setCoords(s, numberOf(f.wzLat), numberOf(f.wzLon), Intl.DateTimeFormat().resolvedOptions().timeZone);
    /** @type {Array<[HTMLElement, (t: HTMLInputElement, s: SetupState) => SetupPatch | void]>} */
    const pairs = [
        [f.wzLink, (t) => ({ setupLink: t.value })],
        [f.wzPlace, (t) => search(t.value.trim())],
        [f.wzLat, coords],
        [f.wzLon, coords],
        [f.wzWp, (t, s) => flow.typeWp(s, numberOf(t))],
        [f.wzKwp, (t) => ({ setupKwp: numberOf(t) })],
        [f.wzTilt, (t, s) => flow.setTilt(s, Number(t.value), false)],
        [f.wzPanels, (t, s) => flow.setPanels(s, numberOf(t))],
        [f.wzAc, (t, s) => flow.typeAc(s, numberOf(t))],
        [f.wzKiosk, (t, s) => flow.setKiosk(s, t.value)],
    ];
    return new Map(pairs);
}

/**
 * Písanie mena pásma alebo ceny. Polia vznikajú v renderi, preto sa rozlišujú podľa data-
 * atribútu, nie podľa prvku. @param {HTMLInputElement} t @param {SetupState} s @returns {SetupPatch | null}
 */
function tariffInput(t, s) {
    if (t.dataset.setupBandName) return flow.setBandName(s, t.dataset.setupBandName, t.value);
    if (t.dataset.setupPrice) return flow.setBandPrice(s, t.dataset.setupPrice, numberOf(t));
    return null;
}

/** Kompas z klávesnice: šípky otáčajú o 45° (radiogroup), fokus ide so zvoleným smerom.
 * @param {SetupStore} store @param {SetupFields} f @param {KeyboardEvent} e */
function onCompassKey(store, f, e) {
    const btn = /** @type {HTMLElement} */ (e.target);
    if (!btn.closest || !btn.closest('.dir-btn')) return;
    const turn = /** @type {Record<string, 1 | -1>} */ ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 })[e.key];
    if (!turn) return;
    e.preventDefault();
    store.setState(flow.turnCompass(store.get(), turn));
    // Prekreslenie vráti fokus na tlačidlo na tom istom mieste, v radiogroup má ale ísť so
    // zvoleným smerom.
    const on = f.wzCompass.querySelector('.dir-btn.on');
    if (on instanceof HTMLElement) on.focus();
}

/**
 * Sprievodca (aj prehľad elektrárne, ktorého riadky otvárajú jeho kroky): kliky, písanie do
 * polí, kompas z klávesnice a maľovanie po kruhu tarify. Poslucháče sedia na `f.root`.
 * @param {SetupStore} store @param {SetupApp} app @param {SetupFields} f
 */
export function initSetupWiring(store, app, f) {
    const clicks = clickActions(store, app, f);
    const inputs = inputActions(f, placeSearch(store));
    f.root.addEventListener('click', (e) => {
        const target = /** @type {HTMLElement} */ (e.target);
        for (const [selector, act] of clicks) {
            const el = target.closest(selector);
            if (!(el instanceof HTMLElement) || !f.root.contains(el)) continue;
            const patch = act(el, store.get());
            if (patch) store.setState(patch);
            return;
        }
    });
    f.root.addEventListener('input', (e) => {
        const t = /** @type {HTMLInputElement} */ (e.target);
        const act = inputs.get(t);
        const patch = act ? act(t, store.get()) : tariffInput(t, store.get());
        if (patch) store.setState(patch);
    });
    f.root.addEventListener('keydown', (e) => onCompassKey(store, f, e));
    initRingPaint(store, f.wzTariffRing);
}
