import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_DAYS, ALL_MONTHS, DEVICES, MOZEM_ITEMS, PLAN_DNA, PLANT, powerThresholds, SITE, TARIFF } from '../shared/config.js';
import { dayCtx, freeKw, programDraw } from '../shared/mozem-jadro.js';
import { planDna, planDnaModel, podielDrahy } from '../shared/plan-dna.js';
import { PLAN_DNA_NOTE, PLAN_ZO_SIETE, terazRiadokText } from '../shared/messages.js';
import { FIXED_NOW, fixtureData } from './helpers.js';

/** Tarifa Dvorian s cenami: NT lacné, VT drahé. */
const PRICED = { ...TARIFF, bands: TARIFF.bands.map((b) => ({ ...b, price: b.id === 'nt' ? 0.14 : 0.19 })) };
/** Jedna cena celý deň, bez ceny. @type {import('../shared/config.js').Tariff} */
const FLAT = {
    currency: '€',
    bands: [{ id: 'j', name: 'Cena', level: 'bezna', price: null }],
    schedules: [{ days: ALL_DAYS, months: ALL_MONTHS, changes: [{ from: '00:00', band: 'j' }] }],
};
const ALL = ['pracka', 'umyvacka', 'susicka', 'bojler'];
/** Miestny čas 5. 9. 2026 v Bratislave (letný čas). @param {string} hm */
const at = (hm) => new Date(`2026-09-05T${hm}:00+02:00`);

/**
 * Vstup v danej chvíli s predpoveďou z fixtures, bez merania - tieto testy overujú rozvrh nad predpoveďou. Živé
 * meranie (shared/mozem-jadro.js, ziveMeranie) má vlastné testy nižšie.
 * @param {Date} now @param {object} [extra]
 */
function input(now, extra = {}) {
    const { forecast } = fixtureData(now);
    return { now, site: SITE, plant: PLANT, tariff: PRICED, loading: false, pv: null, forecast, ...extra };
}

/** Predpoveď zmenšená na zlomok vo vybraných dňoch (predvolene všetky); meranie sa zahodí. @param {number} k @param {number[]} [dayIdx] */
function cloudy(k, dayIdx) {
    const { forecast } = fixtureData(FIXED_NOW);
    const scale = (/** @type {number} */ i) => (!dayIdx || dayIdx.includes(i) ? k : 1);
    return {
        ...forecast,
        hourlyToday: forecast.hourlyToday.map((p) => ({ ...p, kw: p.kw * scale(0) })),
        days: forecast.days.map((d, i) => ({
            ...d,
            hourly: d.hourly.map((p) => ({ ...p, kw: p.kw * scale(i) })),
            peakKw: d.peakKw * scale(i),
            kwhTotal: d.kwhTotal * scale(i),
        })),
    };
}
/** Plán dňa pre vstup. @param {ReturnType<typeof input>} i @param {readonly string[]} devices */
const planDnaAt = (i, devices) => planDna(dayCtx(i), i, devices);
/** Riadok podľa id. @param {Array<{ id: string }>} rows @param {string} id */
const row = (rows, id) => /** @type {any} */ (rows.find((r) => r.id === id));

test('9:00 za jasna: každý na slnku, sušička po práčke, všetko sa zmestí do výroby nad spotrebou domu', () => {
    const i = input(at('09:00'));
    const ctx = dayCtx(i);
    const rows = planDna(ctx, i, ALL);
    assert.deepEqual(
        rows.map((r) => r.kind),
        ['sun', 'sun', 'sun', 'sun'],
    );
    const [pracka, susicka] = [row(rows, 'pracka'), row(rows, 'susicka')];
    assert.equal(pracka.start, 9 * 60, 'práčka hneď');
    assert.ok(susicka.start >= pracka.end, 'sušička až keď práčka dobehne');
    assert.equal(susicka.after, 'pracka');
    // Rozpočet: v každej minúte ohrevu odber všetkých vecí v pláne neprekročí výrobu nad spotrebou domu.
    /** @type {number[]} */ const draw = new Array(24 * 60).fill(0);
    /** @type {boolean[]} */ const heavy = new Array(24 * 60).fill(false);
    for (const r of rows.filter((x) => x.kind === 'sun')) {
        const item = /** @type {(typeof MOZEM_ITEMS)[number]} */ (MOZEM_ITEMS.find((m) => m.id === r.id));
        const device = /** @type {(typeof DEVICES)[number]} */ (DEVICES.find((d) => d.name === item.device));
        programDraw(item, device.powerKw).forEach((p, m) => {
            draw[r.start + m] += p.kw;
            heavy[r.start + m] ||= p.heavy;
        });
    }
    assert.ok(heavy.some(Boolean));
    heavy.forEach((h, m) => h && assert.ok(draw[m] <= freeKw(ctx, m) + 1e-9, `minúta ${m}: ${draw[m]} kW`));
});

