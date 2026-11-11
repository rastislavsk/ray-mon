// Stav: jeden objekt, mení sa len cez setState (web/store.js) a prekresľuje len
// cez render (render/index.js). Polia o elektrárni a dátach sú tie isté,
// takže ich plní ten istý kód (web/refresh.js, web/storage.js).

import { LAYOUT_PX, MINUTES_PER_DAY, MOZEM_ITEMS, NASTAVENIE_SEKCIE, PANELS } from '../shared/config.js';
import { domaDefault } from '../shared/doma.js';
import { oznameniaDefault } from '../shared/oznamenia.js';
import { DEFAULT_LOOK, typicalSettings } from '../shared/settings.js';
import { emptySettings, SETUP_STEPS } from '../shared/setup.js';
import { setupInit } from '../shared/setup-flow.js';

/**
 * Stav. `mzGraf` otvorený panel s grafom dňa na karte Dnes (docs/navrhy/dnes-predpoved-graf.html) a `terazPreview`
 * zvolený čas v ňom (minúta dňa, null = teraz; meno ostalo z čias, keď bol graf na karte Teraz), `tzVec` otvorený detail spotrebiča (id veci z MOZEM_ITEMS),
 * `tzObrys` čaká alebo beží jednorazový obrys toho, čo zapnúť, po ťuknutí na oznámenie (docs/navrhy/oznamenie-plan-dna.html, web/oznamenia-klik.js),
 * `tzChip` otvorený panel s vysvetlením riadku nad dlaždicami karty Teraz (docs/navrhy/teraz-odznaky-vysvetlenie.html),
 * `mzChip` otvorené vysvetlenie odznaku triedy dňa na karte Dnes - dnešného, alebo večer zajtrajšieho (docs/navrhy/dnes-upravy.html),
 * `weekDetail` otvorený detail karty 7 dní (deň, týždeň,
 * null = prehľad dní) a `weekDay` deň v ňom (index v predpovedi), `statsPeriod` obdobie karty Štatistika,
 * `online`, či má telefón internet - podľa toho karta bez dát povie prečo, a `incoming` nastavenie
 * z otvoreného odkazu, ktoré čaká na potvrdenie. `voice` je tón hlášok a `liveSky` živá obloha (Nastavenie › Vzhľad), `appSheet`
 * otvorené okno sekcie Appka (Zdieľať appku, potvrdenie Vymazať údaje), `nsOpen` rozbalená sekcia
 * karty Nastavenie (NS_FOLDS; pri štarte sú všetky zbalené) a `shareSettings`,
 * `shareKiosk` voľby zdieľania - pribaliť nastavenie elektrárne, k nemu aj prístup k živému meraniu. Polia sprievodcu nastavením (setup…, settings…, geo) sú tie isté
 * a mení ich ten istý kód (shared/setup-flow.js). `layout` je rozloženie podľa šírky okna (layoutOf).
 * `parts` hovorí, ktoré časti appky (PARTS) sú načítané, a ktoré sa načítať nepodarilo. `stavTip` je
 * otvorená bublina s vysvetlením stavu merania pod bodkou a časom v hlavičke.
 * @typedef {(typeof PANELS)[number]} Panel
 * @typedef {'narrow' | 'medium' | 'wide'} Layout
 * @typedef {'nacitavam' | 'ok' | 'chyba' | 'mimo' | 'bezpolohy'} RadarStav
 * @typedef {'day' | 'week'} WeekDetail
 * @typedef {'share' | 'reset'} AppSheet
 * @typedef {import('../shared/mozem.js').Chip['key']} TzChip
 * @typedef {'dnes' | 'zajtra'} MzChip
 * @typedef {(typeof NS_FOLDS)[number]} NsFold
 * @typedef {import('./refresh.js').RefreshState & import('../shared/setup-flow.js').SetupState & {
 *   panel: Panel,
 *   panelDir: 1 | -1,
 *   layout: Layout,
 *   tariff: import('../shared/config.js').Tariff,
 *   mzGraf: boolean,
 *   terazPreview: number | null,
 *   tzVec: string | null,
 *   tzObrys: boolean,
 *   tzChip: TzChip | null,
 *   mzChip: MzChip | null,
 *   weekDetail: WeekDetail | null,
 *   weekDay: number,
 *   statsPeriod: import('../shared/stats.js').StatsPeriod,
 *   radarRozsah: import('../shared/radar.js').RadarRozsah,
 *   radarOblaky: boolean,
 *   radarRychlost: 1 | 2 | 3,
 *   radarHra: boolean,
 *   radarStav: RadarStav,
 *   online: boolean,
 *   incoming: import('../shared/settings.js').Settings | null,
 *   linkError: import('../shared/settings.js').LinkError | null,
 *   voice: import('../shared/messages.js').Voice,
 *   liveSky: boolean,
 *   appSheet: AppSheet | null,
 *   nsOpen: NsFold | null,
 *   shareSettings: boolean,
 *   shareKiosk: boolean,
 *   parts: Partial<Record<Part, PartState>>,
 *   stavTip: boolean,
 *   meranieBublina: '' | 'pripojene' | 'obnovene',
 *   oznamenia: import('../shared/oznamenia.js').Oznamenia,
 *   oznamStav: import('./oznamenia.js').OznamStav,
 *   doma: string[],
 * }} AppState
 * @typedef {ReturnType<typeof import('./store.js').createStore<AppState>>} Store
 */
