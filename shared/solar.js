// Fyzika predpovede výroby FV: poloha slnka (zjednodušený NOAA), žiarenie na naklonenú
// rovinu (izotropný model), bezoblačný strop (Meinel) a skladanie výstupu predpovede.
// Čisté funkcie bez I/O - beží v Node, prehliadači aj Cloudflare Workeri.
// Lokalita a zostava panelov prichádzajú ako parameter, nič z nich tu nie je natvrdo.

import { CLEAR_SKY, FORECAST_DAYS_SHOWN, OPEN_METEO_RADIATION, powerThresholds } from './config.js';

/** @typedef {import('./config.js').Site} Site */
/** @typedef {import('./config.js').Plant} Plant */

/** @typedef {{ hour: number, kw: number, cloud: number | null }} HourPoint */
/** @typedef {HourPoint & { clearKw: number }} DayHourPoint */
/**
 * @typedef {{ date: string, hourly: DayHourPoint[], kwhTotal: number, clearKwhTotal: number,
 *   peakKw: number, peakHour: number | null, cloudAvgPct: number | null }} ForecastDay
 */
/**
 * @typedef {{ strongerWindowAhead: boolean, windowDaypart: string | null, peakKw: number | null,
 *   hoursAhead: number | null, tomorrowSunny: boolean, tomorrowPeakKw: number,
 *   hourlyToday: HourPoint[], hourlyTomorrow: HourPoint[], days: ForecastDay[], updatedAt: string }} Forecast
 */

const toRad = (/** @type {number} */ deg) => (deg * Math.PI) / 180;
const toDeg = (/** @type {number} */ rad) => (rad * 180) / Math.PI;
const clamp = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) => Math.max(lo, Math.min(hi, v));
const round = (/** @type {number} */ v, /** @type {number} */ digits) => Number(v.toFixed(digits));

/**
 * Poloha slnka (elevácia a azimut v stupňoch) pre daný UTC čas a miesto.
 * Počíta sa priamo v UTC - dĺžka ide do rovnice času, civilné pásmo netreba.
 * @param {Date} dateUtc @param {number} latDeg @param {number} lonDeg
 */
export function solarPosition(dateUtc, latDeg, lonDeg) {
    const startOfYear = Date.UTC(dateUtc.getUTCFullYear(), 0, 1);
    const dayOfYear = Math.floor((dateUtc.getTime() - startOfYear) / 86400000) + 1;
    const hourUtc = dateUtc.getUTCHours() + dateUtc.getUTCMinutes() / 60;
    const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hourUtc - 12) / 24);

    const eqTimeMin =
        229.18 *
        (0.000075 +
            0.001868 * Math.cos(gamma) -
            0.032077 * Math.sin(gamma) -
            0.014615 * Math.cos(2 * gamma) -
            0.040849 * Math.sin(2 * gamma));
    const declRad =
        0.006918 -
        0.399912 * Math.cos(gamma) +
        0.070257 * Math.sin(gamma) -
        0.006758 * Math.cos(2 * gamma) +
        0.000907 * Math.sin(2 * gamma) -
        0.002697 * Math.cos(3 * gamma) +
        0.00148 * Math.sin(3 * gamma);

    const trueSolarTimeMin = hourUtc * 60 + eqTimeMin + 4 * lonDeg;
    const hourAngleDeg = trueSolarTimeMin / 4 - 180;
    const latRad = toRad(latDeg);
    const hourAngleRad = toRad(hourAngleDeg);

    const sinElevation = Math.sin(latRad) * Math.sin(declRad) + Math.cos(latRad) * Math.cos(declRad) * Math.cos(hourAngleRad);
    const elevationRad = Math.asin(clamp(sinElevation, -1, 1));
    const elevationDeg = toDeg(elevationRad);

    let azimuthDeg = 180;
    if (elevationDeg > 0) {
        const cosAzimuth = (Math.sin(declRad) - Math.sin(elevationRad) * Math.sin(latRad)) / (Math.cos(elevationRad) * Math.cos(latRad));
        const azRad = Math.acos(clamp(cosAzimuth, -1, 1));
        azimuthDeg = hourAngleDeg > 0 ? 360 - toDeg(azRad) : toDeg(azRad);
    }
    return { elevationDeg, azimuthDeg };
}

