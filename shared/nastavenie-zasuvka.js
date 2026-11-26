// Nastavenie › Čo máš doma › Spotrebič na zásuvke (docs/navrhy/pracka-zasuvka.html, A + S2): ktorý spotrebič je na
// zásuvke Shelly, kedy sa jeho zásuvka naposledy ozvala a skript do nej. Len pri meraní Huawei Northbound - beh rozozná
// Durable Object účtu. Čistá funkcia - stav dostane, texty vráti.

import { MOZEM_ITEMS, ZASUVKA } from './config.js';
import { minutesToTimeStr } from './format.js';
import { polite } from './messages-core.js';
import { localDateKey, localMinutes } from './solar.js';
import { meria } from './zasuvka.js';

export const ZASUVKA_NAST_TEXTS = {
    title: 'Spotrebič na zásuvke Shelly',
    intro: 'Zásuvka každú minútu pošle appke, koľko spotrebič berie. Appka z toho vie, kedy beží a kedy dobehol. Zásuvku nikdy nevypne.',
    vec: 'Čo je na zásuvke',
    stav: 'Zásuvka',
    nikdy: 'ešte sa neozvala',
    ok: (/** @type {string} */ kedy) => `ozvala sa o ${kedy}`,
    mlci: (/** @type {string} */ kedy) => `neozýva sa od ${kedy}`,
    tlacidlo: /** @type {[string, string]} */ (['Skopíruj skript do zásuvky', 'Skopírovať skript do zásuvky']),
    robim: 'Pripravujem skript…',
    hotovo: /** @type {[string, string]} */ ([
        'Skript je v schránke. Vlož ho do zásuvky podľa krokov nižšie.',
        'Skript je v schránke. Vložte ho do zásuvky podľa krokov nižšie.',
    ]),
    rucne: /** @type {[string, string]} */ ([
        'Schránka nie je dostupná. Skopíruj skript z poľa nižšie.',
        'Schránka nie je dostupná. Skopírujte skript z poľa nižšie.',
    ]),
    chyba: /** @type {[string, string]} */ ([
        'Skript sa nepodarilo pripraviť. Skús to znova o chvíľu.',
        'Skript sa nepodarilo pripraviť. Skúste to znova o chvíľu.',
    ]),
    kroky: /** @type {Array<[string, string]>} */ ([
        [
            'V prehliadači otvor zásuvku so spotrebičom cez jej adresu v domácej sieti a choď do Scripts › Create script.',
            'V prehliadači otvorte zásuvku so spotrebičom cez jej adresu v domácej sieti a choďte do Scripts › Create script.',
        ],
        ['Vlož skopírovaný text a ulož ho.', 'Vložte skopírovaný text a uložte ho.'],
        ['Zapni Run on startup a skript spusti.', 'Zapnite Run on startup a skript spustite.'],
        [
            'Každý spotrebič má vlastnú zásuvku a vlastný skript. Do zásuvky s bojlerom tento skript nepatrí.',
            'Každý spotrebič má vlastnú zásuvku a vlastný skript. Do zásuvky s bojlerom tento skript nepatrí.',
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
 * Riadok o zásuvke: kedy sa ozvala; tón ako stav merania (`ok` hlási, `stale` mlčí, `wait` ešte sa neozvala).
 * @param {{ zasuvky?: Record<string, import('./zasuvka.js').ZasuvkaInfo>, now: Date, site: { timezone: string } }} s
 * @param {string} vec
 */
function stavZasuvky(s, vec) {
    const T = ZASUVKA_NAST_TEXTS;
    const z = s.zasuvky?.[vec];
    if (!z) return { tone: 'wait', text: T.nikdy };
    const cas = kedy(z.at, s.now, s.site.timezone);
    return meria(s.zasuvky, vec, s.now.getTime()) ? { tone: 'ok', text: T.ok(cas) } : { tone: 'stale', text: T.mlci(cas) };
}

/**
 * Sekcia spotrebiča na zásuvke, alebo null pri inom zdroji merania než Huawei Northbound. Polia môžu chýbať: starý
 * web/state.js z cache po nasadení ich nemá (CLAUDE.md, Nasadenie a cache).
 * @param {{ zdroj: { sposob: string } | null, zasuvky?: Record<string, import('./zasuvka.js').ZasuvkaInfo>, zasuvkaVec?: string,
 *   zasuvkaSkript?: import('./nastavenie-klima.js').KlimaSkript, now: Date, site: { timezone: string },
 *   voice: import('./messages-core.js').Voice }} s
 */
export function zasuvkaSekcia(s) {
    if (s.zdroj?.sposob !== 'huawei-northbound') return null;
    const T = ZASUVKA_NAST_TEXTS;
    const v = (/** @type {string | [string, string]} */ t) => (typeof t === 'string' ? t : t[polite(s.voice) ? 1 : 0]);
    const vec = s.zasuvkaVec ?? ZASUVKA.veci[0];
    const stav = stavZasuvky(s, vec);
    const sk = s.zasuvkaSkript ?? { stav: 'nic', text: '', schranka: false };
    const sprava = { nic: '', robim: T.robim, hotovo: v(sk.schranka ? T.hotovo : T.rucne), chyba: v(T.chyba), adresa: v(T.chyba) }[sk.stav];
    return {
        title: T.title,
        intro: T.intro,
        vecLabel: T.vec,
        veci: ZASUVKA.veci.map((id) => ({ id, label: MOZEM_ITEMS.find((i) => i.id === id)?.device ?? id, on: id === vec })),
        stavLabel: T.stav,
        stav,
        tlacidlo: v(T.tlacidlo),
        robim: sk.stav === 'robim',
        sprava: sprava ? { text: sprava, chyba: sk.stav === 'chyba' || sk.stav === 'adresa' } : null,
        skript: sk.stav === 'hotovo' && !sk.schranka ? sk.text : '',
        kroky: T.kroky.map(v),
    };
}