test('auto v Pláne dňa nie je, ani keď ho človek má doma (docs/navrhy/auto-mimo-planu.html)', () => {
    assert.deepEqual(
        planDnaAt(input(at('09:00')), [...ALL, 'auto']).map((r) => r.id),
        planDnaAt(input(at('09:00')), ALL).map((r) => r.id),
    );
    assert.deepEqual(planDnaAt(input(at('19:50')), ['auto']), []);
});

test('model: riadky podľa času, teraz pri tom, čo je na rade, bez cien', () => {
    const m = planDnaModel(input(at('09:00')), { devices: ALL });
    assert.ok(m);
    const starts = m.rows.map((r) => (r.kind === 'sun' ? r.start : 0));
    assert.deepEqual(
        starts,
        [...starts].sort((a, b) => a - b),
    );
    assert.equal(m.rows[0].name, 'Práčka');
    assert.equal(m.rows[0].time, '09:00');
    assert.equal(m.rows[0].why, 'ohrev chytí slnko');
    // Teraz je na rade všetko, čo štartuje hneď - za jasna práčka aj umývačka naraz.
    assert.ok(m.rows[0].now);
    for (const r of m.rows) assert.equal(r.now, r.time === '09:00', r.id);
    assert.equal(row(m.rows, 'susicka').why, 'po práčke, celá zo strechy');
    assert.equal(row(m.rows, 'umyvacka').why, 'oba ohrevy chytia slnko');
    assert.equal(row(m.rows, 'bojler').why, 'celý zo strechy');
    for (const r of m.rows) assert.doesNotMatch(r.why, /€/, `${r.id} bez ceny`);
    assert.equal(m.note, PLAN_DNA_NOTE);
});

test('predvolene bez bojlera; bez predpovede alebo elektrárne plán nie je', () => {
    const m = planDnaModel(input(at('09:00')));
    assert.deepEqual(m?.rows.map((r) => r.id).sort(), [...PLAN_DNA.devices].sort());
    assert.equal(planDnaModel(input(at('09:00'), { forecast: null })), null);
    assert.equal(planDnaModel(input(at('09:00'), { known: 'nic' })), null);
});

test('večer: bojler do lacného pásma, ostatné zajtra', () => {
    const m = planDnaModel(input(at('19:50')), { devices: ALL });
    assert.match(row(m?.rows ?? [], 'bojler').time, /^od \d\d:\d\d$/);
    const pracka = row(m?.rows ?? [], 'pracka');
    assert.equal(pracka.kind, 'later');
    assert.match(pracka.time, /^zajtra \d\d:\d\d$/);
    assert.equal(pracka.why, 'dnes slnko nestačí');
    assert.equal(pracka.tone, 'wait');
    assert.equal(m?.rows.at(-1)?.kind, 'later', 'iné dni až za dneškom');
});

test('poradie: umývačka pred práčkou, keď sa tak na slnko zmestia obe', () => {
    // Slabé popoludnie: v pevnom poradí by práčka zabrala slnko a umývačka išla až zajtra. Bez
    // sušičky - tá sa po práčke nezmestí a obe by išli na iný deň.
    const devices = ['pracka', 'umyvacka'];
    const rows = planDnaAt(input(at('13:00'), { pv: null, forecast: cloudy(0.4, [0]) }), devices);
    assert.equal(row(rows, 'umyvacka').kind, 'sun');
    assert.equal(row(rows, 'umyvacka').start, 13 * 60);
    assert.equal(row(rows, 'pracka').kind, 'sun');
    assert.equal(row(rows, 'pracka').start, 13 * 60 + 15);
    assert.deepEqual(
        rows.map((r) => r.id),
        PLAN_DNA.order.filter((id) => devices.includes(id)),
        'riadky v pevnom poradí',
    );
});

