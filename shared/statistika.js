// Karta Štatistika v novej appke „Živá obloha“ (obloha/). Plagát obdobia je ten istý ako v súčasnej
// appke (summaryModel); tu sa k nemu skladajú stavy karty, ktoré má len nová appka: bez polohy, bez
// panelov, načítavanie a bez dát. Súčty za mesiac, rok a celý čas posiela len kiosk - bez neho karta
// ukáže dnešok z predpovede a výzvu pripojiť meranie, nič si nedoskladá. Čisté funkcie, čas aj dáta
// prichádzajú v parametroch. Texty sú v shared/messages.js.

import { installedKw } from './config.js';
import { kwpText } from './format.js';
import { voiceTexts } from './messages.js';
import { offlineLead } from './mozem-sky.js';
import { summaryModel } from './summary.js';

/**
 * @typedef {import('./summary.js').SummaryInput & { known: import('./settings.js').Known,
 *   plant: import('./config.js').Plant }} StatistikaInput
 * @typedef {import('./stats.js').StatsPeriod} StatsPeriod
 */

/**
 * Model karty pre zvolené obdobie. `kind`: `ask` (appka nepozná polohu), `setup` (poloha bez
 * panelov - štatistika je o vlastnej elektrárni, nie o typickej streche), `loading` (prvé
 * načítanie), `offline` (nie je meranie ani predpoveď), `ok`. Pri `ok` je `summary` plagát obdobia
 * a bez živého merania `measure` hovorí, či ide výzva pripojiť meranie (`ask`), alebo veta, že
 * neodpovedá (`off`). `prices` je výzva doplniť ceny v tarife.
 * @param {StatistikaInput} input @param {StatsPeriod} period
 * @param {{ online?: boolean, voice?: import('./messages.js').Voice }} [opts] či má telefón internet a tón hlášok
 */
export function statistikaModel(input, period, { online = true, voice = 'drzy' } = {}) {
    const STATISTIKA_TEXTS = voiceTexts(voice).STATISTIKA_TEXTS;
    const base = {
        kind: /** @type {'ask' | 'setup' | 'loading' | 'offline' | 'ok'} */ ('ok'),
        sub: '',
        retry: false,
        summary: /** @type {import('./summary.js').SummaryModel | null} */ (null),
        measure: /** @type {'ask' | 'off' | null} */ (null),
        prices: false,
    };
    if (input.known === 'nic') return { ...base, kind: /** @type {const} */ ('ask') };
    if (input.known === 'poloha') return { ...base, kind: /** @type {const} */ ('setup'), sub: STATISTIKA_TEXTS.setupSub };
    const s = summaryModel(input, period, voice);
    if (s.status === 'loading') return { ...base, kind: /** @type {const} */ ('loading'), sub: STATISTIKA_TEXTS.loading };
    if (!input.pv && !input.forecast)
        return { ...base, kind: /** @type {const} */ ('offline'), sub: offlineLead(input, online, voice), retry: true };
    return {
        ...base,
        sub: kwpText(installedKw(input.plant)),
        summary: s.kind === 'none' ? null : s,
        measure: s.kind === 'live' ? null : s.status === 'offline' ? /** @type {const} */ ('off') : /** @type {const} */ ('ask'),
        prices: !s.priced,
    };
}

/** @typedef {ReturnType<typeof statistikaModel>} StatistikaModel */
