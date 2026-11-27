// Nastavenie › Čo máš doma (docs/navrhy/nastavenie-co-mas-doma.html, A + L5b + P1 + P3, 27. 11. 2026): zoznam vecí
// s prepínačom, pod zapnutou vecou riadky jej pripojení so stavom (zásuvka Shelly, riadenie bojlera, teplomer, Shelly
// klimatizácie, oznámenia auta) a okno, ktoré riadok otvorí. Pripojenia sú len pri meraní Huawei Northbound - stav drží
// Durable Object účtu. Čistá funkcia - stav dostane, texty vráti.

import { ZASUVKA } from './config.js';
import { fmt1 } from './format.js';
import { klimaUkaz } from './klima.js';
import { voiceTexts } from './messages-core.js';
import { TERAZ_BEZI } from './messages-teraz.js';
import { AUTO_NABIJA_TEXTS } from './auto-nabija.js';
import { bojlerSekcia, stavRiadenia, teplomerRiadok } from './nastavenie-bojler.js';
import { klimaSekcia, stavKlimy } from './nastavenie-klima.js';
import { stavZasuvky, zasuvkaSekcia } from './nastavenie-zasuvka.js';
import { bojlerRiadeny, TERAZ_BOJLER_TEXTS } from './teraz-bojler.js';
import { DOMA_DEVICES } from './doma.js';

/** Okná vecí v Nastavení: časť bojlera (riadenie, teplomer), klimatizácia, oznámenia auta a zásuvka každého spotrebiča. */
export const NS_OKNA = /** @type {const} */ (['bojler', 'teplomer', 'klima', 'auto', ...ZASUVKA.veci.map((v) => `zasuvka:${v}`)]);
/** @typedef {(typeof NS_OKNA)[number]} NsOkno */

export const DOMA_TEXTS = {
    /** V Čo máš doma sa auto volá celým menom, inde v appke ostáva „Auto“. @type {Record<string, string>} */
    nazvy: { auto: 'Elektromobil', klima: 'Klimatizácia' },
    nic: 'zatiaľ nič',
    neozyva: (/** @type {string} */ co) => `${co} sa neozýva`,
    neozyvaju: (/** @type {number} */ n) => `${n} sa neozývajú`,
    note: 'Plán dňa a ranné oznámenie rátajú len so zapnutým.',
    /** Prečo sa vec vypnúť nedá (L5b): kým sa jej zariadenie ozýva, karta Teraz ju ukazuje. */
    zamknute: { bojler: 'riadi ho zásuvka', klima: 'číta ju Shelly' },
    pripojenie: {
        zasuvka: 'Zásuvka Shelly',
        bojler: 'Riadenie zo zásuvky',
        teplomer: 'Teplomer',
        klima: 'Shelly, ktoré ju číta',
        auto: 'Oznámenia o nabíjaní',
    },
    nepripojena: 'nepripojená',
    nepripojene: 'nepripojené',
    nepripojeny: 'nepripojený',
    bezi: (/** @type {number} */ w) => `beží · ${fmt1(w / 1000)} kW`,
    auto: { vypnute: 'vypnuté', oba: 'začiatok a koniec', z: 'začiatok', k: 'koniec' },
    /** Oznámenie o konci platí pre všetky zásuvky (jeden odber telefónu). */
    zasuvkaOznamPozn: 'platí pre všetky zásuvky spotrebičov',
};

/** @typedef {{ tone: string, text: string }} Stav */
/** @typedef {{ okno: NsOkno, label: string, stav: Stav }} Pripojenie */
/** @typedef {{ key: 'bojler' | 'zasuvka' | 'z' | 'k', label: string, small: string, on: boolean }} OznamPrepinac */

/**
 * Stav, z ktorého sa sekcia skladá. Polia môžu chýbať: starý web/state.js z cache po nasadení ich nemá.
 * @typedef {{ zdroj: { sposob: string } | null, doma: readonly string[], now: Date, site: { timezone: string },
 *   voice: import('./messages-core.js').Voice, appSheet?: string | null,
 *   bojler: import('./bojler.js').BojlerInfo | null, bojlerPrahy: import('./bojler.js').Prahy,
 *   bojlerSkript: import('./nastavenie-bojler.js').BojlerSkript, teplomer?: import('./nastavenie-bojler.js').Teplomer,
 *   bojlerHranica?: 'uklada' | 'chyba' | null, bojlerOznam?: boolean, bojlerOznamStav?: 'uklada' | 'zakazane' | 'chyba' | null,
 *   klima?: { at: number } | null, klimaNast?: { ip: string }, klimaSkript?: import('./nastavenie-klima.js').KlimaSkript,
 *   zasuvky?: Record<string, import('./zasuvka.js').ZasuvkaInfo>, zasuvkaSkript?: import('./nastavenie-klima.js').KlimaSkript,
 *   zasuvkaOznam?: boolean, zasuvkaOznamStav?: 'uklada' | 'zakazane' | 'chyba' | null,
 *   autoOznam?: { z: boolean, k: boolean }, autoOznamStav?: 'uklada' | 'zakazane' | 'chyba' | null }} DomaState
 */