/**
 * Krok navigácie, na ktorý sa dá vrátiť tlačidlom Späť: karta, otvorený panel veci, panel s grafom
 * dňa na karte Dnes (`graf`), náhľad iného času v ňom a detail karty 7 dní. Pri náhľade je krokom to, že beží - posun
 * po grafe nový krok nepridá (porovnáva sameNavStep); `preview` si pamätá čas, s ktorým sa doň
 * vstúpilo. Rovnako pri detaile dňa: listovanie po dňoch je stále ten istý krok, Späť z ktoréhokoľvek
 * dňa vráti do prehľadu. Obrazovka sprievodcu
 * nastavením aj s plochou panelov je krok tiež, takže Späť vracia o obrazovku sprievodcu. Okno sekcie
 * Appka (`sheet`) rovnako - Späť ho zavrie, a rozbalená sekcia karty Nastavenie (`fold`) - Späť ju zbalí. Otvorený detail spotrebiča na karte Teraz (`vec`)
 * a panel s vysvetlením nad jej dlaždicami (`chip`) Späť zavrie, rovnako vysvetlenie odznaku na karte Dnes (`trieda`). `dash` hovorí, že krok patrí prehľadu so stĺpcami
 * (dashboard): prepnutie stĺpca v ňom nie je nový krok a detail v ňom nepatrí len
 * stĺpcu, ktorý je práve aktívny. Mimo prehľadu v kroku nie je - položky histórie telefónu ostávajú, aké boli.
 * @typedef {{ panel: Panel, preview: number | null, detail: WeekDetail | null,
 *   setup: import('../shared/setup.js').SetupStep | null, roof: number, sheet: AppSheet | null, fold: NsFold | null,
 *   vec: string | null, chip: TzChip | null, trieda: MzChip | null, graf: boolean, dash?: true }} NavStep
 */

/**
 * Zbaliteľné sekcie karty Nastavenie, v poradí na karte. Rozbalená je najviac jedna.
 * Appka sa nezbaľuje: zdieľanie a vymazanie údajov sú samostatné položky pod nadpisom.
 */
export const NS_FOLDS = /** @type {Exclude<(typeof NASTAVENIE_SEKCIE)[number], 'appka'>[]} */ (
    NASTAVENIE_SEKCIE.filter((k) => k !== 'appka')
);

