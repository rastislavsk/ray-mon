// Karta Dnes podľa časti dňa (smer C v docs/navrhy/dnes-tri-smery.html): ráno plán na dnes, cez deň
// odpočet okna na veľké veci, večer ako dopadol dnešok a zajtrajšok. Pod číslami pás kariet na
// posúvanie (docs/navrhy/dnes-upravy.html): Nabehlo, Kedy lepšie, Mraky a dážď a Najviac slnka.
// K tomu vysvetlenie odznaku triedy dňa. Veľké slovo a čo dá strecha za celý deň počíta
// shared/mozem.js, tu je len to, čo sa mení s časťou dňa. Čisté funkcie bez DOM, texty sú
// v messages-core.js.

import { HOUR_RANGE } from './chart-model.js';
import { PLAN_DNA } from './config.js';
import { forecastDayPlan } from './day-plan.js';
import { DEN_TRIEDY, denTriedaDna, denTriedaVeci, silnyDen } from './den-trieda.js';
import { weekDayName } from './format.js';
import {
    DEN_NAZVY,
    DEN_STUPNICA,
    denVysvetlenieText,
    DNES_TEXTS,
    dnesCountText,
    dnesGradeText,
    dnesLepsieText,
    dnesNabehloText,
    dnesOblohaText,
    dnesPlanText,
    dnesSlnkoText,
    dnesZajtraText,
    MOZEM_ITEM_TEXTS,
} from './messages-core.js';
import { mainWindow, sunWindows } from './mozem.js';
import { localDateKey, localMinutes, sunTimes } from './solar.js';
import { dnesCards, todayOf } from './teraz.js';

/** @typedef {import('./mozem.js').Window} Window */
/** @typedef {{ cls: import('./den-trieda.js').DenTrieda, faza: import('./den-trieda.js').DenFaza }} Den */
/** @typedef {ReturnType<typeof dnesZajtraText> & { cls: import('./den-trieda.js').DenTrieda }} Tomorrow */
/** @typedef {Omit<import('./teraz.js').TerazInput, 'previewMinutes'>} Input */
/** @typedef {'jasno' | 'oblacno' | 'zamracene'} Ton */
/**
 * Karta v páse pod číslami. `preslo` pri stĺpcoch: hodina je už za nami (kreslí sa stlmene).
 * @typedef {{ kind: 'nabehlo', title: string, value: string, text: string, pct: number | null }
 *   | { kind: 'lepsie', title: string, value: string, text: string }
 *   | { kind: 'obloha', title: string, text: string,
 *       hodiny: { hour: number, ton: Ton, zrazky: 'dazd' | 'sneh' | null }[] }
 *   | { kind: 'slnko', title: string, value: string, text: string,
 *       stlpce: { hour: number, pct: number, max: boolean, preslo: boolean }[] }} Karta
 */

/** Oblačnosť v %, od ktorej je hodina oblačná a zamračená. */
const OBLACNOST = { oblacno: 30, zamracene: 70 };

/**
 * Čo karta Dnes ukáže podľa časti dňa. `faza` je časť dňa veľkého slova (denSlovo: večer bez
 * nameraného ostáva ráno). `chip` trieda dneška slovami (večer prázdna - hovorí zajtrajšok),
 * `kick` riadok nad slovom, `count` odpočet okna (cez deň, kým okno prebieha alebo príde),
 * `grade` večer namerané za dnešok, `line` veta o okne či predpovedi, `karty` pás pod číslami
 * a `tomorrow` večer zajtrajšok. Bez slova o dni (`den` null - načítava sa, dáta nie sú) alebo bez
 * predpovede null.
 * @param {Input} input
 * @param {Den | null} den slovo o dni z mozemModel @param {Window | null} window dnešné okno so slnkom z mozemModel (`facts.window`)
 * @param {{ voice?: import('./messages.js').Voice, devices?: readonly string[] }} [opts] tón textov a spotrebiče doma
 */
