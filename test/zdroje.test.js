import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../shared/setup-texts.js';
import { isPecat, menoZnacky, parseZdroj, SPOSOBY, sposobOf, sposobyOf, udajeOk, ZNACKY, znackaOf } from '../shared/zdroje.js';

const KIOSK = 'https://region01eu5.fusionsolar.huawei.com/pvmswebsite/nologin/assets/build/index.html#/kiosk?kk=Abc123xyz';
const PECAT = 'v1.AbCdEfGhIjKlMnOpQrStUvWxYz012345';

test('katalóg: každý spôsob patrí značke, ktorá ho ponúka; nedostupné značky povedia prečo', () => {
    for (const s of SPOSOBY) {
        const z = znackaOf(s.znacka);
        assert.ok(z && 'sposoby' in z && z.sposoby.includes(s.id), `${s.id} chýba pri značke`);
        assert.ok(s.pola.length && s.kroky.length && s.tagy.length >= 2 && s.zrusenie, `${s.id} má neúplný návod`);
    }
    for (const z of ZNACKY) {
        if ('nie' in z) assert.ok(z.nie.endsWith('.'), `${z.meno}: vysvetlenie je veta`);
        else assert.ok(sposobyOf(z).length > 0, `${z.meno}: bez spôsobov`);
    }
    assert.equal(new Set(ZNACKY.map((z) => z.id)).size, ZNACKY.length);
    assert.deepEqual(sposobyOf(/** @type {any} */ (znackaOf('fronius'))), []);
    assert.equal(sposobOf('neznamy'), null);
    assert.equal(menoZnacky('huawei-kiosk'), 'Huawei');
    assert.equal(menoZnacky('neznamy'), '');
});

test('parseZdroj: zapečatený prístup, holý kiosk zo starých nastavení, inak null', () => {
    const z = { sposob: 'huawei-kiosk', pecat: PECAT, nazov: 'Dvorany' };
    assert.deepEqual(parseZdroj(z), z);
    assert.deepEqual(parseZdroj({ ...z, pecat: KIOSK }), { ...z, pecat: KIOSK }, 'kiosk spred zapečatenia v novom tvare');
    assert.deepEqual(parseZdroj(undefined, KIOSK), { sposob: 'huawei-kiosk', pecat: KIOSK, nazov: '' });
    assert.equal(parseZdroj({ ...z, nazov: 'x'.repeat(200) })?.nazov.length, 80);
    assert.deepEqual(parseZdroj({ sposob: 'huawei-kiosk', pecat: PECAT }), { sposob: 'huawei-kiosk', pecat: PECAT, nazov: '' });
    for (const bad of [
        { ...z, sposob: 'neznamy' },
        { ...z, pecat: 'https://example.com/?kk=Abc123xyz' },
        { ...z, pecat: 'v1.kratka' },
        null,
        'text',
    ])
        assert.equal(parseZdroj(bad), null, JSON.stringify(bad));
    assert.equal(parseZdroj(undefined, ''), null);
    assert.equal(parseZdroj(undefined, 'https://example.com/?kk=Abc123xyz'), null);
    assert.equal(isPecat(PECAT), true);
    assert.equal(isPecat(KIOSK), false);
});

test('udajeOk: všetky polia vyplnené, odkaz naozaj na kiosk', () => {
    assert.equal(udajeOk('huawei-kiosk', { odkaz: KIOSK }), true);
    assert.equal(udajeOk('huawei-kiosk', { odkaz: '' }), false);
    assert.equal(udajeOk('huawei-kiosk', {}), false);
    assert.equal(udajeOk('huawei-kiosk', { odkaz: 'https://example.com/?kk=Abc123xyz' }), false);
    assert.equal(udajeOk('neznamy', { odkaz: KIOSK }), false);
});

test('texty pripojenia: hlásenia podľa stavu, nájdené elektrárne a riadok zhrnutia', () => {
    const idle = { status: /** @type {const} */ ('idle'), chyba: /** @type {const} */ (''), stanice: [] };
    assert.equal(T.pripojNote(idle, 'huawei-kiosk'), null);
    assert.match(T.pripojNote({ ...idle, status: 'loading' }, 'huawei-kiosk')?.text ?? '', /^Pýtam sa Huawei…/);
    for (const chyba of /** @type {const} */ (['udaje', 'vyrobca', 'server'])) {
        const note = T.pripojNote({ ...idle, status: 'error', chyba }, 'huawei-kiosk');
        assert.equal(note?.err, true);
        assert.ok(note?.text.endsWith('.'));
    }
    assert.match(T.pripojNote({ ...idle, status: 'error', chyba: 'udaje' }, 'huawei-kiosk')?.text ?? '', /^Huawei údaje neprijal/);
    assert.equal(T.udajeNote('huawei-kiosk', {}), null);
    assert.equal(T.udajeNote('huawei-kiosk', { odkaz: KIOSK })?.err, false);
    assert.equal(T.udajeNote('huawei-kiosk', { odkaz: 'x' })?.err, true);
    assert.equal(T.staniceTitle(1, 'huawei-kiosk'), 'Pripojené');
    assert.equal(T.staniceTitle(2, 'huawei-kiosk'), 'Na účte Huawei sú 2. Vyber tú, ktorú má appka sledovať.');
    const pv = /** @type {any} */ ({ realTimePowerKw: 3.41, dailyEnergyKwh: 18.24 });
    assert.equal(T.stanicaMeta({ nazov: '', pecat: PECAT, pv }), 'teraz 3,4 kW · dnes 18,2 kWh');
    assert.equal(T.stanicaMeta({ nazov: '', pecat: PECAT, pv: { ...pv, realTimePowerKw: null } }), 'dnes 18,2 kWh');
    assert.equal(
        T.stanicaMeta({ nazov: '', pecat: PECAT, pv: { ...pv, realTimePowerKw: null, dailyEnergyKwh: null } }),
        'meranie zatiaľ neprišlo',
    );
    assert.equal(T.stanicaMeta({ nazov: '', pecat: PECAT, pv: null }), 'meranie zatiaľ neprišlo');
    assert.equal(T.zdrojText({ sposob: 'huawei-kiosk', pecat: PECAT, nazov: 'Dvorany' }), 'Huawei · Dvorany');
    assert.equal(T.zdrojText({ sposob: 'huawei-kiosk', pecat: PECAT, nazov: '' }), 'Huawei · odkaz na kiosk');
});

