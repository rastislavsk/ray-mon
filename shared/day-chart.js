// Graf dňa na karte Terazky / Teraz v oboch appkách a v detaile dňa na karte 7 dní novej appky:
// odhora oblačnosť po hodinách, krivka výroby od polnoci do polnoci s osou kW, hranica veľkých
// spotrebičov a plocha nad ňou, značka „teraz“ a náhľad iného času, pod grafom pás plánu po
// polhodinách.
// Čistá geometria v súradniciach SVG (viewBox DAY_CHART.w × DAY_CHART.h) podľa návrhu
// (docs/navrhy/terazky-casova-os.html, C2 s výplňou). Plán aj výkon prichádzajú hotové z day-plan.js
// a hero-model.js - tu sa nič nepočíta inak, len kreslí.

import { kwGridStep } from './chart-model.js';
import { MINUTES_PER_DAY, PREVIEW } from './config.js';
import { formatGridKw } from './format.js';
import { DAY_CHART_KEYS, TERAZ_TONES, terazPreviewTime } from './messages-core.js';

/** Čo platí v danej štvrťhodine plánu: slnko stačí, lacná sieť, drahá sieť, inak bežná cena. @typedef {'sun' | 'cheap' | 'costly' | 'plain'} Tone */
/** @typedef {{ from: number, to: number, tone: Tone }} Cell bunka pásu plánu, minúty dňa */

/**
 * Rozmery grafu: vodorovne od `left` po `right` je celý deň (vľavo od `left` čísla osi kW),
 * zvislo odhora čas náhľadu, riadok oblačnosti (`cloudY`, výška `cloudH`), voľné miesto pre nápis
 * hranice, keď musí vystúpiť nad krivku, krivka od `top`
 * (`maxKw`, pevný vrch stupnice - krivky dní sa dajú porovnať na prvý pohľad) po `base` (nula)
 * a pás plánu (`bandY`, `bandH`) s hodinami pod ním.
 */
export const DAY_CHART = {
    w: 320,
    h: 176,
    left: 26,
    right: 306,
    cloudY: 24,
    cloudH: 12,
    top: 62,
    base: 138,
    bandY: 148,
    bandH: 9,
    maxKw: 10,
    cellMin: 30,
};

/**
 * Popisky grafu - hodiny, čísla osi kW, nápis hranice veľkých spotrebičov a čas náhľadu -
 * majú na každej šírke tú istú veľkosť v px ako na telefóne: graf sa s oknom zväčšuje, písmo nie.
 * Kreslia sa preto ako HTML nad SVG (web/day-chart.js) a ich poloha je v % grafu. Písmo je v style.css
 * (.dc-t, .dc-y, .dc-limit-t, .dc-at-t) a musí sedieť s číslami tu: `limitPx` a `timePx` veľkosť písma,
 * `charEm` a `timeCharEm` šírka znaku s rezervou, `lineEm` výška riadku, `gapPx` odstup nápisu
 * od čiary. `minScale` je najmenšia mierka grafu (px na jednotku
 * viewBoxu): graf široký 274 px na displeji 320 px - tam zaberá nápis v jednotkách grafu najviac.
 * `wideScale` je mierka, od ktorej má nápis vlastnú polohu (graf aspoň 448 px - container query
 * v style.css musí sedieť): na širokom grafe je nápis v pomere ku grafu malý a zmestí sa aj tam,
 * kde by na telefóne prekryl krivku.
 */
export const DAY_CHART_LABELS = {
    limitPx: 12,
    timePx: 15,
    charEm: 0.5,
    timeCharEm: 0.56,
    lineEm: 1.25,
    gapPx: 2,
    minScale: 0.85,
    wideScale: 1.4,
};

/**
 * Polomer, v ktorom nápis nesmie zasiahnuť značku „teraz“ (bodka s polomerom 5) či čiaru náhľadu
 * (bodka 6 s okrajom).
 */
const MARK_R = 7;

/** Rezerva okolo krivky (hrúbka čiary). */
const LINE_PAD = 1.5;

/** Hodiny, ktoré majú pod grafom popisok. */
const TICK_HOURS = [0, 6, 12, 18, 24];

/** Zaokrúhlenie súradnice na desatinu - kratší zápis SVG, oko rozdiel nevidí. @param {number} v */
const r1 = (v) => Math.round(v * 10) / 10;

/**
 * Farba štvrťhodiny plánu. Zelená je tá istá ako v pláne dňa (`tier`
 * zo smartTier), modrá a červená cena pásma tarify.
 * @param {{ tier: import('./config.js').Tier | null, level: import('./config.js').PriceLevel }} slot @returns {Tone}
 */
