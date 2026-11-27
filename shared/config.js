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
 * sú v HTML a nemusia sa s nimi zhodovať (terazky je „Teraz“, mozem „Dnes“ - kedysi Môžem?). Prvá v zozname je karta, na ktorej sa
 * appky vždy otvárajú - karta Teraz s Plánom dňa odpovedá, čo a kedy zapnúť
 * (docs/navrhy/dnes-a-teraz.html).
 */
export const PANELS = /** @type {const} */ (['terazky', 'mozem', 'radar', '7dni', 'statistika', 'nastavenie']);

/**
 * Sekcie karty Nastavenie v poradí na karte - rovnaké (shared/nastavenie.js,
 * docs/navrhy/nastavenie-zjednotenie.html).
 */
export const NASTAVENIE_SEKCIE = /** @type {const} */ (['elektraren', 'doma', 'oznamenia', 'vzhlad', 'appka']);

/**
 * Šírky okna (px), od ktorých appka mení rozloženie. Pod `medium` je telefón aj tablet na
 * výšku: jedna karta a navigácia dole. Od `medium` (tablet na šírku) sú Môžem?, Teraz a 7 dní
 * v dvoch stĺpcoch, od `wide` (počítač) v troch, navigácia je hore. Rozhoduje šírka okna, nie druh zariadenia.
 */
export const LAYOUT_PX = { medium: 1024, wide: 1280 };

/** Minút v dni. Rozvrh tarify ich delí na pásma, graf dňa z nich ukáže deň so slnkom (DAYLIGHT_PAD_MIN). */
export const MINUTES_PER_DAY = 1440;

/**
 * Koľko minút pred východom a po západe slnka ešte ukáže graf dňa a pás dňa na karte Môžem?
 * (daylightSpan v solar.js). Kraje sa potom zaokrúhlia na celé hodiny smerom von.
 */
export const DAYLIGHT_PAD_MIN = 60;

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

/**
 * Oreže menič za jasných dní špičky? Áno, keď panely majú viac než menič o viac ako
 * SETTINGS_LIMITS.dcAcWarnRatio. Malý rozdiel je bežný a skoro nič nestojí.
 * @param {Plant} plant
 */
export function acClips(plant) {
    return installedKw(plant) > plant.acLimitKw * SETTINGS_LIMITS.dcAcWarnRatio;
}

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
        `&hourly=${R.ghi},${R.dni},${R.dhi},temperature_2m,cloud_cover,precipitation,snowfall` +
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
 * Spotreba domu na pozadí v kW (chladnička, router, pohotovostné režimy). Spotrebiču ostáva len
 * výroba nad ňou - Plán dňa aj odpovede karty Môžem? s ňou rátajú. Jedna pre každého, s veľkosťou
 * elektrárne sa nemení.
 */
export const HOUSE_BASE_KW = 0.4;

/**
 * Plán dňa zo živých dát (docs/navrhy/plan-dna-zive-data.html, balík B, 19. 11. 2026).
 * - Oprava predpovede: pomer meranie / predpoveď za posledných `oknoMin` minút pred posledným meraním (len keď
 *   predpoveď v okne dáva v priemere aspoň `minKw` a meraní je aspoň `minBodov`), obmedzený na `kMin`–`kMax`.
 *   Kým sa od 1 nelíši aspoň o `prah`, neplatí - plán by inak poskakoval pri každom meraní. Celý platí `plnaMin` minút
 *   za meraním, do `doMin` sa vytratí k čistej predpovedi.
 * - Meranie (výkon teraz, elektromer) staršie než `meranieMin` minút sa nepoužije.
 * - Základ domu z elektromera (dom bez bežiacich spotrebičov a bojlera) v rozsahu `domMin`–`domMax` kW platí
 *   `plnaMin` minút, do `doMin` sa vráti k HOUSE_BASE_KW.
 */
export const PLAN_ZIVE = {
    oknoMin: 60,
    minKw: 0.3,
    minBodov: 3,
    kMin: 0.3,
    kMax: 1.5,
    prah: 0.15,
    plnaMin: 60,
    doMin: 180,
    meranieMin: 15,
    domMin: 0.1,
    domMax: 4,
};

/**
 * Karta Môžem?: veci, na ktoré sa rodina pýta. Spotrebič (`device`) berie z DEVICES príkon
 * a pravidlá; `runMin` a `runKwh` sú typický program - podľa nich karta radí, dokedy ho pustiť,
 * a koľko stojí zo siete. Auto program nemá, pri ňom sa ráta hodina nabíjania; `runMin` bojlera
 * je typický ohrev nádrže. `heat` je profil odberu: úseky programu v minútach od štartu
 * `[od, do)`, keď spotrebič berie plný príkon (ohrev vody, pri sušičke a bojleri celý čas) -
 * tie potrebujú, aby nad spotrebou domu (HOUSE_BASE_KW) ostal celý príkon. Zvyšok `runKwh` sa
 * rozloží na ostatný čas programu.
 * Zoznam je jeden. Veci bez spotrebiča (`device: null`) sú od slnka nezávislé -
 * berú málo alebo krátko.
 * @type {Array<{ id: string, device: string | null, runMin: number | null, runKwh: number | null,
 *   heat: Array<[number, number]> | null }>}
 */
export const MOZEM_ITEMS = [
    { id: 'pracka', device: 'Práčka', runMin: 120, runKwh: 1, heat: [[0, 20]] },
    {
        id: 'umyvacka',
        device: 'Umývačka',
        runMin: 150,
        runKwh: 1.1,
        heat: [
            [0, 15],
            [120, 135],
        ],
    },
    { id: 'susicka', device: 'Sušička', runMin: 90, runKwh: 2.2, heat: [[0, 90]] },
    { id: 'auto', device: 'Auto', runMin: null, runKwh: null, heat: null },
    { id: 'bojler', device: 'Bojler', runMin: 60, runKwh: 2, heat: [[0, 60]] },
];

/**
 * Plán dňa (karta Môžem?): jadro rozvrhuje dnešné slnko medzi spotrebiče jeden po druhom - každý
 * si z neho odpočíta svoj odber, ďalší dostane, čo ostane. `order`: predvolené poradie. Iné poradie
 * spotrebičov vyhrá, len keď zmestí na slnko viac vecí alebo ušetrí aspoň `betterKwh` zo siete - inak sa riadky
 * zbytočne nepreskupujú
 * (docs/navrhy/plan-dna-poradie.html). `after`: spotrebič, na ktorý vec čaká (sušička suší, čo
 * práčka vyprala) - ide vždy hneď po jej konci a v ten istý deň, aj zo siete, nikdy nečaká na slnko
 * (variant B, 18. 11. 2026). `zoSiete`: pod týmto podielom slnka povie, že taká vec pôjde zo siete. `devices`: s čím plán ráta, kým si človek nevyberie sám.
 * Kratší kúsok lacného pásma nestojí za zapojenie bojlera bez zásuvky (cheapGrid): ide do lacného pásma, z ktorého
 * od štartu ostáva aspoň `lacnaMinMin` minút (docs/navrhy/plan-dna-oznamenie-vt.html, A1). Auto v pláne nie je, nabíjanie
 * riadi človek sám - karta Teraz ukáže, koľko by dalo slnko (AUTO_SLNKO, docs/navrhy/auto-mimo-planu.html).
 */
export const PLAN_DNA = {
    order: ['pracka', 'susicka', 'umyvacka', 'bojler'],
    after: /** @type {Record<string, string>} */ ({ susicka: 'pracka' }),
    zoSiete: 0.42,
    devices: ['pracka', 'umyvacka', 'susicka'],
    lacnaMinMin: 60,
    betterKwh: 0.1,
};

/**
 * Auto čisto zo slnka (docs/navrhy/auto-mimo-planu.html, A1 + K2 + B1 + Z1, 24. 11. 2026): koľko kWh a km by dalo
 * slnko, keby auto viselo na nabíjačke celý deň a práčka, sušička ani umývačka nebežali. Ráta sa prebytok nad domom
 * a bojlerom riadeným zásuvkou, najviac príkon nabíjačky (DEVICES); minúta s prebytkom pod `minKw` sa nepočíta -
 * nabíjačka pod minimom nenabíja (11 kW = 3 fázy, najmenej 6 A na fázu = 4,1 kW). Ráno odhad z predpovede, ktorý
 * sa cez deň nemení; `vecerMin` minút po západe slnka sa prepíše skutočnosťou.
 */