test('poradie: bez zreteľne lepšieho plánu pevné, sušička vždy po práčke', () => {
    // O 9:00 by iné poradie len skôr skončilo - ostáva pevné, práčka prvá.
    const deviata = planDnaAt(input(at('09:00'), { pv: null }), ALL);
    assert.equal(row(deviata, 'pracka').start, 9 * 60);
    for (const k of [1, 0.7, 0.5, 0.4])
        for (const hm of ['07:00', '09:00', '11:00', '13:00']) {
            const rows = planDnaAt(input(at(hm), { pv: null, forecast: cloudy(k, [0]) }), ALL);
            const [pracka, susicka] = [row(rows, 'pracka'), row(rows, 'susicka')];
            if (pracka.kind === 'sun') assert.equal(susicka.start, pracka.end, `${k} ${hm}: sušička nikdy nečaká`);
        }
});

test('práčka a sušička v jeden deň: aj zajtra sušička až po práčke', () => {
    // Večer: dnes nič, zajtra najprv práčka a sušička, až keď práčka dobehne (nie 8:00 a 9:00 naopak).
    const m = planDnaModel(input(at('19:50')), { devices: ALL });
    const [pracka, susicka] = [row(m?.rows ?? [], 'pracka'), row(m?.rows ?? [], 'susicka')];
    assert.equal(pracka.kind, 'later');
    assert.equal(susicka.kind, 'later');
    assert.equal(susicka.day.index, pracka.day.index);
    assert.ok(susicka.day.start >= pracka.day.start + 120, `${pracka.day.start} ${susicka.day.start}`);
    assert.equal(susicka.why, 'po práčke');
    assert.equal(pracka.why, 'dnes slnko nestačí');
    assert.equal(row(planDnaAt(input(at('16:30')), ['pracka']), 'pracka').kind, 'sun', 'bez sušičky práčka ide dnes');
    // Hocijaké počasie a čas: obe v ten istý deň, sušička po práčke.
    for (const k of [1, 0.7, 0.4, 0.2])
        for (const hm of ['07:00', '11:00', '15:00', '19:00']) {
            const rows = planDnaAt(input(at(hm), { pv: null, forecast: cloudy(k, [0, 1]) }), ALL);
            const [p, s] = [row(rows, 'pracka'), row(rows, 'susicka')];
            const when = (/** @type {any} */ r) =>
                r.kind === 'sun' ? [0, r.start] : r.kind === 'later' ? [r.day.index, r.day.start] : null;
            const [wp, ws] = [when(p), when(s)];
            if (!wp || !ws) continue;
            assert.equal(ws[0], wp[0], `${k} ${hm}: nikdy práčka dnes a sušička zajtra`);
            assert.ok(ws[1] >= wp[1] + 120, `${k} ${hm}: sušička po práčke`);
        }
});

test('slnko len na práčku: obe dnes, sušička hneď po nej zo siete', () => {
    // 16:30: ohrev práčky ešte chytí slnko, sušička po nej už nie - obe idú dnes, sušička zo siete.
    const m2 = planDnaModel(input(at('16:30')), { devices: ALL });
    const [p2, s2] = [row(m2?.rows ?? [], 'pracka'), row(m2?.rows ?? [], 'susicka')];
    assert.equal(p2.kind, 'sun');
    // Nie je na slnku, hoci má presný čas: Teraz, Dnes aj oznámenia ju tak nesmú volať „zo slnka“.
    assert.equal(s2.kind, 'siet');
    assert.equal(s2.now, false);
    assert.equal(s2.start, p2.end, 'sušička hneď po práčke');
    assert.ok(s2.podiel < PLAN_DNA.zoSiete, `${s2.podiel}`);
    assert.equal(s2.why, PLAN_ZO_SIETE);
    assert.deepEqual(terazRiadokText(s2).odr, ['po práčke', 'zo siete']);
});

