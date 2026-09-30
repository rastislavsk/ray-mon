import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_DAYS, ALL_MONTHS, MOZEM_ITEMS, PLANT, powerThresholds, SITE, TARIFF } from '../shared/config.js';
import { countdownText, durationText, mozemGlanceText, MOZEM_QUIPS } from '../shared/messages.js';
import { dayWindow, deviceShorts, itemAnswer, itemCost, mozemModel, planWindows, stripGeometry } from '../shared/mozem.js';
import { FIXED_NOW, fixtureData } from './helpers.js';

/** Tarifa Dvorian s cenami: NT lacné, VT drahé. */
const PRICED = { ...TARIFF, bands: TARIFF.bands.map((b) => ({ ...b, price: b.id === 'nt' ? 0.14 : 0.19 })) };
/** Jedna cena celý deň, bez ceny. @type {import('../shared/config.js').Tariff} */
const FLAT = {
    currency: '€',
    bands: [{ id: 'j', name: 'Cena', level: 'bezna', price: null }],
    schedules: [{ days: ALL_DAYS, months: ALL_MONTHS, changes: [{ from: '00:00', band: 'j' }] }],
};
/** Miestny čas 5. 9. 2026 v Bratislave (letný čas). @param {string} hm */
const at = (hm) => new Date(`2026-09-05T${hm}:00+02:00`);

/** Vstup karty v danej chvíli s fixtures. @param {Date} now @param {object} [extra] */
function input(now, extra = {}) {
    const { pv, forecast } = fixtureData(now);
    return { now, site: SITE, plant: PLANT, tariff: PRICED, kiosk: 'kiosk', loading: false, pv, forecast, ...extra };
}
const item = (/** @type {ReturnType<typeof mozemModel>} */ m, /** @type {string} */ id) =>
    /** @type {NonNullable<ReturnType<typeof mozemModel>['items'][number]>} */ (m.items.find((i) => i.id === id));

/**
 * Predpoveď zmenšená na zlomok: zamračený deň. Meranie sa zahodí, inak by dnešok ťahalo nahor.
 * @param {number} k @param {number[]} [dayIdx] ktoré dni zmenšiť (predvolene všetky)
 */
function cloudy(k, dayIdx) {
    const { forecast } = fixtureData(FIXED_NOW);
    const scale = (/** @type {number} */ i) => (!dayIdx || dayIdx.includes(i) ? k : 1);
    return {
        ...forecast,
        hourlyToday: forecast.hourlyToday.map((p) => ({ ...p, kw: p.kw * scale(0) })),
        days: forecast.days.map((d, i) => ({
            ...d,
            hourly: d.hourly.map((p) => ({ ...p, kw: p.kw * scale(i) })),
            peakKw: d.peakKw * scale(i),
            kwhTotal: d.kwhTotal * scale(i),
        })),
    };
}

test('planWindows: súvislé úseky, ktoré spĺňajú podmienku', () => {
    const plan = [0, 1, 1, 0, 1].map((ok, i) => ({ startMin: i * 15, min: 15, ok }));
    assert.deepEqual(
        planWindows(/** @type {any} */ (plan), (/** @type {any} */ s) => !!s.ok),
        [
            { from: 15, to: 45 },
            { from: 60, to: 75 },
        ],
    );
});

test('dayWindow: prvá a posledná hodina nad hranicou, inak null', () => {
    const day = /** @type {any} */ ({
        hourly: [
            { hour: 8, kw: 1 },
            { hour: 9, kw: 3 },
            { hour: 14, kw: 3 },
            { hour: 15, kw: 1 },
        ],
    });
    assert.deepEqual(dayWindow(day, 2), { from: 540, to: 840 });
    assert.equal(dayWindow(day, 5), null);
});

test('stripGeometry: percentá v produkčnom okne, mimo neho na okraji', () => {
    assert.deepEqual(stripGeometry({ from: 9 * 60, to: 13 * 60 }, 21 * 60), { left: 25, width: 25, now: 100 });
    assert.deepEqual(stripGeometry(null, 0), { left: 0, width: 0, now: 0 });
});

test('durationText a countdownText po slovensky', () => {
    assert.equal(durationText(60), 'hodinu');
    assert.equal(durationText(90), 'hodinu a pol');
    assert.equal(durationText(120), '2 hodiny');
    assert.equal(durationText(150), '2 a pol hodiny');
    assert.equal(durationText(300), '5 hodín');
    assert.equal(countdownText(140), '2 h 20 min');
    assert.equal(countdownText(45), '45 min');
    assert.equal(countdownText(180), '3 h');
});

