// Karta Teraz. Výkon, pásmo a odporúčanie sú z heroModel, plán dňa z dayPlan, odpoveď teraz a Plán dňa
// z mozemModel - tie isté ako na karte Dnes. Tu sa to len skladá - číslo, štítky s vetou a čo zapnúť.
// Graf dňa s pásom plánu a zvoleným časom (`previewMinutes`, grafModel) je v paneli karty Dnes
// (docs/navrhy/dnes-predpoved-graf.html), dnešok a kedy lepšie (dnesCards) berie karta Dnes
// (shared/dnes-faza.js). Čisté funkcie,
// čas aj dáta prichádzajú v parametroch. Texty sú v shared/messages.js.

import { interpolate, realCurveBoundary } from './chart-model.js';
import { installedKw, PLAN_DNA, powerThresholds, TARIFF_LIMITS } from './config.js';
import { dayChartModel, slotTone } from './day-chart.js';
import { dayPlan } from './day-plan.js';
import { heroModel } from './hero-model.js';
import {
    TERAZ_BEZ_SLNKA,
    terazCitanieText,
    terazChartText,
    terazDalsiText,
    terazDlazdicaText,
    terazJasText,
    terazNoteText,
    terazOkoText,
    terazPasOkoText,
    terazPotomText,
    terazPreviewTime,
    terazRiadokText,
    terazSkupinaText,
    terazTodayText,
    terazTypicalText,
    terazVecText,
    terazWindowText,
    voiceTexts,
} from './messages-core.js';
import { dayCtx, planWindows, sunWindows } from './mozem-jadro.js';
import { mozemModel } from './mozem.js';
import { offlineLead, pvStatus } from './mozem-sky.js';
import { pocasie } from './pocasie.js';
import { pristupModel } from './pristup.js';
import { daylightSpan, localDateKey, localMinutes, localToUtc } from './solar.js';
import { dalsieSlnko, denInyModel, dniTyzdna, hrebenModel, nudzaRiadok, nudzoveCasy } from './tyzden.js';

/**
 * @typedef {import('./day-plan.js').PlanInput & { zdroj: unknown, loading: boolean,
 *   known: import('./settings.js').Known, previewMinutes: number | null,
 *   pristup?: import('./pristup.js').Odmietnutie | null }} TerazInput
 * @typedef {import('./day-chart.js').Tone} Tone
 */

/**
 * Model karty Teraz. `kind`: `ask` (appka nepozná polohu), `loading` (prvé načítanie),
 * `offline` (bez predpovede), `ok`. Pri známej polohe bez panelov (`known: 'poloha'`) karta
 * počíta s typickou strechou, ktorú má vo vstupe (typicalSettings), a priznáva to (`estimate`).
 * @param {TerazInput} input
 * Pod číslom je hrebeň týždňa (`hreben`) a plán zvoleného dňa: dnes čo zapnúť teraz a neskôr, iný
 * deň (`den`, poradie od dneška) jeho plán s hlavičkou (docs/navrhy/teraz-vyhlad-alternativy.html, C).
 * @param {{ online?: boolean, voice?: import('./messages.js').Voice, devices?: readonly string[], den?: number }} [opts]
 *   či má telefón internet (veta bez dát), tón hlášok, spotrebiče doma (s nimi ráta Plán dňa) a zvolený deň
 */
export function terazModel(input, { online = true, voice = 'drzy', devices, den = 0 } = {}) {
    const TERAZ_TEXTS = voiceTexts(voice).TERAZ_TEXTS;
    const estimate = input.known === 'poloha';
    if (input.known === 'nic') return { ...empty('ask', estimate), ask: true };
    if (!input.forecast) {
        if (input.loading) return { ...empty('loading', estimate), sub: TERAZ_TEXTS.loading };
        return { ...empty('offline', estimate), num: '–', sub: offlineLead(input, online, voice), retry: true };
    }
    // Meranie, ktoré mlčí, heroModel za výkon „teraz“ nepovažuje (freshPowerKw) - číslo je vtedy
    // odhad z krivky dňa a riadok pod ním povie, odkedy meranie mlčí. Karta Teraz je vždy teraz -
    // zvolený čas je len v grafe dňa (grafModel).
    const now = heroModel({ ...input, previewMinutes: null }, voice);
    const plan = dayPlan(input);
    const note = estimate ? null : noteOf(input, now, voice);
    const m = mozemModel(input, { voice, devices });
    const rows = m.plan ? m.plan.rows : [];
    const os = denOs(daylightSpan(input.site, localDateKey(input.now, input.site.timezone)), localMinutes(input.now, input.site.timezone));
    const teraz = {
        nowMin: now.minutes,
        level: plan[Math.floor(now.minutes / STEP)].level,
        slnkoDnes: sunWindows(plan).length > 0,
        dni: dniOf(input),
    };
    return {
        ...empty('ok', estimate),
        ...headOf(input, now, { estimate, voice }),
        note,
        guess: estimate,
        // Štítky už nie sú na karte - ich vysvetlenie je za „i“ riadku nad dlaždicami.
        chips: m.chips,
        ...(m.plan ? tyzdenOf(input, rows, teraz, { span: os.span, devices: devices ?? PLAN_DNA.devices, den, voice }) : {}),
        os,
        pocasie: pocasieOf(input, now),
        jas: jasOf(input, now),
    };
}