test('sušička nikdy nečaká po práčke: dnes štartuje presne na jej konci', () => {
    for (const k of [1, 0.7, 0.4, 0.2])
        for (const hm of ['07:00', '11:00', '15:00', '17:00']) {
            const rows = planDnaAt(input(at(hm), { pv: null, forecast: cloudy(k, [0, 1]) }), ALL);
            const [p, s] = [row(rows, 'pracka'), row(rows, 'susicka')];
            if (p.kind === 'sun') assert.equal(s.start, p.end, `${k} ${hm}`);
        }
});

test('celý týždeň sa nezmestí na slnko, lacné pásmo: sušička až po práčke', () => {
    const m = planDnaModel(input(at('09:00'), { pv: null, forecast: cloudy(0.01) }), { devices: ['pracka', 'susicka'] });
    const [pracka, susicka] = [row(m?.rows ?? [], 'pracka'), row(m?.rows ?? [], 'susicka')];
    assert.equal(pracka.kind, 'cheap');
    assert.equal(susicka.kind, 'cheap');
    assert.ok(susicka.start >= pracka.start + 120, `${pracka.start} ${susicka.start}`);
});

test('slabý deň: umývačka a sušička čakajú na iný deň, auto bez ceny v tarife', () => {
    const forecast = cloudy(0.05, [0, 1]);
    const i = input(at('09:00'), { pv: null, forecast, tariff: FLAT });
    assert.ok(forecast.days[0].peakKw < powerThresholds(PLANT).weakPeakKw);
    const m = planDnaModel(i, { devices: ALL });
    const rows = m?.rows ?? [];
    for (const id of ['umyvacka', 'susicka']) {
        assert.equal(row(rows, id).kind, 'later');
        assert.notEqual(row(rows, id).day.index, 1, 'zajtra je tiež slabý deň');
        assert.equal(row(rows, id).tone, 'no');
    }
    assert.notEqual(row(rows, 'pracka').kind, 'sun');
});

test('celý týždeň bez slnka a bez lacného pásma: tento týždeň nie', () => {
    const m = planDnaModel(input(at('09:00'), { pv: null, forecast: cloudy(0.01), tariff: FLAT }), { devices: ALL });
    for (const r of m?.rows ?? []) {
        assert.equal(r.kind, 'none');
        assert.equal(r.time, 'tento týždeň nie');
    }
});

test('podiel drahého pásma: čo slnko nepokryje v minútach VT, bežné pásmo nie je drahé, za polnocou pásma toho dňa', () => {
    const i = input(at('19:50'));
    const { plan } = dayCtx(i);
    const draw = Array.from({ length: 60 }, () => ({ kw: 2 }));
    const tma = Array.from({ length: 24 * 60 }, () => 0);
    // 20:00 - 21:00: NT do 20:30, potom VT - polovica.
    assert.equal(podielDrahy(draw, tma, 20 * 60, plan), 0.5);
    // Slnko pokryje polovicu odberu každej minúty: v drahom pásme ide zo siete štvrtina.
    assert.equal(
        podielDrahy(
            draw,
            tma.map(() => 1),
            20 * 60,
            plan,
        ),
        0.25,
    );
    // Za polnocou (23:30 - 0:30) je NT.
    assert.equal(podielDrahy(draw, tma, 23 * 60 + 30, plan), 0);
    const bezna = dayCtx({ ...i, tariff: FLAT }).plan;
    assert.equal(podielDrahy(draw, tma, 20 * 60, bezna), 0);
    assert.equal(podielDrahy([], tma, 0, plan), 0);
});

test('sušička po praní večer: pásik povie, koľko ide z drahého pásma', () => {
    // Práčka dobehla o 20:30, sušička ide hneď 20:30 - 22:00: VT do 21:30 (dve tretiny), potom NT.
    const i = input(at('20:25'), { bezi: [{ id: 'pracka', d: '2026-09-05', m: 18 * 60 + 30, k: 20 * 60 + 30 }] });
    const susicka = row(planDnaModel(i, { devices: ['pracka', 'susicka'] })?.rows ?? [], 'susicka');
    assert.deepEqual([susicka.kind, susicka.start], ['siet', 20 * 60 + 30]);
    assert.ok(Math.abs(susicka.draha - 2 / 3) < 0.01, `draha ${susicka.draha}`);
    assert.ok(susicka.podiel + susicka.draha <= 1);
});