export const AUTO_SLNKO = { minKw: 4.1, vecerMin: 15 };
/** Auto zo slnka pre dnešok (shared/auto-slnko.js): { d, kwh, km, vecer }. Patrí telefónu, do odkazu nejde. */
export const AUTO_DEN_STORAGE_KEY = 'auto-den-v1';

/**
 * Auto sa asi nabíja (docs/navrhy/auto-nabija.html, D2 + R2 + T2 + N3 + P2, 24. 11. 2026). Auto sa appke neozýva - Durable
 * Object účtu Huawei to odhaduje z každého nového merania: spotreba domu bez bojlera aspoň AUTO_SLNKO.minKw (pod ním nabíjačka
 * nenabíja) `merani` merania za sebou = začalo, pod `skonciKw` `merani` merania za sebou = skončilo. Medzi meraniami nesmie
 * byť medzera nad `medzeraMin` - po nej sa počíta odznova. Výkon auta = dom bez bojlera mínus dom tesne pred nabíjaním
 * (najviac `zakladMaxKw`). Behy drží `dni` dní, najviac `maxBehov`. Stav bez merania dlhšie než `platnostMin` appka
 * neukáže ako nabíjanie. Oznámenia od `nocOd` do `nocDo` hodiny prídu potichu (N3).
 */
export const AUTO_NABIJA = {
    skonciKw: 3.5,
    merani: 2,
    medzeraMin: 15,
    zakladMaxKw: 1.5,
    dni: 7,
    maxBehov: 40,
    platnostMin: 30,
    nocOd: 22,
    nocDo: 6,
};
/** Oznámenia o nabíjaní auta na tomto telefóne: { z: začiatok, k: koniec } (prepínače v paneli Auto). */
export const AUTO_OZNAM_STORAGE_KEY = 'auto-oznam-v1';

/**
 * Hodiny, v ktorých karta Predpoveď na karte Dnes hľadá zrážky (od `od` do `do` bez nej): deň, ako ho
 * ľudia žijú, nie len svetlo - dážď o siedmej večer patrí do predpovede, o tretej v noci nie.
 */
export const PREDPOVED_HODINY = { od: 6, do: 22 };

/**
 * Trieda celého dňa pre veľké slovo karty Dnes (docs/navrhy/dnes-hlasky-dna.html), zo slnka
 * celého dňa od polnoci: výborný, keď sa všetky spotrebiče zmestia na slnko aj vtedy, keď by
 * strecha dala len `reserve` výkonu (rezerva na mrak), dobrý, keď sa zmestia všetky, slabý, keď
 * aspoň jeden, inak nanič. Bez spotrebičov doma ráta s predvolenými (PLAN_DNA.devices) - minúty
 * zelenej deň nerozlíšia, zelená začína už pri lowKw.
 */
export const DEN_TRIEDA = { reserve: 2 / 3 };

/**
 * Trieda dňa, ktorú appka pre dnešok videla ráno - s ňou karta Dnes porovná, či sa deň zlepšil či
 * pokazil. Patrí telefónu, do odkazu s nastavením nejde.
 */
export const RANNA_TRIEDA_STORAGE_KEY = 'ranna-trieda-v1';

/**
 * Trasy autom z polohy elektrárne do miest zo zoznamu (shared/trasy.js) pre podnadpis „km autom“
 * na karte Štatistika. Patria polohe, s ktorou boli stiahnuté; do odkazu s nastavením nejdú.
 * Formát: { lat, lon, trasy: [{ id, km }] }.
 */
export const TRASY_STORAGE_KEY = 'trasy-v1';

/**
 * Bojler na prebytky (shared/bojler.js, návrh docs/navrhy/bojler-prebytky.html). Rozhoduje sa podľa
 * prebytku bez bojlera = dodávka do siete z elektromera + príkon bojlera zo zásuvky (elektromer meria
 * celý dom vrátane bojlera). `zapKw`/`vypKw` sú predvolené prahy (zvolené 15. 11. 2026), každý musí
 * platiť `potvrdenia` meraní Huawei za sebou (meranie je raz za 5 minút). Po zapnutí beží aspoň
 * `minChodMin`, po vypnutí čaká aspoň `minPauzaMin`. Bez merania staršieho než `tichoMin` vypne;
 * to isté robí skript v zásuvke, keď mu `tichoMin` neodpovedá Worker. Príkon pod `hotovoW` pri
 * zapnutom relé znamená, že termostat bojler vypol (voda nahriata). Prahy sa v appke dajú meniť
 * po `krokKw` medzi `minKw` a `maxKw`; vypnutie musí byť aspoň o `medzeraKw` nižšie ako zapnutie.
 * Zásuvka, ktorá sa neozvala `riadenyHod` hodín, bojler už neriadi - appka s ním radí ako predtým.
 * Teplomer vo vode (docs/navrhy/bojler-teplota.html, B2): zásuvka si pri každom hlásení prečíta teplotu zo Shelly
 * s Add-onom v domácej sieti (snímač `teplomerId`, najviac `teplomerS` sekúnd) a pošle ju Workerovi. Ten si drží
 * bod každých `vodaKrokMin` minút za `vodaDni` dní. Hranica teploty (docs/navrhy/bojler-hranica.html, možnosť 2 + H2 + D1):
 * kým ju človek nenastaví, nie je. Nastavuje sa po 1 °C od `vodaMinC` do `vodaMaxC`, prvé zapnutie ponúkne `vodaStartC`.
 * Pri hranici zásuvka bojler vypne a znova ho pustí až pod hranicou mínus `vodaHystC`.
 * Energiu a odber zo siete si beh drží aj po `qMin` minútach (docs/navrhy/bojler-panel.html, D2) - po toľkých sa mení
 * pásmo tarify, takže appka z nich vie, čo išlo zo siete v drahom pásme.
 */
export const BOJLER = {
    zapKw: 2.3,
    vypKw: 2.0,
    potvrdenia: 2,
    minChodMin: 15,
    minPauzaMin: 10,
    tichoMin: 15,
    hotovoW: 50,
    krokKw: 0.1,
    minKw: 0.5,
    maxKw: 5,
    medzeraKw: 0.2,
    riadenyHod: 24,
    teplomerId: 100,
    teplomerS: 5,
    vodaKrokMin: 5,
    vodaDni: 7,
    vodaMinC: 40,
    vodaMaxC: 75,
    vodaStartC: 55,
    vodaHystC: 5,
    qMin: TARIFF_LIMITS.stepMin,
};

/**
 * Klimatizácia Daikin s lokálnym API (docs/navrhy/klima-daikin.html, adaptér BRP069B4X a podobné). Skript na Shelly sa
 * jej pýta každú minútu na stav a teploty, každých `hodinyMin` minút aj na energiu po hodinách a dňoch, každých `rokMin`
 * na mesiace roka; na jeden dopyt čaká `getS` sekúnd. Daikin hlási príkon (`mompow`) a energiu po `jednotkaWh` Wh.
 * Worker drží bod (teplota doma, vonku, príkon) každých `bodKrokMin` minút za `bodyDni` dní. Hlásenie staršie ako
 * `tichoMin` minút je bez spojenia; po `ukazHod` hodinách ticha dlaždica zmizne. Údaj, ktorý klimatizácia hlási ako
 * nezmysel (`-`), sa nepoužije; teploty mimo `minC` až `maxC` tiež nie.
 */
export const KLIMA = {
    hodinyMin: 15,
    rokMin: 60,
    getS: 5,
    jednotkaWh: 100,
    bodKrokMin: 5,
    bodyDni: 7,
    tichoMin: 5,
    ukazHod: 24,
    minC: -40,
    maxC: 60,
};

/**
 * Skupiny vecí: každá je jedna dlaždica s jednou odpoveďou. `size` je jej miesto
 * (`wide` cez celú šírku s pásom dňa, `half` polovica). Mená sú v messages.
 * @type {Array<{ id: string, items: string[], size: 'wide' | 'half' }>}
 */
