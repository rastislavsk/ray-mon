// Karta 7 dní novej appky (shared/sedem-dni.js): počíta to isté ako karta 7 dní súčasnej appky
// (weekStatsModel, weekListModel, dayDetailMessage, weekMessage) a okno z plánu dňa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestDayIndex, usePct, visibleHours, weekListModel, weekStatsModel } from '../shared/chart-model.js';
import { ALL_DAYS, ALL_MONTHS, installedKw, PLANT, powerThresholds, SITE, TARIFF } from '../shared/config.js';
import { dayChartModel, planCells, planLegend } from '../shared/day-chart.js';
import { dayHourTiers, dayPlan, forecastDayPlan } from '../shared/day-plan.js';
import { kwpRoughText } from '../shared/format.js';
import {
    dayChartText,
    dayDetailMessage,
    SEDEM_TEXTS,
    sedemBarsText,
    sedemClearText,
    sedemDayMessage,
    sedemGuessText,
    sedemHeatText,
    sedemPriceText,
    sedemRowText,
    sedemSumText,
    sedemTitle,
    sedemWindowsText,
    sedemWindowTile,
    terazChartText,
    weekMessage,
} from '../shared/messages.js';
import { planWindows } from '../shared/mozem.js';
import {
    dayWeather,
    mainWindow,
    rowName,
    sedemDayModel,
    sedemModel,
    sedemWeekModel,
    sunWindows,
    WEEK_HEAT,
    windowBand,
} from '../shared/sedem-dni.js';
import { typicalSettings } from '../shared/settings.js';
import { priceSegments } from '../shared/tariff.js';
import { FIXED_NOW, fixtureData, pvAt } from './helpers.js';

const { forecast } = fixtureData();
/** @type {import('../shared/sedem-dni.js').SedemData} */
const input = {
    now: FIXED_NOW,
    site: SITE,
    plant: PLANT,
    tariff: TARIFF,
    kiosk: 'kiosk',
    loading: false,
    known: 'elektraren',
    pv: pvAt(FIXED_NOW),
    forecast,
};
const m = (/** @type {number} */ h, /** @type {number} */ min = 0) => h * 60 + min;

/** Predpoveď, v ktorej má jeden deň výrobu stiahnutú na zlomok (slabý deň bez okna). @param {number} index @param {number} f */
function weakDay(index, f) {
    const days = forecast.days.map((d, i) =>
        i === index ? { ...d, kwhTotal: d.kwhTotal * f, peakKw: d.peakKw * f, hourly: d.hourly.map((p) => ({ ...p, kw: p.kw * f })) } : d,
    );
    return { ...forecast, days };
}

test('rowName: Dnes, Zajtra, potom skratka dňa s dňom v mesiaci', () => {
    assert.deepEqual(
        forecast.days.map((d, i) => rowName(d.date, i)),
        ['Dnes', 'Zajtra', 'Po 7.', 'Ut 8.', 'St 9.', 'Št 10.', 'Pi 11.'],
    );
});

test('dayWeather: stav z oblačnosti tou istou hranicou ako obloha, bez oblačnosti nič', () => {
    assert.equal(dayWeather({ cloudAvgPct: 12 }), 'jasno');
    assert.equal(dayWeather({ cloudAvgPct: 30 }), 'polojasno');
    assert.equal(dayWeather({ cloudAvgPct: 69 }), 'polojasno');
    assert.equal(dayWeather({ cloudAvgPct: 70 }), 'zamracene');
    assert.equal(dayWeather({ cloudAvgPct: null }), null);
    // Vo fixtures sú všetky tri stavy.
    assert.deepEqual([...new Set(forecast.days.map(dayWeather))].sort(), ['jasno', 'polojasno', 'zamracene']);
});

test('windowBand: poloha okna v páse cez produkčné okno 5-21 h, orezanie, prázdny pás bez okna', () => {
    assert.deepEqual(windowBand([{ from: m(9), to: m(17) }]), [{ left: 25, width: 50 }]);
    assert.deepEqual(windowBand([{ from: m(4), to: m(6) }]), [{ left: 0, width: 6.3 }]);
    assert.deepEqual(windowBand([{ from: m(22), to: m(23) }]), []);
    assert.deepEqual(windowBand([]), []);
    assert.equal(
        windowBand([
            { from: m(8), to: m(10) },
            { from: m(11), to: m(15) },
        ]).length,
        2,
    );
});

