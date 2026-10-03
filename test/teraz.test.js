import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installedKw, MINUTES_PER_DAY, MOZEM_ITEMS, PLANT, powerThresholds, SITE, TARIFF, TYPICAL_PLANT } from '../shared/config.js';
import { cellAt, chartMinutes, chartX, DAY_CHART, dayChartModel, planCells, slotTone } from '../shared/day-chart.js';
import { dayPlan } from '../shared/day-plan.js';
import { kwpRoughText } from '../shared/format.js';
import { heroModel, pvFreshness } from '../shared/hero-model.js';
import {
    mozemGuessText,
    mozemOfflineText,
    TERAZ_TEXTS,
    TERAZ_TONES,
    terazChartText,
    terazClearText,
    terazLaterText,
    terazPillText,
    terazPreviewText,
    terazSliderText,
    terazSourceText,
    terazTodayText,
    terazTypicalText,
    terazWindowText,
} from '../shared/messages.js';
import { deviceShorts } from '../shared/mozem.js';
import { typicalSettings } from '../shared/settings.js';
import { terazInput, terazModel } from '../shared/teraz.js';
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
        kiosk: 'kiosk',
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

test('dayChartModel: plocha predpovede, nameraná krivka po hranicu, hranica, pás, teraz a štítok náhľadu v grafe', () => {
    const i = input(at('13:00'));
    const plan = dayPlan(i);
    const forecast = /** @type {import('../shared/solar.js').Forecast} */ (i.forecast);
    const pv = /** @type {import('../shared/kiosk.js').PvData} */ (i.pv);
    const limitKw = powerThresholds(PLANT).lowKw;
    const base = { plan, hourly: forecast.hourlyToday, real: pv.realCurveToday, boundary: hm(11), nowMin: hm(13), nowKw: 6.4, limitKw };
    const m = dayChartModel({ ...base, preview: null });
    assert.match(m.area, new RegExp(`^M${DAY_CHART.left} ${DAY_CHART.base} L`));
    assert.match(m.area, /Z$/);
    // Nameraná krivka končí na hranici (11:00), nie na poslednom bode kiosku.
    const realXs = m.real
        .slice(1)
        .split(' L')
        .map((p) => Number(p.split(' ')[0]));
    assert.equal(Math.max(...realXs), Math.round(chartX(hm(11)) * 10) / 10);
    assert.ok(m.limitY > DAY_CHART.top && m.limitY < DAY_CHART.base);
    assert.equal(m.cells.length, 48);
    assert.deepEqual(
        m.ticks.map((t) => t.label),
        ['0', '6', '12', '18', '24'],
    );
    assert.equal(m.now.x, Math.round(chartX(hm(13)) * 10) / 10);
    assert.ok(m.now.y !== null && m.now.y < DAY_CHART.base);
    assert.equal(m.preview, null);

    // Štítok náhľadu na kraji dňa ostane celý v grafe.
    for (const min of [0, hm(12), hm(23, 45)]) {
        const p = dayChartModel({ ...base, preview: { min, kw: 1, text: terazPillText(min, 1, 'plain') } }).preview;
        assert.ok(p);
        assert.ok(p.pill.x >= 4 && p.pill.x + p.pill.w <= DAY_CHART.w - 4 + 0.1, `štítok o ${min} trčí z grafu`);
    }
    // Bez výkonu bodka nie je, bez predpovede ani plocha; prázdna krivka sa nekreslí.
    const empty = dayChartModel({ ...base, hourly: [], real: [], boundary: null, nowKw: NaN, preview: null });
    assert.equal(empty.area, '');
    assert.equal(empty.real, '');
    assert.equal(empty.now.y, null);
});

test('terazModel o 13:00: číslo, odporúčanie a spotrebiče ako karta Terazky (heroModel, deviceShorts)', () => {
    const i = input(at('13:00'));
    const m = terazModel(i);
    const hero = heroModel(i);
    assert.equal(terazInput(i), i, 'pri čerstvom meraní je vstup ten istý ako pre Terazky');
    assert.equal(m.kind, 'ok');
    assert.equal(m.num, hero.powerText);
    assert.equal(m.source, 'živé meranie');
    assert.match(m.sub, /^\d+ % z toho, čo by dala jasná obloha$/);
    assert.equal(m.retry, false);
    assert.equal(m.guess, false);
    assert.ok(m.cards && m.chart);
    assert.deepEqual(m.cards.now, { head: hero.message.headline, body: hero.message.body });
    const shorts = deviceShorts(i);
    assert.deepEqual(
        m.cards.devices,
        MOZEM_ITEMS.filter((it) => it.device).map((it) => ({ name: it.device, short: shorts[/** @type {string} */ (it.device)] })),
    );
    assert.equal(
        m.cards.today.line,
        terazTodayText({ forecastKwh: 61.4, doneKwh: /** @type {number} */ (i.pv?.dailyEnergyKwh), measured: true }),
    );
    assert.equal(m.cards.today.pct, Math.round((100 * /** @type {number} */ (i.pv?.dailyEnergyKwh)) / 61.4));
    assert.equal(m.chart.value, hm(13));
    assert.equal(m.chart.valueText, terazSliderText(hm(13), false, hero.powerText, 'sun'));
    assert.deepEqual(m.hint, { text: TERAZ_TEXTS.hint, reset: false });
    assert.deepEqual(
        m.chart.legend.map((l) => l.text),
        [TERAZ_TONES.sun, TERAZ_TONES.cheap, TERAZ_TONES.costly],
    );
    assert.match(m.chart.desc, /^Výroba počas dňa\. Teraz 13:00: .* kW, slnko stačí\. Okno na veľké veci /);
});

