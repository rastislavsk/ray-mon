// Karta Teraz a bojler na prebytky (docs/navrhy/bojler-prebytky.html, časť 3): smer toku pod číslom,
// dlaždica Bojler podľa toho, čo hlási zásuvka (variant A, len stav), a panel „Bojler dnes“
// s pásom dňa, počtom zapnutí a behmi. Čisté funkcie - stav dostanú, texty a čísla vrátia.

import { BOJLER } from './config.js';
import { bojlerStav, suctyDna } from './bojler.js';
import { fmt1, minutesToTimeStr } from './format.js';
import { localDateKey, localMinutes } from './solar.js';

/** @typedef {import('./bojler.js').BojlerInfo} BojlerInfo */

const MIN = 60 * 1000;

// Pás dňa v paneli: od 6 do 18 h, popisky každé 3 hodiny.
const PAS = { odMin: 6 * 60, doMin: 18 * 60, krokMin: 3 * 60 };

export const TERAZ_BOJLER_TEXTS = {
    von: 'do siete',
    dnu: 'zo siete',
    hreje: 'Hreje zo slnka',
    hrejeSiet: 'Hreje',
    caka: 'Čaká na slnko',
    hotovo: 'Voda nahriata',
    mlci: 'Zásuvka sa neozýva',
    prebytok: 'prebytok',
    od: 'od',
    zapneOd: 'zapne od',
    prebytokTeraz: 'prebytok teraz',
    dnesZoSlnka: 'dnes zo slnka',
    hotovoO: 'hotovo',
    bezSpojenia: 'skript nebeží alebo je bez Wi-Fi',
    rucne: 'ručne',
    hrejeRucne: 'Hreje',
    vypnuty: 'Vypnutý',
    zasuvkaZap: 'zásuvka zapnutá',
    detail: 'Bojler dnes',
    detailPod: {
        hreje: 'hreje od',
        caka: 'čaká na prebytok',
        hotovo: 'voda nahriata o',
        mlci: 'zásuvka sa neozýva od',
        vypnuty: 'vypnutý od',
        vypnutyBez: 'vypnutý',
        hrejeBez: 'hreje',
        nic: 'dnes ešte nehrial',
    },
    zapnuty: 'zapnutý',
    hrial: 'hrial',
    zoSlnka: 'zo slnka',
    zoSiete: 'zo siete',
    teraz: 'teraz',
    nahriata: 'nahriata',
    behSiet: (/** @type {string} */ kwh) => `${kwh} kWh zo siete`,
    rezim: {
        nazov: 'Kto zapína bojler',
        appka: 'Riadi appka',
        rucne: 'Ručne',
        popisRucne: 'Zapína sa ručne alebo časovačom v appke Shelly. Ray-mon len zapisuje, čo bojler robí.',
        popisAppka: (/** @type {string} */ zap, /** @type {string} */ vyp) => `Zapne pri prebytku od ${zap} kW, vypne pod ${vyp} kW.`,
        chyba: 'Režim sa nepodarilo uložiť, ostal pôvodný.',
    },
    tokNadpis: 'Elektrina teraz',
    tokPod: 'meranie elektromera o',
    panely: 'panely',
    dom: 'dom',
};

/**
 * Riadi zásuvka bojler? Áno, keď sa za posledných BOJLER.riadenyHod hodín ozvala - inak (skript
 * zastavený, zásuvka preč) appka radí s bojlerom ako s každým iným spotrebičom.
 * @param {BojlerInfo | null} b @param {Date} now
 */
export const bojlerRiadeny = (b, now) => !!b && now.getTime() - b.kontaktAt < BOJLER.riadenyHod * 60 * MIN;

/**
 * Smer toku na odbernom mieste vedľa stavu merania (docs/navrhy/teraz-auto-tok.html, T1): šípky od domu
 * k stĺpu (`von`, do siete) alebo od stĺpu k domu (`dnu`, zo siete), koľko kW a to isté slovom pre čítačku.
 * Bez elektromera či pri takmer nule nič.
 * @param {number | null | undefined} sietKw kladné dodávka
 * @returns {{ smer: 'von' | 'dnu', kw: string, slovo: string } | null}
 */
export function tokSiete(sietKw) {
    if (typeof sietKw !== 'number' || Math.abs(sietKw) < 0.05) return null;
    const T = TERAZ_BOJLER_TEXTS;
    return sietKw > 0 ? { smer: 'von', kw: `${fmt1(sietKw)} kW`, slovo: T.von } : { smer: 'dnu', kw: `${fmt1(-sietKw)} kW`, slovo: T.dnu };
}

/** Čas, za ktorý bodka prejde po vedení jeden krok (s): viac kW tečie rýchlejšie. @param {number} kw */
const krok = (kw) => Math.round(Math.max(0.35, 2.4 - 0.4 * Math.max(0, kw)) * 100) / 100;

