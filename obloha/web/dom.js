// Všetky DOM referencie novej appky, načítané raz po naparsovaní stránky. Render funkcie
// dostávajú tento objekt a nikdy nevolajú querySelector samy.

import { PANELS } from '../../shared/config.js';

/** Prvok podľa id. Chýbajúci prvok je chyba (napr. staré index.html z cache) - boot.js ju zachytí. */
const byId = (/** @type {string} */ id) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Chýba element #${id}`);
    return el;
};

/** @param {string} prefix */
const perPanel = (prefix) =>
    /** @type {Record<import('./state.js').Panel, HTMLElement>} */ (Object.fromEntries(PANELS.map((p) => [p, byId(`${prefix}-${p}`)])));

/** Karta Môžem? a jej panel veci. */
function mozemDom() {
    return {
        mzArc: byId('mz-arc'),
        mzAnswer: byId('mz-answer'),
        mzChips: byId('mz-chips'),
        mzWord: byId('mz-word'),
        mzLead: byId('mz-lead'),
        mzLive: byId('mz-live'),
        mzPhones: byId('mz-phones'),
        mzPhonesText: byId('mz-phones-text'),
        mzRetry: byId('mz-retry'),
        mzGuess: byId('mz-guess'),
        mzGuessTitle: byId('mz-guess-title'),
        mzGuessText: byId('mz-guess-text'),
        mzGuessBtn: byId('mz-guess-btn'),
        mzAsk: byId('mz-ask'),
        mzAskTitle: byId('mz-ask-title'),
        mzAskText: byId('mz-ask-text'),
        mzAskBtn: byId('mz-ask-btn'),
        mzList: byId('mz-list'),
        mzListTitle: byId('mz-list-title'),
        mzItems: byId('mz-items'),
        mzCount: byId('mz-count'),
        mzQuip: byId('mz-quip'),
        mzQuipText: byId('mz-quip-text'),
        mzQuipHint: byId('mz-quip-hint'),
        mzSummary: byId('mz-summary'),
        mzSummaryText: byId('mz-summary-text'),
        mzSheet: /** @type {HTMLDialogElement} */ (byId('mz-sheet')),
        mzSheetX: byId('mz-sheet-x'),
        mzSheetTitle: byId('mz-sheet-title'),
        mzSheetLead: byId('mz-sheet-lead'),
        mzSheetRows: byId('mz-sheet-rows'),
        mzSheetDoQ: byId('mz-sheet-do-q'),
        mzSheetDo: byId('mz-sheet-do'),
        mzSheetWhyQ: byId('mz-sheet-why-q'),
        mzSheetWhy: byId('mz-sheet-why'),
        mzSheetMoreQ: byId('mz-sheet-more-q'),
        mzSheetMore: byId('mz-sheet-more'),
        mzSheetLog: byId('mz-sheet-log'),
    };
}

/** Karta Teraz. */
function terazDom() {
    return {
        tzNum: byId('tz-num'),
        tzNumVal: byId('tz-num-val'),
        tzSrc: byId('tz-src'),
        tzSub: byId('tz-sub'),
        tzRetry: byId('tz-retry'),
        tzGuess: byId('tz-guess'),
        tzGuessTitle: byId('tz-guess-title'),
        tzGuessText: byId('tz-guess-text'),
        tzGuessBtn: byId('tz-guess-btn'),
        tzAsk: byId('tz-ask'),
        tzAskTitle: byId('tz-ask-title'),
        tzAskText: byId('tz-ask-text'),
        tzAskBtn: byId('tz-ask-btn'),
        tzPlot: byId('tz-plot'),
        tzChart: byId('tz-chart'),
        tzChartDesc: byId('tz-chart-desc'),
        tzLegend: byId('tz-legend'),
        tzHint: byId('tz-hint'),
        tzReset: byId('tz-reset'),
        tzRecs: byId('tz-recs'),
        tzStrip: byId('tz-strip'),
        tzNowHead: byId('tz-now-head'),
        tzNowBody: byId('tz-now-body'),
        tzDevicesTitle: byId('tz-devices-title'),
        tzDevices: byId('tz-devices'),
        tzTodayTitle: byId('tz-today-title'),
        tzToday: byId('tz-today'),
        tzTodayBar: byId('tz-today-bar'),
        tzWindow: byId('tz-window'),
        tzLaterTitle: byId('tz-later-title'),
        tzLater: byId('tz-later'),
        tzDots: byId('tz-dots'),
    };
}

