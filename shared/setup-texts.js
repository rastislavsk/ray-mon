// Texty a čísla sprievodcu nastavením: otázky, popisy tlačidiel, hlásenia pod poľami a riadky
// zhrnutia. Obe appky ich kreslia každá po svojom (web/render/nastavenie.js, obloha/web/render/),
// ale pýtajú sa rovnako - preto sú texty tu, na jednom mieste. Žiadne HTML, len reťazce a dáta.

import { installedKw, SETTINGS_LIMITS, SETUP } from './config.js';
import { fmt2, hoursText, kwpText, minutesToTimeStr } from './format.js';
import { checkSettings, sameSettings, siteMetaText, totalPanels } from './settings.js';
import { SETUP_SECTIONS, setupSection } from './setup.js';
import { isWelcome, savedSettings, schedIndex } from './setup-flow.js';
import { clearDayKwh, localDateKey, sunTimes } from './solar.js';
import { autoLevels, isSeasonSchedule, isWeekendSchedule, scheduleRuns, tariffHint, tariffPricesText } from './tariff.js';

/** @typedef {import('./settings.js').Settings} Settings */
/** @typedef {import('./setup.js').SetupStep} SetupStep */
/** @typedef {import('./setup-flow.js').SetupState} SetupState */
/** @typedef {import('./config.js').Tariff} Tariff */
/** @typedef {import('./config.js').PriceLevel} PriceLevel */
/** @typedef {{ text: string, err: boolean }} Note hlásenie pod poľom; `err` blokuje ďalší krok */

/** Smery kompasu po 45°. */
export const DIRS = [
    { az: 0, short: 'S', name: 'Sever' },
    { az: 45, short: 'SV', name: 'Severovýchod' },
    { az: 90, short: 'V', name: 'Východ' },
    { az: 135, short: 'JV', name: 'Juhovýchod' },
    { az: 180, short: 'J', name: 'Juh' },
    { az: 225, short: 'JZ', name: 'Juhozápad' },
    { az: 270, short: 'Z', name: 'Západ' },
    { az: 315, short: 'SZ', name: 'Severozápad' },
];

/** Typy striech - to, čo človek o svojej streche vie, namiesto stupňov. */
export const TILT_PRESETS = [
    { deg: 10, name: 'Plochá', sub: 'na stojanoch, ~10°' },
    { deg: 20, name: 'Mierna', sub: '~20°' },
    { deg: 35, name: 'Bežná šikmá', sub: '~35°' },
    { deg: 45, name: 'Strmá', sub: '~45°' },
    { deg: 90, name: 'Na stene', sub: 'fasáda, 90°' },
];

/** Otázka na polohu pri prvom otvorení appky - jediné, čo appka bez nej chce vedieť. */
const WELCOME = {
    title: 'Kde máš elektráreň?',
    lead: 'Podľa polohy appka stiahne predpoveď počasia a vie, kedy u teba svieti slnko. Panely a tarifu doplníš hneď potom, alebo kedykoľvek neskôr.',
};