test('13:00 za jasna: zapínaj, s meraním nabitia mobilu a spotrebiče dokedy', () => {
    const m = mozemModel(input(FIXED_NOW));
    assert.equal(m.state, 'go');
    assert.equal(m.word, 'ZAPNI TOOO');
    assert.match(m.hero.factV, /^~\d+ mobilov$/);
    assert.ok(m.strip && m.strip.width > 0 && m.strip.now > m.strip.left);
    const pracka = item(m, 'pracka');
    assert.equal(pracka.tone, 'go');
    assert.match(pracka.short, /^do \d\d:\d\d$/);
    assert.match(pracka.extra, /~0,14 €/, 'cena z lacného pásma');
    assert.match(item(m, 'auto').text, /asi \d+ km/);
    assert.equal(item(m, 'hranie').short, 'vždy OK');
    assert.ok(MOZEM_QUIPS.go.includes(m.quip));
});

test('bez merania: priznaný odhad a bez cien žiadne eurá', () => {
    const m = mozemModel(input(FIXED_NOW, { pv: null, kiosk: '', tariff: FLAT }));
    assert.equal(m.state, 'go');
    assert.equal(m.hero.factV, 'odhad z predpovede');
    assert.ok(m.items.every((i) => !i.extra.includes('€')));
});

test('rano pred slnkom: ešte nie, štart a spotrebiče o koľkej', () => {
    const m = mozemModel(input(at('05:30')));
    assert.equal(m.state, 'wait');
    assert.equal(m.hero.factK, 'štart');
    const pracka = item(m, 'pracka');
    assert.equal(pracka.tone, 'wait');
    assert.equal(pracka.short, `o ${m.hero.factV}`);
    assert.match(pracka.extra, /^Musíš hneď\? Stojí to/);
    assert.ok(item(m, 'auto').short >= pracka.short, 'auto potrebuje silnejšie slnko');
});

test('v drahom pásme rano to karta povie', () => {
    const m = mozemModel(input(at('09:40'), { pv: null, forecast: cloudy(0.3, [0]) }));
    assert.equal(m.state, 'wait');
    assert.match(m.hero.lead, /drahý prúd/);
    assert.match(item(m, 'pracka').text, /práve drahá/);
});

test('večer: dnes už nie, auto na lacný prúd, ostatné zajtra', () => {
    const m = mozemModel(input(at('19:50')));
    assert.equal(m.state, 'none');
    assert.match(m.hero.lead, /Auto na lacný prúd/);
    assert.match(m.strip?.text || '', /^Slnko skončilo o/);
    assert.equal(item(m, 'auto').tone, 'cheap');
    assert.match(item(m, 'auto').extra, /^Zajtra od/);
    assert.match(item(m, 'pracka').short, /^zajtra /);
    assert.ok(MOZEM_QUIPS.none.includes(m.quip));
});

test('večer vo VT: auto nie je lacno, čaká na zajtrajšie slnko', () => {
    const m = mozemModel(input(at('20:45')));
    assert.equal(item(m, 'auto').tone, 'wait');
    assert.doesNotMatch(m.hero.lead, /lacný/);
});

test('zamračený deň: slabý deň, umývačka a sušička sa preskočia, práčka nie', () => {
    const forecast = cloudy(0.05, [0, 1]);
    const m = mozemModel(input(at('12:00'), { pv: null, forecast }));
    assert.equal(m.state, 'slabo');
    assert.match(m.hero.factV, /zajtra/);
    assert.match(m.strip?.text || '', /neutiahne/);
    const th = powerThresholds(PLANT);
    assert.ok(forecast.days[1].peakKw < th.weakPeakKw, 'zajtra je tiež slabý deň');
    const pracka = item(m, 'pracka');
    const umyvacka = item(m, 'umyvacka');
    assert.doesNotMatch(pracka.text, /radšej počkaj/, 'práčka sa v slabý deň neodporúča len preto, že slnko nestačí');
    assert.match(umyvacka.text, /radšej počkaj/);
    assert.equal(umyvacka.tone, 'no');
});

test('celý týždeň bez slnka: tento týždeň nie', () => {
    const m = mozemModel(input(at('12:00'), { pv: null, forecast: cloudy(0.01) }));
    assert.equal(item(m, 'susicka').short, 'tento týždeň nie');
    assert.equal(item(m, 'auto').tone, 'cheap', 'cez deň v NT je aspoň lacno');
});

test('bez dát: neviem, pri spotrebičoch otáznik, hranie ostáva OK', () => {
    const m = mozemModel(input(FIXED_NOW, { pv: null, forecast: null }));
    assert.equal(m.state, 'offline');
    assert.equal(m.word, 'Neviem.');
    assert.equal(m.strip, null);
    assert.equal(item(m, 'pracka').tone, 'unk');
    assert.equal(item(m, 'hranie').tone, 'go');
    assert.equal(mozemModel(input(FIXED_NOW, { pv: null, forecast: null, loading: true })).state, 'loading');
});

