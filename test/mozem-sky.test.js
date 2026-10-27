import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installedKw, MOZEM_GROUPS, MOZEM_ITEMS, PLANT, SITE, TARIFF, TYPICAL_PLANT } from '../shared/config.js';
import { kwpRoughText } from '../shared/format.js';
import {
    MOZEM_CHIPS,
    MOZEM_GROUP_NAMES,
    mozemGuessText,
    mozemItemText,
    mozemListTitle,
    mozemOfflineText,
    mozemTileNote,
    mozemTileValue,
    phonesPerHour,
} from '../shared/messages.js';
import { itemAnswer, mozemModel } from '../shared/mozem.js';
import { mozemSkyModel, sunArc } from '../shared/mozem-sky.js';
import { typicalSettings } from '../shared/settings.js';
import { sunTimes } from '../shared/solar.js';
import { FIXED_NOW, fixtureData } from './helpers.js';

/** Miestny čas 5. 9. 2026 v Bratislave (letný čas). @param {string} hm */
const at = (hm) => new Date(`2026-09-05T${hm}:00+02:00`);

/**
 * Vstup karty: Dvorany s kioskom a fixtures v danej chvíli.
 * @param {Date} now @param {object} [extra]
 * @returns {Parameters<typeof mozemSkyModel>[0]}
 */
function input(now, extra = {}) {
    const { pv, forecast } = fixtureData(now);
    return {
        now,
        site: SITE,
        plant: PLANT,
        tariff: TARIFF,
        zdroj: { sposob: 'huawei-kiosk', pecat: 'v1.test-pecat-0123456789', nazov: '' },
        loading: false,
        known: 'elektraren',
        pv,
        forecast,
        ...extra,
    };
}

/** Vstup pri známej polohe bez panelov: typická strecha, ako ho skladá appka. @param {Date} now */
function guessInput(now) {
    const typical = typicalSettings(SITE);
    const { forecast } = fixtureData(now);
    return { now, ...typical, loading: false, known: /** @type {const} */ ('poloha'), pv: null, forecast };
}

test('mozemModel: pri polohe bez panelov odpovedá z typickej strechy v oboch appkách, bez polohy nie', () => {
    const g = guessInput(FIXED_NOW);
    const odhad = mozemModel(g);
    const elektraren = mozemModel({ ...g, known: 'elektraren' });
    assert.equal(odhad.estimate, true);
    assert.equal(odhad.state, elektraren.state, 'odpoveď je tá istá, akú by dala uložená typická strecha');
    assert.deepEqual(
        odhad.items.map((i) => i.short),
        elektraren.items.map((i) => i.short),
    );
    assert.equal(elektraren.estimate, false);
    // Bez polohy sa odpovedať nedá.
    const nic = mozemModel({ ...g, known: 'nic' });
    assert.equal(nic.state, 'bezpanelov');
    assert.equal(nic.facts, null);
});

test('mozemModel: facts nesú cenu siete, okno pása dneška, živý výkon a výkon z plánu', () => {
    const m = mozemModel(input(FIXED_NOW));
    assert.ok(m.facts);
    assert.equal(m.facts.level, 'lacna');
    assert.ok(m.facts.window && m.facts.window.from < 13 * 60 && m.facts.window.to > 13 * 60);
    assert.equal(m.facts.liveKw, fixtureData(FIXED_NOW).pv.realTimePowerKw);
    assert.ok(m.facts.planKw > 0);
    assert.equal(mozemModel(input(FIXED_NOW, { pv: null })).facts?.liveKw, null);
    assert.equal(mozemModel(input(FIXED_NOW, { forecast: null })).facts, null);
});