export function slotTone(slot) {
    if (slot.tier === 'green') return 'sun';
    if (slot.level === 'lacna') return 'cheap';
    if (slot.level === 'draha') return 'costly';
    return 'plain';
}

/**
 * Pás plánu po polhodinách. Bunka má farbu štvrťhodiny v jej strede (druhej z dvoch) - jedno
 * pravidlo pre všetky bunky, nie väčšina ani priemer.
 * @param {import('./day-plan.js').PlanSlot[]} plan celý deň po štvrťhodinách (dayPlan) @returns {Cell[]}
 */
export function planCells(plan) {
    const step = plan[0].min;
    return Array.from({ length: MINUTES_PER_DAY / DAY_CHART.cellMin }, (_, i) => {
        const from = i * DAY_CHART.cellMin;
        const mid = plan[Math.floor((from + DAY_CHART.cellMin / 2) / step)];
        return { from, to: from + DAY_CHART.cellMin, tone: slotTone(mid) };
    });
}

/**
 * Legenda pod pásom plánu: farby, ktoré v páse naozaj sú, slovom a v pevnom poradí - aby farba
 * nebola jediný nosič významu. @param {Array<{ tone: Tone }>} cells
 */
export function planLegend(cells) {
    const order = /** @type {Tone[]} */ (['sun', 'cheap', 'costly', 'plain']);
    return order.filter((t) => cells.some((c) => c.tone === t)).map((tone) => ({ tone, text: TERAZ_TONES[tone] }));
}

/**
 * Celá legenda pod grafom dňa: výkon, predpoveď a oblačnosť, za nimi farby pásu
 * plánu (planLegend). `tone` je kľúč pre CSS appky (`data-tone`).
 * @param {Array<{ tone: Tone }>} cells @returns {Array<{ tone: string, text: string }>}
 */
export function chartLegend(cells) {
    return [
        { tone: 'power', text: DAY_CHART_KEYS.power },
        { tone: 'forecast', text: DAY_CHART_KEYS.forecast },
        { tone: 'cloud', text: DAY_CHART_KEYS.cloud },
        ...planLegend(cells),
    ];
}

/** Bunka pásu, do ktorej padne minúta dňa. @template {Cell} T @param {T[]} cells @param {number} min */
export function cellAt(cells, min) {
    return cells[Math.min(cells.length - 1, Math.max(0, Math.floor(min / DAY_CHART.cellMin)))];
}

/** Vodorovná poloha minúty dňa. @param {number} min */
export const chartX = (min) => DAY_CHART.left + (min / MINUTES_PER_DAY) * (DAY_CHART.right - DAY_CHART.left);

/**
 * Minúta dňa pre miesto na grafe, zaokrúhlená na krok náhľadu (štvrťhodina, ako šípky na
 * klávesnici). Mimo kriviek sa drží krajov dňa.
 * @param {number} rel poloha od ľavého okraja grafu ako podiel jeho šírky (0 až 1)
 */
export function chartMinutes(rel) {
    const step = PREVIEW.keyStepMin;
    const frac = (rel * DAY_CHART.w - DAY_CHART.left) / (DAY_CHART.right - DAY_CHART.left);
    const min = Math.round((Math.max(0, Math.min(1, frac)) * MINUTES_PER_DAY) / step) * step;
    return Math.min(min, MINUTES_PER_DAY - step);
}

/**
 * Geometria grafu dňa.
 * @param {{ plan: import('./day-plan.js').PlanSlot[], hourly: Array<{ hour: number, kw: number, cloud?: number | null }>,
 *   real: Array<{ hour: number, kw: number }>, boundary: number | null, nowMin: number | null, nowKw: number,
 *   limitKw: number, limitText: string, preview: { min: number, kw: number, text: string } | null }} d `hourly`
 *   predpoveď dňa aj s oblačnosťou po hodinách, `real` nameraná krivka (kreslí sa po `boundary`, posledný
 *   nameraný bod), `nowMin`
 *   značka „teraz“ (null = iný deň než dnešok, značka nie je), `limitKw` hranica veľkých spotrebičov
 *   a `limitText` nápis pri nej, `preview` náhľad iného času s popiskom (čas)
 */
