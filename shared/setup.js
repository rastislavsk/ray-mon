// Sprievodca nastavením elektrárne: poradie krokov, kedy sa dá ísť ďalej a prázdne nastavenie
// pre nového používateľa. Čisté funkcie - obrazovky kreslí web/render/nastavenie.js.

import { PLANT, SETTINGS_LIMITS, SETUP, TARIFF_TEMPLATES } from './config.js';
import { kioskApiUrl } from './kiosk.js';
import { checkSettings, checkSite, totalPanels } from './settings.js';
import { checkTariff } from './tariff.js';
import { inRange } from './valid.js';

/** @typedef {import('./settings.js').Settings} Settings */
/** @typedef {import('./config.js').PlantString} PlantString */
/**
 * Obrazovky sprievodcu. `start` a `odkaz` stoja pred ním (úvod a prevzatie z odkazu), zvyšok
 * sú jeho kroky v poradí.
 * @typedef {'start' | 'odkaz' | 'lokalita' | 'panel' | 'smer' | 'sklon' | 'pocet' | 'dalsia' | 'menic' | 'meranie'
 *   | 'tarifa' | 'pasma' | 'rozvrh' | 'vynimky' | 'ceny' | 'suhrn'} SetupStep
 */
/** @typedef {{ step: SetupStep, roof: number }} SetupPlace obrazovka a plocha panelov, ktorej sa týka */
/** @typedef {'jedna' | 'dvoj' | 'viac'} TariffKind typ sadzby (tariffKind) - podľa neho sa vyberajú obrazovky tarify */

/** @type {SetupStep[]} */
export const SETUP_STEPS = [
    'start',
    'odkaz',
    'lokalita',
    'panel',
    'smer',
    'sklon',
    'pocet',
    'dalsia',
    'menic',
    'meranie',
    'tarifa',
    'pasma',
    'rozvrh',
    'vynimky',
    'ceny',
    'suhrn',
];

/** Časti sprievodcu, ako ich ukazuje ukazovateľ postupu. Plochy strechy sú jedna časť. */
export const SETUP_SECTIONS = [
    { name: 'Poloha', steps: ['lokalita'] },
    { name: 'Panely', steps: ['panel'] },
    { name: 'Strecha', steps: ['smer', 'sklon', 'pocet', 'dalsia'] },
    { name: 'Menič', steps: ['menic'] },
    { name: 'Meranie', steps: ['meranie'] },
    { name: 'Tarifa', steps: ['tarifa', 'pasma', 'rozvrh', 'vynimky', 'ceny'] },
    { name: 'Kontrola', steps: ['suhrn'] },
];

/** Ktorá časť sprievodcu to je (0 = Poloha), -1 pre úvod a odkaz. @param {SetupStep} step */
export function setupSection(step) {
    return SETUP_SECTIONS.findIndex((s) => s.steps.includes(step));
}

/** Kroky jednej plochy panelov - tie sa opakujú pre každú plochu. */
export const ROOF_STEPS = /** @type {const} */ (['smer', 'sklon', 'pocet']);

/** Kroky tarify v poradí. Pásma má len sadzba s tromi a viac pásmami, jedna cena len typ a ceny. */
export const TARIFF_STEPS = /** @type {const} */ (['tarifa', 'pasma', 'rozvrh', 'vynimky', 'ceny']);

/** Kroky tarify, ktoré daný typ sadzby má. @param {TariffKind} kind @returns {SetupStep[]} */
export function tariffSteps(kind) {
    if (kind === 'jedna') return ['tarifa', 'ceny'];
    return kind === 'viac' ? [...TARIFF_STEPS] : ['tarifa', 'rozvrh', 'vynimky', 'ceny'];
}

/** @type {Partial<Record<SetupStep, SetupStep>>} */
const NEXT = {
    start: 'lokalita',
    odkaz: 'suhrn',
    lokalita: 'panel',
    smer: 'sklon',
    sklon: 'pocet',
    dalsia: 'menic',
    menic: 'meranie',
    meranie: 'tarifa',
    ceny: 'suhrn',
};
/** @type {Partial<Record<SetupStep, SetupStep>>} */
const PREV = {
    odkaz: 'start',
    lokalita: 'start',
    panel: 'lokalita',
    sklon: 'smer',
    pocet: 'sklon',
    menic: 'dalsia',
    meranie: 'menic',
    tarifa: 'meranie',
    suhrn: 'ceny',
};

/**
 * Nasledujúca obrazovka. Plochy idú po sebe: po počte panelov jednej plochy prichádza smer
 * ďalšej, po poslednej otázka na ďalšiu plochu. Kroky tarify idú podľa typu sadzby. Za
 * zhrnutím nie je nič (null).
 * @param {SetupPlace} at @param {number} roofCount @param {TariffKind} [kind] @returns {SetupPlace | null}
 */
