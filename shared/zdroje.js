// Odkiaľ appka berie živé meranie: značky meničov a spôsoby, ktorými sa k nim pripojí. Sú to
// dáta - sprievodca podľa nich kreslí obrazovky (výber značky, spôsobu, formulár), Worker podľa
// `id` spôsobu vie, ktorého výrobcu sa pýtať. Nová značka = riadok tu a zdroj vo Workeri.
// Návrh: docs/navrhy/meranie-cez-api.html. Len spôsoby, ktoré má človek sám alebo si ich vypýta
// od inštalatéra či podpory výrobcu - nič, čo by vyžadovalo registráciu appky u výrobcu.

import { REFRESH } from './config.js';
import { kioskApiUrl } from './kiosk.js';
import { solaxUrl } from './solax.js';
import { isObj } from './valid.js';

/**
 * Pole formulára spôsobu. `tajne` je heslo či kľúč (pole skryje písanie), `typ` druh klávesnice.
 * @typedef {{ id: string, lbl: string, ph: string, tajne?: boolean, typ?: 'url' | 'text' | 'email' }} Pole
 */
/**
 * Spôsob pripojenia. `tagy` sú štítky pri jeho voľbe (kto ho urobí, ako dlho, prípadne prečo
 * prvý), `kroky` návod, kde údaje nájde, `sprava` hotová správa pre inštalatéra či podporu,
 * `pozn` veta pod formulárom, `zrusenie` kde prístup zrušiť aj u výrobcu. `intervalMs` je, ako často
 * sa appka pýta na meranie - podľa limitov výrobcu a toho, ako často jeho cloud dáta obnovuje.
 * @typedef {{ id: string, znacka: string, nazov: string, pod: string, tagy: string[], kroky: string[], pola: Pole[],
 *   sprava?: string, pozn?: string, zrusenie: string, intervalMs: number }} Sposob
 */
/**
 * Značka meniča: buď so spôsobmi pripojenia (prvý je odporúčaný), alebo s vysvetlením, prečo
 * sa k nej domácnosť zatiaľ nedostane.
 * @typedef {{ id: string, meno: string, sposoby: string[] } | { id: string, meno: string, nie: string }} Znacka
 */
/**
 * Pripojené meranie tak, ako ho appka drží v nastavení. `pecat` je zapečatený prístup - otvoriť
 * ho vie len Worker, telefón v ňom heslo ani kľúč neprečíta. Nastavenia spred zapečatenia majú
 * v `pecat` holý odkaz na kiosk; Worker ho pri prvom meraní zapečatí. `nazov` je meno elektrárne
 * u výrobcu (prázdne, keď ho výrobca nepovie).
 * @typedef {{ sposob: string, pecat: string, nazov: string }} Zdroj
 */