/**
 * Hrebeň týždňa a plán zvoleného dňa: dnes čo zapnúť, iný deň (`den`, poradie od dneška) jeho plán
 * s hlavičkou; detaily spotrebičov patria zvolenému dňu. Deň mimo predpovede je dnešok.
 * @param {TerazInput} input @param {RiadokPlanu[]} rows @param {Parameters<typeof coZapnutModel>[1]} teraz
 * @param {{ span: { from: number, to: number }, devices: readonly string[], den: number, voice: import('./messages.js').Voice }} o
 */
function tyzdenOf(input, rows, teraz, { span, devices, den, voice }) {
    const dni = dniTyzdna(input, devices);
    const hreben = hrebenModel(dni);
    const zvoleny = hreben && dni[den] ? den : 0;
    const dnes = dnesOf(input, rows, { ...teraz, tyzden: dni }, span, voice);
    const iny = hreben && zvoleny > 0 ? denInyModel(dni[zvoleny], devices, hreben.dni[zvoleny].nad, voice) : null;
    return {
        co: { ...dnes.co, den: iny ? iny.hlavicka : null, skupiny: iny ? iny.skupiny : dnes.co.skupiny },
        veci: iny ? iny.veci : dnes.veci,
        hreben: hreben && { ...hreben, zvoleny },
    };
}

/**
 * Graf dňa v paneli karty Dnes (docs/navrhy/dnes-predpoved-graf.html, predtým karta Deň na karte Teraz):
 * krivka dňa ako posúvač času (`chart`), odčítanie zvoleného času (`den`: výkon, odkiaľ je, čas) a obloha
 * v tej chvíli (`pocasie`). `previewMinutes` je zvolený čas, null teraz. Bez polohy a bez predpovede null.
 * @param {TerazInput} input
 * @param {{ voice?: import('./messages.js').Voice, devices?: readonly string[] }} [opts] tón hlášok a spotrebiče doma
 */
export function grafModel(input, { voice = 'drzy', devices } = {}) {
    if (input.known === 'nic' || !input.forecast) return null;
    const hero = heroModel(input, voice);
    const now = input.previewMinutes === null ? hero : heroModel({ ...input, previewMinutes: null }, voice);
    const m = mozemModel(input, { voice, devices });
    return {
        chart: chartOf(input, dayPlan(input), hero, now),
        den: denModel(input, m.plan ? m.plan.rows : [], input.previewMinutes, voice),
        pocasie: pocasieOf(input, hero),
    };
}

/**
 * Dnešok: čo zapnúť a detaily spotrebičov. Čo sa dnes na slnko nezmestí (Plán dňa to dá na iný deň
 * alebo nikam), dostane núdzový čas - kedy to dnes stojí najmenej zo siete - a čo dnes zo slnka ide,
 * odznak, kedy bude slnko na ten spotrebič najbližšie, keď to nie je zajtra (shared/tyzden.js).
 * @param {TerazInput} input @param {RiadokPlanu[]} rows
 * @param {Parameters<typeof coZapnutModel>[1] & { tyzden: ReturnType<typeof dniTyzdna> }} teraz
 * @param {{ from: number, to: number }} span os dňa @param {import('./messages.js').Voice} voice
 */
function dnesOf(input, rows, teraz, span, voice) {
    const slnko = /** @type {Extract<RiadokPlanu, { kind: 'sun' }>[]} */ (rows.filter((r) => r.kind === 'sun'));
    const cakaju = rows.filter((r) => r.kind === 'later' || r.kind === 'none');
    const nudza = nudzoveCasy(
        dayCtx(input),
        slnko,
        cakaju.map((r) => r.id),
    ).map((n) => {
        const r = /** @type {RiadokPlanu} */ (cakaju.find((x) => x.id === n.id));
        return nudzaRiadok(n, { name: r.name, span, den: '', potom: r.kind === 'later' ? r.day.name : null }, voice);
    });
    /** @type {Record<string, ReturnType<typeof terazPotomText>>} */ const potom = {};
    for (const r of teraz.tyzden.length > 1 ? slnko : []) {
        const dalsi = dalsieSlnko(teraz.tyzden, r.id);
        if (dalsi?.index !== 1) potom[r.id] = terazPotomText(dalsi);
    }
    return {
        co: coZapnutModel(rows, { ...teraz, nudza: nudza.map((n) => n.riadok), potom }, voice),
        veci: [...rows.filter((r) => dnesny(r)).map((r) => vecDetail(r, teraz.nowMin, span)), ...nudza.map((n) => n.detail)],
    };
}

