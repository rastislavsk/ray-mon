// Stav novej appky: jeden objekt, mení sa len cez setState (web/store.js) a prekresľuje len
// cez render (render/index.js). Polia o elektrárni a dátach sú tie isté ako v súčasnej appke,
// takže ich plní ten istý kód (web/refresh.js, web/storage.js).

import { LAYOUT_PX, MINUTES_PER_DAY, MOZEM_ITEMS, PANELS } from '../../shared/config.js';
import { DEFAULT_LOOK, typicalSettings } from '../../shared/settings.js';
import { emptySettings, SETUP_STEPS } from '../../shared/setup.js';
import { setupInit } from '../../shared/setup-flow.js';
import { SUMMARY_PERIODS } from '../../shared/summary.js';

/**
 * Stav. `mozemItem` je vec karty Môžem?, ktorej panel je otvorený (null = žiadny), `mozemQuip`
 * stránka hlášok, `terazPreview` čas náhľadu na grafe karty Teraz (minúta dňa, null = teraz),
 * `terazPage` stránka pásu odporúčaní pod ním, `weekDetail` otvorený detail karty 7 dní (deň, týždeň,
 * null = prehľad dní) a `weekDay` deň v ňom (index v predpovedi), `statsPeriod` obdobie karty Štatistika,
 * `poster` otvorený plagát na zdieľanie (obdobie súhrnu, null = zatvorený; otvára ho Štatistika aj
 * odkaz na karte Môžem?), `launches` zápisy „Pustil/a som“ (to isté úložisko ako v súčasnej appke)
 * `online`, či má telefón internet - podľa toho karta bez dát povie prečo, `startPanel` karta, na ktorej
 * sa appka na tomto telefóne otvára, a `incoming` nastavenie z otvoreného odkazu, ktoré čaká na
 * potvrdenie. `voice` je tón hlášok a `liveSky` živá obloha (Nastavenie › Vzhľad), `appSheet`
 * otvorené okno sekcie Appka (Zdieľať appku, potvrdenie Nastaviť celé znova) a `shareSettings`,
 * `shareKiosk` voľby zdieľania - pribaliť nastavenie elektrárne, k nemu aj kiosk. Polia sprievodcu nastavením (setup…, settings…, geo) sú tie isté ako v súčasnej appke
 * a mení ich ten istý kód (shared/setup-flow.js). `layout` je rozloženie podľa šírky okna (layoutOf).
 * @typedef {(typeof PANELS)[number]} Panel
 * @typedef {'narrow' | 'medium' | 'wide'} Layout
 * @typedef {'day' | 'week'} WeekDetail
 * @typedef {'share' | 'reset'} AppSheet
 * @typedef {import('../../shared/summary.js').SummaryPeriod} PosterPeriod
 * @typedef {import('../../web/refresh.js').RefreshState & import('../../shared/setup-flow.js').SetupState & {
 *   panel: Panel,
 *   panelDir: 1 | -1,
 *   layout: Layout,
 *   tariff: import('../../shared/config.js').Tariff,
 *   launches: import('../../shared/launches.js').Launch[],
 *   mozemItem: string | null,
 *   mozemQuip: number,
 *   terazPreview: number | null,
 *   terazPage: number,
 *   weekDetail: WeekDetail | null,
 *   weekDay: number,
 *   statsPeriod: import('../../shared/stats.js').StatsPeriod,
 *   poster: PosterPeriod | null,
 *   online: boolean,
 *   startPanel: import('../../shared/settings.js').StartPanel,
 *   incoming: import('../../shared/settings.js').Settings | null,
 *   voice: import('../../shared/messages.js').Voice,
 *   liveSky: boolean,
 *   appSheet: AppSheet | null,
 *   shareSettings: boolean,
 *   shareKiosk: boolean,
 * }} AppState
 * @typedef {ReturnType<typeof import('../../web/store.js').createStore<AppState>>} Store
 */
