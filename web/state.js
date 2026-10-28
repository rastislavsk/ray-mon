// Jediný stav appky a jediné miesto, odkiaľ sa spúšťa prekreslenie.
// setState (web/store.js) zlúči zmenu a zavolá odberateľov práve raz; rovnaké hodnoty nič nespustia.

import { oznameniaDefault } from '../shared/oznamenia.js';
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
 *   weekDetail: 'day' | 'week' | null,
 *   terazPage: number,
 *   tzListOpen: boolean,
 *   statsPeriod: import('../shared/stats.js').StatsPeriod,
 *   dayLog: import('../shared/daylog.js').DayLog,
 *   ranna: import('../shared/den-trieda.js').RannaTrieda | null,
 *   previewMinutes: number | null,
 *   wide: boolean,
 *   tall: boolean,
 *   chartSizes: Record<string, { w: number, h: number }>,
 *   site: import('../shared/config.js').Site,
 *   plant: import('../shared/config.js').Plant,
 *   tariff: import('../shared/config.js').Tariff,
 *   zdroj: import('../shared/zdroje.js').Zdroj | null,
 *   pristup: import('../shared/pristup.js').Odmietnutie | null,
 *   known: import('../shared/settings.js').Known,
 *   settingsDraft: import('../shared/settings.js').Settings,
 *   settingsRev: number,
 *   settingsNote: string,
 *   geo: GeoSearch,
 *   incoming: import('../shared/settings.js').Settings | null,
 *   linkError: import('../shared/settings.js').LinkError | null,
 *   importNote: string,
 *   shareSettings: boolean,
 *   shareKiosk: boolean,
 *   setupStep: SetupStep | null,
 *   setupRoof: number,
 *   setupReturn: 'suhrn' | 'prehlad' | null,
 *   setupKwp: number | null,
 *   setupPick: { wp: Pick, ac: Pick },
 *   setupLive: boolean,
 *   setupZnacka: string,
 *   setupSposob: string,
 *   setupUdaje: Record<string, string>,
 *   setupPripoj: import('../shared/setup-flow.js').Pripoj,
 *   setupObnova: boolean,
 *   setupLink: string,
 *   setupSched: number,
 *   setupBrush: string | null,
 *   setupDunno: boolean,
 *   infoOpen: InfoItem | null,
 *   stavTip: boolean,
 *   oznamenia: import('../shared/oznamenia.js').Oznamenia,
 *   oznamStav: import('./oznamenia.js').OznamStav,
 * }} AppState
 * @typedef {import('../shared/setup-flow.js').GeoSearch} GeoSearch
 * @typedef {import('../shared/setup.js').SetupStep} SetupStep
 * @typedef {import('../shared/setup-flow.js').ValuePick} Pick ako človek zadal hodnotu: tlačidlom, vlastným číslom, alebo „Neviem“
 * @typedef {(typeof INFO_ITEMS)[number]} InfoItem položka sekcie Appka v karte Nastavenie
 * @typedef {{ panel: Panel, weekDetail: 'day' | 'week' | null, setup: SetupStep | null, roof: number, info: InfoItem | null }} NavStep krok navigácie pre tlačidlo Späť
 */

/**
 * @param {Date} now @param {{ wide: boolean, tall: boolean }} layout
 * @param {{ saved?: import('../shared/settings.js').Settings | null, site?: import('../shared/config.js').Site | null,
 *   incoming?: import('../shared/settings.js').Settings | null }} start uložené nastavenie, bez neho
 *   uložená poloha (appka počíta s typickou strechou v nej) a nastavenie z odkazu, ktoré appka
 *   ponúkne prevziať
 * @returns {AppState}
 */
