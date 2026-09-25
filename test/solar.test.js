import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { PLANT, SITE } from '../shared/config.js';
import {
    alignToLocalHours,
    buildForecast,
    clearSkyAcKw,
    clearSkyIrradiance,
    daypartFor,
    forecastAcKw,
    hourlySeries,
    localDateKey,
    localHour,
    localMinutes,
    plantAcKw,
    poaIrradiance,
    solarPosition,
} from '../shared/solar.js';
import { FIXED_NOW, fixture } from './helpers.js';

// Pravé slnečné poludnie v Dvoranoch (18,12° E) je približne 10:47 UTC.
const NOON_JUNE = new Date('2026-06-21T10:47:00Z');
const NOON_DEC = new Date('2026-12-21T10:47:00Z');
const TZ = SITE.timezone;
/** Iná lokalita na južnej pologuli, aby testy chytili, keby niečo ostalo natvrdo pre Dvorany. */
const SYDNEY = { name: 'Sydney', lat: -33.87, lon: 151.21, elevationM: 40, timezone: 'Australia/Sydney' };
const pos = (/** @type {Date} */ d) => solarPosition(d, SITE.lat, SITE.lon);

test('solarPosition: letné poludnie ~65°, zimné ~18°, azimut na juh', () => {
    const summer = pos(NOON_JUNE);
    assert.ok(summer.elevationDeg > 63.5 && summer.elevationDeg < 66.5, `leto ${summer.elevationDeg}`);
    assert.ok(Math.abs(summer.azimuthDeg - 180) < 3, `azimut ${summer.azimuthDeg}`);
    const winter = pos(NOON_DEC);
    assert.ok(winter.elevationDeg > 16.5 && winter.elevationDeg < 19.5, `zima ${winter.elevationDeg}`);
    assert.ok(pos(new Date('2026-06-21T23:00:00Z')).elevationDeg < 0, 'polnoc pod horizontom');
});

test('solarPosition: ráno východ (azimut < 180), popoludní západ (> 180)', () => {
    assert.ok(pos(new Date('2026-06-21T05:00:00Z')).azimuthDeg < 180);
    assert.ok(pos(new Date('2026-06-21T15:00:00Z')).azimuthDeg > 180);
});

test('poaIrradiance: pod horizontom 0, kolmé slnko dáva beam ≈ dni + difúzna zložka', () => {
    assert.equal(
        poaIrradiance({ ghi: 500, dni: 800, dhi: 100 }, { elevationDeg: -1, azimuthDeg: 180 }, { tiltDeg: 40, azimuthDeg: 180 }, 0.2),
        0,
    );
    // Slnko presne kolmo na panel so sklonom 40° orientovaný na juh: elevácia 50°, azimut 180°.
    const poa = poaIrradiance({ ghi: 0, dni: 800, dhi: 0 }, { elevationDeg: 50, azimuthDeg: 180 }, { tiltDeg: 40, azimuthDeg: 180 }, 0.2);
    assert.ok(Math.abs(poa - 800) < 1e-6, `poa ${poa}`);
});

test('forecastAcKw: vždy v intervale 0 až limit striedača', () => {
    for (let h = 0; h < 24; h++) {
        const kw = forecastAcKw(
            { ghi: 900, dni: 900, dhi: 150 },
            30,
            new Date(`2026-06-21T${String(h).padStart(2, '0')}:00:00Z`),
            SITE,
            PLANT,
        );
        assert.ok(kw >= 0 && kw <= PLANT.acLimitKw, `hodina ${h}: ${kw}`);
    }
    assert.equal(forecastAcKw({ ghi: 0, dni: 0, dhi: 0 }, 20, NOON_JUNE, SITE, PLANT), 0);
});

test('clearSky: pri poludní v lete blízko limitu, v noci 0', () => {
    assert.deepEqual(clearSkyIrradiance(0, SITE.elevationM), { ghi: 0, dni: 0, dhi: 0 });
    const kw = clearSkyAcKw(NOON_JUNE, SITE, PLANT);
    assert.ok(kw > 6 && kw <= PLANT.acLimitKw, `strop ${kw}`);
    assert.equal(clearSkyAcKw(new Date('2026-06-21T23:00:00Z'), SITE, PLANT), 0);
});

test('localHour/localDateKey/daypartFor: Europe/Bratislava vrátane letného času', () => {
    assert.equal(localHour(new Date('2026-07-01T10:00:00Z'), TZ), 12);
    assert.equal(localHour(new Date('2026-01-01T10:00:00Z'), TZ), 11);
    assert.equal(localDateKey(new Date('2026-07-01T22:30:00Z'), TZ), '2026-07-02');
    assert.equal(daypartFor(new Date('2026-07-01T12:00:00Z'), TZ), 'poobede');
    assert.equal(daypartFor(new Date('2026-07-01T16:00:00Z'), TZ), 'podvečer');
    assert.equal(daypartFor(new Date('2026-07-01T19:00:00Z'), TZ), 'neskôr');
});

