// Sprievodca nastavením ako zmeny stavu: čo urobí každé tlačidlo a pole sprievodcu s rozpísaným
// nastavením a kam sa pohne. Čisté funkcie - dostanú stav, vrátia zmenu (patch) pre setState.
// Používajú ich obe appky (súčasná cez web/setup-interactions.js, nová v obloha/), takže sa
// sprievodca správa v oboch rovnako. Ukladanie a sieť robí web/setup-wiring.js.

import {
    ALL_DAYS,
    ALL_MONTHS,
    installedKw,
    PRICE_LEVELS,
    SETTINGS_LIMITS,
    SETUP,
    TARIFF,
    TARIFF_LIMITS,
    TARIFF_TEMPLATES,
} from './config.js';
import { sameSettings, settingsFromLink, typicalSettings } from './settings.js';
import { emptySettings, newRoof, nextSetupPlace, prevSetupPlace, resolveDraft, setupStepOk } from './setup.js';
import {
    autoLevels,
    changesOf,
    isSeasonSchedule,
    isWeekendSchedule,
    newBandId,
    paintSlots,
    scheduleRuns,
    slotsOf,
    tariffKind,
} from './tariff.js';
import { sposobOf, sposobyOf, udajeOk, znackaOf } from './zdroje.js';

/** @typedef {import('./settings.js').Settings} Settings */
/** @typedef {import('./config.js').PlantString} PlantString */
/** @typedef {import('./config.js').Tariff} Tariff */
/** @typedef {import('./config.js').PriceLevel} PriceLevel */
/** @typedef {import('./setup.js').SetupStep} SetupStep */
/** @typedef {import('./zdroje.js').Zdroj} Zdroj */
/**
 * Elektráreň, ktorú Worker našiel pri pripojení: meno u výrobcu, zapečatený prístup práve k nej
 * a čo práve nameral (na kontrolu, že čísla sedia).
 * @typedef {{ nazov: string, pecat: string, pv: import('./kiosk.js').PvData | null }} Stanica
 */
/**
 * Pripájanie živého merania: `loading` čaká na Workera, `done` má nájdené elektrárne, `error`
 * nesie druh chyby (`udaje` výrobca údaje neprijal, `vyrobca` neodpovedá, `server` appka) a `kod`
 * krok a kód chyby od výrobcu (`prihlasenie:20400`), keď ho Worker poslal.
 * @typedef {{ status: 'idle' | 'loading' | 'done' | 'error', chyba: 'udaje' | 'vyrobca' | 'server' | '', kod?: string, stanice: Stanica[] }} Pripoj
 */
/** @typedef {'chip' | 'other' | 'guess'} ValuePick ako človek zadal hodnotu: tlačidlom, vlastným číslom, alebo „Neviem“ */
/**
 * @typedef {{ status: 'idle' | 'loading' | 'done' | 'error', results: Array<{ site: import('./config.js').Site, detail: string }> }} GeoSearch
 */
/**
 * Časť stavu appky, s ktorou pracuje sprievodca. Obe appky ju majú v stave s tými istými menami.
 * @typedef {{
 *   now: Date,
 *   known: import('./settings.js').Known,
 *   site: import('./config.js').Site,
 *   plant: import('./config.js').Plant,
 *   tariff: Tariff,
 *   zdroj: Zdroj | null,
 *   settingsDraft: Settings,
 *   settingsRev: number,
 *   settingsNote: string,
 *   geo: GeoSearch,
 *   setupStep: SetupStep | null,
 *   setupRoof: number,
 *   setupReturn: 'suhrn' | 'prehlad' | null,
 *   setupKwp: number | null,
 *   setupPick: { wp: ValuePick, ac: ValuePick },
 *   setupLive: boolean,
 *   setupZnacka: string,
 *   setupSposob: string,
 *   setupUdaje: Record<string, string>,
 *   setupPripoj: Pripoj,
 *   setupLink: string,
 *   setupSched: number,
 *   setupBrush: string | null,
 *   setupDunno: boolean,
 * }} SetupState
 */
/** @typedef {Partial<SetupState>} SetupPatch */
/**
 * Čo spraví „Ďalej“, „Späť“ či zatvorenie: `patch` je obyčajná zmena stavu, `back` krok späť
 * (pokiaľ sa dá, cez históriu prehliadača - ten istý krok ako Späť na telefóne), `site` uloží
 * samotnú polohu a `save` celé nastavenie. `extra` je zmena stavu, ktorá ide s uložením.
 * @typedef {{ type: 'patch', patch: SetupPatch }
 *   | { type: 'back', patch: SetupPatch }
 *   | { type: 'site', site: import('./config.js').Site, extra: SetupPatch }
 *   | { type: 'save', settings: Settings, extra: SetupPatch }} SetupAction
 */

/**
 * Sprievodca na začiatku: rozpísané je to, s čím appka počíta. Bez polohy začína otázkou na ňu.
 * @param {Settings} start uložené nastavenie, typická strecha v uloženej polohe, alebo prázdne
 * @param {import('./settings.js').Known} known
 */
