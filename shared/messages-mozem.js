// Texty karty Dnes (kódové meno mozem), Plánu dňa a dlaždíc. Čisté funkcie bez DOM.

import { DEVICES, EVERYDAY, MINUTES_PER_DAY, MOZEM_ITEMS } from './config.js';
import { fmt1, fmtSum, kwpRoughText } from './format.js';
import { andList, cap, endHm, hm, money, polite, spanText } from './messages-zaklad.js';

// ---- Karta Môžem? -----------------------------------------------------------------
// Tón je zámerne suchý, nie roztomilý: čítajú ho najmä tínedžeri (návrh C
// v docs/navrhy/karta-mozem.html). Veľké slovo, jedna veta, žiadne kW.

/** Veľké slovo karty, keď o dni nevie nič: dáta nie sú, načítava sa, panely nie sú zadané. */
export const MOZEM_WORDS = {
    offline: 'Nemám dáta, sme off-line',
    loading: 'Uno momento',
    bezpanelov: 'Nastav panely, voe!',
};

/** Slušný tón karty: veľké slovo vecne. @type {typeof MOZEM_WORDS} */
export const MOZEM_WORDS_SLUSNE = {
    offline: 'Nemám dáta, sme off-line',
    loading: 'MOMENT',
    bezpanelov: 'Elektráreň zatiaľ nie je nastavená',
};

/**
 * Veľké slovo o celom dni (shared/den-trieda.js, docs/navrhy/dnes-hlasky-dna.html): ráno a cez
 * deň podľa triedy dňa, cez deň zmena oproti rannej triede, večer zhodnotenie nameraného.
 * Rozdiel NAGOVNO / NAHOVNO je zámerný.
 */
export const DEN_WORDS = {
    rano: {
        vyborny: 'Oskar dnes pujde na plný koule',
        dobry: 'Not baaad dneskaj',
        slaby: 'NAGOVNO DEŇ',
        nanic: 'ÚPLNE NAHOVNO DEŇ',
    },
    zmena: {
        lepsi: 'Tak jo, Oskar nakoniec vylezie',
        horsi: 'Dojebabralo sa nám to dneskaj',
    },
    vecer: {
        vyborny: 'Oskar to dnes odpálil na plný koule',
        dobry: 'Not baad, zer gút',
        slaby: 'Dneskaj ništ moc, nem džo',
        nanic: 'Dnes to bolo pjekne nagovno',
    },
    zajtra: {
        vyborny: 'Zajtra Oskar pujde na plný koule',
        dobry: 'Zajtra not baaad',
        slaby: 'Zajtra NAGOVNO DEŇ',
        nanic: 'Zajtra ÚPLNE NAHOVNO DEŇ',
    },
};

/** @type {typeof DEN_WORDS} */
export const DEN_WORDS_SLUSNE = {
    rano: {
        vyborny: 'Dnes bude výborný deň',
        dobry: 'Dnes bude dobrý deň',
        slaby: 'Dnes bude slabý deň',
        nanic: 'Dnes takmer nič nevyrobíme',
    },
    zmena: {
        lepsi: 'Deň bude lepší, ako sa čakalo',
        horsi: 'Deň bude slabší, ako sa čakalo',
    },
    vecer: {
        vyborny: 'Dnes to bol výborný deň',
        dobry: 'Dnes to bol dobrý deň',
        slaby: 'Dnes to bol slabý deň',
        nanic: 'Dnes sme takmer nič nevyrobili',
    },
    zajtra: {
        vyborny: 'Zajtra bude výborný deň',
        dobry: 'Zajtra bude dobrý deň',
        slaby: 'Zajtra bude slabý deň',
        nanic: 'Zajtra takmer nič nevyrobíme',
    },
};

/**
 * Veľké slovo pre deň (denSlovo v shared/den-trieda.js).
 * @param {{ cls: import('./den-trieda.js').DenTrieda, faza: import('./den-trieda.js').DenFaza, change: 'lepsi' | 'horsi' | null }} d
 * @param {import('./messages-zaklad.js').Voice} voice
 */
export function denWord({ cls, faza, change }, voice) {
    const w = mozemTexts(voice).DEN_WORDS;
    if (change) return w.zmena[change];
    return faza === 'vecer' ? w.vecer[cls] : w.rano[cls];
}

/** Trieda dňa slovami - štítok na karte Dnes. Bez postoja, jedna pre oba tóny. */
export const DEN_NAZVY = { vyborny: 'výborný deň', dobry: 'dobrý deň', slaby: 'slabý deň', nanic: 'deň skoro bez slnka' };