export function dayChartModel({ plan, hourly, real, boundary, nowMin, nowKw, limitKw, limitText, preview }) {
    const C = DAY_CHART;
    const measured = boundary === null ? [] : real.filter((p) => p.hour * 60 <= boundary);
    const max = C.maxKw;
    const step = kwGridStep(max, 4);
    const y = (/** @type {number} */ kw) => r1(C.base - (Math.min(max, Math.max(0, kw)) / max) * (C.base - C.top));
    const x = (/** @type {number} */ min) => r1(chartX(min));
    const limitY = y(limitKw);
    const { forecast, curve, paths } = linesOf(hourly, measured, x, y, limitY);
    const cellW = r1(chartX(C.cellMin) - chartX(0) - 0.8);
    const at = (/** @type {number} */ min, /** @type {number} */ kw) => ({ x: x(min), y: Number.isFinite(kw) ? y(kw) : null });
    // Bunky, ktoré dnes už prešli, sú stlmené: hranica medzi nimi a plným pásom ukazuje „teraz“ aj
    // v páse. Bunka, v ktorej „teraz“ je, ešte platí.
    const cells = planCells(plan).map((c) => ({ ...c, x: x(c.from), w: cellW, past: nowMin !== null && c.to <= nowMin }));
    // Čiara náhľadu stojí bez náhľadu na „teraz“ (ak je dnešok) - čas pri nej povie, ktorá chvíľa to je.
    const at0 = preview ?? (nowMin === null ? null : { min: nowMin, kw: nowKw, text: terazPreviewTime(nowMin) });
    const mark = at0 && { ...at(at0.min, at0.kw), min: at0.min, text: at0.text };
    return {
        ...paths,
        grid: Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step).map((kw) => ({ y: y(kw), label: formatGridKw(kw) })),
        limitY,
        limitText,
        // Nápis hranice nesmie prekryť krivky, bod „teraz“ ani čiaru náhľadu.
        limitAt: limitPlaces(limitY, limitText, [forecast, curve], marksOf(nowMin, mark)),
        clouds: cloudCells(hourly, x),
        cells,
        ticks: TICK_HOURS.map((h) => ({ x: x(h * 60), label: String(h) })),
        now: nowMin === null ? null : at(nowMin, nowKw),
        // Čiara náhľadu (alebo „teraz“): čas nad ňou, zvýraznená bunka pásu a hodina oblačnosti pod ňou.
        mark: mark && {
            x: mark.x,
            y: mark.y,
            preview: !!preview,
            label: labelOf(mark.text),
            cell: cellAt(cells, mark.min),
            hour: Math.min(23, Math.floor(mark.min / 60)),
        },
    };
}

/**
 * Čiary grafu: predpoveď cez celý deň (posledná hodina drží do polnoci), nameraná krivka a plocha
 * nad hranicou veľkých spotrebičov (slnko navyše na ne) - krivka dňa je meranie po hranicu, za ňou
 * predpoveď, tá istá ako výkon v náhľade (dayKwAt). Pod hranicou plocha nie je.
 * @param {Array<{ hour: number, kw: number }>} hourly @param {Array<{ hour: number, kw: number }>} measured
 * @param {(min: number) => number} x @param {(kw: number) => number} y @param {number} limitY
 */
function linesOf(hourly, measured, x, y, limitY) {
    const toPt = (/** @type {{ hour: number, kw: number }} */ p) => ({ x: x(p.hour * 60), y: y(p.kw) });
    const path = (/** @type {Pt[]} */ list) => (list.length ? `M${list.map((p) => `${p.x} ${p.y}`).join(' L')}` : '');
    const last = hourly[hourly.length - 1];
    const forecast = last ? [...hourly.map(toPt), { x: x(MINUTES_PER_DAY), y: y(last.kw) }] : [];
    const curve = measured.length > 1 ? measured.map(toPt) : [];
    const end = curve.length ? curve[curve.length - 1].x : -Infinity;
    const day = [...curve, ...forecast.filter((p) => p.x > end)];
    return {
        forecast,
        curve,
        paths: {
            forecast: path(forecast),
            real: path(curve),
            over: day.some((p) => p.y < limitY) ? fillPath(day, limitY, 'over') : '',
        },
    };
}

/**
 * Oblačnosť po hodinách: bunka na hodinu, `cloud` v percentách. Hodina bez údaja bunku nemá.
 * @param {Array<{ hour: number, cloud?: number | null }>} hourly @param {(min: number) => number} x
 */
function cloudCells(hourly, x) {
    const w = r1(x(60) - x(0) - 1.6);
    return hourly
        .filter((p) => Number.isFinite(p.cloud) && p.hour >= 0 && p.hour < 24)
        .map((p) => ({ hour: p.hour, x: r1(x(p.hour * 60) + 0.8), w, cloud: /** @type {number} */ (p.cloud) }));
}

