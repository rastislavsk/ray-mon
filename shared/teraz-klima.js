// Karta Teraz a klimatizácia Daikin (docs/navrhy/klima-daikin.html, B + Z1): dlaždica Klíma (príkon, vonku / nastavená,
// dnešné kWh, pásik slnko / sieť / drahé pásmo ako pri ostatných spotrebičoch) a panel Klíma (graf dňa, energia dneška,
// 14 dní, rok a podrobnosti). Čisté funkcie - stav dostanú, texty a čísla vrátia.

import { MINUTES_PER_DAY } from './config.js';
import { dateParts, dayNameShort, fmt1 } from './format.js';
import { klimaSpojena } from './klima.js';
import { male } from './messages-teraz.js';
import { addDays, localDateKey, localMinutes } from './solar.js';
import { casti, drahaDna, maDrahu } from './teraz-bojler.js';

/** @typedef {import('./klima.js').KlimaStav} KlimaStav */
/** @typedef {import('./config.js').Tariff} Tariff */

const MIN = 60 * 1000;

export const TERAZ_KLIMA_TEXTS = {
    meno: 'Klíma',
    /** Meno dlaždice podľa režimu na Daikine (docs/navrhy/teraz-klima-rezim.html): vypnutá Off, bez spojenia Off-line. */
    menoRezim: { kurenie: 'Kúrenie', chladenie: 'Chladenie', auto: 'Auto', susenie: 'Sušenie', ventilator: 'Vetranie' },
    menoVypnuta: 'Off',
    menoMlci: 'Off-line',
    ventilatorSr: (/** @type {string} */ ako) => `ventilátor ${ako}`,
    kw: 'kW',
    dnesKwh: (/** @type {string} */ kwh) => `dnes ${kwh} kWh`,
    mlci: 'klimatizácia mlčí',
    bezSpojenia: 'skript alebo Wi-Fi',
    rezim: { kurenie: 'kúri', chladenie: 'chladí', auto: 'automaticky', susenie: 'suší', ventilator: 'vetrá' },
    pod: (/** @type {string} */ rezim, /** @type {string} */ nast, /** @type {string} */ kw) => `${rezim} na ${nast} · ${kw} kW teraz`,
    vypnuta: 'vypnutá',
    neozyva: (/** @type {string} */ ako) => `neozýva sa ${ako}`,
    doma: 'doma',
    vonku: 'vonku',
    nastavene: 'nastavené',
    kwhHodina: 'kWh za hodinu',
    dnesSpolu: (/** @type {string} */ kwh) => `Dnes ${kwh} kWh`,
    bezi: (/** @type {string} */ ako) => `beží ${ako}`,
    vcera: (/** @type {string} */ kwh) => `včera ${kwh} kWh`,
    dni14: 'Posledných 14 dní',
    najviac: (/** @type {string} */ kedy, /** @type {string} */ kwh) => `Najviac ${kedy}: ${kwh} kWh`,
    rok: 'Tento rok a minulý',
    kurenieRok: (/** @type {number} */ r) => `kúrenie ${r}`,
    chladenieRok: (/** @type {number} */ r) => `chladenie ${r}`,
    mesiacPozn: (/** @type {string} */ mesiac, /** @type {string} */ teraz, /** @type {string} */ minuly) =>
        `${mesiac} zatiaľ ${teraz} kWh, celý minulý ${minuly} kWh. Svetlejšie stĺpce sú minulý rok.`,
    podrobnosti: 'Podrobnosti',
    riadky: {
        rezim: 'Režim',
        kompresor: 'Kompresor',
        stoji: 'stojí',
        ventilator: 'Ventilátor',
        lamely: 'Lamely',
        hybu: 'pohybujú sa',
        stoja: 'stoja',
        chyba: 'Chyba',
        ziadna: 'žiadna',
        wifi: 'Wi-Fi adaptéra',
        adapter: 'Firmvér adaptéra',
        udaje: 'Údaje',
        pred: (/** @type {string} */ ako) => `pred ${ako}`,
    },
    /** Ventilátor (`f_rate`): A automaticky, B tichý, 3 až 7 stupne 1 až 5. */
    ventilator: (/** @type {string} */ f) =>
        f === 'A' ? 'automaticky' : f === 'B' ? 'tichý' : /^[3-7]$/.test(f) ? `stupeň ${Number(f) - 2}` : f,
    rezimDlho: { kurenie: 'kúrenie', chladenie: 'chladenie', auto: 'automaticky', susenie: 'sušenie', ventilator: 'ventilátor' },
    /** „v stredu“ - deň v týždni v 6. páde (podľa getUTCDay). */
    vDen: ['v nedeľu', 'v pondelok', 'v utorok', 'v stredu', 'vo štvrtok', 'v piatok', 'v sobotu'],
    mesiace: ['Január', 'Február', 'Marec', 'Apríl', 'Máj', 'Jún', 'Júl', 'August', 'September', 'Október', 'November', 'December'],
    mesiaceSkratka: ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'],
};

