// Všetky DOM referencie na jednom mieste, načítané raz po naparsovaní stránky.
// Render funkcie dostávajú tento objekt a nikdy nevolajú querySelector samy.

const byId = (/** @type {string} */ id) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Chýba element #${id}`);
    return el;
};

// Karty v poradí navigácie. Kódový názov a popiska v navigácii nie sú vždy to isté slovo,
// preto tu ostáva mapovanie: terazky = „Terazky", 7dni = „7 dní", nastavenie = „Nastavenie",
// info = „Info". Popiska je text pre používateľa a mení sa podľa chuti; kódový názov drží
// HTML id, CSS selektory aj stav, tak nech ho popiska nemusí naháňať.
export const PANELS = /** @type {const} */ (['terazky', '7dni', 'nastavenie', 'info']);

// Položky karty Info (natívne <details>); id v HTML je `info-<položka>`.
export const INFO_ITEMS = /** @type {const} */ (['guide', 'share']);

function headerDom() {
    return {
        // <html>, nie <body>: farba tarify sa zapisuje sem, lebo --bg-page je zložené
        // z --tint-rgb a obe musia byť na tom istom prvku (viď :root v style.css).
        root: document.documentElement,
        page: byId('page'),
        currentTimeDisplay: byId('current-time-display'),
        pvUpdated: byId('pv-updated'),
        panels: /** @type {Record<(typeof PANELS)[number], HTMLElement>} */ (
            Object.fromEntries(PANELS.map((p) => [p, byId(`panel-${p}`)]))
        ),
        navs: /** @type {Record<(typeof PANELS)[number], HTMLElement>} */ (Object.fromEntries(PANELS.map((p) => [p, byId(`nav-${p}`)]))),
    };
}

function terazkyDom() {
    return {
        previewReset: byId('preview-reset'),
        verdictForecastTitle: byId('verdict-forecast-title'),
        verdictForecastBody: byId('verdict-forecast-body'),
        dialRing: byId('dial-ring'),
        pvPower: byId('pv-power'),
        pvPowerUnit: byId('pv-power-unit'),
        verdictHeadline: byId('verdict-headline'),
        verdictBody: byId('verdict-body'),
        verdictGoRow: byId('verdict-go-row'),
        verdictPager: byId('verdict-pager'),
        verdictPageWait: byId('verdict-page-wait'),
        verdictDotButtons: /** @type {HTMLElement[]} */ (Array.from(byId('verdict-dots').querySelectorAll('.pager-dot'))),
        verdictDotWait: byId('verdict-dot-wait'),
        verdictChipTooltip: byId('verdict-chip-tooltip'),
        verdictWaitTime: byId('verdict-wait-time'),
        dialWrap: byId('dial-wrap'),
        dayRing: byId('day-ring'),
        dialWhen: byId('dial-when'),
        dialNow: byId('dial-now'),
        dialGrip: byId('dial-grip'),
    };
}

function sedemdniDom() {
    return {
        weekSub: byId('week-sub'),
        weekHead: byId('week-head'),
        weekTrio: byId('week-trio'),
        weekDayHead: byId('week-day-head'),
        weekDayBack: byId('week-day-back'),
        weekDayTitle: byId('week-day-title'),
        weekGrid: byId('week-grid'),
        weekBlockHeat: byId('week-block-heat'),
        weekBlockBars: byId('week-block-bars'),
        weekBlockCurve: byId('week-block-curve'),
        weekBlockTable: byId('week-block-table'),
        weekBlockList: byId('week-block-list'),
        weekMsgBlock: byId('week-msg-block'),
        weekToday: byId('week-today'),
        weekTodayBadge: byId('week-today-badge'),
        weekTodayMeta: byId('week-today-meta'),
        weekTodayProgress: byId('week-today-progress'),
        weekTodayProgressFill: byId('week-today-progress-fill'),
        weekTodayProgressTxt: byId('week-today-progress-txt'),
        weekTodayProgressPct: byId('week-today-progress-pct'),
        weekTomorrow: byId('week-tomorrow'),
        weekTomorrowBadge: byId('week-tomorrow-badge'),
        weekTomorrowTrend: byId('week-tomorrow-trend'),
        weekTomorrowMeta: byId('week-tomorrow-meta'),
        weekTotal: byId('week-total'),
        weekTotalMeta: byId('week-total-meta'),
        weekHeatLabel: byId('week-heat-label'),
        weekHeatScale: byId('week-heat-scale'),
        weekHeatWrap: byId('week-heat-wrap'),
        weekHeat: byId('week-heat'),
        weekHeatTooltip: byId('week-heat-tooltip'),
        weekBarsStat: byId('week-bars-stat'),
        weekBarsWrap: byId('week-bars-wrap'),
        weekBars: byId('week-bars'),
        weekBarsTooltip: byId('week-bars-tooltip'),
        weekBarsClearLegend: byId('week-bars-clear-legend'),
        weekDayTabs: byId('week-day-tabs'),
        weekCurveLiveLegend: byId('week-curve-live-legend'),
        weekCurveStat: byId('week-curve-stat'),
        weekCurveWrap: byId('week-curve-wrap'),
        weekCurve: byId('week-curve'),
        weekCurveTooltip: byId('week-curve-tooltip'),
        weekTbody: byId('week-tbody'),
        weekList: byId('week-list'),
        weekListTotal: byId('week-list-total'),
        weekListAvg: byId('week-list-avg'),
        weekMsgTitle: byId('week-msg-title'),
        weekMsgBody: byId('week-msg-body'),
    };
}

