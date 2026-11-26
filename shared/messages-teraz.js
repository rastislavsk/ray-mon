// Texty karty Teraz: číslo a stav a čo zapnúť. Čisté funkcie bez DOM.

import { MINUTES_PER_DAY, PLAN_DNA } from './config.js';
import { fmt1, kwpRoughText } from './format.js';
import { MOZEM_ITEM_TEXTS, MOZEM_SKY_TEXTS, PLAN_AFTER, PLAN_PO_BOJLERI, countdownText } from './messages-mozem.js';
import { andList, cap, endHm, hm, onDay, polite, spanText } from './messages-zaklad.js';

// ---- Karta Teraz -----------------------------------------------------
// Výkon, odporúčanie a plán dňa počíta heroModel a
// dayPlan; tu sú len texty (shared/teraz.js).

/**
 * Čo znamená farba pásu plánu pod grafom: zelená slnko stačí, modrá lacná sieť, červená drahá
 * sieť, inak bežná cena. Legenda pod pásom ich píše slovom, aby farba nebola jediný nosič významu.
 * @type {Record<import('./day-chart.js').Tone, string>}
 */
export const TERAZ_TONES = { sun: 'slnko stačí', cheap: 'lacná sieť', costly: 'drahá sieť', plain: 'bežná cena' };

/** Legenda čiar a riadkov grafu dňa (nápis hranice je TERAZ_TEXTS.limit). */
export const DAY_CHART_KEYS = { power: 'výkon', forecast: 'predpoveď', cloud: 'oblačnosť' };

/** Pevné texty karty: popisky, tlačidlá a výzvy. */
export const TERAZ_TEXTS = {
    title: 'Teraz',
    retry: MOZEM_SKY_TEXTS.retry,
    hint: 'Ťahaj prstom po grafe a pozri si iný čas.',
    reset: 'Späť na teraz',
    limit: 'veľké spotrebiče',
    loading: 'Načítavam…',
    slider: 'Deň, šípkami si pozrieš iný čas',
    strip: 'Odporúčania, posúvaj do strán',
    devices: 'Spotrebiče',
    today: 'Dnešok',
    later: 'Kedy lepšie',
    guessTitle: 'Koľko dáva tvoja strecha?',
    guessText: 'Zadaj panely a tu uvidíš svoj výkon. S pripojeným meničom aj naozaj nameraný.',
    guessBtn: 'Zadaj panely',
    askTitle: 'Kde máš strechu?',
    askText: 'Bez polohy neviem, kedy u teba svieti. Zadaj ju v Nastavení a ukážem ti výkon aj plán dňa.',
    askBtn: 'Zadaj polohu',
    noteTitle: 'Odhad z predpovede, nie tvoja strecha',
    noteText: 'Appka nemá údaje z tvojho meniča. Číslo počíta z počasia.',
    noteBtn: 'Pripojiť meranie',
    noteAgainBtn: 'Pripojiť znova',
};

/** @type {typeof TERAZ_TEXTS} */
export const TERAZ_TEXTS_SLUSNE = {
    ...TERAZ_TEXTS,
    hint: 'Ťahajte prstom po grafe a pozrite si iný čas.',
    slider: 'Deň, šípkami si pozriete iný čas',
    strip: 'Odporúčania, posúvajte do strán',
    guessTitle: 'Koľko dáva vaša strecha?',
    guessText: 'Zadajte panely a uvidíte tu svoj výkon. S pripojeným meničom aj naozaj nameraný.',
    guessBtn: 'Zadajte panely',
    askTitle: 'Kde máte strechu?',
    askText: 'Bez polohy neviem, kedy u vás svieti. Zadajte ju v Nastavení a ukážem vám výkon aj plán dňa.',
    askBtn: 'Zadajte polohu',
    noteTitle: 'Odhad z predpovede, nie vaša strecha',
    noteText: 'Appka nemá údaje z vášho meniča. Číslo počíta z počasia.',
};

// ---- Čo zapnúť na karte Teraz (docs/navrhy/teraz-navrh-2.html) -----------------------
// Mriežka dlaždíc (docs/navrhy/teraz-dlazdice.html)
// a karta Deň s odčítaním zvoleného času. Pri bežných spotrebičoch bez ceny, pri aute km.
// Veľké písmená robí štýl, texty sú v bežnom tvare.

/** Koniec úseku, ktorý môže ísť cez polnoc: presne polnoc je „24:00“, ďalej čas ďalšieho dňa. @param {number} min */
const koniecHm = (min) => (min === MINUTES_PER_DAY ? '24:00' : hm(min));

/** Kým niečo príde, krátko: „45 min“, „1 h 30 min“, „2 h“. @param {number} min */
export function terazZaText(min) {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    if (!h) return `${m} min`;
    return m ? `${h} h ${m} min` : `${h} h`;
}

/**
 * Dlaždica toho, čo ide teraz (docs/navrhy/teraz-dlazdice-odrazky.html): veľké číslo, pod ním len meno
 * a najviac dve odrážky - čo urobiť a odkiaľ ide prúd. Spotrebič zo slnka: kedy ho zapnúť; v lacnom pásme dokedy je lacné. `pred` je malé slovo pred veľkým
 * číslom („do“), prázdne keď nie je. Keď slnko nepokryje celý program, povie „zo slnka“ slovom, koľko.
 * @param {{ id: string, name: string, kind: 'sun' | 'siet' | 'cheap', start: number, end: number, podiel: number }} r
 * @param {import('./messages-zaklad.js').Voice} [voice]
 * @returns {{ pred: string, velky: string, meno: string, odr: string[] }}
 */
