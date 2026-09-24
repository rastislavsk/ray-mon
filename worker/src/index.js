// Cloudflare Worker: živé meranie pre appku. POST /pv stiahne kiosk, ktorý si používateľ
// zadal v Nastavení. Pôvodná cesta pre elektráreň v Dvoranoch ostáva: cron každých 5 minút
// stiahne jej kiosk, raz za hodinu prepočíta predpoveď a obe uloží do KV; GET / ich vráti.

import { PLANT, SITE, STALE_FORECAST_MS, STALE_PV_MS, openMeteoUrl } from '../../shared/config.js';
import { fetchWithRetry } from '../../shared/http.js';
import { kioskApiUrl, parseKiosk } from '../../shared/kiosk.js';
import { buildForecast } from '../../shared/solar.js';

const KV_PV = 'pv';
const KV_FORECAST = 'forecast';
// Výsledok posledného behu cronu. Vďaka nemu endpoint sám povie, prečo časť dát chýba,
// namiesto toho, aby ticho vrátil null a nechal hádať medzi výpadkom a zlým nastavením.
const KV_STATUS = 'status';
// Predpoveď sa prepočíta, keď je staršia než 55 minút (cron beží každých 5 min, takže raz za hodinu).
const FORECAST_REFRESH_MS = 55 * 60 * 1000;

const CORS_HEADERS = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=60',
};

/**
 * @typedef {{ PV_DATA: { get(key: string, type: 'json'): Promise<any>, put(key: string, value: string): Promise<void> },
 *   KIOSK_URL: string }} Env
 */

/** Stiahne kiosk a uloží `pv`. Pri chybe nechá v KV predchádzajúcu hodnotu. @param {Env} env @param {Date} now @param {typeof fetch} fetchImpl */
export async function refreshPv(env, now, fetchImpl = fetch) {
    if (!env.KIOSK_URL) throw new Error('KIOSK_URL secret nie je nastavený');
    const res = await fetchWithRetry(env.KIOSK_URL, {}, { fetchImpl });
    const pv = parseKiosk(await res.json(), now);
    await env.PV_DATA.put(KV_PV, JSON.stringify(pv));
    return pv;
}

/** Prepočíta predpoveď, ak je stará alebo chýba. @param {Env} env @param {Date} now @param {typeof fetch} fetchImpl */
export async function refreshForecastIfStale(env, now, fetchImpl = fetch) {
    const existing = await env.PV_DATA.get(KV_FORECAST, 'json');
    if (existing && existing.updatedAt && now.getTime() - Date.parse(existing.updatedAt) < FORECAST_REFRESH_MS) return existing;
    const res = await fetchWithRetry(openMeteoUrl(SITE), {}, { fetchImpl });
    const forecast = buildForecast(await res.json(), now, SITE, PLANT);
    await env.PV_DATA.put(KV_FORECAST, JSON.stringify(forecast));
    return forecast;
}

/** Zhrnutie jednej obnovy pre KV. @param {PromiseSettledResult<unknown>} result @param {Date} now */
function statusEntry(result, now) {
    if (result.status === 'fulfilled') return { ok: true, at: now.toISOString() };
    // Dôvod skracujeme, do KV patrí hlásenie, nie celý zásobník volaní.
    return { ok: false, at: now.toISOString(), error: String(result.reason).slice(0, 300) };
}

/** Jeden beh cronu: obe obnovy nezávisle, chyba jednej nezhodí druhú. @param {Env} env @param {Date} now @param {typeof fetch} fetchImpl */
export async function runScheduled(env, now = new Date(), fetchImpl = fetch) {
    const results = await Promise.allSettled([refreshPv(env, now, fetchImpl), refreshForecastIfStale(env, now, fetchImpl)]);
    results.forEach((r, i) => {
        if (r.status === 'rejected') console.log(i === 0 ? 'pv refresh failed' : 'forecast refresh failed', String(r.reason));
    });
    const status = { pv: statusEntry(results[0], now), forecast: statusEntry(results[1], now) };
    // Zápis stavu je len diagnostika; keby zlyhal, dáta samotné sú už uložené.
    try {
        await env.PV_DATA.put(KV_STATUS, JSON.stringify(status));
    } catch (err) {
        console.log('status write failed', String(err));
    }
    return results;
}

/** Vek údaja v minútach; null, keď údaj alebo jeho značka času chýba. @param {string | undefined} iso @param {Date} now */
function ageMinutes(iso, now) {
    if (!iso) return null;
    const ms = now.getTime() - Date.parse(iso);
    return Number.isFinite(ms) ? Math.round(ms / 60000) : null;
}