test('mainWindow: najdlhšie okno, pri zhode skoršie; bez okien null', () => {
    assert.equal(mainWindow([]), null);
    const a = { from: m(8), to: m(10) };
    const b = { from: m(11), to: m(15) };
    const c = { from: m(16), to: m(20) };
    assert.equal(mainWindow([a, b, c]), b);
});

test('forecastDayPlan: dnešok je presne dayPlan, iný deň z predpovede toho dňa a jeho pásma tarify', () => {
    assert.deepEqual(forecastDayPlan(input, 0), dayPlan(input));
    const plan = forecastDayPlan(input, 3);
    assert.equal(plan.length, 96);
    const day = forecast.days[3];
    // Výkon v strede štvrťhodiny z predpovede toho dňa; zelená presne tam, kde je nad hranicou.
    const noon = plan[m(12) / 15];
    assert.ok(Math.abs(noon.kw - (day.hourly[12].kw * 0.875 + day.hourly[13].kw * 0.125)) < 1e-9);
    const th = powerThresholds(PLANT);
    assert.ok(plan.every((s) => (s.tier === 'green') === s.kw >= th.lowKw));
    assert.equal(plan[m(2) / 15].night, true);
    assert.equal(plan[m(13) / 15].night, false);
    // Hodinová farba zo súčasnej appky (dayHourTiers) sedí s plánom v celú hodinu.
    const tiers = dayHourTiers(day, TARIFF, PLANT);
    assert.equal(tiers[12] === 'green', plan[m(12) / 15].tier === 'green');
});

test('bestDayIndex: najviac kWh, pri zhode skorší - ten istý deň ako súhrn súčasnej appky', () => {
    assert.equal(bestDayIndex(forecast.days), 5);
    assert.equal(bestDayIndex([{ kwhTotal: 3 }, { kwhTotal: 5 }, { kwhTotal: 5 }]), 1);
    assert.equal(weekStatsModel(forecast.days, null, false).best.kwh, forecast.days[5].kwhTotal);
});

test('sedemModel: nadpis s najlepším dňom, súčet, 7 riadkov s kWh zo súčasnej appky a oknom z plánu', () => {
    const s = sedemModel(input);
    assert.equal(s.kind, 'ok');
    assert.equal(s.title, 'Veľké pranie? Štvrtok.');
    const stats = weekStatsModel(forecast.days, input.pv, forecast.tomorrowSunny);
    assert.equal(s.sum, `Spolu 7 dní asi ${Math.round(stats.totalKwh)} kWh`);
    assert.equal(s.guess, null);
    const list = weekListModel(forecast.days, -1);
    assert.deepEqual(
        s.rows.map((r) => r.kwh),
        list.map((r) => `${r.kwh} kWh`),
    );
    assert.deepEqual(
        s.rows.map((r) => r.best),
        [false, false, false, false, false, true, false],
    );
    // Okno v riadku Dnes je zelený úsek plánu dňa - ten istý ako na kartách Môžem? a Teraz.
    const today = planWindows(dayPlan(input), (x) => x.tier === 'green');
    assert.deepEqual(s.rows[0].band, windowBand(today));
    assert.equal(s.rows[5].label, `Štvrtok, jasno, 63 kWh, ${sedemWindowsText(sunWindows(forecastDayPlan(input, 5)))}, najlepší deň`);
    assert.equal(s.rows[2].weather, 'zamracene');
});

test('sedemModel: najlepší je dnešok - „Dnes.“; bez okna celý týždeň nadpis to povie', () => {
    const days = forecast.days.map((d, i) => (i === 0 ? { ...d, kwhTotal: 99 } : d));
    assert.equal(sedemModel({ ...input, forecast: { ...forecast, days } }).title, 'Veľké pranie? Dnes.');
    const cloudy = { ...forecast, hourlyToday: forecast.hourlyToday.map((p) => ({ ...p, kw: 0.5 })) };
    cloudy.days = forecast.days.map((d) => ({ ...d, hourly: d.hourly.map((p) => ({ ...p, kw: Math.min(p.kw, 1) })) }));
    const s = sedemModel({ ...input, pv: null, forecast: cloudy });
    assert.equal(s.title, 'Veľké pranie? Tento týždeň slnko nestačí.');
    assert.ok(s.rows.every((r) => r.band.length === 0 && r.label.includes('bez okna')));
});

