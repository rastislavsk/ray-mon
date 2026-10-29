// Service worker len na ranné oznámenie s plánom dňa - súbory appky necachuje, o tie sa stará
// boot.js. Worker telefón zobudí prázdnym pushom (worker/src/oznamenia.js); obsah sa vypočíta
// až tu, z čerstvej predpovede a nastavenia, ktoré appka odložila do Cache API (OZNAMENIA.mirror),
// tou istou funkciou jadra, akou počíta Plán dňa na karte Môžem? (shared/oznamenia.js).
// Súčasná appka ho registruje priamo, Živá obloha cez obloha/sw.js s vlastným rozsahom (kvôli
// logu jej nainštalovanej appky v oznámení). Obe s updateViaCache: 'none', aby prehliadač bral
// aj jeho importy vždy čerstvé. Každý push musí niečo ukázať - pri akejkoľvek chybe ukáže, nech sa človek pozrie do appky.
// Mimo tsc: typy prehliadača (DOM) a service workera (WebWorker) sa v jednom projekte nedajú
// zapnúť naraz. Logika je v shared/, tam ju tsc aj testy kontrolujú.

import { OZNAMENIA, openMeteoUrl, WORKER_OZNAMENIA_URL, WORKER_PRIPOMEN_URL } from './shared/config.js';
import { oznameniaTexts } from './shared/messages-core.js';
import { swNotice, vapidKeyBytes } from './shared/oznamenia.js';

// Koreň appky. Tento súbor importuje aj obloha/sw.js, takže adresy sa nesmú počítať voči
// rozsahu ani adrese service workera, ale voči tomuto súboru.
const ROOT = new URL('./', import.meta.url).href;
// Logo v oznámení: každá appka ho má v koreni svojho rozsahu (icon-192.png, obloha/icon-192.png),
// takže sa ráta od rozsahu - Obloha tak ukáže svoje, nie logo súčasnej appky.
const ICON = new URL('icon-192.png', self.registration.scope).href;
// Malá ikona v lište (a na čistom Androide aj vľavo v oznámení). Android z nej berie len tvar
// (priehľadnosť), farbu dá sám; bez nej tam ukáže logo Chrome. Zdroj je badge.svg.
const BADGE = new URL('badge-96.png', ROOT).href;
// Ranný plán a pripomienka majú vlastné značky, aby pripomienka plán v lište neprepísala.
// `renotify`: aj oznámenie, ktoré nahradí staré s tou istou značkou, zazvoní.
const TAG = { plan: 'plan-dna', remind: 'pripomienka' };

/** JSON z Cache API pod daným menom, inak `fallback`. */
async function citaj(name, fallback) {
    const res = await (await caches.open(OZNAMENIA.cache)).match(name);
    return res ? res.json() : fallback;
}

async function zapis(name, value) {
    await (await caches.open(OZNAMENIA.cache)).put(name, new Response(JSON.stringify(value)));
}

/** Požiadavka s časovým limitom - visiace spojenie nesmie zadržať oznámenie. */
const ziskaj = (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(OZNAMENIA.timeoutMs) });

/** @param {string} tag @param {{ title: string, body: string }} n @param {object} [extra] */
const ukazOznamenie = (tag, n, extra = {}) =>
    self.registration.showNotification(n.title, { body: n.body, icon: ICON, badge: BADGE, tag, renotify: true, ...extra });

/** Oznámenie z plánu dňa; keď sa nedá vypočítať, aspoň výzva pozrieť appku. */
async function ukaz() {
    /** Nastavenie (zrkadlo), ak sa ho podarilo prečítať - kvôli tónu a appke aj v chybovom oznámení. */
    let z = null;
    try {
        z = await citaj(OZNAMENIA.mirror, null);
        if (!z) throw new Error('bez nastavenia');
        const weather = await (await ziskaj(openMeteoUrl(z.site))).json();
        const n = swNotice(z, await citaj(OZNAMENIA.reminders, []), weather, new Date());
        await zapis(OZNAMENIA.reminders, n.keep);
        const actions = n.remind
            ? [
                  { action: 'pripomen', title: n.remind.label },
                  { action: 'otvor', title: oznameniaTexts(z.voice).open },
              ]
            : [];
        return ukazOznamenie(n.reminder ? TAG.remind : TAG.plan, n, { data: { app: z.app, remind: n.remind, voice: z.voice }, actions });
    } catch {
        return ukazOznamenie(TAG.plan, oznameniaTexts(z?.voice).fail, { data: { app: z?.app ?? './' } });
    }
}

/** Tlačidlo Pripomeň: objedná u Workera budenie. Keď ho Worker neprijme, povie to. */
async function pripomen(data) {
    try {
        const sub = await self.registration.pushManager.getSubscription();
        const res =
            sub &&
            (await ziskaj(WORKER_PRIPOMEN_URL, { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint, at: data.remind.at }) }));
        if (!res || !res.ok) throw new Error('neprijaté');
        await zapis(OZNAMENIA.reminders, [...(await citaj(OZNAMENIA.reminders, [])), { id: data.remind.id, at: data.remind.at }]);
    } catch {
        await ukazOznamenie(TAG.remind, oznameniaTexts(data.voice).remindFail, { data: { app: data.app } });
    }
}

/** Ťuknutie: tlačidlo Pripomeň, inak otvorí appku (okno práve tej appky, nie druhej). */
async function klik(action, data) {
    if (action === 'pripomen' && data?.remind) return pripomen(data);
    const url = new URL(data?.app ?? './', ROOT);
    const appka = (/** @type {string} */ u) => new URL(u).pathname.replace(/index\.html$/, '') === url.pathname;
    const okna = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const okno = okna.find((c) => appka(c.url));
    return okno ? okno.focus() : self.clients.openWindow(url.href);
}

/**
 * Push služba odber obnovila alebo zrušila: prihlási sa znova a nový odber pošle Workeru
 * s hodinou a pásmom zo zrkadla - inak by ranné oznámenia potichu prestali chodiť.
 */
async function obnovOdber(e) {
    const z = await citaj(OZNAMENIA.mirror, null);
    if (!z) return;
    const sub =
        e.newSubscription ??
        (await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes() }));
    await ziskaj(WORKER_OZNAMENIA_URL, {
        method: 'POST',
        body: JSON.stringify({ endpoint: sub.endpoint, on: true, hour: z.hour, tz: z.site.timezone }),
    });
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('push', (e) => e.waitUntil(ukaz()));
self.addEventListener('pushsubscriptionchange', (e) => e.waitUntil(obnovOdber(e).catch(() => null)));
self.addEventListener('notificationclick', (e) => {
    e.notification.close();
    e.waitUntil(klik(e.action, e.notification.data));
});
