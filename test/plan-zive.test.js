// Plán dňa zo živých dát (docs/navrhy/plan-dna-zive-data.html): oprava predpovede meraním, živé meranie v rozpočte,
// bojler, ktorý riadi zásuvka, pred ostatnými spotrebičmi a texty k tomu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOJLER, HOUSE_BASE_KW, PLAN_ZIVE, PLANT, SITE, TARIFF } from '../shared/config.js';
import { simulujBojler } from '../shared/bojler.js';
import { dayKwAt, opravaPredpovede, opravenaPredpoved } from '../shared/chart-model.js';
import { planDnaRowText, planTileText, terazRiadokText } from '../shared/messages.js';
import { dayCtx, freeKw, ziveMeranie } from '../shared/mozem-jadro.js';
import { planDna, planDnaModel } from '../shared/plan-dna.js';
import { bojlerDetail, bojlerDlazdica } from '../shared/teraz-bojler.js';
import { fixtureData } from './helpers.js';

/** Miestny čas 5. 9. 2026 v Bratislave (letný čas). @param {string} hm */
const at = (hm) => new Date(`2026-09-05T${hm}:00+02:00`);
const MIN = 60000;
/** Hodinová predpoveď s rovnakým výkonom celý deň. @param {number} kw */
const rovna = (kw) => Array.from({ length: 24 }, (_, hour) => ({ hour, kw, cloud: 0 }));
/** Krivka merania po 5 minútach od `od` po `po` (hodiny). @param {number} od @param {number} po @param {number} kw */
const krivka = (od, po, kw) => Array.from({ length: Math.round((po - od) * 12) + 1 }, (_, i) => ({ hour: od + i / 12, kw }));

test('oprava predpovede: pomer za poslednú hodinu, obmedzený, s prahom, celý hodinu a potom sa vytratí', () => {
    const fc = rovna(4);
    // Strecha dáva polovicu predpovede.
    assert.deepEqual(opravaPredpovede(krivka(8, 10, 2), fc, 600), { k: 0.5, od: 600 });
    assert.equal(dayKwAt(600 + PLAN_ZIVE.plnaMin, krivka(8, 10, 2), fc, 600), 2);
    const polcesta = 600 + (PLAN_ZIVE.plnaMin + PLAN_ZIVE.doMin) / 2;
    assert.equal(dayKwAt(polcesta, krivka(8, 10, 2), fc, 600), 3, 'v polovici vytrácania polovica opravy');
    assert.equal(dayKwAt(600 + PLAN_ZIVE.doMin, krivka(8, 10, 2), fc, 600), 4, 'potom čistá predpoveď');
    assert.equal(dayKwAt(540, krivka(8, 10, 2), fc, 600), 2, 'do merania meranie');
    // Pod prahom nič, nad hranicami orezané.
    assert.equal(opravaPredpovede(krivka(8, 10, 4 * (1 + PLAN_ZIVE.prah / 2)), fc, 600), null);
    assert.equal(opravaPredpovede(krivka(8, 10, 40), fc, 600)?.k, PLAN_ZIVE.kMax);
    assert.equal(opravaPredpovede(krivka(8, 10, 0), fc, 600)?.k, PLAN_ZIVE.kMin);
    // Bez dosť meraní, slabá predpoveď (ráno), bez dát.
    assert.equal(opravaPredpovede(krivka(9.9, 10, 2), fc, 600), null);
    assert.equal(opravaPredpovede(krivka(8, 10, 0.1), rovna(PLAN_ZIVE.minKw / 2), 600), null);
    assert.equal(opravaPredpovede(null, fc, 600), null);
    assert.equal(opravaPredpovede(krivka(8, 10, 2), [], 600), null);
});

test('opravenaPredpoved: graf dňa ukazuje tú istú opravu ako dayKwAt, pred meraním nič nemení', () => {
    const fc = rovna(4);
    const o = opravenaPredpoved(krivka(8, 10, 2), fc, 600);
    assert.deepEqual([o[9].kw, o[10].kw, o[11].kw, o[13].kw], [4, 4, 2, 4]);
    assert.equal(o[11].kw, dayKwAt(660, krivka(8, 10, 2), fc, 600));
    assert.equal(opravenaPredpoved(krivka(8, 10, 4), fc, 600), fc, 'bez opravy ten istý zoznam');
});

