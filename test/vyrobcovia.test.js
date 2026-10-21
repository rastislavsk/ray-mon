// Prevod odpovedí výrobcov meničov na formát `pv`. Odpovede sú zložené podľa štruktúry v ich
// oficiálnej dokumentácii (Fox ESS Open API, SolaX Cloud User API V6.1, Victron VRM API v2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FOXESS, foxHeaders, FoxChyba, parseFoxList, parseFoxPv } from '../shared/foxess.js';
import { md5 } from '../shared/md5.js';
import { validatePv } from '../shared/schema.js';
import { parseSolax, solaxUrl } from '../shared/solax.js';
import { parseVictronMe, parseVictronPv, parseVictronSites, VICTRON, victronHeaders } from '../shared/victron.js';
import { pvDue, SPOSOBY, udajeOk } from '../shared/zdroje.js';

const NOW = new Date('2026-09-05T11:00:00Z');

test('md5: vzorky z RFC 1321 a text s diakritikou', () => {
    const rfc = {
        '': 'd41d8cd98f00b204e9800998ecf8427e',
        a: '0cc175b9c0f1b6a831c399e269772661',
        abc: '900150983cd24fb0d6963f7d28e17f72',
        'message digest': 'f96b697d7cb7938d525a2f31aaf161d0',
        abcdefghijklmnopqrstuvwxyz: 'c3fcd3d76192e4007dfb496cca67e13b',
        '12345678901234567890123456789012345678901234567890123456789012345678901234567890': '57edf4a22be3c955ac49da2e2107b67a',
    };
    for (const [text, hash] of Object.entries(rfc)) assert.equal(md5(text), hash, text);
    assert.equal(md5('žltý kôň'), '20efb62e757498a1a4fd61a3fb18db89', 'to isté ako node:crypto');
});

test('Fox ESS: podpis z cesty, kľúča a času oddelených doslova znakmi \\r\\n', () => {
    const h = foxHeaders(FOXESS.real, 'kluc', 1700000000000);
    assert.equal(h.signature, md5(`${FOXESS.real}\\r\\nkluc\\r\\n1700000000000`));
    assert.equal(h.timestamp, '1700000000000');
    assert.equal(h.token, 'kluc');
    assert.equal(h.lang, 'en');
});

test('Fox ESS: zoznam meničov a meranie z real/query a generation', () => {
    const list = {
        errno: 0,
        result: {
            currentPage: 1,
            pageSize: 10,
            total: 2,
            data: [
                { deviceSN: '60BH1234', stationName: 'Dvorany', stationID: 's1', hasPV: true },
                { deviceSN: '', stationName: 'Bez čísla' },
            ],
        },
    };
    assert.deepEqual(parseFoxList(list), [{ sn: '60BH1234', nazov: 'Dvorany' }]);
    assert.throws(
        () => parseFoxList({ errno: 41809, msg: 'token invalid' }),
        (e) => e instanceof FoxChyba && e.errno === 41809,
    );
    assert.throws(() => parseFoxList(null), FoxChyba);
    const real = {
        errno: 0,
        result: [
            {
                deviceSN: '60BH1234',
                datas: [{ variable: 'pvPower', unit: 'kW', name: 'PVPower', value: 3.42, time: '2026-09-05 13:00:00 CEST+0200' }],
            },
        ],
    };
    const gen = { errno: 0, result: { today: 18.2, month: 410.5, cumulative: 9876.4 } };
    const pv = parseFoxPv(real, gen, 'Dvorany', NOW);
    assert.deepEqual(validatePv(pv), []);
    assert.deepEqual(
        [pv.realTimePowerKw, pv.dailyEnergyKwh, pv.monthEnergyKwh, pv.yearEnergyKwh, pv.cumulativeEnergyKwh, pv.stationName],
        [3.42, 18.2, 410.5, null, 9876.4, 'Dvorany'],
    );
    assert.equal(pv.updatedAt, NOW.toISOString());
    // Premenná, ktorú menič neposlal, je null - nie nula.
    const bezVykonu = parseFoxPv({ errno: 0, result: [{ deviceSN: '60BH1234', datas: [] }] }, { errno: 0, result: {} }, '', NOW);
    assert.deepEqual([bezVykonu.realTimePowerKw, bezVykonu.dailyEnergyKwh, bezVykonu.stationName], [null, null, null]);
    assert.throws(
        () => parseFoxPv({ errno: FOXESS.tooFrequent }, gen, '', NOW),
        (e) => e instanceof FoxChyba && e.errno === 40400,
    );
});

