import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_DNA, PLANT, SITE, TARIFF } from '../shared/config.js';
import { denFaza, denSlovo, denTrieda, parseRanna, rannaFor, recordRanna } from '../shared/den-trieda.js';
import { DEN_WORDS, voiceTexts } from '../shared/messages.js';
import { mozemModel } from '../shared/mozem.js';
import { FIXED_NOW, fixtureData, pvAt } from './helpers.js';

/** Miestny čas 5. 9. 2026 v Bratislave (letný čas). @param {string} hm */
const at = (hm) => new Date(`2026-09-05T${hm}:00+02:00`);

/** Predpoveď zmenšená na zlomok `k`, bez merania - deň len z predpovede. @param {number} k */
function den(k, now = FIXED_NOW) {
    const { forecast } = fixtureData(now);
    const scale = (/** @type {Array<{ kw: number }>} */ h) => h.map((p) => ({ ...p, kw: p.kw * k }));
    return {
        now,
        site: SITE,
        plant: PLANT,
        tariff: TARIFF,
        pv: null,
        forecast: {
            ...forecast,
            hourlyToday: scale(forecast.hourlyToday),
            days: forecast.days.map((d) => ({ ...d, hourly: scale(d.hourly), peakKw: d.peakKw * k, kwhTotal: d.kwhTotal * k })),
        },
    };
}

test('trieda dňa podľa toho, koľko spotrebičov sa za deň zmestí na slnko', () => {
    const cls = (/** @type {number} */ k) => denTrieda(den(k), PLAN_DNA.devices);
    assert.equal(cls(1), 'vyborny', 'jasný deň: všetky aj s rezervou na mrak');
    assert.equal(cls(0.7), 'dobry', 'všetky, ale bez rezervy');
    assert.equal(cls(0.4), 'slaby', 'len niektoré');
    assert.equal(cls(0.1), 'nanic', 'ani jeden');
});

test('trieda dňa bez spotrebičov doma: ako s predvolenými', () => {
    for (const k of [1, 0.7, 0.4, 0.1]) assert.equal(denTrieda(den(k), []), denTrieda(den(k), PLAN_DNA.devices), String(k));
});

test('trieda dňa ráta celý deň od polnoci, nie od teraz', () => {
    // Večer už slnko nesvieti, ale deň ostáva taký, aký bol.
    assert.equal(denTrieda(den(1, at('21:00')), PLAN_DNA.devices), 'vyborny');
});

test('časť dňa: pred východom ráno, po západe večer', () => {
    assert.equal(denFaza({ now: at('05:00'), site: SITE }), 'rano');
    assert.equal(denFaza({ now: at('13:00'), site: SITE }), 'den');
    assert.equal(denFaza({ now: at('21:00'), site: SITE }), 'vecer');
    // Za polárnym kruhom v lete slnko nezapadne - celý deň je deň.
    assert.equal(
        denFaza({ now: new Date('2026-06-21T22:00:00Z'), site: { ...SITE, lat: 78.2, lon: 15.6, timezone: 'Europe/Oslo' } }),
        'den',
    );
});

test('ranná trieda: do východu sa prepisuje, potom ostáva', () => {
    const date = '2026-09-05';
    const devices = ['pracka', 'auto'];
    const a = recordRanna(null, { date, devices, cls: 'dobry', faza: 'rano' });
    assert.deepEqual(a, { date, devices: 'auto,pracka', cls: 'dobry', final: false });
    assert.equal(recordRanna(a, { date, devices, cls: 'dobry', faza: 'rano' }), a, 'bez zmeny ten istý objekt');
    const b = recordRanna(a, { date, devices, cls: 'vyborny', faza: 'rano' });
    assert.equal(b.cls, 'vyborny', 'predpoveď sa v noci zmenila');
    const c = recordRanna(b, { date, devices, cls: 'slaby', faza: 'den' });
    assert.deepEqual(c, { ...b, final: true }, 'po východe ostáva posledná ranná');
    assert.equal(recordRanna(c, { date, devices, cls: 'nanic', faza: 'den' }), c);
    assert.equal(recordRanna(c, { date: '2026-09-06', devices, cls: 'nanic', faza: 'rano' }).cls, 'nanic', 'nový deň');
    assert.equal(recordRanna(c, { date, devices: ['pracka'], cls: 'nanic', faza: 'den' }).cls, 'nanic', 'iné spotrebiče');
    // Kto appku otvorí až cez deň, má rannú triedu z prvého otvorenia.
    assert.deepEqual(recordRanna(null, { date, devices, cls: 'slaby', faza: 'den' }).final, true);
});