/**
 * Pásik pod číslom: koľko z jasnej oblohy dáva strecha teraz, aby aj menej znalý videl, či je
 * číslo veľa alebo málo. Jasná obloha je bezoblačný strop predpovede dneška (`clearKw`), ten istý,
 * z ktorého počíta percento využitia karta 7 dní. Platí aj pre odhad z predpovede. V noci (slnko
 * pod obzorom alebo strop nula) pásik nie je - na nočnej oblohe rušil. Cez deň aj 0 % ostáva -
 * vtedy niečo nie je v poriadku. `text` je pre čítačku.
 * @param {TerazInput} input @param {ReturnType<typeof heroModel>} now
 */
function jasOf(input, now) {
    const today = todayOf(input);
    const clear = today && !now.isNight ? interpolate(today.hourly, now.minutes / 60, 'clearKw') : 0;
    if (!(clear > 0)) return null;
    if (!Number.isFinite(now.power)) return { pct: null, label: '', text: '' };
    const pct = Math.min(100, Math.round((100 * now.power) / clear));
    return { pct, label: `${pct} %`, text: terazJasText(pct) };
}

/**
 * Počasie karty Teraz v zvolenej chvíli (teraz, alebo pri náhľade iného času v ňom - dopredu
 * z predpovede, dozadu z merania) bez zvyšku modelu karty. Z neho je farba Oblohy na všetkých
 * kartách (docs/navrhy/obloha-farba-podla-pocasia.html), takže nebo a kresba počasia hovoria to
 * isté. Bez predpovede null.
 * @param {TerazInput} input
 */
export function pocasieTeraz(input) {
    if (input.known === 'nic' || !input.forecast) return null;
    return pocasieOf(input, heroModel(input));
}

/**
 * Počasie v pozadí karty v zvolenej chvíli (aj v náhľade iného času): hodina predpovede, a keď
 * je výkon v tej chvíli nameraný, aj jeho podiel z jasnej oblohy (shared/pocasie.js). Mesiac
 * a hviezdy sú z tej istej chvíle, nie z teraz.
 * @param {TerazInput} input @param {ReturnType<typeof heroModel>} hero
 */
function pocasieOf(input, hero) {
    const hour = Math.floor(hero.minutes / 60);
    const point = input.forecast?.hourlyToday.find((h) => h.hour === hour);
    // Zrážky z hodiny, ktorá sa končí po tejto chvíli (o 23:xx je to polnoc zajtrajška).
    const zrazkyPoint =
        hour < 23 ? input.forecast?.hourlyToday.find((h) => h.hour === hour + 1) : input.forecast?.hourlyTomorrow.find((h) => h.hour === 0);
    const today = todayOf(input);
    const merane =
        today && (hero.source === 'live' || hero.source === 'measured')
            ? { kw: hero.power, clearKw: interpolate(today.hourly, hero.minutes / 60, 'clearKw'), installedKw: installedKw(input.plant) }
            : null;
    // Minúta náhľadu je miestny čas elektrárne, hviezdy a mesiac potrebujú okamih v UTC.
    const tz = input.site.timezone;
    const chvila = hero.preview ? localToUtc(localDateKey(input.now, tz), hero.minutes, tz) : input.now;
    return pocasie({ point, zrazkyPoint, noc: hero.isNight, chvila, site: input.site, merane });
}

/**
 * Nadpis, číslo teraz a riadok pod ním (pri vlastnej streche prázdny). Pri typickej streche „~“
 * a veta, že to nie je vlastná strecha. Medzi číslom a vetou je riadok stavu merania (stavRiadok
 * v shared/hlavicka.js).
 * @param {TerazInput} input @param {ReturnType<typeof heroModel>} now
 * @param {{ estimate: boolean, voice: import('./messages.js').Voice }} o
 */
function headOf(input, now, { estimate, voice }) {
    const title = voiceTexts(voice).TERAZ_TEXTS.title;
    if (estimate) {
        const num = Number.isFinite(now.power) ? `~${now.powerText}` : now.powerText;
        return { title, num, sub: terazTypicalText(installedKw(input.plant), voice) };
    }
    return { title, num: now.powerText, sub: '' };
}

/**
 * Pás pod číslom, keď appka teraz nemá údaje z meniča a číslo je odhad z predpovede: bez merania
 * vedie k jeho pripojeniu, pri odmietnutom prístupe povie prečo a vedie k oprave
 * (shared/pristup.js), keď meranie mlčí, povie odkedy. Rozhoduje výkon teraz, nie náhľad - pás
 * počas ťahania po grafe ostáva, aby sa graf pod prstom nepohol. Inak null. `btn` je text
 * tlačidla, prázdny bez tlačidla; `znova`: tlačidlo vedie k opätovnému pripojeniu, nie k prvému.
 * @param {TerazInput} input @param {ReturnType<typeof heroModel>} now
 * @param {import('./messages.js').Voice} voice
 */