/** @type {Record<SetupStep, { title: string, lead: string }>} */
const TEXTS = {
    start: {
        title: 'Nastavme tvoju elektráreň',
        lead: 'Sedem krátkych otázok. Na čo nevieš odpoveď, preskočíš tlačidlom „Neviem“ a všetko sa dá neskôr zmeniť.',
    },
    odkaz: {
        title: 'Vlož odkaz s nastavením',
        lead: 'Odkaz ti mohol poslať niekto, kto appku už používa. Pred uložením uvidíš, čo obsahuje.',
    },
    lokalita: {
        title: 'Kde je tvoja elektráreň?',
        lead: 'Podľa polohy appka vie, kde je na oblohe slnko a ktorá hodina je tam miestna.',
    },
    panel: {
        title: 'Aký výkon má jeden panel?',
        lead: 'Nájdeš ho na štítku na zadnej strane panelu pri „Pmax“, alebo v zmluve, napríklad „24 × 435 Wp“.',
    },
    smer: {
        title: 'Kam smerujú panely?',
        lead: 'Ťukni na stranu, na ktorú je strecha s panelmi otočená. Oranžový oblúk je dráha slnka cez deň.',
    },
    sklon: { title: 'Aká strmá je strecha?', lead: 'Vyber typ strechy. Kto pozná presné stupne, doladí ich posúvačom.' },
    pocet: { title: 'Koľko panelov je na tejto ploche?', lead: '' },
    dalsia: {
        title: 'Máš panely aj na inej strane strechy?',
        lead: 'Napríklad časť na juh a časť na východ. Každá strana je samostatná plocha, najviac tri.',
    },
    menic: { title: 'Aký veľký je menič?', lead: '' },
    meranie: {
        title: 'Chceš vidieť skutočný výkon?',
        lead: 'Bez merania appka ukazuje odhad z predpovede počasia. S meraním vidíš aj to, čo panely naozaj vyrábajú.',
    },
    tarifa: {
        title: 'Ako platíš za elektrinu?',
        lead: 'Podľa toho appka zafarbí ciferník a poradí, kedy zapínať spotrebiče. Nájdeš to na faktúre alebo v zmluve.',
    },
    pasma: { title: 'Aké pásma máš?', lead: 'Pomenuj ich ako na faktúre. Úroveň hovorí appke, akou farbou ich kresliť.' },
    rozvrh: { title: 'Kedy platí ktoré pásmo?', lead: 'Vyber pásmo a prejdi prstom po kruhu. Krok je 15 minút.' },
    vynimky: { title: 'Platí to každý deň rovnako?', lead: 'Niektoré tarify majú iný rozvrh cez víkend alebo v časti roka.' },
    ceny: {
        title: 'Koľko stojí kilowatthodina?',
        lead: 'Nepovinné, stačí približne. S cenami appka sama určí, ktoré pásmo je lacné a ktoré drahé.',
    },
    suhrn: { title: 'Skontroluj a ulož', lead: 'Ťuknutím na riadok ho opravíš a vrátiš sa sem.' },
};

/** Typy sadzby na výber. Spot appka zatiaľ nevie, ponúka sa vypnutý. */
export const TARIFF_KINDS = /** @type {const} */ ([
    { kind: 'jedna', title: 'Jedna cena celý deň', sub: 'jednotarif' },
    { kind: 'dvoj', title: 'Lacnejšie a drahšie hodiny', sub: 'dvojtarif · VT a NT · nočný prúd' },
    { kind: 'viac', title: 'Tri a viac pásiem', sub: 'špička · bežné · mimo špičky' },
    { kind: 'spot', title: 'Cena sa mení každú hodinu', sub: 'spot · dynamická cena · pripravujeme' },
]);

/** Čo appka urobí, keď človek pri tarife nevie. */
export const TARIFF_DUNNO =
    'Appka bude počítať s jednou cenou a ciferník zafarbí len podľa slnka. Tarifu nájdeš na faktúre alebo v zmluve a doplníš ju kedykoľvek v Nastavení.';

/** Úroveň pásma slovom. @type {Record<PriceLevel, { name: string, label: string }>} */
export const LEVELS = {
    lacna: { name: 'Lacné', label: 'lacné' },
    bezna: { name: 'Bežné', label: 'bežné' },
    draha: { name: 'Drahé', label: 'drahé' },
};

/** Popisky záložiek pri úprave tarify z prehľadu. @type {Record<string, string>} */
export const TARIFF_TABS = { tarifa: 'Typ', pasma: 'Pásma', rozvrh: 'Rozvrh', vynimky: 'Výnimky', ceny: 'Ceny' };

export const MONTH_NAMES = [
    'január',
    'február',
    'marec',
    'apríl',
    'máj',
    'jún',
    'júl',
    'august',
    'september',
    'október',
    'november',
    'december',
];
export const MONTH_SHORT = ['jan', 'feb', 'mar', 'apr', 'máj', 'jún', 'júl', 'aug', 'sep', 'okt', 'nov', 'dec'];
const DAY_SHORT = ['Po', 'Ut', 'St', 'Št', 'Pi', 'So', 'Ne'];

/** Číslo do poľa formulára, s desatinnou čiarkou; neplatné ostane prázdne. @param {number | null} n */
export const fieldText = (n) => (n !== null && Number.isFinite(n) ? String(n).replace('.', ',') : '');

/** Názov smeru; mimo ôsmich smerov (staré nastavenie) aspoň stupne. @param {number} az */
export const dirName = (az) => (DIRS.find((d) => d.az === az) || { name: `${az}°` }).name;

