import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BEZI } from '../shared/config.js';
import {
    behyVeci,
    beziaci,
    daSaZapisat,
    parseBezi,
    nastav,
    navrhBehu,
    parseCaka,
    prevezmi,
    vratBehy,
    zapisZmeny,
    zoZvysku,
    zrus,
} from '../shared/bezi.js';

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

test('nastav bez zmeny času: nový beh od teraz po dĺžke programu, dobehnuté behy dňa nechá, bežiaci nahradí, iné dni zahodí', () => {
    const list = [
        { id: 'pracka', d: '2026-09-04', m: 600, k: 720 },
        { id: 'pracka', d: D, m: 420, k: 540 },
        { id: 'umyvacka', d: D, m: 500, k: 650 },
    ];
    const z = nastav(list, 'pracka', D, 560, null);
    assert.deepEqual(z, [
        { id: 'pracka', d: D, m: 420, k: 540 },
        { id: 'umyvacka', d: D, m: 500, k: 650 },
        { id: 'pracka', d: D, m: 560, k: 680 },
    ]);
    assert.deepEqual(
        nastav(z, 'pracka', D, 570, null).filter((x) => x.id === 'pracka'),
        [
            { id: 'pracka', d: D, m: 420, k: 540 },
            { id: 'pracka', d: D, m: 560, k: 680 },
        ],
        'bežiaci beh bez zmeny ostane, ako je',
    );
    assert.deepEqual(beziaci(z, 'pracka', D, 600), { id: 'pracka', d: D, m: 560, k: 680 });
    assert.equal(beziaci(z, 'pracka', D, 680), null, 'v minúte konca už dobehla');
    assert.equal(beziaci(z, 'susicka', D, 600), null);
});

test('navrhBehu: práčka a sušička zo zvyšku programu v hraniciach, začiatok podľa dĺžky programu, nie pred polnoc', () => {
    assert.deepEqual(navrhBehu([], 'pracka', D, 600), { id: 'pracka', d: D, m: 600, k: 720 }, 'nebeží: od teraz po dĺžke programu');
    assert.deepEqual(navrhBehu([], 'pracka', D, 600, 60), { id: 'pracka', d: D, m: 540, k: 660 }, 'kratší zvyšok: začala skôr');
    assert.deepEqual(navrhBehu([], 'pracka', D, 600, 180), { id: 'pracka', d: D, m: 600, k: 780 }, 'dlhší program začal teraz');
    assert.equal(navrhBehu([], 'pracka', D, 600, 0).k, 600 + BEZI.minZvysokMin, 'najmenej minZvysokMin');
    // Posledná minúta programu sa dá nastaviť a spotrebič ešte beží.
    const posledna = nastav([], 'pracka', D, 600, 1);
    assert.deepEqual(beziaci(posledna, 'pracka', D, 600), { id: 'pracka', d: D, m: 481, k: 601 });
    assert.equal(navrhBehu([], 'pracka', D, 600, 999).k, 600 + BEZI.maxZvysokMin, 'najviac maxZvysokMin');
    assert.equal(navrhBehu([], 'pracka', D, 50, 10).m, 0, 'nie pred polnoc');
    const list = [{ id: 'susicka', d: D, m: 500, k: 650 }];
    assert.equal(navrhBehu(list, 'susicka', D, 600).k, 650, 'bežiaci beh bez zmeny: jeho koniec');
});

test('navrhBehu: umývačka od času zapnutia, nie pred polnoc ani po teraz, koniec po dĺžke programu či bežiaceho behu', () => {
    const dlzka = navrhBehu([], 'umyvacka', D, 600).k - 600;
    assert.deepEqual(navrhBehu([], 'umyvacka', D, 600), { id: 'umyvacka', d: D, m: 600, k: 600 + dlzka }, 'nebeží: od teraz');
    assert.deepEqual(navrhBehu([], 'umyvacka', D, 600, 540), { id: 'umyvacka', d: D, m: 540, k: 540 + dlzka });
    assert.equal(navrhBehu([], 'umyvacka', D, 600, 700).m, 600, 'najviac teraz');
    assert.equal(navrhBehu([], 'umyvacka', D, 600, -30).m, 0, 'najmenej polnoc');
    const list = [{ id: 'umyvacka', d: D, m: 560, k: 660 }];
    assert.deepEqual(navrhBehu(list, 'umyvacka', D, 600), list[0], 'bežiaci beh bez zmeny');
    assert.deepEqual(navrhBehu(list, 'umyvacka', D, 600, 500), { id: 'umyvacka', d: D, m: 500, k: 600 }, 'dĺžka bežiaceho behu');
});

test('nastav: nastavený čas nahradí bežiaci beh, dobehnuté nechá', () => {
    const list = [
        { id: 'pracka', d: D, m: 300, k: 420 },
        { id: 'pracka', d: D, m: 560, k: 680 },
    ];
    assert.deepEqual(nastav(list, 'pracka', D, 600, 155), [list[0], { id: 'pracka', d: D, m: 600, k: 755 }]);
    assert.deepEqual(nastav(list, 'umyvacka', D, 600, 540).at(-1), navrhBehu([], 'umyvacka', D, 600, 540));
});