/**
 * Krátke zhrnutie zdravia pre `GET /status`: ako dopadol posledný beh cronu a aké
 * čerstvé sú uložené dáta. Určené na to, aby sa dalo skontrolovať jedným pohľadom.
 * @param {{ pv: any, forecast: any, status: any }} stored @param {Date} now
 */
export function buildStatus(stored, now) {
    const { pv, forecast, status } = stored;
    const pvAge = ageMinutes(pv && pv.updatedAt, now);
    const forecastAge = ageMinutes(forecast && forecast.updatedAt, now);
    const pvFresh = pvAge !== null && pvAge * 60000 <= STALE_PV_MS;
    const forecastFresh = forecastAge !== null && forecastAge * 60000 <= STALE_FORECAST_MS;
    const part = (/** @type {boolean} */ fresh, /** @type {any} */ data, /** @type {number | null} */ age, /** @type {any} */ lastRun) => ({
        ok: fresh,
        updatedAt: (data && data.updatedAt) || null,
        ageMinutes: age,
        lastRun: lastRun || null,
    });
    return {
        ok: pvFresh && forecastFresh,
        pv: part(pvFresh, pv, pvAge, status && status.pv),
        forecast: part(forecastFresh, forecast, forecastAge, status && status.forecast),
        servedAt: now.toISOString(),
    };
}

/** Prečíta všetky tri kľúče z KV naraz. @param {Env} env */
async function readStored(env) {
    const [pv, forecast, status] = await Promise.all([
        env.PV_DATA.get(KV_PV, 'json'),
        env.PV_DATA.get(KV_FORECAST, 'json'),
        env.PV_DATA.get(KV_STATUS, 'json'),
    ]);
    return { pv: pv || null, forecast: forecast || null, status: status || null };
}

/** @param {number} status @param {unknown} body @param {Record<string, string>} [extra] */
const json = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, ...extra } });

/**
 * POST /pv: živé meranie z kiosku, ktorého odkaz je v tele požiadavky (text). Worker z neho
 * vezme len server a kľúč kiosku a adresu dát si zloží sám, takže nesťahuje nič iné než
 * kiosk FusionSolar. Odkaz si nikam neukladá.
 * @param {Request} request @param {Date} now @param {typeof fetch} fetchImpl
 */
export async function handlePv(request, now, fetchImpl = fetch) {
    const url = kioskApiUrl((await request.text()).slice(0, 2000));
    if (!url) return json(400, { error: 'odkaz nie je kiosk FusionSolar' });
    try {
        const res = await fetchWithRetry(url, {}, { fetchImpl, attempts: 2, delayMs: 500 });
        return json(200, { pv: parseKiosk(await res.json(), now), servedAt: now.toISOString() }, { 'cache-control': 'no-store' });
    } catch {
        // Bez podrobností: tie by mohli obsahovať odkaz, a ten do odpovedí ani logov nepatrí.
        return json(502, { error: 'kiosk neodpovedá alebo vrátil nečakané dáta' }, { 'cache-control': 'no-store' });
    }
}

/**
 * Odpoveď na GET /, GET /status a POST /pv; chýbajúce dáta sú null.
 * @param {Request} request @param {Env} env @param {Date} now @param {typeof fetch} [fetchImpl]
 */
export async function handleRequest(request, env, now = new Date(), fetchImpl = fetch) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    const path = new URL(request.url).pathname;
    if (path === '/pv' && request.method === 'POST') return handlePv(request, now, fetchImpl);
    if (request.method !== 'GET') return json(405, { error: 'method not allowed' });
    if (path !== '/' && path !== '/status')
        return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: CORS_HEADERS });

    const stored = await readStored(env);
    if (path === '/status') {
        // Zhrnutie sa píše pre človeka v prehliadači, preto s odsadením a bez cache.
        return new Response(JSON.stringify(buildStatus(stored, now), null, 2), {
            status: 200,
            headers: { ...CORS_HEADERS, 'cache-control': 'no-store' },
        });
    }

    const { pv, forecast, status } = stored;
    const body = { pv, forecast, status, servedAt: now.toISOString() };
    const stale = forecast && now.getTime() - Date.parse(forecast.updatedAt) > STALE_FORECAST_MS;
    return new Response(JSON.stringify(body), { status: 200, headers: { ...CORS_HEADERS, 'x-data-stale': stale ? '1' : '0' } });
}

export default {
    /** @param {Request} request @param {Env} env */
    fetch(request, env) {
        return handleRequest(request, env);
    },
    /** @param {unknown} _event @param {Env} env @param {{ waitUntil(p: Promise<unknown>): void }} ctx */
    scheduled(_event, env, ctx) {
        ctx.waitUntil(runScheduled(env));
    },
};
