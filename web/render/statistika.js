// Karta Štatistika: výroba za dnes, mesiac, rok a celý čas a jej hodnota podľa tarify.
// Celý obsah karty skladá render do #stats-body - v index.html sú len nosiče, takže ďalší
// prvok v karte nepotrebuje dve nasadenia (viď CLAUDE.md). Počíta shared/stats.js.

import { installedKw } from '../../shared/config.js';
import { escapeHtml, fmt1, fmtSum, kwpText } from '../../shared/format.js';
import { EMPTY_MESSAGES } from '../../shared/messages.js';
import { STATS_PERIODS, statsModel } from '../../shared/stats.js';
import { SETUP_ICONS } from '../icons.js';
import { writeHtml } from '../memo.js';

/** @typedef {ReturnType<typeof statsModel>} StatsModel */

/** Popisky prepínača obdobia. */
const PERIOD_LABELS = { dnes: 'Dnes', mesiac: 'Mesiac', rok: 'Rok', spolu: 'Spolu' };

/** kWh do textu: „31,7“, od tisíc „9 112“; bez údaja pomlčka. @param {number | null} kwh */
export const kwhText = (kwh) => (kwh === null ? '–' : fmtSum(kwh, 1));

/** Peniaze do textu: „4,78 €“, od tisíc „1 297 €“. @param {number} value @param {string} currency */
export const moneyText = (value, currency) => `${fmtSum(value, 2)} ${currency}`;

/** Výzva, ktorá vedie do Nastavenia (data-stats-go, viď initStats vo web/interactions.js).
 * @param {string} go krok sprievodcu, alebo `nastavenie` pre samotnú kartu @param {string} title @param {string} text */
function goHtml(go, title, text) {
    return (
        `<button type="button" class="choice stats-go" data-stats-go="${go}">` +
        `<span class="t"><b>${escapeHtml(title)}</b><span>${escapeHtml(text)}</span></span>${SETUP_ICONS.chevron}</button>`
    );
}

/** @param {import('../../shared/stats.js').StatsPeriod} period */
function segHtml(period) {
    const buttons = STATS_PERIODS.map(
        (p) => `<button type="button" data-stats-period="${p}" aria-pressed="${p === period}">${PERIOD_LABELS[p]}</button>`,
    ).join('');
    return `<div class="seg" role="group" aria-label="Obdobie">${buttons}</div>`;
}

/** Veľké číslo obdobia, eurá, pri dnešku pásik voči predpovedi a pri mesiaci a roku priemer.
 * @param {StatsModel} m */
function heroHtml(m) {
    const h = m.hero;
    let html = `<div class="stats-hero"><span class="lbl">${escapeHtml(h.heading)}</span>`;
    html += `<div class="stats-num"><span class="num">${kwhText(h.kwh)}</span><span class="u">kWh</span></div>`;
    if (h.value !== null) html += `<div class="stats-eur">${moneyText(h.value, m.currency)}<small>hodnota podľa tarify</small></div>`;
    if (m.progress && m.forecastToday) {
        const pct = Math.max(0, Math.min(100, m.progress.pct));
        html +=
            `<div><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>` +
            `<div class="progress-caption"><span>z predpovede <b>${fmt1(m.forecastToday.kwh)} kWh</b></span><span><b>${m.progress.pct} %</b></span></div></div>`;
    }
    if (h.perDay !== null) html += `<div class="stats-meta">ø <b>${fmt1(h.perDay)} kWh</b> za deň</div>`;
    return `${html}</div>`;
}

/** Ostatné obdobia pod veľkým číslom. @param {StatsModel} m */
function rowsHtml(m) {
    const rows = m.rows
        .map(
            (r) =>
                `<div class="stats-row"><span class="k">${escapeHtml(r.label)}</span><span class="v">${kwhText(r.kwh)} kWh</span>` +
                `<span class="e">${r.value === null ? '' : moneyText(r.value, m.currency)}</span></div>`,
        )
        .join('');
    return `<div class="stats-rows">${rows}</div>`;
}

/** Bez merania: dnešok podľa predpovede. @param {StatsModel} m */
function forecastHtml(m) {
    if (!m.forecastToday) return `<p class="stats-note">${escapeHtml(EMPTY_MESSAGES.forecast.body)}</p>`;
    const f = m.forecastToday;
    return (
        `<div class="stats-hero"><span class="lbl">Dnes podľa predpovede</span>` +
        `<div class="stats-num"><span class="num">${fmt1(f.kwh)}</span><span class="u">kWh</span></div>` +
        (f.value === null ? '' : `<div class="stats-eur">≈ ${moneyText(f.value, m.currency)}<small>hodnota podľa tarify</small></div>`) +
        `</div>`
    );
}

/** Obsah karty podľa toho, čo appka o elektrárni vie. @param {StatsModel} m @param {boolean} demo */
export function statsHtml(m, demo) {
    if (m.status === 'loading') return `<p class="stats-note">Načítavam…</p>`;
    // Ukážka: namiesto výziev na ceny a meranie jediná - nastaviť si vlastnú elektráreň.
    if (demo)
        return (
            forecastHtml(m) +
            goHtml('nastavenie', 'Nastav si svoju elektráreň', 'Štatistika je o tvojej elektrárni, nie o ukážke v Londýne.')
        );
    const prices = m.priced ? '' : goHtml('ceny', 'Doplň ceny v tarife', 'Uvidíš, akú hodnotu má vyrobená elektrina v peniazoch.');
    if (m.status === 'live') {
        const note = m.priced
            ? `<p class="stats-note">Hodnota je to, čo by si za túto elektrinu zaplatil zo siete podľa svojej tarify. Koľko z nej si spotreboval sám, appka nevie.</p>`
            : '';
        return segHtml(m.hero.period) + heroHtml(m) + rowsHtml(m) + note + prices;
    }
    const live =
        m.status === 'offline'
            ? `<p class="stats-note">Živé meranie teraz neodpovedá. Súčty za mesiac, rok a celý čas sa ukážu, keď sa spojenie obnoví.</p>`
            : goHtml('meranie', 'Pripojiť živé meranie', 'Súčty za mesiac, rok a celý čas posiela menič Huawei cez kiosk FusionSolar.');
    return forecastHtml(m) + live + prices;
}

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
export function renderStatistika(state, dom) {
    dom.statsSub.textContent = `${state.site.name} · ${kwpText(installedKw(state.plant))}`;
    writeHtml(dom.statsBody, statsHtml(statsModel(state, state.statsPeriod), state.demo), 'statsBody');
}