/**
 * Voľby telefónu: ranné oznámenie, čo s oznámeniami telefón vie,
 * a spotrebiče doma (Nastavenie › Čo máš doma) - s nimi ráta Plán dňa aj ranné oznámenie.
 * @param {{ oznamenia?: import('../shared/oznamenia.js').Oznamenia, oznamStav?: import('./oznamenia.js').OznamStav, doma?: string[] }} o
 */
const telefon = ({
    oznamenia = oznameniaDefault(),
    oznamStav = /** @type {import('./oznamenia.js').OznamStav} */ ('ok'),
    doma = domaDefault(),
}) => ({
    oznamenia,
    oznamStav,
    doma,
});

/**
 * Karta Radar: čo si človek zvolil. Poloha na osi nie je v stave, patrí prehrávaču (web/radar-hrac.js).
 * @param {{ radarOblaky?: boolean, radarRychlost?: 1 | 2 | 3 }} ulozene
 */
const radarStart = ({ radarOblaky = true, radarRychlost = 1 }) => ({
    radarRozsah: /** @type {import('../shared/radar.js').RadarRozsah} */ ('2h'),
    radarOblaky,
    radarRychlost: /** @type {1 | 2 | 3} */ (radarRychlost),
    radarHra: false,
    radarStav: /** @type {RadarStav} */ ('nacitavam'),
});

/**
 * @param {Date} now
 * @param {{ saved: import('../shared/settings.js').Settings | null, site: import('../shared/config.js').Site | null,
 *   dayLog: import('../shared/daylog.js').DayLog,
 *   online: boolean, ranna: import('../shared/den-trieda.js').RannaTrieda | null,
 *   pristup?: import('../shared/pristup.js').Odmietnutie | null,
 *   incoming?: import('../shared/settings.js').Settings | null, linkError?: import('../shared/settings.js').LinkError | null, look?: import('../shared/settings.js').Look,
 *   radarOblaky?: boolean, radarRychlost?: 1 | 2 | 3, layout?: Layout, oznamenia?: import('../shared/oznamenia.js').Oznamenia,
 *   oznamStav?: import('./oznamenia.js').OznamStav, doma?: string[] }} start
 *   uložené nastavenie, bez neho uložená poloha (appka počíta s typickou strechou v nej), denník výroby, internet, nastavenie
 *   z odkazu, ktoré appka ponúkne prevziať, vzhľad (tón hlášok, živá obloha), rozloženie a prístup
 *   k meraniu, ktorý výrobca odmietol (shared/pristup.js)
 * @returns {AppState}
 */
export function initialState(
    now,
    {
        saved,
        site,
        dayLog,
        online,
        ranna,
        incoming = null,
        linkError = null,
        look = DEFAULT_LOOK,
        layout = 'narrow',
        pristup = null,
        ...phone
    },
) {
    const start = saved || (site ? typicalSettings(site) : emptySettings());
    /** @type {import('../shared/settings.js').Known} */
    const known = saved ? 'elektraren' : site ? 'poloha' : 'nic';
    return {
        now,
        // Appka sa otvára vždy na prvej karte (Teraz), nič na nej nie je otvorené. Smer posledného
        // prechodu medzi kartami (`panelDir`): 1 dopredu v poradí navigácie, -1 späť.
        ...panelChange(PANELS[0], PANELS[0]),
        layout,
        known,
        site: start.site,
        plant: start.plant,
        tariff: start.tariff,
        zdroj: start.zdroj,
        pristup,
        pv: null,
        // Kedy appka naposledy dokončila pokus o stiahnutie dát (web/refresh.js); 0 = ešte nie.
        pokusAt: 0,
        forecast: null,
        // Kým beží prvé načítanie, chýbajúce dáta nie sú chyba.
        loading: true,
        dayLog,
        // Trieda dňa, ktorú appka dnes videla ráno (shared/den-trieda.js); zapisuje ju obnova dát.
        ranna,
        weekDay: 0,
        statsPeriod: /** @type {import('../shared/stats.js').StatsPeriod} */ ('dnes'),
        ...radarStart(phone),
        online,
        incoming,
        linkError,
        voice: look.voice,
        liveSky: look.liveSky,
        shareSettings: false,
        shareKiosk: false,
        // Neskoré časti appky (web/parts.js) zatiaľ nie sú načítané.
        parts: {},
        // Bublina, ktorú appka ešte neukázala: meranie sa práve pripojilo (web/setup-wiring.js), alebo
        // sa vrátilo z výpadku (shared/hlavicka.js, obnovaMerania).
        meranieBublina: /** @type {'' | 'pripojene' | 'obnovene'} */ (''),
        ...telefon(phone),
        // Sprievodca nastavením a rozpísané nastavenie. Bez polohy čaká na karte Nastavenie otázka
        // na ňu; appka sa aj tak otvára na svojej prvej karte, ktorá vedie do Nastavenia.
        ...setupInit(start, known),
    };
}

