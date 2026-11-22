// Service worker len na oznámenia - súbory appky necachuje, o tie sa stará boot.js. Koniec programu a zmenu
// ohrevu bojlera pošle Worker s textom (zašifrovaným, docs/navrhy/spotrebic-koniec-opakovanie.html). Ranné
// oznámenie s plánom dňa: Worker telefón zobudí prázdnym pushom (worker/src/oznamenia.js); obsah sa vypočíta
// až tu, z čerstvej predpovede a nastavenia, ktoré appka odložila do Cache API (OZNAMENIA.mirror),
// tou istou funkciou jadra, akou počíta Plán dňa na karte Môžem? (shared/oznamenia.js).
// Appka ho registruje s updateViaCache: 'none', aby prehliadač bral
// aj jeho importy vždy čerstvé. Každý push musí niečo ukázať - pri akejkoľvek chybe ukáže, nech sa človek pozrie do appky.
// Mimo tsc: typy prehliadača (DOM) a service workera (WebWorker) sa v jednom projekte nedajú
// zapnúť naraz. Logika je v shared/, tam ju tsc aj testy kontrolujú.

import { OZNAMENIA, openMeteoUrl, WORKER_OZNAMENIA_URL, WORKER_PRIPOMEN_URL } from './shared/config.js';
import { oznameniaTexts } from './shared/messages-core.js';
import { cielPushu, klikUrl, klikZnacka, swNotice, vapidKeyBytes } from './shared/oznamenia.js';

// Koreň appky. Tento súbor importuje aj obloha/sw.js (odbery z čias, keď appka bývala v obloha/), takže adresy sa nesmú počítať voči
// rozsahu ani adrese service workera, ale voči tomuto súboru.
const ROOT = new URL('./', import.meta.url).href;
// Veľké logo (`icon`) oznámenie zámerne nemá: Samsung ho kreslí vpravo popri ikone appky vľavo, dve rovnaké ikony vedľa seba.
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
    self.registration.showNotification(n.title, { body: n.body, badge: BADGE, tag, renotify: true, ...extra });

/** Oznámenie z plánu dňa; keď sa nedá vypočítať, aspoň výzva pozrieť appku. */
async function ukaz() {
    /** Nastavenie (zrkadlo), ak sa ho podarilo prečítať - kvôli tónu a appke aj v chybovom oznámení. */
    let z = null;
    try {
        z = await citaj(OZNAMENIA.mirror, null);
        if (!z) throw new Error('bez nastavenia');
        const weather = await (await ziskaj(openMeteoUrl(z.site))).json();
        const n = swNotice(z, await citaj(OZNAMENIA.reminders, []), weather, new Date(), await citaj(OZNAMENIA.vyhlad, null));
        await zapis(OZNAMENIA.reminders, n.keep);
        await zapis(OZNAMENIA.vyhlad, n.vyhlad);
        const actions = n.remind
            ? [
                  { action: 'pripomen', title: n.remind.label },
                  { action: 'otvor', title: oznameniaTexts(z.voice).open },
              ]
            : [];
        // `ciel`: na čo appka po ťuknutí upozorní (docs/navrhy/oznamenia-animacie.html) - pripomienka na svoj spotrebič.
        const ciel = n.vec ? { udalost: 'pripomen', vec: n.vec } : { udalost: 'plan' };
        return ukazOznamenie(n.reminder ? TAG.remind : TAG.plan, n, {
            data: { app: z.app, remind: n.remind, voice: z.voice, ciel },
            actions,
        });
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

/**
 * Ťuknutie: tlačidlo Pripomeň, inak otvorí appku (okno práve tej appky, nie druhej) na karte Teraz
 * s rozbaleným Plánom dňa. Zatvorená appka to vie z adresy, bežiaca zo správy - samotný focus by
 * ju nechal na poslednej karte. Správa ide aj do okna, ktoré tento service worker neovláda. Obe nesú
 * značku cieľa (`data.ciel`; oznámenie spred cieľov ho nemá - to je plán).
 */
async function klik(action, data) {
    if (action === 'pripomen' && data?.remind) return pripomen(data);
    const url = new URL(data?.app ?? './', ROOT);
    const appka = (/** @type {string} */ u) => new URL(u).pathname.replace(/index\.html$/, '') === url.pathname;
    const okna = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const okno = okna.find((c) => appka(c.url));
    const ciel = data?.ciel ?? { udalost: 'plan' };
    if (!okno) return self.clients.openWindow(klikUrl(url.href, ciel));
    okno.postMessage(klikZnacka(ciel));
    return okno.focus();
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
/**
 * Push s obsahom (docs/navrhy/spotrebic-koniec-opakovanie.html): koniec programu či zmena ohrevu bojlera - text poslal
 * Worker zašifrovaný, netreba nič počítať. Prázdny push je ranné oznámenie či pripomienka (ukaz). Ťuknutie otvorí appku.
 * @param {{ title: string, body: string, tag: string }} d
 */
const ukazText = (d) => ukazOznamenie(d.tag, d, { data: { app: './', ciel: cielPushu(d.tag) } });

/** Obsah pushu ako JSON s nadpisom, textom a značkou, inak null. */
function obsah(data) {
    try {
        const d = data?.json();
        return d && typeof d.title === 'string' && typeof d.body === 'string' && typeof d.tag === 'string' ? d : null;
    } catch {
        return null;
    }
}

/**
 * Zmena ohrevu bojlera: okrem oznámenia aj správa každému oknu appky (aj tomu, ktoré tento service worker neovláda) -
 * otvorená appka si hneď stiahne stav a dlaždica Bojler sa prekreslí spolu s oznámením (web/refresh.js).
 */
async function povedzOknam() {
    const okna = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const okno of okna) okno.postMessage(OZNAMENIA.bojler);
}

self.addEventListener('push', (e) => {
    const d = obsah(e.data);
    e.waitUntil(d ? Promise.all([ukazText(d), d.tag === OZNAMENIA.bojler ? povedzOknam() : null]) : ukaz());
});
self.addEventListener('pushsubscriptionchange', (e) => e.waitUntil(obnovOdber(e).catch(() => null)));
self.addEventListener('notificationclick', (e) => {
    e.notification.close();
    e.waitUntil(klik(e.action, e.notification.data));
});
