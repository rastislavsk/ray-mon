import { test } from 'node:test';
import assert from 'node:assert/strict';
import { polovicaDlazdice, stlpceDlazdic } from '../shared/teraz-stlpce.js';

/** @param {...string} ids */
const veci = (...ids) => ids.map((id) => ({ id }));
/** @param {{ lavy: Array<Array<{ id: string }>>, pravy: Array<Array<{ id: string }>> }} s */
const ids = (s) => ({ lavy: s.lavy.map((b) => b.map((v) => v.id)), pravy: s.pravy.map((b) => b.map((v) => v.id)) });

test('stlpceDlazdic: vľavo dvojica a umývačka podľa poradia, vpravo bojler nad autom', () => {
    assert.deepEqual(ids(stlpceDlazdic(veci('auto', 'umyvacka', 'pracka', 'bojler', 'susicka'))), {
        lavy: [['umyvacka'], ['pracka', 'susicka']],
        pravy: [['bojler'], ['auto']],
    });
    assert.deepEqual(ids(stlpceDlazdic(veci('pracka', 'auto', 'umyvacka', 'susicka'))), {
        lavy: [['pracka', 'susicka'], ['umyvacka']],
        pravy: [['auto']],
    });
});

test('stlpceDlazdic: v dvojici hore to, čo je v poradí skôr (sušička beží, práčka dobehla)', () => {
    assert.deepEqual(ids(stlpceDlazdic(veci('susicka', 'umyvacka', 'pracka'))).lavy, [['susicka', 'pracka'], ['umyvacka']]);
});

test('stlpceDlazdic: z dvojice bez druhej veci je celá dlaždica, neznáma vec ide do ľavého stĺpca', () => {
    assert.deepEqual(ids(stlpceDlazdic(veci('rura', 'susicka', 'bojler'))), {
        lavy: [['rura'], ['susicka']],
        pravy: [['bojler']],
    });
    assert.deepEqual(stlpceDlazdic([]), { lavy: [], pravy: [] });
});

test('polovicaDlazdice: jedna odrážka, odznak ju nahradí', () => {
    assert.deepEqual(polovicaDlazdice({ odr: ['a', 'b'] }), { odr: ['a'] });
    const potom = { text: 'potom v pondelok', dlho: false };
    assert.deepEqual(polovicaDlazdice({ odr: ['a'], potom }), { odr: [], potom });
    assert.deepEqual(polovicaDlazdice({ odr: ['a'], potom: null }), { odr: ['a'], potom: null });
});