test('riadok Čo môžem: koľko ide hneď a výnimky slovom, najviac dve', () => {
    const it = (/** @type {string} */ name, /** @type {string} */ tone, /** @type {string} */ short) => ({ name, tone, short });
    const go = it('Hranie', 'go', 'vždy OK');
    assert.deepEqual(mozemGlanceText([go, go, go, go, go, go]), { title: 'Všetko ide hneď', sub: 'Ťukni, dokedy.' });
    assert.deepEqual(mozemGlanceText([go, go, go, go, go, it('Auto', 'wait', 'o 12:30')]), {
        title: '5 zo 6 ide hneď',
        sub: 'auto o 12:30',
    });
    const no = it('Sušička', 'no', 'zajtra 09:00');
    assert.deepEqual(mozemGlanceText([no, no, no, it('Auto', 'cheap', 'lacno')]), {
        title: 'Teraz nič',
        sub: 'sušička zajtra 09:00, sušička zajtra 09:00 +2',
    });
    assert.equal(mozemGlanceText([go, no, no, no, no]).title, '1 z 5 ide hneď');
    assert.equal(mozemGlanceText([go, no, no, no]).title, '1 zo 4 ide hneď');
    assert.equal(mozemGlanceText([go, it('Práčka', 'unk', 'neviem')]).sub, 'Pri spotrebičoch bez dát neviem.');

    // Model: riadok ráta s krátkymi odpoveďami veci, ktoré ukazuje aj zoznam.
    const rano = mozemModel(input(at('07:30')));
    assert.deepEqual(rano.glance, mozemGlanceText(rano.items));
    assert.equal(mozemModel(input(FIXED_NOW, { pv: null, forecast: null })).glance.sub, 'Pri spotrebičoch bez dát neviem.');
});

test('hlášky: celá sada stavu, hláška dňa prvá, stránka mimo sady sa točí dokola', () => {
    const m = mozemModel(input(FIXED_NOW), 0);
    assert.deepEqual([...m.quips].sort(), [...MOZEM_QUIPS.go].sort(), 'každá hláška sady práve raz');
    assert.equal(m.quipPage, 0);
    assert.equal(m.quip, m.quips[0]);
    const druha = mozemModel(input(FIXED_NOW), 1);
    assert.equal(druha.quip, m.quips[1]);
    assert.deepEqual(druha.quips, m.quips, 'poradie sa listovaním nemení');
    assert.equal(mozemModel(input(FIXED_NOW), MOZEM_QUIPS.go.length).quipPage, 0, 'sada sa točí dokola');
    assert.equal(mozemModel(input(FIXED_NOW), -1).quipPage, MOZEM_QUIPS.go.length - 1);
    const nacitava = mozemModel(input(FIXED_NOW, { pv: null, forecast: null, loading: true }), 3);
    assert.deepEqual(nacitava.quips, MOZEM_QUIPS.loading, 'jediná hláška, stránka vždy prvá');
    assert.equal(nacitava.quipPage, 0);
});

test('itemAnswer a itemCost: veci bez spotrebiča sú vždy OK a nemajú cenu', () => {
    const hranie = /** @type {(typeof MOZEM_ITEMS)[number]} */ (MOZEM_ITEMS.find((i) => i.id === 'hranie'));
    const ctx = /** @type {any} */ ({ price: 0.2 });
    assert.deepEqual(itemAnswer(hranie, ctx), { kind: 'always' });
    assert.equal(itemCost(hranie, ctx), null);
});

test('neskoro popoludní: program už celý na slnku nedobehne, karta to povie', () => {
    const m = mozemModel(input(at('16:30')));
    assert.equal(m.state, 'go');
    const pracka = item(m, 'pracka');
    assert.equal(pracka.short, 'teraz');
    assert.match(pracka.text, /Koniec pôjde zo siete\.$/);
});

test('deviceShorts: krátke odpovede podľa názvu spotrebiča pre tooltip na Terazky', () => {
    const m = mozemModel(input(FIXED_NOW));
    const shorts = deviceShorts(m);
    assert.equal(shorts['Práčka'], item(m, 'pracka').short);
    assert.equal(shorts.Auto, item(m, 'auto').short);
    assert.equal(shorts.Bojler, undefined, 'bojler na karte Môžem? nie je');
    assert.deepEqual(Object.keys(shorts).sort(), ['Auto', 'Práčka', 'Sušička', 'Umývačka']);
});
