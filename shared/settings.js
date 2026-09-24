// Nastavenie elektrárne, ktoré si používateľ zadá v karte Nastavenie: lokalita a zostava
// panelov. Kontrola vstupu, prevod na formát výpočtu a čítanie uloženej či nájdenej lokality.
// Čisté funkcie - úložisko, sieť a formulár rieši web/.

import { DEMO_PLANT, DEMO_SITE, OWNER_NEAR_DEG, PLANT, SETTINGS_LIMITS, SITE } from './config.js';
import { kioskApiUrl } from './kiosk.js';

/** @typedef {import('./config.js').Site} Site */
/** @typedef {import('./config.js').Plant} Plant */
/** @typedef {import('./config.js').PlantString} PlantString */
/**
 * Nastavenie tak, ako ho používa appka. `kiosk` je odkaz na verejný kiosk elektrárne pre živé
 * meranie, prázdny reťazec znamená „bez merania“.
 * @typedef {{ site: Site, plant: Plant, kiosk: string }} Settings
 */
/**
 * To, čo používateľ naozaj zadáva a čo sa ukladá. Odborné parametre zostavy sa neukladajú,
 * dopĺňajú sa vždy z config.js - keby sa tam zmenili, prejaví sa to aj u uložených nastavení.
 * @typedef {{ site: Site, strings: PlantString[], panelWp: number, acLimitKw: number, kiosk: string }} UserSettings
 */

/** Ukážka pre nového používateľa. @returns {Settings} */
export function demoSettings() {
    return { site: DEMO_SITE, plant: DEMO_PLANT, kiosk: '' };
}

/** Doplní zadané údaje o odborné parametre zostavy. @param {UserSettings} user @returns {Settings} */
export function settingsFrom(user) {
    return {
        site: user.site,
        plant: { ...PLANT, strings: user.strings, panelWp: user.panelWp, acLimitKw: user.acLimitKw },
        kiosk: user.kiosk,
    };
}

/** Len to, čo zadal používateľ - na uloženie a porovnávanie. @param {Settings} s @returns {UserSettings} */
export function toUser(s) {
    return {
        site: { ...s.site },
        strings: s.plant.strings.map((x) => ({ panels: x.panels, azimuthDeg: x.azimuthDeg, tiltDeg: x.tiltDeg })),
        panelWp: s.plant.panelWp,
        acLimitKw: s.plant.acLimitKw,
        kiosk: s.kiosk,
    };
}

/** Líšia sa dve nastavenia v niečom, čo používateľ zadáva? @param {Settings} a @param {Settings} b */
export function sameSettings(a, b) {
    return JSON.stringify(toUser(a)) === JSON.stringify(toUser(b));
}

/** Pozná prehliadač toto časové pásmo? @param {unknown} tz */
export function isTimezone(tz) {
    if (typeof tz !== 'string' || !tz) return false;
    try {
        new Intl.DateTimeFormat('en-GB', { timeZone: tz });
        return true;
    } catch {
        return false;
    }
}

const inRange = (/** @type {number} */ v, /** @type {{ min: number, max: number }} */ r) => Number.isFinite(v) && v >= r.min && v <= r.max;

/** Chyby lokality. @param {Site} site @param {string[]} errors */
function checkSite(site, errors) {
    if (!Number.isFinite(site.lat) || Math.abs(site.lat) > 90) errors.push('Zemepisná šírka musí byť od −90 do 90.');
    if (!Number.isFinite(site.lon) || Math.abs(site.lon) > 180) errors.push('Zemepisná dĺžka musí byť od −180 do 180.');
    if (!isTimezone(site.timezone)) errors.push('Lokalite chýba časové pásmo. Vyber ju zo zoznamu.');
}

/** Chyby jednej plochy panelov. @param {PlantString} x @param {number} i @param {string[]} errors */
function checkString(x, i, errors) {
    const L = SETTINGS_LIMITS;
    if (!Number.isInteger(x.panels) || !inRange(x.panels, L.panels))
        errors.push(`Plocha ${i + 1}: počet panelov musí byť celé číslo od ${L.panels.min} do ${L.panels.max}.`);
    if (!inRange(x.tiltDeg, L.tiltDeg)) errors.push(`Plocha ${i + 1}: sklon musí byť od ${L.tiltDeg.min} do ${L.tiltDeg.max}°.`);
    if (!Number.isFinite(x.azimuthDeg) || x.azimuthDeg < 0 || x.azimuthDeg >= 360) errors.push(`Plocha ${i + 1}: vyber orientáciu.`);
}

/** Chyby zostavy. @param {Plant} plant @param {string[]} errors */
function checkPlant(plant, errors) {
    const L = SETTINGS_LIMITS;
    if (plant.strings.length < 1 || plant.strings.length > L.maxStrings) errors.push(`Plôch panelov môže byť 1 až ${L.maxStrings}.`);
    plant.strings.forEach((x, i) => checkString(x, i, errors));
    if (!inRange(plant.panelWp, L.panelWp)) errors.push(`Výkon panelu musí byť od ${L.panelWp.min} do ${L.panelWp.max} Wp.`);
    if (!inRange(plant.acLimitKw, L.acLimitKw)) errors.push(`Menič musí mať od ${L.acLimitKw.min} do ${L.acLimitKw.max} kW.`);
}

/**
 * Kontrola nastavenia pred uložením. Chyby uloženie zablokujú, varovania nie.
 * @param {Settings} s
 * @returns {{ errors: string[], warnings: string[], kwp: number | null, panels: number }}
 */
