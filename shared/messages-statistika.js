// Texty karty Štatistika a plagátu novej appky a súhrnu na zdieľanie. Nová appka ich sťahuje až
// s kartou Štatistika (obloha/web/parts.js); spoločný vstup do všetkých textov je messages.js.
// Čisté funkcie bez DOM.

import { dateParts, dayNameLong, dayNameShort, fmt1, fmtSum } from './format.js';
import { DATE_RE } from './valid.js';
import { MOZEM_SKY_TEXTS, polite, TERAZ_TEXTS } from './messages-core.js';

/** @typedef {import('./messages-core.js').Voice} Voice */

// ---- Karta Štatistika a plagát v novej appke ---------------------------------------
// Súčty, hodnotu podľa tarify aj súhrn počíta to isté ako súčasná appka (statsModel,
// summaryModel); tu sú len texty nového vzhľadu (shared/statistika.js).

/** Mesiac v genitíve: „Najlepší deň októbra“. */
const MONTHS_OF = [
    'januára',
    'februára',
    'marca',
    'apríla',
    'mája',
    'júna',
    'júla',
    'augusta',
    'septembra',
    'októbra',
    'novembra',
    'decembra',
];

/** Pevné texty karty a plagátu: prepínač, popisky, výzvy a tlačidlá. */
export const STATISTIKA_TEXTS = {
    title: 'Štatistika',
    periods: { dnes: 'Dnes', mesiac: 'Mesiac', rok: 'Rok', spolu: 'Spolu' },
    periodsLabel: 'Obdobie',
    equiv: 'To je ako',
    phones: 'nabitý mobil',
    km: 'elektrickým autom',
    loading: TERAZ_TEXTS.loading,
    retry: MOZEM_SKY_TEXTS.retry,
    forecastSub: 'odhad z predpovede na celý dnešok',
    note: 'Hodnota je to, čo by si za túto elektrinu zaplatil zo siete podľa svojej tarify. Koľko z nej si spotreboval sám, appka nevie.',
    pricesTitle: 'Doplň ceny v tarife',
    pricesText: 'Uvidíš, akú hodnotu má vyrobená elektrina v peniazoch.',
    pricesBtn: 'Doplniť ceny',
    measureTitle: 'Pripoj živé meranie',
    measureText:
        'Dnešok teraz len odhadujem z predpovede. Naozaj vyrobené kWh za dnes, mesiac, rok aj celý čas posiela menič, keď ho pripojíš v Nastavení.',
    measureBtn: 'Pripojiť meranie',
    measureOff:
        'Živé meranie teraz neodpovedá, dnešok len odhadujem z predpovede. Súčty za mesiac, rok aj celý čas sa ukážu, keď sa menič ozve.',
    setupSub: 'zatiaľ nemám čo počítať',
    setupTitle: 'Prázdna strecha, prázdna štatistika',
    setupText:
        'Bez panelov neviem, koľko si vyrobil za deň, mesiac ani rok. Zadaj ich a prípadne pripoj aj menič pre naozaj namerané čísla.',
    setupBtn: 'Nastaviť panely',
    laterTitle: 'Keď ich zadáš, uvidíš',
    laterText:
        'Vyrobené dnes, za mesiac, rok aj od spustenia · koľko je to mobilov a kilometrov autom · najlepší deň · plagát na zdieľanie',
    askTitle: 'Kde máš strechu?',
    askText: 'Bez polohy neviem, kde tvoja strecha je, nieto koľko vyrobila. Zadaj ju v Nastavení a začnem počítať.',
    askBtn: 'Zadaj polohu',
    posterLabel: 'Súhrn na zdieľanie',
    posterShare: 'Zdieľať do story',
    posterClose: 'Zavrieť',
    posterFoot: 'RAY-MON · slnko nefakturuje',
    posterPhones: 'nabitý mobil',
    posterKm: 'elektrickým autom',
    posterWashes: 'pranie zo slnka',
    posterValue: 'hodnota podľa tarify',
    posterCo2: 'CO2eq menej ako zo siete',
    posterPayback: 'uhlíka panelov od spustenia',
    posterPaid: 'uhlík panelov splatený',
};

