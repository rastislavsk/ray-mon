import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANT, SITE } from '../shared/config.js';
import { heroModel, pvFreshness } from '../shared/hero-model.js';
import { FIXED_NOW, fixtureData } from './helpers.js';

const { pv, forecast } = fixtureData();
const at = (/** @type {string} */ hm) => {
    const d = new Date(FIXED_NOW);
    const [h, m] = hm.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    return d;
};
const base = { season: /** @type {const} */ ('summer'), pv, forecast, previewMinutes: null, site: SITE, plant: PLANT };

test('13:00 v lete so 6,4 kW: zelené okno, všetky spotrebiče go, žiadne čakanie', () => {
    const m = heroModel({ ...base, now: at('13:00') });
    assert.equal(m.tier, 'green');
    assert.equal(m.accent, 'green');
    assert.equal(m.message.headline, 'Najlepší čas dňa — zapni všetko');
    assert.ok(m.devices.every((d) => d.state === 'go' && d.tier === 'green'));
    assert.equal(m.waitTime, null);
    assert.equal(m.powerText, '6,41');
    assert.equal(m.unitText, 'kW teraz');
    assert.equal(m.dial.tier, 'green');
});

test('číslo v ciferníku má najviac päť znakov, aj pri 100 kW', () => {
    // Šesť znakov („100,00“) sa medzi prstence nezmestí - od 100 kW ostáva jedno desatinné miesto.
    const vykon = (/** @type {number} */ kw) => heroModel({ ...base, now: at('13:00'), pv: { ...pv, realTimePowerKw: kw } }).powerText;
    assert.equal(vykon(10.44), '10,44', 'desatinná čiarka ako všade v appke');
    assert.equal(vykon(100), '100,0');
    assert.equal(vykon(99.996), '100,0', 'zaokrúhlenie na dve desatiny by dalo šesť znakov');
});

test('02:00 nočný slot: text z okna, auto oranžové', () => {
    const m = heroModel({ ...base, now: at('02:00'), pv: { ...pv, realTimePowerKw: 0 } });
    assert.ok(m.isNight);
    assert.equal(m.message.headline, 'Lacný nočný prúd');
    assert.equal(m.devices.find((d) => d.name === 'Auto')?.tier, 'amber');
    assert.equal(m.dial.tier, 'red');
});

test('08:00 drahý slot bez dát: farba podľa tarify, číslo pomlčka', () => {
    const m = heroModel({ ...base, now: at('08:00'), pv: null, forecast: null });
    assert.equal(m.accent, 'red');
    assert.equal(m.powerText, '–');
    assert.equal(m.message.headline, 'Najdrahšia sieť');
});

test('čakací chip len mimo zeleného okna, keď predpoveď hlási silnejšie slnko', () => {
    const f = { ...forecast, strongerWindowAhead: true, hoursAhead: 3, windowDaypart: 'poobede' };
    const m = heroModel({ ...base, now: at('09:00'), forecast: f, pv: { ...pv, realTimePowerKw: 0.5 } });
    assert.equal(m.waitTime, '12:00');
    assert.equal(m.message.headline, 'Radšej počkaj na slnko', '08:30-09:30 je lacný slot, slabé slnko');
    assert.equal(heroModel({ ...base, now: at('13:00'), forecast: f }).waitTime, null, 'v okne so spotrebičmi sa nečaká');
});

test('náhľad iného času berie výkon z krivky: minulosť merané, budúcnosť odhad', () => {
    const past = heroModel({ ...base, now: at('13:00'), previewMinutes: 10 * 60 });
    assert.ok(past.preview && past.unitText === 'kW (merané)' && past.previewLabel === 'Náhľad · 10:00');
    const future = heroModel({ ...base, now: at('13:00'), previewMinutes: 16 * 60 });
    assert.equal(future.unitText, 'kW (odhad)');
    assert.equal(future.waitTime, null);
    assert.ok(Number.isFinite(future.power));
});

test('bez živého merania je „teraz“ odhad z predpovede a ciferník meria voči vlastnej zostave', () => {
    const m = heroModel({ ...base, now: at('13:00'), pv: null });
    assert.ok(Number.isFinite(m.power) && m.power > 0, `odhad ${m.power}`);
    assert.equal(m.unitText, 'kW (odhad)');
    // Tá istá výroba na polovičnej zostave vyplní ciferník dvakrát viac (strop je 100 %).
    const half = { ...PLANT, strings: [{ panels: 12, azimuthDeg: 180, tiltDeg: 40 }] };
    const small = heroModel({ ...base, now: at('13:00'), pv: null, plant: half });
    assert.ok(Math.abs(small.dial.fraction - Math.min(1, 2 * m.dial.fraction)) < 0.02, `${small.dial.fraction} vs ${m.dial.fraction}`);
});

test('kiosk bez živého výkonu: nie nameraná nula, ale posledné meranie z krivky alebo odhad', () => {
    // Kontrakt pv povoľuje null - kiosk údaj neposlal. Number(null) je 0, takže appka o 13:00
    // za plného slnka ukazovala nameraných 0 kW a radila nič nezapínať.
    const bezVykonu = { ...pv, realTimePowerKw: null };
    const posledny = pv.realCurveToday[pv.realCurveToday.length - 1];
    assert.equal(posledny.hour, 13, 'krivka v ukážke končí o 13:00');
    const teraz = heroModel({ ...base, now: at('13:00'), pv: bezVykonu });
    assert.equal(teraz.power, posledny.kw);
    assert.equal(teraz.unitText, 'kW (merané)');
    // Za koncom krivky ostáva odhad z predpovede, rovnako ako bez kiosku.
    const neskor = heroModel({ ...base, now: at('13:30'), pv: bezVykonu });
    assert.ok(neskor.power > 0, `odhad ${neskor.power}`);
    assert.equal(neskor.unitText, 'kW (odhad)');
});

test('pvFreshness: čas merania je posledný bod krivky, mlčanie za slnka je zastarané', () => {
    // Stiahnuté práve teraz - sleduje sa len krivka, ktorá vo vzorke končí o 13:00.
    const fresh = (/** @type {Date} */ now, curve = pv.realCurveToday) =>
        pvFreshness({ now, site: SITE, pv: { ...pv, realCurveToday: curve, updatedAt: now.toISOString() } });
    assert.deepEqual(fresh(at('13:00')), { label: 'meranie 13:00', stale: false });
    assert.deepEqual(fresh(at('13:15')), { label: 'meranie 13:00', stale: false });
    assert.deepEqual(fresh(at('13:30')), { label: 'meranie 13:00', stale: true });
    // Večer a v noci menič nemeria a nie je to chyba.
    const evening = [...pv.realCurveToday, { hour: 18.75, kw: 0.1 }];
    assert.deepEqual(fresh(at('21:00'), evening), { label: 'meranie 18:45', stale: false });
    // Ráno tesne po východe slnka krivka ešte nemusí mať ani bod; o desiatej už áno.
    assert.deepEqual(fresh(at('07:00'), []), { label: 'aktualizované 07:00', stale: false });
    assert.equal(fresh(at('10:00'), []).stale, true);
    // Staré stiahnutie je zastarané aj v noci.
    const old = pvFreshness({ now: at('22:00'), site: SITE, pv: { ...pv, updatedAt: at('21:00').toISOString() } });
    assert.equal(old.stale, true);
});
