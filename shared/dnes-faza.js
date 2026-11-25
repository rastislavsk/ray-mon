// Karta Dnes podľa časti dňa (smer C v docs/navrhy/dnes-tri-smery.html): ráno plán na dnes, cez deň
// odpočet okna na veľké veci, večer ako dopadol dnešok a zajtrajšok. Pod číslami pás kariet na
// posúvanie (docs/navrhy/dnes-upravy.html, nové karty docs/navrhy/dnes-predpoved-graf.html): Predpoveď,
// Oblačnosť, Najviac slnka a Kedy lepšie, večer Predpoveď na zajtra. Dlaždica pásu nesie dvojicu kariet
// (docs/navrhy/dnes-nizsie-dlazdice.html, D; všetky na dve docs/navrhy/dnes-vsetky-dvojice.html, A).
// K tomu vysvetlenie odznaku triedy dňa. Veľké slovo a čo dá strecha za celý deň počíta
// shared/mozem.js, tu je len to, čo sa mení s časťou dňa. Čisté funkcie bez DOM, texty sú
// v messages-core.js.

import { HOUR_RANGE } from './chart-model.js';
import { PLAN_DNA, PREDPOVED_HODINY } from './config.js';
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
    CASTI_DNA,
    dnesNabehloText,
    dnesPlanText,
    dnesPopisText,
    dnesSlnkoText,
    dnesZajtraText,
    MOZEM_ITEM_TEXTS,
    stupne,
} from './messages-core.js';
import { mainWindow, sunWindows } from './mozem-jadro.js';
import { skyWeather } from './sky.js';
import { localDateKey, localMinutes, sunTimes } from './solar.js';
import { dnesCards, todayOf } from './teraz.js';

/** @typedef {import('./mozem-jadro.js').Window} Window */
/** @typedef {{ cls: import('./den-trieda.js').DenTrieda, faza: import('./den-trieda.js').DenFaza }} Den */
/** @typedef {ReturnType<typeof dnesZajtraText> & { cls: import('./den-trieda.js').DenTrieda }} Tomorrow */
/** @typedef {Omit<import('./teraz.js').TerazInput, 'previewMinutes'>} Input */
/**
 * Karta v páse pod číslami. `preslo` pri stĺpcoch: hodina je už za nami (kreslí sa stlmene).
 * Predpoveď: `weather` oblačnosť dňa (ikona), `min` a `max` teplota („3°“). Oblačnosť: priemerná oblačnosť
 * dňa v % (`pct`). Ako keby: čo dá strecha za deň v mobiloch, km autom a CO2 (`ikona` kreslí render). Zo strechy:
 * cez deň `pct` koľko z predpovede už nabehlo (pásik), inak null.
 * @typedef {{ kind: 'lepsie', title: string, value: string, text: string }
 *   | { kind: 'predpoved', title: string, popis: string, weather: import('./sky.js').SkyWeather | null,
 *       min: string, max: string }
 *   | { kind: 'oblacnost', title: string, value: string, pct: number }
 *   | { kind: 'eq', title: string, eq: { ikona: string, value: string, label: string }[] }
 *   | { kind: 'slnko', title: string, value: string, text: string,
 *       stlpce: { hour: number, pct: number, max: boolean, preslo: boolean }[] }
 *   | { kind: 'dnes', title: string, chip: string, cls: import('./den-trieda.js').DenTrieda | null, word: string, text: string }
 *   | { kind: 'velke', title: string, value: string, text: string }
 *   | { kind: 'strecha', title: string, value: string, text: string, pct: number | null }
 *   | { kind: 'zajtra', title: string, chip: string, cls: import('./den-trieda.js').DenTrieda, word: string, text: string }} Karta
 */

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
    const predpoved = predpovedOf(input, 0);
    const oblacnost = oblacnostOf(input, 0);
    const slnko = slnkoOf(input);
    /** Karty pásu v poradí, len tie, ktoré je z čoho poskladať. @param {(Karta | null)[]} k */
    const pas = (k) => k.flatMap((x) => (x ? [x] : []));
    const base = {
        faza: den.faza,
        chip: DEN_NAZVY[den.cls],
        kick: '',
        /** @type {ReturnType<typeof dnesCountText> | null} */ count: null,
        /** @type {string | null} */ grade: null,
        /** @type {ReturnType<typeof cezDen>['nabehlo']} */ nabehlo: null,
        line: '',
        /** @type {Karta[]} */ karty: pas([predpoved, oblacnost, slnko, lepsie]),
        /** @type {Tomorrow | null} */ tomorrow: null,
    };
    // Ráno nadpis Dnes ako cez deň - „Plán na dnes“ sa s odznakom do polovice dlaždice nezmestí, plán povedia Veľké veci.
    if (den.faza === 'rano') return { ...base, line: dnesPlanText(window) };
    if (den.faza === 'den') {
        const d = cezDen(input, window, cards.today);
        return { ...base, count: d.count, line: d.line, nabehlo: d.nabehlo };
    }
    const t = cards.today;
    const grade = dnesGradeText(t.doneKwh, t.forecastKwh);
    const tomorrow = tomorrowOf(input, devices, voice);
    return {
        ...base,
        chip: '',
        kick: DNES_TEXTS.grade,
        grade: grade.value,
        line: grade.line,
        // Pod zajtrajškom predpoveď a oblačnosť na zajtra. Kedy lepšie povie zajtrajšok presnejšie; mraky
        // a najsilnejšia hodina dneška už nič neradia. Bez zajtrajška len Kedy lepšie.
        karty: tomorrow ? pas([predpovedOf(input, 1), oblacnostOf(input, 1)]) : [lepsie],
        tomorrow,
    };
}