/** @type {typeof STATISTIKA_TEXTS} */
const STATISTIKA_TEXTS_SLUSNE = {
    ...STATISTIKA_TEXTS,
    note: 'Hodnota je to, čo by ste za túto elektrinu zaplatili zo siete podľa svojej tarify. Koľko z nej ste spotrebovali sami, appka nevie.',
    pricesTitle: 'Doplňte ceny v tarife',
    pricesText: 'Uvidíte, akú hodnotu má vyrobená elektrina v peniazoch.',
    measureTitle: 'Pripojte živé meranie',
    measureText:
        'Dnešok teraz len odhadujem z predpovede. Naozaj vyrobené kWh za dnes, mesiac, rok aj celý čas posiela menič, keď ho pripojíte v Nastavení.',
    setupTitle: 'Štatistika potrebuje vaše panely',
    setupText:
        'Bez panelov neviem, koľko ste vyrobili za deň, mesiac ani rok. Zadajte ich a prípadne pripojte aj menič pre naozaj namerané čísla.',
    laterTitle: 'Keď ich zadáte, uvidíte',
    askTitle: 'Kde máte strechu?',
    askText: 'Bez polohy neviem, kde je vaša strecha, ani koľko vyrobila. Zadajte ju v Nastavení a začnem počítať.',
    askBtn: 'Zadajte polohu',
    posterFoot: 'RAY-MON',
};

/**
 * Odkiaľ je veľké číslo zo živého merania: „vyrobené dnes do 13:00“, „vyrobené v októbri“. Súčet,
 * ktorý nesiaha na začiatok obdobia (shared/sucty.js), povie odkiaľ: „vyrobené tento rok od 21. 10.“,
 * „vyrobené dnes od 09:12 do 13:00“.
 * @param {import('./stats.js').StatsPeriod} period
 * @param {{ time: string, month: string, od?: string | null }} d `time` čas merania, `month` mesiac v lokáli („októbri“), `od` odText
 */
export function statsHeroSub(period, { time, month, od = null }) {
    const s = od ? ` ${od}` : '';
    return `vyrobené ${{ dnes: `dnes${s} do ${time}`, mesiac: `v ${month}${s}`, rok: `tento rok${s}`, spolu: 'od spustenia' }[period]}`;
}

// ---- Súčty dopočítané z celkovej výroby (shared/sucty.js) ---------------------------

/**
 * Odkiaľ je súčet: „od 21. 10.“ (deň), „od 09:12“ (čas dneška).
 * @param {string} od deň `YYYY-MM-DD` či čas `HH:MM` z pv.od
 */
export function odText(od) {
    if (!DATE_RE.test(od)) return `od ${od}`;
    const { day, month } = dateParts(od);
    return `od ${day}. ${month}.`;
}

/** Obdobia pv.od v poradí vety a ich mená. */
const OD_OBDOBIA = /** @type {const} */ ([
    ['den', 'dnešok'],
    ['mesiac', 'mesiac'],
    ['rok', 'rok'],
]);

/**
 * Poznámka Štatistiky, keď je niektorý súčet len od prvého merania: „Fox ESS neposiela súčet za rok.
 * Rátam ho sám z celkovej výroby, zatiaľ od 21. 10. – skôr som meranie nemal.“ Inak prázdna.
 * @param {string} znacka meno značky (menoZnacky) @param {import('./kiosk.js').PvData['od']} od
 */
export function suctyOdNote(znacka, od) {
    const obd = OD_OBDOBIA.filter(([k]) => od?.[k]);
    if (!od || !obd.length) return '';
    const mena = obd.map(([, m]) => m);
    const zoznam = mena.length === 1 ? mena[0] : `${mena.slice(0, -1).join(', ')} ani ${mena[mena.length - 1]}`;
    const ody = [...new Set(obd.map(([k]) => /** @type {string} */ (od[k])))];
    const kedy =
        ody.length === 1 ? `zatiaľ ${odText(ody[0])}` : obd.map(([k, m]) => `${m} ${odText(/** @type {string} */ (od[k]))}`).join(', ');
    return `${znacka || 'Výrobca'} neposiela súčet za ${zoznam}. Rátam ${mena.length === 1 ? 'ho' : 'ich'} sám z celkovej výroby, ${kedy} – skôr som meranie nemal.`;
}

