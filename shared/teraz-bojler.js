// Karta Teraz a bojler na prebytky (docs/navrhy/bojler-prebytky.html, časť 3): smer toku pod číslom,
// dlaždica Bojler podľa toho, čo hlási zásuvka (variant A, len stav), a panel „Bojler dnes“
// (docs/navrhy/bojler-panel.html, A) s teplotou a behmi na jednej osi, energiou podľa zdroja a behmi. Čisté funkcie - stav dostanú, texty a čísla vrátia.

import { BOJLER, MINUTES_PER_DAY } from './config.js';
import { bojlerStav, suctyDna } from './bojler.js';
import { krivkaVody, stupne, vodaTeraz } from './bojler-voda.js';
import { fmt1, minutesToTimeStr } from './format.js';
import { male } from './messages-teraz.js';
import { localDateKey, localMinutes } from './solar.js';
import { bandAt, bandById, scheduleFor } from './tariff.js';

/** @typedef {import('./bojler.js').BojlerInfo} BojlerInfo */

const MIN = 60 * 1000;

// Pás dňa v paneli: celý deň (os zdieľa s krivkou teploty), popisky každých 6 hodín.
const PAS = { odMin: 0, doMin: MINUTES_PER_DAY, krokMin: 6 * 60 };

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
    /** Čo plán čaká od bojlera (docs/navrhy/plan-dna-zive-data.html): kedy dohreje, alebo že dnes nie. Za stavom v paneli. */
    plan: {
        dohreje: (/** @type {string} */ cas) => `dohreje okolo ${cas}`,
        nedohreje: 'slnko ho dnes asi nedohreje',
    },
    dnesZoSlnka: 'dnes zo slnka',
    o: 'o',
    bezSpojenia: 'skript alebo Wi-Fi',
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
    /** Riadok pod energiou: koľkokrát a ako dlho dnes hrial. */
    zapnutyHrial: (/** @type {number} */ n, /** @type {string} */ hrial) => `${n}× zapnutý · hrial ${hrial}`,
    /** Energia dňa podľa zdroja (docs/navrhy/bojler-panel.html): slnko, sieť a sieť v drahom pásme tarify. */
    zdroj: { slnko: 'slnko', siet: 'sieť', vt: 'sieť vo VT' },
    /** To isté pre čítačku v riadku behu. */
    zdrojSr: { slnko: 'zo slnka', siet: 'zo siete', vt: 'zo siete vo VT' },
    behyNadpis: 'Behy dnes',
    teraz: 'teraz',
    rezim: {
        nazov: 'Čo riadi bojler?',
        appka: 'Ray-mon',
        rucne: 'Shelly',
        popisRucne: 'Zapína sa ručne alebo časovačom v appke Shelly. Ray-mon len zapisuje, čo bojler robí.',
        popisAppka: (/** @type {string} */ zap, /** @type {string} */ vyp) => `Zapne pri prebytku od ${zap} kW, vypne pod ${vyp} kW.`,
        chyba: 'Režim sa nepodarilo uložiť, ostal pôvodný.',
        ulozene: (/** @type {boolean} */ rucne) => `Uložené · riadi ${rucne ? 'Shelly' : 'Ray-mon'}`,
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

/** @typedef {import('./config.js').Tariff} Tariff */
/** Je minúta `m` v drahom pásme tarify? @typedef {(m: number) => boolean} JeDraha */

/** Drahé pásmo tarify v deň `den` (bez tarify nikdy). @param {Tariff | null} tariff @param {string} den @returns {JeDraha} */
export function drahaDna(tariff, den) {
    if (!tariff) return () => false;
    const schedule = scheduleFor(tariff, den);
    return (m) => bandAt(tariff, schedule, Math.min(m, MINUTES_PER_DAY - 1)).level === 'draha';
}

/** Má tarifa v deň `den` drahé pásmo? Pri jednosadzbovej panel VT neukáže. @param {Tariff | null} tariff @param {string} den */
export const maDrahu = (tariff, den) =>
    !!tariff && scheduleFor(tariff, den).changes.some((c) => bandById(tariff, c.band).level === 'draha');

/**
 * Koľko Wh behu išlo zo siete a koľko z toho v drahom pásme tarify (docs/navrhy/bojler-panel.html, D2). Beh so štvrťhodinami
 * (`q`) to vie presne, beh od staršieho Workera len odhadom (D1): odber zo siete sa rozloží rovnomerne na čas behu
 * (`od` až `do`, bežiaci beh po teraz).
 * @param {import('./bojler.js').Beh} beh @param {JeDraha} jeDraha @param {number} teraz minúta dňa
 */
function sietBehu(beh, jeDraha, teraz) {
    const siet = Math.min(beh.wh, beh.whSiet);
    let vt = 0;
    if (beh.q) {
        const q0 = Math.floor(beh.od / BOJLER.qMin);
        vt = beh.q.reduce((sum, [, wh], i) => sum + (jeDraha((q0 + i) * BOJLER.qMin) ? wh : 0), 0);
    } else {
        const doMin = Math.max(beh.od + 1, beh.do ?? teraz);
        let n = 0;
        for (let m = beh.od; m < doMin; m++) if (jeDraha(m)) n++;
        vt = (siet * n) / (doMin - beh.od);
    }
    return { siet, vt: Math.min(siet, vt) };
}

/**
 * Energia dňa podľa zdroja vo Wh: zo slnka, zo siete mimo drahého pásma a zo siete v drahom pásme.
 * @param {import('./bojler.js').Den} den @param {Tariff | null} tariff @param {number} teraz minúta dňa
 */
function energiaDna(den, tariff, teraz) {
    const jeDraha = drahaDna(tariff, den.den);
    return den.behy.reduce(
        (e, beh) => {
            const { siet, vt } = sietBehu(beh, jeDraha, teraz);
            return { slnko: e.slnko + beh.wh - siet, siet: e.siet + siet - vt, vt: e.vt + vt };
        },
        { slnko: 0, siet: 0, vt: 0 },
    );
}

/**
 * Koľko dnešnej energie bojlera išlo zo siete v drahom pásme tarify, v % pre červenú časť pásika dlaždice
 * (docs/navrhy/plan-dna-oznamenie-vt.html, P1). Kým dnes nehrial, 0.
 * @param {BojlerInfo} b @param {Date} now @param {string} tz @param {Tariff} tariff
 */
export function bojlerDrahaDnes(b, now, tz, tariff) {
    const den = dnes(b, now, tz);
    if (!den) return 0;
    const e = energiaDna(den, tariff, localMinutes(now, tz));
    const spolu = e.slnko + e.siet + e.vt;
    return spolu > 0 ? Math.round((100 * e.vt) / spolu) : 0;
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
 * hreje (príkon a od kedy), voda nahriata (dnešné kWh spolu) alebo vypnutý (od kedy). Že je to ručne, povie
 * panel Bojler dnes (Čo riadi bojler?), dlaždica nie (značka pri ikone zrušená 26. 11. 2026).
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
 * S teplomerom (docs/navrhy/bojler-teplota.html, T1) je veľké číslo teplota vody, keď ju zásuvka hlási.
 * @param {BojlerInfo} b @param {Date} now @param {string} tz @param {import('./plan-dna.js').BojlerPlan | null} [plan]
 * Na dlaždici sú len čísla (docs/navrhy/teraz-dlazdice-cisla.html, B): pod menom malé čísla (`mv`) - dnešné kWh, pri čakaní
 * kedy či pri akom prebytku zapne, pri nahriatej vode bez teplomera (veľké číslo sú kWh zo slnka) kedy bola nahriata;
 * mlčiaca zásuvka má pri veľkom čísle značku ticha (`zn`). Slová (`odr`) číta čítačka.
 * @returns {{ tone: string, riadi: string, zn?: import('./messages-teraz.js').Znacka, velky: string, meno: string, odr: string[],
 *   mv: import('./messages-teraz.js').MaleCislo[], podiel: number | null }}
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
            zn: 'ticho',
            velky: ticho(now.getTime() - b.kontaktAt),
            meno,
            odr: [T.mlci, T.bezSpojenia],
            mv: [],
            podiel,
        };
    const voda = vodaTeraz(b, now.getTime());
    /** @template {{ velky: string }} D @param {D} d @returns {D} */
    const sVodou = (d) => (voda ? { ...d, velky: stupne(voda.t) } : d);
    const s = den ? suctyDna(den) : null;
    const mv = s ? [male('kwh', `${fmt1(s.slnkoKwh + s.sietKwh)} kWh`)] : [];
    if (b.rucne) return { ...sVodou(dlazdicaRucne(b, stav, den)), meno, mv, podiel };
    if (stav === 'caka') return { ...sVodou(dlazdicaCaka(b, plan)), meno, podiel };
    if (stav === 'hotovo') {
        // Bez teplomera je veľké číslo kWh zo slnka - pod menom je potom, kedy bola voda nahriata.
        const kedy = den?.hotovo ?? null;
        const mvHotovo = voda ? mv : kedy === null ? [] : [male('koniec', minutesToTimeStr(kedy))];
        return { ...sVodou(dlazdicaHotovo(b, den, !!voda)), meno, mv: mvHotovo, podiel };
    }
    return { ...sVodou(dlazdicaHreje(b, den)), meno, mv, podiel };
}