/**
 * Krok navigácie, na ktorý sa dá vrátiť tlačidlom Späť: karta, otvorený panel veci, náhľad
 * iného času na grafe karty Teraz a detail karty 7 dní. Pri náhľade je krokom to, že beží - posun
 * po grafe nový krok nepridá (porovnáva sameNavStep); `preview` si pamätá čas, s ktorým sa doň
 * vstúpilo. Rovnako pri detaile dňa: listovanie po dňoch je stále ten istý krok, Späť z ktoréhokoľvek
 * dňa vráti do prehľadu. Otvorený plagát je tiež krok - Späť ho zavrie. Obrazovka sprievodcu
 * nastavením aj s plochou panelov je krok tiež, takže Späť vracia o obrazovku sprievodcu. Okno sekcie
 * Appka (`sheet`) rovnako - Späť ho zavrie. `dash` hovorí, že krok patrí prehľadu so stĺpcami
 * (dashboard): prepnutie stĺpca v ňom nie je nový krok a detail ani plagát v ňom nepatria len
 * stĺpcu, ktorý je práve aktívny. Mimo prehľadu v kroku nie je - položky histórie telefónu ostávajú, aké boli.
 * @typedef {{ panel: Panel, item: string | null, preview: number | null, detail: WeekDetail | null, poster: PosterPeriod | null,
 *   setup: import('../../shared/setup.js').SetupStep | null, roof: number, sheet: AppSheet | null, dash?: true }} NavStep
 */

/**
 * @param {Date} now
 * @param {{ saved: import('../../shared/settings.js').Settings | null, site: import('../../shared/config.js').Site | null,
 *   startPanel: import('../../shared/settings.js').StartPanel, dayLog: import('../../shared/daylog.js').DayLog,
 *   launches: import('../../shared/launches.js').Launch[], online: boolean,
 *   incoming?: import('../../shared/settings.js').Settings | null, look?: import('../../shared/settings.js').Look,
 *   layout?: Layout }} start
 *   uložené nastavenie, bez neho uložená poloha (appka počíta s typickou strechou v nej), karta,
 *   na ktorej sa appka na tomto telefóne otvára, denník výroby, zápisy spustení, internet, nastavenie
 *   z odkazu, ktoré appka ponúkne prevziať, vzhľad (tón hlášok, živá obloha) a rozloženie
 * @returns {AppState}
 */
export function initialState(
    now,
    { saved, site, startPanel, dayLog, launches, online, incoming = null, look = DEFAULT_LOOK, layout = 'narrow' },
) {
    const start = saved || (site ? typicalSettings(site) : emptySettings());
    /** @type {import('../../shared/settings.js').Known} */
    const known = saved ? 'elektraren' : site ? 'poloha' : 'nic';
    return {
        now,
        panel: startPanel,
        // Smer posledného prechodu medzi kartami: 1 dopredu v poradí navigácie, -1 späť.
        panelDir: 1,
        layout,
        known,
        site: start.site,
        plant: start.plant,
        tariff: start.tariff,
        kiosk: start.kiosk,
        pv: null,
        forecast: null,
        // Kým beží prvé načítanie, chýbajúce dáta nie sú chyba.
        loading: true,
        dayLog,
        launches,
        mozemItem: null,
        mozemQuip: 0,
        terazPreview: null,
        terazPage: 0,
        weekDetail: null,
        weekDay: 0,
        statsPeriod: /** @type {import('../../shared/stats.js').StatsPeriod} */ ('dnes'),
        poster: null,
        online,
        startPanel,
        incoming,
        voice: look.voice,
        liveSky: look.liveSky,
        appSheet: null,
        shareSettings: false,
        shareKiosk: false,
        // Sprievodca nastavením a rozpísané nastavenie. Bez polohy čaká na karte Nastavenie otázka
        // na ňu; appka sa aj tak otvára na svojej prvej karte, ktorá vedie do Nastavenia.
        ...setupInit(start, known),
    };
}