test('localMinutes: minúta dňa v pásme lokality, aj s polhodinovým posunom', () => {
    const chvila = new Date('2026-09-05T11:05:00Z');
    assert.equal(localMinutes(chvila, TZ), 13 * 60 + 5);
    // Tá istá chvíľa v Londýne je o hodinu skôr, v Indii (+5:30) o tri a pol hodiny neskôr.
    assert.equal(localMinutes(chvila, 'Europe/London'), 12 * 60 + 5);
    assert.equal(localMinutes(chvila, 'Asia/Kolkata'), 16 * 60 + 35);
});

test('alignToLocalHours: celé hodiny nechá, polhodinové posunie na celú miestnu hodinu', () => {
    const hodina = (/** @type {string} */ iso, /** @type {number} */ ghi, /** @type {number | null} */ cloudPct = 50) => ({
        dateUtc: new Date(iso),
        irr: { ghi, dni: 2 * ghi, dhi: ghi / 2 },
        tempC: ghi / 10,
        cloudPct,
    });
    const raw = [hodina('2026-09-05T05:00:00Z', 0), hodina('2026-09-05T06:00:00Z', 100, null)];
    // Bratislava (+2): UTC hodina je aj celá miestna hodina, nemení sa nič.
    assert.deepEqual(alignToLocalHours(raw, TZ), raw);
    // India (+5:30): 06:00 UTC je 11:30 miestneho. Hodnota patrí na 11:00, teda 05:30 UTC -
    // v polovici cesty od predošlej UTC hodiny.
    const india = alignToLocalHours(raw, 'Asia/Kolkata');
    assert.equal(india.length, 1, 'prvá hodina nemá predchodcu, z ktorého by sa dopočítala');
    assert.equal(india[0].dateUtc.toISOString(), '2026-09-05T05:30:00.000Z');
    assert.deepEqual(india[0].irr, { ghi: 50, dni: 100, dhi: 25 });
    assert.equal(india[0].tempC, 5);
    assert.equal(india[0].cloudPct, null, 'chýbajúca oblačnosť sa nedopočítava');
    // Nepál (+5:45): 06:00 UTC je 11:45 miestneho, 11:00 je 05:15 UTC - štvrtina cesty.
    const nepal = alignToLocalHours(raw, 'Asia/Kathmandu');
    assert.equal(nepal[0].dateUtc.toISOString(), '2026-09-05T05:15:00.000Z');
    assert.equal(nepal[0].irr.ghi, 25);
});

test('pásmo s polhodinovým posunom: čas silnejšieho slnka ukazuje na hodinu, kde je špička', () => {
    // Geografia Dvorian, len pásmo +5:30. O 04:40 UTC je tam 10:10 a špička príde poobede.
    const india = { ...SITE, timezone: 'Asia/Kolkata' };
    const f = buildForecast(fixture('open-meteo.json'), new Date('2026-09-05T04:40:00Z'), india, PLANT);
    assert.ok(f.strongerWindowAhead && f.hoursAhead !== null, 'predpoveď musí hlásiť silnejšie slnko');
    const buduce = f.hourlyToday.filter((h) => h.hour > 10);
    const spicka = buduce.reduce((a, b) => (b.kw > a.kw ? b : a));
    // „Lepšie bude o HH:00“ skladá appka z aktuálnej miestnej hodiny a hoursAhead.
    assert.equal(10 + f.hoursAhead, spicka.hour);
});

test('hourlySeries: zoradené podľa miestnej hodiny, kw na 2 desatiny, cloud zaokrúhlený', () => {
    const series = hourlySeries(
        [
            { dateUtc: new Date('2026-07-01T12:00:00Z'), acKw: 3.14159, localDate: '2026-07-01', cloudPct: 33.3, tempC: 20 },
            { dateUtc: new Date('2026-07-01T10:00:00Z'), acKw: 1, localDate: '2026-07-01', cloudPct: null, tempC: 18 },
        ],
        TZ,
    );
    assert.deepEqual(series, [
        { hour: 12, kw: 1, cloud: null },
        { hour: 14, kw: 3.14, cloud: 33 },
    ]);
});

