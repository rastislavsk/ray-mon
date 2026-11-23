// Nastavenie › Čo máš doma › Bojler na prebytky (docs/navrhy/bojler-prebytky.html, časť 4): prahy,
// stav zásuvky a skript do nej. Len pri meraní cez Huawei Northbound (iné zdroje elektromer
// nemajú) a s bojlerom medzi spotrebičmi. Čistá funkcia - stav dostane, texty vráti.

import { BOJLER } from './config.js';
import { bojlerStav } from './bojler.js';
import { stupne, vodaTeraz } from './bojler-voda.js';
import { fmt1, minutesToTimeStr } from './format.js';
import { polite } from './messages-core.js';
import { localDateKey, localMinutes } from './solar.js';
import { isObj } from './valid.js';

/** @typedef {import('./bojler.js').Prahy} Prahy */
/** @typedef {import('./bojler.js').BojlerInfo} BojlerInfo */
/**
 * Príprava skriptu: `nic` ešte nebola, `robim` appka pýta pečať, `hotovo` skript je v schránke
 * (a v `text` na ručné skopírovanie), `chyba` nevyšlo, `teplomer` chýba adresa či heslo teplomera.
 * @typedef {{ stav: 'nic' | 'robim' | 'hotovo' | 'chyba' | 'teplomer', text: string, schranka: boolean }} BojlerSkript
 */
/**
 * Teplomer v bojleri (docs/navrhy/bojler-teplota.html, N2): či ho človek má a jeho adresa v domácej sieti. Heslo
 * appka nedrží - je len v poli formulára a v skripte.
 * @typedef {{ on: boolean, ip: string }} Teplomer
 */

/** Teplomer z úložiska, alebo vypnutý bez adresy. @param {unknown} raw @returns {Teplomer} */
export function teplomerZ(raw) {
    const o = isObj(raw) ? /** @type {Record<string, unknown>} */ (raw) : {};
    return { on: o.on === true, ip: typeof o.ip === 'string' ? o.ip.slice(0, 63) : '' };
}

/** @param {string | [string, string]} t @param {import('./messages-core.js').Voice} voice */
const inVoice = (t, voice) => (typeof t === 'string' ? t : t[polite(voice) ? 1 : 0]);

export const BOJLER_TEXTS = {
    title: 'Bojler na prebytky',
    intro: 'Zásuvka Shelly s bojlerom ho zapne, keď strecha posiela do siete dosť, a vypne, keď prebytok klesne. Beží aj bez telefónu.',
    zap: 'Zapni od',
    vyp: 'Vypni pod',
    prahSmall: 'prebytok bez bojlera, dve merania po sebe',
    menej: 'Menej',
    viac: 'Viac',
    zasuvka: 'Zásuvka',
    nikdy: 'ešte sa neozvala',
    stavy: {
        hreje: 'hreje',
        caka: 'čaká na prebytok',
        hotovo: 'voda nahriata',
        vypnuty: 'vypnutý ručne',
    },
    mlci: 'neozvala sa od',
    ine: /** @type {[string, string]} */ ([
        'Zásuvka má prahy {zap} a {vyp} kW. Skopíruj skript znova.',
        'Zásuvka má prahy {zap} a {vyp} kW. Skopírujte skript znova.',
    ]),
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
    teplomer: {
        label: 'Mám teplomer v bojleri',
        small: 'zásuvka prečíta teplotu vody zo Shelly s Add-onom',
        voda: (/** @type {string} */ t, /** @type {string} */ kedy) => `voda ${t} o ${kedy}`,
        mlci: (/** @type {string} */ kedy) => `neodpovedá od ${kedy} – skontroluj adresu a heslo`,
        caka: 'zatiaľ bez teploty – vlož skript do zásuvky znova',
        ip: 'Adresa teplomera v domácej sieti',
        heslo: 'Heslo teplomera (meno admin)',
        pozn: 'Heslo appka neuloží, ide len do skriptu zásuvky.',
        chyba: /** @type {[string, string]} */ (['Doplň adresu a heslo teplomera.', 'Doplňte adresu a heslo teplomera.']),
    },
    kroky: /** @type {Array<[string, string]>} */ ([
        [
            'V prehliadači otvor zásuvku cez jej adresu v domácej sieti a choď do Scripts › Create script.',
            'V prehliadači otvorte zásuvku cez jej adresu v domácej sieti a choďte do Scripts › Create script.',
        ],
        ['Vlož skopírovaný text a ulož ho.', 'Vložte skopírovaný text a uložte ho.'],
        ['Zapni Run on startup a skript spusti.', 'Zapnite Run on startup a skript spustite.'],
        [
            'V zásuvke vypni rozvrhy, ktoré bojler zapínajú či vypínajú. Inak by sa s riadením bili.',
            'V zásuvke vypnite rozvrhy, ktoré bojler zapínajú či vypínajú. Inak by sa s riadením bili.',
        ],
        ['Riadenie vypneš tak, že skript v zásuvke zastavíš.', 'Riadenie vypnete tak, že skript v zásuvke zastavíte.'],
    ]),
};