/** @type {Sposob[]} */
export const SPOSOBY = [
    {
        id: 'huawei-kiosk',
        znacka: 'huawei',
        nazov: 'Odkaz na kiosk',
        pod: 'Verejný odkaz na výrobu z appky FusionSolar. Kto ho má, vidí tvoju výrobu.',
        tagy: ['ty', '2 minúty'],
        kroky: ['V appke FusionSolar otvor svoju elektráreň.', 'Zvoľ zdieľanie cez kiosk a skopíruj odkaz.', 'Vlož ho sem.'],
        pola: [{ id: 'odkaz', lbl: 'Odkaz na kiosk', ph: 'Odkaz na kiosk FusionSolar', typ: 'url' }],
        zrusenie: 'Kiosk vypneš v appke FusionSolar pri zdieľaní elektrárne.',
        intervalMs: REFRESH.dataMs,
    },
    {
        id: 'foxess-kluc',
        znacka: 'foxess',
        nazov: 'Kľúč z FoxESS Cloud',
        pod: 'Kľúč si vygeneruješ sám na webe FoxESS Cloud.',
        tagy: ['ty', '3 minúty'],
        kroky: [
            'Prihlás sa na foxesscloud.com.',
            'Ikona vpravo hore → User Profile → API Management.',
            'Vygeneruj kľúč. Ukáže sa len raz, hneď ho skopíruj a vlož sem.',
        ],
        pola: [{ id: 'kluc', lbl: 'API kľúč', ph: 'kľúč', tajne: true }],
        pozn: 'Fox ESS dovolí 1 440 dopytov denne, appka sa preto pýta každé 3 minúty.',
        zrusenie: 'Kľúč zrušíš na foxesscloud.com vygenerovaním nového (User Profile → API Management).',
        // 1 440 dopytov denne na menič, meranie stojí dva: každé 3 minúty je to 960 a ostáva rezerva
        // na druhé zariadenie s otvorenou appkou.
        intervalMs: 3 * 60 * 1000,
    },
    {
        id: 'solax-token',
        znacka: 'solax',
        nazov: 'Token zo SolaX Cloud',
        pod: 'Token si skopíruješ sám, k nemu číslo Wi-Fi modulu.',
        tagy: ['ty', '3 minúty'],
        kroky: [
            'Prihlás sa na solaxcloud.com a otvor Service → API.',
            'Skopíruj tokenID.',
            'Registračné číslo je na štítku Wi-Fi modulu v meniči (Registration No.).',
        ],
        pola: [
            { id: 'token', lbl: 'Token', ph: 'tokenID', tajne: true },
            { id: 'sn', lbl: 'Registračné číslo modulu', ph: '10 znakov' },
        ],
        pozn: 'SolaX obnovuje dáta raz za 5 minút, appka sa pýta rovnako často.',
        zrusenie: 'Token spravuješ v SolaX Cloud v časti Service → API.',
        intervalMs: 5 * 60 * 1000,
    },
    {
        id: 'victron-token',
        znacka: 'victron',
        nazov: 'Prístupový token z VRM',
        pod: 'Token si vytvoríš sám v portáli VRM.',
        tagy: ['ty', '3 minúty'],
        kroky: ['Prihlás sa na vrm.victronenergy.com.', 'Preferences → Integrations → Access tokens → Add.', 'Token skopíruj a vlož sem.'],
        pola: [{ id: 'token', lbl: 'Prístupový token', ph: 'token', tajne: true }],
        pozn: 'Victron posiela výkon a celkovú výrobu, dnešnú výrobu appka dopočítať nevie.',
        zrusenie: 'Token zrušíš v portáli VRM tam, kde si ho vytvoril (Access tokens).',
        intervalMs: REFRESH.dataMs,
    },
];

/** @type {Znacka[]} */
export const ZNACKY = [
    { id: 'huawei', meno: 'Huawei', sposoby: ['huawei-kiosk'] },
    { id: 'foxess', meno: 'Fox ESS', sposoby: ['foxess-kluc'] },
    { id: 'solax', meno: 'SolaX', sposoby: ['solax-token'] },
    { id: 'victron', meno: 'Victron', sposoby: ['victron-token'] },
    {
        id: 'solaredge',
        meno: 'SolarEdge',
        nie: 'Doterajší kľúč z portálu SolarEdge končí 1. 11. 2026 a nový spôsob je len pre vývojárov.',
    },
    { id: 'enphase', meno: 'Enphase', nie: 'Enphase dáva údaje len aplikáciám registrovaným u nich.' },
    { id: 'sungrow', meno: 'Sungrow', nie: 'Sungrow dáva údaje len aplikáciám registrovaným a schváleným u nich.' },
    { id: 'fronius', meno: 'Fronius', nie: 'Fronius dáva údaje cez internet len firmám, za poplatok.' },
    { id: 'sma', meno: 'SMA', nie: 'SMA dáva údaje len firmám so zmluvou, za mesačný poplatok.' },
    { id: 'goodwe', meno: 'GoodWe', nie: 'GoodWe dáva údaje len firmám a dodávateľom s licenciou.' },
    { id: 'growatt', meno: 'Growatt', nie: 'Growatt zatiaľ nezverejnil, ako sa k údajom dostať.' },
];

