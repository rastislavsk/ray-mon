import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installedKw, PLANT, SETTINGS_LIMITS, SITE, TARIFF, TARIFF_TEMPLATES, TYPICAL_PLANT } from '../shared/config.js';
import {
    DEFAULT_LOOK,
    lookToStored,
    parseLook,
    checkSettings,
    isTimezone,
    parseGeocode,
    parseStoredSettings,
    parseStoredSite,
    sameSettings,
    settingsFrom,
    settingsHint,
    siteMetaText,
    toUser,
    typicalSettings,
} from '../shared/settings.js';

const DVORANY = { site: SITE, plant: PLANT, tariff: TARIFF, zdroj: null };
const KIOSK = 'https://region01eu5.fusionsolar.huawei.com/pvmswebsite/nologin/assets/build/index.html#/kiosk?kk=Abc123xyz';
// Pripojené meranie so zapečateným prístupom (tvar ako od Workera, obsah nikto okrem neho nečíta).
const ZDROJ = { sposob: 'huawei-kiosk', pecat: 'v1.AbCdEfGhIjKlMnOpQrStUvWxYz012345', nazov: 'Dvorany' };

const SEVILLA = { name: 'Sevilla', lat: 37.39, lon: -5.98, elevationM: 10, timezone: 'Europe/Madrid' };

test('len poloha: typická strecha v nej a jedna cena, prejde kontrolou', () => {
    const typical = typicalSettings(SEVILLA);
    assert.equal(typical.site, SEVILLA);
    assert.equal(typical.plant, TYPICAL_PLANT);
    assert.equal(typical.tariff, TARIFF_TEMPLATES.jedna);
    assert.equal(typical.zdroj, null);
    const check = checkSettings(typical);
    assert.deepEqual(check.errors, []);
    assert.equal(check.kwp, 12 * 0.435);
    assert.equal(check.panels, 12);
});

test('uložená poloha: platná sa načíta, čokoľvek nesedí, je null', () => {
    assert.deepEqual(parseStoredSite(JSON.parse(JSON.stringify(SEVILLA))), SEVILLA);
    assert.deepEqual(parseStoredSite({ ...SEVILLA, elevationM: undefined }), { ...SEVILLA, elevationM: 0 });
    assert.equal(parseStoredSite(null), null);
    assert.equal(parseStoredSite('Sevilla'), null);
    assert.equal(parseStoredSite({ ...SEVILLA, name: '' }), null);
    assert.equal(parseStoredSite({ ...SEVILLA, lat: 95 }), null);
    assert.equal(parseStoredSite({ ...SEVILLA, timezone: 'Mars/Olympus' }), null);
});

test('Dvorany prejdú kontrolou bez varovaní', () => {
    assert.deepEqual(checkSettings(DVORANY), { errors: [], warnings: [], kwp: (24 * 435) / 1000, panels: 24 });
});

test('kWp je v appke jedno číslo: kontrola, súhrn aj ciferník ho berú z installedKw', () => {
    // Karta 7 dní ukazovala 10,4 kWp (zaokrúhlené installedKw), Nastavenie 10,44 kWp (vlastný súčet).
    assert.equal(installedKw(PLANT), 10.44);
    assert.equal(checkSettings(DVORANY).kwp, installedKw(PLANT));
});

test('chyby: rozsahy, celé čísla, časové pásmo, počet plôch', () => {
    const bad = settingsFrom({
        site: { ...SITE, lat: 95, lon: NaN, timezone: 'Mars/Olympus' },
        strings: [
            { panels: 2.5, azimuthDeg: 180, tiltDeg: 95 },
            { panels: 0, azimuthDeg: 360, tiltDeg: 30 },
        ],
        panelWp: 50,
        acLimitKw: 0,
        tariff: TARIFF,
    });
    const { errors, kwp } = checkSettings(bad);
    assert.equal(kwp, null);
    for (const part of [
        'šírka',
        'dĺžka',
        'časové pásmo',
        'Plocha 1: počet',
        'Plocha 1: sklon',
        'Plocha 2: počet',
        'Plocha 2: vyber',
        'panelu',
        'Menič',
    ])
        assert.ok(
            errors.some((e) => e.includes(part)),
            `chýba chyba „${part}“`,
        );
    const none = settingsFrom({ ...toUser(DVORANY), strings: [] });
    assert.ok(checkSettings(none).errors.some((e) => e.includes('Plôch panelov')));
});

