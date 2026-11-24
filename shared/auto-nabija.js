// Auto sa asi nabíja (docs/navrhy/auto-nabija.html, D2 + R2 + T2 + N3 + P2, 24. 11. 2026). Auto sa appke neozýva, preto
// Durable Object účtu Huawei (worker/src/ucet.js) pri každom novom meraní posunie stav nabíjania (krokAuta): spotreba domu
// bez bojlera nad minimom nabíjačky dve merania za sebou = začalo, pod AUTO_NABIJA.skonciKw dve merania za sebou = skončilo.
// Pri zmene pošle telefónom push (texty v shared/messages-oznamenia.js). Appka si stav vezme cez /auto: dlaždica Auto
// na karte Teraz je počas nabíjania o behu s oranžovou ikonou (nie zelenou - tú majú spotrebiče, o ktorých appka vie
// naisto) a panel Auto ukáže beh, os dňa a behy za týždeň. Čisté funkcie - čas a dáta prichádzajú ako parametre.

import { AUTO_NABIJA, AUTO_SLNKO, BOJLER, DEVICES } from './config.js';
import { dayNameShort, fmt1, minutesToTimeStr } from './format.js';
import { money } from './messages-zaklad.js';
import { kmOf } from './mozem-jadro.js';
import { localDateKey, localMinutes } from './solar.js';
import { bandAt, bandById, scheduleFor } from './tariff.js';
import { isObj } from './valid.js';

const MIN = 60 * 1000;
const DEN = 24 * 60 * MIN;
const Q = BOJLER.qMin * MIN;
const MAX_KW = /** @type {(typeof DEVICES)[number]} */ (DEVICES.find((d) => d.name === 'Auto')).powerKw;

/**
 * Beh nabíjania: začiatok `m` a koniec `k` (ms; null - ešte sa nabíja), energia `wh` a z toho zo siete `whSiet`, výkon
 * auta pri poslednom meraní `kw` a energia po štvrťhodinách tarify `q` ([Wh, Wh zo siete], prvá je štvrťhodina začiatku).
 * @typedef {{ m: number, k: number | null, wh: number, whSiet: number, kw: number, q: Array<[number, number]> }} BehAuta
 */
/**
 * Stav v Durable Objecte: posledné meranie `at`, koľko meraní za sebou bolo nad / pod prahom a čas prvého z nich `od`,
 * dom bez bojlera tesne pred nabíjaním `zakladKw` (od neho sa ráta výkon auta) a behy za AUTO_NABIJA.dni dní.
 * @typedef {{ at: number, nad: number, pod: number, od: number | null, zakladKw: number, behy: BehAuta[] }} StavAuta
 */
/** Čo appka dostane z /auto: posledné meranie a behy. @typedef {{ at: number, behy: BehAuta[] }} AutoInfo */
/** Začiatok či koniec nabíjania pre oznámenie; `slnkoKw` - koľko z výkonu auta teraz dáva slnko. @typedef {{ zacal: boolean, beh: BehAuta, slnkoKw: number }} ZmenaAuta */

/** @type {StavAuta} */
export const AUTO_ZACIATOK = { at: 0, nad: 0, pod: 0, od: null, zakladKw: 0, behy: [] };

/** Na desatiny. @param {number} x */
const r1 = (x) => Math.round(x * 10) / 10;
/** Číslo, inak null. @param {unknown} x */
const cislo = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/**
 * Pripočíta behu energiu za čas `od` - `po` (ms) pri výkone auta `kw`. Zo siete je to, čo dom berie zo siete, najviac
 * výkon auta (auto je posledné v rade - slnko je to, čo by inak odtieklo do siete). Celý úsek ide do štvrťhodiny
 * jeho stredu. @param {BehAuta} beh @param {number} od @param {number} po @param {number} kw @param {number} sietKw
 * @returns {BehAuta}
 */
