import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_DAYS, ALL_MONTHS, PLANT, PRISTUP, SITE, TARIFF } from '../shared/config.js';
import { bodkaMerania, freshPowerKw, heroModel, liveStatus, pvFreshness, stavMerania } from '../shared/hero-model.js';
import { stavMeraniaSlovo, stavMeraniaText } from '../shared/messages-core.js';
import { odmietnute } from '../shared/pristup.js';
import { FIXED_NOW, fixtureData } from './helpers.js';

const { pv, forecast } = fixtureData();
const at = (/** @type {string} */ hm) => {
    const d = new Date(FIXED_NOW);
    const [h, m] = hm.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    return d;
};
const base = { tariff: TARIFF, pv, forecast, previewMinutes: null, site: SITE, plant: PLANT };

test('13:00 so 6,4 kW v lacnom pásme: zelená, výkon naživo', () => {
    const m = heroModel({ ...base, now: at('13:00') });
    assert.equal(m.tier, 'green');
    assert.equal(m.message.headline, 'Najlepší čas dňa — zapni všetko');
    assert.equal(m.powerText, '6.4');
    assert.equal(m.source, 'live');
    assert.equal(m.waitTime, null);
});

test('veľké číslo výkonu má jedno desatinné miesto s bodkou, nula je len „0“', () => {
    const vykon = (/** @type {number} */ kw) => heroModel({ ...base, now: at('13:00'), pv: { ...pv, realTimePowerKw: kw } }).powerText;
    assert.equal(vykon(10.44), '10.4');
    assert.equal(vykon(100), '100.0');
    assert.equal(vykon(0.06), '0.1');
    assert.equal(vykon(0.04), '0', 'čo sa zaokrúhli na nulu, je nula bez desatín');
    assert.equal(vykon(0), '0');
});

test('02:00 v noci: text o lacnom nočnom prúde', () => {
    const m = heroModel({ ...base, now: at('02:00'), pv: { ...pv, realTimePowerKw: 0 } });
    assert.ok(m.isNight);
    assert.equal(m.tier, 'amber');
    assert.equal(m.message.headline, 'Lacný nočný prúd');
});

test('21:00 VT bez slnka: červená a text o drahej sieti v tme', () => {
    const m = heroModel({ ...base, now: at('21:00'), pv: { ...pv, realTimePowerKw: 0 } });
    assert.equal(m.tier, 'red');
    assert.equal(m.message.headline, 'Drahá sieť a tma');
});

test('08:00 drahé pásmo bez dát: farba podľa ceny, číslo pomlčka', () => {
    const m = heroModel({ ...base, now: at('08:00'), pv: null, forecast: null });
    assert.equal(m.tier, 'red');
    assert.equal(m.powerText, '–');
    assert.equal(m.message.headline, 'Drahá elektrina');
});

test('jedna cena celý deň: bez slnka sivá, pri slnku zelená', () => {
    /** @type {import('../shared/config.js').Tariff} */
    const flat = {
        currency: '€',
        bands: [{ id: 'j', name: 'Cena', level: 'bezna', price: null }],
        schedules: [{ days: ALL_DAYS, months: ALL_MONTHS, changes: [{ from: '00:00', band: 'j' }] }],
    };
    const noc = heroModel({ ...base, tariff: flat, now: at('22:00'), pv: { ...pv, realTimePowerKw: 0 } });
    assert.equal(noc.tier, 'grey');
    assert.equal(noc.message.headline, 'Slnko nesvieti');
    assert.equal(heroModel({ ...base, tariff: flat, now: at('13:00') }).tier, 'green');
});

test('čakanie len keď slnko ešte nepokrýva spotrebiče a predpoveď hlási silnejšie', () => {
    const f = { ...forecast, strongerWindowAhead: true, hoursAhead: 3, windowDaypart: 'poobede' };
    const m = heroModel({ ...base, now: at('07:00'), forecast: f, pv: { ...pv, realTimePowerKw: 0.5 } });
    assert.equal(m.waitTime, '10:00');
    assert.equal(m.message.headline, 'Radšej počkaj na slnko', 'pred 07:30 je lacné NT, slabé slnko');
    assert.equal(heroModel({ ...base, now: at('13:00'), forecast: f }).waitTime, null, 'keď slnko svieti, nečaká sa');
});

test('náhľad iného času berie výkon z krivky: minulosť merané, budúcnosť odhad', () => {
    const past = heroModel({ ...base, now: at('13:00'), previewMinutes: 10 * 60 });
    assert.ok(past.preview && past.minutes === 10 * 60 && past.source === 'measured');
    const future = heroModel({ ...base, now: at('13:00'), previewMinutes: 16 * 60 });
    assert.equal(future.source, 'forecast');
    assert.equal(future.waitTime, null);
    assert.ok(Number.isFinite(future.power));
});