/**
 * Zmena karty aj so smerom podľa poradia v navigácii. Zvolený čas, detail spotrebiča a vysvetlenie
 * patria karte Teraz, vysvetlenie odznaku karte Dnes a detail karte 7 dní - s kartou sa zatvoria.
 * @param {Panel} from @param {Panel} to
 */
export function panelChange(from, to) {
    return {
        panel: to,
        panelDir: /** @type {1 | -1} */ (PANELS.indexOf(to) < PANELS.indexOf(from) ? -1 : 1),
        mzGraf: false,
        terazPreview: /** @type {number | null} */ (null),
        tzVec: /** @type {string | null} */ (null),
        tzObrys: false,
        tzChip: /** @type {TzChip | null} */ (null),
        mzChip: /** @type {MzChip | null} */ (null),
        weekDetail: /** @type {WeekDetail | null} */ (null),
        appSheet: /** @type {AppSheet | null} */ (null),
        nsOpen: /** @type {NsFold | null} */ (null),
        stavTip: false,
    };
}

/**
 * Ťuknutie na oznámenie: karta Teraz s obrysom okolo toho, čo zapnúť. Čokoľvek bolo otvorené,
 * zatvorí sa ako pri prechode na kartu.
 * @param {AppState} state
 */
export function zOznamenia(state) {
    return { ...panelChange(state.panel, 'terazky'), tzObrys: true };
}

/**
 * Rozloženie podľa šírky okna (LAYOUT_PX): telefón a tablet na výšku, tablet na šírku, počítač.
 * @param {number} width šírka okna v px @returns {Layout}
 */
export function layoutOf(width) {
    return width >= LAYOUT_PX.wide ? 'wide' : width >= LAYOUT_PX.medium ? 'medium' : 'narrow';
}

/** Karty, ktoré široká obrazovka ukazuje naraz ako stĺpce prehľadu, zľava doprava. */
export const COLUMNS = /** @type {const} */ (['mozem', 'terazky', '7dni']);

/** Je karta stĺpcom prehľadu? @param {Panel} panel */
export const isColumn = (panel) => COLUMNS.some((c) => c === panel);

/**
 * Ukazuje appka prehľad so stĺpcami? Len na širšej obrazovke a len na kartách Môžem?, Teraz a
 * 7 dní - Štatistika a Nastavenie sú aj tam samostatná stránka. `panel` je potom aktívny stĺpec:
 * ten, ktorý vybrala navigácia alebo v ktorom človek naposledy niečo otvoril.
 * @param {Pick<AppState, 'layout' | 'panel'>} state
 */
export const dashboard = (state) => state.layout !== 'narrow' && isColumn(state.panel);

/**
 * Je karta na obrazovke? Na telefóne len vybraná, v prehľade všetky jeho stĺpce.
 * @param {Pick<AppState, 'layout' | 'panel'>} state @param {Panel} panel
 */