export function terazDlazdicaText(r, voice = 'drzy') {
    const vy = polite(voice);
    const lacna = 'lacná elektrina';
    const zapni = vy ? 'zapnite teraz' : 'zapni teraz';
    if (r.kind === 'cheap') return { pred: 'do', velky: koniecHm(r.end), meno: r.name, odr: [zapni, lacna] };
    const zdroj = r.kind === 'siet' ? 'zo siete' : zoSlnkaSlovo(r.podiel);
    return { pred: '', velky: hm(r.start), meno: r.name, odr: [zapni, zdroj] };
}

/**
 * Dlaždica auta čisto zo slnka (docs/navrhy/auto-mimo-planu.html, Z1): veľké km (jednotka `za` je malá za číslom, aby sa
 * číslo v polovičnej šírke nezalomilo), pod menom kWh a či je to ranný odhad na celý deň, alebo po západe slnka skutočnosť.
 * @param {import('./auto-slnko.js').AutoSlnko} a @returns {{ velky: string, za: string, meno: string, odr: string[] }}
 */
export function terazAutoText(a) {
    return {
        velky: `${a.km ? '~' : ''}${a.km}`,
        za: 'km',
        meno: MOZEM_ITEM_TEXTS.auto.name,
        odr: [`${fmt1(a.kwh)} kWh zo slnka`, a.vecer ? 'dnes naozaj' : 'odhad na celý deň'],
    };
}

/**
 * Spotrebič beží (docs/navrhy/teraz-bezi-spotrebic.html, docs/navrhy/spotrebic-cas-nastavenie.html): tlačidlá v detaile
 * spotrebiča, kolieska zvyšku programu (práčka, sušička), čas zapnutia (umývačka) a bublina po „Nastaviť“ a „Nebeží“
 * s „Vrátiť“ a tým, či príde oznámenie o konci. Práčka, sušička aj umývačka sú „ona“ - „zapnutá“, „dobehla“.
 */
export const TERAZ_BEZI = {
    zapol: 'Už beží',
    nastav: 'Nastaviť',
    nebezi: 'Nebeží',
    zostava: 'Zostáva',
    zapnuta: 'Zapnutá o',
    hodiny: 'Hodiny',
    minuty: 'Minúty',
    h: 'h',
    min: 'min',
    vratit: 'Vrátiť',
    /**
     * Spotrebič na zásuvke Shelly (docs/navrhy/pracka-zasuvka.html, U1): namiesto „Už beží“ riadok so zmeraným príkonom
     * a vypínač oznámenia o konci behu pre tento telefón.
     */
    zasuvka: {
        meria: (/** @type {number} */ w) => (w >= 10 ? `Meria zásuvka · teraz ${fmt1(w / 1000)} kW` : 'Meria zásuvka · teraz nebeží'),
        oznam: 'Oznámiť, keď dobehne',
        /** Bežiaci beh zo zásuvky: koniec je odhad, kým zásuvka nezmeria skutočný. */
        why: 'Začiatok zmerala zásuvka. Koniec je odhad podľa predošlých behov, skutočný zmeria tiež.',
        zakazane: 'Oznámenia appka nemá povolené.',
        chyba: 'Nepodarilo sa to uložiť, skús znova.',
    },
    /** Či príde oznámenie o konci (web/koniec.js): objednané, zakázané v prehliadači, nepodarilo sa. */
    oznam: {
        ok: 'dám vedieť',
        zakazane: 'oznámenie nepríde',
        chyba: 'oznámenie sa nepodarilo',
    },
};

/**
 * Kedy nastavovaný beh skončí - „skončí o 17:15“, a keď je jeho koniec už preč (umývačka zapnutá dávno), „dobehla o 12:00“.
 * @param {number} k minúta dňa konca @param {number} nowMin
 */
export const terazKonciText = (k, nowMin) => `${k > nowMin ? 'skončí' : 'dobehla'} o ${hm(k % MINUTES_PER_DAY)}`;

/**
 * Bublina po „Nastaviť“ či „Nebeží“: „Práčka skončí o 17:15 · dám vedieť“, „Umývačka dobehla o 12:00“, „Práčka nebeží“.
 * @param {string} id @param {{ k: number } | null} beh beh po zmene, null po „Nebeží“ @param {number} nowMin
 * @param {'ok' | 'zakazane' | 'chyba' | null} oznam či príde oznámenie o konci
 */
export function terazBublinaText(id, beh, nowMin, oznam) {
    const meno = MOZEM_ITEM_TEXTS[id]?.name ?? '';
    if (!beh) return `${meno} ${TERAZ_BEZI.nebezi.toLowerCase()}`;
    const o = beh.k > nowMin && oznam ? ` · ${TERAZ_BEZI.oznam[oznam]}` : '';
    return `${meno} ${terazKonciText(beh.k, nowMin)}${o}`;
}

/** Čo spotrebič robí - „Dnes už prala“. @type {Record<string, string>} */
const ROBILA = { pracka: 'prala', susicka: 'sušila', umyvacka: 'umývala' };
const KRAT = ['Druhýkrát', 'Tretíkrát', 'Štvrtýkrát', 'Piatykrát'];