/** Výkon v kW bez zbytočných núl: 10 kW, 7,5 kW. @param {number} kw */
export const kwText = (kw) => `${fieldText(Math.round(kw * 10) / 10)} kW`;

/** Je lokalita v nastavení úplná (vybraná, nie rozpísaná)? @param {Settings} s */
export const hasSite = (s) => !!s.site.name && Number.isFinite(s.site.lat) && Number.isFinite(s.site.lon) && !!s.site.timezone;

/** Ako bol zadaný výkon: vlastné číslo, ktoré nie je medzi tlačidlami, sa ráta ako „iný“.
 * @param {import('./setup-flow.js').ValuePick} pick @param {number} value @param {number[]} choices */
export function effectivePick(pick, value, choices) {
    return pick === 'chip' && Number.isFinite(value) && !choices.includes(value) ? 'other' : pick;
}

/** Výkon jednej plochy, alebo null bez výkonu panelu. @param {Settings} s @param {import('./config.js').PlantString} x */
const roofKwp = (s, x) => (Number.isFinite(s.plant.panelWp) ? kwpText(installedKw({ ...s.plant, strings: [x] })) : null);

// ---- Hlavička a tlačidlá sprievodcu ----------------------------------------------------

/** Titulok a úvodná veta obrazovky; niektoré závisia od toho, čo už človek zadal.
 * @param {SetupState} state @param {Settings} draft @param {SetupStep} step */
export function textsFor(state, draft, step) {
    if (isWelcome(state, step)) return WELCOME;
    if (step === 'panel' && state.setupKwp !== null)
        return {
            title: 'Aký výkon má celá elektráreň?',
            lead: 'Nájdeš ho v zmluve alebo na faktúre, napríklad „10,44 kWp“. Výkon jedného panelu dopočítam, keď spočítame panely na strechách.',
        };
    if (step === 'dalsia' && draft.plant.strings.length >= SETTINGS_LIMITS.maxStrings)
        return { title: 'Tri plochy sú maximum', lead: 'Viac plôch appka nepočíta.' };
    if (step === 'menic') {
        const kwp = Number.isFinite(draft.plant.panelWp) ? `Panely majú spolu ${kwpText(installedKw(draft.plant))}. ` : '';
        return { title: TEXTS.menic.title, lead: `${kwp}Výkon meniča je na jeho štítku alebo v zmluve, napríklad SUN2000-10KTL je 10 kW.` };
    }
    return TEXTS[step];
}

/** Riadok nad ukazovateľom postupu. @param {SetupState} state @param {SetupStep} step */
export function stepLabel(state, step) {
    if (isWelcome(state, step)) return 'Vitaj';
    const section = setupSection(step);
    const name = section >= 0 ? SETUP_SECTIONS[section].name : '';
    if (state.setupReturn !== null) return `Úprava · ${name}`;
    if (section >= 0) return `Krok ${section + 1} z ${SETUP_SECTIONS.length} · ${name}`;
    return step === 'odkaz' ? 'Nastavenie z odkazu' : 'Moja elektráreň';
}

/** Časť sprievodcu pre ukazovateľ postupu, alebo -1, keď sa ukazovateľ neukazuje (úprava
 * jedného kroku, úvod, odkaz, otázka na polohu pri prvom otvorení). @param {SetupState} state @param {SetupStep} step */
export function progressSection(state, step) {
    return state.setupReturn !== null || isWelcome(state, step) ? -1 : setupSection(step);
}

/** Nápis na „Ďalej“. @param {SetupState} state @param {Settings} draft @param {SetupStep} step */
function nextLabel(state, draft, step) {
    if (state.setupReturn === 'suhrn') return 'Späť na zhrnutie';
    if (state.setupReturn === 'prehlad') return 'Uložiť zmenu';
    /** @type {Partial<Record<SetupStep, string>>} */
    const labels = {
        start: 'Začať',
        odkaz: 'Pozrieť a prevziať',
        lokalita: state.known === 'nic' ? 'Nastaviť panely' : 'Ďalej',
        dalsia: draft.plant.strings.length >= SETTINGS_LIMITS.maxStrings ? 'Ďalej' : 'Nie, to je všetko',
        meranie: state.setupLive ? 'Ďalej' : 'Preskočiť',
        suhrn: 'Uložiť a prepočítať',
    };
    return labels[step] || 'Ďalej';
}