/** @typedef {{ ghi: number, dni: number, dhi: number }} Irradiance */
/** @typedef {{ elevationDeg: number, azimuthDeg: number }} SunPosition */
/** @typedef {{ tiltDeg: number, azimuthDeg: number }} PanelPlane */

/**
 * Žiarenie na naklonenej rovine panelu (W/m²), izotropný model oblohy.
 * @param {Irradiance} irr @param {SunPosition} sun @param {PanelPlane} panel @param {number} albedo odrazivosť terénu
 */
export function poaIrradiance(irr, sun, panel, albedo) {
    if (sun.elevationDeg <= 0) return 0;
    const elevationRad = toRad(sun.elevationDeg);
    const tiltRad = toRad(panel.tiltDeg);
    const azDiffRad = toRad(sun.azimuthDeg - panel.azimuthDeg);
    const cosAoi = Math.sin(elevationRad) * Math.cos(tiltRad) + Math.cos(elevationRad) * Math.sin(tiltRad) * Math.cos(azDiffRad);
    const beam = Math.max(0, irr.dni * cosAoi);
    const diffuseIso = (irr.dhi * (1 + Math.cos(tiltRad))) / 2;
    const ground = (irr.ghi * albedo * (1 - Math.cos(tiltRad))) / 2;
    return Math.max(0, beam + diffuseIso + ground);
}

/**
 * AC výkon celej elektrárne (kW) pre dané žiarenie, teplotu a polohu slnka:
 * všetky skupiny stringov, teplotný odber, účinnosť a limit striedača.
 * @param {Irradiance} irr @param {number} tempC @param {SunPosition} sun @param {Plant} plant
 */
export function plantAcKw(irr, tempC, sun, plant) {
    if (sun.elevationDeg <= 0) return 0;
    let dcWatts = 0;
    for (const s of plant.strings) {
        const poa = poaIrradiance(irr, sun, s, plant.albedo);
        const cellTemp = tempC + ((plant.noctC - 20) / 800) * poa;
        const tempFactor = 1 + (plant.tempCoefPctPerC / 100) * (cellTemp - 25);
        dcWatts += s.panels * plant.panelWp * (poa / 1000) * Math.max(0, tempFactor);
    }
    const acKw = (dcWatts / 1000) * plant.systemEfficiency;
    return clamp(acKw, 0, plant.acLimitKw);
}

/** Predpovedaný AC výkon (kW) z Open-Meteo hodnôt pre daný UTC čas, lokalitu a zostavu. */
export function forecastAcKw(
    /** @type {Irradiance} */ irr,
    /** @type {number} */ tempC,
    /** @type {Date} */ dateUtc,
    /** @type {Site} */ site,
    /** @type {Plant} */ plant,
) {
    return plantAcKw(irr, tempC, solarPosition(dateUtc, site.lat, site.lon), plant);
}

/**
 * Žiarenie bezoblačnej oblohy (Meinelov útlm, výšková korekcia) pre danú eleváciu slnka.
 * @param {number} elevationDeg @param {number} siteElevationM nadmorská výška lokality
 */
export function clearSkyIrradiance(elevationDeg, siteElevationM) {
    if (elevationDeg <= 0.5) return { ghi: 0, dni: 0, dhi: 0 };
    const zenithDeg = 90 - elevationDeg;
    const cosZ = Math.cos(toRad(zenithDeg));
    const airMass = 1 / (cosZ + 0.50572 * Math.pow(96.07995 - zenithDeg, -1.6364));
    const hkm = Math.max(0, siteElevationM) / 1000;
    const dni = 1353 * ((1 - 0.14 * hkm) * Math.pow(CLEAR_SKY.tau, Math.pow(airMass, 0.678)) + 0.14 * hkm);
    const dhi = CLEAR_SKY.dhiFraction * dni * cosZ;
    return { ghi: dni * cosZ + dhi, dni, dhi };
}

/**
 * Horný strop výroby (kW): koľko by elektráreň dala v tejto hodine pri úplne jasnej oblohe.
 * Teplota je tá istá ako v predpovedi danej hodiny, takže pomer výroba/strop vyjadruje
 * čistú stratu oblačnosťou a nikdy neprekročí 100 % (pri 25 °C by chladný deň dal viac).
 * @param {Date} dateUtc @param {Site} site @param {Plant} plant @param {number} [ambientC]
 */
