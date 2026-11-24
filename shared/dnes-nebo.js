// Obloha zvoleného času hore na karte Dnes (docs/navrhy/dnes-obloha-posuvnik.html, A, a docs/navrhy/dnes-tlacidlo-teraz.html,
// T4c): veľký výkon a čo je to za číslo, počasie a slnko v tej chvíli a posuvník dňa s východom a západom.
// Výkon a počasie sú z toho istého výpočtu ako graf dňa a pozadie appky (heroModel, pocasieTeraz) - dozadu
// meranie, dopredu predpoveď. Čisté funkcie, čas aj dáta prichádzajú v parametroch.

import { DNES_OS, HVIEZDY, MINUTES_PER_DAY } from './config.js';
import { fmt1 } from './format.js';
import { heroModel } from './hero-model.js';
import { dnesNeboText, hm, terazSourceText } from './messages-core.js';
import { daylightSpan, localDateKey, localMinutes, sunTimes } from './solar.js';
import { pocasieTeraz } from './teraz.js';

/** Minúta dňa ako % posuvníka (0 – 24 h), na desatiny. @param {number} m */
const pct = (m) => Math.round((Math.max(0, Math.min(MINUTES_PER_DAY, m)) / MINUTES_PER_DAY) * 1000) / 10;

/**
 * Model hornej časti karty Dnes v minúte `cas` (null = teraz). Bez polohy a bez predpovede null - karta vtedy
 * oblohu ani posuvník nemá.
 * `slnko`: kde je slnko na dennej dráhe (`f` 0 východ - 1 západ) a ako vysoko (`h` 0 - 1), v noci null.
 * `os`: polohy na posuvníku v % - zvolený čas (`bezec`), teraz (`teraz`, tam je odtlačok), deň od východu po
 * západ (`den`) a ich časy; deň bez východu či západu (polárny) ide cez celé svetlo dňa bez časov.
 * @param {Omit<import('./teraz.js').TerazInput, 'previewMinutes'>} input @param {number | null} cas
 * @param {import('./messages.js').Voice} [voice]
 */
export function dnesNeboModel(input, cas, voice = 'drzy') {
    if (input.known === 'nic' || !input.forecast) return null;
    const chvila = { ...input, previewMinutes: cas };
    const hero = heroModel(chvila, voice);
    const druh = cas === null ? 'teraz' : hero.source === 'measured' ? 'namerane' : 'predpoved';
    // Číslo s desatinnou čiarkou, aj nulové („0,0“), ako v poli toku karty Teraz. Typická strecha (poloha bez panelov)
    // je odhad s vlnovkou.
    const cislo = Number.isFinite(hero.power) ? fmt1(hero.power) : '–';
    const kw = input.known === 'poloha' && Number.isFinite(hero.power) ? `~${cislo}` : cislo;
    // Živé meranie hovorí zelená bodka, slovami sa píše len iný zdroj (najmä odhad, keď meranie mlčí).
    const zdroj = druh === 'teraz' && hero.source && hero.source !== 'live' ? terazSourceText(hero.source) : '';
    const d = denSvetla(input);
    return {
        kw,
        druh,
        ...dnesNeboText({ druh, min: hero.minutes, zdroj, kw: cislo }),
        // Hviezdy a Mesiac tak, ako ich vidno pri pohľade na východ: obzor na čiare posuvníka, hore zenit.
        pocasie: pocasieTeraz(chvila, HVIEZDY.dnes),
        slnko: slnkoNaDrahe(d.svetlo, hero.minutes),
        os: {
            min: hero.minutes,
            bezec: pct(hero.minutes),
            teraz: pct(localMinutes(input.now, input.site.timezone)),
            zvolene: cas !== null,
            den: { od: pct(d.svetlo.from), do: pct(d.svetlo.to) },
            vychod: d.vychod,
            zapad: d.zapad,
        },
    };
}

/**
 * Slnko na dennej dráhe v minúte `t`: kde (`f` 0 východ - 1 západ) a ako vysoko (`h` 0 - 1). Mimo dňa null.
 * @param {{ from: number, to: number }} svetlo @param {number} t
 */
function slnkoNaDrahe(svetlo, t) {
    const f = (t - svetlo.from) / (svetlo.to - svetlo.from);
    if (f < 0 || f > 1) return null;
    return { f: Math.round(f * 1000) / 1000, h: Math.round(Math.sin(Math.PI * f) * 1000) / 1000 };
}

/**
 * Dnešné svetlo: od východu po západ slnka a ich časy. Keď v ten deň nie sú (polárny deň či noc), svetlo dňa
 * grafov (daylightSpan) bez časov. @param {Pick<import('./day-plan.js').PlanInput, 'now' | 'site'>} input
 */
function denSvetla({ now, site }) {
    const den = localDateKey(now, site.timezone);
    const { rise, set } = sunTimes(site, den);
    if (rise === null || set === null || set <= rise) return { svetlo: daylightSpan(site, den), vychod: '', zapad: '' };
    return { svetlo: { from: rise, to: set }, vychod: hm(rise), zapad: hm(set) };
}

/**
 * Minúta dňa pre miesto na posuvníku: podiel jeho šírky (0 až 1) na krok DNES_OS.krokMin, najviac posledný krok
 * dňa. Do DNES_OS.prilepMin minút od teraz sa bežec prilepí na teraz (null).
 * @param {number} rel @param {number} nowMin
 */
export function dnesOsMinuta(rel, nowMin) {
    const krok = DNES_OS.krokMin;
    const min = Math.min(MINUTES_PER_DAY - krok, Math.round((Math.max(0, Math.min(1, rel)) * MINUTES_PER_DAY) / krok) * krok);
    return Math.abs(min - nowMin) <= DNES_OS.prilepMin ? null : min;
}

/** @typedef {NonNullable<ReturnType<typeof dnesNeboModel>>} DnesNebo */
