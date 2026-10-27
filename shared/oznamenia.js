// Ranné oznámenie s plánom dňa: uložená voľba telefónu, obsah oznámenia a pripomienka. Čisté
// funkcie bez DOM a siete - volá ich service worker (sw.js) v chvíli, keď ho Worker zobudí,
// a appky v Nastavení. Plán počíta shared/plan-dna.js, vety skladá shared/messages-core.js.

import { MOZEM_ITEMS, OZNAMENIA, PLAN_DNA, TARIFF_LIMITS } from './config.js';
import { oznameniaTexts, planNoticeText, reminderText } from './messages-core.js';
import { dayCtx, planWindows } from './mozem.js';
import { planDna } from './plan-dna.js';
import { buildForecast, localMinutes } from './solar.js';

/**
 * Voľba telefónu: oznámenie zapnuté, hodina (miestny čas, jedna z OZNAMENIA.hours) a spotrebiče,
 * ktoré človek má doma - s nimi ráta oznámenie aj Plán dňa na karte Môžem?.
 * @typedef {{ on: boolean, hour: number, devices: string[] }} Oznamenia
 */

/** Pred prvou voľbou: vypnuté, predvolená hodina a spotrebiče plánu. @returns {Oznamenia} */
export const oznameniaDefault = () => ({ on: false, hour: OZNAMENIA.hour, devices: [...PLAN_DNA.devices] });

/** Spotrebiče, ktoré sa dajú vybrať: veci karty, ktoré majú spotrebič. */
export const OZNAMENIA_DEVICES = MOZEM_ITEMS.filter((i) => i.device).map((i) => i.id);

/**
 * Uložená voľba (JSON z úložiska). Čokoľvek poškodené alebo neznáme sa nahradí predvolenou
 * hodnotou, nie zahodí celé - nová appka tak prečíta aj voľbu staršej.
 * @param {string | null} raw @returns {Oznamenia}
 */
export function parseOznamenia(raw) {
    const base = oznameniaDefault();
    /** @type {any} */ let v = null;
    try {
        v = raw ? JSON.parse(raw) : null;
    } catch {
        return base;
    }
    if (!v || typeof v !== 'object') return base;
    const devices = Array.isArray(v.devices)
        ? v.devices.filter((/** @type {unknown} */ d) => OZNAMENIA_DEVICES.includes(String(d)))
        : base.devices;
    return {
        on: v.on === true,
        hour: OZNAMENIA.hours.includes(v.hour) ? v.hour : base.hour,
        devices: [...new Set(/** @type {string[]} */ (devices))],
    };
}

/**
 * Obsah ranného oznámenia z plánu dňa od teraz: nadpis, text a pripomienka, ktorú ponúkne
 * tlačidlo (najbližší spotrebič, ktorý ešte nie je na rade) - alebo null.
 * @param {import('./day-plan.js').PlanInput} input @param {{ devices: readonly string[], voice?: import('./messages.js').Voice }} opts
 */
export function planNotice(input, { devices, voice = 'drzy' }) {
    const ctx = dayCtx(input);
    const rows = planDna(ctx, input, devices);
    const green = planWindows(ctx.plan, (s) => Number.isFinite(s.kw) && s.kw >= ctx.th.lowKw).filter((w) => w.to > ctx.nowMin);
    const sunEnd = green.length ? green[green.length - 1].to : null;
    const now = Math.ceil(ctx.nowMin / TARIFF_LIMITS.stepMin) * TARIFF_LIMITS.stepMin;
    const next = rows.filter((r) => r.kind === 'sun' && r.id !== 'auto' && r.start > now).sort((a, b) => sortStart(a) - sortStart(b))[0];
    const remind = next && next.kind === 'sun' ? { id: next.id, at: next.start } : null;
    return { ...planNoticeText({ rows, sunEnd, weak: ctx.weakToday }, voice), remind };
}

/** @param {import('./plan-dna.js').PlanRow} r */
const sortStart = (r) => (r.kind === 'sun' || r.kind === 'cheap' ? r.start : Infinity);

/**
 * Pripomienka spotrebiča `id`, o ktorú človek ráno požiadal: jeho miesto sa prepočíta z čerstvej
 * predpovede, takže keď medzičasom zatiahlo, povie to namiesto „teraz“. Ráta len s ním -
 * čo bolo v pláne pred ním, už beží alebo dobehlo.
 * @param {import('./day-plan.js').PlanInput} input @param {{ id: string, voice?: import('./messages.js').Voice }} opts
 */
