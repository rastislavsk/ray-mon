// Jediný stav appky a jediné miesto, odkiaľ sa spúšťa prekreslenie.
// setState (web/store.js) zlúči zmenu a zavolá odberateľov práve raz; rovnaké hodnoty nič nespustia.

import { START_PANELS } from '../shared/config.js';
import { typicalSettings } from '../shared/settings.js';
import { emptySettings, SETUP_STEPS } from '../shared/setup.js';
import { setupInit } from '../shared/setup-flow.js';
import { INFO_ITEMS, PANELS } from './dom.js';
import { createStore } from './store.js';

// Úložisko stavu a meranie po obnove dát sú v neutrálnych moduloch, ktoré používa aj nová
// appka (obloha/). Tu sú znova vyvezené, aby sa ich odberatelia nemuseli meniť.
export { createStore };
export { nextPv } from './refresh.js';
// Sprievodca nastavením je spoločný s novou appkou (shared/setup-flow.js).
export { isWelcome, savedSettings, setupDraft } from '../shared/setup-flow.js';

/**
 * @typedef {'mozem' | 'terazky' | '7dni' | 'statistika' | 'nastavenie'} Panel
 * @typedef {{
 *   now: Date,
 *   panel: Panel,
 *   panelDir: 1 | -1,
 *   pv: import('../shared/kiosk.js').PvData | null,
 *   forecast: import('../shared/solar.js').Forecast | null,
 *   loading: boolean,
 *   weekSelDay: number,
 *   weekDayDir: 1 | -1,
 *   weekDetail: 'day' | 'week' | null,
 *   verdictPage: number,
 *   statsPeriod: import('../shared/stats.js').StatsPeriod,
 *   mozemOpen: string | null,
 *   mozemQuip: number,
 *   launches: import('../shared/launches.js').Launch[],
 *   dayLog: import('../shared/daylog.js').DayLog,
 *   mozemSummary: boolean,
 *   mozemList: boolean,
 *   summaryPeriod: import('../shared/summary.js').SummaryPeriod,
 *   previewMinutes: number | null,
 *   isDragging: boolean,
 *   wide: boolean,
 *   tall: boolean,
 *   chartSizes: Record<string, { w: number, h: number }>,
 *   site: import('../shared/config.js').Site,
 *   plant: import('../shared/config.js').Plant,
 *   tariff: import('../shared/config.js').Tariff,
 *   kiosk: string,
 *   known: import('../shared/settings.js').Known,
 *   settingsDraft: import('../shared/settings.js').Settings,
 *   settingsRev: number,
 *   settingsNote: string,
 *   geo: GeoSearch,
 *   incoming: import('../shared/settings.js').Settings | null,
 *   importNote: string,
 *   shareSettings: boolean,
 *   shareKiosk: boolean,
 *   startPanel: import('../shared/settings.js').StartPanel,
 *   setupStep: SetupStep | null,
 *   setupRoof: number,
 *   setupReturn: 'suhrn' | 'prehlad' | null,
 *   setupKwp: number | null,
 *   setupPick: { wp: Pick, ac: Pick },
 *   setupLive: boolean,
 *   setupLink: string,
 *   setupSched: number,
 *   setupBrush: string | null,
 *   setupDunno: boolean,
 *   infoOpen: InfoItem | null,
 *   dialGuideOpen: boolean,
 * }} AppState
 * @typedef {import('../shared/setup-flow.js').GeoSearch} GeoSearch
 * @typedef {import('../shared/setup.js').SetupStep} SetupStep
 * @typedef {import('../shared/setup-flow.js').ValuePick} Pick ako človek zadal hodnotu: tlačidlom, vlastným číslom, alebo „Neviem“
 * @typedef {(typeof INFO_ITEMS)[number]} InfoItem položka sekcie Appka v karte Nastavenie
 * @typedef {{ panel: Panel, weekDetail: 'day' | 'week' | null, setup: SetupStep | null, roof: number, info: InfoItem | null, summary: boolean, list: boolean, guide: boolean }} NavStep krok navigácie pre tlačidlo Späť
 */

/**
 * @param {Date} now @param {{ wide: boolean, tall: boolean }} layout
 * @param {{ saved?: import('../shared/settings.js').Settings | null, site?: import('../shared/config.js').Site | null,
 *   incoming?: import('../shared/settings.js').Settings | null,
 *   startPanel?: import('../shared/settings.js').StartPanel }} start uložené nastavenie, bez neho
 *   uložená poloha (appka počíta s typickou strechou v nej), nastavenie z odkazu, ktoré appka
 *   ponúkne prevziať, a karta, na ktorej sa appka na tomto telefóne otvára
 * @returns {AppState}
 */
