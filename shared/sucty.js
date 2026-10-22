// Súčty, ktoré výrobca neposiela: rok a mesiac (Fox ESS, Huawei, SolaX, Victron), pri Victrone aj
// dnešok. Appka ich dopočíta z celkovej výroby (`cumulativeEnergyKwh`): pri prvom meraní v období si
// zapamätá, koľko bolo celkovo na jeho začiatku (kotva), a súčet je potom celkovo teraz mínus to.
// Súčet od výrobcu má prednosť a kotvu zároveň posunie - Huawei tak pošle rok raz za pár hodín
// a medzitým ho appka dorátava. Kým kotva nesiaha na začiatok obdobia, súčet je len od prvého
// merania: `pv.od` to povie a texty ukážu „od 21. 10.“. Bez celkovej výroby (Deye) nič.
// Čisté funkcie - úložisko rieši web/storage.js, volá ich web/refresh.js.

import { addDays } from './solar.js';
import { isObj } from './valid.js';

/** @typedef {import('./kiosk.js').PvData} PvData */
/** @typedef {'den' | 'mesiac' | 'rok'} SuctyObdobie */
/**
 * Kotva obdobia: `kluc` je obdobie (`2026`, `2026-10`, `2026-10-22`), `kwh0` súčet obdobia a `cum0`
 * celková výroba v čase kotvy. `od` je, odkiaľ súčet je - deň (rok, mesiac) či čas (deň) -, alebo
 * null, keď siaha na začiatok obdobia.
 * @typedef {{ kluc: string, kwh0: number, cum0: number, od: string | null }} Kotva
 */
/**
 * Kotvy merania. `zdroj` je kľúč merania (suctyZdroj) - po pripojení iného sa počíta odznova.
 * `posledne` je posledné meranie s celkovou výrobou: keď bolo v poslednom dni predošlého obdobia,
 * nové obdobie začína ním, nie až dnešným ránom.
 * @typedef {{ zdroj: string, posledne: { den: string, cas: string, cum: number }, rok: Kotva, mesiac: Kotva, den: Kotva }} Sucty
 */

// Po tomto čase už Victron do konca dňa nič nevyrobí: meranie po ňom stačí ako začiatok zajtrajška.
// Pre mesiac a rok stačí akékoľvek meranie v ich poslednom dni - večer je proti celému roku nepatrný.
const NOC = '21:00';

/** Pole merania, ktoré obdobie dopĺňa. */
const POLE = /** @type {const} */ ({ rok: 'yearEnergyKwh', mesiac: 'monthEnergyKwh', den: 'dailyEnergyKwh' });

/** Kľúč merania pre kotvy: spôsob a elektráreň. @param {import('./zdroje.js').Zdroj} zdroj */
export const suctyZdroj = (zdroj) => `${zdroj.sposob}|${zdroj.nazov}`;

/** Prvý deň obdobia, z ktorého je `kluc`. @param {SuctyObdobie} obd @param {string} kluc */
function zaciatok(obd, kluc) {
    if (obd === 'rok') return `${kluc}-01-01`;
    return obd === 'mesiac' ? `${kluc}-01` : kluc;
}

/**
 * Meranie, ku ktorému sa hľadá kotva: obdobie (`kluc`), súčet od výrobcu (alebo null), celková výroba,
 * posledné meranie pred ním, miestny deň a čas a dnešná výroba od výrobcu.
 * @typedef {{ kluc: string, vyrobca: number | null, cum: number, posledne: Sucty['posledne'] | null,
 *   dnes: string, cas: string, dnesKwh: number | null }} Meranie
 */

/**
 * Kotva obdobia pre meranie. Súčet od výrobcu ju posunie; tá istá ostáva, kým trvá obdobie a celková
 * výroba neklesla (iný menič, nové počítadlo); inak nová (novaKotva).
 * @param {SuctyObdobie} obd @param {Kotva | undefined} stara @param {Meranie} m @returns {Kotva}
 */
