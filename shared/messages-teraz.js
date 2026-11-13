// Texty karty Teraz: číslo a stav, čo zapnúť, panel štítka. Čisté funkcie bez DOM.

import { MINUTES_PER_DAY } from './config.js';
import { fmt1, kwpRoughText, weekDateLabel, weekDayName } from './format.js';
import { HERO_SAY, MOZEM_SKY_TEXTS, PLAN_AFTER, countdownText, laterWhen, mozemTexts } from './messages-mozem.js';
import { andList, cap, dniSlovo, endHm, hm, onDay, polite, spanText } from './messages-zaklad.js';

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
    // Panel štítka pod číslom: nadpis vysvetlenia.
    chipWhy: 'Čo to znamená',
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
// Riadok nad dlaždicami (odkiaľ ide prúd teraz), dlaždice toho, čo ide teraz, skupiny riadkov
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

/** Sieť teraz do riadku nad dlaždicami; bežná cena slovo nemá. */
const SIET_TERAZ = /** @type {Record<string, string>} */ ({ lacna: 'sieť je teraz lacná', draha: 'sieť je teraz drahá' });

/**
 * Riadok nad dlaždicami: odkiaľ ide prúd teraz (`slnko`, `siet`), a keď teraz nejde nič, či ešte
 * dnes príde slnko (`pockaj`), alebo už nie (`dnesNic` - dnes ešte lacná sieť, `nic` - dnes nič).
 * Keď teraz nič nejde, `sub` povie cenu siete. Keď zo slnka dnes už nič a niečo pôjde zo slnka iný
 * deň (`dalej`), povie namiesto ceny kedy („zajtra od 07:30“) - zoznam pod tým sú časy iného dňa.
 * @param {{ druh: 'slnko' | 'siet' | 'pockaj' | 'dnesNic' | 'nic', level: string, dalej?: { name: string, start: number } | null }} o
 * @param {import('./messages-zaklad.js').Voice} [voice]
 */
export function terazOkoText({ druh, level, dalej = null }, voice = 'drzy') {
    if (druh === 'slnko') return { text: 'Teraz zo slnka', sub: '' };
    if (druh === 'siet') return { text: 'Teraz z lacnej siete', sub: '' };
    const text = druh === 'pockaj' ? mozemTexts(voice).MOZEM_CHIPS.wait : druh === 'dnesNic' ? 'Zo slnka dnes už nič' : 'Dnes už nič';
    if (druh !== 'pockaj' && dalej) return { text, sub: `${onDay(dalej.name)} od ${hm(dalej.start)}` };
    return { text, sub: SIET_TERAZ[level] ?? '' };
}

/** Pod riadkom nad dlaždicami, keď teraz ide len lacná sieť a slnko dnes nestačí vôbec. */
export const TERAZ_BEZ_SLNKA = 'Slnko dnes na veľké veci nestačí.';

/**
 * Pod menom dlaždice toho, čo ide teraz: kedy dobehne, auto dokedy a koľko km zo slnka, v lacnom
 * pásme dokedy je lacné.
 * @param {{ id: string, kind: 'sun' | 'cheap', end: number, km?: number | null }} r @param {import('./messages-zaklad.js').Voice} [voice]
 */
export function terazDlazdicaText(r, voice = 'drzy') {
    if (r.kind === 'cheap') {
        if (r.id !== 'auto') return `lacný prúd do ${koniecHm(r.end)}`;
        return `${polite(voice) ? 'nabíjajte' : 'nabíjaj'} do ${koniecHm(r.end)} · lacný prúd`;
    }
    if (r.id === 'auto') return r.km ? `do ${hm(r.end)} · ~${r.km} km` : `do ${hm(r.end)}`;
    return `dobehne ${hm(r.end)}`;
}

/**
 * Dlaždica s rámom, keď teraz nejde nič: o koľko príde najbližšia vec a odkiaľ.
 * @param {{ kind: 'sun' | 'cheap', start: number }} r @param {number} nowMin
 */
export function terazDalsiText(r, nowMin) {
    return `za ${terazZaText(Math.max(0, r.start - nowMin))} · ${r.kind === 'cheap' ? 'lacný prúd' : 'zo slnka'}`;
}

/**
 * Riadok v skupine: veľký čas a pod menom doplnok - dobehne, po čom ide, km auta, lacný prúd.
 * Riadok „tento týždeň nie“ má namiesto času pomlčku.
 * @param {import('./plan-dna.js').PlanRow} r @returns {{ cas: string, info: string }}
 */
