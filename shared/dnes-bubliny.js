// Bubliny polí dlaždíc karty Dnes (docs/navrhy/dnes-bubliny-poli.html, V3 + A): po ťuknutí na pole sa zdola otvorí
// panel s obrázkom toho, čo pole hovorí len číslom - okno na osi dňa, krivka dňa, prepočty, počasie a oblačnosť po
// hodinách, stĺpce hodín s kW a dni v kWh. Pole Dnes a Zajtra má vlastné vysvetlenie triedy dňa (denVysvetlenie).
// Čisté funkcie bez DOM; čísla berú z tých istých modelov ako dlaždice (mozemSkyModel, dnesFaza), aby si neprotirečili.

import { solarG } from './carbon.js';
import { CARBON, PREDPOVED_HODINY } from './config.js';
import { bestDayIndex } from './chart-model.js';
import { fmt1, fmtSum, weekDayName, weekDayShort } from './format.js';
import { akoKebyAko, DNES_BUBLINY, DNES_TEXTS, dnesBublinaTitle, hm } from './messages-core.js';
import { skyWeather } from './sky.js';
import { localDateKey, localMinutes, sunTimes } from './solar.js';
import { dnesCards, todayOf } from './teraz.js';

/** Polia, ktoré majú bublinu (Dnes a Zajtra majú vysvetlenie triedy dňa). */
export const BUBLINY = /** @type {const} */ (['velke', 'strecha', 'eq', 'predpoved', 'oblacnost', 'slnko', 'lepsie']);
/** @typedef {(typeof BUBLINY)[number]} Bublina */

/** @typedef {import('./dnes-faza.js').Karta} Karta */
/** @typedef {NonNullable<ReturnType<typeof import('./dnes-faza.js').dnesFaza>>} DnesFaza */
/** @typedef {import('./mozem-sky.js').MozemSkyModel} Sky */
/** @typedef {Omit<import('./teraz.js').TerazInput, 'previewMinutes'>} Input */

/**
 * Bublina poľa `kind`: `q` nadpis nad bublinou (meno poľa), `title` veta s hlavným číslom a podľa poľa dáta grafu.
 * Keď pole v páse nie je alebo nie je z čoho kresliť, null.
 * @param {Bublina} kind @param {Input} input @param {Sky} sky model karty Dnes @param {DnesFaza | null} d časť dňa
 */
export function dnesBublina(kind, input, sky, d) {
    if (!d || !input.forecast || !todayOf(input)) return null;
    const karta = d.karty.find((k) => k.kind === kind) ?? null;
    const pole = {
        velke: () => velke(input, sky, d),
        strecha: () => strecha(input, sky, d),
        eq: () => eq(sky),
        predpoved: () => (karta?.kind === 'predpoved' ? predpoved(input, karta, denPasu(d)) : null),
        oblacnost: () => oblacnost(input, denPasu(d)),
        slnko: () => (karta?.kind === 'slnko' ? slnko(input, karta) : null),
        lepsie: () => lepsie(input),
    };
    return pole[kind]();
}

/** Deň predpovede, o ktorom hovorí Predpoveď a Oblačnosť: večer so zajtrajškom zajtra. @param {DnesFaza} d @returns {0 | 1} */
const denPasu = (d) => (d.faza === 'vecer' && d.tomorrow ? 1 : 0);

/** Teraz v minútach miestneho dňa. @param {Input} input */
const teraz = (input) => localMinutes(input.now, input.site.timezone);

/**
 * Veľké veci: okno so slnkom na osi 0 – 24 h, deň od východu po západ, teraz a dnešné veľké veci s časom z Plánu dňa.
 * @param {Input} input @param {Sky} sky @param {DnesFaza} d
 */