function pripocitaj(beh, od, po, kw, sietKw) {
    const h = Math.max(0, po - od) / (60 * MIN);
    const wh = kw * h * 1000;
    const siet = Math.min(kw, Math.max(0, -sietKw)) * h * 1000;
    const i = Math.floor((od + po) / 2 / Q) - Math.floor(beh.m / Q);
    const q = beh.q.map((x) => /** @type {[number, number]} */ ([...x]));
    while (q.length <= i) q.push([0, 0]);
    q[i] = [r1(q[i][0] + wh), r1(q[i][1] + siet)];
    return { ...beh, wh: r1(beh.wh + wh), whSiet: r1(beh.whSiet + siet), kw: r1(kw), q };
}

/**
 * Stav nabíjania po novom meraní (R2): dom bez bojlera `domKw` (kW, null - meranie ho nevie) a dodávka do siete `sietKw`
 * (kladná dodávka, záporný odber) v čase `at` (ms). Začalo, keď je dom AUTO_NABIJA.merani merania za sebou aspoň
 * AUTO_SLNKO.minKw; skončilo, keď je toľko meraní za sebou pod AUTO_NABIJA.skonciKw. Merania musia ísť bez medzery nad
 * AUTO_NABIJA.medzeraMin - po nej sa počíta odznova a energia za medzeru sa nepripočíta. Beh začína prvým meraním nad
 * prahom a končí prvým pod ním. Vráti nový stav a zmenu na oznámenie (inak null).
 * @param {StavAuta | null | undefined} stav @param {{ at: number, domKw: number | null, sietKw: number | null }} m
 * @returns {{ stav: StavAuta, zmena: ZmenaAuta | null }}
 */
export function krokAuta(stav, { at, domKw, sietKw }) {
    const s = stav ?? AUTO_ZACIATOK;
    if (domKw === null || sietKw === null || at <= s.at) return { stav: s, zmena: null };
    const behy = s.behy.filter((b) => (b.k ?? at) >= at - AUTO_NABIJA.dni * DEN).slice(-AUTO_NABIJA.maxBehov);
    const posl = behy[behy.length - 1];
    /** @type {Krok} */ const k = {
        s,
        behy,
        at,
        domKw,
        sietKw,
        spojite: s.at > 0 && at - s.at <= AUTO_NABIJA.medzeraMin * MIN,
        kw: Math.min(MAX_KW, Math.max(0, domKw - s.zakladKw)),
    };
    return posl && posl.k === null ? sBehom(k, posl) : bezBehu(k);
}

/**
 * Jedno meranie pre krokAuta: predošlý stav `s`, behy bez starých, či ide hneď po predošlom meraní (`spojite`) a výkon auta.
 * @typedef {{ s: StavAuta, behy: BehAuta[], at: number, domKw: number, sietKw: number, spojite: boolean, kw: number }} Krok
 */

/** Koľko meraní za sebou splnilo podmienku (po medzere sa počíta od jedného). @param {boolean} plati @param {Krok} k @param {number} predtym */
const zaSebou = (plati, k, predtym) => (plati ? (k.spojite ? predtym : 0) + 1 : 0);

/** Nenabíja sa: začne po AUTO_NABIJA.merani meraniach nad prahom. @param {Krok} k @returns {{ stav: StavAuta, zmena: ZmenaAuta | null }} */
function bezBehu(k) {
    const { s, at } = k;
    const nad = zaSebou(k.domKw >= AUTO_SLNKO.minKw, k, s.nad);
    const od = nad === 1 ? at : nad ? s.od : null;
    if (nad < AUTO_NABIJA.merani || od === null) {
        const zakladKw = nad ? s.zakladKw : Math.min(k.domKw, AUTO_NABIJA.zakladMaxKw);
        return { stav: { at, nad, pod: 0, od, zakladKw, behy: k.behy }, zmena: null };
    }
    const beh = pripocitaj({ m: od, k: null, wh: 0, whSiet: 0, kw: 0, q: [] }, od, at, k.kw, k.sietKw);
    const slnkoKw = r1(Math.max(0, k.kw - Math.max(0, -k.sietKw)));
    return { stav: { at, nad: 0, pod: 0, od: null, zakladKw: s.zakladKw, behy: [...k.behy, beh] }, zmena: { zacal: true, beh, slnkoKw } };
}

