// Všetky texty odporúčaní pre používateľa na jednom mieste. Čisté funkcie bez DOM.

import { EVERYDAY } from './config.js';
import { dateParts, dayNameLong, fmt1, fmt2, fmtSum, hourLabel, minutesToTimeStr, weekDayLabel } from './format.js';
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
 * Veta a fakt pod veľkým slovom. Bez `data` (načítava sa, dáta nie sú) len stála veta.
 * @param {import('./mozem.js').MozemState} state
 * @param {{ ctx: DayCtx, window: MozemWindow | null, nextDay: LaterDay | null, live: boolean, kwNow: number,
 *   todayKwh: number | null, tomorrowKwh: number | null } | null} data
 * @returns {{ lead: string, factK: string, factV: string }}
 */
export function mozemHeroText(state, data) {
    if (state === 'loading') return { lead: 'Pozerám na oblohu.', factK: '', factV: '' };
    if (state === 'bezpanelov')
        return {
            lead: 'Nepoznám tvoje panely, takže netuším, koľko toho strecha utiahne. Ak musíš, pusti to.',
            factK: 'panely',
            factV: 'nezadané',
        };
    if (!data || state === 'offline')
        return {
            lead: 'Nemám predpoveď ani meranie. Skús o chvíľu, alebo sa spýtaj toho, kto platí elektrinu.',
            factK: 'dáta',
            factV: 'nedostupné',
        };
    if (state === 'go') return goHero(data);
    if (state === 'wait') {
        const { ctx, window } = data;
        const start = window ? window.from : ctx.nowMin;
        return {
            lead: `Za ${countdownText(start - ctx.nowMin)} to pôjde zo strechy.${ctx.draha ? ' Teraz by si platil drahý prúd.' : ''}`,
            factK: 'štart',
            factV: hm(start),
        };
    }
    return afterHero(state, data);
}

/**
 * Hlavička, keď dnes slnko už nepríde: slabý deň, alebo po zmene.
 * @param {import('./mozem.js').MozemState} state
 * @param {{ ctx: DayCtx, nextDay: LaterDay | null, live: boolean, todayKwh: number | null, tomorrowKwh: number | null }} data
 */
function afterHero(state, { ctx, nextDay, live, todayKwh, tomorrowKwh }) {
    const soon = nextDay && nextDay.index === 1 ? 'zajtra' : 'keď vyjde slnko';
    const kwh = (/** @type {number | null} */ v) => (v === null ? '–' : `~${Math.round(v)} kWh`);
    if (state === 'slabo')
        return {
            lead: `Mraky celý deň. Veľké veci radšej ${soon}.`,
            factK: 'dnes len',
            factV: kwh(todayKwh) + (tomorrowKwh === null ? '' : ` · zajtra ${kwh(tomorrowKwh)}`),
        };
    return {
        lead: `Slnko skončilo zmenu.${ctx.cheap ? ` Auto na lacný prúd je OK, zvyšok ${soon}.` : ` Zvyšok ${soon}.`}`,
        factK: live ? 'dnes strecha nahnala' : 'dnes podľa predpovede',
        factV: todayKwh === null ? '–' : `${fmt1(todayKwh)} kWh`,
    };
}

