// Texty karty 7 dní novej appky a denné a týždenné hlášky (detail dňa a týždňa súčasnej appky).
// Nová appka ich sťahuje až s kartou 7 dní (obloha/web/parts.js); spoločný vstup do všetkých
// textov je messages.js. Čisté funkcie bez DOM.

import { fmt1, fmtSum, hourLabel, kwpRoughText, minutesToTimeStr, weekDateLabel, weekDayLabel } from './format.js';
import { endHm, MOZEM_SKY_TEXTS, polite, TERAZ_TEXTS } from './messages-core.js';

/** @typedef {import('./messages-core.js').Voice} Voice */

const hm = minutesToTimeStr;

/** Špička dňa a okno, v ktorom výroba drží aspoň 60 % špičky - z toho sa skladajú obe
 * správy o dni. @param {Array<{hour: number, kw: number}>} pts */
function peakWindow(pts) {
    const peak = pts.reduce((a, b) => (b.kw > a.kw ? b : a), pts[0] || { hour: 0, kw: 0 });
    const strongHours = pts.filter((p) => p.kw >= peak.kw * 0.6).map((p) => p.hour);
    return { peak, rangeStart: Math.min(...strongHours), rangeEnd: Math.max(...strongHours) + 1 };
}

/** Správa o slabom dni v detaile dňa. @param {Voice} voice */
const weakDayMessage = (voice) => ({
    title: 'Slabý deň',
    body: `Výroba bude celý deň nízka. Veľké spotrebiče si radšej ${polite(voice) ? 'naplánujte' : 'naplánuj'} na iný deň.`,
});

/**
 * Správa v detaile dňa. O ktorý deň ide, hovorí hlavička nad ňou, takže text sám deň
 * nepomenúva - inak by sa pre stredu musel prekladať do "v stredu" a pre štvrtok do
 * "vo štvrtok". Dnes a Zajtra majú vlastné znenie vo forecastDayMessage nižšie.
 * @param {Array<{hour: number, kw: number}>} pts @param {import('./config.js').PowerThresholds} th @param {Voice} [voice]
 * @returns {{ title: string, body: string }}
 */
export function dayDetailMessage(pts, th, voice = 'drzy') {
    const { peak, rangeStart, rangeEnd } = peakWindow(pts);
    if (peak.kw < th.weakPeakKw) return weakDayMessage(voice);
    const peakLabel = hourLabel(peak.hour);
    return {
        title: `Najsilnejšie slnko okolo ${peakLabel}`,
        body: `Špička ~${fmt1(peak.kw)} kW. Veľké spotrebiče majú najviac zmysel medzi ${rangeStart}:00 a ${rangeEnd}:00.`,
    };
}

/**
 * Správa pod grafom predpovede pre jeden deň.
 * @param {Array<{hour: number, kw: number}>} pts @param {boolean} isToday
 * @param {import('./config.js').PowerThresholds} th
 * @returns {{ title: string, body: string }}
 */
export function forecastDayMessage(pts, isToday, th) {
    const { peak, rangeStart, rangeEnd } = peakWindow(pts);

    if (peak.kw < th.weakPeakKw) {
        return isToday
            ? { title: 'Dnes bude slabo', body: 'Výroba bude celý deň nízka. Veľké spotrebiče si radšej naplánuj na iný deň.' }
            : { title: 'Zajtra bude slabšie', body: 'Predpoveď počíta s nízkou výrobou. Ak to nie je súrne, počkaj na slnečnejší deň.' };
    }

    const peakLabel = hourLabel(peak.hour);

    if (isToday) {
        return {
            title: `Najsilnejšie slnko okolo ${peakLabel}`,
            body: `Špička okolo ${peakLabel}. Veľké spotrebiče majú najviac zmysel medzi ${rangeStart}:00 a ${rangeEnd}:00.`,
        };
    }
    return {
        title: 'Zajtra bude slnečno',
        body: `Špička okolo ${peakLabel} (~${fmt1(peak.kw)} kW). Veľké spotrebiče má zmysel naplánovať medzi ${rangeStart}:00 a ${rangeEnd}:00.`,
    };
}

/**
 * Správa pod týždenným prehľadom: najsilnejší a najslabší deň.
 * @param {Array<{date: string, kwhTotal: number}>} days
 * @returns {{ title: string, body: string }}
 */