export function initialState(now, layout, { saved = null, site = null, incoming = null, startPanel = START_PANELS[0] }) {
    /** @type {import('../shared/settings.js').Known} */
    const known = saved ? 'elektraren' : site ? 'poloha' : 'nic';
    // Bez polohy začína appka sprievodcom na otázke, kde elektráreň stojí.
    const welcome = known === 'nic';
    const start = saved || (site ? typicalSettings(site) : emptySettings());
    return {
        now,
        panel: welcome ? 'nastavenie' : startPanel,
        // Smer posledného prechodu medzi kartami: 1 dopredu v poradí navigácie, -1 späť.
        // Od neho závisí, z ktorej strany sa nová karta prisunie (viď panel-in-* v style.css).
        panelDir: 1,
        pv: null,
        forecast: null,
        // Dáta pre aktuálnu elektráreň sa ešte sťahujú (štart appky, uloženie nastavenia).
        // Kým beží prvé načítanie, chýbajúce dáta nie sú chyba - hlavička hovorí "načítavam…".
        loading: true,
        weekSelDay: 0,
        // Smer posledného prelistovania dní v detaile dňa: 1 na ďalší deň, -1 na predchádzajúci.
        // Od neho závisí, z ktorej strany sa detail prisunie (viď day-in-* v style.css) - to isté,
        // čo panelDir robí pre karty.
        weekDayDir: /** @type {1 | -1} */ (1),
        // Karta 7 dní má na mobile dve obrazovky: prehľad dní a detail vybraného dňa.
        // Na širokej obrazovke je na všetko miesto naraz a toto pole sa neprejaví.
        weekDetail: null,
        verdictPage: 0,
        // Obdobie na karte Štatistika. Nastavenie vnútri karty, nie krok navigácie - Späť sa
        // naň nevracia, rovnako ako na vybraný deň.
        statsPeriod: /** @type {import('../shared/stats.js').StatsPeriod} */ ('dnes'),
        // Karta Môžem?: rozbalená vec (id z MOZEM_ITEMS, null = žiadna) a stránka v páse hlášok
        // (0 = hláška dňa). Obe sú nastavenie vnútri karty, nie krok navigácie.
        mozemOpen: /** @type {string | null} */ (null),
        mozemQuip: 0,
        // Zápisy „Pustil/a som“ z tohto telefónu (web/settings-store.js). Načítajú sa pri štarte.
        launches: [],
        // Denník výroby po dňoch pre súhrn (shared/daylog.js). Načíta sa pri štarte, dopĺňa ho obnova dát.
        dayLog: {},
        // Obrazovka súhrnu v karte Môžem? - je to krok navigácie, Späť ju zavrie. Obdobie je
        // nastavenie vnútri nej.
        mozemSummary: false,
        // Zoznam vecí v karte Môžem? (čo môžem pustiť a dokedy) - druhá obrazovka karty ako súhrn,
        // krok navigácie, Späť ju zavrie.
        mozemList: false,
        summaryPeriod: /** @type {import('../shared/summary.js').SummaryPeriod} */ ('mesiac'),
        previewMinutes: null,
        isDragging: false,
        wide: layout.wide,
        // Či je okno dosť vysoké na to, aby sa do prehľadu dní zmestila aj správa týždňa
        // (WEEK_MSG_MIN_H). Keď nie je, správa sa nekreslí - prehľad ostáva bez scrollovania.
        tall: layout.tall,
        // Skutočné rozmery plátien grafov. Napĺňa ich ResizeObserver v interactions.js;
        // kým sú prázdne, grafy sa kreslia na pevné plátno z chartDims.
        chartSizes: {},
        // Elektráreň, pre ktorú appka počíta: uložené nastavenie, kým si ho používateľ
        // nezadá, typická strecha v jeho polohe.
        site: start.site,
        plant: start.plant,
        // Tarifa: pásma, rozvrh a ceny. Kedy svieti slnko, v nej nie je - to je z predpovede.
        tariff: start.tariff,
        // Odkaz na kiosk pre živé meranie; prázdny = bez merania.
        kiosk: start.kiosk,
        // Čo appka o elektrárni vie. `nic`: ukazuje len otázku na polohu (krok lokalita sprievodcu)
        // bez navigácie a nič nesťahuje - site je prázdna, kým ju človek nevyberie. `poloha`:
        // panely nie sú zadané, karty o výkone (Terazky, Môžem?) sú sivé a bez čísel.
        known,
        // Sprievodca nastavením a rozpísané nastavenie - to isté ako v novej appke (shared/setup-flow.js).
        ...setupInit(start, known),
        // Nastavenie z odkazu (otvoreného alebo prilepeného), ktoré čaká na potvrdenie.
        // Odkaz môže poslať ktokoľvek, preto ho appka sama neuloží.
        incoming,
        importNote: '',
        // Čo pribaliť k zdieľanému odkazu na appku.
        shareSettings: false,
        shareKiosk: false,
        // Karta, na ktorej sa appka na tomto telefóne otvára (voľba v karte Nastavenie).
        startPanel,
        // Rozbalená položka sekcie Appka v karte Nastavenie (null = žiadna). Je to krok navigácie, takže tlačidlo
        // Späť na telefóne položku zbalí a vráti na zoznam, nie na predchádzajúcu kartu.
        infoOpen: null,
        // Popup „Ako čítať ciferník“ na karte Terazky. Je krok navigácie, takže Späť ho najprv zatvorí.
        dialGuideOpen: false,
    };
}

