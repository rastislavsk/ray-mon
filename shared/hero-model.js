// Model hlavnej karty (výkon, pásmo, odporúčanie) pre daný čas dňa.
// Rovnaká logika pre živé "teraz" aj pre náhľad iného času; líši sa len zdroj výkonu.

import { powerThresholds, STALE_PV_MS, STALE_PV_SUN_DEG } from './config.js';
import { dayKwAt, realCurveBoundary } from './chart-model.js';
import { minutesToTimeStr, pad2 } from './format.js';
import { localMinutes, solarPosition } from './solar.js';
import { planAt } from './day-plan.js';
import { getSlotMessage, STAV_SLOVO, voiceTexts } from './messages-core.js';
import { neplatiOf } from './pristup.js';

/**
 * @typedef {{ now: Date, tariff: import('./config.js').Tariff, pv: import('./kiosk.js').PvData | null,
 *   forecast: import('./solar.js').Forecast | null, previewMinutes: number | null,
 *   site: import('./config.js').Site, plant: import('./config.js').Plant }} HeroInput
 */

/**
 * Výkon „teraz“ z merania, alebo null, keď ho niet: bez merania, keď výrobca výkon neposlal,
 * aj keď meranie mlčí (pvFreshness). Číslo spred hodiny už nie je výkon teraz - appka vtedy
 * počíta z krivky dňa a povie, že je to odhad. Jedno miesto pre obe appky a všetky karty.
 * Chýbajúci údaj treba strážiť zvlášť - kontrakt `pv` null povoľuje a Number(null) je 0,
 * takže by sa tváril ako nameraná nula.
 * @param {{ now: Date, pv: import('./kiosk.js').PvData | null, site: import('./config.js').Site }} state
 * @returns {number | null}
 */
export function freshPowerKw({ now, pv, site }) {
    if (!pv || !Number.isFinite(pv.realTimePowerKw)) return null;
    return pvFreshness({ now, pv, site }).stale ? null : /** @type {number} */ (pv.realTimePowerKw);
}

/** Živý výkon na kartu: v náhľade iného času žiadny. @param {HeroInput} state @returns {number | null} */
function livePower(state) {
    return state.previewMinutes === null ? freshPowerKw(state) : null;
}

/**
 * Výkon pre danú minútu: naživo z kiosku, inak z krivky dňa (namerané/predpoveď) - v náhľade
 * aj „teraz“ bez živého výkonu. Appka tak funguje aj pre toho, kto meranie nemá.
 * @param {HeroInput} state @param {number | null} live @param {number} minutes @param {number} nowMinutes
 */
function powerFor(state, live, minutes, nowMinutes) {
    if (live !== null) return live;
    return dayKwAt(minutes, state.pv ? state.pv.realCurveToday : null, state.forecast ? state.forecast.hourlyToday : null, nowMinutes);
}

/**
 * Kedy menič naposledy meral a či je to priveľmi dávno. Čas merania je posledný bod dnešnej
 * krivky - "aktualizované" (čas stiahnutia) by pri výpadku meniča ďalej rástlo, krivka nie.
 * Mlčanie krivky je chyba, len keď slnko svietilo celé okno STALE_PV_MS; inak je večer
 * a noc bez merania normálne. Zdroj bez krivky (výrobca cez API) posiela čas merania
 * v `measuredAt`. Bez bodu krivky aj bez neho zostáva čas stiahnutia. `label` je bez času -
 * hlavička ukazuje čas a slovo v dvoch riadkoch.
 * `pricina` povie, prečo je zastarané: `spojenie` - appka sama nič nestiahla (telefón, server),
 * `menic` - dáta chodia, ale menič mlčí, hoci slnko svieti. Pri oboch naraz je to spojenie - kým
 * appka nič nestiahne, o meniči nevie nič nové. `spi`: nezastarané, slnko je pod hranicou a krivka
 * mlčí - večer a v noci normálny stav, nie chyba. `mlci` je počet minút od merania (null bez neho).
 * @param {{ now: Date, pv: import('./kiosk.js').PvData, site: import('./config.js').Site }} state
 * @returns {{ label: string, time: string, stale: boolean, pricina: 'spojenie' | 'menic' | null, spi: boolean, mlci: number | null }}
 */