export function clearSkyAcKw(dateUtc, site, plant, ambientC = 25) {
    const sun = solarPosition(dateUtc, site.lat, site.lon);
    return plantAcKw(clearSkyIrradiance(sun.elevationDeg, site.elevationM), ambientC, sun, plant);
}

// Formátovače sú drahé na vytvorenie a lacné na použitie, preto vzniknú raz pre každé
// časové pásmo. Predpoveď ich volá tisíckrát; stavať ich pri každom volaní stálo 99 % času
// buildForecast.
/** @type {Map<string, { hour: Intl.DateTimeFormat, hm: Intl.DateTimeFormat, date: Intl.DateTimeFormat }>} */
const FORMATS = new Map();

/** @param {string} timezone */
function formatsFor(timezone) {
    let f = FORMATS.get(timezone);
    if (!f) {
        f = {
            hour: new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hour12: false }),
            hm: new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }),
            date: new Intl.DateTimeFormat('en-CA', { timeZone: timezone }),
        };
        FORMATS.set(timezone, f);
    }
    return f;
}

/** Miestna hodina (0-23) pre UTC čas v danom časovom pásme. @param {Date} dateUtc @param {string} timezone */
export function localHour(dateUtc, timezone) {
    const parts = formatsFor(timezone).hour.formatToParts(dateUtc);
    const hour = parts.find((p) => p.type === 'hour');
    return Number(hour ? hour.value : 0) % 24;
}

/**
 * Minúta dňa (0-1439) v danom časovom pásme. Hodiny, ciferník aj tarifné okná appky idú
 * podľa času lokality, nie telefónu - kto sa pozerá na elektráreň v inom pásme, vidí jej čas.
 * @param {Date} dateUtc @param {string} timezone
 */
export function localMinutes(dateUtc, timezone) {
    const parts = formatsFor(timezone).hm.formatToParts(dateUtc);
    const num = (/** @type {string} */ type) => Number((parts.find((p) => p.type === type) || { value: 0 }).value);
    return (num('hour') % 24) * 60 + num('minute');
}

/** Miestny dátum "YYYY-MM-DD" pre UTC čas v danom časovom pásme. @param {Date} dateUtc @param {string} timezone */
export function localDateKey(dateUtc, timezone) {
    return formatsFor(timezone).date.format(dateUtc);
}

/**
 * Dátum "YYYY-MM-DD" posunutý o celé kalendárne dni. Nie o 24 hodín: deň prechodu na letný
 * čas má 23 hodín a na zimný 25, takže 24 h od 23:30 pred jarným prechodom preskočí celý
 * nasledujúci deň a 48 h od 00:30 pred jesenným skončí v tom istom dni druhýkrát.
 * @param {string} dateKey @param {number} days
 */
