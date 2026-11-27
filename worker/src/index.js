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
// POST /bojler: skript v zásuvke Shelly s bojlerom sa každú minútu pýta, či ho má zapnúť
// (docs/navrhy/bojler-prebytky.html). POST /bojler-pecat: pečať telefónu -> menšia pečať do skriptu.
// POST /koniec: oznámenie o konci programu spotrebiča - budík v Durable Object (worker/src/budik.js).
// POST /bojler-stav: pečať telefónu -> posledné hlásenie zásuvky s bojlerom, bez merania (worker/src/ucet.js).
// POST /bojler-hranica: telefón nastaví hranicu teploty vody, ktorú zásuvka stráži (worker/src/ucet.js).
// POST /bojler-oznamenia: telefón si zapne či vypne oznámenia o zapnutí a vypnutí bojlera (worker/src/ucet.js).
// POST /historia: pečať telefónu -> história elektrárne pre učenie Plánu dňa (worker/src/ucet.js, shared/historia.js).
// POST /bezi: pečať telefónu, dnešok a zmeny „Už beží“ -> dnešné behy všetkých telefónov domácnosti (worker/src/ucet.js).
// POST /ucenie: pečať telefónu, snímky predpovede a „Začať odznova“ -> model učenia Plánu dňa (worker/src/ucet.js).
// POST /auto: pečať telefónu -> stav a behy nabíjania auta, bez merania (docs/navrhy/auto-nabija.html, worker/src/ucet.js).
// POST /auto-oznamenia: telefón si zapne či vypne oznámenia o začiatku a konci nabíjania auta (worker/src/ucet.js).
// POST /klima: skript na Shelly posiela odpovede lokálneho API klimatizácie Daikin (docs/navrhy/klima-daikin.html).
// POST /klima-stav: pečať telefónu -> stav klimatizácie s dnešnými bodmi a zdrojmi hodín (worker/src/ucet.js).
// POST /spotrebic: skript v zásuvke Shelly so spotrebičom posiela príkon a energiu (docs/navrhy/pracka-zasuvka.html).
// POST /spotrebic-oznamenia: telefón si zapne či vypne oznámenie o konci behu zo zásuvky (worker/src/ucet.js).
//
// Huawei Northbound meria cez Durable Object účtu (worker/src/ucet.js): telefón a zásuvka by sa inak
// navzájom odhlasovali. Ten si pamätá aj reláciu a stav bojlera; heslo nie.

import {
    WORKER_AUTO_OZNAM_PATH,
    WORKER_AUTO_PATH,
    WORKER_BOJLER_PATH,
    WORKER_BOJLER_PECAT_PATH,
    WORKER_BOJLER_OZNAM_PATH,
    WORKER_BOJLER_REZIM_PATH,
    WORKER_BOJLER_HRANICA_PATH,
    WORKER_BEZI_PATH,
    WORKER_BOJLER_STAV_PATH,
    WORKER_HISTORIA_PATH,
    WORKER_KLIMA_PATH,
    WORKER_KLIMA_STAV_PATH,
    WORKER_KONIEC_PATH,
    WORKER_OZNAMENIA_PATH,
    WORKER_PRIPOJ_PATH,
    WORKER_PRIPOMEN_PATH,
    WORKER_PV_PATH,
    WORKER_RADAR_PATH,
    WORKER_SPOTREBIC_OZNAM_PATH,
    WORKER_SPOTREBIC_PATH,
    WORKER_TRASY_PATH,
    WORKER_UCENIE_PATH,
    WORKER_ZDIELAJ_PATH,
    ZDIELANIE,
} from '../../shared/config.js';
import { hranicaZ } from '../../shared/bojler-voda.js';
import { kioskApiUrl } from '../../shared/kiosk.js';
import { isObj } from '../../shared/valid.js';
import { ulozKoniec } from './budik.js';
import { budenie, ulozOdber, ulozPripomienku } from './oznamenia.js';
import { otvor, pecatKey, zapecat } from './pecat.js';
import { handleRadar } from './radar.js';
import { trasy } from './trasy.js';
import { klucOdberu, platnyOdber } from './webpush.js';
import { ZdrojChyba, ZDROJE } from './zdroje.js';