test('SolaX: adresa len z tokenu a čísla modulu v správnom tvare, výkon z panelov', () => {
    assert.equal(
        solaxUrl('20200722185111234567890', 'SXABCDEFGH'),
        'https://www.solaxcloud.com/proxyApp/proxy/api/getRealtimeInfo.do?tokenId=20200722185111234567890&sn=SXABCDEFGH',
    );
    for (const [t, sn] of [
        ['kratky', 'SXABCDEFGH'],
        ['20200722185111234567890', 'SX/../x'],
        ['20200722185111234567890&x=1', 'SXABCDEFGH'],
        [undefined, 'SXABCDEFGH'],
    ])
        assert.equal(solaxUrl(t, sn), null, `${t} ${sn}`);
    const ok = {
        success: true,
        exception: 'Query success!',
        result: {
            inverterSN: 'XB422',
            sn: 'SXABCDEFGH',
            acpower: 3100,
            yieldtoday: 13.6,
            yieldtotal: 31120.6,
            powerdc1: 1800,
            powerdc2: 1500,
            powerdc3: null,
            powerdc4: null,
            uploadTime: '2026-09-05 12:58:01',
        },
    };
    const pv = parseSolax(ok, NOW);
    assert.deepEqual(validatePv(pv), []);
    assert.deepEqual([pv.realTimePowerKw, pv.dailyEnergyKwh, pv.cumulativeEnergyKwh, pv.monthEnergyKwh], [3.3, 13.6, 31120.6, null]);
    // Menič bez výkonu panelov: výkon na výstupe.
    assert.equal(parseSolax({ ...ok, result: { acpower: 2500, yieldtoday: 1 } }, NOW).realTimePowerKw, 2.5);
    assert.equal(parseSolax({ ...ok, result: {} }, NOW).realTimePowerKw, null);
    assert.throws(() => parseSolax({ success: false, exception: 'tokenId error', result: null }, NOW));
    assert.equal(udajeOk('solax-token', { token: '20200722185111234567890', sn: 'SXABCDEFGH' }), true);
    assert.equal(udajeOk('solax-token', { token: '20200722185111234567890', sn: 'S X' }), false);
});

test('Victron: používateľ, inštalácie a výkon z diagnostiky podľa ciest D-Bus', () => {
    assert.deepEqual(victronHeaders('abc'), { 'x-authorization': 'Token abc' });
    assert.equal(VICTRON.installations(22), '/users/22/installations');
    assert.equal(parseVictronMe({ success: true, user: { id: 22, name: 'R' } }), 22);
    assert.equal(parseVictronMe({ success: false, errors: 'x', error_code: null }), null);
    assert.deepEqual(parseVictronSites({ success: true, records: [{ idSite: 7, name: 'Chata' }, { name: 'bez id' }] }), [
        { idSite: 7, nazov: 'Chata' },
    ]);
    assert.deepEqual(parseVictronSites({ success: false }), []);
    const diag = {
        success: true,
        records: [
            { dbusServiceType: 'solarcharger', dbusPath: '/Yield/Power', rawValue: 1200, code: 'ScW' },
            { dbusServiceType: 'solarcharger', dbusPath: '/Yield/Power', rawValue: '800', code: 'ScW' },
            { dbusServiceType: 'pvinverter', dbusPath: '/Ac/Power', rawValue: 1500, code: 'PVP' },
            { dbusServiceType: 'solarcharger', dbusPath: '/Yield/System', rawValue: 950.5 },
            { dbusServiceType: 'pvinverter', dbusPath: '/Ac/Energy/Forward', rawValue: 49.5 },
            { dbusServiceType: 'battery', dbusPath: '/Dc/0/Power', rawValue: -300 },
            { dbusServiceType: 'solarcharger', dbusPath: '/Yield/Power', rawValue: 'nezmysel' },
        ],
    };
    const pv = parseVictronPv(diag, 'Chata', NOW);
    assert.deepEqual(validatePv(pv), []);
    assert.deepEqual([pv.realTimePowerKw, pv.cumulativeEnergyKwh, pv.dailyEnergyKwh, pv.stationName], [3.5, 1000, null, 'Chata']);
    const prazdna = parseVictronPv({ success: true, records: [] }, '', NOW);
    assert.deepEqual([prazdna.realTimePowerKw, prazdna.cumulativeEnergyKwh, prazdna.stationName], [null, null, null]);
    assert.throws(() => parseVictronPv({ success: false }, '', NOW));
});