/** Vstup s predpoveďou z fixtures a vlastným meraním. @param {string} hm @param {object} [pv] @param {object} [extra] */
function vstup(hm, pv, extra = {}) {
    const now = at(hm);
    const { forecast } = fixtureData(now);
    const meranie = pv ? { ...fixtureData(now).pv, realCurveToday: [], measuredAt: now.toISOString(), ...pv } : null;
    return { now, site: SITE, plant: PLANT, tariff: TARIFF, loading: false, pv: meranie, forecast, ...extra };
}

test('živé meranie: výkon teraz a základ domu z elektromera bez bežiacich spotrebičov a bojlera, staré nič', () => {
    const nowMin = 12 * 60;
    assert.deepEqual(ziveMeranie(vstup('12:00', null), nowMin), { nowMin, vyrobaKw: null, zakladKw: null });
    assert.deepEqual(ziveMeranie(vstup('12:00', { realTimePowerKw: 5, sietKw: null }), nowMin), { nowMin, vyrobaKw: 5, zakladKw: null });
    // Dom 5 - 3,2 = 1,8 kW, z toho bojler 1,2 kW: základ 0,6 kW.
    const bojler = { kontaktAt: at('12:00').getTime(), rele: true, w: 1200 };
    assert.equal(ziveMeranie(vstup('12:00', { realTimePowerKw: 5, sietKw: 3.2 }, { bojler }), nowMin).zakladKw, 0.6);
    // Práčka beží od 11:50 - prvých 20 minút hreje 2 kW, dom bez nej je pod minimom.
    const bezi = [{ id: 'pracka', d: '2026-09-05', m: 710, k: 830 }];
    assert.equal(ziveMeranie(vstup('12:00', { realTimePowerKw: 5, sietKw: 3.2 }, { bezi }), nowMin).zakladKw, PLAN_ZIVE.domMin);
    assert.equal(ziveMeranie(vstup('12:00', { realTimePowerKw: 5, sietKw: -10 }), nowMin).zakladKw, PLAN_ZIVE.domMax);
    // Staré meranie, meranie z budúcnosti a kiosk bez času podľa posledného bodu krivky.
    const stare = { realTimePowerKw: 5, measuredAt: new Date(at('12:00').getTime() - (PLAN_ZIVE.meranieMin + 1) * MIN).toISOString() };
    assert.equal(ziveMeranie(vstup('12:00', stare), nowMin).vyrobaKw, null);
    const kiosk = (/** @type {number} */ po) => ({ realTimePowerKw: 5, measuredAt: undefined, realCurveToday: krivka(8, po, 5) });
    assert.equal(ziveMeranie(vstup('12:00', kiosk(11.9)), nowMin).vyrobaKw, 5);
    assert.equal(ziveMeranie(vstup('12:00', kiosk(13)), nowMin).vyrobaKw, null);
    assert.equal(ziveMeranie(vstup('12:00', kiosk(11)), nowMin).vyrobaKw, null);
    assert.equal(ziveMeranie(vstup('12:00', { realTimePowerKw: 5, measuredAt: undefined }), nowMin).vyrobaKw, null);
});

test('rozpočet: štvrťhodina teraz z merania, základ domu hodinu a potom späť k predvolenému, iný deň bez merania', () => {
    const i = vstup('12:07', { realTimePowerKw: 1, sietKw: -0.5 });
    const ctx = dayCtx(i);
    // Dom 1,5 kW: z merania ostáva nula, hoci predpoveď na poludnie sľubuje veľa.
    assert.equal(freeKw(ctx, 12 * 60 + 7), 0);
    assert.equal(freeKw(ctx, 12 * 60 + 29), 0, 'aj štvrťhodina, od ktorej plán púšťa');
    const slot = (/** @type {number} */ m) => ctx.plan[Math.floor(m / 15)].kw;
    assert.equal(freeKw(ctx, 12 * 60 + 30), Math.max(0, slot(750) - 1.5), 'potom predpoveď a dom z merania');
    const neskor = 12 * 60 + 7 + PLAN_ZIVE.doMin;
    assert.equal(freeKw(ctx, neskor), Math.max(0, slot(neskor) - HOUSE_BASE_KW));
    const cely = { ...ctx, nowMin: 0 };
    assert.equal(freeKw(cely, 12 * 60 + 7), Math.max(0, slot(727) - HOUSE_BASE_KW), 'kópia od polnoci meranie nevidí');
});

