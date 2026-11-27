import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_DNA, PLANT, SITE, TARIFF, TYZDEN } from '../shared/config.js';
import { terazNudzaText, terazPotomText } from '../shared/messages.js';
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

test('hrebenModel: počasie dní, okná nad hranicou veľkých spotrebičov na osi svetla, teraz na tej istej osi', () => {
    const h = hrebenModel(dniTyzdna(input(DVA_DNI), DEVICES));
    assert.ok(h);
    assert.deepEqual(
        h.dni.map((d) => [d.den, d.nad, d.okna.length > 0]),
        [
            ['So', true, true],
            ['Ne', false, false],
            ['Po', false, false],
            ['Ut', true, true],
        ],
    );
    assert.equal(h.dni.length, TYZDEN.dni);
    assert.ok(h.dni.every((d) => d.pocasie === null || ['jasno', 'polojasno', 'zamracene'].includes(d.pocasie)));
    const so = h.dni[0].okna;
    assert.equal(so.length, 1, 'jasný deň má jedno súvislé okno');
    assert.ok(so[0].zac > 0 && so[0].zac < so[0].kon && so[0].kon < 1, 'okno je vnútri dňa, nie od východu po západ');
    assert.equal(h.teraz, 0.25, 'o 9:00 je štvrtina dňa');
    // Počasie z oblačnosti dňa, bez nej nič.
    const vstup = input(DVA_DNI);
    const f = /** @type {NonNullable<typeof vstup.forecast>} */ (vstup.forecast);
    const zmena = {
        ...vstup,
        forecast: { ...f, days: f.days.map((d, i) => ({ ...d, cloudAvgPct: i < 4 ? [5, 50, 95, null][i] : d.cloudAvgPct })) },
    };
    assert.deepEqual(
        hrebenModel(dniTyzdna(zmena, DEVICES))?.dni.map((d) => d.pocasie),
        ['jasno', 'polojasno', 'zamracene', null],
    );
    // V noci teraz na osi nie je.
    assert.equal(hrebenModel(dniTyzdna(input({}, at('23:00')), DEVICES))?.teraz, null);
    assert.equal(hrebenModel([]), null);
    assert.equal(hrebenModel(dniTyzdna(input({}), DEVICES).slice(0, 1)), null, 'jeden deň nie je pás');
});

test('dalsieSlnko: najbližší ďalší deň, keď sa spotrebič zmestí na slnko', () => {
    const dni = dniTyzdna(input(DVA_DNI), DEVICES);
    assert.deepEqual(dalsieSlnko(dni, 'pracka'), { name: 'Utorok', kratko: 'Ut', index: 3 });
    assert.deepEqual(dalsieSlnko(dniTyzdna(input({}), DEVICES), 'pracka'), { name: 'Zajtra', kratko: 'Ne', index: 1 });
    assert.equal(dalsieSlnko(dni.slice(0, 3), 'pracka'), null);
});

test('núdzový čas: cez deň s kúskom slnka, inak v lacnom pásme; sušička až po práčke', () => {
    // Zajtra tretina slnka: na celý program nestačí, ale kus pokryje.
    const slabo = dniTyzdna(input({ '2026-09-06': 0.3 }), VSETKO)[1];
    const zvysok = VSETKO.filter((id) => id !== 'auto' && !slabo.slnko.some((r) => r.id === id));
    const n = nudzoveCasy(slabo.ctx, slabo.slnko, zvysok);
    const pracka = n.find((x) => x.id === 'pracka');
    const susicka = n.find((x) => x.id === 'susicka');
    assert.ok(pracka && susicka && pracka.start !== null && pracka.end !== null && susicka.start !== null);
    assert.equal(pracka.zdroj, 'slnko');
    assert.ok(pracka.podiel >= TYZDEN.minPodiel && pracka.podiel <= 1);
    assert.equal(pracka.end - pracka.start, 120);
    assert.ok(susicka.start >= pracka.end, 'sušička až po práčke');
    assert.deepEqual(n.map((x) => x.id).sort(), [...zvysok].sort());
    assert.ok(
        n.every((x, i) => i === 0 || (x.start ?? Infinity) >= (n[i - 1].start ?? Infinity)),
        'podľa času',
    );
    // Deň bez slnka: lacné pásmo, do ktorého sa program zmestí celý, v hodinách, keď je človek hore
    // (bojler ráno o šiestej). Auto v pláne nie je (docs/navrhy/auto-mimo-planu.html).
    const tma = dniTyzdna(input(DVA_DNI), VSETKO)[1];
    const t = nudzoveCasy(tma.ctx, [], VSETKO);
    assert.deepEqual(
        t.map((x) => [x.id, x.zdroj, x.start, x.end, Math.round(x.podiel * 100)]),
        [
            ['bojler', 'lacna', 360, 420, 0],
            ['pracka', 'lacna', 630, 750, 0],
            ['umyvacka', 'lacna', 630, 780, 0],
            ['susicka', 'lacna', 750, 840, 0],
        ],
    );
});

