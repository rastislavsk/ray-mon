// Načítanie dát. Predpoveď sa počíta tu v prehliadači z počasia Open-Meteo pre lokalitu
// z nastavenia. Živé meranie stiahne Worker od výrobcu meniča, ktorý si používateľ pripojil;
// bez pripojeného merania meranie nie je. Neplatné dáta sa správajú ako chýbajúce.

import {
    geocodeUrl,
    openMeteoUrl,
    TIMEOUT,
    WEATHER_CACHE_MS,
    WEATHER_KEEP_MS,
    WORKER_PRIPOJ_URL,
    WORKER_PV_URL,
} from '../shared/config.js';
import { validateForecast, validatePv } from '../shared/schema.js';
import { parseGeocode } from '../shared/settings.js';
import { buildForecast } from '../shared/solar.js';
import { isPecat } from '../shared/zdroje.js';
import { loadStoredWeather, saveStoredWeather } from './storage.js';

/** @typedef {import('../shared/settings.js').Settings} Settings */
/**
 * `pvFailed` odlišuje "meranie sa nepodarilo" od "meranie nie je" (bez pripojeného merania) - pri
 * prvom si appka na chvíľu nechá posledné meranie, pri druhom nemá čo nechávať. `pecat` je nový
 * zapečatený prístup, keď ho Worker pri meraní vydal (obnovený token, alebo zapečatený holý odkaz
 * na kiosk z nastavení spred zapečatenia) - appka si ho uloží namiesto starého.
 * @typedef {{ pv: import('../shared/kiosk.js').PvData | null, pvFailed: boolean, pecat: string | null,
 *   forecast: import('../shared/solar.js').Forecast | null }} DataResult
 */

/** @param {string} url @param {typeof fetch} fetchImpl */
async function getJson(url, fetchImpl) {
    const res = await fetchImpl(url, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT.appMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return res.json();
}

/** @param {unknown} pv */
const validPv = (pv) => (pv && validatePv(pv).length === 0 ? /** @type {import('../shared/kiosk.js').PvData} */ (pv) : null);

/**
 * POST na Workera s textom v tele - taká požiadavka nepotrebuje predbežnú CORS kontrolu a prístup
 * sa nedostane do adresy, ktorá končí v logoch.
 * @param {string} url @param {string} body @param {typeof fetch} fetchImpl
 */
function postWorker(url, body, fetchImpl) {
    return fetchImpl(url, { method: 'POST', body, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT.appMs) });
}

/**
 * Živé meranie z pripojeného meniča. Telo je zapečatený prístup (alebo holý odkaz na kiosk).
 * @param {import('../shared/zdroje.js').Zdroj} zdroj @param {typeof fetch} fetchImpl
 */
async function loadPv(zdroj, fetchImpl) {
    const res = await postWorker(WORKER_PV_URL, zdroj.pecat, fetchImpl);
    if (!res.ok) throw new Error(`HTTP ${res.status} meranie`);
    const body = await res.json();
    const pv = validPv(body.pv);
    if (!pv) throw new Error('Meranie neprišlo v platnom tvare');
    return { pv, pecat: typeof body.pecat === 'string' && isPecat(body.pecat) ? body.pecat : null };
}

/**
 * Pripojenie merania zo sprievodcu: údaje z formulára ide overiť Worker. Nikdy nehádže - vráti
 * nájdené elektrárne, alebo druh chyby, ktorý sprievodca ukáže.
 * @param {string} sposob id spôsobu (shared/zdroje.js) @param {Record<string, string>} udaje @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ stanice: import('../shared/setup-flow.js').Stanica[] } | { chyba: 'udaje' | 'vyrobca' | 'server', kod?: string }>}
 */
export async function pripojZdroj(sposob, udaje, fetchImpl = fetch) {
    try {
        const res = await postWorker(WORKER_PRIPOJ_URL, JSON.stringify({ sposob, udaje }), fetchImpl);
        const body = await res.json().catch(() => ({}));
        // Krok a kód chyby od výrobcu (napr. `prihlasenie:20400`); len krátky text bez tajomstiev.
        const kod = typeof body.kod === 'string' && /^[a-z]+(:[A-Za-z0-9 ]{1,20})?$/.test(body.kod) ? body.kod : '';
        if (res.status === 400) return { chyba: 'udaje', kod };
        if (!res.ok) return { chyba: res.status === 502 ? 'vyrobca' : 'server', kod };
        const stanice = Array.isArray(body.stanice) ? body.stanice : [];
        return {
            stanice: stanice
                .filter((/** @type {any} */ x) => x && typeof x.pecat === 'string' && isPecat(x.pecat))
                .map((/** @type {any} */ x) => ({
                    nazov: typeof x.nazov === 'string' ? x.nazov.slice(0, 80) : '',
                    pecat: x.pecat,
                    pv: validPv(x.pv),
                })),
        };
    } catch {
        return { chyba: 'server' };
    }
}