export const shows = (state, panel) => panel === state.panel || (dashboard(state) && isColumn(panel));

/**
 * Časti appky, ktorých kód sa nesťahuje pri štarte, ale až keď ich treba, alebo keď je prehliadač po
 * prvom vykreslení voľný (web/parts.js): karta 7 dní, Štatistika s plagátom a Nastavenie so
 * sprievodcom a ponukou prevziať nastavenie z odkazu. Úvodná karta, hlavička, navigácia a obloha
 * sú v jadre - prvé zobrazenie na ne nečaká.
 */
export const PARTS = /** @type {const} */ (['sedem', 'radar', 'statistika', 'nastavenie']);

/**
 * @typedef {(typeof PARTS)[number]} Part
 * @typedef {'ok' | 'chyba' | 'koniec'} PartState načítaná; nenačítala sa (dá sa stiahnuť znova a
 *   obnoviť stránku); nenačítala sa ani po obnovení v tejto karte prehliadača
 */

/** Časť appky, ktorej kód karta potrebuje (null = karta je v jadre). @param {Panel} panel @returns {Part | null} */
export const partOf = (panel) =>
    panel === '7dni' ? 'sedem' : panel === 'radar' || panel === 'statistika' || panel === 'nastavenie' ? panel : null;

/** Je kód karty načítaný? Kým nie je, karta sa neukáže prázdna - namiesto nej je hláška. @param {Pick<AppState, 'parts'>} state @param {Panel} panel */
export function ready(state, panel) {
    const part = partOf(panel);
    return !part || state.parts[part] === 'ok';
}

/**
 * Časti, ktoré obrazovka práve potrebuje: karty na obrazovke a ponuka prevziať nastavenie z odkazu
 * (patrí Nastaveniu).
 * @param {AppState} state @returns {Part[]}
 */
export function neededParts(state) {
    const shown = PANELS.filter((p) => shows(state, p)).map(partOf);
    return PARTS.filter((part) => shown.includes(part) || (part === 'nastavenie' && (!!state.incoming || !!state.linkError)));
}

/** @param {AppState} state @returns {NavStep} */
export function navStep(state) {
    return {
        panel: state.panel,
        preview: state.terazPreview,
        detail: state.weekDetail,
        setup: state.setupStep,
        roof: state.setupRoof,
        sheet: state.appSheet,
        fold: state.nsOpen,
        vec: state.tzVec,
        chip: state.tzChip,
        trieda: state.mzChip,
        graf: state.mzGraf,
        ...(dashboard(state) ? { dash: /** @type {const} */ (true) } : {}),
    };
}

/**
 * Rovnaký krok? V prehľade sú všetky stĺpce jedna obrazovka - prepnutie stĺpca nový krok nepridá.
 * @param {NavStep} a @param {NavStep} b
 */
export function sameNavStep(a, b) {
    return (
        (a.panel === b.panel || (!!a.dash && !!b.dash)) &&
        (a.preview === null) === (b.preview === null) &&
        ROVNAKE_V_KROKU.every((k) => a[k] === b[k])
    );
}

/** Časti kroku, ktoré musia byť rovnaké, aby to bol ten istý krok. @type {(keyof NavStep)[]} */
const ROVNAKE_V_KROKU = ['detail', 'setup', 'roof', 'sheet', 'fold', 'vec', 'chip', 'trieda', 'graf'];

/**
 * Detail z položky histórie. Patrí len karte 7 dní (v prehľade ktorémukoľvek stĺpcu - 7 dní je
 * vidieť vždy); položka zo skoršej verzie ho nemá.
 * @param {Panel} panel @param {boolean} dash @param {unknown} detail @returns {WeekDetail | null}
 */
const weekDetailOf = (panel, dash, detail) => ((panel === '7dni' || dash) && (detail === 'day' || detail === 'week') ? detail : null);