/** @param {string} id @returns {Sposob | null} */
export const sposobOf = (id) => SPOSOBY.find((x) => x.id === id) ?? null;

/** @param {string} id @returns {Znacka | null} */
export const znackaOf = (id) => ZNACKY.find((x) => x.id === id) ?? null;

/** Spôsoby značky v poradí (prvý odporúčaný); pre značku, ktorá sa nedá, prázdne. @param {Znacka} z @returns {Sposob[]} */
export function sposobyOf(z) {
    return 'sposoby' in z ? z.sposoby.map(sposobOf).filter((x) => x !== null) : [];
}

/** Meno značky spôsobu, napr. „Huawei“. @param {string} sposob */
export function menoZnacky(sposob) {
    const s = sposobOf(sposob);
    const z = s && znackaOf(s.znacka);
    return z ? z.meno : '';
}

// Zapečatený prístup: verzia, bodka a base64url (náhodný vektor + šifra AES-GCM, viď
// worker/src/pecat.js). Kontrola tu je len tvar - obsah overí Worker.
const PECAT_RE = /^v1\.[A-Za-z0-9_-]{20,8000}$/;

/** Je to zapečatený prístup (nie holý odkaz z nastavení spred zapečatenia)? @param {string} pecat */
export const isPecat = (pecat) => PECAT_RE.test(pecat);

/**
 * Pripojené meranie z uloženého nastavenia alebo z odkazu, inak null. Prijme aj nastavenie
 * spred zapečatenia, kde bol holý odkaz na kiosk (`kiosk: "https://…"`).
 * @param {unknown} raw objekt `zdroj` @param {unknown} [legacyKiosk] pole `kiosk` starých nastavení
 * @returns {Zdroj | null}
 */
export function parseZdroj(raw, legacyKiosk) {
    if (isObj(raw)) {
        const o = /** @type {Record<string, unknown>} */ (raw);
        const sposob = typeof o.sposob === 'string' ? o.sposob : '';
        const pecat = typeof o.pecat === 'string' ? o.pecat : '';
        const nazov = typeof o.nazov === 'string' ? o.nazov.slice(0, 80) : '';
        if (!sposobOf(sposob)) return null;
        if (isPecat(pecat) || (sposob === 'huawei-kiosk' && kioskApiUrl(pecat))) return { sposob, pecat, nazov };
        return null;
    }
    if (typeof legacyKiosk === 'string' && kioskApiUrl(legacyKiosk)) return { sposob: 'huawei-kiosk', pecat: legacyKiosk, nazov: '' };
    return null;
}

/**
 * Sú údaje z formulára úplné a na pohľad v poriadku? Všetky polia vyplnené, odkaz na kiosk
 * naozaj na kiosk FusionSolar. Či ich výrobca prijme, overí až Worker.
 * @param {string} sposob @param {Record<string, string>} udaje
 */
export function udajeOk(sposob, udaje) {
    const s = sposobOf(sposob);
    if (!s || !s.pola.every((p) => !!udaje[p.id])) return false;
    if (sposob === 'huawei-kiosk') return !!kioskApiUrl(udaje.odkaz);
    if (sposob === 'solax-token') return !!solaxUrl(udaje.token, udaje.sn);
    return true;
}

// Rezerva pri porovnaní s intervalom: čas merania je čas Workera a obnova appky beží na minútu,
// meranie tesne pred uplynutím intervalu sa tak nepreskočí o celú ďalšiu minútu.
const DUE_SLACK_MS = 10 * 1000;

/**
 * Je čas sa znova opýtať na meranie? Áno, keď ešte nijaké nie je alebo je staršie než interval
 * spôsobu (`intervalMs`) - inak by appka míňala dopyty, ktoré výrobca obmedzuje.
 * @param {Zdroj} zdroj @param {{ updatedAt: string } | null} pv @param {Date} now
 */
export function pvDue(zdroj, pv, now) {
    const s = sposobOf(zdroj.sposob);
    if (!pv || !s) return true;
    return now.getTime() - Date.parse(pv.updatedAt) >= s.intervalMs - DUE_SLACK_MS;
}