test('vratBehy: behy spotrebiča v ten deň budú zas tie pred zmenou, ostatné ostanú', () => {
    const pred = [{ id: 'pracka', d: D, m: 420, k: 540 }];
    const po = nastav([...pred, { id: 'umyvacka', d: D, m: 500, k: 650 }], 'pracka', D, 600, 60);
    assert.deepEqual(vratBehy(po, 'pracka', D, pred), [pred[0], { id: 'umyvacka', d: D, m: 500, k: 650 }]);
    assert.deepEqual(vratBehy(po, 'pracka', D, []), [{ id: 'umyvacka', d: D, m: 500, k: 650 }], 'pred zmenou nebežala');
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

test('parseCaka: len platný spotrebič a deň, každý raz', () => {
    assert.deepEqual(parseCaka(null), []);
    assert.deepEqual(
        parseCaka([
            { id: 'pracka', d: D },
            { id: 'pracka', d: D },
            { id: 'bojler', d: D },
            { id: 'susicka', d: '5. 9.' },
            null,
            { id: 'umyvacka', d: D },
        ]),
        [
            { id: 'pracka', d: D },
            { id: 'umyvacka', d: D },
        ],
    );
});

test('behyVeci: behy jedného spotrebiča v ten deň', () => {
    const list = [
        { id: 'pracka', d: D, m: 420, k: 540 },
        { id: 'pracka', d: '2026-09-04', m: 420, k: 540 },
        { id: 'umyvacka', d: D, m: 500, k: 650 },
    ];
    assert.deepEqual(behyVeci(list, 'pracka', D), [list[0]]);
});

test('zapisZmeny: behy spotrebiča v deň zmeny nahradí, iné nechá, staršie dni a nezmysly zahodí', () => {
    const spolocne = [
        { id: 'pracka', d: '2026-09-04', m: 600, k: 720 },
        { id: 'pracka', d: D, m: 420, k: 540 },
        { id: 'umyvacka', d: D, m: 500, k: 650 },
    ];
    const zmeny = [
        {
            id: 'pracka',
            d: D,
            behy: [
                { id: 'pracka', d: D, m: 420, k: 540 },
                { id: 'pracka', d: D, m: 600, k: 720 },
                { id: 'susicka', d: D, m: 600, k: 700 },
            ],
        },
        { id: 'bojler', d: D, behy: [{ id: 'bojler', d: D, m: 600, k: 700 }] },
        { id: 'susicka', d: 'zajtra', behy: [] },
        null,
    ];
    assert.deepEqual(zapisZmeny(spolocne, zmeny, D), [
        { id: 'pracka', d: D, m: 420, k: 540 },
        { id: 'umyvacka', d: D, m: 500, k: 650 },
        { id: 'pracka', d: D, m: 600, k: 720 },
    ]);
    // „Nebeží“: prázdne behy spotrebič zo zoznamu odstránia.
    assert.deepEqual(zapisZmeny(spolocne, [{ id: 'umyvacka', d: D, behy: [] }], D), [{ id: 'pracka', d: D, m: 420, k: 540 }]);
    // Bez zmien len prečistí; zlé vstupy nič nezhodia.
    assert.deepEqual(zapisZmeny(spolocne, undefined, D), spolocne.slice(1));
    assert.deepEqual(zapisZmeny('x', 'y', D), []);
    // Viac zmien než spotrebičov telefón neposiela - zvyšok sa ignoruje.
    const vela = Array.from({ length: BEZI.veci.length + 1 }, () => ({ id: 'umyvacka', d: D, behy: [] }));
    vela[BEZI.veci.length] = { id: 'susicka', d: D, behy: [{ id: 'susicka', d: D, m: 600, k: 700 }] };
    assert.deepEqual(zapisZmeny([], vela, D), []);
});

test('prevezmi: dnešné behy od Workera, nepotvrdené spotrebiče z telefónu', () => {
    const lokalne = [
        { id: 'pracka', d: D, m: 600, k: 720 },
        { id: 'umyvacka', d: D, m: 500, k: 650 },
        { id: 'susicka', d: '2026-09-04', m: 500, k: 600 },
    ];
    const zWorkera = [
        { id: 'pracka', d: D, m: 420, k: 540 },
        { id: 'susicka', d: D, m: 700, k: 800 },
        { id: 'umyvacka', d: '2026-09-04', m: 500, k: 650 },
        { id: 'auto', d: D, m: 1, k: 2 },
    ];
    assert.deepEqual(prevezmi(lokalne, zWorkera, [{ id: 'pracka', d: D }], D), [
        { id: 'pracka', d: D, m: 600, k: 720 },
        { id: 'susicka', d: D, m: 700, k: 800 },
    ]);
    // Nepotvrdená zmena iného dňa sa nepočíta.
    assert.deepEqual(prevezmi(lokalne, zWorkera, [{ id: 'pracka', d: '2026-09-04' }], D), [
        { id: 'pracka', d: D, m: 420, k: 540 },
        { id: 'susicka', d: D, m: 700, k: 800 },
    ]);
    assert.deepEqual(prevezmi(lokalne, null, [], D), []);
});