test('lacné pásmo má koniec: do konca pásma, cez polnoc podľa rozvrhu ďalšieho dňa', () => {
    // 19:50: NT od 20:00 do 20:30 je kratšie ako PLAN_DNA.lacnaMinMin - bojler ide do NT od 21:30 do 22:30.
    const vecer = row(planDnaModel(input(at('19:50')), { devices: ALL })?.rows ?? [], 'bojler');
    assert.deepEqual([vecer.kind, vecer.start, vecer.end], ['cheap', 21 * 60 + 30, 22 * 60 + 30]);
    // Ráno 7:01 (zistené 24. 11. 2026): koniec NT o 7:30 nie je „zapni teraz“, ďalšie NT je od 8:30 do 9:30.
    const rano = row(planDnaModel(input(at('07:01'), { forecast: cloudy(0) }), { devices: ['bojler'] })?.rows ?? [], 'bojler');
    assert.deepEqual([rano.kind, rano.start, rano.end], ['cheap', 8 * 60 + 30, 9 * 60 + 30]);
    // 23:00: NT od 23:30 pokračuje cez polnoc do 07:30 ďalšieho dňa.
    const noc = planDnaModel(input(at('23:00')), { devices: ALL });
    const bojler = row(noc?.rows ?? [], 'bojler');
    assert.equal(bojler.kind, 'cheap');
    assert.equal(bojler.start, 23 * 60 + 30);
    assert.equal(bojler.end, 24 * 60 + 7 * 60 + 30);
    // Celý deň lacný: pásmo cez polnoc trvá aj celý ďalší deň.
    /** @type {import('../shared/config.js').Tariff} */
    const lacna = { ...FLAT, bands: [{ id: 'j', name: 'NT', level: 'lacna', price: null }] };
    const cely = planDnaModel(input(at('23:00'), { tariff: lacna }), { devices: ['bojler'] });
    assert.equal(row(cely?.rows ?? [], 'bojler').end, 2 * 24 * 60);
});

// ---- Spotrebič beží (docs/navrhy/teraz-bezi-spotrebic.html) -----------------------------
const VELKE = ['pracka', 'umyvacka', 'susicka', 'auto'];
/** Beh „Už beží“ 5. 9. 2026 od `m`, koniec `k` (bez neho po dĺžke programu). @param {string} id @param {number} m @param {number} [k] */
const zapis = (id, m, k) => ({ id, d: '2026-09-05', m, k: k ?? m + (MOZEM_ITEMS.find((x) => x.id === id)?.runMin ?? 0) });

test('práčka beží od 8:00: plán ju nerozvrhuje, sušička ide po jej skutočnom konci, model ju ukáže v behoch', () => {
    // S nameranou krivkou: o 8:00 dala strecha menej, než predpoveď sľubovala.
    const i = input(at('09:00'), { pv: fixtureData(at('09:00')).pv, bezi: [zapis('pracka', 480)] });
    const rows = planDnaAt(i, VELKE);
    assert.equal(row(rows, 'pracka'), undefined);
    const susicka = row(rows, 'susicka');
    assert.equal(susicka.kind, 'sun');
    assert.equal(susicka.start, 600, 'hneď, keď práčka dobehne');
    assert.equal(susicka.after, 'pracka');
    const m = planDnaModel(i, { devices: VELKE });
    assert.deepEqual(
        m?.behy.map(({ id, kind, start, end, name }) => ({ id, kind, start, end, name })),
        [{ id: 'pracka', kind: 'run', start: 480, end: 600, name: 'Práčka' }],
    );
    assert.ok((m?.behy[0].podiel ?? 0) > 0 && (m?.behy[0].podiel ?? 1) < 1, 'o 8:00 len časť zo slnka');
    assert.equal(row(m?.rows ?? [], 'susicka').why, 'po práčke, celá zo strechy');
});

test('práčka dobehla: plán ju ponúkne znova, sušička suší to pranie hneď, nie až ďalšie', () => {
    const i = input(at('11:00'), { bezi: [zapis('pracka', 480)] });
    const m = planDnaModel(i, { devices: VELKE });
    assert.deepEqual(
        m?.behy.map((b) => b.kind),
        ['done'],
    );
    const pracka = row(m?.rows ?? [], 'pracka');
    assert.ok(pracka, 'ďalšie pranie má miesto');
    assert.ok(pracka.kind !== 'sun' || pracka.start >= 11 * 60);
    const susicka = row(m?.rows ?? [], 'susicka');
    assert.equal(susicka.start, 11 * 60);
    assert.equal(susicka.after, 'pracka');
});

