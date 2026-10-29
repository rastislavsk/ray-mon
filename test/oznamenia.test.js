import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_DAYS, ALL_MONTHS, OZNAMENIA, PLAN_DNA, PLANT, SITE, TARIFF } from '../shared/config.js';
import { oznameniaTexts, planNoticeText } from '../shared/messages.js';
import {
    morningDue,
    oznameniaDefault,
    oznamOvladanie,
    parseOznamenia,
    planNotice,
    reminderNotice,
    swNotice,
    vapidKeyBytes,
} from '../shared/oznamenia.js';
import { fixture, fixtureData } from './helpers.js';

/** Tarifa Dvorian s cenami: NT lacné, VT drahé. */
const PRICED = { ...TARIFF, bands: TARIFF.bands.map((b) => ({ ...b, price: b.id === 'nt' ? 0.14 : 0.19 })) };
/** Jedna cena celý deň, bez ceny a bez lacného pásma. @type {import('../shared/config.js').Tariff} */
const FLAT = {
    currency: '€',
    bands: [{ id: 'j', name: 'Cena', level: 'bezna', price: null }],
    schedules: [{ days: ALL_DAYS, months: ALL_MONTHS, changes: [{ from: '00:00', band: 'j' }] }],
};
const DEVICES = [...PLAN_DNA.devices];
/** Miestny čas 5. 9. 2026 v Bratislave (letný čas). @param {string} hm */
const at = (hm) => new Date(`2026-09-05T${hm}:00+02:00`);
/** Vstup bez merania, ako ho má service worker. @param {Date} now @param {object} [extra] */
const input = (now, extra = {}) => ({
    now,
    site: SITE,
    plant: PLANT,
    tariff: PRICED,
    pv: null,
    forecast: fixtureData(now).forecast,
    ...extra,
});

test('parseOznamenia: predvolene vypnuté o 9:00, poškodené a neznáme hodnoty nahradí, nič nezahodí celé', () => {
    assert.deepEqual(parseOznamenia(null), { on: false, hour: 9 });
    assert.equal(OZNAMENIA.hour, 9);
    assert.deepEqual(parseOznamenia('{zle'), oznameniaDefault());
    assert.deepEqual(parseOznamenia('"text"'), oznameniaDefault());
    // Spotrebiče zo staršej verzie sa tu ignorujú - presúva ich shared/doma.js.
    assert.deepEqual(parseOznamenia(JSON.stringify({ on: true, hour: 7, devices: ['pracka', 'bojler'] })), { on: true, hour: 7 });
    assert.deepEqual(parseOznamenia(JSON.stringify({ on: 'ano', hour: 13 })), { on: false, hour: 9 });
});

test('morningDue: prvá štvrťhodina zvolenej hodiny v pásme telefónu', () => {
    const tz = 'Europe/Bratislava';
    assert.ok(morningDue(at('09:00'), tz, 9));
    assert.ok(morningDue(at('09:14'), tz, 9));
    assert.ok(!morningDue(at('09:15'), tz, 9));
    assert.ok(!morningDue(at('08:59'), tz, 9));
    assert.ok(morningDue(at('08:00'), 'Europe/London', 7), '8:00 v Bratislave je 7:00 v Londýne');
});

test('ranné oznámenie o 9:00 za jasna: nadpis s koncom slnka, poradie od teraz, auto s km a úsporou, bez cien pri spotrebičoch', () => {
    const n = planNotice(input(at('09:00')), { devices: DEVICES });
    assert.equal(n.title, 'Dnes slnko do 17:30');
    assert.match(
        n.body,
        /^Práčka 09:00 · umývačka \d\d:\d\d · sušička \d\d:\d\d\. Auto \d\d:\d\d–\d\d:\d\d: ~\d+ km zo slnka, ušetríš ~\d+ €\.$/,
    );
    assert.ok(n.body.length <= 200, `krátke: ${n.body.length}`);
    assert.equal(n.body.match(/€/g)?.length, 1, 'cena len pri aute');
    assert.ok(n.remind && n.remind.id !== 'pracka' && n.remind.at > 9 * 60, 'pripomienka najbližšieho, ktorý nie je na rade hneď');
    const slusne = planNotice(input(at('09:00')), { devices: DEVICES, voice: 'slusny' });
    assert.match(slusne.body, /ušetríte/);
});

test('ranné oznámenie: večer, zamračený deň a týždeň bez slnka', () => {
    const vecer = planNotice(input(at('19:50')), { devices: DEVICES });
    assert.equal(vecer.title, 'Dnes slnko na spotrebiče nestačí');
    assert.equal(vecer.body, 'Práčka, sušička a umývačka radšej zajtra. Auto nabi v lacnom pásme od 20:00.');
    assert.equal(vecer.remind, null);
    const { forecast } = fixtureData(at('09:00'));
    const scale = (/** @type {number} */ k) => ({
        ...forecast,
        hourlyToday: forecast.hourlyToday.map((p) => ({ ...p, kw: p.kw * k })),
        days: forecast.days.map((d) => ({
            ...d,
            hourly: d.hourly.map((p) => ({ ...p, kw: p.kw * k })),
            peakKw: d.peakKw * k,
            kwhTotal: d.kwhTotal * k,
        })),
    });
    const tyzden = planNotice(input(at('09:00'), { forecast: scale(0.01), tariff: FLAT }), { devices: DEVICES });
    assert.equal(tyzden.title, 'Tento týždeň slnko nestačí');
    assert.equal(tyzden.body, 'Pusti ich, keď treba, najlepšie v lacnom pásme.');
    assert.equal(
        planNotice(input(at('09:00'), { forecast: scale(0.01), tariff: FLAT }), { devices: DEVICES, voice: 'slusny' }).body.slice(0, 7),
        'Pustite',
    );
});

