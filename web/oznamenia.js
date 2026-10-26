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

/** Adresa service workera v koreni appky (pokryje aj obloha/). @param {string} root koreň appky voči stránke */
const swUrl = (root) => new URL(`${root}sw.js`, location.href).href;

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

/** Odber tohto telefónu, ak je. @param {string} root */
async function odber(root) {
    if (!('serviceWorker' in navigator)) return null;
    const reg = await navigator.serviceWorker.getRegistration(swUrl(root));
    return reg ? reg.pushManager.getSubscription() : null;
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
 * na povolenie len zavrel - nič sa nestalo, môže to skúsiť znova.
 * @param {{ root: string, hour: number, timeZone: string }} o
 * @returns {Promise<'ok' | 'zakazane' | 'zatvorene' | 'chyba'>}
 */
export async function zapniOznamenia({ root, hour, timeZone }) {
    try {
        const perm = await Notification.requestPermission();
        if (perm === 'denied') return 'zakazane';
        if (perm !== 'granted') return 'zatvorene';
        const url = swUrl(root);
        await navigator.serviceWorker.register(url, { type: 'module', updateViaCache: 'none', scope: new URL('./', url).href });
        const reg = await doLimitu(navigator.serviceWorker.ready);
        const sub =
            (await reg.pushManager.getSubscription()) ??
            (await doLimitu(reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes() })));
        return (await posliOdber(sub, hour, timeZone)) ? 'ok' : 'chyba';
    } catch {
        return 'chyba';
    }
}

/**
 * Vypne ranné oznámenie: zruší odber vo Workeri aj v prehliadači a zmaže, čo mal service worker
 * odložené. Aj keď niečo zlyhá alebo trvá priveľa, v appke je vypnuté - Worker neplatný odber zmaže sám.
 * @param {string} root
 */
export async function vypniOznamenia(root) {
    try {
        const sub = await doLimitu(odber(root));
        if (sub) {
            const body = JSON.stringify({ endpoint: sub.endpoint, on: false });
            await doLimitu(fetch(WORKER_OZNAMENIA_URL, { method: 'POST', body })).catch(() => null);
            await doLimitu(sub.unsubscribe());
        }
        if ('caches' in window) await doLimitu(caches.delete(OZNAMENIA.cache));
    } catch {
        // Vypnuté je aj tak; zvyšok dorieši Worker pri prvom budení (410).
    }
}

/**
 * Zmena voľby z Nastavenia (zapnúť, vypnúť, hodina, spotrebiče): zapne či vypne odber, keď treba,
 * a voľbu uloží. Keď zapnutie zlyhá, ostane vypnuté a stav povie prečo. Keď zlyhá zmena hodiny,
 * ostane stará hodina - tú má aj Worker - a stav `chyba`, takže sa dá skúsiť znova.
 * @param {import('../shared/oznamenia.js').Oznamenia} o @param {Partial<import('../shared/oznamenia.js').Oznamenia>} zmena
 * @param {{ root: string, timeZone: string }} kde
 * @returns {Promise<{ oznamenia: import('../shared/oznamenia.js').Oznamenia, oznamStav: OznamStav }>}
 */
export async function nastavOznamenia(o, zmena, { root, timeZone }) {
    const next = { ...o, ...zmena };
    /** @type {OznamStav} */ let stav = oznamStav();
    if (zmena.on === false) await vypniOznamenia(root);
    else if (next.on && (zmena.on === true || (zmena.hour !== undefined && zmena.hour !== o.hour))) {
        const res = await zapniOznamenia({ root, hour: next.hour, timeZone });
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
 * @param {string} root
 */
export async function initOznamZosulad(store, root) {
    const o = store.get().oznamenia;
    if (!o.on) return;
    const granted = 'Notification' in window && Notification.permission === 'granted';
    const sub = granted ? await odber(root).catch(() => null) : null;
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
 * @param {string} app @param {string} root
 */
export function initOznamZrkadlo(store, app, root) {
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
        const { hour, devices } = s.oznamenia;
        /** @type {import('../shared/oznamenia.js').Zrkadlo} */
        const z = { site: s.site, plant: s.plant, tariff: s.tariff, devices, voice: s.voice ?? 'drzy', app, hour };
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
            odber(root)
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
 *   oznamenia: import('../shared/oznamenia.js').Oznamenia, voice?: import('../shared/messages.js').Voice }} MirrorSource
 */
