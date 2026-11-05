import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINUTES_PER_DAY, PLANT, SITE, TARIFF } from '../shared/config.js';
import { dayPlan } from '../shared/day-plan.js';
import {
    COMPASS,
    compassModel,
    compassPoint,
    dayKwAt,
    dayRingModel,
    interpolate,
    minutesFromAngle,
    panelGridModel,
    RING,
    ringPoint,
    tiltModel,
    usePct,
    weekDayTiers,
    weekListModel,
    weekStatsModel,
} from '../shared/chart-model.js';
import { FIXED_NOW, fixtureData } from './helpers.js';

const { pv, forecast } = fixtureData();

test('interpolate: okraje, stred, iné pole', () => {
    const pts = [
        { hour: 6, kw: 0, cloud: 10 },
        { hour: 8, kw: 4, cloud: 50 },
    ];
    assert.equal(interpolate(pts, 5), 0);
    assert.equal(interpolate(pts, 9), 4);
    assert.equal(interpolate(pts, 7), 2);
    assert.equal(interpolate(pts, 7, 'cloud'), 30);
    assert.equal(interpolate([], 7), 0);
});

test('kruh dňa: poludnie hore, pásma obídu celý deň, uhol a minúta sú navzájom opačné', () => {
    const c = RING.viewBox / 2;
    const midnight = ringPoint(RING.rDay, 0);
    assert.ok(Math.abs(midnight.x - c) < 1e-9 && midnight.y > c, 'polnoc je dole');
    const noon = ringPoint(RING.rDay, MINUTES_PER_DAY / 2);
    assert.ok(Math.abs(noon.x - c) < 1e-9 && noon.y < c, 'poludnie je hore');
    const six = ringPoint(RING.rDay, MINUTES_PER_DAY / 4);
    assert.ok(six.x < c && Math.abs(six.y - c) < 1e-9, '06:00 je vľavo - slnko ide zľava doprava');

    // minutesFromAngle je opak ringPoint: čo jeden vyrobí, druhý prečíta späť.
    for (const m of [0, 95, 370, 786, 1000, 1435]) {
        const p = ringPoint(RING.rDay, m);
        assert.equal(minutesFromAngle(p.x - c, p.y - c), m, `minúta ${m} tam a späť`);
    }

    const bands = dayRingModel(dayPlan({ now: FIXED_NOW, tariff: TARIFF, site: SITE, plant: PLANT, pv, forecast }));
    assert.ok(bands.length > 1 && bands.every((b) => ['green', 'amber', 'red'].includes(String(b.cls))));
    assert.ok(
        bands.every((b) => b.large === 0),
        'žiadny oblúk Dvorian nie je dlhší než pol dňa',
    );
    // Posledné pásmo končí tesne pred polnocou, nie na nej - oblúk s totožnými koncami
    // by sa nevykreslil vôbec.
    const last = bands[bands.length - 1];
    assert.ok(Math.abs(last.end.x - c) > 1e-6 || last.end.y > c, 'posledný oblúk nekončí presne hore');

    const nowMinutes = 13 * 60;
    assert.ok(Number.isNaN(dayKwAt(600, null, null, nowMinutes)));
    assert.ok(dayKwAt(600, pv.realCurveToday, forecast.hourlyToday, nowMinutes) > 0);
});

test('weekListModel: pásik podľa najsilnejšieho dňa, výroba v celých kWh', () => {
    const rows = weekListModel(forecast.days, 3);
    assert.equal(rows.length, 7);
    assert.ok(rows[0].today && rows[3].sel, 'dnešok a vybraný deň sú označené');
    assert.equal(rows[0].name, 'Dnes');
    assert.equal(rows[1].name, 'Zajtra');
    // Najsilnejší deň má plný pásik, žiadny iný ho nepresiahne.
    const najsilnejsi = Math.max(...forecast.days.map((d) => d.kwhTotal));
    assert.equal(rows[forecast.days.findIndex((d) => d.kwhTotal === najsilnejsi)].barPct, 100);
    assert.ok(
        rows.every((r) => r.barPct >= 0 && r.barPct <= 100),
        'pásik ostáva v rozsahu 0-100 %',
    );
    assert.ok(
        rows.every((r) => Number.isInteger(r.kwh)),
        'výroba je v celých kWh',
    );
});