/**
 * Plocha pod krivkou dňa nad hranicou (`over`: medzi krivkou a čiarou, kde je krivka nad ňou) alebo
 * pod ňou (`under`: od nuly po krivku, najvyššie po čiaru). Kde krivka čiaru pretne, pribudne bod
 * priesečníka, aby plocha končila presne na nej.
 * @param {Pt[]} line @param {number} limitY @param {'over' | 'under'} part
 */
export function fillPath(line, limitY, part) {
    /** @type {Pt[]} */ const pts = [];
    line.forEach((p, i) => {
        const prev = line[i - 1];
        if (prev && (prev.y - limitY) * (p.y - limitY) < 0) {
            const t = (limitY - prev.y) / (p.y - prev.y);
            pts.push({ x: r1(prev.x + t * (p.x - prev.x)), y: limitY });
        }
        pts.push(p);
    });
    const clamp = (/** @type {number} */ v) => (part === 'over' ? Math.min(v, limitY) : Math.max(v, limitY));
    const edge = part === 'over' ? limitY : DAY_CHART.base;
    const first = pts[0];
    const last = pts[pts.length - 1];
    return `M${first.x} ${edge} L${pts.map((p) => `${p.x} ${clamp(p.y)}`).join(' L')} L${last.x} ${edge}Z`;
}

/**
 * Značky, ktorým sa nápis hranice vyhne: bod „teraz“ a čiara náhľadu (bez náhľadu stojí na „teraz“)
 * s časom nad ňou.
 * @param {number | null} nowMin @param {{ min: number, text: string } | null} mark @returns {Mark[]}
 */
function marksOf(nowMin, mark) {
    /** @type {Mark[]} */
    const marks = [];
    if (nowMin !== null) marks.push({ x: r1(chartX(nowMin)), halfPx: 0 });
    if (mark) marks.push({ x: r1(chartX(mark.min)), halfPx: labelOf(mark.text).w / 2 });
    return marks;
}

/**
 * Poloha nápisu hranice na úzkom grafe (telefón) a na širokom (od DAY_CHART_LABELS.wideScale).
 * @param {number} limitY @param {string} text @param {Pt[][]} lines @param {Mark[]} marks
 */
function limitPlaces(limitY, text, lines, marks) {
    return { narrow: limitSpot(limitY, text, lines, marks), wide: limitSpot(limitY, text, lines, marks, DAY_CHART_LABELS.wideScale) };
}

/**
 * Čas náhľadu nad čiarou: šírka v px z počtu znakov. Vystredí ho nad čiarou a udrží celý v grafe
 * render (CSS clamp) - šírka grafu v px je známa až v prehliadači.
 * @param {string} text
 */
function labelOf(text) {
    const L = DAY_CHART_LABELS;
    return { w: Math.round(text.length * L.timeCharEm * L.timePx), text };
}

/** @typedef {{ x: number, y: number }} Pt bod v jednotkách grafu */
/**
 * Značka v grafe (bod „teraz“, čiara náhľadu): `x` v jednotkách grafu, `halfPx` polovica šírky toho,
 * čo na nej v px stojí (čas náhľadu; pri „teraz“ 0 - stačí rezerva na bodku).
 * @typedef {{ x: number, halfPx: number }} Mark
 */
/** @typedef {{ x0: number, x1: number, y0: number, y1: number }} Box obdĺžnik v jednotkách grafu (y rastie nadol) */
/**
 * Kde nápis stojí: `x` bod, ku ktorému je zarovnaný koncom (`end`) alebo začiatkom, a `y` jeho
 * spodok - čiara hranice, alebo vyššie, keď je nápis nad krivkou.
 * @typedef {{ x: number, end: boolean, y: number }} Spot
 */

/**
 * Najvyšší a najnižší bod lomenej čiary nad úsekom [x0, x1]. Čiara ide zľava doprava; kde nad
 * úsekom nie je, vráti null.
 * @param {Pt[]} line @param {number} x0 @param {number} x1 @returns {[number, number] | null}
 */
function spanY(line, x0, x1) {
    /** @type {number[]} */
    const ys = [];
    for (let i = 1; i < line.length; i++) {
        const a = line[i - 1];
        const b = line[i];
        if (b.x < x0 || a.x > x1) continue;
        const yAt = (/** @type {number} */ x) => (b.x === a.x ? a.y : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x));
        ys.push(yAt(Math.max(a.x, x0)), yAt(Math.min(b.x, x1)), ...(b.x === a.x ? [b.y] : []));
    }
    return ys.length ? [Math.min(...ys), Math.max(...ys)] : null;
}

/** Prekrýva obdĺžnik lomenú čiaru (aj s jej hrúbkou)? @param {Box} box @param {Pt[]} line */
export function boxHitsLine(box, line) {
    const span = spanY(line, box.x0 - LINE_PAD, box.x1 + LINE_PAD);
    return !!span && span[0] <= box.y1 + LINE_PAD && span[1] >= box.y0 - LINE_PAD;
}

