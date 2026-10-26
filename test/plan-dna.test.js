import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_DAYS, ALL_MONTHS, MOZEM_ITEMS, PLAN_DNA, PLANT, powerThresholds, SITE, TARIFF } from '../shared/config.js';
import { dayCtx } from '../shared/mozem.js';
import { planDna, planDnaModel } from '../shared/plan-dna.js';
import { PLAN_DNA_NOTE } from '../shared/messages.js';
import { FIXED_NOW, fixtureData } from './helpers.js';

/** Tarifa Dvorian s cenami: NT lacné, VT drahé. */
const PRICED = { ...TARIFF, bands: TARIFF.bands.map((b) => ({ ...b, price: b.id === 'nt' ? 0.14 : 0.19 })) };
/** Jedna cena celý deň, bez ceny. @type {import('../shared/config.js').Tariff} */
const FLAT = {
    currency: '€',
    bands: [{ id: 'j', name: 'Cena', level: 'bezna', price: null }],
    schedules: [{ days: ALL_DAYS, months: ALL_MONTHS, changes: [{ from: '00:00', band: 'j' }] }],
};
const ALL = ['pracka', 'umyvacka', 'susicka', 'auto', 'bojler'];
/** Miestny čas 5. 9. 2026 v Bratislave (letný čas). @param {string} hm */
const at = (hm) => new Date(`2026-09-05T${hm}:00+02:00`);

/** Vstup v danej chvíli s fixtures. @param {Date} now @param {object} [extra] */
function input(now, extra = {}) {
    const { pv, forecast } = fixtureData(now);
    return { now, site: SITE, plant: PLANT, tariff: PRICED, loading: false, pv, forecast, ...extra };
}

/** Predpoveď zmenšená na zlomok vo vybraných dňoch (predvolene všetky); meranie sa zahodí. @param {number} k @param {number[]} [dayIdx] */
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
/** Riadok podľa id. @param {Array<{ id: string }>} rows @param {string} id */
const row = (rows, id) => /** @type {any} */ (rows.find((r) => r.id === id));

test('9:00 za jasna: každý na slnku, sušička po práčke, ohrevy sa neprekrývajú', () => {
    const i = input(at('09:00'));
    const ctx = dayCtx(i);
    const rows = planDna(ctx, '€', ALL);
    assert.deepEqual(
        rows.map((r) => r.kind),
        ['sun', 'sun', 'sun', 'sun', 'sun'],
    );
    const [pracka, susicka] = [row(rows, 'pracka'), row(rows, 'susicka')];
    assert.equal(pracka.start, 9 * 60, 'práčka hneď');
    assert.ok(susicka.start >= pracka.end, 'sušička až keď práčka dobehne');
    assert.equal(susicka.after, 'pracka');
    // Ohrevy (plný príkon) dvoch vecí nikdy naraz.
    const heats = rows
        .filter((r) => r.kind === 'sun' && r.id !== 'auto')
        .flatMap((r) => (MOZEM_ITEMS.find((m) => m.id === r.id)?.heat ?? []).map(([a, b]) => [r.start + a, r.start + b]));
    for (const [a, b] of heats) for (const [c, d] of heats) if (a !== c || b !== d) assert.ok(b <= c || d <= a, `${a}-${b} a ${c}-${d}`);
    const auto = row(rows, 'auto');
    assert.ok(auto.end - auto.start >= PLAN_DNA.autoMinMin);
    assert.ok(auto.km > 0 && auto.save > 0);
    for (const [a, b] of heats) assert.ok(b <= auto.start || auto.end <= a, 'auto nenabíja, kým beží ohrev');
});