test('bez dát je výkon pomlčka a netvrdí, že je to odhad', () => {
    const m = heroModel({ ...base, now: at('13:00'), pv: null, forecast: null });
    assert.equal(m.powerText, '–');
    assert.equal(m.source, null);
});

test('bez živého merania je „teraz“ odhad z predpovede', () => {
    const m = heroModel({ ...base, now: at('13:00'), pv: null });
    assert.ok(Number.isFinite(m.power) && m.power > 0, `odhad ${m.power}`);
    assert.equal(m.source, 'forecast');
});

test('kiosk bez živého výkonu: nie nameraná nula, ale posledné meranie z krivky alebo odhad', () => {
    // Kontrakt pv povoľuje null - kiosk údaj neposlal. Number(null) je 0, takže appka o 13:00
    // za plného slnka ukazovala nameraných 0 kW a radila nič nezapínať.
    const bezVykonu = { ...pv, realTimePowerKw: null };
    const posledny = pv.realCurveToday[pv.realCurveToday.length - 1];
    assert.equal(posledny.hour, 13, 'krivka v ukážke končí o 13:00');
    const teraz = heroModel({ ...base, now: at('13:00'), pv: bezVykonu });
    assert.equal(teraz.power, posledny.kw);
    assert.equal(teraz.source, 'measured');
    // Za koncom krivky ostáva odhad z predpovede, rovnako ako bez kiosku.
    const neskor = heroModel({ ...base, now: at('13:30'), pv: bezVykonu });
    assert.ok(neskor.power > 0, `odhad ${neskor.power}`);
    assert.equal(neskor.source, 'forecast');
});

test('meranie, ktoré mlčí: číslo spred hodiny nie je výkon teraz, výkon aj odporúčanie idú z odhadu', () => {
    // Krivka v ukážke končí o 13:00. O 14:30 za slnka meranie mlčí - kiosk ešte drží 13:00.
    const now = at('14:30');
    const stale = { ...pv, updatedAt: now.toISOString() };
    assert.equal(pvFreshness({ now, pv: stale, site: SITE }).stale, true);
    assert.equal(freshPowerKw({ now, pv: stale, site: SITE }), null);
    const m = heroModel({ ...base, now, pv: stale });
    assert.equal(m.source, 'forecast');
    assert.notEqual(m.power, pv.realTimePowerKw);
    // To isté ako bez merania: odporúčanie stojí na krivke dňa, nie na starom čísle.
    const bez = heroModel({ ...base, now, pv: { ...stale, realTimePowerKw: null } });
    assert.equal(m.power, bez.power);
    assert.deepEqual(m.message, bez.message);
    // Čerstvé meranie je výkon teraz.
    assert.equal(freshPowerKw({ now: at('13:00'), pv, site: SITE }), pv.realTimePowerKw);
    assert.equal(freshPowerKw({ now, pv: null, site: SITE }), null);
});