/** Hodnota podľa tarify: „Hodnota podľa tarify 4,78 €“, odhad s „≈“. @param {number} value @param {string} currency @param {boolean} estimate */
export function statsValueText(value, currency, estimate) {
    return `Hodnota podľa tarify ${estimate ? '≈ ' : ''}${fmtSum(value, 2)} ${currency}`;
}

/** Pás pod dneškom: koľko z predpovede už strecha vyrobila. @param {number} pct @param {number} forecastKwh */
export function statsProgressText(pct, forecastKwh) {
    return `${pct} % z predpovede ${fmt1(forecastKwh)} kWh`;
}

/**
 * Najlepší deň mesiaca: nadpis a veta. Dnešok je ešte rozbehnutý, preto iná veta.
 * @param {{ date: string, kwh: number, today: boolean }} best @param {Voice} [voice]
 */
export function statsBestText(best, voice = 'drzy') {
    const { day, month } = dateParts(best.date);
    const title = `Najlepší deň ${MONTHS_OF[month - 1]}`;
    if (polite(voice))
        return {
            title,
            text: best.today
                ? `Dnes · ${fmt1(best.kwh)} kWh. Strecha dnes pracuje naplno.`
                : `${dayNameLong(best.date)} ${day}. · ${fmt1(best.kwh)} kWh. Strecha vtedy pracovala naplno.`,
        };
    return {
        title,
        text: best.today
            ? `Dnes · ${fmt1(best.kwh)} kWh. Strecha dnes maká ako blázon.`
            : `${dayNameLong(best.date)} ${day}. · ${fmt1(best.kwh)} kWh. Strecha vtedy makala ako blázon.`,
    };
}

/** Tlačidlo plagátu: „Október na streche · zdieľať“. @param {string} kick nadpis súhrnu (summaryTexts) */
export const posterButtonText = (kick) => `${kick} · zdieľať`;

/** Odkaz na plagát na karte Môžem?: „Október na streche: 168 kWh · súhrn“. @param {string} kick @param {number} kwh */
export const posterLinkText = (kick, kwh) => `${kick}: ${fmtSum(Math.round(kwh), 0)} kWh · súhrn na zdieľanie`;

/**
 * Najlepší deň na plagáte nakrátko: „so 14.“, „dnes“; v roku s mesiacom, „14. 6.“ - deň bez
 * mesiaca by tam nebol jednoznačný.
 * @param {{ date: string, today: boolean }} best @param {import('./config.js').SummaryPeriod} [period]
 */
export function posterBestDay(best, period) {
    if (best.today) return 'dnes';
    const { day, month } = dateParts(best.date);
    return period === 'rok' ? `${day}. ${month}.` : `${dayNameShort(best.date).toLowerCase()} ${day}.`;
}

/** Úspora CO2eq na plagáte: do 10 kg s desatinou („~2,4 kg“), inak celé („~38 kg“). @param {number} kg */
export const posterCo2Value = (kg) => `~${kg < 10 ? fmt1(kg) : fmtSum(Math.round(kg), 0)} kg`;

/**
 * Splatený uhlík panelov v percentách, nadol - 100 % až keď je naozaj splatený.
 * @param {number} share podiel (carbonPayback) @returns {{ pct: number, paid: boolean }}
 */
export function posterPayback(share) {
    const pct = Math.min(100, Math.floor(share * 100));
    return { pct, paid: pct >= 100 };
}

/**
 * Faktory CO2eq a ich zdroje (shared/carbon.js, carbonFacts).
 * @typedef {{ gridG: number, gridSource: string, pvG: number, pvSource: string, lifeYears: number }} CarbonFactors
 */