export function weekMessage(days) {
    let best = days[0];
    let worst = days[0];
    days.forEach((d) => {
        if (d.kwhTotal > best.kwhTotal) best = d;
        if (d.kwhTotal < worst.kwhTotal) worst = d;
    });
    const bestLabel = weekDayLabel(best.date, days.indexOf(best));
    let body = `${bestLabel} má vyjsť najlepšie (${fmt1(best.kwhTotal)} kWh).`;
    if (worst !== best) {
        body += ` Najslabšie bude ${weekDayLabel(worst.date, days.indexOf(worst)).toLowerCase()} (${fmt1(worst.kwhTotal)} kWh).`;
    }
    return { title: `Najsilnejší deň: ${bestLabel}`, body };
}

// ---- Karta 7 dní v novej appke -----------------------------------------------------
// Predpoveď, okno na veľké veci aj najlepší deň počíta to isté ako kartu 7 dní súčasnej appky
// (weekStatsModel, weekListModel, plán dňa); tu sú len texty nového vzhľadu (shared/sedem-dni.js).

/** Počasie dňa slovom - ikona v riadku je len ozdoba, význam nesie toto slovo. @type {Record<import('./sky.js').SkyWeather, string>} */
export const SKY_WORDS = { jasno: 'jasno', polojasno: 'polojasno', zamracene: 'zamračené' };

/** Pevné texty karty: nadpisy, popisky čísel, tlačidlá a výzvy. */
export const SEDEM_TEXTS = {
    question: 'Veľké pranie?',
    hint: 'Zelený pás ukazuje, odkedy dokedy slnko stačí na veľké spotrebiče. Ťukni na deň.',
    back: '7 dní',
    dayHint: 'Potiahni do strán na susedný deň.',
    weekTitle: 'Týždeň',
    weekHint: 'Potiahni doprava a vrátiš sa na 7 dní.',
    bars: 'Výroba po dňoch · kWh',
    heat: 'Hodina × deň',
    heatNote: 'Zelené políčko = v tú hodinu slnko stačí na veľké spotrebiče.',
    kwhDay: 'kWh za deň',
    kwPeak: 'kW špička',
    noWindow: 'bez okna',
    kwhSum: 'kWh spolu',
    kwhAvg: 'kWh na deň',
    best: 'najlepší deň',
    typical: 'typická strecha',
    lastKnown: 'posledná známa predpoveď',
    loading: TERAZ_TEXTS.loading,
    retry: MOZEM_SKY_TEXTS.retry,
    guessTitle: 'Najlepší deň sedí, kWh nie',
    guessBtn: 'Zadať moje panely',
    askTitle: 'Kde máš strechu?',
    askText: 'Bez polohy neviem, kedy u teba bude svietiť. Zadaj ju v Nastavení a poviem ti, ktorý deň je na veľké pranie.',
    askBtn: 'Zadaj polohu',
};

/** @type {typeof SEDEM_TEXTS} */
const SEDEM_TEXTS_SLUSNE = {
    ...SEDEM_TEXTS,
    hint: 'Zelený pás ukazuje, odkedy dokedy slnko stačí na veľké spotrebiče. Ťuknite na deň.',
    dayHint: 'Potiahnite do strán na susedný deň.',
    weekHint: 'Potiahnite doprava a vrátite sa na 7 dní.',
    guessTitle: 'Najlepší deň platí, kWh sú len odhad',
    guessBtn: 'Zadajte panely',
    askTitle: 'Kde máte strechu?',
    askText: 'Bez polohy neviem, kedy u vás bude svietiť. Zadajte ju v Nastavení a poviem vám, ktorý deň je na veľké pranie.',
    askBtn: 'Zadajte polohu',
};

/**
 * Nadpis karty: najlepší deň na veľké pranie (deň s najväčšou výrobou). Keď slnko na veľké
 * spotrebiče nestačí ani v jeden deň týždňa, nadpis to povie namiesto mena dňa.
 * @param {string | null} name „Dnes“, „Zajtra“, „Štvrtok“; null = okno nemá žiadny deň
 */
export function sedemTitle(name) {
    return `${SEDEM_TEXTS.question} ${name === null ? 'Tento týždeň slnko nestačí.' : `${name}.`}`;
}

/**
 * Tlačidlo so súčtom týždňa (otvára detail týždňa). Bez internetu ukazuje poslednú známu
 * predpoveď a povie to, pri typickej streche tiež.
 * @param {{ totalKwh: number, lastKnown: boolean, estimate: boolean }} d
 */
export function sedemSumText({ totalKwh, lastKnown, estimate }) {
    const notes = [lastKnown ? SEDEM_TEXTS.lastKnown : '', estimate ? SEDEM_TEXTS.typical : ''].filter(Boolean);
    return [`Spolu 7 dní asi ${fmtSum(Math.round(totalKwh), 0)} kWh`, ...notes].join(' · ');
}