export function dnesFaza(input, den, window, { voice = 'drzy', devices = PLAN_DNA.devices } = {}) {
    const cards = den && dnesCards({ ...input, previewMinutes: null }, voice);
    if (!den || !cards) return null;
    const lepsie = lepsieOf(input, den.cls, devices, cards.wait);
    const dna = dnaKarty(input, voice);
    const base = {
        faza: den.faza,
        chip: DEN_NAZVY[den.cls],
        kick: '',
        /** @type {ReturnType<typeof dnesCountText> | null} */ count: null,
        /** @type {{ label: string, value: string } | null} */ grade: null,
        line: '',
        /** @type {Karta[]} */ karty: [lepsie, ...dna],
        /** @type {Tomorrow | null} */ tomorrow: null,
    };
    if (den.faza === 'rano') return { ...base, kick: DNES_TEXTS.plan, line: dnesPlanText(window, voice) };
    if (den.faza === 'den') {
        const d = cezDen(input, window, cards.today);
        return { ...base, count: d.count, line: d.line, karty: d.nabehlo ? [d.nabehlo, lepsie, ...dna] : base.karty };
    }
    const t = cards.today;
    const grade = dnesGradeText(t.doneKwh, t.forecastKwh);
    const tomorrow = tomorrowOf(input, devices, voice);
    return {
        ...base,
        chip: '',
        kick: DNES_TEXTS.grade,
        grade: { label: DNES_TEXTS.gradeLabel, value: grade.value },
        line: grade.line,
        // Zajtrajšok nahradí kartu Kedy lepšie - povie to isté o najbližšom dni presnejšie. Deň je za
        // nami, jeho mraky a najsilnejšia hodina už nič neradia.
        karty: tomorrow ? [] : [lepsie],
        tomorrow,
    };
}

/**
 * Karty o dnešku z predpovede: Mraky a dážď a Najviac slnka, tie, ktoré je z čoho poskladať.
 * @param {Input} input @param {import('./messages.js').Voice} voice @returns {Karta[]}
 */
function dnaKarty(input, voice) {
    return [oblohaOf(input), slnkoOf(input, voice)].flatMap((k) => (k ? [k] : []));
}

/**
 * Cez deň: odpočet okna, kým prebieha alebo príde, inak veta o okne; a karta Nabehlo - koľko
 * z predpovede už nabehlo.
 * @param {Input} input @param {Window | null} window @param {ReturnType<typeof import('./teraz.js').todayCard>} t
 */
function cezDen(input, window, t) {
    const nowMin = localMinutes(input.now, input.site.timezone);
    const kind = !window ? null : window.from > nowMin ? 'wait' : window.to > nowMin ? 'go' : null;
    /** @type {Karta | null} */
    const nabehlo =
        t.forecastKwh === null ? null : { kind: 'nabehlo', ...dnesNabehloText({ ...t, forecastKwh: t.forecastKwh }), pct: t.pct };
    return {
        count: window && kind ? dnesCountText(kind, window, kind === 'go' ? window.to - nowMin : window.from - nowMin) : null,
        nabehlo,
        line: kind ? '' : t.window,
    };
}

/**
 * Karta Kedy lepšie: ešte dnes (`wait` z heroModel) a najbližší silný deň predpovede. Silný je
 * podľa triedy dňa (silnyDen) - tej istej, ktorú ukazuje veľké slovo, aby si karta neprotirečila.
 * @param {Input} input @param {import('./den-trieda.js').DenTrieda} cls trieda dneška
 * @param {readonly string[]} devices @param {string | null} wait @returns {Karta}
 */
function lepsieOf(input, cls, devices, wait) {
    const days = input.forecast ? input.forecast.days : [];
    const data = input.forecast ? { ...input, forecast: input.forecast } : null;
    const i = data ? days.findIndex((_, k) => k > 0 && silnyDen(denTriedaDna(data, k, devices))) : -1;
    const next = i > 0 ? { name: weekDayName(days[i].date, i), kwh: days[i].kwhTotal } : null;
    return { kind: 'lepsie', title: DNES_TEXTS.later, ...dnesLepsieText({ wait, todayStrong: !!todayOf(input) && silnyDen(cls), next }) };
}

/**
 * Hodiny dneška medzi východom a západom slnka (keď v ten deň nie sú, produkčné okno grafov) s predpoveďou
 * na ne, a či sú už za nami. Bez predpovede na dnešok prázdne.
 * @param {Input} input
 */
function denneHodiny(input) {
    if (!todayOf(input) || !input.forecast) return [];
    const { rise, set } = sunTimes(input.site, localDateKey(input.now, input.site.timezone));
    const from = rise === null ? HOUR_RANGE.min : Math.floor(rise / 60);
    const to = set === null ? HOUR_RANGE.max - 1 : Math.floor(set / 60);
    const nowMin = localMinutes(input.now, input.site.timezone);
    return input.forecast.hourlyToday
        .filter((h) => h.hour >= from && h.hour <= to)
        .map((h) => ({ ...h, preslo: (h.hour + 1) * 60 <= nowMin }));
}