/** Bojler, ktorý riadi zásuvka. @param {object} [o] */
const bojlerInfo = (o = {}) => ({
    kontaktAt: at('09:00').getTime(),
    rele: false,
    w: 0,
    prebytokKw: 0,
    prahy: { zapKw: BOJLER.zapKw, vypKw: BOJLER.vypKw },
    den: null,
    rucne: false,
    ...o,
});
const SIM = { nowMin: 540, now: at('09:00').getTime(), dnes: '2026-09-05', potrebaWh: 2000, kw: 2, krokMin: 5 };
/** Prebytok bez bojlera: `kw` od `od` minúty, inak nič. @param {number} od @param {number} kw */
const prebytok = (od, kw) => Array.from({ length: 1440 }, (_, m) => (m >= od ? kw : 0));

test('simulujBojler: zapne po dvoch meraniach nad prahom, hreje kým nedostane potrebu, potom nič', () => {
    const r = simulujBojler(prebytok(600, 3), bojlerInfo(), SIM);
    assert.equal(r.zapne, 605, 'druhé meranie nad prahom');
    assert.equal(r.dohreje, 665, '2 kWh pri 2 kW je hodina');
    assert.equal(r.nahriaty, false);
    assert.deepEqual([r.odber[604], r.odber[605], r.odber[664], r.odber[665]], [0, 2, 2, 0]);
    // Slabý prebytok: dnes nezapne.
    assert.deepEqual(simulujBojler(prebytok(600, 2), bojlerInfo(), SIM).zapne, null);
    // Vypne pod prahom a znova zapne - dohreje neskôr.
    const mrak = prebytok(600, 3).map((kw, m) => (m >= 615 && m < 640 ? 1 : kw));
    const s = simulujBojler(mrak, bojlerInfo(), SIM);
    assert.ok((s.dohreje ?? 0) > 665);
});

test('simulujBojler: hreje teraz, časť už nahrial, nahriaty, ručný režim', () => {
    const den = (/** @type {number | null} */ hotovo, /** @type {number} */ wh) => ({
        den: '2026-09-05',
        behy: [{ od: 500, do: hotovo, wh, whSiet: 0, e0: 0, hrejeMin: 30 }],
        hotovo,
        posledneAt: 0,
    });
    const hreje = simulujBojler(prebytok(540, 3), bojlerInfo({ rele: true, w: 1800, den: den(null, 1100) }), SIM);
    assert.deepEqual([hreje.zapne, hreje.dohreje, hreje.odber[540]], [null, 570, 1.8], '900 Wh pri 1,8 kW je pol hodiny');
    const nahriaty = simulujBojler(prebytok(540, 3), bojlerInfo({ rele: true, w: 10, den: den(null, 900) }), SIM);
    assert.equal(nahriaty.nahriaty, true);
    assert.equal(simulujBojler(prebytok(540, 3), bojlerInfo({ den: den(520, 900) }), SIM).nahriaty, true, 'dnes už dohrial');
    assert.equal(simulujBojler(prebytok(540, 3), bojlerInfo({ den: den(null, 2500) }), SIM).nahriaty, true, 'má, čo potrebuje');
    assert.equal(simulujBojler(prebytok(540, 3), bojlerInfo({ rucne: true }), SIM).zapne, null, 'ručne appka nezapína');
    const rucne = simulujBojler(prebytok(540, 0), bojlerInfo({ rucne: true, rele: true, w: 2000 }), SIM);
    assert.equal(rucne.dohreje, 600, 'ručne zapnutý hreje aj bez slnka');
});