test('varovania: menič menší než panely, plocha na juh na južnej pologuli', () => {
    const tiny = settingsFrom({ ...toUser(DVORANY), acLimitKw: 5 });
    assert.equal(checkSettings(tiny).warnings.length, 1);
    assert.ok(checkSettings(tiny).warnings[0].includes('orezávať'));
    const sydney = settingsFrom({
        ...toUser(DVORANY),
        site: { name: 'Sydney', lat: -33.87, lon: 151.21, elevationM: 40, timezone: 'Australia/Sydney' },
    });
    assert.ok(checkSettings(sydney).warnings.some((w) => w.includes('južnej pologuli')));
    const north = settingsFrom({ ...toUser(sydney), strings: [{ panels: 10, azimuthDeg: 0, tiltDeg: 30 }] });
    assert.deepEqual(checkSettings(north).warnings, []);
});

test('uloženie a načítanie: odborné parametre sa dopĺňajú z config.js', () => {
    const stored = JSON.parse(JSON.stringify(toUser(DVORANY)));
    assert.equal('albedo' in stored, false);
    const back = parseStoredSettings(stored);
    assert.ok(back);
    assert.deepEqual(back, DVORANY);
    assert.ok(sameSettings(back, DVORANY));
    assert.ok(!sameSettings(back, typicalSettings(SITE)));
});

test('uložené nastavenie, ktoré nesedí, sa zahodí', () => {
    const ok = toUser(DVORANY);
    for (const bad of [
        null,
        'text',
        {},
        { ...ok, strings: 'x' },
        { ...ok, site: null },
        { ...ok, site: { ...ok.site, name: '' } },
        { ...ok, site: { ...ok.site, timezone: 'Nikde/Nic' } },
        { ...ok, panelWp: '435 Wp' },
        { ...ok, strings: [null] },
    ])
        assert.equal(parseStoredSettings(bad), null, JSON.stringify(bad));
    // Chýbajúca výška nevadí - je to len korekcia bezoblačného stropu.
    const noElev = parseStoredSettings({ ...ok, site: { ...ok.site, elevationM: undefined } });
    assert.equal(noElev && noElev.site.elevationM, 0);
});

test('isTimezone', () => {
    assert.ok(isTimezone('Europe/London'));
    assert.ok(!isTimezone(''));
    assert.ok(!isTimezone(42));
    assert.ok(!isTimezone('Mars/Olympus'));
});

test('parseGeocode: lokalita s krajom a štátom, bez časového pásma sa vynechá', () => {
    const json = {
        results: [
            {
                name: 'Nitra',
                latitude: 48.31,
                longitude: 18.09,
                elevation: 150,
                timezone: 'Europe/Bratislava',
                admin1: 'Nitriansky kraj',
                country: 'Slovensko',
            },
            { name: 'Bez pásma', latitude: 1, longitude: 2 },
            { name: 'Sydney', latitude: -33.87, longitude: 151.21, timezone: 'Australia/Sydney', country: 'Austrália' },
            { latitude: 1, longitude: 2, timezone: 'Europe/London' },
        ],
    };
    assert.deepEqual(parseGeocode(json), [
        {
            site: { name: 'Nitra', lat: 48.31, lon: 18.09, elevationM: 150, timezone: 'Europe/Bratislava' },
            detail: 'Nitriansky kraj, Slovensko',
        },
        { site: { name: 'Sydney', lat: -33.87, lon: 151.21, elevationM: 0, timezone: 'Australia/Sydney' }, detail: 'Austrália' },
    ]);
    assert.deepEqual(parseGeocode({}), []);
    assert.deepEqual(parseGeocode(null), []);
});