/**
 * Behy, ktoré dnes dobehli, v detaile spotrebiča: „Dnes už prala 9:10 – 11:05“, ďalší „Druhýkrát …“.
 * @param {string} id @param {Array<{ start: number, end: number }>} behy podľa začiatku
 * @returns {Array<{ text: string, cas: string }>}
 */
export function terazHotoveText(id, behy) {
    return behy.map((b, i) => ({
        text: i === 0 ? `Dnes už ${ROBILA[id] ?? 'bežala'}` : (KRAT[i - 1] ?? `${i + 1}. raz`),
        cas: `${hm(b.start)} – ${hm(b.end % MINUTES_PER_DAY)}`,
    }));
}

/** Odrážka dlaždice spotrebiča, ktorý dnes už dobehol: „dnes už 1×“. @param {number} n */
export const terazOpakText = (n) => `dnes už ${n}×`;

/**
 * Dlaždica spotrebiča, ktorý beží: do kedy a koľko ešte. Tie isté prvky ako ostatné dlaždice (veľký čas, meno,
 * dve odrážky), aby sedeli v rade.
 * @param {{ end: number }} r @param {number} nowMin
 * @returns {{ pred: string, velky: string, odr: string[] }}
 */
export function terazBehText(r, nowMin) {
    return { pred: 'do', velky: hm(r.end % MINUTES_PER_DAY), odr: ['beží', `ešte ${terazZaText(Math.max(1, r.end - nowMin))}`] };
}

/**
 * Detail spotrebiča, ktorý beží: od-do a pri zvyšku (práčka, sušička), čo s ním urobiť, inak čo s tým plán robí.
 * @param {{ start: number, end: number }} r @param {string} name @param {boolean} zvysok
 */
export function terazBehVecText(r, name, zvysok) {
    return {
        kedy: 'Beží',
        cas: `${hm(r.start)} – ${hm(r.end % MINUTES_PER_DAY)}`,
        why: zvysok
            ? `Nastav, koľko ukazuje ${name.toLowerCase()}.`
            : 'Plán dňa s ňou ráta: čo zo slnka zvýši, dostanú ostatné spotrebiče.',
    };
}

/**
 * Dlaždica najbližšej veci, keď teraz nejde nič: o koľko príde a odkiaľ.
 * @param {{ kind: 'sun' | 'siet' | 'cheap', start: number, podiel: number }} r @param {number} nowMin
 */
export function terazDalsiText(r, nowMin) {
    const zdroj = r.kind === 'cheap' ? 'lacná elektrina' : r.kind === 'siet' ? 'zo siete' : zoSlnkaSlovo(r.podiel);
    return [`za ${terazZaText(Math.max(0, r.start - nowMin))}`, zdroj];
}

/**
 * Odrážka, koľko zo slnka - prázdna, keď skoro celé. Vec po inej (sušička po práčke) pod PLAN_DNA.zoSiete povie „zo siete“.
 * @param {number} p podiel 0 až 1 @param {boolean} po @returns {string[]}
 */
function kolkoSlovo(p, po) {
    if (po && p < PLAN_DNA.zoSiete) return ['zo siete'];
    return p < CELE_ZO_SLNKA ? [podielSlovo(p)] : [];
}

/** Od tohto podielu slnka je vec „zo slnka“ bez ďalšieho slova - zvyšok ukáže pásik dlaždice. */
const CELE_ZO_SLNKA = 0.85;

/** „Zo slnka“, a keď slnko nepokryje skoro celý program, slovom koľko. @param {number} p podiel 0 až 1 */
const zoSlnkaSlovo = (p) => (p >= CELE_ZO_SLNKA ? 'zo slnka' : podielSlovo(p));

/**
 * Dlaždica ďalšieho spotrebiča: veľký čas a pod menom krátky doplnok - dobehne, po čom ide (aj „po bojleri“),
 * lacná elektrina - ako odrážky. Keď slnko nepokryje skoro celý program, druhá odrážka povie koľko („väčšina zo
 * slnka“); odznak spotrebiča ju môže nahradiť. „Tento týždeň nie“ má namiesto času pomlčku. Lacné pásmo má
 * pred časom malé „od“ (`pred`).
 * @param {import('./plan-dna.js').PlanRow} r @returns {{ pred?: string, cas: string, odr: string[] }}
 */
export function terazRiadokText(r) {
    if (r.kind === 'none') return { cas: '–', odr: ['slnko nestačí'] };
    if (r.kind === 'cheap') return { pred: 'od', cas: hm(r.start), odr: ['lacná elektrina'] };
    const start = r.kind === 'later' ? r.day.start : r.start;
    const after = r.after ? (PLAN_AFTER[r.after] ?? '') : '';
    // Sušička ide hneď po práčke aj vtedy, keď ju slnko neutiahne - povie, že pôjde zo siete.
    const kolko = kolkoSlovo(r.podiel, Boolean(after));
    if (after) return { cas: hm(start), odr: [after, ...kolko] };
    return { cas: hm(start), odr: odrazkyDomu(r, kolko) };
}

/**
 * Odrážky domáceho spotrebiča: kedy dobehne a koľko zo slnka. Posunutý bojlerom (`poBojleri`) povie najprv prečo
 * a potom koľko zo slnka - alebo kedy dobehne.
 * @param {Exclude<import('./plan-dna.js').PlanRow, { kind: 'none' | 'cheap' }>} r @param {string[]} kolko
 */
