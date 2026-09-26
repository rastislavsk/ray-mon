// Karta Nastavenie: poslucháče prehľadu elektrárne a sprievodcu jej nastavením. Každý končí
// volaním setState (alebo krokom v histórii cez backTo); kreslí web/render/nastavenie.js.

import { installedKw, SEARCH_DEBOUNCE_MS, SETTINGS_LIMITS, SETUP } from '../shared/config.js';
import { checkSettings, demoSettings, sameSettings, settingsFromLink } from '../shared/settings.js';
import { emptySettings, newRoof, nextSetupPlace, prevSetupPlace } from '../shared/setup.js';
import { searchPlaces } from './data.js';
import { backTo } from './history.js';
import { setupReady } from './render/nastavenie.js';
import { saveSettings } from './settings-store.js';
import { clockPatch, setupDraft } from './state.js';

/** @typedef {import('./state.js').Store} Store */
/** @typedef {import('./state.js').AppState} AppState */
/** @typedef {import('./dom.js').Dom} Dom */
/** @typedef {import('../shared/settings.js').Settings} Settings */
/** @typedef {import('../shared/config.js').PlantString} PlantString */

/** Číslo z poľa formulára; prijme aj desatinnú čiarku. Prázdne pole je NaN. @param {HTMLInputElement} input */
function numberOf(input) {
    const text = input.value.trim().replace(',', '.');
    return text === '' ? NaN : Number(text);
}

/** Uložená elektráreň. @param {AppState} s @returns {Settings} */
const savedOf = (s) => ({ site: s.site, plant: s.plant, kiosk: s.kiosk });

/**
 * Uloží nastavenie do prehliadača, prepne naň appku a stiahne predpoveď pre novú elektráreň.
 * @param {Store} store @param {Settings} next @param {() => Promise<void>} refresh @param {Partial<AppState>} [extra]
 */
export function applySettings(store, next, refresh, extra = {}) {
    if (checkSettings(next).errors.length) return;
    if (!saveSettings(next)) {
        store.setState({ settingsNote: 'Uložiť sa nepodarilo. Prehliadač možno nepovoľuje ukladanie dát.' });
        return;
    }
    // Dáta starej elektrárne sa zahodia hneď, aby sa ani na chvíľu nemiešali s novou.
    store.setState({
        site: next.site,
        plant: next.plant,
        kiosk: next.kiosk,
        demo: false,
        pv: null,
        forecast: null,
        loading: true,
        // Nová lokalita môže mať iné pásmo, a na prelome mesiaca teda aj inú sezónu.
        ...clockPatch(new Date(), next.site),
        settingsDraft: next,
        settingsNote: 'Uložené. Prepočítavam predpoveď.',
        settingsRev: store.get().settingsRev + 1,
        setupLive: !!next.kiosk,
        ...extra,
    });
    refresh();
}

/** Úpravy rozpísaného nastavenia. `rewrite` prepíše aj hodnoty polí. @param {Store} store */
function draftOps(store) {
    const draft = () => store.get().settingsDraft;
    /** @param {Settings} next @param {boolean} [rewrite] @param {Partial<AppState>} [extra] */
    const setDraft = (next, rewrite = false, extra = {}) =>
        store.setState({
            settingsDraft: next,
            settingsNote: '',
            ...(rewrite ? { settingsRev: store.get().settingsRev + 1 } : {}),
            ...extra,
        });
    /** Úprava plochy, na ktorej sprievodca práve stojí. @param {(x: PlantString) => PlantString} fn @param {boolean} [rewrite] */
    const setRoof = (fn, rewrite = false) => {
        const d = draft();
        const i = store.get().setupRoof;
        setDraft({ ...d, plant: { ...d.plant, strings: d.plant.strings.map((x, j) => (j === i ? fn(x) : x)) } }, rewrite);
    };
    /** @param {Partial<Settings['plant']>} patch @param {boolean} [rewrite] @param {Partial<AppState>} [extra] */
    const setPlant = (patch, rewrite = false, extra = {}) =>
        setDraft({ ...draft(), plant: { ...draft().plant, ...patch } }, rewrite, extra);
    return { draft, setDraft, setRoof, setPlant };
}