test('buildForecast: 7 dní, dnes = miestny dátum, zajtra má 24 hodín, golden sa nemení', () => {
    const forecast = buildForecast(fixture('open-meteo.json'), FIXED_NOW, SITE, PLANT);
    assert.equal(forecast.days.length, 7);
    assert.equal(forecast.days[0].date, '2026-09-05');
    assert.equal(forecast.hourlyTomorrow.length, 24);
    assert.equal(forecast.updatedAt, FIXED_NOW.toISOString());
    // Open-Meteo začína o 00:00 UTC, takže dnešný miestny deň má v lete len 22 hodín, ďalšie dni 24.
    assert.ok(
        forecast.days.every((d, i) => d.clearKwhTotal > 0 && d.hourly.length === (i === 0 ? 22 : 24)),
        'každý deň má bezoblačný strop a plný počet hodín',
    );
    // "Využitie" v karte 7 dní je pomer týchto dvoch čísel, takže nesmie vyjsť nad 100 %.
    // Na úrovni jednotlivých hodín pripúšťame krok zaokrúhlenia (0,01 kW na oboch stranách),
    // ktorý sa prejaví len pri súmraku, kde ide o stotiny kilowattu.
    assert.ok(
        forecast.days.every((d) => d.kwhTotal <= d.clearKwhTotal),
        'denná výroba neprekročí bezoblačný strop',
    );
    assert.ok(
        forecast.days.every((d) => d.hourly.every((h) => h.kw <= h.clearKw + 0.02)),
        'hodinová výroba neprekročí bezoblačný strop tej istej hodiny',
    );

    const goldenPath = new URL('./golden/forecast.json', import.meta.url);
    if (!existsSync(goldenPath) || process.env.UPDATE_GOLDEN) writeFileSync(goldenPath, JSON.stringify(forecast, null, 1) + '\n');
    assert.deepEqual(
        forecast,
        JSON.parse(readFileSync(goldenPath, 'utf8')),
        'zmena výstupu predpovede - ak je zámerná, spusti UPDATE_GOLDEN=1 npm test',
    );
});

test('iná lokalita: na južnej pologuli je slnko na poludnie na severe a hodiny idú podľa jej pásma', () => {
    // Pravé poludnie v Sydney (151,21° E) je v decembri približne 01:57 UTC.
    const noon = solarPosition(new Date('2026-12-21T01:57:00Z'), SYDNEY.lat, SYDNEY.lon);
    assert.ok(noon.elevationDeg > 75, `elevácia ${noon.elevationDeg}`);
    const june = solarPosition(new Date('2026-06-21T01:57:00Z'), SYDNEY.lat, SYDNEY.lon);
    assert.ok(june.azimuthDeg < 5 || june.azimuthDeg > 355, `azimut ${june.azimuthDeg}`);
    // 1. 7. je v Sydney zima (UTC+10), 1. 1. leto (UTC+11).
    assert.equal(localHour(new Date('2026-07-01T10:00:00Z'), SYDNEY.timezone), 20);
    assert.equal(localHour(new Date('2026-01-01T10:00:00Z'), SYDNEY.timezone), 21);
    assert.equal(localDateKey(new Date('2026-07-01T15:00:00Z'), SYDNEY.timezone), '2026-07-02');
});

test('iná zostava: výkon rastie s počtom panelov a panel otočený od slnka dá menej', () => {
    const irr = { ghi: 700, dni: 800, dhi: 100 };
    const sun = pos(NOON_JUNE);
    const one = { ...PLANT, strings: [{ panels: 10, azimuthDeg: 180, tiltDeg: 30 }], acLimitKw: 100 };
    const two = { ...one, strings: [{ panels: 20, azimuthDeg: 180, tiltDeg: 30 }] };
    const north = { ...one, strings: [{ panels: 10, azimuthDeg: 0, tiltDeg: 30 }] };
    const kwOne = plantAcKw(irr, 20, sun, one);
    assert.ok(Math.abs(plantAcKw(irr, 20, sun, two) - 2 * kwOne) < 1e-9, 'dvojnásobok panelov = dvojnásobok výkonu');
    assert.ok(plantAcKw(irr, 20, sun, north) < kwOne, 'sever dá na severnej pologuli menej');
    assert.equal(plantAcKw(irr, 20, sun, { ...two, acLimitKw: 3 }), 3, 'menič orezáva');
});

test('buildForecast: dni sa delia podľa časového pásma lokality', () => {
    const plant = { ...PLANT, strings: [{ panels: 12, azimuthDeg: 0, tiltDeg: 30 }] };
    const forecast = buildForecast(fixture('open-meteo.json'), FIXED_NOW, SYDNEY, plant);
    // FIXED_NOW je 11:00 UTC, v Sydney 21:00 toho istého dňa. Fixture začína 00:00 UTC, čo je
    // v Sydney 10:00, takže dnešný deň tam má 14 hodín.
    assert.equal(forecast.days[0].date, '2026-09-05');
    assert.equal(forecast.days[0].hourly.length, 14);
    assert.equal(forecast.days.length, 7);
});