/**
 * Nabíja sa (`posl` je otvorený beh): kým je dom nad AUTO_NABIJA.skonciKw, beh pribúda (po medzere sa energia
 * nepripočíta); po AUTO_NABIJA.merani meraniach pod ním sa uzavrie prvým z nich.
 * @param {Krok} k @param {BehAuta} posl @returns {{ stav: StavAuta, zmena: ZmenaAuta | null }}
 */
function sBehom(k, posl) {
    const { s, at } = k;
    const pod = zaSebou(k.domKw < AUTO_NABIJA.skonciKw, k, s.pod);
    const od = pod === 1 ? at : pod ? s.od : null;
    const dalej = k.spojite ? pripocitaj(posl, s.at, at, k.kw, k.sietKw) : { ...posl, kw: r1(k.kw) };
    const beh = pod ? posl : dalej;
    if (pod < AUTO_NABIJA.merani || od === null)
        return { stav: { at, nad: 0, pod, od, zakladKw: s.zakladKw, behy: [...k.behy.slice(0, -1), beh] }, zmena: null };
    const hotovy = { ...beh, k: od, kw: 0 };
    const zakladKw = Math.min(k.domKw, AUTO_NABIJA.zakladMaxKw);
    return {
        stav: { at, nad: 0, pod: 0, od: null, zakladKw, behy: [...k.behy.slice(0, -1), hotovy] },
        zmena: { zacal: false, beh: hotovy, slnkoKw: 0 },
    };
}

/** Má oznámenie v čase `at` prísť potichu (N3, AUTO_NABIJA.nocOd - nocDo)? @param {number} at @param {string} tz */
export function autoTiche(at, tz) {
    const h = Math.floor(localMinutes(new Date(at), tz) / 60);
    return h >= AUTO_NABIJA.nocOd || h < AUTO_NABIJA.nocDo;
}

/** Beh z odpovede Workera, inak null. @param {unknown} b @returns {BehAuta | null} */
function behZ(b) {
    if (!isObj(b)) return null;
    const [m, wh, whSiet, kw] = [b.m, b.wh, b.whSiet, b.kw].map(cislo);
    const k = b.k === null ? null : cislo(b.k);
    const q = Array.isArray(b.q) && b.q.every((x) => Array.isArray(x) && x.length === 2 && x.every((y) => cislo(y) !== null)) ? b.q : null;
    if (m === null || wh === null || whSiet === null || kw === null || (b.k !== null && k === null) || !q) return null;
    return { m, k, wh, whSiet, kw, q: /** @type {Array<[number, number]>} */ (q) };
}

/** Stav nabíjania z odpovede Workera (/auto), inak null. @param {unknown} raw @returns {AutoInfo | null} */
export function autoInfoZ(raw) {
    if (!isObj(raw) || cislo(raw.at) === null || !Array.isArray(raw.behy)) return null;
    const behy = raw.behy.map(behZ);
    return behy.every((b) => b !== null) ? { at: /** @type {number} */ (raw.at), behy: /** @type {BehAuta[]} */ (behy) } : null;
}

/**
 * Beh, ktorý sa práve nabíja: otvorený posledný beh, kým meranie nie je staršie než AUTO_NABIJA.platnostMin. Bez meraní
 * appka nevie, či sa ešte nabíja - nehovorí to. @param {AutoInfo | null | undefined} info @param {number} now @returns {BehAuta | null}
 */
export function nabijaSa(info, now) {
    const b = info?.behy[info.behy.length - 1];
    return info && b && b.k === null && now - info.at <= AUTO_NABIJA.platnostMin * MIN ? b : null;
}

/** km energie behu (kmOf: nadol na desiatky). @param {BehAuta} b */
export const kmBehu = (b) => kmOf(b.wh / 1000);

/** Čas v pásme elektrárne. @param {number} at @param {string} tz */
const hm = (at, tz) => minutesToTimeStr(localMinutes(new Date(at), tz));

