// Ranné oznámenie v prehliadači: čo telefón vie, zapnutie a vypnutie odberu Web Push a nastavenie
// pre service worker (sw.js), ktorý nevidí localStorage. Nevie nič o stave ani DOM appky, takže ho
// používajú obe appky (súčasná aj obloha/). Rozhodnutia a texty sú v shared/oznamenia.js.

import { OZNAMENIA, WORKER_OZNAMENIA_URL } from '../shared/config.js';
import { saveOznamenia } from './storage.js';

/**
 * Stav oznámení na tomto telefóne: `ok` sa dajú zapnúť, `plocha` iPhone v Safari (oznámenia má
 * len appka pridaná na plochu), `zakazane` človek ich v prehliadači odmietol, `nepodporuje`
 * prehliadač ich nemá. V appke k nim pribúda `caka` (zapína sa) a `chyba`.
 * @typedef {'ok' | 'plocha' | 'zakazane' | 'nepodporuje' | 'caka' | 'chyba'} OznamStav
 */

/** Adresa service workera v koreni appky (pokryje aj obloha/). @param {string} root koreň appky voči stránke */
const swUrl = (root) => new URL(`${root}sw.js`, location.href).href;

/** Čo telefón s oznámeniami vie, bez pýtania sa na povolenie. @returns {OznamStav} */
export function oznamStav() {
    const nav = /** @type {Navigator & { standalone?: boolean }} */ (navigator);
    const vie = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    // Safari na iPhone má `standalone` a Web Push len v appke pridanej na plochu.
    if (!vie) return nav.standalone === false ? 'plocha' : 'nepodporuje';
    return Notification.permission === 'denied' ? 'zakazane' : 'ok';
}

/** Verejný kľúč VAPID ako bajty pre pushManager.subscribe. */
function vapidKey() {
    const b64 = OZNAMENIA.vapidPublic.replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/**
 * Zapne ranné oznámenie (alebo zmení hodinu): povolenie, service worker, odber a jeho uloženie vo
 * Workeri. Volá sa z ťuknutia - iPhone sa inak na povolenie nespýta. Vráti `ok`, `zakazane`, alebo
 * `chyba`, keď niečo po ceste zlyhá.
 * @param {{ root: string, hour: number, timeZone: string }} o
 * @returns {Promise<OznamStav>}
 */
export async function zapniOznamenia({ root, hour, timeZone }) {
    try {
        if ((await Notification.requestPermission()) !== 'granted') return 'zakazane';
        const url = swUrl(root);
        await navigator.serviceWorker.register(url, { type: 'module', updateViaCache: 'none', scope: new URL('./', url).href });
        const reg = await navigator.serviceWorker.ready;
        const sub =
            (await reg.pushManager.getSubscription()) ??
            (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey() }));
        const res = await fetch(WORKER_OZNAMENIA_URL, {
            method: 'POST',
            body: JSON.stringify({ endpoint: sub.endpoint, on: true, hour, tz: timeZone }),
        });
        return res.ok ? 'ok' : 'chyba';
    } catch {
        return 'chyba';
    }
}

/**
 * Vypne ranné oznámenie: zruší odber vo Workeri aj v prehliadači a zmaže, čo mal service worker
 * odložené. Aj keď niečo zlyhá, v appke je vypnuté - Worker neplatný odber zmaže sám.
 * @param {string} root
 */
export async function vypniOznamenia(root) {
    try {
        const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration(swUrl(root)) : undefined;
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        if (sub) {
            await fetch(WORKER_OZNAMENIA_URL, { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint, on: false }) }).catch(
                () => null,
            );
            await sub.unsubscribe();
        }
        if ('caches' in window) await caches.delete(OZNAMENIA.cache);
    } catch {
        // Vypnuté je aj tak; zvyšok dorieši Worker pri prvom budení (410).
    }
}

/**
 * Zmena voľby z Nastavenia (zapnúť, vypnúť, hodina, spotrebiče): zapne či vypne odber, keď treba,
 * a voľbu uloží. Keď zapnutie zlyhá, ostane vypnuté a stav povie prečo; zlyhaná zmena hodiny
 * nechá oznámenie zapnuté so starou hodinou vo Workeri a stavom `chyba`.
 * @param {import('../shared/oznamenia.js').Oznamenia} o @param {Partial<import('../shared/oznamenia.js').Oznamenia>} zmena
 * @param {{ root: string, timeZone: string }} kde
 * @returns {Promise<{ oznamenia: import('../shared/oznamenia.js').Oznamenia, oznamStav: OznamStav }>}
 */
export async function nastavOznamenia(o, zmena, { root, timeZone }) {
    const next = { ...o, ...zmena };
    /** @type {OznamStav} */ let stav = oznamStav();
    if (zmena.on === false) await vypniOznamenia(root);
    else if (next.on && (zmena.on === true || (zmena.hour !== undefined && zmena.hour !== o.hour))) {
        stav = await zapniOznamenia({ root, hour: next.hour, timeZone });
        if (stav !== 'ok' && zmena.on === true) next.on = false;
    }
    saveOznamenia(next);
    return { oznamenia: next, oznamStav: stav };
}

/**
 * Pridá či uberie spotrebič zo spotrebičov doma.
 * @param {import('../shared/oznamenia.js').Oznamenia} o @param {string} id
 */
export const prepniSpotrebic = (o, id) => ({ devices: o.devices.includes(id) ? o.devices.filter((d) => d !== id) : [...o.devices, id] });

/**
 * Odkladá service workeru nastavenie (Cache API) pri každej zmene stavu, ktorá sa ho týka - len
 * keď je oznámenie zapnuté a appka pozná aspoň polohu. `app`: ktorú appku ťuknutie na oznámenie
 * otvorí, cesta voči koreňu (`./` súčasná, `obloha/` nová).
 * @param {{ get: () => MirrorSource, subscribe: (fn: (s: MirrorSource) => void) => unknown }} store @param {string} app
 */
export function initOznamZrkadlo(store, app) {
    let posledne = '';
    /** @param {MirrorSource} s */
    const mirror = (s) => {
        if (!s.oznamenia.on || s.known === 'nic' || !('caches' in window)) return;
        /** @type {import('../shared/oznamenia.js').Zrkadlo} */
        const z = { site: s.site, plant: s.plant, tariff: s.tariff, devices: s.oznamenia.devices, voice: s.voice ?? 'drzy', app };
        const text = JSON.stringify(z);
        if (text === posledne) return;
        posledne = text;
        caches
            .open(OZNAMENIA.cache)
            .then((c) => c.put(OZNAMENIA.mirror, new Response(text)))
            .catch(() => {
                posledne = '';
            });
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