function noteOf(input, now, voice) {
    if (now.source !== 'forecast') return null;
    const T = voiceTexts(voice).TERAZ_TEXTS;
    if (!input.zdroj) return { title: T.noteTitle, text: T.noteText, btn: T.noteBtn, znova: false };
    const zdroj = /** @type {import('./zdroje.js').Zdroj} */ (input.zdroj);
    const p = pristupModel({ zdroj, pristup: input.pristup ?? null, now: input.now, timezone: input.site.timezone });
    const riadok = p && p.druh === 'neplati' ? p.riadok : '';
    const text = terazNoteText({ since: pvStatus(input).since, riadok }, voice);
    return { title: T.noteTitle, text, btn: riadok ? T.noteAgainBtn : '', znova: !!riadok };
}

/** Karta bez grafu a odporúčaní. @param {'ask' | 'loading' | 'offline' | 'ok'} kind @param {boolean} estimate */
function empty(kind, estimate) {
    return {
        kind,
        estimate,
        ask: false,
        title: voiceTexts().TERAZ_TEXTS.title,
        num: '',
        sub: '',
        note: /** @type {ReturnType<typeof noteOf>} */ (null),
        retry: false,
        guess: false,
        chips: /** @type {import('./mozem.js').Chip[]} */ ([]),
        co: /** @type {(ReturnType<typeof coZapnutModel> & { den: { nazov: string, pod: string } | null }) | null} */ (null),
        veci: /** @type {Array<VecDetail>} */ ([]),
        hreben: /** @type {(NonNullable<ReturnType<typeof hrebenModel>> & { zvoleny: number }) | null} */ (null),
        os: /** @type {ReturnType<typeof denOs> | null} */ (null),
        pocasie: /** @type {import('./pocasie.js').Pocasie | null} */ (null),
        jas: /** @type {{ pct: number | null, label: string, text: string } | null} */ (null),
    };
}

/**
 * Dátumy dní predpovede pre pás dní - len keď predpoveď začína dneškom, inak by poradie dňa nesedelo.
 * @param {import('./day-plan.js').PlanInput} input
 */
function dniOf(input) {
    return todayOf(input) && input.forecast ? input.forecast.days.map((d) => d.date) : [];
}

/** Dnešok v predpovedi, alebo null, keď predpoveď začína iným dňom (po polnoci pred obnovou). @param {import('./day-plan.js').PlanInput} input */
export function todayOf(input) {
    const day = input.forecast ? input.forecast.days[0] : null;
    return day && day.date === localDateKey(input.now, input.site.timezone) ? day : null;
}

/**
 * Graf dňa: geometria, popis pre čítačku a hodnota posúvača (čas, výkon, čo vtedy platí).
 * @param {TerazInput} input @param {import('./day-plan.js').PlanSlot[]} plan
 * @param {ReturnType<typeof heroModel>} hero zvolený čas (náhľad, inak teraz) @param {ReturnType<typeof heroModel>} now teraz
 */
function chartOf(input, plan, hero, now) {
    const tone = (/** @type {number} */ min) => slotTone(plan[Math.floor(min / plan[0].min)]);
    const curve = input.pv ? input.pv.realCurveToday : [];
    const limitKw = powerThresholds(input.plant).lowKw;
    const span = daylightSpan(input.site, localDateKey(input.now, input.site.timezone));
    const geo = dayChartModel({
        span,
        plan,
        hourly: input.forecast ? input.forecast.hourlyToday : [],
        real: curve,
        boundary: realCurveBoundary(curve, now.minutes),
        nowMin: now.minutes,
        nowKw: now.power,
        limitKw,
        limitText: voiceTexts().TERAZ_TEXTS.limit,
        preview: hero.preview ? { min: hero.minutes, kw: hero.power, text: terazPreviewTime(hero.minutes) } : null,
    });
    const windows = (/** @type {Tone} */ t) => planWindows(plan, (s) => slotTone(s) === t);
    return {
        ...geo,
        desc: terazChartText({
            span,
            nowMin: now.minutes,
            kwText: now.powerText,
            tone: tone(now.minutes),
            sun: windows('sun'),
            cheap: windows('cheap'),
            costly: windows('costly'),
        }),
        // Hodnota posúvača ostáva v jeho rozsahu aj v noci, keď je „teraz“ mimo osi; čas povie
        // odčítanie grafu dňa (aria-valuetext).
        value: Math.min(geo.range.max, Math.max(geo.range.min, hero.minutes)),
    };
}

/**
 * Dnešok (predpoveď, koľko už nabehlo, okno na veľké veci) a čas, keď bude ešte dnes lepšie
 * (waitTime z heroModel) - z toho skladá kartu Dnes shared/dnes-faza.js. Bez predpovede null.
 * @param {TerazInput} input @param {import('./messages.js').Voice} [voice]
 */
export function dnesCards(input, voice = 'drzy') {
    if (!input.forecast) return null;
    const now = heroModel({ ...input, previewMinutes: null }, voice);
    return { today: todayCard(input, dayPlan(input), now.minutes), wait: now.waitTime };
}

