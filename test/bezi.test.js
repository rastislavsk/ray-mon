import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BEZI } from '../shared/config.js';
import { beziaci, daSaZapisat, parseBezi, posun, zapol, zoZvysku, zrus, zvysok } from '../shared/bezi.js';

const D = '2026-09-05';

test('parseBezi: z úložiska len platné behy, ten istý začiatok raz, platí posledný, podľa dňa a začiatku', () => {
    assert.deepEqual(parseBezi(null), []);
    assert.deepEqual(parseBezi({ id: 'pracka' }), []);
    assert.deepEqual(
        parseBezi([
            { id: 'pracka', d: D, m: 700, k: 820 },
            { id: 'bojler', d: D, m: 480 },
            { id: 'auto', d: D, m: 480 },
            { id: 'umyvacka', d: '5. 9.', m: 480 },
            { id: 'susicka', d: D, m: 1440 },
            { id: 'susicka', d: D, m: -1 },
            { id: 'susicka', d: D, m: 8.5 },
            { id: 'susicka', d: D, m: 600, k: 600 },
            { id: 'susicka', d: D, m: 600, k: 600 + 24 * 60 + 1 },
            { id: 'susicka', d: D, m: 600, k: '700' },
            { id: 'umyvacka', d: D },
            'pracka',
            null,
            { id: 'pracka', d: D, m: 500, k: 600 },
            { id: 'pracka', d: D, m: 500, k: 610 },
            { id: 'umyvacka', d: '2026-09-04', m: 1400, k: 1550 },
        ]),
        [
            { id: 'umyvacka', d: '2026-09-04', m: 1400, k: 1550 },
            { id: 'pracka', d: D, m: 500, k: 610 },
            { id: 'pracka', d: D, m: 700, k: 820 },
        ],
    );
});

test('parseBezi: zápis bez konca zo staršej appky skončí po dĺžke programu', () => {
    assert.deepEqual(parseBezi([{ id: 'pracka', d: D, m: 480 }]), [{ id: 'pracka', d: D, m: 480, k: 600 }]);
});

test('daSaZapisat a zoZvysku: zapísať práčku, sušičku a umývačku, zvyšok len pri práčke a sušičke', () => {
    for (const id of BEZI.veci) assert.ok(daSaZapisat(id), id);
    assert.equal(daSaZapisat('bojler'), false);
    assert.equal(daSaZapisat('auto'), false);
    assert.deepEqual(
        BEZI.veci.filter((id) => zoZvysku(id)),
        ['pracka', 'susicka'],
    );
});

test('zapol: nový beh po dĺžke programu, dobehnuté behy dňa nechá, bežiaci nahradí, iné dni zahodí', () => {
    const list = [
        { id: 'pracka', d: '2026-09-04', m: 600, k: 720 },
        { id: 'pracka', d: D, m: 420, k: 540 },
        { id: 'umyvacka', d: D, m: 500, k: 650 },
    ];
    const z = zapol(list, 'pracka', D, 560);
    assert.deepEqual(z, [
        { id: 'pracka', d: D, m: 420, k: 540 },
        { id: 'umyvacka', d: D, m: 500, k: 650 },
        { id: 'pracka', d: D, m: 560, k: 680 },
    ]);
    assert.deepEqual(
        zapol(z, 'pracka', D, 570).filter((x) => x.id === 'pracka'),
        [
            { id: 'pracka', d: D, m: 420, k: 540 },
            { id: 'pracka', d: D, m: 570, k: 690 },
        ],
    );
    assert.deepEqual(beziaci(z, 'pracka', D, 600), { id: 'pracka', d: D, m: 560, k: 680 });
    assert.equal(beziaci(z, 'pracka', D, 680), null, 'v minúte konca už dobehla');
    assert.equal(beziaci(z, 'susicka', D, 600), null);
});

test('zrus: zmizne len beh, ktorý ešte beží', () => {
    const list = [
        { id: 'pracka', d: D, m: 420, k: 540 },
        { id: 'pracka', d: D, m: 560, k: 680 },
    ];
    assert.deepEqual(zrus(list, 'pracka', D, 600), [list[0]]);
    assert.deepEqual(zrus(list, 'pracka', '2026-09-06', 600), list);
    assert.deepEqual(zrus(list, 'pracka', D, 700), list);
});

test('posun: čas zapnutia bežiaceho behu o BEZI.posunMin, koniec ide s ním, nie pred polnoc ani po teraz', () => {
    const list = [
        { id: 'umyvacka', d: D, m: 300, k: 450 },
        { id: 'umyvacka', d: D, m: 540, k: 690 },
        { id: 'pracka', d: D, m: 10, k: 130 },
    ];
    assert.deepEqual(posun(list, 'umyvacka', D, -1, 600)[1], { id: 'umyvacka', d: D, m: 540 - BEZI.posunMin, k: 690 - BEZI.posunMin });
    assert.deepEqual(posun(list, 'umyvacka', D, 1, 600)[1], { id: 'umyvacka', d: D, m: 540 + BEZI.posunMin, k: 690 + BEZI.posunMin });
    assert.equal(posun(list, 'umyvacka', D, 1, 545)[1].m, 545, 'najviac teraz');
    assert.equal(posun(list, 'pracka', D, -1, 60)[2].m, 0, 'najmenej polnoc');
    assert.deepEqual(posun(list, 'umyvacka', D, -1, 600)[0], list[0], 'dobehnutý beh ostane');
    assert.deepEqual(posun(list, 'susicka', D, -1, 600), list);
});

test('zvysok: koniec bežiaceho behu o hodinu či BEZI.krokMin, zvyšok v hraniciach, začiatok podľa dĺžky programu', () => {
    const list = [{ id: 'pracka', d: D, m: 600, k: 720 }];
    assert.deepEqual(zvysok(list, 'pracka', D, 60, 600), [{ id: 'pracka', d: D, m: 600, k: 780 }], 'dlhší program začal teraz');
    assert.deepEqual(zvysok(list, 'pracka', D, -60, 600), [{ id: 'pracka', d: D, m: 540, k: 660 }], 'kratší začal skôr');
    assert.equal(zvysok(list, 'pracka', D, -BEZI.krokMin, 600)[0].k, 720 - BEZI.krokMin);
    assert.equal(zvysok(list, 'pracka', D, -600, 600)[0].k, 600 + BEZI.minZvysokMin, 'najmenej minZvysokMin');
    assert.equal(zvysok(list, 'pracka', D, 600, 600)[0].k, 600 + BEZI.maxZvysokMin, 'najviac maxZvysokMin');
    assert.equal(zvysok([{ id: 'pracka', d: D, m: 30, k: 100 }], 'pracka', D, -60, 50)[0].m, 0, 'nie pred polnoc');
    assert.deepEqual(zvysok(list, 'pracka', D, 60, 800), list, 'dobehnutý beh nemení');
});