/** Čas kontaktu: „o 10:32“ dnes, inak aj s dátumom. @param {number} at @param {Date} now @param {string} tz */
function kedy(at, now, tz) {
    const d = new Date(at);
    const cas = minutesToTimeStr(localMinutes(d, tz));
    if (localDateKey(d, tz) === localDateKey(now, tz)) return cas;
    const [, m, den] = localDateKey(d, tz).split('-');
    return `${Number(den)}. ${Number(m)}. ${cas}`;
}

/**
 * Riadok o zásuvke: kedy sa ozvala a čo robí bojler; tón ako stav merania (`ok` beží, `stale`
 * mlčí, `wait` ešte sa neozvala - tlmené).
 * @param {BojlerInfo | null} b @param {Date} now @param {string} tz
 */
function stavZasuvky(b, now, tz) {
    const T = BOJLER_TEXTS;
    if (!b) return { tone: 'wait', text: T.nikdy };
    const stav = bojlerStav(b, now.getTime());
    if (stav === 'mlci') return { tone: 'stale', text: `${T.mlci} ${kedy(b.kontaktAt, now, tz)}` };
    const vykon = stav === 'hreje' ? ` ${fmt1(b.w / 1000)} kW` : '';
    const prebytok = stav === 'caka' && b.prebytokKw !== null ? ` (teraz ${fmt1(b.prebytokKw)} kW)` : '';
    return { tone: 'ok', text: `${kedy(b.kontaktAt, now, tz)} · ${T.stavy[stav]}${vykon}${prebytok}` };
}

/**
 * Riadok pod prepínačom teplomera: posledná teplota, alebo odkedy teplomer mlčí; bez teplomera čo robí.
 * @param {BojlerInfo | null} b @param {boolean} on @param {Date} now @param {string} tz
 */
function stavTeplomera(b, on, now, tz) {
    const T = BOJLER_TEXTS.teplomer;
    const voda = b ? vodaTeraz(b, now.getTime()) : null;
    if (voda) return T.voda(stupne(voda.t), kedy(voda.at, now, tz));
    if (b?.voda) return T.mlci(kedy(b.voda.at, now, tz));
    return on ? T.caka : T.small;
}

/**
 * Sekcia bojlera, alebo null, keď sa riadiť nedá (iný zdroj merania, bojler nie je doma).
 * @param {{ zdroj: { sposob: string } | null, doma: readonly string[], bojler: BojlerInfo | null, bojlerPrahy: Prahy,
 *   bojlerSkript: BojlerSkript, now: Date, site: { timezone: string }, voice: import('./messages-core.js').Voice, teplomer?: Teplomer }} s
 */
export function bojlerSekcia(s) {
    if (s.zdroj?.sposob !== 'huawei-northbound' || !s.doma.includes('bojler')) return null;
    const T = BOJLER_TEXTS;
    const p = s.bojlerPrahy;
    const prah = (/** @type {'zapKw' | 'vypKw'} */ k, /** @type {string} */ label) => ({
        key: k,
        label,
        value: `${fmt1(p[k])} kW`,
        menej: p[k] > BOJLER.minKw + (k === 'zapKw' ? BOJLER.medzeraKw : 0) + 1e-9,
        viac: p[k] < BOJLER.maxKw - (k === 'vypKw' ? BOJLER.medzeraKw : 0) - 1e-9,
    });
    const b = s.bojler;
    const v = (/** @type {string | [string, string]} */ t) => inVoice(t, s.voice);
    const ine =
        b && Math.abs(b.prahy.zapKw - p.zapKw) + Math.abs(b.prahy.vypKw - p.vypKw) > 1e-9
            ? v(T.ine).replace('{zap}', fmt1(b.prahy.zapKw)).replace('{vyp}', fmt1(b.prahy.vypKw))
            : '';
    const sk = s.bojlerSkript;
    const sprava = {
        nic: '',
        robim: T.robim,
        hotovo: v(sk.schranka ? T.hotovo : T.rucne),
        chyba: v(T.chyba),
        teplomer: v(T.teplomer.chyba),
    }[sk.stav];
    // `?? `: starý web/state.js z cache po nasadení teplomer nemá (CLAUDE.md, Nasadenie a cache).
    const tp = s.teplomer ?? teplomerZ(null);
    return {
        title: T.title,
        intro: T.intro,
        prahSmall: T.prahSmall,
        menej: T.menej,
        viac: T.viac,
        prahy: [prah('zapKw', T.zap), prah('vypKw', T.vyp)],
        zasuvka: T.zasuvka,
        stav: stavZasuvky(b, s.now, s.site.timezone),
        ine,
        tlacidlo: v(T.tlacidlo),
        robim: sk.stav === 'robim',
        sprava: sprava ? { text: sprava, chyba: sk.stav === 'chyba' || sk.stav === 'teplomer' } : null,
        teplomer: {
            label: T.teplomer.label,
            small: stavTeplomera(b, tp.on, s.now, s.site.timezone),
            on: tp.on,
            ip: tp.ip,
            ipLabel: T.teplomer.ip,
            hesloLabel: T.teplomer.heslo,
            pozn: T.teplomer.pozn,
        },
        skript: sk.stav === 'hotovo' && !sk.schranka ? sk.text : '',
        kroky: T.kroky.map(v),
    };
}
