// Nameraná krivka dňa z historických dát výrobcov: spoločné jadro (shared/krivka.js) a prevod
// odpovedí Fox ESS, SolisCloud, DeyeCloud a Victron VRM podľa ich dokumentácie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDeyeFrames } from '../shared/deye.js';
import { foxCas, parseFoxHistory } from '../shared/foxess.js';
import { KRIVKA, krivkaDnes, krivkaZBodov, polnoc } from '../shared/krivka.js';
import { parseSolisDay } from '../shared/solis.js';
import { parseVictronYield } from '../shared/victron.js';
import { VyrobcaChyba } from '../shared/vyrobca.js';

const TZ = 'Europe/Bratislava';
// 5. 9. 2026 13:00 SELČ.
const NOW = new Date('2026-09-05T11:00:00Z');
/** Čas v ms z miestneho času 5. 9. (SELČ = UTC+2). @param {number} h @param {number} [m] */
const o = (h, m = 0) => Date.UTC(2026, 8, 5, h - 2, m);

test('krivka: body v tom istom čase sa sčítajú, len dnes a s výkonom, za nimi aktuálny bod', () => {
    const krivka = krivkaZBodov(
        [
            { t: o(8, 5), kw: 2 },
            { t: o(8), kw: 1 },
            { t: o(8), kw: 0.5 },
            { t: o(9), kw: null },
            { t: Date.UTC(2026, 8, 4, 20), kw: 3 },
            { t: NaN, kw: 1 },
        ],
        NOW,
        TZ,
    );
    assert.deepEqual(krivka, {
        den: '2026-09-05',
        body: [
            [480, 1.5],
            [485, 2],
        ],
    });
    assert.deepEqual(krivkaDnes(krivka, 4.2, NOW, TZ), [
        { hour: 8, kw: 1.5 },
        { hour: 8.0833, kw: 2 },
        { hour: 13, kw: 4.2 },
    ]);
    // Bez aktuálneho výkonu len krivka; krivka z iného dňa ani prázdna - nič.
    assert.deepEqual(krivkaDnes(krivka, null, NOW, TZ).length, 2);
    assert.deepEqual(krivkaDnes(krivka, 4.2, new Date('2026-09-05T22:30:00Z'), TZ), []);
    assert.deepEqual(krivkaDnes(null, 4.2, NOW, TZ), []);
    assert.deepEqual(krivkaDnes({ den: '2026-09-05', body: [] }, 4.2, NOW, TZ), []);
    assert.equal(polnoc(new Date('2026-09-05T11:00:12.345Z'), TZ), Date.UTC(2026, 8, 4, 22));
    assert.equal(KRIVKA.ms, 15 * 60 * 1000);
});

test('Fox ESS: čas bodu s posunom aj bez neho (UTC), pvPower v kW či W', () => {
    assert.equal(foxCas('2026-09-05 08:00:00 CET+0100'), o(9));
    assert.equal(foxCas('2026-09-05 06:00:00'), o(8));
    assert.equal(foxCas('2026-09-05T06:00:00-01:30'), o(9, 30));
    assert.ok(Number.isNaN(foxCas('včera')));
    const json = (/** @type {string} */ unit) => ({
        errno: 0,
        result: [
            {
                deviceSN: 'SN1',
                datas: [
                    { variable: 'pv1Current', unit: 'A', data: [{ time: '2026-09-05 06:00:00', value: 9 }] },
                    {
                        variable: 'pvPower',
                        unit,
                        data: [
                            { time: '2026-09-05 06:00:00', value: unit === 'W' ? 1500 : 1.5 },
                            { time: '2026-09-05 06:05:00', value: null },
                        ],
                    },
                ],
            },
        ],
    });
    assert.deepEqual(parseFoxHistory(json('kW'), NOW, TZ).body, [[480, 1.5]]);
    assert.deepEqual(parseFoxHistory(json('W'), NOW, TZ).body, [[480, 1.5]]);
    assert.deepEqual(parseFoxHistory({ errno: 0, result: [] }, NOW, TZ).body, []);
    assert.throws(() => parseFoxHistory({ errno: 40400 }, NOW, TZ), VyrobcaChyba);
});

test('SolisCloud: stationDay - výkon v jednotke powerStr, čas v ms', () => {
    const json = {
        success: true,
        code: '0',
        data: [
            { time: o(7, 25), timeStr: '07:25:00', power: 770, powerStr: 'W' },
            { time: o(7, 30), timeStr: '07:30:00', power: 0.9, powerStr: 'kW' },
            { time: o(7, 35), power: 1, powerStr: '?' },
        ],
    };
    assert.deepEqual(parseSolisDay(json, NOW, TZ).body, [
        [445, 0.77],
        [450, 0.9],
    ]);
    assert.throws(() => parseSolisDay({ code: 'I0012' }, NOW, TZ), VyrobcaChyba);
});

test('DeyeCloud: body dňa (granularity 1) - čas v sekundách aj ms, výkon vo W či kW podľa kWp', () => {
    const json = {
        code: '1000000',
        success: true,
        stationDataItems: [
            { generationPower: 3200, timeStamp: o(10) / 1000 },
            { generationPower: 3.4, timeStamp: o(10, 5) },
        ],
    };
    assert.deepEqual(parseDeyeFrames(json, 10, NOW, TZ).body, [
        [600, 3.2],
        [605, 3.4],
    ]);
    // Bez inštalovaného výkonu sa jednotka určiť nedá - krivka je prázdna.
    assert.deepEqual(parseDeyeFrames(json, null, NOW, TZ).body, []);
    assert.throws(() => parseDeyeFrames({ success: false, code: '2101019' }, 10, NOW, TZ), VyrobcaChyba);
});

test('Victron VRM: solar_yield po 15 minútach - súčet kódov v čase, štvornásobok kWh je kW', () => {
    const json = {
        success: true,
        records: {
            Pb: [
                [o(11), 0.25],
                [o(11, 15), 0.5],
            ],
            Pc: [[o(11) / 1000, 0.5, 0.4, 0.6]],
            Pg: false,
        },
        totals: { Pb: 0.75, Pc: 0.5 },
    };
    assert.deepEqual(parseVictronYield(json, NOW, TZ).body, [
        [660, 3],
        [675, 2],
    ]);
    assert.throws(() => parseVictronYield({ success: false }, NOW, TZ));
});