test('sedemModel: bez polohy výzva, načítavanie pokojne, bez dát príčina a Skúsiť znova', () => {
    const ask = sedemModel({ ...input, known: 'nic' });
    assert.equal(ask.kind, 'ask');
    assert.equal(ask.ask, true);
    assert.equal(ask.rows.length, 0);
    const loading = sedemModel({ ...input, forecast: null, loading: true });
    assert.equal(loading.kind, 'loading');
    assert.equal(loading.sub, SEDEM_TEXTS.loading);
    assert.equal(loading.retry, false);
    const offline = sedemModel({ ...input, forecast: null, pv: null }, { online: false });
    assert.equal(offline.kind, 'offline');
    assert.equal(offline.retry, true);
    assert.match(offline.sub, /^Nie je internet/);
    assert.equal(offline.rows.length, 0, 'žiadne vymyslené čísla');
    assert.equal(offline.sum, '');
});

test('sedemModel: bez internetu s predpoveďou je to posledná známa predpoveď', () => {
    const s = sedemModel(input, { online: false });
    assert.equal(s.kind, 'ok');
    assert.match(s.sum, / · posledná známa predpoveď$/);
});

test('sedemModel: poloha bez panelov - typická strecha, odhad v riadkoch a výzva', () => {
    const typical = typicalSettings(SITE);
    const f = fixtureData(FIXED_NOW).forecast;
    const s = sedemModel({ ...input, ...typical, known: 'poloha', pv: null, forecast: f });
    assert.equal(s.estimate, true);
    assert.match(s.sum, / · typická strecha$/);
    assert.equal(s.guess, sedemGuessText(installedKw(typical.plant)));
    assert.match(/** @type {string} */ (s.guess), /typickú strechu asi 5 kWp\.$/);
    assert.ok(s.rows.every((r) => r.kwh.startsWith('~') && r.label.endsWith('odhad pre typickú strechu')));
});

test('sedemDayModel: dnešok - čísla zo súčasnej appky, okno, „teraz“, nameraná krivka a čo nabehlo', () => {
    const d = sedemDayModel(input, 0);
    const day = forecast.days[0];
    assert.equal(d.title, 'Dnes 5.9.');
    assert.equal(d.sub, 'jasno');
    const w = mainWindow(sunWindows(dayPlan(input)));
    assert.deepEqual(d.nums, [{ value: '61,4', label: 'kWh za deň' }, { value: '7,9', label: 'kW špička' }, sedemWindowTile(w)]);
    assert.ok(d.chart.now, 'pri dnešku je značka teraz');
    assert.ok(d.chart.real, 'a nameraná krivka');
    assert.match(d.done, /^Predpoveď 61,4 kWh, už nabehlo/);
    assert.equal(d.clear, sedemClearText(day.clearKwhTotal, usePct(day)));
    assert.equal(d.price, null, 'ceny tarify nie sú zadané');
    assert.deepEqual(d.message, dayDetailMessage(visibleHours(day.hourly), powerThresholds(PLANT)));
    assert.match(d.chart.desc, /^Výroba počas dňa\. Teraz 13:00: /);
    assert.deepEqual(d.chart.legend, planLegend(planCells(dayPlan(input))));
    assert.equal(d.first, true);
    assert.equal(d.last, false);
});

test('sedemDayModel: iný deň bez „teraz“ a bez merania; deň bez okna „bez okna“ a slabý deň', () => {
    const d = sedemDayModel(input, 6);
    assert.equal(d.chart.now, null);
    assert.equal(d.chart.real, '');
    assert.equal(d.done, '');
    assert.equal(d.last, true);
    assert.doesNotMatch(d.chart.desc, /Teraz/);
    const weak = sedemDayModel({ ...input, forecast: weakDay(4, 0.15) }, 4);
    assert.deepEqual(weak.nums[2], { value: '–', label: 'bez okna' });
    assert.equal(weak.message.title, 'Slabý deň');
    assert.match(weak.chart.desc, /Okno na veľké veci nebude\./);
    // Typická strecha to povie aj v detaile.
    assert.equal(sedemDayModel({ ...input, known: 'poloha' }, 2).sub, 'zamračené · typická strecha');
});

