import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PUSH_TEXT } from '../../shared/config.js';
import { Budik, ulozKoniec } from '../src/budik.js';
import { handleRequest } from '../src/index.js';
import { odberTelefonu, rozsifruj, vapidTest } from './push-pomoc.js';

const NOW = new Date('2026-09-05T11:00:00Z');
const FCM = 'https://fcm.googleapis.com/fcm/send/abc123';
const po = (/** @type {number} */ min) => new Date(NOW.getTime() + min * 60000);

/** Úložisko Durable Object v pamäti, aj s alarmom. */
function uloziste() {
    /** @type {Map<string, any>} */ const m = new Map();
    const u = {
        m,
        /** @type {number | null} */ alarm: null,
        get: async (/** @type {string} */ k) => structuredClone(m.get(k)),
        put: async (/** @type {string} */ k, /** @type {unknown} */ v) => void m.set(k, structuredClone(v)),
        delete: async (/** @type {string} */ k) => m.delete(k),
        list: async ({ prefix }) => new Map([...m].filter(([k]) => k.startsWith(prefix))),
        setAlarm: async (/** @type {number} */ t) => void (u.alarm = t),
        deleteAlarm: async () => void (u.alarm = null),
    };
    return u;
}

/** Prostredie s jedným budíkom na odber a podvrhnutou push službou. */
async function prostredie(status = 201) {
    /** @type {Array<{ url: string, init: any }>} */ const pushe = [];
    const impl = /** @type {typeof fetch} */ (
        /** @type {unknown} */ (
            async (/** @type {string} */ url, /** @type {any} */ init) => {
                pushe.push({ url, init });
                return new Response(null, { status });
            }
        )
    );
    let hodiny = NOW;
    const env = { VAPID_JWK: await vapidTest() };
    /** @type {Map<string, { b: Budik, u: ReturnType<typeof uloziste> }>} */ const objekty = new Map();
    const BUDIK = {
        idFromName: (/** @type {string} */ n) => n,
        get: (/** @type {string} */ id) => {
            if (!objekty.has(id)) {
                const u = uloziste();
                objekty.set(id, { b: new Budik({ storage: u }, env, impl, () => hodiny), u });
            }
            const { b } = /** @type {{ b: Budik }} */ (objekty.get(id));
            return { fetch: (/** @type {string} */ url, /** @type {RequestInit} */ init) => b.fetch(new Request(url, init)) };
        },
    };
    return { env: { ...env, BUDIK }, objekty, pushe, nastav: (/** @type {Date} */ d) => (hodiny = d) };
}

test('POST /koniec: budík na čas konca, alarm pošle push s textom, ktorý telefón prečíta; „Nebeží“ ho zruší', async () => {
    const { env, objekty, pushe, nastav } = await prostredie();
    const { ua, keys } = await odberTelefonu();
    const koniec = (/** @type {object} */ o) => ulozKoniec(JSON.stringify({ endpoint: FCM, keys, ...o }), env, NOW);
    assert.equal(await koniec({ id: 'pracka', at: po(85).toISOString(), title: 'Práčka dobehla', body: 'Pranie je hotové.' }), 200);
    assert.equal(await koniec({ id: 'umyvacka', at: po(150).toISOString(), title: 'Umývačka dobehla', body: 'Riad je umytý.' }), 200);
    const { b, u } = /** @type {{ b: Budik, u: any }} */ (objekty.get(FCM));
    assert.equal(u.alarm, po(85).getTime(), 'alarm na najbližší koniec');
    // Alarm príde o pár sekúnd skôr: práčka zazvoní, umývačka čaká.
    nastav(new Date(po(85).getTime() - 10000));
    await b.alarm();
    assert.equal(pushe.length, 1);
    assert.equal(pushe[0].url, FCM);
    assert.equal(pushe[0].init.headers['content-encoding'], 'aes128gcm');
    assert.deepEqual(JSON.parse(await rozsifruj(pushe[0].init.body, ua, keys.auth)), {
        title: 'Práčka dobehla',
        body: 'Pranie je hotové.',
        tag: 'koniec-pracka',
    });
    assert.equal(u.alarm, po(150).getTime());
    assert.equal(await koniec({ id: 'umyvacka', at: null }), 200);
    assert.equal(u.alarm, null, 'bez budíkov bez alarmu');
    await b.alarm();
    assert.equal(pushe.length, 1);
});

test('POST /koniec: zlé údaje 400, bez objektu či kľúča 503, cez cestu Workera s limitom', async () => {
    const { env } = await prostredie();
    const { keys } = await odberTelefonu();
    const ok = { endpoint: FCM, keys, id: 'susicka', at: po(60).toISOString(), title: 'Sušička dobehla', body: 'Sušenie je hotové.' };
    const uloz = (/** @type {object} */ o, e = env) => ulozKoniec(JSON.stringify({ ...ok, ...o }), e, NOW);
    assert.equal(await uloz({}), 200);
    for (const zle of [
        { endpoint: 'https://zly.example/x' },
        { keys: { p256dh: keys.p256dh } },
        { id: 'bojler' },
        { at: 'zajtra' },
        { at: po(PUSH_TEXT.maxDopreduH * 60 + 1).toISOString() },
        { at: po(-2).toISOString() },
        { title: '' },
        { body: 'x'.repeat(PUSH_TEXT.maxText + 1) },
        { body: 'riadok\nďalší' },
    ])
        assert.equal(await uloz(zle), 400, JSON.stringify(zle));
    assert.equal(await ulozKoniec('nie json', env, NOW), 400);
    assert.equal(await uloz({}, { ...env, BUDIK: undefined }), 503);
    assert.equal(await uloz({}, { ...env, VAPID_JWK: undefined }), 503);
    const res = await handleRequest(new Request('https://w.test/koniec', { method: 'POST', body: JSON.stringify(ok) }), env, NOW);
    assert.equal(res.status, 200);
});

test('Budik: bez kľúča VAPID budík len zmaže a alarm zruší', async () => {
    const { env, objekty } = await prostredie(500);
    const { keys } = await odberTelefonu();
    await ulozKoniec(JSON.stringify({ endpoint: FCM, keys, id: 'pracka', at: po(1).toISOString(), title: 'a', body: 'b' }), env, NOW);
    const { u } = /** @type {{ u: any }} */ (objekty.get(FCM));
    const bez = new Budik({ storage: u }, {}, undefined, () => po(2));
    await bez.alarm();
    assert.equal(u.m.size, 0);
    assert.equal(u.alarm, null);
});