export function addDays(dateKey, days) {
    const [y, m, d] = dateKey.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Časť dňa pre text "silnejšie slnko príde ...". @param {Date} dateUtc @param {string} timezone */
export function daypartFor(dateUtc, timezone) {
    const h = localHour(dateUtc, timezone);
    if (h >= 12 && h < 17) return 'poobede';
    if (h >= 17 && h < 20) return 'podvečer';
    return 'neskôr';
}

/** @typedef {{ dateUtc: Date, acKw: number, localDate: string, cloudPct: number | null, tempC: number }} HourEntry */

/**
 * Hodinové pole pre graf, zoradené podľa miestnej hodiny.
 * @param {HourEntry[]} entries @param {string} timezone @returns {HourPoint[]}
 */
export function hourlySeries(entries, timezone) {
    return entries
        .map((h) => ({
            hour: localHour(h.dateUtc, timezone),
            kw: round(h.acKw, 2),
            cloud: Number.isFinite(h.cloudPct) ? Math.round(/** @type {number} */ (h.cloudPct)) : null,
        }))
        .sort((a, b) => a.hour - b.hour);
}

/**
 * Jeden deň pre kartu "7 dní": hodinová predpoveď + bezoblačný strop + súhrny.
 * @param {string} dayKey @param {HourEntry[]} entries @param {Site} site @param {Plant} plant @returns {ForecastDay}
 */
function buildDay(dayKey, entries, site, plant) {
    // Mapa nahrádza hľadanie cez `find` v cykle. Prvý záznam hodiny vyhráva rovnako ako tam,
    // takže zhoda s pôvodným správaním platí aj v deň prechodu na zimný čas, keď miestna
    // hodina 2 existuje dvakrát (v noci, čiže strop je tak či tak nulový).
    /** @type {Map<number, HourEntry>} */ const entryByHour = new Map();
    for (const e of entries) {
        const hour = localHour(e.dateUtc, site.timezone);
        if (!entryByHour.has(hour)) entryByHour.set(hour, e);
    }
    const hourly = hourlySeries(entries, site.timezone).map((h) => {
        const entry = entryByHour.get(h.hour);
        return { ...h, clearKw: entry ? round(clearSkyAcKw(entry.dateUtc, site, plant, entry.tempC), 2) : 0 };
    });
    let peak = hourly[0] || { hour: null, kw: 0 };
    for (const h of hourly) if (h.kw > peak.kw) peak = h;
    const cloudVals = hourly.map((h) => h.cloud).filter((c) => c != null);
    return {
        date: dayKey,
        hourly,
        kwhTotal: round(
            hourly.reduce((s, h) => s + h.kw, 0),
            1,
        ),
        clearKwhTotal: round(
            hourly.reduce((s, h) => s + h.clearKw, 0),
            1,
        ),
        peakKw: round(peak.kw, 2),
        peakHour: peak.hour,
        cloudAvgPct: cloudVals.length ? Math.round(cloudVals.reduce((a, b) => a + b, 0) / cloudVals.length) : null,
    };
}

/**
 * Príde ešte dnes citeľne silnejšie slnko než teraz? (Pre texty "počkaj na slnko".)
 * @param {HourEntry[]} hourly @param {string} todayKey
 * @param {number} nowHourStart začiatok aktuálnej miestnej hodiny (ms) @param {string} timezone
 * @param {import('./config.js').PowerThresholds} th
 */
function strongerWindowAhead(hourly, todayKey, nowHourStart, timezone, th) {
    const none = {
        strongerWindowAhead: false,
        windowDaypart: /** @type {string | null} */ (null),
        peakKw: /** @type {number | null} */ (null),
        hoursAhead: /** @type {number | null} */ (null),
    };
    const currentHour = hourly.find((h) => h.dateUtc.getTime() === nowHourStart);
    const baselineKw = currentHour ? currentHour.acKw : 0;
    const futureToday = hourly.filter((h) => h.localDate === todayKey && h.dateUtc.getTime() > nowHourStart);
    if (!futureToday.length) return none;
    let peak = futureToday[0];
    for (const h of futureToday) if (h.acKw > peak.acKw) peak = h;
    if (peak.acKw < th.highKw || peak.acKw < baselineKw + th.marginKw) return none;
    return {
        strongerWindowAhead: true,
        windowDaypart: daypartFor(peak.dateUtc, timezone),
        peakKw: round(peak.acKw, 2),
        hoursAhead: Math.round((peak.dateUtc.getTime() - nowHourStart) / 3600000),
    };
}

/** @typedef {{ dateUtc: Date, irr: Irradiance, tempC: number, cloudPct: number | null }} WeatherHour */

/**
 * Open-Meteo dáva hodiny v UTC. V pásme s polhodinovým posunom (India +5:30, Nepál +5:45,
 * Newfoundland −3:30) tak padne každá hodnota na hh:30 miestneho času, kým appka kreslí aj
 * počíta po celých miestnych hodinách - krivka by bola o pol hodiny posunutá proti slnku aj
 * proti tarifným oknám. Taká hodnota sa preto presunie na celú miestnu hodinu pred ňou
 * a dopočíta sa lineárne od predošlej UTC hodiny. Prvá hodina predošlú nemá, a tak vypadne.
 * V pásme s celými hodinami sa nemení nič.
 * @param {WeatherHour[]} hours @param {string} timezone @returns {WeatherHour[]}
 */
export function alignToLocalHours(hours, timezone) {
    const out = [];
    for (let i = 0; i < hours.length; i++) {
        const minute = localMinutes(hours[i].dateUtc, timezone) % 60;
        if (minute === 0) out.push(hours[i]);
        else if (i > 0) out.push(between(hours[i - 1], hours[i], (60 - minute) / 60));
    }
    return out;
}

/** Počasie v zlomku `t` cesty od hodiny `a` k hodine `b` (0 = a, 1 = b).
 * @param {WeatherHour} a @param {WeatherHour} b @param {number} t @returns {WeatherHour} */
function between(a, b, t) {
    const mix = (/** @type {number} */ x, /** @type {number} */ y) => x + (y - x) * t;
    return {
        dateUtc: new Date(mix(a.dateUtc.getTime(), b.dateUtc.getTime())),
        irr: { ghi: mix(a.irr.ghi, b.irr.ghi), dni: mix(a.irr.dni, b.irr.dni), dhi: mix(a.irr.dhi, b.irr.dhi) },
        tempC: mix(a.tempC, b.tempC),
        cloudPct: a.cloudPct === null || b.cloudPct === null ? null : mix(a.cloudPct, b.cloudPct),
    };
}

/**
 * Zloží celý výstup predpovede z odpovede Open-Meteo pre danú lokalitu a zostavu. Toto je
 * jediné miesto, kde vzniká formát `forecast` - používa ho Worker aj testy. Žiarenie je
 * okamžité (OPEN_METEO_RADIATION v config.js), teda patrí presne k času záznamu.
 * @param {{ hourly: { time: string[], temperature_2m: number[], cloud_cover?: number[] } & Record<string, number[]> }} data
 * @param {Date} now @param {Site} site @param {Plant} plant
 * @returns {Forecast}
 */
export function buildForecast(data, now, site, plant) {
    const tz = site.timezone;
    const { time, temperature_2m: tempArr, cloud_cover: cloudArr } = data.hourly;
    const ghiArr = data.hourly[OPEN_METEO_RADIATION.ghi];
    const dniArr = data.hourly[OPEN_METEO_RADIATION.dni];
    const dhiArr = data.hourly[OPEN_METEO_RADIATION.dhi];

    const todayKey = localDateKey(now, tz);
    // Začiatok aktuálnej miestnej hodiny. Záznamy predpovede stoja na celých miestnych hodinách
    // (alignToLocalHours), takže sa s ním dajú porovnať priamo. Pri pásme s celými hodinami je
    // to začiatok UTC hodiny.
    const nowHourStart = now.getTime() - (localMinutes(now, tz) % 60) * 60000 - (now.getTime() % 60000);

    /** @type {WeatherHour[]} */
    const weather = time.map((t, i) => ({
        dateUtc: new Date(`${t}Z`),
        irr: { ghi: ghiArr[i], dni: dniArr[i], dhi: dhiArr[i] },
        tempC: tempArr[i],
        cloudPct: cloudArr ? cloudArr[i] : null,
    }));
    /** @type {HourEntry[]} */
    const hourly = alignToLocalHours(weather, tz).map((w) => ({
        dateUtc: w.dateUtc,
        acKw: forecastAcKw(w.irr, w.tempC, w.dateUtc, site, plant),
        localDate: localDateKey(w.dateUtc, tz),
        cloudPct: w.cloudPct,
        tempC: w.tempC,
    }));

    const th = powerThresholds(plant);
    const ahead = strongerWindowAhead(hourly, todayKey, nowHourStart, tz, th);

    const dayKeyOffset = (/** @type {number} */ days) => addDays(todayKey, days);
    const tomorrowKey = dayKeyOffset(1);
    const tomorrowEntries = hourly.filter((h) => h.localDate === tomorrowKey);
    const tomorrowPeakKw = tomorrowEntries.reduce((max, h) => Math.max(max, h.acKw), 0);

    const days = [];
    for (let i = 0; i < FORECAST_DAYS_SHOWN; i++) {
        const key = dayKeyOffset(i);
        days.push(
            buildDay(
                key,
                hourly.filter((h) => h.localDate === key),
                site,
                plant,
            ),
        );
    }

    return {
        ...ahead,
        tomorrowSunny: tomorrowPeakKw >= th.highKw,
        tomorrowPeakKw: round(tomorrowPeakKw, 2),
        hourlyToday: hourlySeries(
            hourly.filter((h) => h.localDate === todayKey),
            tz,
        ),
        hourlyTomorrow: hourlySeries(tomorrowEntries, tz),
        days,
        updatedAt: now.toISOString(),
    };
}