/**
 * Panel Elektrina teraz (T3): panely → dom → stĺp s hodnotami a rýchlosťou bodiek na oboch vedeniach.
 * Dom je výroba mínus dodávka (plus odber) - batériu appka nepozná. Bez smeru toku null.
 * @param {{ vyrobaKw: number | null, sietKw: number | null | undefined, meraneAt: number }} v @param {Date} now @param {string} tz
 */
export function tokDetail({ vyrobaKw, sietKw, meraneAt }, now, tz) {
    const tok = tokSiete(sietKw);
    if (!tok || typeof sietKw !== 'number') return null;
    const T = TERAZ_BOJLER_TEXTS;
    const vyroba = Math.max(0, vyrobaKw ?? 0);
    const dom = Math.max(0, vyroba - sietKw);
    const uzly = [
        { id: /** @type {const} */ ('slnko'), kw: `${fmt1(vyroba)} kW`, l: T.panely },
        { id: /** @type {const} */ ('dom'), kw: `${fmt1(dom)} kW`, l: T.dom },
        { id: /** @type {const} */ ('stlp'), kw: tok.kw, l: tok.slovo },
    ];
    return {
        nadpis: T.tokNadpis,
        pod: `${T.tokPod} ${cas(meraneAt, now, tz)}`,
        smer: tok.smer,
        uzly,
        // Bez výroby (noc) po prvom vedení nič netečie.
        krokSlnko: vyroba >= 0.05 ? krok(vyroba) : null,
        krokSiet: krok(Math.abs(sietKw)),
        popis: uzly.map((u) => `${u.l} ${u.kw}`).join(', '),
    };
}

/** Čas kontaktu ako „14:05“, alebo s dátumom, keď nebol dnes. @param {number} at @param {Date} now @param {string} tz */
function cas(at, now, tz) {
    const d = new Date(at);
    const hhmm = minutesToTimeStr(localMinutes(d, tz));
    if (localDateKey(d, tz) === localDateKey(now, tz)) return hhmm;
    const [, m, den] = localDateKey(d, tz).split('-');
    return `${Number(den)}. ${Number(m)}. ${hhmm}`;
}

/** Ako dlho sa zásuvka neozvala: „18 min“, „3 h“. @param {number} ms */
const ticho = (ms) => (ms < 60 * MIN ? `${Math.floor(ms / MIN)} min` : `${Math.floor(ms / (60 * MIN))} h`);

/** Záznam dnešného dňa (záznam spred polnoci je včerajší). @param {BojlerInfo} b @param {Date} now @param {string} tz */
const dnes = (b, now, tz) => (b.den && b.den.den === localDateKey(now, tz) ? b.den : null);

/**
 * Kedy termostat vypol bojler v behu `beh` (minúty), alebo null.
 * @param {import('./bojler.js').Den} den @param {{ od: number, do: number | null }} beh @param {number} koniec
 */
const hotovoV = (den, beh, koniec) => (den.hotovo !== null && den.hotovo >= beh.od && den.hotovo <= koniec ? den.hotovo : null);

/** Prebytok na dlaždicu: nezáporný, bez neho pomlčka. @param {BojlerInfo} b */
const prebytokText = (b) => (b.prebytokKw === null ? '–' : `${fmt1(Math.max(0, b.prebytokKw))} kW`);

/** Dlaždica nahriatej vody: koľko išlo dnes zo slnka a kedy bolo hotovo. @param {import('./bojler.js').Den | null} den */
function dlazdicaHotovo(den) {
    const T = TERAZ_BOJLER_TEXTS;
    const kedy = den?.hotovo ?? null;
    return {
        tone: 'tiche',
        riadi: 'caka',
        velky: `${fmt1(den ? suctyDna(den).slnkoKwh : 0)} kWh`,
        meno: T.hotovo,
        sub: kedy === null ? T.dnesZoSlnka : `${T.dnesZoSlnka} · ${T.hotovoO} ${minutesToTimeStr(kedy)}`,
    };
}

/** Dlaždica bojlera, ktorý hreje. @param {BojlerInfo} b @param {import('./bojler.js').Den | null} den */
function dlazdicaHreje(b, den) {
    const T = TERAZ_BOJLER_TEXTS;
    const beh = den?.behy.find((x) => x.do === null);
    // Hreje, ale prebytok bojler nepokryje (napr. pod prechádzajúcim oblakom): bez „zo slnka“.
    const zoSlnka = b.prebytokKw === null || b.prebytokKw >= b.w / 1000 - 0.05;
    return {
        tone: zoSlnka ? 'go' : 'next',
        riadi: 'bezi',
        velky: `${fmt1(b.w / 1000)} kW`,
        meno: zoSlnka ? T.hreje : T.hrejeSiet,
        sub: `${T.prebytok} ${prebytokText(b)}${beh ? ` · ${T.od} ${minutesToTimeStr(beh.od)}` : ''}`,
    };
}