export { Budik } from './budik.js';
export { UcetHuawei } from './ucet.js';

/**
 * `LIMIT`: obmedzenie počtu volaní z jednej adresy (väzba `ratelimits` vo wrangler.toml).
 * `UCTY`: Durable Objects účtov Huawei Northbound (worker/src/ucet.js). Bez nich (testy) Worker
 * meria priamo a bojler nevie riadiť.
 * @typedef {{ idFromName: (n: string) => unknown, get: (id: unknown) => { fetch: (url: string, init: RequestInit) => Promise<Response> } }} UctyNs
 * `BUDIK`: Durable Objects budíkov konca programu (worker/src/budik.js), jeden na odber telefónu.
 * @typedef {{ PECAT_KLUC?: string, LIMIT?: { limit: (o: { key: string }) => Promise<{ success: boolean }> }, UCTY?: UctyNs, BUDIK?: UctyNs } & import('./oznamenia.js').OznamEnv} Env
 */

const HEADERS = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
};

// Najdlhšie telo požiadavky. Odkaz na kiosk má okolo stovky znakov, údaje z formulára tiež málo.
const MAX_BODY = 10000;
/** /ucenie: pri prechode telefón pošle naraz všetky svoje snímky predpovede a behy (HISTORIA.dni dní, asi 25 kB). */
const MAX_BODY_UCENIE = 60000;

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

/**
 * Telo požiadavky ako text, najviac `max` znakov; dlhšie je null. Telo, ktoré podľa hlavičky nemôže byť krátke
 * (znak v UTF-8 má najviac 3 bajty na jednotku UTF-16), sa ani nečíta - inak by ho Worker celé držal v pamäti.
 * @param {Request} request @param {number} [max]
 */
