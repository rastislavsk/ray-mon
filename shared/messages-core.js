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

import { DEVICES, EVERYDAY, MINUTES_PER_DAY, MOZEM_ITEMS } from './config.js';
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
    offline: 'Nemám dáta, sme off-line',
    loading: 'Uno momento',
    bezpanelov: 'Nastav panely, voe!',
};

/** Slušný tón karty: veľké slovo vecne. */
const MOZEM_WORDS_SLUSNE = {
    go: 'Teraz je to ok',
    wait: 'Počkajte na slnko',
    slabo: 'Dnes bude slabý deň',
    none: 'DNES UŽ NIE',
    offline: 'Nemám dáta, sme off-line',
    loading: 'MOMENT',
    bezpanelov: 'Elektráreň zatiaľ nie je nastavená',
};

/**
 * Veci v karte Môžem?: meno, sloveso a zámeno do viet („Pusti ju o 10:30.“) a čo sa stane, keď
 * sa zamračí. Kľúče sú id z MOZEM_ITEMS v config.js. `run` začína vetu o dĺžke behu
 * (bez neho „Program má“).
 * @type {Record<string, { name: string, verb: string, pron: string, cloud: string, run?: string }>}
 */
export const MOZEM_ITEM_TEXTS = {
    pracka: { name: 'Práčka', verb: 'Pusti', pron: 'ju', cloud: 'Nevadí. Najviac berie na začiatku pri ohreve vody.' },
    umyvacka: { name: 'Umývačka', verb: 'Pusti', pron: 'ju', cloud: 'Nevadí. Najviac berie pri ohreve vody.' },
    susicka: { name: 'Sušička', verb: 'Pusti', pron: 'ju', cloud: 'Sušička berie prúd celý čas, zvyšok pôjde zo siete.' },
    auto: { name: 'Auto', verb: 'Zapoj', pron: 'ho', cloud: 'Nabíja sa ďalej, len zo siete.' },
    bojler: { name: 'Bojler', verb: 'Zapni', pron: 'ho', cloud: 'Vodu dohreje sieť.', run: 'Ohrev trvá asi' },
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
    bojler: { ...MOZEM_ITEM_TEXTS.bojler, verb: 'Zapnite' },
};

/** @type {typeof MOZEM_UNKNOWN} */
const MOZEM_UNKNOWN_SLUSNE = {
    ...MOZEM_UNKNOWN,
    text: 'Bez dát neviem, či svieti. Ak to potrebujete, zapnite to, nič sa nestane.',
};

/** @typedef {import('./mozem.js').DayCtx} DayCtx */
/** @typedef {import('./mozem.js').LaterDay} LaterDay */
/** @typedef {import('./mozem.js').Window} MozemWindow */
/** @typedef {(typeof import('./config.js').MOZEM_ITEMS)[number]} MozemItem */
/** Veci karty podľa id. */
const MOZEM_ITEMS_BY_ID = Object.fromEntries(MOZEM_ITEMS.map((i) => [i.id, i]));

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
 * Drzé sú tie isté, ktoré hovorí súčasná appka. Spotrebiče a časy do nich dopĺňa Plán dňa (PlanHero).
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
        nostrong: 'Na veľké veci už slnko nestačí.',
        onCheap: (/** @type {string} */ name, /** @type {string} */ time) => `${name} od ${time} na lacný prúd`,
        restWord: 'zvyšok',
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
        nostrong: 'Na veľké spotrebiče už slnko nestačí.',
        onCheap: (/** @type {string} */ name, /** @type {string} */ time) => `${name} od ${time} z lacnej siete`,
        restWord: 'ostatné',
    },
};
/** @typedef {(typeof HERO_SAY)['drzy']} HeroSay */

/**
 * Veta a fakt pod veľkým slovom. Bez `data` (načítava sa, dáta nie sú) len stála veta. Spotrebiče
 * a časy sú z Plánu dňa (`plan`, null bez spotrebičov doma - vtedy veta o slnku bez nich).
 * @param {import('./mozem.js').MozemState} state
 * @param {{ ctx: DayCtx, window: MozemWindow | null, nextDay: LaterDay | null, live: boolean, silentSince: string | null,
 *   measured: boolean, kwNow: number, todayKwh: number | null, tomorrowKwh: number | null, typicalKwp?: number | null,
 *   plan: PlanHero | null, sunLeft: boolean } | null} data
 *   `typicalKwp`: výkon typickej strechy, keď appka panely nepozná; `sunLeft`: slnko ešte svieti dosť
 *   (zelená teraz alebo neskôr), len na nič z plánu
 * @param {Voice} [voice]
 * @returns {{ lead: string, factK: string, factV: string }}
 */
export function mozemHeroText(state, data, voice = 'drzy') {
    const say = HERO_SAY[voice];
    if (state === 'loading') return { lead: 'Pozerám na oblohu.', factK: '', factV: '' };
    if (state === 'bezpanelov') return { lead: say.bezpanelov, factK: 'panely', factV: 'nezadané' };
    if (!data || state === 'offline') return { lead: say.offline, factK: 'dáta', factV: 'nedostupné' };
    if (state === 'go') return goHero(data, say);
    if (state === 'wait') return waitHero(data, say);
    return afterHero(state, data, say);
}

/**
 * Hlavička, keď slnko na niečo z plánu príde až neskôr: za koľko a čo (bez plánu len kedy).
 * @param {{ ctx: DayCtx, window: MozemWindow | null, plan: PlanHero | null }} data @param {HeroSay} say
 */
function waitHero({ ctx, window, plan }, say) {
    const next = plan?.next;
    const start = next ? next.start : window ? window.from : ctx.nowMin;
    const what = next ? `pôjde zo strechy ${next.name.toLowerCase()}` : 'to pôjde zo strechy';
    return {
        lead: `Za ${countdownText(start - ctx.nowMin)} ${what}.${ctx.draha ? say.pay : ''}`,
        factK: 'štart',
        factV: hm(start),
    };
}

/**
 * Čo hovorí Plán dňa hlavičke karty Môžem?: spotrebiče, ktoré idú teraz, najbližší ďalší na
 * slnku a prvý v lacnom pásme (mená ako v riadkoch plánu, časy v minútach dňa).
 * @typedef {{ now: string[], next: { name: string, start: number } | null, cheap: { name: string, start: number } | null }} PlanHero
 */

/**
 * Časť vety o pláne, keď svieti: „ Teraz práčka a umývačka, o 09:20 auto.“ Bez plánu prázdna.
 * @param {PlanHero | null} plan @param {HeroSay} say
 */
function planNowText(plan, say) {
    if (!plan || !plan.now.length) return '';
    const low = (/** @type {string} */ s) => s.toLowerCase();
    const then = plan.next
        ? `, o ${hm(plan.next.start)} ${low(plan.next.name)}`
        : plan.cheap
          ? `, ${low(say.onCheap(plan.cheap.name, hm(plan.cheap.start)))}`
          : '';
    return ` Teraz ${andList(plan.now.map(low))}${then}.`;
}

