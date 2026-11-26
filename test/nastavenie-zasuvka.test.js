import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZASUVKA_NAST_TEXTS, zasuvkaSekcia } from '../shared/nastavenie-zasuvka.js';

const NOW = new Date('2026-11-26T09:30:00Z');
const MIN = 60 * 1000;
const zaklad = {
    zdroj: { sposob: 'huawei-northbound' },
    now: NOW,
    site: { timezone: 'Europe/Bratislava' },
    voice: /** @type {const} */ ('drzy'),
};

test('zasuvkaSekcia: len pri Huawei Northbound; voľba spotrebiča, stav zásuvky, správy a kroky v tóne', () => {
    assert.equal(zasuvkaSekcia({ ...zaklad, zdroj: { sposob: 'huawei-kiosk' } }), null);
    const s = zasuvkaSekcia(zaklad);
    assert.ok(s);
    assert.deepEqual(
        s.veci.map((v) => [v.label, v.on]),
        [
            ['Práčka', true],
            ['Sušička', false],
            ['Umývačka', false],
        ],
    );
    assert.deepEqual(s.stav, { tone: 'wait', text: 'ešte sa neozvala' });
    assert.equal(s.sprava, null);
    assert.equal(s.tlacidlo, 'Skopíruj skript do zásuvky');
    assert.equal(s.kroky.length, ZASUVKA_NAST_TEXTS.kroky.length);
    const zasuvky = {
        susicka: { at: NOW.getTime() - 2 * MIN, w: 5, bezi: false },
        pracka: { at: NOW.getTime() - 3 * 24 * 60 * MIN, w: 0, bezi: false },
    };
    assert.deepEqual(zasuvkaSekcia({ ...zaklad, zasuvky, zasuvkaVec: 'susicka' })?.stav, { tone: 'ok', text: 'ozvala sa o 10:28' });
    assert.deepEqual(zasuvkaSekcia({ ...zaklad, zasuvky })?.stav, { tone: 'stale', text: 'neozýva sa od 23. 11. 10:30' });
    const slusne = { ...zaklad, voice: /** @type {const} */ ('slusny') };
    const hotovo = zasuvkaSekcia({ ...slusne, zasuvkaSkript: { stav: 'hotovo', text: 'skript', schranka: false } });
    assert.deepEqual(hotovo?.sprava, { text: 'Schránka nie je dostupná. Skopírujte skript z poľa nižšie.', chyba: false });
    assert.equal(hotovo?.skript, 'skript');
    assert.equal(zasuvkaSekcia({ ...zaklad, zasuvkaSkript: { stav: 'hotovo', text: 'x', schranka: true } })?.skript, '');
    assert.equal(zasuvkaSekcia({ ...zaklad, zasuvkaSkript: { stav: 'robim', text: '', schranka: false } })?.robim, true);
    assert.equal(zasuvkaSekcia({ ...zaklad, zasuvkaSkript: { stav: 'chyba', text: '', schranka: false } })?.sprava?.chyba, true);
});