async function telo(request, max = MAX_BODY) {
    if (Number(request.headers.get('content-length')) > 3 * max) return null;
    const text = await request.text();
    return text.length <= max ? text : null;
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
 * Dopyt na Durable Object účtu Huawei, do ktorého prístup patrí (server a meno). Chybu zdroja
 * vráti ako ZdrojChyba, akoby merala sama.
 * @param {UctyNs} ucty @param {Record<string, unknown>} pristup @param {string} path @param {Date} now @param {object} [navyse]
 * @returns {Promise<any>}
 */
async function ucet(ucty, pristup, path, now, navyse = {}) {
    const stub = ucty.get(ucty.idFromName(`${String(pristup.server)}|${String(pristup.meno)}`));
    const res = await stub.fetch(`https://ucet${path}`, {
        method: 'POST',
        body: JSON.stringify({ ...navyse, pristup, now: now.toISOString() }),
    });
    const body = /** @type {any} */ (await res.json());
    if (body.chyba) throw new ZdrojChyba(body.chyba.druh, body.chyba.kod);
    return body;
}

/**
 * Meranie Huawei Northbound cez Durable Object účtu: k meraniu aj stav bojlera, keď ho zásuvka hlási.
 * @param {UctyNs} ucty @param {Promise<CryptoKey>} key @param {{ sposob: string, pristup: Record<string, unknown>, platiDo?: number }} obsah @param {Date} now
 */
async function pvCezUcet(ucty, key, obsah, now) {
    const r = await ucet(ucty, obsah.pristup, '/pv', now);
    zalogujMeranie(obsah.sposob, r.pv);
    return json(200, { pv: r.pv, pecat: await novaPecat(key, obsah, r.pristup), ...(r.bojler ? { bojler: r.bojler } : {}) });
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
        if (obsah.sposob === 'huawei-northbound' && env.UCTY) return await pvCezUcet(env.UCTY, key, obsah, now);
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

// Čo pečať pre zásuvku nesie: na meranie stačí prístup bez relácie a bez toho, čo si meranie
// zapamätá samo (krivka, časy) - to drží Durable Object účtu. Skript ju posiela s každým dopytom.
const BOJLER_PRISTUP = ['server', 'meno', 'heslo', 'plant', 'nazov', 'devs', 'dns', 'meters', 'devsAt', 'dnsAt', 'metersAt'];

/**
 * POST /bojler-pecat: pečať telefónu v tele -> pečať do skriptu zásuvky. Len Huawei Northbound,
 * iné zdroje elektromer nemajú.
 * @param {Request} request @param {Env} env @param {Date} now
 */
export async function handleBojlerPecat(request, env, now) {
    const key = pecatKey(env.PECAT_KLUC);
    if (!key || !env.UCTY) return json(503, { chyba: 'server' });
    const body = await telo(request);
    const obsah = body === null ? null : await otvor(key, body, now);
    if (!obsah || obsah.sposob !== 'huawei-northbound' || obsah.platiDo !== undefined) return json(400, { chyba: 'udaje' });
    const pristup = Object.fromEntries(Object.entries(obsah.pristup).filter(([k]) => BOJLER_PRISTUP.includes(k)));
    return json(200, { pecat: await zapecat(key, { sposob: obsah.sposob, pristup }) });
}

/**
 * JSON od zásuvky či appky s pečaťou Huawei Northbound (nie odkazom na zdieľanie): telo a otvorená pečať,
 * alebo `obsah` null, keď telo či pečať nesedí.
 * @param {Request} request @param {Promise<CryptoKey>} key @param {Date} now
 * @returns {Promise<{ req: any, obsah: Awaited<ReturnType<typeof otvor>> }>}
 */
async function dopytBojlera(request, key, now, max = MAX_BODY) {
    /** @type {any} */ let req = null;
    try {
        req = JSON.parse((await telo(request, max)) ?? '');
    } catch {
        return { req: null, obsah: null };
    }
    const obsah = isObj(req) && typeof req.pecat === 'string' ? await otvor(key, req.pecat, now) : null;
    const nb = !!obsah && obsah.sposob === 'huawei-northbound' && obsah.platiDo === undefined;
    return { req, obsah: nb ? obsah : null };
}

/**
 * POST /bojler: `{ pecat, id, rele, w, e, zapKw, vypKw, t? }` od skriptu zásuvky (ID zariadenia, stav relé, príkon vo W,
 * počítadlo energie vo Wh, prahy a s teplomerom teplota vody v °C, docs/navrhy/bojler-teplota.html) -> `{ zapni, rucne, prebytokKw, maxC, minC }` (hranica teploty a návrat). V ručnom režime je `zapni` stav relé, takže ho
 * nezmení ani starší skript, ktorý `rucne` nepozná. Rozhoduje Durable Object účtu (shared/bojler.js). Hlásenie
 * od iného zariadenia, než ktoré bojler riadi, či bez merania príkonu -> 409 (zariadenieBojlera v shared/bojler.js).
 * @param {Request} request @param {Env} env @param {Date} now
 */
export async function handleBojler(request, env, now) {
    const key = pecatKey(env.PECAT_KLUC);
    if (!key || !env.UCTY) return json(503, { chyba: 'server' });
    const { req, obsah } = await dopytBojlera(request, key, now);
    if (!obsah) return json(400, { chyba: 'udaje' });
    try {
        const prahy = { zapKw: req.zapKw, vypKw: req.vypKw };
        const hlasenie = { id: req.id, rele: req.rele, w: req.w, e: req.e, prahy, t: req.t };
        const r = await ucet(env.UCTY, obsah.pristup, '/bojler', now, hlasenie);
        // Iné zariadenie než to, ktoré bojler riadi (docs/navrhy/bojler-jedno-zariadenie.html): skript to berie ako ticho.
        if (r.odmietnute) return json(409, { chyba: 'zariadenie' });
        // Hranicu teploty (docs/navrhy/bojler-hranica.html) si skript zásuvky pamätá a stráži ju aj bez Workera.
        const hranica = { maxC: r.maxC ?? null, minC: r.minC ?? null };
        return json(200, { zapni: r.zapni === true, rucne: r.rucne === true, prebytokKw: r.prebytokKw ?? null, ...hranica });
    } catch (err) {
        return chyba(err);
    }
}

/**
 * POST /bojler-oznamenia: `{ pecat, endpoint, keys, on }` od appky (pečať telefónu) -> `{ ok }`. Zapne (`on`) či vypne
 * tomuto telefónu oznámenia o zapnutí a vypnutí bojlera (docs/navrhy/spotrebic-koniec-opakovanie.html); posiela ich
 * Durable Object účtu pri hlásení zásuvky.
 * @param {Request} request @param {Env} env @param {Date} now
 */
export async function handleBojlerOznam(request, env, now) {
    const key = pecatKey(env.PECAT_KLUC);
    if (!key || !env.UCTY) return json(503, { chyba: 'server' });
    const { req, obsah } = await dopytBojlera(request, key, now);
    const keys = klucOdberu(req?.keys);
    if (!obsah || !platnyOdber(req.endpoint) || typeof req.on !== 'boolean' || (req.on && !keys)) return json(400, { chyba: 'udaje' });
    try {
        await ucet(env.UCTY, obsah.pristup, '/oznam', now, { endpoint: req.endpoint, keys, on: req.on });
        return json(200, { ok: true });
    } catch (err) {
        return chyba(err);
    }
}

/**
 * POST /auto-oznamenia: `{ pecat, endpoint, keys, z, k }` od appky (pečať telefónu) -> `{ ok }`. Tomuto telefónu zapne
 * oznámenia o začiatku (`z`) a konci (`k`) nabíjania auta; bez oboch ich vypne (docs/navrhy/auto-nabija.html).
 * @param {Request} request @param {Env} env @param {Date} now
 */
export async function handleAutoOznam(request, env, now) {
    const key = pecatKey(env.PECAT_KLUC);
    if (!key || !env.UCTY) return json(503, { chyba: 'server' });
    const { req, obsah } = await dopytBojlera(request, key, now);
    const odber = odberAuta(req);
    if (!obsah || !odber) return json(400, { chyba: 'udaje' });
    try {
        await ucet(env.UCTY, obsah.pristup, '/auto-oznam', now, odber);
        return json(200, { ok: true });
    } catch (err) {
        return chyba(err);
    }
}

/**
 * Odber oznámení o nabíjaní z dopytu appky: adresa, kľúče (bez nich len vypnutie oboch) a voľby `z`, `k`; inak null.
 * @param {any} req
 */
function odberAuta(req) {
    const keys = klucOdberu(req?.keys);
    if (!platnyOdber(req?.endpoint) || typeof req.z !== 'boolean' || typeof req.k !== 'boolean') return null;
    return (req.z || req.k) && !keys ? null : { endpoint: req.endpoint, keys, z: req.z, k: req.k };
}

/**
 * POST /auto: `{ pecat }` od appky (pečať telefónu) -> `{ auto }`, stav a behy nabíjania auta (null, kým objekt nič
 * nenameral). Appka sa pýta pri každej obnove dát, na Huawei nejde nič.
 * @param {Request} request @param {Env} env @param {Date} now
 */
export async function handleAuto(request, env, now) {
    const key = pecatKey(env.PECAT_KLUC);
    if (!key || !env.UCTY) return json(503, { chyba: 'server' });
    const { obsah } = await dopytBojlera(request, key, now);
    if (!obsah) return json(400, { chyba: 'udaje' });
    try {
        const r = await ucet(env.UCTY, obsah.pristup, '/auto', now);
        return json(200, { auto: r.auto ?? null });
    } catch (err) {
        return chyba(err);
    }
}

/**
 * POST /klima: `{ pecat, id, s, c, d?, w?, t?, r?, b? }` od skriptu na Shelly (docs/navrhy/klima-daikin.html): surové
 * odpovede lokálneho API klimatizácie Daikin -> `{ ok }`. Stav z nich skladá Durable Object účtu (shared/klima.js).
 * Hlásenie bez stavu či teplôt -> 400.
 * @param {Request} request @param {Env} env @param {Date} now
 */
export async function handleKlima(request, env, now) {
    const key = pecatKey(env.PECAT_KLUC);
    if (!key || !env.UCTY) return json(503, { chyba: 'server' });
    const { req, obsah } = await dopytBojlera(request, key, now);
    if (!obsah) return json(400, { chyba: 'udaje' });
    try {
        const odpovede = Object.fromEntries(
            ['s', 'c', 'd', 'w', 't', 'r', 'b'].filter((k) => typeof req[k] === 'string').map((k) => [k, req[k]]),
        );
        const r = await ucet(env.UCTY, obsah.pristup, '/klima', now, { odpovede });
        return r.ok ? json(200, { ok: true }) : json(400, { chyba: 'udaje' });
    } catch (err) {
        return chyba(err);
    }
}

/**
 * POST /spotrebic: `{ pecat, id, vec, w, e }` od skriptu v zásuvke so spotrebičom (docs/navrhy/pracka-zasuvka.html) ->
 * `{ ok }`. Beh z hlásení rozozná Durable Object účtu (shared/zasuvka.js). Zlé hlásenie -> 400, iná zásuvka toho istého
 * spotrebiča, kým sa prvá ozýva -> 409.
 * @param {Request} request @param {Env} env @param {Date} now
 */
export async function handleSpotrebic(request, env, now) {
    const key = pecatKey(env.PECAT_KLUC);
    if (!key || !env.UCTY) return json(503, { chyba: 'server' });
    const { req, obsah } = await dopytBojlera(request, key, now);
    if (!obsah) return json(400, { chyba: 'udaje' });
    try {
        const r = await ucet(env.UCTY, obsah.pristup, '/spotrebic', now, { vec: req.vec, id: req.id, w: req.w, e: req.e });
        if (r.odmietnute) return json(409, { chyba: 'zariadenie' });
        return r.ok ? json(200, { ok: true }) : json(400, { chyba: 'udaje' });
    } catch (err) {
        return chyba(err);
    }
}

/**
 * POST /spotrebic-oznamenia: `{ pecat, endpoint, keys, on }` od appky (pečať telefónu) -> `{ ok }`. Zapne (`on`) či
 * vypne tomuto telefónu oznámenie o konci behu spotrebiča na zásuvke (docs/navrhy/pracka-zasuvka.html).
 * @param {Request} request @param {Env} env @param {Date} now
 */
export async function handleSpotrebicOznam(request, env, now) {
    const key = pecatKey(env.PECAT_KLUC);
    if (!key || !env.UCTY) return json(503, { chyba: 'server' });
    const { req, obsah } = await dopytBojlera(request, key, now);
    const keys = klucOdberu(req?.keys);
    if (!obsah || !platnyOdber(req.endpoint) || typeof req.on !== 'boolean' || (req.on && !keys)) return json(400, { chyba: 'udaje' });
    try {
        await ucet(env.UCTY, obsah.pristup, '/spotrebic-oznam', now, { endpoint: req.endpoint, keys, on: req.on });
        return json(200, { ok: true });
    } catch (err) {
        return chyba(err);
    }
}

/**
 * POST /klima-stav: `{ pecat }` od appky (pečať telefónu) -> `{ klima }`, posledné hlásenie klimatizácie s dnešnými
 * bodmi a zdrojmi hodín (null, kým sa skript neozval). Appka sa pýta pri každej obnove dát, na Huawei nejde nič.
 * @param {Request} request @param {Env} env @param {Date} now
 */
export async function handleKlimaStav(request, env, now) {
    const key = pecatKey(env.PECAT_KLUC);
    if (!key || !env.UCTY) return json(503, { chyba: 'server' });
    const { obsah } = await dopytBojlera(request, key, now);
    if (!obsah) return json(400, { chyba: 'udaje' });
    try {
        const r = await ucet(env.UCTY, obsah.pristup, '/klima-stav', now);
        return json(200, { klima: r.klima ?? null });
    } catch (err) {
        return chyba(err);
    }
}

/**
 * POST /bojler-rezim: `{ pecat, rucne }` od appky (pečať telefónu, nie odkaz na zdieľanie) -> `{ ok, bojler }`.
 * V ručnom režime skript v zásuvke relé neprepína, len hlási (docs/navrhy/teraz-auto-tok.html).
 * @param {Request} request @param {Env} env @param {Date} now
 */
export async function handleBojlerRezim(request, env, now) {
    const key = pecatKey(env.PECAT_KLUC);
    if (!key || !env.UCTY) return json(503, { chyba: 'server' });
    const { req, obsah } = await dopytBojlera(request, key, now);
    if (!obsah || typeof req.rucne !== 'boolean') return json(400, { chyba: 'udaje' });
    try {
        const r = await ucet(env.UCTY, obsah.pristup, '/rezim', now, { rucne: req.rucne });
        return json(200, { ok: true, bojler: r.bojler ?? null });
    } catch (err) {
        return chyba(err);
    }
}

/**
 * POST /bojler-hranica: `{ pecat, hranica }` od appky (pečať telefónu) -> `{ ok, bojler }`. Hranica teploty vody v °C (celé
 * číslo v rozsahu BOJLER.vodaMinC až vodaMaxC) alebo null - bez hranice (docs/navrhy/bojler-hranica.html).
 * @param {Request} request @param {Env} env @param {Date} now
 */
export async function handleBojlerHranica(request, env, now) {
    const key = pecatKey(env.PECAT_KLUC);
    if (!key || !env.UCTY) return json(503, { chyba: 'server' });
    const { req, obsah } = await dopytBojlera(request, key, now);
    if (!obsah || (req.hranica !== null && hranicaZ(req.hranica) === null)) return json(400, { chyba: 'udaje' });
    try {
        const r = await ucet(env.UCTY, obsah.pristup, '/hranica', now, { hranica: req.hranica });
        return json(200, { ok: true, bojler: r.bojler ?? null });
    } catch (err) {
        return chyba(err);
    }
}

/**
 * POST /bojler-stav: `{ pecat }` od appky (pečať telefónu) -> `{ bojler }`, posledné hlásenie zásuvky (null, keď sa
 * ešte neozvala). Appka sa pýta každú minútu, aby dlaždica Bojler nečakala na meranie Huawei (raz za 5 minút).
 * @param {Request} request @param {Env} env @param {Date} now
 */
export async function handleBojlerStav(request, env, now) {
    const key = pecatKey(env.PECAT_KLUC);
    if (!key || !env.UCTY) return json(503, { chyba: 'server' });
    const { obsah } = await dopytBojlera(request, key, now);
    if (!obsah) return json(400, { chyba: 'udaje' });
    try {
        const r = await ucet(env.UCTY, obsah.pristup, '/stav', now);
        return json(200, { bojler: r.bojler ?? null });
    } catch (err) {
        return chyba(err);
    }
}

/**
 * POST /historia: `{ pecat }` od appky (pečať telefónu, nie odkaz na zdieľanie) -> `{ dni }`, história elektrárne
 * pre učenie Plánu dňa (docs/navrhy/plan-dna-ucenie.html). Len Huawei Northbound - iné zdroje Durable Object nemajú.
 * @param {Request} request @param {Env} env @param {Date} now
 */
export async function handleHistoria(request, env, now) {
    const key = pecatKey(env.PECAT_KLUC);
    if (!key || !env.UCTY) return json(503, { chyba: 'server' });
    const { obsah } = await dopytBojlera(request, key, now);
    if (!obsah) return json(400, { chyba: 'udaje' });
    try {
        const r = await ucet(env.UCTY, obsah.pristup, '/historia', now);
        return json(200, { dni: r.dni });
    } catch (err) {
        return chyba(err);
    }
}

/** Dátum YYYY-MM-DD. */
const DATUM = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST /bezi: `{ pecat, d, zmeny }` od appky (pečať telefónu) -> `{ bezi, zasuvky }`, dnešné behy „Už beží“ všetkých
 * telefónov domácnosti (docs/navrhy/bezi-spolocne.html) a stav zásuviek spotrebičov (docs/navrhy/pracka-zasuvka.html). `d` je dnešok telefónu, `zmeny` behy spotrebičov, ktoré sa na ňom zmenili
 * (shared/bezi.js). Len Huawei Northbound - iné zdroje Durable Object nemajú.
 * @param {Request} request @param {Env} env @param {Date} now
 */
export async function handleBezi(request, env, now) {
    const key = pecatKey(env.PECAT_KLUC);
    if (!key || !env.UCTY) return json(503, { chyba: 'server' });
    const { req, obsah } = await dopytBojlera(request, key, now);
    if (!obsah || typeof req.d !== 'string' || !DATUM.test(req.d)) return json(400, { chyba: 'udaje' });
    try {
        const r = await ucet(env.UCTY, obsah.pristup, '/bezi', now, { d: req.d, zmeny: req.zmeny ?? [] });
        return json(200, { bezi: r.bezi, zasuvky: r.zasuvky ?? {} });
    } catch (err) {
        return chyba(err);
    }
}

/**
 * POST /ucenie: `{ pecat, snimky?, behy?, od?, odznova? }` od appky (pečať telefónu) -> `{ ucenie }`, model učenia Plánu
 * dňa, ten istý pre všetky telefóny domácnosti (docs/navrhy/ucenie-vo-workeri.html). Telefón pošle snímku predpovede
 * dneška, raz pri prechode aj všetky svoje snímky, behy a „Začať odznova“; `odznova: true` sa učí od dneška. Dáta
 * prečistí Durable Object. Len Huawei Northbound - iné zdroje Durable Object nemajú.
 * @param {Request} request @param {Env} env @param {Date} now
 */
export async function handleUcenie(request, env, now) {
    const key = pecatKey(env.PECAT_KLUC);
    if (!key || !env.UCTY) return json(503, { chyba: 'server' });
    const { req, obsah } = await dopytBojlera(request, key, now, MAX_BODY_UCENIE);
    if (!obsah) return json(400, { chyba: 'udaje' });
    try {
        const { snimky, behy, od, odznova } = req;
        const r = await ucet(env.UCTY, obsah.pristup, '/ucenie', now, { snimky, behy, od, odznova });
        return json(200, { ucenie: r.ucenie });
    } catch (err) {
        return chyba(err);
    }
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
    // Zásuvka sa pýta každú minútu a bez platnej pečate nič nespraví, ako meranie.
    [WORKER_BOJLER_PATH]: { limit: false, run: handleBojler },
    [WORKER_BOJLER_PECAT_PATH]: { limit: true, run: handleBojlerPecat },
    [WORKER_BOJLER_REZIM_PATH]: { limit: true, run: handleBojlerRezim },
    [WORKER_BOJLER_HRANICA_PATH]: { limit: true, run: handleBojlerHranica },
    // Appka sa pýta každú minútu, bez platnej pečate nič nespraví (ako meranie).
    [WORKER_BOJLER_STAV_PATH]: { limit: false, run: handleBojlerStav },
    [WORKER_OZNAMENIA_PATH]: { limit: true, run: (request, env) => oznam((body) => ulozOdber(body, env), request) },
    [WORKER_PRIPOMEN_PATH]: { limit: true, run: (request, env, now) => oznam((body) => ulozPripomienku(body, env, now), request) },
    [WORKER_KONIEC_PATH]: { limit: true, run: (request, env, now) => oznam((body) => ulozKoniec(body, env, now), request) },
    [WORKER_BOJLER_OZNAM_PATH]: { limit: true, run: handleBojlerOznam },
    // Appka sa pýta pri každej obnove dát, bez platnej pečate nič nespraví (ako meranie).
    [WORKER_AUTO_PATH]: { limit: false, run: handleAuto },
    [WORKER_AUTO_OZNAM_PATH]: { limit: true, run: handleAutoOznam },
    // Skript na Shelly hlási každú minútu, appka sa pýta pri každej obnove; bez platnej pečate nič nespraví.
    [WORKER_KLIMA_PATH]: { limit: false, run: handleKlima },
    [WORKER_KLIMA_STAV_PATH]: { limit: false, run: handleKlimaStav },
    [WORKER_SPOTREBIC_PATH]: { limit: false, run: handleSpotrebic },
    [WORKER_SPOTREBIC_OZNAM_PATH]: { limit: true, run: handleSpotrebicOznam },
    [WORKER_HISTORIA_PATH]: { limit: true, run: handleHistoria },
    // Appka sa pýta pri každej obnove dát, bez platnej pečate nič nespraví (ako meranie).
    [WORKER_BEZI_PATH]: { limit: false, run: handleBezi },
    // Raz za deň, so snímkou predpovede a pri „Začať odznova“.
    [WORKER_UCENIE_PATH]: { limit: true, run: handleUcenie },
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
