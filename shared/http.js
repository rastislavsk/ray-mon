// Spoločný retry pre sieťové volania (Worker). Jeden prechodný výpadok nemá zhodiť celý beh.

const DEFAULTS = { attempts: 3, delayMs: 2000, timeoutMs: 10000 };
const wait = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Stiahne adresu, pri prechodnej chybe to skúsi znova. Prechodná je chyba siete, vypršaný
 * čas a odpoveď 5xx. Odpoveď 4xx (neplatný kľúč kiosku, zamietnutý prístup) sa druhým
 * pokusom nezmení, takže sa vráti hneď ako chyba.
 *
 * Každý pokus má vlastný časový limit - bez neho by zaseknuté spojenie čakalo donekonečna
 * a s ním aj ten, kto na odpoveď čaká.
 * @param {string} url @param {RequestInit} [options]
 * @param {{ attempts?: number, delayMs?: number, timeoutMs?: number, fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<unknown> }} [opts]
 */
export async function fetchWithRetry(url, options = {}, opts = {}) {
    const { attempts, delayMs, timeoutMs, fetchImpl = fetch, sleep = wait } = { ...DEFAULTS, ...opts };
    /** @type {unknown} */ let lastErr;
    for (let i = 0; i < attempts; i++) {
        try {
            const res = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
            if (res.ok) return res;
            lastErr = new Error(`HTTP ${res.status}`);
            if (res.status < 500) break;
        } catch (err) {
            lastErr = err;
        }
        if (i < attempts - 1) await sleep(delayMs * 2 ** i);
    }
    throw lastErr;
}