/** Predpoveď dneška zmenšená na zlomok - slnko na bojler aj práčku naraz nestačí. @param {number} k */
function slabsie(k) {
    const { forecast } = fixtureData(at('09:00'));
    const d0 = forecast.days[0];
    return {
        ...forecast,
        hourlyToday: forecast.hourlyToday.map((p) => ({ ...p, kw: p.kw * k })),
        days: [{ ...d0, hourly: d0.hourly.map((p) => ({ ...p, kw: p.kw * k })) }, ...forecast.days.slice(1)],
    };
}

test('bojler s prednosťou: plán ho odsimuluje prvý, práčka ide po ňom, sušička hneď po práčke', () => {
    const devices = ['pracka', 'susicka', 'umyvacka', 'bojler'];
    const forecast = slabsie(0.55);
    const bez = vstup('09:00', null, { forecast });
    const s = vstup('09:00', null, { forecast, bojler: bojlerInfo() });
    const rowsBez = planDna(dayCtx(bez), bez, devices);
    const m = /** @type {NonNullable<ReturnType<typeof planDnaModel>>} */ (planDnaModel(s, { devices }));
    assert.ok(m.bojler && m.bojler.zapne !== null && m.bojler.dohreje !== null, 'zapne aj dohreje');
    assert.equal(
        m.rows.find((r) => r.id === 'bojler'),
        undefined,
        'bojler riadený zásuvkou riadok nemá',
    );
    const pracka = /** @type {any} */ (m.rows.find((r) => r.id === 'pracka'));
    const predtym = /** @type {any} */ (rowsBez.find((r) => r.id === 'pracka'));
    assert.ok(pracka.start > predtym.start, 'práčka po bojleri');
    assert.equal(pracka.poBojleri, true);
    assert.equal(pracka.why, 'po bojleri, ohrev chytí slnko');
    const susicka = /** @type {any} */ (m.rows.find((r) => r.id === 'susicka'));
    assert.equal(susicka.start, pracka.end, 'sušička hneď po práčke');
    assert.notEqual(susicka.poBojleri, true, 'sušička ide po práčke, nie po bojleri');
    // Zásuvka, ktorá sa dlho neozvala, bojler neriadi - plán je ako bez nej.
    const ticho = vstup('09:00', null, { bojler: bojlerInfo({ kontaktAt: at('09:00').getTime() - (BOJLER.riadenyHod + 1) * 3600000 }) });
    assert.equal(planDnaModel(ticho, { devices })?.bojler, null);
    // Nahriaty bojler nič neberie.
    const den = { den: '2026-09-05', behy: [{ od: 400, do: 460, wh: 2100, whSiet: 0, e0: 0, hrejeMin: 60 }], hotovo: 460, posledneAt: 0 };
    const hotovy = /** @type {any} */ (planDnaModel(vstup('09:00', null, { forecast, bojler: bojlerInfo({ den }) }), { devices }));
    assert.equal(hotovy.bojler.nahriaty, true);
    assert.equal(hotovy.rows.find((/** @type {any} */ r) => r.id === 'pracka').start, predtym.start);
});

