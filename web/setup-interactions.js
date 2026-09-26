// Karta Nastavenie: poslucháče prehľadu elektrárne a sprievodcu jej nastavením. Každý končí
// volaním setState (alebo krokom v histórii cez backTo); kreslí web/render/nastavenie.js.

import { RING, minutesFromAngle } from '../shared/chart-model.js';
import {
    ALL_DAYS,
    ALL_MONTHS,
    installedKw,
    PRICE_LEVELS,
    SEARCH_DEBOUNCE_MS,
    SETTINGS_LIMITS,
    SETUP,
    TARIFF,
    TARIFF_LIMITS,
    TARIFF_TEMPLATES,
} from '../shared/config.js';
import { checkSettings, demoSettings, sameSettings, settingsFromLink } from '../shared/settings.js';
import { emptySettings, newRoof, nextSetupPlace, prevSetupPlace } from '../shared/setup.js';
import {
    autoLevels,
    changesOf,
    isSeasonSchedule,
    isWeekendSchedule,
    newBandId,
    paintSlots,
    scheduleRuns,
    slotsOf,
    tariffKind,
} from '../shared/tariff.js';
import { searchPlaces } from './data.js';
import { backTo } from './history.js';
import { brushOf, setupReady } from './render/nastavenie.js';
import { saveSettings } from './settings-store.js';
import { savedSettings, setupDraft } from './state.js';

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
        tariff: next.tariff,
        kiosk: next.kiosk,
        demo: false,
        pv: null,
        forecast: null,
        loading: true,
        now: new Date(),
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
        settingsDraft: savedSettings(s),
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
    const saved = savedSettings(s);
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
    const place = nextSetupPlace(
        { step: s.setupStep, roof: s.setupRoof },
        s.settingsDraft.plant.strings.length,
        tariffKind(s.settingsDraft.tariff),
    );
    if (place) store.setState({ setupStep: place.step, setupRoof: place.roof });
}

/** „Späť“ - ten istý krok ako tlačidlo Späť na telefóne, pokiaľ sa dá (backTo). @param {Store} store */
function goBack(store) {
    const s = store.get();
    if (!s.setupStep || s.setupReturn === 'prehlad' || s.setupStep === 'start') return closeSetup(store);
    const place = prevSetupPlace(
        { step: s.setupStep, roof: s.setupRoof },
        s.settingsDraft.plant.strings.length,
        tariffKind(s.settingsDraft.tariff),
    );
    if (place) backTo(store, { setupStep: place.step, setupRoof: place.roof });
}

/**
 * Úprava jedného kroku z riadku zhrnutia. Zo zhrnutia sprievodcu sa vracia naň, z prehľadu
 * uloženej elektrárne sa zmena rovno ukladá.
 * @param {Store} store @param {string} key `lokalita`, `panel`, `roof:1`, `menic`, `meranie`, `tarifa`
 */
