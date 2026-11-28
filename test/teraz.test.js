import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installedKw, MINUTES_PER_DAY, PLANT, powerThresholds, SITE, TARIFF, TYPICAL_PLANT } from '../shared/config.js';
import { TERAZ_BEZI } from '../shared/messages-teraz.js';
import {
    boxHitsLine,
    cellAt,
    chartMinutes,
    chartRange,
    chartX,
    DAY_CHART,
    DAY_CHART_LABELS,
    dayChartModel,
    fillPath,
    FULL_DAY,
    limitBox,
    limitSpot,
    planCells,
    slotTone,
    tickHours,
} from '../shared/day-chart.js';
import { dayPlan } from '../shared/day-plan.js';
import { kwpRoughText } from '../shared/format.js';
import { heroModel, pvFreshness } from '../shared/hero-model.js';
import {
    dayChartText,
    mozemGuessText,
    mozemOfflineText,
    TERAZ_TEXTS,
    terazBublinaText,
    terazPreviewTime,
    terazSourceText,
    terazTodayText,
    terazTypicalText,
    terazWindowText,
    terazZaText,
} from '../shared/messages.js';
import { mesiacNaOblohe, mesiacVPoli } from '../shared/mesiac.js';
import { mozemModel } from '../shared/mozem.js';
import { odmietnute } from '../shared/pristup.js';
import { typicalSettings } from '../shared/settings.js';
import { coZapnutModel, dnesCards, pocasieTeraz, terazModel } from '../shared/teraz.js';
import { planDnaModel } from '../shared/plan-dna.js';
import { fixtureData, pvAt } from './helpers.js';

/** Miestny čas 5. 9. 2026 v Bratislave (letný čas). @param {string} hm */
const at = (hm) => new Date(`2026-09-05T${hm}:00+02:00`);

/**
 * Vstup karty: Dvorany s kioskom, meranie a predpoveď ako v danej chvíli.
 * @param {Date} now @param {object} [extra] @returns {import('../shared/teraz.js').TerazInput}
 */
function input(now, extra = {}) {
    const { forecast } = fixtureData(now);
    return {
        now,
        site: SITE,
        plant: PLANT,
        tariff: TARIFF,
        zdroj: { sposob: 'huawei-kiosk', pecat: 'v1.test-pecat-0123456789', nazov: '' },
        loading: false,
        known: 'elektraren',
        pv: pvAt(now),
        forecast,
        previewMinutes: null,
        ...extra,
    };
}

/** Vstup pri známej polohe bez panelov: typická strecha, ako ho skladá appka. @param {Date} now */
function guessInput(now) {
    const typical = typicalSettings(SITE);
    const { forecast } = fixtureData(now);
    return /** @type {import('../shared/teraz.js').TerazInput} */ ({
        now,
        ...typical,
        loading: false,
        known: 'poloha',
        pv: null,
        forecast,
        previewMinutes: null,
    });
}

/** @param {number} h @param {number} [m] */
const hm = (h, m = 0) => h * 60 + m;

test('kwpRoughText: výkon strechy na celé kWp s „asi“, najmenej 1', () => {
    assert.equal(kwpRoughText(5.22), 'asi 5 kWp');
    assert.equal(kwpRoughText(10.44), 'asi 10 kWp');
    assert.equal(kwpRoughText(7.5), 'asi 8 kWp');
    assert.equal(kwpRoughText(0.3), 'asi 1 kWp');
    // Výzva karty Môžem? aj veta karty Teraz píšu zaokrúhlené číslo, výpočet ostáva presný.
    assert.equal(installedKw(TYPICAL_PLANT), 5.22);
    assert.match(mozemGuessText(installedKw(TYPICAL_PLANT)), /typickou strechou asi 5 kWp\./);
    assert.equal(terazTypicalText(installedKw(TYPICAL_PLANT)), 'typická strecha asi 5 kWp v tvojej obci, nie tvoja');
});

test('heroModel.source: živé meranie, nameraná krivka, predpoveď, bez výkonu null', () => {
    const live = input(at('13:00'));
    assert.equal(heroModel(live).source, 'live');
    assert.equal(heroModel({ ...live, previewMinutes: hm(10) }).source, 'measured');
    assert.equal(heroModel({ ...live, previewMinutes: hm(15) }).source, 'forecast');
    assert.equal(heroModel({ ...live, pv: null, forecast: null }).source, null);
});

test('slotTone a planCells: zelená slnko, modrá lacná, červená drahá, inak bežná; bunka má farbu svojej druhej štvrťhodiny', () => {
    assert.equal(slotTone({ tier: 'green', level: 'draha' }), 'sun');
    assert.equal(slotTone({ tier: 'amber', level: 'lacna' }), 'cheap');
    assert.equal(slotTone({ tier: 'red', level: 'draha' }), 'costly');
    assert.equal(slotTone({ tier: 'grey', level: 'bezna' }), 'plain');
    const plan = dayPlan(input(at('13:00')));
    const cells = planCells(plan);
    assert.equal(cells.length, MINUTES_PER_DAY / DAY_CHART.cellMin);
    cells.forEach((c, i) => {
        assert.equal(c.from, i * 30);
        assert.equal(c.to, c.from + 30);
        assert.equal(c.tone, slotTone(plan[i * 2 + 1]));
    });
    assert.equal(cellAt(cells, hm(13, 10)), cells[26]);
    assert.equal(cellAt(cells, -5), cells[0]);
    assert.equal(cellAt(cells, MINUTES_PER_DAY + 5), cells[47]);
});

test('chartX a chartMinutes: celý deň medzi okrajmi grafu, náhľad po štvrťhodinách', () => {
    assert.equal(chartX(0), DAY_CHART.left);
    assert.equal(chartX(MINUTES_PER_DAY), DAY_CHART.right);
    const rel = (/** @type {number} */ min) => chartX(min) / DAY_CHART.w;
    assert.equal(chartMinutes(rel(hm(15, 30))), hm(15, 30));
    assert.equal(chartMinutes(rel(hm(15, 37))), hm(15, 30));
    assert.equal(chartMinutes(rel(hm(15, 38))), hm(15, 45));
    // Mimo krivky (okraj rámčeka) sa drží krajov dňa, posledná je štvrťhodina pred polnocou.
    assert.equal(chartMinutes(0), 0);
    assert.equal(chartMinutes(-0.2), 0);
    assert.equal(chartMinutes(1), MINUTES_PER_DAY - 15);
});

test('os dňa od úsvitu: chartX, chartMinutes, rozsah posúvača a bunky pásu len v nej', () => {
    const span = { from: hm(5), to: hm(18) };
    assert.equal(chartX(hm(5), span), DAY_CHART.left);
    assert.equal(chartX(hm(18), span), DAY_CHART.right);
    // Noc je na kraji osi.
    assert.equal(chartX(hm(1), span), DAY_CHART.left);
    assert.equal(chartX(hm(22), span), DAY_CHART.right);
    const rel = (/** @type {number} */ min) => chartX(min, span) / DAY_CHART.w;
    assert.equal(chartMinutes(rel(hm(11, 30)), span), hm(11, 30));
    assert.equal(chartMinutes(0, span), hm(5));
    assert.equal(chartMinutes(1, span), hm(17, 45));
    assert.deepEqual(chartRange(span), { min: hm(5), max: hm(17, 45) });
    const cells = planCells(dayPlan(input(at('13:00'))), span);
    assert.equal(cells.length, 26);
    assert.equal(cells[0].from, hm(5));
    assert.equal(cells[25].to, hm(18));
    assert.equal(cellAt(cells, hm(13, 10)), cells[16]);
    assert.equal(cellAt(cells, hm(1)), cells[0]);
    assert.equal(cellAt(cells, hm(23)), cells[25]);
});

