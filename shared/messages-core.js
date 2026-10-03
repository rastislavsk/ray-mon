// Texty pre používateľa, ktoré nová appka potrebuje hneď pri štarte: hlášky podľa výroby a ceny,
// karty Môžem? a Teraz, hlavička. Texty karty 7 dní (a denné a týždenné hlášky) sú
// v messages-sedem.js, Štatistiky a súhrnu v messages-statistika.js - nová appka ich sťahuje, až
// keď tie karty načíta (obloha/web/parts.js). Spoločný vstup do všetkých textov je messages.js.
// Čisté funkcie bez DOM.
//
// Tón hlášok: drzý (predvolený, ním hovorí súčasná appka) a slušný, ktorý vyká a je vecný - voľba
// v novej appke (obloha/). Tón je parameter `voice` textových funkcií (posledný, predvolený drzý)
// a pevné texty v oboch tónoch vracia voiceTexts. Slušná varianta stojí pri drzej; kde text
// nikoho neoslovuje a nemá postoj (čísla, časy, popisky), je jeden pre oba tóny.

import { EVERYDAY, MINUTES_PER_DAY } from './config.js';
import { fmt1, fmt2, fmtSum, kwpRoughText, minutesToTimeStr } from './format.js';
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
const SLOT_MESSAGES_SLUSNE = {
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
const NIGHT_MESSAGES_SLUSNE = {
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
const PRICE_MESSAGES_SLUSNE = {
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

// ---- Karta Môžem? -----------------------------------------------------------------
// Tón je zámerne suchý, nie roztomilý: čítajú ho najmä tínedžeri (návrh C
// v docs/navrhy/karta-mozem.html). Veľké slovo, jedna veta, žiadne kW.

/** Veľké slovo karty podľa stavu. */
export const MOZEM_WORDS = {
    go: 'ZAPNI TOOO',
    wait: 'NO NO, NOT YET',
    slabo: 'NAHOVNO DEŇ',
    none: 'Dnes už ne e !',
    offline: 'Neviem.',
    loading: 'Uno momento',
    bezpanelov: 'Neviem.',
};

/** Hlášky pod mriežkou, striedajú sa ťuknutím. Sada podľa stavu karty. */
export const MOZEM_QUIPS = {
    go: [
        'Slnko platí. Ty nie.',
        'Strecha dnes robí viac ako ty.',
        'Teraz je to zo strechy. Večer nie.',
        'Svieti. Nerieš a zapni.',
        'Najlepšie hodiny dňa. Nepremrhaj ich scrollovaním.',
    ],
    wait: [
        'Daj si raňajky. Práčka počká.',
        'Slnko sa ešte rozcvičuje. Ty môžeš tiež.',
        'Počkať sa tu vypláca. Doslova.',
        'Ešte chvíľu. Ako keď sa načítava hra.',
    ],
    none: [
        'Slnko má padla. Zajtra zase v robote.',
        'Noc je na spanie, nie na sušičku.',
        'Mesiac bohužiaľ nevyrába.',
        'Strecha spí. Nebuď ju.',
    ],
    slabo: ['Slnko je dnes na home office.', 'Mraky majú dnes prednosť.', 'Slabý deň. Stáva sa aj najlepším.'],
    offline: ['Aj slnko má niekedy výpadok. Tentoraz my.', 'Bez dát len hádam. A hádať nebudem.', 'Spýtaj sa toho, kto platí elektrinu.'],
    loading: ['Pozerám na oblohu.'],
    bezpanelov: ['Bez panelov len hádam. A hádať nebudem.', 'Povedz mi, čo máš na streche, a poviem ti, čo môžeš.'],
};

/** Slušný tón karty: veľké slovo vecne a hlášky bez irónie, s vykaním. Veľké slovo píše veľkými ako v návrhu. */
const MOZEM_WORDS_SLUSNE = {
    go: 'ÁNO, TERAZ',
    wait: 'EŠTE NIE',
    slabo: 'SLABÝ DEŇ',
    none: 'DNES UŽ NIE',
    offline: 'NEVIEM',
    loading: 'MOMENT',
    bezpanelov: 'NEVIEM',
};

/** @type {typeof MOZEM_QUIPS} */
const MOZEM_QUIPS_SLUSNE = {
    go: [
        'Strecha dnes pracuje za vás.',
        'Slnečná energia je zadarmo.',
        'Teraz to ide zo strechy, večer už zo siete.',
        'Svieti. Je vhodný čas zapnúť spotrebiče.',
        'Najlepšie hodiny dňa sú práve teraz.',
    ],
    wait: ['Práčka môže chvíľu počkať.', 'Slnko ešte len naberá silu.', 'Počkať sa oplatí.', 'Ešte chvíľu, slnko príde.'],
    none: [
        'Slnko dnes už skončilo. Zajtra bude znova vyrábať.',
        'V noci panely nevyrábajú.',
        'Väčšie spotrebiče sa oplatí zladiť so slnkom.',
        'Ďalšie dni nájdete na karte 7 dní.',
    ],
    slabo: ['Dnes je oblačno, výroba bude nízka.', 'Oblačnosť sa mení, sledujem ju.', 'Slabý deň. Lepší príde.'],
    offline: ['Dáta momentálne nie sú dostupné.', 'Bez dát nebudem odhadovať.', 'Skúste to o chvíľu znova.'],
    loading: MOZEM_QUIPS.loading,
    bezpanelov: ['Bez panelov môžem len odhadovať.', 'Zadajte, čo máte na streche, a poviem vám, čo môžete zapnúť.'],
};

/**
 * Veci v karte Môžem?: meno, sloveso a zámeno do viet („Pusti ju o 10:30.“) a čo sa stane, keď
 * sa zamračí. Kľúče sú id z MOZEM_ITEMS v config.js.
 * @type {Record<string, { name: string, verb: string, pron: string, cloud: string }>}
 */
export const MOZEM_ITEM_TEXTS = {
    pracka: { name: 'Práčka', verb: 'Pusti', pron: 'ju', cloud: 'Nevadí. Najviac berie na začiatku pri ohreve vody.' },
    umyvacka: { name: 'Umývačka', verb: 'Pusti', pron: 'ju', cloud: 'Nevadí. Najviac berie pri ohreve vody.' },
    susicka: { name: 'Sušička', verb: 'Pusti', pron: 'ju', cloud: 'Sušička berie prúd celý čas, zvyšok pôjde zo siete.' },
    auto: { name: 'Auto', verb: 'Zapoj', pron: 'ho', cloud: 'Nabíja sa ďalej, len zo siete.' },
    hranie: { name: 'Hranie', verb: '', pron: '', cloud: '' },
    fen: { name: 'Fén', verb: '', pron: '', cloud: '' },
};

/** Veci, ktoré od slnka nezávisia: vždy OK, s vysvetlením. */
export const MOZEM_ALWAYS = {
    hranie: { head: 'Vždy OK.', text: 'Konzola aj PC berú menej ako chladnička. Hraj kedy chceš, to nie je otázka pre strechu.' },
    fen: { head: 'Pokojne.', text: 'Fén berie veľa, ale len pár minút. To sú centy.' },
};

/** Bez dát o slnku nevie karta o spotrebiči nič povedať. */
export const MOZEM_UNKNOWN = { short: 'neviem', head: 'Neviem.', text: 'Bez dát netuším, či svieti. Ak musíš, pusti to, nič sa nestane.' };

/** Veci v slušnom tóne: sloveso vyká. @type {typeof MOZEM_ITEM_TEXTS} */
const MOZEM_ITEM_TEXTS_SLUSNE = {
    ...MOZEM_ITEM_TEXTS,
    pracka: { ...MOZEM_ITEM_TEXTS.pracka, verb: 'Pustite' },
    umyvacka: { ...MOZEM_ITEM_TEXTS.umyvacka, verb: 'Pustite' },
    susicka: { ...MOZEM_ITEM_TEXTS.susicka, verb: 'Pustite' },
    auto: { ...MOZEM_ITEM_TEXTS.auto, verb: 'Zapojte' },
};

/** @type {typeof MOZEM_ALWAYS} */
const MOZEM_ALWAYS_SLUSNE = {
    hranie: {
        head: 'Vždy v poriadku.',
        text: 'Konzola aj počítač berú menej ako chladnička. Hrať sa dá kedykoľvek, so strechou to nesúvisí.',
    },
    fen: MOZEM_ALWAYS.fen,
};

/** @type {typeof MOZEM_UNKNOWN} */
const MOZEM_UNKNOWN_SLUSNE = {
    ...MOZEM_UNKNOWN,
    text: 'Bez dát neviem, či svieti. Ak to potrebujete, zapnite to, nič sa nestane.',
};

/** @typedef {import('./mozem.js').DayCtx} DayCtx */
/** @typedef {import('./mozem.js').LaterDay} LaterDay */
/** @typedef {import('./mozem.js').Window} MozemWindow */

const hm = minutesToTimeStr;

/** Dĺžka programu slovami: „hodinu“, „hodinu a pol“, „2 hodiny“, „2 a pol hodiny“, „5 hodín“. @param {number} min */
export function durationText(min) {
    const h = Math.floor(min / 60);
    const half = min % 60 >= 30;
    if (h <= 1) return half && h === 1 ? 'hodinu a pol' : 'hodinu';
    const noun = half || h < 5 ? 'hodiny' : 'hodín';
    return half ? `${h} a pol ${noun}` : `${h} ${noun}`;
}

/** Odpočet: „2 h 20 min“, „45 min“, „3 h“. @param {number} min */
export function countdownText(min) {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    if (!h) return `${m} min`;
    return m ? `${h} h ${m} min` : `${h} h`;
}

/** Peniaze: „0,19 €“. @param {number} value @param {string} currency */
const money = (value, currency) => `${fmt2(value)} ${currency}`;

/** Kedy iný deň: „Zajtra od 11:00“. @param {LaterDay} d */
const laterWhen = (d) => `${d.name} od ${hm(d.start)}`;

/**
 * Vety hlavičky karty Môžem? v oboch tónoch. `soon` je „zajtra“ alebo „keď vyjde slnko“.
 * Drzé sú tie isté, ktoré hovorí súčasná appka.
 */
const HERO_SAY = {
    drzy: {
        bezpanelov: 'Nepoznám tvoje panely, takže netuším, koľko toho strecha utiahne. Ak musíš, pusti to.',
        offline: 'Nemám predpoveď ani meranie. Skús o chvíľu, alebo sa spýtaj toho, kto platí elektrinu.',
        pay: ' Teraz by si platil drahý prúd.',
        slabo: (/** @type {string} */ soon) => `Mraky celý deň. Veľké veci radšej ${soon}.`,
        done: 'Slnko skončilo zmenu.',
        cheap: (/** @type {string} */ soon) => ` Auto na lacný prúd je OK, zvyšok ${soon}.`,
        rest: (/** @type {string} */ soon) => ` Zvyšok ${soon}.`,
        made: 'dnes strecha nahnala',
        live: 'Slnko to teraz platí za nás.',
        go: ' Práčka, sušička, auto, čo chceš.',
    },
    slusny: {
        bezpanelov: 'Nepoznám vaše panely, takže neviem, koľko strecha zvládne. Ak to potrebujete, zapnite to.',
        offline: 'Nemám predpoveď ani meranie. Skúste to o chvíľu znova.',
        pay: ' Teraz by ste platili drahý prúd.',
        slabo: (/** @type {string} */ soon) => `Celý deň je oblačno. Veľké spotrebiče radšej ${soon}.`,
        done: 'Slnko dnes už nevyrába.',
        cheap: (/** @type {string} */ soon) => ` Auto môžete nabíjať z lacnej siete, ostatné ${soon}.`,
        rest: (/** @type {string} */ soon) => ` Ostatné ${soon}.`,
        made: 'dnes strecha vyrobila',
        live: 'Elektrinu teraz dodáva slnko.',
        go: ' Môžete zapnúť práčku, sušičku aj nabíjanie auta.',
    },
};
/** @typedef {(typeof HERO_SAY)['drzy']} HeroSay */

/**
 * Veta a fakt pod veľkým slovom. Bez `data` (načítava sa, dáta nie sú) len stála veta.
 * @param {import('./mozem.js').MozemState} state
 * @param {{ ctx: DayCtx, window: MozemWindow | null, nextDay: LaterDay | null, live: boolean, kwNow: number,
 *   todayKwh: number | null, tomorrowKwh: number | null } | null} data
 * @param {Voice} [voice]
 * @returns {{ lead: string, factK: string, factV: string }}
 */
export function mozemHeroText(state, data, voice = 'drzy') {
    const say = HERO_SAY[voice];
    if (state === 'loading') return { lead: 'Pozerám na oblohu.', factK: '', factV: '' };
    if (state === 'bezpanelov') return { lead: say.bezpanelov, factK: 'panely', factV: 'nezadané' };
    if (!data || state === 'offline') return { lead: say.offline, factK: 'dáta', factV: 'nedostupné' };
    if (state === 'go') return goHero(data, say);
    if (state === 'wait') {
        const { ctx, window } = data;
        const start = window ? window.from : ctx.nowMin;
        return {
            lead: `Za ${countdownText(start - ctx.nowMin)} to pôjde zo strechy.${ctx.draha ? say.pay : ''}`,
            factK: 'štart',
            factV: hm(start),
        };
    }
    return afterHero(state, data, say);
}

/**
 * Hlavička, keď dnes slnko už nepríde: slabý deň, alebo po zmene.
 * @param {import('./mozem.js').MozemState} state
 * @param {{ ctx: DayCtx, nextDay: LaterDay | null, live: boolean, todayKwh: number | null, tomorrowKwh: number | null }} data
 * @param {HeroSay} say vety v tóne
 */
function afterHero(state, { ctx, nextDay, live, todayKwh, tomorrowKwh }, say) {
    const soon = nextDay && nextDay.index === 1 ? 'zajtra' : 'keď vyjde slnko';
    const kwh = (/** @type {number | null} */ v) => (v === null ? '–' : `~${Math.round(v)} kWh`);
    if (state === 'slabo')
        return {
            lead: say.slabo(soon),
            factK: 'dnes len',
            factV: kwh(todayKwh) + (tomorrowKwh === null ? '' : ` · zajtra ${kwh(tomorrowKwh)}`),
        };
    return {
        lead: `${say.done}${ctx.cheap ? say.cheap(soon) : say.rest(soon)}`,
        factK: live ? say.made : 'dnes podľa predpovede',
        factV: todayKwh === null ? '–' : `${fmt1(todayKwh)} kWh`,
    };
}

/** Koľko mobilov nabije strecha za hodinu pri danom výkone, zaokrúhlené na desiatky. @param {number} kw */
export function phonesPerHour(kw) {
    return Math.round(kw / EVERYDAY.phoneChargeKwh / 10) * 10;
}

/**
 * Hlavička, keď svieti: s meraním nabitia mobilu, bez neho priznaný odhad.
 * @param {{ live: boolean, kwNow: number }} data @param {HeroSay} say vety v tóne
 */
function goHero({ live, kwNow }, say) {
    const lead = live ? say.live : 'Podľa predpovede teraz svieti naplno.';
    const phones = phonesPerHour(kwNow);
    return {
        lead: `${lead}${say.go}`,
        factK: live ? 'strecha za hodinu nabije' : 'bez merania',
        factV: live ? `~${phones} mobilov` : 'odhad z predpovede',
    };
}

/**
 * Veta pod pásom dňa.
 * @param {import('./mozem.js').MozemState} state @param {{ ctx: DayCtx, window: MozemWindow | null, nextDay: LaterDay | null }} data
 */
export function mozemStripText(state, { ctx, window, nextDay }) {
    const next = nextDay ? ` ${laterWhen(nextDay)}.` : '';
    if (state === 'go' && window) return `Slnko do ${hm(window.to)}. Ešte ${countdownText(window.to - ctx.nowMin)}.`;
    if (state === 'wait' && window) return `Slnko ${hm(window.from)} – ${hm(window.to)}.${ctx.draha ? ' Teraz je drahý prúd.' : ''}`;
    if (state === 'none' && window) return `Slnko skončilo o ${hm(window.to)}.${next}`;
    return `Dnes slnko veľké spotrebiče neutiahne.${next}`;
}

/**
 * Riadok veci v mriežke a jej rozbalenie: krátka odpoveď, veta, vysvetlenie a pri spotrebičoch
 * „čo keď mrak“ alebo „musíš hneď“ s cenou, keď ju tarifa pozná. `extra` je to posledné jednou
 * vetou (súčasná appka), `more` to isté ako otázka a odpoveď pod vlastným nadpisom (panel veci
 * v novej appke); bez vysvetlenia je `more` null.
 * @param {{ id: string, runMin: number | null }} item @param {import('./mozem.js').Answer} a
 * @param {{ ctx: DayCtx, cost: number | null } | null} env
 * @param {Voice} [voice]
 * @returns {{ name: string, tone: 'go' | 'wait' | 'cheap' | 'no' | 'unk', short: string, head: string, text: string, extra: string,
 *   more: { q: string, a: string } | null }}
 */
export function mozemItemText(item, a, env, voice = 'drzy') {
    const T = voiceTexts(voice);
    const t = T.MOZEM_ITEM_TEXTS[item.id];
    const base = { name: t.name, extra: '', more: null };
    if (a.kind === 'always') return { ...base, tone: 'go', short: 'vždy OK', ...T.MOZEM_ALWAYS[/** @type {'hranie' | 'fen'} */ (item.id)] };
    if (a.kind === 'unk' || !env) return { ...base, tone: 'unk', ...T.MOZEM_UNKNOWN };
    const isAuto = item.runMin === null;
    const cost = env.cost === null ? '' : `${isAuto ? 'Hodina nabíjania' : 'Stojí to'} ~${money(env.cost, env.ctx.currency)}.`;
    if (a.kind === 'go') {
        const cloud = `${t.cloud}${cost ? ` ${cost}` : ''}`;
        return {
            ...base,
            tone: 'go',
            ...goItem(t, a, item.runMin, env.ctx),
            extra: `Mrak? ${cloud}`,
            more: { q: 'A keď sa zamračí?', a: cloud },
        };
    }
    const now = cost || 'Pôjde to zo siete.';
    if (a.kind === 'wait') return { ...base, ...waitItem(t, a.start, isAuto, env.ctx.draha), ...ask(ITEM_SAY[voice].now, now) };
    if (a.kind === 'cheap') return { ...base, ...cheapItem(t, a.next) };
    return { ...base, ...laterItem(a, voice), ...ask('Nepočká to?', now) };
}

/** Slnko dnes nie, ale sieť je lacná. @param {{ verb: string, pron: string }} t @param {LaterDay | null} next */
function cheapItem(t, next) {
    const sun = next ? `${laterWhen(next)} by to išlo zo strechy.` : '';
    return {
        tone: /** @type {const} */ ('cheap'),
        short: 'lacno',
        head: `${t.verb} ${t.pron}, prúd je lacný.`,
        text: 'Slnko to dnes už neutiahne, ale sieť je teraz lacná.',
        extra: sun,
        more: sun ? { q: 'A zo slnka?', a: sun } : null,
    };
}

/** Vysvetlenie ako otázka s odpoveďou: jednou vetou aj zvlášť. @param {string} q @param {string} a */
const ask = (q, a) => ({ extra: `${q} ${a}`, more: { q, a } });

/** Slnko príde ešte dnes. @param {{ verb: string, pron: string }} t @param {number} start @param {boolean} isAuto @param {boolean} draha */
function waitItem(t, start, isAuto, draha) {
    return {
        tone: /** @type {const} */ ('wait'),
        short: `o ${hm(start)}`,
        head: `${t.verb} ${t.pron} o ${hm(start)}.`,
        text: isAuto
            ? `Na auto treba silné slnko a to bude o ${hm(start)}.`
            : `Teraz by to išlo zo siete${draha ? ' a tá je práve drahá' : ''}. O ${hm(start)} to utiahne strecha.`,
    };
}

/** Rozbalenie, keď svieti. @param {{ verb: string, pron: string }} t
 * @param {{ end: number, until: number, km: number | null }} a @param {number | null} runMin @param {DayCtx} ctx */
function goItem(t, a, runMin, ctx) {
    if (runMin === null)
        return {
            short: `do ${hm(a.end)}`,
            head: `${t.verb} ${t.pron}.`,
            text: a.km ? `Do ${hm(a.end)} chytí zo slnka asi ${a.km} km.` : 'Slnko ho aspoň trochu nabije.',
        };
    if (a.until > ctx.nowMin)
        return {
            short: `do ${hm(a.until)}`,
            head: `${t.verb} ${t.pron} do ${hm(a.until)}.`,
            text: `Program má ${durationText(runMin)}, takto dobehne celý na slnku.`,
        };
    return {
        short: 'teraz',
        head: `${t.verb} ${t.pron} hneď.`,
        text: `Program má ${durationText(runMin)} a slnko vydrží do ${hm(a.end)}. Koniec pôjde zo siete.`,
    };
}

/** Vety veci, ktoré sa v tónoch líšia. */
const ITEM_SAY = {
    drzy: { now: 'Musíš hneď?', wait: ' Kým nebude poriadne slnko, radšej počkaj.' },
    slusny: { now: 'Potrebujete to hneď?', wait: ' Kým nebude poriadne slnko, radšej počkajte.' },
};

/** Iný deň, alebo tento týždeň vôbec. @param {import('./mozem.js').Answer} a @param {Voice} voice */
function laterItem(a, voice) {
    if (a.kind !== 'later')
        return {
            tone: /** @type {const} */ ('no'),
            short: 'tento týždeň nie',
            head: 'Tento týždeň nie.',
            text: 'Slnko na to podľa predpovede tento týždeň nestačí.',
        };
    const { day } = a;
    return {
        tone: /** @type {'wait' | 'no'} */ (day.index === 1 ? 'wait' : 'no'),
        short: day.index === 1 ? `zajtra ${hm(day.start)}` : day.name.toLowerCase(),
        head: `${laterWhen(day)}.`,
        text: `Dnes to už slnko neutiahne.${a.weakSkipped ? ITEM_SAY[voice].wait : ''}`,
    };
}

/**
 * Tlačidlo „Pustil/a som“ v rozbalení spotrebiča. Kým vec beží, hovorí, kedy sa zapísala,
 * a že druhé ťuknutie zápis zruší. Keď appka radí počkať, je to „aj tak“ - zápis to tak berie.
 * @param {string} tone @param {boolean} isAuto @param {{ m: number } | null} running @param {Voice} [voice]
 */
export function mozemLogLabel(tone, isAuto, running, voice = 'drzy') {
    if (running) return `Zapísané o ${hm(running.m)}. ${polite(voice) ? 'Ťuknite' : 'Ťukni'} znova, ak nie.`;
    const verb = isAuto ? 'Zapojil/a som' : 'Pustil/a som';
    return tone === 'go' || tone === 'cheap' ? verb : `${verb} aj tak`;
}

/** Krátka odpoveď, kým spustená vec beží. @param {boolean} isAuto @param {number} until minúta dňa */
export function mozemRunningShort(isAuto, until) {
    return `${isAuto ? 'nabíja sa' : 'beží'} do ${hm(until)}`;
}

/** Riadok pod mriežkou: koľko toho tento mesiac človek pustil a koľko na slnku. @param {{ all: number, sun: number }} c @param {Voice} [voice] */
export function mozemCountText({ all, sun }, voice = 'drzy') {
    if (!all) return '';
    if (polite(voice)) return `Tento mesiac ste niečo pustili ${all}×, z toho ${sun}× na slnku.`;
    return `Tento mesiac si pustil/a ${all}× niečo, z toho ${sun}× na slnku.`;
}

/** „zo“ pred číslom, ktoré sa číta so s/š na začiatku: zo štyroch, zo šiestich, zo siedmich. @param {number} n */
const zFrom = (n) => ([4, 6, 7].includes(n) ? 'zo' : 'z');

/** Koľko výnimiek riadok vstupu do zoznamu vymenuje; ďalšie zhrnie ako „+2“. */
const GLANCE_NAMED = 2;

/**
 * Riadok, ktorým sa z karty Môžem? otvára zoznam vecí: koľko ide hneď a výnimky slovom
 * („auto o 12:30“). Keď ide všetko, výnimky nie sú a riadok zavolá do zoznamu po časy.
 * @param {Array<{ name: string, tone: string, short: string }>} items
 * @returns {{ title: string, sub: string }}
 */
export function mozemGlanceText(items) {
    const n = items.length;
    const go = items.filter((i) => i.tone === 'go').length;
    const rest = items.filter((i) => i.tone !== 'go');
    if (!rest.length) return { title: 'Všetko ide hneď', sub: 'Ťukni, dokedy.' };
    const title = go ? `${go} ${zFrom(n)} ${n} ide hneď` : 'Teraz nič';
    if (rest.every((i) => i.tone === 'unk')) return { title, sub: 'Pri spotrebičoch bez dát neviem.' };
    const named = rest.slice(0, GLANCE_NAMED).map((i) => `${i.name.toLowerCase()} ${i.short}`);
    const more = rest.length > GLANCE_NAMED ? ` +${rest.length - GLANCE_NAMED}` : '';
    return { title, sub: named.join(', ') + more };
}

// ---- Karta Môžem? v novej appke „Živá obloha“ (obloha/) ----------------------------
// Odpovede, časy a vety sú tie isté ako vyššie, tu sú len texty, ktoré nový vzhľad pridáva.
// Veľké písmená robí štýl, texty sú v bežnom tvare - čítačka ich tak nehláskuje.

/**
 * Štítky nad veľkým slovom: odpoveď slovom podľa stavu karty a cena siete teraz (bežná cena
 * štítok nemá). Kým sa načítava, štítok nie je - pokojný stav nemá čo tvrdiť.
 * @type {Record<import('./mozem.js').MozemState | 'lacna' | 'draha', string>}
 */
export const MOZEM_CHIPS = {
    go: 'Áno',
    wait: 'Počkaj',
    slabo: 'Dnes nie',
    none: 'Dnes nie',
    offline: 'Neviem',
    bezpanelov: 'Neviem',
    loading: '',
    lacna: 'Lacná sieť',
    draha: 'Drahá sieť',
};

/** Pevné texty karty: nadpisy panelu veci, tlačidlá a výzvy. */
export const MOZEM_SKY_TEXTS = {
    retry: 'Skúsiť znova',
    quipHint: 'ťukni, príde ďalšia',
    sheetDo: 'Čo robiť',
    sheetWhy: 'Prečo',
    close: 'Zavrieť',
    guessTitle: 'Hádam podľa suseda',
    guessBtn: 'Zadaj panely',
    askTitle: 'Kde máš strechu?',
    askText: 'Bez polohy neviem, kedy u teba svieti slnko. Zadaj ju v Nastavení a poviem ti, čo môžeš.',
    askBtn: 'Zadaj polohu',
};

/** @type {typeof MOZEM_CHIPS} */
const MOZEM_CHIPS_SLUSNE = { ...MOZEM_CHIPS, wait: 'Počkajte' };

/** @type {typeof MOZEM_SKY_TEXTS} */
const MOZEM_SKY_TEXTS_SLUSNE = {
    ...MOZEM_SKY_TEXTS,
    quipHint: 'ťuknite pre ďalší tip',
    guessTitle: 'Toto je len odhad',
    guessBtn: 'Zadajte panely',
    askTitle: 'Kde máte strechu?',
    askText: 'Bez polohy neviem, kedy u vás svieti slnko. Zadajte ju v Nastavení a poviem vám, čo môžete zapnúť.',
    askBtn: 'Zadajte polohu',
};

/** Štítok v hlavičke novej appky bez zadaných panelov - otvorí Nastavenie. */
export const HEADER_TEXTS = { setup: 'Zadaj panely ›' };

/** @type {typeof HEADER_TEXTS} */
const HEADER_TEXTS_SLUSNE = { setup: 'Zadajte panely ›' };

/** Výzva pri odpovedi z typickej strechy: s čím appka počíta. Výkon zhruba („asi 5 kWp“) -
 * desatiny by tvrdili presnosť, ktorú typická strecha nemá. @param {number} kwp výkon typickej strechy @param {Voice} [voice] */
export function mozemGuessText(kwp, voice = 'drzy') {
    if (polite(voice))
        return `Počasie poznám, vašu strechu nie. Rátam s typickou strechou ${kwpRoughText(kwp)}. Zadajte panely a odpoveď bude presne pre vás.`;
    return `Počasie poznám, tvoju strechu nie. Rátam s typickou strechou ${kwpRoughText(kwp)}. Zadaj panely a odpoveď bude naozaj tvoja.`;
}

/**
 * Nadpis zoznamu vecí: koľko ide hneď. Bez dát počet netvrdí („?“), pri typickej streche
 * priznáva odhad.
 * @param {Array<{ tone: string }>} items @param {{ unknown: boolean, estimate: boolean }} opts
 */
export function mozemListTitle(items, { unknown, estimate }) {
    const n = items.length;
    const go = unknown ? '?' : String(items.filter((i) => i.tone === 'go').length);
    return `Čo môžem · ${go} ${zFrom(n)} ${n} ide hneď${estimate ? ' · odhad' : ''}`;
}

/**
 * Fakt v mobiloch: koľko ich strecha nabije za hodinu. Zo živého merania naisto, z predpovede
 * (alebo z typickej strechy) s „asi“.
 * @param {number} kw výkon teraz @param {boolean} sure je to živé meranie z vlastnej strechy?
 */
export function mozemPhonesText(kw, sure) {
    const phones = phonesPerHour(kw);
    if (phones <= 0) return 'Strecha teraz nenabije ani jeden mobil';
    return `Strecha za hodinu nabije ${sure ? '' : 'asi '}${fmtSum(phones, 0)} mobilov`;
}

/**
 * Veta namiesto odpovede, keď appka nemá predpoveď: prečo. Bez internetu nemá nič; s ním
 * neprišla predpoveď a pri vlastnom meraní aj to, či a odkedy mlčí meranie.
 * @param {{ online: boolean, kiosk: boolean, pvOk: boolean, pvSince: string | null }} why `pvOk`: meranie
 *   ide, `pvSince`: čas posledného merania, keď je staré (null = meranie vôbec neprišlo)
 * @param {Voice} [voice]
 */
export function mozemOfflineText({ online, kiosk, pvOk, pvSince }, voice = 'drzy') {
    const p = polite(voice);
    if (!online)
        return p
            ? 'Nie je internet, takže nemám predpoveď ani meranie. Pripojte sa a skúste to znova.'
            : 'Nie je internet, takže nemám predpoveď ani meranie. Pripoj sa a skús to znova.';
    const pv = !kiosk || pvOk ? '' : pvSince ? ` Meranie zo strechy neodpovedá od ${pvSince}.` : ' Ani meranie zo strechy neodpovedá.';
    return `Predpoveď počasia neprišla, bez nej neviem, kedy bude slnko.${pv} ${p ? 'Skúste' : 'Skús'} to o chvíľu znova.`;
}

/** Tlačidlo v paneli veci, kým beží: dokedy a že ťuknutie zápis zruší. @param {boolean} isAuto @param {number} until minúta dňa */
export function mozemLogCancel(isAuto, until) {
    return `${isAuto ? 'Nabíja sa' : 'Beží'} do ${hm(until)} · zrušiť`;
}

// ---- Karta Teraz v novej appke -----------------------------------------------------
// Výkon, odporúčanie a plán dňa počíta to isté ako kartu Terazky súčasnej appky (heroModel,
// dayPlan); tu sú len texty nového vzhľadu (shared/teraz.js).

/**
 * Čo znamená farba pásu plánu pod grafom: zelená slnko stačí, modrá lacná sieť, červená drahá
 * sieť, inak bežná cena. Legenda pod pásom ich píše slovom, aby farba nebola jediný nosič významu.
 * @type {Record<import('./day-chart.js').Tone, string>}
 */
export const TERAZ_TONES = { sun: 'slnko stačí', cheap: 'lacná sieť', costly: 'drahá sieť', plain: 'bežná cena' };

/** Pevné texty karty: popisky, tlačidlá a výzvy. */
export const TERAZ_TEXTS = {
    retry: MOZEM_SKY_TEXTS.retry,
    hint: 'Ťahaj prstom po grafe a pozri si iný čas.',
    reset: 'Späť na teraz',
    limit: 'veľké spotrebiče',
    night: 'slnko je pod obzorom',
    loading: 'Načítavam…',
    slider: 'Graf dňa, šípkami si pozrieš iný čas',
    strip: 'Odporúčania, posúvaj do strán',
    devices: 'Spotrebiče',
    today: 'Dnešok',
    later: 'Kedy lepšie',
    guessTitle: 'Koľko dáva tvoja strecha?',
    guessText: 'Zadaj panely a tu uvidíš svoj výkon. S odkazom na kiosk aj naozaj nameraný.',
    guessBtn: 'Zadaj panely',
    askTitle: 'Kde máš strechu?',
    askText: 'Bez polohy neviem, kedy u teba svieti. Zadaj ju v Nastavení a ukážem ti výkon aj plán dňa.',
    askBtn: 'Zadaj polohu',
};

/** @type {typeof TERAZ_TEXTS} */
const TERAZ_TEXTS_SLUSNE = {
    ...TERAZ_TEXTS,
    hint: 'Ťahajte prstom po grafe a pozrite si iný čas.',
    slider: 'Graf dňa, šípkami si pozriete iný čas',
    strip: 'Odporúčania, posúvajte do strán',
    guessTitle: 'Koľko dáva vaša strecha?',
    guessText: 'Zadajte panely a uvidíte tu svoj výkon. S odkazom na kiosk aj naozaj nameraný.',
    guessBtn: 'Zadajte panely',
    askTitle: 'Kde máte strechu?',
    askText: 'Bez polohy neviem, kedy u vás svieti. Zadajte ju v Nastavení a ukážem vám výkon aj plán dňa.',
    askBtn: 'Zadajte polohu',
};

/** Koniec úseku dňa: polnoc na konci dňa je „24:00“, nie „00:00“. @param {number} min */
export const endHm = (min) => (min >= MINUTES_PER_DAY ? '24:00' : hm(min));

/** Úsek dňa „09:15 – 16:45“. @param {{ from: number, to: number }} w */
export const spanText = (w) => `${hm(w.from)} – ${endHm(w.to)}`;

/**
 * Riadok pod číslom: odkiaľ výkon je. Živé meranie, namerané (krivka dneška), alebo odhad
 * z predpovede - a keď meranie mlčí, aj odkedy.
 * @param {'live' | 'measured' | 'forecast' | null} source
 * @param {{ silent: boolean, since: string | null }} pv `silent`: vlastné meranie mlčí, `since`: čas
 *   posledného merania (null, keď neprišlo vôbec)
 */
export function terazSourceText(source, { silent, since }) {
    if (source === 'live') return 'živé meranie';
    if (source === 'measured') return 'namerané';
    if (!silent) return 'odhad z predpovede';
    return `odhad z predpovede · meranie neodpovedá${since ? ` od ${since}` : ''}`;
}

/** Veta pod číslom: koľko z jasnej oblohy. @param {number} pct */
export function terazClearText(pct) {
    return `${pct} % z toho, čo by dala jasná obloha`;
}

/** Veta pod číslom pri typickej streche: priznáva, že nejde o vlastnú strechu. @param {number} kwp @param {Voice} [voice] */
export function terazTypicalText(kwp, voice = 'drzy') {
    if (polite(voice)) return `typická strecha ${kwpRoughText(kwp)} vo vašej obci, nie vaša`;
    return `typická strecha ${kwpRoughText(kwp)} v tvojej obci, nie tvoja`;
}

/** Nápis pod grafom počas náhľadu. @param {number} min */
export function terazPreviewText(min) {
    return `Pozeráš ${hm(min)}.`;
}

/** Štítok nad grafom počas náhľadu: čas, výkon a čo vtedy platí. @param {number} min @param {number} kw @param {import('./day-chart.js').Tone} tone */
export function terazPillText(min, kw, tone) {
    return `${hm(min)} · ${fmt1(kw)} kW · ${TERAZ_TONES[tone]}`;
}

/**
 * Hodnota grafu pre čítačku (posúvač): čas, výkon a čo vtedy platí.
 * @param {number} min @param {boolean} preview @param {string} kwText @param {import('./day-chart.js').Tone} tone
 */
export function terazSliderText(min, preview, kwText, tone) {
    return `${preview ? 'Náhľad' : 'Teraz'} ${hm(min)}, ${kwText} kW, ${TERAZ_TONES[tone]}`;
}

/** Okno na veľké veci dnes: prebieha či príde, už bolo, alebo nebude. @param {{ from: number, to: number } | null} w @param {boolean} past */
export function terazWindowText(w, past) {
    if (!w) return 'Okno na veľké veci dnes nebude.';
    return `Okno na veľké veci ${past ? 'bolo ' : ''}${spanText(w)}.`;
}

/**
 * Textový popis grafu pre čítačku obrazovky: teraz, okno na veľké veci, kedy je lacná a kedy
 * drahá sieť - to, čo inak nesie farba pásu.
 * @param {{ nowMin: number, kwText: string, tone: import('./day-chart.js').Tone,
 *   sun: Array<{ from: number, to: number }>, cheap: Array<{ from: number, to: number }>, costly: Array<{ from: number, to: number }> }} d
 */
export function terazChartText({ nowMin, kwText, tone, sun, cheap, costly }) {
    return dayChartText({ now: { min: nowMin, kwText, tone }, sun, cheap, costly });
}

/**
 * Textový popis grafu dňa pre čítačku: pri dnešku teraz, potom okno na veľké veci, lacná a drahá
 * sieť. Graf v detaile iného dňa než dnešok značku „teraz“ nemá (`now` je null).
 * @param {{ now: { min: number, kwText: string, tone: import('./day-chart.js').Tone } | null,
 *   sun: Array<{ from: number, to: number }>, cheap: Array<{ from: number, to: number }>, costly: Array<{ from: number, to: number }> }} d
 */
export function dayChartText({ now, sun, cheap, costly }) {
    const list = (/** @type {Array<{ from: number, to: number }>} */ ws) => ws.map(spanText).join(', ');
    const parts = ['Výroba počas dňa.'];
    if (now) parts.push(`Teraz ${hm(now.min)}: ${now.kwText} kW, ${TERAZ_TONES[now.tone]}.`);
    parts.push(sun.length ? `Okno na veľké veci ${list(sun)}.` : `Okno na veľké veci ${now ? 'dnes ' : ''}nebude.`);
    if (cheap.length) parts.push(`Lacná sieť ${list(cheap)}.`);
    if (costly.length) parts.push(`Drahá sieť ${list(costly)}.`);
    return parts.join(' ');
}

/**
 * Karta Dnešok: predpoveď dňa a koľko už nabehlo - z merania naisto, bez neho podľa predpovede.
 * @param {{ forecastKwh: number, doneKwh: number, measured: boolean }} d
 */
export function terazTodayText({ forecastKwh, doneKwh, measured }) {
    return measured
        ? `Predpoveď ${fmt1(forecastKwh)} kWh, už nabehlo ${fmt1(doneKwh)} kWh.`
        : `Predpoveď ${fmt1(forecastKwh)} kWh, podľa nej už asi ${fmt1(doneKwh)} kWh.`;
}

/**
 * Karta Kedy lepšie: dnes ešte silnejšie slnko (čas z heroModel, ten istý ako „Lepšie bude o“
 * v súčasnej appke) a najbližší silný deň z predpovede.
 * @param {{ wait: string | null, todayStrong: boolean, next: { name: string, kwh: number } | null }} d
 */
export function terazLaterText({ wait, todayStrong, next }) {
    const day = next
        ? todayStrong
            ? `Dnes je silný deň. Ďalší taký: ${next.name.toLowerCase()}, okolo ${Math.round(next.kwh)} kWh.`
            : `Najbližší silný deň: ${next.name.toLowerCase()}, okolo ${Math.round(next.kwh)} kWh.`
        : todayStrong
          ? 'Dnes je silný deň. Ďalší taký v predpovedi nie je.'
          : 'Silný deň v predpovedi na týždeň nie je.';
    return wait ? `Lepšie bude o ${wait}. ${day}` : day;
}

export const EMPTY_MESSAGES = {
    forecast: { title: 'Predpoveď sa pripravuje', body: 'Hodinové dáta zatiaľ nie sú k dispozícii, skús to o chvíľu.' },
    week: { title: 'Predpoveď sa pripravuje', body: 'Týždenné dáta zatiaľ nie sú k dispozícii, skús to o chvíľu.' },
};

// ---- Pevné texty podľa tónu ---------------------------------------------------------

/** Pevné texty drzého tónu - tie isté objekty, ktoré používa súčasná appka. Celé (aj s kartami 7 dní a Štatistika) vracia voiceTexts v messages.js. */
const DRZY = {
    SLOT_MESSAGES,
    NIGHT_MESSAGES,
    PRICE_MESSAGES,
    MOZEM_WORDS,
    MOZEM_QUIPS,
    MOZEM_ITEM_TEXTS,
    MOZEM_ALWAYS,
    MOZEM_UNKNOWN,
    MOZEM_CHIPS,
    MOZEM_SKY_TEXTS,
    HEADER_TEXTS,
    TERAZ_TEXTS,
};

/** @type {typeof DRZY} */
const SLUSNY = {
    SLOT_MESSAGES: SLOT_MESSAGES_SLUSNE,
    NIGHT_MESSAGES: NIGHT_MESSAGES_SLUSNE,
    PRICE_MESSAGES: PRICE_MESSAGES_SLUSNE,
    MOZEM_WORDS: MOZEM_WORDS_SLUSNE,
    MOZEM_QUIPS: MOZEM_QUIPS_SLUSNE,
    MOZEM_ITEM_TEXTS: MOZEM_ITEM_TEXTS_SLUSNE,
    MOZEM_ALWAYS: MOZEM_ALWAYS_SLUSNE,
    MOZEM_UNKNOWN: MOZEM_UNKNOWN_SLUSNE,
    MOZEM_CHIPS: MOZEM_CHIPS_SLUSNE,
    MOZEM_SKY_TEXTS: MOZEM_SKY_TEXTS_SLUSNE,
    HEADER_TEXTS: HEADER_TEXTS_SLUSNE,
    TERAZ_TEXTS: TERAZ_TEXTS_SLUSNE,
};

/** Pevné texty jadra v danom tóne; oba tóny majú tie isté kľúče. @param {Voice} [voice] */
export function voiceTexts(voice = 'drzy') {
    return polite(voice) ? SLUSNY : DRZY;
}