test('sedemDayModel: cena zo siete, keď sú ceny pásiem zadané', () => {
    const tariff = { ...TARIFF, bands: TARIFF.bands.map((b, i) => ({ ...b, price: i ? 0.2 : 0.1 })) };
    const d = sedemDayModel({ ...input, tariff }, 3);
    assert.equal(d.price, sedemPriceText(priceSegments(tariff, forecast.days[3].date), '€'));
    assert.match(/** @type {string} */ (d.price), /^Cena zo siete: 00:00 – /);
});

test('sedemWeekModel: čísla zo súhrnu súčasnej appky, 7 stĺpcov, mapa 7 × hodiny, hláška weekMessage', () => {
    const w = sedemWeekModel(input);
    const stats = weekStatsModel(forecast.days, input.pv, forecast.tomorrowSunny);
    assert.equal(w.range, '5.9. – 11.9.');
    assert.deepEqual(w.nums, [
        { value: String(Math.round(stats.totalKwh)), label: 'kWh spolu' },
        { value: '46,7', label: 'kWh na deň' },
        { value: stats.best.label, label: 'najlepší deň' },
    ]);
    assert.equal(w.bars.length, 7);
    assert.deepEqual(
        w.bars.filter((b) => b.best).map((b) => b.name),
        ['Št'],
    );
    const top = w.bars.find((b) => b.best);
    assert.ok(top && w.bars.every((b) => b.h <= top.h));
    assert.equal(w.heat.cells.length, 7 * 17);
    assert.equal(w.heat.h, WEEK_HEAT.top + 7 * (WEEK_HEAT.rowH + WEEK_HEAT.gap));
    // Zelené políčko = hodina, keď slnko stačí (dayHourTiers).
    const tiers = dayHourTiers(forecast.days[0], TARIFF, PLANT);
    assert.equal(w.heat.cells[12 - 5].sun, tiers[12] === 'green');
    assert.equal(w.heat.cells[0].sun, false);
    assert.deepEqual(w.message, weekMessage(forecast.days));
    assert.match(w.barsText, /^Výroba po dňoch: Dnes 61 kWh, .* Najlepší deň: štvrtok\.$/);
    assert.match(w.heatText, /^Hodiny, keď slnko stačí na veľké spotrebiče: Dnes od 8 do 18 h, /);
    assert.equal(sedemWeekModel({ ...input, known: 'poloha' }).range, '5.9. – 11.9. · typická strecha');
});

