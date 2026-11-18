// Stav: jeden objekt, mení sa len cez setState (web/store.js) a prekresľuje len
// cez render (render/index.js). Polia o elektrárni a dátach sú tie isté,
// takže ich plní ten istý kód (web/refresh.js, web/storage.js).

import { BOJLER, LAYOUT_PX, NASTAVENIE_SEKCIE, PANELS } from '../shared/config.js';
import { domaDefault } from '../shared/doma.js';
import { oznameniaDefault } from '../shared/oznamenia.js';
import { DEFAULT_LOOK, typicalSettings } from '../shared/settings.js';
import { emptySettings } from '../shared/setup.js';
import { backAction, closeAction, setupInit } from '../shared/setup-flow.js';

/**
 * Stav. `mzGraf` otvorený panel s grafom dňa na karte Dnes (docs/navrhy/dnes-predpoved-graf.html) a `terazPreview`
 * zvolený čas v ňom (minúta dňa, null = teraz; meno ostalo z čias, keď bol graf na karte Teraz), `tzVec` otvorený detail spotrebiča (id veci z MOZEM_ITEMS),
 * `tzDen` deň zvolený v hrebeni týždňa karty Teraz (poradie od dneška, 0 = dnes; docs/navrhy/teraz-vyhlad-alternativy.html),
 * `tzObrys` čaká alebo beží jednorazový obrys toho, čo zapnúť, po ťuknutí na oznámenie (docs/navrhy/oznamenie-plan-dna.html, web/oznamenia-klik.js),
 * `tzChip` otvorený panel s vysvetlením riadku nad dlaždicami karty Teraz (docs/navrhy/teraz-odznaky-vysvetlenie.html),
 * `tzCisla` čísla v scéne toku energie karty Teraz, ukázané po ťuknutí na scénu (docs/navrhy/teraz-tok-energie.html),
 * `mzChip` otvorené vysvetlenie odznaku triedy dňa na karte Dnes - dnešného, alebo večer zajtrajšieho (docs/navrhy/dnes-upravy.html),
 * `weekDetail` otvorený detail karty 7 dní (deň, týždeň,
 * null = prehľad dní) a `weekDay` deň v ňom (index v predpovedi), `statsPeriod` obdobie karty Štatistika,
 * `online`, či má telefón internet - podľa toho karta bez dát povie prečo, a `incoming` nastavenie
 * z otvoreného odkazu, ktoré čaká na potvrdenie. `voice` je tón hlášok a `liveSky` živá obloha (Nastavenie › Vzhľad), `appSheet`
 * otvorené okno sekcie Appka (Zdieľať appku, potvrdenie Vymazať údaje), `nsOpen` rozbalená sekcia
 * karty Nastavenie (NS_FOLDS; pri štarte sú všetky zbalené) a `shareSettings`,
 * `shareKiosk` voľby zdieľania - pribaliť nastavenie elektrárne, k nemu aj prístup k živému meraniu (`sharePecat` pečať na čas, ktorú naň vydal Worker; `shareKioskFail` nevydal ju). Polia sprievodcu nastavením (setup…, settings…, geo) sú tie isté
 * a mení ich ten istý kód (shared/setup-flow.js). `layout` je rozloženie podľa šírky okna (layoutOf).
 * `parts` hovorí, ktoré časti appky (PARTS) sú načítané, a ktoré sa načítať nepodarilo. `stavTip` je
 * otvorená bublina s vysvetlením stavu merania pod bodkou a časom v hlavičke.
 * @typedef {(typeof PANELS)[number]} Panel
 * @typedef {'narrow' | 'medium' | 'wide'} Layout
 * @typedef {'nacitavam' | 'ok' | 'chyba' | 'mimo' | 'bezpolohy'} RadarStav
 * @typedef {'day' | 'week'} WeekDetail
 * @typedef {'share' | 'reset'} AppSheet
 * @typedef {import('../shared/mozem.js').Chip['key'] | 'tok'} TzChip
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
 *   tzDen: number,
 *   tzObrys: boolean,
 *   tzChip: TzChip | null,
 *   tzCisla: boolean,
 *   mzChip: MzChip | null,
 *   weekDetail: WeekDetail | null,
 *   weekDay: number,
 *   statsPeriod: import('../shared/stats.js').StatsPeriod,
 *   radarRozsah: import('../shared/radar.js').RadarRozsah,
 *   radarOblaky: boolean,
 *   radarRychlost: 1 | 2 | 3,
 *   radarHra: boolean,
 *   radarStav: RadarStav,
 *   radarHotovo: boolean,
 *   radarBezModelu: boolean,
 *   online: boolean,
 *   incoming: import('../shared/settings.js').Settings | null,
 *   linkError: import('../shared/settings.js').LinkError | null,
 *   voice: import('../shared/messages.js').Voice,
 *   liveSky: boolean,
 *   appSheet: AppSheet | null,
 *   nsOpen: NsFold | null,
 *   shareSettings: boolean,
 *   shareKiosk: boolean,
 *   sharePecat: string | null,
 *   shareKioskFail: boolean,
 *   parts: Partial<Record<Part, PartState>>,
 *   stavTip: boolean,
 *   meranieBublina: '' | 'pripojene' | 'obnovene',
 *   oznamenia: import('../shared/oznamenia.js').Oznamenia,
 *   oznamStav: import('./oznamenia.js').OznamStav,
 *   doma: string[],
 *   bojler: import('../shared/bojler.js').BojlerInfo | null,
 *   bojlerPrahy: import('../shared/bojler.js').Prahy,
 *   bojlerSkript: import('../shared/nastavenie-bojler.js').BojlerSkript,
 *   bojlerRezim: 'uklada' | 'chyba' | 'ulozene' | null,
 *   trasy: import('../shared/trasy.js').UlozeneTrasy | null,
 * }} AppState
 * @typedef {ReturnType<typeof import('./store.js').createStore<AppState>>} Store
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
 * spotrebiče doma (Nastavenie › Čo máš doma) - s nimi ráta Plán dňa aj ranné oznámenie - a prahy
 * bojlera na prebytky (do skriptu zásuvky).
 * @param {{ oznamenia?: import('../shared/oznamenia.js').Oznamenia, oznamStav?: import('./oznamenia.js').OznamStav, doma?: string[],
 *   bojlerPrahy?: import('../shared/bojler.js').Prahy }} o
 */