/**
 * Zmena karty aj so smerom podľa poradia v navigácii. Panel veci patrí karte Môžem?, náhľad
 * karte Teraz, detail karte 7 dní a plagát karte, z ktorej sa otvoril - s kartou sa zatvoria.
 * @param {Panel} from @param {Panel} to
 */
export function panelChange(from, to) {
    return {
        panel: to,
        panelDir: /** @type {1 | -1} */ (PANELS.indexOf(to) < PANELS.indexOf(from) ? -1 : 1),
        mozemItem: /** @type {string | null} */ (null),
        terazPreview: /** @type {number | null} */ (null),
        weekDetail: /** @type {WeekDetail | null} */ (null),
        poster: /** @type {PosterPeriod | null} */ (null),
        appSheet: /** @type {AppSheet | null} */ (null),
    };
}

/**
 * Susedná karta v poradí navigácie, alebo null na kraji - listovanie sa nezacyklí.
 * @param {Panel} panel @param {1 | -1} dir 1 = ďalšia, -1 = predchádzajúca @returns {Panel | null}
 */
export function nextPanel(panel, dir) {
    return PANELS[PANELS.indexOf(panel) + dir] ?? null;
}

/**
 * Rozloženie podľa šírky okna (LAYOUT_PX): telefón a tablet na výšku, tablet na šírku, počítač.
 * @param {number} width šírka okna v px @returns {Layout}
 */
export function layoutOf(width) {
    return width >= LAYOUT_PX.wide ? 'wide' : width >= LAYOUT_PX.medium ? 'medium' : 'narrow';
}

/** Karty, ktoré široká obrazovka ukazuje naraz ako stĺpce prehľadu, zľava doprava. */
export const COLUMNS = /** @type {const} */ (['mozem', 'terazky', '7dni']);

/** Je karta stĺpcom prehľadu? @param {Panel} panel */
export const isColumn = (panel) => COLUMNS.some((c) => c === panel);

/**
 * Ukazuje appka prehľad so stĺpcami? Len na širšej obrazovke a len na kartách Môžem?, Teraz a
 * 7 dní - Štatistika a Nastavenie sú aj tam samostatná stránka. `panel` je potom aktívny stĺpec:
 * ten, ktorý vybrala navigácia alebo v ktorom človek naposledy niečo otvoril.
 * @param {Pick<AppState, 'layout' | 'panel'>} state
 */
export const dashboard = (state) => state.layout !== 'narrow' && isColumn(state.panel);

/**
 * Je karta na obrazovke? Na telefóne len vybraná, v prehľade všetky jeho stĺpce.
 * @param {Pick<AppState, 'layout' | 'panel'>} state @param {Panel} panel
 */
export const shows = (state, panel) => panel === state.panel || (dashboard(state) && isColumn(panel));

/** @param {AppState} state @returns {NavStep} */
export function navStep(state) {
    return {
        panel: state.panel,
        item: state.mozemItem,
        preview: state.terazPreview,
        detail: state.weekDetail,
        poster: state.poster,
        setup: state.setupStep,
        roof: state.setupRoof,
        sheet: state.appSheet,
        ...(dashboard(state) ? { dash: /** @type {const} */ (true) } : {}),
    };
}

/**
 * Rovnaký krok? V prehľade sú všetky stĺpce jedna obrazovka - prepnutie stĺpca nový krok nepridá.
 * @param {NavStep} a @param {NavStep} b
 */
export function sameNavStep(a, b) {
    return (
        (a.panel === b.panel || (!!a.dash && !!b.dash)) &&
        a.item === b.item &&
        (a.preview === null) === (b.preview === null) &&
        a.detail === b.detail &&
        a.poster === b.poster &&
        a.setup === b.setup &&
        a.roof === b.roof &&
        a.sheet === b.sheet
    );
}

/**
 * Detail z položky histórie. Patrí len karte 7 dní (v prehľade ktorémukoľvek stĺpcu - 7 dní je
 * vidieť vždy); položka zo skoršej verzie ho nemá.
 * @param {Panel} panel @param {boolean} dash @param {unknown} detail @returns {WeekDetail | null}
 */
