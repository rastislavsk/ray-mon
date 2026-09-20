// Všetky DOM referencie na jednom mieste, načítané raz po naparsovaní stránky.
// Render funkcie dostávajú tento objekt a nikdy nevolajú querySelector samy.

// Posledný zvyšok premenovania karty `zdielat` na `nastavenie`: v index.html aj v PANELS je
// už všade nový názov, tieto dva preklady len držia pri živote stránku a skripty z minulých
// nasadení, ktoré môžu byť ešte v cache (prehliadač ich vie desať minút miešať a byId na
// chýbajúci prvok zhodí appku ešte pred prvým render(), viď CLAUDE.md). Po nasadení tohto
// kroku a vypršaní cache zmaž ALIAS, panelFromHtml aj ich použitie - premenovanie je hotové.
/** @type {Record<string, string>} */
const ALIAS = {
    'panel-zdielat': 'panel-nastavenie',
    'panel-nastavenie': 'panel-zdielat',
    'nav-zdielat': 'nav-nastavenie',
    'nav-nastavenie': 'nav-zdielat',
};

/**
 * Názov karty z príznaku data-panel v stránke. Z toho istého dôvodu ako ALIAS vyššie:
 * stránka v cache môže byť staršia než skript a niesť ešte starý názov tretej karty.
 * Patrí k tomu istému upratovaniu - zmaž ju v poslednom kroku premenovania.
 * @param {string} raw @returns {string}
 */
export const panelFromHtml = (raw) => (raw === 'zdielat' ? 'nastavenie' : raw);

const byId = (/** @type {string} */ id) => {
    const alias = ALIAS[id];
    const el = document.getElementById(id) ?? (alias ? document.getElementById(alias) : null);
    if (!el) throw new Error(`Chýba element #${id}`);
    return el;
};

// Karty v poradí navigácie. Kódový názov a popiska v navigácii nie sú vždy to isté slovo,
// preto tu ostáva mapovanie: terazky = „Terazky", 7dni = „7 dní", nastavenie = „Nastavenie",
// info = „Info". Popiska je text pre používateľa a mení sa podľa chuti; kódový názov drží
// HTML id, CSS selektory aj stav, tak nech ho popiska nemusí naháňať.
export const PANELS = /** @type {const} */ (['terazky', '7dni', 'nastavenie', 'info']);

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

// Karta Nastavenie: zatiaľ len prvky jej jedinej položky, ktorá niečo kreslí - zdieľania appky.
function nastavenieDom() {
    return {
        qrcode: byId('qrcode'),
        shareWhatsapp: /** @type {HTMLAnchorElement} */ (byId('share-whatsapp')),
    };
}

export function collectDom() {
    return { ...headerDom(), ...terazkyDom(), ...sedemdniDom(), ...nastavenieDom() };
}

/** @typedef {ReturnType<typeof collectDom>} Dom */