/**
 * Hlavička, keď dnes z plánu na slnku už nič nepríde: slabý deň, po zmene, alebo slnko ešte svieti,
 * ale na veľké veci nestačí (`sunLeft`).
 * @param {import('./mozem.js').MozemState} state
 * @param {{ ctx: DayCtx, nextDay: LaterDay | null, measured: boolean, todayKwh: number | null, tomorrowKwh: number | null,
 *   plan: PlanHero | null, sunLeft: boolean }} data
 *   `measured`: dnešok je z merania, nie z predpovede
 * @param {HeroSay} say vety v tóne
 */
function afterHero(state, { ctx, nextDay, measured, todayKwh, tomorrowKwh, plan, sunLeft }, say) {
    const soon = nextDay && nextDay.index === 1 ? 'zajtra' : 'keď vyjde slnko';
    const kwh = (/** @type {number | null} */ v) => (v === null ? '–' : `~${Math.round(v)} kWh`);
    if (state === 'slabo')
        return {
            lead: say.slabo(soon),
            factK: 'dnes len',
            factV: kwh(todayKwh) + (tomorrowKwh === null ? '' : ` · zajtra ${kwh(tomorrowKwh)}`),
        };
    // Slnko ešte svieti, len na nič z plánu nestačí - nie „skončilo“. Lacné pásmo povie plán aj s časom.
    const rest = plan?.cheap ? ` ${say.onCheap(plan.cheap.name, hm(plan.cheap.start))}, ${say.restWord} ${soon}.` : '';
    return {
        lead: sunLeft ? `${say.nostrong}${rest || say.rest(soon)}` : `${say.done}${ctx.cheap ? say.cheap(soon) : say.rest(soon)}`,
        factK: measured ? say.made : 'dnes podľa predpovede',
        factV: todayKwh === null ? '–' : `${fmt1(todayKwh)} kWh`,
    };
}

/** Fakt v hlavičke karty Môžem?, keď svieti a živé meranie nie je (goHero). */
export const NO_LIVE_FACT = 'bez merania';

/** Koľko mobilov nabije strecha za hodinu pri danom výkone, zaokrúhlené na desiatky. @param {number} kw */
export function phonesPerHour(kw) {
    return Math.round(kw / EVERYDAY.phoneChargeKwh / 10) * 10;
}

/**
 * Fakt v hlavičke karty Môžem?, keď svieti a meranie mlčí - povie odkedy, ako pás pod číslom
 * karty Teraz (terazNoteText). @param {string} since čas posledného merania
 */
export const silentFact = (since) => `meranie neodpovedá od ${since}`;

/**
 * Hlavička, keď svieti: čo z plánu ide teraz a čo potom, s čerstvým meraním nabitia mobilu, bez
 * neho priznaný odhad - pri typickej streche s čím appka počíta, a keď meranie mlčí, odkedy.
 * @param {{ live: boolean, silentSince: string | null, kwNow: number, typicalKwp?: number | null, plan: PlanHero | null }} data
 * @param {HeroSay} say vety v tóne
 */
function goHero({ live, silentSince, kwNow, typicalKwp = null, plan }, say) {
    const lead = `${live ? say.live : 'Podľa predpovede teraz svieti.'}${planNowText(plan, say)}`;
    if (!live && typicalKwp !== null) return { lead, factK: 'typická strecha', factV: kwpRoughText(typicalKwp) };
    const phones = phonesPerHour(kwNow);
    return {
        lead,
        factK: live ? 'strecha za hodinu nabije' : silentSince ? silentFact(silentSince) : NO_LIVE_FACT,
        factV: live ? `~${phones} mobilov` : 'odhad z predpovede',
    };
}

/**
 * Veta o dnešnom slnku v paneli skupiny vecí.
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
 * „čo keď mrak“ alebo „musíš hneď“ s cenou, keď ju tarifa pozná. `more` je to posledné ako otázka
 * a odpoveď pod vlastným nadpisom (panel veci); bez vysvetlenia je null.
 * @param {MozemItem} item @param {import('./mozem.js').Answer} a
 * @param {{ ctx: DayCtx, cost: number | null } | null} env
 * @param {Voice} [voice]
 * @returns {{ name: string, tone: 'go' | 'wait' | 'cheap' | 'no' | 'unk', short: string, head: string, text: string,
 *   more: { q: string, a: string } | null }}
 */
export function mozemItemText(item, a, env, voice = 'drzy') {
    const T = voiceTexts(voice);
    const t = T.MOZEM_ITEM_TEXTS[item.id];
    const base = { name: t.name, more: null };
    if (a.kind === 'unk' || !env) return { ...base, tone: 'unk', ...T.MOZEM_UNKNOWN };
    // Cenu má len auto: pri práčke či umývačke sú to centy, ktoré človeka nepresvedčia.
    const cost = item.runMin === null && env.cost !== null ? `Hodina nabíjania ~${money(env.cost, env.ctx.currency)}.` : '';
    if (a.kind === 'go') {
        const cloud = `${t.cloud}${cost ? ` ${cost}` : ''}`;
        return {
            ...base,
            tone: 'go',
            ...goItem(t, a, item, env),
            more: { q: 'A keď sa zamračí?', a: cloud },
        };
    }
    const now = cost || 'Pôjde to zo siete.';
    if (a.kind === 'wait') return { ...base, ...waitItem(t, a.start, item, env.ctx.draha), ...ask(ITEM_SAY[voice].now, now) };
    if (a.kind === 'cheap') return { ...base, ...cheapItem(t, a.next) };
    return { ...base, ...laterItem(a, notTodayText(item), voice), ...ask('Nepočká to?', now) };
}

/** Slnko dnes nie, ale sieť je lacná. @param {{ verb: string, pron: string }} t @param {LaterDay | null} next */
function cheapItem(t, next) {
    const sun = next ? `${laterWhen(next)} by to išlo zo strechy.` : '';
    return {
        tone: /** @type {const} */ ('cheap'),
        short: 'lacno',
        head: `${t.verb} ${t.pron}, prúd je lacný.`,
        text: 'Slnko to dnes už neutiahne, ale sieť je teraz lacná.',
        more: sun ? { q: 'A zo slnka?', a: sun } : null,
    };
}

/** Vysvetlenie ako otázka s odpoveďou. @param {string} q @param {string} a */
const ask = (q, a) => ({ more: { q, a } });