/** Vyhľadávanie lokality: až keď človek chvíľu nepíše, a počíta sa len posledná odpoveď. @param {Store} store */
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

// ---- Pohyb v sprievodcovi -------------------------------------------------------

/**
 * Otvorí sprievodcu od úvodu. Kto ho už raz rozpísal a odišiel, pokračuje s tým, čo zadal.
 * Ukážka (Londýn) sa nepredvypĺňa - človek by si ju mohol omylom nechať ako svoju.
 * @param {Store} store
 */
function startSetup(store) {
    const s = store.get();
    const fresh = s.demo && sameSettings(s.settingsDraft, demoSettings());
    store.setState({
        setupStep: 'start',
        setupRoof: 0,
        setupReturn: null,
        settingsNote: '',
        ...(fresh ? { settingsDraft: emptySettings(), settingsRev: s.settingsRev + 1, setupLive: false, setupKwp: null } : {}),
    });
}

/** Nastaviť celé znova: sprievodca od úvodu, predvyplnený uloženou elektrárňou. @param {Store} store */
function restartSetup(store) {
    const s = store.get();
    store.setState({
        settingsDraft: savedOf(s),
        settingsRev: s.settingsRev + 1,
        setupLive: !!s.kiosk,
        setupStep: 'start',
        setupRoof: 0,
        setupReturn: null,
        settingsNote: '',
    });
}

/** @param {Store} store */
function openLink(store) {
    store.setState({ setupStep: 'odkaz', setupReturn: null, setupLink: '', settingsRev: store.get().settingsRev + 1, settingsNote: '' });
}

/** Zavrie sprievodcu. Rozpísané ostáva - kto ho otvorí znova, pokračuje. Úprava uloženej
 * elektrárne sa naopak zahodí, lebo tam „zavrieť“ znamená „nechať, ako bolo“. @param {Store} store */
function closeSetup(store) {
    const s = store.get();
    if (s.setupReturn !== 'prehlad') return store.setState({ setupStep: null, setupReturn: null });
    const saved = savedOf(s);
    store.setState({ settingsDraft: saved, settingsRev: s.settingsRev + 1, setupLive: !!saved.kiosk, setupStep: null, setupReturn: null });
}

/** Prevezme nastavenie z vloženého odkazu a ukáže ho v zhrnutí - uloží sa až tam. @param {Store} store */
function acceptLink(store) {
    const s = store.get();
    const found = settingsFromLink(s.setupLink);
    if (!found) return;
    store.setState({
        settingsDraft: found,
        settingsRev: s.settingsRev + 1,
        setupKwp: null,
        setupPick: { wp: 'chip', ac: 'chip' },
        setupLive: !!found.kiosk,
        setupStep: 'suhrn',
        setupRoof: 0,
        setupReturn: null,
    });
}

/** „Ďalej“ a jeho varianty: prevziať odkaz, vrátiť sa na zhrnutie, uložiť. @param {Store} store @param {() => Promise<void>} refresh */
function goNext(store, refresh) {
    const s = store.get();
    if (!setupReady(s) || !s.setupStep) return;
    if (s.setupReturn === 'suhrn') return backTo(store, { setupStep: 'suhrn', setupReturn: null });
    if (s.setupReturn === 'prehlad' || s.setupStep === 'suhrn')
        return applySettings(store, setupDraft(s), refresh, { setupStep: null, setupReturn: null, setupLink: '' });
    if (s.setupStep === 'odkaz') return acceptLink(store);
    const place = nextSetupPlace({ step: s.setupStep, roof: s.setupRoof }, s.settingsDraft.plant.strings.length);
    if (place) store.setState({ setupStep: place.step, setupRoof: place.roof });
}

/** „Späť“ - ten istý krok ako tlačidlo Späť na telefóne, pokiaľ sa dá (backTo). @param {Store} store */
function goBack(store) {
    const s = store.get();
    if (!s.setupStep || s.setupReturn === 'prehlad' || s.setupStep === 'start') return closeSetup(store);
    const place = prevSetupPlace({ step: s.setupStep, roof: s.setupRoof }, s.settingsDraft.plant.strings.length);
    if (place) backTo(store, { setupStep: place.step, setupRoof: place.roof });
}