/**
 * Tlačidlá dole a krížik: čo je na nich napísané, či sa dá ísť ďalej a či je Späť vôbec vidieť.
 * Čo „Ďalej“ urobí, rozhoduje nextAction v shared/setup-flow.js podľa toho istého stavu.
 * @param {SetupState} state @param {Settings} draft @param {SetupStep} step @param {boolean} ready (setupReady)
 */
export function footModel(state, draft, step, ready) {
    const ret = state.setupReturn;
    return {
        next: nextLabel(state, draft, step),
        nextOff: !ready || (ret === 'prehlad' && sameSettings(draft, savedSettings(state))),
        back: ret === 'prehlad' ? 'Zrušiť' : step === 'start' ? 'Neskôr' : 'Späť',
        backShown: ret !== 'suhrn' && !isWelcome(state, step),
        close: ret !== null ? 'Zrušiť úpravu' : 'Zavrieť sprievodcu',
        closeShown: !isWelcome(state, step),
    };
}

/** Riadok nad titulkom: ktorá plocha, alebo ktorý rozvrh tarify sa upravuje. @param {SetupState} state @param {Settings} draft @param {SetupStep} step @param {number} roof */
export function subText(state, draft, step, roof) {
    const n = draft.plant.strings.length;
    const t = draft.tariff;
    if (step === 'smer' || step === 'sklon' || step === 'pocet') return `Plocha ${roof + 1}${n > 1 ? ` z ${n}` : ''}`;
    if (step === 'rozvrh' && t.schedules.length > 1) return `Rozvrh · ${schedLabel(t, schedIndex(state, t))}`;
    return '';
}

// ---- Obrazovky ------------------------------------------------------------------------

/** Stav vyhľadávania polohy slovom, alebo null, keď je čo ukázať (zoznam) alebo nič. @param {import('./setup-flow.js').GeoSearch} geo */
export function geoNote(geo) {
    if (geo.status === 'loading') return 'Hľadám…';
    if (geo.status === 'error') return 'Vyhľadávanie teraz nefunguje. Skús to znova alebo zadaj súradnice.';
    if (geo.status === 'done' && !geo.results.length) return 'Nič som nenašiel. Skús väčšie mesto v okolí alebo súradnice.';
    return null;
}

/** Potvrdenie lokality tým, čo človek pozná: kedy u neho dnes vychádza a zapadá slnko. Bez
 * vybranej lokality null. @param {Settings} s @param {Date} now */
export function placeCard(s, now) {
    if (!hasSite(s)) return null;
    const today = localDateKey(now, s.site.timezone);
    const sun = sunTimes(s.site, today);
    const time = (/** @type {number | null} */ m) => (m === null ? '–' : minutesToTimeStr(m));
    const [, month, day] = today.split('-').map(Number);
    return { name: s.site.name, date: `dnes, ${day}. ${month}.`, rise: time(sun.rise), set: time(sun.set), meta: siteMetaText(s.site) };
}

/** Čo appka urobí s „Neviem“ pri výkone panelu. */
export const WP_GUESS = `Počítam s bežnými ${SETUP.guessPanelWp} Wp. V zhrnutí to bude označené ako odhad, kedykoľvek to opravíš.`;

/** Čo appka urobí s „Neviem“ pri meniči. */
export const AC_GUESS = 'Počítam s meničom rovnako veľkým ako panely. V zhrnutí to bude označené ako odhad.';

/** Hodnotenie smeru a sklonu: koľko energie to dá oproti najlepšiemu. @param {number} share 0-1 */
export function quality(share) {
    const pct = Math.round(share * 100);
    const [label, tier] =
        share >= 0.95 ? ['Výborné', 'green'] : share >= 0.85 ? ['Dobré', 'green'] : share >= 0.7 ? ['Slušné', 'amber'] : ['Slabšie', 'red'];
    return { label, tier, pct };
}

/** Riadok pod mriežkou panelov: koľko ich je a koľko to dá. `strong` sa píše tučne.
 * @param {SetupState} state @param {Settings} draft @param {number} roof */
