// Tarifa používateľa a všetko, čo z nej a z výkonu FV odvodzuje stav siete a spotrebičov:
// rozvrh na deň, pásmo v danej minúte, farebné "tiery", kontrola a čítanie uloženej tarify.
// Čisté funkcie bez DOM.

import { DEVICES, LEVEL_TIER, MINUTES_PER_DAY, PRICE_LEVELS, TARIFF_LIMITS } from './config.js';
import { fmt2, minutesToTimeStr, timeStrToMinutes } from './format.js';

/** @typedef {import('./config.js').Tier} Tier */
/** @typedef {import('./config.js').PriceLevel} PriceLevel */
/** @typedef {import('./config.js').Band} Band */
/** @typedef {import('./config.js').Schedule} Schedule */
/** @typedef {import('./config.js').Tariff} Tariff */
/** @typedef {import('./config.js').PowerThresholds} PowerThresholds */

/** Deň v týždni pre miestny dátum `YYYY-MM-DD`: 1 = pondelok … 7 = nedeľa. @param {string} dateKey */
export function weekdayOf(dateKey) {
    const d = new Date(`${dateKey}T12:00:00Z`).getUTCDay();
    return d === 0 ? 7 : d;
}

/**
 * Rozvrh pre miestny deň: posledná výnimka, ktorá sedí na deň v týždni aj mesiac, inak
 * základ. Dátum je v pásme lokality, ako všetko, čo appka o čase elektrárne hovorí.
 * @param {Tariff} tariff @param {string} dateKey @returns {Schedule}
 */
export function scheduleFor(tariff, dateKey) {
    const day = weekdayOf(dateKey);
    const month = Number(dateKey.slice(5, 7));
    let found = tariff.schedules[0];
    for (const s of tariff.schedules.slice(1)) if (s.days.includes(day) && s.months.includes(month)) found = s;
    return found;
}

/** Pásmo podľa id; neznáme id (nemalo by nastať, kontroluje ho checkTariff) je prvé pásmo.
 * @param {Tariff} tariff @param {string} id */
export function bandById(tariff, id) {
    return tariff.bands.find((b) => b.id === id) || tariff.bands[0];
}

/** Pásmo v danej minúte dňa. @param {Tariff} tariff @param {Schedule} schedule @param {number} minutes @returns {Band} */
export function bandAt(tariff, schedule, minutes) {
    let id = schedule.changes[0].band;
    for (const c of schedule.changes) {
        if (timeStrToMinutes(c.from) > minutes) break;
        id = c.band;
    }
    return bandById(tariff, id);
}

/**
 * Pásma dňa od 00:00 do 24:00: {startMin, min, band, level}. Rozvrh je zoznam zmien, takže
 * pásma idú za sebou bez dier aj prekryvov.
 * @param {Tariff} tariff @param {string} dateKey
 */
export function priceSegments(tariff, dateKey) {
    const { changes } = scheduleFor(tariff, dateKey);
    return changes.map((c, i) => {
        const startMin = timeStrToMinutes(c.from);
        const end = i + 1 < changes.length ? timeStrToMinutes(changes[i + 1].from) : MINUTES_PER_DAY;
        const band = bandById(tariff, c.band);
        return { startMin, min: end - startMin, band, level: band.level };
    });
}

/** Farba úrovne bez slnka. @param {PriceLevel | null} level @returns {Tier | null} */
export function levelTier(level) {
    return level ? LEVEL_TIER[level] : null;
}

/**
 * Zaradenie výkonu FV do pásma: 'niz' | 'str' | 'vys' | null bez dát.
 * @param {number} powerKw @param {PowerThresholds} th hranice elektrárne (`powerThresholds`)
 */
export function productionLevel(powerKw, th) {
    if (!Number.isFinite(powerKw)) return null;
    if (powerKw < th.lowKw) return 'niz';
    if (powerKw < th.highKw) return 'str';
    return 'vys';
}