export function initialState(now, layout, { saved = null, site = null, incoming = null }) {
    /** @type {import('../shared/settings.js').Known} */
    const known = saved ? 'elektraren' : site ? 'poloha' : 'nic';
    // Bez polohy začína appka sprievodcom na otázke, kde elektráreň stojí.
    const welcome = known === 'nic';
    const start = saved || (site ? typicalSettings(site) : emptySettings());
    return {
        now,
        // Appka sa otvára vždy na prvej karte (Terazky), bez polohy v sprievodcovi.
        panel: welcome ? 'nastavenie' : PANELS[0],
        // Smer posledného prechodu medzi kartami: 1 dopredu v poradí navigácie, -1 späť.
        // Od neho závisí, z ktorej strany sa nová karta prisunie (viď panel-in-* v style.css).
        panelDir: 1,
        pv: null,
        forecast: null,
        // Dáta pre aktuálnu elektráreň sa ešte sťahujú (štart appky, uloženie nastavenia).
        // Kým beží prvé načítanie, chýbajúce dáta nie sú chyba - hlavička hovorí "načítavam…".
        loading: true,
        weekSelDay: 0,
        // Karta 7 dní má na mobile dve obrazovky: prehľad dní a detail vybraného dňa.
        // Na širokej obrazovke je na všetko miesto naraz a toto pole sa neprejaví.
        weekDetail: null,
        // Stránka pásu odporúčaní na karte Dnes (nastavenie vnútri karty, nie krok navigácie).
        terazPage: 0,
        // Zoznam pod grafom dňa na karte Terazky: na začiatku zatvorený. Nastavenie vnútri karty,
        // nie krok navigácie, a neukladá sa.
        tzListOpen: false,
        // Obdobie na karte Štatistika. Nastavenie vnútri karty, nie krok navigácie - Späť sa
        // naň nevracia, rovnako ako na vybraný deň.
        statsPeriod: /** @type {import('../shared/stats.js').StatsPeriod} */ ('dnes'),
        // Denník výroby po dňoch pre plagát Štatistiky (shared/daylog.js). Načíta sa pri štarte, dopĺňa ho obnova dát.
        dayLog: {},
        // Trieda dňa, ktorú appka dnes videla ráno (shared/den-trieda.js). Načíta sa pri štarte, zapisuje ju obnova dát.
        ranna: null,
        previewMinutes: null,
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
        // Pripojené živé meranie (shared/zdroje.js); null = bez merania.
        zdroj: start.zdroj,
        // Prístup k meraniu, ktorý výrobca odmietol (shared/pristup.js). Uložený načíta app.js.
        pristup: null,
        // Čo appka o elektrárni vie. `nic`: ukazuje len otázku na polohu (krok lokalita sprievodcu)
        // bez navigácie a nič nesťahuje - site je prázdna, kým ju človek nevyberie. `poloha`:
        // panely nie sú zadané, karty odpovedajú z typickej strechy a jantárový pás to povie.
        known,
        // Sprievodca nastavením a rozpísané nastavenie - to isté ako v novej appke (shared/setup-flow.js).
        ...setupInit(start, known),
        // Nastavenie z odkazu (otvoreného alebo prilepeného), ktoré čaká na potvrdenie.
        // Odkaz môže poslať ktokoľvek, preto ho appka sama neuloží.
        incoming,
        // Odkaz, ktorý appka nevie prevziať (readLink), a prečo - ponuka to povie namiesto mlčania.
        linkError: null,
        importNote: '',
        // Čo pribaliť k zdieľanému odkazu na appku.
        shareSettings: false,
        shareKiosk: false,
        // Rozbalená položka sekcie Appka v karte Nastavenie (null = žiadna). Je to krok navigácie, takže tlačidlo
        // Späť na telefóne položku zbalí a vráti na zoznam, nie na predchádzajúcu kartu.
        infoOpen: null,
        // Bublina s vysvetlením stavu merania pod bodkou a časom v hlavičke.
        stavTip: false,
        // Ranné oznámenie a spotrebiče doma (voľba telefónu, uložená načíta app.js) a čo s
        // oznámeniami telefón vie (web/oznamenia.js) - podľa spotrebičov ráta aj Plán dňa.
        oznamenia: oznameniaDefault(),
        oznamStav: /** @type {import('./oznamenia.js').OznamStav} */ ('ok'),
    };
}

/** @typedef {ReturnType<typeof createStore<AppState>>} Store */

/**
 * Zmena karty aj so smerom, ktorým sa má nová karta prisunúť. Smer sa berie z poradia
 * v navigácii, nie z toho, odkiaľ sa prepínalo (spodná lišta, tlačidlo Späť, výzva na
 * karte) - prechod tak vyzerá rovnako pri všetkých. Detail dňa aj rozbalená položka sekcie Appka sa pritom zatvárajú: je to vec jedného pozretia, nie stav, do ktorého
 * by sa appka mala vrátiť o hodinu neskôr.
 * @param {Panel} from @param {Panel} to
 */
export function panelChange(from, to) {
    return {
        panel: to,
        panelDir: /** @type {1 | -1} */ (PANELS.indexOf(to) < PANELS.indexOf(from) ? -1 : 1),
        weekDetail: null,
        infoOpen: /** @type {null} */ (null),
        stavTip: false,
    };
}

/**
 * Krok navigácie, na ktorý sa dá vrátiť tlačidlom Späť: karta, či je otvorený detail dňa,
 * obrazovka sprievodcu nastavením aj s plochou panelov a rozbalená položka sekcie Appka. Zvyšok stavu (vybraný deň, stránka
 * pásu odporúčaní, náhľad času) je nastavenie vnútri karty, nie miesto v appke - tam sa Späť
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
    };
}

/** @param {NavStep} a @param {NavStep} b */
export function sameNavStep(a, b) {
    return a.panel === b.panel && a.weekDetail === b.weekDetail && a.setup === b.setup && a.roof === b.roof && a.info === b.info;
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
    if (!validPanelPlace(panel, weekDetail) || !validSetupPlace(setup, roof) || !validInfoItem(info)) return null;
    return {
        panel: /** @type {Panel} */ (panel),
        weekDetail: /** @type {'day' | 'week' | null} */ (weekDetail),
        setup: /** @type {SetupStep | null} */ (setup),
        roof: /** @type {number} */ (roof),
        info: /** @type {InfoItem | null} */ (info),
    };
}

/** Karta a detail dňa z položky histórie. @param {unknown} panel @param {unknown} weekDetail */
function validPanelPlace(panel, weekDetail) {
    const detailOk = weekDetail === null || weekDetail === 'day' || weekDetail === 'week';
    return detailOk && PANELS.some((p) => p === panel);
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