/**
 * Karta Dnešok: predpoveď dňa, koľko už nabehlo (z kiosku, bez neho podľa predpovede) a okno
 * na veľké veci - zelený úsek plánu, ten istý ako na páse a na karte Môžem? (prebieha, príde,
 * alebo posledný, ktorý už bol). Riadok o predpovedi a o tom, čo už nabehlo, ukazuje aj detail
 * dneška na karte 7 dní.
 * @param {import('./day-plan.js').PlanInput} input @param {import('./day-plan.js').PlanSlot[]} plan @param {number} nowMin
 */
export function todayCard(input, plan, nowMin) {
    const windows = planWindows(plan, (s) => s.tier === 'green');
    const ahead = windows.find((w) => w.to > nowMin) || null;
    const window = ahead || windows[windows.length - 1] || null;
    const day = todayOf(input);
    const kwh = input.pv ? input.pv.dailyEnergyKwh : null;
    const measured = kwh !== null && Number.isFinite(kwh);
    const done = measured ? /** @type {number} */ (kwh) : day ? soFar(day.hourly, nowMin) : 0;
    return {
        ...dayDone(day, done, measured),
        window: terazWindowText(window, !ahead && !!window),
    };
}

/**
 * Čo z predpovede dneška už nabehlo: čísla pre kartu Dnes cez deň (shared/dnes-faza.js) - predpoveď
 * dňa (null bez nej), nabehnuté a či je namerané -, riadok a percento pre pás. Bez predpovede na dnešok prázdne.
 * @param {import('./solar.js').ForecastDay | null} day @param {number} done @param {boolean} measured
 */
function dayDone(day, done, measured) {
    if (!day) return { forecastKwh: null, doneKwh: done, measured, line: '', pct: null };
    return {
        forecastKwh: day.kwhTotal,
        doneKwh: done,
        measured,
        line: terazTodayText({ forecastKwh: day.kwhTotal, doneKwh: done, measured }),
        pct: day.kwhTotal > 0 ? Math.min(100, Math.round((100 * done) / day.kwhTotal)) : null,
    };
}

/**
 * Koľko z predpovede dneška už nabehlo. Hodnota hodiny je výkon v jej celú hodinu, a tak
 * zastupuje polhodinu pred ňou aj po nej - súčet celého dňa je potom presne `kwhTotal`.
 * @param {Array<{ hour: number, kw: number }>} hourly @param {number} nowMin
 */
function soFar(hourly, nowMin) {
    return hourly.reduce((sum, p) => sum + p.kw * Math.max(0, Math.min(1, (nowMin - (p.hour * 60 - 30)) / 60)), 0);
}

/** @typedef {ReturnType<typeof terazModel>} TerazModel */
/**
 * Detail spotrebiča pre panel: `slot` je jeho úsek na osi dňa v % - zo slnka zelený, z lacnej siete
 * modrý, núdzový čas s kúskom slnka zlatý (`part`).
 * @typedef {{ id: string, name: string, tone: string, den: string, kedy: string, cas: string, why: string,
 *   slot: { left: number, width: number, tone: 'go' | 'cheap' | 'part', dnes: boolean } | null }} VecDetail
 */

// ---- Nová karta Teraz (docs/navrhy/teraz-navrh-2.html) ----------------------------------
// Čo zapnúť (dlaždice a skupiny z Plánu dňa) a detail spotrebiča. Graf dňa s odčítaním zvoleného času
// je v paneli karty Dnes (grafModel), číslo karty Teraz je vždy teraz.

/** @typedef {import('./plan-dna.js').PlanRow & { name: string, why: string }} RiadokPlanu */
/** @typedef {Extract<RiadokPlanu, { kind: 'sun' | 'cheap' }>} DnesnyRiadok */

const STEP = TARIFF_LIMITS.stepMin;

/** Riadok, ktorý ide dnes (na slnku alebo v lacnom pásme). @param {RiadokPlanu} r @returns {r is DnesnyRiadok} */
const dnesny = (r) => r.kind === 'sun' || r.kind === 'cheap';

/**
 * Riadok skupiny: veľký čas, meno, doplnok a pri núdzovom čase podiel slnka v % (pásik; inak null).
 * @typedef {{ id: string, name: string, kind: string, cas: string, info: string, podiel: number | null }} Riadok
 */
/** Odznak, kedy bude slnko na spotrebič najbližšie. @typedef {{ text: string, dlho: boolean }} Potom */

