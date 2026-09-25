// Vytvorí deterministické fixtures pre testy. Sieť z vývojového prostredia nemusí
// pustiť Open-Meteo ani kiosk, preto sú SYNTETICKÉ: Open-Meteo z bezoblačného modelu
// × pevný vzor oblačnosti, kiosk z tvaru skutočnej odpovede. Spusti: node test/fixtures/generate.js
import { writeFileSync } from 'node:fs';
import { FORECAST_API_DAYS, FORECAST_PAST_DAYS, OPEN_METEO_RADIATION, SITE } from '../../shared/config.js';
import { clearSkyIrradiance, solarPosition } from '../../shared/solar.js';

const OUT = new URL('./', import.meta.url);
// Prvý predpovedaný deň (UTC). Pred ním je ešte FORECAST_PAST_DAYS dní minulosti, rovnako
// ako v skutočnej odpovedi - hodina i = 0 ostáva polnocou tohto dňa, takže doterajšie dni
// majú bajtovo tie isté hodnoty.
const START = new Date('2026-09-05T00:00:00Z');

// Oblačnosť po dňoch: slnečno, polooblačno, zamračené, ... nech sú v týždni rôzne dni.
const CLOUD_BY_DAY = [10, 45, 90, 25, 60, 5, 75, 30, 50];
// Včerajšok (past_days).
const CLOUD_PAST = 35;

const R = OPEN_METEO_RADIATION;
/** @type {Record<string, Array<string | number>>} */
const hourly = {
    time: [],
    [R.ghi]: [],
    [R.dni]: [],
    [R.dhi]: [],
    temperature_2m: [],
    cloud_cover: [],
};
for (let i = -FORECAST_PAST_DAYS * 24; i < FORECAST_API_DAYS * 24; i++) {
    const t = new Date(START.getTime() + i * 3600 * 1000);
    const sun = solarPosition(t, SITE.lat, SITE.lon);
    const clear = clearSkyIrradiance(sun.elevationDeg, SITE.elevationM);
    const cloud = (i < 0 ? CLOUD_PAST : CLOUD_BY_DAY[Math.floor(i / 24)]) + 5 * Math.sin(i / 3);
    const cloudFrac = Math.max(0, Math.min(1, cloud / 100));
    // Oblačnosť tlmí priame žiarenie silno, rozptýlené naopak zvýši. Celkové žiarenie
    // však nikdy neprekročí bezoblačnú oblohu - inak by "využitie" vyšlo nad 100 %.
    const cosZ = Math.max(0, Math.cos(((90 - sun.elevationDeg) * Math.PI) / 180));
    const dni = clear.dni * (1 - 0.95 * cloudFrac);
    const dhi = Math.min(clear.dhi * (1 + 2.5 * cloudFrac), Math.max(0, clear.ghi - dni * cosZ));
    const ghi = sun.elevationDeg > 0 ? dni * cosZ + dhi : 0;
    hourly.time.push(t.toISOString().slice(0, 16));
    // Okamžité hodnoty v čase t - presne to, čo znamenajú premenné `_instant`.
    hourly[R.ghi].push(Number(ghi.toFixed(1)));
    hourly[R.dni].push(Number(dni.toFixed(1)));
    hourly[R.dhi].push(Number(dhi.toFixed(1)));
    hourly.temperature_2m.push(Number((14 + 8 * Math.sin(((t.getUTCHours() - 8) / 24) * 2 * Math.PI)).toFixed(1)));
    hourly.cloud_cover.push(Math.round(Math.max(0, Math.min(100, cloud))));
}
writeFileSync(
    new URL('open-meteo.json', OUT),
    JSON.stringify({ latitude: 48.48, longitude: 18.12, hourly_units: { [R.ghi]: 'W/m²' }, hourly }, null, 1) + '\n',
);

// Kiosk: 5-minútová krivka do 11:00 UTC (13:00 miestneho), vrchol okolo poludnia.
const xAxis = [];
const activePower = [];
for (let m = 0; m < 24 * 60; m += 5) {
    xAxis.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
    const h = m / 60;
    if (m > 13 * 60) activePower.push('-');
    else if (h < 6.5 || h > 19.5) activePower.push('0.000');
    else activePower.push((7.8 * Math.exp(-((h - 12.6) ** 2) / 9)).toFixed(3));
}
const inner = {
    realKpi: { realTimePower: 6.412, dailyEnergy: 31.7, monthEnergy: 168.2, yearEnergy: 9112.4, cumulativeEnergy: 21504.9 },
    stationOverview: { stationName: 'Račkofci Energy s.r.o.' },
    powerCurve: { xAxis, activePower },
};
const encoded = JSON.stringify(inner).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
writeFileSync(new URL('kiosk.json', OUT), JSON.stringify({ data: encoded, success: true, failCode: 0 }, null, 1) + '\n');

writeFileSync(
    new URL('meta.json', OUT),
    JSON.stringify(
        { synthetic: true, generatedAt: START.toISOString(), note: 'Syntetické fixtures z test/fixtures/generate.js, nie reálne dáta.' },
        null,
        2,
    ) + '\n',
);
console.log('fixtures written');