/** Výzva pri typickej streche: deň platí, kWh nie. Výkon zhruba ako na karte Môžem?. @param {number} kwp @param {Voice} [voice] */
export function sedemGuessText(kwp, voice = 'drzy') {
    if (polite(voice))
        return `Ktorý deň je najlepší, viem z počasia. Koľko kWh, záleží od vašich panelov. Teraz ukazujem typickú strechu ${kwpRoughText(kwp)}.`;
    return `Ktorý deň je najlepší, viem z počasia. Koľko kWh, záleží od tvojich panelov. Teraz ukazujem typickú strechu ${kwpRoughText(kwp)}.`;
}

/** Okná dňa slovom: „10:15 až 14:30“, viac okien spojí „a“, bez okna „bez okna“. @param {Array<{ from: number, to: number }>} windows */
export function sedemWindowsText(windows) {
    if (!windows.length) return SEDEM_TEXTS.noWindow;
    return `okno ${windows.map((w) => `${hm(w.from)} až ${endHm(w.to)}`).join(' a ')}`;
}

/**
 * Celé znenie riadku dňa pre čítačku obrazovky: deň, počasie, kWh, okno - a či je to najlepší
 * deň a odhad pre typickú strechu.
 * @param {{ name: string, word: string | null, kwh: number, windows: Array<{ from: number, to: number }>, best: boolean, estimate: boolean }} d
 */
export function sedemRowText({ name, word, kwh, windows, best, estimate }) {
    const parts = [
        name,
        word,
        `${kwh} kWh`,
        sedemWindowsText(windows),
        best ? SEDEM_TEXTS.best : '',
        estimate ? 'odhad pre typickú strechu' : '',
    ];
    return parts.filter(Boolean).join(', ');
}

/** Tretie číslo detailu dňa: odkedy (veľké číslo) a dokedy (popisok) trvá hlavné okno. @param {{ from: number, to: number } | null} w */
export function sedemWindowTile(w) {
    return w ? { value: hm(w.from), label: `do ${endHm(w.to)}` } : { value: '–', label: SEDEM_TEXTS.noWindow };
}

/** Strop jasnej oblohy v detaile dňa: koľko by dala, a koľko z toho je predpoveď. @param {number} clearKwh @param {number | null} pct */
export function sedemClearText(clearKwh, pct) {
    if (!(clearKwh > 0) || pct === null) return '';
    return `Jasná obloha by dala ${fmt1(clearKwh)} kWh, predpoveď je ${pct} % z toho.`;
}

/**
 * Hláška v detaile dňa: tá istá ako v detaile dňa súčasnej appky (dayDetailMessage). Deň bez
 * okna je pre veľké spotrebiče slabý, aj keď špička prekročí hranicu slabého dňa - hláška
 * nesmie radiť, kedy ich pustiť, keď detail hovorí „bez okna“.
 * @param {Array<{hour: number, kw: number}>} pts @param {import('./config.js').PowerThresholds} th @param {boolean} hasWindow
 * @param {Voice} [voice]
 */
export function sedemDayMessage(pts, th, hasWindow, voice = 'drzy') {
    return hasWindow ? dayDetailMessage(pts, th, voice) : weakDayMessage(voice);
}

/** Rozsah dátumov týždňa: „5.9. – 11.9.“. @param {string} first @param {string} last */
export function sedemRangeText(first, last) {
    return `${weekDateLabel(first)} – ${weekDateLabel(last)}`;
}

/**
 * Popis stĺpcov týždňa pre čítačku: výroba každého dňa a najlepší deň.
 * @param {Array<{ name: string, kwh: number }>} days @param {string} bestName
 */
export function sedemBarsText(days, bestName) {
    return `Výroba po dňoch: ${days.map((d) => `${d.name} ${d.kwh} kWh`).join(', ')}. Najlepší deň: ${bestName.toLowerCase()}.`;
}

/**
 * Popis mapy hodina × deň pre čítačku: v ktorých hodinách slnko stačí na veľké spotrebiče.
 * @param {Array<{ name: string, hours: number[] }>} days zelené hodiny každého dňa
 */
export function sedemHeatText(days) {
    const day = (/** @type {{ name: string, hours: number[] }} */ d) =>
        d.hours.length ? `${d.name} od ${Math.min(...d.hours)} do ${Math.max(...d.hours) + 1} h` : `${d.name} vôbec`;
    return `Hodiny, keď slnko stačí na veľké spotrebiče: ${days.map(day).join(', ')}.`;
}

/** Pevné texty karty v danom tóne. @param {Voice} [voice] */
export function sedemTexts(voice = 'drzy') {
    return polite(voice) ? SEDEM_TEXTS_SLUSNE : SEDEM_TEXTS;
}
