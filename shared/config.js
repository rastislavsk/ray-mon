// Jediný zdroj pravdy pre doménové konštanty appky (lokalita, elektráreň, tarifa,
// hranice výkonu, spotrebiče). Používa ho prehliadač, Cloudflare Worker aj testy.
// Žiadne z týchto čísel sa nesmie objaviť natvrdo inde v kóde.

/**
 * Farba stavu: zelená = slnko pokryje veľké spotrebiče, inak cena zo siete - červená drahá,
 * sivá bežná, oranžová lacná.
 * @typedef {'red' | 'amber' | 'grey' | 'green'} Tier
 */

/**
 * Lokalita elektrárne. Časové pásmo určuje, ktorá hodina a ktorý deň je „miestny“.
 * @typedef {{ name: string, lat: number, lon: number, elevationM: number, timezone: string }} Site
 */
/**
 * Zostava fotovoltiky: skupiny panelov s vlastnou orientáciou (azimut 180 = juh) a sklonom,
 * spoločný typ panelu a menič.
 * @typedef {{ panels: number, azimuthDeg: number, tiltDeg: number }} PlantString
 * @typedef {{ strings: PlantString[], panelWp: number, acLimitKw: number, systemEfficiency: number,
 *   tempCoefPctPerC: number, noctC: number, albedo: number }} Plant
 */

/**
 * Elektráreň v Dvoranoch: referenčná lokalita, na ktorej stoja testy a zamknutá predpoveď
 * (golden). Appka počíta pre to, čo si používateľ uloží v Nastavení.
 * @type {Site}
 */
export const SITE = {
    name: 'Dvorany nad Nitrou',
    lat: 48.48,
    lon: 18.12,
    elevationM: 180,
    timezone: 'Europe/Bratislava',
};

/**
 * Zostava v Dvoranoch: dve skupiny stringov (juh + východ), rovnaký sklon. Odborné parametre
 * (účinnosť, teplotný koeficient, NOCT, albedo) z nej preberá každé nastavenie používateľa.
 * @type {Plant}
 */
export const PLANT = {
    strings: [
        { panels: 16, azimuthDeg: 180, tiltDeg: 40 },
        { panels: 8, azimuthDeg: 90, tiltDeg: 40 },
    ],
    panelWp: 435,
    acLimitKw: 10,
    systemEfficiency: 0.88,
    tempCoefPctPerC: -0.41,
    noctC: 45,
    albedo: 0.2,
};

/**
 * Typická strecha: s ňou appka počíta, kým človek pozná len polohu a panely ešte nezadal -
 * karta 7 dní ukazuje predpoveď pre ňu. Odborné parametre (účinnosť, teplotný koeficient,
 * NOCT, albedo) sú tie isté ako v Dvoranoch - používateľ ich nemení.
 * @type {Plant}
 */
export const TYPICAL_PLANT = { ...PLANT, strings: [{ panels: 12, azimuthDeg: 180, tiltDeg: 35 }], acLimitKw: 5 };

/** Povolené rozsahy údajov, ktoré používateľ zadáva v Nastavení. */
export const SETTINGS_LIMITS = {
    maxStrings: 3,
    panels: { min: 1, max: 200 },
    panelWp: { min: 100, max: 800 },
    acLimitKw: { min: 1, max: 100 },
    tiltDeg: { min: 0, max: 90 },
    // Nadmorská výška lokality (m). Zadáva ju vyhľadávanie, nie človek - rozsah stráži najmä
    // odkaz s nastavením, ktorý mohol ktokoľvek upraviť. Mimo neho by bezoblačný model dal
    // nezmyselný strop (od ~7 km mu vychádza záporný útlm atmosféry).
    elevationM: { min: -500, max: 6000 },
    // Názov lokality. Dáva ho vyhľadávanie, no z odkazu s nastavením môže prísť čokoľvek
    // a dlhý názov by nafúkol odkaz aj rozbil hlavičku appky.
    siteNameMax: 100,
    // Nad týmto pomerom výkonu panelov k meniču bude menič za jasných dní orezávať špičky.
    dcAcWarnRatio: 1.3,
    // Celkový výkon elektrárne v kWp, keď ho človek zadá namiesto výkonu jedného panelu.
    // Horná hranica je najväčšia zostava, akú rozsahy vyššie pripustia (3 × 200 × 800 Wp).
    totalKwp: { min: 0.1, max: 480 },
};

/**
 * Sprievodca nastavením elektrárne (karta Nastavenie). Tlačidlá s bežnými hodnotami,
 * odhad pre „Neviem“ a to, s čím začína nová plocha panelov.
 */
export const SETUP = {
    panelWpChoices: [400, 410, 435, 450, 500],
    acChoices: [3, 5, 6, 8, 10, 12, 15, 20],
    // „Neviem“ pri výkone panelu: bežný panel posledných rokov.
    guessPanelWp: 430,
    newRoof: { panels: 10, tiltDeg: 35 },
    // Kompas má osem smerov po 45°.
    compassStepDeg: 45,
};