test('mozemItemText: vysvetlenie `more` je otázka a odpoveď', () => {
    const m = mozemModel(input(FIXED_NOW));
    for (const it of m.items.filter((i) => i.more)) assert.ok(it.more?.q.endsWith('?') && it.more.a, it.id);
    const go = m.items.find((i) => i.id === 'pracka');
    assert.equal(go?.more?.q, 'A keď sa zamračí?');
    // Čakanie: otázka „musíš hneď“.
    const rano = mozemModel(input(at('05:30')));
    const wait = rano.items.find((i) => i.tone === 'wait' && i.more);
    assert.ok(wait?.more);
    assert.match(wait.more.q, /hneď\?$/);
    // Lacná sieť bez slnka v ďalších dňoch nemá čo dodať.
    const auto = /** @type {(typeof MOZEM_ITEMS)[number]} */ (MOZEM_ITEMS.find((i) => i.id === 'auto'));
    const ctx = {
        nowMin: 0,
        plan: [],
        th: { lowKw: 1, highKw: 2, weakPeakKw: 1 },
        draha: false,
        cheap: true,
        price: null,
        currency: '€',
        weakToday: false,
        later: [],
    };
    const lacno = mozemItemText(auto, itemAnswer(auto, ctx), { ctx, cost: null });
    assert.equal(lacno.tone, 'cheap');
    assert.equal(lacno.more, null);
});

test('texty novej karty: nadpis dlaždíc, odpoveď dlaždice, mobily, výzvy, zrušenie behu', () => {
    assert.equal(mozemListTitle(false), 'Čo môžem');
    assert.equal(mozemListTitle(true), 'Čo môžem · odhad');
    assert.equal(
        mozemTileValue({ kind: 'go', end: 16 * 60, until: 14 * 60, km: null }, 'do 14:00'),
        'do 16:00',
        'koniec slnka, nie štart programu',
    );
    assert.equal(mozemTileValue({ kind: 'wait', start: 630 }, 'o 10:30'), 'o 10:30');
    assert.equal(mozemTileNote({ kind: 'go', end: 900, until: 900, km: 60 }), 'asi 60 km zo slnka');
    assert.equal(mozemTileNote({ kind: 'go', end: 900, until: 840, km: null }), 'zo slnka');
    assert.equal(mozemTileNote({ kind: 'cheap', next: null }), 'lacná sieť');
    assert.equal(mozemTileNote({ kind: 'wait', start: 630 }), '');

    assert.equal(phonesPerHour(6.45), 430);

    assert.match(mozemOfflineText({ online: false, zdroj: true, pvOk: false, pvSince: null }), /^Nie je internet/);
    const bezPredpovede = mozemOfflineText({ online: true, zdroj: false, pvOk: false, pvSince: null });
    assert.match(bezPredpovede, /^Predpoveď počasia neprišla/);
    assert.doesNotMatch(bezPredpovede, /Meranie/, 'bez kiosku o meraní nehovorí');
    assert.match(mozemOfflineText({ online: true, zdroj: true, pvOk: false, pvSince: null }), /Ani meranie zo strechy neodpovedá\./);
    assert.match(
        mozemOfflineText({ online: true, zdroj: true, pvOk: false, pvSince: '12:40' }),
        /Meranie zo strechy neodpovedá od 12:40\./,
    );
    assert.doesNotMatch(mozemOfflineText({ online: true, zdroj: true, pvOk: true, pvSince: null }), /Meranie/);

    assert.match(mozemGuessText(5.22), /typickou strechou asi 5 kWp./);
});

test('mozemSkyModel: o 13:00 to isté slovo, veta, odpovede aj deň v číslach ako mozemModel', () => {
    const i = input(FIXED_NOW);
    const m = mozemSkyModel(i);
    const base = mozemModel(i);
    assert.equal(m.state, 'go');
    assert.equal(m.word, base.word);
    assert.equal(m.lead, base.hero.lead);
    assert.deepEqual(
        m.items.map((x) => [x.id, x.short, x.tone]),
        base.items.map((x) => [x.id, x.short, x.tone]),
    );
    assert.deepEqual(base.chips, [
        { text: MOZEM_CHIPS.go, tone: 'go' },
        { text: MOZEM_CHIPS.lacna, tone: 'cheap' },
    ]);
    assert.deepEqual(m.day, base.day);
    assert.match(m.day?.lead ?? '', /^Dnes zo strechy asi \d+ kWh\. To je:$/);
    assert.equal(m.list?.title, 'Čo môžem');
    assert.equal(m.retry, false);
    assert.equal(m.guess, '');
    assert.equal(m.items.find((x) => x.id === 'pracka')?.title, `Práčka: ${base.items[0].short}`);
});

test('mozemModel: večer štítky povedia drahú sieť', () => {
    const vecer = mozemModel(input(at('21:00')));
    assert.equal(vecer.state, 'none');
    assert.deepEqual(
        vecer.chips.map((c) => c.tone),
        ['plain', 'costly'],
    );
});