/**
 * Farba podľa ceny aj výkonu FV: od dolnej hranice je zelená bez ohľadu na cenu (slnko pokryje
 * veľké spotrebiče), pod ňou podľa úrovne pásma - červená drahé, sivá bežné, oranžová lacné.
 * @param {PriceLevel | null} level @param {number} powerKw @param {PowerThresholds} th @param {Tier | null} [fallback] bez výkonu
 * @returns {Tier | null}
 */
export function smartTier(level, powerKw, th, fallback = levelTier(level)) {
    if (!Number.isFinite(powerKw)) return fallback;
    if (powerKw >= th.lowKw) return 'green';
    return levelTier(level);
}

/**
 * Auto má vlastnú farebnú logiku, lebo berie 11 kW: zelené len pri vysokej výrobe mimo drahého
 * pásma, v lacnom pásme bez slnka oranžové, inak červené.
 * @param {PriceLevel | null} level @param {number} powerKw @param {PowerThresholds} th @returns {Tier}
 */
export function autoTier(level, powerKw, th) {
    if (!Number.isFinite(powerKw) || powerKw < th.highKw) return level === 'lacna' ? 'amber' : 'red';
    return level === 'draha' ? 'amber' : 'green';
}

/**
 * Stav každého spotrebiča: 'go', keď slnko pokryje veľké spotrebiče (alebo, pri aute a bojleri,
 * v lacnom pásme), inak 'wait'. V slabý deň sú spotrebiče, ktoré sa bez slnka neoplatia,
 * 'no' - slnko ich v taký deň nepokryje vôbec.
 * @param {{ tier: Tier | null, level: PriceLevel }} slot pás plánu dňa v danej minúte
 * @param {boolean} weakDay dnešná špička nedosiahne ani hranicu slabého dňa
 * @returns {Array<{name: string, powerKw: number, state: 'go' | 'wait' | 'no'}>}
 */
export function deviceStates(slot, weakDay) {
    return DEVICES.map((d) => {
        const base = { name: d.name, powerKw: d.powerKw };
        if (weakDay && !d.weakDay) return { ...base, state: 'no' };
        const go = slot.tier === 'green' || (d.cheapGrid && slot.level === 'lacna');
        return { ...base, state: go ? 'go' : 'wait' };
    });
}

/**
 * Úrovne pásiem podľa cien: najlacnejšie je lacné, najdrahšie drahé, ostatné bežné. Jediné
 * pásmo alebo všetky za rovnakú cenu sú bežné. Bez cien všetkých pásiem null.
 * @param {Band[]} bands @returns {Record<string, PriceLevel> | null}
 */
export function autoLevels(bands) {
    if (!bands.length || bands.some((b) => b.price === null || !Number.isFinite(b.price))) return null;
    const prices = bands.map((b) => /** @type {number} */ (b.price));
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    /** @type {Record<string, PriceLevel>} */ const out = {};
    for (const b of bands) out[b.id] = min === max ? 'bezna' : b.price === min ? 'lacna' : b.price === max ? 'draha' : 'bezna';
    return out;
}

// ---- Úpravy rozvrhu v sprievodcovi --------------------------------------------------

const SLOTS = MINUTES_PER_DAY / TARIFF_LIMITS.stepMin;

/** Typ sadzby podľa počtu pásiem - podľa neho sprievodca vyberá obrazovky. @param {Tariff} tariff */
export function tariffKind(tariff) {
    return tariff.bands.length === 1 ? 'jedna' : tariff.bands.length === 2 ? 'dvoj' : 'viac';
}