// Vyhľadávanie lokality sa spustí, až keď človek toľkoto milisekúnd nepíše.
export const SEARCH_DEBOUNCE_MS = 350;

/** Kľúč za mriežkou v odkaze, ktorý nesie nastavenie elektrárne: `…/#nastavenie=…`. */
export const SHARE_HASH_KEY = 'nastavenie';

/**
 * Verzia formátu nastavenia v odkaze (pole `v`). Zvýš ju, keď pribudne čokoľvek, čo staršia appka
 * z odkazu nevie prečítať - značka meniča, spôsob pripojenia, druh tarify, nové pole. Staršia appka
 * potom povie „aktualizuj“, namiesto toho, aby časť nastavenia potichu zahodila. Odkazy bez `v`
 * sú verzia 1. Stráži to test/golden/odkaz.json (test/odkaz.test.js).
 */
export const SHARE_LINK_VERSION = 2;

/** Kľúč v localStorage, pod ktorým je uložené nastavenie elektrárne. */
export const SETTINGS_STORAGE_KEY = 'elektraren-v1';

/** Kľúč v localStorage pre samotnú polohu - kto ju zadal, no panely ešte nie. */
export const SITE_STORAGE_KEY = 'poloha-v1';

/**
 * Karty v poradí navigácie - kódové názvy, ktoré drží HTML id, CSS selektory aj stav. Popisky
 * sú v HTML a nemusia sa s nimi zhodovať (terazky je v novej appke „Teraz“). Rovnaké v oboch
 * appkách, takže uložená úvodná karta (START_PANELS) platí v oboch.
 */
export const PANELS = /** @type {const} */ (['mozem', 'terazky', '7dni', 'statistika', 'nastavenie']);

/**
 * Karta, na ktorej sa appka otvára. Je to voľba telefónu, nie elektrárne: deti chcú Môžem?,
 * ten, kto elektráreň platí, Terazky. Ukladá sa zvlášť od nastavenia a do odkazu ide ako
 * `&prva=…` za mriežkou. Prvá v zozname je predvolená - Môžem? je jednoduchá odpoveď pre celú
 * rodinu, Terazky s grafom dňa sú podrobnejšie. Predvolená karta sa do odkazu nepíše.
 */
export const START_PANELS = /** @type {const} */ (['mozem', 'terazky']);
export const START_STORAGE_KEY = 'prva-karta-v1';
export const START_HASH_KEY = 'prva';

/**
 * Šírky okna (px), od ktorých nová appka mení rozloženie. Pod `medium` je telefón aj tablet na
 * výšku: jedna karta a navigácia dole. Od `medium` (tablet na šírku) sú Môžem?, Teraz a 7 dní
 * v dvoch stĺpcoch, od `wide` (počítač) v troch, navigácia je hore. `medium` je tá istá šírka,
 * od ktorej súčasná appka kreslí desktop (style.css, `min-width: 1024px`), takže sa obe appky
 * prepínajú naraz. Rozhoduje šírka okna, nie druh zariadenia.
 */
export const LAYOUT_PX = { medium: 1024, wide: 1280 };

/** Minút v dni. Graf dňa ich rozloží po šírke, rozvrh tarify ich delí na pásma. */
export const MINUTES_PER_DAY = 1440;

/**
 * Inštalovaný výkon zostavy v kWp: počet panelov × výkon panelu. Jediné miesto, kde sa počíta -
 * graf dňa, hranice výkonu, karta 7 dní aj Nastavenie ho berú odtiaľto. Nezaokrúhľuje sa,
 * zaokrúhľuje až text (kwpText v format.js).
 * @param {Plant} plant
 */
export function installedKw(plant) {
    return (plant.strings.reduce((sum, s) => sum + s.panels, 0) * plant.panelWp) / 1000;
}

// Bezoblačný model (Meinel + Laueho výšková korekcia) - horný strop výroby.
export const CLEAR_SKY = { tau: 0.8, dhiFraction: 0.12 };

/** Najvyšší výkon, aký elektráreň vie dodať: menší z výkonu panelov a meniča, v kW. @param {Plant} plant */
function maxOutputKw(plant) {
    return Math.min(installedKw(plant), plant.acLimitKw);
}

// Hranice výkonu FV, na ktorých stojí farba aj text odporúčaní, nastavené pre Dvorany.
// Inej elektrárni sa prepočítajú v pomere jej najvyššieho výkonu - 3 kWp strecha by inak
// „vysokú výrobu“ nevidela skoro nikdy.
const POWER_THRESHOLDS_DVORANY = {
    lowKw: 2, // pod touto hodnotou panely "nedávajú veľa"
    highKw: 4, // od tejto hodnoty je výroba "vysoká" a oplatí sa nabíjať auto zo slnka
    marginKw: 1.5, // o koľko musí byť budúce okno lepšie než teraz
    weakPeakKw: 1.2, // keď špička dňa nedosiahne ani toto, je to "slabý deň"
};

