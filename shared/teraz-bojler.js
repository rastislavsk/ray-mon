// Karta Teraz a bojler na prebytky (docs/navrhy/bojler-prebytky.html, časť 3): smer toku pod číslom,
// dlaždica Bojler podľa toho, čo hlási zásuvka (variant A, len stav), a panel „Bojler dnes“
// s pásom dňa, počtom zapnutí a behmi. Čisté funkcie - stav dostanú, texty a čísla vrátia.

import { BOJLER } from './config.js';
import { bojlerStav, suctyDna } from './bojler.js';
import { krivkaVody, stupne, vodaTeraz } from './bojler-voda.js';
import { fmt1, minutesToTimeStr } from './format.js';
import { localDateKey, localMinutes } from './solar.js';

/** @typedef {import('./bojler.js').BojlerInfo} BojlerInfo */

const MIN = 60 * 1000;

// Pás dňa v paneli: od 6 do 18 h, popisky každé 3 hodiny.
const PAS = { odMin: 6 * 60, doMin: 18 * 60, krokMin: 3 * 60 };

export const TERAZ_BOJLER_TEXTS = {
    von: 'do siete',
    dnu: 'zo siete',
    meno: 'Bojler',
    hreje: 'hreje zo slnka',
    hrejeSiet: 'hreje aj zo siete',
    caka: 'čaká na slnko',
    hotovo: 'nahriata',
    /** Voda dosiahla hranicu teploty (docs/navrhy/bojler-hranica.html). */
    hotovoNa: (/** @type {string} */ t) => `nahriata na ${t}`,
    mlci: 'zásuvka mlčí',
    od: 'od',
    zapnePri: 'zapne pri',
    zapneOkolo: 'zapne okolo',
    /** Čo plán čaká od bojlera (docs/navrhy/plan-dna-zive-data.html): kedy dohreje, alebo že dnes nie. */
    plan: {
        dohreje: (/** @type {string} */ cas) => `Podľa plánu dohreje okolo ${cas}.`,
        nedohreje: 'Dnes ho slnko asi nedohreje.',
        /** S teplomerom (docs/navrhy/bojler-teplota.html): aj koľko má voda teraz. */
        dohrejeVoda: (/** @type {string} */ t, /** @type {string} */ cas) => `Voda má ${t}, podľa plánu dohreje okolo ${cas}.`,
        nedohrejeVoda: (/** @type {string} */ t) => `Voda má ${t}, dnes ju slnko asi nedohreje.`,
    },
    dnesZoSlnka: 'dnes zo slnka',
    o: 'o',
    bezSpojenia: 'skript alebo Wi-Fi',
    rucne: 'ručne',
    hrejeRucne: 'hreje',
    vypnuty: 'vypnutý',
    dnesKwh: (/** @type {string} */ kwh) => `dnes ${kwh} kWh`,
    dnesKwhSlnko: (/** @type {string} */ kwh) => `dnes ${kwh} kWh zo slnka`,
    detail: 'Bojler dnes',
    detailPod: {
        hreje: 'hreje od',
        caka: 'čaká na prebytok',
        hotovo: 'voda nahriata o',
        hotovoNa: (/** @type {string} */ t) => `voda nahriata na ${t}`,
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
    rezim: {
        nazov: 'Kto zapína bojler',
        appka: 'Riadi appka',
        rucne: 'Ručne',
        popisRucne: 'Zapína sa ručne alebo časovačom v appke Shelly. Ray-mon len zapisuje, čo bojler robí.',
        popisAppka: (/** @type {string} */ zap, /** @type {string} */ vyp) => `Zapne pri prebytku od ${zap} kW, vypne pod ${vyp} kW.`,
        chyba: 'Režim sa nepodarilo uložiť, ostal pôvodný.',
        ulozene: (/** @type {boolean} */ rucne) => `Uložené · ${rucne ? 'zapínaš ručne' : 'riadi appka'}`,
    },
    /** Vypínač oznámení o zapnutí a vypnutí bojlera (docs/navrhy/spotrebic-koniec-opakovanie.html). */
    oznam: {
        nazov: 'Oznámiť zapnutie a vypnutie',
        zakazane: 'Oznámenia appka nemá povolené.',
        chyba: 'Nepodarilo sa to uložiť, skús znova.',
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

/** Odrážka „od 10:55“, alebo nič, keď čas nie je. @param {number | null | undefined} m */
const odText = (m) => (m == null ? [] : [`${TERAZ_BOJLER_TEXTS.od} ${minutesToTimeStr(m)}`]);

/**
 * Podiel dnešnej energie bojlera zo slnka v % pre pásik dlaždice, kým dnes nehrial null (pásik je prázdny).
 * @param {import('./bojler.js').Den | null} den
 */
function podielDnes(den) {
    const s = den ? suctyDna(den) : null;
    const spolu = s ? s.slnkoKwh + s.sietKwh : 0;
    return s && spolu > 0 ? Math.round((100 * s.slnkoKwh) / spolu) : null;
}

/**
 * Dlaždica nahriatej vody: koľko išlo dnes zo slnka a kedy bola voda nahriata. S teplomerom je veľké číslo teplota
 * a kWh zo slnka idú do odrážky. Keď vodu zastavila hranica teploty, povie „nahriata na 60 °C“.
 * @param {BojlerInfo} b @param {import('./bojler.js').Den | null} den @param {boolean} sVodou
 */
function dlazdicaHotovo(b, den, sVodou) {
    const T = TERAZ_BOJLER_TEXTS;
    const kedy = den?.hotovo ?? null;
    const kwh = fmt1(den ? suctyDna(den).slnkoKwh : 0);
    const prva = naHranici(b)
        ? T.hotovoNa(stupne(/** @type {number} */ (b.hranica)))
        : kedy === null
          ? T.hotovo
          : `${T.hotovo} ${T.o} ${minutesToTimeStr(kedy)}`;
    return {
        tone: 'tiche',
        riadi: 'caka',
        velky: `${kwh} kWh`,
        odr: [prva, sVodou ? T.dnesKwhSlnko(kwh) : T.dnesZoSlnka],
    };
}

/** Zastavila bojler hranica teploty (relé vypnuté, voda nahriata na hranicu)? @param {BojlerInfo} b */
const naHranici = (b) => !b.rele && !!b.nahriata && typeof b.hranica === 'number';

/** Dlaždica bojlera, ktorý hreje. @param {BojlerInfo} b @param {import('./bojler.js').Den | null} den */
function dlazdicaHreje(b, den) {
    const T = TERAZ_BOJLER_TEXTS;
    // Hreje, ale prebytok bojler nepokryje (napr. pod prechádzajúcim oblakom): aj zo siete.
    const zoSlnka = b.prebytokKw === null || b.prebytokKw >= b.w / 1000 - 0.05;
    return {
        tone: zoSlnka ? 'go' : 'next',
        riadi: 'bezi',
        velky: `${fmt1(b.w / 1000)} kW`,
        odr: [zoSlnka ? T.hreje : T.hrejeSiet, ...odText(den?.behy.find((x) => x.do === null)?.od)],
    };
}

/** Kedy sa relé naposledy vyplo: koniec posledného behu dneška, alebo null. @param {import('./bojler.js').Den | null} den */
const vypnuteOd = (den) => {
    const posledny = den?.behy[den.behy.length - 1];
    return posledny && posledny.do !== null ? posledny.do : null;
};

/**
 * Dlaždica v ručnom režime (docs/navrhy/teraz-auto-tok.html, ručný režim): na skle, bez rady -
 * hreje (príkon a od kedy), voda nahriata (dnešné kWh spolu) alebo vypnutý (od kedy). Že je to ručne,
 * ukáže značka pri ikone dlaždice (`rezim`), nie text.
 * @param {BojlerInfo} b @param {'hreje' | 'hotovo' | 'caka' | 'vypnuty'} stav @param {import('./bojler.js').Den | null} den
 */
function dlazdicaRucne(b, stav, den) {
    const T = TERAZ_BOJLER_TEXTS;
    if (stav === 'hreje')
        return {
            tone: 'tiche',
            riadi: 'bezi',
            velky: `${fmt1(b.w / 1000)} kW`,
            odr: [T.hrejeRucne, ...odText(den?.behy.find((x) => x.do === null)?.od)],
        };
    if (stav === 'hotovo') {
        // Veľké číslo je odber teraz (ako pri Hreje a Vypnutý), dnešné kWh až v odrážke.
        const s = den ? suctyDna(den) : null;
        return {
            tone: 'tiche',
            riadi: 'caka',
            velky: `${fmt1(b.w / 1000)} kW`,
            odr: [T.hotovo, T.dnesKwh(fmt1(s ? s.slnkoKwh + s.sietKwh : 0))],
        };
    }
    return { tone: 'tiche', riadi: 'vyp', velky: '0 kW', odr: [T.vypnuty, ...odText(vypnuteOd(den))] };
}

/**
 * Dlaždica Bojler (docs/navrhy/teraz-dlazdice-odrazky.html): tón ako ostatné dlaždice (`go` hreje, `next`
 * čaká, `tiche` nahriata, `chyba` mlčí), stav relé (`bezi` - dlaždica je zapnutá, zelená ikona; `caka`, `vyp`, `mlci`), veľké
 * číslo, meno, pásik (koľko dnes išlo zo slnka, `podiel` v %, kým dnes nehrial null) a najviac dve odrážky. Keď
 * Plán dňa vie, kedy zásuvka bojler zapne (`plan`, docs/navrhy/plan-dna-zive-data.html), čakajúci bojler povie
 * „zapne okolo …“ namiesto prahu.
 * `rezim` je značka pri ikone: kto bojler zapína (pri tichej zásuvke nevieme, null).
 * S teplomerom (docs/navrhy/bojler-teplota.html, T1) je veľké číslo teplota vody, keď ju zásuvka hlási.
 * @param {BojlerInfo} b @param {Date} now @param {string} tz @param {import('./plan-dna.js').BojlerPlan | null} [plan]
 * @returns {{ tone: string, riadi: string, rezim: 'appka' | 'rucne' | null, velky: string, meno: string, odr: string[], podiel: number | null }}
 */
export function bojlerDlazdica(b, now, tz, plan = null) {
    const T = TERAZ_BOJLER_TEXTS;
    const stav = bojlerStav(b, now.getTime());
    const meno = T.meno;
    const den = dnes(b, now, tz);
    const podiel = podielDnes(den);
    if (stav === 'mlci')
        return {
            tone: 'chyba',
            riadi: 'mlci',
            rezim: null,
            velky: ticho(now.getTime() - b.kontaktAt),
            meno,
            odr: [T.mlci, T.bezSpojenia],
            podiel,
        };
    const voda = vodaTeraz(b, now.getTime());
    /** @template {{ velky: string }} D @param {D} d @returns {D} */
    const sVodou = (d) => (voda ? { ...d, velky: stupne(voda.t) } : d);
    if (b.rucne) return { ...sVodou(dlazdicaRucne(b, stav, den)), rezim: 'rucne', meno, podiel };
    const t =
        stav === 'caka'
            ? // Veľké číslo je odber bojlera ako v ostatných stavoch, prebytok, pri ktorom zapne, je v odrážke.
              {
                  tone: 'next',
                  riadi: 'caka',
                  velky: '0 kW',
                  odr: [
                      T.caka,
                      plan?.zapne != null ? `${T.zapneOkolo} ${minutesToTimeStr(plan.zapne)}` : `${T.zapnePri} ${fmt1(b.prahy.zapKw)} kW`,
                  ],
              }
            : stav === 'hotovo'
              ? dlazdicaHotovo(b, den, !!voda)
              : dlazdicaHreje(b, den);
    return { ...sVodou(t), rezim: 'appka', meno, podiel };
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
    if (stav === 'hotovo' && naHranici(b)) return TERAZ_BOJLER_TEXTS.detailPod.hotovoNa(stupne(/** @type {number} */ (b.hranica)));
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

/**
 * Kde sa končí otvorený beh: hreje - „teraz“; termostat vypol - kedy bola voda nahriata; zásuvka mlčí -
 * jej posledné hlásenie. Relé ostáva zapnuté, preto sa beh v zázname ešte neuzavrel.
 * @param {BojlerInfo} b @param {import('./bojler.js').Den} den @param {import('./bojler.js').Beh} x @param {Date} now @param {string} tz
 */
function koniecBehu(b, den, x, now, tz) {
    const stav = bojlerStav(b, now.getTime());
    if (stav === 'mlci') return minutesToTimeStr(localMinutes(new Date(b.kontaktAt), tz));
    const nahriata = stav === 'hotovo' ? hotovoV(den, x, Number.POSITIVE_INFINITY) : null;
    return nahriata === null ? TERAZ_BOJLER_TEXTS.teraz : minutesToTimeStr(nahriata);
}

/**
 * Riadok behu: od - do a koľko kWh išlo zo slnka a koľko zo siete (farby, bez popisu; `sr` pre čítačku).
 * @param {BojlerInfo} b @param {import('./bojler.js').Den} den @param {import('./bojler.js').Beh} x @param {Date} now @param {string} tz
 */
function behRiadok(b, den, x, now, tz) {
    const siet = Math.min(x.wh, x.whSiet);
    return {
        cas: `${minutesToTimeStr(x.od)} – ${x.do === null ? koniecBehu(b, den, x, now, tz) : minutesToTimeStr(x.do)}`,
        slnko: `${fmt1((x.wh - siet) / 1000)} kWh`,
        siet: `${fmt1(siet / 1000)} kWh`,
    };
}

/**
 * Čo čaká plán od bojlera: kedy dohreje, alebo že dnes nie; s teplomerom aj koľko má voda. Pri nahriatej vode a bez plánu
 * prázdne.
 * @param {import('./plan-dna.js').BojlerPlan | null} plan @param {{ t: number } | null} voda
 */
function planText(plan, voda) {
    const T = TERAZ_BOJLER_TEXTS.plan;
    if (!plan || plan.nahriaty) return '';
    const cas = plan.dohreje === null ? null : minutesToTimeStr(plan.dohreje);
    if (voda) return cas === null ? T.nedohrejeVoda(stupne(voda.t)) : T.dohrejeVoda(stupne(voda.t), cas);
    return cas === null ? T.nedohreje : T.dohreje(cas);
}

/**
 * Panel „Bojler dnes“: nadpis, čo sa deje teraz, čo čaká plán (`plan`: kedy dohreje, alebo že dnes nie - pri nahriatej
 * vode a bez plánu prázdne; s teplomerom aj koľko má voda), krivka teploty vody dnes (`voda`, P1 v
 * docs/navrhy/bojler-teplota.html, bez teplomera null), pás dňa, štyri čísla (zapnutia, ako dlho hrial, kWh zo slnka
 * a zo siete) a behy s časom a odkiaľ.
 * @param {BojlerInfo} b @param {Date} now @param {string} tz @param {import('./plan-dna.js').BojlerPlan | null} [plan]
 */
export function bojlerDetail(b, now, tz, plan = null) {
    const T = TERAZ_BOJLER_TEXTS;
    const den = dnes(b, now, tz);
    const s = den ? suctyDna(den) : { zapnuti: 0, min: 0, slnkoKwh: 0, sietKwh: 0 };
    const hrial = s.min >= 60 ? `${Math.floor(s.min / 60)} h ${s.min % 60} min` : `${s.min} min`;
    return {
        nadpis: T.detail,
        pod: podDetail(b, den, now, tz),
        plan: planText(plan, vodaTeraz(b, now.getTime())),
        voda: krivkaVody(b.teploty ?? [], b.hranica ?? null),
        rezim: { rucne: b.rucne, popis: b.rucne ? T.rezim.popisRucne : T.rezim.popisAppka(fmt1(b.prahy.zapKw), fmt1(b.prahy.vypKw)) },
        pas: pasDna(den, localMinutes(now, tz)),
        cisla: [
            { v: `${s.zapnuti}×`, l: T.zapnuty, tone: '' },
            { v: hrial, l: T.hrial, tone: '' },
            { v: `${fmt1(s.slnkoKwh)} kWh`, l: T.zoSlnka, tone: 'slnko' },
            { v: `${fmt1(s.sietKwh)} kWh`, l: T.zoSiete, tone: 'siet' },
        ],
        behy: den ? den.behy.map((x) => behRiadok(b, den, x, now, tz)) : [],
    };
}