test('tickHours: kraje osi a medzi nimi násobky troch aspoň dve hodiny od kraja, na celom dni šiestich', () => {
    assert.deepEqual(tickHours({ from: hm(5), to: hm(18) }), [5, 9, 12, 15, 18]);
    assert.deepEqual(tickHours({ from: hm(6), to: hm(17) }), [6, 9, 12, 15, 17]);
    assert.deepEqual(tickHours({ from: hm(3), to: hm(22) }), [3, 6, 9, 12, 15, 18, 22]);
    assert.deepEqual(tickHours(FULL_DAY), [0, 6, 12, 18, 24]);
});

test('dayChartModel na osi dňa: krivka, oblačnosť a pás len v nej, „teraz“ v noci na kraji so šípkou von', () => {
    const i = input(at('13:00'));
    const forecast = /** @type {import('../shared/solar.js').Forecast} */ (i.forecast);
    const span = { from: hm(5), to: hm(18) };
    const base = {
        span,
        plan: dayPlan(i),
        hourly: forecast.hourlyToday,
        real: [],
        boundary: null,
        nowKw: 0,
        limitKw: powerThresholds(PLANT).lowKw,
        limitText: 'veľké spotrebiče',
        preview: null,
    };
    const day = dayChartModel({ ...base, nowMin: hm(13) });
    assert.deepEqual(day.span, span);
    assert.deepEqual(day.range, { min: hm(5), max: hm(17, 45) });
    assert.match(day.forecast, new RegExp(`^M${DAY_CHART.left} `));
    assert.match(day.forecast, new RegExp(` L${DAY_CHART.right} [0-9.]+$`));
    assert.deepEqual(
        day.clouds.map((c) => c.hour),
        Array.from({ length: 13 }, (_, h) => h + 5),
    );
    assert.equal(day.cells.length, 26);
    assert.deepEqual(
        day.ticks.map((t) => t.label),
        ['5', '9', '12', '15', '18'],
    );
    assert.equal(day.mark?.label.text, '13:00');
    assert.equal(day.mark?.cell, day.cells[16]);
    assert.equal(day.mark?.hour, 13);

    const evening = dayChartModel({ ...base, nowMin: hm(19, 45) });
    assert.equal(evening.mark?.x, DAY_CHART.right);
    assert.equal(evening.mark?.label.text, `${terazPreviewTime(hm(19, 45))} ›`);
    assert.equal(evening.mark?.cell, null);
    assert.equal(evening.mark?.hour, null);
    assert.ok(
        evening.cells.every((c) => c.past),
        'deň na osi už prešiel',
    );

    const morning = dayChartModel({ ...base, nowMin: hm(4, 30) });
    assert.equal(morning.mark?.x, DAY_CHART.left);
    assert.equal(morning.mark?.label.text, `‹ ${terazPreviewTime(hm(4, 30))}`);
    assert.ok(morning.cells.every((c) => !c.past));
});

test('dayChartModel: predpoveď, nameraná krivka po hranicu, os kW, oblačnosť, hranica, pás, okno a čiara „teraz“', () => {
    const i = input(at('13:00'));
    const plan = dayPlan(i);
    const forecast = /** @type {import('../shared/solar.js').Forecast} */ (i.forecast);
    const pv = /** @type {import('../shared/kiosk.js').PvData} */ (i.pv);
    const limitKw = powerThresholds(PLANT).lowKw;
    const base = {
        span: FULL_DAY,
        plan,
        hourly: forecast.hourlyToday,
        real: pv.realCurveToday,
        boundary: hm(11),
        nowMin: hm(13),
        nowKw: 6.4,
        limitKw,
        limitText: 'veľké spotrebiče',
    };
    const m = dayChartModel({ ...base, preview: null });
    // Predpoveď ide cez celý deň, od polnoci po polnoc.
    assert.match(m.forecast, new RegExp(`^M${DAY_CHART.left} `));
    assert.match(m.forecast, new RegExp(` L${DAY_CHART.right} [0-9.]+$`));
    // Nameraná krivka končí na hranici (11:00), nie na poslednom bode kiosku.
    const realXs = m.real
        .slice(1)
        .split(' L')
        .map((p) => Number(p.split(' ')[0]));
    assert.equal(Math.max(...realXs), Math.round(chartX(hm(11)) * 10) / 10);
    assert.ok(m.limitY > DAY_CHART.top && m.limitY < DAY_CHART.base);
    // Plocha pod krivkou dňa len nad hranicou, nikdy pod čiarou.
    const ys = (/** @type {string} */ d) => [...d.matchAll(/ (-?[0-9.]+)(?= L|Z)/g)].map((x) => Number(x[1]));
    assert.ok(m.over);
    assert.ok(ys(m.over).every((y) => y <= m.limitY));
    // Os kW: pevne do 10 kW, nech sa dni dajú porovnať, a celé čísla - bez desatín je stĺpec čísel úzky.
    assert.deepEqual(
        m.grid.map((g) => g.label),
        ['0', '2', '4', '6', '8', '10'],
    );
    assert.equal(m.grid[0].y, DAY_CHART.base);
    assert.equal(m.grid[m.grid.length - 1].y, DAY_CHART.top);
    // Oblačnosť: bunka na každú hodinu dňa, percentá z predpovede.
    assert.deepEqual(
        m.clouds.map((c) => c.hour),
        Array.from({ length: 24 }, (_, h) => h),
    );
    assert.deepEqual(
        m.clouds.map((c) => c.cloud),
        forecast.hourlyToday.map((p) => p.cloud),
    );
    assert.equal(m.cells.length, 48);
    // Teraz je 13:00: bunky do 13:00 prešli a sú stlmené, bunka od 13:00 ešte platí.
    assert.deepEqual(
        m.cells.map((c) => c.past),
        m.cells.map((_, i) => i < 26),
    );
    // Iný deň než dnešok „teraz“ nemá, nestlmí sa nič a čiara nie je.
    const other = dayChartModel({ ...base, nowMin: null, preview: null });
    assert.ok(other.cells.every((c) => !c.past));
    assert.equal(other.mark, null);
    assert.deepEqual(
        m.ticks.map((t) => t.label),
        ['0', '6', '12', '18', '24'],
    );
    assert.equal(m.now.x, Math.round(chartX(hm(13)) * 10) / 10);
    assert.ok(m.now.y !== null && m.now.y < DAY_CHART.base);
    // Bez náhľadu stojí čiara na „teraz“ s jeho časom.
    assert.ok(m.mark);
    assert.equal(m.mark.preview, false);
    assert.equal(m.mark.x, m.now.x);
    assert.equal(m.mark.label.text, '13:00');
    assert.equal(m.mark.cell, m.cells[26]);
    assert.equal(m.mark.hour, 13);

    // Čas náhľadu: nad čiarou, šírka v px z počtu znakov (v grafe ho udrží CSS v rendri), bunka
    // pásu a hodina oblačnosti pod čiarou na zvýraznenie.
    const text = terazPreviewTime(hm(15, 30));
    const withPreview = dayChartModel({ ...base, preview: { min: hm(15, 30), kw: 4.9, text } });
    const p = withPreview.mark;
    assert.ok(p);
    assert.equal(p.preview, true);
    assert.equal(p.x, Math.round(chartX(hm(15, 30)) * 10) / 10);
    assert.equal(p.label.text, '15:30');
    assert.equal(p.label.w, Math.round(text.length * DAY_CHART_LABELS.timeCharEm * DAY_CHART_LABELS.timePx));
    assert.equal(p.cell, withPreview.cells[31]);
    assert.equal(p.hour, 15);
    // Bez výkonu bodka nie je, bez predpovede ani krivky, plocha či oblačnosť.
    const empty = dayChartModel({ ...base, hourly: [], real: [], boundary: null, nowKw: NaN, preview: null });
    assert.equal(empty.forecast, '');
    assert.equal(empty.real, '');
    assert.equal(empty.over, '');
    assert.deepEqual(empty.clouds, []);
    assert.equal(empty.now.y, null);
});

