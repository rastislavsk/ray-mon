import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_DNA, PLANT, SITE, TARIFF } from '../shared/config.js';
import { dnesFaza } from '../shared/dnes-faza.js';
import { denTrieda, denTriedaDna } from '../shared/den-trieda.js';
import { countdownText, DEN_NAZVY, DEN_WORDS, DNES_TEXTS, spanText, voiceTexts } from '../shared/messages.js';
import { dnesDay, mozemModel } from '../shared/mozem.js';
import { fixtureData, pvAt } from './helpers.js';

/** Miestny čas 5. 9. 2026 v Bratislave (letný čas). @param {string} hm */
const at = (hm) => new Date(`2026-09-05T${hm}:00+02:00`);

/**
 * Vstup karty: Dvorany s kioskom a fixtures v danej chvíli. @param {Date} now @param {object} [extra]
 * @returns {Parameters<typeof dnesFaza>[0]}
 */
function input(now, extra = {}) {
    const { forecast } = fixtureData(now);
    return {
        now,
        site: SITE,
        plant: PLANT,
        tariff: TARIFF,
        zdroj: { sposob: 'huawei-kiosk', pecat: 'v1.test-pecat-0123456789', nazov: '' },
        loading: false,
        known: 'elektraren',
        pv: pvAt(now),
        forecast,
        ...extra,
    };
}

/** Model karty tak, ako ho skladajú obe appky. @param {ReturnType<typeof input>} i @param {import('../shared/messages.js').Voice} [voice] */
function faza(i, voice = 'drzy') {
    const m = mozemModel(i, { voice });
    return { m, d: dnesFaza(i, m.den, m.facts ? m.facts.window : null, { voice }) };
}

test('ráno pred východom: plán na dnes s oknom na veľké veci a trieda dňa', () => {
    const { m, d } = faza(input(at('05:30')));
    assert.ok(d && m.den && m.facts?.window);
    assert.equal(d.faza, 'rano');
    assert.equal(d.kick, DNES_TEXTS.plan);
    assert.equal(d.chip, DEN_NAZVY[m.den.cls]);
    assert.equal(d.line, `Veľké veci daj medzi ${spanText(m.facts.window)}.`);
    assert.equal(d.count, null);
    assert.equal(d.grade, null);
    assert.equal(d.tomorrow, null);
    assert.ok(d.later, 'kedy bude lepšie');
    assert.equal(faza(input(at('05:30')), 'slusny').d?.line.startsWith('Veľké veci dajte medzi'), true, 'slušne vyká');
});

test('cez deň v okne: odpočet do konca okna a koľko už nabehlo', () => {
    const { m, d } = faza(input(at('13:00')));
    const w = m.facts?.window;
    assert.ok(d && w);
    assert.equal(d.faza, 'den');
    assert.equal(d.kick, '');
    assert.deepEqual(d.count, {
        value: countdownText(w.to - 13 * 60),
        text: `ešte slnka na veľké veci, do ${spanText(w).split(' – ')[1]}`,
    });
    assert.match(d.progress?.text ?? '', /^Nabehlo \d+,\d z ~\d+ kWh\.$/);
    assert.ok(d.progress?.pct !== null && d.progress?.pct !== undefined && d.progress.pct > 0);
    assert.equal(d.line, '', 'okno povie odpočet, veta by ho opakovala');
});

test('cez deň pred oknom: odpočet do začiatku okna', () => {
    const { m, d } = faza(input(at('06:45')));
    const w = m.facts?.window;
    assert.ok(d && w && w.from > 6 * 60 + 45, 'okno ešte nezačalo');
    assert.equal(d.faza, 'den');
    assert.deepEqual(d.count, { value: countdownText(w.from - (6 * 60 + 45)), text: `do okna na veľké veci ${spanText(w)}` });
});

test('cez deň po okne: bez odpočtu, veta, že okno už bolo', () => {
    const { d } = faza(input(at('18:30')));
    assert.ok(d);
    assert.equal(d.faza, 'den');
    assert.equal(d.count, null);
    assert.match(d.line, /^Okno na veľké veci bolo /);
});

test('bez merania: odhad z predpovede', () => {
    const { d } = faza(input(at('13:00'), { pv: null }));
    assert.match(d?.progress?.text ?? '', /^Podľa predpovede už asi \d+,\d z ~\d+ kWh\.$/);
});

test('večer: vysvedčenie z nameraného a zajtrajšok namiesto riadku Kedy lepšie', () => {
    const i = input(at('21:00'));
    const { d } = faza(i);
    assert.ok(d && d.tomorrow && d.grade && i.pv && i.forecast);
    assert.equal(d.faza, 'vecer');
    assert.equal(d.kick, DNES_TEXTS.grade);
    assert.equal(d.chip, '', 'večer hovorí štítok zajtrajška');
    assert.equal(d.grade.value, `${String(i.pv.dailyEnergyKwh.toFixed(1)).replace('.', ',')} kWh`);
    assert.equal(d.line, `Predpoveď bola ${Math.round(i.forecast.days[0].kwhTotal)} kWh.`);
    assert.equal(d.later, '');
    const cls = denTriedaDna(i, 1, PLAN_DNA.devices);
    assert.equal(d.tomorrow.cls, cls);
    assert.equal(d.tomorrow.word, DEN_WORDS.zajtra[cls]);
    assert.equal(d.tomorrow.chip, `zajtra ${DEN_NAZVY[cls]}`);
    assert.match(
        d.tomorrow.text,
        new RegExp(`^Okolo ${Math.round(i.forecast.days[1].kwhTotal)} kWh, veľké veci \\d\\d:\\d\\d – \\d\\d:\\d\\d\\.$`),
    );
    assert.equal(faza(i, 'slusny').d?.tomorrow?.word, voiceTexts('slusny').DEN_WORDS.zajtra[cls]);
});

test('večer bez zajtrajška v predpovedi: ostáva riadok Kedy lepšie', () => {
    const i = input(at('21:00'));
    const forecast = i.forecast && { ...i.forecast, days: i.forecast.days.slice(0, 1) };
    const { d } = faza({ ...i, forecast });
    assert.equal(d?.tomorrow, null);
    assert.ok(d?.later);
});

test('večer bez merania hodnotí ešte predpoveď: plán ako ráno', () => {
    assert.equal(faza(input(at('21:00'), { pv: null })).d?.faza, 'rano');
});

test('bez dát nič: načítava sa či chýba predpoveď', () => {
    assert.equal(faza(input(at('13:00'), { forecast: null })).d, null);
    const m = mozemModel(input(at('13:00')));
    assert.equal(dnesFaza(input(at('13:00'), { forecast: null }), m.den, null), null, 'slovo o dni bez predpovede nestačí');
});

test('trieda iného dňa: dnešok je tá istá ako denTrieda', () => {
    const i = input(at('13:00'));
    assert.ok(i.forecast);
    assert.equal(denTriedaDna({ ...i, forecast: i.forecast }, 0, PLAN_DNA.devices), denTrieda(i, PLAN_DNA.devices));
});

test('čo dá strecha za deň: po západe len namerané', () => {
    const i = input(at('21:00'));
    assert.ok(i.pv && i.forecast);
    assert.ok(i.forecast.days[0].kwhTotal > i.pv.dailyEnergyKwh, 'predpoveď sľubovala viac');
    assert.equal(dnesDay(i)?.kwh, i.pv.dailyEnergyKwh);
    assert.equal(dnesDay(input(at('13:00')))?.kwh, i.forecast.days[0].kwhTotal, 'cez deň ešte predpoveď');
});
