// Ranné oznámenie v prehliadači: čo telefón vie, zapnutie a vypnutie odberu Web Push a nastavenie
// pre service worker (sw.js), ktorý nevidí localStorage. Nevie nič o stave ani DOM appky, takže ho
// používajú obe appky (súčasná aj obloha/). Rozhodnutia a texty sú v shared/oznamenia.js.

import { OZNAMENIA, WORKER_OZNAMENIA_URL } from '../shared/config.js';
import { vapidKeyBytes } from '../shared/oznamenia.js';
import { saveOznamenia } from './storage.js';

/**
 * Stav oznámení na tomto telefóne: `ok` sa dajú zapnúť, `plocha` iPhone v Safari (oznámenia má
 * len appka pridaná na plochu), `zakazane` človek ich v prehliadači odmietol, `nepodporuje`
 * prehliadač ich nemá. V appke k nim pribúda `caka` (zapína sa) a `chyba`.
 * @typedef {'ok' | 'plocha' | 'zakazane' | 'nepodporuje' | 'caka' | 'chyba'} OznamStav
 */

/**
 * Appka ako cesta voči koreňu: `./` súčasná, `obloha/` nová. Každá má vlastný service worker
 * (`sw.js`, `obloha/sw.js`) s rozsahom svojej appky - Android potom oznámenie pripíše
 * nainštalovanej appke (jej logo) a nie Chrome. Odber je však v telefóne len jeden, voľba
 * oznámení je spoločná: posiela ho appka, v ktorej sa naposledy zapol alebo zmenila hodina.
 * @typedef {'./' | 'obloha/'} Appka
 */
/** @type {Appka[]} */
const APPKY = ['./', 'obloha/'];

/** Adresa service workera appky. @param {Appka} app */
const swUrl = (app) => new URL(`../${app}sw.js`, import.meta.url).href;

/**
 * Registrácia práve tejto appky. `getRegistration` vráti registráciu s najdlhším rozsahom, ktorý
 * adresu pokrýva - pre obloha/ teda aj koreňovú, keď vlastnú ešte nemá. Preto kontrola rozsahu.
 * @param {Appka} app
 */
async function registracia(app) {
    const url = swUrl(app);
    const reg = await navigator.serviceWorker.getRegistration(url);
    return reg && reg.scope === new URL('./', url).href ? reg : null;
}

/**
 * Prísľub s časovým limitom OZNAMENIA.timeoutMs: service worker, ktorého inštalácia zlyhala,
 * nikdy nebude `ready` a visiace spojenie by appku nechalo v „Zapínam…“ navždy.
 * @template T @param {Promise<T>} p @returns {Promise<T>}
 */
const doLimitu = (p) =>
    Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error('časový limit')), OZNAMENIA.timeoutMs))]);

/** Čo telefón s oznámeniami vie, bez pýtania sa na povolenie. @returns {OznamStav} */
export function oznamStav() {
    const nav = /** @type {Navigator & { standalone?: boolean }} */ (navigator);
    const vie = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    // Safari na iPhone má `standalone` a Web Push len v appke pridanej na plochu.
    if (!vie) return nav.standalone === false ? 'plocha' : 'nepodporuje';
    return Notification.permission === 'denied' ? 'zakazane' : 'ok';
}

/** Odbery tohto telefónu podľa appky, ktorá ich má. @returns {Promise<Array<{ app: Appka, sub: PushSubscription }>>} */
async function odbery() {
    if (!('serviceWorker' in navigator)) return [];
    const najdene = await Promise.all(
        APPKY.map(async (app) => {
            const sub = await (await registracia(app))?.pushManager.getSubscription();
            return sub ? [{ app, sub }] : [];
        }),
    );
    return najdene.flat();
}

/** Odber tohto telefónu, ak je - nech ho má ktorákoľvek appka. */
const odber = async () => (await odbery())[0]?.sub ?? null;

/** Zruší odber vo Workeri aj v prehliadači. Worker neplatný odber zmaže aj sám (410). @param {PushSubscription} sub */
async function zrusOdber(sub) {
    const body = JSON.stringify({ endpoint: sub.endpoint, on: false });
    await doLimitu(fetch(WORKER_OZNAMENIA_URL, { method: 'POST', body })).catch(() => null);
    await doLimitu(sub.unsubscribe());
}