/**
 * Dlaždica bojlera, ktorý čaká na slnko: veľké číslo je odber ako v ostatných stavoch, kedy zapne (keď to plán vie,
 * `plan`), inak pri akom prebytku, je pod menom. @param {BojlerInfo} b @param {import('./plan-dna.js').BojlerPlan | null} plan
 */
function dlazdicaCaka(b, plan) {
    const T = TERAZ_BOJLER_TEXTS;
    const zapne = plan?.zapne != null ? minutesToTimeStr(plan.zapne) : null;
    const prah = `${fmt1(b.prahy.zapKw)} kW`;
    return {
        tone: 'next',
        riadi: 'caka',
        velky: '0 kW',
        odr: [T.caka, zapne ? `${T.zapneOkolo} ${zapne}` : `${T.zapnePri} ${prah}`],
        mv: [male('start', zapne ?? prah)],
    };
}

/** Pozícia minúty na páse v % (orezaná na pás). @param {number} m */
const naPase = (m) => Math.round(((Math.min(PAS.doMin, Math.max(PAS.odMin, m)) - PAS.odMin) * 10000) / (PAS.doMin - PAS.odMin)) / 100;

/** @typedef {'slnko' | 'siet' | 'vt' | 'hotovo'} Ton */

/**
 * Kusy jedného behu v minútach: zo slnka, zo siete (v drahom pásme `vt`) a po nahriatí vody. So štvrťhodinami (D2)
 * po štvrťhodinách - v každej najprv slnko, potom sieť; štvrťhodina bez energie je po nahriatí. Beh od staršieho
 * Workera ako predtým: slnko, na konci ohrevu sieť, potom po nahriatí.
 * @param {import('./bojler.js').Den} den @param {import('./bojler.js').Beh} b @param {number} terazMin @param {JeDraha} jeDraha
 * @returns {Array<[number, number, Ton]>}
 */
