import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_DNA, PLANT, PREDPOVED_HODINY, SITE, TARIFF } from '../shared/config.js';
import { denVysvetlenie, dnesFaza } from '../shared/dnes-faza.js';
import { denTrieda, denTriedaDna, denTriedaVeci, silnyDen } from '../shared/den-trieda.js';
import {
    countdownText,
    denVysvetlenieText,
    DEN_NAZVY,
    DEN_WORDS,
    dnesLepsieText,
    dnesNabehloText,
    dnesPopisText,
    DNES_TEXTS,
    spanText,
    voiceTexts,
} from '../shared/messages.js';
import { weekDayName } from '../shared/format.js';
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

/** Model karty tak, ako ho skladá appka. @param {ReturnType<typeof input>} i @param {import('../shared/messages.js').Voice} [voice] */
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
    assert.deepEqual(
        d.karty.map((k) => k.kind),
        ['predpoved', 'slnko', 'graf', 'lepsie'],
        'ráno ešte nič nenabehlo',
    );
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
    assert.deepEqual(
        d.karty.map((k) => k.kind),
        ['predpoved', 'slnko', 'graf', 'nabehlo', 'lepsie'],
    );
    const n = d.karty[3];
    assert.ok(n.kind === 'nabehlo' && n.pct !== null && n.pct > 0);
    assert.equal(n.title, 'Nabehlo');
    assert.match(n.value, /^\d+,\d kWh$/);
    assert.equal(n.text, `${n.pct} % z ~61 kWh na celý deň.`);
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
    const n = d?.karty.find((k) => k.kind === 'nabehlo');
    assert.ok(n?.kind === 'nabehlo');
    assert.equal(n.title, 'Nabehlo asi');
    assert.match(n.text, /^\d+ % z ~61 kWh na celý deň, podľa predpovede\.$/);
});

