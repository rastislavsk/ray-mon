// Zdroje živého merania vo Workeri: pre každý spôsob pripojenia (shared/zdroje.js) ako sa
// pripojiť a ako merať. Sieť je len tu - prevod odpovedí výrobcu na formát `pv` je v shared/,
// aby sa dal testovať. Worker sa pýta len serverov výrobcu, nikdy adresy od používateľa.

import { SITE, VYROBCA_RETRY } from '../../shared/config.js';
import {
    DEYE,
    deyeKw,
    deyePv,
    deyeToday,
    parseDeyeDay,
    parseDeyeFrames,
    parseDeyeLatest,
    parseDeyeStations,
    parseDeyeToken,
} from '../../shared/deye.js';
import { FOXESS, foxHeaders, parseFoxHistory, parseFoxList, parseFoxPv } from '../../shared/foxess.js';
import {
    checkNbLogin,
    NB,
    nbPv,
    nbServer,
    parseNbDevDns,
    parseNbDevices,
    parseNbDevReal,
    parseNbHistory,
    parseNbStationReal,
    parseNbStations,
    parseNbStationYear,
} from '../../shared/huawei-nb.js';
import { kioskApiUrl, parseKiosk } from '../../shared/kiosk.js';
import { parseSolax, solaxUrl } from '../../shared/solax.js';
import { KRIVKA, krivkaDnes, polnoc } from '../../shared/krivka.js';
import { localDateKey } from '../../shared/solar.js';
import { parseSolisDay, parseSolisStations, SOLIS, solisRequest } from '../../shared/solis.js';
import { VyrobcaChyba } from '../../shared/vyrobca.js';
import { parseVictronMe, parseVictronPv, parseVictronSites, parseVictronYield, VICTRON, victronHeaders } from '../../shared/victron.js';
import { fetchWithRetry } from './http.js';

/** @typedef {import('../../shared/kiosk.js').PvData} PvData */
/** @typedef {import('../../shared/krivka.js').Krivka} Krivka */
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
 * Meranie s krivkou dňa (shared/krivka.js): priebeh dňa (`stiahni`) najviac raz za KRIVKA.ms - čas
 * pokusu a krivka sa zapečatia -, medzitým posledná zapečatená krivka a za ňou aktuálny výkon.
 * Zlyhanie histórie meranie nezastaví: ostane posledná krivka a ďalší pokus o KRIVKA.ms.
 * @param {Record<string, unknown>} pristup @param {PvData} pv @param {Ctx} ctx @param {string} tz pásmo elektrárne
 * @param {() => Promise<Krivka>} stiahni @returns {Promise<{ pv: PvData, pristup?: Record<string, unknown> }>}
 */
async function sKrivkou(pristup, pv, ctx, tz, stiahni) {
    const now = ctx.now.getTime();
    const na = now - (Number(pristup.krivkaAt) || 0) >= KRIVKA.ms;
    const nova = na ? await stiahni().catch(() => null) : null;
    const krivka = nova ?? /** @type {Krivka | null} */ (pristup.krivka ?? null);
    const s = { ...pv, realCurveToday: krivkaDnes(krivka, pv.realTimePowerKw, ctx.now, tz) };
    return na ? { pv: s, pristup: { ...pristup, krivkaAt: now, krivka } } : { pv: s };
}

/**
 * Elektráreň z pripojenia s krivkou dňa hneď od začiatku (sKrivkou); bez merania aj bez krivky.
 * @param {Najdena} n @param {Ctx} ctx @param {string} tz @param {() => Promise<Krivka>} stiahni @returns {Promise<Najdena>}
 */
async function najdenaSKrivkou(n, ctx, tz, stiahni) {
    if (!n.pv) return n;
    const r = await sKrivkou(n.pristup, n.pv, ctx, tz, stiahni);
    return { ...n, pv: r.pv, pristup: r.pristup ?? n.pristup };
}

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