test('fillPath: plocha nad hranicou končí presne na čiare, pod hranicou siaha najvyššie po ňu', () => {
    const limitY = 50;
    // Krivka vystúpi nad čiaru (menšie y) a znova klesne.
    const line = [
        { x: 0, y: 100 },
        { x: 10, y: 30 },
        { x: 20, y: 100 },
    ];
    // Priesečníky s čiarou y = 50: x = 10 * 50 / 70 ≈ 7,1 a symetricky ≈ 12,9.
    assert.equal(fillPath(line, limitY, 'over'), 'M0 50 L0 50 L7.1 50 L10 30 L12.9 50 L20 50 L20 50Z');
    assert.equal(fillPath(line, limitY, 'under'), `M0 ${DAY_CHART.base} L0 100 L7.1 50 L10 50 L12.9 50 L20 100 L20 ${DAY_CHART.base}Z`);
});

/** Krivka v jednotkách grafu: výška (0 až 1 stupnice) v každej celej hodine. @param {(hour: number) => number} h */
const curve = (h) =>
    Array.from({ length: 25 }, (_, hour) => ({ x: chartX(hour * 60), y: DAY_CHART.base - h(hour) * (DAY_CHART.base - DAY_CHART.top) }));

/** Výroba od `from` do `to` hodín s vrcholom (1) v strede, inak nula. @param {number} from @param {number} to */
const hump = (from, to) => (/** @type {number} */ hour) =>
    hour > from && hour < to ? Math.sin(((hour - from) / (to - from)) * Math.PI) : 0;

/** Bežný slnečný deň: nula v noci, vrchol na obed. */
const sunny = hump(6, 20);

test('limitSpot: nápis hranice je nad čiarou na konci, kým tam neprekryje krivku ani „teraz“', () => {
    const text = 'veľké spotrebiče';
    const limitY = DAY_CHART.base - 0.4 * (DAY_CHART.base - DAY_CHART.top);
    // Večer je krivka pod čiarou: nápis ostane na konci nad ňou, ako vždy.
    const end = { x: DAY_CHART.right - 2, end: true, y: limitY };
    const start = { x: DAY_CHART.left + 2, end: false, y: limitY };
    // Krivka je pod čiarou už od 14:00: nápis ostane na konci nad ňou, ako vždy.
    const early = hump(8, 14);
    assert.deepEqual(limitSpot(limitY, text, [curve(early)], []), end);
    // „Teraz“ večer: nápis prejde na začiatok čiary - ráno je krivka nad čiarou, takže nad krivku.
    const evening = limitSpot(limitY, text, [curve(early)], [{ x: chartX(hm(21)), halfPx: 0 }]);
    assert.equal(evening.x, start.x);
    assert.equal(evening.end, false);
    assert.ok(!boxHitsLine(limitBox(text, evening), curve(early)));
    // Krivka v noci aj ráno nízko: na začiatku tesne nad čiarou.
    const late = hump(12, 18);
    assert.deepEqual(limitSpot(limitY, text, [curve(late)], [{ x: chartX(hm(21)), halfPx: 0 }]), start);
    // Krivka nad čiarou až do večera: tesne nad čiarou nie je miesto, nápis sa zdvihne nad krivku na konci.
    const spot = limitSpot(limitY, text, [curve(sunny)], [{ x: chartX(hm(13)), halfPx: 0 }]);
    assert.equal(spot.x, end.x);
    assert.ok(spot.y < limitY);
    const box = limitBox(text, spot);
    assert.ok(!boxHitsLine(box, curve(sunny)), 'nápis prekrýva krivku');
    assert.ok(box.y0 >= 0, 'nápis trčí z grafu');
});

test('limitSpot: v žiadnom čase dňa nápis neprekryje krivku ani „teraz“, ostane v grafe a nad čiarou', () => {
    const text = 'veľké spotrebiče';
    for (const level of [0.15, 0.4, 0.7, 0.95])
        for (let min = 0; min < MINUTES_PER_DAY; min += 30) {
            const limitY = DAY_CHART.base - level * (DAY_CHART.base - DAY_CHART.top);
            const nowX = chartX(min);
            const spot = limitSpot(limitY, text, [curve(sunny)], [{ x: nowX, halfPx: 0 }]);
            const box = limitBox(text, spot);
            const where = `hranica ${level}, ${min} min`;
            assert.ok(!boxHitsLine(box, curve(sunny)), `${where}: prekrýva krivku`);
            assert.ok(nowX < box.x0 - 5 || nowX > box.x1 + 5, `${where}: prekrýva „teraz“`);
            assert.ok(box.y0 >= 0 && spot.y <= limitY, `${where}: mimo grafu alebo pod čiarou`);
        }
});

test('limitSpot: nápis sa vyhne aj čiare náhľadu s časom nad ňou, na úzkom aj širokom grafe', () => {
    const text = 'veľké spotrebiče';
    const L = DAY_CHART_LABELS;
    const halfPx = Math.round(5 * L.timeCharEm * L.timePx) / 2;
    const nowX = chartX(hm(13));
    for (const level of [0.15, 0.4, 0.7])
        for (let min = 0; min < MINUTES_PER_DAY; min += 15)
            for (const scale of [L.minScale, L.wideScale]) {
                const limitY = DAY_CHART.base - level * (DAY_CHART.base - DAY_CHART.top);
                const x = chartX(min);
                const spot = limitSpot(
                    limitY,
                    text,
                    [curve(sunny)],
                    [
                        { x: nowX, halfPx: 0 },
                        { x, halfPx },
                    ],
                    scale,
                );
                const box = limitBox(text, spot, scale);
                const r = halfPx / scale;
                const where = `hranica ${level}, náhľad ${min} min, mierka ${scale}`;
                assert.ok(x + r < box.x0 || x - r > box.x1, `${where}: prekrýva náhľad`);
                assert.ok(nowX < box.x0 - 5 || nowX > box.x1 + 5, `${where}: prekrýva „teraz“`);
            }
});

test('dayChartModel: nápis hranice sa pri náhľade posunie z jeho cesty', () => {
    const i = input(at('13:00'));
    const forecast = /** @type {import('../shared/solar.js').Forecast} */ (i.forecast);
    const base = {
        span: FULL_DAY,
        plan: dayPlan(i),
        hourly: forecast.hourlyToday,
        real: [],
        boundary: null,
        nowMin: hm(13),
        nowKw: 6.4,
        limitKw: powerThresholds(PLANT).lowKw,
        limitText: 'veľké spotrebiče',
    };
    const bez = dayChartModel({ ...base, preview: null }).limitAt.narrow;
    // Náhľad presne tam, kde nápis stojí bez neho.
    const min = Math.round(((bez.x - DAY_CHART.left) / (DAY_CHART.right - DAY_CHART.left)) * MINUTES_PER_DAY) - (bez.end ? 30 : -30);
    const s = dayChartModel({ ...base, preview: { min, kw: 1, text: terazPreviewTime(min) } }).limitAt.narrow;
    const box = limitBox('veľké spotrebiče', s);
    const x = chartX(min);
    assert.ok(x < box.x0 || x > box.x1, 'nápis ostal na čiare náhľadu');
});

