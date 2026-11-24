// Ranné oznámenie s plánom dňa: uložená voľba telefónu, obsah oznámenia a pripomienka. Čisté
// funkcie bez DOM a siete - volá ich service worker (sw.js) v chvíli, keď ho Worker zobudí,
// a appky v Nastavení. Plán počíta shared/plan-dna.js, vety skladá shared/messages-core.js.

import { OZNAMENIA, PLAN_DNA, TARIFF_LIMITS } from './config.js';
import { koniecText, oznameniaTexts, planNoticeText, reminderText } from './messages-core.js';
import { dayCtx, planWindows } from './mozem-jadro.js';
import { planDna, vec } from './plan-dna.js';
import { bojlerInfoZ } from './bojler.js';
import { buildForecast, localMinutes } from './solar.js';
import { naucenaPredpoved, nauceneZ } from './ucenie.js';
import { isObj } from './valid.js';
import { vyhladOznamenia } from './vyhlad.js';

/**
 * Voľba telefónu: oznámenie zapnuté a hodina (miestny čas, jedna z OZNAMENIA.hours). Spotrebiče,
 * s ktorými oznámenie ráta, sú v položke Čo máš doma (shared/doma.js).
 * @typedef {{ on: boolean, hour: number }} Oznamenia
 */

/**
 * Značka v adrese: appku otvorilo ťuknutie na oznámenie. V hashi byť nemôže, ten nesie nastavenie
 * a appka ho prepisuje (web/settings-store.js). Návrh: docs/navrhy/oznamenie-plan-dna.html.
 */
const KLIK_PARAM = 'z';

/**
 * Na čo sa ťuklo (docs/navrhy/oznamenia-animacie.html): ranný plán dňa, alebo oznámenie jedného spotrebiča -
 * koniec programu, pripomienka, zmena ohrevu bojlera, začiatok či koniec nabíjania auta. Appka podľa toho oživí ikonu dlaždice.
 * @typedef {{ udalost: 'plan' } | { udalost: 'koniec' | 'pripomen' | 'bojler' | 'auto', vec: string }} Ciel
 */

/** @type {Ciel} */
const PLAN = { udalost: 'plan' };
const UDALOSTI = ['koniec', 'pripomen', 'bojler', 'auto'];

/**
 * Značka ťuknutia v adrese aj v správe bežiacej appke. Plán je holé OZNAMENIA.klik ako pred cieľmi, takže ho pozná
 * aj staršia appka; značku spotrebiča staršia appka prejde mlčky.
 * @param {Ciel} ciel @returns {string}
 */
export const klikZnacka = (ciel) => (ciel.udalost === 'plan' ? OZNAMENIA.klik : `${OZNAMENIA.klik}:${ciel.udalost}:${ciel.vec}`);

/**
 * Cieľ zo značky, null keď to značka ťuknutia nie je. Značku, ktorej táto appka nerozumie (z novšieho service
 * workera), berie ako plán - ťuknutie sa tak neprepadne.
 * @param {unknown} znacka @returns {Ciel | null}
 */
export function klikCiel(znacka) {
    if (typeof znacka !== 'string') return null;
    if (znacka === OZNAMENIA.klik) return PLAN;
    const [k, udalost, vec, ...zvysok] = znacka.split(':');
    if (k !== OZNAMENIA.klik) return null;
    return UDALOSTI.includes(udalost) && /^[a-z]+$/.test(vec ?? '') && !zvysok.length ? /** @type {Ciel} */ ({ udalost, vec }) : PLAN;
}

/**
 * Cieľ oznámenia s obsahom podľa jeho značky: koniec programu (`koniec-pracka`, worker/src/budik.js), zmena
 * ohrevu bojlera (OZNAMENIA.bojler), nabíjanie auta (OZNAMENIA.auto). Inak plán.
 * @param {string} tag @returns {Ciel}
 */
export function cielPushu(tag) {
    if (tag === OZNAMENIA.bojler) return { udalost: 'bojler', vec: 'bojler' };
    if (tag === OZNAMENIA.auto) return { udalost: 'auto', vec: 'auto' };
    const vec = /^koniec-([a-z]+)$/.exec(tag)?.[1];
    return vec ? { udalost: 'koniec', vec } : PLAN;
}

/** Adresa, ktorú service worker otvorí, keď appka nebeží. @param {string} href @param {Ciel} [ciel] @returns {string} */
export function klikUrl(href, ciel = PLAN) {
    const url = new URL(href);
    url.searchParams.set(KLIK_PARAM, klikZnacka(ciel));
    return url.href;
}

