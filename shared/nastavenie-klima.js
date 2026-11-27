// Nastavenie › Čo máš doma › Klimatizácia (docs/navrhy/klima-daikin.html, cesta A): adresa klimatizácie v domácej sieti,
// kedy sa naposledy ozvala a skript na Shelly. Len pri meraní Huawei Northbound - stav drží Durable Object účtu.
// Čistá funkcia - stav dostane, texty vráti.

import { minutesToTimeStr } from './format.js';
import { klimaSpojena } from './klima.js';
import { polite } from './messages-core.js';
import { localDateKey, localMinutes } from './solar.js';
import { isObj } from './valid.js';

/**
 * Príprava skriptu: `nic` ešte nebola, `robim` appka pýta pečať, `hotovo` skript je v schránke (a v `text` na ručné
 * skopírovanie), `chyba` nevyšlo, `adresa` chýba či nesedí adresa klimatizácie.
 * @typedef {{ stav: 'nic' | 'robim' | 'hotovo' | 'chyba' | 'adresa', text: string, schranka: boolean }} KlimaSkript
 */

/** Adresa klimatizácie z úložiska (KLIMA_STORAGE_KEY), alebo prázdna. @param {unknown} raw @returns {{ ip: string }} */
export function klimaNastZ(raw) {
    const o = isObj(raw) ? /** @type {Record<string, unknown>} */ (raw) : {};
    return { ip: typeof o.ip === 'string' ? o.ip.slice(0, 63) : '' };
}

export const KLIMA_NAST_TEXTS = {
    intro: 'Shelly v domácej sieti každú minútu prečíta stav klimatizácie a pošle ho appke. Klimatizáciu nijako neriadi.',
    ip: 'Adresa klimatizácie v domácej sieti',
    stav: 'Klimatizácia',
    nikdy: 'ešte sa neozvala',
    ok: (/** @type {string} */ kedy) => `ozvala sa o ${kedy}`,
    mlci: (/** @type {string} */ kedy) => `neozýva sa od ${kedy}`,
    tlacidlo: /** @type {[string, string]} */ (['Skopíruj skript do Shelly', 'Skopírovať skript do Shelly']),
    robim: 'Pripravujem skript…',
    hotovo: /** @type {[string, string]} */ ([
        'Skript je v schránke. Vlož ho do Shelly podľa krokov nižšie.',
        'Skript je v schránke. Vložte ho do Shelly podľa krokov nižšie.',
    ]),
    rucne: /** @type {[string, string]} */ ([
        'Schránka nie je dostupná. Skopíruj skript z poľa nižšie.',
        'Schránka nie je dostupná. Skopírujte skript z poľa nižšie.',
    ]),
    chyba: /** @type {[string, string]} */ ([
        'Skript sa nepodarilo pripraviť. Skús to znova o chvíľu.',
        'Skript sa nepodarilo pripraviť. Skúste to znova o chvíľu.',
    ]),
    adresa: /** @type {[string, string]} */ ([
        'Doplň adresu klimatizácie, napr. 10.10.10.148.',
        'Doplňte adresu klimatizácie, napr. 10.10.10.148.',
    ]),
    kroky: /** @type {Array<[string, string]>} */ ([
        [
            'V prehliadači otvor Shelly, ktoré má klimatizáciu čítať, cez jeho adresu v domácej sieti a choď do Scripts › Create script.',
            'V prehliadači otvorte Shelly, ktoré má klimatizáciu čítať, cez jeho adresu v domácej sieti a choďte do Scripts › Create script.',
        ],
        ['Vlož skopírovaný text a ulož ho.', 'Vložte skopírovaný text a uložte ho.'],
        ['Zapni Run on startup a skript spusti.', 'Zapnite Run on startup a skript spustite.'],
        [
            'Hodí sa Shelly, ktoré je v sieti stále zapnuté, napr. to s teplomerom v bojleri. Do zásuvky s bojlerom ani so spotrebičom skript nepatrí.',
            'Hodí sa Shelly, ktoré je v sieti stále zapnuté, napr. to s teplomerom v bojleri. Do zásuvky s bojlerom ani so spotrebičom skript nepatrí.',
        ],
    ]),
};

/** Čas: „10:32“ dnes, inak aj s dátumom. @param {number} at @param {Date} now @param {string} tz */
function kedy(at, now, tz) {
    const d = new Date(at);
    const cas = minutesToTimeStr(localMinutes(d, tz));
    if (localDateKey(d, tz) === localDateKey(now, tz)) return cas;
    const [, m, den] = localDateKey(d, tz).split('-');
    return `${Number(den)}. ${Number(m)}. ${cas}`;
}

/**
 * Riadok o klimatizácii: kedy sa ozvala; tón ako stav merania (`ok` hlási, `stale` mlčí, `wait` ešte sa neozvala).
 * @param {{ at: number } | null} k @param {Date} now @param {string} tz
 */
export function stavKlimy(k, now, tz) {
    const T = KLIMA_NAST_TEXTS;
    if (!k) return { tone: 'wait', text: T.nikdy };
    return klimaSpojena(k, now.getTime())
        ? { tone: 'ok', text: T.ok(kedy(k.at, now, tz)) }
        : { tone: 'stale', text: T.mlci(kedy(k.at, now, tz)) };
}

/**
 * Sekcia klimatizácie, alebo null pri inom zdroji merania než Huawei Northbound. Polia klimatizácie môžu chýbať: starý
 * web/state.js z cache po nasadení ich nemá (CLAUDE.md, Nasadenie a cache).
 * @param {{ zdroj: { sposob: string } | null, klima?: { at: number } | null, klimaNast?: { ip: string },
 *   klimaSkript?: KlimaSkript, now: Date, site: { timezone: string }, voice: import('./messages-core.js').Voice }} s
 */
export function klimaSekcia(s) {
    if (s.zdroj?.sposob !== 'huawei-northbound') return null;
    const T = KLIMA_NAST_TEXTS;
    const v = (/** @type {string | [string, string]} */ t) => (typeof t === 'string' ? t : t[polite(s.voice) ? 1 : 0]);
    const stav = stavKlimy(s.klima ?? null, s.now, s.site.timezone);

    const sk = s.klimaSkript ?? { stav: 'nic', text: '', schranka: false };
    const sprava = { nic: '', robim: T.robim, hotovo: v(sk.schranka ? T.hotovo : T.rucne), chyba: v(T.chyba), adresa: v(T.adresa) }[
        sk.stav
    ];
    return {
        intro: T.intro,
        ipLabel: T.ip,
        ip: s.klimaNast?.ip ?? '',
        stavLabel: T.stav,
        stav,
        tlacidlo: v(T.tlacidlo),
        robim: sk.stav === 'robim',
        sprava: sprava ? { text: sprava, chyba: sk.stav === 'chyba' || sk.stav === 'adresa' } : null,
        skript: sk.stav === 'hotovo' && !sk.schranka ? sk.text : '',
        kroky: T.kroky.map(v),
    };
}