/**
 * Cez deň: odpočet okna, kým prebieha alebo príde, inak veta o okne; a koľko z predpovede už nabehlo -
 * pásik a riadok karty Zo strechy (docs/navrhy/dnes-vsetky-dvojice.html, A).
 * @param {Input} input @param {Window | null} window @param {ReturnType<typeof import('./teraz.js').todayCard>} t
 */
function cezDen(input, window, t) {
    const nowMin = localMinutes(input.now, input.site.timezone);
    const kind = !window ? null : window.from > nowMin ? 'wait' : window.to > nowMin ? 'go' : null;
    const nabehlo = t.forecastKwh === null ? null : { text: dnesNabehloText(t), pct: t.pct };
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
 * Karta Predpoveď na deň `i` predpovede (0 dnes, 1 zajtra; docs/navrhy/dnes-predpoved-graf.html, B):
 * najnižšia a najvyššia teplota, priemerná oblačnosť a popis na dve-tri slová. Popis stojí na tom
 * istom, z čoho appka kreslí oblohu: slovo oblačnosti ako karta 7 dní (skyWeather) a zrážky
 * v hodinách PREDPOVED_HODINY - s časťou dňa, keď padajú len v jednej. Bez teploty alebo keď
 * predpoveď nezačína dneškom null.
 * @param {Input} input @param {0 | 1} i @returns {Karta | null}
 */
function predpovedOf(input, i) {
    const day = todayOf(input) && input.forecast ? input.forecast.days[i] : null;
    if (!day || day.tempMinC === null || day.tempMaxC === null) return null;
    const weather = day.cloudAvgPct === null ? null : skyWeather(day.cloudAvgPct);
    const mokre = day.hourly.filter((h) => h.precip && h.hour >= PREDPOVED_HODINY.od && h.hour < PREDPOVED_HODINY.do);
    const sneh = mokre.filter((h) => h.precip === 'sneh').length;
    const cast = (/** @type {number} */ hour) => CASTI_DNA.filter((c) => c.od <= hour).at(-1)?.slovo ?? '';
    const casti = new Set(mokre.map((h) => cast(h.hour)));
    const zrazky = mokre.length
        ? {
              druh: /** @type {'dazd' | 'sneh'} */ (sneh * 2 > mokre.length ? 'sneh' : 'dazd'),
              cast: casti.size === 1 ? [...casti][0] : null,
          }
        : null;
    return {
        kind: 'predpoved',
        title: i === 0 ? DNES_TEXTS.predpoved : DNES_TEXTS.predpovedZajtra,
        popis: dnesPopisText({ weather, zrazky }),
        weather,
        min: stupne(day.tempMinC),
        max: stupne(day.tempMaxC),
    };
}

/**
 * Karta Oblačnosť vedľa Predpovede (docs/navrhy/dnes-nizsie-dlazdice.html, D): priemerná oblačnosť dňa `i`
 * predpovede. Bez nej v dátach, alebo keď predpoveď nezačína dneškom, null.
 * @param {Input} input @param {0 | 1} i @returns {Karta | null}
 */
function oblacnostOf(input, i) {
    const pct = todayOf(input) && input.forecast ? (input.forecast.days[i]?.cloudAvgPct ?? null) : null;
    return pct === null ? null : { kind: 'oblacnost', title: DNES_TEXTS.oblacnost, value: `${pct} %`, pct };
}

/**
 * Karta Najviac slnka: najsilnejšia hodina dneška podľa predpovede a stĺpce hodín. Keď strecha celý
 * deň nedá nič, null.
 * @param {Input} input @returns {Karta | null}
 */
function slnkoOf(input) {
    const hodiny = denneHodiny(input);
    const top = hodiny.reduce((a, h) => (h.kw > a.kw ? h : a), { hour: -1, kw: 0 });
    if (top.hour < 0) return null;
    const stlpce = hodiny.map((h) => ({
        hour: h.hour,
        pct: Math.round((100 * h.kw) / top.kw),
        max: h.hour === top.hour,
        preslo: h.preslo,
    }));
    return { kind: 'slnko', title: DNES_TEXTS.slnko, ...dnesSlnkoText({ from: top.hour * 60, kw: top.kw }), stlpce };
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

/**
 * Celý pás karty Dnes (docs/navrhy/dnes-obloha-posuvnik.html, A): to, čo bolo nad pásom, sú jeho prvé dlaždice -
 * Dnes (odznak a veľké slovo; večer nadpis Ako dopadol dnešok), Veľké veci (ráno plán, cez deň odpočet okna alebo
 * veta o ňom), Zo strechy s Ako keby (večer namerané a čo sľubovala predpoveď) a večer Zajtra. Za nimi karty časti
 * dňa (`d.karty`). Bez časti dňa (načítava sa, dáta nie sú) len Dnes so slovom a vetou, prečo dáta nie sú.
 * Vracia dlaždice - každá je jedna karta alebo dvojica (dvojice).
 * @param {{ word: string, lead: string, day: { label: string, value: string, eq: { ikona: string, value: string, label: string }[] } | null,
 *   den: Den | null }} sky veľké slovo, veta a čo dá strecha za celý deň (shared/mozem-sky.js)
 * @param {DnesFaza | null} d časť dňa (dnesFaza) @returns {Karta[][]}
 */
export function dnesKarty(sky, d) {
    /** @type {Karta} */
    const dnes = {
        kind: 'dnes',
        title: d?.kick || DNES_TEXTS.dnes,
        chip: d?.chip ?? '',
        cls: sky.den ? sky.den.cls : null,
        word: sky.word,
        text: sky.day ? '' : sky.lead,
    };
    if (!d) return sky.word ? [[dnes]] : [];
    const vecer = d.faza === 'vecer';
    return dvojice(
        [dnes, vecer ? null : velkeOf(d), ...strechaOf(sky.day, d), zajtraOf(d.tomorrow), ...d.karty].flatMap((k) => (k ? [k] : [])),
    );
}

/**
 * Ktoré karty idú na jednu dlaždicu (docs/navrhy/dnes-vsetky-dvojice.html, A): prvá kľúčom, druhá prvou z hodnoty,
 * ktorá v páse je. Dnes ráno a cez deň s Veľkými vecami, večer so Zajtra, bez zajtrajška s Kedy lepšie.
 * @type {Partial<Record<Karta['kind'], Karta['kind'][]>>}
 */
const DVOJICE = { dnes: ['velke', 'zajtra', 'lepsie'], strecha: ['eq'], predpoved: ['oblacnost'], slnko: ['lepsie'] };

/**
 * Karty v poradí pásu poskladané do dlaždíc: prvá z dvojice si k sebe vezme druhú, nech je v páse kdekoľvek;
 * keď druhá nie je (bez dát len Dnes, strecha celý deň nedá nič), ostane na dlaždici sama.
 * @param {Karta[]} karty @returns {Karta[][]}
 */
function dvojice(karty) {
    /** @type {Set<Karta>} */
    const vzate = new Set();
    return karty.flatMap((k) => {
        if (vzate.has(k)) return [];
        const druha = (DVOJICE[k.kind] ?? []).map((kind) => karty.find((x) => x.kind === kind && !vzate.has(x))).find(Boolean);
        if (druha) vzate.add(druha);
        return [druha ? [k, druha] : [k]];
    });
}

/**
 * Karty Zo strechy a Ako keby: čo dá strecha za celý deň (cez deň s tým, koľko už nabehlo; večer namerané a čo
 * sľubovala predpoveď) a to isté v mobiloch, km autom a CO2.
 * @param {{ label: string, value: string, eq: { ikona: string, value: string, label: string }[] } | null} day @param {DnesFaza} d
 * @returns {Karta[]}
 */
function strechaOf(day, d) {
    if (!day) return [];
    return [
        {
            kind: 'strecha',
            title: day.label,
            value: d.grade ?? day.value,
            text: d.faza === 'vecer' ? d.line : (d.nabehlo?.text ?? DNES_TEXTS.celyDen),
            pct: d.nabehlo?.pct ?? null,
        },
        { kind: 'eq', title: DNES_TEXTS.akoKeby, eq: day.eq },
    ];
}

/**
 * Dlaždica Veľké veci (ráno a cez deň): odpočet okna, kým prebieha alebo príde, inak veta o okne či pláne.
 * @param {DnesFaza} d @returns {Karta | null}
 */
function velkeOf(d) {
    if (d.count) return { kind: 'velke', title: DNES_TEXTS.velke, value: d.count.value, text: d.count.text };
    return d.line ? { kind: 'velke', title: DNES_TEXTS.velke, value: '', text: d.line } : null;
}

/** Dlaždica Zajtra (večer): trieda, veľké slovo a veta zajtrajška. @param {Tomorrow | null} t @returns {Karta | null} */
function zajtraOf(t) {
    return t ? { kind: 'zajtra', title: t.kick, chip: t.chip, cls: t.cls, word: t.word, text: t.text } : null;
}

/** @typedef {NonNullable<ReturnType<typeof dnesFaza>>} DnesFaza */
/** @typedef {NonNullable<ReturnType<typeof denVysvetlenie>>} DenVysvetlenie */