/**
 * Karta Mraky a dážď: oblačnosť a zrážky po hodinách dňa a veta o nich. Bez oblačnosti v predpovedi null.
 * @param {Input} input @returns {Karta | null}
 */
function oblohaOf(input) {
    const hodiny = denneHodiny(input);
    if (!hodiny.length || hodiny.some((h) => h.cloud === null)) return null;
    const list = hodiny.map((h) => {
        const c = /** @type {number} */ (h.cloud);
        /** @type {Ton} */ const ton = c >= OBLACNOST.zamracene ? 'zamracene' : c >= OBLACNOST.oblacno ? 'oblacno' : 'jasno';
        return { hour: h.hour, ton, zrazky: h.precip ?? null };
    });
    return { kind: 'obloha', title: DNES_TEXTS.obloha, text: dnesOblohaText(list), hodiny: list };
}

/**
 * Karta Najviac slnka: najsilnejšia hodina dneška podľa predpovede a stĺpce hodín. Keď strecha celý
 * deň nedá nič, null.
 * @param {Input} input @param {import('./messages.js').Voice} voice @returns {Karta | null}
 */
function slnkoOf(input, voice) {
    const hodiny = denneHodiny(input);
    const top = hodiny.reduce((a, h) => (h.kw > a.kw ? h : a), { hour: -1, kw: 0 });
    if (top.hour < 0) return null;
    const stlpce = hodiny.map((h) => ({
        hour: h.hour,
        pct: Math.round((100 * h.kw) / top.kw),
        max: h.hour === top.hour,
        preslo: h.preslo,
    }));
    return { kind: 'slnko', title: DNES_TEXTS.slnko, ...dnesSlnkoText({ from: top.hour * 60, kw: top.kw }, voice), stlpce };
}

/**
 * Zajtrajšok z predpovede: trieda dňa, koľko dá strecha a hlavné okno na veľké veci. Keď predpoveď
 * nezačína dneškom alebo zajtrajšok nemá, null.
 * @param {Input} input @param {readonly string[]} devices @param {import('./messages.js').Voice} voice
 */
function tomorrowOf(input, devices, voice) {
    const next = todayOf(input) && input.forecast ? input.forecast.days[1] : null;
    if (!next || !input.forecast) return null;
    const data = { ...input, forecast: input.forecast };
    const cls = denTriedaDna(data, 1, devices);
    return { cls, ...dnesZajtraText({ cls, kwh: next.kwhTotal, window: mainWindow(sunWindows(forecastDayPlan(data, 1))) }, voice) };
}

/**
 * Vysvetlenie odznaku triedy dňa (docs/navrhy/dnes-upravy.html): štítok, nadpis, veta, ktoré veľké veci
 * sa zmestia na slnko, stupnica tried od najhoršej a ako appka deň ráta. `kedy` dnešok, alebo zajtrajšok
 * (večerný odznak); zajtrajšok bez predpovede, ktorá začína dneškom, null. Trieda je tá istá ako na
 * odznaku - ten istý výpočet (shared/den-trieda.js).
 * @param {import('./day-plan.js').PlanInput} input @param {'dnes' | 'zajtra'} kedy
 * @param {{ voice?: import('./messages.js').Voice, devices?: readonly string[] }} [opts]
 */
export function denVysvetlenie(input, kedy, { voice = 'drzy', devices = PLAN_DNA.devices } = {}) {
    if (kedy === 'zajtra' && !(todayOf(input) && input.forecast?.days[1])) return null;
    const { cls, veci } = denTriedaVeci(input, devices, kedy === 'dnes' ? null : 1);
    return {
        cls,
        chip: kedy === 'dnes' ? DEN_NAZVY[cls] : `zajtra ${DEN_NAZVY[cls]}`,
        ...denVysvetlenieText(cls, kedy, voice),
        veci: veci.map((v) => ({ ...v, name: MOZEM_ITEM_TEXTS[v.id]?.name ?? v.id })),
        stupnicaTitle: DNES_TEXTS.stupnica,
        stupnica: DEN_TRIEDY.map((c) => ({ cls: c, ...DEN_STUPNICA[c], on: c === cls })).reverse(),
    };
}

/** @typedef {NonNullable<ReturnType<typeof dnesFaza>>} DnesFaza */
/** @typedef {NonNullable<ReturnType<typeof denVysvetlenie>>} DenVysvetlenie */