/**
 * Úprava jedného kroku z riadku zhrnutia. Zo zhrnutia sprievodcu sa vracia naň, z prehľadu
 * uloženej elektrárne sa zmena rovno ukladá.
 * @param {Store} store @param {string} key `lokalita`, `panel`, `roof:1`, `menic`, `meranie`
 */
function editStep(store, key) {
    const s = store.get();
    const fromHome = s.setupStep === null;
    const [step, roof] = key.startsWith('roof:') ? ['smer', Number(key.slice(5))] : [key, 0];
    store.setState({
        setupStep: /** @type {import('../shared/setup.js').SetupStep} */ (step),
        setupRoof: roof,
        setupReturn: fromHome ? 'prehlad' : 'suhrn',
        settingsNote: '',
        ...(fromHome ? { settingsDraft: savedOf(s), settingsRev: s.settingsRev + 1, setupLive: !!s.kiosk } : {}),
    });
}

// ---- Tlačidlá na obrazovkách ------------------------------------------------------

/** Výber lokality zo zoznamu. Ak nová plocha ešte smeruje na juh a lokalita je na južnej
 * pologuli, otočí sa na sever - tam je slnko. @param {Store} store @param {ReturnType<typeof draftOps>} ops @param {number} i */
function pickPlace(store, ops, i) {
    const pick = store.get().geo.results[i];
    store.setState({ geo: { status: 'idle', results: [] } });
    if (!pick) return;
    const d = ops.draft();
    const untouched = d.plant.strings.length === 1 && sameSettings({ ...d, plant: { ...d.plant, strings: [newRoof(0)] } }, d);
    const strings = untouched ? [newRoof(pick.site.lat)] : d.plant.strings;
    ops.setDraft({ ...d, site: pick.site, plant: { ...d.plant, strings } }, true);
}

/** Výkon panelu: tlačidlo, „Iný“, alebo „Neviem“. @param {Store} store @param {ReturnType<typeof draftOps>} ops @param {string} v */
function pickWp(store, ops, v) {
    const pick = store.get().setupPick;
    if (v === 'other') return store.setState({ setupPick: { ...pick, wp: 'other' } });
    const guess = v === 'guess';
    ops.setPlant({ panelWp: guess ? SETUP.guessPanelWp : Number(v) }, true, { setupPick: { ...pick, wp: guess ? 'guess' : 'chip' } });
}

/** Menič: tlačidlo, „Iný“, alebo „Neviem“ - vtedy rovnako veľký ako panely, teda bez orezávania.
 * @param {Store} store @param {ReturnType<typeof draftOps>} ops @param {string} v */
function pickAc(store, ops, v) {
    const s = store.get();
    if (v === 'other') return store.setState({ setupPick: { ...s.setupPick, ac: 'other' } });
    const guess = v === 'guess';
    const L = SETTINGS_LIMITS.acLimitKw;
    const panels = setupDraft(s).plant;
    const kwp = Number.isFinite(panels.panelWp) ? installedKw(panels) : L.min;
    const acLimitKw = guess ? Math.max(L.min, Math.min(L.max, Math.round(kwp))) : Number(v);
    ops.setPlant({ acLimitKw }, true, { setupPick: { ...s.setupPick, ac: guess ? 'guess' : 'chip' } });
}

/** Prepnutie „výkon panelu / celkový výkon“ prenesie, čo už je známe. @param {Store} store @param {ReturnType<typeof draftOps>} ops @param {string} mode */
function pickWpMode(store, ops, mode) {
    const s = store.get();
    const resolved = setupDraft(s).plant;
    if (mode === 'kwp' && s.setupKwp === null) {
        const kwp = Number.isFinite(resolved.panelWp) ? Math.round(installedKw(resolved) * 100) / 100 : NaN;
        return store.setState({ setupKwp: kwp, settingsRev: s.settingsRev + 1 });
    }
    if (mode === 'panel' && s.setupKwp !== null) {
        const L = SETTINGS_LIMITS.panelWp;
        const wp = resolved.panelWp >= L.min && resolved.panelWp <= L.max ? Math.round(resolved.panelWp) : s.settingsDraft.plant.panelWp;
        ops.setPlant({ panelWp: wp }, true, { setupKwp: null, setupPick: { ...s.setupPick, wp: 'chip' } });
    }
}

