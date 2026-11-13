// POST /trasy: poloha elektrárne -> trasy autom do miest zo zoznamu (shared/trasy-mesta.js) pre podnadpis
// „km autom“ na karte Štatistika. Appka sa pýta raz pre polohu a odpoveď si odloží. Worker vyberie
// mestá, opýta sa smerovača OSRM na tabuľku vzdialeností jednou požiadavkou a vráti len id a km.
// Poloha ide v tele, nie v adrese (tá končí v logoch), a ďalej len zaokrúhlená na stotiny stupňa.
// Smerovač sa vymení v TRASY (shared/config.js) - appka o ňom nevie.

import { APP_URL } from '../../shared/config.js';
import { mestaPre, osrmAdresa, trasyZTabulky, zaokruhli } from '../../shared/trasy.js';
import { isObj } from '../../shared/valid.js';

/** Ako dlho čakať na smerovač (ms); appka čaká na Worker dlhšie (TIMEOUT.appMs). */
const OSRM_MS = 10 * 1000;

/** Poloha z tela požiadavky, alebo null. @param {string | null} body */
function polohaZ(body) {
    try {
        /** @type {unknown} */ const p = body ? JSON.parse(body) : null;
        if (!isObj(p)) return null;
        const { lat, lon } = p;
        const ok = typeof lat === 'number' && typeof lon === 'number' && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
        return ok ? zaokruhli({ lat, lon }) : null;
    } catch {
        return null;
    }
}

/**
 * @param {string | null} body telo požiadavky
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<{ status: number, body: unknown }>}
 */
export async function trasy(body, fetchImpl) {
    const doma = polohaZ(body);
    if (!doma) return { status: 400, body: { chyba: 'udaje' } };
    const mesta = mestaPre(doma);
    if (!mesta.length) return { status: 200, body: { trasy: [] } };
    try {
        const res = await fetchImpl(osrmAdresa(doma, mesta), {
            headers: { 'user-agent': `ray-mon (${APP_URL})` },
            signal: AbortSignal.timeout(OSRM_MS),
        });
        const zoznam = res.ok ? trasyZTabulky(await res.json(), mesta) : null;
        console.log(`trasy: ${zoznam ? `${zoznam.length} z ${mesta.length}` : `smerovač ${res.status}`}`);
        return zoznam ? { status: 200, body: { trasy: zoznam } } : { status: 502, body: { chyba: 'server' } };
    } catch {
        console.log('trasy: smerovač neodpovedá');
        return { status: 502, body: { chyba: 'server' } };
    }
}
