import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    ALL_DAYS,
    ALL_MONTHS,
    DEMO_PLANT,
    DEMO_TARIFF,
    PLANT,
    powerThresholds,
    TARIFF,
    TARIFF_LIMITS,
    TARIFF_TEMPLATES,
} from '../shared/config.js';
import {
    autoLevels,
    autoTier,
    bandAt,
    changesOf,
    checkTariff,
    deviceStates,
    isSeasonSchedule,
    isWeekendSchedule,
    levelTier,
    newBandId,
    paintSlots,
    parseStoredTariff,
    priceSegments,
    productionLevel,
    scheduleFor,
    scheduleRuns,
    scheduleTiers,
    slotsOf,
    smartTier,
    tariffHint,
    tariffKind,
    tariffPricesText,
    weekdayOf,
} from '../shared/tariff.js';

const m = (/** @type {number} */ h, /** @type {number} */ min = 0) => h * 60 + min;
const th = powerThresholds(PLANT);
/** @typedef {import('../shared/config.js').Tariff} Tariff */

/** Tarifa s víkendom a letom ako výnimkami: tri pásma, ceny sedia s úrovňami. @returns {Tariff} */
function troj() {
    return {
        currency: '€',
        bands: [
            { id: 'p3', name: 'Mimo špičky', level: 'lacna', price: 0.11 },
            { id: 'p2', name: 'Bežné', level: 'bezna', price: 0.17 },
            { id: 'p1', name: 'Špička', level: 'draha', price: 0.25 },
        ],
        schedules: [
            {
                days: ALL_DAYS,
                months: ALL_MONTHS,
                changes: [
                    { from: '00:00', band: 'p3' },
                    { from: '08:00', band: 'p2' },
                    { from: '10:00', band: 'p1' },
                    { from: '14:00', band: 'p2' },
                ],
            },
            { days: [6, 7], months: ALL_MONTHS, changes: [{ from: '00:00', band: 'p3' }] },
            { days: ALL_DAYS, months: [7, 8], changes: [{ from: '00:00', band: 'p2' }] },
        ],
    };
}

test('weekdayOf: pondelok 1 až nedeľa 7', () => {
    assert.equal(weekdayOf('2026-09-07'), 1);
    assert.equal(weekdayOf('2026-09-05'), 6);
    assert.equal(weekdayOf('2026-09-06'), 7);
});

test('scheduleFor: posledná výnimka, ktorá na deň sedí, inak základ', () => {
    const t = troj();
    assert.equal(scheduleFor(t, '2026-09-07'), t.schedules[0], 'pondelok v septembri je základ');
    assert.equal(scheduleFor(t, '2026-09-05'), t.schedules[1], 'sobota je víkend');
    assert.equal(scheduleFor(t, '2026-07-06'), t.schedules[2], 'pondelok v júli je leto');
    assert.equal(scheduleFor(t, '2026-07-04'), t.schedules[2], 'sobota v júli: leto je neskôr, vyhráva');
});

test('bandAt a priceSegments: Dvorany majú štyri hodiny VT a dvadsať NT', () => {
    const day = '2026-09-05';
    const s = scheduleFor(TARIFF, day);
    assert.equal(bandAt(TARIFF, s, m(2)).id, 'nt');
    assert.equal(bandAt(TARIFF, s, m(7, 30)).id, 'vt');
    assert.equal(bandAt(TARIFF, s, m(8, 29)).id, 'vt');
    assert.equal(bandAt(TARIFF, s, m(8, 30)).id, 'nt');
    assert.equal(bandAt(TARIFF, s, m(23, 59)).id, 'nt');
    const segs = priceSegments(TARIFF, day);
    assert.equal(
        segs.reduce((sum, x) => sum + x.min, 0),
        1440,
    );
    assert.deepEqual(
        segs.map((x) => `${x.min}${x.level[0]}`),
        ['450l', '60d', '60l', '60d', '600l', '60d', '60l', '60d', '30l'],
    );
    const vt = segs.filter((x) => x.band.id === 'vt').reduce((sum, x) => sum + x.min, 0);
    assert.equal(vt, 240);
});