export function terazRiadokText(r) {
    if (r.kind === 'none') return { cas: '–', info: 'slnko podľa predpovede nestačí' };
    if (r.kind === 'cheap') return { cas: hm(r.start), info: 'lacný prúd' };
    const start = r.kind === 'later' ? r.day.start : r.start;
    const after = r.after ? (PLAN_AFTER[r.after] ?? '') : '';
    if (after) return { cas: hm(start), info: after };
    if (r.id === 'auto') return { cas: hm(start), info: r.kind === 'sun' && r.km ? `~${r.km} km zo slnka` : 'zo slnka' };
    return { cas: hm(start), info: `dobehne ${hm(r.end)}` };
}

/**
 * Nadpis skupiny riadkov: dnes neskôr (`teraz` - nad ňou sú dlaždice toho, čo ide teraz), čo ide
 * v zvolený deň zo slnka, a čo sa na slnko nezmestí a pôjde aspoň najmenej zo siete.
 * @param {{ druh: 'dnes', teraz: boolean } | { druh: 'slnko' } | { druh: 'nudza' }} g
 */
export function terazSkupinaText(g) {
    if (g.druh === 'dnes') return g.teraz ? 'Neskôr dnes' : 'Potom';
    return g.druh === 'slnko' ? 'Zo slnka' : 'Najmenej zo siete';
}

/**
 * Hlavička plánu iného dňa na karte Teraz (docs/navrhy/teraz-vyhlad-alternativy.html, C): meno dňa
 * a pod ním dátum (pri zajtrajšku aj meno dňa - nadpis je „Zajtra“), o koľko dní to je a keď slnko
 * na veľké spotrebiče v ten deň nestačí (`nad` false), aj to.
 * @param {{ date: string, index: number, nad: boolean }} d
 */
export function terazDenHlavickaText({ date, index, nad }) {
    const datum = index === 1 ? `${weekDayName(date, 2).toLowerCase()} ${weekDateLabel(date)}` : weekDateLabel(date);
    const pod = [datum, index > 1 ? `o ${index} ${dniSlovo(index)}` : '', nad ? '' : 'pod hranicou'].filter(Boolean).join(' · ');
    return { nazov: weekDayName(date, index), pod };
}

/**
 * Riadok nad dlaždicami, keď slnko na spotrebiče príde až o viac dní: deň so slnkom (`name`,
 * null = v predpovedi žiadny) a koľko dní pred ním je zamračených (`oblacne`).
 * @param {{ name: string | null, oblacne: number }} p
 */
export function terazPasOkoText({ name, oblacne }) {
    if (!name) return { text: 'Slnko tento týždeň nestačí', sub: 'celý týždeň zamračené' };
    if (oblacne === 1) return { text: `Slnko až ${onDay(name)}`, sub: 'zajtra zamračené' };
    return { text: `Slnko až ${onDay(name)}`, sub: `${oblacne} ${dniSlovo(oblacne)} ${oblacne < 5 ? 'zamračené' : 'zamračených'}` };
}

/** Vo vysvetlení za „i“, keď slnko príde až o viac dní - predpoveď o niekoľko dní je menej istá. */
export const TERAZ_PAS_ISTOTA = 'Predpoveď na viac dní dopredu je menej istá, ešte sa môže zmeniť.';

/** Hrebeň týždňa na karte Teraz: meno skupiny tlačidiel dní a čo čítačka povie o dni pod hranicou. */
export const TERAZ_HREBEN = { label: 'Plán podľa dňa', pod: 'slnko na veľké spotrebiče nestačí' };

/**
 * Odznak na dlaždici a v riadku toho, čo ide dnes zo slnka: kedy bude slnko na ten spotrebič
 * najbližšie, keď to nie je zajtra (`dalsi` null = v predpovedi už nie). `dlho`: dva a viac dní bez slnka.
 * @param {{ name: string, index: number } | null} dalsi
 */
export function terazPotomText(dalsi) {
    if (!dalsi) return { text: 'potom tento týždeň nie', dlho: true };
    const dlho = dalsi.index > 2;
    return { text: `potom ${dlho ? 'až ' : ''}${onDay(dalsi.name)}`, dlho };
}

