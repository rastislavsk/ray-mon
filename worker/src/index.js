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

import { WORKER_OZNAMENIA_PATH, WORKER_PRIPOJ_PATH, WORKER_PRIPOMEN_PATH, WORKER_PV_PATH } from '../../shared/config.js';
import { kioskApiUrl } from '../../shared/kiosk.js';
import { budenie, ulozOdber, ulozPripomienku } from './oznamenia.js';
import { otvor, pecatKey, zapecat } from './pecat.js';
import { ZdrojChyba, ZDROJE } from './zdroje.js';

/** @typedef {{ PECAT_KLUC?: string } & import('./oznamenia.js').OznamEnv} Env */

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
    const obsah = key && (await otvor(key, body));
    const zdroj = obsah && ZDROJE[obsah.sposob];
    if (!obsah || !zdroj) return json(400, { chyba: 'udaje' });
    try {
        const res = await zdroj.meraj(obsah.pristup, ctx);
        const pecat = res.pristup && key ? await zapecat(key, { sposob: obsah.sposob, pristup: res.pristup }) : undefined;
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
    /** @type {any} */ let req;
    try {
        req = JSON.parse(body ?? '');
    } catch {
        return null;
    }
    const zdroj = req && typeof req.sposob === 'string' ? ZDROJE[req.sposob] : undefined;
    const udaje = req && req.udaje && typeof req.udaje === 'object' ? req.udaje : null;
    if (!zdroj || !udaje || !Object.values(udaje).every((v) => typeof v === 'string')) return null;
    return { sposob: req.sposob, zdroj, udaje, pecat: typeof req.pecat === 'string' ? req.pecat : '' };
}

/**
 * Údaje formulára doplnené zo starej pečate toho istého spôsobu (obnova prístupu: Deye pýta len
 * heslo). Čo človek zadal, má prednosť; cudzia či neplatná pečať nič nedoplní.
 * @param {NonNullable<ReturnType<typeof pripojReq>>} req @param {Promise<CryptoKey>} key
 */
async function sPecatou(req, key) {
    const stara = req.pecat && req.zdroj.zPecate ? await otvor(key, req.pecat) : null;
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
        const najdene = await req.zdroj.pripoj(await sPecatou(req, key), { now, fetchImpl });
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

/** Odpoveď na uloženie odberu či pripomienky podľa stavu. @param {number} status */
const oznamOdpoved = (status) => json(status, status === 200 ? { ok: true } : { chyba: status === 400 ? 'udaje' : 'server' });

/** @param {Request} request @param {Env} [env] @param {Date} [now] @param {typeof fetch} [fetchImpl] */
export async function handleRequest(request, env = {}, now = new Date(), fetchImpl = fetch) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS });
    const path = new URL(request.url).pathname;
    const paths = [WORKER_PV_PATH, WORKER_PRIPOJ_PATH, WORKER_OZNAMENIA_PATH, WORKER_PRIPOMEN_PATH];
    if (!paths.includes(path)) return json(404, { error: 'neznáma cesta' });
    if (request.method !== 'POST') return json(405, { error: 'nepovolená metóda' });
    if (path === WORKER_OZNAMENIA_PATH) return oznamOdpoved(await ulozOdber(await telo(request), env));
    if (path === WORKER_PRIPOMEN_PATH) return oznamOdpoved(await ulozPripomienku(await telo(request), env, now));
    return path === WORKER_PV_PATH ? handlePv(request, env, now, fetchImpl) : handlePripoj(request, env, now, fetchImpl);
}

export default {
    /** @param {Request} request @param {Env} env */
    fetch(request, env) {
        return handleRequest(request, env);
    },
    /**
     * Plánovaný beh (cron vo wrangler.toml): zobudí telefóny, ktorým nastal čas oznámenia.
     * @param {{ scheduledTime: number }} controller @param {Env} env @param {{ waitUntil: (p: Promise<unknown>) => void }} ctx
     */
    scheduled(controller, env, ctx) {
        ctx.waitUntil(budenie(env, new Date(controller.scheduledTime), fetch));
    },
};
