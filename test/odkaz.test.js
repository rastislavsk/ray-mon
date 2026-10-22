import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { CURRENCIES, PLANT, PRICE_LEVELS, SHARE_HASH_KEY, SHARE_LINK_VERSION, SITE, TARIFF } from '../shared/config.js';
import { readLink, settingsFromLink, shareHash, toUser } from '../shared/settings.js';
import { LINK_ERRORS } from '../shared/setup-texts.js';
import { SPOSOBY } from '../shared/zdroje.js';

const goldenPath = new URL('./golden/odkaz.json', import.meta.url);

/** Nastavenie so všetkým, čo odkaz vie niesť - aj meranie s prístupom na čas. */
const PLNE = {
    site: SITE,
    plant: PLANT,
    tariff: TARIFF,
    zdroj: { sposob: 'deye-aplikacia', pecat: 'v1.test-pecat-0123456789', nazov: 'Strecha', platiDo: '2026-12-01T00:00:00.000Z' },
};

/** Cesty kľúčov v objekte (pri poli podľa prvej položky), zoradené. @param {unknown} o @param {string} [p] @returns {string[]} */
function cesty(o, p = '') {
    if (Array.isArray(o)) return o.length ? cesty(o[0], `${p}[]`) : [`${p}[]`];
    if (o && typeof o === 'object') return Object.entries(o).flatMap(([k, v]) => [`${p}.${k}`, ...cesty(v, `${p}.${k}`)]);
    return [];
}

/**
 * Odtlačok formátu odkazu: všetko, čo staršia appka musí poznať, aby odkaz prečítala celý -
 * polia, spôsoby pripojenia merania, úrovne ceny a meny tarify. Zmena v ňom bez novej verzie
 * by znamenala, že staršia appka časť nastavenia potichu zahodí.
 */
function odtlacok() {
    return {
        verzia: SHARE_LINK_VERSION,
        polia: [...new Set(cesty(toUser(PLNE)))].sort(),
        sposoby: SPOSOBY.map((s) => s.id).sort(),
        urovne: [...PRICE_LEVELS],
        meny: [...CURRENCIES],
    };
}

test('formát odkazu sa nezmenil bez novej verzie (test/golden/odkaz.json)', () => {
    const teraz = odtlacok();
    const ulozeny = existsSync(goldenPath) ? JSON.parse(readFileSync(goldenPath, 'utf8')) : null;
    const zmena = JSON.stringify({ ...teraz, verzia: 0 }) !== JSON.stringify({ ...ulozeny, verzia: 0 });
    if (process.env.UPDATE_GOLDEN) {
        // Ani prepis golden súboru nepustí zmenu formátu bez zvýšenia verzie.
        assert.ok(
            !ulozeny || !zmena || ulozeny.verzia < SHARE_LINK_VERSION,
            'formát odkazu sa zmenil - najprv zvýš SHARE_LINK_VERSION v shared/config.js',
        );
        writeFileSync(goldenPath, JSON.stringify(teraz, null, 2) + '\n');
    }
    assert.ok(ulozeny || process.env.UPDATE_GOLDEN, 'chýba test/golden/odkaz.json - vytvor ho cez UPDATE_GOLDEN=1 npm test');
    assert.deepEqual(
        teraz,
        JSON.parse(readFileSync(goldenPath, 'utf8')),
        'formát odkazu sa zmenil: zvýš SHARE_LINK_VERSION v shared/config.js a spusti UPDATE_GOLDEN=1 npm test',
    );
});

/** Odkaz s nastavením z ľubovoľného objektu. @param {unknown} o */
const odkaz = (o) => `#${SHARE_HASH_KEY}=${Buffer.from(JSON.stringify(o)).toString('base64url')}`;

test('readLink: odkaz nesie verziu a appka ho prevezme celý, aj s meraním', () => {
    const hash = shareHash(PLNE, true);
    const surovy = JSON.parse(Buffer.from(hash.split('=')[1], 'base64url').toString());
    assert.equal(surovy.v, SHARE_LINK_VERSION);
    const r = readLink(`https://example.test/ray-mon/${hash}`);
    assert.equal(r?.error, null);
    assert.deepEqual(r?.settings && toUser(r.settings), toUser(PLNE));
    assert.deepEqual(settingsFromLink(hash), r?.settings);
});

test('readLink: starý odkaz bez verzie je verzia 1 a prečíta sa ako doteraz', () => {
    const r = readLink(odkaz(toUser(PLNE)));
    assert.equal(r?.error, null);
    assert.ok(r?.settings);
});

test('readLink: odkaz z novšej verzie appky nič nezahodí potichu, povie prečo', () => {
    // Aj keď by sa nastavenie dalo prečítať - novšia verzia v ňom môže myslieť niečo iné.
    assert.deepEqual(readLink(odkaz({ v: SHARE_LINK_VERSION + 1, ...toUser(PLNE) })), { settings: null, error: 'novsi' });
    assert.deepEqual(readLink(odkaz({ v: SHARE_LINK_VERSION + 1, nieco: 'nové' })), { settings: null, error: 'novsi' });
    assert.equal(settingsFromLink(odkaz({ v: SHARE_LINK_VERSION + 1, ...toUser(PLNE) })), null);
});

test('readLink: poškodený alebo neúplný odkaz povie, že je poškodený; text bez odkazu je null', () => {
    const cely = shareHash(PLNE, false);
    for (const zly of [cely.slice(0, -12), `#${SHARE_HASH_KEY}=`, `#${SHARE_HASH_KEY}=%%%`, odkaz({ v: 1, site: {} }), odkaz([1, 2])])
        assert.deepEqual(readLink(zly), { settings: null, error: 'poskodeny' }, zly);
    assert.equal(readLink(`#${SHARE_HASH_KEY}=${'A'.repeat(8001)}`)?.error, 'poskodeny', 'priveľký odkaz sa ani nečíta');
    assert.equal(readLink('ahoj, tu je nejaký text'), null);
    assert.equal(readLink('#prva=terazky'), null);
});

test('texty pre odkaz, ktorý appka nevie prevziať: nadpis, veta a veta pri vloženom odkaze', () => {
    for (const e of /** @type {const} */ (['poskodeny', 'novsi'])) {
        assert.ok(LINK_ERRORS[e].title && LINK_ERRORS[e].text && LINK_ERRORS[e].paste);
        assert.match(LINK_ERRORS[e].text, /\.$/);
    }
    assert.match(LINK_ERRORS.novsi.text, /^Aktualizuj appku/);
});