export function pvFreshness({ now, pv, site }) {
    const nowMinutes = localMinutes(now, site.timezone);
    const updated = new Date(pv.updatedAt);
    const fetchStale = now.getTime() - updated.getTime() > STALE_PV_MS;
    const measured =
        realCurveBoundary(pv.realCurveToday, nowMinutes) ??
        (pv.measuredAt ? Math.min(localMinutes(new Date(pv.measuredAt), site.timezone), nowMinutes) : null);
    const windowStart = new Date(now.getTime() - STALE_PV_MS);
    const sunUp = solarPosition(windowStart, site.lat, site.lon).elevationDeg > STALE_PV_SUN_DEG;
    const mlci = measured === null ? null : nowMinutes - measured;
    const quiet = mlci === null || mlci * 60000 > STALE_PV_MS;
    const pricina = fetchStale ? 'spojenie' : sunUp && quiet ? 'menic' : null;
    const time = minutesToTimeStr(measured === null ? localMinutes(updated, site.timezone) : measured);
    return {
        label: measured === null ? 'aktualizované' : 'meranie',
        time,
        stale: pricina !== null,
        pricina,
        spi: pricina === null && !sunUp && quiet,
        mlci,
    };
}

/**
 * @typedef {{ druh: 'zive' | 'spi' | 'zastarane' | 'neprislo' | 'znova' | 'odhad', cas: string,
 *   neplati: ReturnType<typeof neplatiOf>, pricina: 'spojenie' | 'menic' | null, mlci: number | null }} StavMerania
 */

/**
 * Stav živého merania: rátajú karty s meraním, a keď nie, prečo. `cas` je čas posledného merania
 * (pvFreshness), kde meranie je, inak prázdny; `neplati` model prístupu, ktorý výrobca prestal
 * prijímať (neplatiOf). Meranie bez výkonu je pre karty to isté ako meranie, ktoré neprišlo - okrem
 * noci (`spi`), keď menič nemá čo merať. Pri `zastarane` nesie `pricina` a `mlci` z pvFreshness.
 * @param {{ now: Date, pv: import('./kiosk.js').PvData | null, site: import('./config.js').Site,
 *   zdroj: import('./zdroje.js').Zdroj | null, pristup: import('./pristup.js').Odmietnutie | null }} s
 * @returns {StavMerania}
 */
export function stavMerania(s) {
    const base = { cas: '', neplati: null, pricina: null, mlci: null };
    if (s.pv) {
        const f = pvFreshness({ now: s.now, pv: s.pv, site: s.site });
        if (f.pricina) return { ...base, druh: 'zastarane', cas: f.time, pricina: f.pricina, mlci: f.mlci };
        if (f.spi) return { ...base, druh: 'spi', cas: f.time, mlci: f.mlci };
        return { ...base, druh: freshPowerKw(s) === null ? 'neprislo' : 'zive', cas: f.time };
    }
    const neplati = neplatiOf(s);
    if (neplati) return { ...base, druh: 'znova', neplati };
    return { ...base, druh: s.zdroj ? 'neprislo' : 'odhad' };
}

/**
 * Tvar bodky pri čase v hlavičke - v oboch appkách ten istý: `live` plná (meranie ide, aj keď
 * menič v noci spí), `stale` polovičná (meranie je pripojené, ale nové neprišlo), `odhad` krúžok
 * (len predpoveď). Stav `off` (appka ešte nevie) určuje kabát pred načítaním.
 * @param {StavMerania} stav @returns {'live' | 'stale' | 'odhad'}
 */
export function bodkaMerania(stav) {
    if (stav.druh === 'zive' || stav.druh === 'spi') return 'live';
    return stav.druh === 'zastarane' ? 'stale' : 'odhad';
}