/** @typedef {typeof POWER_THRESHOLDS_DVORANY} PowerThresholds */

/** Hranice výkonu pre danú elektráreň, v kW. @param {Plant} plant @returns {PowerThresholds} */
export function powerThresholds(plant) {
    const scale = maxOutputKw(plant) / maxOutputKw(PLANT);
    return {
        lowKw: POWER_THRESHOLDS_DVORANY.lowKw * scale,
        highKw: POWER_THRESHOLDS_DVORANY.highKw * scale,
        marginKw: POWER_THRESHOLDS_DVORANY.marginKw * scale,
        weakPeakKw: POWER_THRESHOLDS_DVORANY.weakPeakKw * scale,
    };
}

// Predpoveď: koľko dní z Open-Meteo (9 = rezerva, aby 7 miestnych dní bolo úplných aj s posunom UTC).
export const FORECAST_API_DAYS = 9;
// A jeden deň dozadu. Open-Meteo začína polnocou UTC, takže západne od Greenwichu by večer,
// keď v UTC už je zajtra, chýbala celá doterajšia časť miestneho dneška (v UTC−7 po 17:00).
export const FORECAST_PAST_DAYS = 1;
export const FORECAST_DAYS_SHOWN = 7;
// Počasie z Open-Meteo sa sťahuje nanovo najskôr po tomto čase; predpoveď sa z neho medzitým
// len prepočítava pre aktuálny čas. Open-Meteo ju aj tak obnovuje raz za hodinu.
export const WEATHER_CACHE_MS = 55 * 60 * 1000;
// Posledné počasie sa odkladá aj v prehliadači (WEATHER_STORAGE_KEY): appka z neho po otvorení hneď
// ukáže predpoveď a nové počasie dotiahne popri tom. Staršie než toto sa nepoužije - ani pri výpadku.
export const WEATHER_KEEP_MS = 12 * 60 * 60 * 1000;

/** Vyhľadávanie miest Open-Meteo (celý svet, názvy po slovensky, kde ich poznajú). @param {string} query */
export function geocodeUrl(query) {
    return `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&language=sk&format=json`;
}

/**
 * Premenné žiarenia z Open-Meteo. Okamžité (`_instant`), nie hodinové: tie sú priemerom
 * predošlej hodiny, kým predpoveď k nim ráta polohu slnka v čase záznamu - krivka tak bola
 * o pol hodiny posunutá a denný súčet nízky (v zime o 5 %). Okamžitá hodnota patrí presne
 * k svojmu času, rovnako ako body nameranej krivky z kiosku.
 */
export const OPEN_METEO_RADIATION = {
    ghi: 'shortwave_radiation_instant',
    dni: 'direct_normal_irradiance_instant',
    dhi: 'diffuse_radiation_instant',
};

/** Adresa hodinovej predpovede Open-Meteo pre danú lokalitu (časy v UTC). @param {Site} site */
export function openMeteoUrl(site) {
    const R = OPEN_METEO_RADIATION;
    return (
        'https://api.open-meteo.com/v1/forecast' +
        `?latitude=${site.lat}&longitude=${site.lon}` +
        `&hourly=${R.ghi},${R.dni},${R.dhi},temperature_2m,cloud_cover` +
        `&forecast_days=${FORECAST_API_DAYS}&past_days=${FORECAST_PAST_DAYS}&timezone=UTC`
    );
}

/**
 * Cenová úroveň pásma tarify. Na týchto troch úrovniach stoja farby, texty aj spotrebiče,
 * nech má tarifa koľkokoľvek pásiem: lacné (NT, mimo špičky), bežné (jedna cena, stredné
 * pásmo) a drahé (VT, špička).
 * @typedef {'lacna' | 'bezna' | 'draha'} PriceLevel
 */
/**
 * Pásmo tarify. `id` je krátky kľúč, na ktorý odkazuje rozvrh, a pri premenovaní sa nemení.
 * `price` je cena za kWh v mene tarify, null = človek ju nezadal.
 * @typedef {{ id: string, name: string, level: PriceLevel, price: number | null }} Band
 */
/**
 * Rozvrh dňa: zmeny pásma od polnoci (prvá je vždy 00:00), pásmo platí do ďalšej zmeny.
 * `days` sú dni v týždni (1 = pondelok … 7 = nedeľa), `months` mesiace (1 – 12).
 * @typedef {{ from: string, band: string }} TariffChange
 * @typedef {{ days: number[], months: number[], changes: TariffChange[] }} Schedule
 */
