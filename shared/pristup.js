// Prístup k meraniu, ktorý výrobca prestal prijímať (vypršal, bol zrušený, zmenilo sa heslo), a
// prístup, ktorý čoskoro vyprší. Výpadok výrobcu či siete sem nepatrí - ten appka hlási ako
// „meranie neodpovedá“ a skúša ďalej. Odmietnutie znamená, že kým človek niečo neurobí, meranie
// nepôjde; appka preto povie prečo, ukáže cestu k oprave a prestane výrobcu zbytočne zaťažovať.
// Návrh: docs/navrhy/meranie-pristup-neplati.html.

import { PRISTUP } from './config.js';
import { isObj } from './valid.js';
import { menoZnacky, sposobOf } from './zdroje.js';

/** @typedef {import('./zdroje.js').Zdroj} Zdroj */
/**
 * Odmietnutý prístup, ako si ho appka pamätá: ku ktorej pečati patrí, koľkokrát za sebou ho
 * výrobca odmietol, kedy naposledy (ms), krok a kód chyby od výrobcu a či posledný pokus bol
 * „Skúsiť znova“ (vtedy appka povie, že ani to nepomohlo).
 * @typedef {{ pecat: string, n: number, at: number, kod: string, skusene: boolean }} Odmietnutie
 */

// Rezerva pri porovnaní s intervalom spôsobu - ako DUE_SLACK_MS v shared/zdroje.js.
const SLACK_MS = 10 * 1000;
const DEN_MS = 24 * 60 * 60 * 1000;

/** Odmietnutie z úložiska; čokoľvek iné je null. @param {unknown} raw @returns {Odmietnutie | null} */
export function parseOdmietnutie(raw) {
    if (!isObj(raw)) return null;
    const o = /** @type {Record<string, unknown>} */ (raw);
    if (typeof o.pecat !== 'string' || !o.pecat || !Number.isInteger(o.n) || !Number.isFinite(o.at)) return null;
    return {
        pecat: o.pecat,
        n: Math.max(1, /** @type {number} */ (o.n)),
        at: /** @type {number} */ (o.at),
        kod: typeof o.kod === 'string' ? o.kod.slice(0, 40) : '',
        skusene: o.skusene === true,
    };
}

/** Patrí odmietnutie k tomuto pripojenému meraniu? @param {Odmietnutie | null} o @param {Zdroj | null} zdroj */
const patri = (o, zdroj) => !!o && !!zdroj && o.pecat === zdroj.pecat;

/**
 * Ďalšie odmietnutie toho istého prístupu (počíta sa za sebou), alebo prvé pre nový.
 * @param {Odmietnutie | null} prev @param {Zdroj} zdroj @param {Date} now @param {string} kod
 * @param {boolean} skusene pokus vyvolal človek tlačidlom „Skúsiť znova“
 * @returns {Odmietnutie}
 */
export function odmietnute(prev, zdroj, now, kod, skusene) {
    const n = prev && patri(prev, zdroj) ? prev.n + 1 : 1;
    return { pecat: zdroj.pecat, n, at: now.getTime(), kod, skusene };
}

/** Povedať, že treba pripojiť znova? Až po PRISTUP.odmietnutia odmietnutiach za sebou.
 * @param {Odmietnutie | null} o @param {Zdroj | null} zdroj */
export const neplati = (o, zdroj) => patri(o, zdroj) && /** @type {Odmietnutie} */ (o).n >= PRISTUP.odmietnutia;

/**
 * Je po odmietnutí čas sa opýtať znova? null, keď odmietnutie k meraniu nepatrí - vtedy
 * rozhoduje bežný interval (pvDue). Kým appka ešte neusúdila, že prístup neplatí, čaká interval
 * spôsobu; potom raz za PRISTUP.skusMs.
 * @param {Odmietnutie | null} o @param {Zdroj | null} zdroj @param {Date} now @returns {boolean | null}
 */
export function znovaDue(o, zdroj, now) {
    if (!o || !zdroj || !patri(o, zdroj)) return null;
    const s = sposobOf(zdroj.sposob);
    const wait = neplati(o, zdroj) ? PRISTUP.skusMs : (s?.intervalMs ?? 0) - SLACK_MS;
    return now.getTime() - o.at >= wait;
}

/**
 * Koľko celých dní ostáva prístupu, ktorý výrobca dáva len na čas, keď je to najviac
 * PRISTUP.pripomenutMs; inak (a bez dátumu) null.
 * @param {Zdroj | null} zdroj @param {Date} now @returns {number | null}
 */
export function dniDoKonca(zdroj, now) {
    if (!zdroj?.platiDo) return null;
    const left = Date.parse(zdroj.platiDo) - now.getTime();
    return left <= PRISTUP.pripomenutMs ? Math.max(0, Math.ceil(left / DEN_MS)) : null;
}

/** „o 5 dní“, „o 1 deň“, „dnes“. @param {number} n */
function zaDni(n) {
    if (n <= 0) return 'dnes';
    return `o ${n} ${n === 1 ? 'deň' : n < 5 ? 'dni' : 'dní'}`;
}

/** Deň a mesiac „26. 10.“ v časovom pásme elektrárne. @param {string} iso @param {string} timeZone */
function denMesiac(iso, timeZone) {
    const p = new Intl.DateTimeFormat('sk-SK', { timeZone, day: 'numeric', month: 'numeric' }).formatToParts(new Date(iso));
    const v = (/** @type {string} */ t) => p.find((x) => x.type === t)?.value ?? '';
    return `${v('day')}. ${v('month')}.`;
}