/** Pevné texty karty Dnes podľa časti dňa (shared/dnes-faza.js). */
export const DNES_TEXTS = {
    plan: 'Plán na dnes',
    grade: 'Ako dopadol dnešok',
    gradeLabel: 'Dnes zo strechy',
    later: 'Kedy lepšie',
    predpoved: 'Predpoveď',
    predpovedZajtra: 'Predpoveď na zajtra',
    oblacnost: 'oblačnosť',
    graf: 'Graf dňa',
    /** Venovanie - jediný viditeľný text karty Graf dňa (docs/navrhy/dnes-graf-tajomno.html, D). */
    grafStitok: 'Kheinshmetke only',
    slnko: 'Najviac slnka',
    karty: 'Viac o dnešku',
    stupnica: 'Ako appka deň hodnotí',
};

/**
 * Stupnica tried dňa vo vysvetlení odznaku (docs/navrhy/dnes-upravy.html): krátke meno a čo trieda znamená
 * pre veľké veci. Bez postoja, jedna pre oba tóny.
 */
export const DEN_STUPNICA = {
    nanic: { label: 'skoro bez slnka', pop: 'nezmestí sa nič' },
    slaby: { label: 'slabý', pop: 'zmestí sa časť' },
    dobry: { label: 'dobrý', pop: 'zmestí sa všetko' },
    vyborny: { label: 'výborný', pop: 'všetko, aj keď príde mrak' },
};

/**
 * Vysvetlenie triedy dňa po ťuknutí na odznak karty Dnes: nadpis, veta o veľkých veciach a ako appka
 * deň ráta. `kedy` je dnešok, alebo večer zajtrajšok.
 * @param {import('./den-trieda.js').DenTrieda} cls @param {'dnes' | 'zajtra'} kedy @param {import('./messages-zaklad.js').Voice} voice
 */
export function denVysvetlenieText(cls, kedy, voice) {
    const p = polite(voice);
    const veci = p ? 'vaše' : 'tvoje';
    const Kedy = kedy === 'dnes' ? 'Dnes' : 'Zajtra';
    const title = {
        vyborny: 'Na slnko sa zmestí všetko, aj s rezervou',
        dobry: 'Na slnko sa zmestí všetko',
        slaby: 'Na slnko sa zmestí len časť',
        nanic: 'Na slnko sa nezmestí nič',
    }[cls];
    const text = {
        vyborny: `Všetky ${veci} veľké veci ${kedy} stihnú bežať zo strechy, aj keby prišiel mrak a strecha dala menej.`,
        dobry: `Všetky ${veci} veľké veci ${kedy} stihnú bežať zo strechy. Rezerva však nie je – keď príde mrak, niečo pôjde zo siete.`,
        slaby: `${Kedy} stihne zo strechy len časť ${p ? 'vašich' : 'tvojich'} veľkých vecí. Ostatné pôjdu zo siete, alebo ${p ? 'počkajte' : 'počkaj'} na lepší deň.`,
        nanic: `${Kedy} nestihne zo strechy ani jedna veľká vec. Čo nepočká, pôjde zo siete.`,
    }[cls];
    const slnko = kedy === 'dnes' ? 'čo už bolo, podľa merania, zvyšok podľa predpovede' : 'podľa predpovede';
    const note = `Ráta s veľkými vecami, ktoré ${p ? 'máte' : 'máš'} v Nastavení, a so slnkom celého dňa: ${slnko}.`;
    return { title, text, note };
}

/** Ráno: kedy dnes pustiť veľké veci. @param {{ from: number, to: number } | null} w @param {import('./messages-zaklad.js').Voice} voice */
export function dnesPlanText(w, voice) {
    if (!w) return 'Okno na veľké veci dnes nebude.';
    return `Veľké veci ${polite(voice) ? 'dajte' : 'daj'} medzi ${spanText(w)}.`;
}

/**
 * Cez deň: odpočet okna na veľké veci - koľko z neho ešte zostáva (`go`), alebo o koľko začne (`wait`).
 * @param {'go' | 'wait'} kind @param {{ from: number, to: number }} w @param {number} left minúty
 */
export function dnesCountText(kind, w, left) {
    const text = kind === 'go' ? `ešte slnka na veľké veci, do ${endHm(w.to)}` : `do okna na veľké veci ${spanText(w)}`;
    return { value: countdownText(left), text };
}

/**
 * Cez deň: karta Nabehlo - koľko už nabehlo z predpovede dneška, z merania naisto, bez neho podľa predpovede.
 * @param {{ forecastKwh: number, doneKwh: number, measured: boolean, pct: number | null }} d
 */