export const MOZEM_GROUPS = [
    { id: 'velke', items: ['pracka', 'umyvacka', 'susicka'], size: 'wide' },
    { id: 'bojler', items: ['bojler'], size: 'wide' },
];

/**
 * Kľúče, ktoré appka už nepoužíva a pri štarte ich zmaže. Mená sa nesmú použiť znova na niečo
 * iné - v starších telefónoch pod nimi môžu ležať staré dáta. `spustenia-v1` boli zápisy
 * „Pustil/a som“ z karty Môžem?, `prva-karta-v1` voľba úvodnej karty - appka sa dnes otvára vždy
 * na karte Teraz, `teraz-den-v1` voľba pásu alebo krivky v karte Deň - dnes je tam len krivka.
 */
export const OLD_STORAGE_KEYS = ['spustenia-v1', 'prva-karta-v1', 'teraz-den-v1'];

/**
 * Denník výroby po dňoch pre súhrn na zdieľanie. Kiosk posiela len súčty (dnes, mesiac, rok),
 * takže dni si appka odkladá sama pri každej obnove merania. `fromMin`: zapisuje sa až od 03:00
 * miestneho času - tesne po polnoci môže kiosk ešte hlásiť včerajší súčet a ten by sa zapísal
 * ako dnešný. `limit` je najviac dní (vyše roka).
 */
export const DAYLOG = { limit: 400, fromMin: 180 };
export const DAYLOG_STORAGE_KEY = 'dni-v1';

/** Voľby karty Radar: oblaky a rýchlosť. Len v tomto prehliadači, do odkazu nepatria. */
export const RADAR_STORAGE_KEY = 'radar-v1';
/** Posledný model karty Radar, aby boli oblaky pri ďalšom otvorení hneď a Open-Meteo sa pýtalo menej. */
export const RADAR_MODEL_STORAGE_KEY = 'radar-model-v1';

/**
 * Tón hlášok: drzý je predvolený (rozhodnuté 2. 10. 2026), slušný vyká a je vecný. Voľba je
 * spoločná (Nastavenie › Vzhľad). Prvý v zozname je predvolený.
 */
export const VOICES = /** @type {const} */ (['drzy', 'slusny']);

/**
 * Vzhľad: tón hlášok a živá obloha (vypnutá = pokojná tmavá). Formát: { ton, obloha }.
 * Staršie uloženia majú aj `farba` (farba pozadia z pôvodnej appky), appka ju ignoruje.
 */
export const LOOK_STORAGE_KEY = 'vzhlad-v1';

/**
 * Posledné počasie z Open-Meteo (WEATHER_KEEP_MS). Formát: { url, at, json },
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
 * Posledný dopyt na meranie v tomto prehliadači (Rytmus v shared/zdroje.js).
 * Limity výrobcu sú na účet, nie na appku - Huawei dá dáta raz za 5 minút. Formát: { sposob, nazov, at, pv }.
 */
export const MERANIE_STORAGE_KEY = 'meranie-v1';

/**
 * Kotvy súčtov, ktoré výrobca neposiela (shared/sucty.js): celková výroba na začiatku roka, mesiaca
 * a dňa. Formát: { zdroj, posledne: { den, cas, cum }, rok, mesiac, den }.
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
 * Ranné oznámenie na tomto telefóne: zapnuté a hodina. Patrí telefónu, do odkazu s nastavením
 * nejde. Staršia verzia v ňom mala aj spotrebiče - tie sú teraz pod DOMA_STORAGE_KEY.
 */
export const OZNAMENIA_STORAGE_KEY = 'oznamenia-v1';
/** Kedy appka naposledy poslala odber Workeru (ms) - podľa toho ho obnovuje (OZNAMENIA.obnovDni). */
export const ODBER_STORAGE_KEY = 'odber-v1';

/**
 * Čo má človek doma: spotrebiče, s ktorými ráta Plán dňa aj ranné oznámenie (shared/doma.js).
 * Patrí telefónu, do odkazu s nastavením nejde. Formát: { devices }.
 */
export const DOMA_STORAGE_KEY = 'doma-v1';

/** Prahy bojlera na prebytky (shared/bojler.js), ktoré appka dá do skriptu zásuvky. Patria telefónu. */
export const BOJLER_STORAGE_KEY = 'bojler-v1';

/**
 * Teplomer v bojleri (docs/navrhy/bojler-teplota.html, N2): či ho človek má a jeho adresa v domácej sieti, do skriptu
 * zásuvky. Heslo sa neukladá - ide len do skriptu. Patrí telefónu. Formát: { on, ip }.
 */
export const TEPLOMER_STORAGE_KEY = 'teplomer-v1';

/**
 * Klimatizácia Daikin (docs/navrhy/klima-daikin.html): adresa jej adaptéra v domácej sieti, do skriptu na Shelly. Patrí
 * telefónu. Formát: { ip }.
 */
export const KLIMA_STORAGE_KEY = 'klima-v1';

/**
 * Spotrebič beží (docs/navrhy/teraz-bezi-spotrebic.html, A + 1; docs/navrhy/spotrebic-koniec-opakovanie.html):
 * „Už beží“ v detaile spotrebiča na karte Teraz zapíše beh a Plán dňa s ním ráta (shared/bezi.js). Len `veci` -
 * bojler riadi zásuvka a auto zatiaľ nie. Pri `zvysok` (práčka, sušička - ukazujú ho na displeji) sa appka pýta, koľko
 * programu zostáva - kolieskami hodín a minút, od `minZvysokMin` (1 - pri 0 by už dobehla) do `maxZvysokMin`. Umývačka
 * zvyšok neukazuje: pýta sa, kedy ju človek zapol, výberom času telefónu (docs/navrhy/spotrebic-cas-nastavenie.html,
 * A + D). Uloží až „Nastaviť“, ktoré zavrie panel a ukáže na `bublinaMs` bublinu s tým, čo sa nastavilo, a s „Vrátiť“ (P1).
 * Zápis platí len v ten deň a do odkazu s nastavením nejde. Pri Huawei Northbound ho telefóny domácnosti zdieľajú cez
 * Durable Object účtu (WORKER_BEZI_PATH, docs/navrhy/bezi-spolocne.html); zmenu, ktorú Worker ešte nepotvrdil, si telefón
 * pamätá v BEZI_CAKA_STORAGE_KEY a pošle ju znova.
 */
export const BEZI = {
    veci: ['pracka', 'umyvacka', 'susicka'],
    zvysok: ['pracka', 'susicka'],
    minZvysokMin: 1,
    maxZvysokMin: 360,
    bublinaMs: 6000,
};
export const BEZI_STORAGE_KEY = 'bezi-v1';
/**
 * Spotrebič na zásuvke Shelly (docs/navrhy/pracka-zasuvka.html, A + U1 + K2 + S2): skript v zásuvke každú minútu pošle
 * príkon a energiu (shared/zasuvka-skript.js), Durable Object účtu z toho rozozná beh (shared/zasuvka.js) a zapíše ho
 * do spoločných behov ako „Už beží“. Zásuvka nikdy neprepína relé. `veci`: čo môže na zásuvke byť.
 * Beh začne, keď je príkon aspoň `zapW` W v `potvrdenie` hláseniach za sebou (od prvého z nich). Skončí (K2), keď je
 * príkon pod `zapW` aspoň `pauzaMin` minút a beh trval aspoň `podielTyp` typickej dĺžky, alebo vždy po `dlhaPauzaMin`
 * minútach pod prahom; koniec je prvá chvíľa pod prahom. Typická dĺžka je medián posledných `typBehov` behov, od
 * `typMinBehov` behov, dovtedy `runMin` z MOZEM_ITEMS. Beh kratší než `minBehMin` sa zahodí. Zásuvka bez hlásenia
 * `tichoMin` minút uzavrie beh poslednou chvíľou s príkonom. Kým sa ozvala pred najviac `ozyvaMin` minútami, appka pri
 * spotrebiči „Už beží“ nemá (U1) a jej príkon sa nepočíta do domu.
 */