/**
 * Tarifa, ktorú si človek zadá v Nastavení. `schedules[0]` je základ a platí pre všetky dni
 * aj mesiace; ďalšie rozvrhy sú výnimky (víkend, časť roka) a vyhráva posledná, ktorá na deň
 * sedí. Kedy svieti slnko, tarifa nehovorí - to vie appka z predpovede.
 * @typedef {{ currency: string, bands: Band[], schedules: Schedule[] }} Tariff
 */

/** Úrovne od najlacnejšej. @type {PriceLevel[]} */
export const PRICE_LEVELS = ['lacna', 'bezna', 'draha'];

/** Farba úrovne, keď slnko nepokryje veľké spotrebiče (inak je zelená). @type {Record<PriceLevel, Tier>} */
export const LEVEL_TIER = { lacna: 'amber', bezna: 'grey', draha: 'red' };

/** Povolené rozsahy tarify. */
export const TARIFF_LIMITS = {
    maxBands: 4,
    maxSchedules: 4,
    // Zmien za deň. Viac nemá žiadny bežný produkt a dlhší rozvrh by nafúkol zdieľaný odkaz.
    maxChanges: 24,
    // Zmena pásma len na celú štvrťhodinu; po štvrťhodinách sa počíta aj plán dňa.
    stepMin: 15,
    nameMax: 16,
    priceMax: 10,
};

/** Všetky dni v týždni a všetky mesiace - rozsah základného rozvrhu. */
export const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
export const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/**
 * Tarifa v Dvoranoch: štyri hodiny VT, zvyšných dvadsať NT. Referenčná tarifa pre testy
 * a zároveň tarifa každého nastavenia uloženého skôr, než appka poznala vlastné tarify -
 * doterajším používateľom sa tak nič nezmení.
 * @type {Tariff}
 */
export const TARIFF = {
    currency: '€',
    bands: [
        { id: 'nt', name: 'NT', level: 'lacna', price: null },
        { id: 'vt', name: 'VT', level: 'draha', price: null },
    ],
    schedules: [
        {
            days: ALL_DAYS,
            months: ALL_MONTHS,
            changes: [
                { from: '00:00', band: 'nt' },
                { from: '07:30', band: 'vt' },
                { from: '08:30', band: 'nt' },
                { from: '09:30', band: 'vt' },
                { from: '10:30', band: 'nt' },
                { from: '20:30', band: 'vt' },
                { from: '21:30', band: 'nt' },
                { from: '22:30', band: 'vt' },
                { from: '23:30', band: 'nt' },
            ],
        },
    ],
};

/**
 * Šablóny tarify v sprievodcovi podľa typu sadzby. Sú to tvary dňa, nie produkty: časy NT
 * určuje distribučka pre konkrétne odberné miesto, takže si ich človek aj tak opraví podľa
 * faktúry. Ceny nie sú - tie sú nepovinné.
 * @type {Record<'jedna' | 'dvoj' | 'viac', Tariff>}
 */
export const TARIFF_TEMPLATES = {
    jedna: {
        currency: '€',
        bands: [{ id: 'j', name: 'Cena', level: 'bezna', price: null }],
        schedules: [{ days: ALL_DAYS, months: ALL_MONTHS, changes: [{ from: '00:00', band: 'j' }] }],
    },
    dvoj: {
        currency: '€',
        bands: [
            { id: 'nt', name: 'NT', level: 'lacna', price: null },
            { id: 'vt', name: 'VT', level: 'draha', price: null },
        ],
        schedules: [
            {
                days: ALL_DAYS,
                months: ALL_MONTHS,
                changes: [
                    { from: '00:00', band: 'nt' },
                    { from: '06:00', band: 'vt' },
                    { from: '22:00', band: 'nt' },
                ],
            },
        ],
    },
    viac: {
        currency: '€',
        bands: [
            { id: 'p3', name: 'Mimo špičky', level: 'lacna', price: null },
            { id: 'p2', name: 'Bežné', level: 'bezna', price: null },
            { id: 'p1', name: 'Špička', level: 'draha', price: null },
        ],
        schedules: [
            {
                days: ALL_DAYS,
                months: ALL_MONTHS,
                changes: [
                    { from: '00:00', band: 'p3' },
                    { from: '08:00', band: 'p2' },
                    { from: '10:00', band: 'p1' },
                    { from: '14:00', band: 'p2' },
                    { from: '18:00', band: 'p1' },
                    { from: '22:00', band: 'p2' },
                ],
            },
        ],
    },
};

/** Meny na výber v sprievodcovi; appka nič neprepočítava, mena je len text pri cene. */
export const CURRENCIES = ['€', 'Kč', '£', 'zł', 'Ft', '$'];

/**
 * Spotrebiče v pevnom poradí (riadky v karte nepreskakujú) s typickým príkonom v kW.
 * `cheapGrid`: oplatí sa ho pustiť aj v lacnom pásme bez slnka (auto, bojler). `weakDay`:
 * odporúča sa aj v slabý deň, keď slnko veľké spotrebiče nepokryje.
 */