export function dnesNabehloText({ forecastKwh, doneKwh, measured, pct }) {
    const z = `z ~${fmtSum(Math.round(forecastKwh), 0)} kWh na celý deň`;
    return {
        title: measured ? 'Nabehlo' : 'Nabehlo asi',
        value: `${fmt1(doneKwh)} kWh`,
        text: `${pct === null ? z.charAt(0).toUpperCase() + z.slice(1) : `${pct} % ${z}`}${measured ? '' : ', podľa predpovede'}.`,
    };
}

/** Večer: namerané za dnešok a čo sľubovala predpoveď. @param {number} kwh @param {number | null} forecastKwh */
export function dnesGradeText(kwh, forecastKwh) {
    return {
        value: `${fmt1(kwh)} kWh`,
        line: forecastKwh === null ? '' : `Predpoveď bola ${fmtSum(Math.round(forecastKwh), 0)} kWh.`,
    };
}

/**
 * Večer: zajtrajšok - trieda dňa, veľké slovo, koľko dá strecha a okno na veľké veci.
 * @param {{ cls: import('./den-trieda.js').DenTrieda, kwh: number, window: { from: number, to: number } | null }} d @param {import('./messages-zaklad.js').Voice} voice
 */
export function dnesZajtraText({ cls, kwh, window }, voice) {
    const okolo = `Okolo ${fmtSum(Math.round(kwh), 0)} kWh`;
    return {
        kick: 'Zajtra',
        chip: `zajtra ${DEN_NAZVY[cls]}`,
        word: mozemTexts(voice).DEN_WORDS.zajtra[cls],
        text: window ? `${okolo}, veľké veci ${spanText(window)}.` : `${okolo}, okno na veľké veci nebude.`,
    };
}

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
export const MOZEM_ITEM_TEXTS_SLUSNE = {
    ...MOZEM_ITEM_TEXTS,
    pracka: { ...MOZEM_ITEM_TEXTS.pracka, verb: 'Pustite' },
    umyvacka: { ...MOZEM_ITEM_TEXTS.umyvacka, verb: 'Pustite' },
    susicka: { ...MOZEM_ITEM_TEXTS.susicka, verb: 'Pustite' },
    auto: { ...MOZEM_ITEM_TEXTS.auto, verb: 'Zapojte' },
    bojler: { ...MOZEM_ITEM_TEXTS.bojler, verb: 'Zapnite' },
};

/** @type {typeof MOZEM_UNKNOWN} */
export const MOZEM_UNKNOWN_SLUSNE = {
    ...MOZEM_UNKNOWN,
    text: 'Bez dát neviem, či svieti. Ak to potrebujete, zapnite to, nič sa nestane.',
};

/** @typedef {import('./mozem-jadro.js').DayCtx} DayCtx */
/** @typedef {import('./mozem-jadro.js').LaterDay} LaterDay */
/** @typedef {import('./mozem-jadro.js').Window} MozemWindow */
/** @typedef {(typeof import('./config.js').MOZEM_ITEMS)[number]} MozemItem */
/** Veci karty podľa id. */
const MOZEM_ITEMS_BY_ID = Object.fromEntries(MOZEM_ITEMS.map((i) => [i.id, i]));

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

/** Kedy iný deň: „Zajtra od 11:00“. @param {LaterDay} d */
export const laterWhen = (d) => `${d.name} od ${hm(d.start)}`;

/**
 * Vety hlavičky karty Môžem? v oboch tónoch. `soon` je „zajtra“ alebo „keď vyjde slnko“.
 * Spotrebiče a časy do nich dopĺňa Plán dňa (PlanHero).
 */
