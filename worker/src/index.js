// Cloudflare Worker: živé meranie pre appku. Prehliadač by sa na servery výrobcov meničov priamo
// nedostal, preto sa ich pýta tento Worker. Nič neukladá - nemá úložisko ani plánované behy.
// Prístup k meraniu drží appka zapečatený (worker/src/pecat.js), Worker ho pri každom meraní otvorí.
//
// POST /pripoj: údaje z formulára sprievodcu -> nájdené elektrárne, každá so zapečateným prístupom.
// POST /pv: zapečatený prístup -> meranie vo formáte `pv`. Prijme aj holý odkaz na kiosk, ktorý
// posielali appky spred zapečatenia - vtedy k meraniu pribalí aj zapečatený prístup, appka si ho
// uloží namiesto odkazu.

import { WORKER_PRIPOJ_PATH, WORKER_PV_PATH } from '../../shared/config.js';
import { kioskApiUrl } from '../../shared/kiosk.js';
import { otvor, pecatKey, zapecat } from './pecat.js';
import { ZdrojChyba, ZDROJE } from './zdroje.js';

/** @typedef {{ PECAT_KLUC?: string }} Env */

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
 * ani logov nepatrí. @param {unknown} err
 */
function chyba(err) {
    if (err instanceof ZdrojChyba && err.druh === 'udaje') return json(400, { chyba: 'udaje' });
    return json(502, { chyba: 'vyrobca' });
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
        return json(200, { pv: res.pv, pecat });
    } catch (err) {
        return chyba(err);
    }
}

/**
 * Požiadavka na pripojenie z tela: známy spôsob a údaje ako texty. Čokoľvek iné je null.
 * @param {string | null} body
 * @returns {{ sposob: string, zdroj: import('./zdroje.js').Zdroj, udaje: Record<string, string> } | null}
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
    return { sposob: req.sposob, zdroj, udaje };
}

/**
 * POST /pripoj: `{ sposob, udaje }` v tele (JSON ako text). Overí údaje u výrobcu a vráti
 * nájdené elektrárne - meno, zapečatený prístup a čo práve namerala.
 * @param {Request} request @param {Env} env @param {Date} now @param {typeof fetch} fetchImpl
 */
export async function handlePripoj(request, env, now, fetchImpl) {
    const key = pecatKey(env.PECAT_KLUC);
    if (!key) return json(503, { chyba: 'server' });
    const req = pripojReq(await telo(request));
    if (!req) return json(400, { chyba: 'udaje' });
    try {
        const najdene = await req.zdroj.pripoj(req.udaje, { now, fetchImpl });
        const stanice = await Promise.all(
            najdene.map(async (n) => ({
                nazov: n.nazov,
                pecat: await zapecat(key, { sposob: req.sposob, pristup: n.pristup }),
                pv: n.pv,
            })),
        );
        return json(200, { stanice });
    } catch (err) {
        return chyba(err);
    }
}

/** @param {Request} request @param {Env} [env] @param {Date} [now] @param {typeof fetch} [fetchImpl] */
export async function handleRequest(request, env = {}, now = new Date(), fetchImpl = fetch) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS });
    const path = new URL(request.url).pathname;
    if (path !== WORKER_PV_PATH && path !== WORKER_PRIPOJ_PATH) return json(404, { error: 'neznáma cesta' });
    if (request.method !== 'POST') return json(405, { error: 'nepovolená metóda' });
    return path === WORKER_PV_PATH ? handlePv(request, env, now, fetchImpl) : handlePripoj(request, env, now, fetchImpl);
}

export default {
    /** @param {Request} request @param {Env} env */
    fetch(request, env) {
        return handleRequest(request, env);
    },
};
