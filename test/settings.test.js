import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_PLANT, DEMO_SITE, PLANT, SITE } from '../shared/config.js';
import {
    checkSettings,
    demoSettings,
    isTimezone,
    parseGeocode,
    parseStoredSettings,
    sameSettings,
    settingsFrom,
    settingsHint,
    siteMetaText,
    toUser,
} from '../shared/settings.js';

const DVORANY = { site: SITE, plant: PLANT, kiosk: '' };
const KIOSK = 'https://region01eu5.fusionsolar.huawei.com/pvmswebsite/nologin/assets/build/index.html#/kiosk?kk=Abc123xyz';

test('ukážka je Londýn s vlastnou zostavou a prejde kontrolou', () => {
    const demo = demoSettings();
    assert.equal(demo.site, DEMO_SITE);
    assert.equal(demo.plant, DEMO_PLANT);
    const check = checkSettings(demo);
    assert.deepEqual(check.errors, []);
    assert.equal(check.kwp, 12 * 0.435);
    assert.equal(check.panels, 12);
});

test('Dvorany prejdú kontrolou bez varovaní', () => {
    assert.deepEqual(checkSettings(DVORANY), { errors: [], warnings: [], kwp: (24 * 435) / 1000, panels: 24 });
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
    assert.ok(!sameSettings(back, demoSettings()));
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

test('texty: súradnice podľa pologule, súhrn s ukážkou', () => {
    assert.equal(siteMetaText(SITE), '48,48° s. š. · 18,12° v. d. · 180 m n. m. · Europe/Bratislava');
    assert.equal(siteMetaText(DEMO_SITE), '51,51° s. š. · 0,13° z. d. · 25 m n. m. · Europe/London');
    assert.equal(
        siteMetaText({ name: 'Sydney', lat: -33.87, lon: 151.21, elevationM: 40, timezone: 'Australia/Sydney' }),
        '33,87° j. š. · 151,21° v. d. · 40 m n. m. · Australia/Sydney',
    );
    assert.equal(siteMetaText({ ...SITE, lat: NaN }), 'Súradnice nie sú zadané.');
    assert.equal(settingsHint(DVORANY, false), 'Dvorany nad Nitrou · 10,44 kWp');
    assert.equal(settingsHint(demoSettings(), true), 'Ukážka · Londýn · 5,22 kWp');
});

test('kiosk: prázdny je bez merania, cudzí odkaz je chyba, uloží sa a staré nastavenie bez neho platí', () => {
    assert.deepEqual(checkSettings({ ...DVORANY, kiosk: KIOSK }).errors, []);
    assert.ok(checkSettings({ ...DVORANY, kiosk: 'https://example.com/?kk=Abc123xyz' }).errors.some((e) => e.includes('kiosk')));
    const withKiosk = parseStoredSettings(toUser({ ...DVORANY, kiosk: KIOSK }));
    assert.equal(withKiosk && withKiosk.kiosk, KIOSK);
    assert.ok(!sameSettings({ ...DVORANY, kiosk: KIOSK }, DVORANY));
    // Nastavenie uložené pred pridaním kiosku.
    const old = /** @type {Partial<ReturnType<typeof toUser>>} */ (toUser(DVORANY));
    delete old.kiosk;
    const back = parseStoredSettings(old);
    assert.equal(back && back.kiosk, '');
    assert.equal(parseStoredSettings({ ...toUser(DVORANY), kiosk: 'https://example.com/?kk=Abc123xyz' }), null);
});