export const ZASUVKA = {
    veci: ['pracka', 'susicka', 'umyvacka'],
    zapW: 10,
    potvrdenie: 2,
    pauzaMin: 5,
    dlhaPauzaMin: 30,
    podielTyp: 0.7,
    typBehov: 10,
    typMinBehov: 3,
    minBehMin: 5,
    tichoMin: 30,
    ozyvaMin: 10,
};
/** Oznámenie o konci behu zo zásuvky (docs/navrhy/pracka-zasuvka.html): či ho tento telefón chce. Patrí telefónu. */
export const ZASUVKA_OZNAM_STORAGE_KEY = 'zasuvka-oznam-v1';

export const BEZI_CAKA_STORAGE_KEY = 'bezi-caka-v1';

/**
 * Zber histórie pre učenie Plánu dňa (docs/navrhy/plan-dna-ucenie.html, shared/historia.js). Worker si v Durable
 * Objecte účtu drží `dni` dní hodinových súhrnov výroby a spotreby domu a deň bojlera, telefón toľko isto dní snímok
 * predpovede (PREDPOVED_HIST_STORAGE_KEY) a behov z „Už beží“ (BEHY_HIST_STORAGE_KEY). Zatiaľ sa len zbiera, appka
 * z toho ešte nič nepočíta. Snímka predpovede je prvá predpoveď dňa, ktorú telefón videl od `snimkaOdMin`
 * (skôr ráno býva ešte včerajší beh modelu). Patrí telefónu, do odkazu s nastavením nejde.
 */
export const HISTORIA = { dni: 60, snimkaOdMin: 5 * 60 };
export const PREDPOVED_HIST_STORAGE_KEY = 'predpoved-hist-v1';
export const BEHY_HIST_STORAGE_KEY = 'behy-hist-v1';

/**
 * Učenie Plánu dňa z histórie (docs/navrhy/plan-dna-ucenie.html, C + M1, shared/ucenie.js): tabuľky sa každý deň
 * prepočítajú z histórie (HISTORIA.dni dní), novší deň váži viac (`polcasDni`). Políčko tabuľky platí od `minDni` dní,
 * potreba bojlera od `minDniBojler` dní, keď ho vypol termostat; inak predvolené hodnoty. Hodina histórie sa ráta, keď
 * má aspoň `minMerani` meraní a predpoveď aspoň `minKw`. Pomer meranie / predpoveď v jednej hodine je orezaný na
 * `pomer`, výsledná oprava predpovede na `oprava`. Oblačnosť sa delí na jasno / polojasno / zamračené hranicami
 * `oblacnost` (%), teplota dňa pre bojler hranicami `teploty` (°C), potreba bojlera je v rozsahu `bojlerWh`.
 */
export const UCENIE = {
    polcasDni: 14,
    minDni: 5,
    minDniBojler: 3,
    minMerani: 6,
    minKw: 0.3,
    pomer: [0.2, 2],
    oprava: [0.5, 1.5],
    oblacnost: [30, 70],
    teploty: [5, 15],
    bojlerWh: [500, 6000],
};
/** História elektrárne z Workera (`/historia`): { d, dni }. Nová appka ju už len číta, keď nemá model od Workera. */
export const HISTORIA_STORAGE_KEY = 'historia-v1';
/** Od ktorého dňa sa appka učí - „Začať odznova“ v Nastavení. Formát: dátum YYYY-MM-DD. */
export const UCENIE_OD_STORAGE_KEY = 'ucenie-od-v1';
/** Model učenia od Workera (docs/navrhy/ucenie-vo-workeri.html): { d, z, s, n, o, model }, web/ucenie.js. */
export const UCENIE_WORKER_STORAGE_KEY = 'ucenie-worker-v1';
/** Oznámenia bojlera na tomto telefóne zapnuté (vypínač v paneli Bojler dnes). */
export const BOJLER_OZNAM_STORAGE_KEY = 'bojler-oznam-v1';

/**
 * Všetky kľúče, pod ktorými appka niečo ukladá v localStorage - toľko zmaže „Vymazať údaje“
 * v Nastavení. Nový kľúč patrí sem, inak by po vymazaní ostal v prehliadači.
 */
export const STORAGE_KEYS = [
    SETTINGS_STORAGE_KEY,
    SITE_STORAGE_KEY,
    DAYLOG_STORAGE_KEY,
    LOOK_STORAGE_KEY,
    RADAR_STORAGE_KEY,
    RADAR_MODEL_STORAGE_KEY,
    WEATHER_STORAGE_KEY,
    PRISTUP_STORAGE_KEY,
    MERANIE_STORAGE_KEY,
    SUCTY_STORAGE_KEY,
    VYMAZANE_STORAGE_KEY,
    OZNAMENIA_STORAGE_KEY,
    ODBER_STORAGE_KEY,
    DOMA_STORAGE_KEY,
    BOJLER_STORAGE_KEY,
    BEZI_STORAGE_KEY,
    BEZI_CAKA_STORAGE_KEY,
    BOJLER_OZNAM_STORAGE_KEY,
    PREDPOVED_HIST_STORAGE_KEY,
    BEHY_HIST_STORAGE_KEY,
    HISTORIA_STORAGE_KEY,
    UCENIE_OD_STORAGE_KEY,
    UCENIE_WORKER_STORAGE_KEY,
    RANNA_TRIEDA_STORAGE_KEY,
    TRASY_STORAGE_KEY,
    AUTO_DEN_STORAGE_KEY,
    AUTO_OZNAM_STORAGE_KEY,
    KLIMA_STORAGE_KEY,
];

/** Prepočty do jednotiek, ktoré pozná každý: jedno nabitie mobilu (kWh) a dojazd auta na kWh. */
export const EVERYDAY = { phoneChargeKwh: 0.015, evKmPerKwh: 6 };

/**
 * Na čo stačia kilometre autom (shared/trasy.js): skutočné trasy autom z domu do miest zo zoznamu,
 * míľniky, cesta okolo Zeme a na Mesiac.
 * - Trasy ráta Worker (POST /trasy) cez smerovač OSRM nad mapou OpenStreetMap, raz pre polohu.
 *   Verejný server OSRM je bez záruky a len na nekomerčné použitie - pred obchodmi treba iného
 *   poskytovateľa alebo vlastný server; vymení sa len tu a vo Workeri.
 * - `najviacMiest` najbližších miest do `dosahKm` vzdušnou čiarou ide v jednej požiadavke.
 * - `prichytenieM`: smerovač cieľ, kam autom nevedie cesta (ostrov), prichytí k najbližšej ceste -
 *   ďalej než toľko metrov od mesta je to iné miesto a trasa sa zahodí. To isté platí pre domov.
 * - `tolerancia`: trasa sedí, keď sa od kilometrov líši najviac o tento podiel.
 * - `zemOdKm`: keď nesedí žiadna trasa, od tejto vzdialenosti podiel cesty okolo Zeme.
 * - Dĺžky: rovník Zeme 40 075 km, priemerná vzdialenosť Mesiaca 384 400 km (NASA), Route 66
 *   3 940 km, Transsibírska magistrála Moskva – Vladivostok 9 289 km.
 */