/** Karta 7 dní: prehľad dní, detail dňa a detail týždňa. */
function sedemDom() {
    return {
        sdList: byId('sd-list'),
        sdTitle: byId('sd-title'),
        sdSum: byId('sd-sum'),
        sdSumText: byId('sd-sum-text'),
        sdSub: byId('sd-sub'),
        sdRetry: byId('sd-retry'),
        sdAsk: byId('sd-ask'),
        sdAskTitle: byId('sd-ask-title'),
        sdAskText: byId('sd-ask-text'),
        sdAskBtn: byId('sd-ask-btn'),
        sdGuess: byId('sd-guess'),
        sdGuessTitle: byId('sd-guess-title'),
        sdGuessText: byId('sd-guess-text'),
        sdGuessBtn: byId('sd-guess-btn'),
        sdDays: byId('sd-days'),
        sdHint: byId('sd-hint'),
        sdDay: byId('sd-day'),
        sdDayBack: byId('sd-day-back'),
        sdDayBackText: byId('sd-day-back-text'),
        sdDayTitle: byId('sd-day-title'),
        sdDayIcon: byId('sd-day-icon'),
        sdDaySub: byId('sd-day-sub'),
        sdDayNums: byId('sd-day-nums'),
        sdDayChart: byId('sd-day-chart'),
        sdDayLegend: byId('sd-day-legend'),
        sdDayFacts: byId('sd-day-facts'),
        sdDayDone: byId('sd-day-done'),
        sdDayClear: byId('sd-day-clear'),
        sdDayMsgTitle: byId('sd-day-msg-title'),
        sdDayMsgBody: byId('sd-day-msg-body'),
        sdDayHint: byId('sd-day-hint'),
        sdWeek: byId('sd-week'),
        sdWeekBack: byId('sd-week-back'),
        sdWeekBackText: byId('sd-week-back-text'),
        sdWeekTitle: byId('sd-week-title'),
        sdWeekRange: byId('sd-week-range'),
        sdWeekNums: byId('sd-week-nums'),
        sdBarsTitle: byId('sd-bars-title'),
        sdBars: byId('sd-bars'),
        sdHeatTitle: byId('sd-heat-title'),
        sdHeat: byId('sd-heat'),
        sdHeatNote: byId('sd-heat-note'),
        sdWeekMsgTitle: byId('sd-week-msg-title'),
        sdWeekMsgBody: byId('sd-week-msg-body'),
        sdWeekHint: byId('sd-week-hint'),
    };
}

/** Karta Štatistika a plagát na zdieľanie. */
function statistikaDom() {
    return {
        stSub: byId('st-sub'),
        stRetry: byId('st-retry'),
        stAsk: byId('st-ask'),
        stAskTitle: byId('st-ask-title'),
        stAskText: byId('st-ask-text'),
        stAskBtn: byId('st-ask-btn'),
        stSetup: byId('st-setup'),
        stSetupTitle: byId('st-setup-title'),
        stSetupText: byId('st-setup-text'),
        stSetupBtn: byId('st-setup-btn'),
        stLaterTitle: byId('st-later-title'),
        stLaterText: byId('st-later-text'),
        stBody: byId('st-body'),
        stSeg: byId('st-seg'),
        stNum: byId('st-num'),
        stNumVal: byId('st-num-val'),
        stSrc: byId('st-src'),
        stValue: byId('st-value'),
        stProgress: byId('st-progress'),
        stBar: byId('st-bar'),
        stProgressText: byId('st-progress-text'),
        stEquiv: byId('st-equiv'),
        stEquivTitle: byId('st-equiv-title'),
        stPhones: byId('st-phones'),
        stPhonesLabel: byId('st-phones-label'),
        stKm: byId('st-km'),
        stKmLabel: byId('st-km-label'),
        stRows: byId('st-rows'),
        stBest: byId('st-best'),
        stBestTitle: byId('st-best-title'),
        stBestText: byId('st-best-text'),
        stNote: byId('st-note'),
        stMeasureOff: byId('st-measure-off'),
        stMeasure: byId('st-measure'),
        stMeasureTitle: byId('st-measure-title'),
        stMeasureText: byId('st-measure-text'),
        stMeasureBtn: byId('st-measure-btn'),
        stPrices: byId('st-prices'),
        stPricesTitle: byId('st-prices-title'),
        stPricesText: byId('st-prices-text'),
        stPricesBtn: byId('st-prices-btn'),
        stPosters: byId('st-posters'),
        poster: /** @type {HTMLDialogElement} */ (byId('poster')),
        posterTitle: byId('poster-title'),
        posterKwh: byId('poster-kwh'),
        posterCols: byId('poster-cols'),
        posterTiles: byId('poster-tiles'),
        posterFoot: byId('poster-foot'),
        posterNote: byId('poster-note'),
        posterShare: byId('poster-share'),
        posterClose: byId('poster-close'),
    };
}