test('weekDayTiers: pásmo dňa podľa podielu z najsilnejšieho dňa, tie isté hranice ako heatmapa', () => {
    const den = (/** @type {number} */ kwhTotal) => ({ ...forecast.days[0], kwhTotal });
    // 60 je najsilnejší deň: 60/60 = 1 zelená, 35/60 = 0,58 jantárová, 15/60 = 0,25 červená.
    const tiers = weekDayTiers([den(60), den(35), den(15), den(0)]);
    assert.deepEqual(tiers, ['green', 'amber', 'red', null]);
    // Hranice sú presne v tretinách, rovnako ako pásma buniek heatmapy.
    assert.deepEqual(weekDayTiers([den(90), den(30), den(29.9), den(60), den(59.9)]), ['green', 'amber', 'red', 'green', 'amber']);
});

test('weekDayTiers: týždeň bez jedinej kWh nemá byť celý červený', () => {
    const tiers = weekDayTiers(forecast.days.map((d) => ({ ...d, kwhTotal: 0 })));
    assert.ok(
        tiers.every((t) => t === null),
        'deň bez výroby nemá pásmo - null znamená nefarbiť',
    );
});

test('weekListModel: týždeň bez výroby má prázdne pásiky, nie NaN', () => {
    const rows = weekListModel(
        forecast.days.map((d) => ({ ...d, kwhTotal: 0 })),
        0,
    );
    assert.ok(
        rows.every((r) => r.barPct === 0 && r.kwh === 0),
        'delenie nulou nesmie pásiky rozhodiť',
    );
});

test('weekStatsModel', () => {
    const s = weekStatsModel(forecast.days, pv, forecast.tomorrowSunny);
    assert.ok(s.progress && s.progress.realKwh === 31.7);
    assert.ok(Math.abs(s.totalKwh - forecast.days.reduce((a, d) => a + d.kwhTotal, 0)) < 1e-9);
    assert.ok(s.best.kwh >= s.avgKwh);
    assert.equal(weekStatsModel(forecast.days, null, false).progress, null);
    // Kiosk dennú výrobu neposlal (null) - to nie je nameraná nula, takže ani progress.
    assert.equal(weekStatsModel(forecast.days, { ...pv, dailyEnergyKwh: null }, false).progress, null);
    assert.equal(typeof s.trendPct, 'number');
    assert.equal(usePct({ ...forecast.days[0], clearKwhTotal: 0 }), null);
});

test('kompas: osem výsekov, zvolený svieti, slnko na poludnie na juhu (na južnej pologuli na severe)', () => {
    const m = compassModel(135, false);
    assert.equal(m.sectors.length, 8);
    assert.deepEqual(
        m.sectors.filter((s) => s.on).map((s) => s.az),
        [135],
    );
    assert.ok(m.sun.y > COMPASS.viewBox / 2, 'na severnej pologuli je poludnie dole (juh)');
    assert.ok(compassModel(0, true).sun.y < COMPASS.viewBox / 2, 'na južnej hore (sever)');
    assert.equal(m.rotateDeg, -45, 'strecha nakreslená na juh sa otočí o rozdiel');
    // Tlačidlá sedia v percentách obalu: sever hore v strede, východ vpravo.
    const [sever, , vychod] = m.sectors;
    assert.ok(Math.abs(sever.button.left - 50) < 1e-9 && sever.button.top < 50);
    assert.ok(vychod.button.left > 50 && Math.abs(vychod.button.top - 50) < 1e-9);
    assert.ok(Math.abs(compassPoint(90, 10, 0).x - 10) < 1e-9, 'azimut 90 je vpravo');
});

test('nákres sklonu: rovina stúpa doľava, pri plochej streche bez oblúka uhla', () => {
    const plocha = tiltModel(0);
    assert.equal(plocha.arc, null);
    assert.ok(Math.abs(plocha.end.y - plocha.pivot.y) < 1e-9);
    const strma = tiltModel(45);
    assert.ok(strma.arc && strma.end.x < strma.pivot.x && strma.end.y < strma.pivot.y);
    const stena = tiltModel(90);
    assert.ok(Math.abs(stena.end.x - stena.pivot.x) < 1e-6, 'panel na stene stojí zvislo');
});