function odrazkyDomu(r, kolko) {
    const dobehne = `dobehne ${hm(r.end)}`;
    if (r.kind === 'sun' && r.poBojleri) return [PLAN_PO_BOJLERI, ...(kolko.length ? kolko : [dobehne])];
    return [dobehne, ...kolko];
}

/** Hrebeň týždňa na karte Teraz: meno skupiny tlačidiel dní a čo čítačka povie o dni pod hranicou. */
export const TERAZ_HREBEN = { label: 'Plán podľa dňa', pod: 'slnko na veľké spotrebiče nestačí' };

/**
 * Odznak na dlaždici a v riadku toho, čo ide dnes zo slnka: kedy bude slnko na ten spotrebič
 * najbližšie, keď to nie je zajtra (`dalsi` null = v predpovedi už nie). `dlho`: dva a viac dní bez slnka.
 * @param {{ name: string, index: number } | null} dalsi
 */
export function terazPotomText(dalsi) {
    if (!dalsi) return { text: 'tento týždeň už nie', dlho: true };
    const dlho = dalsi.index > 2;
    return { text: `potom ${dlho ? 'až ' : ''}${onDay(dalsi.name)}`, dlho };
}

/** Koľko programu pokryje slnko, slovom - na riadok odrážky v dlaždici, na S22 najviac asi 18 znakov. @param {number} p podiel 0 až 1 */
function podielSlovo(p) {
    if (p >= CELE_ZO_SLNKA) return 'skoro celé zo slnka';
    if (p >= 0.6) return 'väčšina zo slnka';
    if (p >= 0.42) return 'polovica zo slnka';
    return p >= 0.25 ? 'tretina zo slnka' : 'trochu zo slnka';
}

/** „Celá“ (pôjde zo slnka v deň …) v rode spotrebiča; práčka, sušička a umývačka sú „celá“. */
const CELY = /** @type {Record<string, string>} */ ({ bojler: 'celý' });

/**
 * Núdzový čas spotrebiča v deň, keď sa na slnko nezmestí (shared/tyzden.js): veľký čas a odrážky
 * dlaždice, a pre detail kedy, od-do a prečo. `zdroj`: cez deň s kúskom slnka, v lacnom pásme, aspoň
 * mimo drahého pásma, alebo je to jedno (`start` null). Pri dnešku (`dnes`) povie aj, kedy pôjde celý zo slnka (`potom`, meno
 * dňa, null = v predpovedi nie). Bez ceny v €.
 * @param {{ id?: string, start: number | null, end: number | null, podiel: number, zdroj: 'slnko' | 'lacna' | 'bezna' | 'siet',
 *   dnes: boolean, potom: string | null }} r
 * @param {import('./messages-zaklad.js').Voice} [voice]
 */
export function terazNudzaText(r, voice = 'drzy') {
    const od = r.start === null ? '' : hm(r.start);
    const info = { slnko: podielSlovo(r.podiel), lacna: 'lacná elektrina', bezna: 'bežná elektrina', siet: 'slnko nepomôže' }[r.zdroj];
    return {
        cas: od || '–',
        odr: r.dnes && r.potom ? [info, `${CELY[r.id ?? ''] ?? 'celá'} ${onDay(r.potom)}`] : [info],
        kedy: 'Najmenej zo siete',
        odDo: r.start === null || r.end === null ? '–' : `${od} – ${koniecHm(r.end)}`,
        why: `${nudzaWhy(r.zdroj, od, r.dnes, voice)}${r.dnes ? nudzaPotom(r.potom) : ''}`,
    };
}

/**
 * Prečo práve vtedy, v detaile núdzového času. @param {'slnko' | 'lacna' | 'bezna' | 'siet'} zdroj @param {string} od čas štartu
 * @param {boolean} dnes @param {import('./messages-zaklad.js').Voice} voice
 */
function nudzaWhy(zdroj, od, dnes, voice) {
    if (zdroj === 'slnko') return `Slnko na celý program nestačí. O ${od} ho pokryje najviac, zvyšok pôjde zo siete.`;
    if (zdroj === 'lacna') return `Slnko nepomôže, najmenej to stojí v lacnom pásme od ${od}.`;
    if (zdroj === 'bezna') return `Slnko nepomôže, od ${od} to aspoň nejde z drahej siete.`;
    return `Slnko nepomôže a sieť ${dnes ? 'dnes už lacnejšia nebude' : 'je v ten deň stále rovnako drahá'}. ${polite(voice) ? 'Pustite' : 'Pusti'}, keď treba.`;
}

/** Veta v detaile dnešného núdzového času, kedy pôjde spotrebič celý zo slnka. @param {string | null} potom meno dňa */
const nudzaPotom = (potom) => (potom ? ` Celé zo slnka ${onDay(potom)}.` : ' Celé zo slnka tento týždeň podľa predpovede nie.');

/**
 * Detail spotrebiča: kedy a odkiaľ prúd (`kedy`), od-do (`cas`) a prečo práve vtedy (`why`, z Plánu dňa).
 * @param {import('./plan-dna.js').PlanRow & { why: string }} r @param {boolean} teraz ide teraz
 */