/**
 * Stav živého merania do riadku v Nastavení: bodka (tone) a krátky text. Bez merania null -
 * kto meranie nechce, tomu nič nechýba.
 * @param {{ now: Date, pv: import('./kiosk.js').PvData | null, site: import('./config.js').Site, zdroj: unknown, loading: boolean }} state
 * @returns {{ tone: 'ok' | 'stale' | 'off' | 'wait', text: string } | null}
 */
export function liveStatus({ now, pv, site, zdroj, loading }) {
    if (!zdroj) return null;
    if (!pv) return loading ? { tone: 'wait', text: 'pripájam…' } : { tone: 'off', text: 'nepripojené' };
    const { time, pricina } = pvFreshness({ now, pv, site });
    return pricina ? { tone: 'stale', text: `${STAV_SLOVO[pricina]} · ${time}` } : { tone: 'ok', text: `pripojené · ${time}` };
}

/** "Lepšie bude o HH:00" - len naživo, keď slnko ešte nepokrýva veľké spotrebiče a predpoveď hlási silnejšie. @param {HeroInput} state @param {boolean} sunny */
function waitTimeFor(state, sunny) {
    const f = state.forecast;
    if (state.previewMinutes !== null || sunny || !f || !f.strongerWindowAhead || !Number.isFinite(f.hoursAhead)) return null;
    const hour = Math.floor(localMinutes(state.now, state.site.timezone) / 60);
    return `${pad2((hour + Math.round(/** @type {number} */ (f.hoursAhead))) % 24)}:00`;
}

/**
 * Veľké číslo výkonu: jedno desatinné miesto, nula bez neho („0“, nie „0.0“) - druhé desatinné
 * miesto bolo pre rodinu len šum. Bodka je tu zámerne, hoci zvyšok appky píše desatinnú čiarku:
 * veľké číslo ako na displeji meniča s ňou vyzerá lepšie. Čiarku sme skúsili (#180) a vrátili.
 * @param {number} kw
 */
function powerTextOf(kw) {
    const text = kw.toFixed(1);
    return text === '0.0' ? '0' : text;
}

/**
 * Odkiaľ výkon je: naživo, z merania v krivke dňa, alebo z predpovede. Bez výkonu (žiadne dáta,
 * panely nie sú zadané) null - pomlčka nie je odhad. Karty ho píšu vlastnými slovami
 * (terazSourceText). @param {number} power @param {boolean} live @param {boolean} measured
 * @returns {'live' | 'measured' | 'forecast' | null}
 */
function sourceFor(power, live, measured) {
    if (!Number.isFinite(power)) return null;
    return live ? 'live' : measured ? 'measured' : 'forecast';
}

/** @param {HeroInput} state @param {import('./messages.js').Voice} [voice] tón odporúčania */
export function heroModel(state, voice = 'drzy') {
    const nowMinutes = localMinutes(state.now, state.site.timezone);
    const preview = state.previewMinutes !== null;
    const minutes = preview ? /** @type {number} */ (state.previewMinutes) : nowMinutes;
    const live = livePower(state);
    const power = powerFor(state, live, minutes, nowMinutes);
    const th = powerThresholds(state.plant);
    // Štvrťhodina plánu dňa: pásmo tarify a farba z krivky dňa. Pozadie (tier) sa tak zhoduje
    // s pásom plánu pod zvoleným časom v grafe dňa.
    const slot = planAt(state, minutes);
    const level = slot.level;
    const T = voiceTexts(voice);
    const message = slot.night
        ? T.NIGHT_MESSAGES[level]
        : getSlotMessage(level, power, state.forecast, th, voice) || T.PRICE_MESSAGES[level];
    const boundary = realCurveBoundary(state.pv ? state.pv.realCurveToday : null, nowMinutes);
    const measured = boundary !== null && minutes <= boundary;

    return {
        minutes,
        preview,
        power,
        tier: slot.tier,
        isNight: slot.night,
        message,
        waitTime: waitTimeFor(state, slot.tier === 'green'),
        powerText: Number.isFinite(power) ? powerTextOf(power) : '–',
        source: sourceFor(power, live !== null, measured),
    };
}