test('mozemSkyModel: bez dát veta s príčinou, Skúsiť znova, otáznik v nadpise a „neviem“ pri spotrebičoch', () => {
    const m = mozemSkyModel(input(FIXED_NOW, { forecast: null, pv: null }), { online: true });
    assert.equal(m.state, 'offline');
    assert.equal(m.retry, true);
    assert.match(m.lead, /Predpoveď počasia neprišla.*Ani meranie/);
    assert.equal(m.list?.title, 'Čo môžem');
    assert.deepEqual(
        m.groups.map((g) => [g.id, g.value, g.tone]),
        [
            ['velke', 'neviem', 'unk'],
            ['auto', 'neviem', 'unk'],
            ['bojler', 'neviem', 'unk'],
        ],
    );
    assert.equal(m.groups[0].bar, null, 'bez okna slnka pás nie je');
    assert.equal(m.groups[0].sheet?.lead, '');
    assert.equal(m.items.find((x) => x.id === 'pracka')?.short, 'neviem');
    assert.equal(m.day, null);
    assert.equal(m.arc?.win, null);
    assert.deepEqual(
        mozemModel(input(FIXED_NOW, { forecast: null, pv: null })).chips.map((c) => c.text),
        [MOZEM_CHIPS.offline],
    );
    assert.match(mozemSkyModel(input(FIXED_NOW, { forecast: null }), { online: false }).lead, /^Nie je internet/);
    // Meranie z fixtures o 17:00 mlčí od 13:00.
    assert.match(mozemSkyModel(input(at('17:00'), { forecast: null })).lead, /Meranie zo strechy neodpovedá od \d\d:\d\d\./);
});

test('mozemSkyModel: kým sa načítava, karta nič netvrdí', () => {
    const m = mozemSkyModel(input(FIXED_NOW, { forecast: null, pv: null, loading: true }));
    assert.equal(m.state, 'loading');
    assert.equal(m.list, null);
    assert.equal(m.day, null);
    assert.deepEqual(mozemModel(input(FIXED_NOW, { forecast: null, pv: null, loading: true })).chips, []);
    assert.equal(m.retry, false);
});

test('mozemSkyModel: poloha bez panelov odpovedá z typickej strechy a priznáva odhad', () => {
    const m = mozemSkyModel(guessInput(FIXED_NOW));
    assert.equal(m.state, 'go');
    assert.equal(m.guess, mozemGuessText(installedKw(TYPICAL_PLANT)));
    assert.ok(m.guess.includes(kwpRoughText(installedKw(TYPICAL_PLANT))));
    assert.match(m.list?.title || '', / · odhad$/);
    assert.equal(m.list?.estimate, true);
    assert.ok(m.day, 'deň v číslach aj z typickej strechy');
});

test('mozemSkyModel: bez polohy len výzva, žiadne odpovede', () => {
    const m = mozemSkyModel({ ...input(FIXED_NOW, { forecast: null, pv: null }), known: 'nic' });
    assert.equal(m.ask, true);
    assert.equal(m.arc, null);
    assert.equal(m.list, null);
    assert.deepEqual(m.items, []);
});

test('sunArc: slnko medzi skutočným východom a západom, v noci mesiac, okno tým istým meradlom', () => {
    const sun = sunTimes(SITE, '2026-09-05');
    const noon = sunArc(FIXED_NOW, SITE, { from: /** @type {number} */ (sun.rise), to: /** @type {number} */ (sun.set) });
    assert.equal(noon.rise, sun.rise);
    assert.equal(noon.set, sun.set);
    assert.ok(noon.sun !== null && noon.sun > 0.4 && noon.sun < 0.7);
    assert.deepEqual(noon.win, { from: 0, to: 1 });
    assert.equal(sunArc(at('22:00'), SITE, null).sun, null);
    assert.equal(sunArc(at('22:00'), SITE, null).win, null);
    // Polárna noc: východ ani západ nie je, oblúk ide cez produkčné okno grafov.
    const arctic = { ...SITE, lat: 78.2, lon: 15.6, timezone: 'Arctic/Longyearbyen' };
    const dec = sunArc(new Date('2026-12-21T11:00:00Z'), arctic, { from: 5 * 60, to: 21 * 60 });
    assert.equal(dec.rise, null);
    assert.equal(dec.sun, null);
    assert.deepEqual(dec.win, { from: 0, to: 1 });
});

