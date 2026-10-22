// Zdroje živého merania vo Workeri: pre každý spôsob pripojenia (shared/zdroje.js) ako sa
// pripojiť a ako merať. Sieť je len tu - prevod odpovedí výrobcu na formát `pv` je v shared/,
// aby sa dal testovať. Worker sa pýta len serverov výrobcu, nikdy adresy od používateľa.

import { VYROBCA_RETRY } from '../../shared/config.js';
import { DEYE, deyeKw, deyePv, deyeToday, parseDeyeDay, parseDeyeLatest, parseDeyeStations, parseDeyeToken } from '../../shared/deye.js';
import { FOXESS, foxHeaders, parseFoxList, parseFoxPv } from '../../shared/foxess.js';
import {
    checkNbLogin,
    NB,
    nbPv,
    nbServer,
    parseNbDevices,
    parseNbDevReal,
    parseNbStationReal,
    parseNbStations,
} from '../../shared/huawei-nb.js';
import { kioskApiUrl, parseKiosk } from '../../shared/kiosk.js';
import { parseSolax, solaxUrl } from '../../shared/solax.js';
import { parseSolisStations, SOLIS, solisRequest } from '../../shared/solis.js';
import { VyrobcaChyba } from '../../shared/vyrobca.js';
import { parseVictronMe, parseVictronPv, parseVictronSites, VICTRON, victronHeaders } from '../../shared/victron.js';
import { fetchWithRetry } from './http.js';

/** @typedef {import('../../shared/kiosk.js').PvData} PvData */
/** @typedef {{ now: Date, fetchImpl: typeof fetch }} Ctx */
/**
 * Elektráreň nájdená pri pripojení: meno u výrobcu, čo treba na meranie (to sa zapečatí), čo
 * práve namerala a dokedy prístup platí (ISO čas), keď ho výrobca dáva len na čas.
 * @typedef {{ nazov: string, pristup: Record<string, unknown>, pv: PvData | null, platiDo?: string }} Najdena
 */
/**
 * Spôsob pripojenia vo Workeri. `pripoj` overí údaje z formulára a nájde elektrárne, `meraj`
 * vráti meranie; ak sa pri ňom prístup obnovil (nový token), aj nový `pristup` na zapečatenie.
 * `zPecate` vytiahne zo starého prístupu údaje formulára, ktoré pri obnove netreba zadávať znova
 * (Deye: všetko okrem hesla).
 * @typedef {{
 *   pripoj: (udaje: Record<string, string>, ctx: Ctx) => Promise<Najdena[]>,
 *   meraj: (pristup: Record<string, unknown>, ctx: Ctx) => Promise<{ pv: PvData, pristup?: Record<string, unknown> }>,
 *   zPecate?: (pristup: Record<string, unknown>) => Record<string, string>,
 * }} Zdroj
 */

/**
 * Chyba pripojenia či merania s druhom, ktorý appka ukáže: `udaje` výrobca údaje neprijal (alebo
 * nie sú v poriadku), `vyrobca` výrobca neodpovedá či vrátil nezmysel. `kod` je krok a kód chyby
 * od výrobcu (napr. `prihlasenie:20400`, `zoznam:HTTP 403`) - nič tajné, len aby appka vedela
 * povedať, čo presne výrobca odmietol.
 */
export class ZdrojChyba extends Error {
    /** @param {'udaje' | 'vyrobca'} druh @param {string} [kod] */
    constructor(druh, kod = '') {
        super(kod ? `${druh} ${kod}` : druh);
        this.druh = druh;
        this.kod = kod;
    }
}

/** Kiosk FusionSolar z odkazu: stiahne a prevedie ho. @param {string} url adresa dát (kioskApiUrl) @param {Ctx} ctx */
async function kiosk(url, ctx) {
    /** @type {Response} */ let res;
    try {
        res = await fetchWithRetry(url, {}, { ...VYROBCA_RETRY, fetchImpl: ctx.fetchImpl });
    } catch {
        throw new ZdrojChyba('vyrobca');
    }
    try {
        return parseKiosk(await res.json(), ctx.now);
    } catch {
        // Kiosk s neplatným kľúčom odpovedá 200, len bez dát.
        throw new ZdrojChyba('udaje');
    }
}