export const TRASY = {
    osrmUrl: 'https://router.project-osrm.org/table/v1/driving/',
    najviacMiest: 90,
    dosahKm: 4000,
    prichytenieM: 5000,
    tolerancia: 0.15,
    zemOdKm: 5000,
    zemKm: 40075,
    mesiacKm: 384400,
    milniky: [
        { id: 'route66', km: 3940 },
        { id: 'transsib', km: 9289 },
    ],
};

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
export const WORKER_URL = 'https://ray-mon.rastislav-racek.workers.dev/';
// Živé meranie z meniča, ktorý si používateľ pripojil v Nastavení (`/pv`), a pripojenie samo
// (`/pripoj`). Zapečatený prístup aj údaje z formulára idú v tele POST požiadavky, nie
// v adrese - adresy požiadaviek končia v logoch Workera. Cesty čítajú appka aj Worker, aby sa
// nerozišli.
export const WORKER_PV_PATH = '/pv';
export const WORKER_PV_URL = new URL(WORKER_PV_PATH, WORKER_URL).href;
export const WORKER_PRIPOJ_PATH = '/pripoj';
export const WORKER_PRIPOJ_URL = new URL(WORKER_PRIPOJ_PATH, WORKER_URL).href;
// Ranné oznámenie: odber tohto telefónu (`/oznamenia`, POST uloží, s `on: false` zruší) a jednorazová
// pripomienka z tlačidla v oznámení (`/pripomen`).
export const WORKER_OZNAMENIA_PATH = '/oznamenia';
export const WORKER_OZNAMENIA_URL = new URL(WORKER_OZNAMENIA_PATH, WORKER_URL).href;
export const WORKER_PRIPOMEN_PATH = '/pripomen';
export const WORKER_PRIPOMEN_URL = new URL(WORKER_PRIPOMEN_PATH, WORKER_URL).href;
// Oznámenie o konci programu (`/koniec`, docs/navrhy/spotrebic-koniec-opakovanie.html): telefón objedná push s textom
// na čas konca behu, bez času ho zruší. Oznámenia bojlera (`/bojler-oznamenia`): telefón sa prihlási či odhlási.
export const WORKER_KONIEC_PATH = '/koniec';
export const WORKER_KONIEC_URL = new URL(WORKER_KONIEC_PATH, WORKER_URL).href;
export const WORKER_BOJLER_OZNAM_PATH = '/bojler-oznamenia';
export const WORKER_BOJLER_OZNAM_URL = new URL(WORKER_BOJLER_OZNAM_PATH, WORKER_URL).href;
/**
 * Push s textom (docs/navrhy/spotrebic-koniec-opakovanie.html). `maxText`: najdlhší nadpis a text v znakoch. `maxDopreduH`: koniec
 * najviac toľko hodín dopredu. `maxOdberov`: koľko telefónov si oznámenia bojlera jednej elektrárne zapne najviac.
 */
export const PUSH_TEXT = { maxText: 200, maxDopreduH: 8, maxOdberov: 10 };
// Pečať do odkazu Zdieľať appku (`/zdielaj`): prístup k meraniu s platnosťou `platiDni` dní. Odkaz
// ostáva v správach natrvalo, prístup v ňom nie - kto ho otvorí neskôr, pripojí si meranie sám.
export const WORKER_ZDIELAJ_PATH = '/zdielaj';
export const WORKER_ZDIELAJ_URL = new URL(WORKER_ZDIELAJ_PATH, WORKER_URL).href;
export const ZDIELANIE = { platiDni: 7 };
// Trasy autom z polohy (`/trasy`) pre podnadpis „km autom“ na karte Štatistika. Poloha ide v tele.
export const WORKER_TRASY_PATH = '/trasy';
export const WORKER_TRASY_URL = new URL(WORKER_TRASY_PATH, WORKER_URL).href;
// Bojler na prebytky (docs/navrhy/bojler-prebytky.html): skript v zásuvke Shelly sa každú minútu
// opýta `/bojler`, či má bojler zapnúť. `/bojler-pecat` vydá appke pečať do skriptu, `/bojler-rezim`
// uloží, či bojler riadi appka, alebo ho človek zapína ručne. `/bojler-stav` vráti appke posledné hlásenie
// zásuvky bez merania - appka sa naň pýta každú minútu, meranie Huawei je len raz za 5 minút.
export const WORKER_BOJLER_PATH = '/bojler';
export const WORKER_BOJLER_URL = new URL(WORKER_BOJLER_PATH, WORKER_URL).href;
export const WORKER_BOJLER_PECAT_PATH = '/bojler-pecat';
export const WORKER_BOJLER_PECAT_URL = new URL(WORKER_BOJLER_PECAT_PATH, WORKER_URL).href;
export const WORKER_BOJLER_REZIM_PATH = '/bojler-rezim';
export const WORKER_BOJLER_REZIM_URL = new URL(WORKER_BOJLER_REZIM_PATH, WORKER_URL).href;
export const WORKER_BOJLER_HRANICA_PATH = '/bojler-hranica';
export const WORKER_BOJLER_HRANICA_URL = new URL(WORKER_BOJLER_HRANICA_PATH, WORKER_URL).href;
export const WORKER_BOJLER_STAV_PATH = '/bojler-stav';
export const WORKER_BOJLER_STAV_URL = new URL(WORKER_BOJLER_STAV_PATH, WORKER_URL).href;
// Auto sa nabíja (docs/navrhy/auto-nabija.html): `/auto` vráti appke stav a behy nabíjania z Durable Objectu účtu (bez
// merania, appka sa pýta pri každej obnove dát), `/auto-oznamenia` zapne či vypne telefónu oznámenia o začiatku a konci.
export const WORKER_AUTO_PATH = '/auto';
export const WORKER_AUTO_URL = new URL(WORKER_AUTO_PATH, WORKER_URL).href;
export const WORKER_AUTO_OZNAM_PATH = '/auto-oznamenia';
export const WORKER_AUTO_OZNAM_URL = new URL(WORKER_AUTO_OZNAM_PATH, WORKER_URL).href;
// Klimatizácia Daikin (docs/navrhy/klima-daikin.html): skript na Shelly v domácej sieti posiela `/klima` odpovede lokálneho
// API klimatizácie (s pečaťou z `/bojler-pecat`), appka si stav berie cez `/klima-stav` pri každej obnove dát.
export const WORKER_KLIMA_PATH = '/klima';
export const WORKER_KLIMA_URL = new URL(WORKER_KLIMA_PATH, WORKER_URL).href;
export const WORKER_KLIMA_STAV_PATH = '/klima-stav';
export const WORKER_KLIMA_STAV_URL = new URL(WORKER_KLIMA_STAV_PATH, WORKER_URL).href;
// Spotrebič na zásuvke Shelly (docs/navrhy/pracka-zasuvka.html): skript v zásuvke posiela `/spotrebic` (s pečaťou
// z `/bojler-pecat`), telefón si oznámenie o konci zapne cez `/spotrebic-oznamenia`. Stav zásuviek chodí s `/bezi`.
export const WORKER_SPOTREBIC_PATH = '/spotrebic';
export const WORKER_SPOTREBIC_URL = new URL(WORKER_SPOTREBIC_PATH, WORKER_URL).href;
export const WORKER_SPOTREBIC_OZNAM_PATH = '/spotrebic-oznamenia';
export const WORKER_SPOTREBIC_OZNAM_URL = new URL(WORKER_SPOTREBIC_OZNAM_PATH, WORKER_URL).href;
/**
 * História elektrárne z Durable Objectu účtu Huawei (docs/navrhy/plan-dna-ucenie.html). Model učenia z nej počíta Worker
 * (WORKER_UCENIE_PATH); appka si ju stiahne raz za deň po západe slnka - dnešné hodiny domu na večerný prepis auta zo
 * slnka (docs/navrhy/auto-mimo-planu.html).
 */
export const WORKER_HISTORIA_PATH = '/historia';
export const WORKER_HISTORIA_URL = new URL(WORKER_HISTORIA_PATH, WORKER_URL).href;
/**
 * Spoločné behy „Už beží“ telefónov domácnosti (docs/navrhy/bezi-spolocne.html), v Durable Objecte účtu Huawei.
 * Appka sa pýta pri každej obnove dát (každú minútu a po návrate do appky) a pošle aj nepotvrdené zmeny.
 */
export const WORKER_BEZI_PATH = '/bezi';
export const WORKER_BEZI_URL = new URL(WORKER_BEZI_PATH, WORKER_URL).href;
/**
 * Model učenia Plánu dňa z Durable Objectu účtu Huawei (docs/navrhy/ucenie-vo-workeri.html): Worker ho počíta raz za
 * deň, telefóny domácnosti ho dostanú hotový. Telefón sa pýta raz za deň a keď má novú snímku predpovede dneška.
 */
export const WORKER_UCENIE_PATH = '/ucenie';
export const WORKER_UCENIE_URL = new URL(WORKER_UCENIE_PATH, WORKER_URL).href;
export const WORKER_RADAR_PATH = '/radar/';
export const WORKER_RADAR_URL = new URL(WORKER_RADAR_PATH, WORKER_URL).href;

