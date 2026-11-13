// Cloudflare Worker: živé meranie pre appku. Prehliadač by sa na servery výrobcov meničov priamo
// nedostal, preto sa ich pýta tento Worker. Prístupy ani nastavenie elektrárne neukladá - prístup
// k meraniu drží appka zapečatený (worker/src/pecat.js), Worker ho pri každom meraní otvorí.
// Jediné, čo si pamätá, sú odbery ranného oznámenia: adresa, kam telefón zobudiť, hodina
// a časové pásmo (worker/src/oznamenia.js), a budí ich plánovaným behom každú štvrťhodinu.
//
// POST /pripoj: údaje z formulára sprievodcu -> nájdené elektrárne, každá so zapečateným prístupom.
// Pri obnove prístupu príde aj stará pečať - z nej sa doplní, čo človek nemusí zadávať znova.
// POST /pv: zapečatený prístup -> meranie vo formáte `pv`. Prijme aj holý odkaz na kiosk, ktorý
// posielali appky spred zapečatenia - vtedy k meraniu pribalí aj zapečatený prístup, appka si ho
// uloží namiesto odkazu.
// POST /zdielaj: zapečatený prístup -> ten istý prístup s platnosťou ZDIELANIE.platiDni dní, do
// odkazu Zdieľať appku. Kto odkaz otvorí včas, dostane pri prvom meraní (/pv) trvalú pečať.
// POST /trasy: poloha -> trasy autom do miest pre kartu Štatistika (worker/src/trasy.js).
// GET /radar/<snímka>?b=<bloky>: kúsky radarového súboru OPERA pre kartu Radar (worker/src/radar.js).

import {
    WORKER_OZNAMENIA_PATH,
    WORKER_PRIPOJ_PATH,
    WORKER_PRIPOMEN_PATH,
    WORKER_PV_PATH,
    WORKER_RADAR_PATH,
    WORKER_TRASY_PATH,
    WORKER_ZDIELAJ_PATH,
    ZDIELANIE,
} from '../../shared/config.js';
import { kioskApiUrl } from '../../shared/kiosk.js';
import { isObj } from '../../shared/valid.js';
import { budenie, ulozOdber, ulozPripomienku } from './oznamenia.js';
import { otvor, pecatKey, zapecat } from './pecat.js';
import { handleRadar } from './radar.js';
import { trasy } from './trasy.js';
import { ZdrojChyba, ZDROJE } from './zdroje.js';

/**
 * `LIMIT`: obmedzenie počtu volaní z jednej adresy (väzba `ratelimits` vo wrangler.toml).
 * @typedef {{ PECAT_KLUC?: string, LIMIT?: { limit: (o: { key: string }) => Promise<{ success: boolean }> } } & import('./oznamenia.js').OznamEnv} Env
 */

const HEADERS = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
};

// Najdlhšie telo požiadavky. Odkaz na kiosk má okolo stovky znakov, údaje z formulára tiež málo.
const MAX_BODY = 10000;

/** @param {number} status @param {unknown} body */
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: HEADERS });

/**
 * Chyba ako odpoveď. Bez podrobností - tie by mohli obsahovať odkaz či kľúč, a ten do odpovedí
 * ani logov nepatrí. Výnimkou je `kod`: krok a kód chyby od výrobcu (napr. `prihlasenie:20400`),
 * podľa ktorého appka povie, čo presne výrobca odmietol. Ten ide aj do logu Workera.
 * @param {unknown} err
 */
function chyba(err) {
    const kod = err instanceof ZdrojChyba ? err.kod : '';
    const druh = err instanceof ZdrojChyba && err.druh === 'udaje' ? 'udaje' : 'vyrobca';
    console.log(`zdroj: ${druh}${kod ? ` (${kod})` : ''}`);
    return json(druh === 'udaje' ? 400 : 502, kod ? { chyba: druh, kod } : { chyba: druh });
}

/**
 * Úspešné meranie do logu: spôsob a či chýbal výkon - inak sa pri odpovedi 200 nedá zistiť, prečo
 * appka ukazuje odhad. Bez prístupu a hodnôt merania.
 * @param {string} sposob @param {import('../../shared/kiosk.js').PvData} pv
 */
function zalogujMeranie(sposob, pv) {
    console.log(`meranie: ${sposob}${pv.realTimePowerKw === null ? ' (bez výkonu)' : ''}`);
}

/** Telo požiadavky ako text, najviac MAX_BODY znakov; dlhšie je null. @param {Request} request */
async function telo(request) {
    const text = await request.text();
    return text.length <= MAX_BODY ? text : null;
}

/**
 * Pečať, ktorú si appka po meraní uloží namiesto doterajšej, alebo nič. Novú treba, keď sa prístup
 * zmenil (nový token), a keď appka merala s pečaťou zo zdieľaného odkazu - tá sa pri prvom meraní
 * vymení za trvalú.
 * @param {Promise<CryptoKey>} key @param {{ sposob: string, pristup: Record<string, unknown>, platiDo?: number }} obsah
 * @param {Record<string, unknown> | undefined} zmeneny prístup, ktorý vrátilo meranie
 */
