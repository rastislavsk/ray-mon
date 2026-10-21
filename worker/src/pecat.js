// Zapečatený prístup k meraniu. Worker pri pripojení prevezme odkaz, kľúč či heslo, zašifruje
// ich vlastným tajným kľúčom (AES-GCM) a appke vráti len výsledok. Telefón tak drží balíček,
// ktorý vie otvoriť iba tento Worker - kto vytiahne úložisko telefónu, prístup k účtu výrobcu
// nezíska. Tajný kľúč je v nastavení Workera (`wrangler secret put PECAT_KLUC`), nie v repozitári.
// Keď sa vymení, staré balíčky sa neotvoria a každý sa musí pripojiť znova.

const VERZIA = 'v1';
// Viaže šifru na tento účel: balíček z inej appky s tým istým kľúčom by sa neotvoril.
const UCEL = new TextEncoder().encode('ray-mon-pecat');

/** @param {Uint8Array} bytes */
function toBase64Url(bytes) {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @param {string} text */
function fromBase64Url(text) {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

/** @type {Map<string, Promise<CryptoKey>>} kľúč sa importuje raz za beh Workera */
const keys = new Map();

/**
 * Tajný kľúč z nastavenia Workera (base64, 32 bajtov). Bez neho null - Worker potom nevie
 * pripájať, len merať zo starých holých odkazov na kiosk.
 * @param {string | undefined} secret @returns {Promise<CryptoKey> | null}
 */
export function pecatKey(secret) {
    if (!secret) return null;
    let key = keys.get(secret);
    if (!key) {
        const raw = Uint8Array.from(atob(secret), (c) => c.charCodeAt(0));
        if (raw.length !== 32) throw new Error('PECAT_KLUC musí mať 32 bajtov (base64)');
        key = crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
        keys.set(secret, key);
    }
    return key;
}

/**
 * Zapečatí prístup: `sposob` (id zo shared/zdroje.js) a údaje, ktoré Worker potrebuje na meranie.
 * @param {Promise<CryptoKey>} key @param {{ sposob: string, pristup: Record<string, unknown> }} obsah
 */
export async function zapecat(key, obsah) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(JSON.stringify({ s: obsah.sposob, p: obsah.pristup }));
    const sifra = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: UCEL }, await key, data));
    const out = new Uint8Array(iv.length + sifra.length);
    out.set(iv);
    out.set(sifra, iv.length);
    return `${VERZIA}.${toBase64Url(out)}`;
}

/**
 * Otvorí zapečatený prístup. Cudzí, poškodený alebo iným kľúčom zapečatený balíček je null.
 * @param {Promise<CryptoKey>} key @param {string} pecat
 * @returns {Promise<{ sposob: string, pristup: Record<string, unknown> } | null>}
 */
export async function otvor(key, pecat) {
    const [verzia, telo] = pecat.split('.');
    if (verzia !== VERZIA || !telo) return null;
    try {
        const bytes = fromBase64Url(telo);
        const data = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: UCEL },
            await key,
            bytes.slice(12),
        );
        const o = JSON.parse(new TextDecoder().decode(data));
        return typeof o.s === 'string' && o.p && typeof o.p === 'object' ? { sposob: o.s, pristup: o.p } : null;
    } catch {
        return null;
    }
}