export function checkSettings(s) {
    const { site, plant } = s;
    /** @type {string[]} */ const errors = [];
    /** @type {string[]} */ const warnings = [];
    checkSite(site, errors);
    checkPlant(plant, errors);
    if (s.kiosk && !kioskApiUrl(s.kiosk))
        errors.push('Odkaz nie je kiosk FusionSolar. Skopíruj ho v aplikácii FusionSolar pri zdieľaní elektrárne cez kiosk.');
    const panels = plant.strings.reduce((sum, x) => sum + (Number.isFinite(x.panels) ? x.panels : 0), 0);
    const kwp = errors.length ? null : (panels * plant.panelWp) / 1000;
    if (kwp !== null && kwp > plant.acLimitKw * SETTINGS_LIMITS.dcAcWarnRatio)
        warnings.push(`Panely majú spolu viac než menič zvládne. Za jasných dní bude menič orezávať špičky na ${plant.acLimitKw} kW.`);
    // Na južnej pologuli je slnko na severe. Plocha otočená na juh tam dostane málo, čo je
    // skoro vždy omyl pri zadávaní, nie skutočná strecha.
    if (site.lat < 0 && plant.strings.some((x) => Math.abs(x.azimuthDeg - 180) <= 45))
        warnings.push('Lokalita je na južnej pologuli, slnko je tam na severe. Plocha otočená na juh dostane málo svetla.');
    return { errors, warnings, kwp, panels };
}

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObj = (v) => !!v && typeof v === 'object';

/**
 * Nastavenie z localStorage. Dáta odtiaľ sú nedôveryhodné (iná verzia appky, ručný zásah),
 * preto všetko, čo nie je presne v poriadku, vráti null a appka ukáže ukážku.
 * @param {unknown} raw @returns {Settings | null}
 */
export function parseStoredSettings(raw) {
    if (!isObj(raw)) return null;
    const o = /** @type {Record<string, any>} */ (raw);
    if (!isObj(o.site) || !Array.isArray(o.strings)) return null;
    /** @type {UserSettings} */
    const user = {
        site: {
            name: typeof o.site.name === 'string' ? o.site.name : '',
            lat: Number(o.site.lat),
            lon: Number(o.site.lon),
            elevationM: Number.isFinite(o.site.elevationM) ? o.site.elevationM : 0,
            timezone: o.site.timezone,
        },
        strings: o.strings.map((/** @type {any} */ x) => ({
            panels: Number(x && x.panels),
            azimuthDeg: Number(x && x.azimuthDeg),
            tiltDeg: Number(x && x.tiltDeg),
        })),
        panelWp: Number(o.panelWp),
        acLimitKw: Number(o.acLimitKw),
        // Nastavenia uložené pred pridaním kiosku ho nemajú - to je „bez merania“.
        kiosk: typeof o.kiosk === 'string' ? o.kiosk : '',
    };
    const s = settingsFrom(user);
    return user.site.name && checkSettings(s).errors.length === 0 ? s : null;
}

/**
 * Lokality z odpovede vyhľadávania Open-Meteo. Bez časového pásma sa lokalita nedá použiť
 * (nevedeli by sme, ktorá hodina je tam miestna), takže sa vynechá.
 * @param {unknown} json @returns {Array<{ site: Site, detail: string }>}
 */
export function parseGeocode(json) {
    const results =
        isObj(json) && Array.isArray(/** @type {any} */ (json).results) ? /** @type {any[]} */ (/** @type {any} */ (json).results) : [];
    return results
        .filter((r) => isObj(r) && typeof r.name === 'string' && Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
        .filter((r) => isTimezone(r.timezone))
        .map((r) => ({
            site: {
                name: r.name,
                lat: r.latitude,
                lon: r.longitude,
                elevationM: Number.isFinite(r.elevation) ? r.elevation : 0,
                timezone: r.timezone,
            },
            detail: [r.admin1, r.country].filter((x) => typeof x === 'string' && x).join(', '),
        }));
}

/**
 * Leží lokalita pri elektrárni v Dvoranoch? Dočasný most pre toho, kto si ešte nevložil
 * vlastný kiosk odkaz: živé meranie z cronu Workera patrí len k tejto elektrárni.
 * @param {Site} site
 */
export function nearOwnerPlant(site) {
    return Math.abs(site.lat - SITE.lat) <= OWNER_NEAR_DEG && Math.abs(site.lon - SITE.lon) <= OWNER_NEAR_DEG;
}

/** Číslo s dvomi desatinnými miestami a slovenskou čiarkou. @param {number} n */
const fmt2 = (n) => n.toFixed(2).replace('.', ',');

/** Výkon v kWp pre text, napr. „10,44 kWp“. @param {number} kwp */
export function kwpText(kwp) {
    return `${fmt2(kwp)} kWp`;
}

/**
 * Riadok pod názvom lokality: súradnice, výška, časové pásmo.
 * @param {Site} site
 */
export function siteMetaText(site) {
    if (!Number.isFinite(site.lat) || !Number.isFinite(site.lon)) return 'Súradnice nie sú zadané.';
    const ns = site.lat >= 0 ? 's. š.' : 'j. š.';
    const ew = site.lon >= 0 ? 'v. d.' : 'z. d.';
    return `${fmt2(Math.abs(site.lat))}° ${ns} · ${fmt2(Math.abs(site.lon))}° ${ew} · ${Math.round(site.elevationM)} m n. m. · ${site.timezone}`;
}

/** Súhrn uloženej elektrárne v zatvorenej položke nastavenia. @param {Settings} s @param {boolean} demo */
export function settingsHint(s, demo) {
    const panels = s.plant.strings.reduce((sum, x) => sum + x.panels, 0);
    const text = `${s.site.name} · ${kwpText((panels * s.plant.panelWp) / 1000)}`;
    return demo ? `Ukážka · ${text}` : text;
}
