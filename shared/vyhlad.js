// Výhľad dní bez slnka vopred (docs/navrhy/vyhlad-dni-bez-slnka.html, A): ranné oznámenie a karta
// Teraz povedia vopred, že prídu dni bez slnka a treba využiť dnešok. Deň bez slnka je deň, keď sa
// zo slnka nezmestí ani jeden spotrebič z Čo máš doma - ten istý rozvrh, aký robí Plán dňa
// (shared/plan-dna.js). Upozorní sa o toľko dní vopred, koľko dní bez slnka ide za sebou, najviac
// VYHLAD.maxDni, a len keď dnes slnko je. Zmenu predpovede povie len ranné oznámenie, oproti tomu,
// čo povedalo naposledy (pamätá si to service worker). Čisté funkcie bez DOM.

import { VYHLAD } from './config.js';
import { forecastDayPlan } from './day-plan.js';
import { dayNameShort, weekDayName } from './format.js';
import { vyhladNoticeText, vyhladPasText } from './messages-core.js';
import { dayCtx } from './mozem.js';
import { chosen, najlepsiDen, planDna } from './plan-dna.js';
import { localDateKey } from './solar.js';

/** @typedef {import('./messages-core.js').BehBezSlnka} Beh */
/** Čo oznámenie povedalo naposledy: prvý deň bez slnka a koľko ich je. @typedef {{ date: string, pocet: number }} Vyhlad */
/**
 * Zmena oproti tomu, čo oznámenie povedalo naposledy: dni bez slnka zmizli, začínajú neskôr
 * alebo skôr, je ich viac alebo menej.
 * @typedef {'zmizli' | 'neskor' | 'skor' | 'dlhsie' | 'kratsie'} Zmena
 */

/**
 * Dnes a ďalšie dni predpovede: či dnes od teraz pôjde zo slnka aspoň jedna vec a ktoré ďalšie
 * dni majú slnko aspoň na jednu (každý deň sám za seba, s rozpočtom od polnoci). `index` je poradie
 * od dneška (1 = zajtra). Bez predpovede alebo bez spotrebičov nič.
 * @param {import('./day-plan.js').PlanInput} input @param {readonly string[]} devices
 */
export function dniVyhladu(input, devices) {
    const list = chosen(devices);
    const { forecast } = input;
    if (!forecast || !list.length) return { dnes: false, dni: [] };
    const ctx = dayCtx(input);
    return {
        dnes: planDna(ctx, input, devices).some((r) => r.kind === 'sun'),
        dni: ctx.later.map(({ day, index }, i) => {
            const dctx = {
                ...ctx,
                nowMin: 0,
                plan: forecastDayPlan({ ...input, forecast }, index),
                weakToday: day.peakKw < ctx.th.weakPeakKw,
            };
            return {
                name: weekDayName(day.date, i + 1),
                date: day.date,
                index: i + 1,
                slnko: najlepsiDen(dctx, input.tariff.currency, list).length > 0,
            };
        }),
    };
}

/**
 * Prvé dni bez slnka za sebou, alebo null. Dni, ktoré idú až za koniec predpovede, nepozná.
 * @param {ReturnType<typeof dniVyhladu>['dni']} dni @returns {Beh | null}
 */
export function prvyBeh(dni) {
    const i = dni.findIndex((d) => !d.slnko);
    if (i < 0) return null;
    let pocet = 0;
    while (i + pocet < dni.length && !dni[i + pocet].slnko) pocet++;
    const d = dni[i];
    return { name: d.name, date: d.date, index: d.index, pocet, pred: i > 0 ? dni[i - 1].name : null };
}

/**
 * Je čas upozorniť? Dnes slnko je a dni bez slnka sú o toľko dní vopred, koľko ich je, najviac VYHLAD.maxDni.
 * @param {boolean} dnes @param {Beh | null} b @returns {b is Beh}
 */
const vystraha = (dnes, b) => dnes && !!b && b.index <= Math.min(b.pocet, VYHLAD.maxDni);

/**
 * Zmena oproti tomu, čo oznámenie povedalo naposledy (`posledny`); keď ten deň už je dnes alebo
 * minul, porovnávať niet s čím.
 * @param {Vyhlad | null} posledny @param {Beh | null} beh @param {string} dnesKey @returns {Zmena | null}
 */
export function vyhladZmena(posledny, beh, dnesKey) {
    if (!posledny || posledny.date <= dnesKey) return null;
    if (!beh) return 'zmizli';
    if (beh.date !== posledny.date) return beh.date > posledny.date ? 'neskor' : 'skor';
    if (beh.pocet !== posledny.pocet) return beh.pocet > posledny.pocet ? 'dlhsie' : 'kratsie';
    return null;
}

/**
 * Výhľad pre ranné oznámenie: nadpis a úvod (null, keď niet čo povedať) a čo si zapamätať na
 * zajtra (`vyhlad`) - to, čo človek práve počul, inak to, čo počul predtým, kým ten deň nepríde.
 * @param {import('./day-plan.js').PlanInput} input @param {readonly string[]} devices
 * @param {Vyhlad | null} posledny @param {import('./messages.js').Voice} [voice]
 */
export function vyhladOznamenia(input, devices, posledny, voice = 'drzy') {
    const { dnes, dni } = dniVyhladu(input, devices);
    const beh = prvyBeh(dni);
    const dnesKey = localDateKey(input.now, input.site.timezone);
    const zmena = vyhladZmena(posledny, beh, dnesKey);
    // Pri zmene sa povie, ako je to teraz; inak len výstraha, keď je čas.
    const povie = zmena || vystraha(dnes, beh) ? beh : null;
    if (!zmena && !povie) return { text: null, vyhlad: posledny && posledny.date > dnesKey ? posledny : null };
    const predtym = zmena ? (dni.find((d) => d.date === posledny?.date)?.name ?? null) : null;
    return {
        text: vyhladNoticeText({ beh: povie, zmena, predtym, dnes, pracka: devices.includes('pracka') }, voice),
        vyhlad: povie && { date: povie.date, pocet: povie.pocet },
    };
}

/**
 * Pás „Využi dnešok“ na karte Teraz: keď by ranné oznámenie nieslo výstrahu - dnes slnko je
 * a dni bez slnka sú dosť blízko. Dni od dneška po posledný deň bez slnka. Inak null.
 * @param {import('./day-plan.js').PlanInput} input @param {readonly string[]} devices @param {import('./messages.js').Voice} [voice]
 */
export function vyhladPas(input, devices, voice = 'drzy') {
    const { dnes, dni } = dniVyhladu(input, devices);
    const beh = prvyBeh(dni);
    if (!vystraha(dnes, beh)) return null;
    const dnesKey = localDateKey(input.now, input.site.timezone);
    const den = (/** @type {string} */ date, /** @type {boolean} */ slnko) => ({ den: dayNameShort(date), slnko, dnes: date === dnesKey });
    return {
        ...vyhladPasText(beh, voice),
        dni: [den(dnesKey, true), ...dni.slice(0, beh.index - 1 + beh.pocet).map((d) => den(d.date, d.slnko))],
    };
}