const weekDetailOf = (panel, dash, detail) => ((panel === '7dni' || dash) && (detail === 'day' || detail === 'week') ? detail : null);

/**
 * Plagát z položky histórie. Otvára sa len na karte Môžem? a Štatistika (v prehľade z ktoréhokoľvek
 * stĺpca); položka zo skoršej verzie ho nemá.
 * @param {Panel} panel @param {boolean} dash @param {unknown} poster @returns {PosterPeriod | null}
 */
const posterOf = (panel, dash, poster) =>
    (panel === 'mozem' || panel === 'statistika' || dash) && SUMMARY_PERIODS.some((p) => p === poster)
        ? /** @type {PosterPeriod} */ (poster)
        : null;

/**
 * Okno sekcie Appka z položky histórie. Patrí len karte Nastavenie; položka zo skoršej verzie ho nemá.
 * @param {Panel} panel @param {unknown} sheet @returns {AppSheet | null}
 */
const appSheetOf = (panel, sheet) => (panel === 'nastavenie' && (sheet === 'share' || sheet === 'reset') ? sheet : null);

/**
 * Obrazovka sprievodcu a plocha z položky histórie. Položka zo skoršej verzie sprievodcu nepozná -
 * chýbajúci krok je prehľad karty. Cudzia hodnota je null.
 * @param {unknown} setup @param {unknown} roof
 * @returns {{ setup: import('../../shared/setup.js').SetupStep | null, roof: number } | null}
 */
function setupPlaceOf(setup = null, roof = 0) {
    const s = setup === null ? null : SETUP_STEPS.find((x) => x === setup);
    if (s === undefined || !Number.isInteger(roof) || /** @type {number} */ (roof) < 0) return null;
    return { setup: s, roof: /** @type {number} */ (roof) };
}

/**
 * Prehľad so stĺpcami z položky histórie. Poznajú ho len jeho karty; položka zo skoršej verzie ho nemá.
 * Vracia časť kroku: `{ dash: true }`, inak nič. @param {Panel} panel @param {unknown} dash @returns {{ dash?: true }}
 */
const dashOf = (panel, dash) => (dash === true && isColumn(panel) ? { dash: true } : {});

/**
 * Krok z hodnoty v položke histórie (`step` alebo `prev`). Cudzia hodnota je null a Späť sa
 * pri nej správa ako predtým - odíde zo stránky.
 * @param {unknown} raw @returns {NavStep | null}
 */
export function navStepOf(raw) {
    // Položka zo skoršej verzie appky mala za krok len kartu.
    if (typeof raw === 'string') raw = { panel: raw };
    if (!raw || typeof raw !== 'object') return null;
    const { panel, item, preview, detail, poster, setup, roof, sheet, dash } =
        /** @type {{ panel?: unknown, item?: unknown, preview?: unknown, detail?: unknown, poster?: unknown, setup?: unknown, roof?: unknown,
         *   sheet?: unknown, dash?: unknown }} */ (raw);
    const p = PANELS.find((x) => x === panel);
    const place = setupPlaceOf(setup, roof);
    if (!p || !place) return null;
    const d = dashOf(p, dash);
    const inDash = !!d.dash;
    // Náhľad mimo dňa (cudzia či poškodená položka) nie je náhľad.
    const at = Number.isInteger(preview) && /** @type {number} */ (preview) >= 0 && /** @type {number} */ (preview) < MINUTES_PER_DAY;
    const step = {
        panel: p,
        item: null,
        preview: at ? /** @type {number} */ (preview) : null,
        detail: weekDetailOf(p, inDash, detail),
        poster: posterOf(p, inDash, poster),
        ...place,
        sheet: appSheetOf(p, sheet),
        ...d,
    };
    if (item === null || item === undefined) return step;
    return MOZEM_ITEMS.some((i) => i.id === item) ? { ...step, item: /** @type {string} */ (item) } : null;
}