test('texty: súradnice podľa pologule, súhrn jedným riadkom', () => {
    assert.equal(siteMetaText(SITE), '48,48° s. š. · 18,12° v. d. · 180 m n. m. · Europe/Bratislava');
    assert.equal(siteMetaText(SEVILLA), '37,39° s. š. · 5,98° z. d. · 10 m n. m. · Europe/Madrid');
    assert.equal(
        siteMetaText({ name: 'Sydney', lat: -33.87, lon: 151.21, elevationM: 40, timezone: 'Australia/Sydney' }),
        '33,87° j. š. · 151,21° v. d. · 40 m n. m. · Australia/Sydney',
    );
    assert.equal(siteMetaText({ ...SITE, lat: NaN }), 'Súradnice nie sú zadané.');
    assert.equal(settingsHint(DVORANY), 'Dvorany nad Nitrou · 10,44 kWp');
    assert.equal(settingsHint(typicalSettings(SEVILLA)), 'Sevilla · 5,22 kWp');
});

test('meranie: bez neho null, pripojené sa uloží, staré nastavenia s holým kiosk odkazom platia ďalej', () => {
    assert.deepEqual(checkSettings({ ...DVORANY, zdroj: ZDROJ }).errors, []);
    const bad = { ...DVORANY, zdroj: { ...ZDROJ, pecat: 'https://example.com/?kk=Abc123xyz' } };
    assert.ok(checkSettings(bad).errors.some((e) => e.includes('meranie')));
    assert.deepEqual(parseStoredSettings(toUser({ ...DVORANY, zdroj: ZDROJ }))?.zdroj, ZDROJ);
    assert.ok(!sameSettings({ ...DVORANY, zdroj: ZDROJ }, DVORANY));
    // Nastavenie spred zapečatenia: holý odkaz na kiosk sa prečíta ako spôsob huawei-kiosk.
    const stare = /** @type {Partial<ReturnType<typeof toUser>>} */ (toUser(DVORANY));
    delete stare.zdroj;
    assert.deepEqual(parseStoredSettings({ ...stare, kiosk: KIOSK })?.zdroj, { sposob: 'huawei-kiosk', pecat: KIOSK, nazov: '' });
    // Spred pridania kiosku, alebo so zlým meraním: bez merania, ostatné platí.
    assert.equal(parseStoredSettings(stare)?.zdroj, null);
    assert.equal(parseStoredSettings({ ...stare, kiosk: 'https://example.com/?kk=Abc123xyz' })?.zdroj, null);
    assert.equal(parseStoredSettings(toUser(bad))?.zdroj, null);
    assert.equal(parseStoredSettings({ ...stare, zdroj: { ...ZDROJ, sposob: 'neznamy' } })?.zdroj, null);
});