export function setupInit(start, known) {
    return {
        // Rozpísaný formulár. Hodnoty polí píše render len pri zmene settingsRev (načítanie, výber
        // lokality, pridanie plochy, zahodenie zmien), inak by počas písania prepisoval to, čo
        // človek práve píše.
        settingsDraft: start,
        settingsRev: 0,
        // Hlásenie po uložení; pri ďalšej úprave zmizne.
        settingsNote: '',
        geo: /** @type {GeoSearch} */ ({ status: 'idle', results: [] }),
        // Otvorená obrazovka (null = karta ukazuje prehľad) a plocha panelov, ktorej sa týka. Oboje
        // je krok navigácie, takže tlačidlo Späť na telefóne vracia o obrazovku sprievodcu.
        setupStep: /** @type {SetupStep | null} */ (known === 'nic' ? 'lokalita' : null),
        setupRoof: 0,
        // Úprava jedného kroku: kam sa po nej vrátiť - na zhrnutie sprievodcu, alebo na prehľad
        // uloženej elektrárne (vtedy sa zmena rovno ukladá). null = sprievodca ide v poradí.
        setupReturn: /** @type {'suhrn' | 'prehlad' | null} */ (null),
        // Kto pozná len celkový výkon elektrárne (kWp), zadá ten; výkon panelu sa dopočíta.
        setupKwp: /** @type {number | null} */ (null),
        // Ako bol zadaný výkon panelu a meniča - „Neviem“ zhrnutie označí ako odhad.
        setupPick: /** @type {{ wp: ValuePick, ac: ValuePick }} */ ({ wp: 'chip', ac: 'chip' }),
        // Či človek chce živé meranie. Rozhoduje, či sa pripojené meranie pri uložení vôbec berie.
        setupLive: !!start.zdroj,
        // Pripájanie merania: zvolená značka a spôsob, čo človek napísal do polí a výsledok
        // pripojenia. Polia (heslá, kľúče) sa nikam neukladajú - po pripojení ostane len
        // zapečatený prístup v rozpísanom nastavení.
        setupZnacka: '',
        setupSposob: '',
        setupUdaje: /** @type {Record<string, string>} */ ({}),
        setupPripoj: /** @type {Pripoj} */ ({ status: 'idle', chyba: '', stanice: [] }),
        // Odkaz s nastavením vložený v sprievodcovi (obrazovka „odkaz“).
        setupLink: '',
        // Rozvrh tarify, ktorý sa práve upravuje (0 = základ, ďalej výnimky), a pásmo, ktorým sa
        // maľuje po kruhu (null = najdrahšie). Nastavenie vnútri obrazovky, nie krok navigácie.
        setupSched: 0,
        setupBrush: /** @type {string | null} */ (null),
        // Človek pri tarife ťukol na „Neviem“ - obrazovka vysvetlí, s čím appka počíta.
        setupDunno: false,
    };
}

/** Uložené nastavenie, pre ktoré appka práve počíta. @param {Pick<SetupState, 'site' | 'plant' | 'tariff' | 'zdroj'>} s @returns {Settings} */
export function savedSettings(s) {
    return { site: s.site, plant: s.plant, tariff: s.tariff, zdroj: s.zdroj };
}

/**
 * Rozpísané nastavenie tak, ako by sa uložilo: bez merania, keď ho človek nechce,
 * a s výkonom panelu dopočítaným z celkového výkonu, keď zadal ten.
 * @param {Pick<SetupState, 'settingsDraft' | 'setupLive' | 'setupKwp'>} s @returns {Settings}
 */
export function setupDraft(s) {
    const draft = s.setupLive ? s.settingsDraft : { ...s.settingsDraft, zdroj: null };
    return resolveDraft(draft, s.setupKwp);
}

/**
 * Otázka na polohu pri prvom otvorení appky, kým appka nevie nič. Nie je to krok sprievodcu - za ňou
 * zatiaľ nie je nič, kam sa vrátiť, takže nemá krížik, Späť ani ukazovateľ postupu.
 * @param {Pick<SetupState, 'known'>} s @param {SetupStep | null} step
 */
export function isWelcome(s, step) {
    return s.known === 'nic' && step === 'lokalita';
}

/** Je obrazovka hotová, dá sa z nej ísť ďalej? @param {SetupState} s */
export function setupReady(s) {
    const step = s.setupStep;
    if (!step) return false;
    if (step === 'odkaz') return !!settingsFromLink(s.setupLink);
    const roof = Math.min(s.setupRoof, s.settingsDraft.plant.strings.length - 1);
    return setupStepOk({ step, roof }, setupDraft(s), { totalKwp: s.setupKwp });
}

// ---- Úpravy rozpísaného nastavenia ----------------------------------------------------

/** Nové rozpísané nastavenie. `rewrite` prepíše aj hodnoty polí.
 * @param {SetupState} s @param {Settings} next @param {boolean} [rewrite] @param {SetupPatch} [extra] @returns {SetupPatch} */
function draftPatch(s, next, rewrite = false, extra = {}) {
    return { settingsDraft: next, settingsNote: '', ...(rewrite ? { settingsRev: s.settingsRev + 1 } : {}), ...extra };
}

/** Úprava plochy, na ktorej sprievodca práve stojí. @param {SetupState} s @param {(x: PlantString) => PlantString} fn @param {boolean} [rewrite] */
function roofPatch(s, fn, rewrite = false) {
    const d = s.settingsDraft;
    const strings = d.plant.strings.map((x, j) => (j === s.setupRoof ? fn(x) : x));
    return draftPatch(s, { ...d, plant: { ...d.plant, strings } }, rewrite);
}

