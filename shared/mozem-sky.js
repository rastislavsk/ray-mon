// Karta Môžem?. Počíta sa to isté
// (mozemModel v shared/mozem.js), tu sa to len skladá pre nový vzhľad: veľké slovo, čo dá
// strecha za celý deň a výzvy. Štítky a vetu o teraz kreslí karta Teraz. Čisté funkcie - čas, dáta
// aj to, či je internet, prichádzajú v parametroch. Texty sú v shared/messages.js.

import { installedKw, TYPICAL_PLANT } from './config.js';
import { pvFreshness } from './hero-model.js';
import { mozemGuessText, mozemOfflineText } from './messages-core.js';
import { mozemModel } from './mozem.js';

/**
 * Meranie zo strechy: ide, alebo odkedy mlčí. Bez pripojeného merania nie je čo merať.
 * @param {import('./day-plan.js').PlanInput & { zdroj: unknown }} input
 */
export function pvStatus({ now, site, pv, zdroj, pokusAt }) {
    if (!zdroj || !pv) return { ok: false, since: null };
    const fresh = pvFreshness({ now, pv, site, pokusAt });
    return { ok: !fresh.stale, since: fresh.stale ? fresh.time : null };
}

/**
 * Model karty Môžem?. `known: 'nic'` (appka nepozná ani polohu) je len výzva zadať
 * polohu (`ask`), bez odpovedí. Pri známej polohe bez panelov karta odpovedá z typickej strechy
 * a priznáva to (`estimate`, `guess`).
 * @param {import('./day-plan.js').PlanInput & { zdroj: unknown, loading: boolean, known: import('./settings.js').Known }} input
 * @param {{ online?: boolean, voice?: import('./messages.js').Voice, devices?: readonly string[],
 *   ranna?: import('./den-trieda.js').RannaTrieda | null }} [opts] či má telefón internet, tón textov,
 *   spotrebiče doma (s nimi ráta Plán dňa) a ranná trieda dňa
 */
export function mozemSkyModel(input, { online = true, voice = 'drzy', devices, ranna = null } = {}) {
    if (input.known === 'nic') return { ask: true, ...emptyCard() };
    const m = mozemModel(input, { voice, devices, ranna });
    const f = m.facts;
    const offline = m.state === 'offline';
    return {
        ask: false,
        state: m.state,
        word: m.word,
        // S predpoveďou na dnešok karta namiesto vety ukáže, čo dá strecha za celý deň (`day`);
        // veta ostáva pre čítačku - ohlási ju pri zmene odpovede.
        lead: offline ? offlineLead(input, online, voice) : m.hero.lead,
        day: m.day,
        // Slovo o dni a dnešné okno - z nich karta skladá to, čo sa mení s časťou dňa (shared/dnes-faza.js).
        den: m.den,
        window: f ? f.window : null,
        retry: offline,
        guess: m.estimate ? mozemGuessText(installedKw(TYPICAL_PLANT), voice) : '',
        list: m.list,
        items: m.items,
        groups: m.groups,
        plan: m.plan,
    };
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
        day: /** @type {ReturnType<typeof mozemModel>['day']} */ (null),
        den: /** @type {ReturnType<typeof mozemModel>['den']} */ (null),
        window: /** @type {import('./mozem-jadro.js').Window | null} */ (null),
        retry: false,
        guess: '',
        list: null,
        items: /** @type {ReturnType<typeof mozemModel>['items']} */ ([]),
        groups: /** @type {ReturnType<typeof mozemModel>['groups']} */ ([]),
        plan: /** @type {import('./mozem.js').MozemModelPlan} */ (null),
    };
}

/** @typedef {ReturnType<typeof mozemSkyModel>} MozemSkyModel */
