// Zdroje živého merania vo Workeri: pre každý spôsob pripojenia (shared/zdroje.js) ako sa
// pripojiť a ako merať. Sieť je len tu - prevod odpovedí výrobcu na formát `pv` je v shared/,
// aby sa dal testovať. Worker sa pýta len serverov výrobcu, nikdy adresy od používateľa.

import { KIOSK_RETRY } from '../../shared/config.js';
import { kioskApiUrl, parseKiosk } from '../../shared/kiosk.js';
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
        res = await fetchWithRetry(url, {}, { ...KIOSK_RETRY, fetchImpl: ctx.fetchImpl });
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
};