/** Teplota bez slov: „2°“, „23,5°“, bez údaja „–“. @param {number | null} t */
const st = (t) => (t === null ? '–' : `${Number.isInteger(t) ? String(t) : fmt1(t).replace(/,0$/, '')}°`);

/** Ako dlho: „18 min“, „3 h“. @param {number} ms */
const ticho = (ms) => (ms < 60 * MIN ? `${Math.max(0, Math.floor(ms / MIN))} min` : `${Math.floor(ms / (60 * MIN))} h`);

/** kWh z Wh s jedným desatinným miestom. @param {number} wh */
const kwh = (wh) => fmt1(wh / 1000);

/** Dnešné hodiny (Wh), keď sú z dneška, inak null. @param {KlimaStav} k @param {string} dnes */
const hodinyDnes = (k, dnes) => (k.hod && k.hod.d === dnes ? k.hod : null);

/**
 * Energia dneška podľa zdroja vo Wh: zo slnka (zdroje hodín od Workera), zo siete mimo drahého pásma a v ňom. Hodina
 * bez zdroja je celá zo siete; pásmo hodiny určuje jej polovica (tarifa sa mení po štvrťhodinách, Daikin hlási hodiny).
 * @param {KlimaStav} k @param {string} dnes @param {Tariff | null} tariff
 */
function energiaDnes(k, dnes, tariff) {
    const hod = hodinyDnes(k, dnes);
    const jeDraha = drahaDna(tariff, dnes);
    const e = { slnko: 0, siet: 0, vt: 0 };
    hod?.k.forEach((wh, h) => {
        const z = k.zdroje[h] ?? null;
        const slnko = z ? Math.min(wh, z[0]) : 0;
        e.slnko += slnko;
        if (jeDraha(h * 60 + 30)) e.vt += wh - slnko;
        else e.siet += wh - slnko;
    });
    return e;
}

/**
 * Ventilátor na dlaždicu: A automaticky, B tichý, `f_rate` 3 až 7 ako stupeň 1 až 5; iné a bez údaja null.
 * @param {string | null} f
 */
const ventilatorStupen = (f) => (f === 'A' || f === 'B' ? f : f && /^[3-7]$/.test(f) ? String(Number(f) - 2) : null);

/**
 * Dlaždica Klíma (B): príkon veľkým číslom, odrážky „vonku / nastavená“ len hodnotami a „dnes … kWh“, pásik slnko /
 * sieť / drahé pásmo (`podiel`, `draha` v %, kým dnes nič nespotrebovala null). Kompresor beží = zapnutá (`riadi` bezi,
 * biely kruh, Z1). Skript mlčí dlhšie ako KLIMA.tichoMin - tón `chyba` (jantárový rám) a ako dlho.
 * @param {KlimaStav} k @param {Date} now @param {string} tz @param {Tariff | null} tariff
 * Na dlaždici sú len čísla (docs/navrhy/teraz-dlazdice-cisla.html, B): pod menom teplota vonku a nastavená so značkami (`mv`),
 * dnešné kWh sú v paneli; slová (`odr`) číta čítačka. Meno je režim nastavený na Daikine, vypnutá Off, bez spojenia
 * Off-line; zapnutá ukáže vpravo hore ventilátor (`vent`: A, B tichý, 1 až 5 stupeň), docs/navrhy/teraz-klima-rezim.html.
 * @returns {{ tone: string, riadi: string, zn?: import('./messages-teraz.js').Znacka, velky: string, za?: string, meno: string, odr: string[],
 *   mv: import('./messages-teraz.js').MaleCislo[], podiel: number | null, draha: number, vent?: string | null }}
 */