/** @param {SetupState} s @param {Partial<Settings['plant']>} patch @param {boolean} [rewrite] @param {SetupPatch} [extra] */
function plantPatch(s, patch, rewrite = false, extra = {}) {
    return draftPatch(s, { ...s.settingsDraft, plant: { ...s.settingsDraft.plant, ...patch } }, rewrite, extra);
}

/** Úprava tarify. @param {SetupState} s @param {(t: Tariff) => Tariff} fn @param {boolean} [rewrite] @param {SetupPatch} [extra] */
function tariffPatch(s, fn, rewrite = false, extra = {}) {
    return draftPatch(s, { ...s.settingsDraft, tariff: fn(s.settingsDraft.tariff) }, rewrite, extra);
}

/** Výber lokality zo zoznamu. Ak jediná plocha ešte smeruje na juh a lokalita je na južnej
 * pologuli, otočí sa na sever - tam je slnko. @param {SetupState} s @param {number} i @returns {SetupPatch} */
export function pickPlace(s, i) {
    const pick = s.geo.results[i];
    /** @type {GeoSearch} */ const geo = { status: 'idle', results: [] };
    if (!pick) return { geo };
    const d = s.settingsDraft;
    const untouched = d.plant.strings.length === 1 && sameSettings({ ...d, plant: { ...d.plant, strings: [newRoof(0)] } }, d);
    const strings = untouched ? [newRoof(pick.site.lat)] : d.plant.strings;
    return draftPatch(s, { ...d, site: pick.site, plant: { ...d.plant, strings } }, true, { geo });
}

/** Ručne zadané súradnice. Berú časové pásmo telefónu - kto ich zadáva, je zvyčajne doma.
 * @param {SetupState} s @param {number} lat @param {number} lon @param {string} timezone */
export function setCoords(s, lat, lon, timezone) {
    return draftPatch(s, { ...s.settingsDraft, site: { name: 'Vlastné súradnice', lat, lon, elevationM: 0, timezone } });
}

/** Výkon panelu: tlačidlo (číslo vo `v`), „Iný“ (`other`), alebo „Neviem“ (`guess`). @param {SetupState} s @param {string} v */
export function pickWp(s, v) {
    if (v === 'other') return { setupPick: { ...s.setupPick, wp: /** @type {ValuePick} */ ('other') } };
    const guess = v === 'guess';
    return plantPatch(s, { panelWp: guess ? SETUP.guessPanelWp : Number(v) }, true, {
        setupPick: { ...s.setupPick, wp: guess ? 'guess' : 'chip' },
    });
}

/** Vlastný výkon panelu napísaný do poľa. @param {SetupState} s @param {number} wp */
export function typeWp(s, wp) {
    return plantPatch(s, { panelWp: wp }, false, { setupPick: { ...s.setupPick, wp: 'other' } });
}

/** Menič: tlačidlo, „Iný“, alebo „Neviem“ - vtedy rovnako veľký ako panely, teda bez orezávania.
 * @param {SetupState} s @param {string} v */
export function pickAc(s, v) {
    if (v === 'other') return { setupPick: { ...s.setupPick, ac: /** @type {ValuePick} */ ('other') } };
    const guess = v === 'guess';
    const L = SETTINGS_LIMITS.acLimitKw;
    const panels = setupDraft(s).plant;
    const kwp = Number.isFinite(panels.panelWp) ? installedKw(panels) : L.min;
    const acLimitKw = guess ? Math.max(L.min, Math.min(L.max, Math.round(kwp))) : Number(v);
    return plantPatch(s, { acLimitKw }, true, { setupPick: { ...s.setupPick, ac: guess ? 'guess' : 'chip' } });
}

/** Vlastný výkon meniča napísaný do poľa. @param {SetupState} s @param {number} kw */
export function typeAc(s, kw) {
    return plantPatch(s, { acLimitKw: kw }, false, { setupPick: { ...s.setupPick, ac: 'other' } });
}

/** Prepnutie „výkon panelu / celkový výkon“ prenesie, čo už je známe. Bez zmeny null.
 * @param {SetupState} s @param {string} mode `panel` alebo `kwp` @returns {SetupPatch | null} */
export function pickWpMode(s, mode) {
    const resolved = setupDraft(s).plant;
    if (mode === 'kwp' && s.setupKwp === null) {
        const kwp = Number.isFinite(resolved.panelWp) ? Math.round(installedKw(resolved) * 100) / 100 : NaN;
        return { setupKwp: kwp, settingsRev: s.settingsRev + 1 };
    }
    if (mode === 'panel' && s.setupKwp !== null) {
        const L = SETTINGS_LIMITS.panelWp;
        const wp = resolved.panelWp >= L.min && resolved.panelWp <= L.max ? Math.round(resolved.panelWp) : s.settingsDraft.plant.panelWp;
        return plantPatch(s, { panelWp: wp }, true, { setupKwp: null, setupPick: { ...s.setupPick, wp: 'chip' } });
    }
    return null;
}