/**
 * Pošle Workeru odber s hodinou a časovým pásmom elektrárne (v ňom sa ráta „9:00“). Vráti, či ho prijal.
 * @param {PushSubscription} sub @param {number} hour @param {string} timeZone
 */
async function posliOdber(sub, hour, timeZone) {
    const body = JSON.stringify({ endpoint: sub.endpoint, on: true, hour, tz: timeZone });
    const res = await doLimitu(fetch(WORKER_OZNAMENIA_URL, { method: 'POST', body }));
    return res.ok;
}

/**
 * Zapne ranné oznámenie (alebo zmení hodinu): povolenie, service worker, odber a jeho uloženie vo
 * Workeri. Volá sa z ťuknutia - iPhone sa inak na povolenie nespýta. `zatvorene`: človek otázku
 * na povolenie len zavrel - nič sa nestalo, môže to skúsiť znova. Odber, ktorý mala druhá appka,
 * sa zruší až potom, čo Worker prijal nový - kým sa to nepodarí, chodí oznámenie po starom.
 * @param {{ app: Appka, hour: number, timeZone: string }} o
 * @returns {Promise<'ok' | 'zakazane' | 'zatvorene' | 'chyba'>}
 */
export async function zapniOznamenia({ app, hour, timeZone }) {
    try {
        const perm = await Notification.requestPermission();
        if (perm === 'denied') return 'zakazane';
        if (perm !== 'granted') return 'zatvorene';
        const url = swUrl(app);
        // Na tú istú registráciu, ktorú zapisuje - nie `ready`, to sa riadi stránkou, nie appkou.
        const reg = await navigator.serviceWorker.register(url, { type: 'module', updateViaCache: 'none', scope: new URL('./', url).href });
        await doLimitu(cakajNaAktivny(reg));
        const sub =
            (await reg.pushManager.getSubscription()) ??
            (await doLimitu(reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes() })));
        if (!(await posliOdber(sub, hour, timeZone))) return 'chyba';
        for (const ine of await odbery()) if (ine.app !== app) await zrusOdber(ine.sub).catch(() => null);
        return 'ok';
    } catch {
        return 'chyba';
    }
}

/** Počká, kým registrácia nemá aktívny service worker - až potom sa dá prihlásiť k push. @param {ServiceWorkerRegistration} reg */
function cakajNaAktivny(reg) {
    return new Promise((resolve) => {
        if (reg.active) return resolve(reg.active);
        const sw = /** @type {ServiceWorker} */ (reg.installing ?? reg.waiting);
        sw.addEventListener('statechange', () => sw.state === 'activated' && resolve(sw));
    });
}

/**
 * Vypne ranné oznámenie: zruší odber vo Workeri aj v prehliadači a zmaže, čo mal service worker
 * odložené - v oboch appkách, voľba je spoločná. Aj keď niečo zlyhá alebo trvá priveľa, v appke
 * je vypnuté - Worker neplatný odber zmaže sám.
 */
export async function vypniOznamenia() {
    try {
        for (const { sub } of await doLimitu(odbery())) await zrusOdber(sub);
        if ('caches' in window) await doLimitu(caches.delete(OZNAMENIA.cache));
    } catch {
        // Vypnuté je aj tak; zvyšok dorieši Worker pri prvom budení (410).
    }
}

/**
 * Zmena voľby z Nastavenia (zapnúť, vypnúť, hodina): zapne či vypne odber, keď treba,
 * a voľbu uloží. Keď zapnutie zlyhá, ostane vypnuté a stav povie prečo. Keď zlyhá zmena hodiny,
 * ostane stará hodina - tú má aj Worker - a stav `chyba`, takže sa dá skúsiť znova.
 * @param {import('../shared/oznamenia.js').Oznamenia} o @param {Partial<import('../shared/oznamenia.js').Oznamenia>} zmena
 * @param {{ app: Appka, timeZone: string }} kde
 * @returns {Promise<{ oznamenia: import('../shared/oznamenia.js').Oznamenia, oznamStav: OznamStav }>}
 */