/**
 * Čo appka hovorí, keď výrobca prístup odmietol (pristupModel s `druh: 'neplati'`), inak null -
 * pre hlavičku, pás súčasnej appky a kartu Štatistika, ktoré pripomenutie vypršania netýka.
 * @param {{ zdroj: Zdroj | null, pristup: Odmietnutie | null, now: Date, site: { timezone: string } }} s
 */
export function neplatiOf(s) {
    const p = pristupModel({ zdroj: s.zdroj, pristup: s.pristup, now: s.now, timezone: s.site.timezone });
    return p && p.druh === 'neplati' ? p : null;
}

/**
 * Úvod sprievodcu pri pripájaní znova: dôvod, kód chyby od výrobcu a pri Huawei 20400 aj rada,
 * že účet môže byť prihlásený inde.
 * @param {string} dovod @param {string} kod napr. `prihlasenie:20400`
 */
function uvodZnova(dovod, kod) {
    const cislo = kod.split(':')[1] ?? '';
    const sKodom = cislo ? dovod.replace(/^([^.]*)\./, `$1 (kód ${cislo}).`) : dovod;
    return cislo === '20400' ? `${sKodom} Ak je účet prihlásený aj inde, napríklad v Shelly, odhlás ho tam.` : sKodom;
}

/**
 * Prístup, ktorý výrobca opakovane odmietol: čo appka povie a kde (pristupModel).
 * @param {Zdroj} zdroj @param {import('./zdroje.js').Sposob} sposob @param {Odmietnutie} o @param {Date} now
 */
function neplatiModel(zdroj, sposob, o, now) {
    const znacka = menoZnacky(zdroj.sposob);
    const vyprsal = !!zdroj.platiDo && Date.parse(zdroj.platiDo) <= now.getTime() && sposob.vyprsal;
    const dovod = vyprsal || sposob.neplati;
    return {
        druh: /** @type {const} */ ('neplati'),
        riadok: `${znacka} prestal prijímať prístup`,
        pas: { nadpis: 'Meranie treba pripojiť znova', text: `${znacka} prestal prijímať prístup.`, tlacidlo: 'Pripojiť' },
        hlavicka: 'meranie treba pripojiť znova',
        tone: 'prístup k meraniu neplatí',
        stav: `${znacka} · prístup neplatí`,
        stavKratko: 'prístup neplatí',
        karta: {
            nadpis: 'Meranie treba pripojiť znova',
            text: `${dovod} Kým meranie nepripojíš, appka ukazuje odhad z predpovede.`,
            skus: o.skusene ? `${znacka} prístup stále neprijíma. Skús to znova o hodinu, alebo meranie pripoj znova.` : '',
            tlacidlo: 'Pripojiť znova',
        },
        statistika: `${znacka} prestal prijímať prístup, dnešok len odhadujem z predpovede. Súčty za mesiac, rok aj celý čas sa ukážu, keď meranie pripojíš znova v Nastavení.`,
        sprievodca: { nadpis: `Pripoj ${znacka} znova`, uvod: uvodZnova(dovod, o.kod) },
    };
}

/**
 * Prístup na čas, ktorý čoskoro vyprší (pristupModel); inak null.
 * @param {Zdroj} zdroj @param {import('./zdroje.js').Sposob} sposob @param {Date} now @param {string} timezone
 */
function vyprsiModel(zdroj, sposob, now, timezone) {
    const dni = dniDoKonca(zdroj, now);
    if (dni === null || !zdroj.platiDo || !sposob.obnova) return null;
    const znacka = menoZnacky(zdroj.sposob);
    const nadpis = `Prístup od ${znacka} vyprší ${zaDni(dni)}`;
    const datum = denMesiac(zdroj.platiDo, timezone);
    return {
        druh: /** @type {const} */ ('vyprsi'),
        stav: `${znacka} · platí do ${datum}`,
        stavKratko: `platí do ${datum}`,
        karta: { nadpis, text: sposob.obnova.text, skus: '', tlacidlo: 'Obnoviť prístup' },
        sprievodca: { nadpis: `Obnov prístup ${znacka}`, uvod: `${nadpis}. ${sposob.obnova.text}` },
    };
}

/**
 * Čo appka o prístupe k meraniu hovorí, alebo null, keď nie je čo. `neplati`: výrobca prístup
 * opakovane odmietol. `vyprsi`: prístup na čas (Deye) čoskoro vyprší.
 * - `riadok`: veta pod číslom na karte Teraz (nová appka), `pas`: pás pod hlavičkou (súčasná),
 * - `hlavicka`: stav v hlavičke súčasnej appky, `tone`: to isté pre čítačku obrazovky v novej,
 * - `stav`: riadok Živé meranie v Nastavení (`stavKratko` bez značky), `karta`: hlásenie v Nastavení,
 * - `statistika`: veta na karte Štatistika, `sprievodca`: nadpis a úvod pri pripájaní znova.
 * @param {{ zdroj: Zdroj | null, pristup: Odmietnutie | null, now: Date, timezone: string }} s
 */
export function pristupModel({ zdroj, pristup, now, timezone }) {
    const sposob = zdroj && sposobOf(zdroj.sposob);
    if (!zdroj || !sposob) return null;
    if (pristup && neplati(pristup, zdroj)) return neplatiModel(zdroj, sposob, pristup, now);
    return vyprsiModel(zdroj, sposob, now, timezone);
}