/**
 * Čo zapnúť dnes: hore dlaždice toho, čo ide teraz (zo slnka alebo z lacnej siete), a keď teraz nejde
 * nič, jedna dlaždica s najbližšou vecou a odpočtom; pod tým skupiny riadkov - zvyšok dneška a čo sa
 * dnes na slnko nezmestí, s núdzovým časom (`nudza`, počíta shared/tyzden.js). Riadky sú z Plánu dňa
 * (planDnaModel), nič sa nepočíta znova. Vec v lacnom pásme ide teraz, keď v tom pásme teraz sme.
 * Dlaždíc je jedna cez celú šírku, dve vedľa seba, viac po dvoch a nepárna posledná cez celú šírku
 * (`cela`). Čo ide zo slnka, nesie odznak, kedy bude slnko najbližšie (`potom`, podľa id veci).
 * Keď dnes zo slnka nejde nič a slnko príde až o viac dní, riadok hore to povie (`dlho`).
 * @param {RiadokPlanu[]} rows
 * @param {{ nowMin: number, level: string, slnkoDnes: boolean, dni?: string[], nudza?: Riadok[], potom?: Record<string, Potom> }} teraz
 *   minúta dňa, úroveň siete teraz, či dnes slnko na veľké veci stačí aspoň chvíľu a dátumy dní predpovede
 *   od dneška (bez nich riadok hore o viacerých dňoch nehovorí)
 * @param {import('./messages.js').Voice} [voice]
 */
export function coZapnutModel(rows, { nowMin, level, slnkoDnes, dni = [], nudza = [], potom = {} }, voice = 'drzy') {
    // Ten istý štart „teraz“ ako v Pláne dňa: najbližšia štvrťhodina.
    const now = Math.ceil(nowMin / STEP) * STEP;
    const ide = (/** @type {DnesnyRiadok} */ r) => r.start <= now && now < r.end;
    const dnesne = rows.filter(dnesny);
    const teraz = dnesne.filter(ide);
    const dnes = dnesne.filter((r) => !ide(r)).sort((a, b) => a.start - b.start);
    const slnko = dnesne.some((r) => r.kind === 'sun');
    const oko = slnko ? null : okoDlho(rows, dni);
    const hore = teraz.length
        ? horeTeraz(teraz, { level, slnkoDnes, potom }, voice)
        : horeDalsi(dnes.shift() ?? null, slnko, { nowMin, level, dalej: najskorsiInyDen(rows) }, voice);
    const riadok = (/** @type {DnesnyRiadok} */ r) => {
        const t = terazRiadokText(r);
        const p = r.kind === 'sun' ? potom[r.id] : null;
        return { id: r.id, name: r.name, kind: r.kind, cas: t.cas, info: p ? `${t.info} · ${p.text}` : t.info, podiel: null };
    };
    /** @type {Array<{ nazov: string, riadky: Riadok[] }>} */ const skupiny = [];
    if (dnes.length) skupiny.push({ nazov: terazSkupinaText({ druh: 'dnes', teraz: teraz.length > 0 }), riadky: dnes.map(riadok) });
    if (nudza.length) skupiny.push({ nazov: terazSkupinaText({ druh: 'nudza' }), riadky: nudza });
    return {
        // Riadok o viacerých dňoch povie, že dnes slnko nestačí - veta pod ním by to opakovala.
        hore: oko ? { ...hore, oko, bod: /** @type {const} */ ('cloud'), bezSlnka: '' } : hore,
        dlho: !!oko,
        skupiny,
    };
}

/**
 * Riadok hore, keď slnko príde až o viac dní: prvý deň, keď sa zo slnka zmestí aspoň jedna vec, nie je
 * dnes ani zajtra. Keď taký deň v predpovedi nie je a niečo tento týždeň nepôjde, platí pre celú
 * predpoveď (bez slnka). Inak null.
 * @param {RiadokPlanu[]} rows @param {string[]} dni dátumy dní predpovede od dneška
 */
function okoDlho(rows, dni) {
    const prvy = najskorsiInyDen(rows);
    if (prvy ? prvy.index < 2 : !rows.some((r) => r.kind === 'none')) return null;
    const koniec = prvy ? prvy.index : dni.length - 1;
    if (koniec < 1 || koniec >= dni.length) return null;
    return terazPasOkoText({ name: prvy?.name ?? null, oblacne: koniec - 1 });
}

/**
 * Najskoršia vec zo slnka v iný deň (deň a začiatok), null keď taká nie je.
 * @param {RiadokPlanu[]} rows
 */
function najskorsiInyDen(rows) {
    const later = rows.filter((r) => r.kind === 'later');
    later.sort((a, b) => a.day.index - b.day.index || a.day.start - b.day.start);
    return later[0]?.day ?? null;
}

/**
 * Dlaždice toho, čo ide teraz: zo slnka, alebo len z lacnej siete (vtedy aj veta, keď dnes slnko
 * nestačí vôbec). @param {DnesnyRiadok[]} teraz @param {{ level: string, slnkoDnes: boolean, potom: Record<string, Potom> }} o
 * @param {import('./messages.js').Voice} voice @returns {CoZapnutHore}
 */
