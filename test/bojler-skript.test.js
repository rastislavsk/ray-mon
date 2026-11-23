// Skript do zásuvky Shelly: pustí sa v podvrhnutom prostredí Shelly (Shelly.call, Timer.set)
// a overí sa, čo pošle Workeru a ako poslúchne.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { adresaTeplomera, skriptBojlera } from '../shared/bojler-skript.js';
import { BOJLER, WORKER_BOJLER_URL } from '../shared/config.js';

/**
 * Zásuvka s relé a skriptom. `odpoved` rozhodne, čo vráti Worker (null = chyba spojenia), `teplomer` čo vráti
 * teplomer v domácej sieti.
 * @param {string} kod @param {(telo: any) => { code: number, body: string } | null} odpoved
 * @param {(url: string) => { code: number, body: string } | null} [teplomer]
 */
function zasuvka(kod, odpoved, teplomer) {
    const z = { output: false, apower: 0, aenergy: { total: 1234.5 } };
    /** @type {any[]} */ const dopyty = [];
    /** @type {Array<() => void>} */ const casovace = [];
    const Shelly = {
        getComponentStatus: (/** @type {string} */ typ) => (typ === 'switch' ? { ...z } : null),
        call: (/** @type {string} */ metoda, /** @type {any} */ p, /** @type {any} */ cb) => {
            if (metoda === 'Switch.Set') {
                z.output = p.on;
                z.apower = p.on ? 2200 : 0;
                return;
            }
            if (metoda === 'HTTP.GET' && teplomer) {
                const t = teplomer(p.url);
                cb(t, t ? 0 : -114, t ? '' : 'chyba');
                return;
            }
            assert.equal(metoda, 'HTTP.POST');
            assert.ok(p.body.length > 0, 'telo nikdy prázdne');
            const telo = JSON.parse(p.body);
            dopyty.push({ url: p.url, telo });
            const r = odpoved(telo);
            cb(r, r ? 0 : -114, r ? '' : 'chyba');
        },
    };
    const Timer = { set: (/** @type {number} */ ms, /** @type {boolean} */ opak, /** @type {() => void} */ fn) => casovace.push(fn) };
    vm.runInNewContext(kod, { Shelly, Timer, JSON });
    return { z, dopyty, minuta: () => casovace.forEach((f) => f()) };
}

const PECAT = 'v1.abc_DEF-123.xyz';

test('skript: pošle pečať, relé, príkon, počítadlo a prahy, poslúchne Worker', () => {
    const kod = /** @type {string} */ (skriptBojlera({ url: WORKER_BOJLER_URL, pecat: PECAT, zapKw: 2.3, vypKw: 2 }));
    let zapni = true;
    const s = zasuvka(kod, () => ({ code: 200, body: JSON.stringify({ zapni }) }));
    assert.equal(s.dopyty.length, 1, 'hneď po spustení');
    assert.deepEqual(s.dopyty[0], {
        url: WORKER_BOJLER_URL,
        telo: { pecat: PECAT, rele: false, w: 0, e: 1234.5, zapKw: 2.3, vypKw: 2 },
    });
    assert.equal(s.z.output, true);
    s.minuta();
    assert.equal(s.dopyty[1].telo.w, 2200);
    zapni = false;
    s.minuta();
    assert.equal(s.z.output, false);
});

test('skript: bez odpovede drží stav a po BOJLER.tichoMin minútach vypne', () => {
    const kod = /** @type {string} */ (skriptBojlera({ url: WORKER_BOJLER_URL, pecat: PECAT, zapKw: 2.3, vypKw: 2 }));
    let ok = true;
    const s = zasuvka(kod, () => (ok ? { code: 200, body: '{"zapni":true}' } : null));
    assert.equal(s.z.output, true);
    ok = false;
    for (let i = 1; i < BOJLER.tichoMin; i++) s.minuta();
    assert.equal(s.z.output, true, `${BOJLER.tichoMin - 1} minút bez odpovede ešte drží`);
    s.minuta();
    assert.equal(s.z.output, false);
    // Odpoveď 502 a nezmysel v tele sa rátajú ako ticho.
    const z = zasuvka(kod, () => ({ code: 502, body: 'x' }));
    const n = zasuvka(kod, () => ({ code: 200, body: 'nie json' }));
    assert.deepEqual([z.z.output, n.z.output], [false, false]);
});

test('skript: v ručnom režime relé neprepne - ani na pokyn, ani pri tichu', () => {
    const kod = /** @type {string} */ (skriptBojlera({ url: WORKER_BOJLER_URL, pecat: PECAT, zapKw: 2.3, vypKw: 2 }));
    let ok = true;
    const s = zasuvka(kod, () => (ok ? { code: 200, body: '{"zapni":false,"rucne":true}' } : null));
    // Človek zapol bojler v appke Shelly: skript to len nahlási.
    s.z.output = true;
    s.minuta();
    assert.equal(s.z.output, true);
    assert.equal(s.dopyty[1].telo.rele, true);
    ok = false;
    for (let i = 0; i < BOJLER.tichoMin + 2; i++) s.minuta();
    assert.equal(s.z.output, true, 'v ručnom režime ani výpadok internetu bojler nevypne');
});