export const AUTO_NABIJA_TEXTS = {
    nadpis: 'Auto',
    asiOd: (/** @type {string} */ cas) => `asi sa nabíja od ${cas}`,
    kw: (/** @type {number} */ kw) => `≈ ${fmt1(kw)} kW`,
    nenabija: 'Nenabíja sa',
    naposledy: (/** @type {string} */ kedy) => `Nenabíja sa · naposledy ${kedy}`,
    vTomto: 'v tomto behu',
    zoSlnka: (/** @type {number} */ pct) => `${pct} % zo slnka`,
    zdroj: { slnko: 'slnko', siet: 'sieť', vt: 'drahá sieť' },
    zdrojSr: { slnko: 'zo slnka', siet: 'zo siete', vt: 'zo siete v drahom pásme' },
    behyNadpis: 'Posledné nabíjania',
    dnes: 'dnes',
    vcera: 'včera',
    slnkoDnes: 'Slnko by dnes dalo',
    tyzden: 'Zo slnka za 7 dní',
    usetrene: (/** @type {string} */ suma) => `ušetrené ≈ ${suma}`,
    oznamZ: 'Oznámiť začiatok',
    oznamK: 'Oznámiť koniec',
    zakazane: 'Oznámenia sú v prehliadači zakázané. Povoľ ich v nastavení stránky.',
    chyba: 'Nepodarilo sa uložiť. Skús to znova.',
    poznamka: (/** @type {number} */ kw) => `Auto sa appke neozýva. Že sa nabíja, appka odhaduje zo spotreby domu nad ${fmt1(kw)} kW.`,
    osPopis: 'Os dňa: výroba a nabíjanie auta',
};

/**
 * Dlaždica auta počas nabíjania (T2): veľké km, ktoré v behu pribudli, od kedy a akým výkonom. Oranžovú ikonu
 * a obrys robí `zapnuty: 'nabija'` (render/teraz.js). @param {BehAuta} b @param {string} tz
 */
export function autoDlazdicaNabija(b, tz) {
    const T = AUTO_NABIJA_TEXTS;
    return {
        velky: `+${kmBehu(b)}`,
        za: 'km',
        meno: T.nadpis,
        odr: [T.asiOd(hm(b.m, tz)), T.kw(b.kw)],
        podiel: b.wh > 0 ? Math.round((100 * (b.wh - Math.min(b.wh, b.whSiet))) / b.wh) : null,
        zapnuty: /** @type {const} */ ('nabija'),
    };
}

/** @typedef {import('./config.js').Tariff} Tariff */
/** @typedef {'slnko' | 'siet' | 'vt'} Ton */

/** Pásmo tarify v čase `at` (bez tarify null). @param {Tariff | null} tariff @param {number} at @param {string} tz */
function pasmo(tariff, at, tz) {
    if (!tariff) return null;
    const d = new Date(at);
    return bandAt(tariff, scheduleFor(tariff, localDateKey(d, tz)), Math.min(localMinutes(d, tz), 24 * 60 - 1));
}

/**
 * Energia behu podľa zdroja vo Wh: slnko, sieť mimo drahého pásma a sieť v drahom pásme (po štvrťhodinách `q`),
 * a koľko by stálo zo siete to, čo dalo slnko (cena pásma v tej štvrťhodine). @param {BehAuta} b @param {Tariff | null} tariff
 * @param {string} tz
 */
function energiaBehu(b, tariff, tz) {
    const q0 = Math.floor(b.m / Q);
    return b.q.reduce(
        (e, [wh, siet], i) => {
            const p = pasmo(tariff, (q0 + i) * Q, tz);
            const s = Math.min(wh, siet);
            const vt = p?.level === 'draha' ? s : 0;
            return {
                slnko: e.slnko + wh - s,
                siet: e.siet + s - vt,
                vt: e.vt + vt,
                uspora: e.uspora + ((wh - s) / 1000) * (p?.price ?? 0),
            };
        },
        { slnko: 0, siet: 0, vt: 0, uspora: 0 },
    );
}

/** Má tarifa v deň `den` drahé pásmo? @param {Tariff | null} tariff @param {string} den */
const maDrahu = (tariff, den) => !!tariff && scheduleFor(tariff, den).changes.some((c) => bandById(tariff, c.band).level === 'draha');

