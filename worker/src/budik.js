// Oznámenie o konci programu (docs/navrhy/spotrebic-koniec-opakovanie.html): POST /koniec od appky po „Už beží“, zmene
// zvyšku či „Nebeží“. Durable Object `Budik` (jeden na odber telefónu) si drží konce behov po spotrebičoch a alarmom
// pošle v čase konca push s textom - presne, nie až pri štvrťhodinovom budení. Text skladá appka v chvíli zápisu; Worker
// ho len zašifruje pre telefón. Zápisy, plán ani polohu Worker nevidí. Bez času (`at: null`) budík spotrebiča zruší.

import { BEZI, PUSH_TEXT } from '../../shared/config.js';
import { klucOdberu, platnyOdber, posliPush, vapidKlic } from './webpush.js';

/**
 * Budík jedného spotrebiča: kedy (ms), kam a čo povedať.
 * @typedef {{ at: number, endpoint: string, keys: { p256dh: string, auth: string }, title: string, body: string }} Zvonenie
 */
/** Úložisko Durable Object, ako ho Budik používa. @typedef {{ get: (k: string) => Promise<any>, put: (k: string, v: unknown) => Promise<void>, delete: (k: string) => Promise<unknown>, list: (o: { prefix: string }) => Promise<Map<string, any>>, setAlarm: (t: number) => Promise<void>, deleteAlarm: () => Promise<void> }} Uloziste */

/** Krátky text bez riadiacich znakov, inak null. @param {unknown} s */
const text = (s) => (typeof s === 'string' && s.length > 0 && s.length <= PUSH_TEXT.maxText && !/[\x00-\x1f]/.test(s) ? s : null);

/**
 * POST /koniec: `{ endpoint, keys, id, at, title, body }`. Vráti stav odpovede: 200 uložené či zrušené, 400 zlé údaje,
 * 503 Worker nemá objekt budíkov alebo kľúč VAPID.
 * @param {string | null} raw telo požiadavky @param {{ BUDIK?: any, VAPID_JWK?: string }} env @param {Date} now
 */
export async function ulozKoniec(raw, env, now) {
    if (!env.BUDIK || !env.VAPID_JWK) return 503;
    const req = dopyt(raw);
    const keys = klucOdberu(req?.keys);
    if (!req || !keys) return 400;
    const z = req.at === null ? null : zvonenie(req, keys, now);
    if (z === undefined) return 400;
    const stub = env.BUDIK.get(env.BUDIK.idFromName(req.endpoint));
    const res = await stub.fetch('https://budik/', { method: 'POST', body: JSON.stringify({ id: req.id, z }) });
    return res.ok ? 200 : 503;
}

/**
 * Telo POST /koniec s adresou odberu známej push služby a spotrebičom, ktorý sa dá zapísať, inak null.
 * @param {string | null} raw @returns {any}
 */
function dopyt(raw) {
    try {
        const req = JSON.parse(raw ?? '');
        return req && platnyOdber(req.endpoint) && typeof req.id === 'string' && BEZI.veci.includes(req.id) ? req : null;
    } catch {
        return null;
    }
}

/**
 * Budík z požiadavky: čas konca najviac PUSH_TEXT.maxDopreduH hodín dopredu (a nie viac než minútu dozadu), nadpis aj
 * text. Keď niečo nesedí, undefined.
 * @param {any} req @param {Zvonenie['keys']} keys @param {Date} now @returns {Zvonenie | undefined}
 */
function zvonenie(req, keys, now) {
    const at = typeof req.at === 'string' ? Date.parse(req.at) : NaN;
    const title = text(req.title);
    const body = text(req.body);
    const ahead = at - now.getTime();
    if (!Number.isFinite(at) || ahead < -60000 || ahead > PUSH_TEXT.maxDopreduH * 3600000 || !title || !body) return undefined;
    return { at, endpoint: req.endpoint, keys, title, body };
}

export class Budik {
    /** @param {{ storage: Uloziste }} state @param {{ VAPID_JWK?: string }} env @param {typeof fetch} [fetchImpl] @param {() => Date} [hodiny] */
    constructor(state, env, fetchImpl, hodiny) {
        this.storage = state.storage;
        this.env = env;
        /** @type {typeof fetch} */
        this.fetchImpl = fetchImpl ?? ((u, i) => fetch(u, i));
        this.hodiny = hodiny ?? (() => new Date());
    }

    /** Uloží či zruší budík spotrebiča a nastaví alarm na najbližší. @param {Request} request */
    async fetch(request) {
        const { id, z } = /** @type {{ id: string, z: Zvonenie | null }} */ (await request.json());
        if (z) await this.storage.put(`k:${id}`, z);
        else await this.storage.delete(`k:${id}`);
        await this.nastav();
        return new Response('ok');
    }

    /** Alarm: pošle, čomu nastal čas (aj o chvíľu skôr - alarm nemusí prísť na milisekundu), a nastaví ďalší. */
    async alarm() {
        const now = this.hodiny();
        const klic = this.env.VAPID_JWK ? await vapidKlic(this.env.VAPID_JWK) : null;
        for (const [k, z] of await this.storage.list({ prefix: 'k:' })) {
            const zv = /** @type {Zvonenie} */ (z);
            if (zv.at > now.getTime() + 30000) continue;
            await this.storage.delete(k);
            if (!klic) continue;
            const data = { title: zv.title, body: zv.body, tag: `koniec-${k.slice(2)}` };
            const status = await posliPush(zv.endpoint, klic, now, this.fetchImpl, { data, keys: zv.keys }).catch(() => 0);
            console.log(`koniec: push ${status}`);
        }
        await this.nastav();
    }

    /** Alarm na najbližší budík, bez budíkov žiadny. */
    async nastav() {
        const casy = [...(await this.storage.list({ prefix: 'k:' })).values()].map((z) => /** @type {Zvonenie} */ (z).at);
        if (casy.length) await this.storage.setAlarm(Math.min(...casy));
        else await this.storage.deleteAlarm();
    }
}