// Posledné stiahnuté počasie. Predpoveď sa z neho prepočítava pri každej obnove (mení sa „teraz“),
// nové sa sťahuje až po WEATHER_CACHE_MS alebo pre inú lokalitu. Pri výpadku ostáva staré. Odkladá
// sa aj v prehliadači, takže appka po otvorení nezačína od nuly; staršie než WEATHER_KEEP_MS sa
// nepoužije vôbec - ani pri výpadku by sa už nemalo tváriť ako predpoveď.
/** @type {import('../shared/schema.js').StoredWeather | null | undefined} undefined = z prehliadača ešte nečítané */
let weather;

/**
 * Počasie z tejto adresy, ak nie je staršie než WEATHER_KEEP_MS. Prvý raz ho vezme z prehliadača.
 * Záporný vek znamená, že sa hodiny telefónu posunuli dozadu - také sa nepoužije.
 * @param {string} url @param {Date} now
 */
function keptWeather(url, now) {
    if (weather === undefined) weather = loadStoredWeather();
    if (!weather || weather.url !== url) return null;
    const age = now.getTime() - weather.at;
    return age >= 0 && age < WEATHER_KEEP_MS ? weather : null;
}

/** @param {import('../shared/config.js').Site} site @param {Date} now @param {typeof fetch} fetchImpl */
async function loadWeather(site, now, fetchImpl) {
    const url = openMeteoUrl(site);
    const kept = keptWeather(url, now);
    if (kept && now.getTime() - kept.at < WEATHER_CACHE_MS) return kept.json;
    try {
        const json = await getJson(url, fetchImpl);
        weather = { url, at: now.getTime(), json };
        saveStoredWeather(weather);
        return json;
    } catch (err) {
        if (kept) return kept.json;
        throw err;
    }
}

/** Predpoveď z počasia; čokoľvek nečakané v dátach znamená „predpoveď nie je“. @param {any} json @param {Date} now @param {Pick<Settings, 'site' | 'plant'>} s */
function forecastFrom(json, now, s) {
    try {
        const f = buildForecast(json, now, s.site, s.plant);
        return validateForecast(f).length === 0 ? f : null;
    } catch {
        return null;
    }
}

/**
 * Dáta pre dané nastavenie. Nikdy nehádže - čo chýba, je null a appka to ukáže. Tarifa
 * dáta nemení (predpoveď ani meranie od nej nezávisia), preto ju netreba.
 * @param {Pick<Settings, 'site' | 'plant' | 'zdroj'>} settings @param {Date} now @param {typeof fetch} [fetchImpl] @returns {Promise<DataResult>}
 */
export async function loadData(settings, now, fetchImpl = fetch) {
    const [pvRes, weatherRes] = await Promise.allSettled([
        settings.zdroj ? loadPv(settings.zdroj, fetchImpl) : Promise.resolve(null),
        loadWeather(settings.site, now, fetchImpl),
    ]);
    const live = pvRes.status === 'fulfilled' ? pvRes.value : null;
    const forecast = weatherRes.status === 'fulfilled' ? forecastFrom(weatherRes.value, now, settings) : null;
    return { pv: live && live.pv, pvFailed: pvRes.status === 'rejected', pecat: live && live.pecat, forecast };
}

/**
 * Predpoveď z počasia, ktoré už appka má (aj odložené v prehliadači), bez siete. Appka ju ukáže
 * hneď po otvorení, kým loadData stiahne čerstvé dáta. null, keď pre lokalitu nič nemá alebo je
 * staršie než WEATHER_KEEP_MS.
 * @param {Pick<Settings, 'site' | 'plant'>} settings @param {Date} now
 * @returns {import('../shared/solar.js').Forecast | null}
 */
export function keptForecast(settings, now) {
    const kept = keptWeather(openMeteoUrl(settings.site), now);
    return kept ? forecastFrom(kept.json, now, settings) : null;
}

/**
 * Vyhľadanie lokality podľa názvu. Pri chybe siete hádže - formulár to ohlási.
 * @param {string} query @param {typeof fetch} [fetchImpl]
 */
export async function searchPlaces(query, fetchImpl = fetch) {
    return parseGeocode(await getJson(geocodeUrl(query), fetchImpl));
}
