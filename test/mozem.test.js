import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_DAYS, ALL_MONTHS, installedKw, MOZEM_ITEMS, PLANT, powerThresholds, SITE, TARIFF } from '../shared/config.js';
import { countdownText, durationText } from '../shared/messages.js';
import { dayWindow, itemAnswer, itemCost, mozemModel, mozemSheetOf, planWindows, stripGeometry, sunShare } from '../shared/mozem.js';
import { kwpRoughText } from '../shared/format.js';
import { FIXED_NOW, fixtureData } from './helpers.js';

/** Tarifa Dvorian s cenami: NT lacné, VT drahé. */
const PRICED = { ...TARIFF, bands: TARIFF.bands.map((b) => ({ ...b, price: b.id === 'nt' ? 0.14 : 0.19 })) };
/** Jedna cena celý deň, bez ceny. @type {import('../shared/config.js').Tariff} */
const FLAT = {
    currency: '€',
    bands: [{ id: 'j', name: 'Cena', level: 'bezna', price: null }],
    schedules: [{ days: ALL_DAYS, months: ALL_MONTHS, changes: [{ from: '00:00', band: 'j' }] }],
};
/** Miestny čas 5. 9. 2026 v Bratislave (letný čas). @param {string} hm */
const at = (hm) => new Date(`2026-09-05T${hm}:00+02:00`);

/** Vstup karty v danej chvíli s fixtures. @param {Date} now @param {object} [extra] */
function input(now, extra = {}) {
    const { pv, forecast } = fixtureData(now);
    return {
        now,
        site: SITE,
        plant: PLANT,
        tariff: PRICED,
        zdroj: { sposob: 'huawei-kiosk', pecat: 'v1.test-pecat-0123456789', nazov: '' },
        loading: false,
        pv,
        forecast,
        ...extra,
    };
}
const item = (/** @type {ReturnType<typeof mozemModel>} */ m, /** @type {string} */ id) =>
    /** @type {NonNullable<ReturnType<typeof mozemModel>['items'][number]>} */ (m.items.find((i) => i.id === id));

/**
 * Predpoveď zmenšená na zlomok: zamračený deň. Meranie sa zahodí, inak by dnešok ťahalo nahor.
 * @param {number} k @param {number[]} [dayIdx] ktoré dni zmenšiť (predvolene všetky)
 */
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

test('planWindows: súvislé úseky, ktoré spĺňajú podmienku', () => {
    const plan = [0, 1, 1, 0, 1].map((ok, i) => ({ startMin: i * 15, min: 15, ok }));
    assert.deepEqual(
        planWindows(/** @type {any} */ (plan), (/** @type {any} */ s) => !!s.ok),
        [
            { from: 15, to: 45 },
            { from: 60, to: 75 },
        ],
    );
});

test('dayWindow: prvá a posledná hodina nad hranicou, inak null', () => {
    const day = /** @type {any} */ ({
        hourly: [
            { hour: 8, kw: 1 },
            { hour: 9, kw: 3 },
            { hour: 14, kw: 3 },
            { hour: 15, kw: 1 },
        ],
    });
    assert.deepEqual(dayWindow(day, 2), { from: 540, to: 840 });
    assert.equal(dayWindow(day, 5), null);
});

test('stripGeometry: percentá v produkčnom okne, mimo neho na okraji', () => {
    const span = { from: 5 * 60, to: 21 * 60 };
    assert.deepEqual(stripGeometry({ from: 9 * 60, to: 13 * 60 }, 21 * 60, span), { left: 25, width: 25, now: 100, ...span });
    assert.deepEqual(stripGeometry(null, 0, span), { left: 0, width: 0, now: 0, ...span });
});

test('durationText a countdownText po slovensky', () => {
    assert.equal(durationText(60), 'hodinu');
    assert.equal(durationText(90), 'hodinu a pol');
    assert.equal(durationText(120), '2 hodiny');
    assert.equal(durationText(150), '2 a pol hodiny');
    assert.equal(durationText(300), '5 hodín');
    assert.equal(countdownText(140), '2 h 20 min');
    assert.equal(countdownText(45), '45 min');
    assert.equal(countdownText(180), '3 h');
});