/** Priebeh dňa meniča Fox ESS (`pvPower`) od polnoci po teraz. @param {string} kluc @param {string} sn @param {Ctx} ctx */
async function foxKrivka(kluc, sn, ctx) {
    const json = await fox(FOXESS.history, kluc, ctx, {
        sn,
        variables: ['pvPower'],
        begin: polnoc(ctx.now, SITE.timezone),
        end: ctx.now.getTime(),
    });
    return parseFoxHistory(json, ctx.now, SITE.timezone);
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

/** Priebeh dňa inštalácie Victron (výroba panelov po 15 minútach) od polnoci po teraz. @param {string} token @param {number} idSite @param {Ctx} ctx */
async function victronKrivka(token, idSite, ctx) {
    const sek = (/** @type {number} */ ms) => Math.floor(ms / 1000);
    const path = VICTRON.solarYield(idSite, sek(polnoc(ctx.now, SITE.timezone)), sek(ctx.now.getTime()));
    return parseVictronYield(await getJson(`${VICTRON.base}${path}`, { headers: victronHeaders(token) }, ctx), ctx.now, SITE.timezone);
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
 * Elektráreň Northbound: id, meno a meniče po typoch - číselné id (`devs`, `{ 1: [id…] }`) pre
 * meranie a textové `devDn` (`dns`) pre priebeh dňa -, ako ich vrátil zoznam zariadení.
 * @typedef {{ plant: string, nazov: string, devs: Record<string, number[]>, dns: Record<string, string[]> }} NbPlant
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

/**
 * Elektrárne na účte Northbound s reláciou z prihlásenia: zoznam, meniče a čo práve namerali.
 * @param {string} server @param {NbRelacia} rel @param {Record<string, string>} udaje @param {Ctx} ctx
 * @returns {Promise<Najdena[]>}
 */
async function nbNajdi(server, rel, udaje, ctx) {
    const tokenAt = ctx.now.getTime();
    const sp = { server, rel, ctx };
    const stanice = (await nbStanice(sp)).slice(0, MAX_STANIC);
    if (!stanice.length) return [];
    const devJson = await nbPost(sp, NB.devList, { stationCodes: stanice.map((st) => st.plant).join(',') }, 'zariadenia');
    const devs = prevod(() => parseNbDevices(devJson), 'zariadenia');
    const dns = prevod(() => parseNbDevDns(devJson), 'zariadenia');
    const plants = stanice.map((st) => ({ ...st, devs: devs[st.plant] ?? {}, dns: dns[st.plant] ?? {} }));
    const pv = await nbMeraj(sp, plants).catch(() => null);
    const rok = await nbRok(sp, plants);
    // Priebeh dňa hneď pri pripojení, nech je v grafe od prvého merania.
    /** @type {Map<string, Krivka | null>} */ const krivky = new Map();
    for (const p of plants) if (Object.keys(p.dns).length) krivky.set(p.plant, await nbKrivka(sp, p));
    return plants.map((p) => {
        const zmerane = pv?.get(p.plant);
        const krivka = krivky.get(p.plant) ?? null;
        return {
            nazov: p.nazov,
            pristup: {
                server,
                meno: udaje.meno,
                heslo: udaje.heslo,
                ...rel,
                tokenAt,
                rokAt: tokenAt,
                ...p,
                ...(krivky.has(p.plant) ? { krivkaAt: tokenAt, krivka } : {}),
            },
            pv: zmerane
                ? {
                      ...zmerane,
                      yearEnergyKwh: rok.get(p.plant) ?? null,
                      realCurveToday: krivkaDnes(krivka, zmerane.realTimePowerKw, ctx.now, NB.pasmo),
                  }
                : null,
        };
    });
}

/**
 * Tohtoročná výroba elektrární z getKpiStationYear, jedným dopytom. Reálne dáta rok nemajú a toto
 * rozhranie má limit 25 dopytov denne - pýta sa pri pripojení a potom najviac raz za NB.rokMs
 * (`rokAt` v pečati). Zlyhanie meranie nezastaví (účet napr. nemá rozhranie povolené): rok potom
 * appka dorátava z celkovej výroby (shared/sucty.js).
 * @param {NbSpoj} sp @param {NbPlant[]} plants @returns {Promise<Map<string, number | null>>}
 */
async function nbRok(sp, plants) {
    try {
        const body = { stationCodes: plants.map((p) => p.plant).join(','), collectTime: sp.ctx.now.getTime() };
        const json = await nbPost(sp, NB.stationYear, body, 'rok');
        return new Map(plants.map((p) => [p.plant, parseNbStationYear(json, p.plant, sp.ctx.now)]));
    } catch {
        return new Map();
    }
}

/**
 * Meniče elektrárne, ktorá ich v pečati nemá - pripojenej skôr, než appka poznala menič s batériou
 * (23093) či priebeh dňa (`devDn`). Zoznam zariadení má limit 25 denne, preto sa pýta raz: volajúci
 * zapečatí čas pokusu, aj keď zoznam nevyjde. Bez neho sa meria ďalej ako doteraz.
 * @param {NbSpoj} sp @param {NbPlant} plant @returns {Promise<NbPlant>}
 */
async function nbDoplnDevs(sp, plant) {
    try {
        const json = await nbPost(sp, NB.devList, { stationCodes: plant.plant }, 'zariadenia');
        return { ...plant, devs: parseNbDevices(json)[plant.plant] ?? {}, dns: parseNbDevDns(json)[plant.plant] ?? {} };
    } catch {
        return plant;
    }
}

/**
 * Priebeh dňa meničov elektrárne z historického rozhrania: jeden dopyt na menič, od polnoci (v pásme
 * elektrárne) po teraz. Zlyhanie meranie nezastaví (účet napr. rozhranie nemá povolené, limit 407):
 * vráti null a appka dostane poslednú zapečatenú krivku.
 * @param {NbSpoj} sp @param {NbPlant} plant @returns {Promise<Krivka | null>}
 */
async function nbKrivka(sp, plant) {
    const now = sp.ctx.now.getTime();
    const startTime = polnoc(sp.ctx.now, NB.pasmo);
    try {
        const jsons = [];
        for (const [typ, dns] of Object.entries(plant.dns))
            for (const devDn of dns)
                jsons.push(await nbPost(sp, NB.devHistory, { devDn, devTypeId: Number(typ), startTime, endTime: now }, 'krivka'));
        return parseNbHistory(jsons, sp.ctx.now);
    } catch {
        return null;
    }
}

/**
 * Čo si meranie elektrárne vypýta navyše: zoznam zariadení raz, keď v pečati chýbajú meniče či ich
 * devDn (nbDoplnDevs), rok najviac raz za NB.rokMs (nbRok) a priebeh dňa najviac raz za KRIVKA.ms
 * (nbKrivka). Hodnota je čas dopytu na zapečatenie, 0 = nepýta sa.
 * @param {Record<string, unknown>} pristup @param {NbPlant} plant @param {number} now
 */
function nbPlan(pristup, plant, now) {
    const chyba = (/** @type {'devs' | 'dns'} */ k, /** @type {string} */ at) => !Object.keys(plant[k]).length && !Number(pristup[at]);
    return {
        devsAt: chyba('devs', 'devsAt') || chyba('dns', 'dnsAt') ? now : 0,
        rokAt: now - (Number(pristup.rokAt) || 0) >= NB.rokMs ? now : 0,
        krivkaAt: now - (Number(pristup.krivkaAt) || 0) >= KRIVKA.ms ? now : 0,
    };
}

/**
 * Meranie elektrárne a podľa plánu aj rok a priebeh dňa (ten len pri meničoch s devDn).
 * @param {NbSpoj} sp @param {NbPlant} plant @param {ReturnType<typeof nbPlan>} plan
 */
async function nbMerajPodlaPlanu(sp, plant, plan) {
    const pv = /** @type {PvData} */ ((await nbMeraj(sp, [plant])).get(plant.plant));
    const krivkaAt = Object.keys(plant.dns).length ? plan.krivkaAt : 0;
    const krivka = krivkaAt ? await nbKrivka(sp, plant) : null;
    if (plan.rokAt) pv.yearEnergyKwh = (await nbRok(sp, [plant])).get(plant.plant) ?? null;
    return { pv, krivka, krivkaAt };
}

/**
 * Dopyt s reláciou zo zapečateného prístupu. Token starší než NB.tokenMs vymení vopred; keď ho
 * Huawei zrušil skôr (305), prihlási sa raz znova a dopyt zopakuje. `relacia` je nový token
 * s časom prihlásenia na zapečatenie, alebo null, keď sa neprihlasoval.
 * @template T
 * @param {ReturnType<typeof nbPristup>} p prístup s overeným serverom @param {Ctx} ctx @param {(sp: NbSpoj) => Promise<T>} fn
 * @returns {Promise<{ vysledok: T, relacia: (NbRelacia & { tokenAt: number }) | null }>}
 */
async function nbSRelaciou(p, ctx, fn) {
    const server = /** @type {string} */ (p.server);
    /** @type {(NbRelacia & { tokenAt: number }) | null} */ let relacia = null;
    let rel = { token: p.token, cookie: p.cookie };
    const prihlas = async () => {
        rel = await nbLogin(server, p.meno, p.heslo, ctx);
        relacia = { ...rel, tokenAt: ctx.now.getTime() };
    };
    if (!rel.token || ctx.now.getTime() - p.tokenAt > NB.tokenMs) await prihlas();
    try {
        return { vysledok: await fn({ server, rel, ctx }), relacia };
    } catch (err) {
        if (!(err instanceof VyrobcaChyba && err.kod === String(NB.notLoggedIn)) || relacia) throw prevodChyba(err, 'meranie');
        await prihlas();
        const vysledok = await fn({ server, rel, ctx }).catch((e) => Promise.reject(prevodChyba(e, 'meranie')));
        return { vysledok, relacia };
    }
}

/** Prístup Northbound zo zapečateného objektu. @param {Record<string, unknown>} p */
function nbPristup(p) {
    const devs = p.devs && typeof p.devs === 'object' ? /** @type {Record<string, number[]>} */ (p.devs) : {};
    const dns = p.dns && typeof p.dns === 'object' ? /** @type {Record<string, string[]>} */ (p.dns) : {};
    return {
        server: nbServer(p.server),
        meno: str(p.meno),
        heslo: str(p.heslo),
        token: str(p.token),
        cookie: str(p.cookie),
        tokenAt: Number(p.tokenAt) || 0,
        plant: { plant: str(p.plant), nazov: str(p.nazov), devs, dns },
    };
}

// ---- Solis ----------------------------------------------------------------------------

/** base64 bajtov. @param {ArrayBuffer} buf */
const base64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

/**
 * Požiadavka SolisCloud podpísaná HmacSHA1 kľúčom API Secret podľa dokumentácie
 * (Authorization: API {apiId}:{sign}).
 * @param {string} path @param {unknown} data @param {{ keyId: string, secret: string }} kluc @param {Ctx} ctx @param {string} krok
 */
async function solis(path, data, { keyId, secret }, ctx, krok) {
    const body = JSON.stringify(data);
    const req = solisRequest(path, body, ctx.now);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const sign = base64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(req.toSign)));
    const init = { method: 'POST', headers: { ...req.headers, authorization: `API ${keyId}:${sign}` }, body };
    return getJson(`${SOLIS.base}${path}`, init, ctx, krok);
}