/** Smer plochy. @param {SetupState} s @param {number} az */
export const setAzimuth = (s, az) => roofPatch(s, (x) => ({ ...x, azimuthDeg: az }));

/** Kompas z klávesnice: o 45° v smere `turn` (1 = v smere hodín). @param {SetupState} s @param {1 | -1} turn */
export function turnCompass(s, turn) {
    const step = SETUP.compassStepDeg;
    return roofPatch(s, (x) => ({ ...x, azimuthDeg: ((((Math.round(x.azimuthDeg / step) + turn) * step) % 360) + 360) % 360 }));
}

/** Sklon plochy: typ strechy (`rewrite`, prepíše aj posúvač) alebo posúvač sám. @param {SetupState} s @param {number} deg @param {boolean} rewrite */
export const setTilt = (s, deg, rewrite) => roofPatch(s, (x) => ({ ...x, tiltDeg: deg }), rewrite);

/** Počet panelov napísaný do poľa. @param {SetupState} s @param {number} n */
export const setPanels = (s, n) => roofPatch(s, (x) => ({ ...x, panels: n }));

/** Krok o jeden panel; pri neplatnom čísle v poli začne od najmenšej povolenej hodnoty. @param {SetupState} s @param {number} step */
export function stepPanels(s, step) {
    const L = SETTINGS_LIMITS.panels;
    return roofPatch(
        s,
        (x) => ({ ...x, panels: Math.max(L.min, Math.min(L.max, (Number.isInteger(x.panels) ? x.panels : L.min) + step)) }),
        true,
    );
}

/** Ďalšia plocha (najviac tri) - sprievodca sa na ňu rovno presunie. @param {SetupState} s @returns {SetupPatch | null} */
export function addRoof(s) {
    const d = s.settingsDraft;
    if (d.plant.strings.length >= SETTINGS_LIMITS.maxStrings) return null;
    const strings = [...d.plant.strings, newRoof(d.site.lat)];
    return draftPatch(s, { ...d, plant: { ...d.plant, strings } }, true, { setupStep: 'smer', setupRoof: strings.length - 1 });
}

/** Zmazanie plochy; posledná ostáva. @param {SetupState} s @param {number} i @returns {SetupPatch | null} */
export function deleteRoof(s, i) {
    const d = s.settingsDraft;
    if (d.plant.strings.length < 2) return null;
    const strings = d.plant.strings.filter((_, j) => j !== i);
    return draftPatch(s, { ...d, plant: { ...d.plant, strings } }, true, { setupRoof: Math.min(s.setupRoof, strings.length - 1) });
}

// ---- Živé meranie ---------------------------------------------------------------------

/** Pripájanie od začiatku: nič nájdené, žiadna chyba. */
const PRIPOJ_IDLE = /** @type {Pripoj} */ ({ status: 'idle', chyba: '', stanice: [] });

/**
 * Formulár spôsobu s prázdnymi poľami. Doteraz pripojené meranie z rozpísaného nastavenia
 * zmizne - „Ďalej“ sa tak nedá, kým sa nepripojí nové.
 * @param {SetupState} s @param {string} sposob @returns {SetupPatch}
 */
function openForm(s, sposob) {
    return draftPatch(s, { ...s.settingsDraft, zdroj: null }, true, {
        setupSposob: sposob,
        setupUdaje: {},
        setupPripoj: PRIPOJ_IDLE,
        setupStep: 'pripoj',
    });
}

/** Ťuknutie na značku: s jediným spôsobom rovno jeho formulár, inak výber spôsobu (aj
 * vysvetlenie, prečo sa značka nedá). @param {SetupState} s @param {string} id @returns {SetupPatch | null} */
export function pickZnacka(s, id) {
    const z = znackaOf(id);
    if (!z) return null;
    const sposoby = sposobyOf(z);
    if (sposoby.length === 1) return { ...openForm(s, sposoby[0].id), setupZnacka: id };
    return { setupZnacka: id, setupStep: 'sposob' };
}

/** Ťuknutie na spôsob pripojenia. @param {SetupState} s @param {string} id @returns {SetupPatch | null} */
export function pickSposob(s, id) {
    const sposob = sposobOf(id);
    return sposob && sposob.znacka === s.setupZnacka ? openForm(s, id) : null;
}

/** Pripojiť meranie inak; už pripojené ostáva, kým sa nepripojí nové. @returns {SetupPatch} */
export const changeZdroj = () => ({ setupStep: /** @type {SetupStep} */ ('znacka'), setupLive: true });

/** Značka, ktorá sa pripojiť nedá: človeku stačí odhad. @returns {SetupPatch} */
export const noZdroj = () => ({ setupStep: /** @type {SetupStep} */ ('meranie'), setupLive: false });

/** Text napísaný do poľa formulára. Pripojenie s inými údajmi treba spustiť znova.
 * @param {SetupState} s @param {string} id @param {string} value @returns {SetupPatch} */
export function setPole(s, id, value) {
    const done = s.setupPripoj.status === 'done' || s.setupPripoj.status === 'error';
    return {
        setupUdaje: { ...s.setupUdaje, [id]: value.trim() },
        ...(done ? { setupPripoj: PRIPOJ_IDLE, settingsDraft: { ...s.settingsDraft, zdroj: null } } : {}),
    };
}