/**
 * Okno sekcie Appka z položky histórie. Patrí len karte Nastavenie; položka zo skoršej verzie ho nemá.
 * @param {Panel} panel @param {unknown} sheet @returns {AppSheet | null}
 */
const appSheetOf = (panel, sheet) => (panel === 'nastavenie' && (sheet === 'share' || sheet === 'reset') ? sheet : null);

/**
 * Rozbalená sekcia karty Nastavenie z položky histórie. Patrí len tej karte; položka zo skoršej
 * verzie ju nemá - všetko je zbalené.
 * @param {Panel} panel @param {unknown} fold @returns {NsFold | null}
 */
const nsFoldOf = (panel, fold) => (panel === 'nastavenie' && NS_FOLDS.find((f) => f === fold)) || null;

/**
 * Otvorený detail spotrebiča z položky histórie. Patrí len karte Teraz (v prehľade ktorémukoľvek
 * stĺpcu - Teraz je vidieť vždy); položka zo skoršej verzie ho nemá, cudzia vec nie je.
 * @param {Panel} panel @param {boolean} dash @param {unknown} vec @returns {string | null}
 */
const tzVecOf = (panel, dash, vec) => ((panel === 'terazky' || dash) && MOZEM_ITEMS.find((i) => i.id === vec)?.id) || null;

/**
 * Otvorený panel štítka z položky histórie. Patrí karte Teraz ako Plán dňa; položka zo skoršej verzie
 * ho nemá. @param {Panel} panel @param {boolean} dash @param {unknown} chip @returns {TzChip | null}
 */
const tzChipOf = (panel, dash, chip) => ((panel === 'terazky' || dash) && (chip === 'stav' || chip === 'siet') ? chip : null);

/**
 * Otvorené vysvetlenie odznaku karty Dnes z položky histórie. Patrí karte Dnes (v prehľade ktorémukoľvek
 * stĺpcu); položka zo skoršej verzie ho nemá. @param {Panel} panel @param {boolean} dash @param {unknown} trieda @returns {MzChip | null}
 */
const mzChipOf = (panel, dash, trieda) => ((panel === 'mozem' || dash) && (trieda === 'dnes' || trieda === 'zajtra') ? trieda : null);

/**
 * Otvorený panel s grafom dňa z položky histórie. Patrí karte Dnes (v prehľade ktorémukoľvek stĺpcu);
 * položka zo skoršej verzie ho nemá. @param {Panel} panel @param {boolean} dash @param {unknown} graf
 */
const mzGrafOf = (panel, dash, graf) => (panel === 'mozem' || dash) && graf === true;

/**
 * Obrazovka sprievodcu a plocha z položky histórie. Položka zo skoršej verzie sprievodcu nepozná -
 * chýbajúci krok je prehľad karty. Cudzia hodnota je null.
 * @param {unknown} setup @param {unknown} roof
 * @returns {{ setup: import('../shared/setup.js').SetupStep | null, roof: number } | null}
 */
function setupPlaceOf(setup = null, roof = 0) {
    const s = setup === null ? null : SETUP_STEPS.find((x) => x === setup);
    if (s === undefined || !Number.isInteger(roof) || /** @type {number} */ (roof) < 0) return null;
    return { setup: s, roof: /** @type {number} */ (roof) };
}

/**
 * Prehľad so stĺpcami z položky histórie. Poznajú ho len jeho karty; položka zo skoršej verzie ho nemá.
 * Vracia časť kroku: `{ dash: true }`, inak nič. @param {Panel} panel @param {unknown} dash @returns {{ dash?: true }}
 */
const dashOf = (panel, dash) => (dash === true && isColumn(panel) ? { dash: true } : {});

/**
 * Krok z hodnoty v položke histórie (`step` alebo `prev`). Cudzia hodnota je null a Späť sa
 * pri nej správa ako predtým - odíde zo stránky.
 * @param {unknown} raw @returns {NavStep | null}
 */