test('núdzový čas bez lacného pásma: bežná elektrina, pri jednej cene s tým málom slnka, alebo je to jedno', () => {
    const spicka = dniTyzdna(input(DVA_DNI, RANO, SPICKA), VSETKO)[1];
    const s = nudzoveCasy(spicka.ctx, [], ['pracka', 'auto']);
    assert.deepEqual(s[0].zdroj, 'bezna');
    assert.ok(s[0].start !== null && s[0].start >= 7 * 60 && s[0].start + 120 <= 17 * 60, 'celá mimo drahého pásma');
    assert.equal(s.length, 1, 'auto v pláne nie je');
    // Jedna cena: zamračený deň dá aspoň trochu slnka okolo poludnia.
    const jedna = dniTyzdna(input({ '2026-09-06': 0.08 }, RANO, JEDNA), VSETKO)[1];
    const j = nudzoveCasy(jedna.ctx, [], ['pracka'])[0];
    assert.equal(j.zdroj, 'slnko');
    assert.ok(j.podiel > 0 && j.podiel < 1);
    assert.ok(j.start !== null && j.start > 8 * 60 && j.start < 15 * 60);
    // Dnes večer po západe, jedna cena: slnko nepomôže, je to jedno. Tesne pred polnocou program nedobehne.
    const vecer = dayCtx(input({}, at('21:30'), JEDNA));
    assert.deepEqual(nudzoveCasy(vecer, [], ['pracka']), [{ id: 'pracka', start: null, end: null, podiel: 0, draha: 0, zdroj: 'siet' }]);
    const polnoc = dayCtx(input({}, at('23:20'), JEDNA));
    assert.deepEqual(nudzoveCasy(polnoc, [], ['pracka', 'auto'])[0].start, null);
    // S lacným pásmom cez polnoc: štart v ňom, aj keď program dobehne až zajtra.
    const nt = nudzoveCasy(dayCtx(input({}, at('23:20'))), [], ['pracka'])[0];
    assert.deepEqual([nt.zdroj, nt.start, nt.end], ['lacna', 23 * 60 + 30, 25 * 60 + 30]);
});

test('denInyModel: čo ide zo slnka a čo najmenej zo siete, detaily s dňom pri čase', () => {
    const dni = dniTyzdna(input(DVA_DNI), DEVICES);
    const utorok = denInyModel(dni[3], DEVICES);
    // Všetko ide zo slnka - mriežka bez núdzových časov.
    const riadky = utorok.riadky;
    assert.deepEqual(riadky.map((r) => r.id).sort(), [...DEVICES].sort());
    assert.ok(riadky.every((r, i) => r.kind === 'later' && r.podiel >= 50 && r.podiel <= 100 && (i === 0 || r.cas >= riadky[i - 1].cas)));
    assert.deepEqual(riadky.find((r) => r.id === 'susicka')?.odr, ['po práčke']);
    const pracka = utorok.veci.find((v) => v.id === 'pracka');
    assert.equal(pracka?.den, 'Utorok');
    assert.equal(pracka?.kedy, 'V utorok zo slnka');
    assert.equal(pracka?.why, 'Ohrev chytí slnko.');
    assert.deepEqual([pracka?.slot?.tone, pracka?.slot?.dnes], ['go', false]);
});