function kusyBehu(den, b, terazMin, jeDraha) {
    const koniec = b.do ?? terazMin;
    if (b.q) {
        const q0 = Math.floor(b.od / BOJLER.qMin);
        return b.q.flatMap(([wh, siet], i) => {
            const zac = (q0 + i) * BOJLER.qMin;
            const od = Math.max(b.od, zac);
            const po = Math.min(koniec, zac + BOJLER.qMin);
            if (po <= od) return [];
            if (wh <= 0) return [/** @type {[number, number, Ton]} */ ([od, po, 'hotovo'])];
            const delenie = od + (po - od) * (1 - Math.min(1, siet / wh));
            return /** @type {Array<[number, number, Ton]>} */ ([
                [od, delenie, 'slnko'],
                [delenie, po, jeDraha(zac) ? 'vt' : 'siet'],
            ]);
        });
    }
    const hotovo = hotovoV(den, b, koniec) ?? koniec;
    const siet = b.wh > 0 ? Math.min(1, b.whSiet / b.wh) : 0;
    const delenie = b.od + (hotovo - b.od) * (1 - siet);
    return [
        [b.od, delenie, 'slnko'],
        [delenie, hotovo, 'siet'],
        [hotovo, koniec, 'hotovo'],
    ];
}

/**
 * Pás dňa v paneli na osi 0 - 24 h, tej istej ako krivka teploty: úseky behov v % pásu (zo slnka, zo siete, zo siete
 * v drahom pásme, po nahriatí vody; susedné kusy tej istej farby zlúčené), čiarka teraz a popisky hodín.
 * @param {import('./bojler.js').Den | null} den @param {number} terazMin @param {Tariff | null} tariff
 */