export function panelsLine(state, draft, roof) {
    const x = draft.plant.strings[roof];
    const n = Number.isFinite(x.panels) ? x.panels : 0;
    if (state.setupKwp !== null)
        return { text: `${n} panelov · výkon panelu dopočítam z ${kwpText(state.setupKwp)}, keď budú spočítané všetky plochy`, strong: '' };
    if (!Number.isFinite(draft.plant.panelWp)) return { text: '', strong: '' };
    return { text: `${n} × ${fieldText(draft.plant.panelWp)} Wp = `, strong: /** @type {string} */ (roofKwp(draft, x)) };
}

/** Plochy v prehľade plôch. @param {Settings} draft */
export function roofRows(draft) {
    return draft.plant.strings.map((x, i) => {
        const kwp = roofKwp(draft, x);
        return {
            az: x.azimuthDeg,
            title: `Plocha ${i + 1} · ${dirName(x.azimuthDeg)}`,
            sub: `${x.tiltDeg}° · ${x.panels} panelov${kwp ? ` · ${kwp}` : ''}`,
        };
    });
}

/** Výkon panelu dopočítaný z celkového výkonu - ukáže sa, keď sú spočítané všetky plochy.
 * Bez celkového výkonu null. @param {SetupState} state @param {Settings} draft @returns {Note | null} */
export function derivedNote(state, draft) {
    if (state.setupKwp === null) return null;
    const n = totalPanels(draft);
    const wp = draft.plant.panelWp;
    const L = SETTINGS_LIMITS.panelWp;
    if (Number.isFinite(wp) && wp >= L.min && wp <= L.max)
        return { text: `Spolu ${n} panelov a ${kwpText(state.setupKwp)}, teda ${Math.round(wp)} Wp na panel.`, err: false };
    return {
        text: `Z ${kwpText(state.setupKwp)} a ${n} panelov vychádza ${Number.isFinite(wp) ? Math.round(wp) : '–'} Wp na panel, to nie je možné (${L.min} až ${L.max} Wp). Skontroluj počty panelov alebo celkový výkon.`,
        err: true,
    };
}

/** Menič oproti panelom: dĺžky pásov (0-1) a veta. @param {Settings} draft (s dopočítaným výkonom panelu) @param {number} ac výkon meniča v poli */
export function menicModel(draft, ac) {
    const kwp = Number.isFinite(draft.plant.panelWp) ? installedKw(draft.plant) : 0;
    const top = Math.max(kwp, Number.isFinite(ac) ? ac : 0) * 1.05 || 1;
    const ratio = kwp / ac;
    const note = !Number.isFinite(ratio)
        ? null
        : ratio > SETTINGS_LIMITS.dcAcWarnRatio
          ? { text: `Panely majú viac, než menič zvládne. Za jasných dní bude menič orezávať špičky na ${kwText(ac)}.`, ok: false }
          : ratio > 1
            ? { text: 'Menič je o trochu menší než panely. To je bežné a skoro nič to nestojí.', ok: true }
            : { text: 'Menič zvládne plný výkon panelov.', ok: true };
    return {
        pv: { share: kwp / top, text: kwpText(kwp) },
        ac: { share: (Number.isFinite(ac) ? ac : 0) / top, text: Number.isFinite(ac) ? kwText(ac) : '–' },
        note,
    };
}

/** Hlásenie pod odkazom na kiosk, alebo null pri prázdnom poli. @param {string} kiosk @param {boolean} ok (kioskApiUrl) @returns {Note | null} */
export function kioskNote(kiosk, ok) {
    if (!kiosk) return null;
    return ok
        ? { text: 'Vyzerá to ako kiosk FusionSolar. Po uložení overím, či odpovedá.', err: false }
        : { text: 'Toto nie je odkaz na kiosk FusionSolar. Skopíruj ho v appke FusionSolar pri zdieľaní elektrárne cez kiosk.', err: true };
}

/** Čo je v odkaze s nastavením. @param {Settings} found */
export function linkPreview(found) {
    const n = found.plant.strings.length;
    const dirs = found.plant.strings.map((x) => dirName(x.azimuthDeg).toLowerCase()).join(', ');
    return {
        name: found.site.name,
        kwp: kwpText(installedKw(found.plant)),
        meta: `${n === 1 ? '1 plocha' : `${n} plochy`} (${dirs}) · ${totalPanels(found)} panelov · menič ${kwText(found.plant.acLimitKw)}${found.kiosk ? ' · so živým meraním' : ''}`,
    };
}