test('dayChartModel: nápis hranice má polohu pre úzky aj široký graf, každá voľná pre svoj rozsah šírok', () => {
    const lines = [curve(sunny)];
    const limitY = DAY_CHART.base - 0.25 * (DAY_CHART.base - DAY_CHART.top);
    const L = DAY_CHART_LABELS;
    const nowX = chartX(hm(15, 30));
    const marks = [{ x: nowX, halfPx: 0 }];
    const narrow = limitSpot(limitY, 'veľké spotrebiče', lines, marks);
    const wide = limitSpot(limitY, 'veľké spotrebiče', lines, marks, L.wideScale);
    // Na širokom grafe sa nápis zmestí tesne nad čiaru, na úzkom nie.
    assert.equal(wide.y, limitY);
    assert.ok(narrow.y < limitY);
    assert.ok(!boxHitsLine(limitBox('veľké spotrebiče', wide, L.wideScale), lines[0]));
    assert.ok(boxHitsLine(limitBox('veľké spotrebiče', wide), lines[0]), 'široká poloha na úzkom grafe prekryje krivku');
});

test('limitBox: na najužšom grafe je nápis v jednotkách grafu najväčší, na širšom je celý v tom istom obdĺžniku', () => {
    const L = DAY_CHART_LABELS;
    const text = 'veľké spotrebiče';
    const box = limitBox(text, { x: DAY_CHART.right - 2, end: true, y: 80 });
    for (const scale of [L.minScale, 1.075, 1.9]) {
        const w = (text.length * L.charEm * L.limitPx) / scale;
        const h = (L.limitPx * L.lineEm + L.gapPx) / scale;
        assert.ok(DAY_CHART.right - 2 - w >= box.x0 - 1e-9 && 80 - h >= box.y0 - 1e-9, `mierka ${scale}`);
    }
    // Obdĺžnik siaha až po čiaru - medzera medzi nápisom a čiarou je tiež jeho.
    assert.equal(box.y1, 80);
    assert.equal(limitBox(text, { x: DAY_CHART.left + 2, end: false, y: 80 }).x0, DAY_CHART.left + 2);
});

test('terazModel o 13:00: číslo teraz, čo zapnúť z Plánu dňa, pás odporúčaní pre kartu Dnes', () => {
    const i = input(at('13:00'));
    const m = terazModel(i);
    const hero = heroModel(i);
    assert.equal(m.kind, 'ok');
    assert.equal(m.title, 'Teraz');
    assert.equal(m.num, hero.powerText);
    assert.equal(m.sub, '', 'pod číslom nie je veta');
    assert.equal(m.retry, false);
    assert.equal(m.guess, false);
    const cards = dnesCards(i);
    assert.ok(cards && m.co && m.os);
    const base = mozemModel(i);
    const rows = base.plan?.rows ?? [];
    // Zvolený je dnešok a odznaky „potom až…“ nie sú - v predpovedi z fixtures majú slnko všetky dni.
    // Auto predvolene doma nie je (PLAN_DNA.devices) - dlaždica auta zo slnka nie je.
    assert.deepEqual(m.co, { ...coZapnutModel(rows, { nowMin: hm(13) }), den: null, auto: null });
    assert.equal(m.hreben?.zvoleny, 0);
    assert.deepEqual(
        m.co.hore.dlazdice.map((d) => d.id),
        ['pracka', 'umyvacka'],
    );
    assert.deepEqual(
        m.veci.map((v) => v.id),
        rows.map((r) => r.id),
    );
    assert.deepEqual(
        terazModel(i, { devices: ['bojler'] }).veci.map((v) => v.name),
        ['Bojler'],
        'len spotrebiče doma',
    );
    assert.equal(
        cards.today.line,
        terazTodayText({ forecastKwh: 61.4, doneKwh: /** @type {number} */ (i.pv?.dailyEnergyKwh), measured: true }),
    );
    assert.equal(cards.today.pct, Math.round((100 * /** @type {number} */ (i.pv?.dailyEnergyKwh)) / 61.4));
});

test('terazModel: detail spotrebiča - kedy, od-do, prečo, deň a úsek na osi dňa', () => {
    const m = terazModel(input(at('13:00')));
    const pracka = m.veci.find((v) => v.id === 'pracka');
    assert.deepEqual(
        { ...pracka, slot: undefined },
        {
            id: 'pracka',
            name: 'Práčka',
            tone: 'go',
            den: '',
            kedy: 'Teraz zo slnka',
            cas: '13:00 – 15:00',
            why: 'Ohrev chytí slnko.',
            slot: undefined,
            useky: [],
            energia: null,
            zapis: { stav: 'moze', hotove: [], cas: null },
        },
    );
    assert.ok(pracka?.slot && pracka.slot.left > 0 && pracka.slot.width > 0);
    assert.equal(pracka?.slot?.tone, 'go');
    assert.equal(pracka?.slot?.dnes, true);
    const susicka = m.veci.find((v) => v.id === 'susicka');
    assert.equal(susicka?.tone, '');
    assert.equal(susicka?.kedy, 'Dnes zo slnka');
    const vecer = terazModel(input(at('19:50')), { devices: ['pracka', 'bojler', 'auto'] });
    assert.deepEqual(
        vecer.veci.map((v) => [v.id, v.tone, v.kedy, v.cas]),
        [
            // Kúsok NT 20:00 – 20:30 je pre bojler krátky (PLAN_DNA.lacnaMinMin), ide do ďalšieho. Auto detail nemá.
            ['bojler', '', 'Dnes z lacnej siete', '21:30 – 22:30'],
            ['pracka', '', 'Najmenej zo siete', '20:00 – 22:00'],
        ],
    );
});

test('detail spotrebiča večer: iný deň s dňom pri čase, lacná sieť modrá, noc mimo osi', () => {
    const vecer = terazModel(input(at('19:50')), { devices: ['pracka', 'bojler'] });
    // Dnes: lacná sieť modrá, bez dňa pri čase.
    assert.equal(vecer.veci[1].den, '');
    assert.equal(vecer.veci[1].slot?.tone, 'cheap');
    // Iný deň (zvolený v hrebeni): deň pri čase a úsek na tej istej osi, bez „teraz“.
    const zajtra = terazModel(input(at('19:50')), { devices: ['pracka', 'bojler'], den: 1 });
    const pracka = zajtra.veci.find((v) => v.id === 'pracka');
    assert.equal(pracka?.den, 'Zajtra');
    assert.equal(pracka?.kedy, 'Zajtra zo slnka');
    assert.equal(pracka?.slot?.dnes, false);
    assert.equal(pracka?.slot?.tone, 'go');
    // Os je celý deň 0 - 24 h (docs/navrhy/teraz-panely-zladenie.html): lacná sieť v noci je na nej po polnoc.
    const noc = terazModel(input(at('23:00')), { devices: ['bojler'] });
    assert.equal(noc.veci[0].cas, '23:30 – 07:30');
    assert.equal(noc.veci[0].slot?.left, Math.round(((23 * 60 + 30) / 1440) * 1000) / 10);
    assert.equal(noc.veci[0].slot?.tone, 'cheap');
});

test('terazModel: os dňa detailu spotrebiča - celý deň 0 - 24 h po šiestich hodinách, teraz je na nej aj v noci', () => {
    const os = terazModel(input(at('13:00'))).os;
    assert.deepEqual(
        os?.ticks.map((t) => [t.label, t.at]),
        [
            ['0', 0],
            ['6', 25],
            ['12', 50],
            ['18', 75],
            ['24', 100],
        ],
    );
    assert.equal(os?.now, Math.round(((13 * 60) / 1440) * 1000) / 10);
    assert.equal(terazModel(input(at('23:00'))).os?.now, Math.round(((23 * 60) / 1440) * 1000) / 10);
});

