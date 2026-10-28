// Nastavenie elektrárne, ktoré si používateľ zadá v karte Nastavenie: lokalita a zostava
// panelov. Kontrola vstupu, prevod na formát výpočtu a čítanie uloženej či nájdenej lokality.
// Čisté funkcie - úložisko, sieť a formulár rieši web/.

import {
    installedKw,
    PLANT,
    SETTINGS_LIMITS,
    SHARE_HASH_KEY,
    SHARE_LINK_VERSION,
    TARIFF,
    TARIFF_TEMPLATES,
    TYPICAL_PLANT,
    VLASTNA_HASH_KEY,
    VOICES,
} from './config.js';
import { fmt2, kwpText } from './format.js';
import { checkTariff, parseStoredTariff } from './tariff.js';
import { inRange, isObj } from './valid.js';
import { parseZdroj } from './zdroje.js';

/** @typedef {import('./config.js').Site} Site */
/** @typedef {import('./config.js').Plant} Plant */
/** @typedef {import('./config.js').PlantString} PlantString */
/** @typedef {import('./config.js').Tariff} Tariff */
/** @typedef {import('./zdroje.js').Zdroj} Zdroj */
/**
 * Nastavenie tak, ako ho používa appka. `tariff` sú pásma a rozvrh ceny elektriny. `zdroj` je
 * pripojené živé meranie (shared/zdroje.js), null znamená „bez merania“.
 * @typedef {{ site: Site, plant: Plant, tariff: Tariff, zdroj: Zdroj | null }} Settings
 */
/**
 * To, čo používateľ naozaj zadáva a čo sa ukladá. Odborné parametre zostavy sa neukladajú,
 * dopĺňajú sa vždy z config.js - keby sa tam zmenili, prejaví sa to aj u uložených nastavení.
 * @typedef {{ site: Site, strings: PlantString[], panelWp: number, acLimitKw: number, tariff: Tariff, zdroj: Zdroj | null }} UserSettings
 */
/**
 * Čo appka o elektrárni vie: `nic` ani polohu (pýta sa na ňu), `poloha` len polohu (počíta
 * s typickou strechou, karty o výkone sú sivé), `elektraren` uložené nastavenie.
 * @typedef {'nic' | 'poloha' | 'elektraren'} Known
 */

/**
 * Nastavenie, s ktorým appka počíta, kým človek pozná len polohu: typická strecha a jedna
 * cena celý deň (to isté ako „Neviem“ pri tarife).
 * @param {Site} site @returns {Settings}
 */
export function typicalSettings(site) {
    return { site, plant: TYPICAL_PLANT, tariff: TARIFF_TEMPLATES.jedna, zdroj: null };
}

/** Doplní zadané údaje o odborné parametre zostavy. @param {UserSettings} user @returns {Settings} */
export function settingsFrom(user) {
    return {
        site: user.site,
        plant: { ...PLANT, strings: user.strings, panelWp: user.panelWp, acLimitKw: user.acLimitKw },
        tariff: user.tariff,
        zdroj: user.zdroj,
    };
}