test('planNoticeText: deň v pláne ako časť vety („v stredu“, „vo štvrtok“), bojler v lacnom pásme', () => {
    const day = (/** @type {string} */ name, /** @type {number} */ index) => ({ name, index, start: 540 });
    const t = planNoticeText({
        rows: [
            { id: 'pracka', kind: 'later', day: day('Streda', 4) },
            { id: 'susicka', kind: 'later', day: day('Štvrtok', 5) },
            { id: 'bojler', kind: 'cheap', start: 1320 },
        ],
        sunEnd: null,
        weak: true,
    });
    assert.equal(t.title, 'Dnes zamračené celý deň');
    assert.equal(t.body, 'Práčka radšej v stredu. Sušička radšej vo štvrtok. Bojler v lacnom pásme od 22:00.');
    assert.equal(
        planNoticeText({
            rows: [{ id: 'pracka', kind: 'sun', start: 480, end: 600, after: null, km: null, save: null, currency: '€' }],
            sunEnd: 690,
            weak: false,
        }).title,
        'Dnes slnko len dopoludnia',
    );
});

test('pripomienka: teraz, keď je na rade; inak povie, čo sa zmenilo', () => {
    const teraz = reminderNotice(input(at('10:30')), { id: 'umyvacka' });
    assert.equal(teraz?.title, 'Umývačka · teraz');
    assert.match(teraz?.body ?? '', /^Oba ohrevy chytia slnko\. Dobehne o \d\d:\d\d\.$/);
    assert.equal(reminderNotice(input(at('19:50')), { id: 'susicka' })?.title, 'Sušička radšej zajtra');
    assert.equal(reminderNotice(input(at('19:50')), { id: 'auto' })?.title, 'Auto v lacnom pásme');
});

test('swNotice: ranné oznámenie s tlačidlom Pripomeň, v čase pripomienky pripomienka', () => {
    const weather = fixture('open-meteo.json');
    /** @type {import('../shared/oznamenia.js').Zrkadlo} */
    const z = { site: SITE, plant: PLANT, tariff: PRICED, devices: DEVICES, voice: 'drzy', app: 'obloha/', hour: 9 };
    const rano = swNotice(z, [], weather, at('09:00'));
    assert.equal(rano.title, 'Dnes slnko do 17:30');
    assert.ok(rano.remind);
    assert.match(rano.remind.label, /^Pripomeň o \d\d:\d\d$/);
    const remindAt = new Date(rano.remind.at);
    assert.equal(rano.remind.label, oznameniaTexts().remind((remindAt.getTime() - at('00:00').getTime()) / 60000));
    const stara = { id: 'pracka', at: at('06:00').toISOString() };
    const pripomienka = swNotice(z, [stara, { id: rano.remind.id, at: rano.remind.at }], weather, remindAt);
    assert.match(pripomienka.title, / · teraz$/);
    assert.equal(pripomienka.reminder, true, 'pripomienka má vlastnú značku v lište');
    assert.equal(rano.reminder, false);
    assert.equal(pripomienka.remind, null);
    assert.deepEqual(pripomienka.keep, [], 'odoslaná aj stará pripomienka zmizli');
    const neskor = { id: 'susicka', at: at('15:00').toISOString() };
    assert.deepEqual(swNotice(z, [neskor], weather, at('09:00')).keep, [neskor], 'budúca ostáva');
});

test('oznamOvladanie: hláška a zámok sekcie Oznámenia, rovnaké pre obe appky', () => {
    assert.deepEqual(oznamOvladanie('elektraren', 'ok', false), { stav: 'ok', blocked: false, busy: false });
    assert.deepEqual(oznamOvladanie('nic', 'ok', false), { stav: 'bezElektrarne', blocked: true, busy: false });
    assert.deepEqual(oznamOvladanie('poloha', 'zakazane', false), { stav: 'zakazane', blocked: true, busy: false });
    assert.equal(oznamOvladanie('poloha', 'zakazane', true).blocked, false, 'zapnuté sa dá vždy vypnúť');
    assert.deepEqual(oznamOvladanie('elektraren', 'caka', true), { stav: 'caka', blocked: true, busy: true }, 'kým sa zapína, nič');
    assert.equal(oznamOvladanie('elektraren', 'chyba', false).blocked, false, 'po chybe sa dá skúsiť znova');
    for (const k of ['ok', 'caka', 'plocha', 'zakazane', 'nepodporuje', 'bezElektrarne', 'chyba'])
        assert.equal(typeof oznameniaTexts().stav[/** @type {keyof ReturnType<typeof oznameniaTexts>['stav']} */ (k)], 'string', k);
});

test('kľúč VAPID má 65 bajtov', () => {
    const key = vapidKeyBytes();
    assert.equal(key.length, 65);
    assert.equal(key[0], 4, 'nekomprimovaný bod P-256');
});
