// Texty appky: základ spoločný všetkým kartám - tón, mriežka hlášok podľa ceny a výroby
// a drobné tvary (čas, peniaze, zoznam, deň vo vete). Čisté funkcie bez DOM.

import { MINUTES_PER_DAY } from './config.js';
import { fmt2, minutesToTimeStr } from './format.js';
import { productionLevel } from './tariff.js';

/** @typedef {import('./config.js').PriceLevel} PriceLevel */
/** @typedef {{ headline: string, body: string }} Message */
/** @typedef {(typeof import('./config.js').VOICES)[number]} Voice tón hlášok */

/** Je tón slušný? @param {Voice} voice */
export const polite = (voice) => voice === 'slusny';

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
            /** @returns {string} */
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

/** SLOT_MESSAGES v slušnom tóne, s tými istými kľúčmi. */
export const SLOT_MESSAGES_SLUSNE = {
    draha: {
        niz: {
            h: 'Veľké spotrebiče teraz nezapínajte',
            p: 'Slnko dnes už výraznejšie nepridá a elektrina je drahá. Práčku, sušičku ani nabíjanie auta teraz nespúšťajte.',
            override: {
                h: 'Počkajte na slnko',
                p: (/** @type {string} */ d) =>
                    `Elektrina je teraz drahá a slnko ešte nepridáva. Silnejšie slnko príde ${d} — veľké spotrebiče si nechajte na vtedy.`,
            },
        },
        str: {
            h: 'Len menšie spotrebiče',
            p: 'Panely čiastočne pomáhajú, sieť je stále drahá. Rýchlovarná kanvica či nabíjačky sú v poriadku, veľké spotrebiče radšej nie.',
            override: {
                h: 'Počkajte, bude to lepšie',
                p: (/** @type {string} */ d) =>
                    `Panely zatiaľ len pomáhajú, sieť je drahá. Silnejšie slnko príde ${d} — veľké spotrebiče si nechajte na vtedy.`,
            },
        },
        vys: {
            h: 'Môžete zapnúť aj väčší spotrebič',
            p: 'Aj v drahej hodine dávajú panely slušný výkon. Jeden väčší spotrebič si môžete dovoliť.',
        },
    },
    bezna: {
        niz: {
            h: 'Zvážte, či nepočkať',
            p: (/** @type {{ tomorrowSunny: boolean }} */ ctx) =>
                ctx.tomorrowSunny
                    ? 'Panely momentálne nedávajú veľa. Zajtra bude slnečno, môžete to nechať na zajtra.'
                    : 'Panely momentálne nedávajú veľa. Zajtra podľa predpovede slnečno nebude, zapnite, čo potrebujete.',
            override: {
                h: 'Počkajte na slnko',
                p: (/** @type {string} */ d) =>
                    `Panely teraz veľa nedávajú. Silnejšie slnko príde ${d} — veľké spotrebiče si nechajte na vtedy.`,
            },
        },
        str: {
            h: 'Dobrý čas, využite ho',
            p: 'Slnko slušne svieti. Zapnite práčku, umývačku, čo potrebujete.',
            override: {
                h: 'Počkajte, ak to nie je súrne',
                p: (/** @type {string} */ d) => `Teraz je to dobré, ale silnejšie slnko príde ${d}. Ak môžete počkať, oplatí sa.`,
            },
        },
        vys: {
            h: 'Výborný čas na spotrebiče',
            p: 'Vysoká výroba pokryje aj veľké spotrebiče vrátane nabíjania auta.',
        },
    },
    lacna: {
        niz: {
            h: 'Malé spotrebiče áno. Veľké nezapínajte, ak nemusíte.',
            p: 'Sieť je ale lacná, takže ak potrebujete, môžete zapnúť aj veľké spotrebiče.',
            override: {
                h: 'Radšej počkajte na slnko',
                p: (/** @type {string} */ d) =>
                    `Sieť je síce lacná, ale elektrina zo slnka zadarmo príde ${d}. Ak to nie je súrne, počkajte.`,
            },
        },
        str: {
            h: 'Dobrý čas na bežnú prevádzku',
            p: 'Slušná výroba aj lacná sieť. Práčka, umývačka aj iné bežné spotrebiče môžu ísť.',
            override: {
                h: 'Počkajte, ak to nie je súrne',
                p: (/** @type {string} */ d) =>
                    `Teraz je to dobré, ale elektrina zo slnka zadarmo príde ${d}. Ak môžete počkať, oplatí sa.`,
            },
        },
        vys: {
            h: 'Najlepší čas dňa — zapnite všetko',
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

/** NIGHT_MESSAGES v slušnom tóne. @type {Record<PriceLevel, Message>} */
export const NIGHT_MESSAGES_SLUSNE = {
    draha: {
        headline: 'Drahá sieť a tma',
        body: 'Slnko nesvieti a elektrina je drahá. Veľké spotrebiče nechajte na lacnejšie pásmo alebo na slnko.',
    },
    bezna: {
        headline: 'Slnko nesvieti',
        body: 'Zo siete platíte bežnú cenu. Čo môže počkať, nechajte na zajtra na slnko.',
    },
    lacna: NIGHT_MESSAGES.lacna,
};

/** PRICE_MESSAGES v slušnom tóne. @type {Record<PriceLevel, Message>} */
export const PRICE_MESSAGES_SLUSNE = {
    ...PRICE_MESSAGES,
    draha: { headline: 'Drahá elektrina', body: 'Výkon panelov teraz nepoznám a sieť je drahá. Veľké spotrebiče radšej nezapínajte.' },
};

/**
 * Odporúčanie pre kombináciu ceny a výkonu, s ohľadom na predpoveď.
 * @param {PriceLevel | null} level @param {number} powerKw
 * @param {{ strongerWindowAhead?: boolean, windowDaypart?: string | null, tomorrowSunny?: boolean } | null} forecast
 * @param {import('./config.js').PowerThresholds} th
 * @param {Voice} [voice]
 * @returns {Message | null}
 */
export function getSlotMessage(level, powerKw, forecast, th, voice = 'drzy') {
    const prod = productionLevel(powerKw, th);
    if (!prod || !level) return null;
    /** @type {{ h: string, p: string | ((ctx: { tomorrowSunny: boolean }) => string), override?: { h: string, p: (d: string) => string } }} */
    const entry = (polite(voice) ? SLOT_MESSAGES_SLUSNE : SLOT_MESSAGES)[level][prod];
    if (entry.override && forecast && forecast.strongerWindowAhead && forecast.windowDaypart) {
        return { headline: entry.override.h, body: entry.override.p(forecast.windowDaypart) };
    }
    const body = typeof entry.p === 'function' ? entry.p({ tomorrowSunny: !!(forecast && forecast.tomorrowSunny) }) : entry.p;
    return { headline: entry.h, body };
}

// ---- Drobné tvary, ktoré skladajú vety na viacerých kartách ----------------------------

export const hm = minutesToTimeStr;

/** Peniaze: „0,19 €“. @param {number} value @param {string} currency */
export const money = (value, currency) => `${fmt2(value)} ${currency}`;

/** „v stredu“, „vo štvrtok“ - deň v pláne ako časť vety. */
export const ON_DAY = /** @type {Record<string, string>} */ ({
    Zajtra: 'zajtra',
    Pondelok: 'v pondelok',
    Utorok: 'v utorok',
    Streda: 'v stredu',
    Štvrtok: 'vo štvrtok',
    Piatok: 'v piatok',
    Sobota: 'v sobotu',
    Nedeľa: 'v nedeľu',
});

/** @param {string} name */
export const onDay = (name) => ON_DAY[name] ?? name.toLowerCase();

/** „práčka, sušička a umývačka“ @param {string[]} list */
export const andList = (list) => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} a ${list[list.length - 1]}`);

/** @param {string} s */
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Koniec úseku dňa: polnoc na konci dňa je „24:00“, nie „00:00“. @param {number} min */
export const endHm = (min) => (min >= MINUTES_PER_DAY ? '24:00' : hm(min));

/** Úsek dňa „09:15 – 16:45“. @param {{ from: number, to: number }} w */
export const spanText = (w) => `${hm(w.from)} – ${endHm(w.to)}`;

/** Slovo za počtom dní: „1 deň“, „3 dni“, „5 dní“. @param {number} n */
export const dniSlovo = (n) => (n === 1 ? 'deň' : n < 5 ? 'dni' : 'dní');