test('terazModel: náhľad iného času mení číslo, vetu a odporúčanie, „teraz“ v grafe ostáva', () => {
    const i = input(at('13:00'), { previewMinutes: hm(15, 30) });
    const m = terazModel(i);
    const hero = heroModel(i);
    assert.equal(m.num, hero.powerText);
    assert.equal(m.source, 'odhad z predpovede');
    assert.deepEqual(m.hint, { text: terazPreviewText(hm(15, 30)), reset: true });
    assert.equal(m.hint.text, 'Pozeráš 15:30.');
    assert.equal(m.cards?.now.head, hero.message.headline);
    const now = terazModel(input(at('13:00')));
    assert.equal(m.chart?.now.x, now.chart?.now.x);
    assert.equal(m.chart?.preview?.pill.text, terazPillText(hm(15, 30), hero.power, 'sun'));
    assert.equal(m.chart?.value, hm(15, 30));
    assert.match(m.chart?.valueText ?? '', /^Náhľad 15:30, /);
});

test('terazModel: meranie mlčí - odhad z krivky dňa, povie odkedy; plán a odporúčanie z predpovede', () => {
    // Posledné meranie o 11:40, teraz je 13:00.
    const stale = { ...pvAt(at('11:40')) };
    const i = input(at('13:00'), { pv: stale });
    const base = terazInput(i);
    assert.notEqual(base, i);
    assert.equal(base.pv?.realTimePowerKw, null);
    const m = terazModel(i);
    const hero = heroModel(base);
    assert.equal(m.num, hero.powerText);
    assert.notEqual(m.num, heroModel(i).powerText, 'staré číslo z kiosku sa netvári ako výkon teraz');
    // Čas je posledný bod krivky, ten istý, aký ukazuje hlavička.
    assert.equal(m.source, `odhad z predpovede · meranie neodpovedá od ${pvFreshness({ now: at('13:00'), pv: stale, site: SITE }).time}`);
    assert.equal(m.cards?.now.head, hero.message.headline);
    // Kiosk nastavený, meranie vôbec neprišlo.
    assert.equal(terazModel(input(at('13:00'), { pv: null })).source, 'odhad z predpovede · meranie neodpovedá');
    // Bez kiosku nemá čo mlčať.
    assert.equal(terazModel(input(at('13:00'), { pv: null, kiosk: '' })).source, 'odhad z predpovede');
});

test('terazModel: noc - výkon 0, veta o obzore, okno, ktoré už bolo, a lacná sieť', () => {
    const vecer = terazModel(input(at('21:00')));
    assert.equal(vecer.num, '0.00');
    assert.equal(vecer.sub, TERAZ_TEXTS.night);
    assert.match(vecer.cards?.today.window ?? '', /^Okno na veľké veci bolo /);
    const noc = terazModel(input(at('02:00')));
    assert.equal(noc.sub, TERAZ_TEXTS.night);
    assert.equal(noc.cards?.now.head, heroModel(input(at('02:00'))).message.headline);
    assert.match(noc.cards?.today.window ?? '', /^Okno na veľké veci \d/);
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
    assert.equal(off.sub, mozemOfflineText({ online: true, kiosk: true, pvOk: false, pvSince: null }));
    assert.equal(off.chart, null);
    assert.equal(off.cards, null);
    assert.equal(
        terazModel(input(at('13:00'), { pv: null, forecast: null }), { online: false }).sub,
        mozemOfflineText({ online: false, kiosk: true, pvOk: false, pvSince: null }),
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
    assert.equal(m.cards?.now.head, terazModel({ ...g, known: 'elektraren' }).cards?.now.head);
    assert.match(m.cards?.today.line ?? '', /podľa nej už asi/);
});

test('terazModel: predpoveď z iného dňa (po polnoci pred obnovou) netvrdí dnešok ani jasnú oblohu', () => {
    const i = input(at('13:00'));
    const m = terazModel({ ...i, now: new Date(at('13:00').getTime() + 86400000), pv: null, kiosk: '' });
    assert.equal(m.cards?.today.line, '');
    assert.equal(m.cards?.today.pct, null);
    assert.equal(m.sub, TERAZ_TEXTS.night);
});

test('texty karty Teraz', () => {
    assert.equal(terazSourceText('live', { silent: false, since: null }), 'živé meranie');
    assert.equal(terazSourceText('measured', { silent: true, since: '11:40' }), 'namerané');
    assert.equal(terazSourceText('forecast', { silent: false, since: null }), 'odhad z predpovede');
    assert.equal(terazSourceText(null, { silent: true, since: '11:40' }), 'odhad z predpovede · meranie neodpovedá od 11:40');
    assert.equal(terazClearText(72), '72 % z toho, čo by dala jasná obloha');
    assert.equal(terazPillText(hm(15, 30), 4.89, 'sun'), '15:30 · 4,9 kW · slnko stačí');
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
        'Výroba počas dňa. Teraz 13:00: 6.41 kW, slnko stačí. Okno na veľké veci 09:00 – 17:30. Lacná sieť 00:00 – 06:00, 22:00 – 24:00.',
    );
    assert.match(
        terazChartText({ nowMin: 0, kwText: '0.00', tone: 'costly', sun: [], cheap: [], costly: [{ from: 0, to: 60 }] }),
        /Okno na veľké veci dnes nebude\. Drahá sieť 00:00 – 01:00\.$/,
    );
});