/**
 * Obdĺžnik, ktorý nápis hranice zaberie na každom grafe s mierkou aspoň `scale`. Nápis má pevnú
 * veľkosť v px, takže v jednotkách grafu je najväčší na najužšom z nich a na širšom sa zmenší smerom
 * k bodu, ku ktorému je zarovnaný, a k svojmu spodku. Obdĺžnik siaha od spodku (aj s medzerou
 * gapPx) po vrch nápisu na najužšom grafe - na širšom je nápis celý v ňom.
 * @param {string} text @param {Spot} spot @param {number} [scale] najmenšia mierka grafu (px na jednotku) @returns {Box}
 */
export function limitBox(text, { x, end, y }, scale = DAY_CHART_LABELS.minScale) {
    const L = DAY_CHART_LABELS;
    const w = (text.length * L.charEm * L.limitPx) / scale;
    const h = (L.limitPx * L.lineEm + L.gapPx) / scale;
    return { x0: end ? x - w : x, x1: end ? x : x + w, y0: y - h, y1: y };
}

/** Krok, o ktorý sa nápis posúva po čiare, keď kraje nie sú voľné. */
const SPOT_STEP = 10;

/**
 * Body, ku ktorým sa nápis skúša zarovnať: koniec čiary (kde bol vždy), jej začiatok, potom po
 * krokoch sprava doľava.
 * @returns {Array<{ x: number, end: boolean }>}
 */
function limitAnchors() {
    const end = DAY_CHART.right - 2;
    const start = DAY_CHART.left + 2;
    const anchors = [
        { x: end, end: true },
        { x: start, end: false },
    ];
    for (let x = end - SPOT_STEP; x > start; x -= SPOT_STEP) anchors.push({ x, end: true });
    return anchors;
}

/**
 * Kde stojí nápis hranice veľkých spotrebičov. Na žiadnom grafe s mierkou aspoň `scale` nesmie
 * prekryť krivku predpovede, nameranú krivku ani značky („teraz“, náhľad) a musí ostať v ploche krivky (pod riadkom oblačnosti).
 * Skúša sa: tesne nad čiarou na konci, na začiatku; potom na konci a na začiatku nad krivkou (nápis sa
 * zdvihne na voľné miesto nad ňou); potom to isté po krokoch pozdĺž čiary. Keď nič z toho nejde,
 * ostane nad čiarou na konci. Od značky sa nápis drží vodorovne v celej výške grafu: čiara náhľadu
 * ide cez celý graf aj s časom nad ňou, pri bode „teraz“ je to jednoduchšie pravidlo s rezervou.
 * @param {number} limitY @param {string} text @param {Pt[][]} lines krivky v grafe
 * @param {Mark[]} marks bod „teraz“ a čiara náhľadu (tie, ktoré v grafe sú)
 * @param {number} [scale] najmenšia mierka grafu, pre ktorú poloha platí (px na jednotku) @returns {Spot}
 */
export function limitSpot(limitY, text, lines, marks, scale = DAY_CHART_LABELS.minScale) {
    const free = (/** @type {Spot} */ spot) => {
        const b = limitBox(text, spot, scale);
        if (b.y0 < DAY_CHART.cloudY + DAY_CHART.cloudH) return false;
        const hit = (/** @type {Mark} */ m) => {
            const r = Math.max(MARK_R, m.halfPx / scale + LINE_PAD);
            return m.x + r >= b.x0 && m.x - r <= b.x1;
        };
        if (marks.some(hit)) return false;
        return !lines.some((line) => boxHitsLine(b, line));
    };
    /** Nad krivkou: spodok nápisu tesne nad jej najvyšším bodom pod ním (no nie pod čiarou). @param {{ x: number, end: boolean }} a */
    const raised = (a) => {
        const b = limitBox(text, { ...a, y: limitY }, scale);
        const tops = lines.map((line) => spanY(line, b.x0 - LINE_PAD, b.x1 + LINE_PAD)?.[0] ?? Infinity);
        return { ...a, y: Math.min(limitY, Math.min(...tops) - 2 * LINE_PAD) };
    };
    const anchors = limitAnchors();
    /** @type {Spot[]} */
    const tries = [...anchors.slice(0, 2).map((a) => ({ ...a, y: limitY })), ...anchors.slice(0, 2).map(raised)];
    for (const a of anchors.slice(2)) tries.push({ ...a, y: limitY }, raised(a));
    return tries.find(free) ?? { ...anchors[0], y: limitY };
}
