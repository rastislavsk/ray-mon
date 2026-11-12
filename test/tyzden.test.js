import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_DNA, PLANT, SITE, TARIFF, TYZDEN } from '../shared/config.js';
import { terazDenHlavickaText, terazNudzaText, terazPotomText } from '../shared/messages.js';
import { dayCtx } from '../shared/mozem-jadro.js';
import { terazModel } from '../shared/teraz.js';
import { dalsieSlnko, denInyModel, dniTyzdna, hrebenModel, nudzoveCasy } from '../shared/tyzden.js';
import { fixtureData } from './helpers.js';

const DEVICES = [...PLAN_DNA.devices];
const VSETKO = ['pracka', 'umyvacka', 'susicka', 'auto', 'bojler'];
/** Miestny čas 5. 9. 2026 (sobota) v Bratislave. @param {string} hm */
const at = (hm) => new Date(`2026-09-05T${hm}:00+02:00`);
const RANO = at('09:00');
/** Sadzba s jednou cenou celý deň. @type {import('../shared/config.js').Tariff} */
const JEDNA = {
    currency: '€',
    bands: [{ id: 'j', name: 'J', level: 'bezna', price: null }],
    schedules: [{ days: [1, 2, 3, 4, 5, 6, 7], months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], changes: [{ from: '00:00', band: 'j' }] }],
};
/** Sadzba bez lacného pásma: bežná cena, od 17:00 do 21:00 drahá. @type {import('../shared/config.js').Tariff} */
const SPICKA = {
    ...JEDNA,
    bands: [...JEDNA.bands, { id: 'd', name: 'D', level: 'draha', price: null }],
    schedules: [
        {
            ...JEDNA.schedules[0],
            changes: [
                { from: '00:00', band: 'd' },
                { from: '07:00', band: 'j' },
                { from: '17:00', band: 'd' },
            ],
        },
    ],
};

/**
 * Predpoveď z fixtures s výrobou dní stiahnutou na daný zlomok (deň bez údaja ostáva celý).
 * @param {Record<string, number>} zlomky dátum → zlomok výroby @param {Date} now
 */
function predpoved(zlomky, now) {
    const f = fixtureData(now).forecast;
    if (!f) throw new Error('fixtures nemajú predpoveď');
    const k = (/** @type {string} */ date) => zlomky[date] ?? 1;
    return {
        ...f,
        // Dnešok plán dňa berie z hodín dneška, ďalšie dni z `days`.
        hourlyToday: f.hourlyToday.map((p) => ({ ...p, kw: p.kw * k(f.days[0].date) })),
        days: f.days.map((d) => ({
            ...d,
            hourly: d.hourly.map((p) => ({ ...p, kw: p.kw * k(d.date) })),
            peakKw: d.peakKw * k(d.date),
            kwhTotal: d.kwhTotal * k(d.date),
        })),
    };
}
/**
 * Vstup karty Teraz bez merania. @param {Record<string, number>} zlomky @param {Date} [now] @param {import('../shared/config.js').Tariff} [tariff]
 * @returns {import('../shared/teraz.js').TerazInput}
 */
const input = (zlomky, now = RANO, tariff = TARIFF) => ({
    now,
    site: SITE,
    plant: PLANT,
    tariff,
    pv: null,
    forecast: predpoved(zlomky, now),
    zdroj: null,
    loading: false,
    known: 'elektraren',
    previewMinutes: null,
});
const ZAMRACENE = 0.05;
/** Nedeľa a pondelok zamračené, od utorka slnko. */
const DVA_DNI = { '2026-09-06': ZAMRACENE, '2026-09-07': ZAMRACENE };

test('dniTyzdna: dnes a ďalšie dni s tým, čo sa zmestí na slnko; bez spotrebičov, predpovede či dneška nič', () => {
    const dni = dniTyzdna(input(DVA_DNI), DEVICES);
    assert.equal(dni.length, TYZDEN.dni);
    assert.deepEqual(
        dni.slice(0, 4).map((d) => [d.name, d.index, d.slnko.length > 0]),
        [
            ['Dnes', 0, true],
            ['Zajtra', 1, false],
            ['Pondelok', 2, false],
            ['Utorok', 3, true],
        ],
    );
    assert.equal(dni[1].ctx.nowMin, 0, 'iný deň sa rozvrhuje od polnoci');
    assert.deepEqual(dniTyzdna(input({}), []), []);
    assert.deepEqual(dniTyzdna({ ...input({}), forecast: null }, DEVICES), []);
    // Po polnoci pred obnovou predpoveď ešte začína včerajškom - poradie dní by nesedelo.
    assert.deepEqual(dniTyzdna({ ...input({}), now: new Date('2026-09-06T00:30:00+02:00') }, DEVICES), []);
});

