// Graf dňa novej appky (obloha/) na karte Teraz aj v detaile dňa na karte 7 dní: krivka výroby
// od polnoci do polnoci, hranica veľkých spotrebičov, značka „teraz“ a náhľad iného času, pod
// grafom pás plánu po polhodinách.
// Čistá geometria v súradniciach SVG (viewBox DAY_CHART.w × DAY_CHART.h) podľa návrhu
// (docs/navrhy/smer-b-obloha.html, `dayChart`). Plán aj výkon prichádzajú hotové z day-plan.js
// a hero-model.js - tu sa nič nepočíta inak, len kreslí.

import { MINUTES_PER_DAY, PREVIEW } from './config.js';
import { TERAZ_TONES } from './messages-core.js';

/** Čo platí v danej štvrťhodine plánu: slnko stačí, lacná sieť, drahá sieť, inak bežná cena. @typedef {'sun' | 'cheap' | 'costly' | 'plain'} Tone */
/** @typedef {{ from: number, to: number, tone: Tone }} Cell bunka pásu plánu, minúty dňa */

/**
 * Rozmery grafu: vodorovne od `left` po `right` je celý deň, zvislo od `top` (najvyšší výkon
 * stupnice) po `base` (nula). Pod nulou pás plánu a popisky hodín, nad `top` čas náhľadu.
 */
export const DAY_CHART = { w: 320, h: 150, left: 10, right: 310, top: 24, base: 112, bandY: 120, bandH: 9, cellMin: 30 };

/**
 * Popisky grafu - hodiny, nápis hranice veľkých spotrebičov a čas náhľadu - majú na každej šírke
 * tú istú veľkosť v px ako na telefóne: graf sa s oknom zväčšuje, písmo nie. Kreslia sa preto ako
 * HTML nad SVG (obloha/web/render/day-chart.js) a ich poloha je v % grafu. Písmo je v style.css
 * (.dc-t, .dc-limit-t, .dc-at-t) a musí sedieť s číslami tu: `limitPx` a `timePx` veľkosť písma,
 * `charEm` a `timeCharEm` šírka znaku s rezervou, `lineEm` výška riadku, `gapPx` odstup nápisu
 * od čiary. `minScale` je najmenšia mierka grafu (px na jednotku
 * viewBoxu): graf široký 274 px na displeji 320 px - tam zaberá nápis v jednotkách grafu najviac.
 * `wideScale` je mierka, od ktorej má nápis vlastnú polohu (graf aspoň 448 px - container query
 * v style.css musí sedieť): na širokom grafe je nápis v pomere ku grafu malý a zmestí sa aj tam,
 * kde by na telefóne prekryl krivku.
 */
export const DAY_CHART_LABELS = {
    limitPx: 13,
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
 * Farba štvrťhodiny plánu. Zelená je tá istá ako na dennom prstenci súčasnej appky (`tier`
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
 * @param {{ plan: import('./day-plan.js').PlanSlot[], hourly: Array<{ hour: number, kw: number }>,
 *   real: Array<{ hour: number, kw: number }>, boundary: number | null, nowMin: number | null, nowKw: number,
 *   limitKw: number, limitText: string, preview: { min: number, kw: number, text: string } | null }} d `hourly`
 *   predpoveď dňa, `real` nameraná krivka (kreslí sa po `boundary`, posledný nameraný bod), `nowMin`
 *   značka „teraz“ (null = iný deň než dnešok, značka nie je), `limitKw` hranica veľkých spotrebičov
 *   a `limitText` nápis pri nej, `preview` náhľad iného času s popiskom (čas)
 */
export function dayChartModel({ plan, hourly, real, boundary, nowMin, nowKw, limitKw, limitText, preview }) {
    const C = DAY_CHART;
    const measured = boundary === null ? [] : real.filter((p) => p.hour * 60 <= boundary);
    const kws = [limitKw, ...hourly.map((p) => p.kw), ...measured.map((p) => p.kw), nowMin === null ? 0 : nowKw, preview ? preview.kw : 0];
    // Stupnica s rezervou nad najvyšším bodom, aby krivka nenarážala na čas náhľadu.
    const max = Math.max(...kws.filter(Number.isFinite)) * 1.1 || 1;
    const y = (/** @type {number} */ kw) => r1(C.base - (Math.max(0, kw) / max) * (C.base - C.top));
    const x = (/** @type {number} */ min) => r1(chartX(min));
    const toPt = (/** @type {{ hour: number, kw: number }} */ p) => ({ x: x(p.hour * 60), y: y(p.kw) });
    const path = (/** @type {Pt[]} */ list) => `M${list.map((p) => `${p.x} ${p.y}`).join(' L')}`;
    const last = hourly[hourly.length - 1];
    // Obrys plochy predpovede: od nuly cez hodiny po koniec dňa a späť na nulu.
    const edge = hourly.length
        ? [{ x: x(0), y: C.base }, ...hourly.map(toPt), { x: x(MINUTES_PER_DAY), y: y(last.kw) }, { x: x(MINUTES_PER_DAY), y: C.base }]
        : [];
    const curve = measured.length > 1 ? measured.map(toPt) : [];
    const cellW = r1(chartX(C.cellMin) - chartX(0) - 0.8);
    const at = (/** @type {number} */ min, /** @type {number} */ kw) => ({ x: x(min), y: Number.isFinite(kw) ? y(kw) : null });
    // Bunky, ktoré dnes už prešli, sú stlmené: hranica medzi nimi a plným pásom ukazuje „teraz“ aj
    // v páse (zvislá čiara „teraz“ nie je, len bod). Bunka, v ktorej „teraz“ je, ešte platí.
    const cells = planCells(plan).map((c) => ({ ...c, x: x(c.from), w: cellW, past: nowMin !== null && c.to <= nowMin }));
    return {
        area: edge.length ? `${path(edge)}Z` : '',
        real: curve.length ? path(curve) : '',
        limitY: y(limitKw),
        limitText,
        // Nápis hranice nesmie prekryť krivky, bod „teraz“ ani čiaru náhľadu.
        limitAt: limitPlaces(y(limitKw), limitText, [edge, curve], marksOf(nowMin, preview)),
        cells,
        ticks: TICK_HOURS.map((h) => ({ x: x(h * 60), label: String(h) })),
        now: nowMin === null ? null : at(nowMin, nowKw),
        // Náhľad: čas pri čiare a zvýraznená bunka pásu pod ňou - jej farba povie, čo vtedy platí.
        preview: preview ? { ...at(preview.min, preview.kw), label: labelOf(preview.text), cell: cellAt(cells, preview.min) } : null,
    };
}

/**
 * Značky, ktorým sa nápis hranice vyhne: bod „teraz“ a čiara náhľadu s časom nad ňou.
 * @param {number | null} nowMin @param {{ min: number, text: string } | null} preview @returns {Mark[]}
 */
function marksOf(nowMin, preview) {
    /** @type {Mark[]} */
    const marks = [];
    if (nowMin !== null) marks.push({ x: r1(chartX(nowMin)), halfPx: 0 });
    if (preview) marks.push({ x: r1(chartX(preview.min)), halfPx: labelOf(preview.text).w / 2 });
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
 * prekryť krivku predpovede, nameranú krivku ani značky („teraz“, náhľad) a musí ostať v grafe.
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
        if (b.y0 < 0) return false;
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
