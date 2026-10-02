import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installedKw, MOZEM_ITEMS, PLANT, SITE, TARIFF, TYPICAL_PLANT } from '../shared/config.js';
import { kwpText } from '../shared/format.js';
import {
    MOZEM_CHIPS,
    mozemGuessText,
    mozemItemText,
    mozemListTitle,
    mozemLogCancel,
    mozemOfflineText,
    mozemPhonesText,
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
    return { now, site: SITE, plant: PLANT, tariff: TARIFF, kiosk: 'kiosk', loading: false, known: 'elektraren', pv, forecast, ...extra };
}

/** Vstup pri známej polohe bez panelov: typická strecha, ako ho skladá appka. @param {Date} now */
function guessInput(now) {
    const typical = typicalSettings(SITE);
    const { forecast } = fixtureData(now);
    return { now, ...typical, loading: false, known: /** @type {const} */ ('poloha'), pv: null, forecast };
}

test('mozemModel: bez guess ostáva pri polohe bez panelov „bezpanelov“, s guess odpovedá z typickej strechy', () => {
    const g = guessInput(FIXED_NOW);
    const dnes = mozemModel(g);
    assert.equal(dnes.state, 'bezpanelov');
    assert.equal(dnes.estimate, false);
    assert.equal(dnes.facts, null);

    const odhad = mozemModel(g, 0, [], { guess: true });
    const elektraren = mozemModel({ ...g, known: 'elektraren' });
    assert.equal(odhad.estimate, true);
    assert.equal(odhad.state, elektraren.state, 'odpoveď je tá istá, akú by dala uložená typická strecha');
    assert.deepEqual(
        odhad.items.map((i) => i.short),
        elektraren.items.map((i) => i.short),
    );
    // Bez polohy sa nedá odpovedať ani s guess.
    assert.equal(mozemModel({ ...g, known: 'nic' }, 0, [], { guess: true }).state, 'bezpanelov');
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

test('mozemItemText: `more` je to isté ako `extra`, len rozdelené na otázku a odpoveď', () => {
    const m = mozemModel(input(FIXED_NOW));
    for (const it of m.items) {
        if (!it.more) {
            assert.equal(it.extra, '', it.id);
            continue;
        }
        if (it.tone === 'go') assert.equal(it.extra, `Mrak? ${it.more.a}`, it.id);
        else assert.ok([it.extra, `${it.more.q} ${it.more.a}`].includes(it.extra), it.id);
    }
    const go = m.items.find((i) => i.id === 'pracka');
    assert.equal(go?.more?.q, 'A keď sa zamračí?');
    // Čakanie a iný deň: otázka je presne začiatok vety súčasnej appky.
    const rano = mozemModel(input(at('05:30')));
    const wait = rano.items.find((i) => i.tone === 'wait' && i.more);
    assert.ok(wait?.more);
    assert.equal(wait.extra, `${wait.more.q} ${wait.more.a}`);
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
    assert.equal(lacno.extra, '');
});

test('texty novej karty: nadpis zoznamu, mobily, výzvy, zrušenie behu', () => {
    const items = [{ tone: 'go' }, { tone: 'go' }, { tone: 'wait' }, { tone: 'no' }, { tone: 'unk' }, { tone: 'go' }];
    assert.equal(mozemListTitle(items, { unknown: false, estimate: false }), 'Čo môžem · 3 zo 6 ide hneď');
    assert.equal(mozemListTitle(items, { unknown: true, estimate: false }), 'Čo môžem · ? zo 6 ide hneď', 'bez dát počet netvrdí');
    assert.equal(mozemListTitle(items.slice(0, 5), { unknown: false, estimate: true }), 'Čo môžem · 2 z 5 ide hneď · odhad');

    assert.equal(phonesPerHour(6.45), 430);
    assert.equal(mozemPhonesText(6.45, true), 'Strecha za hodinu nabije 430 mobilov');
    assert.equal(mozemPhonesText(6.45, false), 'Strecha za hodinu nabije asi 430 mobilov');
    assert.equal(mozemPhonesText(30, true), 'Strecha za hodinu nabije 2\u00a0000 mobilov');
    assert.equal(mozemPhonesText(0.05, false), 'Strecha teraz nenabije ani jeden mobil');

    assert.match(mozemOfflineText({ online: false, kiosk: true, pvOk: false, pvSince: null }), /^Nie je internet/);
    const bezPredpovede = mozemOfflineText({ online: true, kiosk: false, pvOk: false, pvSince: null });
    assert.match(bezPredpovede, /^Predpoveď počasia neprišla/);
    assert.doesNotMatch(bezPredpovede, /Meranie/, 'bez kiosku o meraní nehovorí');
    assert.match(mozemOfflineText({ online: true, kiosk: true, pvOk: false, pvSince: null }), /Ani meranie zo strechy neodpovedá\./);
    assert.match(
        mozemOfflineText({ online: true, kiosk: true, pvOk: false, pvSince: '12:40' }),
        /Meranie zo strechy neodpovedá od 12:40\./,
    );
    assert.doesNotMatch(mozemOfflineText({ online: true, kiosk: true, pvOk: true, pvSince: null }), /Meranie/);

    assert.equal(mozemLogCancel(false, 14 * 60 + 50), 'Beží do 14:50 · zrušiť');
    assert.equal(mozemLogCancel(true, 15 * 60), 'Nabíja sa do 15:00 · zrušiť');
    assert.match(mozemGuessText(5.22), /typickou strechou 5,22 kWp/);
});

test('mozemSkyModel: o 13:00 to isté slovo, veta a odpovede ako mozemModel, k tomu štítky a mobily', () => {
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
    assert.deepEqual(m.chips, [
        { text: MOZEM_CHIPS.go, tone: 'go' },
        { text: MOZEM_CHIPS.lacna, tone: 'cheap' },
    ]);
    assert.equal(m.phones, mozemPhonesText(fixtureData(FIXED_NOW).pv.realTimePowerKw, true), 'živé meranie naisto');
    assert.equal(m.list?.title, mozemListTitle(base.items, { unknown: false, estimate: false }));
    assert.equal(m.retry, false);
    assert.equal(m.guess, '');
    assert.equal(m.quip, base.quip);
    assert.equal(m.items.find((x) => x.id === 'pracka')?.title, `Práčka: ${base.items[0].short}`);
});

test('mozemSkyModel: staré meranie, večer drahá sieť a bez kiosku je fakt v mobiloch „asi“', () => {
    // O 17:00 meranie z fixtures stojí od 13:00 - je staré, takže výkon ide z plánu dňa.
    assert.match(mozemSkyModel(input(at('17:00'))).phones, /asi/);
    assert.match(mozemSkyModel(input(FIXED_NOW, { kiosk: '' })).phones, /asi/);
    const vecer = mozemSkyModel(input(at('21:00')));
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
    assert.equal(m.list?.title, 'Čo môžem · ? zo 6 ide hneď');
    assert.equal(m.items.find((x) => x.id === 'pracka')?.short, 'neviem');
    assert.equal(m.phones, '');
    assert.equal(m.arc?.win, null);
    assert.deepEqual(
        m.chips.map((c) => c.text),
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
    assert.equal(m.quip, '');
    assert.deepEqual(m.chips, []);
    assert.equal(m.retry, false);
});

test('mozemSkyModel: poloha bez panelov odpovedá z typickej strechy a priznáva odhad', () => {
    const m = mozemSkyModel(guessInput(FIXED_NOW));
    assert.equal(m.state, 'go');
    assert.equal(m.guess, mozemGuessText(installedKw(TYPICAL_PLANT)));
    assert.ok(m.guess.includes(kwpText(installedKw(TYPICAL_PLANT))));
    assert.match(m.list?.title || '', / · odhad$/);
    assert.equal(m.list?.estimate, true);
    assert.match(m.phones, /asi/);
});

test('mozemSkyModel: bez polohy len výzva, žiadne odpovede', () => {
    const m = mozemSkyModel({ ...input(FIXED_NOW, { forecast: null, pv: null }), known: 'nic' });
    assert.equal(m.ask, true);
    assert.equal(m.arc, null);
    assert.equal(m.list, null);
    assert.deepEqual(m.items, []);
});

test('mozemSkyModel: bežiaca vec má riadok „beží do“ a tlačidlo na zrušenie', () => {
    const launches = [{ d: '2026-09-05', id: 'pracka', m: 770, sun: true }];
    const m = mozemSkyModel(input(FIXED_NOW), { launches });
    const pr = m.items.find((x) => x.id === 'pracka');
    assert.equal(pr?.running, true);
    assert.equal(pr?.short, 'beží do 14:50');
    assert.equal(pr?.log?.label, 'Beží do 14:50 · zrušiť');
    assert.equal(pr?.log?.pressed, true);
    const auto = mozemSkyModel(input(FIXED_NOW), { launches: [{ d: '2026-09-05', id: 'auto', m: 770, sun: true }] }).items.find(
        (x) => x.id === 'auto',
    );
    assert.match(auto?.log?.label || '', /^Nabíja sa do .* · zrušiť$/);
    assert.equal(m.items.find((x) => x.id === 'hranie')?.log, null);
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