test('hrebenModel: krivky dní v mierke týždňa, hranica veľkých spotrebičov, teraz na dnešnej krivke', () => {
    const h = hrebenModel(dniTyzdna(input(DVA_DNI), DEVICES));
    assert.ok(h);
    assert.deepEqual(
        h.dni.map((d) => [d.den, d.nad]),
        [
            ['So', true],
            ['Ne', false],
            ['Po', false],
            ['Ut', true],
            ['St', true],
            ['Št', true],
            ['Pi', true],
        ],
    );
    assert.ok(h.dni.every((d) => d.body.length === TYZDEN.body + 1 && d.body.every((v) => v >= 0 && v <= 1)));
    assert.equal(Math.max(...h.dni.flatMap((d) => d.body)), 1, 'najvyšší bod týždňa je navrchu');
    assert.ok(h.hranica > 0 && h.hranica < 1);
    assert.ok(Math.max(...h.dni[1].body) < h.hranica, 'zamračený deň ostáva pod hranicou');
    assert.ok(h.teraz && h.teraz.x === 0.25 && h.teraz.y > h.hranica, 'o 9:00 je štvrtina dňa a slnko už stačí');
    // V noci teraz na krivke nie je; týždeň bez slnka má hranicu stále vidno.
    assert.equal(hrebenModel(dniTyzdna(input({}, at('23:00')), DEVICES))?.teraz, null);
    const tma = Object.fromEntries(['05', '06', '07', '08', '09', '10', '11'].map((d) => [`2026-09-${d}`, 0.01]));
    assert.equal(hrebenModel(dniTyzdna(input(tma), DEVICES))?.hranica, Math.round(1000 / TYZDEN.nadHranicou) / 1000);
    assert.equal(hrebenModel([]), null);
    assert.equal(hrebenModel(dniTyzdna(input({}), DEVICES).slice(0, 1)), null, 'jeden deň nie je hrebeň');
});

test('dalsieSlnko: najbližší ďalší deň, keď sa spotrebič zmestí na slnko', () => {
    const dni = dniTyzdna(input(DVA_DNI), DEVICES);
    assert.deepEqual(dalsieSlnko(dni, 'pracka'), { name: 'Utorok', index: 3 });
    assert.deepEqual(dalsieSlnko(dniTyzdna(input({}), DEVICES), 'pracka'), { name: 'Zajtra', index: 1 });
    assert.equal(dalsieSlnko(dni.slice(0, 3), 'pracka'), null);
});

test('núdzový čas: cez deň s kúskom slnka, inak v lacnom pásme; sušička až po práčke', () => {
    // Zajtra tretina slnka: na celý program nestačí, ale kus pokryje.
    const slabo = dniTyzdna(input({ '2026-09-06': 0.3 }), VSETKO)[1];
    const zvysok = VSETKO.filter((id) => !slabo.slnko.some((r) => r.id === id));
    const n = nudzoveCasy(slabo.ctx, slabo.slnko, zvysok);
    const pracka = n.find((x) => x.id === 'pracka');
    const susicka = n.find((x) => x.id === 'susicka');
    assert.ok(pracka && susicka && pracka.start !== null && pracka.end !== null && susicka.start !== null);
    assert.equal(pracka.zdroj, 'slnko');
    assert.ok(pracka.podiel !== null && pracka.podiel >= TYZDEN.minPodiel && pracka.podiel <= 1);
    assert.equal(pracka.end - pracka.start, 120);
    assert.ok(susicka.start >= pracka.end, 'sušička až po práčke');
    assert.deepEqual(n.map((x) => x.id).sort(), [...zvysok].sort());
    assert.ok(
        n.every((x, i) => i === 0 || (x.start ?? Infinity) >= (n[i - 1].start ?? Infinity)),
        'podľa času',
    );
    // Deň bez slnka: lacné pásmo, do ktorého sa program zmestí celý, v hodinách, keď je človek hore
    // (bojler ráno o šiestej); auto do konca lacného pásma.
    const tma = dniTyzdna(input(DVA_DNI), VSETKO)[1];
    const t = nudzoveCasy(tma.ctx, [], VSETKO);
    assert.deepEqual(
        t.map((x) => [x.id, x.zdroj, x.start, x.end, x.podiel === null ? null : Math.round(x.podiel * 100)]),
        [
            ['auto', 'lacna', 0, 450, null],
            ['bojler', 'lacna', 360, 420, 0],
            ['pracka', 'lacna', 630, 750, 0],
            ['umyvacka', 'lacna', 630, 780, 0],
            ['susicka', 'lacna', 750, 840, 0],
        ],
    );
});