async function novaPecat(key, obsah, zmeneny) {
    const pristup = zmeneny ?? (obsah.platiDo === undefined ? null : obsah.pristup);
    return pristup ? zapecat(key, { sposob: obsah.sposob, pristup }) : undefined;
}

/**
 * POST /pv: meranie zo zapečateného prístupu (text v tele), alebo z holého odkazu na kiosk.
 * @param {Request} request @param {Env} env @param {Date} now @param {typeof fetch} fetchImpl
 */
export async function handlePv(request, env, now, fetchImpl) {
    const body = await telo(request);
    if (body === null) return json(400, { chyba: 'udaje' });
    const key = pecatKey(env.PECAT_KLUC);
    const ctx = { now, fetchImpl };
    if (kioskApiUrl(body)) {
        try {
            const { pv } = await ZDROJE['huawei-kiosk'].meraj({ odkaz: body }, ctx);
            const pecat = key ? await zapecat(key, { sposob: 'huawei-kiosk', pristup: { odkaz: body } }) : undefined;
            zalogujMeranie('huawei-kiosk', pv);
            return json(200, { pv, pecat });
        } catch (err) {
            return chyba(err);
        }
    }
    const obsah = key && (await otvor(key, body, now));
    const zdroj = obsah && ZDROJE[obsah.sposob];
    if (!obsah || !zdroj) return json(400, { chyba: 'udaje' });
    try {
        const res = await zdroj.meraj(obsah.pristup, ctx);
        const pecat = await novaPecat(key, obsah, res.pristup);
        zalogujMeranie(obsah.sposob, res.pv);
        return json(200, { pv: res.pv, pecat });
    } catch (err) {
        return chyba(err);
    }
}

/**
 * Požiadavka na pripojenie z tela: známy spôsob, údaje ako texty a nepovinne stará pečať.
 * Čokoľvek iné je null.
 * @param {string | null} body
 * @returns {{ sposob: string, zdroj: import('./zdroje.js').Zdroj, udaje: Record<string, string>, pecat: string } | null}
 */
function pripojReq(body) {
    /** @type {unknown} */ let req;
    try {
        req = JSON.parse(body ?? '');
    } catch {
        return null;
    }
    if (!isObj(req) || typeof req.sposob !== 'string' || !Object.hasOwn(ZDROJE, req.sposob) || !isObj(req.udaje)) return null;
    const udaje = Object.entries(req.udaje);
    if (!udaje.every((u) => typeof u[1] === 'string')) return null;
    return {
        sposob: req.sposob,
        zdroj: ZDROJE[req.sposob],
        udaje: Object.fromEntries(udaje.map(([k, v]) => [k, String(v)])),
        pecat: typeof req.pecat === 'string' ? req.pecat : '',
    };
}

/**
 * Údaje formulára doplnené zo starej pečate toho istého spôsobu (obnova prístupu: Deye pýta len
 * heslo). Čo človek zadal, má prednosť; cudzia či neplatná pečať nič nedoplní.
 * @param {NonNullable<ReturnType<typeof pripojReq>>} req @param {Promise<CryptoKey>} key @param {Date} now
 */
async function sPecatou(req, key, now) {
    const stara = req.pecat && req.zdroj.zPecate ? await otvor(key, req.pecat, now) : null;
    if (!stara || stara.sposob !== req.sposob || !req.zdroj.zPecate) return req.udaje;
    const z = Object.entries(req.zdroj.zPecate(stara.pristup)).filter(([, v]) => v);
    return { ...Object.fromEntries(z), ...req.udaje };
}

/**
 * POST /pripoj: `{ sposob, udaje, pecat? }` v tele (JSON ako text). Overí údaje u výrobcu a vráti
 * nájdené elektrárne - meno, zapečatený prístup, čo práve namerala a dokedy prístup platí.
 * @param {Request} request @param {Env} env @param {Date} now @param {typeof fetch} fetchImpl
 */
export async function handlePripoj(request, env, now, fetchImpl) {
    const key = pecatKey(env.PECAT_KLUC);
    if (!key) return json(503, { chyba: 'server' });
    const req = pripojReq(await telo(request));
    if (!req) return json(400, { chyba: 'udaje' });
    try {
        const najdene = await req.zdroj.pripoj(await sPecatou(req, key, now), { now, fetchImpl });
        const stanice = await Promise.all(
            najdene.map(async (n) => ({
                nazov: n.nazov,
                pecat: await zapecat(key, { sposob: req.sposob, pristup: n.pristup }),
                pv: n.pv,
                platiDo: n.platiDo,
            })),
        );
        return json(200, { stanice });
    } catch (err) {
        return chyba(err);
    }
}