/**
 * Karta Radar (docs/navrhy/radar.html). Kompozit OPERA má mriežku 1 km a 30 samostatne
 * komprimovaných blokov. Worker z neho prepošle len bloky do `dosahKm` od polohy, zvyšok spočíta
 * prehliadač. Predpoveď na 2 h je posun poslednej snímky podľa pohybu, Dnes a Zajtra model ICON-EU.
 */
export const RADAR = {
    // Zdroje snímok v poradí pokusov. Hlavný (CloudFerro) bol 13. 11. 2026 prázdny a OPERA ho
    // dočasne nahradila zálohou na ECMWF s tými istými menami súborov. Worker skúsi hlavný a pri 404
    // zálohu, takže keď sa hlavný vráti alebo záloha skončí, netreba nič meniť.
    s3: ['https://s3.waw3-1.cloudferro.com/openradar-24h/', 'https://object-store.os-api.cci1.ecmwf.int/openradar-24h-backup/'],
    stlpce: 3800,
    riadky: 4400,
    blokStlpce: 880,
    blokRiadky: 760,
    dosahKm: 250,
    zmensenie: 2,
    krokMin: 5,
    minulostMin: 120,
    buducnostMin: 120,
    // Najnovšia snímka býva zverejnená o 4-5 minút, preto treba skúsiť aj staršie kroky.
    pokusov: 5,
    // Staršie snímky sa sťahujú po štyroch naraz, aby sa nečakalo jedna na druhú.
    subezne: 4,
    // Ďalšia snímka sa čaká krok + zverejnenie po najnovšej; potom sa appka pýta najviac raz za `obnovaPokusMs`,
    // kým je karta na obrazovke (pri prepnutí karty, návrate do appky a každú minútu).
    zverejnenieMin: 5,
    obnovaPokusMs: 60 * 1000,
    // Najnovšia snímka staršia ako toto „mešká“ (výpadok OPERA, slabý signál): vek pri nej má inú farbu.
    meskaMin: 15,
    // Najdlhšie čakanie na všetky dáta pred prehrávaním. Potom sa prehrá to, čo prišlo (napr. bez modelu pri limite 429).
    cakanieMs: 30000,
    // Prehrávanie pri 1×: dve hodiny merania a dve predpovede za 16 s, deň za 23 s. Prehrá sa raz a zastane.
    krokovZaS: 3,
    hodinZaS: 1,
    rychlosti: /** @type {const} */ ([1, 2, 3]),
    dbz: { od: 8, do: 60, prah: 9 },
    cistenie: { susedia: 6, ostrov: 40 },
    pohyb: { mriezka: 32, hladanie: 14, okno: 30, minEnergia: 1200, mierny: 20000, mierka: 20 },
    // Predpoveď slabne, lebo posun nevie, že dážď zaniká. Zmeraná presnosť: docs/navrhy/radar.html.
    predpovedSlabne: 0.992,
    // Každý bod sa zrejme ráta ako samostatné volanie Open-Meteo: mriežka 20 × 30 po pár otvoreniach narazila
    // na limit 429 a zastavila aj predpoveď appky. Model sa mení raz za 3 hodiny, častejšie sa pýtať netreba.
    modelBodyX: 16,
    modelBodyY: 14,
    modelBodovNaDopyt: 300,
    modelZjemnenie: 10,
    modelObnovaMs: 3 * 60 * 60 * 1000,
    farby: [
        { dbz: 8, farba: '#2b6cff', krytie: 0 },
        { dbz: 11, farba: '#2f7bff', krytie: 0.5 },
        { dbz: 20, farba: '#2b8cf5', krytie: 0.78 },
        { dbz: 26, farba: '#22b8f0', krytie: 0.86 },
        { dbz: 32, farba: '#34e0a1', krytie: 0.92 },
        { dbz: 39, farba: '#ffe14d', krytie: 0.96 },
        { dbz: 46, farba: '#ff7a2f', krytie: 1 },
        { dbz: 52, farba: '#ff2d6b', krytie: 1 },
        { dbz: 60, farba: '#ffd0f5', krytie: 1 },
    ],
    // Sneh a dážď so snehom (docs/navrhy/radar-sneh.html, D1 + V1, 26. 11. 2026). Sneh sa vníma v centimetroch: 30 dBZ
    // je v snehu okolo 1 cm za hodinu, husté sneženie, v daždi len mierny dážď. Paleta snehu preto silnie pri nižších dBZ:
    // slabý bledomodrý, stredný biely, silný fialový.
    farbySneh: [
        { dbz: 8, farba: '#bcd4ff', krytie: 0 },
        { dbz: 10, farba: '#c7dcff', krytie: 0.55 },
        { dbz: 15, farba: '#dde9ff', krytie: 0.76 },
        { dbz: 21, farba: '#ffffff', krytie: 0.88 },
        { dbz: 27, farba: '#e6cfff', krytie: 0.94 },
        { dbz: 33, farba: '#c492ff', krytie: 1 },
        { dbz: 40, farba: '#9a5cff', krytie: 1 },
        { dbz: 52, farba: '#7a3cff', krytie: 1 },
    ],
    farbyZmiesane: [
        { dbz: 8, farba: '#f4b6e6', krytie: 0 },
        { dbz: 11, farba: '#f2a8e3', krytie: 0.5 },
        { dbz: 19, farba: '#ee93dc', krytie: 0.78 },
        { dbz: 27, farba: '#e57bd6', krytie: 0.9 },
        { dbz: 35, farba: '#d35fcb', krytie: 0.96 },
        { dbz: 44, farba: '#bb45bd', krytie: 1 },
        { dbz: 56, farba: '#9c2fa8', krytie: 1 },
    ],
    // Podiel snehu v zrážkach z modelu ICON-EU: Open-Meteo dáva sneh v cm, 1 mm vody = 0,7 cm (overené 26. 11. 2026,
    // zrážky 1,2 mm = sneh 0,84 cm). Kde model zrážky nemá a radar áno, rozhodne teplota pri zemi. Od `zmiesaneOd` je to
    // dážď so snehom, od `snehOd` sneh, na hranici sa farby prelínajú v pásme `prechod`. Zrážky modelu (voda v mm) idú
    // na dBZ pri snehu vzťahom Z = zsA · S^zsB (Sekhon a Srivastava), pri daždi Z = 200 · R^1,6.
    sneh: { cmNaMm: 0.7, minMm: 0.05, tSneh: 0, tDazd: 2, zmiesaneOd: 0.35, snehOd: 0.65, prechod: 0.03, zsA: 2000, zsB: 2 },
    // Mapa nemá vlastné pozadie, pod ňou je obloha appky so závojom (css/radar.css, rozhodnuté 14. 11. 2026).
    // Voda a čiary sú preto priesvitné, aby ladili s každou farbou oblohy.
    mapa: {
        voda: 'rgba(5, 10, 30, 0.32)',
        hranica: 'rgba(255, 255, 255, 0.45)',
        cesta: 'rgba(255, 255, 255, 0.1)',
        text: '#a9b6cc',
        textOkraj: '#0d1422',
    },
    styl: 'https://tiles.openfreemap.org/styles/dark',
    zoom: 5.6,
    zdroj: 'Radar EUMETNET OPERA, CC BY 4.0, upravené · Model DWD ICON-EU, Open-Meteo, CC BY 4.0',
    // Výnimka z pravidla o závislostiach, len pre túto kartu. Pri zmene verzie treba zmeniť aj hashe (uvádza ich cdnjs).
    maplibre: {
        js: 'https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.24.0/maplibre-gl.js',
        jsHash: 'sha512-rOFgoUgWaVi69JW1dzBu6PWF9xKW9rxYfY5u2SexFABHhWk0qUWkJoWNz4UuZRMvSXsNZG66+tU5B+HlwWF5kA==',
        css: 'https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.24.0/maplibre-gl.css',
        cssHash: 'sha512-KIMsMWIdnoG9OwZa+oaIafmbDonqck1UCmq+/zcUi2aaZ97N9QE6TqpTM+n36EO40HGh64hU/375zxtjx7WTyQ==',
    },
};
/** Adresa modelu pre body výrezu, po hodinách, dnes a zajtra. @param {Array<{ lat: number, lon: number }>} body */
export function radarModelUrl(body) {
    /** @param {'lat' | 'lon'} k */
    const zoznam = (k) => body.map((b) => b[k].toFixed(3)).join(',');
    return (
        'https://api.open-meteo.com/v1/forecast' +
        `?latitude=${zoznam('lat')}&longitude=${zoznam('lon')}` +
        '&hourly=precipitation,cloud_cover,snowfall,temperature_2m&models=icon_eu&forecast_days=2&timeformat=unixtime&timezone=auto'
    );
}

