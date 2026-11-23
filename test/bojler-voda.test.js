// Teplota vody v bojleri (docs/navrhy/bojler-teplota.html): body vo Workeri, dnešok pre appku a krivka v paneli.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    hranicaZ,
    krivkaVody,
    posunHranicu,
    pridajTeplotu,
    strazVodu,
    stupne,
    teplotaZ,
    teplotyDna,
    vodaTeraz,
} from '../shared/bojler-voda.js';
import { BOJLER } from '../shared/config.js';

const MIN = 60 * 1000;
const TZ = 'Europe/Bratislava';

test('teplota od zásuvky: len rozumné číslo, na desatiny', () => {
    assert.equal(teplotaZ(60.53), 60.5);
    assert.equal(teplotaZ(-5), -5);
    assert.deepEqual([teplotaZ(null), teplotaZ('60'), teplotaZ(Number.NaN), teplotaZ(-85), teplotaZ(127)], [null, null, null, null, null]);
});

test('body: nový bod najskôr po BOJLER.vodaKrokMin minútach, staré po BOJLER.vodaDni dňoch odpadnú', () => {
    const t0 = Date.UTC(2026, 10, 23, 10, 0);
    let body = pridajTeplotu([], 60.5, t0);
    assert.deepEqual(body, [[t0 / MIN, 605]]);
    assert.equal(pridajTeplotu(body, 61, t0 + (BOJLER.vodaKrokMin - 1) * MIN), body, 'skoro - bez zmeny');
    assert.equal(pridajTeplotu(body, null, t0 + 60 * MIN), body, 'bez teploty - bez zmeny');
    body = pridajTeplotu(body, 61, t0 + BOJLER.vodaKrokMin * MIN);
    assert.equal(body.length, 2);
    const neskor = t0 + BOJLER.vodaDni * 24 * 60 * MIN + MIN;
    assert.deepEqual(pridajTeplotu(body, 50, neskor), [body[1], [neskor / MIN, 500]]);
});

test('dnešné body: len dnešok v miestnom čase, minúta dňa a °C', () => {
    // 22. 11. 23:00 SEČ je ešte včera, 23. 11. 0:05 a 7:30 dnes.
    const body = /** @type {import('../shared/bojler-voda.js').BodyVody} */ ([
        [Date.UTC(2026, 10, 22, 22, 0) / MIN, 580],
        [Date.UTC(2026, 10, 22, 23, 5) / MIN, 575],
        [Date.UTC(2026, 10, 23, 6, 30) / MIN, 440],
    ]);
    assert.deepEqual(teplotyDna(body, new Date(Date.UTC(2026, 10, 23, 13, 0)), TZ), [
        [5, 57.5],
        [450, 44],
    ]);
});

test('teplota teraz: len kým nie je staršia ako BOJLER.tichoMin', () => {
    const now = Date.UTC(2026, 10, 23, 13, 0);
    const voda = { t: 60, at: now - BOJLER.tichoMin * MIN };
    assert.equal(vodaTeraz({ voda }, now), voda);
    assert.equal(vodaTeraz({ voda }, now + MIN), null);
    assert.equal(vodaTeraz({}, now), null);
    assert.equal(stupne(67.6), '68 °C');
});

test('krivka: úseky po medzerách, plocha, čiara cieľa, bod teraz a popis', () => {
    assert.equal(krivkaVody([[0, 50]], 55), null);
    const k = /** @type {NonNullable<ReturnType<typeof krivkaVody>>} */ (
        krivkaVody(
            [
                [0, 58],
                [5, 57.5],
                [420, 44],
                [425, 43.5],
                [430, 44.2],
                [845, 67.6],
            ],
            55,
        )
    );
    assert.equal(k.ciary.length, 3, 'medzera dlhšia ako 20 min čiaru preruší');
    assert.equal(k.plochy.length, 3);
    assert.match(k.plochy[0], /Z$/);
    assert.equal(k.ciel?.text, 'hranica 55 °C');
    assert.equal(
        krivkaVody(
            k.ticks.map((_, i) => [i * 5, 50]),
            null,
        )?.ciel,
        null,
        'bez hranice čiara nie je',
    );
    assert.ok(k.ciel && k.ciel.y > 0 && k.ciel.y < k.h);
    assert.deepEqual(k.bod.text, '68 °C');
    assert.equal(k.bod.x, Math.round((845 / 1440) * k.w * 10) / 10);
    assert.deepEqual(
        k.ticks.map((t) => t.label),
        ['0', '6', '12', '18', '24'],
    );
    assert.equal(k.popis, 'Teplota vody dnes od 43,5 do 67,6 °C, naposledy 67,6 °C.');
    // Cieľ mimo rozsahu krivky sa nekreslí, rozsah sa rozšíri podľa teplôt.
    const horuca = krivkaVody(
        [
            [0, 20],
            [5, 85],
        ],
        10,
    );
    assert.equal(horuca?.ciel, null);
});

test('hranica: rozsah, posun a stráženie s návratom o BOJLER.vodaHystC nižšie', () => {
    assert.equal(hranicaZ(60), 60);
    assert.deepEqual(
        [hranicaZ(60.5), hranicaZ(BOJLER.vodaMinC - 1), hranicaZ(BOJLER.vodaMaxC + 1), hranicaZ('60'), hranicaZ(null)],
        [null, null, null, null, null],
    );
    assert.equal(posunHranicu(null, 1), BOJLER.vodaStartC);
    assert.equal(posunHranicu(null, -1), null);
    assert.equal(posunHranicu(60, 1), 61);
    assert.equal(posunHranicu(BOJLER.vodaMinC, -1), null);
    assert.equal(posunHranicu(BOJLER.vodaMaxC, 1), BOJLER.vodaMaxC);
    assert.equal(strazVodu(false, 60, 60), true);
    assert.equal(strazVodu(true, 57, 60), true, 'medzi hranicou a návratom ostáva');
    assert.equal(strazVodu(false, 57, 60), false);
    assert.equal(strazVodu(true, 60 - BOJLER.vodaHystC, 60), false, 'na návrate pustí');
    assert.equal(strazVodu(true, null, 60), false, 'teplomer mlčí - stráži termostat');
    assert.equal(strazVodu(true, 70, null), false, 'bez hranice');
});