/**
 * Veci, ktoré sa vypnúť nedajú (L5b): bojler, ktorý riadi zásuvka, a klimatizácia, ktorej Shelly sa ozval - karta Teraz
 * ich vtedy ukazuje, nech je voľba akákoľvek. @param {DomaState} s @returns {Record<string, string>}
 */
export function zamknuteVeci(s) {
    const T = DOMA_TEXTS.zamknute;
    return {
        ...(bojlerRiadeny(s.bojler ?? null, s.now) ? { bojler: T.bojler } : {}),
        ...(klimaUkaz(s.klima ?? null, s.now.getTime()) ? { klima: T.klima } : {}),
    };
}

/** Čo má človek doma vrátane zamknutých vecí. @param {DomaState} s @returns {string[]} */
export const domaUcinne = (s) => [...new Set([...s.doma, ...Object.keys(zamknuteVeci(s))])];

/** Oznámenia auta jedným slovom. @param {{ z: boolean, k: boolean }} o @returns {Stav} */
function stavAuta(o) {
    const T = DOMA_TEXTS.auto;
    if (!o.z && !o.k) return { tone: 'wait', text: T.vypnute };
    return { tone: 'ok', text: o.z && o.k ? T.oba : o.z ? T.z : T.k };
}

/**
 * Riadok zásuvky spotrebiča: nepripojená, beží s príkonom, alebo kedy sa ozvala. @param {DomaState} s @param {string} vec
 * @returns {Stav}
 */
function riadokZasuvky(s, vec) {
    const z = s.zasuvky?.[vec];
    if (!z) return { tone: 'wait', text: DOMA_TEXTS.nepripojena };
    const stav = stavZasuvky(s, vec);
    return stav.tone === 'ok' && z.bezi ? { tone: 'ok', text: DOMA_TEXTS.bezi(z.w) } : stav;
}

/**
 * Pripojenia zapnutej veci (len Huawei Northbound).
 * @param {DomaState} s @param {string} id @returns {Pripojenie[]}
 */
function pripojenia(s, id) {
    const P = DOMA_TEXTS.pripojenie;
    const tz = s.site.timezone;
    if (ZASUVKA.veci.includes(id)) {
        return [{ okno: /** @type {NsOkno} */ (`zasuvka:${id}`), label: P.zasuvka, stav: riadokZasuvky(s, id) }];
    }
    if (id === 'bojler') {
        const b = s.bojler ?? null;
        return [
            { okno: 'bojler', label: P.bojler, stav: b ? stavRiadenia(b, s.now, tz) : { tone: 'wait', text: DOMA_TEXTS.nepripojene } },
            {
                okno: 'teplomer',
                label: P.teplomer,
                stav: s.teplomer?.on ? teplomerRiadok(b, s.now, tz) : { tone: 'wait', text: DOMA_TEXTS.nepripojeny },
            },
        ];
    }
    if (id === 'klima') {
        const k = s.klima ?? null;
        return [{ okno: 'klima', label: P.klima, stav: k ? stavKlimy(k, s.now, tz) : { tone: 'wait', text: DOMA_TEXTS.nepripojena } }];
    }
    if (id === 'auto') return [{ okno: 'auto', label: P.auto, stav: stavAuta(s.autoOznam ?? { z: false, k: false }) }];
    return [];
}

/**
 * Prepínače oznámení v okne (P3) a prečo sa zmena nepodarila. @param {DomaState} s @param {NsOkno} okno
 * @returns {{ prepinace: OznamPrepinac[], busy: boolean, chyba: string }}
 */
