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
 * Ukážka pre nového používateľa, kým si neuloží vlastnú elektráreň: vymyslená bežná strecha
 * v Londýne. Odborné parametre (účinnosť, teplotný koeficient, NOCT, albedo) sú tie isté ako
 * v Dvoranoch - používateľ ich nemení.
 * @type {Site}
 */
export const DEMO_SITE = { name: 'Londýn', lat: 51.51, lon: -0.13, elevationM: 25, timezone: 'Europe/London' };
/** @type {Plant} */
export const DEMO_PLANT = { ...PLANT, strings: [{ panels: 12, azimuthDeg: 180, tiltDeg: 35 }], acLimitKw: 5 };

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

/** Kľúč v localStorage, pod ktorým je uložené nastavenie elektrárne. */
export const SETTINGS_STORAGE_KEY = 'elektraren-v1';

/** Minút v dni. Ciferník ich rozloží po obvode, rozvrh tarify ich delí na pásma. */
export const MINUTES_PER_DAY = 1440;

/**
 * Inštalovaný výkon zostavy v kWp: počet panelov × výkon panelu. Jediné miesto, kde sa počíta -
 * ciferník, hranice výkonu, karta 7 dní aj Nastavenie ho berú odtiaľto. Nezaokrúhľuje sa,
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
    currencyMax: 4,
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
 * Ukážka pre nového používateľa (Londýn): sedem hodín lacno v noci, inak bežná cena.
 * @type {Tariff}
 */
export const DEMO_TARIFF = {
    currency: '£',
    bands: [
        { id: 'noc', name: 'Noc', level: 'lacna', price: null },
        { id: 'den', name: 'Deň', level: 'bezna', price: null },
    ],
    schedules: [
        {
            days: ALL_DAYS,
            months: ALL_MONTHS,
            changes: [
                { from: '00:00', band: 'den' },
                { from: '00:30', band: 'noc' },
                { from: '07:30', band: 'den' },
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

// Kde appka beží a odkiaľ číta dáta.
export const APP_URL = 'https://rastislavsk.github.io/ray-mon/';
export const WORKER_URL = 'https://ray-mon.rastislav-racek.workers.dev/';
// Živé meranie z kiosku, ktorý si používateľ zadal v Nastavení. Odkaz ide v tele POST
// požiadavky, nie v adrese - adresy požiadaviek končia v logoch Workera.
export const WORKER_PV_URL = `${WORKER_URL}pv`;

/**
 * Verejný kiosk Huawei FusionSolar. Worker sťahuje len z týchto serverov a len túto cestu,
 * odkaz od používateľa dodá iba server a kľúč kiosku - inak by z Workera bol proxy server
 * na čokoľvek.
 */
export const KIOSK = {
    hostSuffix: 'fusionsolar.huawei.com',
    apiPath: '/rest/pvms/web/kiosk/v1/station-kiosk-file',
};

// Ako často sa čo obnovuje (ms).
export const REFRESH = {
    clockMs: 30 * 1000,
    dataMs: 60 * 1000,
};

// Najdlhšie čakanie na jednu sieťovú požiadavku (ms). Bez limitu by zaseknuté spojenie
// čakalo donekonečna. Worker čaká na kiosk kratšie než appka na Worker, aby sa aj s jedným
// opakovaním (2 × 5 s + 0,5 s) zmestil do jej limitu.
export const TIMEOUT = {
    appMs: 15 * 1000,
    kioskMs: 5 * 1000,
};

// Od akej viditeľnej výšky okna (px) sa v prehľade dní na karte 7 dní ukáže aj správa
// týždňa. Prehľad sám sa zmestí od 710 px; so správou potrebuje 835 px, a pri najdlhšej
// možnej správe na úzkom displeji (320 px) 854 px - namerané v Chromiu pri predvolenej
// veľkosti písma. 860 je tých 854 a malá rezerva.
//
// Rozhoduje skutočná viditeľná výška (visualViewport), nie rozlíšenie displeja: v mobilnom
// prehliadači ukrojí adresný riadok 60-90 px, a práve o tie tu ide. Keď sa správa nezmestí,
// jednoducho nie je - prehľad má ostať na jednu obrazovku bez scrollovania.
export const WEEK_MSG_MIN_H = 860;

// Ako dlho ostáva tooltip po ťuknutí zobrazený (ms).
export const TOOLTIP_HOLD_MS = 1600;

// Kedy je tooltip po skrytí naozaj neviditeľný. Musí byť aspoň taký dlhý ako prechod
// `opacity` na `.chart-tooltip` v style.css - až potom sa dajú zahodiť jeho súradnice.
export const TOOLTIP_FADE_MS = 200;

// Ako dlho po poslednom posune sa listovanie považuje za ustálené (ms).
export const PAGER_SETTLE_MS = 90;

// Dáta staršie než toto sú "zastarané" a appka to ukáže. Platí pre stiahnutie z kiosku
// aj pre posledné meranie z meniča.
export const STALE_PV_MS = 20 * 60 * 1000;

// Nad touto výškou slnka (stupne) menič vyrába, takže mlčiaca krivka znamená výpadok.
// Pod ňou - ráno, večer a v noci - je bez merania normálne a "zastarané" by bol planý poplach.
export const STALE_PV_SUN_DEG = 5;

// Náhľad iného času jazdcom na dennom prstenci (web/interactions.js).
export const PREVIEW = {
    // Ako blízko musí jazdec prísť k značke "teraz", aby sa naň prichytil a náhľad sa zrušil.
    // 25 minút je na ciferníku ~6 stupňov - dosť na to, aby sa to podarilo palcom, a málo na
    // to, aby sa človek nevedel pozrieť na čas tesne pred aktuálnym.
    snapToNowMin: 25,
    // O koľko posunie náhľad jedno ťuknutie šípkou na klávesnici.
    keyStepMin: 15,
};

// Prepínanie kariet potiahnutím prsta (web/swipe.js). Prah je kompromis: dosť veľký, aby
// gesto nespustil ťuk roztrasenou rukou, dosť malý, aby stačil pohodlný pohyb palca.
export const SWIPE = {
    minDistPx: 60, // koľko musí prst prejsť vodorovne
    maxOffAxisRatio: 0.6, // zvislý posun smie byť najviac takýto podiel vodorovného
    maxDurationMs: 600, // pomalšie ťahanie už nie je gesto, ale posúvanie po stránke
    // Nad grafom je vodorovný ťah zároveň prezeraním krivky (tooltip ide za prstom), takže
    // tam kartu prepne len rýchle švihnutie. Pokojné sledovanie krivky je pomalšie.
    flickMs: 300,
};