export async function nastavOznamenia(o, zmena, { app, timeZone }) {
    const next = { ...o, ...zmena };
    /** @type {OznamStav} */ let stav = oznamStav();
    if (zmena.on === false) await vypniOznamenia();
    else if (next.on && (zmena.on === true || (zmena.hour !== undefined && zmena.hour !== o.hour))) {
        const res = await zapniOznamenia({ app, hour: next.hour, timeZone });
        stav = res === 'zatvorene' ? 'ok' : res;
        if (res !== 'ok' && zmena.on === true) next.on = false;
        if (res !== 'ok' && zmena.on !== true) next.hour = o.hour;
    }
    saveOznamenia(next);
    return { oznamenia: next, oznamStav: stav };
}

/**
 * Pri štarte appky: keď je oznámenie zapnuté, ale telefón už povolenie alebo odber nemá (človek
 * ho odobral v prehliadači, push služba odber zrušila), prepne ho na vypnuté - prepínač nesmie
 * tvrdiť, že oznámenia chodia, keď nechodia.
 * @param {{ get: () => MirrorSource, setState: (patch: { oznamenia: import('../shared/oznamenia.js').Oznamenia }) => void }} store
 */
export async function initOznamZosulad(store) {
    const o = store.get().oznamenia;
    if (!o.on) return;
    const granted = 'Notification' in window && Notification.permission === 'granted';
    const sub = granted ? await odber().catch(() => null) : null;
    if (sub) return;
    const next = { ...store.get().oznamenia, on: false };
    saveOznamenia(next);
    store.setState({ oznamenia: next });
}

/**
 * Odkladá service workeru nastavenie (Cache API) pri každej zmene stavu, ktorá sa ho týka - len
 * keď je oznámenie zapnuté a appka pozná aspoň polohu. `app`: ktorú appku ťuknutie na oznámenie
 * otvorí, cesta voči koreňu (`./` súčasná, `obloha/` nová). Keď sa pri zapnutom oznámení zmení
 * časové pásmo elektrárne (iná poloha), pošle ho aj Workeru - ráta v ňom ranný čas.
 * @param {{ get: () => MirrorSource, subscribe: (fn: (s: MirrorSource) => void) => unknown }} store
 * @param {Appka} app
 */
export function initOznamZrkadlo(store, app) {
    let posledne = '';
    let pasmo = '';
    /** @param {MirrorSource} s */
    const mirror = (s) => {
        if (!s.oznamenia.on || s.known === 'nic' || !('caches' in window)) {
            // Vypnutie zmaže cache - po novom zapnutí sa musí zapísať znova, aj keď je nastavenie rovnaké.
            posledne = '';
            pasmo = '';
            return;
        }
        const { hour } = s.oznamenia;
        /** @type {import('../shared/oznamenia.js').Zrkadlo} */
        const z = { site: s.site, plant: s.plant, tariff: s.tariff, devices: s.doma, voice: s.voice, app, hour };
        const text = JSON.stringify(z);
        if (text === posledne) return;
        posledne = text;
        caches
            .open(OZNAMENIA.cache)
            .then((c) => c.put(OZNAMENIA.mirror, new Response(text)))
            .catch(() => {
                posledne = '';
            });
        if (pasmo && pasmo !== s.site.timezone)
            odber()
                .then((sub) => sub && posliOdber(sub, hour, s.site.timezone))
                .catch(() => null);
        pasmo = s.site.timezone;
    };
    mirror(store.get());
    store.subscribe(mirror);
}

/**
 * Časť stavu oboch appiek, z ktorej vzniká zrkadlo pre service worker.
 * @typedef {{ site: import('../shared/config.js').Site, plant: import('../shared/config.js').Plant,
 *   tariff: import('../shared/config.js').Tariff, known: import('../shared/settings.js').Known,
 *   oznamenia: import('../shared/oznamenia.js').Oznamenia, doma: string[], voice: import('../shared/messages.js').Voice }} MirrorSource
 */
