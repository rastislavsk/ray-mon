import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OZNAMENIA } from '../../shared/config.js';
import { handleRequest } from '../src/index.js';
import { budenie } from '../src/oznamenia.js';
import { platnyOdber, vapidAuth } from '../src/webpush.js';

const FCM = 'https://fcm.googleapis.com/fcm/send/abc123';
const APPLE = 'https://web.push.apple.com/QWERTY';

/** Kľúč VAPID len pre testy - vygenerovaný pri behu, aby sa dal overiť podpis. */
async function testKeys() {
    const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', k.privateKey);
    return { jwk: JSON.stringify(jwk), publicKey: k.publicKey };
}

/** KV v pamäti: hodnoty, metadáta, zoznam po stránkach s kurzorom. */
function fakeKv(pageSize = 2) {
    /** @type {Map<string, { metadata: any, expiration?: number }>} */ const data = new Map();
    return {
        data,
        /** @param {string} key @param {string} _v @param {{ metadata?: any, expiration?: number }} [opts] */
        async put(key, _v, opts = {}) {
            data.set(key, { metadata: opts.metadata, expiration: opts.expiration });
        },
        /** @param {string} key */
        async delete(key) {
            data.delete(key);
        },
        /** @param {{ prefix: string, cursor?: string }} opts */
        async list({ prefix, cursor }) {
            const all = [...data.keys()].filter((k) => k.startsWith(prefix)).sort();
            const from = cursor ? Number(cursor) : 0;
            const keys = all.slice(from, from + pageSize).map((name) => ({ name, metadata: data.get(name)?.metadata }));
            const done = from + pageSize >= all.length;
            return { keys, list_complete: done, cursor: done ? undefined : String(from + pageSize) };
        },
    };
}

const post = (/** @type {string} */ path, /** @type {unknown} */ body) =>
    new Request(`https://w.test${path}`, { method: 'POST', body: JSON.stringify(body) });

test('platnyOdber: len https adresy známych push služieb', () => {
    assert.ok(platnyOdber(FCM));
    assert.ok(platnyOdber(APPLE));
    assert.ok(platnyOdber('https://updates.push.services.mozilla.com/wpush/v2/x'));
    for (const bad of [
        'http://fcm.googleapis.com/x',
        'https://evil.test/x',
        'https://push.apple.com.evil.test/',
        'x',
        42,
        `${FCM}${'a'.repeat(OZNAMENIA.maxEndpoint)}`,
    ])
        assert.equal(platnyOdber(bad), false, String(bad).slice(0, 40));
});

test('POST /oznamenia uloží odber do metadát, on: false ho zruší; zlé údaje 400, bez úložiska 503', async () => {
    const { jwk } = await testKeys();
    const ODBERY = fakeKv();
    const env = { ODBERY, VAPID_JWK: jwk };
    let res = await handleRequest(post('/oznamenia', { endpoint: FCM, on: true, hour: 9, tz: 'Europe/Bratislava' }), env);
    assert.equal(res.status, 200);
    const [[key, val]] = [...ODBERY.data];
    assert.match(key, /^o:[0-9a-f]{32}$/);
    assert.ok(!key.includes('abc123'), 'adresa nie je v kľúči');
    assert.deepEqual(val.metadata, { e: FCM, h: 9, tz: 'Europe/Bratislava' });
    res = await handleRequest(post('/oznamenia', { endpoint: FCM, on: false }), env);
    assert.equal(res.status, 200);
    assert.equal(ODBERY.data.size, 0);
    for (const bad of [
        { endpoint: 'https://evil.test/x', on: true, hour: 9, tz: 'Europe/Bratislava' },
        { endpoint: FCM, on: true, hour: 13, tz: 'Europe/Bratislava' },
        { endpoint: FCM, on: true, hour: 9, tz: 'Mars/Base' },
    ])
        assert.equal((await handleRequest(post('/oznamenia', bad), env)).status, 400);
    assert.equal((await handleRequest(post('/oznamenia', { endpoint: FCM, on: true, hour: 9, tz: 'UTC' }), {})).status, 503);
});