/** Kedy sa relé naposledy vyplo: koniec posledného behu dneška, alebo null. @param {import('./bojler.js').Den | null} den */
const vypnuteOd = (den) => {
    const posledny = den?.behy[den.behy.length - 1];
    return posledny && posledny.do !== null ? posledny.do : null;
};

/**
 * Dlaždica v ručnom režime (docs/navrhy/teraz-auto-tok.html, ručný režim): na skle, bez rady -
 * hreje (príkon a od kedy), voda nahriata (dnešné kWh spolu) alebo vypnutý (od kedy).
 * @param {BojlerInfo} b @param {'hreje' | 'hotovo' | 'caka' | 'vypnuty'} stav @param {import('./bojler.js').Den | null} den
 */
function dlazdicaRucne(b, stav, den) {
    const T = TERAZ_BOJLER_TEXTS;
    if (stav === 'hreje') {
        const beh = den?.behy.find((x) => x.do === null);
        return {
            tone: 'tiche',
            riadi: 'bezi',
            velky: `${fmt1(b.w / 1000)} kW`,
            meno: T.hrejeRucne,
            sub: `${T.rucne}${beh ? ` · ${T.od} ${minutesToTimeStr(beh.od)}` : ''}`,
        };
    }
    if (stav === 'hotovo') {
        const s = den ? suctyDna(den) : null;
        return {
            tone: 'tiche',
            riadi: 'caka',
            velky: `${fmt1(s ? s.slnkoKwh + s.sietKwh : 0)} kWh`,
            meno: T.hotovo,
            sub: `${T.rucne} · ${T.zasuvkaZap}`,
        };
    }
    const od = vypnuteOd(den);
    return {
        tone: 'tiche',
        riadi: 'vyp',
        velky: '0 kW',
        meno: T.vypnuty,
        sub: `${T.rucne}${od === null ? '' : ` · ${T.od} ${minutesToTimeStr(od)}`}`,
    };
}

/**
 * Dlaždica Bojler (variant A, len stav): tón ako ostatné dlaždice (`go` hreje, `next` čaká, `tiche`
 * nahriata, `chyba` mlčí), bodka pri ikone (`bezi`, `caka`, `mlci`), veľké číslo, meno a doplnok.
 * @param {BojlerInfo} b @param {Date} now @param {string} tz
 */
export function bojlerDlazdica(b, now, tz) {
    const T = TERAZ_BOJLER_TEXTS;
    const stav = bojlerStav(b, now.getTime());
    if (stav === 'mlci')
        return { tone: 'chyba', riadi: 'mlci', velky: ticho(now.getTime() - b.kontaktAt), meno: T.mlci, sub: T.bezSpojenia };
    if (b.rucne) return dlazdicaRucne(b, stav, dnes(b, now, tz));
    if (stav === 'caka')
        return {
            tone: 'next',
            riadi: 'caka',
            velky: prebytokText(b),
            meno: T.caka,
            sub: `${T.prebytokTeraz} · ${T.zapneOd} ${fmt1(b.prahy.zapKw)}`,
        };
    return stav === 'hotovo' ? dlazdicaHotovo(dnes(b, now, tz)) : dlazdicaHreje(b, dnes(b, now, tz));
}

/** Pozícia minúty na páse v % (orezaná na pás). @param {number} m */
const naPase = (m) => Math.round(((Math.min(PAS.doMin, Math.max(PAS.odMin, m)) - PAS.odMin) * 10000) / (PAS.doMin - PAS.odMin)) / 100;

/**
 * Úseky jedného behu na páse: zo slnka, podiel zo siete (na konci ohrevu) a po nahriatí vody.
 * @param {import('./bojler.js').Den} den @param {import('./bojler.js').Beh} b @param {number} terazMin
 */
function usekyBehu(den, b, terazMin) {
    const koniec = b.do ?? terazMin;
    const hotovo = hotovoV(den, b, koniec) ?? koniec;
    const siet = b.wh > 0 ? Math.min(1, b.whSiet / b.wh) : 0;
    const delenie = b.od + (hotovo - b.od) * (1 - siet);
    /** @type {Array<[number, number, 'slnko' | 'siet' | 'hotovo']>} */
    const kusy = [
        [b.od, delenie, 'slnko'],
        [delenie, hotovo, 'siet'],
        [hotovo, koniec, 'hotovo'],
    ];
    return kusy
        .filter(([od, po]) => naPase(po) > naPase(od))
        .map(([od, po, tone]) => ({ left: naPase(od), width: Math.round((naPase(po) - naPase(od)) * 100) / 100, tone }));
}