test('model: riadky podľa času, teraz pri tom, čo je na rade, cena len pri aute', () => {
    const m = planDnaModel(input(at('09:00')), { devices: ALL });
    assert.ok(m);
    const starts = m.rows.map((r) => (r.kind === 'sun' ? r.start : 0));
    assert.deepEqual(
        starts,
        [...starts].sort((a, b) => a - b),
    );
    assert.equal(m.rows[0].name, 'Práčka');
    assert.equal(m.rows[0].time, '09:00');
    assert.equal(m.rows[0].why, 'ohrev chytí slnko');
    assert.ok(m.rows[0].now);
    assert.equal(m.rows.filter((r) => r.now).length, 1);
    assert.equal(row(m.rows, 'susicka').why, 'po práčke, celá zo strechy');
    assert.equal(row(m.rows, 'umyvacka').why, 'oba ohrevy chytia slnko');
    assert.equal(row(m.rows, 'bojler').why, 'celý zo strechy');
    const auto = row(m.rows, 'auto');
    assert.match(auto.time, /^\d\d:\d\d–\d\d:\d\d$/);
    assert.match(auto.why, /^~\d+ km zo slnka, ušetríš ~\d+ €$/);
    for (const r of m.rows.filter((x) => x.id !== 'auto')) assert.doesNotMatch(r.why, /€/, `${r.id} bez ceny`);
    assert.equal(m.note, PLAN_DNA_NOTE);
    const slusne = planDnaModel(input(at('09:00')), { devices: ALL, voice: 'slusny' });
    assert.match(row(slusne?.rows ?? [], 'auto').why, /ušetríte/);
});

test('predvolene bez bojlera; bez predpovede alebo elektrárne plán nie je', () => {
    const m = planDnaModel(input(at('09:00')));
    assert.deepEqual(m?.rows.map((r) => r.id).sort(), [...PLAN_DNA.devices].sort());
    // Ráno je medzi ohrevom práčky a umývačky hodinová medzera; auto má dostať dlhé poobedie.
    const auto = row(m?.rows ?? [], 'auto');
    assert.ok(auto.start >= 12 * 60 && auto.end - auto.start >= 3 * 60, `auto ${auto.start}-${auto.end}`);
    assert.equal(planDnaModel(input(at('09:00'), { forecast: null })), null);
    assert.equal(planDnaModel(input(at('09:00'), { known: 'nic' })), null);
});

test('večer: auto a bojler do lacného pásma, ostatné zajtra', () => {
    const m = planDnaModel(input(at('19:50')), { devices: ALL });
    assert.equal(row(m?.rows ?? [], 'auto').kind, 'cheap');
    assert.match(row(m?.rows ?? [], 'bojler').time, /^od \d\d:\d\d$/);
    const pracka = row(m?.rows ?? [], 'pracka');
    assert.equal(pracka.kind, 'later');
    assert.match(pracka.time, /^zajtra \d\d:\d\d$/);
    assert.equal(pracka.why, 'dnes slnko nestačí');
    assert.equal(pracka.tone, 'wait');
    assert.equal(m?.rows.at(-1)?.kind, 'later', 'iné dni až za dneškom');
});

test('slabý deň: umývačka a sušička čakajú na iný deň, auto bez ceny v tarife', () => {
    const forecast = cloudy(0.05, [0, 1]);
    const i = input(at('09:00'), { pv: null, forecast, tariff: FLAT });
    assert.ok(forecast.days[0].peakKw < powerThresholds(PLANT).weakPeakKw);
    const m = planDnaModel(i, { devices: ALL });
    const rows = m?.rows ?? [];
    for (const id of ['umyvacka', 'susicka']) {
        assert.equal(row(rows, id).kind, 'later');
        assert.notEqual(row(rows, id).day.index, 1, 'zajtra je tiež slabý deň');
        assert.equal(row(rows, id).tone, 'no');
    }
    assert.notEqual(row(rows, 'pracka').kind, 'sun');
    assert.notEqual(row(rows, 'auto').kind, 'sun');
});

test('celý týždeň bez slnka a bez lacného pásma: tento týždeň nie', () => {
    const m = planDnaModel(input(at('09:00'), { pv: null, forecast: cloudy(0.01), tariff: FLAT }), { devices: ALL });
    for (const r of m?.rows ?? []) {
        assert.equal(r.kind, 'none');
        assert.equal(r.time, 'tento týždeň nie');
    }
});

test('auto na slnku bez ceny v tarife: len km', () => {
    const m = planDnaModel(input(at('09:00'), { tariff: FLAT }), { devices: ['auto'] });
    assert.match(row(m?.rows ?? [], 'auto').why, /^~\d+ km zo slnka$/);
});