/** Hlavička, keď svieti: s meraním nabitia mobilu, bez neho priznaný odhad. @param {{ live: boolean, kwNow: number }} data */
function goHero({ live, kwNow }) {
    const lead = live ? 'Slnko to teraz platí za nás.' : 'Podľa predpovede teraz svieti naplno.';
    const phones = Math.round(kwNow / EVERYDAY.phoneChargeKwh / 10) * 10;
    return {
        lead: `${lead} Práčka, sušička, auto, čo chceš.`,
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
 * „čo keď mrak“ alebo „musíš hneď“ s cenou, keď ju tarifa pozná.
 * @param {{ id: string, runMin: number | null }} item @param {import('./mozem.js').Answer} a
 * @param {{ ctx: DayCtx, cost: number | null } | null} env
 * @returns {{ name: string, tone: 'go' | 'wait' | 'cheap' | 'no' | 'unk', short: string, head: string, text: string, extra: string }}
 */
export function mozemItemText(item, a, env) {
    const t = MOZEM_ITEM_TEXTS[item.id];
    const base = { name: t.name, extra: '' };
    if (a.kind === 'always') return { ...base, tone: 'go', short: 'vždy OK', ...MOZEM_ALWAYS[/** @type {'hranie' | 'fen'} */ (item.id)] };
    if (a.kind === 'unk' || !env) return { ...base, tone: 'unk', ...MOZEM_UNKNOWN };
    const isAuto = item.runMin === null;
    const cost = env.cost === null ? '' : `${isAuto ? 'Hodina nabíjania' : 'Stojí to'} ~${money(env.cost, env.ctx.currency)}.`;
    if (a.kind === 'go')
        return { ...base, tone: 'go', ...goItem(t, a, item.runMin, env.ctx), extra: `Mrak? ${t.cloud}${cost ? ` ${cost}` : ''}` };
    const now = cost || 'Pôjde to zo siete.';
    if (a.kind === 'wait') return { ...base, ...waitItem(t, a.start, isAuto, env.ctx.draha), extra: `Musíš hneď? ${now}` };
    if (a.kind === 'cheap')
        return {
            ...base,
            tone: 'cheap',
            short: 'lacno',
            head: `${t.verb} ${t.pron}, prúd je lacný.`,
            text: 'Slnko to dnes už neutiahne, ale sieť je teraz lacná.',
            extra: a.next ? `${laterWhen(a.next)} by to išlo zo strechy.` : '',
        };
    return { ...base, ...laterItem(a), extra: `Nepočká to? ${now}` };
}

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

/** Iný deň, alebo tento týždeň vôbec. @param {import('./mozem.js').Answer} a */
function laterItem(a) {
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
        text: `Dnes to už slnko neutiahne.${a.weakSkipped ? ' Kým nebude poriadne slnko, radšej počkaj.' : ''}`,
    };
}

/**
 * Tlačidlo „Pustil/a som“ v rozbalení spotrebiča. Kým vec beží, hovorí, kedy sa zapísala,
 * a že druhé ťuknutie zápis zruší. Keď appka radí počkať, je to „aj tak“ - zápis to tak berie.
 * @param {string} tone @param {boolean} isAuto @param {{ m: number } | null} running
 */
export function mozemLogLabel(tone, isAuto, running) {
    if (running) return `Zapísané o ${hm(running.m)}. Ťukni znova, ak nie.`;
    const verb = isAuto ? 'Zapojil/a som' : 'Pustil/a som';
    return tone === 'go' || tone === 'cheap' ? verb : `${verb} aj tak`;
}

/** Krátka odpoveď, kým spustená vec beží. @param {boolean} isAuto @param {number} until minúta dňa */
export function mozemRunningShort(isAuto, until) {
    return `${isAuto ? 'nabíja sa' : 'beží'} do ${hm(until)}`;
}

/** Riadok pod mriežkou: koľko toho tento mesiac človek pustil a koľko na slnku. @param {{ all: number, sun: number }} c */
export function mozemCountText({ all, sun }) {
    if (!all) return '';
    return `Tento mesiac si pustil/a ${all}× niečo, z toho ${sun}× na slnku.`;
}

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
    // „zo“ pred číslom, ktoré sa číta so s/š na začiatku: zo štyroch, zo šiestich, zo siedmich.
    const title = go ? `${go} ${[4, 6, 7].includes(n) ? 'zo' : 'z'} ${n} ide hneď` : 'Teraz nič';
    if (rest.every((i) => i.tone === 'unk')) return { title, sub: 'Pri spotrebičoch bez dát neviem.' };
    const named = rest.slice(0, GLANCE_NAMED).map((i) => `${i.name.toLowerCase()} ${i.short}`);
    const more = rest.length > GLANCE_NAMED ? ` +${rest.length - GLANCE_NAMED}` : '';
    return { title, sub: named.join(', ') + more };
}

// ---- Súhrn na zdieľanie ------------------------------------------------------------

/** Tvar podstatného mena podľa počtu: 1 rok, 2 roky, 5 rokov. @param {number} n @param {[string, string, string]} forms */
export function plural(n, [one, few, many]) {
    if (n === 1) return one;
    return n >= 2 && n <= 4 ? few : many;
}