function horeTeraz(teraz, { level, slnkoDnes, potom }, voice) {
    const druh = teraz.every((r) => r.kind === 'cheap') ? 'siet' : 'slnko';
    const n = teraz.length;
    return {
        druh,
        oko: terazOkoText({ druh, level }, voice),
        bod: druh === 'siet' ? 'cheap' : 'go',
        bezSlnka: druh === 'siet' && !slnkoDnes ? TERAZ_BEZ_SLNKA : '',
        dlazdice: teraz.map((r, i) => ({
            id: r.id,
            name: r.name,
            tone: r.kind === 'cheap' ? /** @type {const} */ ('cheap') : /** @type {const} */ ('go'),
            sub: terazDlazdicaText(r, voice),
            potom: r.kind === 'sun' ? (potom[r.id] ?? null) : null,
            cela: n === 1 || (n % 2 === 1 && i === n - 1),
        })),
        dalsi: null,
    };
}

/**
 * Keď teraz nejde nič: najbližšia vec dneška `p` (null, keď dnes už nič) a či dnes ešte niečo
 * pôjde na slnko (počkaj), alebo už len do lacného pásma.
 * @param {DnesnyRiadok | null} p @param {boolean} slnkoPride
 * @param {{ nowMin: number, level: string, dalej: { name: string, start: number } | null }} t `dalej` najskoršia vec iný deň
 * @param {import('./messages.js').Voice} voice @returns {CoZapnutHore}
 */
function horeDalsi(p, slnkoPride, { nowMin, level, dalej }, voice) {
    const druh = !p ? 'nic' : slnkoPride ? 'pockaj' : 'dnesNic';
    const dalsi = p
        ? { id: p.id, name: p.name, cas: terazRiadokText(p).cas, tone: p.kind === 'cheap' ? 'cheap' : 'go', sub: terazDalsiText(p, nowMin) }
        : null;
    return {
        druh,
        oko: terazOkoText({ druh, level, dalej }, voice),
        bod: level === 'lacna' ? 'cheap' : level === 'draha' ? 'costly' : 'plain',
        bezSlnka: '',
        dlazdice: [],
        dalsi: /** @type {CoZapnutHore['dalsi']} */ (dalsi),
    };
}

/**
 * Hore v Čo zapnúť: `druh` (zdroj prúdu teraz, alebo prečo nič), riadok nad dlaždicami, dlaždice
 * toho, čo ide teraz, alebo najbližšia vec.
 * `bod` je farba bodky pred riadkom: zdroj prúdu teraz, keď teraz nejde nič, cena siete.
 * @typedef {{ druh: 'slnko' | 'siet' | 'pockaj' | 'dnesNic' | 'nic', oko: { text: string, sub: string },
 *   bod: 'go' | 'cheap' | 'costly' | 'plain' | 'cloud', bezSlnka: string,
 *   dlazdice: Array<{ id: string, name: string, tone: 'go' | 'cheap', sub: string, potom: Potom | null, cela: boolean }>,
 *   dalsi: { id: string, name: string, cas: string, tone: 'go' | 'cheap', sub: string } | null }} CoZapnutHore
 */

/**
 * Graf dňa: odčítanie zvoleného času (`min`, null = teraz) - výkon a odkiaľ je, pre čítačku aj či
 * slnko stačí, sieť, oblačnosť a čo z Plánu dňa (`rows`) vtedy beží - a slnko na oblohe panelu. Výkon v inom čase je ten istý ako náhľad grafu (heroModel): dozadu meranie,
 * dopredu predpoveď.
 * @param {TerazInput} input @param {RiadokPlanu[]} rows @param {number | null} min
 * @param {import('./messages.js').Voice} [voice]
 */
export function denModel(input, rows, min, voice = 'drzy') {
    const tz = input.site.timezone;
    const nowMin = localMinutes(input.now, tz);
    const plan = dayPlan(input);
    const t = Math.max(0, Math.min(plan.length * STEP - 1, min ?? nowMin));
    return {
        citanie: citanieOf(input, plan, rows, { t, min }, voice),
        slnko: slnkoVKarte(daylightSpan(input.site, localDateKey(input.now, tz)), t),
        min: t,
        zvolene: min !== null,
    };
}

/**
 * Slnko na oblohe panelu s grafom dňa v minúte `t`: zľava (východ) doprava (západ) po oblúku, v % plochy panelu
 * (`x` zľava, `y` zhora). Len dekorácia, poloha z dĺžky dňa, nie presná výška slnka. Mimo dňa null.
 * @param {{ from: number, to: number }} span @param {number} t
 */
function slnkoVKarte(span, t) {
    if (t < span.from || t > span.to) return null;
    const f = (t - span.from) / (span.to - span.from);
    return { x: Math.round(6 + f * 88), y: Math.round(78 - Math.sin(Math.PI * f) * 70) };
}

/**
 * Odčítanie grafu dňa v minúte `t` (zvolený čas `min`, null = teraz). @param {TerazInput} input @param {import('./day-plan.js').PlanSlot[]} plan
 * @param {RiadokPlanu[]} rows @param {{ t: number, min: number | null }} cas @param {import('./messages.js').Voice} voice
 */