test('skupiny: len spotrebiče doma, polovičná dlaždica bez páru na celú šírku', () => {
    const doma = mozemSkyModel(input(FIXED_NOW), { devices: ['pracka', 'umyvacka', 'susicka', 'auto', 'bojler'] });
    assert.deepEqual(
        doma.groups.map((g) => [g.id, g.key, g.size, g.name]),
        MOZEM_GROUPS.map((g) => [
            g.id,
            g.items.length > 1 ? g.id : g.items[0],
            g.size,
            MOZEM_GROUP_NAMES[/** @type {keyof typeof MOZEM_GROUP_NAMES} */ (g.id)],
        ]),
    );
    // Predvolene bez bojlera: dlaždica Bojler nie je a auto ide na celú šírku.
    assert.deepEqual(
        mozemSkyModel(input(FIXED_NOW)).groups.map((g) => [g.id, g.size]),
        [
            ['velke', 'wide'],
            ['auto', 'wide'],
        ],
    );
});

test('skupiny: veľké spotrebiče o 13:00 podľa Plánu dňa - čo je na rade, všetky s časom, pás dňa a panel', () => {
    const m = mozemSkyModel(input(FIXED_NOW));
    const velke = m.groups[0];
    const { sheet, bar } = velke;
    if (!sheet || !bar) throw new Error('veľké spotrebiče nemajú panel alebo pás');
    assert.equal(velke.tone, 'go');
    assert.equal(velke.value, 'teraz');
    assert.equal(velke.note, 'Práčka a umývačka teraz · Sušička o 15:00', 'rovnaké časy spolu');
    assert.ok(bar.width > 0 && bar.now > bar.left);
    assert.deepEqual(bar.ticks, ['5:00', '13:00', '21:00']);
    assert.deepEqual(
        sheet.rows.map((r) => [r.id, r.short]),
        [
            ['pracka', 'teraz'],
            ['umyvacka', 'teraz'],
            ['susicka', 'o 15:00'],
        ],
    );
    assert.equal(sheet.title, `Veľké spotrebiče: ${velke.value}`);
    assert.match(sheet.lead, /^Slnko do /);
    // Časy sú tie isté ako v bloku Plán dňa.
    for (const r of sheet.rows) assert.equal(m.plan?.rows.find((p) => p.id === r.id)?.kind, 'sun');
});

test('skupiny: auto a bojler o 13:00 podľa Plánu dňa', () => {
    const m = mozemSkyModel(input(FIXED_NOW), { devices: ['pracka', 'umyvacka', 'susicka', 'auto', 'bojler'] });
    const [, auto, bojler] = m.groups;
    assert.equal(m.groups.length, 3);
    assert.equal(bojler.key, 'bojler');
    assert.equal(bojler.sheet, null, 'jedna vec: ťuknutie otvorí jej panel');
    assert.equal(bojler.value, 'teraz');
    assert.equal(bojler.note, 'zo slnka');
    assert.equal(auto.tone, 'wait', 'auto až po ohrevoch');
    assert.match(auto.value, /^o \d\d:\d\d$/);
    assert.match(auto.note, /km zo slnka$/);
    assert.equal(
        m.items.find((i) => i.id === 'bojler')?.text,
        'Ohrev trvá asi hodinu a celý čas berie 2 kW. Pri štarte najneskôr o 16:15 dobehne celý na slnku.',
    );
});

test('skupiny: veci skupiny idú v pláne inokedy - dlaždica ukáže prvú, poznámka všetky', () => {
    // Slabý deň: práčka sa odporúča, sušička a umývačka nie.
    const i = input(FIXED_NOW);
    const forecast = i.forecast && {
        ...i.forecast,
        days: i.forecast.days.map((d, n) => (n === 0 ? { ...d, peakKw: 0.1 } : d)),
    };
    const m = mozemSkyModel({ ...i, forecast });
    const velke = m.groups[0];
    assert.equal(velke.tone, 'go', 'práčka ide');
    assert.equal(velke.note, 'Práčka teraz · Sušička a umývačka zajtra 08:00');
});