/**
 * Otvorilo appku ťuknutie na oznámenie? Vráti adresu bez značky (tú treba hneď zapísať, inak by
 * obnovenie stránky ťuknutie zopakovalo) a cieľ, alebo null, keď značku nenesie.
 * @param {string} href @returns {{ adresa: string, ciel: Ciel } | null}
 */
export function klikZAdresy(href) {
    const url = new URL(href);
    const ciel = klikCiel(url.searchParams.get(KLIK_PARAM));
    if (!ciel) return null;
    url.searchParams.delete(KLIK_PARAM);
    return { adresa: url.pathname + url.search + url.hash, ciel };
}

/**
 * Treba odber poslať Workeru znova? Worker ho drží len OZNAMENIA.odberDni dní od posledného
 * poslania; appka ho obnovuje po OZNAMENIA.obnovDni dňoch. Bez záznamu (odber spred obnovovania) áno.
 * @param {number} poslaneAt kedy naposledy (ms), 0 nikdy @param {number} nowMs
 */
export const odberTrebaObnovit = (poslaneAt, nowMs) => nowMs - poslaneAt >= OZNAMENIA.obnovDni * 24 * 3600 * 1000;

/** Pred prvou voľbou: vypnuté a predvolená hodina. @returns {Oznamenia} */
export const oznameniaDefault = () => ({ on: false, hour: OZNAMENIA.hour });

/**
 * Uložená voľba (JSON z úložiska). Čokoľvek poškodené alebo neznáme sa nahradí predvolenou
 * hodnotou, nie zahodí celé - appka tak prečíta aj voľbu staršej. Spotrebiče, ktoré v nej
 * mala staršia verzia, presúva shared/doma.js.
 * @param {string | null} raw @returns {Oznamenia}
 */
export function parseOznamenia(raw) {
    const base = oznameniaDefault();
    /** @type {unknown} */ let v = null;
    try {
        v = raw ? JSON.parse(raw) : null;
    } catch {
        return base;
    }
    if (!isObj(v)) return base;
    return { on: v.on === true, hour: typeof v.hour === 'number' && OZNAMENIA.hours.includes(v.hour) ? v.hour : base.hour };
}

/**
 * Obsah ranného oznámenia z plánu dňa od teraz: nadpis, text a pripomienka, ktorú ponúkne
 * tlačidlo (najbližší spotrebič, ktorý ešte nie je na rade) - alebo null. Keď idú dni bez slnka
 * alebo sa výhľad zmenil oproti tomu, čo oznámenie povedalo naposledy (`posledny`), nadpis je
 * výhľad a dnešok ide do textu (docs/navrhy/vyhlad-dni-bez-slnka.html). `vyhlad` si service
 * worker zapamätá na zajtra.
 * @param {import('./day-plan.js').PlanInput} input
 * @param {{ devices: readonly string[], voice?: import('./messages.js').Voice, posledny?: import('./vyhlad.js').Vyhlad | null }} opts
 */
export function planNotice(input, { devices, voice = 'drzy', posledny = null }) {
    const ctx = dayCtx(input);
    const rows = planDna(ctx, input, devices);
    const green = planWindows(ctx.plan, (s) => Number.isFinite(s.kw) && s.kw >= ctx.th.lowKw).filter((w) => w.to > ctx.nowMin);
    const sunEnd = green.length ? green[green.length - 1].to : null;
    const now = Math.ceil(ctx.nowMin / TARIFF_LIMITS.stepMin) * TARIFF_LIMITS.stepMin;
    const next = rows.filter((r) => r.kind === 'sun' && r.id !== 'auto' && r.start > now).sort((a, b) => sortStart(a) - sortStart(b))[0];
    const remind = next && next.kind === 'sun' ? { id: next.id, at: next.start } : null;
    const plan = planNoticeText({ rows, sunEnd, weak: ctx.weakToday }, voice);
    const v = vyhladOznamenia(input, devices, posledny, voice);
    if (!v.text) return { ...plan, remind, vyhlad: v.vyhlad };
    const body = [v.text.uvod, `${plan.title}.`, plan.body].filter(Boolean).join(' ');
    return { title: v.text.title, body, remind, vyhlad: v.vyhlad };
}

/**
 * Oznámenie o konci programu spotrebiča `id` (docs/navrhy/spotrebic-koniec-opakovanie.html), zložené v chvíli zápisu
 * z plánu dňa, ktorý s behom už ráta. Pri praní povie aj, čo sušička, ktorá naň čaká: plán ju dáva hneď po ňom
 * a jej podiel slnka hovorí, či ju v tej chvíli utiahne slnko.
 * @param {import('./day-plan.js').PlanInput} input @param {{ id: string, devices: readonly string[] }} o
 */