// Najviac toľko elektrární ukáže pripojenie - viac by sa do limitu appky nestihlo načítať.
const MAX_STANIC = 10;

/** Text z prístupu (zapečateného alebo z formulára); čokoľvek iné je prázdny reťazec. @param {unknown} v */
const str = (v) => (typeof v === 'string' ? v : '');

/**
 * JSON z adresy výrobcu, s opakovaním pri prechodnej chybe. Zamietnutý prístup (401, 403) sú zlé
 * údaje, ostatné zlyhania výpadok výrobcu. `krok` sa pribalí ku kódu chyby.
 * @param {string} url @param {RequestInit} init @param {Ctx} ctx @param {string} [krok] @returns {Promise<unknown>}
 */
async function getJson(url, init, ctx, krok = '') {
    try {
        const res = await fetchWithRetry(url, init, { ...VYROBCA_RETRY, fetchImpl: ctx.fetchImpl });
        return await res.json();
    } catch (err) {
        const http = /HTTP (\d{3})/.exec(String(err));
        const kod = krok && http ? `${krok}:HTTP ${http[1]}` : krok;
        throw new ZdrojChyba(http && /^40[13]$/.test(http[1]) ? 'udaje' : 'vyrobca', kod);
    }
}

/**
 * Prevod odpovede výrobcu; čo sa prečítať nedá, sú zlé údaje (výrobca odpovedal, len nie tým,
 * čo appka žiadala - typicky neplatný kľúč).
 * @template T @param {() => T} fn @param {string} [krok] @returns {T}
 */
function prevod(fn, krok = '') {
    try {
        return fn();
    } catch (err) {
        throw prevodChyba(err, krok);
    }
}

/** Chyba výrobcu ako ZdrojChyba s krokom a kódom (ZdrojChyba prepustí). @param {unknown} err @param {string} [krok] */
function prevodChyba(err, krok = '') {
    if (err instanceof ZdrojChyba) return err;
    // Či výrobca údaje zamietol, alebo len pribrzdil či vypadol, vie jeho chyba (shared/vyrobca.js).
    const vyrobca = err instanceof VyrobcaChyba ? err : null;
    const druh = !vyrobca || vyrobca.zamietol ? 'udaje' : 'vyrobca';
    return new ZdrojChyba(druh, krok && vyrobca?.kod ? `${krok}:${vyrobca.kod}` : krok);
}

/** Požiadavka na Fox ESS podpísaná kľúčom. @param {string} path @param {string} kluc @param {Ctx} ctx @param {unknown} [body] @param {string} [query] */
function fox(path, kluc, ctx, body, query = '') {
    const init = {
        method: body ? 'POST' : 'GET',
        headers: foxHeaders(path, kluc, ctx.now.getTime()),
        body: body ? JSON.stringify(body) : undefined,
    };
    return getJson(`${FOXESS.base}${path}${query}`, init, ctx);
}

/** Meranie jedného meniča Fox ESS: výkon a súčty naraz, nie po sebe. @param {string} kluc @param {string} sn @param {string} nazov @param {Ctx} ctx */
async function foxPv(kluc, sn, nazov, ctx) {
    const [real, gen] = await Promise.all([
        fox(FOXESS.real, kluc, ctx, { sns: [sn], variables: ['pvPower'] }),
        fox(FOXESS.generation, kluc, ctx, undefined, `?sn=${encodeURIComponent(sn)}`),
    ]);
    return prevod(() => parseFoxPv(real, gen, nazov, ctx.now));
}

/** Diagnostika inštalácie Victron ako meranie. @param {string} token @param {number} idSite @param {string} nazov @param {Ctx} ctx */
async function victronPv(token, idSite, nazov, ctx) {
    const json = await getJson(`${VICTRON.base}${VICTRON.diagnostics(idSite)}`, { headers: victronHeaders(token) }, ctx);
    return prevod(() => parseVictronPv(json, nazov, ctx.now));
}

/** SolaX: meranie z tokenu a registračného čísla modulu. @param {unknown} token @param {unknown} sn @param {Ctx} ctx */
async function solaxPv(token, sn, ctx) {
    const url = solaxUrl(token, sn);
    if (!url) throw new ZdrojChyba('udaje');
    const json = await getJson(url, {}, ctx);
    return prevod(() => parseSolax(json, ctx.now));
}

// ---- Huawei Northbound ---------------------------------------------------------------