test('ranná trieda platí len pre dnešok a tie isté spotrebiče', () => {
    const r = recordRanna(null, { date: '2026-09-05', devices: ['auto', 'pracka'], cls: 'dobry', faza: 'rano' });
    assert.equal(rannaFor(r, '2026-09-05', ['pracka', 'auto']), 'dobry');
    assert.equal(rannaFor(r, '2026-09-06', ['pracka', 'auto']), null);
    assert.equal(rannaFor(r, '2026-09-05', ['pracka']), null);
    assert.equal(rannaFor(null, '2026-09-05', []), null);
});

test('ranná trieda z úložiska: čo nesedí, je null', () => {
    const ok = { date: '2026-09-05', devices: 'pracka', cls: 'slaby', final: true };
    assert.deepEqual(parseRanna(ok), ok);
    assert.deepEqual(parseRanna({ ...ok, final: 'ano' }), { ...ok, final: false });
    assert.equal(parseRanna({ ...ok, cls: 'super' }), null);
    assert.equal(parseRanna({ ...ok, date: '5. 9.' }), null);
    assert.equal(parseRanna({ ...ok, devices: 3 }), null);
    assert.equal(parseRanna(null), null);
    assert.equal(parseRanna('slaby'), null);
});

test('zmena oproti rannej triede len cez deň, večer bez merania ranná hláška', () => {
    assert.deepEqual(denSlovo('dobry', 'den', 'slaby', true), { cls: 'dobry', faza: 'den', change: 'lepsi' });
    assert.deepEqual(denSlovo('nanic', 'den', 'dobry', true), { cls: 'nanic', faza: 'den', change: 'horsi' });
    assert.equal(denSlovo('dobry', 'den', 'dobry', true).change, null);
    assert.equal(denSlovo('dobry', 'den', null, true).change, null, 'bez rannej triedy niet s čím porovnať');
    assert.equal(denSlovo('dobry', 'rano', 'slaby', false).change, null);
    assert.equal(denSlovo('dobry', 'vecer', 'slaby', true).faza, 'vecer');
    assert.equal(denSlovo('dobry', 'vecer', 'slaby', false).faza, 'rano', 'bez merania nie je čo hodnotiť');
});

test('karta Dnes: veľké slovo o celom dni v oboch tónoch', () => {
    const rano = mozemModel({ ...den(1, at('05:30')), loading: false });
    assert.deepEqual(rano.den, { cls: 'vyborny', faza: 'rano', change: null });
    assert.equal(rano.word, DEN_WORDS.rano.vyborny);
    assert.equal(mozemModel({ ...den(1, at('05:30')), loading: false }, { voice: 'slusny' }).word, 'Dnes bude výborný deň');

    // Ráno bolo výborne, cez deň sa zamračilo: hláška o zmene.
    const ranna = recordRanna(null, { date: '2026-09-05', devices: PLAN_DNA.devices, cls: 'vyborny', faza: 'den' });
    const horsie = mozemModel({ ...den(0.1), loading: false }, { ranna });
    assert.equal(horsie.den?.change, 'horsi');
    assert.equal(horsie.word, DEN_WORDS.zmena.horsi);
    assert.equal(mozemModel({ ...den(0.1), loading: false }, { ranna, voice: 'slusny' }).word, voiceTexts('slusny').DEN_WORDS.zmena.horsi);

    // Večer s meraním: zhodnotenie dňa.
    const vecer = mozemModel({ ...den(1, at('21:00')), pv: pvAt(at('21:00')), loading: false });
    assert.equal(vecer.den?.faza, 'vecer');
    assert.equal(vecer.word, DEN_WORDS.vecer[/** @type {NonNullable<typeof vecer.den>} */ (vecer.den).cls]);
});

test('karta Dnes bez dát: slovo stavu, triedu dňa nemá', () => {
    const m = mozemModel({ ...den(1), forecast: null, loading: false });
    assert.equal(m.den, null);
    assert.equal(m.state, 'offline');
});