test('zdieľanie: odkaz s nastavením sa rozbalí na to isté, aj s diakritikou a južnou pologuľou', async () => {
    const { shareHash, shareUrl, settingsFromLink } = await import('../shared/settings.js');
    const app = 'https://example.test/appka/';
    assert.equal(shareUrl(app, null, true), app);
    assert.equal(shareHash(null, true), '');
    const withKiosk = { ...DVORANY, zdroj: ZDROJ };
    const url = shareUrl(app, withKiosk, true);
    assert.match(url, /^https:\/\/example\.test\/appka\/#nastavenie=[A-Za-z0-9_-]+$/);
    assert.deepEqual(settingsFromLink(url), withKiosk);
    // Bez merania ostane všetko ostatné.
    assert.deepEqual(settingsFromLink(shareUrl(app, withKiosk, false)), DVORANY);
    // Samotná časť za mriežkou (location.hash) stačí rovnako.
    assert.deepEqual(settingsFromLink(`#${url.split('#')[1]}`), withKiosk);
    assert.equal(shareHash(withKiosk, true), `#${url.split('#')[1]}`);
    const south = settingsFrom({
        ...toUser(DVORANY),
        site: { name: 'Žilina – Považský Chlmec', lat: -33.87, lon: 151.21, elevationM: 40, timezone: 'Australia/Sydney' },
    });
    assert.deepEqual(settingsFromLink(shareUrl(app, south, true)), south);
});

test('zdieľanie: nezmysel alebo poškodený odkaz nič neprevezme, cudzí kiosk len bez merania', async () => {
    const { shareUrl, settingsFromLink } = await import('../shared/settings.js');
    const url = shareUrl('https://x.test/', DVORANY, true);
    for (const bad of [
        '',
        'https://x.test/',
        'https://x.test/#nastavenie=',
        'https://x.test/#nastavenie=@@@',
        'https://x.test/#nastavenie=bm9uLWpzb24',
        url.slice(0, -10),
        // Výška mimo rozsahu by bezoblačnému modelu dala nezmyselný strop.
        shareUrl('https://x.test/', { ...DVORANY, site: { ...DVORANY.site, elevationM: 1e6 } }, false),
    ])
        assert.equal(settingsFromLink(bad), null, bad);
    const cudzi = shareUrl('https://x.test/', { ...DVORANY, zdroj: { ...ZDROJ, pecat: 'https://example.com/?kk=Abc123xyz' } }, true);
    assert.deepEqual(settingsFromLink(cudzi), DVORANY);
});

test('tarifa: uloží sa aj s cenami, staré nastavenie bez nej dostane tarifu Dvorian, chybná zahodí všetko', async () => {
    const { shareUrl, settingsFromLink } = await import('../shared/settings.js');
    const priced = {
        ...DVORANY,
        tariff: { ...TARIFF, bands: TARIFF.bands.map((b, i) => ({ ...b, price: i ? 0.19 : 0.12 })) },
    };
    const back = parseStoredSettings(JSON.parse(JSON.stringify(toUser(priced))));
    assert.deepEqual(back, priced);
    assert.ok(!sameSettings(priced, DVORANY), 'iná cena je iné nastavenie');
    assert.deepEqual(settingsFromLink(shareUrl('https://x.test/', priced, false)), priced);
    // Nastavenie uložené pred vlastnými tarifami.
    const old = /** @type {Partial<ReturnType<typeof toUser>>} */ (toUser(DVORANY));
    delete old.tariff;
    assert.equal(parseStoredSettings(old)?.tariff, TARIFF);
    // Tarifa, ktorá tam je, no nesedí: nič z nastavenia sa nepoužije.
    const bad = { ...toUser(DVORANY), tariff: { ...TARIFF, schedules: [] } };
    assert.equal(parseStoredSettings(bad), null);
    assert.ok(checkSettings({ ...DVORANY, tariff: { ...TARIFF, currency: '' } }).errors.some((e) => /Mena/.test(e)));
});

test('prvá karta už do odkazu nejde; starší odkaz s ňou sa prečíta rovnako', async () => {
    const { shareHash, shareUrl, settingsFromLink } = await import('../shared/settings.js');
    assert.equal(shareHash(null, true), '');
    assert.match(shareUrl('https://x.test/', DVORANY, true), /^https:\/\/x\.test\/#nastavenie=[\w-]+$/);
    const stary = `${shareUrl('https://x.test/', DVORANY, true)}&prva=mozem`;
    assert.deepEqual(settingsFromLink(stary), DVORANY, 'appka sa otvára na Terazkách, nastavenie z odkazu platí');
});

test('parseLook: chýbajúci či neplatný vzhľad je predvolený, každá voľba zvlášť', () => {
    assert.deepEqual(DEFAULT_LOOK, { voice: 'drzy', liveSky: true });
    for (const raw of [null, undefined, 'slusny', 42, [], {}]) assert.deepEqual(parseLook(raw), DEFAULT_LOOK, String(raw));
    assert.deepEqual(parseLook({ ton: 'slusny', obloha: false }), { voice: 'slusny', liveSky: false });
    assert.deepEqual(parseLook({ ton: 'drzy', obloha: true }), { voice: 'drzy', liveSky: true });
    assert.deepEqual(parseLook({ ton: 'vulgarny', obloha: false }), { voice: 'drzy', liveSky: false });
    assert.deepEqual(parseLook({ ton: 'slusny', obloha: 'nie' }), { voice: 'slusny', liveSky: true });
    // Uložený tvar sa prečíta späť ten istý.
    const look = { voice: /** @type {const} */ ('slusny'), liveSky: false };
    assert.deepEqual(lookToStored(look), { ton: 'slusny', obloha: false });
    assert.deepEqual(parseLook(JSON.parse(JSON.stringify(lookToStored(look)))), look);
});

test('názov lokality: dlhší než SETTINGS_LIMITS.siteNameMax je chyba aj v uloženej polohe', () => {
    const N = SETTINGS_LIMITS.siteNameMax;
    const named = (/** @type {string} */ name) => checkSettings({ ...DVORANY, site: { ...SITE, name } }).errors;
    assert.deepEqual(named('x'.repeat(N)), []);
    assert.ok(named('x'.repeat(N + 1)).some((e) => /Názov lokality/.test(e)));
    assert.equal(parseStoredSite({ ...SEVILLA, name: 'x'.repeat(N + 1) }), null);
});

test('incomingSettings: to isté sa neponúka, ani keď odkaz nenesie meranie a uložené ho má', async () => {
    const { incomingSettings } = await import('../shared/settings.js');
    const ulozene = { ...DVORANY, zdroj: ZDROJ };
    assert.equal(incomingSettings(null, ulozene), null);
    assert.equal(incomingSettings(DVORANY, null), DVORANY, 'bez uloženého sa ponúkne');
    assert.equal(incomingSettings(DVORANY, ulozene), null, 'adresa nesie nastavenie bez merania');
    assert.equal(incomingSettings(ulozene, ulozene), null);
    const ine = { ...DVORANY, plant: { ...DVORANY.plant, acLimitKw: 8 } };
    assert.equal(incomingSettings(ine, ulozene), ine);
    const inyZdroj = { ...ulozene, zdroj: { ...ZDROJ, nazov: 'Iná' } };
    assert.equal(incomingSettings(inyZdroj, ulozene), inyZdroj, 'iné meranie v odkaze sa ponúkne');
});

test('linkHash: adresa, ktorú appka v karte zapísala sama, odkazom nie je; cudzia áno', async () => {
    const { linkHash } = await import('../shared/settings.js');
    const hash = '#nastavenie=abc';
    assert.equal(linkHash('/ray-mon/', hash, '/ray-mon/#nastavenie=abc', false), '', 'vlastná adresa po obnovení');
    assert.equal(linkHash('/ray-mon/', hash, '/ray-mon/#nastavenie=xyz', false), hash, 'iný odkaz v tej istej karte');
    assert.equal(linkHash('/ray-mon/', hash, '/ray-mon/obloha/#nastavenie=abc', false), hash, 'druhá appka v tej istej karte');
    assert.equal(linkHash('/ray-mon/', hash, null, false), hash, 'nová karta či appka z plochy');
    assert.equal(linkHash('/ray-mon/', hash, null, true), hash, 'odkaz bez značky sa ponúkne vždy');
});

test('linkHash: vlastná adresa z histórie prehliadača sa neponúkne, keď je uložené novšie či vymazané', async () => {
    const { linkHash, shareHash, settingsFromLink } = await import('../shared/settings.js');
    const vlastna = shareHash(DVORANY, false, true);
    assert.match(vlastna, /^#nastavenie=[\w-]+&vlastna=1$/);
    assert.deepEqual(settingsFromLink(vlastna), DVORANY, 'značka nastavenie nemení');
    assert.equal(shareHash(null, false, true), '', 'bez nastavenia značky netreba');
    assert.equal(linkHash('/ray-mon/', vlastna, null, true), '');
    assert.equal(linkHash('/ray-mon/', vlastna, null, false), vlastna, 'appka na ploche iPhonu s prázdnym úložiskom');
    assert.equal(shareHash(DVORANY, false), shareHash(DVORANY, false, false), 'Zdieľať značku nepridá');
});