/**
 * Časti energie podľa zdroja: Wh, kWh textom, popis a to isté pre čítačku. Bez drahého pásma je sieť jedna časť.
 * @param {{ slnko: number, siet: number, vt: number }} e @param {boolean} sVt
 */
function casti(e, sVt) {
    const T = AUTO_NABIJA_TEXTS;
    const tony = /** @type {Ton[]} */ (sVt ? ['slnko', 'siet', 'vt'] : ['slnko', 'siet']);
    return tony.map((tone) => {
        const wh = Math.max(0, tone === 'siet' && !sVt ? e.siet + e.vt : e[tone]);
        return { tone, wh, v: `${fmt1(wh / 1000)} kWh`, l: T.zdroj[tone], sr: T.zdrojSr[tone] };
    });
}

/** Kedy: „dnes 13:20“, „včera 22:05“, inak skratka dňa. @param {number} at @param {Date} now @param {string} tz */
function kedy(at, now, tz) {
    const T = AUTO_NABIJA_TEXTS;
    const d = localDateKey(new Date(at), tz);
    const dnes = localDateKey(now, tz);
    const vcera = localDateKey(new Date(now.getTime() - DEN), tz);
    return `${d === dnes ? T.dnes : d === vcera ? T.vcera : dayNameShort(d)} ${hm(at, tz)}`;
}

/** Pozícia minúty dňa na osi 0 - 24 h v %. @param {number} m */
const naOsi = (m) => Math.round((Math.min(24 * 60, Math.max(0, m)) / (24 * 60)) * 10000) / 100;

/**
 * Úseky dnešných behov na osi 0 - 24 h po štvrťhodinách: v každej najprv slnko, potom sieť (v drahom pásme `vt`).
 * @param {BehAuta[]} behy @param {{ now: Date, tz: string, tariff: Tariff | null }} k
 */
function useky(behy, { now, tz, tariff }) {
    const polnoc = now.getTime() - localMinutes(now, tz) * MIN - (now.getTime() % MIN);
    /** @type {Array<{ left: number, width: number, tone: Ton }>} */ const out = [];
    for (const b of behy) {
        const q0 = Math.floor(b.m / Q);
        const koniec = b.k ?? now.getTime();
        b.q.forEach(([wh, siet], i) => {
            const od = Math.max(b.m, (q0 + i) * Q);
            const po = Math.min(koniec, (q0 + i + 1) * Q);
            if (po <= od || wh <= 0) return;
            const delenie = od + (po - od) * (1 - Math.min(1, siet / wh));
            const tonSiet = pasmo(tariff, od, tz)?.level === 'draha' ? 'vt' : 'siet';
            for (const [a, z, tone] of /** @type {Array<[number, number, Ton]>} */ ([
                [od, delenie, 'slnko'],
                [delenie, po, tonSiet],
            ])) {
                const l = naOsi((a - polnoc) / MIN);
                const w = Math.round((naOsi((z - polnoc) / MIN) - l) * 100) / 100;
                if (w > 0) out.push({ left: l, width: w, tone });
            }
        });
    }
    return out;
}

/**
 * Krivka výroby dneška na osi (plocha v SVG 0 - 96 × 0 - 40, štvrťhodiny), bez výroby null.
 * @param {number[] | null} vyroba kW po štvrťhodinách od polnoci
 */
function krivka(vyroba) {
    const max = vyroba ? Math.max(...vyroba) : 0;
    if (!vyroba || !(max > 0)) return null;
    const y = (/** @type {number} */ kw) => Math.round((40 - (kw / max) * 36) * 10) / 10;
    return `M0 40${vyroba.map((kw, i) => ` L${i + 0.5} ${y(kw)}`).join('')} L96 40 Z`;
}

/**
 * Riadok pod nadpisom panelu: nabíja sa od kedy a akým výkonom, inak kedy naposledy. @param {BehAuta | null} teraz
 * @param {BehAuta | null} posl @param {Date} now @param {string} tz
 */