test('powerThresholds: Dvorany majú 2 / 4 / 1,5 / 1,2 kW, iná elektráreň v pomere najvyššieho výkonu', () => {
    assert.deepEqual(th, { lowKw: 2, highKw: 4, marginKw: 1.5, weakPeakKw: 1.2 });
    // Ukážka: 12 × 435 Wp = 5,2 kWp, menič 5 kW -> polovica Dvorian (10 kW).
    assert.deepEqual(powerThresholds(DEMO_PLANT), { lowKw: 1, highKw: 2, marginKw: 0.75, weakPeakKw: 0.6 });
    // Menič menší než panely: rozhoduje menič, inak by vysoká výroba nebola nikdy.
    const smallInverter = powerThresholds({ ...PLANT, acLimitKw: 3 });
    assert.ok(smallInverter.highKw < 3);
    // Menič väčší než panely: rozhodujú panely (24 × 250 Wp = 6 kWp).
    assert.equal(powerThresholds({ ...PLANT, panelWp: 250, acLimitKw: 20 }).highKw, 2.4);
});

test('productionLevel a smartTier: od dolnej hranice zelená, pod ňou farba ceny', () => {
    assert.equal(productionLevel(NaN, th), null);
    assert.equal(productionLevel(th.lowKw - 0.01, th), 'niz');
    assert.equal(productionLevel(th.lowKw, th), 'str');
    assert.equal(productionLevel(th.highKw, th), 'vys');
    assert.equal(levelTier('lacna'), 'amber');
    assert.equal(levelTier('bezna'), 'grey');
    assert.equal(levelTier('draha'), 'red');
    assert.equal(levelTier(null), null);
    assert.equal(smartTier('draha', NaN, th), 'red');
    assert.equal(smartTier('draha', NaN, th, null), null);
    assert.equal(smartTier('draha', th.lowKw, th), 'green');
    assert.equal(smartTier('draha', 0.5, th), 'red');
    assert.equal(smartTier('bezna', 0.5, th), 'grey');
    assert.equal(smartTier('lacna', 0.5, th), 'amber');
    // Pri menšej elektrárni je rovnaký výkon „viac“.
    assert.equal(productionLevel(2.5, powerThresholds(DEMO_PLANT)), 'vys');
});

test('autoTier: lacné pásmo bez slnka oranžové, inak bez slnka červené, silné slnko mimo drahého zelené', () => {
    assert.equal(autoTier('lacna', 0, th), 'amber');
    assert.equal(autoTier('lacna', NaN, th), 'amber');
    assert.equal(autoTier('bezna', 1, th), 'red');
    assert.equal(autoTier('draha', 3, th), 'red');
    assert.equal(autoTier('lacna', th.highKw, th), 'green');
    assert.equal(autoTier('bezna', th.highKw, th), 'green');
    assert.equal(autoTier('draha', th.highKw, th), 'amber');
});

test('deviceStates: pri slnku go, auto a bojler aj v lacnom pásme, v slabý deň sušička a umývačka no', () => {
    const states = (/** @type {any} */ slot, weak = false) => Object.fromEntries(deviceStates(slot, weak).map((d) => [d.name, d.state]));
    assert.deepEqual(states({ tier: 'green', level: 'draha' }), { Práčka: 'go', Sušička: 'go', Umývačka: 'go', Auto: 'go', Bojler: 'go' });
    assert.deepEqual(states({ tier: 'amber', level: 'lacna' }), {
        Práčka: 'wait',
        Sušička: 'wait',
        Umývačka: 'wait',
        Auto: 'go',
        Bojler: 'go',
    });
    assert.ok(deviceStates({ tier: 'grey', level: 'bezna' }, false).every((d) => d.state === 'wait'));
    assert.deepEqual(states({ tier: 'green', level: 'lacna' }, true), {
        Práčka: 'go',
        Sušička: 'no',
        Umývačka: 'no',
        Auto: 'go',
        Bojler: 'go',
    });
    assert.equal(deviceStates({ tier: 'green', level: 'lacna' }, false).find((d) => d.name === 'Auto')?.powerKw, 11);
});