test('13:00 za jasna: zapínaj, s meraním nabitia mobilu a spotrebiče dokedy', () => {
    const m = mozemModel(input(FIXED_NOW));
    assert.equal(m.state, 'go');
    // Slovo hovorí o celom dni: dopoludnie namerané pod predpoveďou, auto by pri mraku nechytilo slnko.
    assert.deepEqual(m.den, { cls: 'dobry', faza: 'den', change: null });
    assert.equal(m.word, 'Not baaad dneskaj');
    assert.match(m.hero.factV, /^~\d+ mobilov$/);
    assert.ok(m.strip && m.strip.width > 0 && m.strip.now > m.strip.left);
    const pracka = item(m, 'pracka');
    assert.equal(pracka.tone, 'go');
    assert.match(pracka.short, /^najneskôr \d\d:\d\d$/, 'pri spotrebiči posledný štart, „do“ je len koniec');
    assert.match(item(m, 'auto').short, /^do \d\d:\d\d$/, 'auto nabíja do konca slnka');
    assert.equal(pracka.more?.a, 'Nevadí. Najviac berie na začiatku pri ohreve vody.', 'pri práčke bez ceny');
    assert.match(item(m, 'auto').more?.a ?? '', /Hodina nabíjania ~\d+,\d\d €/, 'cenu má len auto');
    assert.match(item(m, 'auto').text, /asi \d+ km/);
});

test('meranie mlčí: nie „Slnko to teraz platí za nás“ zo starého čísla, ale odhad a odkedy mlčí', () => {
    // Krivka vo vzorke končí o 13:00; o 14:30 za slnka kiosk drží stále to isté meranie.
    const now = at('14:30');
    const fresh = input(FIXED_NOW);
    const m = mozemModel({
        ...input(now),
        pv: { .../** @type {import('../shared/kiosk.js').PvData} */ (fresh.pv), updatedAt: now.toISOString() },
    });
    assert.equal(m.state, 'go');
    assert.match(m.hero.lead, /^Podľa predpovede teraz svieti\. Teraz /);
    assert.equal(m.hero.factK, 'meranie neodpovedá od 13:00');
    assert.equal(m.hero.factV, 'odhad z predpovede');
    assert.equal(m.facts?.liveKw, null);
});

test('bez merania: priznaný odhad a bez cien žiadne eurá', () => {
    const m = mozemModel(input(FIXED_NOW, { pv: null, zdroj: null, tariff: FLAT }));
    assert.equal(m.state, 'go');
    assert.equal(m.hero.factV, 'odhad z predpovede');
    assert.ok(m.items.every((i) => !i.more?.a.includes('€')));
});

test('rano pred slnkom: ešte nie, štart a spotrebiče o koľkej', () => {
    const m = mozemModel(input(at('05:30')));
    assert.equal(m.state, 'wait');
    assert.equal(m.hero.factK, 'štart');
    const pracka = item(m, 'pracka');
    assert.equal(pracka.tone, 'wait');
    // Práčka potrebuje nad spotrebou domu celé svoje 2 kW, štart karty (zelená) môže byť skôr.
    assert.match(pracka.short, /^o \d\d:\d\d$/);
    assert.ok(pracka.short >= `o ${m.hero.factV}`);
    assert.equal(pracka.more?.q, 'Musíš hneď?');
    assert.equal(pracka.more?.a, 'Pôjde to zo siete.', 'bez ceny');
    assert.ok(item(m, 'auto').short >= pracka.short, 'auto potrebuje silnejšie slnko');
});

test('v drahom pásme rano to karta povie, aj čo z plánu pôjde prvé', () => {
    const DRAHA = { ...FLAT, bands: [{ ...FLAT.bands[0], level: /** @type {const} */ ('draha'), price: 0.19 }] };
    const m = mozemModel(input(at('07:00'), { pv: null, tariff: DRAHA }));
    assert.equal(m.state, 'wait');
    assert.equal(m.hero.lead, 'Za 15 min pôjde zo strechy umývačka. Teraz by si platil drahý prúd.');
    assert.match(item(m, 'susicka').text, /práve drahá/);
});