/**
 * Elektráreň Northbound: id, meno a meniče po typoch (`{ 1: [id…] }`), ako ich vrátil zoznam
 * zariadení pri pripojení. @typedef {{ plant: string, nazov: string, devs: Record<string, number[]> }} NbPlant
 */

/**
 * Relácia Northbound: token z hlavičky `xsrf-token` a cookies, ktoré server pri prihlásení nastavil
 * (Huawei CloudWAF a relácia) - posielajú sa s každým ďalším dopytom, ako to robí prehliadač či
 * bežný HTTP klient.
 * @typedef {{ token: string, cookie: string }} NbRelacia
 */

/** Cookies z odpovede ako hlavička Cookie (len meno=hodnota). @param {Response} res */
function cookiesOf(res) {
    const all = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    return all
        .map((c) => c.split(';')[0].trim())
        .filter((c) => /^[^=\s]+=/.test(c))
        .join('; ');
}

/**
 * Prihlásenie: token je v hlavičke `xsrf-token` odpovede. Huawei dovolí 5 prihlásení za 10 minút,
 * preto ho Worker drží v pečati a nový si pýta, až keď starý vyprší.
 * @param {string} server @param {string} meno @param {string} heslo @param {Ctx} ctx @returns {Promise<NbRelacia>}
 */
async function nbLogin(server, meno, heslo, ctx) {
    /** @type {Response} */ let res;
    try {
        const init = {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ userName: meno, systemCode: heslo }),
        };
        res = await fetchWithRetry(`https://${server}${NB.login}`, init, { ...VYROBCA_RETRY, fetchImpl: ctx.fetchImpl });
    } catch (err) {
        const http = /HTTP (\d{3})/.exec(String(err));
        throw new ZdrojChyba('vyrobca', http ? `prihlasenie:HTTP ${http[1]}` : 'prihlasenie');
    }
    const json = await res.json().catch(() => null);
    prevod(() => checkNbLogin(json), 'prihlasenie');
    const token = res.headers.get('xsrf-token');
    if (!token) throw new ZdrojChyba('vyrobca', 'prihlasenie:bez tokenu');
    return { token, cookie: cookiesOf(res) };
}

/** Spojenie so serverom Northbound: server, relácia a kontext. @typedef {{ server: string, rel: NbRelacia, ctx: Ctx }} NbSpoj */

/** Požiadavka s reláciou; neúspech (aj 305 „nie si prihlásený“) ostáva VyrobcaChyba pre volajúceho.
 * @param {NbSpoj} sp @param {string} path @param {unknown} body @param {string} krok */
function nbPost(sp, path, body, krok) {
    /** @type {Record<string, string>} */
    const headers = { 'content-type': 'application/json', 'xsrf-token': sp.rel.token };
    if (sp.rel.cookie) headers.cookie = sp.rel.cookie;
    return getJson(`https://${sp.server}${path}`, { method: 'POST', headers, body: JSON.stringify(body) }, sp.ctx, krok);
}

/**
 * Elektrárne na účte: nové rozhranie `stations`, a keď ho účet nemá povolené či server nepozná,
 * staršie `getStationList` (oficiálna referencia, kapitola Historical Interfaces) - niektoré účty
 * a integrácie (napr. Shelly) používajú práve to.
 * @param {NbSpoj} sp
 */
async function nbStanice(sp) {
    /** @type {unknown} */ let chyba;
    try {
        const nove = await nbPost(sp, NB.stations, { pageNo: 1 }, 'zoznam');
        return prevod(() => parseNbStations(nove), 'zoznam');
    } catch (err) {
        // Relácia skončila či priveľa dopytov: staršie rozhranie by dopadlo rovnako.
        if (err instanceof ZdrojChyba && /:(305|407)$/.test(err.kod)) throw err;
        chyba = err;
    }
    try {
        const stare = await nbPost(sp, NB.stationsOld, {}, 'zoznam');
        return prevod(() => parseNbStations(stare), 'zoznam');
    } catch {
        // Nevyšlo ani staršie: appka ukáže chybu nového rozhrania.
        throw chyba;
    }
}

/**
 * Meranie elektrární naraz: jeden dopyt na súčty všetkých elektrární a jeden na typ meniča -
 * Huawei dovolí každý len raz za 5 minút, nech elektrární je koľko chce (do 100).
 * @param {NbSpoj} sp @param {NbPlant[]} plants
 * @returns {Promise<Map<string, import('../../shared/kiosk.js').PvData>>}
 */