/** Obrazovky sprievodcu nastavením - každá je vlastná sekcia v index.html, render ukáže jednu. */
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
    'suhrn',
]);

const input = (/** @type {string} */ id) => /** @type {HTMLInputElement} */ (byId(id));

// Karta Nastavenie: prehľad elektrárne a sprievodca nastavením.
function setupDom() {
    return {
        ...setupHomeDom(),
        ...wizardDom(),
        ...wizardFieldsDom(),
    };
}

// Prehľad uloženej elektrárne (alebo výzva k sprievodcovi) a hlavička sprievodcu.
function setupHomeDom() {
    return {
        settingsHead: byId('settings-head'),
        setup: byId('setup'),
        setupHome: byId('setup-home'),
        setupDemo: byId('setup-demo'),
        setupCta: byId('setup-cta'),
        setupOverview: byId('setup-overview'),
        setupHero: byId('setup-hero'),
        setupRows: byId('setup-rows'),
        setupWarnings: byId('setup-warnings'),
        setupNote: byId('setup-note'),
        wizard: byId('wizard'),
        wzStep: byId('wz-step'),
        wzClose: byId('wz-close'),
        wzProg: byId('wz-prog'),
        wzSub: byId('wz-sub'),
        wzTitle: byId('wz-title'),
        wzLead: byId('wz-lead'),
        wzRoofTabs: byId('wz-roof-tabs'),
    };
}

// Obrazovky sprievodcu a ich prvky.
function wizardDom() {
    return {
        wzScreens: /** @type {Record<(typeof SETUP_SCREENS)[number], HTMLElement>} */ (
            Object.fromEntries(SETUP_SCREENS.map((s) => [s, byId(`wz-${s}`)]))
        ),
        wzLink: input('wz-link'),
        wzLinkNote: byId('wz-link-note'),
        wzLinkPreview: byId('wz-link-preview'),
        wzPlace: input('wz-place'),
        wzGeo: byId('wz-geo'),
        wzPlaceCard: byId('wz-place-card'),
        wzLat: input('wz-lat'),
        wzLon: input('wz-lon'),
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

// Druhá polovica obrazoviek: plochy, menič, meranie, zhrnutie a tlačidlá dole.
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
        wzBack: /** @type {HTMLButtonElement} */ (byId('wz-back')),
        wzNext: /** @type {HTMLButtonElement} */ (byId('wz-next')),
    };
}

// Karta Info a ponuka prevziať nastavenie z odkazu.
function zdielanieDom() {
    return {
        infoItems: /** @type {Record<(typeof INFO_ITEMS)[number], HTMLDetailsElement>} */ (
            Object.fromEntries(INFO_ITEMS.map((i) => [i, byId(`info-${i}`)]))
        ),
        shareOptions: byId('share-options'),
        shareWithSettings: input('share-with-settings'),
        shareWithKiosk: input('share-with-kiosk'),
        shareKioskRow: byId('share-kiosk-row'),
        importOffer: byId('import-offer'),
        importOfferText: byId('import-offer-text'),
        importAccept: byId('import-accept'),
        importDecline: byId('import-decline'),
        qrcode: byId('qrcode'),
        shareWhatsapp: /** @type {HTMLAnchorElement} */ (byId('share-whatsapp')),
    };
}

export function collectDom() {
    return { ...headerDom(), ...terazkyDom(), ...sedemdniDom(), ...setupDom(), ...zdielanieDom() };
}

/** @typedef {ReturnType<typeof collectDom>} Dom */