function citanieOf(input, plan, rows, { t, min }, voice) {
    const hero = heroModel({ ...input, previewMinutes: min }, voice);
    const slot = plan[Math.floor(t / STEP)];
    const slnko = slot.tier === 'green' ? 'go' : slot.night ? 'noc' : 'part';
    const pasmo = /** @type {{ from: number, to: number }} */ (
        planWindows(plan, (s) => s.level === slot.level).find((w) => w.from <= t && t < w.to)
    );
    const hour = input.forecast?.hourlyToday.find((p) => p.hour === Math.floor(t / 60));
    // Teraz je pre plán najbližšia štvrťhodina, ako v Pláne dňa a pri dlaždiciach - inak by vec, ktorá
    // ide teraz, bola tu „potom o …“.
    const { bezi, dalsi } = coBezi(rows, min === null ? Math.ceil(t / STEP) * STEP : t);
    return terazCitanieText({
        min: t,
        teraz: min === null,
        kw: hero.power,
        source: hero.source,
        slnko,
        limitKw: powerThresholds(input.plant).lowKw,
        level: slot.level,
        levelDo: pasmo.to,
        cloud: Number.isFinite(hour?.cloud) ? /** @type {number} */ (hour?.cloud) : null,
        bezi: bezi.map((r) => r.name),
        dalsi: dalsi ? { name: dalsi.name, start: dalsi.start } : null,
    });
}

/**
 * Čo z Plánu dňa beží v minúte `t`, a keď nič, čo príde najskôr (inak null).
 * @param {RiadokPlanu[]} rows @param {number} t
 */
function coBezi(rows, t) {
    const dnes = rows.filter(dnesny);
    const bezi = dnes.filter((r) => r.start <= t && t < r.end);
    const dalsi = bezi.length ? null : (dnes.filter((r) => r.start > t).sort((a, b) => a.start - b.start)[0] ?? null);
    return { bezi, dalsi };
}

/**
 * Detail spotrebiča (panel po ťuknutí na dlaždicu či riadok): kedy a odkiaľ, od-do, prečo práve
 * vtedy (to isté ako Plán dňa) a jeho úsek na osi dňa (`slot` v % osi: zo slnka zelený, z lacnej
 * siete modrý; `dnes` - len vtedy má os aj „teraz“). Pri inom dni `den` („Zajtra“, „Streda“) - čas
 * bez dňa by sa čítal ako dnešný. „Tento týždeň nie“ úsek nemá.
 * @param {RiadokPlanu} r @param {number} nowMin @param {{ from: number, to: number }} span os dňa
 * @returns {VecDetail}
 */
function vecDetail(r, nowMin, span) {
    const now = Math.ceil(nowMin / STEP) * STEP;
    const ide = dnesny(r) && r.start <= now && now < r.end;
    // Úsek celý mimo osi dňa (lacná sieť v noci) by sa prilepil na jej kraj - os vtedy nie je.
    const slot = r.kind === 'none' ? null : vecSlot(r, span);
    const tone = !ide ? '' : r.kind === 'cheap' ? 'cheap' : 'go';
    return { id: r.id, name: r.name, tone, den: r.kind === 'later' ? r.day.name : '', ...terazVecText(r, ide), slot };
}

/**
 * Úsek veci na osi dňa v %: zo slnka zelený, z lacnej siete modrý; `dnes` - len vtedy má os „teraz“.
 * Celý mimo osi null.
 * @param {Exclude<RiadokPlanu, { kind: 'none' }>} r @param {{ from: number, to: number }} span
 */
function vecSlot(r, span) {
    const od = r.kind === 'later' ? r.day.start : r.start;
    if (r.end <= span.from || od >= span.to) return null;
    return {
        left: spanPct(span, od),
        width: Math.round((spanPct(span, r.end) - spanPct(span, od)) * 10) / 10,
        tone: r.kind === 'cheap' ? /** @type {const} */ ('cheap') : /** @type {const} */ ('go'),
        dnes: r.kind !== 'later',
    };
}

/** Minúta dňa ako % osi `span`, mimo osi na jej kraji. @param {{ from: number, to: number }} span @param {number} m */
function spanPct(span, m) {
    return Math.round(((Math.max(span.from, Math.min(span.to, m)) - span.from) / (span.to - span.from)) * 1000) / 10;
}

/**
 * Os dnešného svetla pre detail spotrebiča: hodiny po troch a „teraz“ v % osi (mimo osi null).
 * Zajtrajšok a ďalšie dni idú na tú istú os - dĺžka dňa sa za týždeň zmení o pár minút.
 * @param {{ from: number, to: number }} span @param {number} nowMin
 */
function denOs(span, nowMin) {
    const pct = (/** @type {number} */ m) => spanPct(span, m);
    /** @type {Array<{ label: string, at: number }>} */ const ticks = [];
    for (let h = Math.ceil(span.from / 180) * 3; h * 60 <= span.to; h += 3) ticks.push({ label: String(h), at: pct(h * 60) });
    return { span, ticks, now: nowMin >= span.from && nowMin <= span.to ? pct(nowMin) : null };
}