test('pásik bežiaceho spotrebiča: slnko si najprv vezme bojler a skôr zapnutý spotrebič (24. 11. 2026)', () => {
    const forecast = slabsie(0.4);
    const devices = ['pracka', 'umyvacka'];
    const pracka = { id: 'pracka', d: '2026-09-05', m: 570, k: 690 };
    /** Beh spotrebiča z modelu. @param {object} i @param {string} id */
    const beh = (i, id) => /** @type {any} */ (planDnaModel(/** @type {any} */ (i), { devices })?.behy.find((b) => b.id === id));
    const sam = beh(vstup('09:30', null, { forecast, bezi: [pracka] }), 'pracka');
    // Bojler hreje v ručnom režime od 9:00, práčka zapnutá o 9:30.
    const hreje = bojlerInfo({
        kontaktAt: at('09:30').getTime(),
        rele: true,
        w: 2000,
        rucne: true,
        den: { den: '2026-09-05', behy: [{ od: 540, do: null, wh: 1000, whSiet: 0, e0: 0, hrejeMin: 30 }], hotovo: null, posledneAt: 0 },
    });
    const sBojlerom = beh(vstup('09:30', null, { forecast, bezi: [pracka], bojler: hreje }), 'pracka');
    assert.ok(sBojlerom.podiel < sam.podiel, `${sBojlerom.podiel} < ${sam.podiel}`);
    // O 9:50 bojler dohrial o 9:40: jeho ohrev je už zo záznamu, práčka slnko z tých minút späť nedostane.
    const dohrial = bojlerInfo({
        kontaktAt: at('09:50').getTime(),
        rele: true,
        w: 3,
        rucne: true,
        den: { den: '2026-09-05', behy: [{ od: 540, do: 580, wh: 1333, whSiet: 0, e0: 0, hrejeMin: 40 }], hotovo: 580, posledneAt: 0 },
    });
    const neskor = beh(vstup('09:50', null, { forecast, bezi: [pracka], bojler: dohrial }), 'pracka');
    assert.ok(neskor.podiel < sam.podiel, `${neskor.podiel} < ${sam.podiel}`);
    // Umývačka zapnutá po práčke dostane slnko, ktoré ostane po nej.
    const umyvacka = { id: 'umyvacka', d: '2026-09-05', m: 575, k: 725 };
    const samotna = beh(vstup('09:40', null, { forecast, bezi: [umyvacka] }), 'umyvacka');
    const poPracke = beh(vstup('09:40', null, { forecast, bezi: [pracka, umyvacka] }), 'umyvacka');
    assert.ok(poPracke.podiel < samotna.podiel, `${poPracke.podiel} < ${samotna.podiel}`);
});

test('texty: po bojleri pri spotrebiči, zapne okolo na dlaždici bojlera, dohreje okolo v paneli', () => {
    const row = /** @type {any} */ ({
        id: 'umyvacka',
        kind: 'sun',
        start: 770,
        end: 920,
        after: null,
        km: null,
        save: null,
        currency: '€',
        podiel: 1,
    });
    assert.equal(planDnaRowText({ ...row, poBojleri: true }).why, 'po bojleri, oba ohrevy chytia slnko');
    assert.equal(planDnaRowText(row).why, 'oba ohrevy chytia slnko');
    assert.equal(planTileText({ ...row, poBojleri: true, now: false, time: '12:50', tone: 'go' }).note, 'po bojleri');
    assert.deepEqual(terazRiadokText({ ...row, poBojleri: true }).odr, ['po bojleri', 'dobehne 15:20']);
    assert.deepEqual(terazRiadokText({ ...row, poBojleri: true, podiel: 0.5 }).odr[0], 'po bojleri');
    const now = at('10:00');
    const caka = bojlerInfo({ kontaktAt: now.getTime() });
    const plan = { zapne: 675, dohreje: 770, nahriaty: false };
    assert.deepEqual(bojlerDlazdica(caka, now, SITE.timezone, plan).odr, ['čaká na slnko', 'zapne okolo 11:15']);
    assert.deepEqual(bojlerDlazdica(caka, now, SITE.timezone).odr[1], 'zapne pri 2,3 kW');
    // Plán je veta pod veľkým číslom (teplotou vody) a obrys na páse od zapnutia po dohriatie.
    const d = bojlerDetail(caka, now, SITE.timezone, plan);
    assert.equal(d.veta, 'Dohreje okolo 12:50');
    assert.deepEqual(
        d.pas.useky.filter((u) => u.plan).map((u) => [u.left, u.width]),
        [[46.88, 6.59]],
    );
    assert.equal(bojlerDetail(caka, now, SITE.timezone, { ...plan, dohreje: null }).veta, 'Slnko ho dnes asi nedohreje');
    assert.equal(bojlerDetail(caka, now, SITE.timezone, { ...plan, nahriaty: true }).veta, '');
    assert.equal(bojlerDetail(caka, now, SITE.timezone).veta, '');
    assert.equal(bojlerDetail(caka, now, SITE.timezone, { ...plan, dohreje: null }).pas.useky.filter((u) => u.plan).length, 0);
});