/**
 * POST /zdielaj: zapečatený prístup (alebo holý odkaz na kiosk spred zapečatenia) v tele -> pečať
 * toho istého prístupu s platnosťou ZDIELANIE.platiDni dní. Výrobcu sa nepýta.
 * @param {Request} request @param {Env} env @param {Date} now
 */
export async function handleZdielaj(request, env, now) {
    const key = pecatKey(env.PECAT_KLUC);
    if (!key) return json(503, { chyba: 'server' });
    const body = await telo(request);
    const obsah =
        body === null ? null : kioskApiUrl(body) ? { sposob: 'huawei-kiosk', pristup: { odkaz: body } } : await otvor(key, body, now);
    if (!obsah || !ZDROJE[obsah.sposob]) return json(400, { chyba: 'udaje' });
    const platiDo = now.getTime() + ZDIELANIE.platiDni * 24 * 3600 * 1000;
    return json(200, { pecat: await zapecat(key, { sposob: obsah.sposob, pristup: obsah.pristup, platiDo }) });
}

/** Odpoveď na uloženie odberu či pripomienky podľa stavu. @param {number} status */
const oznamOdpoved = (status) => json(status, status === 200 ? { ok: true } : { chyba: status === 400 ? 'udaje' : 'server' });

/**
 * Uloženie odberu či pripomienky. Zlyhaný zápis do KV (denný limit zápisov) je 503 s hlavičkami
 * CORS, nie holá chyba Workera.
 * @param {(body: string | null) => Promise<number>} uloz @param {Request} request
 */
const oznam = async (uloz, request) => oznamOdpoved(await uloz(await telo(request)).catch(() => 503));

/**
 * Cesty POST. `limit`: počet volaní z jednej adresy je obmedzený - pripojenie by sa inak dalo
 * použiť na skúšanie cudzích hesiel u výrobcov a odbery na zapĺňanie úložiska. Meranie (/pv)
 * obmedzené nie je: pýta sa každú minútu z každej otvorenej appky a bez platnej pečate nič nespraví.
 * @type {Record<string, { limit: boolean, run: (request: Request, env: Env, now: Date, fetchImpl: typeof fetch) => Promise<Response> }>}
 */
const CESTY = {
    [WORKER_PV_PATH]: { limit: false, run: handlePv },
    [WORKER_PRIPOJ_PATH]: { limit: true, run: handlePripoj },
    [WORKER_ZDIELAJ_PATH]: { limit: true, run: handleZdielaj },
    [WORKER_OZNAMENIA_PATH]: { limit: true, run: (request, env) => oznam((body) => ulozOdber(body, env), request) },
    [WORKER_PRIPOMEN_PATH]: { limit: true, run: (request, env, now) => oznam((body) => ulozPripomienku(body, env, now), request) },
    [WORKER_TRASY_PATH]: {
        limit: true,
        run: async (request, env, now, fetchImpl) => {
            const r = await trasy(await telo(request), fetchImpl);
            return json(r.status, r.body);
        },
    },
};

/**
 * Smie táto adresa volať cestu? Bez väzby (testy, miestny beh) a pri jej chybe áno - výpadok
 * počítadla nemá zastaviť appku.
 * @param {Request} request @param {Env} env @param {string} path
 */
async function vLimite(request, env, path) {
    if (!env.LIMIT) return true;
    const adresa = request.headers.get('cf-connecting-ip') ?? '';
    return env.LIMIT.limit({ key: `${path}:${adresa}` }).then(
        (r) => r.success,
        () => true,
    );
}

/** @param {Request} request @param {Env} [env] @param {Date} [now] @param {typeof fetch} [fetchImpl] */
export async function handleRequest(request, env = {}, now = new Date(), fetchImpl = fetch) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS });
    const path = new URL(request.url).pathname;
    const cesta = Object.hasOwn(CESTY, path) ? CESTY[path] : null;
    if (!cesta) return json(404, { error: 'neznáma cesta' });
    if (request.method !== 'POST') return json(405, { error: 'nepovolená metóda' });
    if (cesta.limit && !(await vLimite(request, env, path))) return json(429, { chyba: 'server' });
    return cesta.run(request, env, now, fetchImpl);
}

export default {
    /** @param {Request} request @param {Env} env @param {{ waitUntil: (p: Promise<unknown>) => void }} ctx */
    fetch(request, env, ctx) {
        if (!new URL(request.url).pathname.startsWith(WORKER_RADAR_PATH)) return handleRequest(request, env);
        const cache = /** @type {any} */ (globalThis.caches).default;
        return handleRadar(request, { fetchImpl: fetch, cache, waitUntil: (p) => ctx.waitUntil(p) });
    },
    /**
     * Plánovaný beh (cron vo wrangler.toml): zobudí telefóny, ktorým nastal čas oznámenia.
     * @param {{ scheduledTime: number }} controller @param {Env} env @param {{ waitUntil: (p: Promise<unknown>) => void }} ctx
     */
    scheduled(controller, env, ctx) {
        ctx.waitUntil(budenie(env, new Date(controller.scheduledTime), fetch));
    },
};
