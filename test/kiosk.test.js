import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities, extractRealCurveToday, kioskApiUrl, parseKiosk } from '../shared/kiosk.js';
import { FIXED_NOW, fixture } from './helpers.js';

test('decodeEntities dekóduje HTML entity', () => {
    assert.equal(decodeEntities('&quot;a&quot; &amp; &lt;b&gt; &#39;c&#39;'), '"a" & <b> \'c\'');
    // Text "&lt;" v názve elektrárne je zakódovaný ako "&amp;lt;" - dekóduje sa raz, nie dvakrát.
    assert.equal(decodeEntities('R&amp;lt;D'), 'R&lt;D');
});

test('extractRealCurveToday preskočí prázdne, neplatné a "-" hodnoty', () => {
    const curve = extractRealCurveToday({ xAxis: ['06:00', '06:05', '06:10', '06:15', 'xx'], activePower: ['0.5', '-', null, 'abc', '1'] });
    assert.deepEqual(curve, [{ hour: 6, kw: 0.5 }]);
    assert.deepEqual(extractRealCurveToday(null), []);
    assert.deepEqual(extractRealCurveToday({ xAxis: 'nie pole' }), []);
});

test('parseKiosk vráti formát pv zo vzorky kiosku', () => {
    const pv = parseKiosk(fixture('kiosk.json'), FIXED_NOW);
    assert.equal(pv.realTimePowerKw, 6.412);
    assert.equal(pv.dailyEnergyKwh, 31.7);
    assert.equal(pv.stationName, 'Račkofci Energy s.r.o.');
    assert.equal(pv.updatedAt, FIXED_NOW.toISOString());
    assert.ok(pv.realCurveToday.length > 100);
    assert.ok(
        pv.realCurveToday.every((p) => p.hour <= 13),
        'po 13:00 sú v kiosku len "-"',
    );
});

test('parseKiosk: chýbajúce polia dajú null, bez data hodí chybu', () => {
    const encoded = JSON.stringify({ realKpi: { realTimePower: 'x' } }).replace(/"/g, '&quot;');
    const pv = parseKiosk({ data: encoded }, FIXED_NOW);
    assert.equal(pv.realTimePowerKw, null);
    assert.equal(pv.stationName, null);
    assert.deepEqual(pv.realCurveToday, []);
    assert.throws(() => parseKiosk({}, FIXED_NOW));
});

test('kioskApiUrl: odkaz na stránku aj na dáta vedie na tú istú adresu dát', () => {
    const api = 'https://region01eu5.fusionsolar.huawei.com/rest/pvms/web/kiosk/v1/station-kiosk-file?kk=Abc123_-xyz';
    assert.equal(
        kioskApiUrl('https://region01eu5.fusionsolar.huawei.com/pvmswebsite/nologin/assets/build/index.html#/kiosk?kk=Abc123_-xyz'),
        api,
    );
    assert.equal(kioskApiUrl(`  ${api}  `), api);
    assert.equal(kioskApiUrl('https://REGION01EU5.FusionSolar.Huawei.com/x?a=1&kk=Abc123_-xyz&b=2'), api);
    assert.equal(
        kioskApiUrl('https://fusionsolar.huawei.com/?kk=abcd'),
        'https://fusionsolar.huawei.com/rest/pvms/web/kiosk/v1/station-kiosk-file?kk=abcd',
    );
});

test('kioskApiUrl: iné servery, protokoly a kľúče neprejdú', () => {
    for (const bad of [
        '',
        'nie odkaz',
        42,
        null,
        'http://region01eu5.fusionsolar.huawei.com/?kk=abcd1234',
        'https://fusionsolar.huawei.com.zly.sk/?kk=abcd1234',
        'https://zlyfusionsolar.huawei.com/?kk=abcd1234',
        'https://example.com/?kk=abcd1234',
        'https://region01eu5.fusionsolar.huawei.com:8443/?kk=abcd1234',
        'https://region01eu5.fusionsolar.huawei.com/?kk=ab',
        'https://region01eu5.fusionsolar.huawei.com/?kk=abc%2F..%2Fx',
        'https://region01eu5.fusionsolar.huawei.com/?kiosk=abcd1234',
    ])
        assert.equal(kioskApiUrl(bad), null, String(bad));
});