/** Len to, čo zadal používateľ - na uloženie a porovnávanie. @param {Settings} s @returns {UserSettings} */
export function toUser(s) {
    return {
        site: { ...s.site },
        strings: s.plant.strings.map((x) => ({ panels: x.panels, azimuthDeg: x.azimuthDeg, tiltDeg: x.tiltDeg })),
        panelWp: s.plant.panelWp,
        acLimitKw: s.plant.acLimitKw,
        tariff: s.tariff,
        zdroj: s.zdroj && { ...s.zdroj },
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

/** Chyby lokality. Sprievodca podľa nich púšťa ďalej z výberu lokality. @param {Site} site @param {string[]} errors */
export function checkSite(site, errors) {
    if (!Number.isFinite(site.lat) || Math.abs(site.lat) > 90) errors.push('Zemepisná šírka musí byť od −90 do 90.');
    if (!Number.isFinite(site.lon) || Math.abs(site.lon) > 180) errors.push('Zemepisná dĺžka musí byť od −180 do 180.');
    if (!isTimezone(site.timezone)) errors.push('Lokalite chýba časové pásmo. Vyber ju zo zoznamu.');
    const E = SETTINGS_LIMITS.elevationM;
    if (!inRange(site.elevationM, E)) errors.push(`Nadmorská výška musí byť od ${E.min} do ${E.max} m.`);
    const N = SETTINGS_LIMITS.siteNameMax;
    if (site.name.length > N) errors.push(`Názov lokality môže mať najviac ${N} znakov.`);
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

/** Počet panelov na všetkých plochách; neplatné pole sa ráta ako nula. @param {Settings} s */
export function totalPanels(s) {
    return s.plant.strings.reduce((sum, x) => sum + (Number.isFinite(x.panels) ? x.panels : 0), 0);
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
    const tariff = checkTariff(s.tariff);
    errors.push(...tariff.errors);
    warnings.push(...tariff.warnings);
    if (s.zdroj && !parseZdroj(s.zdroj)) errors.push('Živé meranie nie je pripojené správne. Pripoj ho v Nastavení znova.');
    // Panely sa rátajú aj pri chybách - súčet pod formulárom ich ukazuje stále. Výkon až keď
    // je zostava v poriadku, a potom ten istý, aký appka používa všade inde.
    const panels = totalPanels(s);
    const kwp = errors.length ? null : installedKw(plant);
    if (kwp !== null && kwp > plant.acLimitKw * SETTINGS_LIMITS.dcAcWarnRatio)
        warnings.push(`Panely majú spolu viac než menič zvládne. Za jasných dní bude menič orezávať špičky na ${plant.acLimitKw} kW.`);
    // Na južnej pologuli je slnko na severe. Plocha otočená na juh tam dostane málo, čo je
    // skoro vždy omyl pri zadávaní, nie skutočná strecha.
    if (site.lat < 0 && plant.strings.some((x) => Math.abs(x.azimuthDeg - 180) <= 45))
        warnings.push('Lokalita je na južnej pologuli, slnko je tam na severe. Plocha otočená na juh dostane málo svetla.');
    return { errors, warnings, kwp, panels };
}

/** Lokalita z uloženého objektu; kontrolu robí volajúci. @param {Record<string, any>} o @returns {Site} */
function siteFrom(o) {
    return {
        name: typeof o.name === 'string' ? o.name : '',
        lat: Number(o.lat),
        lon: Number(o.lon),
        elevationM: Number.isFinite(o.elevationM) ? o.elevationM : 0,
        timezone: o.timezone,
    };
}

/**
 * Nastavenie z localStorage. Dáta odtiaľ sú nedôveryhodné (iná verzia appky, ručný zásah),
 * preto všetko, čo nie je presne v poriadku, vráti null a appka sa správa, akoby nič uložené nebolo.
 * @param {unknown} raw @returns {Settings | null}
 */
export function parseStoredSettings(raw) {
    if (!isObj(raw)) return null;
    const o = /** @type {Record<string, any>} */ (raw);
    if (!isObj(o.site) || !Array.isArray(o.strings)) return null;
    /** @type {UserSettings} */
    const user = {
        site: siteFrom(o.site),
        strings: o.strings.map((/** @type {any} */ x) => ({
            panels: Number(x && x.panels),
            azimuthDeg: Number(x && x.azimuthDeg),
            tiltDeg: Number(x && x.tiltDeg),
        })),
        panelWp: Number(o.panelWp),
        acLimitKw: Number(o.acLimitKw),
        // Nastavenia uložené pred pridaním kiosku ho nemajú - to je „bez merania“. Tie spred
        // výberu značky majú namiesto `zdroj` holý odkaz `kiosk`.
        zdroj: parseZdroj(o.zdroj, o.kiosk),
        // Nastavenia uložené pred vlastnými tarifami ju nemajú - dostanú tarifu Dvorian, s ktorou
        // appka dovtedy počítala. Tarifa, ktorá tam je, no nesedí, zahodí všetko.
        tariff: 'tariff' in o ? /** @type {Tariff} */ (parseStoredTariff(o.tariff)) : TARIFF,
    };
    if (!user.tariff) return null;
    const s = settingsFrom(user);
    return user.site.name && checkSettings(s).errors.length === 0 ? s : null;
}

/**
 * Samotná poloha z localStorage - kto ju zadal, no panely ešte nie. Rovnako nedôveryhodná
 * ako uložené nastavenie: čokoľvek nesedí, je null a appka sa na polohu spýta znova.
 * @param {unknown} raw @returns {Site | null}
 */
export function parseStoredSite(raw) {
    if (!isObj(raw)) return null;
    const site = siteFrom(/** @type {Record<string, any>} */ (raw));
    /** @type {string[]} */ const errors = [];
    checkSite(site, errors);
    return site.name && errors.length === 0 ? site : null;
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
 * Riadok pod názvom lokality: súradnice, výška, časové pásmo.
 * @param {Site} site
 */
export function siteMetaText(site) {
    if (!Number.isFinite(site.lat) || !Number.isFinite(site.lon)) return 'Súradnice nie sú zadané.';
    const ns = site.lat >= 0 ? 's. š.' : 'j. š.';
    const ew = site.lon >= 0 ? 'v. d.' : 'z. d.';
    return `${fmt2(Math.abs(site.lat))}° ${ns} · ${fmt2(Math.abs(site.lon))}° ${ew} · ${Math.round(site.elevationM)} m n. m. · ${site.timezone}`;
}

/** Elektráreň jedným riadkom: poloha a výkon. @param {Settings} s */
export function settingsHint(s) {
    return `${s.site.name} · ${kwpText(installedKw(s.plant))}`;
}

// ---- Zdieľanie nastavenia odkazom ------------------------------------------------------
// Nastavenie sa zbalí do časti adresy za mriežkou. Tú prehliadač neposiela na server, takže
// lokalita ani prístup k meraniu nekončia v logoch webového servera.

/** Text -> base64url (bez `+`, `/` a `=`, aby sa nemusel v adrese kódovať). @param {string} text */
function toBase64Url(text) {
    let bin = '';
    for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url -> text; pri neplatnom vstupe hádže. @param {string} token */
function fromBase64Url(token) {
    const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/**
 * Časť adresy za mriežkou s nastavením (`#nastavenie=…`). Bez nastavenia prázdny reťazec.
 * Adresa, ktorú appka zrkadlí sama (`vlastna`), nesie pri nastavení značku VLASTNA_HASH_KEY.
 * Staršie odkazy niesli aj prvú kartu (`&prva=…`); appka sa dnes otvára vždy na Teraz(kách),
 * takže ju z odkazu nečíta.
 * @param {Settings | null} settings @param {boolean} withZdroj pribaliť aj prístup k živému meraniu
 * @param {boolean} [vlastna]
 */
export function shareHash(settings, withZdroj, vlastna = false) {
    if (!settings) return '';
    const user = toUser(settings);
    if (!withZdroj) user.zdroj = null;
    const parts = [`${SHARE_HASH_KEY}=${toBase64Url(JSON.stringify({ v: SHARE_LINK_VERSION, ...user }))}`];
    if (vlastna) parts.push(`${VLASTNA_HASH_KEY}=1`);
    return `#${parts.join('&')}`;
}

/**
 * Odkaz na appku, voliteľne s nastavením elektrárne. Bez neho je to holý odkaz.
 * @param {string} appUrl @param {Settings | null} settings @param {boolean} withZdroj pribaliť aj prístup k živému meraniu
 */
export function shareUrl(appUrl, settings, withZdroj) {
    return appUrl + shareHash(settings, withZdroj);
}

/**
 * @typedef {'poskodeny' | 'novsi'} LinkError prečo appka nastavenie z odkazu neprevezme:
 *   neúplný alebo poškodený odkaz, alebo odkaz z novšej verzie appky (vyššie `v` než SHARE_LINK_VERSION)
 */

/**
 * Nastavenie z odkazu - z časti za mriežkou pri otvorení appky, alebo z celého odkazu, ktorý
 * človek prilepil. Odkaz môže prísť od kohokoľvek, preto prejde tou istou kontrolou ako
 * nastavenie z úložiska. Keď ho appka nevie prevziať, povie prečo (`error`) - nikdy nič
 * nezahodí potichu. Bez nastavenia v texte null.
 * @param {string} text @returns {{ settings: Settings, error: null } | { settings: null, error: LinkError } | null}
 */
export function readLink(text) {
    const m = new RegExp(`[#&]${SHARE_HASH_KEY}=([A-Za-z0-9_-]*)`).exec(String(text || '').trim());
    if (!m) return null;
    /** @type {unknown} */ let raw;
    try {
        raw = m[1].length <= 8000 ? JSON.parse(fromBase64Url(m[1])) : null;
    } catch {
        raw = null;
    }
    const v = isObj(raw) ? /** @type {Record<string, unknown>} */ (raw).v : undefined;
    if (typeof v === 'number' && v > SHARE_LINK_VERSION) return { settings: null, error: 'novsi' };
    const settings = parseStoredSettings(raw);
    return settings ? { settings, error: null } : { settings: null, error: 'poskodeny' };
}

/**
 * Časť adresy za mriežkou, ktorú appka pri štarte berie ako odkaz s nastavením, alebo
 * prázdna, keď je to adresa, ktorú appka v tejto karte sama zapísala (`vlastna`, cesta a časť za
 * mriežkou). Taká adresa nesie nastavenie z chvíle zápisu - po zmene v druhej appke či inej karte by
 * ho obnovenie starej karty ponúklo prevziať a prevzatie by novšie nastavenie prepísalo starším.
 * To isté platí pre adresu so značkou VLASTNA_HASH_KEY z inej karty (história prehliadača), keď
 * má appka novšie - uložené nastavenie, alebo vymazané údaje (`novsie`). Bez neho je taká adresa
 * jediné, čo si appka na ploche iPhonu prenesie zo Safari, a ponúkne sa.
 * @param {string} path @param {string} hash @param {string | null} vlastna @param {boolean} novsie
 * @returns {string}
 */
export function linkHash(path, hash, vlastna, novsie) {
    if (vlastna !== null && vlastna === path + hash) return '';
    return novsie && new RegExp(`[#&]${VLASTNA_HASH_KEY}=1(?:&|$)`).test(hash) ? '' : hash;
}

/** Nastavenie z odkazu, alebo null - pre miesta, ktoré dôvod nepotrebujú. @param {string} text @returns {Settings | null} */
export const settingsFromLink = (text) => readLink(text)?.settings ?? null;

/**
 * Nastavenie z odkazu, ktoré treba ponúknuť prevziať, alebo null. To isté, čo je už uložené, sa
 * neponúka - ani keď odkaz nenesie živé meranie a uložené ho má. Adresa ho totiž nenesie nikdy
 * (initUrlMirror vo web/settings-store.js), inak by appka po každom otvorení ponúkala prevziať
 * samú seba a prevzatím by meranie zmizlo.
 * @param {Settings | null} linked @param {Settings | null} saved @returns {Settings | null}
 */
export function incomingSettings(linked, saved) {
    if (!linked || !saved) return linked;
    return sameSettings(linked.zdroj ? linked : { ...linked, zdroj: saved.zdroj }, saved) ? null : linked;
}

// ---- Vzhľad novej appky ------------------------------------------------------------

/**
 * Vzhľad novej appky (obloha/): tón hlášok a živá obloha. Uložený je pod LOOK_STORAGE_KEY ako
 * { ton, obloha } - kľúč aj formát má len nová appka.
 * @typedef {{ voice: import('./messages.js').Voice, liveSky: boolean }} Look
 */

/** Predvolený vzhľad: drzý tón a živá obloha. @type {Look} */
export const DEFAULT_LOOK = { voice: VOICES[0], liveSky: true };

/**
 * Vzhľad z úložiska. Čo chýba alebo nesedí, je predvolené - každá voľba zvlášť.
 * @param {unknown} raw @returns {Look}
 */
export function parseLook(raw) {
    const o = isObj(raw) ? raw : {};
    return {
        voice: VOICES.find((v) => v === o.ton) ?? DEFAULT_LOOK.voice,
        liveSky: typeof o.obloha === 'boolean' ? o.obloha : DEFAULT_LOOK.liveSky,
    };
}

/** Vzhľad v tvare na uloženie. @param {Look} look */
export const lookToStored = (look) => ({ ton: look.voice, obloha: look.liveSky });