test('skript: pečať ani adresa s úvodzovkami sa do skriptu nedostanú', () => {
    assert.equal(skriptBojlera({ url: WORKER_BOJLER_URL, pecat: "v1.a';Shelly.call('Switch.Set')", zapKw: 2.3, vypKw: 2 }), null);
    assert.equal(skriptBojlera({ url: "https://x.sk/'", pecat: PECAT, zapKw: 2.3, vypKw: 2 }), null);
    assert.equal(skriptBojlera({ url: 'http://x.sk/', pecat: PECAT, zapKw: 2.3, vypKw: 2 }), null);
});

test('skript: jazyk Shelly - bez šípok, let/const, čiarok pred zátvorkou a šablón', () => {
    const kod = /** @type {string} */ (skriptBojlera({ url: WORKER_BOJLER_URL, pecat: PECAT, zapKw: 2.3, vypKw: 2 }));
    assert.doesNotMatch(kod, /=>|\blet\b|\bconst\b|,\s*[)}\]]|`/);
});

const TEPLOMER = { ip: '10.10.10.50', heslo: "tajn'e @heslo" };

test('skript s teplomerom: prečíta teplotu v domácej sieti a pošle ju, bez nej pošle null', () => {
    const kod = /** @type {string} */ (skriptBojlera({ url: WORKER_BOJLER_URL, pecat: PECAT, zapKw: 2.3, vypKw: 2, teplomer: TEPLOMER }));
    assert.doesNotMatch(kod, /=>|let|const|,s*[)}]]|`/);
    /** @type {string[]} */ const adresy = [];
    let teplota = /** @type {{ code: number, body: string } | null} */ ({ code: 200, body: '{"id":100,"tC":60.5,"tF":140.9}' });
    const s = zasuvka(
        kod,
        () => ({ code: 200, body: '{"zapni":true}' }),
        (url) => (adresy.push(url), teplota),
    );
    assert.equal(adresy[0], 'http://admin:tajn%27e%20%40heslo@10.10.10.50/rpc/Temperature.GetStatus?id=' + BOJLER.teplomerId);
    assert.equal(s.dopyty[0].telo.t, 60.5);
    assert.equal(s.z.output, true, 'poslúchne ako bez teplomera');
    teplota = null;
    s.minuta();
    assert.equal(s.dopyty[1].telo.t, null, 'teplomer bez spojenia - hlásenie ide aj tak');
    teplota = { code: 401, body: '' };
    s.minuta();
    teplota = { code: 200, body: 'nie json' };
    s.minuta();
    teplota = { code: 200, body: '{"tC":null}' };
    s.minuta();
    assert.deepEqual(
        s.dopyty.slice(2).map((d) => d.telo.t),
        [null, null, null],
    );
});

test('adresa teplomera: len IP či meno a neprázdne heslo', () => {
    assert.equal(
        adresaTeplomera({ ip: ' 10.10.10.50 ', heslo: 'abc' }),
        'http://admin:abc@10.10.10.50/rpc/Temperature.GetStatus?id=' + BOJLER.teplomerId,
    );
    assert.equal(adresaTeplomera({ ip: 'bojler-teplomer.local', heslo: 'abc' })?.includes('@bojler-teplomer.local/'), true);
    assert.equal(adresaTeplomera({ ip: '10.10.10.50', heslo: '' }), null);
    assert.equal(adresaTeplomera({ ip: '', heslo: 'abc' }), null);
    assert.equal(adresaTeplomera({ ip: "10.0.0.1/x'", heslo: 'abc' }), null);
    assert.equal(adresaTeplomera({ ip: 'a@b', heslo: 'abc' }), null);
    assert.equal(skriptBojlera({ url: WORKER_BOJLER_URL, pecat: PECAT, zapKw: 2.3, vypKw: 2, teplomer: { ip: '', heslo: 'x' } }), null);
});

test('skript s teplomerom: hranicu od Workera stráži sám - vypne pri nej, pustí až pod návratom, aj bez Workera', () => {
    const kod = /** @type {string} */ (skriptBojlera({ url: WORKER_BOJLER_URL, pecat: PECAT, zapKw: 2.3, vypKw: 2, teplomer: TEPLOMER }));
    assert.doesNotMatch(kod, /=>|\blet\b|\bconst\b|,\s*[)}\]]|`/);
    let t = 50;
    let worker = /** @type {{ code: number, body: string } | null} */ ({ code: 200, body: '{"zapni":true,"maxC":60,"minC":55}' });
    const s = zasuvka(
        kod,
        () => worker,
        () => ({ code: 200, body: JSON.stringify({ tC: t }) }),
    );
    assert.equal(s.z.output, true, 'pod hranicou poslúchne');
    t = 60;
    s.minuta();
    assert.equal(s.z.output, false, 'pri hranici vypne, hoci Worker hovorí zapni');
    t = 57;
    s.minuta();
    assert.equal(s.z.output, false, 'medzi hranicou a návratom nepustí');
    t = 55;
    s.minuta();
    assert.equal(s.z.output, true, 'na návrate znova poslúchne');
    // Bez Workera: posledná hranica platí, nahriatu vodu vypne hneď.
    worker = null;
    t = 61;
    s.minuta();
    assert.equal(s.z.output, false);
    // Ručný režim: hranicu nestráži.
    worker = { code: 200, body: '{"zapni":true,"rucne":true,"maxC":60,"minC":55}' };
    s.z.output = true;
    s.minuta();
    s.minuta();
    assert.equal(s.z.output, true);
});