/**
 * Ranné oznámenie s plánom dňa. `hours`: hodiny, z ktorých si človek vyberie (miestny čas),
 * `hour` predvolená. Worker budí raz za `stepMin` minút (cron vo worker/wrangler.toml), takže
 * oznámenie aj pripomienka prídu do štvrťhodiny od svojho času. `remindMaxH`: pripomienka najviac
 * tak ďaleko dopredu. `vapidPublic`: verejný kľúč VAPID (súkromný je tajomstvo Workera
 * VAPID_JWK), ním sa telefón prihlási k odberu. `pushHosts`: služby, na ktoré Worker push pošle -
 * inú adresu odberu odmietne, aby z neho nebol proxy server na čokoľvek. `remindWindowMin`:
 * pripomienka patrí budeniu do toľkých minút od svojho času. `jwtH`: ako dlho platí podpis VAPID.
 * `timeoutMs`: najdlhšie čakanie na service worker a Worker, potom appka povie, že sa nepodarilo.
 */
/**
 * Výhľad dní bez slnka (docs/navrhy/vyhlad-dni-bez-slnka.html): ranné oznámenie a karta Teraz
 * upozornia vopred o toľko dní, koľko dní bez slnka ide za sebou, najviac `maxDni`.
 */
export const VYHLAD = { maxDni: 3 };

/**
 * Týždeň na karte Teraz (docs/navrhy/teraz-pas-dni.html): pás ukáže najviac `dni` dní predpovede. Núdzový čas v deň, keď sa spotrebič
 * na slnko nezmestí: cez deň, keď slnko pokryje aspoň `minPodiel` programu, inak v lacnom pásme.
 */
export const TYZDEN = { dni: 4, minPodiel: 0.25 };

export const OZNAMENIA = {
    hours: [7, 8, 9],
    hour: 9,
    stepMin: 15,
    remindMaxH: 16,
    remindWindowMin: 20,
    jwtH: 12,
    timeoutMs: 15000,
    // Odber, ktorý appka `odberDni` dní neobnovila, vo Workeri sám vyprší; appka ho pri štarte
    // obnoví, keď je starší než `obnovDni` dní. Telefón, na ktorom appku nikto neotvára, tak
    // v úložisku Workera neostane navždy.
    odberDni: 180,
    obnovDni: 30,
    vapidPublic: 'BN5f22u_HXM_8YkH2CWmaNESDDADrK5RfWog4dSGGNl8OVAywRlD6bRL_3lX6bP2xXLWut8K6YrwFJRIoqoFGac',
    pushHosts: ['fcm.googleapis.com', 'updates.push.services.mozilla.com', '.push.apple.com', '.notify.windows.com'],
    maxEndpoint: 900,
    // Service worker nevidí localStorage: appka mu nastavenie odkladá do Cache API pod `mirror`,
    // pripomienky z tlačidla si service worker drží sám pod `reminders`.
    cache: 'ray-mon-oznamenia',
    mirror: 'oznamenia-nastavenie.json',
    reminders: 'oznamenia-pripomienky.json',
    // Výhľad dní bez slnka, ktorý oznámenie povedalo naposledy - z neho je „Lepšie / Horšie“.
    vyhlad: 'oznamenia-vyhlad.json',
    // Ťuknutie na oznámenie: správa od service workera bežiacej appke a hodnota značky v adrese
    // zatvorenej (shared/oznamenia.js). Oživená ikona dlaždice (docs/navrhy/oznamenia-animacie.html)
    // počká na dáta najviac `ozivCakaMs` a od chvíle, keď je dlaždica v stránke, trvá `ozivMs`.
    klik: 'oznamenie',
    ozivCakaMs: 20000,
    ozivMs: 3000,
    // Push o zmene ohrevu bojlera má túto značku a service worker ju pošle aj bežiacej appke ako správu -
    // appka si hneď stiahne stav bojlera, dlaždica nečaká na ďalší minútový dopyt.
    bojler: 'bojler',
    // Push o začiatku či konci nabíjania auta (docs/navrhy/auto-nabija.html) - service worker ho tiež pošle bežiacej appke.
    auto: 'auto',
};

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

// Dáta staršie než toto sú "zastarané" a appka to ukáže. Platí pre stiahnutie z kiosku
// aj pre posledné meranie z meniča.
export const STALE_PV_MS = 20 * 60 * 1000;

/**
 * Tlačidlo Späť (web/nav-history.js): koľko posledných krokov navigácie vráti, kým skočí na kartu
 * Teraz, a ako dlho svieti bublina pred zatvorením appky (ms). Rozhodnuté 19. 11. 2026.
 */
export const SPAT = { krokov: 5, bublinaMs: 2000 };

/** Ako dlho svieti bublina „Meranie pripojené“ nad navigáciou, kým sama zmizne (ms). */
export const PRIPOJENIE_BUBLINA_MS = 5000;

/** Ako dlho svieti zelené „Uložené“ pod prepínačom režimu bojlera, kým sa vráti popis režimu (ms). */
export const BOJLER_ULOZENE_MS = 2500;

/** Okná domu v scéne karty Teraz svietia v tme, okrem času na spánok (miestne minúty dňa, od vrátane, do bez). */
export const TERAZ_OKNA_SPANOK = { od: 0, do: 5 * 60 };

/**
 * Dlaždice spotrebičov na karte Teraz v dvoch stĺpcoch (docs/navrhy/teraz-dlazdice-stlpce.html): pravý stĺpec v tomto
 * pevnom poradí, všetko ostatné (práčka, sušička, umývačka) v ľavom podľa času spustenia. Všetky dlaždice sú celé.
 */
export const TERAZ_STLPCE = {
    pravy: ['bojler', 'auto', 'klima'],
};

// Nad touto výškou slnka (stupne) menič vyrába, takže mlčiaca krivka znamená výpadok.
// Pod ňou - ráno, večer a v noci - je bez merania normálne a "zastarané" by bol planý poplach.
export const STALE_PV_SUN_DEG = 5;

// Náhľad iného času na grafe dňa (web/teraz-gestures.js,).
export const PREVIEW = {
    // O koľko posunie náhľad jedno ťuknutie šípkou na klávesnici.
    keyStepMin: 15,
};

