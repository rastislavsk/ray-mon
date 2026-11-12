// Texty ranného oznámenia a pripomienky (shared/oznamenia.js). Čisté funkcie bez DOM.

import { autoSunWhy, mozemTexts, planDnaRowText } from './messages-mozem.js';
import { andList, cap, dniSlovo, hm, onDay, polite } from './messages-zaklad.js';

// ---- Ranné oznámenie (shared/oznamenia.js) -------------------------------------------
// Jedno oznámenie ráno: nadpis o dni a v texte poradie spotrebičov. Text do ~200 znakov, zamknutá
// obrazovka ukáže 2–4 riadky. Pri bežných spotrebičoch bez ceny, pri aute km a úspora.

/** Výhľad dní bez slnka: „od štvrtka“, „do stredy“ - meno dňa v druhom páde. */
const DNA_GEN = /** @type {Record<string, string>} */ ({
    Zajtra: 'zajtra',
    Pondelok: 'pondelka',
    Utorok: 'utorka',
    Streda: 'stredy',
    Štvrtok: 'štvrtka',
    Piatok: 'piatka',
    Sobota: 'soboty',
    Nedeľa: 'nedele',
});
/** @param {string} name */
const dnaGen = (name) => DNA_GEN[name] ?? name.toLowerCase();

/** Výhľad dní bez slnka: vety, ktoré sa v tónoch líšia. */
const VYHLAD_SAY = {
    drzy: { oper: 'oper dnes', vyuzi: 'využi dnešok', stihni: 'stihni' },
    slusny: { oper: 'operte dnes', vyuzi: 'využite dnešok', stihni: 'stihnite' },
};

/**
 * Dni bez slnka za sebou (shared/vyhlad.js): prvý z nich (`name` ako v Pláne dňa, „Zajtra“, „Štvrtok“),
 * koľko ich je a deň pred nimi (`pred`, null keď začínajú zajtra).
 * @typedef {{ name: string, date: string, index: number, pocet: number, pred: string | null }} BehBezSlnka
 */

/** „Zajtra slnko nebude“, „Od štvrtka 4 dni bez slnka“. @param {BehBezSlnka} b */
function behVeta(b) {
    if (b.pocet === 1) return `${cap(onDay(b.name))} slnko nebude`;
    return `Od ${dnaGen(b.name)} ${b.pocet} ${dniSlovo(b.pocet)} bez slnka`;
}

/**
 * Čo s tým dnes: pred zajtrajškom „Oper dnes.“, inak „Veľké pranie stihni do stredy.“ Bez práčky
 * doma „využi dnešok“ a „veľké veci“.
 * @param {BehBezSlnka} b @param {boolean} pracka @param {import('./messages-zaklad.js').Voice} voice
 */
function behRada(b, pracka, voice) {
    const S = VYHLAD_SAY[voice];
    if (!b.pred) return `${cap(pracka ? S.oper : S.vyuzi)}.`;
    return `${pracka ? 'Veľké pranie' : 'Veľké veci'} ${S.stihni} do ${dnaGen(b.pred)}.`;
}

/**
 * Výhľad v rannom oznámení (docs/navrhy/vyhlad-dni-bez-slnka.html): nadpis a úvod textu, pred
 * ktorým ide dnešný plán. Výstraha (`zmena` null) - dni bez slnka; zmena oproti tomu, čo oznámenie
 * povedalo naposledy (`predtym` - vtedajší prvý deň bez slnka): „Lepšie: …“, „Horšie: …“. Rada,
 * čo stihnúť, len keď dnes slnko je (`dnes`). Bez výhľadu null.
 * @param {{ beh: BehBezSlnka | null, zmena: import('./vyhlad.js').Zmena | null, predtym: string | null, dnes: boolean, pracka: boolean }} v
 * @param {import('./messages-zaklad.js').Voice} [voice]
 */
export function vyhladNoticeText({ beh, zmena, predtym, dnes, pracka }, voice = 'drzy') {
    if (zmena === 'zmizli') return { title: 'Lepšie: zamračené dni zmizli', uvod: 'Predpoveď už dni bez slnka nečaká.' };
    if (!beh) return null;
    const veta = behVeta(beh);
    const rada = dnes ? behRada(beh, pracka, voice) : '';
    if (!zmena) {
        if (!beh.pred && beh.pocet === 1)
            return { title: `${veta} – ${pracka ? VYHLAD_SAY[voice].oper : VYHLAD_SAY[voice].vyuzi}`, uvod: '' };
        return { title: veta, uvod: rada };
    }
    const dni = `${beh.pocet} ${dniSlovo(beh.pocet)}`;
    const title = {
        neskor: `Lepšie: ${(predtym ?? beh.name).toLowerCase()} predsa so slnkom`,
        skor: `Horšie: zamračí sa už ${onDay(beh.name)}`,
        dlhsie: `Horšie: bez slnka ${dni}`,
        kratsie: `Lepšie: bez slnka len ${dni}`,
    }[zmena];
    return { title, uvod: [`${veta}.`, rada].filter(Boolean).join(' ') };
}

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
 * @param {{ rows: import('./plan-dna.js').PlanRow[], sunEnd: number | null, weak: boolean }} d @param {import('./messages-zaklad.js').Voice} [voice]
 */
export function planNoticeText({ rows, sunEnd, weak }, voice = 'drzy') {
    const T = mozemTexts(voice).MOZEM_ITEM_TEXTS;
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
 * @param {import('./plan-dna.js').PlanRow[]} rows @param {(id: string) => string} low @param {import('./messages-zaklad.js').Voice} voice
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
 * @param {import('./plan-dna.js').PlanRow[]} rows @param {(id: string) => string} low @param {import('./messages-zaklad.js').Voice} voice
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
 * @param {import('./plan-dna.js').PlanRow} row @param {number} nowMin @param {import('./messages-zaklad.js').Voice} [voice]
 */
export function reminderText(row, nowMin, voice = 'drzy') {
    const name = mozemTexts(voice).MOZEM_ITEM_TEXTS[row.id].name;
    if (row.kind === 'sun' && row.start <= nowMin + 15)
        return { title: `${name} · teraz`, body: `${cap(planDnaRowText(row, voice).why)}. Dobehne o ${hm(row.end)}.` };
    if (row.kind === 'sun') return { title: `${name} až o ${hm(row.start)}`, body: 'Slnko sa posunulo, skôr by to išlo zo siete.' };
    if (row.kind === 'later') return { title: `${name} radšej ${onDay(row.day.name)}`, body: 'Zatiahlo sa a dnes by to išlo zo siete.' };
    if (row.kind === 'cheap') return { title: `${name} v lacnom pásme`, body: `Slnko dnes nestačí, od ${hm(row.start)} je lacný prúd.` };
    return { title: `${name} dnes nie`, body: 'Slnko podľa predpovede tento týždeň nestačí.' };
}

/**
 * Pevné texty oznámení: tlačidlá v oznámení, oznámenie, keď sa plán nedal vypočítať, a sekcia
 * Oznámenia v Nastavení (stavy povolenia v `stav`).
 * @param {import('./messages-zaklad.js').Voice} [voice]
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
        hintOn: (/** @type {number} */ hour) => `Ráno o ${hour}:00 plán dňa`,
        switchLabel: 'Ranný plán dňa',
        switchSmall: 'jedno oznámenie denne, čo kedy pustiť',
        when: 'Kedy',
        whenSmall: 'ráno o',
        uses: p ? 'Ráta so spotrebičmi z položky Čo máte doma.' : 'Ráta so spotrebičmi z položky Čo máš doma.',
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