/** Rozvrh po štvrťhodinách: id pásma v každej z 96 štvrťhodín dňa. @param {Schedule} schedule @returns {string[]} */
export function slotsOf(schedule) {
    /** @type {string[]} */ const slots = [];
    schedule.changes.forEach((c, i) => {
        const from = timeStrToMinutes(c.from) / TARIFF_LIMITS.stepMin;
        const to = i + 1 < schedule.changes.length ? timeStrToMinutes(schedule.changes[i + 1].from) / TARIFF_LIMITS.stepMin : SLOTS;
        for (let s = from; s < to; s++) slots[s] = c.band;
    });
    return slots;
}

/** Späť na zmeny od 00:00 - opak slotsOf. @param {string[]} slots @returns {Array<{ from: string, band: string }>} */
export function changesOf(slots) {
    const all = slots.map((band, i) => ({ from: minutesToTimeStr(i * TARIFF_LIMITS.stepMin), band }));
    return mergeChanges(all);
}

/**
 * Premaľuje štvrťhodiny od `from` po `to` (vrátane) jedným pásmom, kratšou cestou po kruhu -
 * ťah prstom cez polnoc je súvislý ťah, nie cesta okolo celého dňa.
 * @param {string[]} slots @param {number} from @param {number} to @param {string} band
 */
export function paintSlots(slots, from, to, band) {
    const out = slots.slice();
    const step = (to - from + SLOTS) % SLOTS <= SLOTS / 2 ? 1 : -1;
    let i = from;
    out[i] = band;
    while (i !== to) {
        i = (i + step + SLOTS) % SLOTS;
        out[i] = band;
    }
    return out;
}

/**
 * Úseky rozvrhu na zobrazenie: úsek cez polnoc je jeden (23:30 – 07:30), zoradené od prvého
 * začínajúceho po polnoci. {startMin, min, band}.
 * @param {Tariff} tariff @param {Schedule} schedule
 */
export function scheduleRuns(tariff, schedule) {
    const runs = schedule.changes.map((c, i) => {
        const startMin = timeStrToMinutes(c.from);
        const end = i + 1 < schedule.changes.length ? timeStrToMinutes(schedule.changes[i + 1].from) : MINUTES_PER_DAY;
        return { startMin, min: end - startMin, band: bandById(tariff, c.band) };
    });
    if (runs.length > 1 && runs[0].band === runs[runs.length - 1].band) {
        const last = /** @type {(typeof runs)[number]} */ (runs.pop());
        runs[0] = { startMin: last.startMin, min: last.min + runs[0].min, band: last.band };
        runs.sort((a, b) => a.startMin - b.startMin);
    }
    return runs;
}

/**
 * Rozvrh ako farby bez slnka - pre kruh v sprievodcovi a malý prstenec v zhrnutí. Tvarom sedí
 * s plánom dňa (`dayRingModel` ho nakreslí rovnako).
 * @param {Tariff} tariff @param {Schedule} schedule
 */
export function scheduleTiers(tariff, schedule) {
    return schedule.changes.map((c, i) => {
        const startMin = timeStrToMinutes(c.from);
        const end = i + 1 < schedule.changes.length ? timeStrToMinutes(schedule.changes[i + 1].from) : MINUTES_PER_DAY;
        return { startMin, min: end - startMin, tier: levelTier(bandById(tariff, c.band).level) };
    });
}

/** Je rozvrh víkendová výnimka? @param {Schedule} s */
export const isWeekendSchedule = (s) => s.days.join() === '6,7' && s.months.length === 12;
/** Je rozvrh výnimka na časť roka (všetky dni, niektoré mesiace)? @param {Schedule} s */
export const isSeasonSchedule = (s) => s.days.length === 7 && s.months.length < 12;

/** Kľúč pre nové pásmo, ktorý ešte nie je obsadený. @param {Tariff} tariff */
export function newBandId(tariff) {
    let n = 1;
    while (tariff.bands.some((b) => b.id === `b${n}`)) n++;
    return `b${n}`;
}

/** Hodiny s desatinnou čiarkou: 20 h, 7,5 h. @param {number} min */
const hoursText = (min) => `${String(Math.round((min / 60) * 100) / 100).replace('.', ',')} h`;