export function klimaDlazdica(k, now, tz, tariff) {
    const T = TERAZ_KLIMA_TEXTS;
    const dnes = localDateKey(now, tz);
    const e = energiaDnes(k, dnes, tariff);
    const spolu = e.slnko + e.siet + e.vt;
    const pasik = {
        podiel: spolu > 0 ? Math.round((100 * e.slnko) / spolu) : null,
        draha: spolu > 0 ? Math.round((100 * e.vt) / spolu) : 0,
    };
    const dnesKwh = T.dnesKwh(kwh(spolu));
    if (!klimaSpojena(k, now.getTime())) {
        return {
            tone: 'chyba',
            riadi: 'mlci',
            zn: 'ticho',
            velky: ticho(now.getTime() - k.at),
            meno: T.menoMlci,
            odr: [T.mlci, T.bezSpojenia],
            mv: [],
            ...pasik,
        };
    }
    const bezi = k.pow && (k.hz ?? 0) > 0;
    const vent = k.pow ? ventilatorStupen(k.ventilator) : null;
    return {
        tone: 'tiche',
        riadi: bezi ? 'bezi' : 'vyp',
        velky: fmt1((k.w ?? 0) / 1000),
        za: T.kw,
        meno: k.pow ? T.menoRezim[k.rezim] : T.menoVypnuta,
        odr: [`${st(k.vonkuC)} / ${st(k.stempC)}`, dnesKwh, ...(vent && k.ventilator ? [T.ventilatorSr(T.ventilator(k.ventilator))] : [])],
        vent,
        mv: [male('vonku', st(k.vonkuC)), male('doma', st(k.stempC))],
        ...pasik,
    };
}

// Graf dňa: viewBox W × H pre krivky teplôt; medzera dlhšia ako MEDZERA_MIN preruší čiaru.
const W = 288;
const H = 96;
const MEDZERA_MIN = 20;

/**
 * Krivka jednej teploty z bodov: úseky čiary vo viewBoxe a posledná teplota (bez bodov prázdna a null).
 * @param {Array<[number, number]>} b [minúta dňa, °C] @param {(m: number) => number} x @param {(t: number) => number} y
 */
function krivka(b, x, y) {
    /** @type {Array<Array<[number, number]>>} */ const useky = [];
    b.forEach((p, i) => {
        if (i === 0 || p[0] - b[i - 1][0] > MEDZERA_MIN) useky.push([p]);
        else useky[useky.length - 1].push(p);
    });
    const d = useky.map((u) => u.map(([m, t], i) => `${i ? 'L' : 'M'}${x(m)} ${y(t)}`).join('')).join('');
    return { d, posledna: b.length ? b[b.length - 1][1] : null };
}

/** Percentá s dvomi desatinnými miestami. @param {number} a @param {number} b */
const pct = (a, b) => Math.round((a / b) * 10000) / 100;

/** Body jednej teploty: [minúta dňa, °C] bez chýbajúcich. @param {import('./klima.js').BodyDna} body @param {1 | 2} i */
const bodyTeploty = (body, i) => /** @type {Array<[number, number]>} */ (body.filter((b) => b[i] !== null).map((b) => [b[0], b[i]]));

/** Rozsah osi teplôt po 5 °C s rezervou 2 °C; bez hodnôt 0 až 30. @param {number[]} hodnoty */
function rozsah(hodnoty) {
    if (!hodnoty.length) return { dole: 0, hore: 30 };
    return { dole: Math.floor((Math.min(...hodnoty) - 2) / 5) * 5, hore: Math.ceil((Math.max(...hodnoty) + 2) / 5) * 5 };
}

/**
 * Popisky kriviek pri teraz (y v % výšky). Nesmú sa prekryť: dolný sa odsunie aspoň o 16 % výšky.
 * @param {Array<{ id: string, t: number | null }>} krivky @param {(t: number) => number} y
 */
function popiskyKriviek(krivky, y) {
    const T = TERAZ_KLIMA_TEXTS;
    const p = krivky.flatMap((x) =>
        x.t === null ? [] : [{ id: x.id, y: pct(y(x.t), H), text: `${x.id === 'doma' ? T.doma : T.vonku} ${st(x.t)}` }],
    );
    if (p.length === 2 && Math.abs(p[0].y - p[1].y) < 16) {
        const [a, b] = p[0].y <= p[1].y ? [p[0], p[1]] : [p[1], p[0]];
        b.y = Math.min(100, a.y + 16);
    }
    return p;
}