test('pranie aj sušenie dobehli: sušička čaká na ďalšie pranie', () => {
    const i = input(at('11:00'), { bezi: [zapis('pracka', 480), zapis('susicka', 600, 650)] });
    const rows = planDnaAt(i, VELKE);
    const pracka = row(rows, 'pracka');
    const susicka = row(rows, 'susicka');
    assert.equal(pracka.kind, 'sun');
    assert.equal(susicka.after, 'pracka');
    assert.equal(susicka.start, pracka.end, 'hneď po ďalšom praní');
});

test('druhé pranie beží, prvé sušička usušila: sušička po druhom, plán ráta s oboma behmi', () => {
    const i = input(at('12:00'), { bezi: [zapis('pracka', 480), zapis('susicka', 600, 650), zapis('pracka', 660, 760)] });
    const m = planDnaModel(i, { devices: VELKE });
    assert.deepEqual(
        m?.behy.map((b) => [b.id, b.kind, b.end]),
        [
            ['pracka', 'done', 600],
            ['susicka', 'done', 650],
            ['pracka', 'run', 760],
        ],
    );
    assert.equal(row(m?.rows ?? [], 'pracka'), undefined, 'kým beží, nerozvrhuje sa');
    assert.equal(row(m?.rows ?? [], 'susicka').start, 760);
});

test('zápis bez konca zo staršej appky skončí po dĺžke programu', () => {
    const i = input(at('09:00'), { bezi: [/** @type {any} */ ({ id: 'pracka', d: '2026-09-05', m: 480 })] });
    assert.equal(planDnaModel(i, { devices: VELKE })?.behy[0].end, 600);
});

test('bežiaci spotrebič si berie z rozpočtu: počas ohrevov nič neprekročí výrobu nad spotrebou domu', () => {
    const i = input(at('09:00'), { bezi: [zapis('pracka', 540)] });
    const ctx = dayCtx(i);
    const rows = planDna(ctx, i, ['pracka', 'umyvacka', 'susicka']);
    /** @type {number[]} */ const draw = new Array(24 * 60).fill(0);
    /** @type {boolean[]} */ const heavy = new Array(24 * 60).fill(false);
    for (const r of [{ id: 'pracka', start: 540 }, ...rows.filter((x) => x.kind === 'sun')]) {
        const item = /** @type {(typeof MOZEM_ITEMS)[number]} */ (MOZEM_ITEMS.find((x) => x.id === r.id));
        const device = /** @type {(typeof DEVICES)[number]} */ (DEVICES.find((d) => d.name === item.device));
        programDraw(item, device.powerKw).forEach((p, k) => {
            draw[r.start + k] += p.kw;
            heavy[r.start + k] ||= p.heavy;
        });
    }
    heavy.forEach((h, k) => h && k >= 540 && assert.ok(draw[k] <= freeKw(ctx, k) + 1e-9, `minúta ${k}: ${draw[k]} kW`));
    assert.ok(row(rows, 'susicka').start >= 660);
});

test('za oblačna sušička po bežiacej práčke hneď po jej konci, nie inokedy', () => {
    const i = input(at('09:00'), { pv: null, forecast: cloudy(0.15), bezi: [zapis('pracka', 540)] });
    const susicka = row(planDnaAt(i, VELKE), 'susicka');
    assert.equal(susicka.kind, 'sun');
    assert.equal(susicka.start, 660);
});

test('zápis iného dňa, spotrebiča mimo plánu či bojlera plán nemení', () => {
    const bez = planDnaAt(input(at('09:00')), VELKE);
    for (const bezi of [[{ ...zapis('pracka', 480), d: '2026-09-04' }], [zapis('bojler', 480)]]) {
        const i = input(at('09:00'), { bezi });
        assert.deepEqual(planDnaAt(i, VELKE), bez, JSON.stringify(bezi));
        assert.deepEqual(planDnaModel(i, { devices: VELKE })?.behy, []);
    }
    assert.deepEqual(planDnaModel(input(at('09:00'), { bezi: [zapis('pracka', 480)] }), { devices: ['umyvacka'] })?.behy, []);
});