test('terazModel: meranie mlčí - odhad z krivky dňa, povie odkedy; plán a odporúčanie z predpovede', () => {
    // Posledné meranie o 11:40, teraz je 13:00.
    const stale = { ...pvAt(at('11:40')) };
    const i = input(at('13:00'), { pv: stale });
    const m = terazModel(i);
    const hero = heroModel(i);
    // heroModel ráta to isté: staré číslo z kiosku sa netvári ako výkon teraz.
    assert.equal(m.num, hero.powerText);
    assert.equal(hero.source, 'forecast');
    assert.ok(Number.isFinite(stale.realTimePowerKw));
    assert.notEqual(Number(m.num), stale.realTimePowerKw);
    // Odhad povie pás pod číslom. Čas je posledný bod krivky, ten istý, aký ukazuje riadok stavu merania.
    const since = pvFreshness({ now: at('13:00'), pv: stale, site: SITE }).time;
    assert.deepEqual(m.note, {
        title: TERAZ_TEXTS.noteTitle,
        text: `Meranie neodpovedá od ${since}. Kým sa neozve, číslo počíta z počasia.`,
        btn: '',
        znova: false,
    });
    // Kiosk nastavený, meranie vôbec neprišlo.
    assert.equal(terazModel(input(at('13:00'), { pv: null })).note?.text, 'Meranie neodpovedá. Kým sa neozve, číslo počíta z počasia.');
});

test('terazModel: bez merania pás odhadu vedie k pripojeniu, s meraním pás nie je', () => {
    const bez = input(at('13:00'), { pv: null, zdroj: null });
    const m = terazModel(bez);
    assert.deepEqual(m.note, { title: TERAZ_TEXTS.noteTitle, text: TERAZ_TEXTS.noteText, btn: TERAZ_TEXTS.noteBtn, znova: false });
    assert.deepEqual(terazModel(bez, { voice: 'slusny' }).note, {
        title: 'Odhad z predpovede, nie vaša strecha',
        text: 'Appka nemá údaje z vášho meniča. Číslo počíta z počasia.',
        btn: TERAZ_TEXTS.noteBtn,
        znova: false,
    });
    // Zvolený čas pás nechá, aj keď ide do minulosti.
    assert.deepEqual(terazModel({ ...bez, previewMinutes: hm(9) }).note, m.note);
    // Živé meranie: pás nie je, ani pri zvolenom čase v budúcnosti.
    assert.equal(terazModel(input(at('13:00'))).note, null);
    assert.equal(terazModel(input(at('13:00'), { previewMinutes: hm(15) })).note, null);
    // Typická strecha má vlastnú výzvu, pás odhadu nie.
    assert.equal(terazModel(guessInput(at('13:00'))).note, null);
});

test('terazModel: výrobca prístup odmietol - pás povie prečo a vedie k opätovnému pripojeniu', () => {
    const zdroj = { sposob: 'huawei-northbound', pecat: 'v1.AbCdEfGhIjKlMnOpQrStUvWxYz012345', nazov: '' };
    const now = at('13:00');
    const pristup = odmietnute(odmietnute(null, zdroj, now, '', false), zdroj, now, 'prihlasenie:20400', false);
    const i = input(now, { zdroj, pv: null, pristup });
    assert.deepEqual(terazModel(i).note, {
        title: TERAZ_TEXTS.noteTitle,
        text: 'Huawei prestal prijímať prístup. Kým meranie nepripojíš znova, číslo počíta z počasia.',
        btn: TERAZ_TEXTS.noteAgainBtn,
        znova: true,
    });
    assert.match(terazModel(i, { voice: 'slusny' }).note?.text ?? '', /Kým meranie nepripojíte znova/);
});

test('terazModel: noc - výkon 0, bez vety pod číslom, okno, ktoré už bolo, a lacná sieť', () => {
    const vecer = terazModel(input(at('21:00')));
    assert.equal(vecer.num, '0');
    assert.equal(vecer.sub, '');
    assert.match(dnesCards(input(at('21:00')))?.today.window ?? '', /^Okno na veľké veci bolo /);
    const noc = terazModel(input(at('02:00')));
    assert.equal(noc.sub, '');
    assert.match(dnesCards(input(at('02:00')))?.today.window ?? '', /^Okno na veľké veci \d/);
});

test('terazModel: načítavanie, bez dát, bez polohy', () => {
    const loading = terazModel(input(at('13:00'), { pv: null, forecast: null, loading: true }));
    assert.equal(loading.kind, 'loading');
    assert.equal(loading.num, '');
    assert.equal(loading.retry, false);
    assert.equal(loading.sub, '');

    const off = terazModel(input(at('13:00'), { pv: null, forecast: null }));
    assert.equal(off.kind, 'offline');
    assert.equal(off.num, '–');
    assert.equal(off.retry, true);
    assert.equal(off.sub, mozemOfflineText({ online: true, zdroj: true, pvOk: false, pvSince: null }));
    assert.equal(off.co, null);
    assert.equal(off.os, null);
    assert.equal(
        terazModel(input(at('13:00'), { pv: null, forecast: null }), { online: false }).sub,
        mozemOfflineText({ online: false, zdroj: true, pvOk: false, pvSince: null }),
    );

    const ask = terazModel(input(at('13:00'), { known: 'nic' }));
    assert.equal(ask.kind, 'ask');
    assert.equal(ask.ask, true);
});

test('terazModel: poloha bez panelov - typická strecha s „~“ a výzva, výpočet ako pre uloženú typickú strechu', () => {
    const g = guessInput(at('13:00'));
    const m = terazModel(g);
    assert.equal(m.estimate, true);
    assert.equal(m.guess, true);
    assert.equal(m.num, `~${heroModel(g).powerText}`);
    assert.equal(m.sub, 'typická strecha asi 5 kWp v tvojej obci, nie tvoja');
    assert.ok(m.co, 'čo zapnúť aj z typickej strechy');
    assert.match(dnesCards(g)?.today.line ?? '', /podľa nej už asi/);
});

test('terazModel: predpoveď z iného dňa (po polnoci pred obnovou) netvrdí dnešok ani jasnú oblohu', () => {
    const i = input(at('13:00'));
    const zajtra = { ...i, now: new Date(at('13:00').getTime() + 86400000), pv: null, zdroj: null };
    const m = terazModel(zajtra);
    assert.equal(dnesCards(zajtra)?.today.line, '');
    assert.equal(dnesCards(zajtra)?.today.pct, null);
    assert.equal(m.sub, '');
});

test('texty karty Teraz', () => {
    assert.equal(terazSourceText('live'), 'živé meranie');
    assert.equal(terazSourceText('measured'), 'namerané');
    assert.equal(terazSourceText('forecast'), 'odhad z predpovede');
    assert.equal(terazPreviewTime(hm(15, 30)), '15:30');
    assert.equal(terazWindowText({ from: hm(9, 15), to: hm(16, 45) }, false), 'Okno na veľké veci 09:15 – 16:45.');
    assert.equal(terazWindowText({ from: hm(9), to: hm(17) }, true), 'Okno na veľké veci bolo 09:00 – 17:00.');
    assert.equal(terazWindowText(null, false), 'Okno na veľké veci dnes nebude.');
    assert.equal(terazTodayText({ forecastKwh: 61.4, doneKwh: 31.7, measured: true }), 'Predpoveď 61,4 kWh, už nabehlo 31,7 kWh.');
    assert.equal(terazTodayText({ forecastKwh: 30, doneKwh: 12.04, measured: false }), 'Predpoveď 30,0 kWh, podľa nej už asi 12,0 kWh.');
    const desc = dayChartText({
        span: { from: hm(5), to: hm(21) },
        now: { min: hm(13), kwText: '6.41', tone: 'sun' },
        sun: [{ from: hm(9), to: hm(17, 30) }],
        cheap: [
            { from: 0, to: hm(6) },
            { from: hm(22), to: MINUTES_PER_DAY },
        ],
        costly: [],
    });
    assert.equal(
        desc,
        'Výroba od 05:00 do 21:00. Teraz 13:00: 6.41 kW, slnko stačí. Okno na veľké veci 09:00 – 17:30. Lacná sieť 00:00 – 06:00, 22:00 – 24:00.',
    );
    assert.match(
        dayChartText({
            span: FULL_DAY,
            now: { min: 0, kwText: '0.00', tone: 'costly' },
            sun: [],
            cheap: [],
            costly: [{ from: 0, to: 60 }],
        }),
        /Okno na veľké veci dnes nebude\. Drahá sieť 00:00 – 01:00\.$/,
    );
});

