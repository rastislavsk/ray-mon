// MD5 podľa RFC 1321. Fox ESS ním podpisuje požiadavky na svoje API a WebCrypto vo Workeri MD5
// nemá. Nie je to šifrovanie ani ochrana - len podpis, ktorý výrobca vyžaduje.

/** Posuny v jednotlivých krokoch (RFC 1321, 3.4). */
const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
/** Konštanty z hodnôt sínusu (RFC 1321, 3.4). */
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

/** @param {number} x @param {number} c */
const rotl = (x, c) => (x << c) | (x >>> (32 - c));

/**
 * MD5 textu (kódovaného ako UTF-8) ako 32 malých šestnástkových znakov.
 * @param {string} text
 */
export function md5(text) {
    const bytes = new TextEncoder().encode(text);
    // Doplnenie: bajt 0x80, nuly a dĺžka v bitoch (64 bitov, little-endian) na násobok 64 bajtov.
    const len = ((bytes.length + 8) >>> 6) + 1;
    const words = new Uint32Array(len * 16);
    bytes.forEach((b, i) => (words[i >> 2] |= b << ((i % 4) * 8)));
    words[bytes.length >> 2] |= 0x80 << ((bytes.length % 4) * 8);
    words[len * 16 - 2] = (bytes.length * 8) >>> 0;
    words[len * 16 - 1] = Math.floor(bytes.length / 2 ** 29);
    let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
    for (let block = 0; block < words.length; block += 16) {
        let [a, b, c, d] = [a0, b0, c0, d0];
        for (let i = 0; i < 64; i++) {
            const round = i >> 4;
            const f = [(b & c) | (~b & d), (d & b) | (~d & c), b ^ c ^ d, c ^ (b | ~d)][round];
            const g = [i, (5 * i + 1) % 16, (3 * i + 5) % 16, (7 * i) % 16][round];
            const next = (b + rotl((a + f + K[i] + words[block + g]) | 0, S[round * 4 + (i % 4)])) | 0;
            [a, b, c, d] = [d, next, b, c];
        }
        a0 = (a0 + a) | 0;
        b0 = (b0 + b) | 0;
        c0 = (c0 + c) | 0;
        d0 = (d0 + d) | 0;
    }
    return [a0, b0, c0, d0]
        .map((w) => Array.from({ length: 4 }, (_, i) => ((w >>> (i * 8)) & 0xff).toString(16).padStart(2, '0')).join(''))
        .join('');
}
