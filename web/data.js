// Načítanie dát. Predpoveď sa počíta tu v prehliadači z počasia Open-Meteo pre lokalitu
// z nastavenia. Živé meranie stiahne Worker z kiosku, ktorý si používateľ zadal; bez kiosku
// meranie nie je. Neplatné dáta sa správajú ako chýbajúce.

import { geocodeUrl, openMeteoUrl, TIMEOUT, WEATHER_CACHE_MS, WEATHER_KEEP_MS, WORKER_PV_URL } from '../shared/config.js';
import { validateForecast, validatePv } from '../shared/schema.js';
import { parseGeocode } from '../shared/settings.js';
import { buildForecast } from '../shared/solar.js';
import { loadStoredWeather, saveStoredWeather } from './storage.js';

/** @typedef {import('../shared/settings.js').Settings} Settings */
/**
 * `pvFailed` odlišuje "meranie sa nepodarilo" od "meranie nie je" (bez kiosku) - pri prvom si
 * appka na chvíľu nechá posledné meranie, pri druhom nemá čo nechávať.
 * @typedef {{ pv: import('../shared/kiosk.js').PvData | null, pvFailed: boolean, forecast: import('../shared/solar.js').Forecast | null }} DataResult
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
 * Živé meranie z vlastného kiosku. Odkaz ide v tele ako text - taká požiadavka nepotrebuje
 * predbežnú CORS kontrolu a odkaz sa nedostane do adresy, ktorá končí v logoch.
 * @param {string} kiosk @param {typeof fetch} fetchImpl
 */
async function loadKioskPv(kiosk, fetchImpl) {
    const res = await fetchImpl(WORKER_PV_URL, {
        method: 'POST',
        body: kiosk,
        cache: 'no-store',
        signal: AbortSignal.timeout(TIMEOUT.appMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} kiosk`);
    const pv = validPv((await res.json()).pv);
    if (!pv) throw new Error('Kiosk nevrátil platné dáta');
    return pv;
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
 * @param {Pick<Settings, 'site' | 'plant' | 'kiosk'>} settings @param {Date} now @param {typeof fetch} [fetchImpl] @returns {Promise<DataResult>}
 */
export async function loadData(settings, now, fetchImpl = fetch) {
    const [pvRes, weatherRes] = await Promise.allSettled([
        settings.kiosk ? loadKioskPv(settings.kiosk, fetchImpl) : Promise.resolve(null),
        loadWeather(settings.site, now, fetchImpl),
    ]);
    const pv = pvRes.status === 'fulfilled' ? pvRes.value : null;
    const forecast = weatherRes.status === 'fulfilled' ? forecastFrom(weatherRes.value, now, settings) : null;
    return { pv, pvFailed: pvRes.status === 'rejected', forecast };
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