test('terazModel: počasie v pozadí - z merania cez deň, z predpovede v noci, vždy teraz', () => {
    // 13:00: menič meria; keď dáva len zlomok jasnej oblohy, je zamračené, hoci predpoveď hovorí jasno.
    const i = input(at('13:00'));
    const den = terazModel(i).pocasie;
    assert.equal(den?.noc, false);
    assert.equal(den?.zrazky, null);
    assert.equal(den?.mesiac, null);
    const slabo = { ...i, pv: { ...i.pv, realTimePowerKw: 0.3 } };
    assert.equal(terazModel(slabo).pocasie?.jas, 'zamracene');
    // Zvolený čas v grafe dňa pozadie nemení.
    assert.deepEqual(terazModel({ ...slabo, previewMinutes: 18 * 60 }).pocasie, terazModel(slabo).pocasie);
    // 22:30: noc, s hviezdami nad elektrárňou.
    const noc = terazModel(input(at('22:30'))).pocasie;
    assert.equal(noc?.noc, true);
    assert.ok(Array.isArray(noc?.hviezdy));
    assert.equal(den?.hviezdy, null);
    // Bez predpovede kresba nie je.
    assert.equal(terazModel({ ...i, forecast: null }).pocasie, null);
});

test('pocasieTeraz: počasie v zvolenej chvíli - Mesiac, hviezdy aj jas idú za časom', () => {
    const slabo = { ...input(at('13:00')), pv: { ...input(at('13:00')).pv, realTimePowerKw: 0.3 } };
    assert.deepEqual(pocasieTeraz(slabo), terazModel(slabo).pocasie);
    assert.equal(pocasieTeraz(slabo)?.jas, 'zamracene', 'teraz z merania');
    // O 18:00 dopredu podľa predpovede (jasný deň).
    assert.equal(pocasieTeraz({ ...slabo, previewMinutes: 18 * 60 })?.jas, 'jasno');
    const noc = pocasieTeraz(input(at('22:30')));
    const neskor = pocasieTeraz({ ...input(at('22:30')), previewMinutes: 23 * 60 + 32 });
    assert.notDeepEqual(neskor?.hviezdy, noc?.hviezdy);
    // O 23:32 je Mesiac ešte pod obzorom, nad ránom stojí v poli.
    assert.equal(neskor?.mesiac, null);
    const rano = pocasieTeraz({ ...input(at('22:30')), previewMinutes: 4 * 60 });
    assert.deepEqual(rano?.mesiac, mesiacVPoli(mesiacNaOblohe(at('04:00'), SITE.lat, SITE.lon)));
    assert.equal(pocasieTeraz({ ...slabo, forecast: null }), null);
    assert.equal(pocasieTeraz({ ...slabo, known: 'nic' }), null);
});

// ---- Nová karta Teraz (docs/navrhy/teraz-navrh-2.html) ----

const VSETKO = ['pracka', 'umyvacka', 'susicka', 'auto', 'bojler'];
/** Riadky Plánu dňa v danej chvíli. @param {ReturnType<typeof input>} i */
const riadky = (i) => planDnaModel(i, { devices: VSETKO })?.rows ?? [];
/** @param {string} hm */
const minuta = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));

test('čo zapnúť na poludnie: tri dlaždice zo slnka, zvyšok dneška za nimi podľa času', () => {
    const m = coZapnutModel(riadky(input(at('13:00'))), { nowMin: minuta('13:00') });
    assert.deepEqual(
        m.hore.dlazdice.map((d) => [d.id, d.tone]),
        [
            ['pracka', 'go'],
            ['umyvacka', 'go'],
            ['bojler', 'go'],
        ],
    );
    // Dlaždica ako Bojler (docs/navrhy/teraz-dlazdice-odrazky.html): veľké číslo, meno, odrážky - čo urobiť a odkiaľ.
    assert.deepEqual(
        [m.hore.dlazdice[0].pred, m.hore.dlazdice[0].velky, m.hore.dlazdice[0].meno, m.hore.dlazdice[0].odr],
        ['', '13:00', 'Práčka', ['zapni teraz', 'zo slnka']],
    );
    assert.equal(m.hore.dalsi, null);
    assert.deepEqual(
        m.riadky.map((r) => [r.id, r.cas, r.odr]),
        [['susicka', '15:00', ['po práčke']]],
    );
});

test('čo zapnúť večer: lacná sieť teraz s koncom pásma', () => {
    const rows = riadky(input(at('21:20')));
    const m = coZapnutModel(rows, { nowMin: minuta('21:20') });
    const dl = (/** @type {typeof m} */ x, /** @type {string} */ id) => {
        const d = x.hore.dlazdice.find((y) => y.id === id);
        return d && [d.pred, d.velky, d.meno, d.odr];
    };
    assert.equal(dl(m, 'auto'), undefined, 'auto v Pláne dňa nie je');
    assert.deepEqual(dl(m, 'bojler'), ['do', '22:30', 'Bojler', ['zapni teraz', 'lacná elektrina']]);
    // Čo čaká na iný deň, v mriežke nie je - núdzové časy dodáva karta (shared/tyzden.js).
    assert.deepEqual(m.riadky, []);
    // Slušný tón.
    const slusne = coZapnutModel(rows, { nowMin: minuta('21:20') }, 'slusny');
    assert.deepEqual(dl(slusne, 'bojler'), ['do', '22:30', 'Bojler', ['zapnite teraz', 'lacná elektrina']]);
});

test('čo zapnúť v noci: teraz nič, najbližšia vec s odpočtom, lacné pásmo cez polnoc', () => {
    const m = coZapnutModel(riadky(input(at('23:00'))), { nowMin: minuta('23:00') });
    // Pásik v noci: všetko zo siete.
    assert.deepEqual(m.hore.dalsi, {
        id: 'bojler',
        name: 'Bojler',
        zn: 'start',
        cas: '23:30',
        odr: ['za 30 min', 'lacná elektrina'],
        // Na dlaždici len čísla (docs/navrhy/teraz-dlazdice-cisla.html, B): lacné pásmo dokedy je.
        mv: [{ zn: 'koniec', t: '07:30' }],
        podiel: 0,
        draha: 0,
    });
    assert.deepEqual(m.riadky, [], 'auto v Pláne dňa nie je');
});

