import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { PLANT, powerThresholds, VOICES } from '../shared/config.js';
import * as M from '../shared/messages.js';
import { sampleTexts } from './texts-sample.js';

const goldenPath = new URL('./golden/texty-drzy.json', import.meta.url);

/** Odtlačok celej vzorky: každý text aj to, kde v ktorom modeli stojí. @param {Record<string, string>} t */
const hashOf = (t) =>
    createHash('sha256')
        .update(JSON.stringify(Object.entries(t).sort()))
        .digest('hex');

test('drzé texty sa nezmenili ani o písmeno (test/golden/texty-drzy.json)', () => {
    const t = sampleTexts();
    const texts = [...new Set(Object.values(t))].sort();
    if (!existsSync(goldenPath) || process.env.UPDATE_GOLDEN)
        writeFileSync(goldenPath, JSON.stringify({ hash: hashOf(t), texts }, null, 2) + '\n');
    const golden = JSON.parse(readFileSync(goldenPath, 'utf8'));
    assert.deepEqual(texts, golden.texts, 'zmena drzých textov - ak je zámerná, spusti UPDATE_GOLDEN=1 npm test');
    assert.equal(hashOf(t), golden.hash, 'texty sú tie isté, no inde - zmenilo sa, kde ktorý text appka ukazuje');
});

test('drzý tón je predvolený: s voice „drzy“ sú texty tie isté ako bez neho', () => {
    assert.equal(VOICES[0], 'drzy');
    assert.deepEqual(sampleTexts('drzy'), sampleTexts());
});

/**
 * Pevné texty: oba tóny majú tie isté kľúče a žiadny slušný text nie je prázdny, kde drzý nie je.
 * @param {unknown} a drzý @param {unknown} b slušný @param {string} path
 */
function sameShape(a, b, path) {
    if (typeof a === 'string') {
        assert.equal(typeof b, 'string', path);
        assert.equal(b === '', a === '', `${path}: prázdny len v jednom tóne`);
        return;
    }
    if (typeof a === 'function') return assert.equal(typeof b, 'function', path);
    assert.ok(a && b && typeof a === 'object' && typeof b === 'object', path);
    assert.deepEqual(Object.keys(b).sort(), Object.keys(a).sort(), path);
    for (const k of Object.keys(a)) sameShape(/** @type {any} */ (a)[k], /** @type {any} */ (b)[k], `${path}.${k}`);
}

test('voiceTexts: každý pevný text má obe varianty a žiadna nie je prázdna', () => {
    sameShape(M.voiceTexts('drzy'), M.voiceTexts('slusny'), 'texty');
    assert.equal(M.voiceTexts(), M.voiceTexts('drzy'));
    // Drzé sú tie isté objekty, ktoré číta súčasná appka.
    assert.equal(M.voiceTexts('drzy').MOZEM_WORDS, M.MOZEM_WORDS);
    assert.equal(M.voiceTexts('drzy').STATISTIKA_TEXTS, M.STATISTIKA_TEXTS);
});

test('vzorka: každý text v slušnom tóne existuje a nie je prázdny, kde drzý nie je', () => {
    const d = sampleTexts('drzy');
    const p = sampleTexts('slusny');
    assert.deepEqual(Object.keys(p).sort(), Object.keys(d).sort());
    for (const k of Object.keys(d)) assert.equal(p[k] === '', d[k] === '', k);
});

test('slušný tón: slová, hlášky a päta plagátu podľa návrhu', () => {
    const s = M.voiceTexts('slusny');
    assert.deepEqual(
        [s.MOZEM_WORDS.go, s.MOZEM_WORDS.wait, s.MOZEM_WORDS.slabo, s.MOZEM_WORDS.none, s.MOZEM_WORDS.offline],
        ['ÁNO, TERAZ', 'EŠTE NIE', 'SLABÝ DEŇ', 'DNES UŽ NIE', 'NEVIEM'],
    );
    assert.ok(s.MOZEM_QUIPS.go.includes('Strecha dnes pracuje za vás.'));
    assert.equal(s.MOZEM_SKY_TEXTS.guessTitle, 'Toto je len odhad');
    assert.equal(s.STATISTIKA_TEXTS.setupTitle, 'Štatistika potrebuje vaše panely');
    assert.equal(s.STATISTIKA_TEXTS.posterFoot, 'RAY-MON');
    assert.equal(M.STATISTIKA_TEXTS.posterFoot, 'RAY-MON · slnko nefakturuje');
});

// Tvary, ktoré tykajú (aj „ty“ samo): v slušnom tóne nesmú byť nikde, kde nová appka hovorí.
const TYKANIE =
    /(^|[^\p{L}])(ty|tvoj\p{L}*|teba|tebe|ti|môžeš|chceš|musíš|potrebuješ|platíš|Zadaj|Ťukni|ťukni|Ťahaj|Potiahni|Pusti|Zapoj|zapni|Zapni|pozri|počkaj|Počkaj|nechaj|Hraj|Povedz|Spýtaj|Nerieš|Doplň|Pripoj|Skús|si pustil\/a|si vyrobil|si zaplatil|uvidíš|Uvidíš|zadáš|vrátiš)(?![\p{L}])/u;

test('slušný tón vyká: v textoch novej appky nie je tykanie', () => {
    const p = sampleTexts('slusny');
    // Riadok „glance“ a veta pod pásom dňa sú len v súčasnej appke, predpoveď dňa tiež.
    const own = Object.entries(p).filter(([k]) => !/\.glance|\.strip\.|^forecastDay|^empty/.test(k));
    const bad = own.filter(([, v]) => TYKANIE.test(v));
    assert.deepEqual(bad, []);
    // A drzý tón naozaj tyká - inak by test nič nekontroloval.
    assert.ok(Object.values(sampleTexts('drzy')).some((v) => TYKANIE.test(v)));
});

test('slušné odporúčania a hláška dňa vykajú', () => {
    const th = powerThresholds(PLANT);
    assert.equal(M.getSlotMessage('lacna', 6, null, th, 'slusny')?.headline, 'Najlepší čas dňa — zapnite všetko');
    assert.equal(M.getSlotMessage('lacna', 6, null, th)?.headline, 'Najlepší čas dňa — zapni všetko');
    assert.match(M.dayDetailMessage([{ hour: 12, kw: 0.1 }], th, 'slusny').body, /naplánujte/);
    assert.match(M.sedemDayMessage([{ hour: 12, kw: 9 }], th, false, 'slusny').body, /naplánujte/);
});