export function terazVecText(r, teraz) {
    const why = r.why ? `${cap(r.why)}.` : '';
    if (r.kind === 'none') return { kedy: 'Tento týždeň nie', cas: '–', why };
    if (r.kind === 'later') return { kedy: `${cap(onDay(r.day.name))} zo slnka`, cas: `${hm(r.day.start)} – ${hm(r.end)}`, why };
    const zdroj = { cheap: 'z lacnej siete', siet: 'zo siete', sun: 'zo slnka' }[r.kind];
    return { kedy: `${teraz ? 'Teraz' : 'Dnes'} ${zdroj}`, cas: `${hm(r.start)} – ${koniecHm(r.end)}`, why };
}

/** Sieť v odčítaní karty Deň podľa úrovne pásma. */
const SIET_DO = /** @type {Record<string, string>} */ ({ lacna: 'lacná sieť', draha: 'drahá sieť', bezna: 'bežná cena' });

/**
 * Odčítanie karty Deň pre zvolený čas (alebo teraz): čas, výkon a odkiaľ je. `veta` je pre čítačku
 * a povie aj to, čo karta ukazuje krivkou a farbami: či slnko stačí a o koľko, sieť a dokedy,
 * oblačnosť a čo z plánu vtedy beží, inak čo príde.
 * @param {{ min: number, teraz: boolean, kw: number, source: 'live' | 'measured' | 'forecast' | null,
 *   slnko: 'go' | 'part' | 'noc', limitKw: number, level: string, levelDo: number, cloud: number | null,
 *   bezi: string[], dalsi: { name: string, start: number } | null }} c
 */
export function terazCitanieText(c) {
    const kw = Number.isFinite(c.kw) ? `${fmt1(c.kw)} kW` : '–';
    const zdroj = c.source ? terazSourceText(c.source) : '';
    const slnko =
        c.slnko === 'go'
            ? `slnko stačí · ${terazLimitGap(c.kw, c.limitKw)}`
            : c.slnko === 'part'
              ? `svieti, nestačí · ${terazLimitGap(c.kw, c.limitKw)}`
              : 'slnko nesvieti';
    const siet = `${SIET_DO[c.level] ?? SIET_DO.bezna} do ${koniecHm(c.levelDo)}`;
    const mraky = c.slnko === 'noc' || c.cloud === null ? '' : `oblačnosť ${terazCloudText(c.cloud)}`;
    const low = (/** @type {string} */ n) => n.toLowerCase();
    const plan = c.bezi.length ? `beží ${andList(c.bezi.map(low))}` : c.dalsi ? `potom ${low(c.dalsi.name)} o ${hm(c.dalsi.start)}` : '';
    const cas = c.teraz ? `Teraz ${hm(c.min)}` : hm(c.min);
    return {
        cas,
        kw,
        zdroj,
        veta: [`${cas}, ${kw}${zdroj ? `, ${zdroj}` : ''}`, slnko, siet, mraky, plan].filter(Boolean).join('. '),
    };
}

/** Slová pásu spotrebičov pod grafom detailu dňa (úrovne fitLevel z day-plan.js). Zelené („Zapni veľké“)
 * nesie aj okno pod grafom dňa na karte Teraz, preto sú tu a nie v messages-sedem.js. */
export const FIT_WORDS = { go: 'Zapni veľké', part: 'čiastočne', grid: 'zo siete' };

/** @type {typeof FIT_WORDS} */
const FIT_WORDS_SLUSNE = { ...FIT_WORDS, go: 'Zapnite veľké' };

/** Približná šírka znaku popisu pásu (11,5 px Space Grotesk) - na odhad, či sa popis zmestí. */
const FIT_CHAR_PX = 6.4;

/**
 * Popis úseku pásu spotrebičov: pri zelenom aj s časom („Zapni veľké · 11–16“, „8:30–17:30“), keď sa
 * zmestí, inak len slovo, a keď ani to, nič - úsek potom nesie farba, legenda a tooltip.
 * @param {{ from: number, to: number, level: import('./day-plan.js').FitLevel }} seg @param {number} widthPx
 * @param {import('./messages-zaklad.js').Voice} [voice]
 */
export function fitLabel(seg, widthPx, voice = 'drzy') {
    const fits = (/** @type {string} */ t) => t.length * FIT_CHAR_PX + 8 <= widthPx;
    const short = (/** @type {number} */ min) =>
        min % 60 ? `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}` : String(min / 60);
    const word = (polite(voice) ? FIT_WORDS_SLUSNE : FIT_WORDS)[seg.level];
    const full = `${word} · ${short(seg.from)}–${short(seg.to)}`;
    if (seg.level === 'go' && fits(full)) return full;
    return fits(word) ? word : '';
}

/**
 * Riadok pod číslom: odkiaľ výkon je. Živé meranie, namerané (krivka dneška), alebo odhad
 * z predpovede. Keď appka teraz meranie nemá, povie to pás pod číslom (terazNoteText) a tento
 * riadok sa pri odhade nepíše. @param {'live' | 'measured' | 'forecast' | null} source
 */
export function terazSourceText(source) {
    if (source === 'live') return 'živé meranie';
    if (source === 'measured') return 'namerané';
    return 'odhad z predpovede';
}