/** Slnko príde ešte dnes. @param {{ verb: string, pron: string }} t @param {number} start @param {MozemItem} item @param {boolean} draha */
function waitItem(t, start, item, draha) {
    const at = hm(start);
    const base = { tone: /** @type {const} */ ('wait'), short: `o ${at}`, head: `${t.verb} ${t.pron} o ${at}.` };
    if (item.runMin === null) return { ...base, text: `Na auto treba silné slnko a to bude o ${at}.` };
    const p = profileOf(item);
    const d = draha ? ' a tá je práve drahá' : '';
    const why = {
        start: `Ohrev vody na začiatku by teraz išiel zo siete${d}. O ${at} ho utiahne strecha.`,
        twice: `Prvý ohrev vody by teraz išiel zo siete${d}. Od ${at} chytia slnko oba.`,
        whole: `Celý čas berie ${p.kw} kW a teraz by to išlo zo siete${d}. O ${at} to utiahne strecha.`,
    };
    return { ...base, text: why[p.shape] };
}

/**
 * Profil odberu veci pre vety (`heat` z MOZEM_ITEMS): ohrev len na začiatku (`start`), dva ohrevy
 * (`twice`), alebo plný príkon celý program (`whole`). `kw` je príkon spotrebiča slovami.
 * @param {MozemItem} item
 */
function profileOf(item) {
    const heat = item.heat ?? [[0, item.runMin ?? 0]];
    const kw = DEVICES.find((d) => d.name === item.device)?.powerKw ?? 0;
    /** @type {'start' | 'twice' | 'whole'} */
    const shape = heat.length > 1 ? 'twice' : heat[0][1] < (item.runMin ?? 0) ? 'start' : 'whole';
    return { heat, shape, kw: Number.isInteger(kw) ? String(kw) : fmt1(kw), run: durationText(item.runMin ?? 0) };
}

/** Koľko pokryje strecha, keď vec pustíš teraz a slnko ju celú neutiahne: „Zo slnka asi 70 %, zvyšok zo siete.“ @param {number} share */
function shareText(share) {
    if (share >= 0.95) return 'Skoro všetko pôjde zo strechy.';
    return `Zo slnka asi ${Math.round(share * 10) * 10} %, zvyšok zo siete.`;
}

/** Rozbalenie, keď svieti. @param {{ verb: string, pron: string, run?: string }} t
 * @param {{ end: number, until: number, km: number | null, share: number | null }} a @param {MozemItem} item
 * @param {{ ctx: DayCtx, cost: number | null }} env */
function goItem(t, a, item, env) {
    if (item.runMin === null)
        return {
            short: `do ${hm(a.end)}`,
            head: `${t.verb} ${t.pron}.`,
            text: a.km ? `Do ${hm(a.end)} chytí zo slnka asi ${a.km} km.` : 'Slnko ho aspoň trochu nabije.',
        };
    const p = profileOf(item);
    const run = `${t.run ?? 'Program má'} ${p.run}`;
    if (a.until >= env.ctx.nowMin) {
        const until = hm(a.until);
        const why = {
            start: () => `Najviac berie prvých ${p.heat[0][1]} minút pri ohreve vody. Ten utiahne strecha, aj keď začne až o ${until}.`,
            twice: () =>
                `Vodu ohrieva dvakrát: na začiatku a pri oplachu o ${durationText(p.heat[1][0])}. Pri štarte najneskôr o ${until} chytia slnko oba ohrevy.`,
            whole: () =>
                `${run} a celý čas berie ${p.kw} kW. Pri štarte najneskôr o ${until} dobehne ${t.pron === 'ju' ? 'celá' : 'celý'} na slnku.`,
        };
        // „Do“ je v appke len koniec (nabíjanie auta, slnko); pri spotrebiči je to posledný štart.
        return { short: `najneskôr ${until}`, head: `${t.verb} ${t.pron} najneskôr o ${until}.`, text: why[p.shape]() };
    }
    const why = {
        start: () => `Ohrev na začiatku chytí slnko ${(a.share ?? 1) >= 0.95 ? 'ešte celý' : 'len sčasti'}, zvyšok programu berie málo.`,
        twice: () => `Prvý ohrev ešte chytí slnko, oplach o ${hm((env.ctx.nowMin + p.heat[1][0]) % MINUTES_PER_DAY)} už nie.`,
        whole: () => `${run}, ale slnko vydrží len do ${hm(a.end)}.`,
    };
    return { short: 'teraz', head: `${t.verb} ${t.pron} hneď.`, text: `${why[p.shape]()} ${shareText(a.share ?? 1)}` };
}

/** Vety veci, ktoré sa v tónoch líšia. */
const ITEM_SAY = {
    drzy: { now: 'Musíš hneď?', wait: ' Kým nebude poriadne slnko, radšej počkaj.' },
    slusny: { now: 'Potrebujete to hneď?', wait: ' Kým nebude poriadne slnko, radšej počkajte.' },
};

/** Prečo nie dnes, keď to slnko už neutiahne: čo by išlo zo siete. Auto len povie, že dnes nie. @param {MozemItem} item */
function notTodayText(item) {
    if (item.runMin === null) return 'Dnes to už slnko neutiahne.';
    const p = profileOf(item);
    const why = {
        start: 'Dnes by to išlo zo siete a väčšinu by zjedol ohrev vody.',
        twice: 'Dnes by ohrevy vody išli zo siete.',
        whole: `Celý čas berie ${p.kw} kW a dnes by to celé išlo zo siete.`,
    };
    return why[p.shape];
}

/** Iný deň, alebo tento týždeň vôbec. @param {import('./mozem.js').Answer} a @param {string} notToday @param {Voice} voice */
function laterItem(a, notToday, voice) {
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
        text: `${notToday}${a.weakSkipped ? ITEM_SAY[voice].wait : ''}`,
    };
}

// ---- Plán dňa (shared/plan-dna.js) ----------------------------------------------------
// Riadok: čas, spotrebič a prečo. Pri bežných spotrebičoch bez ceny v €, cenu má len auto.

/** Nadpis, štítok riadku, ktorý je na rade, a pätka bloku Plán dňa. */
export const PLAN_DNA_TITLE = 'Plán dňa';
export const PLAN_DNA_NOW = 'teraz';
export const PLAN_DNA_NOTE = 'Naraz len toľko, koľko strecha utiahne.';
/** Tlačidlo, ktoré zbalí rozbalený Plán dňa späť na prvý riadok. */
export const PLAN_DNA_LESS = 'Skryť plán';
/** Tlačidlo zbaleného Plánu dňa: koľko riadkov je pod prvým. @param {number} n */
export const planDnaMoreText = (n) => `Celý plán · ešte ${n}`;

/** „po práčke“ - na koho vec v pláne čaká (PLAN_DNA.after). */
const PLAN_AFTER = /** @type {Record<string, string>} */ ({ pracka: 'po práčke' });

/**
 * Texty riadku plánu dňa.
 * @param {import('./plan-dna.js').PlanRow} row @param {Voice} [voice]
 * @returns {{ name: string, time: string, why: string, tone: 'go' | 'cheap' | 'wait' | 'no' }}
 */