function pasDna(den, terazMin, tariff) {
    /** @type {Array<[number, number, Ton]>} */ const kusy = [];
    if (den) {
        const jeDraha = drahaDna(tariff, den.den);
        for (const [od, po, tone] of den.behy.flatMap((b) => kusyBehu(den, b, terazMin, jeDraha))) {
            const posl = kusy[kusy.length - 1];
            if (po <= od) continue;
            if (posl && posl[2] === tone && Math.abs(posl[1] - od) < 0.01) posl[1] = po;
            else kusy.push([od, po, tone]);
        }
    }
    const useky = kusy
        .filter(([od, po]) => naPase(po) > naPase(od))
        .map(([od, po, tone]) => ({ left: naPase(od), width: Math.round((naPase(po) - naPase(od)) * 100) / 100, tone }));
    const ticks = [];
    for (let m = PAS.odMin; m <= PAS.doMin; m += PAS.krokMin) ticks.push({ at: naPase(m), label: String(m / 60) });
    return { useky, teraz: naPase(terazMin), ticks };
}

/** Prvé písmeno veľké. @param {string} t */
const velke = (t) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * Riadok pod nadpisom panelu: čo bojler robí teraz.
 * @param {BojlerInfo} b @param {import('./bojler.js').Den | null} den @param {Date} now @param {string} tz
 */
function podDetail(b, den, now, tz) {
    const T = TERAZ_BOJLER_TEXTS.detailPod;
    const stav = bojlerStav(b, now.getTime());
    if (stav === 'mlci') return velke(`${T.mlci} ${cas(b.kontaktAt, now, tz)}`);
    if (stav === 'hotovo' && !b.rucne && naHranici(b)) return velke(T.hotovoNa(stupne(/** @type {number} */ (b.hranica))));
    return velke(podStavu(stav, den));
}

/**
 * Čo čaká plán od bojlera, v tom istom riadku za stavom: kedy dohreje, alebo že dnes nie. Pri nahriatej vode a bez
 * plánu prázdne.
 * @param {import('./plan-dna.js').BojlerPlan | null} plan
 */