/**
 * Súhrn tarify v jednom riadku: „2 pásma · lacno 20 h · víkend inak“.
 * @param {Tariff} tariff
 */
export function tariffHint(tariff) {
    if (tariff.bands.length === 1) return 'Jedna cena celý deň';
    const [base, ...exceptions] = tariff.schedules;
    const cheap = scheduleRuns(tariff, base)
        .filter((r) => r.band.level === 'lacna')
        .reduce((sum, r) => sum + r.min, 0);
    const parts = [`${tariff.bands.length} pásma`];
    if (cheap) parts.push(`lacno ${hoursText(cheap)}`);
    if (exceptions.some(isWeekendSchedule)) parts.push('víkend inak');
    if (exceptions.some((s) => !isWeekendSchedule(s))) parts.push('časť roka inak');
    return parts.join(' · ');
}

/** Ceny pásiem v jednom riadku, alebo null, keď nie sú zadané všetky. @param {Tariff} tariff */
export function tariffPricesText(tariff) {
    if (tariff.bands.some((b) => b.price === null)) return null;
    const list = tariff.bands.map((b) => `${b.name} ${fmt2(/** @type {number} */ (b.price))}`).join(' · ');
    return `${list} ${tariff.currency}/kWh`;
}

// ---- Kontrola a čítanie uloženej tarify ---------------------------------------------

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ID_RE = /^[a-z0-9]{1,8}$/;

/** Je zoznam neprázdna, rastúca množina celých čísel od 1 do max? @param {unknown} list @param {number} max */
function validSet(list, max) {
    return (
        Array.isArray(list) &&
        list.length > 0 &&
        list.every((x, i) => Number.isInteger(x) && x >= 1 && x <= max && (i === 0 || x > list[i - 1]))
    );
}

/** Chyby pásiem. @param {Band[]} bands @param {string[]} errors */
function checkBands(bands, errors) {
    const L = TARIFF_LIMITS;
    if (bands.length < 1 || bands.length > L.maxBands) errors.push(`Pásiem môže byť 1 až ${L.maxBands}.`);
    const ids = new Set();
    bands.forEach((b, i) => {
        const label = b.name ? `Pásmo ${b.name}` : `Pásmo ${i + 1}`;
        if (!ID_RE.test(b.id) || ids.has(b.id)) errors.push(`${label}: chybný kľúč.`);
        ids.add(b.id);
        const name = b.name.trim();
        if (!name || name.length > L.nameMax) errors.push(`Pásmo ${i + 1}: meno musí mať 1 až ${L.nameMax} znakov.`);
        if (!PRICE_LEVELS.includes(b.level)) errors.push(`${label}: vyber, či je lacné, bežné alebo drahé.`);
        if (b.price !== null && !(Number.isFinite(b.price) && b.price >= 0 && b.price <= L.priceMax))
            errors.push(`${label}: cena musí byť od 0 do ${L.priceMax}.`);
    });
}

/** Chyby jedného rozvrhu. @param {Schedule} s @param {number} i @param {Set<string>} ids @param {string[]} errors */
function checkSchedule(s, i, ids, errors) {
    const L = TARIFF_LIMITS;
    const label = i === 0 ? 'Rozvrh' : `Výnimka ${i}`;
    if (!validSet(s.days, 7) || !validSet(s.months, 12)) errors.push(`${label}: vyber aspoň jeden deň a mesiac.`);
    else if (i === 0 && (s.days.length < 7 || s.months.length < 12)) errors.push('Základný rozvrh musí platiť pre všetky dni.');
    if (s.changes.length < 1 || s.changes.length > L.maxChanges) errors.push(`${label}: zmien pásma môže byť 1 až ${L.maxChanges} za deň.`);
    let last = -1;
    s.changes.forEach((c, j) => {
        const ok = TIME_RE.test(c.from) && timeStrToMinutes(c.from) % L.stepMin === 0;
        const min = ok ? timeStrToMinutes(c.from) : NaN;
        if (!ok) errors.push(`${label}: čas ${c.from} nie je na celú štvrťhodinu.`);
        else if (j === 0 && min !== 0) errors.push(`${label}: deň musí začínať o 00:00.`);
        else if (min <= last) errors.push(`${label}: časy musia ísť za sebou.`);
        if (ok) last = min;
        if (!ids.has(c.band)) errors.push(`${label}: pásmo „${c.band}“ neexistuje.`);
    });
}