test('pvDue: meranie sa pýta až po intervale spôsobu, bez merania hneď', () => {
    const at = (/** @type {number} */ s) => new Date(NOW.getTime() + s * 1000);
    const pv = { updatedAt: NOW.toISOString() };
    const fox = { sposob: 'foxess-kluc', pecat: 'v1.x', nazov: '' };
    assert.equal(pvDue(fox, null, NOW), true);
    assert.equal(pvDue(fox, pv, at(60)), false);
    assert.equal(pvDue(fox, pv, at(175)), true, 's rezervou, aby sa nečakalo o minútu dlhšie');
    const kiosk = { ...fox, sposob: 'huawei-kiosk' };
    assert.equal(pvDue(kiosk, pv, at(55)), true);
    assert.equal(pvDue({ ...fox, sposob: 'neznamy' }, pv, at(1)), true);
    for (const s of SPOSOBY) assert.ok(s.intervalMs >= 60 * 1000, s.id);
});

test('Solis: Content-MD5 podľa príkladu z dokumentácie, dátum a text na podpis', async () => {
    const { md5Base64, solisDate, solisRequest, SOLIS } = await import('../shared/solis.js');
    // Príklad z kapitoly 2.4 dokumentácie SolisCloud API V2.0.
    assert.equal(md5Base64('{"pageNo":1,"pageSize":10}'), 'kxdxk7rbAsrzSIWgEwhH4w==');
    assert.equal(solisDate(new Date('2019-07-26T06:00:46Z')), 'Fri, 26 Jul 2019 06:00:46 GMT');
    assert.equal(solisDate(new Date('2026-09-05T11:00:00Z')), 'Sat, 5 Sep 2026 11:00:00 GMT', 'deň bez nuly (EEE, d MMM)');
    const req = solisRequest(SOLIS.stations, '{"pageNo":1,"pageSize":10}', new Date('2019-07-26T06:00:46Z'));
    assert.equal(req.toSign, 'POST\nkxdxk7rbAsrzSIWgEwhH4w==\napplication/json\nFri, 26 Jul 2019 06:00:46 GMT\n/v1/api/userStationList');
    assert.deepEqual(req.headers, {
        'content-md5': 'kxdxk7rbAsrzSIWgEwhH4w==',
        'content-type': 'application/json',
        date: 'Fri, 26 Jul 2019 06:00:46 GMT',
    });
});

