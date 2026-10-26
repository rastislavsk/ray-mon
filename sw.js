// Service worker len na ranné oznámenie s plánom dňa - súbory appky necachuje, o tie sa stará
// boot.js. Worker telefón zobudí prázdnym pushom (worker/src/oznamenia.js); obsah sa vypočíta
// až tu, z čerstvej predpovede a nastavenia, ktoré appka odložila do Cache API (OZNAMENIA.mirror),
// tou istou funkciou jadra, akou počíta Plán dňa na karte Môžem? (shared/oznamenia.js).
// Registrujú ho obe appky s updateViaCache: 'none', aby prehliadač bral aj jeho importy vždy
// čerstvé. Každý push musí niečo ukázať - pri chybe ukáže, nech sa človek pozrie do appky.
// Mimo tsc: typy prehliadača (DOM) a service workera (WebWorker) sa v jednom projekte nedajú
// zapnúť naraz. Logika je v shared/, tam ju tsc aj testy kontrolujú.

import { OZNAMENIA, openMeteoUrl, WORKER_PRIPOMEN_URL } from './shared/config.js';
import { oznameniaTexts } from './shared/messages-core.js';
import { swNotice } from './shared/oznamenia.js';

const ICON = 'icon-192.png';
const TAG = 'plan-dna';

/** JSON z Cache API pod daným menom, inak `fallback`. */
async function citaj(name, fallback) {
    const res = await (await caches.open(OZNAMENIA.cache)).match(name);
    return res ? res.json() : fallback;
}

async function zapis(name, value) {
    await (await caches.open(OZNAMENIA.cache)).put(name, new Response(JSON.stringify(value)));
}

/** Oznámenie z plánu dňa; keď sa nedá vypočítať, aspoň výzva pozrieť appku. */
async function ukaz() {
    const z = await citaj(OZNAMENIA.mirror, null);
    const T = oznameniaTexts(z?.voice);
    try {
        if (!z) throw new Error('bez nastavenia');
        const weather = await (await fetch(openMeteoUrl(z.site))).json();
        const n = swNotice(z, await citaj(OZNAMENIA.reminders, []), weather, new Date());
        await zapis(OZNAMENIA.reminders, n.keep);
        const actions = n.remind
            ? [
                  { action: 'pripomen', title: n.remind.label },
                  { action: 'otvor', title: T.open },
              ]
            : [];
        return self.registration.showNotification(n.title, {
            body: n.body,
            icon: ICON,
            tag: TAG,
            data: { app: z.app, remind: n.remind },
            actions,
        });
    } catch {
        return self.registration.showNotification(T.fail.title, { body: T.fail.body, icon: ICON, tag: TAG, data: { app: z?.app ?? './' } });
    }
}

/** Ťuknutie: tlačidlo Pripomeň objedná u Workera budenie, inak sa otvorí appka. */
async function klik(action, data) {
    if (action === 'pripomen' && data?.remind) {
        const sub = await self.registration.pushManager.getSubscription();
        if (!sub) return;
        await fetch(WORKER_PRIPOMEN_URL, { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint, at: data.remind.at }) });
        await zapis(OZNAMENIA.reminders, [...(await citaj(OZNAMENIA.reminders, [])), { id: data.remind.id, at: data.remind.at }]);
        return;
    }
    const url = new URL(data?.app ?? './', self.registration.scope).href;
    const okna = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const okno = okna.find((c) => c.url.startsWith(url));
    return okno ? okno.focus() : self.clients.openWindow(url);
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('push', (e) => e.waitUntil(ukaz()));
self.addEventListener('notificationclick', (e) => {
    e.notification.close();
    e.waitUntil(klik(e.action, e.notification.data));
});