/** @typedef {ReturnType<typeof createStore<AppState>>} Store */

/**
 * Susedná karta v poradí navigácie, alebo null na kraji - listovanie sa nezacyklí.
 * @param {Panel} panel @param {1 | -1} dir 1 = ďalšia, -1 = predchádzajúca
 * @returns {Panel | null}
 */
export function nextPanel(panel, dir) {
    const i = PANELS.indexOf(panel);
    return i < 0 ? null : (PANELS[i + dir] ?? null);
}

/**
 * Susedný deň v detaile dňa, alebo null na kraji týždňa - listovanie sa nezacyklí, rovnako
 * ako pri kartách. Z posledného dňa teda ťah doľava nevedie nikam a z prvého ťah doprava
 * tiež nie; von z detailu vedie šípka späť v jeho hlavičke.
 * @param {number} sel @param {1 | -1} dir 1 = nasledujúci deň, -1 = predchádzajúci
 * @param {number} count koľko dní predpoveď má
 * @returns {number | null}
 */
export function nextWeekDay(sel, dir, count) {
    const i = sel + dir;
    return i >= 0 && i < count ? i : null;
}

/**
 * Zmena karty aj so smerom, ktorým sa má nová karta prisunúť. Smer sa berie z poradia
 * v navigácii, nie z toho, či sa ťahalo alebo klikalo - prechod tak vyzerá rovnako pri
 * oboch. Detail dňa, popup s návodom k ciferníku aj rozbalená položka sekcie Appka sa pritom zatvárajú: je to vec jedného pozretia, nie stav, do ktorého
 * by sa appka mala vrátiť o hodinu neskôr.
 * @param {Panel} from @param {Panel} to
 */
export function panelChange(from, to) {
    return {
        panel: to,
        panelDir: /** @type {1 | -1} */ (PANELS.indexOf(to) < PANELS.indexOf(from) ? -1 : 1),
        weekDetail: null,
        infoOpen: /** @type {null} */ (null),
        dialGuideOpen: false,
        mozemSummary: false,
        mozemList: false,
    };
}

/**
 * Krok navigácie, na ktorý sa dá vrátiť tlačidlom Späť: karta, či je otvorený detail dňa,
 * obrazovka sprievodcu nastavením aj s plochou panelov a rozbalená položka sekcie Appka. Zvyšok stavu (vybraný deň, stránka
 * verdiktu, náhľad času) je nastavenie vnútri karty, nie miesto v appke - tam sa Späť
 * nevracia, rovnako ako v iných appkách.
 * @param {AppState} state @returns {NavStep}
 */
export function navStep(state) {
    return {
        panel: state.panel,
        weekDetail: state.weekDetail,
        setup: state.setupStep,
        roof: state.setupRoof,
        info: state.infoOpen,
        summary: state.mozemSummary,
        list: state.mozemList,
        guide: state.dialGuideOpen,
    };
}

/** @param {NavStep} a @param {NavStep} b */
export function sameNavStep(a, b) {
    return (
        a.panel === b.panel &&
        a.weekDetail === b.weekDetail &&
        a.setup === b.setup &&
        a.roof === b.roof &&
        a.info === b.info &&
        a.summary === b.summary &&
        a.list === b.list &&
        a.guide === b.guide
    );
}

/**
 * Návrat na skorší krok navigácie (tlačidlo Späť). Od panelChange sa líši jediným:
 * detail dňa nezatvára, ale nastavuje na to, čo v tom kroku bolo - Späť má obnoviť,
 * čo používateľ videl, nie to upratať.
 * @param {Panel} from @param {NavStep} step
 */