test('karta podľa Plánu dňa: čo ide teraz, čo potom, a keď slnko na nič z plánu nestačí', () => {
    const rano = mozemModel(input(at('09:00')));
    assert.equal(rano.state, 'go');
    assert.equal(rano.hero.lead, 'Slnko to teraz platí za nás. Teraz práčka a umývačka, o 09:20 auto.');
    assert.equal(mozemModel(input(at('09:00')), { voice: 'slusny' }).hero.lead.startsWith('Elektrinu teraz dodáva slnko. Teraz '), true);
    // 17:10: zelená ešte svieti, ale na nič z plánu už nestačí - nie „zapni“.
    const vecer = mozemModel(input(at('17:10')));
    assert.equal(vecer.state, 'none');
    assert.equal(vecer.hero.lead, 'Na veľké veci už slnko nestačí. Auto od 17:15 na lacný prúd, zvyšok zajtra.');
    assert.match(vecer.strip?.text ?? '', /^Slnko do /, 'pás dňa ostáva podľa slnka');
    assert.equal(vecer.groups[0].value, 'zajtra 07:30');
    assert.equal(vecer.groups[0].note, 'Umývačka zajtra 07:30 · Práčka zajtra 07:45 · Sušička zajtra 09:45');
    const slusne = mozemModel(input(at('17:10')), { voice: 'slusny' });
    assert.equal(slusne.hero.lead, 'Na veľké spotrebiče už slnko nestačí. Auto od 17:15 z lacnej siete, ostatné zajtra.');
    // Bez spotrebičov doma karta odpovedá podľa slnka a dlaždice podľa vecí.
    const nic = mozemModel(input(at('09:00')), { devices: [] });
    assert.equal(nic.state, 'go');
    assert.equal(nic.hero.lead, 'Slnko to teraz platí za nás.');
    assert.equal(nic.groups.length, 3);
});

test('večer: dnes už nie, auto na lacný prúd, ostatné zajtra', () => {
    const m = mozemModel(input(at('19:50')));
    assert.equal(m.state, 'none');
    assert.match(m.hero.lead, /Auto na lacný prúd/);
    assert.match(m.strip?.text || '', /^Slnko skončilo o/);
    assert.equal(item(m, 'auto').tone, 'cheap');
    assert.match(item(m, 'auto').more?.a ?? '', /^Zajtra od/);
    assert.match(item(m, 'pracka').short, /^zajtra /);
});

test('večer vo VT: auto nie je lacno, čaká na zajtrajšie slnko', () => {
    const m = mozemModel(input(at('20:45')));
    assert.equal(item(m, 'auto').tone, 'wait');
    assert.doesNotMatch(m.hero.lead, /lacný/);
});

test('zamračený deň: slabý deň, umývačka a sušička sa preskočia, práčka nie', () => {
    const forecast = cloudy(0.05, [0, 1]);
    const m = mozemModel(input(at('12:00'), { pv: null, forecast }));
    assert.equal(m.state, 'slabo');
    assert.match(m.hero.factV, /zajtra/);
    assert.match(m.strip?.text || '', /neutiahne/);
    const th = powerThresholds(PLANT);
    assert.ok(forecast.days[1].peakKw < th.weakPeakKw, 'zajtra je tiež slabý deň');
    const pracka = item(m, 'pracka');
    const umyvacka = item(m, 'umyvacka');
    assert.doesNotMatch(pracka.text, /radšej počkaj/, 'práčka sa v slabý deň neodporúča len preto, že slnko nestačí');
    assert.match(umyvacka.text, /radšej počkaj/);
    assert.equal(umyvacka.tone, 'no');
});

test('celý týždeň bez slnka: tento týždeň nie', () => {
    const m = mozemModel(input(at('12:00'), { pv: null, forecast: cloudy(0.01) }));
    assert.equal(item(m, 'susicka').short, 'tento týždeň nie');
    assert.equal(item(m, 'auto').tone, 'cheap', 'cez deň v NT je aspoň lacno');
});