test('večer: ako dopadol dnešok z nameraného, zajtrajšok a v páse graf dneška a predpoveď na zajtra', () => {
    const i = input(at('21:00'));
    const { d } = faza(i);
    assert.ok(d && d.tomorrow && d.grade && i.pv && i.forecast);
    assert.equal(d.faza, 'vecer');
    assert.equal(d.kick, DNES_TEXTS.grade);
    assert.equal(d.chip, '', 'večer hovorí štítok zajtrajška');
    assert.equal(d.grade.value, `${String(i.pv.dailyEnergyKwh.toFixed(1)).replace('.', ',')} kWh`);
    assert.equal(d.line, `Predpoveď bola ${Math.round(i.forecast.days[0].kwhTotal)} kWh.`);
    assert.deepEqual(
        d.karty.map((k) => [k.kind, k.title]),
        [
            ['graf', DNES_TEXTS.graf],
            ['predpoved', DNES_TEXTS.predpovedZajtra],
        ],
    );
    const p = d.karty[1];
    assert.ok(p.kind === 'predpoved');
    assert.equal(p.oblacnost, i.forecast.days[1].cloudAvgPct, 'predpoveď na zajtra je zo zajtrajška');
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

test('večer bez zajtrajška v predpovedi: ostáva karta Kedy lepšie', () => {
    const i = input(at('21:00'));
    const forecast = i.forecast && { ...i.forecast, days: i.forecast.days.slice(0, 1) };
    const { d } = faza({ ...i, forecast });
    assert.equal(d?.tomorrow, null);
    assert.deepEqual(
        d?.karty.map((k) => k.kind),
        ['lepsie'],
    );
});

test('večer bez merania hodnotí ešte predpoveď: plán ako ráno', () => {
    assert.equal(faza(input(at('21:00'), { pv: null })).d?.faza, 'rano');
});

test('bez dát nič: načítava sa či chýba predpoveď', () => {
    assert.equal(faza(input(at('13:00'), { forecast: null })).d, null);
    const m = mozemModel(input(at('13:00')));
    assert.equal(dnesFaza(input(at('13:00'), { forecast: null }), m.den, null), null, 'slovo o dni bez predpovede nestačí');
});

test('Kedy lepšie hovorí o silnom dni podľa triedy dňa, nie podľa špičky predpovede', () => {
    const i = input(at('13:00'));
    const { m } = faza(i);
    assert.ok(i.forecast && m.den && m.facts);
    assert.ok(i.forecast.days[0].peakKw >= 4, 'fixture: špička dneška nad hranicou silného slnka');
    const later = (/** @type {import('../shared/den-trieda.js').DenTrieda} */ cls) => {
        const k = dnesFaza(i, { cls, faza: 'den' }, m.facts?.window ?? null)?.karty.find((x) => x.kind === 'lepsie');
        return k ? `${k.value}: ${k.text}` : '';
    };
    assert.doesNotMatch(later('slaby'), /silný\./, 'odznak Slabý deň - karta mu neprotirečí');
    assert.doesNotMatch(later('nanic'), /silný\./);
    assert.match(later('dobry'), /Aj dnešok je silný\./);
    assert.match(later('vyborny'), /Aj dnešok je silný\./);
    const data = { ...i, forecast: i.forecast };
    const k = i.forecast.days.findIndex((_, x) => x > 0 && silnyDen(denTriedaDna(data, x, PLAN_DNA.devices)));
    assert.ok(k > 0, 'fixture: v predpovedi je ďalší silný deň');
    assert.match(later('slaby'), new RegExp(`^${weekDayName(i.forecast.days[k].date, k).toLowerCase()}: Najbližší silný deň, okolo`));
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

test('karta Kedy lepšie: dnes ešte silnejšie slnko, najbližší silný deň, alebo žiadny', () => {
    const next = { name: 'Zajtra', kwh: 48.5 };
    assert.deepEqual(dnesLepsieText({ wait: null, todayStrong: true, next }), {
        value: 'zajtra',
        text: 'Najbližší silný deň, okolo 49 kWh. Aj dnešok je silný.',
    });
    assert.deepEqual(dnesLepsieText({ wait: '11:00', todayStrong: false, next: { name: 'Pondelok', kwh: 50 } }), {
        value: 'o 11:00',
        text: 'Dnes ešte silnejšie slnko. Najbližší silný deň: pondelok, okolo 50 kWh.',
    });
    assert.deepEqual(dnesLepsieText({ wait: '11:00', todayStrong: false, next: null }), {
        value: 'o 11:00',
        text: 'Dnes ešte silnejšie slnko.',
    });
    assert.deepEqual(dnesLepsieText({ wait: null, todayStrong: true, next: null }), {
        value: 'dnes',
        text: 'Dnes je silný deň, ďalší taký v predpovedi nie je.',
    });
    assert.deepEqual(dnesLepsieText({ wait: null, todayStrong: false, next: null }), {
        value: 'tento týždeň nie',
        text: 'Silný deň v predpovedi na týždeň nie je.',
    });
});

test('karta Nabehlo bez percenta (predpoveď dňa nula)', () => {
    assert.equal(dnesNabehloText({ forecastKwh: 0, doneKwh: 0, measured: true, pct: null }).text, 'Z ~0 kWh na celý deň.');
});

test('karta Predpoveď: teploty, oblačnosť a popis dneška z predpovede', () => {
    const i = input(at('13:00'));
    const k = faza(i).d?.karty[0];
    const day = i.forecast?.days[0];
    assert.ok(k?.kind === 'predpoved' && day && day.tempMinC !== null && day.tempMaxC !== null);
    assert.equal(k.title, DNES_TEXTS.predpoved);
    assert.equal(k.min, `${Math.round(day.tempMinC)}°`);
    assert.equal(k.max, `${Math.round(day.tempMaxC)}°`);
    assert.equal(k.oblacnost, day.cloudAvgPct);
    assert.equal(k.weather, 'jasno', 'fixture: oblačnosť do 15 %');
    assert.equal(k.popis, 'Jasno');
});

test('karta Predpoveď: zrážky s časťou dňa, sneh, celý deň a mimo hodín predpovede nič', () => {
    const i = input(at('13:00'));
    assert.ok(i.forecast);
    const f = i.forecast;
    /** Predpoveď so zrážkami v hodinách `hodiny` a oblačnosťou dňa `cloud`. @param {number[]} hodiny @param {'dazd' | 'sneh'} druh @param {number} cloud */
    const s = (hodiny, druh = 'dazd', cloud = 90) => {
        const days = [
            {
                ...f.days[0],
                cloudAvgPct: cloud,
                hourly: f.days[0].hourly.map((h) => ({ ...h, precip: hodiny.includes(h.hour) ? druh : null })),
            },
            ...f.days.slice(1),
        ];
        const k = faza({ ...i, forecast: { ...f, days } }).d?.karty[0];
        return k?.kind === 'predpoved' ? k.popis : '';
    };
    assert.equal(s([18, 19, 20]), 'Zamračené, večer dážď');
    assert.equal(s([7, 8]), 'Zamračené, ráno dážď');
    assert.equal(s([10, 11]), 'Zamračené, dopoludnia dážď');
    assert.equal(s([13], 'sneh', 50), 'Polojasno, popoludní sneh');
    assert.equal(s([9, 13, 18]), 'Zamračené, dážď', 'v rôznych častiach dňa bez časti');
    assert.equal(s([PREDPOVED_HODINY.od - 1, PREDPOVED_HODINY.do]), 'Zamračené', 'v noci sa nepočíta');
    // Bez teploty karta nie je, bez oblačnosti len zrážky.
    const bezTeploty = { ...f, days: [{ ...f.days[0], tempMinC: null }, ...f.days.slice(1)] };
    assert.equal(faza({ ...i, forecast: bezTeploty }).d?.karty[0].kind, 'slnko');
    assert.equal(dnesPopisText({ weather: null, zrazky: { druh: 'sneh', cast: null } }), 'Sneh');
    assert.equal(dnesPopisText({ weather: null, zrazky: null }), '');
});

test('karta Graf dňa: náhľad predpovede a nameranej krivky v ploche 100 × 40', () => {
    const k = faza(input(at('13:00'))).d?.karty[2];
    assert.ok(k?.kind === 'graf');
    assert.equal(k.title, DNES_TEXTS.graf);
    assert.equal(k.stitok, DNES_TEXTS.grafStitok);
    const body = (/** @type {string} */ t) => t.split(' ').map((p) => p.split(',').map(Number));
    const fc = body(k.fc);
    const real = body(k.real);
    assert.ok(fc.length > 10 && real.length > 1);
    for (const [x, y] of [...fc, ...real]) assert.ok(x >= 0 && x <= 100 && y >= 4 && y <= 38, `${x},${y}`);
    assert.ok(Math.max(...real.map(([x]) => x)) < 60, 'nameraná krivka končí o 13:00');
    // Bez merania len predpoveď.
    const bez = faza(input(at('13:00'), { pv: null })).d?.karty[2];
    assert.ok(bez?.kind === 'graf' && bez.real === '' && bez.fc === k.fc);
});

test('karta Najviac slnka: najsilnejšia hodina, stĺpce a čo je už za nami', () => {
    const { d } = faza(input(at('13:00')));
    const k = d?.karty.find((x) => x.kind === 'slnko');
    assert.ok(k?.kind === 'slnko');
    assert.equal(k.value, '12:00 – 13:00');
    assert.equal(k.text, 'Strecha vtedy dá až ~7,9 kW. Auto alebo dve veci naraz daj sem.');
    assert.deepEqual(
        k.stlpce.filter((s) => s.max).map((s) => [s.hour, s.pct]),
        [[12, 100]],
    );
    assert.deepEqual(
        k.stlpce.filter((s) => s.preslo).map((s) => s.hour),
        [6, 7, 8, 9, 10, 11, 12],
        '13:00 - hodina 12 je celá za nami',
    );
    const slusne = faza(input(at('13:00')), 'slusny').d?.karty.find((x) => x.kind === 'slnko');
    assert.match(slusne?.text ?? '', /dajte sem\.$/);
    // Strecha celý deň nič nedá: karta nie je.
    const i = input(at('13:00'));
    assert.ok(i.forecast);
    const forecast = { ...i.forecast, hourlyToday: i.forecast.hourlyToday.map((h) => ({ ...h, kw: 0 })) };
    assert.equal(
        faza({ ...i, forecast }).d?.karty.some((x) => x.kind === 'slnko'),
        false,
    );
});

test('vysvetlenie odznaku: tá istá trieda ako odznak, veci, stupnica a texty', () => {
    const i = input(at('13:00'));
    const { m } = faza(i);
    const v = denVysvetlenie(i, 'dnes');
    assert.ok(v && m.den);
    assert.equal(v.cls, m.den.cls);
    assert.equal(v.chip, DEN_NAZVY[v.cls]);
    assert.deepEqual(
        v.veci.map((x) => x.id),
        ['pracka', 'susicka', 'umyvacka', 'auto'],
        'v poradí Plánu dňa',
    );
    assert.equal(v.veci[0].name, 'Práčka');
    assert.deepEqual(
        v.stupnica.map((s) => s.cls),
        ['nanic', 'slaby', 'dobry', 'vyborny'],
    );
    assert.deepEqual(
        v.stupnica.filter((s) => s.on).map((s) => s.cls),
        [v.cls],
    );
    assert.match(v.note, /čo už bolo, podľa merania/);
    const z = denVysvetlenie(i, 'zajtra');
    assert.ok(z && i.forecast);
    assert.equal(z.cls, denTriedaDna({ ...i, forecast: i.forecast }, 1, PLAN_DNA.devices));
    assert.equal(z.chip, `zajtra ${DEN_NAZVY[z.cls]}`);
    assert.match(z.text, / zajtra /);
    assert.match(z.note, /celého dňa: podľa predpovede\.$/);
    assert.match(denVysvetlenie(i, 'dnes', { voice: 'slusny' })?.text ?? '', /vaše/);
    // Zajtrajšok bez predpovede na zajtra nie je čo vysvetliť.
    const forecast = i.forecast && { ...i.forecast, days: i.forecast.days.slice(0, 1) };
    assert.equal(denVysvetlenie({ ...i, forecast }, 'zajtra'), null);
});

test('vysvetlenie odznaku: každá trieda má v oboch tónoch svoj nadpis a vetu', () => {
    for (const voice of /** @type {const} */ (['drzy', 'slusny']))
        for (const kedy of /** @type {const} */ (['dnes', 'zajtra'])) {
            const t = ['vyborny', 'dobry', 'slaby', 'nanic'].map((cls) =>
                denVysvetlenieText(/** @type {import('../shared/den-trieda.js').DenTrieda} */ (cls), kedy, voice),
            );
            assert.equal(new Set(t.map((x) => x.title)).size, 4);
            assert.equal(new Set(t.map((x) => x.text)).size, 4);
            for (const x of t) assert.ok(x.text.includes(kedy === 'dnes' ? 'nes' : 'ajtra'), x.text);
        }
    assert.match(denVysvetlenieText('slaby', 'dnes', 'slusny').text, /počkajte/);
    assert.match(denVysvetlenieText('slaby', 'dnes', 'drzy').text, /počkaj na/);
});

test('trieda s vecami: ktoré sa zmestia, a bez spotrebičov doma predvolené', () => {
    const i = input(at('13:00'));
    const r = denTriedaVeci(i, ['pracka', 'auto']);
    assert.equal(r.cls, denTrieda(i, ['pracka', 'auto']));
    assert.deepEqual(
        r.veci.map((x) => x.id),
        ['pracka', 'auto'],
    );
    assert.deepEqual(
        denTriedaVeci(i, []).veci.map((x) => x.id),
        ['pracka', 'susicka', 'umyvacka', 'auto'],
    );
    // Bez slnka sa nezmestí nič.
    assert.ok(i.forecast);
    const tma = { ...i, pv: null, forecast: { ...i.forecast, hourlyToday: i.forecast.hourlyToday.map((h) => ({ ...h, kw: 0 })) } };
    const nic = denTriedaVeci(tma, PLAN_DNA.devices);
    assert.equal(nic.cls, 'nanic');
    assert.ok(nic.veci.every((x) => !x.ok));
});
