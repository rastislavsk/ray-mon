// Jediný stav appky a jediné miesto, odkiaľ sa spúšťa prekreslenie.
// setState zlúči zmenu a zavolá odberateľov práve raz; rovnaké hodnoty nič nespustia.

import { STALE_PV_MS } from '../shared/config.js';
import { resolveDraft, SETUP_STEPS } from '../shared/setup.js';
import { seasonFor } from '../shared/tariff.js';
import { PANELS } from './dom.js';

/**
 * @typedef {import('../shared/config.js').Season} Season
 * @typedef {'terazky' | '7dni' | 'nastavenie' | 'info'} Panel
 * @typedef {{
 *   now: Date,
 *   season: Season,
 *   panel: Panel,
 *   panelDir: 1 | -1,
 *   pv: import('../shared/kiosk.js').PvData | null,
 *   forecast: import('../shared/solar.js').Forecast | null,
 *   loading: boolean,
 *   weekSelDay: number,
 *   weekDayDir: 1 | -1,
 *   weekDetail: 'day' | 'week' | null,
 *   verdictPage: number,
 *   previewMinutes: number | null,
 *   isDragging: boolean,
 *   wide: boolean,
 *   tall: boolean,
 *   chartSizes: Record<string, { w: number, h: number }>,
 *   site: import('../shared/config.js').Site,
 *   plant: import('../shared/config.js').Plant,
 *   kiosk: string,
 *   demo: boolean,
 *   settingsDraft: import('../shared/settings.js').Settings,
 *   settingsRev: number,
 *   settingsNote: string,
 *   geo: GeoSearch,
 *   incoming: import('../shared/settings.js').Settings | null,
 *   importNote: string,
 *   shareSettings: boolean,
 *   shareKiosk: boolean,
 *   setupStep: SetupStep | null,
 *   setupRoof: number,
 *   setupReturn: 'suhrn' | 'prehlad' | null,
 *   setupKwp: number | null,
 *   setupPick: { wp: Pick, ac: Pick },
 *   setupLive: boolean,
 *   setupLink: string,
 * }} AppState
 * @typedef {{ status: 'idle' | 'loading' | 'done' | 'error', results: Array<{ site: import('../shared/config.js').Site, detail: string }> }} GeoSearch
 * @typedef {import('../shared/setup.js').SetupStep} SetupStep
 * @typedef {'chip' | 'other' | 'guess'} Pick ako človek zadal hodnotu: tlačidlom, vlastným číslom, alebo „Neviem“
 * @typedef {{ panel: Panel, weekDetail: 'day' | 'week' | null, setup: SetupStep | null, roof: number }} NavStep krok navigácie pre tlačidlo Späť
 */

/**
 * @param {Date} now @param {Season} season @param {{ wide: boolean, tall: boolean }} layout
 * @param {{ settings: import('../shared/settings.js').Settings, demo: boolean,
 *   incoming?: import('../shared/settings.js').Settings | null }} start uložené nastavenie (alebo ukážka,
 *   vtedy `demo`) a nastavenie z odkazu, ktoré appka ponúkne prevziať
 * @returns {AppState}
 */
export function initialState(now, season, layout, { settings, demo, incoming = null }) {
    return {
        now,
        season,
        panel: 'terazky',
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
        // nezadá, ukážka (demo).
        site: settings.site,
        plant: settings.plant,
        // Odkaz na kiosk pre živé meranie; prázdny = bez merania.
        kiosk: settings.kiosk,
        demo,
        // Rozpísaný formulár v karte Nastavenie. Hodnoty polí píše render len pri zmene
        // settingsRev (načítanie, výber lokality, pridanie plochy, zahodenie zmien), inak by
        // počas písania prepisoval to, čo človek práve píše.
        settingsDraft: settings,
        settingsRev: 0,
        // Hlásenie pod tlačidlom Uložiť; pri ďalšej úprave zmizne.
        settingsNote: '',
        geo: { status: 'idle', results: [] },
        // Nastavenie z odkazu (otvoreného alebo prilepeného), ktoré čaká na potvrdenie.
        // Odkaz môže poslať ktokoľvek, preto ho appka sama neuloží.
        incoming,
        importNote: '',
        // Čo pribaliť k zdieľanému odkazu na appku.
        shareSettings: false,
        shareKiosk: false,
        // Sprievodca nastavením elektrárne v karte Nastavenie: otvorená obrazovka (null = karta
        // ukazuje prehľad) a plocha panelov, ktorej sa týka. Oboje je krok navigácie, takže
        // tlačidlo Späť na telefóne vracia o obrazovku sprievodcu.
        setupStep: null,
        setupRoof: 0,
        // Úprava jedného kroku: kam sa po nej vrátiť - na zhrnutie sprievodcu, alebo na prehľad
        // uloženej elektrárne (vtedy sa zmena rovno ukladá). null = sprievodca ide v poradí.
        setupReturn: null,
        // Kto pozná len celkový výkon elektrárne (kWp), zadá ten; výkon panelu sa dopočíta.
        setupKwp: null,
        // Ako bol zadaný výkon panelu a meniča - „Neviem“ zhrnutie označí ako odhad.
        setupPick: { wp: 'chip', ac: 'chip' },
        // Či človek chce živé meranie z kiosku. Rozhoduje, či sa kiosk pri uložení vôbec berie.
        setupLive: !!settings.kiosk,
        // Odkaz s nastavením vložený v sprievodcovi (obrazovka „odkaz“).
        setupLink: '',
    };
}