/** Krok o jeden panel; pri neplatnom čísle v poli začne od najmenšej povolenej hodnoty. @param {ReturnType<typeof draftOps>} ops @param {number} step */
function stepPanels(ops, step) {
    const L = SETTINGS_LIMITS.panels;
    ops.setRoof((x) => ({ ...x, panels: Math.max(L.min, Math.min(L.max, (Number.isInteger(x.panels) ? x.panels : L.min) + step)) }), true);
}

/** @param {Store} store @param {ReturnType<typeof draftOps>} ops */
function addRoof(store, ops) {
    const d = ops.draft();
    if (d.plant.strings.length >= SETTINGS_LIMITS.maxStrings) return;
    const strings = [...d.plant.strings, newRoof(d.site.lat)];
    ops.setDraft({ ...d, plant: { ...d.plant, strings } }, true, { setupStep: 'smer', setupRoof: strings.length - 1 });
}

/** @param {Store} store @param {ReturnType<typeof draftOps>} ops @param {number} i */
function deleteRoof(store, ops, i) {
    const d = ops.draft();
    if (d.plant.strings.length < 2) return;
    const strings = d.plant.strings.filter((_, j) => j !== i);
    ops.setDraft({ ...d, plant: { ...d.plant, strings } }, true, { setupRoof: Math.min(store.get().setupRoof, strings.length - 1) });
}

/**
 * Klik v karte Nastavenie. Tabuľka dvojíc (selektor, akcia) namiesto reťaze podmienok - prvý
 * zásah vyhrá. Tlačidlá v prekresľovaných častiach nesú data- atribúty, pevné majú id.
 * @param {Store} store @param {() => Promise<void>} refresh @param {ReturnType<typeof draftOps>} ops
 * @returns {Array<[string, (el: HTMLElement) => void]>}
 */
function clickActions(store, refresh, ops) {
    const num = (/** @type {string | undefined} */ v) => Number(v);
    return [
        ['#wz-next', () => goNext(store, refresh)],
        ['#wz-back', () => goBack(store)],
        ['#wz-close', () => closeSetup(store)],
        ['[data-setup-go]', (el) => (el.dataset.setupGo === 'odkaz' ? openLink(store) : startSetup(store))],
        ['[data-setup-restart]', () => restartSetup(store)],
        ['[data-setup-edit]', (el) => editStep(store, el.dataset.setupEdit || '')],
        ['[data-setup-tab]', (el) => store.setState({ setupStep: /** @type {any} */ (el.dataset.setupTab) })],
        ['[data-geo]', (el) => pickPlace(store, ops, num(el.dataset.geo))],
        ['[data-setup-wpmode]', (el) => pickWpMode(store, ops, el.dataset.setupWpmode || '')],
        ['[data-setup-wp]', (el) => pickWp(store, ops, el.dataset.setupWp || '')],
        ['[data-setup-ac]', (el) => pickAc(store, ops, el.dataset.setupAc || '')],
        ['[data-setup-az]', (el) => ops.setRoof((x) => ({ ...x, azimuthDeg: num(el.dataset.setupAz) }))],
        ['[data-setup-tilt]', (el) => ops.setRoof((x) => ({ ...x, tiltDeg: num(el.dataset.setupTilt) }), true)],
        ['[data-setup-step]', (el) => stepPanels(ops, num(el.dataset.setupStep))],
        ['[data-setup-roof-edit]', (el) => store.setState({ setupStep: 'smer', setupRoof: num(el.dataset.setupRoofEdit) })],
        ['[data-setup-roof-del]', (el) => deleteRoof(store, ops, num(el.dataset.setupRoofDel))],
        ['#wz-roof-add', () => addRoof(store, ops)],
        ['[data-setup-live]', (el) => store.setState({ setupLive: el.dataset.setupLive === 'yes' })],
    ];
}

