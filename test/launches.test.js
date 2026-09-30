import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAUNCH, PLANT, SITE, TARIFF } from '../shared/config.js';
import { canLog, monthCount, parseLaunches, runMinOf, runningLaunch, toggleLaunch } from '../shared/launches.js';
import { deviceShorts, mozemModel } from '../shared/mozem.js';
import { FIXED_NOW, fixtureData } from './helpers.js';

const DAY = '2026-09-05';
const pracka = (/** @type {number} */ m, sun = true, d = DAY) => ({ d, id: 'pracka', m, sun });

test('parseLaunches: z úložiska prejde len to, čo sedí, a najviac LAUNCH.limit', () => {
    const raw = [
        pracka(600),
        { d: DAY, id: 'hranie', m: 600, sun: true },
        { d: '5.9.2026', id: 'pracka', m: 600, sun: true },
        { d: DAY, id: 'pracka', m: 1440, sun: true },
        { d: DAY, id: 'pracka', m: 10.5, sun: true },
        { d: DAY, id: 'auto', m: 30, sun: 'nie' },
        null,
        { d: DAY, id: 'auto', m: 30, sun: false, extra: 1 },
    ];
    assert.deepEqual(parseLaunches(raw), [pracka(600), { d: DAY, id: 'auto', m: 30, sun: false }]);
    assert.deepEqual(parseLaunches('nie pole'), []);
    const many = Array.from({ length: LAUNCH.limit + 5 }, (_, i) => pracka(i % 1440));
    assert.equal(parseLaunches(many).length, LAUNCH.limit);
});

test('canLog a runMinOf: spotrebiče áno, hranie nie; auto má náhradnú dĺžku', () => {
    assert.equal(canLog('pracka'), true);
    assert.equal(canLog('fen'), false);
    assert.equal(runMinOf('pracka'), 120);
    assert.equal(runMinOf('auto'), LAUNCH.autoRunMin);
});

test('runningLaunch: beží od spustenia po koniec programu, len v ten deň', () => {
    const list = [pracka(600), pracka(780)];
    assert.equal(runningLaunch(list, 'pracka', DAY, 800), list[1]);
    assert.equal(runningLaunch(list, 'pracka', DAY, 900), null, 'po 2 hodinách už nebeží');
    assert.equal(runningLaunch(list, 'pracka', '2026-09-06', 800), null);
    assert.equal(runningLaunch(list, 'susicka', DAY, 800), null);
});

test('toggleLaunch: pridá, kým beží, druhé ťuknutie zruší; pôvodný zoznam sa nemení', () => {
    const one = toggleLaunch([], pracka(780));
    assert.deepEqual(one, [pracka(780)]);
    const undone = toggleLaunch(one, pracka(790));
    assert.deepEqual(undone, [], 'preklep sa dá vziať späť');
    assert.deepEqual(one, [pracka(780)]);
    assert.equal(toggleLaunch(one, pracka(950)).length, 2, 'po dobehnutí je to nové spustenie');
});

test('monthCount: všetky v mesiaci a z nich na slnku', () => {
    const list = [pracka(600), pracka(1200, false), pracka(600, true, '2026-08-31')];
    assert.deepEqual(monthCount(list, '2026-09'), { all: 2, sun: 1 });
    assert.deepEqual(monthCount(list, '2026-10'), { all: 0, sun: 0 });
});

test('mozemModel so zápismi: beží, tlačidlo zapísané a mesačný riadok', () => {
    const { pv, forecast } = fixtureData(FIXED_NOW);
    const input = { now: FIXED_NOW, site: SITE, plant: PLANT, tariff: TARIFF, kiosk: '', loading: false, pv, forecast };
    const bez = mozemModel(input);
    const pr = bez.items.find((i) => i.id === 'pracka');
    assert.deepEqual(pr?.log, { sun: true, pressed: false, label: 'Pustil/a som' });
    assert.equal(bez.items.find((i) => i.id === 'hranie')?.log, null);
    assert.equal(bez.count, '');

    const s = mozemModel(input, 0, [pracka(770), pracka(600, false, '2026-09-01')]);
    const bezi = s.items.find((i) => i.id === 'pracka');
    assert.equal(bezi?.short, 'beží do 14:50');
    assert.equal(bezi?.log?.pressed, true);
    assert.equal(deviceShorts(input, [pracka(770)])['Práčka'], 'beží do 14:50', 'tooltip na Terazky vie, že beží');
    assert.match(bezi?.log?.label || '', /^Zapísané o 12:50/);
    assert.equal(s.count, 'Tento mesiac si pustil/a 2× niečo, z toho 1× na slnku.');
    const auto = mozemModel(input, 0, [{ d: DAY, id: 'auto', m: 770, sun: true }]).items.find((i) => i.id === 'auto');
    assert.match(auto?.short || '', /^nabíja sa do /);
});

test('mozemModel: keď appka radí počkať, tlačidlo je „aj tak“ a nie na slnku', () => {
    const now = new Date('2026-09-05T05:30:00+02:00');
    const { pv, forecast } = fixtureData(now);
    const m = mozemModel({ now, site: SITE, plant: PLANT, tariff: TARIFF, kiosk: '', loading: false, pv, forecast });
    const pr = m.items.find((i) => i.id === 'pracka');
    assert.deepEqual(pr?.log, { sun: false, pressed: false, label: 'Pustil/a som aj tak' });
    assert.equal(m.items.find((i) => i.id === 'auto')?.log?.label, 'Zapojil/a som aj tak');
});