function oznamOkna(s, okno) {
    /** @param {'uklada' | 'zakazane' | 'chyba' | null | undefined} stav @param {{ zakazane: string, chyba: string }} T */
    const chyba = (stav, T) => (stav === 'zakazane' ? T.zakazane : stav === 'chyba' ? T.chyba : '');
    if (okno === 'bojler') {
        const T = TERAZ_BOJLER_TEXTS.oznam;
        return {
            prepinace: [{ key: 'bojler', label: T.nazov, small: '', on: s.bojlerOznam ?? false }],
            busy: s.bojlerOznamStav === 'uklada',
            chyba: chyba(s.bojlerOznamStav, T),
        };
    }
    if (okno === 'auto') {
        const T = AUTO_NABIJA_TEXTS;
        const o = s.autoOznam ?? { z: false, k: false };
        return {
            prepinace: [
                { key: 'z', label: T.oznamZ, small: '', on: o.z },
                { key: 'k', label: T.oznamK, small: '', on: o.k },
            ],
            busy: s.autoOznamStav === 'uklada',
            chyba: chyba(s.autoOznamStav, T),
        };
    }
    if (okno.startsWith('zasuvka:')) {
        const T = TERAZ_BEZI.zasuvka;
        return {
            prepinace: [{ key: 'zasuvka', label: T.oznam, small: DOMA_TEXTS.zasuvkaOznamPozn, on: s.zasuvkaOznam ?? false }],
            busy: s.zasuvkaOznamStav === 'uklada',
            chyba: chyba(s.zasuvkaOznamStav, T),
        };
    }
    return { prepinace: [], busy: false, chyba: '' };
}

/**
 * Otvorené okno veci: nadpis („Bojler › Teplomer“), ktorá časť sa ukáže, oznámenia a obsah časti. Okno, ktoré k žiadnej
 * zapnutej veci nepatrí (vec vypnutá, iný zdroj merania), je null.
 * @param {DomaState} s @param {Array<{ id: string, name: string, pripojenia: Pripojenie[] }>} veci
 */
function oknoModel(s, veci) {
    const id = NS_OKNA.find((o) => o === s.appSheet);
    const vec = id && veci.find((v) => v.pripojenia.some((p) => p.okno === id));
    if (!id || !vec) return null;
    const p = /** @type {Pripojenie} */ (vec.pripojenia.find((x) => x.okno === id));
    const ucinne = { ...s, doma: domaUcinne(s) };
    return {
        id,
        title: `${vec.name} › ${p.label}`,
        cast: id.startsWith('zasuvka:') ? 'zasuvka' : id,
        ...oznamOkna(s, id),
        bojler: id === 'bojler' || id === 'teplomer' ? bojlerSekcia(ucinne) : null,
        klima: id === 'klima' ? klimaSekcia(s) : null,
        zasuvka: id.startsWith('zasuvka:') ? zasuvkaSekcia({ ...s, zasuvkaVec: id.slice('zasuvka:'.length) }) : null,
    };
}

/**
 * Sekcia Čo máš doma: nadpis s tým, čo je zapnuté a čo sa neozýva (L10), riadky vecí s pripojeniami a otvorené okno.
 * @param {DomaState} s @param {string} title
 */
export function domaSekcia(s, title) {
    const T = DOMA_TEXTS;
    const names = voiceTexts(s.voice).MOZEM_ITEM_TEXTS;
    const meno = (/** @type {string} */ id) => T.nazvy[id] ?? names[id].name;
    const huawei = s.zdroj?.sposob === 'huawei-northbound';
    const zamk = zamknuteVeci(s);
    const ucinne = domaUcinne(s);
    const veci = DOMA_DEVICES.map((id) => {
        const on = ucinne.includes(id);
        return { id, name: meno(id), on, zamknute: zamk[id] ?? '', pripojenia: on && huawei ? pripojenia(s, id) : [] };
    });
    const zapnute = veci.filter((v) => v.on).map((v, i) => (i ? v.name.toLowerCase() : v.name));
    const tiche = veci.filter((v) => v.pripojenia.some((p) => p.stav.tone === 'stale'));
    const neozyva = tiche.length > 1 ? T.neozyvaju(tiche.length) : tiche.length ? T.neozyva(tiche[0].name) : '';
    const zoznam = zapnute.length ? listText(zapnute) : T.nic;
    return {
        title,
        hint: neozyva ? `${zoznam} · ${neozyva}` : zoznam,
        veci,
        note: T.note,
        okno: oknoModel(s, veci),
    };
}

/** Zoznam slovom: „juh“, „juh a východ“, „juh, východ a západ“. @param {string[]} items */
export function listText(items) {
    return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} a ${items[items.length - 1]}`;
}