const telefon = ({
    oznamenia = oznameniaDefault(),
    oznamStav = /** @type {import('./oznamenia.js').OznamStav} */ ('ok'),
    doma = domaDefault(),
    bojlerPrahy = { zapKw: BOJLER.zapKw, vypKw: BOJLER.vypKw },
}) => ({
    oznamenia,
    oznamStav,
    doma,
    bojlerPrahy,
    // Stav bojlera hlási Worker pri meraní; skript do zásuvky appka pripraví až na požiadanie.
    bojler: null,
    bojlerSkript: /** @type {import('../shared/nastavenie-bojler.js').BojlerSkript} */ ({ stav: 'nic', text: '', schranka: false }),
    // Prepínač režimu v paneli Bojler dnes: ukladá sa, alebo sa uložiť nepodarilo.
    bojlerRezim: /** @type {'uklada' | 'chyba' | 'ulozene' | null} */ (null),
});

/**
 * Karta Radar: čo si človek zvolil. Poloha na osi nie je v stave, patrí prehrávaču (web/radar-hrac.js).
 * `radarHotovo`: načítané je všetko a dá sa prehrávať, `radarBezModelu`: model sa pritom nenačítal.
 * @param {{ radarOblaky?: boolean, radarRychlost?: 1 | 2 | 3 }} ulozene
 */
const radarStart = ({ radarOblaky = true, radarRychlost = 1 }) => ({
    radarRozsah: /** @type {import('../shared/radar.js').RadarRozsah} */ ('2h'),
    radarOblaky,
    radarRychlost: /** @type {1 | 2 | 3} */ (radarRychlost),
    radarHra: false,
    radarStav: /** @type {RadarStav} */ ('nacitavam'),
    radarHotovo: false,
    radarBezModelu: false,
});

