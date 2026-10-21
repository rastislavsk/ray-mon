// Zdroje živého merania vo Workeri: pre každý spôsob pripojenia (shared/zdroje.js) ako sa
// pripojiť a ako merať. Sieť je len tu - prevod odpovedí výrobcu na formát `pv` je v shared/,
// aby sa dal testovať. Worker sa pýta len serverov výrobcu, nikdy adresy od používateľa.

import { VYROBCA_RETRY } from '../../shared/config.js';
import { FOXESS, foxHeaders, FoxChyba, parseFoxList, parseFoxPv } from '../../shared/foxess.js';
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
 * nie sú v poriadku), `vyrobca` výrobca neodpovedá či vrátil nezmysel.
 */
export class ZdrojChyba extends Error {
    /** @param {'udaje' | 'vyrobca'} druh */
    constructor(druh) {
        super(druh);
        this.druh = druh;
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
 * údaje, ostatné zlyhania výpadok výrobcu.
 * @param {string} url @param {RequestInit} init @param {Ctx} ctx @returns {Promise<unknown>}
 */
async function getJson(url, init, ctx) {
    try {
        const res = await fetchWithRetry(url, init, { ...VYROBCA_RETRY, fetchImpl: ctx.fetchImpl });
        return await res.json();
    } catch (err) {
        throw new ZdrojChyba(/HTTP 40[13]/.test(String(err)) ? 'udaje' : 'vyrobca');
    }
}

/**
 * Prevod odpovede výrobcu; čo sa prečítať nedá, sú zlé údaje (výrobca odpovedal, len nie tým,
 * čo appka žiadala - typicky neplatný kľúč).
 * @template T @param {() => T} fn @returns {T}
 */
function prevod(fn) {
    try {
        return fn();
    } catch (err) {
        if (err instanceof ZdrojChyba) throw err;
        // Fox ESS pri príliš častých dopytoch nič nezamietol, len pribrzdil.
        throw new ZdrojChyba(err instanceof FoxChyba && err.errno === FOXESS.tooFrequent ? 'vyrobca' : 'udaje');
    }
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