test('pvFreshness: čas merania je posledný bod krivky, mlčanie za slnka je zastarané', () => {
    // Stiahnuté práve teraz - sleduje sa len krivka, ktorá vo vzorke končí o 13:00.
    const fresh = (/** @type {Date} */ now, curve = pv.realCurveToday) =>
        pvFreshness({ now, site: SITE, pv: { ...pv, realCurveToday: curve, updatedAt: now.toISOString() } });
    const ok = { label: 'meranie', time: '13:00', stale: false, pricina: null, spi: false };
    assert.deepEqual(fresh(at('13:00')), { ...ok, mlci: 0 });
    assert.deepEqual(fresh(at('13:15')), { ...ok, mlci: 15 });
    assert.deepEqual(fresh(at('13:30')), { ...ok, stale: true, pricina: 'menic', mlci: 30 });
    // Večer a v noci menič nemeria a nie je to chyba - menič spí.
    const evening = [...pv.realCurveToday, { hour: 18.75, kw: 0.1 }];
    assert.deepEqual(fresh(at('21:00'), evening), { ...ok, time: '18:45', spi: true, mlci: 135 });
    // Ráno tesne po východe slnka krivka ešte nemusí mať ani bod; o desiatej už áno.
    assert.deepEqual(fresh(at('07:00'), []), { ...ok, label: 'aktualizované', time: '07:00', spi: true, mlci: null });
    assert.equal(fresh(at('10:00'), []).pricina, 'menic');
    // Výrobca cez API krivku neposiela vôbec: čas merania je measuredAt, za slnka čerstvé 20 minút.
    const api = (/** @type {Date} */ measured) => ({
        ...pv,
        realCurveToday: [],
        measuredAt: measured.toISOString(),
        updatedAt: measured.toISOString(),
    });
    const apiFresh = (/** @type {Date} */ now, /** @type {Date} */ measured) => pvFreshness({ now, site: SITE, pv: api(measured) });
    const api10 = { ...ok, time: '10:00' };
    assert.deepEqual(apiFresh(at('10:00'), at('10:00')), { ...api10, mlci: 0 });
    assert.deepEqual(apiFresh(at('10:15'), at('10:00')), { ...api10, mlci: 15 });
    assert.deepEqual(apiFresh(at('10:30'), at('10:00')), { ...api10, stale: true, pricina: 'spojenie', mlci: 30 });
    assert.equal(freshPowerKw({ now: at('10:05'), site: SITE, pv: api(at('10:00')) }), pv.realTimePowerKw);
    // Staré stiahnutie je zastarané aj v noci - a príčinou je spojenie, nie menič. Za slnka tiež.
    const old = pvFreshness({ now: at('22:00'), site: SITE, pv: { ...pv, updatedAt: at('21:00').toISOString() } });
    assert.equal(old.stale, true);
    assert.equal(old.pricina, 'spojenie');
    assert.equal(old.spi, false);
    assert.equal(pvFreshness({ now: at('14:00'), site: SITE, pv: { ...pv, updatedAt: at('13:00').toISOString() } }).pricina, 'spojenie');
});

test('liveStatus: stav živého merania pre riadok v Nastavení', () => {
    const base = {
        now: at('13:00'),
        site: SITE,
        zdroj: { sposob: 'huawei-kiosk', pecat: 'v1.test-pecat-0123456789', nazov: '' },
        loading: false,
    };
    const cerstve = { ...pv, updatedAt: at('13:00').toISOString() };
    assert.equal(liveStatus({ ...base, zdroj: null, pv: cerstve }), null);
    assert.deepEqual(liveStatus({ ...base, pv: cerstve }), { tone: 'ok', text: 'pripojené · 13:00' });
    assert.deepEqual(liveStatus({ ...base, now: at('13:30'), pv: { ...cerstve, updatedAt: at('13:30').toISOString() } }), {
        tone: 'stale',
        text: 'zastarané · 13:00',
    });
    assert.deepEqual(liveStatus({ ...base, now: at('13:30'), pv: cerstve }), { tone: 'stale', text: 'bez spojenia · 13:00' });
    assert.deepEqual(liveStatus({ ...base, pv: null }), { tone: 'off', text: 'nepripojené' });
    assert.deepEqual(liveStatus({ ...base, pv: null, loading: true }), { tone: 'wait', text: 'pripájam…' });
});