/** Dá sa pripájať - polia sú vyplnené a na pohľad v poriadku? @param {Pick<SetupState, 'setupSposob' | 'setupUdaje'>} s */
export const udajeReady = (s) => udajeOk(s.setupSposob, s.setupUdaje);

/** Zvolená elektráreň z nájdených: z nej je pripojené meranie. @param {SetupState} s @param {number} i @returns {SetupPatch | null} */
export function pickStanica(s, i) {
    const st = s.setupPripoj.stanice[i];
    if (!st) return null;
    return draftPatch(s, { ...s.settingsDraft, zdroj: { sposob: s.setupSposob, pecat: st.pecat, nazov: st.nazov } });
}

/**
 * Meranie, ktoré Worker vrátil pri pripojení práve ukladaného merania, alebo null. Appka ho
 * po uložení ukáže hneď a ďalšie pýta až po intervale spôsobu - pri prísnych limitoch
 * (Huawei Northbound raz za 5 minút) by sa inak hneď po uložení pýtala druhýkrát a narazila.
 * @param {Pick<SetupState, 'setupPripoj'>} s @param {Zdroj | null} zdroj
 */
export function pripojenePv(s, zdroj) {
    const st = zdroj && s.setupPripoj.stanice.find((x) => x.pecat === zdroj.pecat);
    return st ? st.pv : null;
}

/** Pripájanie začalo. @returns {SetupPatch} */
export const pripojStart = () => ({ setupPripoj: /** @type {Pripoj} */ ({ status: 'loading', chyba: '', stanice: [] }) });

/**
 * Výsledok pripojenia. Jediná nájdená elektráreň je rovno pripojená; z viacerých si človek
 * vyberie. Keď medzitým zmenil spôsob, výsledok patrí inému formuláru a zahodí sa (null).
 * @param {SetupState} s @param {string} sposob pre ktorý spôsob pripájanie bežalo
 * @param {{ stanice: Stanica[] } | { chyba: 'udaje' | 'vyrobca' | 'server', kod?: string }} res @returns {SetupPatch | null}
 */
export function pripojDone(s, sposob, res) {
    if (s.setupSposob !== sposob || s.setupPripoj.status !== 'loading') return null;
    if ('chyba' in res) return { setupPripoj: { status: 'error', chyba: res.chyba, kod: res.kod ?? '', stanice: [] } };
    if (!res.stanice.length) return { setupPripoj: { status: 'error', chyba: 'vyrobca', stanice: [] } };
    /** @type {Pripoj} */ const setupPripoj = { status: 'done', chyba: '', stanice: res.stanice };
    return {
        setupPripoj,
        // Polia s heslom či kľúčom už netreba - zapečatený prístup je v nájdených elektrárňach.
        setupUdaje: {},
        ...(res.stanice.length === 1 ? pickStanica({ ...s, setupPripoj }, 0) : {}),
    };
}

// ---- Tarifa ---------------------------------------------------------------------------

/** Upravovaný rozvrh (po zmazaní výnimky môže index ukazovať mimo). @param {Pick<SetupState, 'setupSched'>} s @param {Tariff} t */
export const schedIndex = (s, t) => Math.max(0, Math.min(s.setupSched, t.schedules.length - 1));

/** Pásmo, ktorým sa maľuje: vybrané, inak najdrahšie (pri rovnakej úrovni posledné).
 * @param {Pick<SetupState, 'setupBrush'>} s @param {Tariff} t */
export function brushOf(s, t) {
    const picked = t.bands.find((b) => b.id === s.setupBrush);
    if (picked) return picked;
    return t.bands.reduce((a, b) => (PRICE_LEVELS.indexOf(b.level) >= PRICE_LEVELS.indexOf(a.level) ? b : a));
}

/** Nahradí jeden rozvrh tarify novými štvrťhodinami. @param {Tariff} t @param {number} i @param {string[]} slots @returns {Tariff} */
function withSlots(t, i, slots) {
    return { ...t, schedules: t.schedules.map((x, j) => (j === i ? { ...x, changes: changesOf(slots) } : x)) };
}

/** Úsek štvrťhodín od `from`, `count` za sebou, jedným pásmom - aj cez polnoc. @param {string[]} slots @param {number} from @param {number} count @param {string} band */
function fillSlots(slots, from, count, band) {
    const out = slots.slice();
    for (let k = 0; k < count; k++) out[(from + k) % out.length] = band;
    return out;
}

/** Typ sadzby, alebo „Neviem“ (`dunno`, jedna cena). Ten istý typ nechá tarifu, ako je (aj
 * s úpravami); iný ju nahradí šablónou. @param {SetupState} s @param {string} kind @returns {SetupPatch | null} */
export function pickKind(s, kind) {
    const dunno = kind === 'dunno';
    const k = /** @type {'jedna' | 'dvoj' | 'viac'} */ (dunno ? 'jedna' : kind);
    if (!(k in TARIFF_TEMPLATES)) return null;
    const t = s.settingsDraft.tariff;
    if (tariffKind(t) === k) return { setupDunno: dunno };
    return tariffPatch(s, () => ({ ...TARIFF_TEMPLATES[k], currency: t.currency }), true, {
        setupDunno: dunno,
        setupSched: 0,
        setupBrush: null,
    });
}