test('sprievodca pri pripájaní: titulky podľa značky a spôsobu, Späť aj pri úprave z prehľadu', async () => {
    const { PLANT, SITE, TARIFF } = await import('../shared/config.js');
    const flow = await import('../shared/setup-flow.js');
    const owner = { site: SITE, plant: PLANT, tariff: TARIFF, zdroj: null };
    /** @param {any} patch @returns {any} */
    const st = (patch) => ({ now: new Date(), known: 'elektraren', ...owner, ...flow.setupInit(owner, 'elektraren'), ...patch });
    assert.equal(T.textsFor(st({ setupZnacka: 'huawei' }), owner, 'sposob').title, 'Ako pripojíš Huawei?');
    assert.equal(T.textsFor(st({ setupZnacka: 'fronius' }), owner, 'sposob').title, 'Fronius zatiaľ pripojiť nevieme');
    assert.equal(T.textsFor(st({ setupZnacka: '' }), owner, 'sposob').title, 'Ako pripojíš menič?');
    assert.equal(T.textsFor(st({ setupSposob: 'huawei-kiosk' }), owner, 'pripoj').title, 'Odkaz na kiosk');
    assert.equal(T.textsFor(st({ setupSposob: '' }), owner, 'pripoj').title, 'Pripoj menič');
    assert.equal(T.textsFor(st({}), owner, 'znacka').title, 'Akú značku má tvoj menič?');
    // Úprava merania z prehľadu: z otázky „Ďalej“ (nie Uložiť), na podobrazovkách Späť, nie Zrušiť.
    const edit = st({ setupReturn: 'prehlad', setupLive: true });
    const foot = T.footModel(edit, owner, 'meranie', true);
    assert.equal(foot.next, 'Ďalej');
    assert.equal(foot.nextOff, false);
    for (const step of /** @type {const} */ (['znacka', 'sposob', 'pripoj'])) {
        const f = T.footModel(edit, owner, step, false);
        assert.equal(f.back, 'Späť', step);
        assert.equal(f.backShown, true, step);
    }
    assert.equal(T.footModel(st({ setupReturn: 'suhrn' }), owner, 'znacka', false).backShown, true);
});

test('hláška pripojenia podľa kódu od Huawei: relácia v Shelly, oprávnenie, limit, inak kód pri všeobecnej', () => {
    /** @param {'udaje' | 'vyrobca'} chyba @param {string} kod */
    const note = (chyba, kod) => T.pripojNote({ status: 'error', chyba, kod, stanice: [] }, 'huawei-northbound')?.text ?? '';
    assert.match(note('udaje', 'prihlasenie:20400'), /kód 20400.*Shelly/);
    assert.match(note('udaje', 'prihlasenie:20403'), /kód 20403\)\. Ozvi sa inštalatérovi/);
    assert.match(note('vyrobca', 'prihlasenie:407'), /5-krát za 10 minút \(kód 407\)/);
    assert.match(note('udaje', 'zoznam:401'), /^Účet nemá povolené rozhranie \(zoznam elektrární, kód 401\)\. Inštalatér/);
    assert.equal(
        note('vyrobca', 'meranie:HTTP 403'),
        'Huawei teraz neodpovedá alebo nič nenašiel. Skús to o chvíľu znova (meranie, kód HTTP 403).',
    );
    assert.equal(
        note('udaje', 'zariadenia:20009'),
        'Huawei údaje neprijal. Skontroluj, či si skopíroval všetko celé (zoznam zariadení, kód 20009).',
    );
    assert.equal(note('vyrobca', 'prihlasenie'), 'Huawei teraz neodpovedá alebo nič nenašiel. Skús to o chvíľu znova (prihlásenie).');
    assert.equal(note('udaje', ''), 'Huawei údaje neprijal. Skontroluj, či si skopíroval všetko celé.');
});
