// Všetky texty odporúčaní pre používateľa na jednom mieste. Čisté funkcie bez DOM.

import { fmt1, hourLabel, weekDayLabel } from './format.js';
import { productionLevel } from './tariff.js';

/** @typedef {import('./config.js').PriceLevel} PriceLevel */
/** @typedef {{ headline: string, body: string }} Message */

// Mriežka textov: cenová úroveň pásma (draha / bezna / lacna) × výroba (niz/str/vys).
// "override" nahradí základný text, keď z predpovede vyplýva citeľne silnejšie slnko ešte dnes.
export const SLOT_MESSAGES = {
    draha: {
        niz: {
            h: 'Nezapínaj veľké spotrebiče',
            p: 'Slnko dnes už výraznejšie nepridá a elektrina je drahá. Práčku, sušičku ani nabíjanie auta teraz nespúšťaj.',
            override: {
                h: 'Počkaj na slnko',
                p: (/** @type {string} */ d) =>
                    `Elektrina je teraz drahá a slnko ešte nepridáva. Silnejšie slnko príde ${d} — veľké spotrebiče si nechaj na vtedy.`,
            },
        },
        str: {
            h: 'Len menšie spotrebiče',
            p: 'Panely čiastočne pomáhajú, sieť je stále drahá. Rýchlovarná kanvica či nabíjačky sú v poriadku, veľké spotrebiče radšej nie.',
            override: {
                h: 'Počkaj, bude to lepšie',
                p: (/** @type {string} */ d) =>
                    `Panely zatiaľ len pomáhajú, sieť je drahá. Silnejšie slnko príde ${d} — veľké spotrebiče si nechaj na vtedy.`,
            },
        },
        vys: {
            h: 'Môžeš zapnúť aj väčší spotrebič',
            p: 'Aj v drahej hodine dávajú panely slušný výkon. Jeden väčší spotrebič si môžeš dovoliť.',
        },
    },
    bezna: {
        niz: {
            h: 'Zváž, či nepočkať',
            p: (/** @type {{ tomorrowSunny: boolean }} */ ctx) =>
                ctx.tomorrowSunny
                    ? 'Panely momentálne nedávajú veľa. Zajtra bude slnečno, tak to pokojne nechaj na zajtra.'
                    : 'Panely momentálne nedávajú veľa. Zajtra podľa predpovede slnečno nebude, tak pokojne zapni, čo potrebuješ.',
            override: {
                h: 'Počkaj na slnko',
                p: (/** @type {string} */ d) =>
                    `Panely teraz veľa nedávajú. Silnejšie slnko príde ${d} — veľké spotrebiče si nechaj na vtedy.`,
            },
        },
        str: {
            h: 'Dobrý čas, využi ho',
            p: 'Slnko slušne svieti. Zapni práčku, umývačku, čo potrebuješ.',
            override: {
                h: 'Počkaj, ak to nie je súrne',
                p: (/** @type {string} */ d) => `Teraz je to dobré, ale silnejšie slnko príde ${d}. Ak môžeš počkať, oplatí sa.`,
            },
        },
        vys: {
            h: 'Výborný čas na spotrebiče',
            p: 'Vysoká výroba pokryje aj veľké spotrebiče vrátane nabíjania auta.',
        },
    },
    lacna: {
        niz: {
            h: 'Malé spotrebiče áno. Veľké nezapínaj, ak nemusíš.',
            p: 'Sieť je ale lacná, takže ak potrebuješ, pokojne zapni aj veľké spotrebiče.',
            override: {
                h: 'Radšej počkaj na slnko',
                p: (/** @type {string} */ d) =>
                    `Sieť je síce lacná, ale zadarmo elektrina zo slnka príde ${d}. Ak to nie je súrne, počkaj.`,
            },
        },
        str: {
            h: 'Dobrý čas na bežnú prevádzku',
            p: 'Slušná výroba aj lacná sieť. Práčka, umývačka aj iné bežné spotrebiče môžu ísť.',
            override: {
                h: 'Počkaj, ak to nie je súrne',
                p: (/** @type {string} */ d) => `Teraz je to dobré, ale zadarmo elektrina zo slnka príde ${d}. Ak môžeš počkať, oplatí sa.`,
            },
        },
        vys: {
            h: 'Najlepší čas dňa — zapni všetko',
            p: 'Plný výkon a k tomu lacná sieť. Ideálny moment na práčku, sušičku aj nabíjanie auta.',
        },
    },
};

/** V noci (slnko pod obzorom) hovorí text len o cene. @type {Record<PriceLevel, Message>} */
export const NIGHT_MESSAGES = {
    draha: {
        headline: 'Drahá sieť a tma',
        body: 'Slnko nesvieti a elektrina je drahá. Veľké spotrebiče nechaj na lacnejšie pásmo alebo na slnko.',
    },
    bezna: {
        headline: 'Slnko nesvieti',
        body: 'Zo siete platíš bežnú cenu. Čo môže počkať, nechaj na zajtra na slnko.',
    },
    lacna: { headline: 'Lacný nočný prúd', body: 'Slnko nesvieti, no sieť je lacná. Vhodné na bojler a nabíjanie auta.' },
};

/** Bez výkonu (žiadne dáta) ostáva len cena. @type {Record<PriceLevel, Message>} */
export const PRICE_MESSAGES = {
    draha: { headline: 'Drahá elektrina', body: 'Výkon panelov teraz nepoznám a sieť je drahá. Veľké spotrebiče radšej nezapínaj.' },
    bezna: { headline: 'Bežná cena elektriny', body: 'Výkon panelov teraz nepoznám.' },
    lacna: { headline: 'Lacná elektrina', body: 'Výkon panelov teraz nepoznám, sieť je ale lacná.' },
};

