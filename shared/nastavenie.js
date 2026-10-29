// Karta Nastavenie oboch appiek: celý prehľad - výzva dokončiť nastavenie, hlásenie o prístupe
// k meraniu, karta elektrárne a sekcie Elektráreň, Čo máš doma, Oznámenia, Vzhľad a Appka -
// s textami, hodnotami a stavom volieb. Obe appky ho len kreslia, každá svojím ovládaním
// (docs/navrhy/nastavenie-zjednotenie.html). Čisté funkcie - stav dostanú, texty a čísla vrátia.
// Voľby, ktoré má len jedna appka (živá obloha, farba pozadia), si do sekcie Vzhľad pridáva kabát.
// Sprievodca sám je spoločný tiež (shared/setup-flow.js, shared/setup-texts.js).

import { OZNAMENIA, VOICES } from './config.js';
import { DOMA_DEVICES } from './doma.js';
import { kwpText } from './format.js';
import { liveStatus } from './hero-model.js';
import { oznameniaTexts, polite, voiceTexts } from './messages-core.js';
import { oznamOvladanie } from './oznamenia.js';
import { pristupModel } from './pristup.js';
import { checkSettings, totalPanels } from './settings.js';
import { ROOF_STEPS, SETUP_SECTIONS, TARIFF_STEPS, tariffSteps } from './setup.js';
import { savedSettings } from './setup-flow.js';
import { GUESS_MARK, kwText, plantHero, TARIFF_TABS, zdrojText } from './setup-texts.js';
import { tariffHint, tariffKind, tariffPricesText } from './tariff.js';
import { menoZnacky } from './zdroje.js';

/** @typedef {import('./setup-flow.js').SetupState} SetupState */
/** @typedef {import('./setup.js').SetupStep} SetupStep */
/** @typedef {import('./messages-core.js').Voice} Voice */
/**
 * Stav, z ktorého sa karta skladá: sprievodca, živé meranie, tón, spotrebiče doma, ranné
 * oznámenie a voľby zdieľania.
 * @typedef {SetupState & { pv: import('./kiosk.js').PvData | null, loading: boolean, voice: Voice, doma: readonly string[],
 *   oznamenia: import('./oznamenia.js').Oznamenia, oznamStav: string, shareSettings: boolean, shareKiosk: boolean }} NastavenieState
 */
/**
 * Riadok sekcie Elektráreň. `edit` je krok, ktorý riadok otvorí na úpravu uloženej elektrárne
 * (stepEdit), `start` znamená pokračovať v sprievodcovi od panelov - bez nich sa tarifa ani meranie
 * uložiť nedajú. `extra` je druhý riadok pod hodnotou, `guess` hodnota z „Neviem“ a `status` stav
 * živého merania (`tone` ako liveStatus, `off` aj pri neplatnom prístupe).
 * @typedef {{ key: string, label: string, value: string, extra: string, guess: boolean,
 *   status: { tone: string, text: string } | null, edit: string | null, start: boolean }} Row
 */

