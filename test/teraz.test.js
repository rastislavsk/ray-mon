import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installedKw, MINUTES_PER_DAY, PLANT, powerThresholds, SITE, TARIFF, TYPICAL_PLANT } from '../shared/config.js';
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
    DAY_CHART_KEYS,
    mozemGuessText,
    mozemOfflineText,
    TERAZ_TEXTS,
    TERAZ_TONES,
    terazBandNext,
    terazBandText,
    terazChartText,
    terazClearText,
    terazCloudText,
    terazKwText,
    terazLaterText,
    terazLimitFrom,
    terazLimitGap,
    terazPreviewTime,
    terazReadoutWhen,
    terazSliderText,
    terazSourceText,
    terazTodayText,
    terazTypicalText,
    terazWindowText,
} from '../shared/messages.js';
import { mozemModel, planWindows } from '../shared/mozem.js';
import { odmietnute } from '../shared/pristup.js';
import { typicalSettings } from '../shared/settings.js';
import { dnesCards, terazModel } from '../shared/teraz.js';
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

test('terazModel o 13:00: číslo, štítky s vetou a Plán dňa z mozemModel, pás odporúčaní pre kartu Dnes', () => {
    const i = input(at('13:00'));
    const m = terazModel(i);
    const hero = heroModel(i);
    assert.equal(m.kind, 'ok');
    assert.equal(m.num, hero.powerText);
    assert.equal(m.source, 'živé meranie');
    assert.match(m.sub, /^\d+ % z toho, čo by dala jasná obloha$/);
    assert.equal(m.retry, false);
    assert.equal(m.guess, false);
    const cards = dnesCards(i);
    assert.ok(cards && m.chart && m.plan && m.say);
    const base = mozemModel(i);
    assert.deepEqual(m.say, { chips: base.chips, text: base.say });
    assert.equal(m.say.text, 'Slnko to teraz platí za nás.', 'bez spotrebičov - tie povie Plán dňa');
    assert.deepEqual(m.plan.rows, base.plan?.rows);
    assert.deepEqual(m.plan.head, { lead: 'Teraz práčka a umývačka', then: 'Auto o 13:15 · sušička o 15:00' });
    assert.deepEqual(
        terazModel(i, { devices: ['bojler'] }).plan?.rows.map((r) => r.name),
        ['Bojler'],
        'len spotrebiče doma',
    );
    assert.equal(
        cards.today.line,
        terazTodayText({ forecastKwh: 61.4, doneKwh: /** @type {number} */ (i.pv?.dailyEnergyKwh), measured: true }),
    );
    assert.equal(cards.today.pct, Math.round((100 * /** @type {number} */ (i.pv?.dailyEnergyKwh)) / 61.4));
    assert.equal(m.chart.value, hm(13));
    assert.equal(m.chart.valueText, terazSliderText(hm(13), false, hero.powerText, 'sun'));
    assert.deepEqual(m.hint, { text: TERAZ_TEXTS.hint, reset: false });
    assert.deepEqual(
        m.chart.keys.map((l) => l.text),
        [DAY_CHART_KEYS.power, DAY_CHART_KEYS.forecast, DAY_CHART_KEYS.cloud],
    );
    assert.deepEqual(
        m.chart.bands.map((l) => l.text),
        [TERAZ_TONES.sun, TERAZ_TONES.cheap, TERAZ_TONES.costly],
    );
    assert.match(m.chart.desc, /^Výroba od 05:00 do 21:00\. Teraz 13:00: .* kW, slnko stačí\. Okno na veľké veci /);
});

