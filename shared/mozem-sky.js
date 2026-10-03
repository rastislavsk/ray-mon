// Karta Môžem? v novej appke „Živá obloha“ (obloha/). Počíta sa to isté ako v súčasnej appke
// (mozemModel v shared/mozem.js), tu sa to len skladá pre nový vzhľad: štítky nad slovom, fakt
// v mobiloch, nadpis zoznamu vecí, panel veci, oblúk slnka a výzvy. Čisté funkcie - čas, dáta
// aj to, či je internet, prichádzajú v parametroch. Texty sú v shared/messages.js.

import { HOUR_RANGE } from './chart-model.js';
import { installedKw, TYPICAL_PLANT } from './config.js';
import { pvFreshness } from './hero-model.js';
import { runMinOf, runningLaunch } from './launches.js';
import { mozemGuessText, mozemListTitle, mozemLogCancel, mozemOfflineText, mozemPhonesText, voiceTexts } from './messages.js';
import { mozemModel } from './mozem.js';
import { localDateKey, localMinutes, sunTimes, sunUp } from './solar.js';

/** @typedef {import('./mozem.js').Window} Window */
/** @typedef {{ text: string, tone: 'go' | 'plain' | 'cheap' | 'costly' }} Chip */
/**
 * Oblúk slnka: východ a západ (minúta dňa, null v polárny deň či noc), kde je slnko medzi nimi
 * (0 = východ, 1 = západ, null = noc) a dnešné okno so slnkom tým istým meradlom.
 * @typedef {{ rise: number | null, set: number | null, sun: number | null, win: { from: number, to: number } | null }} SunArc
 */

/**
 * Oblúk slnka pre danú chvíľu. Východ a západ sú skutočné pre polohu elektrárne; kde v ten deň
 * nie sú, oblúk ide cez produkčné okno grafov (HOUR_RANGE).
 * @param {Date} now @param {import('./config.js').Site} site @param {Window | null} window okno so slnkom, alebo null
 * @returns {SunArc}
 */
export function sunArc(now, site, window) {
    const { rise, set } = sunTimes(site, localDateKey(now, site.timezone));
    const from = rise ?? HOUR_RANGE.min * 60;
    const to = set ?? HOUR_RANGE.max * 60;
    const at = (/** @type {number} */ m) => Math.round(Math.max(0, Math.min(1, (m - from) / (to - from))) * 1000) / 1000;
    return {
        rise,
        set,
        sun: sunUp(now, site) ? at(localMinutes(now, site.timezone)) : null,
        win: window ? { from: at(window.from), to: at(window.to) } : null,
    };
}

/**
 * Meranie zo strechy: ide, alebo odkedy mlčí. Bez kiosku nie je čo merať.
 * @param {import('./day-plan.js').PlanInput & { kiosk: string }} input
 */
export function pvStatus({ now, site, pv, kiosk }) {
    if (!kiosk || !pv) return { ok: false, since: null };
    const fresh = pvFreshness({ now, pv, site });
    return { ok: !fresh.stale, since: fresh.stale ? fresh.time : null };
}

/**
 * Model karty Môžem? novej appky. `known: 'nic'` (appka nepozná ani polohu) je len výzva zadať
 * polohu (`ask`), bez odpovedí. Pri známej polohe bez panelov karta odpovedá z typickej strechy
 * a priznáva to (`estimate`, `guess`).
 * @param {import('./day-plan.js').PlanInput & { kiosk: string, loading: boolean, known: import('./settings.js').Known }} input
 * @param {{ quip?: number, launches?: import('./launches.js').Launch[], online?: boolean,
 *   voice?: import('./messages.js').Voice }} [opts] stránka hlášok, zápisy „Pustil/a som“, či má telefón internet a tón hlášok
 */
export function mozemSkyModel(input, { quip = 0, launches = [], online = true, voice = 'drzy' } = {}) {
    if (input.known === 'nic') return { ask: true, arc: null, ...emptyCard() };
    const m = mozemModel(input, quip, launches, { guess: true, voice });
    const f = m.facts;
    const offline = m.state === 'offline';
    // Kým sa načítava, karta nič netvrdí - ani „neviem“ pri veciach, ani hlášku navyše k vete.
    const loading = m.state === 'loading';
    return {
        ask: false,
        state: m.state,
        word: m.word,
        lead: offline ? offlineLead(input, online, voice) : m.hero.lead,
        chips: chipsOf(m, voice),
        phones: f ? phonesOf(input, f, m.estimate) : '',
        retry: offline,
        guess: m.estimate ? mozemGuessText(installedKw(TYPICAL_PLANT), voice) : '',
        list: listOf(m, loading),
        items: m.items.map((it) => sheetItem(it, runningUntil(input, launches, it.id))),
        count: m.count,
        quip: loading ? '' : m.quip,
        arc: sunArc(input.now, input.site, f ? f.window : null),
    };
}