/** Zoznam slovom: „juh“, „juh a východ“, „juh, východ a západ“. @param {string[]} items */
export function listText(items) {
    return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} a ${items[items.length - 1]}`;
}

/** Počet plôch slovom. @param {number} n */
const planesText = (n) => (n === 1 ? '1 plocha' : `${n} plochy`);

/** Pevné texty karty. Kde sa tóny líšia, je pri kľúči dvojica [drzý, slušný]. */
export const NASTAVENIE_TEXTS = {
    title: 'Moja elektráreň',
    ctaText: /** @type {[string, string]} */ ([
        'Ďalej panely, plochy strechy, menič, meranie a tarifa. Na čo nevieš odpoveď, preskočíš tlačidlom Neviem.',
        'Ďalej panely, plochy strechy, menič, meranie a tarifa. Na čo neviete odpoveď, preskočíte tlačidlom Neviem.',
    ]),
    ctaBtn: 'Pokračovať: panely',
    ctaLink: 'Mám odkaz s nastavením',
    elektraren: 'Elektráreň',
    elektrarenHint: 'Poloha, panely, menič, meranie a tarifa',
    odkaz: { label: 'Prevziať nastavenie z odkazu', small: 'Nahradí to, čo je uložené teraz' },
    sprievodca: {
        label: 'Prejsť sprievodcom znova',
        small: /** @type {[string, string]} */ ([
            'Údaje ostanú, len ich prejdeš krok po kroku',
            'Údaje ostanú, len ich prejdete krok po kroku',
        ]),
    },
    doma: /** @type {[string, string]} */ (['Čo máš doma', 'Čo máte doma']),
    domaNic: 'zatiaľ nič',
    domaNote: /** @type {[string, string]} */ ([
        'Plán dňa a ranné oznámenie rátajú len s tým, čo tu označíš.',
        'Plán dňa a ranné oznámenie rátajú len s tým, čo tu označíte.',
    ]),
    vzhlad: 'Vzhľad',
    voiceLabel: 'Tón hlášok',
    voiceSmall: 'drzý tyká, slušný vyká a je vecný',
    voices: { drzy: 'Drzý', slusny: 'Slušný' },
    appka: 'Appka',
    share: {
        title: 'Zdieľať appku',
        small: 'QR kód, WhatsApp, aj s mojím nastavením',
        text: /** @type {[string, string]} */ ([
            'Druhý telefón naskenuje QR kód, alebo mu pošli odkaz.',
            'Druhý telefón naskenuje QR kód, alebo mu pošlite odkaz.',
        ]),
        settings: 'Pridať moje nastavenie elektrárne',
        kiosk: /** @type {[string, string]} */ ([
            'aj živé meranie – kto odkaz dostane, uvidí tvoju výrobu',
            'aj živé meranie – kto odkaz dostane, uvidí vašu výrobu',
        ]),
        wa: 'Poslať cez WhatsApp',
    },
    clear: {
        title: 'Vymazať údaje',
        small: 'všetko, čo appka uložila v tomto prehliadači',
        ask: 'Vymazať všetky údaje?',
        text:
            'Zmaže sa elektráreň, poloha, denník výroby, spotrebiče aj vzhľad – v oboch appkách, lebo majú spoločné úložisko. ' +
            'Ranné oznámenie sa vypne. Odinštalovanie appky tieto údaje samo nezmaže.',
        ok: 'Vymazať',
        cancel: 'Nechať tak',
    },
    credit: ['Toilet Apps Ltd.', 'Made by 2R & Claude ¯\\_(ツ)_/¯'],
};

/** Text v tóne: dvojica [drzý, slušný] alebo jeden pre oba. @param {string | [string, string]} t @param {Voice} voice */
const inVoice = (t, voice) => (typeof t === 'string' ? t : t[polite(voice) ? 1 : 0]);

/**
 * Výzva dokončiť elektráreň, kým appka pozná len polohu: koľko krokov sprievodcu ostáva
 * (poloha je prvý z nich a je hotová). Inak null.
 * @param {Pick<SetupState, 'known' | 'site'>} state @param {Voice} [voice]
 */
export function setupCta(state, voice = 'drzy') {
    if (state.known !== 'poloha') return null;
    const total = SETUP_SECTIONS.length;
    return {
        title: `Ešte ${total - 1} krokov a appka bude tvoja`,
        steps: Array.from({ length: total }, (_, i) => i < 1),
        stepsLabel: `Hotový 1 zo ${total} krokov`,
        text: `Poloha ${state.site.name} je hotová. ${inVoice(NASTAVENIE_TEXTS.ctaText, voice)}`,
        button: NASTAVENIE_TEXTS.ctaBtn,
        link: NASTAVENIE_TEXTS.ctaLink,
    };
}

/** Prístup k meraniu, ktorý neplatí či čoskoro vyprší (shared/pristup.js). @param {SetupState} state */
const pristupOf = (state) => pristupModel({ zdroj: state.zdroj, pristup: state.pristup, now: state.now, timezone: state.site.timezone });

/**
 * Riadok živého merania: značka a stav pripojenia, bez merania či bez panelov nepovinné.
 * @param {NastavenieState} state @returns {Pick<Row, 'value' | 'status'>}
 */
function liveRow(state) {
    if (state.known !== 'elektraren') return { value: 'nepripojené, nepovinné', status: null };
    if (!state.zdroj) return { value: 'bez merania, odhad z predpovede', status: null };
    const value = menoZnacky(state.zdroj.sposob) || zdrojText(state.zdroj);
    const p = pristupOf(state);
    if (p) return { value, status: { tone: p.druh === 'neplati' ? 'off' : 'stale', text: p.stavKratko } };
    return { value, status: liveStatus(state) };
}

/**
 * Riadky sekcie Elektráreň: poloha, panely, menič, živé meranie, tarifa. Bez zadaných panelov
 * sú len výzvou pokračovať v sprievodcovi - poloha sa dá zmeniť aj tak.
 * @param {NastavenieState} state @returns {Row[]}
 */
export function nastavenieRows(state) {
    const done = state.known === 'elektraren';
    const s = savedSettings(state);
    const wp = s.plant.panelWp;
    /** @param {string} key */
    const go = (key) => ({ edit: done ? key : null, start: !done });
    const base = { extra: '', guess: false, status: null };
    return [
        { ...base, key: 'lokalita', label: 'Poloha', value: s.site.name, edit: 'lokalita', start: false },
        {
            ...base,
            key: 'panel',
            label: 'Panely',
            value: done
                ? `${planesText(s.plant.strings.length)} · ${totalPanels(s)} × ${Number.isFinite(wp) ? Math.round(wp) : '–'} Wp`
                : 'nezadané',
            guess: done && state.setupPick.wp === 'guess',
            ...go('panel'),
        },
        {
            ...base,
            key: 'menic',
            label: 'Menič',
            value: done && Number.isFinite(s.plant.acLimitKw) ? kwText(s.plant.acLimitKw) : 'nezadaný',
            guess: done && state.setupPick.ac === 'guess',
            ...go('menic'),
        },
        { ...base, key: 'meranie', label: 'Živé meranie', ...liveRow(state), ...go('meranie') },
        {
            ...base,
            key: 'tarifa',
            label: 'Tarifa',
            value: done ? tariffHint(s.tariff) : 'nezadaná',
            extra: done ? (tariffPricesText(s.tariff) ?? 'bez cien') : '',
            ...go('tarifa'),
        },
    ];
}

/**
 * Sekcia Oznámenia: prepínač, hodina, stav a čo s nimi telefón vie. Kým sa nedajú zapnúť (iPhone
 * v Safari, zakázané, bez polohy), prepínač je zamknutý a `stav` povie prečo; kým sa zapína
 * (`busy`), nedá sa meniť nič.
 * @param {NastavenieState} state
 */
function oznameniaSekcia(state) {
    const T = oznameniaTexts(state.voice);
    const { on, hour } = state.oznamenia;
    const ui = oznamOvladanie(state.known, state.oznamStav, on);
    return {
        title: T.title,
        hint: on ? T.hintOn(hour) : T.hint,
        label: T.switchLabel,
        small: T.switchSmall,
        on,
        blocked: ui.blocked,
        busy: ui.busy,
        stav: T.stav[ui.stav],
        when: T.when,
        whenSmall: T.whenSmall,
        hours: OZNAMENIA.hours.map((h) => ({ h, label: `${h}:00`, on: h === hour })),
        uses: T.uses,
        privacy: T.privacy,
    };
}

/**
 * Zdieľať appku: texty a voľby, čo k odkazu pribaliť. Typickú strechu nemá zmysel posielať ďalej -
 * pribaľuje sa len uložená elektráreň, k nej aj prístup k živému meraniu.
 * @param {NastavenieState} state
 */
function shareSekcia(state) {
    const T = NASTAVENIE_TEXTS.share;
    return {
        title: T.title,
        small: T.small,
        text: inVoice(T.text, state.voice),
        options: state.known === 'elektraren',
        settings: T.settings,
        settingsOn: state.shareSettings,
        kiosk: inVoice(T.kiosk, state.voice),
        kioskShown: state.shareSettings && !!state.zdroj,
        kioskOn: state.shareKiosk,
        wa: T.wa,
    };
}

/**
 * Karta Nastavenie. `cta` výzva dokončiť nastavenie (len poloha), `pristup` hlásenie, že prístup
 * k meraniu neplatí alebo čoskoro vyprší (`druh`), `hero` karta elektrárne (len pri zadaných
 * paneloch), `note` hlásenie po uložení a ďalej sekcie v poradí NASTAVENIE_SEKCIE.
 * @param {NastavenieState} state
 */
export function nastavenieModel(state) {
    const T = NASTAVENIE_TEXTS;
    const voice = state.voice;
    const done = state.known === 'elektraren';
    const saved = savedSettings(state);
    const h = done ? plantHero(saved, state.now) : null;
    const p = done ? pristupOf(state) : null;
    const names = voiceTexts(voice).MOZEM_ITEM_TEXTS;
    const doma = DOMA_DEVICES.filter((id) => state.doma.includes(id)).map((id, i) => (i ? names[id].name.toLowerCase() : names[id].name));
    return {
        title: T.title,
        cta: setupCta(state, voice),
        pristup: p && { druh: p.druh, ...p.karta },
        hero: h && {
            kwp: kwpText(h.kwp).replace(' kWp', ''),
            line: `${h.panels} panelov · ${listText(h.dirs)} · menič ${h.ac}`,
            clear: `za jasného dňa okolo ${h.clearKwh} kWh`,
            label: `Plochy panelov: ${h.planes}`,
        },
        note: state.settingsNote,
        elektraren: {
            title: T.elektraren,
            hint: p ? p.karta.nadpis : T.elektrarenHint,
            hintErr: p?.druh === 'neplati',
            rows: nastavenieRows(state),
            guessMark: GUESS_MARK,
            warnings: done ? checkSettings(saved).warnings : [],
            odkaz: done ? T.odkaz : null,
            sprievodca: done ? { label: T.sprievodca.label, small: inVoice(T.sprievodca.small, voice) } : null,
        },
        doma: {
            title: inVoice(T.doma, voice),
            hint: doma.length ? listText(doma) : T.domaNic,
            devices: DOMA_DEVICES.map((id) => ({ id, name: names[id].name, on: state.doma.includes(id) })),
            note: inVoice(T.domaNote, voice),
        },
        oznamenia: oznameniaSekcia(state),
        vzhlad: {
            title: T.vzhlad,
            hint: `${T.voiceLabel}: ${T.voices[voice].toLowerCase()}`,
            voiceLabel: T.voiceLabel,
            voiceSmall: T.voiceSmall,
            voices: VOICES.map((v) => ({ id: v, label: T.voices[v], on: v === voice })),
        },
        appka: { title: T.appka },
        share: shareSekcia(state),
        clear: T.clear,
        credit: T.credit,
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
    const onRoof = has(ROOF_STEPS);
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