/** Obrazovky sprievodcu v poradí krokov (id `wz-<krok>`). */
const SETUP_SCREENS = /** @type {const} */ ([
    'start',
    'odkaz',
    'lokalita',
    'panel',
    'smer',
    'sklon',
    'pocet',
    'dalsia',
    'menic',
    'meranie',
    'tarifa',
    'pasma',
    'rozvrh',
    'vynimky',
    'ceny',
    'suhrn',
]);

const input = (/** @type {string} */ id) => /** @type {HTMLInputElement} */ (byId(id));
const select = (/** @type {string} */ id) => /** @type {HTMLSelectElement} */ (byId(id));

/** Karta Nastavenie: prehľad elektrárne a ponuka prevziať nastavenie z odkazu. */
function nastavenieDom() {
    return {
        setupRoot: byId('setup'),
        nsHome: byId('ns-home'),
        nsCta: byId('ns-cta'),
        nsCtaTitle: byId('ns-cta-title'),
        nsCtaSteps: byId('ns-cta-steps'),
        nsCtaText: byId('ns-cta-text'),
        nsCtaBtn: byId('ns-cta-btn'),
        nsHero: byId('ns-hero'),
        nsRows: byId('ns-rows'),
        nsWarn: byId('ns-warn'),
        nsNote: byId('ns-note'),
        nsLink: byId('ns-link'),
        importOffer: byId('import-offer'),
        importOfferText: byId('import-offer-text'),
        importAccept: byId('import-accept'),
        importDecline: byId('import-decline'),
        nsLiveSky: byId('ns-live-sky'),
        nsVoice: byId('ns-voice'),
        nsStart: byId('ns-start'),
        nsShare: byId('ns-share'),
        nsReset: byId('ns-reset'),
        nsShareSheet: /** @type {HTMLDialogElement} */ (byId('ns-share-sheet')),
        nsShareX: byId('ns-share-x'),
        nsShareOpts: byId('ns-share-opts'),
        nsShareSettings: input('ns-share-settings'),
        nsShareKiosk: input('ns-share-kiosk'),
        nsShareKioskRow: byId('ns-share-kiosk-row'),
        nsQr: byId('ns-qr'),
        nsShareLink: /** @type {HTMLAnchorElement} */ (byId('ns-share-link')),
        nsShareWa: /** @type {HTMLAnchorElement} */ (byId('ns-share-wa')),
        nsResetSheet: /** @type {HTMLDialogElement} */ (byId('ns-reset-sheet')),
        nsResetOk: byId('ns-reset-ok'),
        nsResetCancel: byId('ns-reset-cancel'),
    };
}

/** Sprievodca: hlavička, záložky, tlačidlá a polia, ktoré obsluhuje web/setup-wiring.js. */
function wizardDom() {
    return {
        wizard: byId('wizard'),
        wzScreens: /** @type {Record<(typeof SETUP_SCREENS)[number], HTMLElement>} */ (
            Object.fromEntries(SETUP_SCREENS.map((x) => [x, byId(`wz-${x}`)]))
        ),
        wzStep: byId('wz-step'),
        wzClose: byId('wz-close'),
        wzProg: byId('wz-prog'),
        wzSub: byId('wz-sub'),
        wzTitle: byId('wz-title'),
        wzLead: byId('wz-lead'),
        wzGroupTabs: byId('wz-group-tabs'),
        wzRoofTabs: byId('wz-roof-tabs'),
        wzTariffTabs: byId('wz-tariff-tabs'),
        wzTariffMsgs: byId('wz-tariff-msgs'),
        wzBack: /** @type {HTMLButtonElement} */ (byId('wz-back')),
        wzNext: /** @type {HTMLButtonElement} */ (byId('wz-next')),
        wzLink: input('wz-link'),
        wzLinkNote: byId('wz-link-note'),
        wzLinkPreview: byId('wz-link-preview'),
        wzPlace: input('wz-place'),
        wzGeo: byId('wz-geo'),
        wzPlaceCard: byId('wz-place-card'),
        wzLat: input('wz-lat'),
        wzLon: input('wz-lon'),
        wzWelcome: byId('wz-welcome'),
        wzLater: byId('wz-later'),
        wzWpModePanel: byId('wz-wpmode-panel'),
        wzWpModeKwp: byId('wz-wpmode-kwp'),
        wzWpPanel: byId('wz-wp-panel'),
        wzWpLabel: byId('wz-wp-label'),
        wzWpChips: byId('wz-wp-chips'),
        wzWpOther: byId('wz-wp-other'),
        wzWp: input('wz-wp'),
        wzWpGuess: byId('wz-wp-guess'),
        wzWpTotal: byId('wz-wp-total'),
        wzKwp: input('wz-kwp'),
    };
}