/**
 * Veta v páse „Odhad z predpovede“, keď meranie mlčí alebo výrobca prístup odmietol: čo sa stalo
 * a že číslo je z počasia. Bez merania vôbec je to pevný text `noteText`.
 * @param {{ since: string | null, riadok: string }} p `since`: čas posledného merania (null, keď
 *   neprišlo vôbec), `riadok`: prečo prístup neplatí (shared/pristup.js), inak prázdny
 * @param {import('./messages-zaklad.js').Voice} [voice]
 */
export function terazNoteText({ since, riadok }, voice = 'drzy') {
    if (riadok) return `${riadok}. Kým meranie ${polite(voice) ? 'nepripojíte' : 'nepripojíš'} znova, číslo počíta z počasia.`;
    return `${since ? `Meranie neodpovedá od ${since}` : 'Meranie neodpovedá'}. Kým sa neozve, číslo počíta z počasia.`;
}

/** Veta pod číslom pri typickej streche: priznáva, že nejde o vlastnú strechu. @param {number} kwp @param {import('./messages-zaklad.js').Voice} [voice] */
export function terazTypicalText(kwp, voice = 'drzy') {
    if (polite(voice)) return `typická strecha ${kwpRoughText(kwp)} vo vašej obci, nie vaša`;
    return `typická strecha ${kwpRoughText(kwp)} v tvojej obci, nie tvoja`;
}

/**
 * Popisok čiary náhľadu v grafe: len čas. Výkon ukazuje veľké číslo nad grafom a čo vtedy platí
 * farba pásu plánu pod krivkou - v grafe by sa opakovali. @param {number} min
 */
export function terazPreviewTime(min) {
    return hm(min);
}

// Zoznam pod grafom dňa (docs/navrhy/teraz-rozbalovaci-zoznam.html, B): hodnoty v čase, na ktorom
// je bod grafu - teraz, alebo náhľad pod prstom.

/** Oblačnosť v percentách, bez údaja pomlčka. @param {number | null} pct */
export function terazCloudText(pct) {
    return pct === null ? '–' : `${Math.round(pct)} %`;
}

/** Koľko výkonu chýba do hranice veľkých spotrebičov, alebo koľko je ho navyše. @param {number} kw @param {number} limitKw */
export function terazLimitGap(kw, limitKw) {
    if (!Number.isFinite(kw)) return '–';
    return kw < limitKw ? `chýba ${fmt1(limitKw - kw)} kW` : `navyše ${fmt1(kw - limitKw)} kW`;
}

/** Okno na veľké veci dnes: prebieha či príde, už bolo, alebo nebude. @param {{ from: number, to: number } | null} w @param {boolean} past */
export function terazWindowText(w, past) {
    if (!w) return 'Okno na veľké veci dnes nebude.';
    return `Okno na veľké veci ${past ? 'bolo ' : ''}${spanText(w)}.`;
}

/**
 * Textový popis grafu pre čítačku obrazovky: teraz, okno na veľké veci, kedy je lacná a kedy
 * drahá sieť - to, čo inak nesie farba pásu.
 * @param {{ span: { from: number, to: number }, nowMin: number, kwText: string, tone: import('./day-chart.js').Tone,
 *   sun: Array<{ from: number, to: number }>, cheap: Array<{ from: number, to: number }>, costly: Array<{ from: number, to: number }> }} d
 */
export function terazChartText({ span, nowMin, kwText, tone, sun, cheap, costly }) {
    return dayChartText({ span, now: { min: nowMin, kwText, tone }, sun, cheap, costly });
}

/**
 * Textový popis grafu dňa pre čítačku: os grafu (deň so slnkom), pri dnešku teraz, potom okno na
 * veľké veci, lacná a drahá sieť za celý deň. Graf v detaile iného dňa než dnešok značku „teraz“
 * nemá (`now` je null).
 * @param {{ span: { from: number, to: number }, now: { min: number, kwText: string, tone: import('./day-chart.js').Tone } | null,
 *   sun: Array<{ from: number, to: number }>, cheap: Array<{ from: number, to: number }>, costly: Array<{ from: number, to: number }> }} d
 */
export function dayChartText({ span, now, sun, cheap, costly }) {
    const list = (/** @type {Array<{ from: number, to: number }>} */ ws) => ws.map(spanText).join(', ');
    const full = span.from === 0 && span.to === MINUTES_PER_DAY;
    const parts = [full ? 'Výroba počas dňa.' : `Výroba od ${hm(span.from)} do ${endHm(span.to)}.`];
    if (now) parts.push(`Teraz ${hm(now.min)}: ${now.kwText} kW, ${TERAZ_TONES[now.tone]}.`);
    parts.push(sun.length ? `Okno na veľké veci ${list(sun)}.` : `Okno na veľké veci ${now ? 'dnes ' : ''}nebude.`);
    if (cheap.length) parts.push(`Lacná sieť ${list(cheap)}.`);
    if (costly.length) parts.push(`Drahá sieť ${list(costly)}.`);
    return parts.join(' ');
}

/**
 * Karta Dnešok: predpoveď dňa a koľko už nabehlo - z merania naisto, bez neho podľa predpovede.
 * @param {{ forecastKwh: number, doneKwh: number, measured: boolean }} d
 */
export function terazTodayText({ forecastKwh, doneKwh, measured }) {
    return measured
        ? `Predpoveď ${fmt1(forecastKwh)} kWh, už nabehlo ${fmt1(doneKwh)} kWh.`
        : `Predpoveď ${fmt1(forecastKwh)} kWh, podľa nej už asi ${fmt1(doneKwh)} kWh.`;
}