/** Zoznam elektrární SolisCloud s meraním. @param {string} keyId @param {string} secret @param {Ctx} ctx */
async function solisStations(keyId, secret, ctx) {
    if (!keyId || !secret) throw new ZdrojChyba('udaje');
    const json = await solis(SOLIS.stations, { pageNo: 1, pageSize: 100 }, { keyId, secret }, ctx, 'zoznam');
    return prevod(() => parseSolisStations(json, ctx.now), 'zoznam');
}

/**
 * Priebeh dňa elektrárne SolisCloud (stationDay). `tz` je posun pásma elektrárne v hodinách zo
 * zoznamu elektrární (bez neho stredoeurópsky čas).
 * @param {string} keyId @param {string} secret @param {string} id @param {unknown} tz @param {Ctx} ctx
 */
async function solisKrivka(keyId, secret, id, tz, ctx) {
    const timeZone = typeof tz === 'number' ? tz : 1;
    const body = { id, money: 'EUR', time: localDateKey(ctx.now, SITE.timezone), timeZone };
    return parseSolisDay(await solis(SOLIS.stationDay, body, { keyId, secret }, ctx, 'krivka'), ctx.now, SITE.timezone);
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
 * Priebeh dňa elektrárne Deye (/station/history s `granularity: 1`) v jej pásme.
 * @param {string} token @param {{ id: number, kwp: number | null, tz: string }} st @param {Ctx} ctx
 */
async function deyeKrivka(token, st, ctx) {
    const json = await deye(
        DEYE.history,
        token,
        { stationId: st.id, granularity: 1, startAt: localDateKey(ctx.now, st.tz) },
        ctx,
        'krivka',
    );
    return parseDeyeFrames(json, st.kwp, ctx.now, st.tz);
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
            const prihlas = () => nbLogin(server, udaje.meno, udaje.heslo, ctx);
            try {
                return await nbNajdi(server, await prihlas(), udaje, ctx);
            } catch (err) {
                // Huawei prihlásenie medzitým zrušil (305) - ten istý účet sa prihlásil aj inde, napr.
                // meranie v druhej appke. Raz sa prihlási znova; nové prihlásenie zruší to druhé.
                if (!(err instanceof ZdrojChyba && /:305$/.test(err.kod))) throw err;
                return nbNajdi(server, await prihlas(), udaje, ctx);
            }
        },
        async meraj(pristup, ctx) {
            const p = nbPristup(pristup);
            if (!p.server || !p.meno || !p.heslo || !p.plant.plant) throw new ZdrojChyba('udaje');
            const plan = nbPlan(pristup, p.plant, ctx.now.getTime());
            // Zoznam zariadení len raz, aj keď sa po zrušenej relácii (305) meria znova.
            /** @type {NbPlant | null} */ let plant = null;
            const { vysledok, relacia } = await nbSRelaciou(p, ctx, async (sp) => {
                plant ??= plan.devsAt ? await nbDoplnDevs(sp, p.plant) : p.plant;
                return nbMerajPodlaPlanu(sp, plant, plan);
            });
            const { pv, krivkaAt } = vysledok;
            const zariadenia = /** @type {NbPlant} */ (/** @type {unknown} */ (plant));
            // Medzi dopytmi posledná zapečatená krivka a za ňou aktuálny výkon (krivkaDnes).
            const krivka = vysledok.krivka ?? /** @type {Krivka | undefined} */ (pristup.krivka) ?? null;
            pv.realCurveToday = krivkaDnes(krivka, pv.realTimePowerKw, ctx.now, NB.pasmo);
            const zmeny = {
                ...relacia,
                ...(plan.devsAt ? { devs: zariadenia.devs, dns: zariadenia.dns, devsAt: plan.devsAt, dnsAt: plan.devsAt } : {}),
                ...(plan.rokAt ? { rokAt: plan.rokAt } : {}),
                ...(krivkaAt ? { krivkaAt, krivka } : {}),
            };
            return Object.keys(zmeny).length ? { pv, pristup: { ...pristup, ...zmeny } } : { pv };
        },
    },
    'solis-kluc': {
        async pripoj(udaje, ctx) {
            const [keyId, secret] = [str(udaje.keyId), str(udaje.secret)];
            const stanice = await solisStations(keyId, secret, ctx);
            return Promise.all(
                stanice
                    .slice(0, MAX_STANIC)
                    .map((st) =>
                        najdenaSKrivkou(
                            { nazov: st.nazov, pristup: { keyId: udaje.keyId, secret: udaje.secret, id: st.id, tz: st.tz }, pv: st.pv },
                            ctx,
                            SITE.timezone,
                            () => solisKrivka(keyId, secret, st.id, st.tz, ctx),
                        ),
                    ),
            );
        },
        async meraj(pristup, ctx) {
            const [keyId, secret] = [str(pristup.keyId), str(pristup.secret)];
            const st = (await solisStations(keyId, secret, ctx)).find((x) => x.id === str(pristup.id));
            if (!st) throw new ZdrojChyba('udaje');
            return sKrivkou(pristup, st.pv, ctx, SITE.timezone, () => solisKrivka(keyId, secret, st.id, pristup.tz ?? st.tz, ctx));
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
                    const najdena = {
                        nazov: st.nazov,
                        // Heslo sa neukladá - v pečati je token (60 dní), čo treba o elektrárni a údaje
                        // aplikácie s e-mailom, aby na obnovu tokenu stačilo zadať heslo.
                        pristup: { token, appId, appSecret, email, ...stanica },
                        pv: await deyeMeraj(token, stanica, ctx).catch(() => null),
                        platiDo,
                    };
                    return najdenaSKrivkou(najdena, ctx, stanica.tz, () => deyeKrivka(token, stanica, ctx));
                }),
            );
        },
        zPecate: (p) => ({ appId: str(p.appId), appSecret: str(p.appSecret), email: str(p.email) }),
        async meraj(pristup, ctx) {
            const id = Number(pristup.id);
            if (!str(pristup.token) || !Number.isSafeInteger(id)) throw new ZdrojChyba('udaje');
            const kwp = typeof pristup.kwp === 'number' ? pristup.kwp : null;
            const st = { id, nazov: str(pristup.nazov), kwp, tz: pasmo(pristup.tz) };
            const token = str(pristup.token);
            return sKrivkou(pristup, await deyeMeraj(token, st, ctx), ctx, st.tz, () => deyeKrivka(token, st, ctx));
        },
    },
    'foxess-kluc': {
        async pripoj(udaje, ctx) {
            const kluc = str(udaje.kluc);
            if (!kluc) throw new ZdrojChyba('udaje');
            const list = await fox(FOXESS.list, kluc, ctx, { currentPage: 1, pageSize: MAX_STANIC });
            const menice = prevod(() => parseFoxList(list));
            return Promise.all(
                menice.slice(0, MAX_STANIC).map(async (m) =>
                    najdenaSKrivkou(
                        {
                            nazov: m.nazov,
                            pristup: { kluc, sn: m.sn, nazov: m.nazov },
                            pv: await foxPv(kluc, m.sn, m.nazov, ctx).catch(() => null),
                        },
                        ctx,
                        SITE.timezone,
                        () => foxKrivka(kluc, m.sn, ctx),
                    ),
                ),
            );
        },
        async meraj(pristup, ctx) {
            const [kluc, sn] = [str(pristup.kluc), str(pristup.sn)];
            return sKrivkou(pristup, await foxPv(kluc, sn, str(pristup.nazov), ctx), ctx, SITE.timezone, () => foxKrivka(kluc, sn, ctx));
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
                sites.slice(0, MAX_STANIC).map(async (site) =>
                    najdenaSKrivkou(
                        {
                            nazov: site.nazov,
                            pristup: { token, idSite: site.idSite, nazov: site.nazov },
                            pv: await victronPv(token, site.idSite, site.nazov, ctx).catch(() => null),
                        },
                        ctx,
                        SITE.timezone,
                        () => victronKrivka(token, site.idSite, ctx),
                    ),
                ),
            );
        },
        async meraj(pristup, ctx) {
            const idSite = Number(pristup.idSite);
            if (!Number.isInteger(idSite)) throw new ZdrojChyba('udaje');
            const token = str(pristup.token);
            const pv = await victronPv(token, idSite, str(pristup.nazov), ctx);
            return sKrivkou(pristup, pv, ctx, SITE.timezone, () => victronKrivka(token, idSite, ctx));
        },
    },
};