// ---- Tarifa ---------------------------------------------------------------------------

const cap = (/** @type {string} */ s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Dni v týždni slovom. @param {number[]} days */
function daysText(days) {
    if (days.length === 7) return 'každý deň';
    if (days.join() === '6,7') return 'So – Ne';
    if (days.join() === '1,2,3,4,5') return 'Po – Pi';
    return days.map((d) => DAY_SHORT[d - 1]).join(', ');
}

/** Mesiace slovom; súvislé ako rozsah. @param {number[]} months */
function monthsText(months) {
    if (months.length === 12) return 'celý rok';
    const together = months.every((m, i) => i === 0 || m === months[i - 1] + 1);
    return together
        ? `${MONTH_NAMES[months[0] - 1]} – ${MONTH_NAMES[months[months.length - 1] - 1]}`
        : months.map((m) => MONTH_SHORT[m - 1]).join(', ');
}

/** Meno rozvrhu: základ sa volá podľa toho, aké výnimky má. @param {Tariff} t @param {number} i */
export function schedLabel(t, i) {
    const s = t.schedules[i];
    if (i > 0) return isWeekendSchedule(s) ? 'Víkend' : isSeasonSchedule(s) ? cap(monthsText(s.months)) : `Výnimka ${i}`;
    if (t.schedules.length === 1) return 'Každý deň';
    return t.schedules.some(isWeekendSchedule) ? 'Pracovné dni' : 'Zvyšok roka';
}

/** Kedy rozvrh platí. @param {Tariff} t @param {number} i */
export function schedDetail(t, i) {
    const s = t.schedules[i];
    if (i > 0) return `${daysText(s.days)} · ${monthsText(s.months)}`;
    return t.schedules.length === 1 ? 'každý deň · celý rok' : 'keď neplatí výnimka';
}

/** Koľko hodín denne platí ktoré pásmo v rozvrhu. @param {Tariff} t @param {import('./config.js').Schedule} schedule */
export function bandHoursText(t, schedule) {
    const runs = scheduleRuns(t, schedule);
    return t.bands
        .map((b) => ({ b, min: runs.filter((r) => r.band === b).reduce((sum, r) => sum + r.min, 0) }))
        .filter((x) => x.min)
        .map((x) => `${x.b.name} ${hoursText(x.min)}`)
        .join(' · ');
}

/** Šablóny tvaru dňa; dvojpásmová tarifa má viac. @param {Tariff} t */
export function scheduleTemplates(t) {
    if (t.bands.length !== 2) return [{ tpl: 'all', label: 'Všetko najlacnejšie', soft: true }];
    return [
        { tpl: '20h', label: 'Lacno 20 h, 4 h drahé', soft: false },
        { tpl: 'noc8', label: 'Lacno 8 h v noci', soft: false },
        { tpl: 'all', label: 'Všetko lacné', soft: true },
    ];
}

/** Voľby výnimiek v rozvrhu. */
export const EXCEPTIONS = /** @type {const} */ ([
    { what: 'none', title: 'Áno, každý deň rovnako', sub: 'jeden rozvrh na celý rok' },
    { what: 'weekend', title: 'Cez víkend je to inak', sub: 'sobota a nedeľa majú vlastný rozvrh' },
    { what: 'season', title: 'V časti roka je to inak', sub: 'napríklad letná a zimná sadzba' },
]);

/**
 * Úrovne podľa cien a či sedia s tými, ktoré má človek pri pásmach. `auto` sú pásma s úrovňou
 * podľa ceny (null, keď ceny nie sú všetky), `text` veta pod nimi, `fix` či ponúknuť opravu.
 * @param {Tariff} t
 */
export function priceCheck(t) {
    /** @param {string} text @param {boolean} [ok] */
    const only = (text, ok = false) => ({ auto: null, text, ok, fix: false });
    if (t.bands.length === 1) return only('Pri jednej cene je pásmo vždy bežné, ciferník farbí len slnko.');
    if (!t.bands.some((b) => b.price !== null)) return only('Bez cien appka použije úrovne, ktoré majú pásma teraz.');
    const auto = autoLevels(t.bands);
    if (!auto) return only('Doplň ceny všetkých pásiem a navrhnem, ktoré je lacné a ktoré drahé.');
    const list = t.bands.map((b) => ({
        level: auto[b.id],
        text: `${b.name} · ${fmt2(/** @type {number} */ (b.price))} ${t.currency} → ${LEVELS[auto[b.id]].label}`,
    }));
    const clash = t.bands.filter((b) => auto[b.id] !== b.level);
    if (!clash.length) return { auto: list, text: 'Úrovne pásiem sedia s cenami.', ok: true, fix: false };
    return {
        auto: list,
        text: `Podľa cien by ${clash.map((b) => `${b.name} bolo ${LEVELS[auto[b.id]].label}`).join(' a ')}, máš to inak.`,
        ok: false,
        fix: true,
    };
}

// ---- Zhrnutie a prehľad elektrárne ---------------------------------------------------

/**
 * Karta elektrárne: meno, celkový výkon, zostava a výroba za jasného dneška. Bez úplného
 * nastavenia (chýba výkon alebo poloha) null.
 * @param {Settings} s @param {Date} now
 */
export function plantHero(s, now) {
    const check = checkSettings(s);
    if (check.kwp === null || !hasSite(s)) return null;
    const today = localDateKey(now, s.site.timezone);
    return {
        name: s.site.name,
        kwp: check.kwp,
        panels: totalPanels(s),
        ac: kwText(s.plant.acLimitKw),
        clearKwh: Math.round(clearDayKwh(s.site, s.plant, today)),
        planes: s.plant.strings.map((x) => `${dirName(x.azimuthDeg).toLowerCase()} ${x.panels} panelov`).join(', '),
        dirs: [...new Set(s.plant.strings.map((x) => dirName(x.azimuthDeg).toLowerCase()))],
    };
}

/**
 * Riadky zhrnutia: poloha, panel, plochy, menič, meranie, tarifa. `key` je krok, ktorý riadok
 * otvorí (stepEdit), `az` smer plochy (len riadky plôch), `extra` druhý riadok pod hodnotou,
 * `guess` či je hodnota odhad z „Neviem“.
 * @param {Settings} s @param {SetupState} state
 */
export function summaryRows(s, state) {
    const wpExtra = state.setupKwp !== null ? `dopočítané z ${kwpText(state.setupKwp)}` : '';
    const prices = tariffPricesText(s.tariff);
    return [
        { key: 'lokalita', icon: 'poloha', az: null, label: 'Poloha', value: s.site.name || '–', extra: '', guess: false },
        {
            key: 'panel',
            icon: 'panel',
            az: null,
            label: 'Panel',
            value: Number.isFinite(s.plant.panelWp) ? `${Math.round(s.plant.panelWp)} Wp` : '–',
            extra: wpExtra,
            guess: !wpExtra && state.setupPick.wp === 'guess',
        },
        ...s.plant.strings.map((x, i) => ({
            key: `roof:${i}`,
            icon: '',
            az: /** @type {number | null} */ (x.azimuthDeg),
            label: `Plocha ${i + 1}`,
            value: `${dirName(x.azimuthDeg)} · ${x.tiltDeg}° · ${x.panels} panelov`,
            extra: roofKwp(s, x) ?? '–',
            guess: false,
        })),
        {
            key: 'menic',
            icon: 'menic',
            az: null,
            label: 'Menič',
            value: Number.isFinite(s.plant.acLimitKw) ? kwText(s.plant.acLimitKw) : '–',
            extra: '',
            guess: state.setupPick.ac === 'guess',
        },
        {
            key: 'meranie',
            icon: 'meranie',
            az: null,
            label: 'Živé meranie',
            value: s.kiosk ? 'kiosk FusionSolar' : 'bez merania, odhad z predpovede',
            extra: '',
            guess: false,
        },
        { key: 'tarifa', icon: '', az: null, label: 'Tarifa', value: tariffHint(s.tariff), extra: prices || 'bez cien', guess: false },
    ];
}

/** Označenie odhadu z „Neviem“ v zhrnutí. */
export const GUESS_MARK = 'odhad · oprav, keď zistíš';