/**
 * Poznámka pod plagátom aj súhrnom: s akými faktormi a odkiaľ CO2eq počíta, aby sa číslo dalo overiť.
 * @param {CarbonFactors & { debtT: number | null }} c
 */
export function posterCarbonNote({ gridG, gridSource, pvG, pvSource, debtT, lifeYears }) {
    const base =
        `CO2eq za celý životný cyklus: kWh zo siete SR ${gridG} g (${gridSource}), ` +
        `zo slnka ${pvG} g (${pvSource}, prepočítané na výrobu v SR).`;
    return debtT === null
        ? base
        : `${base} Výroba týchto panelov aj s meničom stála asi ${fmt1(debtT)} t CO2eq, rozpočítaná na ${lifeYears} rokov prevádzky.`;
}

// ---- Súhrn na zdieľanie ------------------------------------------------------------

/** Tvar podstatného mena podľa počtu: 1 rok, 2 roky, 5 rokov. @param {number} n @param {[string, string, string]} forms */
export function plural(n, [one, few, many]) {
    if (n === 1) return one;
    return n >= 2 && n <= 4 ? few : many;
}

/**
 * Trasy na porovnanie kilometrov, od najkratšej. Súhrn vyberie najdlhšiu, na ktorú to stačí.
 * Vzdialenosti sú po ceste z Bratislavy, zaokrúhlené; rok na streche dá aj obvod Zeme (40 075 km).
 */
export const SUMMARY_TRIPS = [
    { km: 130, text: 'ako z Bratislavy do Trnavy a späť' },
    { km: 330, text: 'ako z Bratislavy do Prahy' },
    { km: 800, text: 'Bratislava – Košice a späť' },
    { km: 1800, text: 'až do Barcelony' },
    { km: 3600, text: 'do Barcelony a späť' },
    { km: 7200, text: 'dvakrát do Barcelony a späť' },
    { km: 40000, text: 'raz okolo Zeme' },
];

/**
 * Nadpis súhrnu: „Posledných 7 dní na streche“, „September na streche“, „Rok 2026 na streche“.
 * @param {{ period: import('./config.js').SummaryPeriod, month: string, year: string }} d
 */
function summaryKick(d) {
    if (d.period === 'tyzden') return 'Posledných 7 dní na streche';
    if (d.period === 'rok') return `Rok ${d.year} na streche`;
    return `${d.month.charAt(0).toUpperCase()}${d.month.slice(1)} na streche`;
}

/**
 * Nadpis, riadky a poznámka súhrnu. Čísla prichádzajú hotové zo shared/summary.js. `kick` je
 * nadpis obdobia (aj na tlačidle a v odkaze), `heading` nadpis súhrnu a plagátu - pri súčte, ktorý
 * nesiaha na začiatok obdobia, s „od 21. 10.“.
 * @param {{ period: import('./config.js').SummaryPeriod, month: string, year: string, kwh: number, phones: number, km: number,
 *   best: { date: string, kwh: number, today: boolean } | null, value: number | null, currency: string,
 *   launches: { all: number, sun: number }, missing: number, co2Kg: number, payback: number | null, debtT: number | null,
 *   carbon: CarbonFactors, od: string | null, znacka: string }} d
 * @param {Voice} [voice]
 */
export function summaryTexts(d, voice = 'drzy') {
    const kick = summaryKick(d);
    const heading = d.od ? `${kick} ${odText(d.od)}` : kick;
    /** @type {Array<{ t: string, s: string }>} */ const rows = [];
    if (d.kwh > 0) {
        rows.push({ t: `${fmtSum(Math.round(d.phones), 0)} nabití mobilu`, s: phonesSub(d.phones) });
        const trip = SUMMARY_TRIPS.filter((x) => x.km <= d.km).pop();
        rows.push({ t: `${fmtSum(Math.round(d.km), 0)} km autom`, s: trip ? trip.text : 'na elektrinu, zo strechy' });
    }
    if (d.best) rows.push({ t: `Najlepší deň: ${bestDay(d.best, d.period)}`, s: `${fmt1(d.best.kwh)} kWh za jediný deň` });
    if (d.value !== null && d.kwh > 0) rows.push({ t: `Hodnota ~${fmtSum(d.value, 0)} ${d.currency}`, s: 'toľko by sme za to dali sieti' });
    const { all, sun } = d.launches;
    if (all)
        rows.push({
            t: polite(voice) ? `Na slnku ste pustili ${sun}×` : `Na slnku si pustil/a ${sun}×`,
            s: all > sun ? `z ${all} spustení, zvyšok išiel zo siete` : 'všetko išlo zo slnka',
        });
    rows.push(...carbonRows(d));
    return { kick, heading, rows, note: summaryNote(d) };
}