function podText(teraz, posl, now, tz) {
    const T = AUTO_NABIJA_TEXTS;
    if (teraz) return `${T.asiOd(hm(teraz.m, tz))} · ${T.kw(teraz.kw)}`;
    return posl ? T.naposledy(kedy(/** @type {number} */ (posl.k), now, tz)) : T.nenabija;
}

/**
 * Posledný beh v paneli: km veľkým, kWh a kedy (počas nabíjania „v tomto behu“), podiel slnka a energia podľa zdroja.
 * @param {BehAuta} b @param {{ slnko: number, siet: number, vt: number }} e @param {{ teraz: boolean, tz: string, sVt: boolean }} k
 */
function behModel(b, e, { teraz, tz, sVt }) {
    const T = AUTO_NABIJA_TEXTS;
    return {
        km: `+${kmBehu(b)}`,
        kwh: `${fmt1(b.wh / 1000)} kWh`,
        kedy: teraz ? T.vTomto : `${hm(b.m, tz)} – ${hm(/** @type {number} */ (b.k), tz)}`,
        slnko: b.wh > 0 ? T.zoSlnka(Math.round((100 * e.slnko) / b.wh)) : '',
        energia: casti(e, sVt),
    };
}

/**
 * Panel Auto (docs/navrhy/auto-nabija.html, P2): čo sa deje teraz, os dňa s výrobou a behmi, posledný beh (km, kWh,
 * podiel slnka, energia podľa zdroja), behy za týždeň, čo by dalo slnko dnes a koľko auto chytilo zo slnka za 7 dní
 * (s úsporou podľa ceny pásma). @param {AutoInfo} info
 * @param {{ now: Date, tz: string, tariff: Tariff | null, slnko: { kwh: number, km: number } | null, vyroba: number[] | null }} k
 */
export function autoDetail(info, { now, tz, tariff, slnko, vyroba }) {
    const T = AUTO_NABIJA_TEXTS;
    const teraz = nabijaSa(info, now.getTime());
    const behy = info.behy.filter((b) => b.k !== null || b === teraz);
    const posl = behy[behy.length - 1] ?? null;
    const sVt = maDrahu(tariff, localDateKey(now, tz));
    const e = posl ? energiaBehu(posl, tariff, tz) : null;
    const tyzden = behy.reduce(
        (s, b) => {
            const x = energiaBehu(b, tariff, tz);
            return { kwh: s.kwh + x.slnko / 1000, uspora: s.uspora + x.uspora };
        },
        { kwh: 0, uspora: 0 },
    );
    const pod = podText(teraz, posl, now, tz);
    return {
        nadpis: T.nadpis,
        pod: pod.charAt(0).toUpperCase() + pod.slice(1),
        nabija: !!teraz,
        os: { useky: useky(behy, { now, tz, tariff }), krivka: krivka(vyroba), teraz: naOsi(localMinutes(now, tz)), popis: T.osPopis },
        beh: posl && e ? behModel(posl, e, { teraz: posl === teraz, tz, sVt }) : null,
        behyNadpis: T.behyNadpis,
        behy: [...behy].reverse().map((b) => {
            const x = energiaBehu(b, tariff, tz);
            const c = casti(x, sVt);
            return {
                cas: kedy(b.m, now, tz),
                km: `${kmBehu(b)} km`,
                casti: c.map(({ tone, wh }) => ({ tone, wh })),
                sr: c
                    .filter((k) => k.wh > 0)
                    .map((k) => `${k.v} ${k.sr}`)
                    .join(', '),
            };
        }),
        slnkoDnes: slnko ? { l: T.slnkoDnes, v: `${slnko.km ? '~' : ''}${slnko.km} km · ${fmt1(slnko.kwh)} kWh` } : null,
        tyzden: {
            l: T.tyzden,
            v: `~${kmOf(tyzden.kwh)} km` + (tariff && tyzden.uspora > 0 ? ` · ${T.usetrene(money(tyzden.uspora, tariff.currency))}` : ''),
        },
        poznamka: T.poznamka(AUTO_SLNKO.minKw),
    };
}