/** Obrazovky plôch, meniča, merania a zhrnutia. */
function wizardFieldsDom() {
    return {
        wzCompass: byId('wz-compass'),
        wzDirName: byId('wz-dir-name'),
        wzDirDeg: byId('wz-dir-deg'),
        wzDirQuality: byId('wz-dir-quality'),
        wzTiltArt: byId('wz-tilt-art'),
        wzTiltPresets: byId('wz-tilt-presets'),
        wzTilt: input('wz-tilt'),
        wzTiltOut: byId('wz-tilt-out'),
        wzTiltQuality: byId('wz-tilt-quality'),
        wzPanels: input('wz-panels'),
        wzPanelGrid: byId('wz-panel-grid'),
        wzPanelsKwp: byId('wz-panels-kwp'),
        wzRoofs: byId('wz-roofs'),
        wzDerived: byId('wz-derived'),
        wzRoofAdd: byId('wz-roof-add'),
        wzAcBars: byId('wz-ac-bars'),
        wzAcChips: byId('wz-ac-chips'),
        wzAcOther: byId('wz-ac-other'),
        wzAc: input('wz-ac'),
        wzAcGuess: byId('wz-ac-guess'),
        wzLiveYes: byId('wz-live-yes'),
        wzLiveNo: byId('wz-live-no'),
        wzKioskBlock: byId('wz-kiosk-block'),
        wzKiosk: input('wz-kiosk'),
        wzKioskNote: byId('wz-kiosk-note'),
        wzSummary: byId('wz-summary'),
    };
}

/** Obrazovky tarify: typ sadzby, pásma, rozvrh dňa, výnimky a ceny. */
function wizardTariffDom() {
    return {
        wzTariffKinds: byId('wz-tariff-kinds'),
        wzTariffDunno: byId('wz-tariff-dunno'),
        wzBands: byId('wz-bands'),
        wzBandAdd: byId('wz-band-add'),
        wzSchedTabs: byId('wz-sched-tabs'),
        wzBrushes: byId('wz-brushes'),
        wzTariffRing: byId('wz-tariff-ring'),
        wzTariffRingG: byId('wz-tariff-ring-g'),
        wzRingSum: byId('wz-ring-sum'),
        wzSchedTpls: byId('wz-sched-tpls'),
        wzIvals: byId('wz-ivals'),
        wzIvalFrom: select('wz-ival-from'),
        wzIvalTo: select('wz-ival-to'),
        wzIvalBand: select('wz-ival-band'),
        wzExc: byId('wz-exc'),
        wzCurrency: byId('wz-currency'),
        wzPrices: byId('wz-prices'),
        wzPriceCheck: byId('wz-price-check'),
    };
}

export function collectDom() {
    return {
        ...mozemDom(),
        ...terazDom(),
        ...sedemDom(),
        ...statistikaDom(),
        ...nastavenieDom(),
        ...wizardDom(),
        ...wizardFieldsDom(),
        ...wizardTariffDom(),
        // <html> nesie farby oblohy (--s1, --s2) a počasie (data-sky).
        root: document.documentElement,
        page: byId('page'),
        place: byId('hdr-place'),
        live: byId('hdr-live'),
        status: byId('hdr-status'),
        tone: byId('hdr-tone'),
        setup: byId('hdr-setup'),
        panels: perPanel('panel'),
        // Nadpisy kariet a spoločný nadpis prehľadu so stĺpcami na širokej obrazovke.
        titles: perPanel('ttl'),
        dashTitle: byId('ttl-prehlad'),
        navs: perPanel('nav'),
        // Hláška namiesto karty, ktorej kód sa ešte sťahuje alebo sa stiahnuť nepodaril (web/parts.js).
        wait: byId('cakam'),
        waitLoading: byId('ck-loading'),
        waitFail: byId('ck-fail'),
        waitAgain: byId('ck-again'),
        waitLater: byId('ck-later'),
        waitRetry: byId('ck-retry'),
    };
}

/** @typedef {ReturnType<typeof collectDom>} Dom */