test('stavMerania a jeho vysvetlenie: živé, zastarané, neprišlo, pripojiť znova, odhad', () => {
    const NB = { sposob: 'huawei-northbound', pecat: 'v1.AbCdEfGhIjKlMnOpQrStUvWxYz012345', nazov: 'Dvorany' };
    const stav = (/** @type {Date} */ now, /** @type {any} */ p, /** @type {any} */ zdroj = NB, /** @type {any} */ pristup = null) =>
        stavMerania({ now, pv: p, site: SITE, zdroj, pristup });
    const cerstve = { ...pv, updatedAt: at('13:10').toISOString() };
    // Krivka vo vzorke končí 13:00.
    const nic = { neplati: null, pricina: null, mlci: null };
    assert.deepEqual(stav(at('13:10'), cerstve), { ...nic, druh: 'zive', cas: '13:00' });
    assert.deepEqual(stav(at('13:30'), { ...cerstve, updatedAt: at('13:30').toISOString() }), {
        ...nic,
        druh: 'zastarane',
        cas: '13:00',
        pricina: 'menic',
        mlci: 30,
    });
    assert.deepEqual(stav(at('16:40'), cerstve), { ...nic, druh: 'zastarane', cas: '13:00', pricina: 'spojenie', mlci: 220 });
    // V noci menič spí - aj keď výkon neposlal.
    const noc = { ...cerstve, realTimePowerKw: null, updatedAt: at('23:10').toISOString() };
    assert.deepEqual(stav(at('23:10'), noc), { ...nic, druh: 'spi', cas: '13:00', mlci: 610 });
    assert.equal(stav(at('13:10'), { ...cerstve, realTimePowerKw: null }).druh, 'neprislo', 'meranie bez výkonu');
    assert.equal(stav(at('13:10'), null).druh, 'neprislo', 'pripojené meranie neprišlo');
    assert.equal(stav(at('13:10'), null, null).druh, 'odhad', 'meranie nie je pripojené');
    let o = odmietnute(null, NB, at('13:00'), 'prihlasenie:20400', false);
    for (let i = 1; i < PRISTUP.odmietnutia; i++) o = odmietnute(o, NB, at('13:00'), 'prihlasenie:20400', false);
    const znova = stav(at('13:10'), null, NB, o);
    assert.equal(znova.druh, 'znova');
    assert.equal(znova.neplati?.hlavicka, 'meranie treba pripojiť znova');

    // Texty: čas merania, značka pri neplatnom prístupe, tlačidlo len kde treba niečo urobiť, oba tóny.
    const text = (/** @type {any} */ s, voice = 'drzy') => stavMeraniaText(s, /** @type {any} */ (voice));
    assert.match(text(stav(at('13:10'), cerstve)).text, /^Menič poslal výkon o 13:00\. .*tvoja strecha/);
    assert.match(text(stav(at('13:10'), cerstve), 'slusny').text, /vaša strecha/);
    const mlci = stav(at('16:40'), { ...cerstve, updatedAt: at('16:40').toISOString() });
    assert.equal(text(mlci).nadpis, 'Meranie je zastarané');
    assert.match(text(mlci).text, /^Menič mlčí od 13:00, už 3 h 40 min, hoci slnko svieti\. Karty zatiaľ rátajú s predpoveďou\./);
    assert.match(text({ ...mlci, mlci: null }).text, /^Od 13:00 neprišlo nové meranie\./);
    assert.equal(text(stav(at('16:40'), cerstve)).nadpis, 'Appka nemá spojenie');
    assert.match(text(stav(at('16:40'), cerstve)).text, /^Od 13:00 sa appka nedostala k novým dátam\./);
    assert.equal(text(stav(at('23:10'), noc)).nadpis, 'Menič spí');
    assert.match(text(stav(at('23:10'), noc)).text, /^Posledné meranie prišlo o 13:00, odvtedy slnko zapadlo/);
    assert.match(text({ ...stav(at('23:10'), noc), mlci: null }).text, /^Slnko je pod obzorom/);
    assert.equal(text(znova).text.startsWith('Huawei prestal prijímať prístup, ktorý si zadal.'), true);
    assert.equal(text(znova, 'slusny').text.startsWith('Huawei prestal prijímať prístup, ktorý ste zadali.'), true);
    assert.equal(text(znova).tlacidlo, 'Pripojiť znova ›');
    assert.equal(text({ druh: 'znova', cas: '', neplati: null }).text.startsWith('Výrobca prestal'), true);
    assert.equal(text(stav(at('13:10'), null, null)).tlacidlo, 'Pripojiť meranie ›');
    assert.match(text(stav(at('13:10'), null, null), 'slusny').text, /pripojte ho v Nastavení/);
    assert.match(text(stav(at('13:10'), null), 'slusny').text, /nemusíte nič robiť/);
    for (const s of [stav(at('13:10'), cerstve), stav(at('13:10'), null)]) assert.equal(text(s).tlacidlo, '');
});

test('bodka a slovo za čas: tvar podľa stavu merania, rovnaký v oboch appkách', () => {
    const s = (/** @type {any} */ druh, /** @type {any} */ pricina = null) => ({ druh, cas: '13:00', neplati: null, pricina, mlci: null });
    assert.equal(bodkaMerania(s('zive')), 'live');
    assert.equal(bodkaMerania(s('spi')), 'live');
    assert.equal(bodkaMerania(s('zastarane', 'menic')), 'stale');
    assert.equal(bodkaMerania(s('zastarane', 'spojenie')), 'stale');
    for (const druh of ['neprislo', 'znova', 'odhad']) assert.equal(bodkaMerania(s(druh)), 'odhad');
    assert.equal(stavMeraniaSlovo(s('zive')), '');
    assert.equal(stavMeraniaSlovo(s('spi')), 'menič spí');
    assert.equal(stavMeraniaSlovo(s('zastarane', 'menic')), 'zastarané');
    assert.equal(stavMeraniaSlovo(s('zastarane', 'spojenie')), 'bez spojenia');
    assert.equal(stavMeraniaSlovo(s('zastarane')), 'zastarané');
    assert.equal(stavMeraniaSlovo(s('odhad')), '');
});
