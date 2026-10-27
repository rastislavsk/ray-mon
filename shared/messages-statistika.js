// Texty karty Štatistika v oboch appkách: plagát obdobia (nadpis, riadky, poznámka) a výzvy.
// Nová appka ich sťahuje až s kartou Štatistika (obloha/web/parts.js); spoločný vstup do všetkých
// textov je messages.js. Čisté funkcie bez DOM.

import { dateParts, fmt1, fmtSum } from './format.js';
import { DATE_RE } from './valid.js';
import { MOZEM_SKY_TEXTS, polite, posterCo2Value, TERAZ_TEXTS } from './messages-core.js';

/** @typedef {import('./messages-core.js').Voice} Voice */
/** @typedef {import('./stats.js').StatsPeriod} StatsPeriod */

/** Pevné texty karty: prepínač, výzvy a tlačidlá. */
export const STATISTIKA_TEXTS = {
    title: 'Štatistika',
    periods: { dnes: 'Dnes', mesiac: 'Mesiac', rok: 'Rok', spolu: 'Spolu' },
    periodsLabel: 'Obdobie',
    loading: TERAZ_TEXTS.loading,
    retry: MOZEM_SKY_TEXTS.retry,
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
        'Vyrobené dnes, za mesiac, rok aj od spustenia · koľko je to mobilov a kilometrov autom · najlepší deň · hodnota podľa tarify',
    askTitle: 'Kde máš strechu?',
    askText: 'Bez polohy neviem, kde tvoja strecha je, nieto koľko vyrobila. Zadaj ju v Nastavení a začnem počítať.',
    askBtn: 'Zadaj polohu',
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
};

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
 * Veta, keď je niektorý súčet len od prvého merania: „Fox ESS neposiela súčet za rok.
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

// ---- Uhlík ---------------------------------------------------------------------------

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
 * Poznámka pod plagátom: s akými faktormi a odkiaľ CO2eq počíta, aby sa číslo dalo overiť.
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

// ---- Plagát obdobia na karte Štatistika ----------------------------------------------

/** Tvar podstatného mena podľa počtu: 1 rok, 2 roky, 5 rokov. @param {number} n @param {[string, string, string]} forms */
export function plural(n, [one, few, many]) {
    if (n === 1) return one;
    return n >= 2 && n <= 4 ? few : many;
}

/**
 * Trasy na porovnanie kilometrov, od najkratšej. Plagát vyberie najdlhšiu, na ktorú to stačí.
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

/** Koľkokrát okolo Zeme, od dvoch: „dvakrát“, „päťkrát“, od desať „12-krát“. */
const TIMES = ['', 'raz', 'dvakrát', 'trikrát', 'štyrikrát', 'päťkrát', 'šesťkrát', 'sedemkrát', 'osemkrát', 'deväťkrát'];

/** Na čo stačia kilometre: najdlhšia trasa, od dvoch obvodov Zeme ich počet. @param {number} km */
function tripText(km) {
    const earth = Math.floor(km / SUMMARY_TRIPS[SUMMARY_TRIPS.length - 1].km);
    if (earth >= 2) return `${TIMES[earth] ?? `${earth}-krát`} okolo Zeme`;
    const trip = SUMMARY_TRIPS.filter((x) => x.km <= km).pop();
    return trip ? trip.text : 'na elektrinu, zo strechy';
}

/**
 * Nadpis plagátu: „Dnes na streche“, „September na streche“, „Rok 2026 na streche“, „Od spustenia na streche“.
 * @param {{ period: StatsPeriod, month: string, year: string }} d
 */
function summaryKick(d) {
    if (d.period === 'dnes') return 'Dnes na streche';
    if (d.period === 'spolu') return 'Od spustenia na streche';
    if (d.period === 'rok') return `Rok ${d.year} na streche`;
    return `${d.month.charAt(0).toUpperCase()}${d.month.slice(1)} na streche`;
}

/** Peniaze na plagáte: do 10 s centami („1,60 €“), inak celé („50 €“). @param {number} v @param {string} currency */
const money = (v, currency) => `${fmtSum(v, v < 10 ? 2 : 0)} ${currency}`;

/**
 * Pás pod veľkým číslom: dnešok voči predpovedi, celý čas voči uhlíku z výroby panelov.
 * @param {{ pct: number, forecastKwh: number } | { payback: number }} d
 * @returns {{ pct: number, left: string, right: string }}
 */
export function summaryMeter(d) {
    if ('payback' in d) {
        const p = posterPayback(d.payback);
        return { pct: p.pct, left: 'uhlík z výroby panelov', right: p.paid ? 'splatený' : `${p.pct} % splatené` };
    }
    return { pct: Math.max(0, Math.min(100, d.pct)), left: `z predpovede ${fmt1(d.forecastKwh)} kWh`, right: `${d.pct} %` };
}

/**
 * Čísla plagátu obdobia zo živého merania (shared/summary.js).
 * @typedef {{ period: StatsPeriod, month: string, year: string, kwh: number, phones: number, km: number,
 *   best: { date: string, kwh: number, today: boolean } | null, value: number | null, valuePerDay: number | null, currency: string,
 *   rest: { kwh: number, total: number } | null, missing: number, co2Kg: number, payback: number | null, debtT: number | null,
 *   carbon: CarbonFactors, od: string | null, znacka: string }} SummaryFacts
 */