export const DEVICES = [
    { name: 'Práčka', powerKw: 2, cheapGrid: false, weakDay: true },
    { name: 'Sušička', powerKw: 1.5, cheapGrid: false, weakDay: false },
    { name: 'Umývačka', powerKw: 1.5, cheapGrid: false, weakDay: false },
    { name: 'Auto', powerKw: 11, cheapGrid: true, weakDay: true },
    { name: 'Bojler', powerKw: 2, cheapGrid: true, weakDay: true },
];

/**
 * Karta Môžem?: veci, na ktoré sa rodina pýta. Spotrebič (`device`) berie z DEVICES príkon
 * a pravidlá; `runMin` a `runKwh` sú typický program - podľa nich karta radí, dokedy ho pustiť,
 * a koľko stojí zo siete. Auto program nemá, pri ňom sa ráta hodina nabíjania; `runMin` bojlera
 * je typický ohrev nádrže. Zoznam je jeden pre obe appky. Veci bez
 * spotrebiča (`device: null`) sú od slnka nezávislé - berú málo alebo krátko.
 * @type {Array<{ id: string, device: string | null, runMin: number | null, runKwh: number | null }>}
 */
export const MOZEM_ITEMS = [
    { id: 'pracka', device: 'Práčka', runMin: 120, runKwh: 1 },
    { id: 'umyvacka', device: 'Umývačka', runMin: 150, runKwh: 1.1 },
    { id: 'susicka', device: 'Sušička', runMin: 90, runKwh: 2.2 },
    { id: 'auto', device: 'Auto', runMin: null, runKwh: null },
    { id: 'bojler', device: 'Bojler', runMin: 60, runKwh: 2 },
    { id: 'hranie', device: null, runMin: null, runKwh: null },
    { id: 'fen', device: null, runMin: null, runKwh: null },
];

/**
 * Skupiny vecí v novej appke: každá je jedna dlaždica s jednou odpoveďou. `size` je jej miesto
 * (`wide` cez celú šírku s pásom dňa, `half` polovica, `slim` tenký pás). Mená sú v messages.
 * @type {Array<{ id: string, items: string[], size: 'wide' | 'half' | 'slim' }>}
 */
export const MOZEM_GROUPS = [
    { id: 'velke', items: ['pracka', 'umyvacka', 'susicka'], size: 'wide' },
    { id: 'auto', items: ['auto'], size: 'half' },
    { id: 'bojler', items: ['bojler'], size: 'half' },
    { id: 'drobne', items: ['hranie', 'fen'], size: 'slim' },
];

/**
 * Kľúče, ktoré appka už nepoužíva a pri štarte ich zmaže. Mená sa nesmú použiť znova na niečo
 * iné - v starších telefónoch pod nimi môžu ležať staré dáta. `spustenia-v1` boli zápisy
 * „Pustil/a som“ z karty Môžem?.
 */
export const OLD_STORAGE_KEYS = ['spustenia-v1'];

/**
 * Denník výroby po dňoch pre súhrn na zdieľanie. Kiosk posiela len súčty (dnes, mesiac, rok),
 * takže dni si appka odkladá sama pri každej obnove merania. `fromMin`: zapisuje sa až od 03:00
 * miestneho času - tesne po polnoci môže kiosk ešte hlásiť včerajší súčet a ten by sa zapísal
 * ako dnešný. `limit` je najviac dní (vyše roka).
 */
export const DAYLOG = { limit: 400, fromMin: 180 };
export const DAYLOG_STORAGE_KEY = 'dni-v1';

/**
 * Tón hlášok novej appky (obloha/): drzý je predvolený (rozhodnuté 2. 10. 2026), slušný vyká
 * a je vecný. Súčasná appka hovorí len drzo. Prvý v zozname je predvolený.
 */
export const VOICES = /** @type {const} */ (['drzy', 'slusny']);

/**
 * Vzhľad novej appky - tón hlášok a živá obloha (vypnutá = pokojná tmavá). Sú to voľby len
 * novej appky, preto majú vlastný kľúč; súčasná appka ho nečíta. Formát: { ton, obloha }.
 */
export const LOOK_STORAGE_KEY = 'vzhlad-v1';

/**
 * Posledné počasie z Open-Meteo, spoločné pre obe appky (WEATHER_KEEP_MS). Formát: { url, at, json },
 * `url` je adresa, z ktorej prišlo (určuje lokalitu), `at` čas stiahnutia v ms.
 */
export const WEATHER_STORAGE_KEY = 'pocasie-v1';