export function planDnaRowText(row, voice = 'drzy') {
    const t = voiceTexts(voice).MOZEM_ITEM_TEXTS[row.id];
    const name = t.name;
    if (row.kind === 'cheap') return { name, time: `od ${hm(row.start)}`, why: 'v lacnom pásme', tone: 'cheap' };
    if (row.kind === 'none') return { name, time: 'tento týždeň nie', why: 'slnko podľa predpovede nestačí', tone: 'no' };
    if (row.kind === 'later') return { name, ...laterRowText(row) };
    const item = /** @type {MozemItem} */ (MOZEM_ITEMS_BY_ID[row.id]);
    if (item.runMin === null) return { name, time: `${hm(row.start)}–${hm(row.end)}`, why: autoSunWhy(row, voice), tone: 'go' };
    const p = profileOf(item);
    const why = { start: 'ohrev chytí slnko', twice: 'oba ohrevy chytia slnko', whole: `${t.pron === 'ju' ? 'celá' : 'celý'} zo strechy` }[
        p.shape
    ];
    const after = row.after ? `${PLAN_AFTER[row.after] ?? ''}, ` : '';
    return { name, time: hm(row.start), why: `${after}${why}`, tone: 'go' };
}

/**
 * Riadok plánu na iný deň: zajtra s časom, neskôr len deň. Sušička povie, že ide po práčke.
 * @param {Extract<import('./plan-dna.js').PlanRow, { kind: 'later' }>} row
 * @returns {{ time: string, why: string, tone: 'wait' | 'no' }}
 */
function laterRowText({ day, after }) {
    const soon = day.index === 1;
    return {
        time: soon ? `zajtra ${hm(day.start)}` : day.name.toLowerCase(),
        why: after ? (PLAN_AFTER[after] ?? '') : 'dnes slnko nestačí',
        tone: soon ? 'wait' : 'no',
    };
}

/**
 * Prečo auto na slnku: km zo slnka a koľko by tá energia stála zo siete. Úspora na celé eurá -
 * centy by pri aute zbytočne tvrdili presnosť.
 * @param {{ km: number | null, save: number | null, currency: string }} row @param {Voice} voice
 */
function autoSunWhy({ km, save, currency }, voice) {
    const sun = km ? `~${km} km zo slnka` : 'aspoň trochu zo slnka';
    if (!save) return sun;
    const sum = save >= 1 ? `${Math.round(save)} ${currency}` : money(save, currency);
    return `${sun}, ${polite(voice) ? 'ušetríte' : 'ušetríš'} ~${sum}`;
}

// ---- Ranné oznámenie (shared/oznamenia.js) -------------------------------------------
// Jedno oznámenie ráno: nadpis o dni a v texte poradie spotrebičov. Text do ~200 znakov, zamknutá
// obrazovka ukáže 2–4 riadky. Pri bežných spotrebičoch bez ceny, pri aute km a úspora.