test('čo zapnúť: počkaj na slnko, núdzové časy a odznak „potom“, bez riadkov nič', () => {
    /** @type {any[]} */
    const rows = [
        { id: 'pracka', name: 'Práčka', kind: 'sun', start: 9 * 60, end: 11 * 60, after: null, podiel: 0.6, draha: 0.1 },
        { id: 'bojler', name: 'Bojler', kind: 'sun', start: 12 * 60, end: 13 * 60, after: null, podiel: 1, draha: 0 },
        {
            id: 'umyvacka',
            name: 'Umývačka',
            kind: 'later',
            day: { name: 'Streda', date: '2026-09-09', index: 3, start: 8 * 60 },
            end: 10 * 60 + 30,
            after: null,
            podiel: 1,
            draha: 0,
        },
        { id: 'susicka', name: 'Sušička', kind: 'none' },
    ];
    const nudza = [
        {
            id: 'umyvacka',
            name: 'Umývačka',
            kind: 'nudza',
            cas: '12:00',
            odr: ['polovica zo slnka', 'celá v stredu'],
            mv: [],
            podiel: 50,
            draha: 20,
        },
    ];
    const potom = { bojler: { text: 'potom až v stredu', kratko: 'St', dlho: true } };
    const m = coZapnutModel(rows, { nowMin: 7 * 60 + 30, nudza, potom }, 'slusny');
    // Slnko pokryje len 60 % prania: pásik to ukáže a odrážka povie slovom.
    assert.deepEqual(m.hore.dalsi, {
        id: 'pracka',
        name: 'Práčka',
        zn: 'start',
        cas: '09:00',
        odr: ['za 1 h 30 min', 'väčšina zo slnka'],
        mv: [
            { zn: 'slnko', t: '60\u00a0%' },
            { zn: 'koniec', t: '11:00' },
        ],
        podiel: 60,
        // Zvyšok 40 %: 10 % v drahom pásme, 30 % v lacnom - pásik má tri farby.
        draha: 10,
    });
    // Zvyšok dneška podľa času, potom núdzové časy - jedna mriežka, bez nadpisov.
    assert.deepEqual(m.riadky[0], {
        id: 'bojler',
        name: 'Bojler',
        kind: 'sun',
        zn: 'start',
        cas: '12:00',
        // Odznak je na dlaždici skratka dňa pri ikone, veta ostáva čítačke a detailu.
        odr: ['dobehne 13:00'],
        mv: [{ zn: 'koniec', t: '13:00' }],
        podiel: 100,
        draha: 0,
        potom: potom.bojler,
    });
    assert.deepEqual(m.riadky.slice(1), nudza);
    // Bez núdzových časov sa veci na iný deň a „tento týždeň nie“ v mriežke neukážu.
    assert.equal(coZapnutModel(rows, { nowMin: 7 * 60 + 30 }).riadky.length, 1);
    // Dlaždica toho, čo ide teraz zo slnka, nesie odznak; lacná sieť nie. Plná značka štartu = teraz.
    const ide = coZapnutModel(rows, { nowMin: 12 * 60, potom });
    const bojler = ide.hore.dlazdice.find((d) => d.id === 'bojler');
    assert.deepEqual(
        [bojler?.zn, bojler?.odr, bojler?.mv, bojler?.potom, bojler?.podiel],
        ['teraz', ['zapni teraz', 'zo slnka'], [{ zn: 'koniec', t: '13:00' }], potom.bojler, 100],
    );
    // Práčka ďalej dnes (najbližšie je bojler): druhá odrážka povie, koľko dá slnko; odznak ju nahradí.
    const skoro = [{ ...rows[1], start: 6 * 60 }, rows[0]];
    const rano = coZapnutModel(skoro, { nowMin: 5 * 60 });
    assert.deepEqual(rano.riadky[0], {
        id: 'pracka',
        name: 'Práčka',
        kind: 'sun',
        zn: 'start',
        cas: '09:00',
        odr: ['dobehne 11:00', 'väčšina zo slnka'],
        mv: [
            { zn: 'slnko', t: '60\u00a0%' },
            { zn: 'koniec', t: '11:00' },
        ],
        podiel: 60,
        draha: 10,
        potom: null,
    });
    const ranoPotom = coZapnutModel(skoro, { nowMin: 5 * 60, potom: { pracka: potom.bojler } });
    assert.deepEqual([ranoPotom.riadky[0].odr, ranoPotom.riadky[0].potom], [['dobehne 11:00', 'väčšina zo slnka'], potom.bojler]);
    // Práčka teraz: v dlaždici „väčšina zo slnka“ namiesto „zo slnka“.
    const pranie = coZapnutModel(rows, { nowMin: 9 * 60 });
    assert.deepEqual(pranie.hore.dlazdice[0].odr, ['zapni teraz', 'väčšina zo slnka']);
    const nic = coZapnutModel([], { nowMin: 22 * 60 });
    assert.deepEqual([nic.hore.dlazdice, nic.hore.dalsi, nic.riadky], [[], null, []]);
});

test('čo zapnúť večer po praní: sušička zo siete nie je „zo slnka“, ani keď je na rade teraz', () => {
    // Práčka dobehla o 17:00, o 20:35 je tma - sušičku plán dá hneď, celú zo siete.
    const i = input(at('20:35'), { bezi: [{ id: 'pracka', d: '2026-09-05', m: 15 * 60, k: 17 * 60 }] });
    const rows = riadky(i);
    assert.deepEqual(
        rows.filter((r) => r.id === 'susicka').map((r) => r.kind),
        ['siet'],
    );
    const m = coZapnutModel(rows, { nowMin: minuta('20:35') });
    const susicka = m.hore.dlazdice.find((d) => d.id === 'susicka');
    assert.deepEqual([susicka?.tone, susicka?.velky, susicka?.odr, susicka?.potom], ['siet', '20:45', ['zapni teraz', 'zo siete'], null]);
    // Detail a odčítanie grafu povedia to isté.
    const t = terazModel(i);
    assert.equal(t.veci.find((v) => v.id === 'susicka')?.kedy, 'Teraz zo siete');
    // Keď ešte nie je na rade, ide ako ďalšia vec s odpočtom - tiež zo siete.
    const skor = coZapnutModel(rows, { nowMin: minuta('20:00') });
    assert.deepEqual(skor.hore.dalsi?.odr, ['za 45 min', 'zo siete']);
});

test('čas do niečoho', () => {
    assert.equal(terazZaText(45), '45 min');
    assert.equal(terazZaText(120), '2 h');
    assert.equal(terazZaText(95), '1 h 35 min');
});

/** Behy „Už beží“ 5. 9. 2026: umývačka od 12:00 (beží o 13:00), práčka od 9:30 (dobehla). */
const ZAPISY = [
    { id: 'umyvacka', d: '2026-09-05', m: hm(12), k: hm(14, 30) },
    { id: 'pracka', d: '2026-09-05', m: hm(9, 30), k: hm(11, 30) },
];
/** Detail spotrebiča z modelu, ktorý tam musí byť. @param {ReturnType<typeof terazModel>} m @param {string} id */
function detail(m, id) {
    const v = m.veci.find((x) => x.id === id);
    if (!v) throw new Error(`model nemá ${id}`);
    return v;
}

test('spotrebič beží: dlaždica „beží“ hore; dobehnutý má dlaždicu s ďalším časom a odrážkou „dnes už 1×“', () => {
    const co = terazModel(input(at('13:00'), { bezi: ZAPISY })).co;
    if (!co) throw new Error('bez Čo zapnúť');
    assert.deepEqual(
        co.bezi.map((t) => ({ ...t, podiel: t.podiel > 0 })),
        [
            {
                id: 'umyvacka',
                tone: 'bezi',
                meno: 'Umývačka',
                pred: 'do',
                zn: 'koniec',
                velky: '14:30',
                odr: ['beží', 'ešte 1 h 30 min'],
                mv: [{ zn: 'zostava', t: '1 h 30 min' }],
                podiel: true,
                draha: 0,
            },
        ],
    );
    assert.equal('hotovo' in co, false, 'dobehnutý vlastnú dlaždicu nemá');
    const dlazdice = [...co.hore.dlazdice, ...(co.hore.dalsi ? [co.hore.dalsi] : []), ...co.riadky];
    assert.ok(!dlazdice.some((t) => t.id === 'umyvacka'), 'čo beží, sa nerozvrhuje');
    const pracka = dlazdice.find((t) => t.id === 'pracka');
    if (!pracka) throw new Error('práčka nemá ďalší čas');
    // Na dlaždici odznak „1×“ pri ikone, veta „dnes už 1×“ pre čítačku a detail.
    assert.deepEqual(pracka.potom, { text: 'dnes už 1×', kratko: '1×', dlho: false });
});

