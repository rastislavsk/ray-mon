import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithRetry } from '../shared/http.js';

/**
 * Falošný fetch, ktorý postupne vráti zadané odpovede: číslo = HTTP status, 'siet' = chyba siete.
 * @param {Array<number | 'siet'>} plan
 */
function podlaPlanu(plan) {
    /** @type {RequestInit[]} */ const volania = [];
    const fetchImpl = /** @type {typeof fetch} */ (
        /** @type {unknown} */ (
            async (/** @type {string} */ _url, /** @type {RequestInit} */ init) => {
                volania.push(init);
                const krok = plan[volania.length - 1];
                if (krok === 'siet') throw new TypeError('fetch failed');
                return new Response('{}', { status: krok });
            }
        )
    );
    return { fetchImpl, volania, sleep: async () => {} };
}

test('fetchWithRetry: prechodná chyba (5xx, sieť) sa skúsi znova', async () => {
    const f = podlaPlanu([503, 'siet', 200]);
    const res = await fetchWithRetry('https://x.test/', {}, { ...f, attempts: 3 });
    assert.equal(res.status, 200);
    assert.equal(f.volania.length, 3);
});

test('fetchWithRetry: 4xx sa neopakuje - druhý pokus by dopadol rovnako', async () => {
    const f = podlaPlanu([404, 200]);
    await assert.rejects(fetchWithRetry('https://x.test/', {}, { ...f, attempts: 3 }), /HTTP 404/);
    assert.equal(f.volania.length, 1);
});

test('fetchWithRetry: po poslednom pokuse vráti poslednú chybu', async () => {
    const f = podlaPlanu([500, 502]);
    await assert.rejects(fetchWithRetry('https://x.test/', {}, { ...f, attempts: 2 }), /HTTP 502/);
});

test('fetchWithRetry: každý pokus má časový limit, zaseknuté spojenie sa preruší', async () => {
    const f = podlaPlanu([200]);
    await fetchWithRetry('https://x.test/', { method: 'POST' }, { ...f, timeoutMs: 1000 });
    assert.equal(f.volania[0].method, 'POST', 'vlastné nastavenia požiadavky ostanú');
    assert.ok(f.volania[0].signal instanceof AbortSignal);

    // Server, ktorý neodpovie nikdy: pokus skončí po limite, nie nikdy.
    const nikdy = /** @type {typeof fetch} */ (
        /** @type {unknown} */ (
            (/** @type {string} */ _url, /** @type {RequestInit} */ init) =>
                new Promise((_, zlyhaj) => init.signal?.addEventListener('abort', () => zlyhaj(init.signal?.reason)))
        )
    );
    // Časovač AbortSignal.timeout Node nedrží nažive - bez tohto by test skončil skôr, než vyprší.
    const drz = setTimeout(() => {}, 5000);
    const zaciatok = Date.now();
    await assert.rejects(fetchWithRetry('https://x.test/', {}, { fetchImpl: nikdy, attempts: 1, timeoutMs: 50 }), { name: 'TimeoutError' });
    clearTimeout(drz);
    assert.ok(Date.now() - zaciatok < 2000);
});