/**
 * Pás dňa v paneli: úseky behov v % pásu (zo slnka zelené, podiel zo siete červený, po nahriatí
 * vody sivé), čiarka teraz a popisky hodín.
 * @param {import('./bojler.js').Den | null} den @param {number} terazMin
 */
function pasDna(den, terazMin) {
    const useky = den ? den.behy.flatMap((b) => usekyBehu(den, b, terazMin)) : [];
    const ticks = [];
    for (let m = PAS.odMin; m <= PAS.doMin; m += PAS.krokMin) ticks.push({ at: naPase(m), label: String(m / 60) });
    return { useky, teraz: terazMin >= PAS.odMin && terazMin <= PAS.doMin ? naPase(terazMin) : null, ticks };
}

/**
 * Riadok pod nadpisom panelu: čo bojler robí teraz.
 * @param {BojlerInfo} b @param {import('./bojler.js').Den | null} den @param {Date} now @param {string} tz
 */
function podDetail(b, den, now, tz) {
    const T = TERAZ_BOJLER_TEXTS.detailPod;
    const stav = bojlerStav(b, now.getTime());
    if (stav === 'mlci') return `${T.mlci} ${cas(b.kontaktAt, now, tz)}`;
    if (b.rucne) return `${TERAZ_BOJLER_TEXTS.rucne} · ${podStavu(stav, den)}`;
    return podStavu(stav, den);
}

/**
 * Čo bojler robí teraz, keď sa zásuvka ozýva.
 * @param {'hreje' | 'hotovo' | 'caka' | 'vypnuty'} stav @param {import('./bojler.js').Den | null} den
 */
function podStavu(stav, den) {
    const T = TERAZ_BOJLER_TEXTS.detailPod;
    const bezi = den?.behy.find((x) => x.do === null);
    if (stav === 'vypnuty') {
        const od = vypnuteOd(den);
        return od === null ? T.vypnutyBez : `${T.vypnuty} ${minutesToTimeStr(od)}`;
    }
    if (stav === 'hotovo' && den?.hotovo != null) return `${T.hotovo} ${minutesToTimeStr(den.hotovo)}`;
    // Hreje, hoci záznam dňa beh ešte nemá (Worker ho práve začal): bez času.
    if (stav === 'hreje') return bezi ? `${T.hreje} ${minutesToTimeStr(bezi.od)}` : T.hrejeBez;
    return den?.behy.length ? T.caka : T.nic;
}

/** Riadok behu: od - do (bežiaci „teraz“), odkiaľ a kedy bola voda nahriata. @param {import('./bojler.js').Den} den @param {import('./bojler.js').Beh} x */
function behRiadok(den, x) {
    const T = TERAZ_BOJLER_TEXTS;
    const siet = x.whSiet >= 50;
    const nahriata = hotovoV(den, x, x.do ?? Number.POSITIVE_INFINITY);
    const odkial = siet ? T.behSiet(fmt1(x.whSiet / 1000)) : T.zoSlnka;
    return {
        cas: `${minutesToTimeStr(x.od)} – ${x.do === null ? T.teraz : minutesToTimeStr(x.do)}`,
        tone: siet ? 'siet' : 'slnko',
        info: nahriata === null ? odkial : `${odkial} · ${T.nahriata} ${minutesToTimeStr(nahriata)}`,
    };
}

/**
 * Panel „Bojler dnes“: nadpis, čo sa deje teraz, pás dňa, štyri čísla (zapnutia, ako dlho hrial,
 * kWh zo slnka a zo siete) a behy s časom a odkiaľ.
 * @param {BojlerInfo} b @param {Date} now @param {string} tz
 */
export function bojlerDetail(b, now, tz) {
    const T = TERAZ_BOJLER_TEXTS;
    const den = dnes(b, now, tz);
    const s = den ? suctyDna(den) : { zapnuti: 0, min: 0, slnkoKwh: 0, sietKwh: 0 };
    const hrial = s.min >= 60 ? `${Math.floor(s.min / 60)} h ${s.min % 60} min` : `${s.min} min`;
    return {
        nadpis: T.detail,
        pod: podDetail(b, den, now, tz),
        rezim: { rucne: b.rucne, popis: b.rucne ? T.rezim.popisRucne : T.rezim.popisAppka(fmt1(b.prahy.zapKw), fmt1(b.prahy.vypKw)) },
        pas: pasDna(den, localMinutes(now, tz)),
        cisla: [
            { v: `${s.zapnuti}×`, l: T.zapnuty, tone: '' },
            { v: hrial, l: T.hrial, tone: '' },
            { v: `${fmt1(s.slnkoKwh)} kWh`, l: T.zoSlnka, tone: 'slnko' },
            { v: `${fmt1(s.sietKwh)} kWh`, l: T.zoSiete, tone: 'siet' },
        ],
        behy: den ? den.behy.map((x) => behRiadok(den, x)) : [],
    };
}