function velke(input, sky, d) {
    if (d.faza === 'vecer') return null;
    const nowMin = teraz(input);
    const w = sky.window;
    const okno = w ? { od: w.from, do: w.to } : null;
    const stav = !w ? 'koniec' : w.from > nowMin ? 'wait' : w.to > nowMin ? 'go' : 'koniec';
    const { rise, set } = sunTimes(input.site, localDateKey(input.now, input.site.timezone));
    const veci = (sky.plan?.rows ?? [])
        .filter((r) => r.kind === 'sun' || r.kind === 'siet' || r.kind === 'cheap')
        .map((r) => ({ id: r.id, name: r.name, cas: hm(r.start), slnko: r.kind === 'sun' }));
    return {
        kind: /** @type {const} */ ('velke'),
        q: DNES_TEXTS.velke,
        title: dnesBublinaTitle({ kind: 'velke', okno, stav: /** @type {'go' | 'wait' | 'koniec'} */ (stav) }),
        okno,
        oknoText: okno ? `${hm(okno.od)} – ${hm(okno.do)}` : '',
        nowMin,
        den: { rise, set },
        veci,
        pozn: veci.length ? DNES_BUBLINY.planDna : DNES_BUBLINY.bezVeci,
    };
}

/**
 * Zo strechy: krivka dňa - predpoveď po hodinách a namerané do teraz. Cez deň nad grafom koľko nabehlo a koľko ešte
 * príde, večer namerané za deň a čo sľubovala predpoveď.
 * @param {Input} input @param {Sky} sky @param {DnesFaza} d
 */
function strecha(input, sky, d) {
    const cards = dnesCards({ ...input, previewMinutes: null });
    if (!sky.day || !cards) return null;
    const t = cards.today;
    const vecer = d.faza === 'vecer';
    const fc = t.forecastKwh ?? 0;
    const cisla = vecer
        ? [{ value: `~${fmtSum(Math.round(fc), 0)}`, label: DNES_BUBLINY.predpoved }]
        : [
              { value: fmt1(t.doneKwh), label: DNES_BUBLINY.nabehlo },
              { value: `~${fmtSum(Math.max(0, Math.round(fc - t.doneKwh)), 0)}`, label: DNES_BUBLINY.ePride },
          ];
    /** @type {{ hour: number, kw: number }[]} */
    const namerane = input.pv ? input.pv.realCurveToday : [];
    return {
        kind: /** @type {const} */ ('strecha'),
        q: DNES_TEXTS.zoStrechy,
        title: dnesBublinaTitle({ kind: 'strecha', vecer, kwh: vecer ? (d.grade ?? sky.day.value) : sky.day.value }),
        cisla,
        predpoved: input.forecast ? input.forecast.hourlyToday.map((h) => ({ hour: h.hour, kw: h.kw })) : [],
        namerane: namerane.map((p) => ({ hour: p.hour, kw: p.kw })),
        nowMin: vecer ? null : teraz(input),
    };
}

/** Ako keby: tie isté prirovnania ako pole, s menom a z čoho sa rátajú. @param {Sky} sky */
function eq(sky) {
    if (!sky.day) return null;
    const co2 = { gridG: CARBON.gridG, solarG: solarG(), zdroj: CARBON.gridSource };
    return {
        kind: /** @type {const} */ ('eq'),
        q: DNES_TEXTS.akoKeby,
        title: dnesBublinaTitle({ kind: 'eq', kwh: sky.day.value }),
        riadky: sky.day.eq.map((e) => ({ ...e, ako: akoKebyAko(e.ikona, co2) })),
    };
}

/**
 * Šesť hodín dňa rovnomerne od východu po západ slnka (v deň bez neho v hodinách PREDPOVED_HODINY) - ikona slnka v noci
 * by klamala. @param {Input} input @param {0 | 1} i
 */
function hodinyDna(input, i) {
    const day = /** @type {import('./solar.js').ForecastDay} */ (input.forecast?.days[i]);
    const { rise, set } = sunTimes(input.site, day.date);
    const od = rise === null ? PREDPOVED_HODINY.od : Math.ceil(rise / 60);
    const po = set === null ? PREDPOVED_HODINY.do - 1 : Math.floor(set / 60);
    const krok = Math.max(1, Math.round((po - od) / 5));
    const hodiny = [];
    for (let h = od; h <= po && hodiny.length < 6; h += krok) hodiny.push(h);
    return { day, hodiny };
}

/**
 * Predpoveď: počasie v šiestich hodinách dňa - ikona z oblačnosti, teplota a zrážky. Nadpis je popis a teploty poľa.
 * @param {Input} input @param {Extract<Karta, { kind: 'predpoved' }>} k @param {0 | 1} i
 */