test('spotrebič beží: detail so zápisom, krémový úsek na osi; zapísať sa dajú len práčka, sušička a umývačka', () => {
    const m = terazModel(input(at('13:00'), { bezi: ZAPISY }));
    const umyvacka = detail(m, 'umyvacka');
    assert.deepEqual(
        { ...umyvacka, slot: undefined, why: undefined, useky: undefined, energia: undefined },
        {
            id: 'umyvacka',
            name: 'Umývačka',
            tone: 'bezi',
            den: '',
            kedy: 'Beží',
            cas: '12:00 – 14:30',
            why: undefined,
            slot: undefined,
            useky: undefined,
            energia: undefined,
            zapis: { stav: 'bezi', hotove: [], cas: { zvysok: null, od: '12:00', max: '13:00', konci: 'skončí o 14:30' } },
        },
    );
    assert.equal(umyvacka.slot && umyvacka.slot.tone, 'bezi');
    const pracka = detail(m, 'pracka');
    assert.deepEqual('zapis' in pracka && pracka.zapis, {
        stav: 'moze',
        hotove: [{ text: 'Dnes už prala', cas: '09:30 – 11:30' }],
        cas: null,
    });
    const susicka = detail(m, 'susicka');
    assert.equal('zapis' in susicka && susicka.zapis && susicka.zapis.stav, 'moze');
    assert.equal('zapis' in detail(terazModel(input(at('13:00')), { devices: ['bojler'] }), 'bojler'), false);
    // Práčka zapnutá práve teraz: zvyšok programu, prvý beh dňa v hotových.
    const prave = detail(
        terazModel(input(at('13:00'), { bezi: [ZAPISY[1], { id: 'pracka', d: '2026-09-05', m: hm(13), k: hm(15) }] })),
        'pracka',
    );
    assert.equal(prave.why, 'Nastav, koľko ukazuje práčka.');
    assert.deepEqual('zapis' in prave && prave.zapis, {
        stav: 'bezi',
        hotove: [{ text: 'Dnes už prala', cas: '09:30 – 11:30' }],
        cas: { zvysok: { h: 2, m: 0 }, od: null, max: '13:00', konci: 'skončí o 15:00' },
    });
    const kratko = detail(
        terazModel(input(at('13:00'), { bezi: [{ id: 'susicka', d: '2026-09-05', m: hm(11, 35), k: hm(13, 5) }] })),
        'susicka',
    );
    assert.deepEqual('zapis' in kratko && kratko.zapis?.cas?.zvysok, { h: 0, m: 5 });
});

test('detail spotrebiča: dnešné behy plné na osi, energia dnes odhadom z typického programu', () => {
    const m = terazModel(input(at('13:00'), { bezi: ZAPISY }));
    /** @param {string} id */
    const dnes = (id) => {
        const v = detail(m, id);
        return { useky: 'useky' in v ? (v.useky ?? []) : [], energia: 'energia' in v ? (v.energia ?? null) : null };
    };
    // Na osi je plné len to, čo už bežalo (12:00 až teraz 13:00); energia podľa toho, koľko z programu prešlo.
    assert.deepEqual(
        dnes('umyvacka').useky.map((u) => [u.left, u.width]),
        [[50, 4.2]],
    );
    assert.equal(dnes('umyvacka').energia?.suhrn, '1× dnes · odhad podľa typického programu');
    // Dobehnuté pranie 9:30 – 11:30: celý typický program (1 kWh).
    assert.equal(dnes('pracka').energia?.spolu, '≈ 1,0 kWh');
    assert.deepEqual(
        dnes('pracka').useky.map((u) => [u.left, u.width]),
        [[39.6, 8.3]],
    );
    assert.equal(dnes('susicka').energia, null, 'bez behov dnes energia nie je');
});

test('spotrebič na zásuvke (U1): bez „Už beží“ a nastavenia času, so zmeraným príkonom; zásuvka, ktorá mlčí, nie', () => {
    const teraz = at('13:00').getTime();
    const zasuvky = { pracka: { at: teraz - 60000, w: 2100, bezi: true }, umyvacka: { at: teraz - 60000, w: 3, bezi: false } };
    const m = terazModel(input(at('13:00'), { bezi: [{ id: 'pracka', d: '2026-09-05', m: hm(12), k: hm(14) }], zasuvky }));
    assert.deepEqual('zapis' in detail(m, 'pracka') && detail(m, 'pracka').zapis, { stav: 'meria', hotove: [], cas: null, w: 2100 });
    assert.deepEqual('zapis' in detail(m, 'umyvacka') && detail(m, 'umyvacka').zapis, { stav: 'meria', hotove: [], cas: null, w: 3 });
    assert.equal('zapis' in detail(m, 'susicka') && detail(m, 'susicka').zapis?.stav, 'moze');
    const stara = { pracka: { at: teraz - 60 * 60000, w: 0, bezi: false } };
    const mlci = terazModel(input(at('13:00'), { zasuvky: stara }));
    assert.equal('zapis' in detail(mlci, 'pracka') && detail(mlci, 'pracka').zapis?.stav, 'moze');
    assert.equal(detail(m, 'pracka').why, TERAZ_BEZI.zasuvka.why);
    // Príkon zo zásuvky ide na koniec riadku pod nadpisom detailu, keď spotrebič nebeží, nie je.
    assert.equal(TERAZ_BEZI.zasuvka.kw(2100), '2,1 kW');
    assert.equal(TERAZ_BEZI.zasuvka.kw(3), '');
});

test('nastavenie času: po „Už beží“ návrh, ktorý ešte nie je uložený - kolieska práčky, čas zapnutia umývačky', () => {
    const cas = (/** @type {any} */ m, /** @type {string} */ id) => {
        const v = detail(m, id);
        return 'zapis' in v ? v.zapis?.cas : undefined;
    };
    const pracka = cas(terazModel(input(at('13:00'), { vecNavrh: { id: 'pracka', min: 155 } })), 'pracka');
    assert.deepEqual(pracka, { zvysok: { h: 2, m: 35 }, od: null, max: '13:00', konci: 'skončí o 15:35' });
    // Návrh patrí len svojmu spotrebiču.
    assert.equal(cas(terazModel(input(at('13:00'), { vecNavrh: { id: 'pracka', min: 155 } })), 'susicka'), null);
    // Umývačka zapnutá dávno už dobehla.
    const umyvacka = cas(terazModel(input(at('13:00'), { vecNavrh: { id: 'umyvacka', min: hm(9) } })), 'umyvacka');
    assert.deepEqual(umyvacka, { zvysok: null, od: '09:00', max: '13:00', konci: 'dobehla o 11:30' });
});

test('terazBublinaText: čo sa nastavilo a či príde oznámenie o konci', () => {
    assert.equal(terazBublinaText('pracka', { k: hm(17, 15) }, hm(14), 'ok'), 'Práčka skončí o 17:15 · dám vedieť');
    assert.equal(terazBublinaText('susicka', { k: hm(17, 15) }, hm(14), null), 'Sušička skončí o 17:15');
    assert.equal(terazBublinaText('pracka', { k: hm(17, 15) }, hm(14), 'zakazane'), 'Práčka skončí o 17:15 · oznámenie nepríde');
    assert.equal(terazBublinaText('umyvacka', { k: hm(12) }, hm(14), 'ok'), 'Umývačka dobehla o 12:00');
    assert.equal(terazBublinaText('pracka', null, hm(14), 'ok'), 'Práčka nebeží');
});