/** @param {SetupState} s */
export function addBand(s) {
    return tariffPatch(
        s,
        (t) =>
            t.bands.length >= TARIFF_LIMITS.maxBands
                ? t
                : { ...t, bands: [...t.bands, { id: newBandId(t), name: `Pásmo ${t.bands.length + 1}`, level: 'bezna', price: null }] },
        true,
    );
}

/** Zmazanie pásma: jeho úseky prevezme susedné pásmo. Pod tri pásma sa nedá. @param {SetupState} s @param {string} id @returns {SetupPatch | null} */
export function deleteBand(s, id) {
    const t = s.settingsDraft.tariff;
    const i = t.bands.findIndex((b) => b.id === id);
    if (i < 0 || t.bands.length <= 3) return null;
    const heir = t.bands[i === 0 ? 1 : i - 1].id;
    const schedules = t.schedules.map((x) => ({ ...x, changes: changesOf(slotsOf(x).map((b) => (b === id ? heir : b))) }));
    return tariffPatch(s, () => ({ ...t, bands: t.bands.filter((b) => b.id !== id), schedules }), true, {
        setupBrush: s.setupBrush === id ? null : s.setupBrush,
    });
}

/** Úroveň pásma. @param {SetupState} s @param {string} id @param {PriceLevel} level */
export const setLevel = (s, id, level) => tariffPatch(s, (t) => ({ ...t, bands: t.bands.map((b) => (b.id === id ? { ...b, level } : b)) }));

/** Meno pásma napísané do poľa. Pole sa neprepisuje (bez `rewrite`). @param {SetupState} s @param {string} id @param {string} name */
export const setBandName = (s, id, name) =>
    tariffPatch(s, (t) => ({ ...t, bands: t.bands.map((b) => (b.id === id ? { ...b, name: name.trim() } : b)) }));

/** Cena pásma napísaná do poľa; prázdne pole (NaN) je bez ceny. @param {SetupState} s @param {string} id @param {number} n */
export function setBandPrice(s, id, n) {
    const price = Number.isNaN(n) ? null : n;
    return tariffPatch(s, (t) => ({ ...t, bands: t.bands.map((b) => (b.id === id ? { ...b, price } : b)) }));
}

/** Mena. @param {SetupState} s @param {string} currency */
export const setCurrency = (s, currency) => tariffPatch(s, (t) => ({ ...t, currency: currency || t.currency }));

/** Šablóna tvaru dňa pre upravovaný rozvrh. Pásma sa priradia podľa úrovne: najlacnejšie
 * dostane lacné hodiny, najdrahšie drahé. @param {SetupState} s @param {string} tpl `20h`, `noc8`, alebo `all` */
export function applyTemplate(s, tpl) {
    const t = s.settingsDraft.tariff;
    const sorted = [...t.bands].sort((a, b) => PRICE_LEVELS.indexOf(a.level) - PRICE_LEVELS.indexOf(b.level));
    const cheap = sorted[0].id;
    const dear = sorted[sorted.length - 1].id;
    /** Tvar z dvojpásmovej tarify (nt = lacné, ostatné drahé). @param {Tariff} shape */
    const from = (shape) => shape.schedules[0].changes.map((c) => ({ from: c.from, band: c.band === 'nt' ? cheap : dear }));
    const changes = tpl === '20h' ? from(TARIFF) : tpl === 'noc8' ? from(TARIFF_TEMPLATES.dvoj) : [{ from: '00:00', band: cheap }];
    const i = schedIndex(s, t);
    return tariffPatch(s, () => ({ ...t, schedules: t.schedules.map((x, j) => (j === i ? { ...x, changes } : x)) }));
}

/** Zmazanie úseku: prevezme ho predošlý úsek. Posledný úsek ostáva. @param {SetupState} s @param {number} j @returns {SetupPatch | null} */
export function deleteRun(s, j) {
    const t = s.settingsDraft.tariff;
    const i = schedIndex(s, t);
    const runs = scheduleRuns(t, t.schedules[i]);
    const run = runs[j];
    if (!run || runs.length < 2) return null;
    const heir = runs[(j - 1 + runs.length) % runs.length].band.id;
    const step = TARIFF_LIMITS.stepMin;
    return tariffPatch(s, () => withSlots(t, i, fillSlots(slotsOf(t.schedules[i]), run.startMin / step, run.min / step, heir)));
}

/** Úsek z formulára pod zoznamom (cesta pre klávesnicu): štvrťhodiny od-do a pásmo. „Do“ pred
 * „Od“ znamená cez polnoc. @param {SetupState} s @param {number} from @param {number} to @param {string} band @returns {SetupPatch | null} */
export function setRun(s, from, to, band) {
    const t = s.settingsDraft.tariff;
    if (!Number.isInteger(from) || !Number.isInteger(to) || !t.bands.some((b) => b.id === band)) return null;
    const i = schedIndex(s, t);
    const slots = slotsOf(t.schedules[i]);
    const count = (to - from + slots.length) % slots.length || slots.length;
    return tariffPatch(s, () => withSlots(t, i, fillSlots(slots, from, count, band)));
}

/** Ťah po kruhu rozvrhu: štvrťhodiny od `from` po `to` dostanú pásmo, ktorým sa maľuje.
 * @param {SetupState} s @param {number} from @param {number} to */