function editStep(store, key) {
    const s = store.get();
    const fromHome = s.setupStep === null;
    const [step, roof] = key.startsWith('roof:') ? ['smer', Number(key.slice(5))] : [key, 0];
    store.setState({
        setupStep: /** @type {import('../shared/setup.js').SetupStep} */ (step),
        setupRoof: roof,
        setupReturn: fromHome ? 'prehlad' : 'suhrn',
        setupSched: 0,
        setupDunno: false,
        settingsNote: '',
        ...(fromHome ? { settingsDraft: savedSettings(s), settingsRev: s.settingsRev + 1, setupLive: !!s.kiosk } : {}),
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

// ---- Tarifa ------------------------------------------------------------------------

/** @typedef {import('../shared/config.js').Tariff} Tariff */
/** @typedef {import('../shared/config.js').PriceLevel} PriceLevel */

/** Úprava tarify v rozpísanom nastavení. `rewrite` prepíše aj polia (mená pásiem, ceny).
 * @param {ReturnType<typeof draftOps>} ops @param {(t: Tariff) => Tariff} fn @param {boolean} [rewrite] @param {Partial<AppState>} [extra] */
function setTariff(ops, fn, rewrite = false, extra = {}) {
    const d = ops.draft();
    ops.setDraft({ ...d, tariff: fn(d.tariff) }, rewrite, extra);
}

/** Upravovaný rozvrh (po zmazaní výnimky môže index ukazovať mimo). @param {Store} store @param {Tariff} t */
const schedAt = (store, t) => Math.max(0, Math.min(store.get().setupSched, t.schedules.length - 1));

/** Nahradí jeden rozvrh tarify novými štvrťhodinami. @param {Tariff} t @param {number} i @param {string[]} slots @returns {Tariff} */
function withSlots(t, i, slots) {
    return { ...t, schedules: t.schedules.map((s, j) => (j === i ? { ...s, changes: changesOf(slots) } : s)) };
}

/** Úsek štvrťhodín od `from`, `count` za sebou, jedným pásmom - aj cez polnoc. @param {string[]} slots @param {number} from @param {number} count @param {string} band */
function fillSlots(slots, from, count, band) {
    const out = slots.slice();
    for (let k = 0; k < count; k++) out[(from + k) % out.length] = band;
    return out;
}

/** Typ sadzby. Ten istý typ nechá tarifu, ako je (aj s úpravami); iný ju nahradí šablónou.
 * @param {Store} store @param {ReturnType<typeof draftOps>} ops @param {string} kind */
function pickKind(store, ops, kind) {
    const dunno = kind === 'dunno';
    const k = /** @type {'jedna' | 'dvoj' | 'viac'} */ (dunno ? 'jedna' : kind);
    if (!(k in TARIFF_TEMPLATES)) return;
    const t = ops.draft().tariff;
    if (tariffKind(t) === k) return store.setState({ setupDunno: dunno });
    setTariff(ops, () => ({ ...TARIFF_TEMPLATES[k], currency: t.currency }), true, { setupDunno: dunno, setupSched: 0, setupBrush: null });
}

/** @param {ReturnType<typeof draftOps>} ops */
function addBand(ops) {
    setTariff(
        ops,
        (t) =>
            t.bands.length >= TARIFF_LIMITS.maxBands
                ? t
                : { ...t, bands: [...t.bands, { id: newBandId(t), name: `Pásmo ${t.bands.length + 1}`, level: 'bezna', price: null }] },
        true,
    );
}

/** Zmazanie pásma: jeho úseky prevezme susedné pásmo. @param {Store} store @param {ReturnType<typeof draftOps>} ops @param {string} id */
function deleteBand(store, ops, id) {
    const t = ops.draft().tariff;
    const i = t.bands.findIndex((b) => b.id === id);
    if (i < 0 || t.bands.length <= 3) return;
    const heir = t.bands[i === 0 ? 1 : i - 1].id;
    const schedules = t.schedules.map((s) => ({ ...s, changes: changesOf(slotsOf(s).map((x) => (x === id ? heir : x))) }));
    setTariff(ops, () => ({ ...t, bands: t.bands.filter((b) => b.id !== id), schedules }), true, {
        setupBrush: store.get().setupBrush === id ? null : store.get().setupBrush,
    });
}

/** Šablóna tvaru dňa pre upravovaný rozvrh. Pásma sa priradia podľa úrovne: najlacnejšie
 * dostane lacné hodiny, najdrahšie drahé. @param {Store} store @param {ReturnType<typeof draftOps>} ops @param {string} tpl */
function applyTemplate(store, ops, tpl) {
    const t = ops.draft().tariff;
    const sorted = [...t.bands].sort((a, b) => PRICE_LEVELS.indexOf(a.level) - PRICE_LEVELS.indexOf(b.level));
    const cheap = sorted[0].id;
    const dear = sorted[sorted.length - 1].id;
    /** Tvar z dvojpásmovej tarify (nt = lacné, ostatné drahé). @param {Tariff} shape */
    const from = (shape) => shape.schedules[0].changes.map((c) => ({ from: c.from, band: c.band === 'nt' ? cheap : dear }));
    const changes = tpl === '20h' ? from(TARIFF) : tpl === 'noc8' ? from(TARIFF_TEMPLATES.dvoj) : [{ from: '00:00', band: cheap }];
    const i = schedAt(store, t);
    setTariff(ops, () => ({ ...t, schedules: t.schedules.map((s, j) => (j === i ? { ...s, changes } : s)) }));
}

/** Zmazanie úseku: prevezme ho predošlý úsek. @param {Store} store @param {ReturnType<typeof draftOps>} ops @param {number} j */
function deleteRun(store, ops, j) {
    const t = ops.draft().tariff;
    const i = schedAt(store, t);
    const runs = scheduleRuns(t, t.schedules[i]);
    const run = runs[j];
    if (!run || runs.length < 2) return;
    const heir = runs[(j - 1 + runs.length) % runs.length].band.id;
    const step = TARIFF_LIMITS.stepMin;
    setTariff(ops, () => withSlots(t, i, fillSlots(slotsOf(t.schedules[i]), run.startMin / step, run.min / step, heir)));
}

/** Úsek z formulára pod zoznamom (cesta pre klávesnicu). „Do“ pred „Od“ znamená cez polnoc.
 * @param {Store} store @param {Dom} dom @param {ReturnType<typeof draftOps>} ops */
function setRun(store, dom, ops) {
    const t = ops.draft().tariff;
    const from = Number(dom.wzIvalFrom.value);
    const to = Number(dom.wzIvalTo.value);
    const band = dom.wzIvalBand.value;
    if (!Number.isInteger(from) || !Number.isInteger(to) || !t.bands.some((b) => b.id === band)) return;
    const slots = slotsOf(t.schedules[schedAt(store, t)]);
    const count = (to - from + slots.length) % slots.length || slots.length;
    setTariff(ops, () => withSlots(t, schedAt(store, t), fillSlots(slots, from, count, band)));
}

/** Výnimky: žiadne, alebo prepnúť víkend či časť roka. Nová výnimka začína kópiou základu.
 * @param {Store} store @param {ReturnType<typeof draftOps>} ops @param {string} what */
function toggleException(store, ops, what) {
    const t = ops.draft().tariff;
    const [base, ...rest] = t.schedules;
    /** @param {(s: import('../shared/config.js').Schedule) => boolean} is @param {number[]} days @param {number[]} months */
    const toggle = (is, days, months) => {
        if (rest.some(is)) return [base, ...rest.filter((s) => !is(s))];
        if (t.schedules.length >= TARIFF_LIMITS.maxSchedules) return t.schedules;
        return [...t.schedules, { days, months, changes: base.changes }];
    };
    const schedules =
        what === 'none'
            ? [base]
            : what === 'weekend'
              ? toggle(isWeekendSchedule, [6, 7], ALL_MONTHS)
              : toggle(isSeasonSchedule, ALL_DAYS, [6, 7, 8, 9]);
    setTariff(ops, () => ({ ...t, schedules }), false, { setupSched: 0 });
}

/** Mesiac výnimky na časť roka; aspoň jeden musí ostať a všetky byť nesmú (to by bol základ).
 * @param {ReturnType<typeof draftOps>} ops @param {number} m */
function toggleMonth(ops, m) {
    setTariff(ops, (t) => ({
        ...t,
        schedules: t.schedules.map((s, i) => {
            if (i === 0 || !isSeasonSchedule(s)) return s;
            const months = s.months.includes(m) ? s.months.filter((x) => x !== m) : [...s.months, m].sort((a, b) => a - b);
            return months.length && months.length < 12 ? { ...s, months } : s;
        }),
    }));
}

/**
 * Písanie mena pásma alebo ceny. Polia vznikajú v renderi, preto sa rozlišujú podľa data-
 * atribútu, nie podľa prvku. Pole sa neprepisuje, kurzor ostáva, kde je.
 * @param {ReturnType<typeof draftOps>} ops @param {HTMLInputElement} t
 */
function onTariffInput(ops, t) {
    const name = t.dataset.setupBandName;
    const priced = t.dataset.setupPrice;
    if (name) setTariff(ops, (x) => ({ ...x, bands: x.bands.map((b) => (b.id === name ? { ...b, name: t.value.trim() } : b)) }));
    if (priced) {
        const n = numberOf(t);
        const price = Number.isNaN(n) ? null : n;
        setTariff(ops, (x) => ({ ...x, bands: x.bands.map((b) => (b.id === priced ? { ...b, price } : b)) }));
    }
}

/** Úrovne podľa cien. @param {ReturnType<typeof draftOps>} ops */
function applyAutoLevels(ops) {
    setTariff(ops, (t) => {
        const auto = autoLevels(t.bands);
        return auto ? { ...t, bands: t.bands.map((b) => ({ ...b, level: auto[b.id] })) } : t;
    });
}

/**
 * Maľovanie po kruhu rozvrhu: prst (alebo myš) prechádza štvrťhodinami a každú prefarbí pásmom,
 * ktorým sa maľuje. Pointer udalosti so zachytením, ako jazdec na ciferníku - samotné <svg>
 * sa pri prekreslení nemení (render píše len do jeho <g>), takže zachytenie vydrží celý ťah.
 * @param {Store} store @param {Dom} dom @param {ReturnType<typeof draftOps>} ops
 */
function initRingPaint(store, dom, ops) {
    const ring = dom.wzTariffRing;
    /** @type {number | null} */ let last = null;
    /** Štvrťhodina pod prstom, alebo null mimo prstenca. @param {PointerEvent} e */
    const slotAt = (e) => {
        const box = ring.getBoundingClientRect();
        const dx = e.clientX - (box.left + box.width / 2);
        const dy = e.clientY - (box.top + box.height / 2);
        const dist = (Math.hypot(dx, dy) * 264) / box.width;
        if (dist < RING.rDay - 46 || dist > RING.rDay + 30) return null;
        return Math.floor(minutesFromAngle(dx, dy) / TARIFF_LIMITS.stepMin);
    };
    /** @param {number} slot */
    const paint = (slot) => {
        const s = store.get();
        const t = ops.draft().tariff;
        const i = schedAt(store, t);
        const brush = brushOf(s, t).id;
        setTariff(ops, () => withSlots(t, i, paintSlots(slotsOf(t.schedules[i]), last ?? slot, slot, brush)));
        last = slot;
    };
    ring.addEventListener('pointerdown', (e) => {
        const slot = slotAt(e);
        if (slot === null) return;
        e.preventDefault();
        ring.setPointerCapture(e.pointerId);
        last = null;
        paint(slot);
    });
    ring.addEventListener('pointermove', (e) => {
        if (last === null) return;
        const slot = slotAt(e);
        if (slot !== null && slot !== last) paint(slot);
    });
    const end = () => (last = null);
    ring.addEventListener('pointerup', end);
    ring.addEventListener('pointercancel', end);
}

/**
 * Klik v karte Nastavenie. Tabuľka dvojíc (selektor, akcia) namiesto reťaze podmienok - prvý
 * zásah vyhrá. Tlačidlá v prekresľovaných častiach nesú data- atribúty, pevné majú id.
 * @param {Store} store @param {Dom} dom @param {() => Promise<void>} refresh @param {ReturnType<typeof draftOps>} ops
 * @returns {Array<[string, (el: HTMLElement) => void]>}
 */
function clickActions(store, dom, refresh, ops) {
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
        ['[data-setup-kind]', (el) => pickKind(store, ops, el.dataset.setupKind || '')],
        [
            '[data-setup-level]',
            (el) =>
                setTariff(ops, (t) => ({
                    ...t,
                    bands: t.bands.map((b) =>
                        b.id === el.dataset.setupBand ? { ...b, level: /** @type {PriceLevel} */ (el.dataset.setupLevel) } : b,
                    ),
                })),
        ],
        ['[data-setup-band-del]', (el) => deleteBand(store, ops, el.dataset.setupBandDel || '')],
        ['#wz-band-add', () => addBand(ops)],
        ['[data-setup-sched-edit]', (el) => store.setState({ setupSched: num(el.dataset.setupSchedEdit), setupStep: 'rozvrh' })],
        ['[data-setup-sched]', (el) => store.setState({ setupSched: num(el.dataset.setupSched) })],
        ['[data-setup-brush]', (el) => store.setState({ setupBrush: el.dataset.setupBrush || null })],
        ['[data-setup-tpl]', (el) => applyTemplate(store, ops, el.dataset.setupTpl || '')],
        ['[data-setup-run-del]', (el) => deleteRun(store, ops, num(el.dataset.setupRunDel))],
        ['#wz-ival-set', () => setRun(store, dom, ops)],
        ['[data-setup-exc]', (el) => toggleException(store, ops, el.dataset.setupExc || '')],
        ['[data-setup-month]', (el) => toggleMonth(ops, num(el.dataset.setupMonth))],
        ['[data-setup-cur]', (el) => setTariff(ops, (t) => ({ ...t, currency: el.dataset.setupCur || t.currency }))],
        ['[data-setup-autolevels]', () => applyAutoLevels(ops)],
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
    const clicks = clickActions(store, dom, refresh, ops);
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
        if (inputs.has(t)) return inputs.get(t)?.(t);
        onTariffInput(ops, t);
    });
    dom.setup.addEventListener('keydown', (e) => onCompassKey(dom, ops, e));
    initRingPaint(store, dom, ops);
}