test('núdzový čas bez lacného pásma: mimo drahej siete, pri jednej cene s tým málom slnka, alebo je to jedno', () => {
    const spicka = dniTyzdna(input(DVA_DNI, RANO, SPICKA), VSETKO)[1];
    const s = nudzoveCasy(spicka.ctx, [], ['pracka', 'auto']);
    assert.deepEqual(s[0].zdroj, 'bezna');
    assert.ok(s[0].start !== null && s[0].start >= 7 * 60 && s[0].start + 120 <= 17 * 60, 'celá mimo drahého pásma');
    assert.deepEqual(s[1], { id: 'auto', start: null, end: null, podiel: null, zdroj: 'siet' });
    // Jedna cena: zamračený deň dá aspoň trochu slnka okolo poludnia.
    const jedna = dniTyzdna(input({ '2026-09-06': 0.08 }, RANO, JEDNA), VSETKO)[1];
    const j = nudzoveCasy(jedna.ctx, [], ['pracka'])[0];
    assert.equal(j.zdroj, 'slnko');
    assert.ok(j.podiel !== null && j.podiel > 0 && j.podiel < 1);
    assert.ok(j.start !== null && j.start > 8 * 60 && j.start < 15 * 60);
    // Dnes večer po západe, jedna cena: slnko nepomôže, je to jedno. Tesne pred polnocou program nedobehne.
    const vecer = dayCtx(input({}, at('21:30'), JEDNA));
    assert.deepEqual(nudzoveCasy(vecer, [], ['pracka']), [{ id: 'pracka', start: null, end: null, podiel: 0, zdroj: 'siet' }]);
    const polnoc = dayCtx(input({}, at('23:20'), JEDNA));
    assert.deepEqual(nudzoveCasy(polnoc, [], ['pracka', 'auto'])[0].start, null);
    // S lacným pásmom cez polnoc: štart v ňom, aj keď program dobehne až zajtra.
    const nt = nudzoveCasy(dayCtx(input({}, at('23:20'))), [], ['pracka'])[0];
    assert.deepEqual([nt.zdroj, nt.start, nt.end], ['lacna', 23 * 60 + 30, 25 * 60 + 30]);
});

test('denInyModel: hlavička dňa, čo ide zo slnka a čo najmenej zo siete, detaily s dňom pri čase', () => {
    const dni = dniTyzdna(input(DVA_DNI), DEVICES);
    const utorok = denInyModel(dni[3], DEVICES, true);
    assert.deepEqual(utorok.hlavicka, { nazov: 'Utorok', pod: '8.9. · o 3 dni' });
    assert.deepEqual(
        utorok.skupiny.map((g) => g.nazov),
        ['Zo slnka'],
    );
    const riadky = utorok.skupiny[0].riadky;
    assert.deepEqual(riadky.map((r) => r.id).sort(), [...DEVICES].sort());
    assert.ok(riadky.every((r, i) => r.kind === 'later' && r.podiel === null && (i === 0 || r.cas >= riadky[i - 1].cas)));
    assert.equal(riadky.find((r) => r.id === 'susicka')?.info, 'po práčke');
    const pracka = utorok.veci.find((v) => v.id === 'pracka');
    assert.equal(pracka?.den, 'Utorok');
    assert.equal(pracka?.kedy, 'V utorok zo slnka');
    assert.equal(pracka?.why, 'Ohrev chytí slnko.');
    assert.deepEqual([pracka?.slot?.tone, pracka?.slot?.dnes], ['go', false]);
});