export function paintRing(s, from, to) {
    const t = s.settingsDraft.tariff;
    const i = schedIndex(s, t);
    return tariffPatch(s, () => withSlots(t, i, paintSlots(slotsOf(t.schedules[i]), from, to, brushOf(s, t).id)));
}

/** Výnimky: žiadne (`none`), alebo prepnúť víkend (`weekend`) či časť roka (`season`). Nová
 * výnimka začína kópiou základu. @param {SetupState} s @param {string} what */
export function toggleException(s, what) {
    const t = s.settingsDraft.tariff;
    const [base, ...rest] = t.schedules;
    /** @param {(x: import('./config.js').Schedule) => boolean} is @param {number[]} days @param {number[]} months */
    const toggle = (is, days, months) => {
        if (rest.some(is)) return [base, ...rest.filter((x) => !is(x))];
        if (t.schedules.length >= TARIFF_LIMITS.maxSchedules) return t.schedules;
        return [...t.schedules, { days, months, changes: base.changes }];
    };
    const schedules =
        what === 'none'
            ? [base]
            : what === 'weekend'
              ? toggle(isWeekendSchedule, [6, 7], ALL_MONTHS)
              : toggle(isSeasonSchedule, ALL_DAYS, [6, 7, 8, 9]);
    return tariffPatch(s, () => ({ ...t, schedules }), false, { setupSched: 0 });
}

/** Mesiac výnimky na časť roka; aspoň jeden musí ostať a všetky byť nesmú (to by bol základ).
 * @param {SetupState} s @param {number} m */
export function toggleMonth(s, m) {
    return tariffPatch(s, (t) => ({
        ...t,
        schedules: t.schedules.map((x, i) => {
            if (i === 0 || !isSeasonSchedule(x)) return x;
            const months = x.months.includes(m) ? x.months.filter((y) => y !== m) : [...x.months, m].sort((a, b) => a - b);
            return months.length && months.length < 12 ? { ...x, months } : x;
        }),
    }));
}

/** Úrovne pásiem podľa cien. @param {SetupState} s */
export function applyAutoLevels(s) {
    return tariffPatch(s, (t) => {
        const auto = autoLevels(t.bands);
        return auto ? { ...t, bands: t.bands.map((b) => ({ ...b, level: auto[b.id] })) } : t;
    });
}

// ---- Pohyb v sprievodcovi -------------------------------------------------------------

/**
 * Dokončenie elektrárne, ktorej appka pozná len polohu: sprievodca od panelov, poloha je hotová.
 * Kto ho už raz rozpísal a odišiel, pokračuje s tým, čo zadal. Typická strecha sa nepredvypĺňa -
 * človek by si ju mohol omylom nechať ako svoju.
 * @param {SetupState} s @returns {SetupPatch}
 */
export function setupStart(s) {
    const fresh = sameSettings(s.settingsDraft, typicalSettings(s.site));
    return {
        setupStep: 'panel',
        setupRoof: 0,
        setupReturn: null,
        settingsNote: '',
        ...(fresh ? { settingsDraft: emptySettings(s.site), settingsRev: s.settingsRev + 1, setupLive: false, setupKwp: null } : {}),
    };
}

/** Nastaviť celé znova: sprievodca od úvodu, predvyplnený uloženou elektrárňou. @param {SetupState} s @returns {SetupPatch} */
export function restartSetup(s) {
    return {
        settingsDraft: savedSettings(s),
        settingsRev: s.settingsRev + 1,
        setupLive: !!s.zdroj,
        setupStep: 'start',
        setupRoof: 0,
        setupReturn: null,
        settingsNote: '',
    };
}

/** Obrazovka na vloženie odkazu s nastavením. @param {SetupState} s @returns {SetupPatch} */
export function openLink(s) {
    return { setupStep: 'odkaz', setupReturn: null, setupLink: '', settingsRev: s.settingsRev + 1, settingsNote: '' };
}

/** Prevezme nastavenie z vloženého odkazu a ukáže ho v zhrnutí - uloží sa až tam. @param {SetupState} s @returns {SetupPatch | null} */
function acceptLink(s) {
    const found = settingsFromLink(s.setupLink);
    if (!found) return null;
    return {
        settingsDraft: found,
        settingsRev: s.settingsRev + 1,
        setupKwp: null,
        setupPick: { wp: 'chip', ac: 'chip' },
        setupLive: !!found.zdroj,
        setupStep: 'suhrn',
        setupRoof: 0,
        setupReturn: null,
    };
}

/**
 * Zmena stavu, ktorá otvorí jeden krok na úpravu. `fromHome`: úprava uloženej elektrárne
 * (zmena sa po „Ďalej“ rovno uloží), inak krok zo zhrnutia sprievodcu.
 * @param {SetupState} s @param {string} key `lokalita`, `panel`, `roof:1`, `menic`, `meranie`, `tarifa`, `ceny` …
 * @param {boolean} fromHome
 * @returns {SetupPatch}
 */
