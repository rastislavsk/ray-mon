import { test } from 'node:test';
import assert from 'node:assert/strict';
import { klucOdberu, zasifruj } from '../src/webpush.js';
import { odberTelefonu, rozsifruj } from './push-pomoc.js';

/** @param {string} s */
const z64 = (s) => Uint8Array.from(Buffer.from(s, 'base64url'));
/** @param {Uint8Array} b */
const do64 = (b) => Buffer.from(b).toString('base64url');

// RFC 8291, príloha A: príklad šifrovania pushu.
const RFC = {
    text: 'When I grow up, I want to be a watermelon',
    uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
    asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
    asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
    salt: 'DGv6ra1nlYgDCS1FRnbzlw',
    telo:
        'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
        'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

/** Kľúčový pár P-256 z verejného (nekomprimovaný bod) a súkromného kľúča v base64url. @param {string} pub @param {string} priv */
async function par(pub, priv) {
    const b = z64(pub);
    const jwk = { kty: 'EC', crv: 'P-256', x: do64(b.slice(1, 33)), y: do64(b.slice(33, 65)), d: priv, ext: true };
    return {
        privateKey: await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']),
        publicKey: await crypto.subtle.importKey('raw', b, { name: 'ECDH', namedCurve: 'P-256' }, true, []),
    };
}

test('zasifruj: príklad z RFC 8291 bajt po bajte', async () => {
    const telo = await zasifruj(
        RFC.text,
        { p256dh: RFC.uaPublic, auth: RFC.auth },
        { as: await par(RFC.asPublic, RFC.asPrivate), salt: z64(RFC.salt) },
    );
    assert.equal(do64(telo), RFC.telo);
});

test('zasifruj: náhodný kľúč a soľ, telefón text prečíta, dva pushy nie sú rovnaké', async () => {
    const { ua, keys } = await odberTelefonu();
    const text = JSON.stringify({ title: 'Práčka dobehla', body: 'Pranie je hotové.' });
    const a = await zasifruj(text, keys);
    assert.equal(await rozsifruj(a, ua, keys.auth), text);
    assert.notEqual(do64(a), do64(await zasifruj(text, keys)));
});

test('klucOdberu: len kľúče správnej dĺžky v base64url', () => {
    assert.deepEqual(klucOdberu({ p256dh: RFC.uaPublic, auth: RFC.auth }), { p256dh: RFC.uaPublic, auth: RFC.auth });
    assert.equal(klucOdberu(null), null);
    assert.equal(klucOdberu({ p256dh: RFC.uaPublic }), null);
    assert.equal(klucOdberu({ p256dh: RFC.auth, auth: RFC.auth }), null);
    assert.equal(klucOdberu({ p256dh: RFC.uaPublic, auth: `${RFC.auth}+` }), null);
});