/**
 * @param {Date} now
 * @param {{ saved: import('../shared/settings.js').Settings | null, site: import('../shared/config.js').Site | null,
 *   dayLog: import('../shared/daylog.js').DayLog,
 *   online: boolean, ranna: import('../shared/den-trieda.js').RannaTrieda | null,
 *   trasy?: import('../shared/trasy.js').UlozeneTrasy | null,
 *   pristup?: import('../shared/pristup.js').Odmietnutie | null,
 *   incoming?: import('../shared/settings.js').Settings | null, linkError?: import('../shared/settings.js').LinkError | null, look?: import('../shared/settings.js').Look,
 *   radarOblaky?: boolean, radarRychlost?: 1 | 2 | 3, layout?: Layout, oznamenia?: import('../shared/oznamenia.js').Oznamenia,
 *   oznamStav?: import('./oznamenia.js').OznamStav, doma?: string[], bojlerPrahy?: import('../shared/bojler.js').Prahy }} start
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
        trasy = null,
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
        // Trasy autom z domu pre plagát Štatistiky (shared/trasy.js); sťahuje ich časť Štatistika.
        trasy,
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
        sharePecat: null,
        shareKioskFail: false,
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
 * Zmena karty aj so smerom podľa poradia v navigácii. Zvolený deň, detail spotrebiča a vysvetlenie
 * patria karte Teraz, zvolený čas grafu a vysvetlenie odznaku karte Dnes a detail karte 7 dní - s kartou sa zatvoria.
 * @param {Panel} from @param {Panel} to
 */
export function panelChange(from, to) {
    return {
        panel: to,
        panelDir: /** @type {1 | -1} */ (PANELS.indexOf(to) < PANELS.indexOf(from) ? -1 : 1),
        mzGraf: false,
        terazPreview: /** @type {number | null} */ (null),
        tzVec: /** @type {string | null} */ (null),
        tzDen: 0,
        tzObrys: false,
        tzChip: /** @type {TzChip | null} */ (null),
        tzCisla: false,
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

/**
 * Obrazovka sprievodcu nastavením, z ktorej Späť ide o obrazovku späť (ako jeho vlastné tlačidlo Späť).
 * Obrazovka, na ktorú sprievodcu vracia zatvorenie (kým appka nepozná polohu, otázka na ňu), patrí karte.
 * @param {AppState} s @returns {Partial<AppState> | null}
 */
function sprievodcaSpat(s) {
    const zavri = closeAction(s);
    if (s.panel !== 'nastavenie' || !s.setupStep || zavri.type !== 'patch' || s.setupStep === zavri.patch.setupStep) return null;
    const krok = backAction(s) ?? zavri;
    return krok.type === 'patch' ? krok.patch : null;
}

/**
 * Čo Späť zatvára, zvnútra von: bublina a čísla v scéne, okno sekcie Appka, sprievodca, sekcia Nastavenia,
 * panely na kartách Teraz a Dnes, detail karty 7 dní a nakoniec iný deň v páse dní karty Teraz.
 * @type {((s: AppState) => Partial<AppState> | null)[]}
 */
const ZATVARA = [
    (s) => (s.stavTip ? { stavTip: false } : null),
    (s) => (s.tzCisla ? { tzCisla: false } : null),
    (s) => (s.appSheet ? { appSheet: null } : null),
    sprievodcaSpat,
    (s) => (s.nsOpen ? { nsOpen: null } : null),
    (s) => (s.tzVec ? { tzVec: null } : null),
    (s) => (s.tzChip ? { tzChip: null } : null),
    (s) => (s.mzChip ? { mzChip: null } : null),
    (s) => (s.mzGraf ? { mzGraf: false, terazPreview: null } : null),
    (s) => (s.weekDetail ? { weekDetail: null } : null),
    (s) => (s.tzDen ? { tzDen: 0 } : null),
];

/**
 * Čo spraví tlačidlo Späť (web/nav-history.js): zavrie, čo je otvorené - vždy jednu vec (ZATVARA) -,
 * potom prejde na kartu Teraz (v prehľade so stĺpcami ostane prehľad) a až z nej appka odíde (null).
 * Zatvorenie okna či detailu krížikom je obyčajná zmena stavu, s históriou nemá nič spoločné.
 * @param {AppState} s @returns {Partial<AppState> | null}
 */
export function spatZmena(s) {
    for (const zavri of ZATVARA) {
        const zmena = zavri(s);
        if (zmena) return zmena;
    }
    return s.panel === 'terazky' || dashboard(s) ? null : panelChange(s.panel, 'terazky');
}