async function nbMeraj(sp, plants) {
    const types = [...new Set(plants.flatMap((p) => Object.keys(p.devs)))];
    const [station, ...devs] = await Promise.all([
        nbPost(sp, NB.stationReal, { stationCodes: plants.map((p) => p.plant).join(',') }, 'meranie'),
        ...types.map((t) =>
            nbPost(sp, NB.devReal, { devIds: plants.flatMap((p) => p.devs[t] ?? []).join(','), devTypeId: Number(t) }, 'meranie'),
        ),
    ]);
    return new Map(
        plants.map((p) => [
            p.plant,
            nbPv(parseNbDevReal(devs, Object.values(p.devs).flat()), parseNbStationReal(station, p.plant), p.nazov, sp.ctx.now),
        ]),
    );
}

/** Prístup Northbound zo zapečateného objektu. @param {Record<string, unknown>} p */
function nbPristup(p) {
    const devs = p.devs && typeof p.devs === 'object' ? /** @type {Record<string, number[]>} */ (p.devs) : {};
    return {
        server: nbServer(p.server),
        meno: str(p.meno),
        heslo: str(p.heslo),
        token: str(p.token),
        cookie: str(p.cookie),
        tokenAt: Number(p.tokenAt) || 0,
        plant: { plant: str(p.plant), nazov: str(p.nazov), devs },
    };
}

// ---- Solis ----------------------------------------------------------------------------

/** base64 bajtov. @param {ArrayBuffer} buf */
const base64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

/**
 * Zoznam elektrární SolisCloud s meraním. Požiadavka je podpísaná HmacSHA1 kľúčom API Secret
 * podľa dokumentácie (Authorization: API {apiId}:{sign}).
 * @param {string} keyId @param {string} secret @param {Ctx} ctx
 */
async function solisStations(keyId, secret, ctx) {
    if (!keyId || !secret) throw new ZdrojChyba('udaje');
    const body = JSON.stringify({ pageNo: 1, pageSize: 100 });
    const req = solisRequest(SOLIS.stations, body, ctx.now);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const sign = base64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(req.toSign)));
    const json = await getJson(
        `${SOLIS.base}${SOLIS.stations}`,
        { method: 'POST', headers: { ...req.headers, authorization: `API ${keyId}:${sign}` }, body },
        ctx,
        'zoznam',
    );
    return prevod(() => parseSolisStations(json, ctx.now), 'zoznam');
}

// ---- Deye ------------------------------------------------------------------------------

/** SHA-256 hesla ako malé šestnástkové znaky - DeyeCloud ho tak vyžaduje. @param {string} heslo */
async function sha256Hex(heslo) {
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(heslo)));
    return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Požiadavka DeyeCloud s tokenom. @param {string} path @param {string} token @param {unknown} body @param {Ctx} ctx @param {string} krok */
function deye(path, token, body, ctx, krok) {
    const init = {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
    };
    return getJson(`${DEYE.base}${path}`, init, ctx, krok);
}

/**
 * Meranie elektrárne Deye: výkon a dnešná výroba naraz. Elektráreň: id, meno, inštalovaný výkon
 * (na jednotku výkonu) a časové pásmo (na „dnes“).
 * @param {string} token @param {{ id: number, nazov: string, kwp: number | null, tz: string }} st @param {Ctx} ctx
 */
async function deyeMeraj(token, st, ctx) {
    const [latest, history] = await Promise.all([
        deye(DEYE.latest, token, { stationId: st.id }, ctx, 'meranie'),
        deye(DEYE.history, token, { stationId: st.id, granularity: 2, ...deyeToday(ctx.now, st.tz) }, ctx, 'meranie'),
    ]);
    return prevod(() => deyePv(deyeKw(parseDeyeLatest(latest), st.kwp), parseDeyeDay(history), st.nazov, ctx.now), 'meranie');
}

/** Časové pásmo elektrárne, ktoré Intl pozná; inak stredoeurópske. @param {unknown} tz */
function pasmo(tz) {
    try {
        if (typeof tz === 'string' && tz) return new Intl.DateTimeFormat('en', { timeZone: tz }).resolvedOptions().timeZone;
    } catch {
        // neznáme pásmo
    }
    return 'Europe/Bratislava';
}