/**
 * Prístup k meraniu, ktorý výrobca odmietol (shared/pristup.js). Appka si ho pamätá aj po zatvorení,
 * inak by každé otvorenie znova skúšalo zlé heslo. Formát: { pecat, n, at, kod, skusene }.
 * - `odmietnutia`: po koľkých odmietnutiach za sebou appka povie, že treba pripojiť znova. Jedno
 *   nestačí - Huawei občas odmietne aj správne heslo, keď je účet chvíľu prihlásený inde.
 * - `skusMs`: potom sa pýta len raz za hodinu. Huawei po piatich zlých prihláseniach zablokuje účet
 *   na 30 minút a Fox ESS či SolaX si každý dopyt počítajú do denného limitu.
 * - `pripomenutMs`: prístup, ktorý výrobca dáva len na čas (Deye 60 dní), pripomenie týždeň vopred.
 */
export const PRISTUP = { odmietnutia: 2, skusMs: 60 * 60 * 1000, pripomenutMs: 7 * 24 * 60 * 60 * 1000 };
export const PRISTUP_STORAGE_KEY = 'pristup-v1';

/**
 * Posledný dopyt na meranie v tomto prehliadači, spoločný pre obe appky (Rytmus v shared/zdroje.js).
 * Limity výrobcu sú na účet, nie na appku - Huawei dá dáta raz za 5 minút. Formát: { sposob, nazov, at, pv }.
 */
export const MERANIE_STORAGE_KEY = 'meranie-v1';

/**
 * Kotvy súčtov, ktoré výrobca neposiela (shared/sucty.js): celková výroba na začiatku roka, mesiaca
 * a dňa. Spoločné pre obe appky. Formát: { zdroj, posledne: { den, cas, cum }, rok, mesiac, den }.
 */
export const SUCTY_STORAGE_KEY = 'sucty-v1';

/**
 * Adresa, ktorú appka v tejto karte prehliadača naposledy zapísala (cesta a časť za mriežkou,
 * initUrlMirror vo web/settings-store.js). Je v sessionStorage - patrí karte a prežije jej obnovenie.
 * Po obnovení starej karty tak appka spozná, že staré nastavenie v adrese je jej vlastné, a neponúkne
 * ho prevziať namiesto novšieho uloženého.
 */
export const ADRESA_SESSION_KEY = 'adresa-v1';

/**
 * Značka v adrese (`&vlastna=1`), ktorú appka pripíše k nastaveniu, keď ho sama zrkadlí do adresy
 * (initUrlMirror). Taká adresa nie je odkaz od niekoho, len kópia uloženého - prehliadač si ju však
 * pamätá v histórii a ponúka ju aj v novej karte. Keď má appka niečo novšie (uložené nastavenie,
 * alebo údaje vymazané), vlastnú adresu neponúkne prevziať (linkHash). Odkaz zo Zdieľať ju nemá.
 */
export const VLASTNA_HASH_KEY = 'vlastna';

/**
 * Značka, že človek v tomto prehliadači vymazal údaje (Vymazať údaje, Nastaviť celé znova). Je to
 * jediné, čo vymazanie zapíše: stará adresa z histórie prehliadača potom staré nastavenie neponúkne.
 */
export const VYMAZANE_STORAGE_KEY = 'vymazane-v1';

/**
 * Všetky kľúče, pod ktorými appka niečo ukladá v localStorage - toľko zmaže „Vymazať údaje“
 * v Nastavení. Nový kľúč patrí sem, inak by po vymazaní ostal v prehliadači.
 */
export const STORAGE_KEYS = [
    SETTINGS_STORAGE_KEY,
    SITE_STORAGE_KEY,
    START_STORAGE_KEY,
    DAYLOG_STORAGE_KEY,
    LOOK_STORAGE_KEY,
    WEATHER_STORAGE_KEY,
    PRISTUP_STORAGE_KEY,
    MERANIE_STORAGE_KEY,
    SUCTY_STORAGE_KEY,
    VYMAZANE_STORAGE_KEY,
];

/** Prepočty do jednotiek, ktoré pozná každý: jedno nabitie mobilu (kWh) a dojazd auta na kWh. */
export const EVERYDAY = { phoneChargeKwh: 0.015, evKmPerKwh: 6 };

/**
 * Uhlík elektriny za celý životný cyklus (stavba, palivo, prevádzka, likvidácia), v CO2eq.
 * - `gridG`: g na kWh zo siete SR - priemer výroby podľa Ember, Yearly electricity data, SR 2025.
 *   Priemer, nie „uhlie, ktoré strecha nahradila“ - ten by úsporu nafúkol a nedá sa overiť.
 * - `debtKgPerKwp`: kg na kWp strešnej elektrárne vrátane meniča (dva za 30 rokov), konštrukcie,
 *   montáže a likvidácie - IEA PVPS Task 12, aktualizácia 2023, mono-Si: 35,8 g/kWh pri
 *   976 kWh/kWp ročne a 30 rokoch. Solárny faktor Ember (IPCC 2014, globálny) je starší a vyšší.
 * - Slnečný faktor pre SR (shared/carbon.js) je tento dlh rozpočítaný na výrobu v SR: `lifeYears`
 *   rokov po `yieldKwhPerKwp` kWh z kWp (PVGIS pre juh SR, 35°, okolo 1 150 - 1 200 kWh/kWp).
 * Pri novom ročníku zdroja zmeň čísla aj jeho meno.
 */