test('bez dát: neviem, pri spotrebičoch otáznik', () => {
    const m = mozemModel(input(FIXED_NOW, { pv: null, forecast: null }));
    assert.equal(m.state, 'offline');
    assert.equal(m.word, 'Nemám dáta, sme off-line');
    assert.equal(m.strip, null);
    assert.equal(item(m, 'pracka').tone, 'unk');
    assert.equal(mozemModel(input(FIXED_NOW, { pv: null, forecast: null, loading: true })).state, 'loading');
});

test('bez zadaných panelov: odpoveď z typickej strechy a riadok povie, s akou', () => {
    const m = mozemModel({ ...input(FIXED_NOW, { pv: null, zdroj: null }), known: 'poloha' });
    assert.equal(m.state, 'go');
    assert.equal(m.estimate, true);
    assert.match(m.hero.lead, /^Podľa predpovede teraz svieti\. Teraz /);
    assert.deepEqual([m.hero.factK, m.hero.factV], ['typická strecha', kwpRoughText(installedKw(PLANT))]);
    assert.equal(item(m, 'pracka').tone, 'go');
    // Bez polohy appka nevie nič - neviem a prečo.
    const nic = mozemModel({ ...input(FIXED_NOW, { pv: null }), known: 'nic' });
    assert.equal(nic.state, 'bezpanelov');
    assert.equal(nic.word, 'Nastav panely, voe!');
    assert.equal(nic.strip, null);
    assert.deepEqual([nic.hero.factK, nic.hero.factV], ['panely', 'nezadané']);
});

test('mozemSheetOf: skupina otvorí panel so zoznamom, vec s jednou dlaždicou svoj, iné id nič', () => {
    const m = mozemModel(input(FIXED_NOW));
    const velke = mozemSheetOf(m, 'velke');
    assert.ok(velke && 'group' in velke);
    assert.deepEqual(
        velke.group.rows.map((r) => r.id),
        ['pracka', 'umyvacka', 'susicka'],
    );
    const auto = mozemSheetOf(m, 'auto');
    assert.ok(auto && 'item' in auto);
    assert.equal(auto.item.title, `Auto: ${auto.item.short}`);
    // Vec zo skupiny (napr. starý krok histórie) otvorí svoj panel, nie skupinu.
    assert.ok(mozemSheetOf(m, 'pracka') && 'item' in /** @type {object} */ (mozemSheetOf(m, 'pracka')));
    assert.equal(mozemSheetOf(m, 'nic-take'), null);
    assert.equal(mozemSheetOf(m, null), null);
});

test('itemAnswer a itemCost: vec bez spotrebiča karta nepozná a nemá cenu', () => {
    const nic = { id: 'nic', device: null, runMin: null, runKwh: null, heat: null };
    const ctx = /** @type {any} */ ({ price: 0.2 });
    assert.deepEqual(itemAnswer(nic, ctx), { kind: 'unk' });
    assert.equal(itemCost(nic, ctx), null);
});

test('13:00: každý spotrebič má vlastný posledný štart a vlastnú vetu podľa profilu odberu', () => {
    const m = mozemModel(input(FIXED_NOW));
    const [pracka, umyvacka, susicka] = ['pracka', 'umyvacka', 'susicka'].map((id) => item(m, id));
    assert.equal(m.groups[0].value, 'teraz', 'práčka a umývačka podľa plánu idú teraz');
    // Práčka potrebuje slnko len na 20 minút ohrevu, umývačka aj na oplach o 2 h, sušička celý program.
    assert.deepEqual([pracka.short, umyvacka.short, susicka.short], ['najneskôr 16:55', 'najneskôr 15:15', 'najneskôr 16:00']);
    assert.match(pracka.text, /prvých 20 minút pri ohreve vody/);
    assert.match(umyvacka.text, /dvakrát: na začiatku a pri oplachu o 2 hodiny/);
    assert.match(susicka.text, /celý čas berie 1,5 kW/);
    assert.equal(new Set([pracka.text, umyvacka.text, susicka.text]).size, 3, 'žiadne dve vety rovnaké');
});

