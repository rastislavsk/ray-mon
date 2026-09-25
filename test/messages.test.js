import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_PLANT, PLANT, powerThresholds } from '../shared/config.js';
import { dayDetailMessage, forecastDayMessage, getSlotMessage, SLOT_MESSAGES, weekMessage } from '../shared/messages.js';

const th = powerThresholds(PLANT);

test('getSlotMessage: každá kombinácia tarify × výroby má neprázdny nadpis aj text', () => {
    for (const tier of /** @type {const} */ (['red', 'amber', 'green'])) {
        for (const kw of [0.5, 3, 6]) {
            const msg = getSlotMessage(tier, kw, null, th);
            assert.ok(msg && msg.headline && msg.body, `${tier} ${kw}`);
        }
    }
    assert.equal(getSlotMessage('red', NaN, null, th), null);
    assert.equal(getSlotMessage(null, 3, null, th), null);
});

test('getSlotMessage: override pri silnejšom slnku, green podľa zajtrajška', () => {
    const forecast = { strongerWindowAhead: true, windowDaypart: 'poobede', tomorrowSunny: true };
    assert.equal(getSlotMessage('red', 0.5, forecast, th)?.headline, SLOT_MESSAGES.red.niz.override.h);
    assert.match(getSlotMessage('amber', 3, forecast, th)?.body || '', /poobede/);
    assert.equal(getSlotMessage('red', 6, forecast, th)?.headline, SLOT_MESSAGES.red.vys.h, 'vysoká výroba nemá override');
    assert.match(getSlotMessage('green', 0.5, forecast, th)?.body || '', /Zajtra bude slnečno/);
    assert.match(getSlotMessage('green', 0.5, { tomorrowSunny: false }, th)?.body || '', /slnečno nebude/);
});

test('forecastDayMessage: slabý deň, dnes a zajtra', () => {
    const weak = [{ hour: 12, kw: 0.8 }];
    assert.equal(forecastDayMessage(weak, true, th).title, 'Dnes bude slabo');
    assert.equal(forecastDayMessage(weak, false, th).title, 'Zajtra bude slabšie');
    const pts = [
        { hour: 8, kw: 1 },
        { hour: 11, kw: 4 },
        { hour: 13, kw: 6 },
        { hour: 15, kw: 4.5 },
        { hour: 18, kw: 1 },
    ];
    const today = forecastDayMessage(pts, true, th);
    assert.equal(today.title, 'Najsilnejšie slnko okolo 13:00');
    assert.match(today.body, /medzi 11:00 a 16:00/);
    assert.match(forecastDayMessage(pts, false, th).body, /~6\.0 kW/);
    assert.equal(forecastDayMessage([], true, th).title, 'Dnes bude slabo');
});

/** Detail dňa má nad správou hlavičku s názvom dňa, takže text deň nepomenúva - inak by
 * sa "Zajtra bude slabšie" ukázalo aj pri štvrtku. */
test('dayDetailMessage: text platí pre ktorýkoľvek deň, lebo deň nepomenúva', () => {
    assert.equal(dayDetailMessage([{ hour: 12, kw: 0.8 }], th).title, 'Slabý deň');
    assert.equal(dayDetailMessage([], th).title, 'Slabý deň');
    const pts = [
        { hour: 8, kw: 1 },
        { hour: 11, kw: 4 },
        { hour: 13, kw: 6 },
        { hour: 15, kw: 4.5 },
        { hour: 18, kw: 1 },
    ];
    const msg = dayDetailMessage(pts, th);
    assert.equal(msg.title, 'Najsilnejšie slnko okolo 13:00');
    assert.match(msg.body, /~6\.0 kW/);
    assert.match(msg.body, /medzi 11:00 a 16:00/);
    // Žiadne "dnes" ani "zajtra" - správa sa ukazuje aj pri dňoch o päť dní ďalej.
    assert.doesNotMatch(`${msg.title} ${msg.body}`, /dnes|zajtra/i);
});

test('slabý deň sa meria veľkosťou elektrárne, nie pevnými kilowattmi', () => {
    // Špička 1 kW je pre Dvorany (menič 10 kW) slabý deň, pre ukážku s polovičným meničom nie.
    const den = [
        { hour: 10, kw: 0.6 },
        { hour: 12, kw: 1 },
        { hour: 14, kw: 0.6 },
    ];
    const mala = powerThresholds(DEMO_PLANT);
    assert.equal(dayDetailMessage(den, th).title, 'Slabý deň');
    assert.equal(dayDetailMessage(den, mala).title, 'Najsilnejšie slnko okolo 12:00');
    assert.equal(forecastDayMessage(den, true, th).title, 'Dnes bude slabo');
    assert.equal(forecastDayMessage(den, false, mala).title, 'Zajtra bude slnečno');
});

test('weekMessage: najsilnejší a najslabší deň', () => {
    const days = [
        { date: '2026-09-05', kwhTotal: 30 },
        { date: '2026-09-06', kwhTotal: 45 },
        { date: '2026-09-07', kwhTotal: 12 },
    ];
    const msg = weekMessage(days);
    assert.equal(msg.title, 'Najsilnejší deň: Zajtra');
    assert.match(msg.body, /Najslabšie bude po 7\.9\./);
    assert.doesNotMatch(weekMessage([days[0]]).body, /Najslabšie/);
});