/**
 * Písanie do polí sprievodcu. Hodnota ide do rozpísaného nastavenia; pole samo sa neprepisuje
 * (viď writeFields v render/nastavenie.js), takže kurzor ostáva, kde je.
 * @param {Store} store @param {Dom} dom @param {ReturnType<typeof draftOps>} ops @param {(q: string) => void} search
 * @returns {Map<HTMLElement, (t: HTMLInputElement) => void>}
 */
function inputActions(store, dom, ops, search) {
    const pick = () => store.get().setupPick;
    /** Ručné súradnice berú časové pásmo telefónu - kto ich zadáva, je zvyčajne doma. */
    const coords = () =>
        ops.setDraft({
            ...ops.draft(),
            site: {
                name: 'Vlastné súradnice',
                lat: numberOf(dom.wzLat),
                lon: numberOf(dom.wzLon),
                elevationM: 0,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            },
        });
    /** @type {Array<[HTMLElement, (t: HTMLInputElement) => void]>} */
    const pairs = [
        [dom.wzLink, (t) => store.setState({ setupLink: t.value })],
        [dom.wzPlace, (t) => search(t.value.trim())],
        [dom.wzLat, coords],
        [dom.wzLon, coords],
        [dom.wzWp, (t) => ops.setPlant({ panelWp: numberOf(t) }, false, { setupPick: { ...pick(), wp: 'other' } })],
        [dom.wzKwp, (t) => store.setState({ setupKwp: numberOf(t) })],
        [dom.wzTilt, (t) => ops.setRoof((x) => ({ ...x, tiltDeg: Number(t.value) }))],
        [dom.wzPanels, (t) => ops.setRoof((x) => ({ ...x, panels: numberOf(t) }))],
        [dom.wzAc, (t) => ops.setPlant({ acLimitKw: numberOf(t) }, false, { setupPick: { ...pick(), ac: 'other' } })],
        [dom.wzKiosk, (t) => ops.setDraft({ ...ops.draft(), kiosk: t.value.trim() })],
    ];
    return new Map(pairs);
}

/** Kompas z klávesnice: šípky otáčajú o 45° (radiogroup), fokus ide so zvoleným smerom.
 * @param {Dom} dom @param {ReturnType<typeof draftOps>} ops @param {KeyboardEvent} e */
function onCompassKey(dom, ops, e) {
    const btn = /** @type {HTMLElement} */ (e.target);
    if (!btn.closest || !btn.closest('.dir-btn')) return;
    const turn = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!turn) return;
    e.preventDefault();
    const step = SETUP.compassStepDeg;
    ops.setRoof((x) => ({ ...x, azimuthDeg: ((((Math.round(x.azimuthDeg / step) + turn) * step) % 360) + 360) % 360 }));
    // Prekreslenie vráti fokus na tlačidlo na tom istom mieste (writeHtml), v radiogroup má
    // ale ísť so zvoleným smerom.
    const on = dom.wzCompass.querySelector('.dir-btn.on');
    if (on instanceof HTMLElement) on.focus();
}

/** Karta Nastavenie: prehľad a sprievodca. @param {Store} store @param {Dom} dom @param {() => Promise<void>} refresh */
export function initSetup(store, dom, refresh) {
    const ops = draftOps(store);
    const clicks = clickActions(store, refresh, ops);
    const inputs = inputActions(store, dom, ops, placeSearch(store));
    dom.setup.addEventListener('click', (e) => {
        const target = /** @type {HTMLElement} */ (e.target);
        for (const [selector, act] of clicks) {
            const el = target.closest(selector);
            if (el instanceof HTMLElement && dom.setup.contains(el)) return act(el);
        }
    });
    dom.setup.addEventListener('input', (e) => {
        const t = /** @type {HTMLInputElement} */ (e.target);
        inputs.get(t)?.(t);
    });
    dom.setup.addEventListener('keydown', (e) => onCompassKey(dom, ops, e));
}