/**
 * Kontrola tarify. Chyby uloženie zablokujú, varovania nie.
 * @param {Tariff} tariff @returns {{ errors: string[], warnings: string[] }}
 */
export function checkTariff(tariff) {
    /** @type {string[]} */ const errors = [];
    /** @type {string[]} */ const warnings = [];
    const L = TARIFF_LIMITS;
    checkBands(tariff.bands, errors);
    const c = tariff.currency.trim();
    if (!c || c.length > L.currencyMax) errors.push(`Mena musí mať 1 až ${L.currencyMax} znaky.`);
    if (tariff.schedules.length < 1 || tariff.schedules.length > L.maxSchedules) errors.push(`Rozvrhov môže byť 1 až ${L.maxSchedules}.`);
    const ids = new Set(tariff.bands.map((b) => b.id));
    tariff.schedules.forEach((s, i) => checkSchedule(s, i, ids, errors));
    if (errors.length) return { errors, warnings };
    const used = new Set(tariff.schedules.flatMap((s) => s.changes.map((x) => x.band)));
    for (const b of tariff.bands) if (!used.has(b.id)) warnings.push(`Pásmo ${b.name} v rozvrhu nie je.`);
    const auto = autoLevels(tariff.bands);
    if (auto && tariff.bands.some((b) => auto[b.id] !== b.level)) warnings.push('Úrovne pásiem nesedia s ich cenami.');
    return { errors, warnings };
}

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObj = (v) => !!v && typeof v === 'object';

/** Zmeny rozvrhu bez zbytočných: dve za sebou s rovnakým pásmom sú jedna. @param {Array<{ from: string, band: string }>} changes */
export function mergeChanges(changes) {
    return changes.filter((c, i) => i === 0 || c.band !== changes[i - 1].band);
}

/**
 * Tarifa z úložiska alebo z odkazu. Dáta odtiaľ sú nedôveryhodné, preto všetko, čo nie je
 * presne v poriadku, vráti null. Dve zmeny za sebou s rovnakým pásmom sa zlúčia.
 * @param {unknown} raw @returns {Tariff | null}
 */
export function parseStoredTariff(raw) {
    if (!isObj(raw) || !Array.isArray(raw.bands) || !Array.isArray(raw.schedules)) return null;
    const str = (/** @type {unknown} */ v) => (typeof v === 'string' ? v : '');
    const nums = (/** @type {unknown} */ v) => (Array.isArray(v) ? v.map(Number) : []);
    /** @type {Tariff} */
    const tariff = {
        currency: str(raw.currency),
        bands: raw.bands.map((/** @type {any} */ b) => ({
            id: str(b && b.id),
            name: str(b && b.name),
            level: /** @type {PriceLevel} */ (str(b && b.level)),
            price: b && b.price !== null && b.price !== undefined ? Number(b.price) : null,
        })),
        schedules: raw.schedules.map((/** @type {any} */ s) => ({
            days: nums(s && s.days),
            months: nums(s && s.months),
            changes: mergeChanges(
                (s && Array.isArray(s.changes) ? s.changes : []).map((/** @type {any} */ c) => ({
                    from: str(c && c.from),
                    band: str(c && c.band),
                })),
            ),
        })),
    };
    return checkTariff(tariff).errors.length ? null : tariff;
}
