// Zdroje živého merania vo Workeri: pre každý spôsob pripojenia (shared/zdroje.js) ako sa
// pripojiť a ako merať. Sieť je len tu - prevod odpovedí výrobcu na formát `pv` je v shared/,
// aby sa dal testovať. Worker sa pýta len serverov výrobcu, nikdy adresy od používateľa.

import { VYROBCA_RETRY } from '../../shared/config.js';
import { FOXESS, foxHeaders, FoxChyba, parseFoxList, parseFoxPv } from '../../shared/foxess.js';
import {
    checkNbLogin,
    NB,
    NbChyba,
    nbPv,
    nbServer,
    parseNbDevices,
    parseNbDevReal,
    parseNbStationReal,
    parseNbStations,
} from '../../shared/huawei-nb.js';
import { kioskApiUrl, parseKiosk } from '../../shared/kiosk.js';
import { parseSolax, solaxUrl } from '../../shared/solax.js';
import { parseVictronMe, parseVictronPv, parseVictronSites, VICTRON, victronHeaders } from '../../shared/victron.js';
import { fetchWithRetry } from './http.js';

/** @typedef {import('../../shared/kiosk.js').PvData} PvData */
/** @typedef {{ now: Date, fetchImpl: typeof fetch }} Ctx */
/**
 * Elektráreň nájdená pri pripojení: meno u výrobcu, čo treba na meranie (to sa zapečatí) a čo
 * práve namerala.
 * @typedef {{ nazov: string, pristup: Record<string, unknown>, pv: PvData | null }} Najdena
 */
/**
 * Spôsob pripojenia vo Workeri. `pripoj` overí údaje z formulára a nájde elektrárne, `meraj`
 * vráti meranie; ak sa pri ňom prístup obnovil (nový token), aj nový `pristup` na zapečatenie.
 * @typedef {{
 *   pripoj: (udaje: Record<string, string>, ctx: Ctx) => Promise<Najdena[]>,
 *   meraj: (pristup: Record<string, unknown>, ctx: Ctx) => Promise<{ pv: PvData, pristup?: Record<string, unknown> }>,
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

/** Kód chyby výrobcu z výnimky (Fox ESS errno, Huawei failCode, SolisCloud/DeyeCloud code). @param {unknown} err */
function kodOf(err) {
    if (err instanceof FoxChyba) return String(err.errno);
    if (err instanceof NbChyba) return String(err.failCode);
    return '';
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
    const kod = kodOf(err);
    return new ZdrojChyba(zleUdaje(err) ? 'udaje' : 'vyrobca', krok && kod ? `${krok}:${kod}` : krok);
}

/**
 * Zamietol výrobca údaje? Fox ESS a Huawei pri príliš častých dopytoch nič nezamietli, len
 * pribrzdili; Huawei hlási zlé prihlásenie vlastnými kódmi, ostatné jeho chyby sú výpadok.
 * @param {unknown} err
 */
function zleUdaje(err) {
    if (err instanceof FoxChyba) return err.errno !== FOXESS.tooFrequent;
    if (err instanceof NbChyba) return NB.badLogin.includes(err.failCode);
    return true;
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

/** Požiadavka s reláciou; neúspech (aj 305 „nie si prihlásený“) ostáva NbChyba pre volajúceho.
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
                if (!(err instanceof NbChyba && err.failCode === NB.notLoggedIn) || novy) throw prevodChyba(err, 'meranie');
                await prihlas();
                pv = await meraj().catch((e) => Promise.reject(prevodChyba(e, 'meranie')));
            }
            return novy ? { pv, pristup: { ...pristup, ...rel, tokenAt } } : { pv };
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