/** Stĺpce energie po hodinách v % (najmenej 2 kWh na celú výšku). @param {{ k: number[], c: number[] } | null} hod */
function stlpceHodin(hod) {
    const k = hod?.k ?? Array.from({ length: 24 }, () => 0);
    const c = hod?.c ?? k.map(() => 0);
    const max = Math.max(2000, ...k);
    return k.map((wh, h) => ({ k: pct(wh - c[h], max), c: pct(c[h], max) }));
}

/**
 * Graf dňa (panel Klíma): krivky teploty doma a vonku z bodov Workera, čiara nastavenej teploty, stĺpce energie za
 * každú hodinu (kúrenie a chladenie, `k` a `c` v % výšky) a čiarka teraz (% šírky dňa). Popisky v % výšky. Bez bodov
 * aj bez hodín null.
 * @param {KlimaStav} k @param {string} dnes @param {number} terazMin
 */
function grafDna(k, dnes, terazMin) {
    const T = TERAZ_KLIMA_TEXTS;
    const hod = hodinyDnes(k, dnes);
    const doma = bodyTeploty(k.body, 1);
    const vonku = bodyTeploty(k.body, 2);
    if (!doma.length && !vonku.length && !hod) return null;
    const nast = k.stempC === null ? [] : [k.stempC];
    const { dole, hore } = rozsah([...doma, ...vonku].map((b) => b[1]).concat(nast));
    const x = (/** @type {number} */ m) => Math.round((m / MINUTES_PER_DAY) * W * 10) / 10;
    const y = (/** @type {number} */ t) => Math.round(((hore - t) / (hore - dole)) * H * 10) / 10;
    const kd = krivka(doma, x, y);
    const kv = krivka(vonku, x, y);
    const popisky = popiskyKriviek(
        [
            { id: 'doma', t: kd.posledna },
            { id: 'vonku', t: kv.posledna },
        ],
        y,
    );
    return {
        w: W,
        h: H,
        doma: kd.d,
        vonku: kv.d,
        nastavena: nast.map((t) => ({ y: pct(y(t), H), text: `${T.nastavene} ${st(t)}` }))[0] ?? null,
        nula: dole < 0 && hore > 0 ? pct(y(0), H) : null,
        popisky,
        stlpce: stlpceHodin(hod),
        teraz: pct(terazMin, MINUTES_PER_DAY),
        popis: popisky.map((p) => p.text).join(', '),
    };
}
/**
 * 14 dní stĺpcami (najstarší vľavo, dnešok vpravo a nie je celý), skratky dní a deň s najväčšou spotrebou. Bez dát null.
 * @param {KlimaStav} k @param {string} dnes
 */
function dni14(k, dnes) {
    if (!k.dni || k.dni.d !== dnes) return null;
    const T = TERAZ_KLIMA_TEXTS;
    const dni = k.dni.k.map((wh, i) => ({ d: addDays(dnes, -i), wh })).reverse();
    const max = Math.max(1, ...dni.map((x) => x.wh));
    const top = dni.slice(0, -1).reduce((a, b) => (b.wh > a.wh ? b : a), dni[0]);
    const { day, month, dow } = dateParts(top.d);
    return {
        stlpce: dni.map((x, i) => ({ h: pct(x.wh, max), dnes: i === dni.length - 1 })),
        popisky: dni.map((x, i) => (i % 2 === 1 ? dayNameShort(x.d) : '')),
        najviac: top.wh > 0 ? T.najviac(`${T.vDen[dow]} ${day}. ${month}.`, kwh(top.wh)) : '',
    };
}

/**
 * Tento rok a minulý po mesiacoch (výška v % najväčšieho mesiaca, kúrenie a chladenie zvlášť), súčty roka a veta
 * o tomto mesiaci. Mesiace po dnešnom tohto roka nie sú. Bez dát null.
 * @param {KlimaStav} k @param {string} dnes
 */