test('autoLevels: najlacnejšie lacné, najdrahšie drahé, ostatné bežné; bez cien null', () => {
    assert.deepEqual(autoLevels(troj().bands), { p3: 'lacna', p2: 'bezna', p1: 'draha' });
    assert.equal(autoLevels(TARIFF.bands), null);
    const same = troj().bands.map((b) => ({ ...b, price: 0.2 }));
    assert.deepEqual(autoLevels(same), { p3: 'bezna', p2: 'bezna', p1: 'bezna' });
    assert.deepEqual(autoLevels([{ id: 'j', name: 'Cena', level: 'bezna', price: 0.16 }]), { j: 'bezna' });
});

test('checkTariff: referenčné tarify sú v poriadku', () => {
    assert.deepEqual(checkTariff(TARIFF), { errors: [], warnings: [] });
    assert.deepEqual(checkTariff(DEMO_TARIFF), { errors: [], warnings: [] });
    assert.deepEqual(checkTariff(troj()), { errors: [], warnings: [] });
});

test('checkTariff: chyby rozvrhu a pásiem', () => {
    const t = troj();
    /** @param {(t: Tariff) => void} fn */
    const broken = (fn) => {
        const x = troj();
        fn(x);
        return checkTariff(x).errors;
    };
    assert.ok(broken((x) => (x.schedules[0].changes[0].from = '00:30')).some((e) => /00:00/.test(e)));
    assert.ok(broken((x) => (x.schedules[0].changes[1].from = '08:10')).some((e) => /štvrťhodinu/.test(e)));
    assert.ok(broken((x) => x.schedules[0].changes.reverse()).length > 0);
    assert.ok(broken((x) => (x.schedules[0].changes[1].band = 'xx')).some((e) => /neexistuje/.test(e)));
    assert.ok(broken((x) => (x.schedules[0].days = [1, 2, 3, 4, 5])).some((e) => /všetky dni/.test(e)));
    assert.ok(broken((x) => (x.schedules[1].days = [])).some((e) => /aspoň jeden deň/.test(e)));
    assert.ok(broken((x) => (x.bands[0].name = '  ')).some((e) => /meno/.test(e)));
    assert.ok(broken((x) => (x.bands[1].id = 'p3')).some((e) => /kľúč/.test(e)));
    assert.ok(broken((x) => (x.bands[0].price = -1)).some((e) => /cena/.test(e)));
    assert.ok(broken((x) => (x.bands[0].level = /** @type {any} */ ('lacne'))).length > 0);
    assert.ok(broken((x) => (x.currency = '')).some((e) => /Mena/.test(e)));
    const many = Array.from({ length: TARIFF_LIMITS.maxChanges + 1 }, (_, i) => ({
        from: `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`,
        band: i % 2 ? 'p1' : 'p3',
    }));
    assert.ok(broken((x) => (x.schedules[0].changes = many)).some((e) => /zmien/.test(e)));
    assert.ok(broken((x) => x.bands.push(...t.bands.map((b, i) => ({ ...b, id: `x${i}` })))).some((e) => /Pásiem/.test(e)));
});

test('checkTariff: varovania - nepoužité pásmo a úroveň proti cene', () => {
    const x = troj();
    x.bands[1].price = 0.3;
    assert.deepEqual(checkTariff(x).warnings, ['Úrovne pásiem nesedia s ich cenami.']);
    const y = troj();
    y.bands.push({ id: 'p0', name: 'Navyše', level: 'lacna', price: null });
    assert.deepEqual(checkTariff(y).warnings, ['Pásmo Navyše v rozvrhu nie je.']);
});