export const CARBON = {
    gridG: 95,
    gridSource: 'Ember 2025',
    debtKgPerKwp: 1050,
    pvSource: 'IEA PVPS 2023',
    lifeYears: 30,
    yieldKwhPerKwp: 1150,
};

// Kde appka beží a odkiaľ číta dáta.
export const APP_URL = 'https://rastislavsk.github.io/ray-mon/';
// Druhá appka „Živá obloha“ - na ňu vedie jej Zdieľať appku.
export const OBLOHA_URL = `${APP_URL}obloha/`;
export const WORKER_URL = 'https://ray-mon.rastislav-racek.workers.dev/';
// Živé meranie z meniča, ktorý si používateľ pripojil v Nastavení (`/pv`), a pripojenie samo
// (`/pripoj`). Zapečatený prístup aj údaje z formulára idú v tele POST požiadavky, nie
// v adrese - adresy požiadaviek končia v logoch Workera. Cesty čítajú appka aj Worker, aby sa
// nerozišli.
export const WORKER_PV_PATH = '/pv';
export const WORKER_PV_URL = new URL(WORKER_PV_PATH, WORKER_URL).href;
export const WORKER_PRIPOJ_PATH = '/pripoj';
export const WORKER_PRIPOJ_URL = new URL(WORKER_PRIPOJ_PATH, WORKER_URL).href;

/**
 * Verejný kiosk Huawei FusionSolar. Worker sťahuje len z týchto serverov a len túto cestu,
 * odkaz od používateľa dodá iba server a kľúč kiosku - inak by z Workera bol proxy server
 * na čokoľvek. `maxLinkLength` je najdlhší odkaz v znakoch; skutočné odkazy majú okolo stovky.
 */
export const KIOSK = {
    hostSuffix: 'fusionsolar.huawei.com',
    apiPath: '/rest/pvms/web/kiosk/v1/station-kiosk-file',
    maxLinkLength: 2000,
};

// Ako často sa čo obnovuje (ms).
export const REFRESH = {
    clockMs: 30 * 1000,
    dataMs: 60 * 1000,
};

// Najdlhšie čakanie appky na jednu sieťovú požiadavku (ms). Bez limitu by zaseknuté
// spojenie čakalo donekonečna.
export const TIMEOUT = {
    appMs: 15 * 1000,
};

/**
 * Ako sa Worker pýta servera výrobcu: najviac dva pokusy s pauzou medzi nimi, každý s vlastným
 * limitom (ms). Worker čaká na výrobcu kratšie než appka na Worker, aby sa jedna požiadavka aj
 * s opakovaním (2 × 5 s + 0,5 s) zmestila do jej limitu `TIMEOUT.appMs`. Kde meranie potrebuje
 * dve požiadavky, idú naraz, nie po sebe.
 */
export const VYROBCA_RETRY = { attempts: 2, delayMs: 500, timeoutMs: 5 * 1000 };

// Od akej viditeľnej výšky okna (px) sa v prehľade dní na karte 7 dní ukáže aj správa
// týždňa. Prehľad sám sa zmestí od 735 px; so správou potrebuje 860 px, a pri najdlhšej
// možnej správe na úzkom displeji (320 px) 878 px - namerané v Chromiu pri predvolenej
// veľkosti písma. 885 je tých 878 a malá rezerva. (Pred legendou farieb a väčším písmom
// dní to bolo o 24 px menej.)
//
// Rozhoduje skutočná viditeľná výška (visualViewport), nie rozlíšenie displeja: v mobilnom
// prehliadači ukrojí adresný riadok 60-90 px, a práve o tie tu ide. Keď sa správa nezmestí,
// jednoducho nie je - prehľad má ostať na jednu obrazovku bez scrollovania.
export const WEEK_MSG_MIN_H = 885;

// Ako dlho ostáva tooltip po ťuknutí zobrazený (ms).
export const TOOLTIP_HOLD_MS = 1600;

// Kedy je tooltip po skrytí naozaj neviditeľný. Musí byť aspoň taký dlhý ako prechod
// `opacity` na `.chart-tooltip` v style.css - až potom sa dajú zahodiť jeho súradnice.
export const TOOLTIP_FADE_MS = 200;

// Dáta staršie než toto sú "zastarané" a appka to ukáže. Platí pre stiahnutie z kiosku
// aj pre posledné meranie z meniča.
export const STALE_PV_MS = 20 * 60 * 1000;

// Nad touto výškou slnka (stupne) menič vyrába, takže mlčiaca krivka znamená výpadok.
// Pod ňou - ráno, večer a v noci - je bez merania normálne a "zastarané" by bol planý poplach.
export const STALE_PV_SUN_DEG = 5;