test('denInyModel: deň bez slnka - núdzové časy s dňom pri čase, bez štartu bez úseku', () => {
    const dni = dniTyzdna(input(DVA_DNI), DEVICES);
    const nedela = denInyModel(dni[1], DEVICES, false, 'slusny');
    assert.deepEqual(nedela.hlavicka, { nazov: 'Zajtra', pod: 'nedeľa 6.9. · pod hranicou' });
    assert.deepEqual(
        nedela.skupiny.map((g) => g.nazov),
        ['Najmenej zo siete'],
    );
    assert.deepEqual(nedela.skupiny[0].riadky[1], {
        id: 'pracka',
        name: 'Práčka',
        kind: 'nudza',
        cas: '10:30',
        info: 'lacný prúd',
        podiel: 0,
    });
    const v = nedela.veci.find((x) => x.id === 'pracka');
    assert.deepEqual(
        { ...v, slot: undefined },
        {
            id: 'pracka',
            name: 'Práčka',
            tone: '',
            den: 'Zajtra',
            kedy: 'Najmenej zo siete',
            cas: '10:30 – 12:30',
            why: 'Slnko nepomôže, najmenej to stojí v lacnom pásme od 10:30.',
            slot: undefined,
        },
    );
    assert.deepEqual([v?.slot?.tone, v?.slot?.dnes], ['cheap', false]);
    // Auto v noci je mimo osi dňa len sčasti - úsek ostáva; núdzový čas bez štartu úsek nemá.
    const jedna = denInyModel(dniTyzdna(input(DVA_DNI, RANO, JEDNA), ['auto'])[1], ['auto'], false);
    assert.deepEqual(jedna.skupiny[0].riadky[0], {
        id: 'auto',
        name: 'Auto',
        kind: 'nudza',
        cas: '–',
        info: 'slnko nepomôže',
        podiel: null,
    });
    assert.equal(jedna.veci[0].slot, null);
});

test('karta Teraz pred dňami bez slnka: odznak „potom až v utorok“ na dlaždiciach aj v riadkoch', () => {
    const m = terazModel(input(DVA_DNI));
    assert.equal(m.hreben?.zvoleny, 0);
    assert.equal(m.co?.den, null);
    assert.deepEqual(
        m.co?.hore.dlazdice.map((d) => [d.id, d.potom]),
        [
            ['pracka', { text: 'potom až v utorok', dlho: true }],
            ['umyvacka', { text: 'potom až v utorok', dlho: true }],
        ],
    );
    assert.equal(m.co?.skupiny[0].riadky.find((r) => r.id === 'susicka')?.info, 'po práčke · potom až v utorok');
    // Zajtra slnko je: odznak nie je. Pozajtra: svetlý odznak bez „až“.
    assert.ok(terazModel(input({})).co?.hore.dlazdice.every((d) => d.potom === null));
    assert.deepEqual(terazModel(input({ '2026-09-06': ZAMRACENE })).co?.hore.dlazdice[0].potom, { text: 'potom v pondelok', dlho: false });
});

test('karta Teraz počas dní bez slnka: núdzové časy namiesto „o 3 dni“, veta hore a detail s dňom slnka', () => {
    const m = terazModel(input({ '2026-09-05': ZAMRACENE, ...DVA_DNI }), { devices: VSETKO });
    assert.deepEqual(m.co?.hore.oko, { text: 'Slnko až v utorok', sub: '2 dni zamračené' });
    assert.equal(m.co?.dlho, true);
    assert.deepEqual(
        m.co?.skupiny.map((g) => g.nazov),
        ['Najmenej zo siete'],
    );
    assert.deepEqual(
        m.co?.skupiny[0].riadky.map((r) => [r.id, r.kind, r.cas, r.info, r.podiel]),
        [
            ['pracka', 'nudza', '10:30', 'lacný prúd · naplno v utorok', 0],
            ['umyvacka', 'nudza', '10:30', 'lacný prúd · naplno v utorok', 0],
            ['susicka', 'nudza', '12:30', 'lacný prúd · naplno v utorok', 0],
        ],
    );
    const pracka = m.veci.find((v) => v.id === 'pracka');
    assert.equal(pracka?.why, 'Slnko nepomôže, najmenej to stojí v lacnom pásme od 10:30. Celé zo slnka v utorok.');
    assert.deepEqual([pracka?.den, pracka?.slot?.tone, pracka?.slot?.dnes], ['', 'cheap', true]);
});

test('karta Teraz v slabý deň: umývačka sa zmestí, pranie dostane čas s kusom slnka a zlatý úsek', () => {
    const slabo = terazModel(input({ '2026-09-05': 0.3, '2026-09-06': ZAMRACENE }));
    const nudza = slabo.co?.skupiny.find((g) => g.nazov === 'Najmenej zo siete')?.riadky ?? [];
    assert.deepEqual(
        nudza.map((r) => r.id),
        ['pracka', 'susicka'],
    );
    assert.ok(nudza.every((r) => r.podiel !== null && r.podiel >= 25 && / zo slnka · naplno v pondelok$/.test(r.info)));
    assert.equal(slabo.veci.find((v) => v.id === 'pracka')?.slot?.tone, 'part');
});

