// Karta Môžem? v novej appke „Živá obloha“ (obloha/). Počíta sa to isté ako v súčasnej appke
// (mozemModel v shared/mozem.js, aj dlaždice skupín vecí), tu sa to len skladá pre nový vzhľad:
// štítky nad slovom, fakt v mobiloch, oblúk slnka a výzvy. Čisté funkcie - čas, dáta
// aj to, či je internet, prichádzajú v parametroch. Texty sú v shared/messages.js.

import { HOUR_RANGE } from './chart-model.js';
import { installedKw, TYPICAL_PLANT } from './config.js';
import { pvFreshness } from './hero-model.js';
import { mozemGuessText, mozemOfflineText, mozemPhonesText, voiceTexts } from './messages-core.js';
import { mozemModel } from './mozem.js';
import { planDnaModel } from './plan-dna.js';
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
 * Meranie zo strechy: ide, alebo odkedy mlčí. Bez pripojeného merania nie je čo merať.
 * @param {import('./day-plan.js').PlanInput & { zdroj: unknown }} input
 */
export function pvStatus({ now, site, pv, zdroj }) {
    if (!zdroj || !pv) return { ok: false, since: null };
    const fresh = pvFreshness({ now, pv, site });
    return { ok: !fresh.stale, since: fresh.stale ? fresh.time : null };
}

/**
 * Model karty Môžem? novej appky. `known: 'nic'` (appka nepozná ani polohu) je len výzva zadať
 * polohu (`ask`), bez odpovedí. Pri známej polohe bez panelov karta odpovedá z typickej strechy
 * a priznáva to (`estimate`, `guess`).
 * @param {import('./day-plan.js').PlanInput & { zdroj: unknown, loading: boolean, known: import('./settings.js').Known }} input
 * @param {{ online?: boolean, voice?: import('./messages.js').Voice, devices?: readonly string[] }} [opts] či má telefón
 *   internet, tón textov a spotrebiče doma (s nimi ráta Plán dňa)
 */
export function mozemSkyModel(input, { online = true, voice = 'drzy', devices } = {}) {
    if (input.known === 'nic') return { ask: true, arc: null, ...emptyCard() };
    const m = mozemModel(input, { voice });
    const f = m.facts;
    const offline = m.state === 'offline';
    return {
        ask: false,
        state: m.state,
        word: m.word,
        lead: offline ? offlineLead(input, online, voice) : m.hero.lead,
        chips: chipsOf(m, voice),
        phones: f ? phonesOf(input, f, m.estimate) : '',
        retry: offline,
        guess: m.estimate ? mozemGuessText(installedKw(TYPICAL_PLANT), voice) : '',
        list: m.list,
        items: m.items,
        groups: m.groups,
        plan: planDnaModel(input, { voice, devices }),
        arc: sunArc(input.now, input.site, f ? f.window : null),
    };
}

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
    return mozemOfflineText({ online, zdroj: !!input.zdroj, pvOk: pv.ok, pvSince: pv.since }, voice);
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
        items: /** @type {ReturnType<typeof mozemModel>['items']} */ ([]),
        groups: /** @type {ReturnType<typeof mozemModel>['groups']} */ ([]),
        plan: /** @type {ReturnType<typeof planDnaModel>} */ (null),
    };
}

/** @typedef {ReturnType<typeof mozemSkyModel>} MozemSkyModel */