test('neskoro popoludní: čo už celé na slnku nedobehne, povie koľko pokryje strecha, bez ceny', () => {
    // Bez sušičky: s ňou by práčka čakala na zajtra, aby išli v jeden deň.
    const m = mozemModel(input(at('16:30')), { devices: ['pracka', 'umyvacka', 'auto'] });
    assert.equal(m.state, 'go');
    assert.equal(item(m, 'pracka').short, 'najneskôr 16:55', 'ohrev práčky ešte chytí slnko');
    const umyvacka = item(m, 'umyvacka');
    assert.equal(umyvacka.short, 'teraz');
    assert.match(umyvacka.text, /^Prvý ohrev ešte chytí slnko, oplach o 18:30 už nie\. Zo slnka asi \d0 %, zvyšok zo siete\.$/);
    assert.match(item(m, 'susicka').text, /slnko vydrží len do 17:30\. Zo slnka asi/);
});

test('tesne pred koncom slnka: pod polovicu zo strechy už nie „teraz“, ale iný deň, bez ceny', () => {
    const m = mozemModel(input(at('17:05')));
    assert.equal(item(m, 'pracka').short, 'teraz');
    assert.match(item(m, 'pracka').text, /Zo slnka asi 50 %/);
    const susicka = item(m, 'susicka');
    assert.equal(susicka.short, 'zajtra 08:00');
    assert.equal(susicka.text, 'Celý čas berie 1,5 kW a dnes by to celé išlo zo siete.');
    assert.equal(item(m, 'bojler').tone, 'cheap', 'bojler ide na lacnú sieť');
});

test('večer bez ceny v tarife: vety bez eur', () => {
    const m = mozemModel(input(at('19:50'), { tariff: FLAT }));
    assert.equal(item(m, 'pracka').text, 'Dnes by to išlo zo siete a väčšinu by zjedol ohrev vody.');
    assert.equal(item(m, 'umyvacka').text, 'Dnes by ohrevy vody išli zo siete.');
});

test('sunShare: celý program na slnku, polovica, nič po konci plánu', () => {
    const pracka = /** @type {(typeof MOZEM_ITEMS)[number]} */ (MOZEM_ITEMS.find((i) => i.id === 'pracka'));
    const th = powerThresholds(PLANT);
    const plan = (/** @type {(m: number) => number} */ kw) =>
        Array.from({ length: 96 }, (_, i) => ({ startMin: i * 15, min: 15, kw: kw(i * 15) }));
    const ctx = (/** @type {(m: number) => number} */ kw) => /** @type {any} */ ({ plan: plan(kw), th });
    assert.equal(
        sunShare(
            pracka,
            2,
            ctx(() => 5),
            600,
        ),
        1,
    );
    assert.equal(
        sunShare(
            pracka,
            2,
            ctx(() => 0),
            600,
        ),
        0,
    );
    // Ohrev (20 min) bez slnka, zvyšok so slabým slnkom: zo strechy len ľahká časť programu.
    const s = sunShare(
        pracka,
        2,
        ctx((m) => (m < 630 ? 0 : 1)),
        600,
    );
    assert.ok(s > 0.2 && s < 0.5, `ľahká časť: ${s}`);
    // Štart o 23:00: ohrev a 40 minút ľahkej časti ešte v pláne dňa, po polnoci už nie.
    assert.ok(
        Math.abs(
            sunShare(
                pracka,
                2,
                ctx(() => 5),
                23 * 60,
            ) - 0.8,
        ) < 1e-9,
        'po polnoci plán dňa končí',
    );
});