export function koniecNotice(input, { id, devices }) {
    const rows = input.forecast ? planDna(dayCtx(input), input, devices) : [];
    const caka = Object.keys(PLAN_DNA.after).find((k) => PLAN_DNA.after[k] === id);
    const r = rows.find((x) => x.id === caka && (x.kind === 'sun' || x.kind === 'siet'));
    return koniecText({ id, name: vec(id).device.name, caka: r ? { name: vec(r.id).device.name, slnko: r.kind === 'sun' } : null });
}

/** @param {import('./plan-dna.js').PlanRow} r */
const sortStart = (r) => (r.kind === 'sun' || r.kind === 'siet' || r.kind === 'cheap' ? r.start : Infinity);

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
 * pri obnove odberu prihlási znova). Aby plán v oznámení sedel s kartou Teraz (docs/navrhy/plan-dna-oznamenie-vt.html,
 * O2), odloží aj to, čo sa naučila (`ucenie`), a posledný stav bojlera, ktorý riadi zásuvka (`bojler`); zrkadlo
 * zo staršej appky ich nemá.
 * @typedef {{ site: import('./config.js').Site, plant: import('./config.js').Plant, tariff: import('./config.js').Tariff,
 *   devices: string[], voice: import('./messages.js').Voice, app: string, hour: number,
 *   ucenie?: import('./ucenie.js').Naucene | null, bojler?: import('./bojler.js').BojlerInfo | null }} Zrkadlo
 */

/**
 * Vstup Plánu dňa pre service worker: ten istý, s akým ráta karta Teraz - predpoveď opravená učením (ako sNaucenim vo
 * web/render/index.js), naučená spotreba domu a potreba bojlera a bojler riadený zásuvkou. Živé meranie service worker
 * nemá. Zrkadlo leží v telefóne, ale overí sa ako dáta zvonka - poškodené učenie či bojler sa vynechá.
 * @param {Zrkadlo} z @param {Parameters<typeof buildForecast>[0]} weather @param {Date} now
 * @returns {import('./day-plan.js').PlanInput}
 */
export function swInput(z, weather, now) {
    const ucenie = nauceneZ(z.ucenie);
    const bojler = bojlerInfoZ(z.bojler);
    const forecast = naucenaPredpoved(buildForecast(weather, now, z.site, z.plant), ucenie);
    return { now, site: z.site, plant: z.plant, tariff: z.tariff, pv: null, forecast, ucenie, bojler };
}
/** Pripomienka z tlačidla: spotrebič a kedy (ISO čas). @typedef {{ id: string, at: string }} Pripomienka */

/**
 * Čo ukáže service worker, keď ho Worker zobudí: pripomienka, ak jej čas práve nastal, inak ranný
 * plán dňa - s tlačidlom na pripomienku najbližšieho spotrebiča (`remind`: ISO čas a nápis).
 * `keep` sú pripomienky, ktoré ešte čakajú, `vyhlad` čo si zapamätať z výhľadu dní bez slnka
 * (`posledny` je to, čo si service worker pamätal doteraz), `vec` spotrebič pripomienky.
 * @param {Zrkadlo} z @param {Pripomienka[]} reminders @param {Parameters<typeof buildForecast>[0]} weather @param {Date} now
 * @param {import('./vyhlad.js').Vyhlad | null} [posledny]
 */
export function swNotice(z, reminders, weather, now, posledny = null) {
    const input = swInput(z, weather, now);
    const off = (/** @type {Pripomienka} */ r) => (new Date(r.at).getTime() - now.getTime()) / 60000;
    const due = reminders.find((r) => Math.abs(off(r)) <= OZNAMENIA.remindWindowMin);
    const keep = reminders.filter((r) => r !== due && off(r) > -OZNAMENIA.remindWindowMin);
    const reminder = due ? reminderNotice(input, { id: due.id, voice: z.voice }) : null;
    if (reminder && due) return { ...reminder, remind: null, keep, reminder: true, vec: due.id, vyhlad: posledny };
    const n = planNotice(input, { devices: z.devices, voice: z.voice, posledny });
    const nowMin = localMinutes(now, z.site.timezone);
    const remind = n.remind
        ? {
              id: n.remind.id,
              at: new Date(now.getTime() + (n.remind.at - nowMin) * 60000).toISOString(),
              label: oznameniaTexts(z.voice).remind(n.remind.at),
          }
        : null;
    return { title: n.title, body: n.body, remind, keep, reminder: false, vec: null, vyhlad: n.vyhlad };
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
 * Čo ukáže sekcia Oznámenia: ktorá hláška (kľúč do oznameniaTexts().stav, prázdny
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