test('denInyModel: deň bez slnka - núdzové časy s dňom pri čase, bez štartu bez úseku', () => {
    const dni = dniTyzdna(input(DVA_DNI), DEVICES);
    const nedela = denInyModel(dni[1], DEVICES, 'slusny');
    assert.ok(nedela.riadky.every((r) => r.kind === 'nudza'));
    assert.deepEqual(nedela.riadky[0], {
        id: 'pracka',
        name: 'Práčka',
        kind: 'nudza',
        zn: 'start',
        cas: '10:30',
        odr: ['lacná elektrina'],
        mv: [{ zn: 'koniec', t: '12:30' }],
        podiel: 0,
        draha: 0,
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
    // Núdzový čas bez štartu úsek nemá.
    const jedna = denInyModel(dniTyzdna(input(DVA_DNI, RANO, JEDNA), ['pracka'])[1], ['pracka']);
    assert.deepEqual(jedna.riadky[0], {
        id: 'pracka',
        name: 'Práčka',
        kind: 'nudza',
        cas: '–',
        odr: ['slnko nepomôže'],
        mv: [],
        podiel: 0,
        draha: 0,
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
            ['pracka', { text: 'potom až v utorok', kratko: 'Ut', dlho: true }],
            ['umyvacka', { text: 'potom až v utorok', kratko: 'Ut', dlho: true }],
        ],
    );
    const susicka = m.co?.riadky.find((r) => r.id === 'susicka');
    assert.deepEqual([susicka?.odr, susicka?.potom?.text], [['po práčke'], 'potom až v utorok']);
    // Zajtra slnko je: odznak nie je. Pozajtra: svetlý odznak bez „až“.
    assert.ok(terazModel(input({})).co?.hore.dlazdice.every((d) => d.potom === null));
    assert.deepEqual(terazModel(input({ '2026-09-06': ZAMRACENE })).co?.hore.dlazdice[0].potom, {
        text: 'potom v pondelok',
        kratko: 'Po',
        dlho: false,
    });
});

test('karta Teraz počas dní bez slnka: núdzové časy namiesto „o 3 dni“ a detail s dňom slnka', () => {
    const m = terazModel(input({ '2026-09-05': ZAMRACENE, ...DVA_DNI }), { devices: VSETKO });
    assert.deepEqual(
        m.co?.riadky.map((r) => [r.id, r.kind, r.cas, r.odr, r.podiel]),
        [
            ['pracka', 'nudza', '10:30', ['lacná elektrina', 'celá v utorok'], 0],
            ['umyvacka', 'nudza', '10:30', ['lacná elektrina', 'celá v utorok'], 0],
            ['susicka', 'nudza', '12:30', ['lacná elektrina', 'celá v utorok'], 0],
        ],
    );
    const pracka = m.veci.find((v) => v.id === 'pracka');
    assert.equal(pracka?.why, 'Slnko nepomôže, najmenej to stojí v lacnom pásme od 10:30. Celé zo slnka v utorok.');
    assert.deepEqual([pracka?.den, pracka?.slot?.tone, pracka?.slot?.dnes], ['', 'cheap', true]);
});

test('karta Teraz v slabý deň: umývačka sa zmestí, pranie dostane čas s kusom slnka a zlatý úsek', () => {
    const slabo = terazModel(input({ '2026-09-05': 0.3, '2026-09-06': ZAMRACENE }));
    const nudza = (slabo.co?.riadky ?? []).filter((r) => r.kind === 'nudza');
    assert.deepEqual(
        nudza.map((r) => r.id),
        ['pracka', 'susicka'],
    );
    assert.ok(nudza.every((r) => r.podiel !== null && r.podiel >= 25 && / zo slnka$/.test(r.odr[0]) && r.odr[1] === 'celá v pondelok'));
    assert.equal(slabo.veci.find((v) => v.id === 'pracka')?.slot?.tone, 'part');
});

test('karta Teraz so zvoleným dňom: plán toho dňa, dnešok ostáva v hornej časti modelu; deň mimo predpovede je dnešok', () => {
    const i = input(DVA_DNI);
    const utorok = terazModel(i, { den: 3 });
    assert.equal(utorok.hreben?.zvoleny, 3);
    assert.ok(utorok.co?.riadky.every((r) => r.kind === 'later'));
    assert.ok(utorok.veci.every((v) => v.den === 'Utorok'));
    assert.equal(utorok.num, terazModel(i).num, 'číslo je vždy teraz');
    const nedela = terazModel(i, { den: 1 });
    assert.ok(nedela.co?.riadky.every((r) => r.kind === 'nudza'));
    const mimo = terazModel(i, { den: 99 });
    assert.equal(mimo.hreben?.zvoleny, 0);
    assert.equal(mimo.co?.den, null);
    // Bez hrebeňa (predpoveď nezačína dneškom) je karta len dnešok.
    const poPolnoci = terazModel({ ...input({}), now: new Date('2026-09-06T00:30:00+02:00') }, { den: 2 });
    assert.equal(poPolnoci.hreben, null);
    assert.equal(poPolnoci.co?.den, null);
});

test('karta Teraz so zvoleným dňom: tok dňa pod pásom dní', () => {
    const i = input(DVA_DNI);
    const utorok = terazModel(i, { den: 3 });
    const nedela = terazModel(i, { den: 1 });
    // Tok dňa (docs/navrhy/teraz-pole-ine-dni.html, B): dom bez učenia 24 h × HOUSE_BASE_KW a programy práčky, umývačky a sušičky.
    assert.deepEqual(utorok.co?.den?.cisla, { slnko: '54', dom: '14', siet: { k: 'von', kw: '40' } });
    assert.equal(utorok.co?.den?.popis, 'Za deň zo slnka asi 54 kWh, dom spotrebuje 14 kWh, do siete pôjde 40 kWh');
    // Bojler doma pridá svoju potrebu (bez učenia program bojlera, 2 kWh).
    assert.equal(terazModel(i, { den: 3, devices: [...DEVICES, 'bojler'] }).co?.den?.cisla.dom, '16');
    assert.deepEqual(nedela.co?.den?.cisla, { slnko: '2', dom: '14', siet: { k: 'dnu', kw: '12' } });
});

test('texty týždňa: odznak a núdzový čas v oboch tónoch', () => {
    assert.deepEqual(terazPotomText(null), { text: 'tento týždeň už nie', kratko: '–', dlho: true });
    assert.deepEqual(terazPotomText({ name: 'Piatok', kratko: 'Pi', index: 2 }), { text: 'potom v piatok', kratko: 'Pi', dlho: false });
    /** @param {Partial<Parameters<typeof terazNudzaText>[0]>} r */
    const n = (r) => terazNudzaText({ start: 750, end: 870, podiel: 0.5, zdroj: 'slnko', dnes: true, potom: 'Pondelok', ...r });
    assert.deepEqual(n({}), {
        cas: '12:30',
        odr: ['polovica zo slnka', 'celá v pondelok'],
        mv: [
            { zn: 'slnko', t: '50 %' },
            { zn: 'koniec', t: '14:30' },
        ],
        kedy: 'Najmenej zo siete',
        odDo: '12:30 – 14:30',
        why: 'Slnko na celý program nestačí. O 12:30 ho pokryje najviac, zvyšok pôjde zo siete. Celé zo slnka v pondelok.',
    });
    assert.deepEqual(
        [0.1, 0.3, 0.7, 0.9].map((podiel) => n({ podiel, dnes: false }).odr),
        [['trochu zo slnka'], ['tretina zo slnka'], ['väčšina zo slnka'], ['skoro celé zo slnka']],
    );
    assert.deepEqual(n({ zdroj: 'bezna', potom: null }).odr, ['bežná elektrina']);
    assert.equal(
        n({ zdroj: 'bezna', potom: null }).why,
        'Slnko nepomôže, od 12:30 to aspoň nejde z drahej siete. Celé zo slnka tento týždeň podľa predpovede nie.',
    );
    const jedno = { start: null, end: null, podiel: 0, zdroj: /** @type {const} */ ('siet') };
    assert.deepEqual([n(jedno).cas, n(jedno).odDo, n(jedno).odr, n(jedno).mv], ['–', '–', ['slnko nepomôže', 'celá v pondelok'], []]);
    // V lacnom pásme na dlaždici len koniec, slnko nie.
    assert.deepEqual(n({ zdroj: 'lacna' }).mv, [{ zn: 'koniec', t: '14:30' }]);
    assert.equal(n({ ...jedno, potom: null }).why.startsWith('Slnko nepomôže a sieť dnes už lacnejšia nebude. Pusti, keď treba.'), true);
    assert.equal(
        terazNudzaText({ ...jedno, dnes: false, potom: null }, 'slusny').why,
        'Slnko nepomôže a sieť je v ten deň stále rovnako drahá. Pustite, keď treba.',
    );
    assert.equal(n({ zdroj: 'lacna', end: 1440 }).odDo, '12:30 – 24:00');
});
