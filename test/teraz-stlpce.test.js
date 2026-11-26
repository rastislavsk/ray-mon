import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stlpceDlazdic } from '../shared/teraz-stlpce.js';

/** @param {...string} ids */
const veci = (...ids) => ids.map((id) => ({ id }));
/** @param {{ lavy: Array<{ id: string }>, pravy: Array<{ id: string }> }} s */
const ids = (s) => ({ lavy: s.lavy.map((v) => v.id), pravy: s.pravy.map((v) => v.id) });

test('stlpceDlazdic: vľavo práčka, sušička a umývačka v poradí karty, vpravo bojler, auto a klíma', () => {
    assert.deepEqual(ids(stlpceDlazdic(veci('klima', 'auto', 'umyvacka', 'pracka', 'bojler', 'susicka'))), {
        lavy: ['umyvacka', 'pracka', 'susicka'],
        pravy: ['bojler', 'auto', 'klima'],
    });
    assert.deepEqual(ids(stlpceDlazdic(veci('susicka', 'auto', 'pracka'))), { lavy: ['susicka', 'pracka'], pravy: ['auto'] });
});

test('stlpceDlazdic: neznáma vec ide do ľavého stĺpca, bez vecí nič', () => {
    assert.deepEqual(ids(stlpceDlazdic(veci('rura', 'susicka', 'bojler'))), { lavy: ['rura', 'susicka'], pravy: ['bojler'] });
    assert.deepEqual(stlpceDlazdic([]), { lavy: [], pravy: [] });
});
