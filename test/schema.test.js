import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStoredWeather, validateForecast, validatePv } from '../shared/schema.js';
import { fixtureData } from './helpers.js';

const { pv, forecast } = fixtureData();

test('výstup parsera a predpovede spĺňa kontrakt', () => {
    assert.deepEqual(validatePv(pv), []);
    assert.deepEqual(validateForecast(forecast), []);
});

test('validátor odhalí chýbajúce a zle typované polia', () => {
    assert.ok(validatePv(null).length);
    assert.ok(validatePv({ ...pv, realTimePowerKw: 'x' }).some((e) => e.includes('realTimePowerKw')));
    assert.ok(validatePv({ ...pv, realCurveToday: [{ hour: 'a' }] }).some((e) => e.includes('realCurveToday[0]')));
    assert.ok(validatePv({ ...pv, updatedAt: 'nie dátum' }).some((e) => e.includes('updatedAt')));
    assert.ok(validateForecast({ ...forecast, days: 'x' }).some((e) => e.includes('days')));
    assert.ok(validateForecast({ ...forecast, days: [{ ...forecast.days[0], date: '5.9.' }] }).some((e) => e.includes('date')));
    assert.ok(validateForecast({ ...forecast, tomorrowSunny: 'yes' }).some((e) => e.includes('tomorrowSunny')));
});

test('parseStoredWeather: odložené počasie s adresou, časom a dátami, inak null', () => {
    const ok = { url: 'https://api.open-meteo.com/v1/forecast?x', at: 1, json: { hourly: {} } };
    assert.deepEqual(parseStoredWeather(ok), ok);
    for (const bad of [null, 'x', { ...ok, url: 1 }, { ...ok, at: 'x' }, { ...ok, at: NaN }, { ...ok, json: null }, { ...ok, json: 'x' }]) {
        assert.equal(parseStoredWeather(bad), null, JSON.stringify(bad));
    }
});