export function navStepOf(raw) {
    // Položka zo skoršej verzie appky mala za krok len kartu.
    if (typeof raw === 'string') raw = { panel: raw };
    if (!raw || typeof raw !== 'object') return null;
    // Panel veci karty Môžem? (`item`) zanikol s jej dlaždicami, Plán dňa (`plan`) a zoznam pod grafom
    // (`legend`) s prestavbou karty Teraz; položka, ktorá ich ešte nesie, vráti len kartu.
    const { panel, preview, detail, setup, roof, sheet, fold, vec, chip, trieda, graf, dash } =
        /** @type {{ panel?: unknown, preview?: unknown, detail?: unknown, setup?: unknown, roof?: unknown,
         *   sheet?: unknown, fold?: unknown, vec?: unknown, chip?: unknown, trieda?: unknown, graf?: unknown, dash?: unknown }} */ (raw);
    const p = PANELS.find((x) => x === panel);
    const place = setupPlaceOf(setup, roof);
    if (!p || !place) return null;
    const d = dashOf(p, dash);
    const inDash = !!d.dash;
    const g = mzGrafOf(p, inDash, graf);
    // Náhľad mimo dňa (cudzia či poškodená položka) nie je náhľad, rovnako mimo grafu - položka zo
    // skoršej verzie, keď bol graf na karte Teraz, vráti len kartu.
    const at = g && Number.isInteger(preview) && /** @type {number} */ (preview) >= 0 && /** @type {number} */ (preview) < MINUTES_PER_DAY;
    return {
        panel: p,
        preview: at ? /** @type {number} */ (preview) : null,
        detail: weekDetailOf(p, inDash, detail),
        ...place,
        sheet: appSheetOf(p, sheet),
        fold: nsFoldOf(p, fold),
        vec: tzVecOf(p, inDash, vec),
        chip: tzChipOf(p, inDash, chip),
        trieda: mzChipOf(p, inDash, trieda),
        graf: g,
        ...d,
    };
}

/** Krok, na ktorom položka histórie stojí. @param {unknown} raw */
export const navStepFrom = (raw) => navStepOf(raw && typeof raw === 'object' ? /** @type {{ step?: unknown }} */ (raw).step : null);

/** Krok, z ktorého sa do položky histórie prišlo. @param {unknown} raw */
export const navPrevFrom = (raw) => navStepOf(raw && typeof raw === 'object' ? /** @type {{ prev?: unknown }} */ (raw).prev : null);

/**
 * Návrat na krok z histórie (tlačidlo Späť): karta, zvolený čas, detaily a panely tak, ako boli.
 * Náhľad, ktorý už beží, ostane na čase, kde ho prst nechal; detail dňa na dni, kde sa naposledy
 * stálo. Úprava jedného kroku sprievodcu končí zhrnutím alebo prehľadom - návrat na ne ju ukončí.
 * Návrat v prehľade na krok prehľadu nechá aktívny stĺpec, aký je - stĺpec nebol krokom.
 * @param {AppState} state @param {NavStep} step
 */
export function navChange(state, step) {
    const preview = step.preview === null ? null : (state.terazPreview ?? step.preview);
    const endsEdit = step.setup === null || step.setup === 'suhrn';
    const panel = !!step.dash && dashboard(state) ? state.panel : step.panel;
    return {
        ...panelChange(state.panel, panel),
        terazPreview: preview,
        weekDetail: step.detail,
        setupStep: step.setup,
        setupRoof: step.roof,
        appSheet: step.sheet,
        nsOpen: step.fold,
        tzVec: step.vec,
        tzChip: step.chip,
        mzChip: step.trieda,
        mzGraf: step.graf,
        ...(endsEdit ? { setupReturn: /** @type {null} */ (null) } : {}),
    };
}