test('texty karty 7 dní', () => {
    assert.equal(sedemTitle('Sobota'), 'Veľké pranie? Sobota.');
    assert.equal(sedemTitle(null), 'Veľké pranie? Tento týždeň slnko nestačí.');
    assert.equal(
        sedemSumText({ totalKwh: 1213.6, lastKnown: true, estimate: true }),
        'Spolu 7 dní asi 1 214 kWh · posledná známa predpoveď · typická strecha',
    );
    assert.equal(
        sedemGuessText(4.8),
        `Ktorý deň je najlepší, viem z počasia. Koľko kWh, záleží od tvojich panelov. Teraz ukazujem typickú strechu ${kwpRoughText(4.8)}.`,
    );
    assert.equal(sedemWindowsText([]), 'bez okna');
    assert.equal(
        sedemWindowsText([
            { from: m(10, 15), to: m(12) },
            { from: m(13), to: m(24) },
        ]),
        'okno 10:15 až 12:00 a 13:00 až 24:00',
    );
    assert.equal(
        sedemRowText({
            name: 'Sobota',
            word: 'polojasno',
            kwh: 36,
            windows: [{ from: m(10, 15), to: m(14, 30) }],
            best: false,
            estimate: false,
        }),
        'Sobota, polojasno, 36 kWh, okno 10:15 až 14:30',
    );
    assert.equal(
        sedemRowText({ name: 'Dnes', word: null, kwh: 3, windows: [], best: true, estimate: true }),
        'Dnes, 3 kWh, bez okna, najlepší deň, odhad pre typickú strechu',
    );
    assert.deepEqual(sedemWindowTile({ from: m(10, 15), to: m(14, 30) }), { value: '10:15', label: 'do 14:30' });
    assert.deepEqual(sedemWindowTile(null), { value: '–', label: 'bez okna' });
    assert.equal(sedemClearText(65, 94), 'Jasná obloha by dala 65,0 kWh, predpoveď je 94 % z toho.');
    assert.equal(sedemClearText(0, null), '');
    const band = (/** @type {number | null} */ price) => ({ id: 'j', name: 'Cena', level: /** @type {const} */ ('bezna'), price });
    assert.equal(sedemPriceText([{ startMin: 0, min: 1440, band: band(0.15) }], '€'), 'Cena zo siete celý deň 0,15 €/kWh.');
    assert.equal(sedemPriceText([{ startMin: 0, min: 1440, band: band(null) }], '€'), null);
    assert.equal(
        sedemBarsText(
            [
                { name: 'Dnes', kwh: 5 },
                { name: 'Zajtra', kwh: 7 },
            ],
            'Zajtra',
        ),
        'Výroba po dňoch: Dnes 5 kWh, Zajtra 7 kWh. Najlepší deň: zajtra.',
    );
    assert.equal(
        sedemHeatText([
            { name: 'Dnes', hours: [9, 10, 11] },
            { name: 'Zajtra', hours: [] },
        ]),
        'Hodiny, keď slnko stačí na veľké spotrebiče: Dnes od 9 do 12 h, Zajtra vôbec.',
    );
    const th = powerThresholds(PLANT);
    const pts = visibleHours(forecast.days[0].hourly);
    assert.deepEqual(sedemDayMessage(pts, th, true), dayDetailMessage(pts, th));
    assert.equal(sedemDayMessage(pts, th, false).title, 'Slabý deň');
});

test('dayChartText: bez „teraz“ pre iný deň, terazChartText ostáva to isté', () => {
    const w = [{ from: m(9), to: m(17) }];
    assert.equal(
        dayChartText({ now: null, sun: [], cheap: w, costly: [] }),
        'Výroba počas dňa. Okno na veľké veci nebude. Lacná sieť 09:00 – 17:00.',
    );
    assert.equal(
        terazChartText({ nowMin: m(13), kwText: '5,0', tone: 'sun', sun: w, cheap: [], costly: [] }),
        'Výroba počas dňa. Teraz 13:00: 5,0 kW, slnko stačí. Okno na veľké veci 09:00 – 17:00.',
    );
    assert.equal(
        terazChartText({ nowMin: m(13), kwText: '0,0', tone: 'plain', sun: [], cheap: [], costly: w }),
        'Výroba počas dňa. Teraz 13:00: 0,0 kW, bežná cena. Okno na veľké veci dnes nebude. Drahá sieť 09:00 – 17:00.',
    );
});

test('dayChartModel: bez „teraz“ (iný deň) značka chýba a stupnica ide len z kriviek', () => {
    /** @type {import('../shared/config.js').Tariff} */
    const flat = {
        currency: '€',
        bands: [{ id: 'j', name: 'Cena', level: 'bezna', price: null }],
        schedules: [{ days: ALL_DAYS, months: ALL_MONTHS, changes: [{ from: '00:00', band: 'j' }] }],
    };
    const plan = forecastDayPlan({ ...input, tariff: flat }, 2);
    const geo = dayChartModel({
        plan,
        hourly: forecast.days[2].hourly,
        real: [],
        boundary: null,
        nowMin: null,
        nowKw: 99,
        limitKw: 2,
        limitText: 'veľké spotrebiče',
        preview: null,
    });
    assert.equal(geo.now, null);
    assert.equal(geo.real, '');
    // Výkon „teraz“ (99 kW) do stupnice nevstúpi, keď značka nie je.
    assert.ok(geo.limitY < 100);
    assert.deepEqual(
        planLegend(planCells(plan)).map((l) => l.tone),
        ['sun', 'plain'],
    );
});