/**
 * Nadpis, riadky a poznámka plagátu. Čísla prichádzajú hotové zo shared/summary.js. `kick` je
 * nadpis obdobia (aj v odkaze z karty Môžem?), `heading` nadpis plagátu - pri súčte, ktorý nesiaha
 * na začiatok obdobia, s „od 21. 10.“.
 * @param {SummaryFacts} d @param {Voice} [voice]
 */
export function summaryTexts(d, voice = 'drzy') {
    const kick = summaryKick(d);
    const heading = d.od ? `${kick} ${odText(d.od)}` : kick;
    /** @type {Array<{ t: string, s: string }>} */ const rows = [];
    if (d.kwh > 0) {
        rows.push({ t: `${fmtSum(Math.round(d.phones), 0)} nabití mobilu`, s: phonesSub(d.phones) });
        rows.push({ t: `${fmtSum(Math.round(d.km), 0)} km autom`, s: tripText(d.km) });
    }
    if (d.rest)
        rows.push({ t: `Do večera ešte ~${fmt1(d.rest.kwh)} kWh`, s: `podľa predpovede, spolu by bolo ~${fmt1(d.rest.total)} kWh` });
    if (d.best) rows.push({ t: `Najlepší deň: ${bestDay(d.best)}`, s: `${fmt1(d.best.kwh)} kWh za jediný deň` });
    if (d.value !== null && d.kwh > 0) {
        const perDay = d.valuePerDay === null ? '' : ` · v priemere ${money(d.valuePerDay, d.currency)} za deň`;
        rows.push({ t: `Hodnota ~${fmtSum(d.value, 0)} ${d.currency}`, s: `toľko by sme za to dali sieti${perDay}` });
    }
    rows.push(...carbonRows(d));
    return { kick, heading, rows, note: summaryNote(d, voice) };
}

/**
 * Plagát dneška bez merania: odhad z predpovede, vlnovka pred každým číslom.
 * @param {{ kwh: number, phones: number, km: number, value: number | null, currency: string }} d
 */
export function summaryEstimateTexts(d) {
    /** @type {Array<{ t: string, s: string }>} */ const rows = [];
    if (d.kwh > 0) {
        rows.push({ t: `~${fmtSum(Math.round(d.phones), 0)} nabití mobilu`, s: 'ak vyjde predpoveď' });
        rows.push({ t: `~${fmtSum(Math.round(d.km), 0)} km autom`, s: tripText(d.km) });
        if (d.value !== null) rows.push({ t: `Hodnota ~${money(d.value, d.currency)}`, s: 'toľko by sme za to dali sieti' });
    }
    return { kick: 'Dnes podľa predpovede', heading: 'Dnes podľa predpovede', rows };
}

/**
 * Poznámka pod plagátom: súčet od prvého merania, dni, ktoré v denníku chýbajú, čo je hodnota
 * a s akými faktormi sa počíta CO2eq.
 * @param {SummaryFacts} d @param {Voice} voice
 */
function summaryNote(d, voice) {
    const key = /** @type {const} */ ({ dnes: 'den', mesiac: 'mesiac', rok: 'rok', spolu: null })[d.period];
    const od = d.od && key ? suctyOdNote(d.znacka, { [key]: d.od }) : '';
    const missing = d.missing
        ? `Za ${d.missing} ${plural(d.missing, ['deň', 'dni', 'dní'])} appka čísla nemá – vtedy ju nikto neotvoril.`
        : '';
    const value = d.value !== null && d.kwh > 0 ? statistikaTexts(voice).note : '';
    const carbon = d.kwh > 0 || d.payback !== null ? posterCarbonNote({ ...d.carbon, debtT: d.debtT }) : '';
    return [od, missing, value, carbon].filter(Boolean).join(' ');
}

/**
 * Riadok uhlíka: úspora CO2eq za obdobie a pod ňou koľko z uhlíka výroby panelov je splatené.
 * Pri celom čase je splatený podiel v páse nad riadkami, pod úsporou je preto dlh panelov. Bez
 * výroby za obdobie len návratnosť, bez súčtu od spustenia len úspora.
 * @param {SummaryFacts} d
 */
function carbonRows(d) {
    const p = d.payback === null ? null : posterPayback(d.payback);
    const co2 = `${posterCo2Value(d.co2Kg)} CO2eq menej`;
    if (d.kwh > 0 && d.period === 'spolu')
        return [{ t: co2, s: d.debtT === null ? 'než zo siete SR' : `výroba panelov aj meniča stála ~${fmt1(d.debtT)} t CO2eq` }];
    const paid =
        p && (p.paid ? 'uhlík z výroby panelov už je splatený' : `od spustenia panely splatili ${p.pct} % uhlíka zo svojej výroby`);
    if (d.kwh > 0) return [{ t: co2, s: paid || 'než zo siete SR, aj s uhlíkom z výroby panelov' }];
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

/** Najlepší deň mesiaca či roka: dátum, dnešok slovom. @param {{ date: string, today: boolean }} b */
function bestDay(b) {
    if (b.today) return 'dnes';
    const { day, month } = dateParts(b.date);
    return `${day}. ${month}.`;
}

/** Pevné texty karty v danom tóne. @param {Voice} [voice] */
export function statistikaTexts(voice = 'drzy') {
    return polite(voice) ? STATISTIKA_TEXTS_SLUSNE : STATISTIKA_TEXTS;
}