function rokModel(k, dnes) {
    const r = k.rok;
    if (!r || r.r !== Number(dnes.slice(0, 4))) return null;
    const T = TERAZ_KLIMA_TEXTS;
    const mesiac = Number(dnes.slice(5, 7)) - 1;
    const max = Math.max(1, ...r.k, ...r.kMin);
    const stlpec = (/** @type {number} */ wh, /** @type {number} */ c) => ({ k: pct(wh - c, max), c: pct(c, max) });
    const tento = r.k.slice(0, mesiac + 1);
    const chladenie = r.c.slice(0, mesiac + 1).reduce((a, b) => a + b, 0);
    const kurenie = tento.reduce((a, b) => a + b, 0) - chladenie;
    return {
        mesiace: r.k.map((wh, i) => ({
            m: T.mesiaceSkratka[i],
            minuly: stlpec(r.kMin[i], r.cMin[i]),
            tento: i <= mesiac ? stlpec(wh, r.c[i]) : null,
        })),
        sucty: [
            { tone: 'kurenie', v: `${Math.round(kurenie / 1000).toLocaleString('sk-SK')} kWh`, l: T.kurenieRok(r.r) },
            { tone: 'chladenie', v: `${Math.round(chladenie / 1000).toLocaleString('sk-SK')} kWh`, l: T.chladenieRok(r.r) },
        ],
        pozn: T.mesiacPozn(T.mesiace[mesiac], String(Math.round(r.k[mesiac] / 1000)), String(Math.round(r.kMin[mesiac] / 1000))),
    };
}

/** Riadok pod nadpisom: čo robí, alebo že je vypnutá či mlčí. @param {KlimaStav} k @param {Date} now */
function podText(k, now) {
    const T = TERAZ_KLIMA_TEXTS;
    if (!klimaSpojena(k, now.getTime())) return T.neozyva(ticho(now.getTime() - k.at));
    if (!k.pow) return T.vypnuta;
    const r = T.rezim[k.rezim];
    return T.pod(r.charAt(0).toUpperCase() + r.slice(1), k.stempC === null ? '–' : `${fmt1(k.stempC)} °C`, fmt1((k.w ?? 0) / 1000));
}

/** Podrobnosti: všetko, čo adaptér hlási a appka inde neukazuje. @param {KlimaStav} k @param {Date} now */
function podrobnosti(k, now) {
    const T = TERAZ_KLIMA_TEXTS;
    const R = T.riadky;
    /** @type {Array<[string, string]>} */ const riadky = [
        [R.rezim, k.pow ? T.rezimDlho[k.rezim] : T.vypnuta],
        [R.kompresor, k.hz ? `${k.hz} Hz` : R.stoji],
    ];
    if (k.ventilator) riadky.push([R.ventilator, T.ventilator(k.ventilator)]);
    if (k.lamely !== null) riadky.push([R.lamely, k.lamely ? R.hybu : R.stoja]);
    if (k.chyba !== null) riadky.push([R.chyba, k.chyba === 0 ? R.ziadna : String(k.chyba)]);
    if (k.wifi !== null) riadky.push([R.wifi, `${k.wifi} dBm`.replace('-', '−')]);
    if (k.fw) riadky.push([R.adapter, k.fw]);
    riadky.push([R.udaje, R.pred(ticho(now.getTime() - k.at))]);
    return riadky;
}

/**
 * Panel Klíma (docs/navrhy/klima-daikin.html): nadpis, čo robí, graf dňa, energia dneška podľa zdroja (VT len pri tarife
 * s drahým pásmom), ako dlho dnes beží a včerajšok, 14 dní, rok a podrobnosti.
 * @param {KlimaStav} k @param {Date} now @param {string} tz @param {Tariff | null} tariff
 */
export function klimaDetail(k, now, tz, tariff) {
    const T = TERAZ_KLIMA_TEXTS;
    const dnes = localDateKey(now, tz);
    const beh = k.behMin === null ? '' : T.bezi(k.behMin >= 60 ? `${Math.floor(k.behMin / 60)} h ${k.behMin % 60} min` : `${k.behMin} min`);
    const e = energiaDnes(k, dnes, tariff);
    return {
        nadpis: T.meno,
        pod: podText(k, now),
        graf: grafDna(k, dnes, localMinutes(now, tz)),
        energia: casti(e, maDrahu(tariff, dnes)),
        beh: [T.dnesSpolu(kwh(e.slnko + e.siet + e.vt)), beh, k.vcera === null ? '' : T.vcera(kwh(k.vcera))].filter(Boolean).join(' · '),
        dni: dni14(k, dnes),
        rok: rokModel(k, dnes),
        podrobnosti: podrobnosti(k, now),
    };
}