/**
 * Odporúčanie pre kombináciu ceny a výkonu, s ohľadom na predpoveď.
 * @param {PriceLevel | null} level @param {number} powerKw
 * @param {{ strongerWindowAhead?: boolean, windowDaypart?: string | null, tomorrowSunny?: boolean } | null} forecast
 * @param {import('./config.js').PowerThresholds} th
 * @returns {Message | null}
 */
export function getSlotMessage(level, powerKw, forecast, th) {
    const prod = productionLevel(powerKw, th);
    if (!prod || !level) return null;
    /** @type {{ h: string, p: string | ((ctx: { tomorrowSunny: boolean }) => string), override?: { h: string, p: (d: string) => string } }} */
    const entry = SLOT_MESSAGES[level][prod];
    if (entry.override && forecast && forecast.strongerWindowAhead && forecast.windowDaypart) {
        return { headline: entry.override.h, body: entry.override.p(forecast.windowDaypart) };
    }
    const body = typeof entry.p === 'function' ? entry.p({ tomorrowSunny: !!(forecast && forecast.tomorrowSunny) }) : entry.p;
    return { headline: entry.h, body };
}

/** Špička dňa a okno, v ktorom výroba drží aspoň 60 % špičky - z toho sa skladajú obe
 * správy o dni. @param {Array<{hour: number, kw: number}>} pts */
function peakWindow(pts) {
    const peak = pts.reduce((a, b) => (b.kw > a.kw ? b : a), pts[0] || { hour: 0, kw: 0 });
    const strongHours = pts.filter((p) => p.kw >= peak.kw * 0.6).map((p) => p.hour);
    return { peak, rangeStart: Math.min(...strongHours), rangeEnd: Math.max(...strongHours) + 1 };
}

/**
 * Správa v detaile dňa. O ktorý deň ide, hovorí hlavička nad ňou, takže text sám deň
 * nepomenúva - inak by sa pre stredu musel prekladať do "v stredu" a pre štvrtok do
 * "vo štvrtok". Dnes a Zajtra majú vlastné znenie vo forecastDayMessage nižšie.
 * @param {Array<{hour: number, kw: number}>} pts @param {import('./config.js').PowerThresholds} th
 * @returns {{ title: string, body: string }}
 */
export function dayDetailMessage(pts, th) {
    const { peak, rangeStart, rangeEnd } = peakWindow(pts);
    if (peak.kw < th.weakPeakKw) {
        return { title: 'Slabý deň', body: 'Výroba bude celý deň nízka. Veľké spotrebiče si radšej naplánuj na iný deň.' };
    }
    const peakLabel = hourLabel(peak.hour);
    return {
        title: `Najsilnejšie slnko okolo ${peakLabel}`,
        body: `Špička ~${fmt1(peak.kw)} kW. Veľké spotrebiče majú najviac zmysel medzi ${rangeStart}:00 a ${rangeEnd}:00.`,
    };
}

/**
 * Správa pod grafom predpovede pre jeden deň.
 * @param {Array<{hour: number, kw: number}>} pts @param {boolean} isToday
 * @param {import('./config.js').PowerThresholds} th
 * @returns {{ title: string, body: string }}
 */
export function forecastDayMessage(pts, isToday, th) {
    const { peak, rangeStart, rangeEnd } = peakWindow(pts);

    if (peak.kw < th.weakPeakKw) {
        return isToday
            ? { title: 'Dnes bude slabo', body: 'Výroba bude celý deň nízka. Veľké spotrebiče si radšej naplánuj na iný deň.' }
            : { title: 'Zajtra bude slabšie', body: 'Predpoveď počíta s nízkou výrobou. Ak to nie je súrne, počkaj na slnečnejší deň.' };
    }

    const peakLabel = hourLabel(peak.hour);

    if (isToday) {
        return {
            title: `Najsilnejšie slnko okolo ${peakLabel}`,
            body: `Špička okolo ${peakLabel}. Veľké spotrebiče majú najviac zmysel medzi ${rangeStart}:00 a ${rangeEnd}:00.`,
        };
    }
    return {
        title: 'Zajtra bude slnečno',
        body: `Špička okolo ${peakLabel} (~${fmt1(peak.kw)} kW). Veľké spotrebiče má zmysel naplánovať medzi ${rangeStart}:00 a ${rangeEnd}:00.`,
    };
}

/**
 * Správa pod týždenným prehľadom: najsilnejší a najslabší deň.
 * @param {Array<{date: string, kwhTotal: number}>} days
 * @returns {{ title: string, body: string }}
 */
export function weekMessage(days) {
    let best = days[0];
    let worst = days[0];
    days.forEach((d) => {
        if (d.kwhTotal > best.kwhTotal) best = d;
        if (d.kwhTotal < worst.kwhTotal) worst = d;
    });
    const bestLabel = weekDayLabel(best.date, days.indexOf(best));
    let body = `${bestLabel} má vyjsť najlepšie (${fmt1(best.kwhTotal)} kWh).`;
    if (worst !== best) {
        body += ` Najslabšie bude ${weekDayLabel(worst.date, days.indexOf(worst)).toLowerCase()} (${fmt1(worst.kwhTotal)} kWh).`;
    }
    return { title: `Najsilnejší deň: ${bestLabel}`, body };
}

export const EMPTY_MESSAGES = {
    forecast: { title: 'Predpoveď sa pripravuje', body: 'Hodinové dáta zatiaľ nie sú k dispozícii, skús to o chvíľu.' },
    week: { title: 'Predpoveď sa pripravuje', body: 'Týždenné dáta zatiaľ nie sú k dispozícii, skús to o chvíľu.' },
};