function planText(plan) {
    const T = TERAZ_BOJLER_TEXTS.plan;
    if (!plan || plan.nahriaty) return '';
    return plan.dohreje === null ? T.nedohreje : T.dohreje(minutesToTimeStr(plan.dohreje));
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
 * Časti energie podľa zdroja: Wh (šírka v pásiku), kWh textom, popis a to isté pre čítačku. Bez drahého pásma
 * v tarife (`sVt` false) je sieť jedna časť.
 * @param {{ slnko: number, siet: number, vt: number }} e @param {boolean} sVt
 */
export function casti(e, sVt) {
    const T = TERAZ_BOJLER_TEXTS;
    const tony = /** @type {Array<'slnko' | 'siet' | 'vt'>} */ (sVt ? ['slnko', 'siet', 'vt'] : ['slnko', 'siet']);
    return tony.map((tone) => {
        const wh = Math.max(0, tone === 'siet' && !sVt ? e.siet + e.vt : e[tone]);
        return { tone, wh, v: `${fmt1(wh / 1000)} kWh`, l: T.zdroj[tone], sr: T.zdrojSr[tone] };
    });
}

/**
 * Riadok behu: od - do, pásik podľa zdroja (`casti`) a koľko kWh spolu; čítačka dostane kWh po zdrojoch (`sr`).
 * @param {import('./bojler.js').Beh} x
 * @param {{ b: BojlerInfo, den: import('./bojler.js').Den, now: Date, tz: string, jeDraha: JeDraha, sVt: boolean }} k
 */
function behRiadok(x, { b, den, now, tz, jeDraha, sVt }) {
    const { siet, vt } = sietBehu(x, jeDraha, localMinutes(now, tz));
    const c = casti({ slnko: x.wh - siet, siet: siet - vt, vt }, sVt);
    return {
        cas: `${minutesToTimeStr(x.od)} – ${x.do === null ? koniecBehu(b, den, x, now, tz) : minutesToTimeStr(x.do)}`,
        kwh: `${fmt1(x.wh / 1000)} kWh`,
        casti: c.map(({ tone, wh }) => ({ tone, wh })),
        sr: c
            .filter((k) => k.wh > 0)
            .map((k) => `${k.v} ${k.sr}`)
            .join(', '),
    };
}

/**
 * Panel „Bojler dnes“ (docs/navrhy/bojler-panel.html, A): nadpis, čo sa deje teraz (`pod`) a za ním, čo čaká plán (`plan`),
 * krivka teploty vody dnes (`voda`, P1 v docs/navrhy/bojler-teplota.html, bez teplomera null) a pod ňou pás behov na
 * tej istej osi 0 - 24 h, energia dňa podľa zdroja (VT len pri tarife s drahým pásmom), koľkokrát a ako dlho hrial,
 * behy a čo riadi bojler.
 * @param {BojlerInfo} b @param {Date} now @param {string} tz @param {import('./plan-dna.js').BojlerPlan | null} [plan]
 * @param {Tariff | null} [tariff]
 */
export function bojlerDetail(b, now, tz, plan = null, tariff = null) {
    const T = TERAZ_BOJLER_TEXTS;
    const den = dnes(b, now, tz);
    const teraz = localMinutes(now, tz);
    const s = den ? suctyDna(den) : { zapnuti: 0, min: 0 };
    const hrial = s.min >= 60 ? `${Math.floor(s.min / 60)} h ${s.min % 60} min` : `${s.min} min`;
    const sVt = maDrahu(tariff, localDateKey(now, tz));
    const jeDraha = drahaDna(tariff, localDateKey(now, tz));
    return {
        nadpis: T.detail,
        pod: podDetail(b, den, now, tz),
        plan: planText(plan),
        voda: krivkaVody(b.teploty ?? [], b.hranica ?? null),
        rezim: { rucne: b.rucne, popis: b.rucne ? T.rezim.popisRucne : T.rezim.popisAppka(fmt1(b.prahy.zapKw), fmt1(b.prahy.vypKw)) },
        pas: pasDna(den, teraz, tariff),
        energia: casti(den ? energiaDna(den, tariff, teraz) : { slnko: 0, siet: 0, vt: 0 }, sVt),
        // Kým dnes nehrial, povie to už riadok pod nadpisom.
        hrial: s.zapnuti ? T.zapnutyHrial(s.zapnuti, hrial) : '',
        behyNadpis: T.behyNadpis,
        behy: den ? den.behy.map((x) => behRiadok(x, { b, den, now, tz, jeDraha, sVt })) : [],
    };
}