export function reminderNotice(input, { id, voice = 'drzy' }) {
    const ctx = dayCtx(input);
    const [row] = planDna(ctx, input, [id]);
    return row ? reminderText(row, ctx.nowMin, voice) : null;
}

/**
 * Čo service worker vie bez localStorage: nastavenie, ktoré mu appka odloží (poloha, panely,
 * tarifa, spotrebiče, tón, ktorú appku ťuknutie otvorí - cesta voči koreňu - a hodina, s ktorou sa
 * pri obnove odberu prihlási znova).
 * @typedef {{ site: import('./config.js').Site, plant: import('./config.js').Plant, tariff: import('./config.js').Tariff,
 *   devices: string[], voice: import('./messages.js').Voice, app: string, hour: number }} Zrkadlo
 */
/** Pripomienka z tlačidla: spotrebič a kedy (ISO čas). @typedef {{ id: string, at: string }} Pripomienka */

/**
 * Čo ukáže service worker, keď ho Worker zobudí: pripomienka, ak jej čas práve nastal, inak ranný
 * plán dňa - s tlačidlom na pripomienku najbližšieho spotrebiča (`remind`: ISO čas a nápis).
 * `keep` sú pripomienky, ktoré ešte čakajú.
 * @param {Zrkadlo} z @param {Pripomienka[]} reminders @param {Parameters<typeof buildForecast>[0]} weather @param {Date} now
 */
export function swNotice(z, reminders, weather, now) {
    const forecast = buildForecast(weather, now, z.site, z.plant);
    const input = { now, site: z.site, plant: z.plant, tariff: z.tariff, pv: null, forecast };
    const off = (/** @type {Pripomienka} */ r) => (new Date(r.at).getTime() - now.getTime()) / 60000;
    const due = reminders.find((r) => Math.abs(off(r)) <= OZNAMENIA.remindWindowMin);
    const keep = reminders.filter((r) => r !== due && off(r) > -OZNAMENIA.remindWindowMin);
    const reminder = due ? reminderNotice(input, { id: due.id, voice: z.voice }) : null;
    if (reminder) return { ...reminder, remind: null, keep, reminder: true };
    const n = planNotice(input, { devices: z.devices, voice: z.voice });
    const nowMin = localMinutes(now, z.site.timezone);
    const remind = n.remind
        ? {
              id: n.remind.id,
              at: new Date(now.getTime() + (n.remind.at - nowMin) * 60000).toISOString(),
              label: oznameniaTexts(z.voice).remind(n.remind.at),
          }
        : null;
    return { title: n.title, body: n.body, remind, keep, reminder: false };
}

/**
 * Je čas ranného oznámenia? Worker budí raz za OZNAMENIA.stepMin minút, oznámenie patrí tomu
 * behu, ktorý padne do prvej štvrťhodiny zvolenej hodiny miestneho času.
 * @param {Date} now @param {string} timeZone @param {number} hour
 */
export function morningDue(now, timeZone, hour) {
    const m = localMinutes(now, timeZone) - hour * 60;
    return m >= 0 && m < OZNAMENIA.stepMin;
}

/**
 * Pridá či uberie spotrebič zo spotrebičov doma.
 * @param {Oznamenia} o @param {string} id @returns {Partial<Oznamenia>}
 */
export const prepniSpotrebic = (o, id) => ({ devices: o.devices.includes(id) ? o.devices.filter((d) => d !== id) : [...o.devices, id] });

/**
 * Čo ukáže sekcia Oznámenia v oboch appkách: ktorá hláška (kľúč do oznameniaTexts().stav, prázdny
 * bez hlášky) a či sú voľby zamknuté. Bez polohy appka nemá z čoho rátať; kým sa zapína, nedá sa
 * nič meniť, aby sa zmeny nepobili. Zapnuté oznámenie sa dá vždy vypnúť.
 * @param {import('./settings.js').Known} known @param {string} stav stav z web/oznamenia.js @param {boolean} on
 * @returns {{ stav: 'ok' | 'caka' | 'plocha' | 'zakazane' | 'nepodporuje' | 'bezElektrarne' | 'chyba', blocked: boolean, busy: boolean }}
 */
export function oznamOvladanie(known, stav, on) {
    const key = known === 'nic' ? 'bezElektrarne' : /** @type {any} */ (stav);
    const busy = stav === 'caka';
    const blocked = busy || (!on && ['bezElektrarne', 'plocha', 'nepodporuje', 'zakazane'].includes(key));
    return { stav: key, blocked, busy };
}

/** Verejný kľúč VAPID ako bajty pre pushManager.subscribe (appka aj service worker). */
export function vapidKeyBytes() {
    const b64 = OZNAMENIA.vapidPublic.replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