/** Koľko programu pokryje slnko, slovom. @param {number} p podiel 0 až 1 */
function podielSlovo(p) {
    if (p >= 0.85) return 'takmer celé zo slnka';
    if (p >= 0.6) return 'dve tretiny zo slnka';
    if (p >= 0.42) return 'polovica zo slnka';
    return p >= 0.25 ? 'tretina zo slnka' : 'trochu zo slnka';
}

/**
 * Núdzový čas spotrebiča v deň, keď sa na slnko nezmestí (shared/tyzden.js): veľký čas a doplnok
 * riadku, a pre detail kedy, od-do a prečo. `zdroj`: cez deň s kúskom slnka, v lacnom pásme, aspoň
 * mimo drahého pásma, alebo je to jedno (`start` null). Pri dnešku (`dnes`) povie aj, kedy pôjde celý zo slnka (`potom`, meno
 * dňa, null = v predpovedi nie). Bez ceny v € - tá je len pri aute.
 * @param {{ start: number | null, end: number | null, podiel: number | null, zdroj: 'slnko' | 'lacna' | 'bezna' | 'siet',
 *   dnes: boolean, potom: string | null }} r
 * @param {import('./messages-zaklad.js').Voice} [voice]
 */
export function terazNudzaText(r, voice = 'drzy') {
    const od = r.start === null ? '' : hm(r.start);
    const info = { slnko: podielSlovo(r.podiel ?? 0), lacna: 'lacný prúd', bezna: 'mimo drahej siete', siet: 'slnko nepomôže' }[r.zdroj];
    return {
        cas: od || '–',
        info: r.dnes && r.potom ? `${info} · naplno ${onDay(r.potom)}` : info,
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
    const zdroj = r.kind === 'cheap' ? 'z lacnej siete' : 'zo slnka';
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

/** Pásik pod číslom karty Teraz pre čítačku: koľko z jasnej oblohy. @param {number} pct */
export function terazJasText(pct) {
    return `${pct} % z toho, čo by dala jasná obloha.`;
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

// ---- Panel štítka na karte Teraz ----------------------------------------------------
// Ťuknutie na štítok pod číslom otvorí panel: nadpis, čo platí teraz (časy, čísla) a čo štítok
// znamená vždy (docs/navrhy/teraz-odznaky-vysvetlenie.html). Veta pod štítkami sa v ňom neopakuje.

/** @typedef {{ title: string, now: string, why: string }} ChipInfo */

/** Pevné texty panelu v oboch tónoch: nadpisy, ktoré nezávisia od času, a čo štítok znamená. */
const CHIP_TEXTS = {
    drzy: {
        big: 'veľké veci',
        dnesDa: 'Strecha dnes dá len',
        title: {
            go: 'Slnko teraz stačí',
            wait: 'Slnko príde neskôr',
            slabo: 'Dnes je slabý deň',
            none: 'Slnko skončilo zmenu',
            offline: 'Nemám dáta',
            bezpanelov: 'Nepoznám tvoje panely',
            loading: '',
        },
        why: {
            go: 'Áno znamená, že strecha teraz vyrába viac, než minie dom a k tomu veľký spotrebič. Čo zapneš, ide zo slnka, nie zo siete.',
            wait: 'Strecha už vyrába, ale na veľký spotrebič ešte nestačí – teraz by ťahal časť prúdu zo siete.',
            slabo: 'Je oblačno a výkon dnes ani na chvíľu nedosiahne čiaru „veľké spotrebiče“ v grafe.',
            none: 'Na veľké spotrebiče už dnes slnko nestačí. Čo zapneš, pôjde väčšinou zo siete.',
            offline: 'Bez predpovede a merania netvrdím áno ani nie. Keď sa dáta vrátia, odpoveď príde sama.',
            bezpanelov: 'Chýba mi výkon panelov a ich smer. Stačí ich raz zadať v Nastavení.',
            loading: '',
            lacna: 'Čo slnko nepokryje, je teraz zo siete lacnejšie. Auto či bojler sa oplatí pustiť aj bez slnka.',
            draha: 'Každá kWh zo siete je teraz najdrahšia. Čo nemusí bežať, odlož na slnko alebo do lacného pásma.',
        },
    },
    slusny: {
        big: 'veľké spotrebiče',
        dnesDa: 'Strecha dnes vyrobí len',
        title: {
            go: 'Slnko teraz stačí',
            wait: 'Slnko príde neskôr',
            slabo: 'Dnes je slabý deň',
            none: 'Slnko dnes už nevyrába',
            offline: 'Nemám dáta',
            bezpanelov: 'Nepoznám vaše panely',
            loading: '',
        },
        why: {
            go: 'Áno znamená, že strecha teraz vyrába viac, než minie dom a k tomu veľký spotrebič. Čo zapnete, ide zo slnka, nie zo siete.',
            wait: 'Strecha už vyrába, ale na veľký spotrebič ešte nestačí – teraz by ťahal časť prúdu zo siete.',
            slabo: 'Je oblačno a výkon dnes ani na chvíľu nedosiahne čiaru „veľké spotrebiče“ v grafe.',
            none: 'Na veľké spotrebiče už dnes slnko nestačí. Čo zapnete, pôjde väčšinou zo siete.',
            offline: 'Bez predpovede a merania netvrdím áno ani nie. Keď sa dáta vrátia, odpoveď príde sama.',
            bezpanelov: 'Chýba mi výkon panelov a ich smer. Stačí ich raz zadať v Nastavení.',
            loading: '',
            lacna: 'Čo slnko nepokryje, je teraz zo siete lacnejšie. Auto či bojler sa oplatí pustiť aj bez slnka.',
            draha: 'Každá kWh zo siete je teraz najdrahšia. Čo nemusí bežať, odložte na slnko alebo do lacného pásma.',
        },
    },
};

/** Pevné texty panelu v tóne. @param {import('./messages-zaklad.js').Voice} voice */
const chipTexts = (voice) => CHIP_TEXTS[polite(voice) ? 'slusny' : 'drzy'];

/** Prvé písmeno malé: „zajtra od 11:00“ do stredu vety. @param {string} s */
const low1 = (s) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Údaje dňa z hlavičky karty pre panel štítka stavu. `window`: okno slnka na veľké veci (teraz,
 * najbližšie, alebo dnešné posledné), `sunLeft`: slnko dnes ešte stačí na niečo.
 * @typedef {{ ctx: import('./messages-mozem.js').DayCtx, window: import('./messages-mozem.js').MozemWindow | null, nextDay: import('./messages-mozem.js').LaterDay | null, measured: boolean, todayKwh: number | null,
 *   plan: import('./messages-mozem.js').PlanHero | null, sunLeft: boolean }} ChipDay
 */
/** @typedef {(typeof CHIP_TEXTS)['drzy']} ChipTexts */

/** Áno: dokedy slnko na veľké veci stačí. @param {ChipDay} d @param {ChipTexts} T */
function goNow({ ctx, window: w }, T) {
    const n = ctx.nowMin;
    return w && w.from <= n && n < w.to ? `Na ${T.big} stačí do ${endHm(w.to)}, ešte ${countdownText(w.to - n)}.` : '';
}

/** Počkaj: kedy slnko príde - na prvú vec z plánu, bez plánu na veľké veci. @param {ChipDay} d */
const waitStart = ({ ctx, window: w, plan }) => (plan?.next ? plan.next.start : w ? w.from : ctx.nowMin);

/** Počkaj: za koľko slnko príde a dokedy vydrží. @param {ChipDay} d */
function waitNow(d) {
    const w = d.window;
    const until = w && w.from > d.ctx.nowMin ? `, vydrží do ${endHm(w.to)}` : '';
    return `Za ${countdownText(waitStart(d) - d.ctx.nowMin)}${until}.`;
}

/** Slabý deň: koľko strecha dnes dá a kedy slnko znova stačí. @param {ChipDay} d @param {ChipTexts} T */
function slaboNow({ todayKwh, nextDay }, T) {
    /** @type {string[]} */ const now = [];
    if (todayKwh !== null) now.push(`${T.dnesDa} ~${Math.round(todayKwh)} kWh.`);
    if (nextDay) now.push(`Najbližšie slnko na ${T.big}: ${low1(laterWhen(nextDay))}.`);
    return now.join(' ');
}

/** Dnes už nie: dokedy slnko stačilo, koľko dnes nabehlo a kedy znova. @param {ChipDay} d @param {ChipTexts} T @param {import('./messages-mozem.js').HeroSay} say */
function noneNow({ window: w, sunLeft, todayKwh, measured, nextDay }, T, say) {
    /** @type {string[]} */ const now = [];
    if (!sunLeft && w) now.push(`Na ${T.big} stačilo do ${endHm(w.to)}.`);
    if (todayKwh !== null) now.push(cap(`${measured ? say.made : 'dnes podľa predpovede'} ${fmt1(todayKwh)} kWh.`));
    if (nextDay) now.push(`Znova ${low1(laterWhen(nextDay))}.`);
    return now.join(' ');
}

/**
 * Panel štítka stavu: nadpis a čo platí teraz podľa údajov dňa z hlavičky karty, pod tým stále
 * vysvetlenie. Bez údajov dňa (dáta nie sú, panely nie sú) len nadpis a vysvetlenie.
 * @param {import('./mozem.js').MozemState} state @param {ChipDay | null} data
 * @param {import('./messages-zaklad.js').Voice} [voice] @returns {ChipInfo}
 */
export function mozemChipInfo(state, data, voice = 'drzy') {
    const T = chipTexts(voice);
    const why = T.why[state];
    if (!data || state === 'loading' || state === 'offline' || state === 'bezpanelov') return { title: T.title[state], now: '', why };
    if (state === 'go') return { title: T.title.go, now: goNow(data, T), why };
    if (state === 'wait') return { title: `Slnko príde o ${hm(waitStart(data))}`, now: waitNow(data), why };
    if (state === 'slabo') return { title: T.title.slabo, now: slaboNow(data, T), why };
    const say = HERO_SAY[polite(voice) ? 'slusny' : 'drzy'];
    // Slnko ešte svieti, len na nič z plánu nestačí - nadpis je tá istá veta ako v hlavičke karty.
    return { title: data.sunLeft ? say.nostrong.slice(0, -1) : T.title.none, now: noneNow(data, T, say), why };
}

/** Štítok ceny podľa úrovne pásma. @type {Record<import('./config.js').PriceLevel, import('./day-chart.js').Tone>} */
const LEVEL_TONE = { lacna: 'cheap', bezna: 'plain', draha: 'costly' };

/** Koniec pásma: za polnocou čas zajtrajška, polnoc ako „24:00“. @param {number} min minúta od dnešnej polnoci */
const runEndHm = (min) => endHm(min > MINUTES_PER_DAY ? min - MINUTES_PER_DAY : min);

/**
 * Panel štítka ceny siete: dokedy pásmo platí a čo príde potom.
 * @param {'lacna' | 'draha'} level
 * @param {{ to: number, next: { level: import('./config.js').PriceLevel, to: number } | null }} run
 *   koniec pásma a nasledujúce pásmo s koncom, v minútach od dnešnej polnoci (za polnocou viac ako deň)
 * @param {import('./messages-zaklad.js').Voice} [voice] @returns {ChipInfo}
 */
export function mozemNetInfo(level, run, voice = 'drzy') {
    const title = cap(`${TERAZ_TONES[LEVEL_TONE[level]]} do ${runEndHm(run.to)}`);
    const now = run.next ? `Potom ${TERAZ_TONES[LEVEL_TONE[run.next.level]]} do ${runEndHm(run.next.to)}.` : '';
    return { title, now, why: chipTexts(voice).why[level] };
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
 * triedy dňa (silnyDen v den-trieda.js). Veľká hodnota je kedy, veta k nej.
 * @param {{ wait: string | null, todayStrong: boolean, next: { name: string, kwh: number } | null }} d
 */
export function dnesLepsieText({ wait, todayStrong, next }) {
    const name = next ? next.name.toLowerCase() : '';
    const okolo = next ? `okolo ${Math.round(next.kwh)} kWh` : '';
    if (wait)
        return {
            value: `o ${wait}`,
            text: next ? `Dnes ešte silnejšie slnko. Najbližší silný deň: ${name}, ${okolo}.` : 'Dnes ešte silnejšie slnko.',
        };
    if (next) return { value: name, text: `Najbližší silný deň, ${okolo}.${todayStrong ? ' Aj dnešok je silný.' : ''}` };
    return todayStrong
        ? { value: 'dnes', text: 'Dnes je silný deň, ďalší taký v predpovedi nie je.' }
        : { value: 'tento týždeň nie', text: 'Silný deň v predpovedi na týždeň nie je.' };
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
 * Karta Najviac slnka: najsilnejšia hodina dneška podľa predpovede.
 * @param {{ from: number, kw: number }} d minúta začiatku hodiny a výkon strechy v nej @param {import('./messages-zaklad.js').Voice} voice
 */
export function dnesSlnkoText({ from, kw }, voice) {
    return {
        value: `${hm(from)} – ${endHm(from + 60)}`,
        text: `Strecha vtedy dá až ~${fmt1(kw)} kW. Auto alebo dve veci naraz ${polite(voice) ? 'dajte' : 'daj'} sem.`,
    };
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