export function nextSetupPlace({ step, roof }, roofCount, kind = 'dvoj') {
    const t = tariffSteps(kind);
    if (t.includes(step) && step !== 'ceny') return { step: t[t.indexOf(step) + 1], roof };
    if (step === 'panel') return { step: 'smer', roof: 0 };
    if (step === 'pocet') return roof < roofCount - 1 ? { step: 'smer', roof: roof + 1 } : { step: 'dalsia', roof };
    const next = NEXT[step];
    return next ? { step: next, roof } : null;
}

/**
 * Predošlá obrazovka - opak nextSetupPlace. Pred úvodom nie je nič (null).
 * @param {SetupPlace} at @param {number} roofCount @param {TariffKind} [kind] @returns {SetupPlace | null}
 */
export function prevSetupPlace({ step, roof }, roofCount, kind = 'dvoj') {
    const t = tariffSteps(kind);
    if (t.includes(step) && step !== 'tarifa') return { step: t[t.indexOf(step) - 1], roof };
    if (step === 'smer') return roof > 0 ? { step: 'pocet', roof: roof - 1 } : { step: 'panel', roof: 0 };
    if (step === 'dalsia') return { step: 'pocet', roof: Math.max(0, roofCount - 1) };
    const prev = PREV[step];
    return prev ? { step: prev, roof } : null;
}

/** Nová plocha panelov: smeruje k rovníku, na severnej pologuli na juh, na južnej na sever.
 * @param {number} lat @returns {PlantString} */
export function newRoof(lat) {
    return { panels: SETUP.newRoof.panels, azimuthDeg: lat < 0 ? 0 : 180, tiltDeg: SETUP.newRoof.tiltDeg };
}

/**
 * Nastavenie, s ktorým začína nový používateľ: bez výkonov, aby sprievodca nepredvyplnil nič
 * vymyslené, a bez lokality, kým ju appka nepozná. Jedna plocha smerom k rovníku (bez lokality
 * na juh), jedna cena celý deň (to isté ako „Neviem“ pri tarife), odborné parametre z config.js.
 * @param {import('./config.js').Site} [site] poloha, ak ju už človek zadal
 * @returns {Settings}
 */
export function emptySettings(site = { name: '', lat: NaN, lon: NaN, elevationM: 0, timezone: '' }) {
    return {
        site,
        plant: { ...PLANT, strings: [newRoof(site.lat)], panelWp: NaN, acLimitKw: NaN },
        tariff: TARIFF_TEMPLATES.jedna,
        kiosk: '',
    };
}

/**
 * Nastavenie tak, ako ho appka použije. Kto zadal celkový výkon namiesto výkonu panelu
 * (`totalKwp`), tomu sa výkon panelu dopočíta z počtu panelov na všetkých plochách - uložený
 * formát tak ostáva ten istý. Na desatinu wattu, aby súčet plôch sedel so zadaným výkonom.
 * @param {Settings} draft @param {number | null} totalKwp null = zadaný je výkon panelu
 * @returns {Settings}
 */
export function resolveDraft(draft, totalKwp) {
    if (totalKwp === null) return draft;
    const panels = totalPanels(draft);
    const panelWp = panels > 0 && Number.isFinite(totalKwp) ? Math.round((totalKwp * 10000) / panels) / 10 : NaN;
    return { ...draft, plant: { ...draft.plant, panelWp } };
}

/** Lokalita je vybraná a prejde tou istou kontrolou ako pri uložení (checkSite). @param {Settings} s */
function siteOk(s) {
    /** @type {string[]} */ const errors = [];
    checkSite(s.site, errors);
    return !!s.site.name && errors.length === 0;
}

/**
 * Dá sa z tejto obrazovky ísť ďalej? Každá kontroluje len to, na čo sa pýta; celé nastavenie
 * preverí zhrnutie tou istou funkciou ako uloženie (checkSettings).
 * @param {SetupPlace} at @param {Settings} draft už s dopočítaným výkonom panelu (resolveDraft)
 * @param {{ totalKwp: number | null, live: boolean }} opts
 */
export function setupStepOk({ step, roof }, draft, { totalKwp, live }) {
    const L = SETTINGS_LIMITS;
    const x = draft.plant.strings[roof];
    /** @type {Partial<Record<SetupStep, () => boolean>>} */
    const checks = {
        lokalita: () => siteOk(draft),
        panel: () => (totalKwp === null ? inRange(draft.plant.panelWp, L.panelWp) : inRange(totalKwp, L.totalKwp)),
        sklon: () => !!x && inRange(x.tiltDeg, L.tiltDeg),
        pocet: () => !!x && Number.isInteger(x.panels) && inRange(x.panels, L.panels),
        dalsia: () => inRange(draft.plant.panelWp, L.panelWp),
        menic: () => inRange(draft.plant.acLimitKw, L.acLimitKw),
        meranie: () => !live || !!kioskApiUrl(draft.kiosk),
        pasma: () => checkTariff(draft.tariff).errors.length === 0,
        rozvrh: () => checkTariff(draft.tariff).errors.length === 0,
        vynimky: () => checkTariff(draft.tariff).errors.length === 0,
        ceny: () => checkTariff(draft.tariff).errors.length === 0,
        suhrn: () => checkSettings(draft).errors.length === 0,
    };
    const check = checks[step];
    return check ? check() : true;
}