test('karta Teraz so zvoleným dňom: plán toho dňa, dnešok ostáva v hornej časti modelu; deň mimo predpovede je dnešok', () => {
    const i = input(DVA_DNI);
    const utorok = terazModel(i, { den: 3 });
    assert.equal(utorok.hreben?.zvoleny, 3);
    assert.deepEqual(utorok.co?.den, { nazov: 'Utorok', pod: '8.9. · o 3 dni' });
    assert.deepEqual(
        utorok.co?.skupiny.map((g) => g.nazov),
        ['Zo slnka'],
    );
    assert.ok(utorok.veci.every((v) => v.den === 'Utorok'));
    assert.equal(utorok.num, terazModel(i).num, 'číslo je vždy teraz');
    const nedela = terazModel(i, { den: 1 });
    assert.equal(nedela.co?.den?.pod, 'nedeľa 6.9. · pod hranicou');
    assert.equal(nedela.co?.skupiny[0].nazov, 'Najmenej zo siete');
    const mimo = terazModel(i, { den: 99 });
    assert.equal(mimo.hreben?.zvoleny, 0);
    assert.equal(mimo.co?.den, null);
    // Bez hrebeňa (predpoveď nezačína dneškom) je karta len dnešok.
    const poPolnoci = terazModel({ ...input({}), now: new Date('2026-09-06T00:30:00+02:00') }, { den: 2 });
    assert.equal(poPolnoci.hreben, null);
    assert.equal(poPolnoci.co?.den, null);
});

test('texty týždňa: odznak, hlavička dňa a núdzový čas v oboch tónoch', () => {
    assert.deepEqual(terazPotomText(null), { text: 'potom tento týždeň nie', dlho: true });
    assert.deepEqual(terazPotomText({ name: 'Piatok', index: 2 }), { text: 'potom v piatok', dlho: false });
    assert.deepEqual(terazDenHlavickaText({ date: '2026-09-10', index: 5, nad: false }), {
        nazov: 'Štvrtok',
        pod: '10.9. · o 5 dní · pod hranicou',
    });
    /** @param {Partial<Parameters<typeof terazNudzaText>[0]>} r */
    const n = (r) => terazNudzaText({ start: 750, end: 870, podiel: 0.5, zdroj: 'slnko', dnes: true, potom: 'Pondelok', ...r });
    assert.deepEqual(n({}), {
        cas: '12:30',
        info: 'polovica zo slnka · naplno v pondelok',
        kedy: 'Najmenej zo siete',
        odDo: '12:30 – 14:30',
        why: 'Slnko na celý program nestačí. O 12:30 ho pokryje najviac, zvyšok pôjde zo siete. Celé zo slnka v pondelok.',
    });
    assert.deepEqual(
        [0.1, 0.3, 0.7, 0.9].map((podiel) => n({ podiel, dnes: false }).info),
        ['trochu zo slnka', 'tretina zo slnka', 'dve tretiny zo slnka', 'takmer celé zo slnka'],
    );
    assert.equal(n({ zdroj: 'bezna', potom: null }).info, 'mimo drahej siete');
    assert.equal(
        n({ zdroj: 'bezna', potom: null }).why,
        'Slnko nepomôže, od 12:30 to aspoň nejde z drahej siete. Celé zo slnka tento týždeň podľa predpovede nie.',
    );
    const jedno = { start: null, end: null, podiel: 0, zdroj: /** @type {const} */ ('siet') };
    assert.deepEqual([n(jedno).cas, n(jedno).odDo, n(jedno).info], ['–', '–', 'slnko nepomôže · naplno v pondelok']);
    assert.equal(n({ ...jedno, potom: null }).why.startsWith('Slnko nepomôže a sieť dnes už lacnejšia nebude. Pusti, keď treba.'), true);
    assert.equal(
        terazNudzaText({ ...jedno, dnes: false, potom: null }, 'slusny').why,
        'Slnko nepomôže a sieť je v ten deň stále rovnako drahá. Pustite, keď treba.',
    );
    assert.equal(n({ zdroj: 'lacna', end: 1440 }).odDo, '12:30 – 24:00');
});