export function navChange(from, step) {
    // Úprava jedného kroku končí zhrnutím alebo prehľadom - návrat na ne ju ukončí aj tu.
    const endsEdit = step.setup === null || step.setup === 'suhrn';
    return {
        ...panelChange(from, step.panel),
        weekDetail: step.weekDetail,
        setupStep: step.setup,
        setupRoof: step.roof,
        infoOpen: step.info,
        mozemSummary: step.summary,
        mozemList: step.list,
        dialGuideOpen: step.guide,
        ...(endsEdit ? { setupReturn: /** @type {null} */ (null) } : {}),
    };
}

/**
 * Krok navigácie z položky histórie. Cudzie položky (iná stránka v tej istej karte
 * prehliadača, staršia verzia appky) vracajú null a Späť sa pri nich správa ako
 * predtým - odíde zo stránky.
 * @param {unknown} raw @returns {NavStep | null}
 */
export function navStepFrom(raw) {
    if (!raw || typeof raw !== 'object') return navStepIn(null);
    return navStepIn(/** @type {{ step?: unknown }} */ (raw).step);
}

/**
 * Krok navigácie z hodnoty v položke histórie. Položka zo staršej verzie appky sprievodcu
 * ani položky sekcie Appka nepozná - chýbajúci krok sprievodcu je `null`, teda prehľad karty,
 * a chýbajúca položka tiež `null`, teda nič rozbalené. Položka zo staršej verzie so zrušenou
 * kartou Info (`panel: 'info'`) neprejde kontrolou karty a Späť ju berie ako cudziu.
 * @param {unknown} step @returns {NavStep | null}
 */
function navStepIn(step) {
    if (!step || typeof step !== 'object') return null;
    const { panel, weekDetail, setup = null, roof = 0, info = null } = /** @type {Record<string, unknown>} */ (step);
    const screens = screensIn(/** @type {Record<string, unknown>} */ (step));
    if (!screens || !validPanelPlace(panel, weekDetail) || !validSetupPlace(setup, roof) || !validInfoItem(info)) return null;
    return {
        panel: /** @type {Panel} */ (panel),
        weekDetail: /** @type {'day' | 'week' | null} */ (weekDetail),
        setup: /** @type {SetupStep | null} */ (setup),
        roof: /** @type {number} */ (roof),
        info: /** @type {InfoItem | null} */ (info),
        ...screens,
    };
}

/** Karta a detail dňa z položky histórie. @param {unknown} panel @param {unknown} weekDetail */
function validPanelPlace(panel, weekDetail) {
    const detailOk = weekDetail === null || weekDetail === 'day' || weekDetail === 'week';
    return detailOk && PANELS.some((p) => p === panel);
}

/**
 * Obrazovky, ktoré sú otvorené alebo nie: súhrn a zoznam vecí v karte Môžem?, popup s návodom
 * k ciferníku. Položka zo staršej verzie appky ich nepozná - sú `false`.
 * @param {Record<string, unknown>} step @returns {{ summary: boolean, list: boolean, guide: boolean } | null}
 */
function screensIn({ summary = false, list = false, guide = false }) {
    if (typeof summary !== 'boolean' || typeof list !== 'boolean' || typeof guide !== 'boolean') return null;
    return { summary, list, guide };
}

/** Obrazovka sprievodcu a plocha z položky histórie. @param {unknown} setup @param {unknown} roof */
function validSetupPlace(setup, roof) {
    return (setup === null || SETUP_STEPS.some((s) => s === setup)) && Number.isInteger(roof) && /** @type {number} */ (roof) >= 0;
}

/** Položka sekcie Appka z položky histórie. @param {unknown} info */
function validInfoItem(info) {
    return info === null || INFO_ITEMS.some((i) => i === info);
}

/**
 * Krok navigácie, z ktorého appka do tejto položky histórie prišla (`prev`, zapisuje ho
 * initHistory). Podľa neho vie tlačidlo „Späť“ v sprievodcovi, či smie ísť cez históriu.
 * @param {unknown} raw @returns {NavStep | null}
 */
export function navPrevFrom(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return navStepIn(/** @type {{ prev?: unknown }} */ (raw).prev);
}

/**
 * Stav pre to, čo hovorí o výkone strechy (karta Terazky, farba hlavičky): bez zadaných panelov
 * bez predpovede - tá je pre typickú strechu, nie pre jeho, a výkon z nej by klamal.
 * @param {AppState} state @returns {AppState}
 */
export function powerState(state) {
    return state.known === 'elektraren' ? state : { ...state, pv: null, forecast: null };
}
