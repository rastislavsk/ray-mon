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
        mzSheet: /** @type {HTMLDialogElement} */ (byId('mz-sheet')),
        mzSheetX: byId('mz-sheet-x'),
        mzSheetTitle: byId('mz-sheet-title'),
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

export function collectDom() {
    return {
        ...mozemDom(),
        ...terazDom(),
        // <html> nesie farby oblohy (--s1, --s2) a počasie (data-sky).
        root: document.documentElement,
        page: byId('page'),
        place: byId('hdr-place'),
        live: byId('hdr-live'),
        status: byId('hdr-status'),
        tone: byId('hdr-tone'),
        setup: byId('hdr-setup'),
        panels: perPanel('panel'),
        navs: perPanel('nav'),
    };
}

/** @typedef {ReturnType<typeof collectDom>} Dom */