/**
 * Karta Kedy lepšie: dnes ešte silnejšie slnko (čas z heroModel) a najbližší silný deň z predpovede - podľa
 * triedy dňa (silnyDen v den-trieda.js). Veľká hodnota je kedy, krátky riadok k nej - je to polovica dlaždice
 * (docs/navrhy/dnes-nizsie-dlazdice.html, D).
 * @param {{ wait: string | null, todayStrong: boolean, next: { name: string, kwh: number } | null }} d
 */
export function dnesLepsieText({ wait, todayStrong, next }) {
    const name = next ? next.name.toLowerCase() : '';
    if (wait) return { value: `o ${wait}`, text: 'dnes ešte silnejšie' };
    if (next) return { value: name, text: `~${Math.round(next.kwh)} kWh${todayStrong ? ', aj dnes' : ''}` };
    return todayStrong ? { value: 'dnes', text: 'ďalší taký nebude' } : { value: 'nie', text: 'v týždni silný deň nie je' };
}

/** Počasie dňa slovom - ikona je len ozdoba, význam nesie toto slovo (karta 7 dní, Predpoveď na karte Dnes). @type {Record<import('./sky.js').SkyWeather, string>} */
export const SKY_WORDS = { jasno: 'jasno', polojasno: 'polojasno', zamracene: 'zamračené' };

/** Teplota v celých stupňoch: „8°“, pod nulou so znamienkom mínus („−3°“). @param {number} c */
export const stupne = (c) => `${Math.round(c) < 0 ? '−' : ''}${Math.abs(Math.round(c))}°`;

/**
 * Teplota dňa v celých stupňoch, od najnižšej po najvyššiu: „6° / 22°“, pod nulou so znamienkom
 * mínus („−3° / 4°“). Bez teploty v dátach prázdny text.
 * @param {{ tempMinC: number | null, tempMaxC: number | null }} day
 */
export function dayTempText(day) {
    if (day.tempMinC == null || day.tempMaxC == null) return '';
    return `${stupne(day.tempMinC)} / ${stupne(day.tempMaxC)}`;
}

/** Časti dňa pre zrážky v popise počasia, od hodiny `od` (shared/dnes-faza.js, PREDPOVED_HODINY). */
export const CASTI_DNA = [
    { od: 0, slovo: 'ráno' },
    { od: 10, slovo: 'dopoludnia' },
    { od: 12, slovo: 'popoludní' },
    { od: 17, slovo: 'večer' },
];

/**
 * Popis počasia na kartu Predpoveď (docs/navrhy/dnes-predpoved-graf.html) na dve-tri slová: oblačnosť
 * slovom ako v karte 7 dní a zrážky, keď prídu - s časťou dňa, keď padajú len v jednej:
 * „Jasno“, „Polojasno, sneh“, „Zamračené, večer dážď“. Bez oblačnosti aj zrážok prázdny text.
 * @param {{ weather: import('./sky.js').SkyWeather | null, zrazky: { druh: 'dazd' | 'sneh', cast: string | null } | null }} d
 */