/** @type {Record<string, Zdroj>} */
export const ZDROJE = {
    'huawei-kiosk': {
        async pripoj(udaje, ctx) {
            const url = kioskApiUrl(udaje.odkaz);
            if (!url) throw new ZdrojChyba('udaje');
            const pv = await kiosk(url, ctx);
            return [{ nazov: pv.stationName ?? '', pristup: { odkaz: udaje.odkaz }, pv }];
        },
        async meraj(pristup, ctx) {
            const url = kioskApiUrl(pristup.odkaz);
            if (!url) throw new ZdrojChyba('udaje');
            return { pv: await kiosk(url, ctx) };
        },
    },
    'huawei-northbound': {
        async pripoj(udaje, ctx) {
            const server = nbServer(udaje.server);
            if (!server || !udaje.meno || !udaje.heslo) throw new ZdrojChyba('udaje');
            const rel = await nbLogin(server, udaje.meno, udaje.heslo, ctx);
            const tokenAt = ctx.now.getTime();
            const sp = { server, rel, ctx };
            const stanice = (await nbStanice(sp)).slice(0, MAX_STANIC);
            if (!stanice.length) return [];
            const devJson = await nbPost(sp, NB.devList, { stationCodes: stanice.map((st) => st.plant).join(',') }, 'zariadenia');
            const devs = prevod(() => parseNbDevices(devJson), 'zariadenia');
            const plants = stanice.map((st) => ({ ...st, devs: devs[st.plant] ?? {} }));
            const pv = await nbMeraj(sp, plants).catch(() => null);
            return plants.map((p) => ({
                nazov: p.nazov,
                pristup: { server, meno: udaje.meno, heslo: udaje.heslo, ...rel, tokenAt, ...p },
                pv: pv?.get(p.plant) ?? null,
            }));
        },
        async meraj(pristup, ctx) {
            const p = nbPristup(pristup);
            if (!p.server || !p.meno || !p.heslo || !p.plant.plant) throw new ZdrojChyba('udaje');
            const server = p.server;
            let rel = { token: p.token, cookie: p.cookie };
            let tokenAt = p.tokenAt;
            let novy = false;
            const prihlas = async () => {
                rel = await nbLogin(server, p.meno, p.heslo, ctx);
                tokenAt = ctx.now.getTime();
                novy = true;
            };
            if (!rel.token || ctx.now.getTime() - tokenAt > NB.tokenMs) await prihlas();
            /** @returns {Promise<import('../../shared/kiosk.js').PvData>} */
            const meraj = async () => /** @type {any} */ ((await nbMeraj({ server, rel, ctx }, [p.plant])).get(p.plant.plant));
            /** @type {import('../../shared/kiosk.js').PvData} */ let pv;
            try {
                pv = await meraj();
            } catch (err) {
                // Token mohol vypršať skôr (Huawei odhlásil reláciu): raz sa prihlási znova.
                if (!(err instanceof VyrobcaChyba && err.kod === String(NB.notLoggedIn)) || novy) throw prevodChyba(err, 'meranie');
                await prihlas();
                pv = await meraj().catch((e) => Promise.reject(prevodChyba(e, 'meranie')));
            }
            return novy ? { pv, pristup: { ...pristup, ...rel, tokenAt } } : { pv };
        },
    },
    'solis-kluc': {
        async pripoj(udaje, ctx) {
            const stanice = await solisStations(str(udaje.keyId), str(udaje.secret), ctx);
            return stanice.slice(0, MAX_STANIC).map((st) => ({
                nazov: st.nazov,
                pristup: { keyId: udaje.keyId, secret: udaje.secret, id: st.id },
                pv: st.pv,
            }));
        },
        async meraj(pristup, ctx) {
            const st = (await solisStations(str(pristup.keyId), str(pristup.secret), ctx)).find((x) => x.id === str(pristup.id));
            if (!st) throw new ZdrojChyba('udaje');
            return { pv: st.pv };
        },
    },
    'deye-aplikacia': {
        async pripoj(udaje, ctx) {
            const [appId, appSecret, email, heslo] = [str(udaje.appId), str(udaje.appSecret), str(udaje.email), str(udaje.heslo)];
            if (!appId || !appSecret || !email || !heslo) throw new ZdrojChyba('udaje');
            const init = {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ appSecret, email, password: await sha256Hex(heslo) }),
            };
            const tokenJson = await getJson(`${DEYE.base}${DEYE.token(appId)}`, init, ctx, 'prihlasenie');
            const token = prevod(() => parseDeyeToken(tokenJson), 'prihlasenie');
            const platiDo = new Date(ctx.now.getTime() + DEYE.tokenMs).toISOString();
            const stationsJson = await deye(DEYE.stations, token, { page: 1, size: MAX_STANIC }, ctx, 'zoznam');
            const list = prevod(() => parseDeyeStations(stationsJson), 'zoznam');
            return Promise.all(
                list.slice(0, MAX_STANIC).map(async (st) => {
                    const stanica = { id: st.id, nazov: st.nazov, kwp: st.kwp, tz: pasmo(st.tz) };
                    return {
                        nazov: st.nazov,
                        // Heslo sa neukladá - v pečati je token (60 dní), čo treba o elektrárni a údaje
                        // aplikácie s e-mailom, aby na obnovu tokenu stačilo zadať heslo.
                        pristup: { token, appId, appSecret, email, ...stanica },
                        pv: await deyeMeraj(token, stanica, ctx).catch(() => null),
                        platiDo,
                    };
                }),
            );
        },
        zPecate: (p) => ({ appId: str(p.appId), appSecret: str(p.appSecret), email: str(p.email) }),
        async meraj(pristup, ctx) {
            const id = Number(pristup.id);
            if (!str(pristup.token) || !Number.isSafeInteger(id)) throw new ZdrojChyba('udaje');
            const kwp = typeof pristup.kwp === 'number' ? pristup.kwp : null;
            return { pv: await deyeMeraj(str(pristup.token), { id, nazov: str(pristup.nazov), kwp, tz: pasmo(pristup.tz) }, ctx) };
        },
    },
    'foxess-kluc': {
        async pripoj(udaje, ctx) {
            const kluc = str(udaje.kluc);
            if (!kluc) throw new ZdrojChyba('udaje');
            const list = await fox(FOXESS.list, kluc, ctx, { currentPage: 1, pageSize: MAX_STANIC });
            const menice = prevod(() => parseFoxList(list));
            return Promise.all(
                menice.slice(0, MAX_STANIC).map(async (m) => ({
                    nazov: m.nazov,
                    pristup: { kluc, sn: m.sn, nazov: m.nazov },
                    pv: await foxPv(kluc, m.sn, m.nazov, ctx).catch(() => null),
                })),
            );
        },
        async meraj(pristup, ctx) {
            return { pv: await foxPv(str(pristup.kluc), str(pristup.sn), str(pristup.nazov), ctx) };
        },
    },
    'solax-token': {
        async pripoj(udaje, ctx) {
            const pv = await solaxPv(udaje.token, udaje.sn, ctx);
            return [{ nazov: '', pristup: { token: udaje.token, sn: udaje.sn }, pv }];
        },
        async meraj(pristup, ctx) {
            return { pv: await solaxPv(pristup.token, pristup.sn, ctx) };
        },
    },
    'victron-token': {
        async pripoj(udaje, ctx) {
            const token = str(udaje.token);
            if (!token) throw new ZdrojChyba('udaje');
            const headers = victronHeaders(token);
            const idUser = parseVictronMe(await getJson(`${VICTRON.base}${VICTRON.me}`, { headers }, ctx));
            if (idUser === null) throw new ZdrojChyba('udaje');
            const sites = parseVictronSites(await getJson(`${VICTRON.base}${VICTRON.installations(idUser)}`, { headers }, ctx));
            return Promise.all(
                sites.slice(0, MAX_STANIC).map(async (site) => ({
                    nazov: site.nazov,
                    pristup: { token, idSite: site.idSite, nazov: site.nazov },
                    pv: await victronPv(token, site.idSite, site.nazov, ctx).catch(() => null),
                })),
            );
        },
        async meraj(pristup, ctx) {
            const idSite = Number(pristup.idSite);
            if (!Number.isInteger(idSite)) throw new ZdrojChyba('udaje');
            return { pv: await victronPv(str(pristup.token), idSite, str(pristup.nazov), ctx) };
        },
    },
};