/** „v stredu“, „vo štvrtok“ - deň v pláne ako časť vety. */
const ON_DAY = /** @type {Record<string, string>} */ ({
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
const onDay = (name) => ON_DAY[name] ?? name.toLowerCase();
/** „práčka, sušička a umývačka“ @param {string[]} list */
const andList = (list) => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} a ${list[list.length - 1]}`);
/** @param {string} s */
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Vety oznámení, ktoré sa v tónoch líšia. */
const NOTICE_SAY = {
    drzy: {
        nabi: 'nabi',
        pusti: 'Pusti ich, keď treba, najlepšie v lacnom pásme.',
        remind: 'Pripomeň o',
        fail: 'Nepodarilo sa mi ho vypočítať. Pozri appku.',
    },
    slusny: {
        nabi: 'nabite',
        pusti: 'Pustite ich, keď treba, najlepšie v lacnom pásme.',
        remind: 'Pripomenúť o',
        fail: 'Nepodarilo sa ho vypočítať. Pozrite appku.',
    },
};

/**
 * Nadpis a text ranného oznámenia z plánu dňa: na slnku v poradí podľa času, auto s km,
 * čo počká na iný deň, čo pôjde v lacnom pásme.
 * @param {{ rows: import('./plan-dna.js').PlanRow[], sunEnd: number | null, weak: boolean }} d @param {Voice} [voice]
 */
export function planNoticeText({ rows, sunEnd, weak }, voice = 'drzy') {
    const T = voiceTexts(voice).MOZEM_ITEM_TEXTS;
    const low = (/** @type {string} */ id) => T[id].name.toLowerCase();
    const none = rows.length > 0 && rows.every((r) => r.kind === 'none');
    const parts = [...sunParts(rows, low, voice), ...elsewhereParts(rows, low, voice)];
    if (none) parts.push(NOTICE_SAY[voice].pusti);
    return {
        title: noticeTitle(
            rows.some((r) => r.kind === 'sun'),
            sunEnd,
            weak,
            none,
        ),
        body: parts.join(' '),
    };
}

/**
 * Čo pôjde zo slnka: spotrebiče v poradí podľa času a auto s km.
 * @param {import('./plan-dna.js').PlanRow[]} rows @param {(id: string) => string} low @param {Voice} voice
 */
function sunParts(rows, low, voice) {
    /** @type {string[]} */ const parts = [];
    const plain = rows.flatMap((r) => (r.kind === 'sun' && r.id !== 'auto' ? [r] : [])).sort((a, b) => a.start - b.start);
    if (plain.length) parts.push(`${cap(plain.map((r) => `${low(r.id)} ${hm(r.start)}`).join(' · '))}.`);
    const auto = rows.find((r) => r.id === 'auto');
    if (auto?.kind === 'sun') parts.push(`Auto ${hm(auto.start)}–${hm(auto.end)}: ${autoSunWhy(auto, voice)}.`);
    return parts;
}

/**
 * Čo počká na iný deň a čo pôjde v lacnom pásme.
 * @param {import('./plan-dna.js').PlanRow[]} rows @param {(id: string) => string} low @param {Voice} voice
 */
function elsewhereParts(rows, low, voice) {
    /** @type {string[]} */ const parts = [];
    /** @type {Map<string, string[]>} */ const later = new Map();
    for (const r of rows) if (r.kind === 'later') later.set(r.day.name, [...(later.get(r.day.name) ?? []), low(r.id)]);
    for (const [day, list] of later) parts.push(`${cap(andList(list))} radšej ${onDay(day)}.`);
    const cheap = rows.flatMap((r) => (r.kind === 'cheap' && r.id !== 'auto' ? [r] : []));
    if (cheap.length)
        parts.push(`${cap(andList(cheap.map((r) => low(r.id))))} v lacnom pásme od ${hm(Math.min(...cheap.map((r) => r.start)))}.`);
    const auto = rows.find((r) => r.id === 'auto');
    if (auto?.kind === 'cheap') parts.push(`Auto ${NOTICE_SAY[voice].nabi} v lacnom pásme od ${hm(auto.start)}.`);
    return parts;
}

/** Nadpis oznámenia o dni. @param {boolean} sun @param {number | null} sunEnd @param {boolean} weak @param {boolean} none */
function noticeTitle(sun, sunEnd, weak, none) {
    if (sun && sunEnd !== null) return sunEnd <= 12 * 60 ? 'Dnes slnko len dopoludnia' : `Dnes slnko do ${hm(sunEnd)}`;
    if (none) return 'Tento týždeň slnko nestačí';
    return weak ? 'Dnes zamračené celý deň' : 'Dnes slnko na spotrebiče nestačí';
}

/**
 * Pripomienka spotrebiča z prepočítaného plánu: „teraz“, keď je na rade, inak čo sa zmenilo.
 * @param {import('./plan-dna.js').PlanRow} row @param {number} nowMin @param {Voice} [voice]
 */
export function reminderText(row, nowMin, voice = 'drzy') {
    const name = voiceTexts(voice).MOZEM_ITEM_TEXTS[row.id].name;
    if (row.kind === 'sun' && row.start <= nowMin + 15)
        return { title: `${name} · teraz`, body: `${cap(planDnaRowText(row, voice).why)}. Dobehne o ${hm(row.end)}.` };
    if (row.kind === 'sun') return { title: `${name} až o ${hm(row.start)}`, body: 'Slnko sa posunulo, skôr by to išlo zo siete.' };
    if (row.kind === 'later') return { title: `${name} radšej ${onDay(row.day.name)}`, body: 'Zatiahlo sa a dnes by to išlo zo siete.' };
    if (row.kind === 'cheap') return { title: `${name} v lacnom pásme`, body: `Slnko dnes nestačí, od ${hm(row.start)} je lacný prúd.` };
    return { title: `${name} dnes nie`, body: 'Slnko podľa predpovede tento týždeň nestačí.' };
}

/**
 * Pevné texty oznámení: tlačidlá v oznámení, oznámenie, keď sa plán nedal vypočítať, a sekcia
 * Oznámenia v Nastavení oboch appiek (stavy povolenia v `stav`).
 * @param {Voice} [voice]
 */
export function oznameniaTexts(voice = 'drzy') {
    const p = polite(voice);
    const say = NOTICE_SAY[voice];
    return {
        remind: (/** @type {number} */ at) => `${say.remind} ${hm(at)}`,
        open: 'Otvoriť plán',
        remindFail: {
            title: 'Pripomienka sa neobjednala',
            body: p ? 'Pozrite plán dňa v appke.' : 'Pozri plán dňa v appke.',
        },
        fail: { title: 'Plán na dnes', body: say.fail },
        title: 'Oznámenia',
        hint: 'Ráno plán dňa: kedy pustiť ktorý spotrebič',
        switchLabel: p ? 'Ráno poslať plán dňa' : 'Ráno mi poslať plán dňa',
        switchSky: 'Ranný plán dňa',
        switchSkySmall: 'jedno oznámenie denne, čo kedy pustiť',
        lead: 'Jedno oznámenie denne: v akom poradí a kedy pustiť spotrebiče, aby išli zo slnka – alebo že to dnes radšej počká.',
        when: 'Kedy',
        whenSmall: 'ráno o',
        devices: p ? 'Čo máte doma' : 'Čo máš doma',
        devicesSmall: 'plán ráta len s tým',
        privacy: 'Server appky si pamätá len adresu, kam tento telefón ráno zobudiť, a čas. Polohu ani prístup k meniču nevidí.',
        stav: {
            ok: '',
            caka: 'Zapínam…',
            plocha: 'Na iPhone pošle appka oznámenia, len keď je pridaná na plochu: Zdieľať → Pridať na plochu.',
            zakazane: p
                ? 'Oznámenia máte v telefóne vypnuté. Zapnite ich v nastaveniach prehliadača pre túto stránku.'
                : 'Oznámenia máš v telefóne vypnuté. Zapni ich v nastaveniach prehliadača pre túto stránku.',
            nepodporuje: 'Tento prehliadač oznámenia neposiela.',
            bezElektrarne: p
                ? 'Najprv zadajte polohu a panely, inak nemám z čoho rátať.'
                : 'Najprv zadaj polohu a panely, inak nemám z čoho rátať.',
            chyba: p ? 'Oznámenia sa nepodarilo nastaviť. Skúste znova.' : 'Oznámenia sa nepodarilo nastaviť. Skús znova.',
        },
    };
}

// ---- Karta Môžem?: dlaždice, panel veci a výzvy ------------------------------------
// Odpovede, časy a vety sú tie isté ako vyššie. Dlaždice skupín a panel veci majú obe appky,
// štítky nad slovom a výzvy len nová appka (obloha/) - výzvu z typickej strechy ukazuje aj
// súčasná v páse pod hlavičkou. Veľké písmená robí štýl, texty sú v bežnom tvare - čítačka
// ich tak nehláskuje.

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

/** Pevné texty karty: nadpisy a zatvorenie panelu veci (obe appky), tlačidlá a výzvy. Meno `SKY` ostalo z čias, keď ich mala len nová appka. */
export const MOZEM_SKY_TEXTS = {
    retry: 'Skúsiť znova',
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

/** Nadpis dlaždíc vecí; pri typickej streche priznáva odhad. @param {boolean} estimate */
export const mozemListTitle = (estimate) => `Čo môžem${estimate ? ' · odhad' : ''}`;

/** Mená skupín vecí (dlaždíc) - kľúče sú id z MOZEM_GROUPS v config.js. */
export const MOZEM_GROUP_NAMES = {
    velke: 'Veľké spotrebiče',
    auto: 'Auto',
    bojler: 'Bojler',
};

/**
 * Krátka odpoveď dlaždice: keď svieti, koniec slnka - ten je pre všetky veci skupiny rovnaký,
 * dokedy pustiť ktorý program, povie panel. Inak krátka odpoveď veci.
 * @param {import('./mozem.js').Answer} a @param {string} short krátka odpoveď veci
 */
export function mozemTileValue(a, short) {
    if (a.kind === 'go') return `do ${hm(a.end)}`;
    return short;
}

/**
 * Riadok pod odpoveďou dlaždice s jednou vecou: odkiaľ pôjde prúd, pri aute koľko km chytí.
 * @param {import('./mozem.js').Answer} a
 */
export function mozemTileNote(a) {
    if (a.kind === 'go') return a.km ? `asi ${a.km} km zo slnka` : 'zo slnka';
    if (a.kind === 'cheap') return 'lacná sieť';
    return '';
}

/**
 * Dlaždica podľa riadku Plánu dňa: veľká odpoveď (`value`), krátka do zoznamu (`short`), farba
 * a riadok pod ňou. Na slnku teraz „teraz“ (auto do konca svojho úseku), neskôr „o 10:45“,
 * inak čas riadku plánu.
 * @param {{ id: string, kind: string, start?: number, end?: number, km?: number | null, now: boolean, time: string,
 *   tone: TileTone }} row
 * @returns {{ value: string, short: string, tone: TileTone, note: string }}
 */
export function planTileText(row) {
    const sunNote = row.km ? `asi ${row.km} km zo slnka` : 'zo slnka';
    if (row.kind === 'sun' && row.now) {
        const value = row.id === 'auto' && row.end !== undefined ? `do ${hm(row.end)}` : 'teraz';
        return { value, short: 'teraz', tone: 'go', note: sunNote };
    }
    if (row.kind === 'sun') {
        const at = `o ${hm(row.start ?? 0)}`;
        return { value: at, short: at, tone: 'wait', note: sunNote };
    }
    if (row.kind === 'cheap') return { value: row.time, short: row.time, tone: 'cheap', note: 'lacná sieť' };
    return { value: row.time, short: row.time, tone: row.tone, note: '' };
}

/**
 * Veta nad Plánom dňa na karte Teraz(ky): čo ide teraz, inak čo príde najskôr, a pod ňou ďalšie
 * dve veci s časom - tie isté časy ako dlaždice (planTileText). Bez riadkov null.
 * @param {Array<{ name: string, now: boolean, value: string }>} rows riadky plánu podľa času
 */
export function planDnaHeadText(rows) {
    if (!rows.length) return null;
    const low = (/** @type {string} */ s) => s.toLowerCase();
    const now = rows.filter((r) => r.now);
    const rest = rows.filter((r) => !r.now);
    const lead = now.length ? `Teraz ${andList(now.map((r) => low(r.name)))}` : rest.length ? `${rest[0].name} ${rest[0].value}` : '';
    const then = (now.length ? rest : rest.slice(1)).slice(0, 2).map((r) => `${low(r.name)} ${r.value}`);
    return { lead, then: cap(then.join(' · ')) };
}

/** Úspora CO2eq: do 10 kg s desatinou („~2,4 kg“), do tony celé („~38 kg“), potom v tonách („~1,3 t“). @param {number} kg */
export function posterCo2Value(kg) {
    if (kg >= 1000) return `~${fmt1(kg / 1000)} t`;
    return `~${kg < 10 ? fmt1(kg) : fmtSum(Math.round(kg), 0)} kg`;
}

/**
 * Čo dá strecha za celý deň v jednotkách, ktoré pozná každý - hlavička karty Dnes. Mobily a km
 * zaokrúhlené na desiatky, je to odhad z predpovede (k večeru blízko nameranému).
 * @param {{ kwh: number, phones: number, km: number, co2Kg: number }} d
 */
export function dnesDayText({ kwh, phones, km, co2Kg }) {
    const tens = (/** @type {number} */ n) => fmtSum(Math.round(n / 10) * 10, 0);
    return {
        lead: `Dnes zo strechy asi ${fmtSum(Math.round(kwh), 0)} kWh. To je:`,
        eq: [
            { value: `~${tens(phones)}`, label: 'nabitých mobilov' },
            { value: `~${tens(km)} km`, label: 'elektrickým autom' },
            { value: posterCo2Value(co2Kg), label: 'CO2eq menej' },
        ],
    };
}

/** Farba odpovede v dlaždici a zozname vecí. @typedef {'go' | 'wait' | 'cheap' | 'no' | 'unk'} TileTone */

/**
 * Riadok pod dlaždicou skupiny: všetky jej spotrebiče s časom z plánu, rovnaké časy spolu -
 * „Práčka a umývačka teraz · Sušička o 11:00“.
 * @param {Array<{ name: string, short: string }>} rows v poradí plánu
 */
export function planGroupNote(rows) {
    /** @type {Map<string, string[]>} */ const byShort = new Map();
    for (const r of rows) byShort.set(r.short, [...(byShort.get(r.short) ?? []), r.name]);
    return [...byShort].map(([short, names]) => `${cap(andList(names.map((n) => n.toLowerCase())))} ${short}`).join(' · ');
}

/**
 * Veta namiesto odpovede, keď appka nemá predpoveď: prečo. Bez internetu nemá nič; s ním
 * neprišla predpoveď a pri vlastnom meraní aj to, či a odkedy mlčí meranie.
 * @param {{ online: boolean, zdroj: boolean, pvOk: boolean, pvSince: string | null }} why `pvOk`: meranie
 *   ide, `pvSince`: čas posledného merania, keď je staré (null = meranie vôbec neprišlo)
 * @param {Voice} [voice]
 */
export function mozemOfflineText({ online, zdroj, pvOk, pvSince }, voice = 'drzy') {
    const p = polite(voice);
    if (!online)
        return p
            ? 'Nie je internet, takže nemám predpoveď ani meranie. Pripojte sa a skúste to znova.'
            : 'Nie je internet, takže nemám predpoveď ani meranie. Pripoj sa a skús to znova.';
    const pv = !zdroj || pvOk ? '' : pvSince ? ` Meranie zo strechy neodpovedá od ${pvSince}.` : ' Ani meranie zo strechy neodpovedá.';
    return `Predpoveď počasia neprišla, bez nej neviem, kedy bude slnko.${pv} ${p ? 'Skúste' : 'Skús'} to o chvíľu znova.`;
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

/** Legenda čiar a riadkov grafu dňa (nápis hranice je TERAZ_TEXTS.limit). */
export const DAY_CHART_KEYS = { power: 'výkon', forecast: 'predpoveď', cloud: 'oblačnosť' };

/** Pevné texty karty: popisky, tlačidlá a výzvy. */
export const TERAZ_TEXTS = {
    title: 'Teraz',
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
    guessText: 'Zadaj panely a tu uvidíš svoj výkon. S pripojeným meničom aj naozaj nameraný.',
    guessBtn: 'Zadaj panely',
    askTitle: 'Kde máš strechu?',
    askText: 'Bez polohy neviem, kedy u teba svieti. Zadaj ju v Nastavení a ukážem ti výkon aj plán dňa.',
    askBtn: 'Zadaj polohu',
    noteTitle: 'Odhad z predpovede, nie tvoja strecha',
    noteText: 'Appka nemá údaje z tvojho meniča. Číslo počíta z počasia.',
    noteBtn: 'Pripojiť meranie',
    noteAgainBtn: 'Pripojiť znova',
};

/** @type {typeof TERAZ_TEXTS} */
const TERAZ_TEXTS_SLUSNE = {
    ...TERAZ_TEXTS,
    hint: 'Ťahajte prstom po grafe a pozrite si iný čas.',
    slider: 'Graf dňa, šípkami si pozriete iný čas',
    strip: 'Odporúčania, posúvajte do strán',
    guessTitle: 'Koľko dáva vaša strecha?',
    guessText: 'Zadajte panely a uvidíte tu svoj výkon. S pripojeným meničom aj naozaj nameraný.',
    guessBtn: 'Zadajte panely',
    askTitle: 'Kde máte strechu?',
    askText: 'Bez polohy neviem, kedy u vás svieti. Zadajte ju v Nastavení a ukážem vám výkon aj plán dňa.',
    askBtn: 'Zadajte polohu',
    noteTitle: 'Odhad z predpovede, nie vaša strecha',
    noteText: 'Appka nemá údaje z vášho meniča. Číslo počíta z počasia.',
};

/** Koniec úseku dňa: polnoc na konci dňa je „24:00“, nie „00:00“. @param {number} min */
export const endHm = (min) => (min >= MINUTES_PER_DAY ? '24:00' : hm(min));

/** Úsek dňa „09:15 – 16:45“. @param {{ from: number, to: number }} w */
export const spanText = (w) => `${hm(w.from)} – ${endHm(w.to)}`;

/** Slová pásu spotrebičov pod grafom detailu dňa (úrovne fitLevel z day-plan.js). Zelené („Zapni veľké“)
 * nesie aj okno pod grafom dňa na karte Teraz, preto sú tu a nie v messages-sedem.js. */
export const FIT_WORDS = { go: 'Zapni veľké', part: 'čiastočne', grid: 'zo siete' };

/** @type {typeof FIT_WORDS} */
const FIT_WORDS_SLUSNE = { ...FIT_WORDS, go: 'Zapnite veľké' };

/** Približná šírka znaku popisu pásu (11,5 px Space Grotesk) - na odhad, či sa popis zmestí. */
const FIT_CHAR_PX = 6.4;

/**
 * Popis úseku pásu spotrebičov: pri zelenom aj s časom („Zapni veľké · 11–16“, „8:30–17:30“), keď sa
 * zmestí, inak len slovo, a keď ani to, nič - úsek potom nesie farba, legenda a tooltip.
 * @param {{ from: number, to: number, level: import('./day-plan.js').FitLevel }} seg @param {number} widthPx
 * @param {Voice} [voice]
 */
export function fitLabel(seg, widthPx, voice = 'drzy') {
    const fits = (/** @type {string} */ t) => t.length * FIT_CHAR_PX + 8 <= widthPx;
    const short = (/** @type {number} */ min) =>
        min % 60 ? `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}` : String(min / 60);
    const word = (polite(voice) ? FIT_WORDS_SLUSNE : FIT_WORDS)[seg.level];
    const full = `${word} · ${short(seg.from)}–${short(seg.to)}`;
    if (seg.level === 'go' && fits(full)) return full;
    return fits(word) ? word : '';
}

/**
 * Riadok pod číslom: odkiaľ výkon je. Živé meranie, namerané (krivka dneška), alebo odhad
 * z predpovede. Keď appka teraz meranie nemá, povie to pás pod číslom (terazNoteText) a tento
 * riadok sa pri odhade nepíše. @param {'live' | 'measured' | 'forecast' | null} source
 */
export function terazSourceText(source) {
    if (source === 'live') return 'živé meranie';
    if (source === 'measured') return 'namerané';
    return 'odhad z predpovede';
}

/**
 * Veta v páse „Odhad z predpovede“, keď meranie mlčí alebo výrobca prístup odmietol: čo sa stalo
 * a že číslo je z počasia. Bez merania vôbec je to pevný text `noteText`.
 * @param {{ since: string | null, riadok: string }} p `since`: čas posledného merania (null, keď
 *   neprišlo vôbec), `riadok`: prečo prístup neplatí (shared/pristup.js), inak prázdny
 * @param {Voice} [voice]
 */
export function terazNoteText({ since, riadok }, voice = 'drzy') {
    if (riadok) return `${riadok}. Kým meranie ${polite(voice) ? 'nepripojíte' : 'nepripojíš'} znova, číslo počíta z počasia.`;
    return `${since ? `Meranie neodpovedá od ${since}` : 'Meranie neodpovedá'}. Kým sa neozve, číslo počíta z počasia.`;
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

/**
 * Nadpis karty počas náhľadu: číslo pod ním je výkon v tom čase, nie teraz. Spolu s ním sa číta
 * ako veta („O 15:30 · 4,89 kW“). @param {number} min
 */
export function terazPreviewTitle(min) {
    return `O ${hm(min)}`;
}

/**
 * Popisok čiary náhľadu v grafe: len čas. Výkon ukazuje veľké číslo nad grafom a čo vtedy platí
 * farba pásu plánu pod krivkou - v grafe by sa opakovali. @param {number} min
 */
export function terazPreviewTime(min) {
    return hm(min);
}

// Zoznam pod grafom dňa (docs/navrhy/teraz-rozbalovaci-zoznam.html, B): hodnoty v čase, na ktorom
// je bod grafu - teraz, alebo náhľad pod prstom.

/** Riadok nad hodnotami: ku ktorému času patria. @param {number} min @param {boolean} preview */
export function terazReadoutWhen(min, preview) {
    return `${preview ? 'O' : 'Teraz'} ${hm(min)}`;
}

/** Výkon v zozname, s desatinnou čiarkou ako zvyšok appky. Bez údaja pomlčka. @param {number} kw */
export function terazKwText(kw) {
    return Number.isFinite(kw) ? `${fmt2(kw)} kW` : '–';
}

/** Oblačnosť v percentách, bez údaja pomlčka. @param {number | null} pct */
export function terazCloudText(pct) {
    return pct === null ? '–' : `${Math.round(pct)} %`;
}

/** Odkiaľ začína hranica veľkých spotrebičov. @param {number} kw */
export function terazLimitFrom(kw) {
    return `od ${fmt1(kw)} kW`;
}

/** Koľko výkonu chýba do hranice veľkých spotrebičov, alebo koľko je ho navyše. @param {number} kw @param {number} limitKw */
export function terazLimitGap(kw, limitKw) {
    if (!Number.isFinite(kw)) return '–';
    return kw < limitKw ? `chýba ${fmt2(limitKw - kw)} kW` : `navyše ${fmt2(kw - limitKw)} kW`;
}

/** Čo platí v páse plánu a dokedy. @param {import('./day-chart.js').Tone} tone @param {number} to */
export function terazBandText(tone, to) {
    return `${TERAZ_TONES[tone]} do ${endHm(to)}`;
}

/** Čo v páse plánu príde potom; na konci dňa nič. @param {import('./day-chart.js').Tone | null} tone */
export function terazBandNext(tone) {
    return tone ? `potom ${TERAZ_TONES[tone]}` : '';
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
 * @param {{ span: { from: number, to: number }, nowMin: number, kwText: string, tone: import('./day-chart.js').Tone,
 *   sun: Array<{ from: number, to: number }>, cheap: Array<{ from: number, to: number }>, costly: Array<{ from: number, to: number }> }} d
 */
export function terazChartText({ span, nowMin, kwText, tone, sun, cheap, costly }) {
    return dayChartText({ span, now: { min: nowMin, kwText, tone }, sun, cheap, costly });
}

/**
 * Textový popis grafu dňa pre čítačku: os grafu (deň so slnkom), pri dnešku teraz, potom okno na
 * veľké veci, lacná a drahá sieť za celý deň. Graf v detaile iného dňa než dnešok značku „teraz“
 * nemá (`now` je null).
 * @param {{ span: { from: number, to: number }, now: { min: number, kwText: string, tone: import('./day-chart.js').Tone } | null,
 *   sun: Array<{ from: number, to: number }>, cheap: Array<{ from: number, to: number }>, costly: Array<{ from: number, to: number }> }} d
 */
export function dayChartText({ span, now, sun, cheap, costly }) {
    const list = (/** @type {Array<{ from: number, to: number }>} */ ws) => ws.map(spanText).join(', ');
    const full = span.from === 0 && span.to === MINUTES_PER_DAY;
    const parts = [full ? 'Výroba počas dňa.' : `Výroba od ${hm(span.from)} do ${endHm(span.to)}.`];
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

/**
 * @typedef {{ druh: 'zive' | 'spi' | 'zastarane' | 'neprislo' | 'znova' | 'odhad', cas: string, neplati: { riadok: string } | null,
 *   pricina?: 'spojenie' | 'menic' | null, mlci?: number | null }} StavMeraniaVstup stav merania (stavMerania v hero-model.js)
 */

/** Krátke slovo za čas pri zastaranom meraní, podľa príčiny - hlavička oboch appiek aj riadok v Nastavení. */
export const STAV_SLOVO = { spojenie: 'bez spojenia', menic: 'zastarané' };

/**
 * Slovo za čas v hlavičke (oboch appiek), alebo prázdne, keď ho netreba: pri živom meraní
 * stačí čas, pri odhade hlavička píše vlastný text. @param {StavMeraniaVstup} stav
 */
export function stavMeraniaSlovo(stav) {
    if (stav.druh === 'zastarane') return STAV_SLOVO[stav.pricina ?? 'menic'];
    return stav.druh === 'spi' ? 'menič spí' : '';
}

/**
 * Bublina, keď meranie nejde, hoci je pripojené: menič v noci spí, appka nemá spojenie, alebo
 * menič mlčí za slnka - vtedy aj ako dlho, keď je čas merania známy. Texty sú bez oslovenia,
 * v oboch tónoch rovnaké. @param {StavMeraniaVstup} stav
 */
function stojiText(stav) {
    const mlci = stav.mlci ?? null;
    if (stav.druh === 'spi')
        return {
            nadpis: 'Menič spí',
            text:
                mlci === null
                    ? 'Slnko je pod obzorom a menič nemá čo merať. Ráno sa ozve sám.'
                    : `Posledné meranie prišlo o ${stav.cas}, odvtedy slnko zapadlo a menič nemá čo merať. Ráno sa ozve sám.`,
            tlacidlo: '',
        };
    if (stav.pricina === 'spojenie')
        return {
            nadpis: 'Appka nemá spojenie',
            text: `Od ${stav.cas} sa appka nedostala k novým dátam. Najčastejšie je to slabý signál alebo vypnuté dáta v telefóne. Karty zatiaľ rátajú s predpoveďou. Keď sa spojenie vráti, appka sa obnoví sama.`,
            tlacidlo: '',
        };
    const odkedy =
        mlci === null
            ? `Od ${stav.cas} neprišlo nové meranie.`
            : `Menič mlčí od ${stav.cas}, už ${countdownText(mlci)}, hoci slnko svieti.`;
    return {
        nadpis: 'Meranie je zastarané',
        text: `${odkedy} Karty zatiaľ rátajú s predpoveďou. Býva za tým výpadok internetu pri meniči alebo u výrobcu – appka to skúša ďalej sama.`,
        tlacidlo: '',
    };
}

/**
 * Vysvetlenie stavu merania - bublina pri bodke a čase v hlavičke oboch appiek: nadpis, text
 * a pri stavoch, kde treba niečo urobiť, tlačidlo do Nastavenia (inak prázdne).
 * @param {StavMeraniaVstup} stav @param {Voice} [voice] @returns {{ nadpis: string, text: string, tlacidlo: string }}
 */
export function stavMeraniaText(stav, voice = 'drzy') {
    const w = polite(voice) ? STAV_SLOVA_SLUSNE : STAV_SLOVA;
    switch (stav.druh) {
        case 'zive':
            return {
                nadpis: 'Živé meranie',
                text: `Menič poslal výkon o ${stav.cas}. Karty počítajú s tým, čo ${w.tvoja} strecha vyrába práve teraz. Ďalšie meranie príde o pár minút.`,
                tlacidlo: '',
            };
        case 'spi':
        case 'zastarane':
            return stojiText(stav);
        case 'neprislo':
            return {
                nadpis: 'Meranie neprišlo',
                text: `Appka sa na meranie pýtala, ale odpoveď neprišla. Karty rátajú s predpoveďou. O chvíľu to skúsi znova, ${w.nemusis} nič robiť.`,
                tlacidlo: '',
            };
        case 'znova':
            return {
                nadpis: 'Meranie treba pripojiť znova',
                text: `${stav.neplati?.riadok ?? 'Výrobca prestal prijímať prístup'}, ktorý ${w.zadal}. Kým meranie ${w.nepripojis} znova, karty rátajú s predpoveďou.`,
                tlacidlo: 'Pripojiť znova ›',
            };
        default:
            return {
                nadpis: 'Odhad z predpovede',
                text: `Meranie nie je pripojené. Čísla sú odhad z predpovede počasia a ${w.tvojich} panelov. Ak ${w.tvoj} menič posiela dáta cez internet, ${w.pripoj} ho v Nastavení.`,
                tlacidlo: 'Pripojiť meranie ›',
            };
    }
}

/** Slová vysvetlenia stavu merania, ktoré sa v tóne líšia (tykanie a vykanie). */
const STAV_SLOVA = {
    tvoja: 'tvoja',
    tvojich: 'tvojich',
    tvoj: 'tvoj',
    nemusis: 'nemusíš',
    zadal: 'si zadal',
    nepripojis: 'nepripojíš',
    pripoj: 'pripoj',
};
/** @type {typeof STAV_SLOVA} */
const STAV_SLOVA_SLUSNE = {
    tvoja: 'vaša',
    tvojich: 'vašich',
    tvoj: 'váš',
    nemusis: 'nemusíte',
    zadal: 'ste zadali',
    nepripojis: 'nepripojíte',
    pripoj: 'pripojte',
};

// ---- Pevné texty podľa tónu ---------------------------------------------------------

/** Pevné texty drzého tónu - tie isté objekty, ktoré používa súčasná appka. Celé (aj s kartami 7 dní a Štatistika) vracia voiceTexts v messages.js. */
const DRZY = {
    SLOT_MESSAGES,
    NIGHT_MESSAGES,
    PRICE_MESSAGES,
    MOZEM_WORDS,
    MOZEM_ITEM_TEXTS,
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
    MOZEM_ITEM_TEXTS: MOZEM_ITEM_TEXTS_SLUSNE,
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