test('parseStoredTariff: platná tarifa prejde, zmeny s rovnakým pásmom sa zlúčia, čokoľvek iné je null', () => {
    const stored = JSON.parse(JSON.stringify(troj()));
    assert.deepEqual(parseStoredTariff(stored), troj());
    stored.schedules[0].changes.splice(1, 0, { from: '04:00', band: 'p3' });
    assert.deepEqual(parseStoredTariff(stored), troj(), 'dvakrát p3 za sebou je jedna zmena');
    assert.equal(parseStoredTariff(null), null);
    assert.equal(parseStoredTariff({ bands: [], schedules: [] }), null);
    assert.equal(parseStoredTariff({ ...troj(), bands: 'nie' }), null);
    const noPrice = JSON.parse(JSON.stringify(TARIFF));
    delete noPrice.bands[0].price;
    assert.equal(parseStoredTariff(noPrice)?.bands[0].price, null, 'chýbajúca cena je „nezadaná“');
});

test('slotsOf a changesOf: rozvrh po štvrťhodinách a späť', () => {
    const base = TARIFF.schedules[0];
    const slots = slotsOf(base);
    assert.equal(slots.length, 96);
    assert.equal(slots[m(7, 30) / 15], 'vt');
    assert.equal(slots[m(8, 30) / 15], 'nt');
    assert.deepEqual(changesOf(slots), base.changes);
});

test('paintSlots: kratšou cestou po kruhu, aj cez polnoc', () => {
    const all = Array(96).fill('a');
    const over = paintSlots(all, 94, 1, 'b');
    assert.deepEqual(
        over.map((x, i) => (x === 'b' ? i : null)).filter((x) => x !== null),
        [0, 1, 94, 95],
    );
    const back = paintSlots(all, 10, 8, 'b');
    assert.deepEqual(
        back.map((x, i) => (x === 'b' ? i : null)).filter((x) => x !== null),
        [8, 9, 10],
    );
    assert.equal(all[0], 'a', 'vstup sa nemení');
});

test('scheduleRuns: úsek cez polnoc je jeden, zoradené od polnoci', () => {
    const runs = scheduleRuns(TARIFF, TARIFF.schedules[0]);
    assert.equal(runs.length, 8);
    const night = runs[runs.length - 1];
    assert.equal(night.startMin, m(23, 30));
    assert.equal(night.min, 480, '23:30 až 07:30');
    assert.equal(runs[0].startMin, m(7, 30));
    assert.deepEqual(
        scheduleTiers(TARIFF, TARIFF.schedules[0]).map((x) => x.tier),
        ['amber', 'red', 'amber', 'red', 'amber', 'red', 'amber', 'red', 'amber'],
    );
});

test('typ sadzby, nové pásmo, výnimky a súhrn tarify', () => {
    assert.equal(tariffKind(TARIFF_TEMPLATES.jedna), 'jedna');
    assert.equal(tariffKind(TARIFF), 'dvoj');
    assert.equal(tariffKind(troj()), 'viac');
    assert.equal(newBandId(TARIFF), 'b1');
    assert.equal(newBandId({ ...TARIFF, bands: [...TARIFF.bands, { id: 'b1', name: 'X', level: 'bezna', price: null }] }), 'b2');
    const t = troj();
    assert.ok(isWeekendSchedule(t.schedules[1]) && !isSeasonSchedule(t.schedules[1]));
    assert.ok(isSeasonSchedule(t.schedules[2]) && !isWeekendSchedule(t.schedules[2]));
    assert.equal(tariffHint(TARIFF), '2 pásma · lacno 20 h');
    assert.equal(tariffHint(DEMO_TARIFF), '2 pásma · lacno 7 h');
    assert.equal(tariffHint(TARIFF_TEMPLATES.jedna), 'Jedna cena celý deň');
    assert.equal(tariffHint(t), '3 pásma · lacno 8 h · víkend inak · časť roka inak');
    assert.equal(tariffPricesText(TARIFF), null);
    assert.equal(tariffPricesText(t), 'Mimo špičky 0,11 · Bežné 0,17 · Špička 0,25 €/kWh');
    for (const tpl of Object.values(TARIFF_TEMPLATES)) assert.deepEqual(checkTariff(tpl), { errors: [], warnings: [] });
});