/**
 * Poznámka pod súhrnom: dni, ktoré v denníku chýbajú, a s akými faktormi sa počíta CO2eq.
 * @param {Parameters<typeof summaryTexts>[0]} d
 */
function summaryNote(d) {
    const od = d.od
        ? `Súčet ${d.period === 'rok' ? 'roka' : 'mesiaca'} je ${odText(d.od)} – skôr appka meranie z ${d.znacka || 'meniča'} nemala.`
        : '';
    const missing = d.missing
        ? `Za ${d.missing} ${plural(d.missing, ['deň', 'dni', 'dní'])} appka čísla nemá – vtedy ju nikto neotvoril.`
        : '';
    const carbon = d.kwh > 0 || d.payback !== null ? posterCarbonNote({ ...d.carbon, debtT: d.debtT }) : '';
    return [od, missing, carbon].filter(Boolean).join(' ');
}

/**
 * Riadok uhlíka v súhrne - jeden, aby sa súhrn s cenami a spusteniami zmestil do obrázka do story:
 * úspora CO2eq za obdobie a pod ňou koľko z uhlíka výroby panelov je splatené. Bez výroby za
 * obdobie len návratnosť, bez súčtu od spustenia len úspora.
 * @param {{ kwh: number, co2Kg: number, payback: number | null, debtT: number | null }} d
 */
function carbonRows(d) {
    const p = d.payback === null ? null : posterPayback(d.payback);
    const paid =
        p && (p.paid ? 'uhlík z výroby panelov už je splatený' : `od spustenia panely splatili ${p.pct} % uhlíka zo svojej výroby`);
    if (d.kwh > 0) return [{ t: `${posterCo2Value(d.co2Kg)} CO2eq menej`, s: paid || 'než zo siete SR, aj s uhlíkom z výroby panelov' }];
    if (!p || d.debtT === null) return [];
    return [
        {
            t: p.paid ? 'Uhlík z výroby panelov splatený' : `Od spustenia panely splatili ${p.pct} % uhlíka`,
            s: `z ~${fmt1(d.debtT)} t CO2eq, ktoré stála výroba panelov aj meniča`,
        },
    ];
}

/** Jeden mobil na koľko: „na 12 rokov“, „na 40 dní“ - pri nabíjaní raz denne. @param {number} phones */
function phonesSub(phones) {
    const years = Math.floor(phones / 365);
    if (years >= 1) return `jeden mobil nabíjaný každý deň na ${fmtSum(years, 0)} ${plural(years, ['rok', 'roky', 'rokov'])}`;
    const days = Math.max(1, Math.round(phones));
    return `jeden mobil nabíjaný každý deň na ${days} ${plural(days, ['deň', 'dni', 'dní'])}`;
}

/** Najlepší deň: v týždni meno dňa, v mesiaci a roku dátum. @param {{ date: string, today: boolean }} b @param {import('./config.js').SummaryPeriod} period */
function bestDay(b, period) {
    if (b.today) return 'dnes';
    if (period === 'tyzden') return dayNameLong(b.date).toLowerCase();
    const { day, month } = dateParts(b.date);
    return `${day}. ${month}.`;
}

/** Pevné texty karty a plagátu v danom tóne. @param {Voice} [voice] */
export function statistikaTexts(voice = 'drzy') {
    return polite(voice) ? STATISTIKA_TEXTS_SLUSNE : STATISTIKA_TEXTS;
}