export function stepEdit(s, key, fromHome) {
    const [step, roof] = key.startsWith('roof:') ? ['smer', Number(key.slice(5))] : [key, 0];
    return {
        setupStep: /** @type {SetupStep} */ (step),
        setupRoof: roof,
        setupReturn: fromHome ? 'prehlad' : 'suhrn',
        setupSched: 0,
        setupDunno: false,
        settingsNote: '',
        ...(fromHome ? { settingsDraft: savedSettings(s), settingsRev: s.settingsRev + 1, setupLive: !!s.zdroj } : {}),
    };
}

/** Zavrie sprievodcu. Rozpísané ostáva - kto ho otvorí znova, pokračuje. Úprava uloženej
 * elektrárne sa naopak zahodí, lebo tam „zavrieť“ znamená „nechať, ako bolo“. Kým appka
 * nepozná polohu, za sprievodcom nie je nič - vracia sa na otázku o nej. @param {SetupState} s @returns {SetupAction} */
export function closeAction(s) {
    if (s.known === 'nic') return { type: 'back', patch: { setupStep: 'lokalita', setupReturn: null } };
    if (s.setupReturn !== 'prehlad') return { type: 'patch', patch: { setupStep: null, setupReturn: null } };
    const saved = savedSettings(s);
    return {
        type: 'patch',
        patch: { settingsDraft: saved, settingsRev: s.settingsRev + 1, setupLive: !!saved.zdroj, setupStep: null, setupReturn: null },
    };
}

/**
 * „Ďalej“ a jeho varianty: prevziať odkaz, vrátiť sa na zhrnutie, uložiť. Nedá sa - null.
 * Meranie, ktoré človek chce a ešte nie je pripojené, pokračuje výberom značky - aj pri úprave
 * jedného kroku, uložiť zatiaľ nie je čo.
 * @param {SetupState} s @returns {SetupAction | null}
 */
export function nextAction(s) {
    const toZnacka = s.setupStep === 'meranie' && s.setupLive && !s.settingsDraft.zdroj;
    return toZnacka ? { type: 'patch', patch: { setupStep: 'znacka' } } : stepAction(s);
}

/** „Ďalej“ podľa obrazovky a toho, odkiaľ sa na ňu prišlo (nextAction). @param {SetupState} s @returns {SetupAction | null} */
function stepAction(s) {
    if (!setupReady(s) || !s.setupStep) return null;
    if (s.setupReturn === 'suhrn') return { type: 'back', patch: { setupStep: 'suhrn', setupReturn: null } };
    // Bez zadaných panelov sa ukladá len poloha: pri prvom otvorení (a sprievodca pokračuje
    // panelmi) aj pri jej zmene z prehľadu karty.
    if (isWelcome(s, s.setupStep)) return { type: 'site', site: s.settingsDraft.site, extra: { setupStep: 'panel' } };
    if (s.known === 'poloha' && s.setupReturn === 'prehlad')
        return { type: 'site', site: s.settingsDraft.site, extra: { setupStep: null } };
    if (s.setupReturn === 'prehlad' || s.setupStep === 'suhrn')
        return { type: 'save', settings: setupDraft(s), extra: { setupStep: null, setupReturn: null, setupLink: '' } };
    if (s.setupStep === 'odkaz') {
        const patch = acceptLink(s);
        return patch && { type: 'patch', patch };
    }
    const place = nextSetupPlace(
        { step: s.setupStep, roof: s.setupRoof },
        s.settingsDraft.plant.strings.length,
        tariffKind(s.settingsDraft.tariff),
    );
    return place && { type: 'patch', patch: { setupStep: place.step, setupRoof: place.roof } };
}

/**
 * Späť z obrazoviek pripájania merania - v rámci nich aj pri úprave jedného kroku. Z formulára
 * na výber spôsobu, keď ich značka má viac, inak na značky.
 * @type {Record<string, (s: SetupState) => SetupStep>}
 */
const MERANIE_BACK = {
    znacka: () => 'meranie',
    sposob: () => 'znacka',
    pripoj: (s) => {
        const z = znackaOf(s.setupZnacka);
        return z && sposobyOf(z).length > 1 ? 'sposob' : 'znacka';
    },
};

/** „Späť“ v sprievodcovi - o obrazovku späť, z prvej ho zavrie (closeAction). @param {SetupState} s @returns {SetupAction | null} */
export function backAction(s) {
    const meranie = MERANIE_BACK[/** @type {string} */ (s.setupStep)];
    if (meranie) return { type: 'back', patch: { setupStep: meranie(s) } };
    if (!s.setupStep || s.setupReturn === 'prehlad' || s.setupStep === 'start' || (s.known === 'nic' && s.setupStep === 'odkaz'))
        return closeAction(s);
    const place = prevSetupPlace(
        { step: s.setupStep, roof: s.setupRoof },
        s.settingsDraft.plant.strings.length,
        tariffKind(s.settingsDraft.tariff),
    );
    return place && { type: 'back', patch: { setupStep: place.step, setupRoof: place.roof } };
}

/** „Teraz nie, ukáž predpoveď“ na otázke o polohe: uloží len ju a zavrie sprievodcu. Kam appka
 * potom prejde, pridá volajúci. @param {SetupState} s @returns {SetupAction | null} */
export function skipAction(s) {
    if (s.known !== 'nic' || !setupReady(s)) return null;
    return { type: 'site', site: s.settingsDraft.site, extra: { setupStep: null } };
}