// Náhľad iného času na grafe dňa (web/teraz-gestures.js, v oboch appkách).
export const PREVIEW = {
    // O koľko posunie náhľad jedno ťuknutie šípkou na klávesnici.
    keyStepMin: 15,
};

// Rozlíšenie ťuknutia od švihnutia prstom na grafoch (tooltip vo web/interactions.js, náhľad času
// vo web/teraz-gestures.js). Karty sa ťahom nelistujú - len ťuknutím na ikonu v spodnej lište.
export const SWIPE = {
    minDistPx: 60, // od takéhoto posunu prsta to už nie je ťuknutie
    // Nad grafom je vodorovný ťah prezeraním krivky (tooltip ide za prstom); rýchlejší pohyb
    // je švihnutie, pri ktorom tooltip nemá ani preblikúť.
    flickMs: 300,
};

// Listovanie dní v detaile dňa karty 7 dní (shared/day-pager.js, web/day-pager.js, v oboch
// appkách): obsah ide za prstom, susedný deň je vidno už počas ťahu. Návrh a prečo tieto čísla:
// docs/navrhy/7dni-listovanie-dni.html.
export const DAY_PAGER = {
    lockPx: 9, // po takomto pohybe prsta sa rozhodne, či je to listovanie, alebo scroll
    axisRatio: 1.2, // listovanie, keď je vodorovný posun aspoň toľkokrát väčší než zvislý
    commit: 0.35, // podiel šírky, za ktorým sa po pustení deň prelistuje
    flickPxMs: 0.5, // švih rýchlejší než toto (px/ms) prelistuje aj pod prahom, opačný ťah zruší
    velocityMs: 80, // rýchlosť sa meria z posledných toľkých milisekúnd ťahu
    rubberMax: 0.2, // na prvom a poslednom dni sa pás poddá najviac o tento podiel šírky
    rubberK: 0.55, // tuhosť gumičky: čím menšie, tým tuhšia
    minMs: 180, // dojazd po pustení: krátka zvyšná dráha
    maxMs: 280, // dojazd po pustení: celá šírka
    gapPx: 16, // medzera medzi dňami v páse
};

/**
 * Živá obloha - pozadie novej appky (obloha/): prechod dvoch farieb podľa času dňa
 * a oblačnosti. Farby a ich priebeh sú z návrhu `docs/navrhy/smer-b-obloha.html` (`KEYS`
 * a `skyAt`). Hodiny v `keys` sú hodiny dňa z návrhu, v ktorom slnko vychádza o `riseH`
 * a zapadá o `setH`; skutočný východ a západ v polohe elektrárne do nich premieta
 * `skyColors` v shared/sky.js. Každý kľúč je [hodina, farba hore, farba dole].
 */
export const SKY = {
    riseH: 7,
    setH: 18.5,
    keys: /** @type {Array<[number, string, string]>} */ ([
        [0, '#070b1f', '#141b3d'],
        [5.5, '#0f1736', '#2b2f5c'],
        [7, '#4b5aa6', '#f0a98a'],
        [8.5, '#2f72c0', '#93c8ec'],
        [12, '#1767c9', '#4fa3e2'],
        [16, '#2864b4', '#cf9f6c'],
        [18, '#463a8a', '#e3804f'],
        [19.5, '#1d2257', '#5d437f'],
        [21, '#0b1130', '#1d2550'],
        [24, '#070b1f', '#141b3d'],
    ]),
    // Oblačnosť z Open-Meteo (cloud_cover, %): pod `clearPct` jasno, pod `overcastPct`
    // polojasno, inak zamračené.
    clearPct: 30,
    overcastPct: 70,
    // Koľko sivej sa cez deň primieša do farieb neba. V noci je oblačnosť vidno menej
    // (viď skyColors), dážď appka zatiaľ nepozná.
    cloudMix: { jasno: 0, polojasno: 0.45, zamracene: 0.78 },
    cloud: ['#5b6b82', '#98a5b5'],
    // Bez dát: sivá obloha, ktorá netvrdí nič o počasí.
    offline: ['#4f555f', '#7f858e'],
    // Vypnutá živá obloha (Nastavenie › Vzhľad): pokojná tmavá, nemení sa s časom ani počasím.
    calm: ['#1a2740', '#2c3d5c'],
    // Stmavený spodok: prechod od priehľadnej hore k tejto farbe dole, cez celú výšku obrazovky.
    // Koľko je dole sýty, počíta skyShade v shared/sky.js - práve toľko, aby biely text mal
    // v každej výške kontrast aspoň `shadeContrast`: WCAG pre bežný text chce 4,5, desatina
    // navyše je rezerva na zaokrúhlenie farieb v prehliadači a výšky medzi meranými bodmi.
    shade: '#050a1e',
    shadeContrast: 4.6,
};
