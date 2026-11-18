import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BEZI } from '../shared/config.js';
import { daSaZapisat, parseBezi, posun, zapisVeci, zapol, zrus } from '../shared/bezi.js';

const D = '2026-09-05';

test('parseBezi: z úložiska len platné zápisy, spotrebič raz za deň, platí posledný', () => {
    assert.deepEqual(parseBezi(null), []);
    assert.deepEqual(parseBezi({ id: 'pracka' }), []);
    assert.deepEqual(
        parseBezi([
            { id: 'pracka', d: D, m: 480 },
            { id: 'bojler', d: D, m: 480 },
            { id: 'auto', d: D, m: 480 },
            { id: 'umyvacka', d: '5. 9.', m: 480 },
            { id: 'susicka', d: D, m: 1440 },
            { id: 'susicka', d: D, m: -1 },
            { id: 'susicka', d: D, m: 8.5 },
            { id: 'umyvacka', d: D },
            'pracka',
            null,
            { id: 'pracka', d: D, m: 500 },
        ]),
        [{ id: 'pracka', d: D, m: 500 }],
    );
});

test('daSaZapisat: práčka, sušička a umývačka áno, bojler a auto nie', () => {
    for (const id of BEZI.veci) assert.ok(daSaZapisat(id), id);
    assert.equal(daSaZapisat('bojler'), false);
    assert.equal(daSaZapisat('auto'), false);
});

test('zapol, zrus a zapisVeci: zápis toho dňa nahradí, iné dni zahodí', () => {
    const list = [
        { id: 'pracka', d: '2026-09-04', m: 600 },
        { id: 'umyvacka', d: D, m: 420 },
    ];
    const z = zapol(list, 'pracka', D, 540);
    assert.deepEqual(z, [
        { id: 'umyvacka', d: D, m: 420 },
        { id: 'pracka', d: D, m: 540 },
    ]);
    assert.deepEqual(
        zapol(z, 'pracka', D, 560).filter((x) => x.id === 'pracka'),
        [{ id: 'pracka', d: D, m: 560 }],
    );
    assert.deepEqual(zapisVeci(z, 'pracka', D), { id: 'pracka', d: D, m: 540 });
    assert.equal(zapisVeci(z, 'susicka', D), null);
    assert.deepEqual(zrus(z, 'pracka', D), [{ id: 'umyvacka', d: D, m: 420 }]);
    assert.deepEqual(zrus(z, 'pracka', '2026-09-06'), z);
});

test('posun: o BEZI.posunMin skôr či neskôr, nie pred polnoc ani po teraz, iné zápisy nechá', () => {
    const list = [
        { id: 'pracka', d: D, m: 540 },
        { id: 'umyvacka', d: D, m: 10 },
    ];
    assert.equal(posun(list, 'pracka', D, -1, 600)[0].m, 540 - BEZI.posunMin);
    assert.equal(posun(list, 'pracka', D, 1, 600)[0].m, 540 + BEZI.posunMin);
    assert.equal(posun(list, 'pracka', D, 1, 545)[0].m, 545, 'najviac teraz');
    assert.equal(posun(list, 'umyvacka', D, -1, 600)[1].m, 0, 'najmenej polnoc');
    assert.deepEqual(posun(list, 'pracka', D, -1, 600)[1], list[1]);
    assert.deepEqual(posun(list, 'susicka', D, -1, 600), list);
});