test('Plán dňa pre kartu Teraz: časy ako dlaždice, veta nad ním a časová os', () => {
    const m = mozemModel(input(FIXED_NOW));
    assert.deepEqual(
        m.plan?.rows.map((r) => [r.name, r.value]),
        [
            ['Práčka', 'teraz'],
            ['Umývačka', 'teraz'],
            ['Auto', 'o 13:15'],
            ['Sušička', 'o 15:00'],
        ],
    );
    assert.equal(m.groups.find((g) => g.key === 'auto')?.value, 'o 13:15', 'ten istý čas ako dlaždica');
    assert.deepEqual(m.planHead, { lead: 'Teraz práčka a umývačka', then: 'Auto o 13:15 · sušička o 15:00' });
    // Bez spotrebičov doma ani predpovede veta nie je.
    assert.equal(mozemModel(input(FIXED_NOW), { devices: [] }).planHead, null);
    assert.equal(mozemModel(input(FIXED_NOW, { pv: null, forecast: null })).planHead, null);
    // Večer: nič teraz, veta povie, čo príde najskôr - auto do lacného pásma, za ním zajtrajšie slnko.
    const vecer = mozemModel(input(at('19:50'))).planHead;
    assert.match(vecer?.lead ?? '', /^Auto od \d\d:\d\d$/);
    assert.match(vecer?.then ?? '', /^\S+ zajtra \d\d:\d\d · \S+ zajtra \d\d:\d\d$/);
});

test('Plán dňa pre kartu Teraz v novej appke: časová os', () => {
    // Pás pre každý spotrebič na slnku, os cez dnešné svetlo, čiara teraz.
    const t = /** @type {NonNullable<ReturnType<typeof mozemModel>['plan']>} */ (mozemModel(input(FIXED_NOW)).plan).lanes;
    assert.deepEqual(
        t.lanes.map((l) => l.name),
        ['Práčka', 'Umývačka', 'Auto', 'Sušička'],
    );
    for (const l of t.lanes) assert.ok(l.left >= 0 && l.width > 0 && l.left + l.width <= 100, `${l.name} ${l.left} ${l.width}`);
    assert.ok(t.now > 0 && t.now < 100);
    assert.ok(t.ticks.length >= 3 && t.ticks.every((x) => Number(x.label) % 3 === 0));
    // Večer dnes na slnko nejde nič: os bez pásov, všetko pod ňou s časom z riadku plánu.
    const tma = mozemModel(input(at('19:50')), { devices: ['pracka', 'bojler'] }).plan?.lanes;
    assert.deepEqual(tma?.lanes, []);
    assert.deepEqual(
        tma?.others.map((o) => o.name),
        ['Bojler', 'Práčka'],
    );
    assert.match(tma?.others[1].value ?? '', /^zajtra \d\d:\d\d$/);
});

test('Plán dňa na ďalší deň: večer os zajtrajška, dnešná lacná sieť vetou', () => {
    // Cez deň je na slnku niečo dnes - plán na ďalší deň nie je.
    assert.equal(mozemModel(input(FIXED_NOW)).plan?.next, null);
    const plan = mozemModel(input(at('19:50')), { devices: ['pracka', 'susicka', 'bojler'] }).plan;
    const next = plan?.next;
    assert.ok(next);
    assert.equal(next.title, 'Plán na');
    assert.equal(next.day, 'zajtra');
    assert.equal(next.strip, 'Zajtra · nedeľa 6.9.');
    // Pásy podľa času, sušička po práčke, bez čiary teraz; nič na iný deň, takže bez štítkov.
    assert.deepEqual(
        next.lanes.lanes.map((l) => l.name),
        ['Práčka', 'Sušička'],
    );
    const [pracka, susicka] = next.lanes.lanes;
    assert.ok(pracka.left + pracka.width <= susicka.left + 0.1, 'sušička až po práčke');
    for (const l of next.lanes.lanes) assert.ok(l.left >= 0 && l.width > 0 && l.left + l.width <= 100);
    assert.equal(next.lanes.now, null);
    assert.deepEqual(next.lanes.others, []);
    assert.ok(next.lanes.ticks.every((t) => Number(t.label) % 3 === 0));
    // Veta ako pri dnešku: prvý spotrebič s časom, za ním ďalší; bojler dnes z lacnej siete.
    const row = (/** @type {string} */ id) => /** @type {any} */ (plan?.rows.find((r) => r.id === id));
    assert.equal(next.head.lead, `Práčka o ${row('pracka').value.slice(-5)}`);
    assert.equal(next.head.then, `Sušička o ${row('susicka').value.slice(-5)}`);
    assert.match(next.head.tonight, /^Dnes z lacnej siete: bojler od \d\d:\d\d$/);
    // Riadky pre plagát súčasnej appky: bez dnešnej lacnej siete (tú povie veta), s časom v ten deň.
    assert.deepEqual(
        next.rows.map((r) => [r.name, r.value]),
        [
            ['Práčka', `o ${row('pracka').value.slice(-5)}`],
            ['Sušička', `o ${row('susicka').value.slice(-5)}`],
        ],
    );
    assert.equal(next.rows[1].why, row('susicka').why, 'prečo ostáva z riadku plánu');
});