/**
 * Nadpis zoznamu vecí: koľko ide hneď, bez dát „?“, pri typickej streche odhad. Kým sa načítava, zoznam nie je.
 * @param {ReturnType<typeof mozemModel>} m @param {boolean} loading
 */
const listOf = (m, loading) =>
    loading ? null : { title: mozemListTitle(m.items, { unknown: !m.facts, estimate: m.estimate }), estimate: m.estimate };

/** Štítky nad slovom: odpoveď a lacná či drahá sieť teraz. @param {ReturnType<typeof mozemModel>} m @param {import('./messages.js').Voice} voice @returns {Chip[]} */
function chipsOf(m, voice) {
    const MOZEM_CHIPS = voiceTexts(voice).MOZEM_CHIPS;
    /** @type {Chip[]} */ const chips = [];
    if (MOZEM_CHIPS[m.state]) chips.push({ text: MOZEM_CHIPS[m.state], tone: m.state === 'go' ? 'go' : 'plain' });
    const level = m.facts?.level;
    if (level === 'lacna') chips.push({ text: MOZEM_CHIPS.lacna, tone: 'cheap' });
    if (level === 'draha') chips.push({ text: MOZEM_CHIPS.draha, tone: 'costly' });
    return chips;
}

/**
 * Fakt v mobiloch: naisto len zo živého a čerstvého merania vlastnej strechy, inak z plánu dňa s „asi“.
 * @param {Parameters<typeof pvStatus>[0]} input @param {NonNullable<ReturnType<typeof mozemModel>['facts']>} f @param {boolean} estimate
 */
function phonesOf(input, f, estimate) {
    const sure = f.liveKw !== null && pvStatus(input).ok && !estimate;
    return mozemPhonesText(sure ? /** @type {number} */ (f.liveKw) : f.planKw, sure);
}

/**
 * Veta bez dát: prečo ich appka nemá.
 * @param {Parameters<typeof pvStatus>[0]} input @param {boolean} online @param {import('./messages.js').Voice} [voice]
 */
export function offlineLead(input, online, voice = 'drzy') {
    const pv = pvStatus(input);
    return mozemOfflineText({ online, kiosk: !!input.kiosk, pvOk: pv.ok, pvSince: pv.since }, voice);
}

/**
 * Vec v zozname a v jej paneli: riadok (meno, krátka odpoveď, farba), nadpis panelu, „čo robiť“,
 * „prečo“, otázka s odpoveďou a tlačidlo zápisu. Kým vec beží, tlačidlo hovorí dokedy a zruší ju.
 * @param {ReturnType<typeof mozemModel>['items'][number]} it @param {number | null} until dokedy vec beží (minúta dňa)
 */
function sheetItem(it, until) {
    const log = it.log && {
        sun: it.log.sun,
        pressed: it.log.pressed,
        label: until === null ? it.log.label : mozemLogCancel(it.id === 'auto', until),
    };
    return {
        id: it.id,
        name: it.name,
        short: it.short,
        tone: it.tone,
        running: !!(it.log && it.log.pressed),
        title: `${it.name}: ${it.short}`,
        head: it.head,
        text: it.text,
        more: it.more,
        log,
    };
}

/**
 * Dokedy spustená vec beží (minúta dňa), alebo null - to isté, z čoho mozemModel skladá „beží do …“.
 * @param {import('./day-plan.js').PlanInput} input @param {import('./launches.js').Launch[]} launches @param {string} id
 */
function runningUntil({ now, site }, launches, id) {
    const running = runningLaunch(launches, id, localDateKey(now, site.timezone), localMinutes(now, site.timezone));
    return running ? running.m + runMinOf(id) : null;
}

/** Karta bez odpovede (appka nepozná polohu). */
function emptyCard() {
    return {
        state: /** @type {import('./mozem.js').MozemState} */ ('bezpanelov'),
        word: '',
        lead: '',
        chips: /** @type {Chip[]} */ ([]),
        phones: '',
        retry: false,
        guess: '',
        list: null,
        items: /** @type {ReturnType<typeof sheetItem>[]} */ ([]),
        count: '',
        quip: '',
    };
}

/** @typedef {ReturnType<typeof mozemSkyModel>} MozemSkyModel */