test('mriežka panelov: najviac 40 kresbou, zvyšok číslom, neplatný počet nič', () => {
    assert.equal(panelGridModel(16).cells.length, 16);
    assert.equal(panelGridModel(16).more, 0);
    const vela = panelGridModel(55);
    assert.equal(vela.cells.length, 40);
    assert.equal(vela.more, 15);
    assert.ok(vela.height > panelGridModel(10).height);
    assert.equal(panelGridModel(NaN).cells.length, 0);
});

test('planesRoseModel: výsek na plochu v jej smere, plocha podľa panelov, číslo za špičkou', async () => {
    const { planesRoseModel, PLANES_ROSE } = await import('../shared/chart-model.js');
    const c = PLANES_ROSE.viewBox / 2;
    const m = planesRoseModel(
        [
            { panels: 8, azimuthDeg: 270 },
            { panels: 16, azimuthDeg: 180 },
        ],
        false,
    );
    // Hlavná ide navrch, teda posledná.
    const [zapad, juh] = m.wedges;
    assert.ok(juh.main && !zapad.main);
    assert.equal(juh.r1, PLANES_ROSE.rMax, 'najväčšia plocha má plnú dĺžku');
    // Polovica panelov = polovica plochy výseku, polomer cez odmocninu.
    assert.ok(Math.abs(zapad.r1 - (PLANES_ROSE.rMin + (PLANES_ROSE.rMax - PLANES_ROSE.rMin) * Math.SQRT1_2)) < 1e-9);
    assert.equal(juh.num.text, '16');
    assert.ok(Math.abs(juh.num.x - c) < 1e-9 && juh.num.y > c + juh.r1, 'číslo juhu je pod špičkou');
    assert.ok(zapad.num.x < c - zapad.r1 && Math.abs(zapad.num.y - c) < 1e-9, 'číslo západu je vľavo za špičkou');
    // Slnko na juhu, písmená: sever slabo, západ tučne, juh na slnku.
    assert.ok(m.sun.y > c);
    assert.equal(m.noonSweep, 1);
    assert.deepEqual(
        m.letters.map((l) => [l.az, l.kind]),
        [
            [0, 'dim'],
            [180, 'sun'],
            [270, 'strong'],
        ],
    );
    assert.equal(m.ticks.length, 8);
});

test('planesRoseModel: blízke smery jeden výsek, rovnaké plochy obe hlavné, južná pologuľa', async () => {
    const { planesRoseModel, PLANES_ROSE } = await import('../shared/chart-model.js');
    const c = PLANES_ROSE.viewBox / 2;
    // 170° a 200° by sa prekryli - jeden výsek so súčtom, písmeno najbližšieho smeru.
    const blizke = planesRoseModel(
        [
            { panels: 10, azimuthDeg: 170 },
            { panels: 6, azimuthDeg: 200 },
        ],
        false,
    );
    assert.deepEqual(
        blizke.wedges.map((w) => w.num.text),
        ['16'],
    );
    assert.ok(blizke.letters.some((l) => l.az === 180));
    const rovnake = planesRoseModel(
        [
            { panels: 10, azimuthDeg: 90 },
            { panels: 10, azimuthDeg: 270 },
        ],
        false,
    );
    assert.ok(rovnake.wedges.every((w) => w.main));
    // Na južnej pologuli je poludnie na severe; plocha na sever je tam na slnku.
    const juh = planesRoseModel([{ panels: 16, azimuthDeg: 0 }], true);
    assert.ok(juh.sun.y < c);
    assert.equal(juh.noonSweep, 0);
    assert.deepEqual(
        juh.letters.map((l) => [l.az, l.kind]),
        [[0, 'sun']],
    );
    // Rozpísaná plocha bez počtu panelov: najkratší výsek, nie hlavný, číslo 0.
    const [bez] = planesRoseModel([{ panels: NaN, azimuthDeg: -45 }], false).wedges;
    assert.equal(bez.r1, PLANES_ROSE.rMin);
    assert.ok(!bez.main);
    assert.equal(bez.num.text, '0');
});