/**
 * @template T
 * @param {T} initial
 */
export function createStore(initial) {
    let state = initial;
    /** @type {Array<(state: T, prev: T) => void>} */
    const listeners = [];
    return {
        get: () => state,
        /** @param {Partial<T>} patch */
        setState(patch) {
            const keys = /** @type {Array<keyof T>} */ (Object.keys(patch));
            if (!keys.some((k) => patch[k] !== state[k])) return;
            const prev = state;
            state = { ...state, ...patch };
            listeners.forEach((fn) => fn(state, prev));
        },
        /** @param {(state: T, prev: T) => void} fn */
        subscribe(fn) {
            listeners.push(fn);
            return () => listeners.splice(listeners.indexOf(fn), 1);
        },
    };
}

/** @typedef {ReturnType<typeof createStore<AppState>>} Store */

/**
 * Posun hodín: nový čas a s ním aj sezóna. Sezóna nie je nastavenie z času štartu -
 * appka otvorená cez prelom októbra a novembra musí prejsť na zimné tarifné okná sama,
 * bez načítania stránky. Počíta sa v pásme lokality, rovnako ako hodiny.
 * @param {Date} now @param {import('../shared/config.js').Site} site
 */
export function clockPatch(now, site) {
    return { now, season: seasonFor(now, site.timezone) };
}

/**
 * Meranie po obnove dát. Keď kiosk raz neodpovie, ostáva posledné meranie - appka inak na
 * minútu preskočila na odhad, z grafu zmizla nameraná krivka a o minútu sa všetko vrátilo.
 * Najviac však STALE_PV_MS od stiahnutia: staršie meranie by sa tvárilo ako výkon "teraz".
 * Bez kiosku (`pvFailed` je false) sa nemá čo nechávať.
 * @param {import('../shared/kiosk.js').PvData | null} prev
 * @param {{ pv: import('../shared/kiosk.js').PvData | null, pvFailed: boolean }} result @param {Date} now
 */
export function nextPv(prev, result, now) {
    if (result.pv || !result.pvFailed || !prev) return result.pv;
    return now.getTime() - Date.parse(prev.updatedAt) <= STALE_PV_MS ? prev : null;
}

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
 * oboch. Detail dňa sa pritom zatvára: je to vec jedného pozretia, nie stav, do ktorého
 * by sa appka mala vrátiť o hodinu neskôr.
 * @param {Panel} from @param {Panel} to
 */
export function panelChange(from, to) {
    return {
        panel: to,
        panelDir: /** @type {1 | -1} */ (PANELS.indexOf(to) < PANELS.indexOf(from) ? -1 : 1),
        weekDetail: null,
    };
}

/**
 * Krok navigácie, na ktorý sa dá vrátiť tlačidlom Späť: karta, či je otvorený detail dňa,
 * a obrazovka sprievodcu nastavením aj s plochou panelov. Zvyšok stavu (vybraný deň, stránka
 * verdiktu, náhľad času) je nastavenie vnútri karty, nie miesto v appke - tam sa Späť
 * nevracia, rovnako ako v iných appkách.
 * @param {AppState} state @returns {NavStep}
 */
export function navStep(state) {
    return { panel: state.panel, weekDetail: state.weekDetail, setup: state.setupStep, roof: state.setupRoof };
}

/** @param {NavStep} a @param {NavStep} b */
export function sameNavStep(a, b) {
    return a.panel === b.panel && a.weekDetail === b.weekDetail && a.setup === b.setup && a.roof === b.roof;
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
 * nepozná - chýbajúci krok sprievodcu je `null`, teda prehľad karty.
 * @param {unknown} step @returns {NavStep | null}
 */
function navStepIn(step) {
    if (!step || typeof step !== 'object') return null;
    const { panel, weekDetail, setup = null, roof = 0 } = /** @type {Record<string, unknown>} */ (step);
    if (!(weekDetail === null || weekDetail === 'day' || weekDetail === 'week') || !PANELS.some((p) => p === panel)) return null;
    if (!validSetupPlace(setup, roof)) return null;
    return {
        panel: /** @type {Panel} */ (panel),
        weekDetail: /** @type {'day' | 'week' | null} */ (weekDetail),
        setup: /** @type {SetupStep | null} */ (setup),
        roof: /** @type {number} */ (roof),
    };
}

/** Obrazovka sprievodcu a plocha z položky histórie. @param {unknown} setup @param {unknown} roof */
function validSetupPlace(setup, roof) {
    return (setup === null || SETUP_STEPS.some((s) => s === setup)) && Number.isInteger(roof) && /** @type {number} */ (roof) >= 0;
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
 * Rozpísané nastavenie tak, ako by sa uložilo: bez kiosku, keď človek živé meranie nechce,
 * a s výkonom panelu dopočítaným z celkového výkonu, keď zadal ten.
 * @param {AppState} state @returns {import('../shared/settings.js').Settings}
 */
export function setupDraft(state) {
    const draft = state.setupLive ? state.settingsDraft : { ...state.settingsDraft, kiosk: '' };
    return resolveDraft(draft, state.setupKwp);
}