/**
 * Trasy na porovnanie kilometrov, od najkratšej. Súhrn vyberie najdlhšiu, na ktorú to stačí.
 * Vzdialenosti sú po ceste z Bratislavy, zaokrúhlené.
 */
export const SUMMARY_TRIPS = [
    { km: 130, text: 'ako z Bratislavy do Trnavy a späť' },
    { km: 330, text: 'ako z Bratislavy do Prahy' },
    { km: 800, text: 'Bratislava – Košice a späť' },
    { km: 1800, text: 'až do Barcelony' },
    { km: 3600, text: 'do Barcelony a späť' },
    { km: 7200, text: 'dvakrát do Barcelony a späť' },
];

/**
 * Nadpis, riadky a poznámka súhrnu. Čísla prichádzajú hotové zo shared/summary.js.
 * @param {{ period: 'tyzden' | 'mesiac', month: string, kwh: number, phones: number, km: number,
 *   best: { date: string, kwh: number, today: boolean } | null, value: number | null, currency: string,
 *   launches: { all: number, sun: number }, missing: number }} d
 */
export function summaryTexts(d) {
    const kick = d.period === 'tyzden' ? 'Posledných 7 dní na streche' : `${d.month.charAt(0).toUpperCase()}${d.month.slice(1)} na streche`;
    /** @type {Array<{ t: string, s: string }>} */ const rows = [];
    if (d.kwh > 0) {
        rows.push({ t: `${fmtSum(Math.round(d.phones), 0)} nabití mobilu`, s: phonesSub(d.phones) });
        const trip = SUMMARY_TRIPS.filter((x) => x.km <= d.km).pop();
        rows.push({ t: `${fmtSum(Math.round(d.km), 0)} km autom`, s: trip ? trip.text : 'na elektrinu, zo strechy' });
    }
    if (d.best) rows.push({ t: `Najlepší deň: ${bestDay(d.best, d.period)}`, s: `${fmt1(d.best.kwh)} kWh za jediný deň` });
    if (d.value !== null && d.kwh > 0) rows.push({ t: `Hodnota ~${fmtSum(d.value, 0)} ${d.currency}`, s: 'toľko by sme za to dali sieti' });
    const { all, sun } = d.launches;
    if (all)
        rows.push({
            t: `Na slnku si pustil/a ${sun}×`,
            s: all > sun ? `z ${all} spustení, zvyšok išiel zo siete` : 'všetko išlo zo slnka',
        });
    const note = d.missing
        ? `Za ${d.missing} ${plural(d.missing, ['deň', 'dni', 'dní'])} appka čísla nemá – vtedy ju nikto neotvoril.`
        : '';
    return { kick, rows, note };
}

/** Jeden mobil na koľko: „na 12 rokov“, „na 40 dní“ - pri nabíjaní raz denne. @param {number} phones */
function phonesSub(phones) {
    const years = Math.floor(phones / 365);
    if (years >= 1) return `jeden mobil nabíjaný každý deň na ${years} ${plural(years, ['rok', 'roky', 'rokov'])}`;
    const days = Math.max(1, Math.round(phones));
    return `jeden mobil nabíjaný každý deň na ${days} ${plural(days, ['deň', 'dni', 'dní'])}`;
}

/** Najlepší deň: v týždni meno dňa, v mesiaci dátum. @param {{ date: string, today: boolean }} b @param {'tyzden' | 'mesiac'} period */
function bestDay(b, period) {
    if (b.today) return 'dnes';
    if (period === 'tyzden') return dayNameLong(b.date).toLowerCase();
    const { day, month } = dateParts(b.date);
    return `${day}. ${month}.`;
}

export const EMPTY_MESSAGES = {
    forecast: { title: 'Predpoveď sa pripravuje', body: 'Hodinové dáta zatiaľ nie sú k dispozícii, skús to o chvíľu.' },
    week: { title: 'Predpoveď sa pripravuje', body: 'Týždenné dáta zatiaľ nie sú k dispozícii, skús to o chvíľu.' },
};
