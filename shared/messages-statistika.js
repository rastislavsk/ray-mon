// Texty karty Štatistika a plagátu novej appky a súhrnu na zdieľanie. Nová appka ich sťahuje až
// s kartou Štatistika (obloha/web/parts.js); spoločný vstup do všetkých textov je messages.js.
// Čisté funkcie bez DOM.

import { dateParts, dayNameLong, dayNameShort, fmt1, fmtSum } from './format.js';
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
        'Dnešok teraz len odhadujem z predpovede. Naozaj vyrobené kWh za dnes, mesiac, rok aj celý čas posiela menič Huawei cez kiosk FusionSolar - zadaj odkaz naň v Nastavení.',
    measureBtn: 'Pripojiť meranie',
    measureOff:
        'Živé meranie teraz neodpovedá, dnešok len odhadujem z predpovede. Súčty za mesiac, rok aj celý čas sa ukážu, keď sa kiosk ozve.',
    setupSub: 'zatiaľ nemám čo počítať',
    setupTitle: 'Prázdna strecha, prázdna štatistika',
    setupText:
        'Bez panelov neviem, koľko si vyrobil za deň, mesiac ani rok. Zadaj ich a prípadne aj odkaz na kiosk pre naozaj namerané čísla.',
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
};

/** @type {typeof STATISTIKA_TEXTS} */
const STATISTIKA_TEXTS_SLUSNE = {
    ...STATISTIKA_TEXTS,
    note: 'Hodnota je to, čo by ste za túto elektrinu zaplatili zo siete podľa svojej tarify. Koľko z nej ste spotrebovali sami, appka nevie.',
    pricesTitle: 'Doplňte ceny v tarife',
    pricesText: 'Uvidíte, akú hodnotu má vyrobená elektrina v peniazoch.',
    measureTitle: 'Pripojte živé meranie',
    measureText:
        'Dnešok teraz len odhadujem z predpovede. Naozaj vyrobené kWh za dnes, mesiac, rok aj celý čas posiela menič Huawei cez kiosk FusionSolar - zadajte odkaz naň v Nastavení.',
    setupTitle: 'Štatistika potrebuje vaše panely',
    setupText:
        'Bez panelov neviem, koľko ste vyrobili za deň, mesiac ani rok. Zadajte ich a prípadne aj odkaz na kiosk pre naozaj namerané čísla.',
    laterTitle: 'Keď ich zadáte, uvidíte',
    askTitle: 'Kde máte strechu?',
    askText: 'Bez polohy neviem, kde je vaša strecha, ani koľko vyrobila. Zadajte ju v Nastavení a začnem počítať.',
    askBtn: 'Zadajte polohu',
    posterFoot: 'RAY-MON',
};

/**
 * Odkiaľ je veľké číslo zo živého merania: „vyrobené dnes do 13:00“, „vyrobené v októbri“.
 * @param {import('./stats.js').StatsPeriod} period
 * @param {{ time: string, month: string }} d `time` čas merania, `month` mesiac v lokáli („októbri“)
 */
export function statsHeroSub(period, { time, month }) {
    return `vyrobené ${{ dnes: `dnes do ${time}`, mesiac: `v ${month}`, rok: 'tento rok', spolu: 'od spustenia' }[period]}`;
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

/** Najlepší deň na plagáte nakrátko: „so 14.“, „dnes“. @param {{ date: string, today: boolean }} best */
export function posterBestDay(best) {
    if (best.today) return 'dnes';
    return `${dayNameShort(best.date).toLowerCase()} ${dateParts(best.date).day}.`;
}

// ---- Súhrn na zdieľanie ------------------------------------------------------------

/** Tvar podstatného mena podľa počtu: 1 rok, 2 roky, 5 rokov. @param {number} n @param {[string, string, string]} forms */
export function plural(n, [one, few, many]) {
    if (n === 1) return one;
    return n >= 2 && n <= 4 ? few : many;
}

/**
 * Trasy na porovnanie kilometrov, od najkratšej. Súhrn vyberie najdlhšiu, na ktorú to stačí.
 * Vzdialenosti sú po ceste z Bratislavy, zaokrúhlené.
 */
export const SUMMARY_TRIPS = [
    { km: 130, text: 'ako z Bratislavy do Trnavy a späť' },
    { km: 330, text: 'ako z Bratislavy do Prahy' },
    { km: 800, text: 'Bratislava – Košice a späť' },
    { km: 1800, text: 'až do Barcelony' },
    { km: 3600, text: 'do Barcelony a späť' },
    { km: 7200, text: 'dvakrát do Barcelony a späť' },
];

/**
 * Nadpis, riadky a poznámka súhrnu. Čísla prichádzajú hotové zo shared/summary.js.
 * @param {{ period: 'tyzden' | 'mesiac', month: string, kwh: number, phones: number, km: number,
 *   best: { date: string, kwh: number, today: boolean } | null, value: number | null, currency: string,
 *   launches: { all: number, sun: number }, missing: number }} d
 * @param {Voice} [voice]
 */
export function summaryTexts(d, voice = 'drzy') {
    const kick = d.period === 'tyzden' ? 'Posledných 7 dní na streche' : `${d.month.charAt(0).toUpperCase()}${d.month.slice(1)} na streche`;
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
    const note = d.missing
        ? `Za ${d.missing} ${plural(d.missing, ['deň', 'dni', 'dní'])} appka čísla nemá – vtedy ju nikto neotvoril.`
        : '';
    return { kick, rows, note };
}

/** Jeden mobil na koľko: „na 12 rokov“, „na 40 dní“ - pri nabíjaní raz denne. @param {number} phones */
function phonesSub(phones) {
    const years = Math.floor(phones / 365);
    if (years >= 1) return `jeden mobil nabíjaný každý deň na ${years} ${plural(years, ['rok', 'roky', 'rokov'])}`;
    const days = Math.max(1, Math.round(phones));
    return `jeden mobil nabíjaný každý deň na ${days} ${plural(days, ['deň', 'dni', 'dní'])}`;
}

/** Najlepší deň: v týždni meno dňa, v mesiaci dátum. @param {{ date: string, today: boolean }} b @param {'tyzden' | 'mesiac'} period */
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