test('Plán dňa na ďalší deň: os dňa prvého riadku na iný deň, ostatné dni štítkom aj riadkom', async () => {
    const { planNextDay } = await import('../shared/plan-dna.js');
    const { dayCtx } = await import('../shared/mozem.js');
    const { weekDayName } = await import('../shared/format.js');
    const inp = input(at('19:50'));
    const ctx = dayCtx(inp);
    const [d1, d2] = ctx.later.slice(1);
    /** @param {string} name @param {{ day: { date: string }, index: number }} d @param {number} start */
    const later = (name, d, start) => ({
        id: name,
        kind: /** @type {const} */ ('later'),
        day: { name: weekDayName(d.day.date, d.index), index: d.index, start },
        end: start + 90,
        after: null,
        ...texty(name, 'neskôr'),
    });
    /** @param {string} name @param {string} value */
    function texty(name, value) {
        return { name, value, time: value, why: '', tone: /** @type {const} */ ('wait'), now: false };
    }
    const nie = { id: 'nie', kind: /** @type {const} */ ('none'), ...texty('Sušička', 'tento týždeň nie') };
    // Riadky prichádzajú v poradí dní; v ten deň idú pásy podľa času.
    const next = planNextDay([later('Umývačka', d1, 600), later('Práčka', d1, 480), later('Auto', d2, 540), nie], ctx, inp.site);
    assert.ok(next);
    const name = weekDayName(d1.day.date, d1.index);
    assert.equal(next.day, name.toLowerCase());
    assert.equal(next.strip, `${name} ${d1.day.date.slice(8).replace(/^0/, '')}.${Number(d1.day.date.slice(5, 7))}.`);
    assert.equal(next.head.lead, 'Práčka o 08:00');
    assert.equal(next.head.then, 'Umývačka o 10:00');
    assert.equal(next.head.tonight, '', 'bez lacnej siete bez vety');
    assert.deepEqual(
        next.lanes.others.map((o) => o.name),
        ['Auto', 'Sušička'],
    );
    assert.deepEqual(
        next.rows.map((r) => [r.name, r.value]),
        [
            ['Práčka', 'o 08:00'],
            ['Umývačka', 'o 10:00'],
            ['Auto', 'neskôr'],
            ['Sušička', 'tento týždeň nie'],
        ],
    );
    // Bez riadku na iný deň plán na ďalší deň nie je.
    assert.equal(planNextDay([nie], ctx, inp.site), null);
});

test('mozemModel: veta bez spotrebičov, štítky a čo dá strecha za celý deň', () => {
    const m = mozemModel(input(FIXED_NOW));
    assert.equal(m.say, 'Slnko to teraz platí za nás.');
    assert.match(m.hero.lead, /^Slnko to teraz platí za nás\. Teraz /, 'hlavička Dnes aj s plánom');
    assert.deepEqual(
        m.chips.map((c) => c.tone),
        ['go', 'cheap'],
    );
    // Predpoveď dňa 61,4 kWh je viac, než nabehlo - ráta sa celý deň.
    assert.deepEqual(m.day, {
        lead: 'Dnes zo strechy asi 61 kWh. To je:',
        eq: [
            { value: '~4\u00a0090', label: 'nabitých mobilov' },
            { value: '~370 km', label: 'elektrickým autom' },
            { value: '~4,0 kg', label: 'CO2eq menej' },
        ],
    });
    assert.equal(mozemModel(input(FIXED_NOW, { pv: null, forecast: null })).day, null, 'bez predpovede nie');
    assert.equal(mozemModel(input(FIXED_NOW, { forecast: null, pv: null, loading: true })).say, 'Pozerám na oblohu.');
});
