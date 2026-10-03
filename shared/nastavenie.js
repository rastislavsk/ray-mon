// Karta Nastavenie novej appky „Živá obloha“: prehľad elektrárne (karta strechy, riadky
// ELEKTRÁREŇ, výzva dokončiť nastavenie) a záložky pri úprave z prehľadu. Čisté funkcie - stav
// dostanú, texty a čísla vrátia; kreslí obloha/web/render/nastavenie.js. Sprievodca sám je
// spoločný so súčasnou appkou (shared/setup-flow.js, shared/setup-texts.js).

import { kwpText } from './format.js';
import { liveStatus } from './hero-model.js';
import { checkSettings } from './settings.js';
import { SETUP_SECTIONS, TARIFF_STEPS, tariffSteps } from './setup.js';
import { savedSettings } from './setup-flow.js';
import { plantHero, TARIFF_TABS } from './setup-texts.js';
import { tariffHint, tariffKind } from './tariff.js';

/** @typedef {import('./setup-flow.js').SetupState} SetupState */
/** @typedef {import('./setup.js').SetupStep} SetupStep */
/**
 * Stav, z ktorého sa prehľad skladá: sprievodca a k nemu meranie (stav živého merania).
 * @typedef {SetupState & { pv: import('./kiosk.js').PvData | null, loading: boolean }} NastavenieState
 */
/**
 * Riadok prehľadu. `edit` je krok, ktorý riadok otvorí na úpravu uloženej elektrárne (stepEdit),
 * `start` znamená pokračovať v sprievodcovi od panelov - bez nich sa tarifa ani meranie uložiť nedajú.
 * @typedef {{ label: string, value: string, edit: string | null, start: boolean }} Row
 */

/** Zoznam slovom: „juh“, „juh a východ“, „juh, východ a západ“. @param {string[]} items */
export function listText(items) {
    return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} a ${items[items.length - 1]}`;
}

/** Počet plôch slovom. @param {number} n */
const planesText = (n) => (n === 1 ? '1 plocha' : `${n} plochy`);

export const NASTAVENIE_TEXTS = {
    title: 'Moja strecha',
    rowsTitle: 'Elektráreň',
    ctaText: 'Poloha je hotová. Ďalej panely, plochy strechy, menič, meranie a tarifa. Na čo nevieš odpoveď, preskočíš tlačidlom Neviem.',
    ctaBtn: 'Pokračovať: panely',
    link: 'Prevziať nastavenie z odkazu',
};

/**
 * Výzva dokončiť elektráreň, kým appka pozná len polohu: koľko krokov sprievodcu ostáva
 * (poloha je prvý z nich a je hotová). Inak null.
 * @param {Pick<SetupState, 'known'>} state
 */
export function setupCta(state) {
    if (state.known !== 'poloha') return null;
    const total = SETUP_SECTIONS.length;
    return {
        title: `Ešte ${total - 1} krokov a appka bude tvoja`,
        steps: Array.from({ length: total }, (_, i) => i < 1),
        stepsLabel: `Hotový 1 zo ${total} krokov`,
        text: NASTAVENIE_TEXTS.ctaText,
        button: NASTAVENIE_TEXTS.ctaBtn,
    };
}

/** Riadok živého merania: stav pripojenia, bez kiosku či bez panelov nepovinné. @param {NastavenieState} state */
function liveValue(state) {
    if (state.known !== 'elektraren') return 'nepripojené, nepovinné';
    const live = liveStatus(state);
    return live ? live.text : 'bez merania, odhad z predpovede';
}

/**
 * Riadky ELEKTRÁREŇ: poloha, panely, živé meranie, tarifa. Bez zadaných panelov sú len výzvou
 * pokračovať v sprievodcovi - poloha sa dá zmeniť aj tak.
 * @param {NastavenieState} state @returns {Row[]}
 */
export function nastavenieRows(state) {
    const done = state.known === 'elektraren';
    const s = savedSettings(state);
    const wp = s.plant.panelWp;
    /** @param {string} key */
    const go = (key) => ({ edit: done ? key : null, start: !done });
    return [
        { label: 'Poloha', value: s.site.name, edit: 'lokalita', start: false },
        {
            label: 'Panely',
            value: done ? `${planesText(s.plant.strings.length)} · ${Number.isFinite(wp) ? Math.round(wp) : '–'} Wp` : 'nezadané',
            ...go('panel'),
        },
        { label: 'Živé meranie', value: liveValue(state), ...go('meranie') },
        { label: 'Tarifa', value: done ? tariffHint(s.tariff) : 'nezadaná', ...go('tarifa') },
    ];
}

/**
 * Prehľad karty Nastavenie. `hero` je karta strechy (len pri zadaných paneloch), `cta` výzva
 * dokončiť nastavenie, `warnings` varovania k uloženej elektrárni a `note` hlásenie po uložení.
 * @param {NastavenieState} state
 */
export function nastavenieModel(state) {
    const done = state.known === 'elektraren';
    const saved = savedSettings(state);
    const h = done ? plantHero(saved, state.now) : null;
    return {
        cta: setupCta(state),
        hero: h && {
            kwp: kwpText(h.kwp).replace(' kWp', ''),
            line: `${h.panels} panelov · ${listText(h.dirs)} · menič ${h.ac}`,
            clear: `za jasného dňa okolo ${h.clearKwh} kWh`,
            label: `Plochy panelov: ${h.planes}`,
        },
        rows: nastavenieRows(state),
        warnings: done ? checkSettings(saved).warnings : [],
        note: state.settingsNote,
    };
}

/** Záložky pri úprave panelov z prehľadu: výkon panelu, plochy (zoznam aj kroky jednej plochy) a menič. */
export const PANEL_TABS = /** @type {const} */ ([
    { step: 'panel', label: 'Výkon', steps: ['panel'] },
    { step: 'dalsia', label: 'Plochy', steps: ['dalsia', 'smer', 'sklon', 'pocet'] },
    { step: 'menic', label: 'Menič', steps: ['menic'] },
]);

/**
 * Záložky nad obrazovkou pri úprave z prehľadu (setupReturn = 'prehlad', alebo zo zhrnutia):
 * `group` panely (výkon, plochy, menič), `roof` kroky jednej plochy, `tariff` kroky tarify. Mimo
 * úpravy, alebo na obrazovke, ktorá do skupiny nepatrí, je skupina null.
 * @param {SetupState} state @param {import('./settings.js').Settings} draft @param {SetupStep} step
 */
export function editTabs(state, draft, step) {
    const edit = state.setupReturn !== null;
    /** @param {readonly string[]} steps */
    const has = (steps) => edit && steps.includes(step);
    const onRoof = has(['smer', 'sklon', 'pocet']);
    return {
        // Úprava jedného kroku zo zhrnutia sprievodcu sa vracia naň - prepínať medzi krokmi panelov
        // treba len pri úprave uloženej elektrárne z prehľadu.
        group:
            state.setupReturn === 'prehlad' && has(PANEL_TABS.flatMap((t) => t.steps))
                ? PANEL_TABS.map((t) => ({ step: t.step, label: t.label, on: /** @type {readonly string[]} */ (t.steps).includes(step) }))
                : null,
        roof: onRoof,
        tariff: has(TARIFF_STEPS)
            ? tariffSteps(tariffKind(draft.tariff)).map((k) => ({ step: k, label: TARIFF_TABS[k], on: k === step }))
            : null,
    };
}