test('terazModel: zoznam pod grafom ukáže hodnoty v čase bodu grafu tak, ako ich kreslí graf', () => {
    const i = input(at('13:00'));
    const r = /** @type {NonNullable<ReturnType<typeof terazModel>['chart']>} */ (terazModel(i).chart).readout;
    const hero = heroModel(i);
    const hourly = /** @type {NonNullable<typeof i.forecast>} */ (i.forecast).hourlyToday;
    const h13 = /** @type {{ kw: number, cloud: number }} */ (hourly.find((p) => p.hour === 13));
    const limit = powerThresholds(PLANT).lowKw;
    assert.equal(r.when, 'Teraz 13:00');
    assert.deepEqual(
        r.rows.map((x) => x.tone),
        ['power', 'forecast', 'cloud', 'limit', 'sun'],
    );
    assert.equal(r.rows[0].value, terazKwText(hero.power));
    // V celej hodine je predpoveď presne bod čiary, oblačnosť bunka tej hodiny.
    assert.equal(r.rows[1].value, terazKwText(h13.kw));
    assert.equal(r.rows[2].value, `${Math.round(h13.cloud)} %`);
    assert.equal(r.rows[3].sub, terazLimitFrom(limit));
    assert.equal(r.rows[3].value, terazLimitGap(hero.power, limit));
    assert.match(r.rows[3].value, /^navyše \d+,\d\d kW$/);
    // Úsek pásu plánu: zelený úsek, v ktorom 13:00 je, a čo po ňom príde.
    const sun = planWindows(dayPlan(i), (s) => slotTone(s) === 'sun').find((w) => w.from <= hm(13) && hm(13) < w.to);
    assert.equal(r.rows[4].text, `slnko stačí do ${terazPreviewTime(/** @type {{ to: number }} */ (sun).to)}`);
    assert.match(r.rows[4].sub, /^potom /);
});

test('terazModel: zoznam pod grafom ide za náhľadom, na konci dňa nič nepríde', () => {
    const r = (/** @type {number} */ min) =>
        /** @type {NonNullable<ReturnType<typeof terazModel>['chart']>} */ (terazModel(input(at('13:00'), { previewMinutes: min })).chart)
            .readout;
    const night = r(hm(21));
    assert.equal(night.when, 'O 21:00');
    assert.equal(night.rows[0].value, '0,00 kW');
    assert.match(night.rows[3].value, /^chýba /);
    const last = r(hm(23, 45));
    assert.match(last.rows[4].text, / do 24:00$/);
    assert.equal(last.rows[4].sub, '');
});

test('texty zoznamu pod grafom: pomlčka bez údaja, chýba či navyše podľa hranice', () => {
    assert.equal(terazKwText(NaN), '–');
    assert.equal(terazKwText(1.234), '1,23 kW');
    assert.equal(terazCloudText(null), '–');
    assert.equal(terazCloudText(62.4), '62 %');
    assert.equal(terazLimitGap(NaN, 2), '–');
    assert.equal(terazLimitGap(1.5, 2), 'chýba 0,50 kW');
    assert.equal(terazLimitGap(2, 2), 'navyše 0,00 kW');
    assert.equal(terazLimitFrom(2.088), 'od 2,1 kW');
    assert.equal(terazBandText('costly', MINUTES_PER_DAY), 'drahá sieť do 24:00');
    assert.equal(terazBandNext(null), '');
    assert.equal(terazBandNext('cheap'), 'potom lacná sieť');
    assert.equal(terazReadoutWhen(hm(8, 15), false), 'Teraz 08:15');
});

test('terazModel: zoznam pod grafom bez hodinovej predpovede dneška píše pomlčky', () => {
    const i = input(at('13:00'));
    const f = /** @type {NonNullable<typeof i.forecast>} */ (i.forecast);
    const m = terazModel({ ...i, forecast: { ...f, hourlyToday: [] } });
    const rows = /** @type {NonNullable<typeof m.chart>} */ (m.chart).readout.rows;
    assert.equal(rows[1].value, '–');
    assert.equal(rows[2].value, '–');
});

test('terazModel: náhľad iného času mení číslo, vetu a odporúčanie, „teraz“ v grafe ostáva', () => {
    const i = input(at('13:00'), { previewMinutes: hm(15, 30) });
    const m = terazModel(i);
    const hero = heroModel(i);
    assert.equal(m.num, hero.powerText);
    assert.equal(m.source, 'odhad z predpovede');
    // Nadpis povie, ku ktorému času číslo patrí; bez náhľadu je „Teraz“.
    assert.equal(m.title, 'O 15:30');
    assert.equal(terazModel(input(at('13:00'))).title, 'Teraz');
    assert.equal(terazModel(input(at('13:00'), { previewMinutes: hm(9) }), { voice: 'slusny' }).title, 'O 09:00');
    // Čas je v grafe pri čiare, pod grafom ostáva len „Späť na teraz“.
    assert.deepEqual(m.hint, { text: '', reset: true });
    // Štítky a veta hovoria o teraz, nie o náhľade - pod prstom sa nemenia.
    assert.deepEqual(m.say, terazModel(input(at('13:00'))).say);
    const now = terazModel(input(at('13:00')));
    assert.equal(m.chart?.now.x, now.chart?.now.x);
    const mark = m.chart?.mark;
    assert.ok(mark);
    assert.deepEqual([mark.preview, mark.label.text, mark.cell.tone], [true, '15:30', 'sun']);
    assert.equal(m.chart?.value, hm(15, 30));
    assert.match(m.chart?.valueText ?? '', /^Náhľad 15:30, /);
});