function predpoved(input, k, i) {
    const { day, hodiny } = hodinyDna(input, i);
    const body = hodiny.flatMap((hour) => {
        const h = day.hourly.find((x) => x.hour === hour);
        if (!h) return [];
        return [
            {
                hour,
                cas: `${hour}:00`,
                weather: h.cloud === null ? null : skyWeather(h.cloud),
                temp: Number.isFinite(h.temp) ? `${Math.round(/** @type {number} */ (h.temp))}°` : null,
                zrazky: h.precip ? DNES_BUBLINY.zrazky[h.precip] : null,
            },
        ];
    });
    return {
        kind: /** @type {const} */ ('predpoved'),
        q: k.title,
        title: dnesBublinaTitle({ kind: 'predpoved', popis: k.popis, min: k.min, max: k.max }),
        hodiny: body,
        pozn: body.some((b) => b.zrazky) ? '' : DNES_BUBLINY.bezZrazok,
    };
}

/** Oblačnosť: stĺpec za každú hodinu od východu po západ slnka a kedy je oblakov najviac. @param {Input} input @param {0 | 1} i */
function oblacnost(input, i) {
    const day = input.forecast?.days[i];
    if (!day || day.cloudAvgPct === null) return null;
    const { rise, set } = sunTimes(input.site, day.date);
    const od = rise === null ? PREDPOVED_HODINY.od : Math.floor(rise / 60);
    const po = set === null ? PREDPOVED_HODINY.do - 1 : Math.floor(set / 60);
    const hodiny = day.hourly.flatMap((h) => (h.hour >= od && h.hour <= po && h.cloud !== null ? [{ hour: h.hour, pct: h.cloud }] : []));
    const max = hodiny.reduce((a, h) => (!a || h.pct > a.pct ? h : a), /** @type {{ hour: number, pct: number } | null} */ (null));
    return {
        kind: /** @type {const} */ ('oblacnost'),
        q: DNES_TEXTS.oblacnost,
        title: dnesBublinaTitle({ kind: 'oblacnost', priemer: day.cloudAvgPct, max }),
        hodiny,
        pozn: DNES_BUBLINY.oblacnost,
    };
}

/**
 * Najviac slnka: tie isté hodiny ako stĺpce poľa, s kW nad každou. @param {Input} input @param {Extract<Karta, { kind: 'slnko' }>} k
 */
function slnko(input, k) {
    const hourly = input.forecast ? input.forecast.hourlyToday : [];
    const stlpce = k.stlpce.map((s) => {
        const kw = hourly.find((h) => h.hour === s.hour)?.kw ?? 0;
        return { hour: s.hour, kw, text: fmt1(kw), max: s.max, preslo: s.preslo };
    });
    return {
        kind: /** @type {const} */ ('slnko'),
        q: k.title,
        title: dnesBublinaTitle({ kind: 'slnko', hodiny: k.value, kw: k.text }),
        stlpce,
        pozn: DNES_BUBLINY.slnko,
    };
}

/** Kedy lepšie: dni predpovede v kWh vedľa seba, najsilnejší v nadpise. @param {Input} input */
function lepsie(input) {
    const days = input.forecast ? input.forecast.days : [];
    if (!days.length) return null;
    const b = bestDayIndex(days);
    const meno = b === 0 ? 'dnešok' : b === 1 ? 'zajtrajšok' : weekDayName(days[b].date, b).toLowerCase();
    const kwh = (/** @type {number} */ x) => `~${fmtSum(Math.round(x), 0)} kWh`;
    return {
        kind: /** @type {const} */ ('lepsie'),
        q: DNES_TEXTS.later,
        title: dnesBublinaTitle({ kind: 'lepsie', den: meno, kwh: kwh(days[b].kwhTotal) }),
        dni: days.map((d, i) => ({
            name: weekDayShort(d.date, i),
            kwh: d.kwhTotal,
            text: fmtSum(Math.round(d.kwhTotal), 0),
            max: i === b,
        })),
        pozn: DNES_BUBLINY.dni,
    };
}

/** @typedef {NonNullable<ReturnType<typeof dnesBublina>>} DnesBublina */