export function dnesPopisText({ weather, zrazky }) {
    const z = zrazky ? [zrazky.cast, zrazky.druh === 'sneh' ? 'sneh' : 'dážď'].filter(Boolean).join(' ') : '';
    const text = [weather ? SKY_WORDS[weather] : '', z].filter(Boolean).join(', ');
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Karta Najviac slnka: najsilnejšia hodina dneška podľa predpovede - krátko, je to polovica dlaždice
 * (docs/navrhy/dnes-nizsie-dlazdice.html, D). @param {{ from: number, kw: number }} d minúta začiatku hodiny a výkon strechy v nej
 */
export function dnesSlnkoText({ from, kw }) {
    const h = Math.floor(from / 60);
    return { value: `${h} – ${h + 1} h`, text: `až ~${fmt1(kw)} kW` };
}

/**
 * @typedef {{ druh: 'zive' | 'spi' | 'zastarane' | 'neprislo' | 'znova' | 'odhad', cas: string, neplati: { riadok: string } | null,
 *   pricina?: 'spojenie' | 'menic' | null, mlci?: number | null }} StavMeraniaVstup stav merania (stavMerania v hero-model.js)
 */

/** Krátke slovo za čas pri zastaranom meraní, podľa príčiny - hlavička aj riadok v Nastavení. */
export const STAV_SLOVO = { spojenie: 'bez spojenia', menic: 'zastarané' };

/**
 * Bublina, keď karta Teraz prestane ukazovať odhad: po novom pripojení merania (`pripojene`), keď
 * prišlo prvé meranie - v noci menič spí a namerané čísla prídu až ráno, bez toho by človek videl
 * „pripojené“ a popri tom stále odhad; alebo keď sa meranie po výpadku vrátilo (`obnovene`).
 * Bez oslovenia, v oboch tónoch rovnaké. @param {'zive' | 'spi'} druh @param {string} zdroj napr. „Huawei · Dvorany“
 * @param {'pripojene' | 'obnovene'} [ako]
 */
export function pripojenieText(druh, zdroj, ako = 'pripojene') {
    const obnovene = ako === 'obnovene';
    const veta = druh === 'spi' ? 'menič teraz spí, prvé namerané čísla budú ráno' : `čísla sú ${obnovene ? 'znova' : 'odteraz'} z meniča`;
    return {
        nadpis: obnovene ? 'Meranie sa obnovilo' : 'Meranie pripojené',
        text: zdroj ? `${zdroj} – ${veta}` : `${veta[0].toUpperCase()}${veta.slice(1)}`,
    };
}

/**
 * Slovo za čas v hlavičke, alebo prázdne, keď ho netreba: pri živom meraní
 * stačí čas, pri odhade hlavička píše vlastný text. @param {StavMeraniaVstup} stav
 */
export function stavMeraniaSlovo(stav) {
    if (stav.druh === 'zastarane') return STAV_SLOVO[stav.pricina ?? 'menic'];
    return stav.druh === 'spi' ? 'menič spí' : '';
}

/**
 * Bublina, keď meranie nejde, hoci je pripojené: menič v noci spí, appka nemá spojenie, alebo
 * menič mlčí za slnka - vtedy aj ako dlho, keď je čas merania známy. Texty sú bez oslovenia,
 * v oboch tónoch rovnaké. @param {StavMeraniaVstup} stav
 */
function stojiText(stav) {
    const mlci = stav.mlci ?? null;
    if (stav.druh === 'spi')
        return {
            nadpis: 'Menič spí',
            text:
                mlci === null
                    ? 'Slnko je pod obzorom a menič nemá čo merať. Ráno sa ozve sám.'
                    : `Posledné meranie prišlo o ${stav.cas}, odvtedy slnko zapadlo a menič nemá čo merať. Ráno sa ozve sám.`,
            tlacidlo: '',
        };
    if (stav.pricina === 'spojenie')
        return {
            nadpis: 'Appka nemá spojenie',
            text: `Od ${stav.cas} sa appka nedostala k novým dátam. Najčastejšie je to slabý signál alebo vypnuté dáta v telefóne. Karty zatiaľ rátajú s predpoveďou. Keď sa spojenie vráti, appka sa obnoví sama.`,
            tlacidlo: '',
        };
    const odkedy =
        mlci === null
            ? `Od ${stav.cas} neprišlo nové meranie.`
            : `Menič mlčí od ${stav.cas}, už ${countdownText(mlci)}, hoci slnko svieti.`;
    return {
        nadpis: 'Meranie je zastarané',
        text: `${odkedy} Karty zatiaľ rátajú s predpoveďou. Býva za tým výpadok internetu pri meniči alebo u výrobcu – appka to skúša ďalej sama.`,
        tlacidlo: '',
    };
}

/**
 * Vysvetlenie stavu merania - bublina pri bodke a čase v hlavičke: nadpis, text
 * a pri stavoch, kde treba niečo urobiť, tlačidlo do Nastavenia (inak prázdne).
 * @param {StavMeraniaVstup} stav @param {import('./messages-zaklad.js').Voice} [voice] @returns {{ nadpis: string, text: string, tlacidlo: string }}
 */
export function stavMeraniaText(stav, voice = 'drzy') {
    const w = polite(voice) ? STAV_SLOVA_SLUSNE : STAV_SLOVA;
    switch (stav.druh) {
        case 'zive':
            return {
                nadpis: 'Živé meranie',
                text: `Menič poslal výkon o ${stav.cas}. Karty počítajú s tým, čo ${w.tvoja} strecha vyrába práve teraz. Ďalšie meranie príde o pár minút.`,
                tlacidlo: '',
            };
        case 'spi':
        case 'zastarane':
            return stojiText(stav);
        case 'neprislo':
            return {
                nadpis: 'Meranie neprišlo',
                text: `Appka sa na meranie pýtala, ale odpoveď neprišla. Karty rátajú s predpoveďou. O chvíľu to skúsi znova, ${w.nemusis} nič robiť.`,
                tlacidlo: '',
            };
        case 'znova':
            return {
                nadpis: 'Meranie treba pripojiť znova',
                text: `${stav.neplati?.riadok ?? 'Výrobca prestal prijímať prístup'}, ktorý ${w.zadal}. Kým meranie ${w.nepripojis} znova, karty rátajú s predpoveďou.`,
                tlacidlo: 'Pripojiť znova ›',
            };
        default:
            return {
                nadpis: 'Odhad z predpovede',
                text: `Meranie nie je pripojené. Čísla sú odhad z predpovede počasia a ${w.tvojich} panelov. Ak ${w.tvoj} menič posiela dáta cez internet, ${w.pripoj} ho v Nastavení.`,
                tlacidlo: 'Pripojiť meranie ›',
            };
    }
}

/** Slová vysvetlenia stavu merania, ktoré sa v tóne líšia (tykanie a vykanie). */
const STAV_SLOVA = {
    tvoja: 'tvoja',
    tvojich: 'tvojich',
    tvoj: 'tvoj',
    nemusis: 'nemusíš',
    zadal: 'si zadal',
    nepripojis: 'nepripojíš',
    pripoj: 'pripoj',
};
/** @type {typeof STAV_SLOVA} */
const STAV_SLOVA_SLUSNE = {
    tvoja: 'vaša',
    tvojich: 'vašich',
    tvoj: 'váš',
    nemusis: 'nemusíte',
    zadal: 'ste zadali',
    nepripojis: 'nepripojíte',
    pripoj: 'pripojte',
};