// Posuvník dňa hore na karte Dnes (docs/navrhy/dnes-tlacidlo-teraz.html, T4c, web/mozem-interactions.js): krok
// prsta a kurzora v minútach a do koľkých minút od teraz sa bežec prilepí na teraz. Šípky posúvajú po
// PREVIEW.keyStepMin.
export const DNES_OS = {
    krokMin: 5,
    prilepMin: 10,
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
 * Živá obloha - pozadie: prechod dvoch farieb podľa času dňa
 * a oblačnosti. Farby a ich priebeh sú z návrhu `docs/navrhy/smer-b-obloha.html` (`KEYS`
 * a `skyAt`). Hodiny v `keys` sú hodiny dňa z návrhu, v ktorom slnko vychádza o `riseH`
 * a zapadá o `setH`; skutočný východ a západ v polohe elektrárne do nich premieta
 * `skyColors` v shared/sky.js. Každý kľúč je [hodina, farba hore, farba dole]. Noc (od 19:30
 * do 5:30) je tmavá, takmer čierna s nádychom modrej (docs/navrhy/obloha-noc.html).
 */
export const SKY = {
    riseH: 7,
    setH: 18.5,
    keys: /** @type {Array<[number, string, string]>} */ ([
        [0, '#030616', '#081028'],
        [5.5, '#0a1029', '#1c2147'],
        [7, '#4b5aa6', '#f0a98a'],
        [8.5, '#2f72c0', '#93c8ec'],
        [12, '#1767c9', '#4fa3e2'],
        [16, '#2864b4', '#cf9f6c'],
        [18, '#463a8a', '#e3804f'],
        [19.5, '#141947', '#433262'],
        [21, '#060a1f', '#0d1430'],
        [24, '#030616', '#081028'],
    ]),
    // Súmrak podľa výšky slnka pod obzorom (°), ako ho delia meteorológovia: do -6° občiansky
    // súmrak, do -12° sa stmieva, pod -18° je najhlbšia noc. Body sú [výška slnka, hodina
    // návrhu]; medzi nimi a západom (`setH`) či východom (`riseH`) sa farba mení plynule. Ráno
    // má aj bod pri -12°, aby rovnaká výška slnka dala večer aj ráno podobnú nočnú farbu.
    sumrak: {
        vecer: /** @type {Array<[number, number]>} */ ([
            [-6, 19.5],
            [-12, 21],
            [-18, 24],
        ]),
        rano: /** @type {Array<[number, number]>} */ ([
            [-18, 0],
            [-12, 3],
            [-6, 5.5],
        ]),
    },
    // Oblačnosť z Open-Meteo (cloud_cover, %): pod `clearPct` jasno, pod `overcastPct`
    // polojasno, inak zamračené.
    clearPct: 30,
    overcastPct: 70,
    // Koľko sivej sa cez deň primieša do farieb neba. V noci je oblačnosť vidno menej
    // (viď skyColors). Hodnoty platia pre zamračenosť 0, 0,5 a 1 (shared/pocasie.js), medzi nimi
    // sa menia plynule - nebo je modrosivé podľa sily oblačnosti; dážď a sneh sú zamračenosť 1.
    cloudMix: { jasno: 0, polojasno: 0.45, zamracene: 0.78 },
    cloud: ['#5b6b82', '#98a5b5'],
    // Koľko farebného odtieňa neba po primiešaní oblakov zmizne (0 = nič, 1 = sivá s rovnakým
    // jasom), cez deň aj v noci, rovnako plynule. Polojasno je ešte modré, zamračená obloha sivá
    // celá, aby za oblakmi nebolo vidno modrú.
    sivost: { jasno: 0, polojasno: 0, zamracene: 1 },
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
    // Ikona aktívnej karty v navigácii má farbu obzoru (spodok oblohy) zosvetlenú bielou na tento
    // relatívny jas (WCAG, 0-1). Samotná obloha by na tmavom páse navigácie v noci zmizla. Neaktívne
    // ikony sú tlmené (--icon-dim v css/zaklad.css), takže aktívna je pri tomto jase vždy najsvetlejšia
    // a odtieň oblohy jej ostane (docs/navrhy/navigacia-farba-oblohy.html).
    navJas: 0.45,
    // Sklo dlaždíc na karte Teraz podľa oblohy (skySklo v shared/sky.js, docs/navrhy/teraz-dlazdice-sklo.html,
    // možnosť 1, 26. 11. 2026): dlaždica sa od oblohy v každej výške obrazovky líši jasom aspoň `kontrast`.
    // Prednosť má tmavé sklo (`farba` od `min` do `max` krytia - `min` je --glass v css/zaklad.css), svetlé
    // (biela najviac `svetlo` na tmavom skle s krytím `min`) príde, až keď tmavé nestačí - v tmavej noci.
    // Meria sa od výšky `od` obrazovky nadol: vyššie stojí hlavička so scénou a jedno sklo by pri tmavom vrchu
    // a svetlom spodku nevyhovelo oboma smermi. Pevné svetlé sklo po západe slnka na sivej oblohe súmraku splynulo.
    sklo: { farba: '#081028', min: 0.3, max: 0.65, svetlo: 0.3, kontrast: 1.5, od: 0.4 },
};

/**
 * Počasie v pozadí karty Teraz (shared/pocasie.js, docs/navrhy/teraz-pocasie-2.html).
 * Zrážky za hodinu z Open-Meteo: dážď od `dazdMm` (precipitation, mm), sneh od `snehCm`
 * (snowfall, cm) - menej je len pár kvapiek, ktoré by kresba preháňala. Sila dažďa
 * (docs/navrhy/dazd-sily.html): od `dazdMm` mrholenie, od `dazdSila.slaby` slabý dážď, od
 * `dazdSila.dazd` dážď, od `dazdSila.silny` silný dážď, všetko v mm za hodinu. Hranice 0,5 a 4 sú
 * z delenia Met Office; zo staníc by stáli vyššie, no model ich priemeruje cez políčko siete
 * (2-11 km), takže lejak v ňom vyjde slabší ako na zrážkomere. Jas z merania: podiel
 * výkonu z výkonu pri jasnej oblohe od `jasno`
 * je jasno, pod `zamracene` zamračené, medzi nimi polooblačno. Meraniu sa verí, len keď by
 * jasná obloha dala aspoň `istyPodiel` výkonu zostavy - ráno a večer pri nízkom slnku podiel
 * skáče a o oblakoch nehovorí.
 */
export const POCASIE = {
    dazdMm: 0.2,
    dazdSila: { slaby: 0.5, dazd: 2, silny: 4 },
    snehCm: 0.1,
    jasno: 0.7,
    zamracene: 0.3,
    istyPodiel: 0.15,
};

/**
 * Hviezdy v noci na karte Teraz (shared/hviezdy.js): skutočná obloha nad elektrárňou, pohľad vždy
 * na azimut `smer` (východ), na severnej aj južnej pologuli - vľavo je sever, vpravo juh. Stereografické
 * premietanie so stredom vo výške `vyskaStredu` °. Pole má `sirka` × `vyska` jednotiek, jednotka
 * je v strede pohľadu stupeň; stred pohľadu leží v `stredY` výšky poľa. Vidno hviezdy do
 * magnitúdy `magMax`; oblačnosť 100 % hranicu zníži o `oblakyMag`, spln o `splnMag`. Hviezdy pod
 * `minVyska` ° nie sú (pri obzore ich aj tak skryje opar). Poloha sa počíta po `krokMin`
 * minútach (obloha sa za ten čas pootočí o 1°), aby sa kresba neprepisovala každú minútu.
 * Obzor (výška `minVyska`) je pri spodnom okraji poľa.
 * `mesiacR` je polomer kresby Mesiaca, zámerne väčší ako skutočný (0,25°); 24. 11. 2026 zmenšený o 10 % (z 8,3). `text` sú oblasti poľa
 * za textom karty Teraz na telefóne (číslo a riadok stavu): vľavo od `x`, vo výške `od` až `po`.
 * `mierka` je jednotiek poľa na radián v strede pohľadu (tu 1 jednotka = 1°).
 *
 * `dnes` je pole karty Dnes (docs/navrhy/dnes-hviezdy-vysek.html, R1, 24. 11. 2026): obloha tak, ako ju človek
 * vidí, keď sa pozrie na východ. Stred pohľadu je na obzore, takže obzor je rovná čiara pri spodnom okraji
 * (čiara posuvníka), kraje poľa sú na obzore V ± `dnesOkraj` ° (SV a JV) a vrch poľa je zenit. Pole siaha
 * od čiary posuvníka po vrch obrazovky; na užšej obrazovke ubudne do strán, na širšej zhora. `text` je veľké
 * číslo výkonu a riadok pod ním (namerané na 360 × 780, 24. 11. 2026).
 */
const dnesOkraj = 45;
const dnesMierka = 100 / (2 * Math.tan((dnesOkraj * Math.PI) / 360));
export const HVIEZDY = {
    magMax: 4,
    oblakyMag: 2,
    splnMag: 1,
    smer: 90,
    vyskaStredu: 35,
    sirka: 200,
    vyska: 112,
    stredY: 0.6875,
    mierka: 180 / Math.PI,
    minVyska: 3,
    krokMin: 4,
    mesiacR: 7.47,
    text: [
        { x: 75, od: 29, po: 88 },
        { x: 108, od: 93, po: 107 },
    ],
    dnes: {
        vyskaStredu: 0,
        sirka: 200,
        vyska: 2 * dnesMierka,
        stredY: 1,
        mierka: dnesMierka,
        text: [
            { x: 125, od: 38, po: 78 },
            { x: 80, od: 78, po: 92 },
        ],
    },
};