test('Solis: elektrárne s meraním prevedeným na kW a kWh, chyba s kódom', async () => {
    const { parseSolisStations, SolisChyba } = await import('../shared/solis.js');
    const json = {
        code: '0',
        msg: 'success',
        data: {
            page: {
                records: [
                    {
                        id: 1308675217944611083,
                        stationName: 'Dvorany',
                        power: 5.772,
                        powerStr: 'kW',
                        dayEnergy: 31.3,
                        dayEnergyStr: 'kWh',
                        monthEnergy: 839,
                        monthEnergyStr: 'kWh',
                        yearEnergy: 5.603,
                        yearEnergyStr: 'MWh',
                        allEnergy: 36.393,
                        allEnergyStr: 'MWh',
                    },
                    {
                        id: 7,
                        stationName: 'Chata',
                        power: 800,
                        powerStr: 'W',
                        dayEnergy: 2,
                        dayEnergyStr: 'kWh',
                        allEnergy: 1,
                        allEnergyStr: 'GWh',
                    },
                    { stationName: 'bez id' },
                ],
            },
        },
    };
    const [a, b] = parseSolisStations(json, NOW);
    assert.equal(a.id, String(1308675217944611083));
    assert.deepEqual(validatePv(a.pv), []);
    assert.deepEqual(
        [a.pv.realTimePowerKw, a.pv.dailyEnergyKwh, a.pv.monthEnergyKwh, a.pv.yearEnergyKwh, a.pv.cumulativeEnergyKwh],
        [5.772, 31.3, 839, 5603, 36393],
    );
    assert.deepEqual([b.pv.realTimePowerKw, b.pv.monthEnergyKwh, b.pv.cumulativeEnergyKwh], [0.8, null, 1e6]);
    assert.equal(parseSolisStations(json, NOW).length, 2);
    assert.throws(
        () => parseSolisStations({ code: 'I0012', msg: 'Incorrect account or password' }, NOW),
        (e) => e instanceof SolisChyba && e.code === 'I0012',
    );
    assert.throws(() => parseSolisStations(null, NOW), SolisChyba);
});

test('Deye: token, elektrárne, výkon vo W či kW podľa inštalovaného výkonu, dnešok v pásme elektrárne', async () => {
    const D = await import('../shared/deye.js');
    assert.equal(D.parseDeyeToken({ code: '1000000', msg: 'success', success: true, accessToken: 'eyJ', expiresIn: '5183999' }), 'eyJ');
    assert.throws(
        () => D.parseDeyeToken({ code: '2101006', msg: 'wrong', success: false }),
        (e) => e instanceof D.DeyeChyba && e.code === '2101006',
    );
    assert.throws(() => D.parseDeyeToken({ success: true }), D.DeyeChyba);
    const stations = {
        code: '1000000',
        success: true,
        stationList: [
            { id: 10, name: 'Deye Staion38', regionTimezone: 'Europe/Helsinki', installedCapacity: 50.0, generationPower: 0.0 },
            { id: 'x', name: 'zlé id' },
        ],
    };
    assert.deepEqual(D.parseDeyeStations(stations), [{ id: 10, nazov: 'Deye Staion38', kwp: 50, tz: 'Europe/Helsinki', power: 0 }]);
    assert.equal(D.parseDeyeLatest({ success: true, code: '1000000', generationPower: 3400 }), 3400);
    assert.equal(D.parseDeyeDay({ success: true, stationDataItems: [{ generationValue: 182.6 }] }), 182.6);
    assert.equal(D.parseDeyeDay({ success: true, stationDataItems: [] }), null);
    // Jednotka výkonu: viac než dvojnásobok kWp sú watty.
    assert.equal(D.deyeKw(3400, 10), 3.4);
    assert.equal(D.deyeKw(3.4, 10), 3.4);
    assert.equal(D.deyeKw(0, 10), 0);
    assert.equal(D.deyeKw(3400, null), null);
    assert.equal(D.deyeKw(null, 10), null);
    assert.deepEqual(D.deyeToday(new Date('2026-09-05T22:30:00Z'), 'Europe/Bratislava'), { startAt: '2026-09-06', endAt: '2026-09-07' });
    assert.deepEqual(D.deyeToday(new Date('2026-09-05T22:30:00Z'), 'UTC'), { startAt: '2026-09-05', endAt: '2026-09-06' });
    const pv = D.deyePv(3.4, 18.2, 'Chata', NOW);
    assert.deepEqual(validatePv(pv), []);
    assert.deepEqual([pv.realTimePowerKw, pv.dailyEnergyKwh, pv.cumulativeEnergyKwh, pv.stationName], [3.4, 18.2, null, 'Chata']);
});