test('terazModel: meranie mlčí - odhad z krivky dňa, povie odkedy; plán a odporúčanie z predpovede', () => {
    // Posledné meranie o 11:40, teraz je 13:00.
    const stale = { ...pvAt(at('11:40')) };
    const i = input(at('13:00'), { pv: stale });
    const m = terazModel(i);
    const hero = heroModel(i);
    // Karta Terazky súčasnej appky ráta to isté (heroModel): staré číslo z kiosku sa netvári ako výkon teraz.
    assert.equal(m.num, hero.powerText);
    assert.equal(hero.source, 'forecast');
    assert.ok(Number.isFinite(stale.realTimePowerKw));
    assert.notEqual(Number(m.num), stale.realTimePowerKw);
    // Odhad povie pás pod číslom, riadok ho neopakuje. Čas je posledný bod krivky, ten istý, aký
    // ukazuje hlavička.
    assert.equal(m.source, '');
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
    assert.equal(m.source, '');
    assert.deepEqual(m.note, { title: TERAZ_TEXTS.noteTitle, text: TERAZ_TEXTS.noteText, btn: TERAZ_TEXTS.noteBtn, znova: false });
    assert.deepEqual(terazModel(bez, { voice: 'slusny' }).note, {
        title: 'Odhad z predpovede, nie vaša strecha',
        text: 'Appka nemá údaje z vášho meniča. Číslo počíta z počasia.',
        btn: TERAZ_TEXTS.noteBtn,
        znova: false,
    });
    // Náhľad pás nechá (graf sa pod prstom nepohne), aj keď ide do minulosti.
    assert.deepEqual(terazModel({ ...bez, previewMinutes: hm(9) }).note, m.note);
    // Živé meranie: pás nie je, ani v náhľade budúcnosti - tam ostáva riadok odhadu.
    assert.equal(terazModel(input(at('13:00'))).note, null);
    const buduce = terazModel(input(at('13:00'), { previewMinutes: hm(15) }));
    assert.equal(buduce.note, null);
    assert.equal(buduce.source, 'odhad z predpovede');
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

test('terazModel: noc - výkon 0, veta o obzore, okno, ktoré už bolo, a lacná sieť', () => {
    const vecer = terazModel(input(at('21:00')));
    assert.equal(vecer.num, '0.00');
    assert.equal(vecer.sub, TERAZ_TEXTS.night);
    assert.match(dnesCards(input(at('21:00')))?.today.window ?? '', /^Okno na veľké veci bolo /);
    const noc = terazModel(input(at('02:00')));
    assert.equal(noc.sub, TERAZ_TEXTS.night);
    assert.match(dnesCards(input(at('02:00')))?.today.window ?? '', /^Okno na veľké veci \d/);
});

test('terazModel: načítavanie, bez dát, bez polohy', () => {
    const loading = terazModel(input(at('13:00'), { pv: null, forecast: null, loading: true }));
    assert.equal(loading.kind, 'loading');
    assert.equal(loading.num, '');
    assert.equal(loading.retry, false);
    assert.equal(loading.sub, TERAZ_TEXTS.loading);
    assert.equal(loading.chart, null);

    const off = terazModel(input(at('13:00'), { pv: null, forecast: null }));
    assert.equal(off.kind, 'offline');
    assert.equal(off.num, '–');
    assert.equal(off.retry, true);
    assert.equal(off.sub, mozemOfflineText({ online: true, zdroj: true, pvOk: false, pvSince: null }));
    assert.equal(off.chart, null);
    assert.equal(off.plan, null);
    assert.equal(off.say, null);
    assert.equal(
        terazModel(input(at('13:00'), { pv: null, forecast: null }), { online: false }).sub,
        mozemOfflineText({ online: false, zdroj: true, pvOk: false, pvSince: null }),
    );

    const ask = terazModel(input(at('13:00'), { known: 'nic' }));
    assert.equal(ask.kind, 'ask');
    assert.equal(ask.ask, true);
    assert.equal(ask.chart, null);
});

test('terazModel: poloha bez panelov - typická strecha s „~“ a výzva, výpočet ako pre uloženú typickú strechu', () => {
    const g = guessInput(at('13:00'));
    const m = terazModel(g);
    assert.equal(m.estimate, true);
    assert.equal(m.guess, true);
    assert.equal(m.source, '');
    assert.equal(m.num, `~${heroModel(g).powerText}`);
    assert.equal(m.sub, 'typická strecha asi 5 kWp v tvojej obci, nie tvoja');
    assert.ok(m.plan, 'Plán dňa aj z typickej strechy');
    assert.match(dnesCards(g)?.today.line ?? '', /podľa nej už asi/);
});

test('terazModel: predpoveď z iného dňa (po polnoci pred obnovou) netvrdí dnešok ani jasnú oblohu', () => {
    const i = input(at('13:00'));
    const zajtra = { ...i, now: new Date(at('13:00').getTime() + 86400000), pv: null, zdroj: null };
    const m = terazModel(zajtra);
    assert.equal(dnesCards(zajtra)?.today.line, '');
    assert.equal(dnesCards(zajtra)?.today.pct, null);
    assert.equal(m.sub, TERAZ_TEXTS.night);
});

test('texty karty Teraz', () => {
    assert.equal(terazSourceText('live'), 'živé meranie');
    assert.equal(terazSourceText('measured'), 'namerané');
    assert.equal(terazSourceText('forecast'), 'odhad z predpovede');
    assert.equal(terazClearText(72), '72 % z toho, čo by dala jasná obloha');
    assert.equal(terazPreviewTime(hm(15, 30)), '15:30');
    assert.equal(terazSliderText(hm(8), true, '1.20', 'costly'), 'Náhľad 08:00, 1.20 kW, drahá sieť');
    assert.equal(terazWindowText({ from: hm(9, 15), to: hm(16, 45) }, false), 'Okno na veľké veci 09:15 – 16:45.');
    assert.equal(terazWindowText({ from: hm(9), to: hm(17) }, true), 'Okno na veľké veci bolo 09:00 – 17:00.');
    assert.equal(terazWindowText(null, false), 'Okno na veľké veci dnes nebude.');
    assert.equal(terazTodayText({ forecastKwh: 61.4, doneKwh: 31.7, measured: true }), 'Predpoveď 61,4 kWh, už nabehlo 31,7 kWh.');
    assert.equal(terazTodayText({ forecastKwh: 30, doneKwh: 12.04, measured: false }), 'Predpoveď 30,0 kWh, podľa nej už asi 12,0 kWh.');
    const next = { name: 'Zajtra', kwh: 48.5 };
    assert.equal(terazLaterText({ wait: null, todayStrong: true, next }), 'Dnes je silný deň. Ďalší taký: zajtra, okolo 49 kWh.');
    assert.equal(
        terazLaterText({ wait: '11:00', todayStrong: false, next: { name: 'Pondelok', kwh: 50 } }),
        'Lepšie bude o 11:00. Najbližší silný deň: pondelok, okolo 50 kWh.',
    );
    assert.equal(terazLaterText({ wait: null, todayStrong: true, next: null }), 'Dnes je silný deň. Ďalší taký v predpovedi nie je.');
    assert.equal(terazLaterText({ wait: null, todayStrong: false, next: null }), 'Silný deň v predpovedi na týždeň nie je.');
    const desc = terazChartText({
        span: { from: hm(5), to: hm(21) },
        nowMin: hm(13),
        kwText: '6.41',
        tone: 'sun',
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
        terazChartText({ span: FULL_DAY, nowMin: 0, kwText: '0.00', tone: 'costly', sun: [], cheap: [], costly: [{ from: 0, to: 60 }] }),
        /Okno na veľké veci dnes nebude\. Drahá sieť 00:00 – 01:00\.$/,
    );
});