function kotva(obd, stara, m) {
    if (m.vyrobca !== null) return { kluc: m.kluc, kwh0: m.vyrobca, cum0: m.cum, od: null };
    if (stara && stara.kluc === m.kluc && m.cum >= stara.cum0) return stara;
    return novaKotva(obd, m);
}

/**
 * Kotva nového obdobia: od posledného merania, keď bolo v poslednom dni predošlého (pri dni až
 * v noci), od začiatku dneška (celkovo mínus dnes) alebo od tohto merania.
 * @param {SuctyObdobie} obd @param {Meranie} m @returns {Kotva}
 */
function novaKotva(obd, m) {
    const prvy = zaciatok(obd, m.kluc);
    const p = m.posledne;
    if (p && p.den === addDays(prvy, -1) && m.cum >= p.cum && (obd !== 'den' || p.cas >= NOC))
        return { kluc: m.kluc, kwh0: 0, cum0: p.cum, od: null };
    if (obd !== 'den' && m.dnesKwh !== null && m.dnesKwh <= m.cum)
        return { kluc: m.kluc, kwh0: 0, cum0: m.cum - m.dnesKwh, od: m.dnes === prvy ? null : m.dnes };
    return { kluc: m.kluc, kwh0: 0, cum0: m.cum, od: obd === 'den' ? m.cas : m.dnes };
}

/**
 * Doplní do merania súčty, ktoré výrobca neposlal, a vráti nové kotvy. Bez celkovej výroby
 * meranie ostáva, ako je, a kotvy tiež. `pv.od` má obdobia, ktorých súčet nesiaha na ich začiatok.
 * @param {Sucty | null} sucty uložené kotvy @param {string} zdroj suctyZdroj
 * @param {PvData} pv meranie od Workera @param {string} dnes miestny dátum @param {string} cas miestny čas `HH:MM`
 * @returns {{ pv: PvData, sucty: Sucty | null }}
 */
export function doplnSucty(sucty, zdroj, pv, dnes, cas) {
    const cum = pv.cumulativeEnergyKwh;
    if (cum === null) return { pv, sucty };
    const stare = sucty && sucty.zdroj === zdroj ? sucty : null;
    const t = { cum, posledne: stare?.posledne ?? null, dnes, cas, dnesKwh: pv.dailyEnergyKwh };
    const kluce = { rok: dnes.slice(0, 4), mesiac: dnes.slice(0, 7), den: dnes };
    const out = { ...pv };
    /** @type {NonNullable<PvData['od']>} */ const od = {};
    /** @type {Record<SuctyObdobie, Kotva>} */ const kotvy = /** @type {any} */ ({});
    for (const obd of /** @type {SuctyObdobie[]} */ (['rok', 'mesiac', 'den'])) {
        const k = kotva(obd, stare?.[obd], { ...t, kluc: kluce[obd], vyrobca: pv[POLE[obd]] });
        kotvy[obd] = k;
        out[POLE[obd]] = Math.max(0, Math.round((k.kwh0 + cum - k.cum0) * 100) / 100);
        if (k.od) od[obd] = k.od;
    }
    if (Object.keys(od).length) out.od = od;
    return { pv: out, sucty: { zdroj, posledne: { den: dnes, cas, cum }, ...kotvy } };
}

/** @param {unknown} k @returns {k is Kotva} */
const isKotva = (k) =>
    isObj(k) &&
    typeof k.kluc === 'string' &&
    Number.isFinite(k.kwh0) &&
    Number.isFinite(k.cum0) &&
    (k.od === null || typeof k.od === 'string');

/**
 * Kotvy z úložiska; čo nesedí, je null - appka začne počítať odznova.
 * @param {unknown} raw @returns {Sucty | null}
 */
export function parseSucty(raw) {
    if (!isObj(raw) || typeof raw.zdroj !== 'string' || !isObj(raw.posledne)) return null;
    const p = raw.posledne;
    if (typeof p.den !== 'string' || typeof p.cas !== 'string' || !Number.isFinite(p.cum)) return null;
    if (!isKotva(raw.rok) || !isKotva(raw.mesiac) || !isKotva(raw.den)) return null;
    return /** @type {Sucty} */ (raw);
}
