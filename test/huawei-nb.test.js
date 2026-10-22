// Huawei Northbound API: prevod odpovedí podľa príkladov z oficiálnej referencie SmartPVMS Plant
// V600R024C10 Northbound Interface Reference-V6.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    checkNbLogin,
    NB,
    nbPv,
    nbServer,
    parseNbDevices,
    parseNbDevReal,
    parseNbStationReal,
    parseNbStations,
} from '../shared/huawei-nb.js';
import { validatePv } from '../shared/schema.js';
import { udajeNote } from '../shared/setup-texts.js';
import { VyrobcaChyba } from '../shared/vyrobca.js';
import { udajeOk } from '../shared/zdroje.js';

const NOW = new Date('2026-09-05T11:00:00Z');

test('nbServer: len servery FusionSolar cez https, aj zadané bez https://', () => {
    assert.equal(nbServer('eu5.fusionsolar.huawei.com'), 'eu5.fusionsolar.huawei.com');
    assert.equal(nbServer(' https://EU5.fusionsolar.huawei.com/thirdData/login '), 'eu5.fusionsolar.huawei.com');
    assert.equal(nbServer('fusionsolar.huawei.com'), 'fusionsolar.huawei.com');
    for (const bad of [
        'example.com',
        'eu5.fusionsolar.huawei.com.example.com',
        'http://eu5.fusionsolar.huawei.com',
        'eu5.fusionsolar.huawei.com:8080',
        '',
        42,
        'x'.repeat(300),
    ])
        assert.equal(nbServer(bad), null, String(bad));
    assert.equal(udajeOk('huawei-northbound', { meno: 'a', heslo: 'b', server: 'eu5.fusionsolar.huawei.com' }), true);
    assert.equal(udajeOk('huawei-northbound', { meno: 'a', heslo: 'b', server: 'example.com' }), false);
    assert.equal(udajeNote('huawei-northbound', { server: 'example.com' })?.err, true);
    assert.equal(udajeNote('huawei-northbound', { server: 'eu5.fusionsolar.huawei.com' }), null);
});

test('prihlásenie: úspech prejde, zlé údaje hádžu s kódom', () => {
    checkNbLogin({ success: true, data: null, failCode: 0, params: null, message: null });
    assert.throws(
        () => checkNbLogin({ data: null, failCode: 20400, message: '', params: { currentTime: 1593777870514 }, success: false }),
        (e) => e instanceof VyrobcaChyba && e.kod === '20400' && e.zamietol,
    );
    assert.throws(() => checkNbLogin('nie json'), VyrobcaChyba);
});

test('zoznam elektrární a meničov podľa príkladov z referencie', () => {
    const stations = {
        success: true,
        data: {
            list: [
                { plantCode: 'NE=12345678', plantName: 'NMplant1', capacity: 146.5 },
                { plantCode: 'NE=23456789', plantName: 'plant2', capacity: 123.3 },
                { plantName: 'bez id' },
            ],
            pageCount: 1,
            pageNo: 1,
            pageSize: 100,
            total: 2,
        },
        failCode: 0,
        message: 'get plant list success',
    };
    assert.deepEqual(parseNbStations(stations), [
        { plant: 'NE=12345678', nazov: 'NMplant1' },
        { plant: 'NE=23456789', nazov: 'plant2' },
    ]);
    const devices = {
        success: true,
        data: [
            { id: -214543629611879, devName: '5fbfk4', stationCode: 'NE=12345678', devTypeId: 1, invType: 'SUN2000-17KTL' },
            { id: -214091680973855, devName: '6fbfk11', stationCode: 'NE=12345678', devTypeId: 1 },
            { id: 5, devName: 'meter', stationCode: 'NE=12345678', devTypeId: 17 },
            { id: 7, devName: 'dom', stationCode: 'NE=23456789', devTypeId: 38 },
        ],
        failCode: 0,
    };
    assert.deepEqual(parseNbDevices(devices), {
        'NE=12345678': { 1: [-214543629611879, -214091680973855] },
        'NE=23456789': { 38: [7] },
    });
    assert.throws(
        () => parseNbDevices({ success: false, data: null, failCode: 20009 }),
        (e) => e instanceof VyrobcaChyba && e.kod === '20009' && !e.zamietol,
    );
});

test('meranie: výkon meničov elektrárne, súčty z elektrárne, inak z meničov', () => {
    const dev = (/** @type {number} */ devId, /** @type {Record<string, number>} */ m) => ({ devId, dataItemMap: m });
    const devReal = {
        success: true,
        failCode: 0,
        data: [
            dev(1, { active_power: 3.2, day_cap: 10, total_cap: 900 }),
            dev(2, { active_power: 1.1, day_cap: 4, total_cap: 100 }),
            dev(9, { active_power: 99 }),
        ],
    };
    const sum = parseNbDevReal([devReal], [1, 2]);
    assert.deepEqual(sum, { kw: 4.300000000000001, day: 14, total: 1000 });
    assert.deepEqual(parseNbDevReal([devReal], [42]), { kw: null, day: null, total: null });
    const stationReal = {
        success: true,
        failCode: 0,
        data: [
            { stationCode: 'NE=1', dataItemMap: { day_power: 18.2, month_power: 410.5, total_power: 9876.4, real_health_state: 3 } },
            { stationCode: 'NE=2', dataItemMap: { day_power: 1 } },
        ],
    };
    const station = parseNbStationReal(stationReal, 'NE=1');
    assert.deepEqual(station, { day: 18.2, month: 410.5, total: 9876.4 });
    const pv = nbPv(sum, station, 'Dvorany', NOW);
    assert.deepEqual(validatePv(pv), []);
    assert.deepEqual(
        [pv.realTimePowerKw, pv.dailyEnergyKwh, pv.monthEnergyKwh, pv.cumulativeEnergyKwh, pv.stationName],
        [sum.kw, 18.2, 410.5, 9876.4, 'Dvorany'],
    );
    // Elektráreň bez súčtov: z meničov.
    const bez = nbPv(sum, parseNbStationReal(stationReal, 'NE=3'), '', NOW);
    assert.deepEqual([bez.dailyEnergyKwh, bez.monthEnergyKwh, bez.cumulativeEnergyKwh, bez.stationName], [14, null, 1000, null]);
    assert.throws(
        () => parseNbDevReal([{ success: false, failCode: 407 }], [1]),
        (e) => e instanceof VyrobcaChyba && e.kod === String(NB.tooFrequent) && !e.zamietol,
    );
});
