// Auto čisto zo slnka (docs/navrhy/auto-mimo-planu.html, A1 + K2 + B1 + Z1, 24. 11. 2026). Auto v Pláne dňa nie je -
// nabíjanie riadi človek sám. Dlaždica auta na karte Teraz povie, koľko kWh a km by dalo slnko, keby auto viselo na
// nabíjačke celý deň a práčka, sušička ani umývačka nebežali: prebytok nad bežnou spotrebou domu a nad bojlerom, ktorý
// riadi zásuvka (ide pred autom, tak ako v Pláne dňa). Ráno odhad z predpovede, ktorý telefón zamrazí, po západe slnka
// prepis skutočnosťou (web/auto-den.js). Čisté funkcie - čas a dáta prichádzajú ako parametre.

import { AUTO_SLNKO, DEVICES } from './config.js';
import { forecastDayPlan } from './day-plan.js';
import { dayCtx, freeKw, kmOf } from './mozem-jadro.js';
import { bojlerDna, bojlerInyDen } from './plan-dna.js';
import { hodinaDomu } from './ucenie.js';
import { DATE_RE, isObj } from './valid.js';

/**
 * Auto zo slnka za deň: kWh (na desatiny), km (nadol na desiatky, kmOf) a či je to už skutočnosť (`vecer`), nie odhad.
 * @typedef {{ kwh: number, km: number, vecer: boolean }} AutoSlnko
 */
/** Uložený deň v telefóne (AUTO_DEN_STORAGE_KEY). @typedef {AutoSlnko & { d: string }} AutoDen */

const DAY_MIN = 24 * 60;
const NABIJACKA_KW = /** @type {(typeof DEVICES)[number]} */ (DEVICES.find((d) => d.name === 'Auto')).powerKw;

/**
 * Energia, ktorú by auto chytilo z prebytku `prebytok` (kW po minútach): minúta s prebytkom aspoň AUTO_SLNKO.minKw dá
 * prebytok, najviac príkon nabíjačky. Pod minimom nabíjačka nenabíja (K2).
 * @param {number[]} prebytok @returns {number} kWh
 */
export function autoKwh(prebytok) {
    return prebytok.reduce((sum, kw) => (kw >= AUTO_SLNKO.minKw ? sum + Math.min(kw, NABIJACKA_KW) / 60 : sum), 0);
}

/**
 * Auto zo slnka v dni s kontextom `den` (od polnoci, bez živého merania): prebytok = voľný výkon (výroba bez domu)
 * bez bojlera `bojler` (kW po minútach, null = bez zásuvky). @param {import('./mozem-jadro.js').DayCtx} den
 * @param {(free: number[]) => number[] | null} bojler
 */
function zDna(den, bojler) {
    const free = Array.from({ length: DAY_MIN }, (_, m) => freeKw(den, m));
    const boj = bojler(free);
    const kwh = autoKwh(boj ? free.map((kw, m) => kw - boj[m]) : free);
    return { kwh: Math.round(kwh * 10) / 10, km: kmOf(kwh) };
}

/**
 * Auto zo slnka za celý dnešok. Výroba je plán dňa - do teraz nameraná krivka, potom predpoveď (s učením, ak ju volajúci
 * opravil). Dom po hodinách `dom` (večer skutočnosť, domDnes), inak naučený profil. Bojler riadený zásuvkou do teraz zo
 * záznamu zásuvky, potom simulácia (B1). Živé meranie sa nepoužije - je to číslo za celý deň.
 * @param {import('./day-plan.js').PlanInput} input @param {number[] | null} [dom] @returns {Omit<AutoSlnko, 'vecer'>}
 */
export function autoDnes(input, dom = null) {
    const ctx = dayCtx(input);
    return zDna({ ...ctx, nowMin: 0, ...(dom ? { dom } : {}) }, (free) => bojlerDna(ctx, input, free));
}

/**
 * Odhad auta zo slnka pre iný deň predpovede (`index` v `forecast.days`): z predpovede toho dňa, s domom podľa toho,
 * či je víkend (dom z kontextu dneška je pre dnešok), a bojlerom zo studenej vody (bojlerInyDen).
 * @param {import('./day-plan.js').PlanInput & { forecast: import('./solar.js').Forecast }} input @param {number} index
 * @param {number[]} dom spotreba domu v ten deň po hodinách (domProfil) @returns {AutoSlnko}
 */
export function autoDna(input, index, dom) {
    const date = input.forecast.days[index].date;
    const den = { ...dayCtx(input), nowMin: 0, plan: forecastDayPlan(input, index), dom };
    return { ...zDna(den, (free) => bojlerInyDen(input, date, free)), vecer: false };
}

/**
 * Skutočná spotreba domu dneška `d` po hodinách na večerný prepis: uzavretá hodina z histórie Workera (medián domu bez
 * bojlera), keď je bežná (`hodinaDomu` v shared/ucenie.js: dosť meraní, nie nad PLAN_ZIVE.domMax) a nebežal v nej
 * spotrebič z „Už beží“ (`behy`). Inak naučený `profil`.
 * @param {number[]} profil @param {import('./historia.js').DenHistorie[]} dni @param {import('./bezi.js').Zapis[]} behy
 * @param {string} d @returns {number[]}
 */
export function domDnes(profil, dni, behy, d) {
    const den = dni.find((x) => x.d === d);
    const bezi = behy.filter((z) => z.d === d);
    return profil.map((kw, hod) => {
        const x = den?.h[hod];
        if (!hodinaDomu(x)) return kw;
        return bezi.some((z) => z.m < (hod + 1) * 60 && z.k > hod * 60) ? kw : x[1];
    });
}

/**
 * Čo má telefón s autom zo slnka urobiť pri obnove dát dneška `d`: `rano` - spočítať a zamraziť odhad (dnes ešte nie
 * je), `vecer` - prepísať ho skutočnosťou (AUTO_SLNKO.vecerMin minút po západe slnka `zapad`), inak null.
 * @param {AutoDen | null} ulozene @param {{ d: string, nowMin: number, zapad: number }} teraz
 * @returns {'rano' | 'vecer' | null}
 */
export function autoKrok(ulozene, { d, nowMin, zapad }) {
    const vecer = nowMin >= zapad + AUTO_SLNKO.vecerMin;
    if (!ulozene || ulozene.d !== d) return vecer ? 'vecer' : 'rano';
    return vecer && !ulozene.vecer ? 'vecer' : null;
}

/** Uložený deň auta zo slnka, len v platnom tvare. @param {unknown} raw @returns {AutoDen | null} */
export function autoDenZ(raw) {
    if (!isObj(raw)) return null;
    const x = /** @type {Record<string, unknown>} */ (raw);
    const cislo = (/** @type {unknown} */ v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
    if (typeof x.d !== 'string' || !DATE_RE.test(x.d) || !cislo(x.kwh) || !cislo(x.km) || typeof x.vecer !== 'boolean') return null;
    return { d: x.d, kwh: /** @type {number} */ (x.kwh), km: /** @type {number} */ (x.km), vecer: x.vecer };
}
