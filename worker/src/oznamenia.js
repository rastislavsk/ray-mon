// Ranné oznámenie: Worker si pamätá len adresu odberu telefónu, hodinu a časové pásmo (KV
// ODBERY, všetko v metadátach kľúča - budenie tak zoznam prečíta jedinou operáciou). Polohu,
// panely, tarifu ani prístup k meraniu nepozná; plán si telefón počíta sám, keď ho Worker
// zobudí. Budenie beží každých OZNAMENIA.stepMin minút (cron vo wrangler.toml).
//
// POST /oznamenia: `{ endpoint, on, hour, tz }` - zapne alebo zmení odber, `on: false` ho zruší.
// POST /pripomen: `{ endpoint, at }` - jednorazové budenie o `at` (ISO čas), najviac
// OZNAMENIA.remindMaxH hodín dopredu. Kľúč pripomienky po čase sám vyprší.

import { OZNAMENIA } from '../../shared/config.js';
import { morningDue } from '../../shared/oznamenia.js';
import { platnyOdber, posliPush, vapidKlic } from './webpush.js';

/**
 * KV, ako ho Worker používa: kľúč, prázdna hodnota a metadáta.
 * @typedef {{ put: (key: string, value: string, opts?: { metadata?: unknown, expiration?: number }) => Promise<void>,
 *   delete: (key: string) => Promise<void>,
 *   list: (opts: { prefix: string, cursor?: string }) => Promise<{ keys: Array<{ name: string, metadata?: any }>, list_complete: boolean, cursor?: string }> }} Kv
 */
/** @typedef {{ ODBERY?: Kv, VAPID_JWK?: string }} OznamEnv */

/** Kľúč odberu: odtlačok adresy (adresa sama je v metadátach). @param {string} endpoint */
async function odtlacok(endpoint) {
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint)));
    return [...hash.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Platné časové pásmo IANA. @param {unknown} tz */
function platnePasmo(tz) {
    if (typeof tz !== 'string' || tz.length > 64) return false;
    try {
        new Intl.DateTimeFormat('en', { timeZone: tz });
        return true;
    } catch {
        return false;
    }
}

/** JSON z tela, inak null. @param {string | null} body */
function parse(body) {
    try {
        const v = JSON.parse(body ?? '');
        return v && typeof v === 'object' ? v : null;
    } catch {
        return null;
    }
}

/**
 * POST /oznamenia. Vráti stav odpovede: 200 uložené či zrušené, 400 zlé údaje, 503 Worker nemá
 * úložisko alebo kľúč VAPID.
 * @param {string | null} body @param {OznamEnv} env
 */
export async function ulozOdber(body, env) {
    if (!env.ODBERY || !env.VAPID_JWK) return 503;
    const req = parse(body);
    if (!req || !platnyOdber(req.endpoint)) return 400;
    const key = `o:${await odtlacok(req.endpoint)}`;
    if (req.on === false) {
        await env.ODBERY.delete(key);
        return 200;
    }
    if (!OZNAMENIA.hours.includes(req.hour) || !platnePasmo(req.tz)) return 400;
    await env.ODBERY.put(key, '', { metadata: { e: req.endpoint, h: req.hour, tz: req.tz } });
    return 200;
}

/**
 * POST /pripomen: jednorazové budenie o `at`. Kľúč vyprší hodinu po ňom, aj keby ho budenie
 * nezmazalo.
 * @param {string | null} body @param {OznamEnv} env @param {Date} now
 */
export async function ulozPripomienku(body, env, now) {
    if (!env.ODBERY || !env.VAPID_JWK) return 503;
    const req = parse(body);
    const at = req && typeof req.at === 'string' ? new Date(req.at) : null;
    if (!req || !platnyOdber(req.endpoint) || !at || Number.isNaN(at.getTime())) return 400;
    const ahead = at.getTime() - now.getTime();
    if (ahead < 0 || ahead > OZNAMENIA.remindMaxH * 3600 * 1000) return 400;
    const key = `p:${await odtlacok(req.endpoint)}:${at.toISOString()}`;
    await env.ODBERY.put(key, '', {
        metadata: { e: req.endpoint, at: at.toISOString() },
        expiration: Math.floor(at.getTime() / 1000) + 3600,
    });
    return 200;
}

/** Všetky kľúče s predponou, aj cez viac strán zoznamu. @param {Kv} kv @param {string} prefix */
async function vsetky(kv, prefix) {
    /** @type {Array<{ name: string, metadata?: any }>} */ const out = [];
    /** @type {string | undefined} */ let cursor;
    do {
        const page = await kv.list({ prefix, cursor });
        out.push(...page.keys);
        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return out;
}

/**
 * Budenie: ranné oznámenia, ktorých hodina práve nastala, a pripomienky, ktorých čas prišiel.
 * Odber, ktorý push služba už nepozná (404, 410), zmaže. Vráti, koľko pushov odišlo.
 * @param {OznamEnv} env @param {Date} now @param {typeof fetch} fetchImpl
 */
export async function budenie(env, now, fetchImpl) {
    const kv = env.ODBERY;
    if (!kv || !env.VAPID_JWK) return 0;
    // Kľúč sa importuje raz za beh, nie pri každom pushi - plánovaný beh má na bezplatnom pláne málo CPU.
    const klic = await vapidKlic(env.VAPID_JWK);
    if (!klic.match) console.log('budenie: VAPID_JWK nepatrí k OZNAMENIA.vapidPublic, push služby odmietnu podpis');
    let sent = 0;
    let failed = 0;
    /** @param {string} key @param {string} endpoint @param {boolean} once */
    const zobud = async (key, endpoint, once) => {
        const status = await posliPush(endpoint, klic, now, fetchImpl).catch(() => 0);
        if (status >= 200 && status < 300) sent++;
        else failed++;
        if (once || status === 404 || status === 410) await kv.delete(key);
    };
    for (const k of await vsetky(kv, 'o:')) {
        const m = k.metadata;
        if (m && platnePasmo(m.tz) && morningDue(now, m.tz, m.h)) await zobud(k.name, m.e, false);
    }
    // Pripomienka patrí behu, v ktorom jej čas nastal (cron môže prísť o pár sekúnd neskôr).
    for (const k of await vsetky(kv, 'p:')) {
        const m = k.metadata;
        if (m && new Date(m.at).getTime() <= now.getTime() + 60 * 1000) await zobud(k.name, m.e, true);
    }
    console.log(`budenie: ${sent} push${failed ? `, ${failed} zlyhalo` : ''}`);
    return sent;
}