/** Krok, na ktorom položka histórie stojí. @param {unknown} raw */
export const navStepFrom = (raw) => navStepOf(raw && typeof raw === 'object' ? /** @type {{ step?: unknown }} */ (raw).step : null);

/** Krok, z ktorého sa do položky histórie prišlo. @param {unknown} raw */
export const navPrevFrom = (raw) => navStepOf(raw && typeof raw === 'object' ? /** @type {{ prev?: unknown }} */ (raw).prev : null);

/**
 * Návrat na krok z histórie (tlačidlo Späť): karta, panel veci, náhľad aj detail tak, ako boli.
 * Náhľad, ktorý už beží, ostane na čase, kde ho prst nechal; detail dňa na dni, kde sa naposledy
 * stálo. Úprava jedného kroku sprievodcu končí zhrnutím alebo prehľadom - návrat na ne ju ukončí.
 * Návrat v prehľade na krok prehľadu nechá aktívny stĺpec, aký je - stĺpec nebol krokom.
 * @param {AppState} state @param {NavStep} step
 */
export function navChange(state, step) {
    const preview = step.preview === null ? null : (state.terazPreview ?? step.preview);
    const endsEdit = step.setup === null || step.setup === 'suhrn';
    const panel = !!step.dash && dashboard(state) ? state.panel : step.panel;
    return {
        ...panelChange(state.panel, panel),
        mozemItem: step.item,
        terazPreview: preview,
        weekDetail: step.detail,
        poster: step.poster,
        setupStep: step.setup,
        setupRoof: step.roof,
        appSheet: step.sheet,
        ...(endsEdit ? { setupReturn: /** @type {null} */ (null) } : {}),
    };
}

/**
 * Kam vedie ťah prstom do strán. Mimo detailu karty 7 dní listuje karty (na kraji nikam). Počas
 * sprievodcu nastavením nevedie nikam - človek by omylom odišiel z rozpísaného nastavenia.
 * Detail je podobrazovka karty a ťah ju neopúšťa: v detaile dňa listuje dni, ako súčasná appka
 * (web/swipe.js). Ťah doprava je všade krok späť, takže keď už listovať nie je kam (dnešok, alebo
 * detail týždňa), vedie do prehľadu dní - `'back'`, krok v histórii. Doľava z posledného dňa
 * nevedie nikam. V prehľade so stĺpcami sú karty vedľa seba a listovať ich nemá zmysel; ťah tam
 * listuje len dni v detaile, a to len ťah v stĺpci 7 dní (`where`).
 * @param {AppState} state @param {number} dx záporné = ťah doľava
 * @param {Panel | null} [where] karta, v ktorej ťah začal (null = mimo kariet)
 * @returns {Partial<AppState> | 'back' | null}
 */
export function swipeTarget(state, dx, where = null) {
    const dash = dashboard(state);
    if (state.panel === 'nastavenie' && state.setupStep) return null;
    if ((dash ? where === '7dni' : state.panel === '7dni') && state.weekDetail && state.forecast)
        return swipeDetail(state.weekDetail, state.weekDay, state.forecast.days.length, dx);
    const to = dash ? null : nextPanel(state.panel, dx < 0 ? 1 : -1);
    return to ? panelChange(state.panel, to) : null;
}

/**
 * Ťah v detaile karty 7 dní: v detaile dňa susedný deň, inak (a na kraji doprava) späť do prehľadu.
 * @param {WeekDetail} detail @param {number} day @param {number} days počet dní v predpovedi @param {number} dx
 * @returns {{ weekDay: number } | 'back' | null}
 */
function swipeDetail(detail, day, days, dx) {
    const back = dx > 0 ? /** @type {const} */ ('back') : null;
    if (detail === 'week') return back;
    const to = day + (dx < 0 ? 1 : -1);
    return to >= 0 && to < days ? { weekDay: to } : back;
}