test('POST /pripomen: len do OZNAMENIA.remindMaxH hodín dopredu, kľúč sám vyprší', async () => {
    const { jwk } = await testKeys();
    const ODBERY = fakeKv();
    const env = { ODBERY, VAPID_JWK: jwk };
    const now = new Date('2026-09-05T07:00:00Z');
    const at = new Date('2026-09-05T09:15:00Z');
    assert.equal((await handleRequest(post('/pripomen', { endpoint: FCM, at: at.toISOString() }), env, now)).status, 200);
    const [[key, val]] = [...ODBERY.data];
    assert.match(key, /^p:[0-9a-f]{32}:2026-09-05T09:15:00.000Z$/);
    assert.equal(val.expiration, at.getTime() / 1000 + 3600);
    const far = new Date(now.getTime() + (OZNAMENIA.remindMaxH + 1) * 3600 * 1000);
    for (const bad of [far.toISOString(), '2026-09-05T06:00:00Z', 'zajtra'])
        assert.equal((await handleRequest(post('/pripomen', { endpoint: FCM, at: bad }), env, now)).status, 400);
});

test('budenie: zobudí odbery, ktorým práve nastala hodina v ich pásme, a pripomienky; neplatný odber zmaže', async () => {
    const { jwk, publicKey } = await testKeys();
    const ODBERY = fakeKv();
    const env = { ODBERY, VAPID_JWK: jwk };
    // 7:00 UTC je 9:00 v Bratislave (letný čas) a 8:00 v Londýne.
    const now = new Date('2026-09-05T07:00:00Z');
    await handleRequest(post('/oznamenia', { endpoint: FCM, on: true, hour: 9, tz: 'Europe/Bratislava' }), env);
    await handleRequest(post('/oznamenia', { endpoint: APPLE, on: true, hour: 9, tz: 'Europe/London' }), env);
    await handleRequest(post('/oznamenia', { endpoint: `${FCM}-stary`, on: true, hour: 9, tz: 'Europe/Bratislava' }), env);
    await handleRequest(post('/pripomen', { endpoint: APPLE, at: '2026-09-05T07:00:30Z' }), env, new Date('2026-09-05T06:00:00Z'));
    await handleRequest(post('/pripomen', { endpoint: APPLE, at: '2026-09-05T09:00:00Z' }), env, new Date('2026-09-05T06:00:00Z'));
    /** @type {Array<{ url: string, init: any }>} */ const calls = [];
    const fetchImpl = /** @type {typeof fetch} */ (
        /** @type {unknown} */ (
            async (/** @type {string} */ url, /** @type {any} */ init) => {
                calls.push({ url, init });
                return new Response(null, { status: url.endsWith('-stary') ? 410 : 201 });
            }
        )
    );
    const sent = await budenie(env, now, fetchImpl);
    assert.equal(sent, 2, 'Bratislava ráno a pripomienka v Londýne');
    assert.deepEqual(calls.map((c) => c.url).sort(), [APPLE, FCM, `${FCM}-stary`].sort());
    assert.equal(ODBERY.data.size, 3, 'neplatný odber a odoslaná pripomienka zmizli, budúca ostala');
    assert.ok([...ODBERY.data.keys()].some((k) => k.endsWith('09:00:00.000Z')));
    const { headers } = calls[0].init;
    assert.equal(headers['content-length'], '0', 'push bez obsahu');
    assert.equal(headers.urgency, 'high');
    assert.equal(headers.ttl, String(OZNAMENIA.stepMin * 60));
    // Podpis VAPID sa dá overiť verejným kľúčom a patrí push službe adresy.
    const auth = await vapidAuth(FCM, jwk, now);
    const [, jwt, k] = /** @type {RegExpMatchArray} */ (auth.match(/^vapid t=([^,]+), k=(.+)$/));
    assert.equal(k, OZNAMENIA.vapidPublic);
    const [h, p, s] = jwt.split('.');
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    assert.equal(claims.aud, 'https://fcm.googleapis.com');
    assert.equal(claims.exp, now.getTime() / 1000 + 12 * 3600);
    const ok = await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        publicKey,
        Buffer.from(s, 'base64url'),
        new TextEncoder().encode(`${h}.${p}`),
    );
    assert.ok(ok, 'podpis sedí');
});

test('budenie bez úložiska alebo kľúča nič nepošle', async () => {
    assert.equal(await budenie({}, new Date(), fetch), 0);
});