export const HERO_SAY = {
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
 * @param {import('./messages-zaklad.js').Voice} [voice]
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
 * @param {MozemItem} item @param {import('./mozem-jadro.js').Answer} a
 * @param {{ ctx: DayCtx, cost: number | null } | null} env
 * @param {import('./messages-zaklad.js').Voice} [voice]
 * @returns {{ name: string, tone: 'go' | 'wait' | 'cheap' | 'no' | 'unk', short: string, head: string, text: string,
 *   more: { q: string, a: string } | null }}
 */
export function mozemItemText(item, a, env, voice = 'drzy') {
    const T = mozemTexts(voice);
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

/** Iný deň, alebo tento týždeň vôbec. @param {import('./mozem-jadro.js').Answer} a @param {string} notToday @param {import('./messages-zaklad.js').Voice} voice */
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

export const PLAN_DNA_NOTE = 'Naraz len toľko, koľko strecha utiahne.';

/** „po práčke“ - na koho vec v pláne čaká (PLAN_DNA.after). */
export const PLAN_AFTER = /** @type {Record<string, string>} */ ({ pracka: 'po práčke' });

/**
 * Texty riadku plánu dňa.
 * @param {import('./plan-dna.js').PlanRow} row @param {import('./messages-zaklad.js').Voice} [voice]
 * @returns {{ name: string, time: string, why: string, tone: 'go' | 'cheap' | 'wait' | 'no' }}
 */
export function planDnaRowText(row, voice = 'drzy') {
    const t = mozemTexts(voice).MOZEM_ITEM_TEXTS[row.id];
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
 * @param {{ km: number | null, save: number | null, currency: string }} row @param {import('./messages-zaklad.js').Voice} voice
 */
export function autoSunWhy({ km, save, currency }, voice) {
    const sun = km ? `~${km} km zo slnka` : 'aspoň trochu zo slnka';
    if (!save) return sun;
    const sum = save >= 1 ? `${Math.round(save)} ${currency}` : money(save, currency);
    return `${sun}, ${polite(voice) ? 'ušetríte' : 'ušetríš'} ~${sum}`;
}

// ---- Karta Môžem?: dlaždice, panel veci a výzvy ------------------------------------
// Odpovede, časy a vety sú tie isté ako vyššie. Dlaždice skupín a panel veci,
// štítky nad slovom a výzvy len appka - výzvu z typickej strechy ukazuje aj
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

/** Pevné texty karty: nadpisy a zatvorenie panelu veci, tlačidlá a výzvy. */
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
export const MOZEM_CHIPS_SLUSNE = { ...MOZEM_CHIPS, wait: 'Počkajte' };

/** @type {typeof MOZEM_SKY_TEXTS} */
export const MOZEM_SKY_TEXTS_SLUSNE = {
    ...MOZEM_SKY_TEXTS,
    guessTitle: 'Toto je len odhad',
    guessBtn: 'Zadajte panely',
    askTitle: 'Kde máte strechu?',
    askText: 'Bez polohy neviem, kedy u vás svieti slnko. Zadajte ju v Nastavení a poviem vám, čo môžete zapnúť.',
    askBtn: 'Zadajte polohu',
};

/** Štítok v hlavičke bez zadaných panelov - otvorí Nastavenie. */
export const HEADER_TEXTS = { setup: 'Zadaj panely ›' };

/** @type {typeof HEADER_TEXTS} */
export const HEADER_TEXTS_SLUSNE = { setup: 'Zadajte panely ›' };

/** Výzva pri odpovedi z typickej strechy: s čím appka počíta. Výkon zhruba („asi 5 kWp“) -
 * desatiny by tvrdili presnosť, ktorú typická strecha nemá. @param {number} kwp výkon typickej strechy @param {import('./messages-zaklad.js').Voice} [voice] */
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
 * @param {import('./mozem-jadro.js').Answer} a @param {string} short krátka odpoveď veci
 */
export function mozemTileValue(a, short) {
    if (a.kind === 'go') return `do ${hm(a.end)}`;
    return short;
}

/**
 * Riadok pod odpoveďou dlaždice s jednou vecou: odkiaľ pôjde prúd, pri aute koľko km chytí.
 * @param {import('./mozem-jadro.js').Answer} a
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
 * @param {import('./messages-zaklad.js').Voice} [voice]
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

/** Pevné texty karty Dnes v drzom tóne, ktoré čítajú aj vety iných kariet. */
const MOZEM_DRZY = { DEN_WORDS, MOZEM_ITEM_TEXTS, MOZEM_UNKNOWN, MOZEM_CHIPS };
/** @type {typeof MOZEM_DRZY} */
const MOZEM_SLUSNE = {
    DEN_WORDS: DEN_WORDS_SLUSNE,
    MOZEM_ITEM_TEXTS: MOZEM_ITEM_TEXTS_SLUSNE,
    MOZEM_UNKNOWN: MOZEM_UNKNOWN_SLUSNE,
    MOZEM_CHIPS: MOZEM_CHIPS_SLUSNE,
};

/**
 * Pevné texty karty Dnes v danom tóne - len tie, ktoré vety potrebujú. Všetky pevné texty jadra
 * vracia voiceTexts (messages-core.js); ten sa tu použiť nedá, importoval by tento súbor späť.
 * @param {import('./messages-zaklad.js').Voice} voice
 */
export const mozemTexts = (voice) => (polite(voice) ? MOZEM_SLUSNE : MOZEM_DRZY);
