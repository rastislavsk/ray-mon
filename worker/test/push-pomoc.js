// Pomôcky testov pushu s obsahom: telefón s kľúčmi odberu a rozšifrovanie tela tak, ako to robí prehliadač (RFC 8291).

import assert from 'node:assert/strict';

/** @param {string} s */
const z64 = (s) => Uint8Array.from(Buffer.from(s, 'base64url'));
/** @param {Uint8Array} b */
const do64 = (b) => Buffer.from(b).toString('base64url');

/** Telefón: kľúčový pár odberu a kľúče, ktoré appka pošle Workeru. */
export async function odberTelefonu() {
    const ua = /** @type {CryptoKeyPair} */ (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']));
    const keys = {
        p256dh: do64(new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey))),
        auth: do64(crypto.getRandomValues(new Uint8Array(16))),
    };
    return { ua, keys };
}

/** Kľúč VAPID len pre testy - vygenerovaný pri behu. */
export async function vapidTest() {
    const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    return JSON.stringify(await crypto.subtle.exportKey('jwk', k.privateKey));
}

/** Rozšifruje telo pushu tak, ako to robí prehliadač (RFC 8291) - pre test, že telefón text naozaj prečíta. */
export async function rozsifruj(/** @type {Uint8Array} */ telo, /** @type {CryptoKeyPair} */ ua, /** @type {string} */ auth) {
    const salt = telo.slice(0, 16);
    const asPub = telo.slice(21, 21 + telo[20]);
    const uaPub = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
    const as = await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: as }, ua.privateKey, 256));
    const hkdf = async (
        /** @type {Uint8Array} */ s,
        /** @type {Uint8Array} */ ikm,
        /** @type {Uint8Array} */ info,
        /** @type {number} */ n,
    ) =>
        new Uint8Array(
            await crypto.subtle.deriveBits(
                { name: 'HKDF', hash: 'SHA-256', salt: s, info },
                await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']),
                n * 8,
            ),
        );
    const t = new TextEncoder();
    const ikm = await hkdf(z64(auth), ecdh, new Uint8Array([...t.encode('WebPush: info\0'), ...uaPub, ...asPub]), 32);
    const cek = await hkdf(salt, ikm, t.encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(salt, ikm, t.encode('Content-Encoding: nonce\0'), 12);
    const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, telo.slice(21 + telo[20])));
    assert.equal(plain.at(-1), 2, 'posledný záznam');
    return new TextDecoder().decode(plain.slice(0, -1));
}
