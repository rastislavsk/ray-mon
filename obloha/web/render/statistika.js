// Karta Štatistika novej appky: prepínač obdobia, veľké číslo kWh a odkiaľ je, pri dnešku pás voči
// predpovedi, „to je ako“, ostatné obdobia v riadkoch, najlepší deň mesiaca, hodnota podľa tarify,
// výzvy a tlačidlá plagátu. Všetko počíta shared/statistika.js a texty sú v shared/messages.js -
// tu sa len zapisuje do DOM.

import { escapeHtml } from '../../../shared/format.js';
import { STATISTIKA_TEXTS as T } from '../../../shared/messages.js';
import { kwhText, statistikaModel } from '../../../shared/statistika.js';
import { setHtml, setText, show } from './write.js';

/** @typedef {import('../dom.js').Dom} Dom */
/** @typedef {import('../../../shared/statistika.js').StatistikaModel} Model */

/** Ostatné obdobia: meno a kWh, odhad kurzívou ako inde v appke. @param {Model['rows']} rows */
const rowsHtml = (rows) =>
    rows
        .map((r) => `<p${r.estimate ? ' class="est"' : ''}><span>${escapeHtml(r.name)}</span><b>${escapeHtml(kwhText(r.kwh))} kWh</b></p>`)
        .join('');

/** Tlačidlá plagátu: prvé plné, ďalšie priesvitné. @param {Model['posters']} posters */
const postersHtml = (posters) =>
    posters
        .map(
            (p, i) =>
                `<button type="button" class="pbtn${i ? ' ghost' : ''}" data-poster="${p.period}" aria-haspopup="dialog">${escapeHtml(p.label)}</button>`,
        )
        .join('');

/** Výzvy a stavy bez čísel: bez polohy, bez panelov, načítavanie, bez dát. @param {Model} m @param {Dom} dom */
function renderStates(m, dom) {
    show(dom.stSub, m.sub !== '');
    setText(dom.stSub, m.sub);
    show(dom.stRetry, m.retry);
    setText(dom.stRetry, T.retry);
    show(dom.stAsk, m.kind === 'ask');
    setText(dom.stAskTitle, T.askTitle);
    setText(dom.stAskText, T.askText);
    setText(dom.stAskBtn, T.askBtn);
    // Biela výzva bez panelov; tlačidlo pri každom vstupe na kartu trikrát zapulzuje (CSS animácia
    // sa spustí vždy, keď sa prvok ukáže) a zastaví sa.
    show(dom.stSetup, m.kind === 'setup');
    setText(dom.stSetupTitle, T.setupTitle);
    setText(dom.stSetupText, T.setupText);
    setText(dom.stSetupBtn, T.setupBtn);
    setText(dom.stLaterTitle, T.laterTitle);
    setText(dom.stLaterText, T.laterText);
}

/** Čísla zvoleného obdobia. @param {Model} m @param {NonNullable<Model['hero']>} hero @param {import('../state.js').AppState} state @param {Dom} dom */
function renderNumbers(m, hero, state, dom) {
    dom.stSeg.setAttribute('aria-label', T.periodsLabel);
    for (const btn of dom.stSeg.querySelectorAll('button')) {
        const p = /** @type {import('../../../shared/stats.js').StatsPeriod} */ (btn.dataset.period);
        setText(btn, T.periods[p]);
        btn.setAttribute('aria-pressed', String(p === state.statsPeriod));
    }
    setText(dom.stNumVal, kwhText(hero.kwh));
    dom.stNum.classList.toggle('est', hero.estimate);
    setText(dom.stSrc, hero.sub);
    show(dom.stValue, m.value !== null);
    setText(dom.stValue, m.value ?? '');
    show(dom.stProgress, !!m.progress);
    if (m.progress) {
        dom.stBar.style.width = `${m.progress.pct}%`;
        setText(dom.stProgressText, m.progress.text);
    }
    show(dom.stEquiv, !!m.equiv);
    dom.stEquiv.classList.toggle('est', hero.estimate);
    setText(dom.stEquivTitle, T.equiv);
    setText(dom.stPhones, m.equiv ? m.equiv.phones : '');
    setText(dom.stPhonesLabel, T.phones);
    setText(dom.stKm, m.equiv ? m.equiv.km : '');
    setText(dom.stKmLabel, T.km);
    setHtml(dom.stRows, rowsHtml(m.rows));
}

/** Riadky pod číslami: najlepší deň, veta o spotrebe, meranie, ceny a plagát. @param {Model} m @param {Dom} dom */
function renderExtras(m, dom) {
    show(dom.stBest, !!m.best);
    setText(dom.stBestTitle, m.best ? m.best.title : '');
    setText(dom.stBestText, m.best ? m.best.text : '');
    show(dom.stNote, m.note !== '');
    setText(dom.stNote, m.note);
    show(dom.stMeasureOff, m.measure === 'off');
    setText(dom.stMeasureOff, T.measureOff);
    show(dom.stMeasure, m.measure === 'ask');
    setText(dom.stMeasureTitle, T.measureTitle);
    setText(dom.stMeasureText, T.measureText);
    setText(dom.stMeasureBtn, T.measureBtn);
    show(dom.stPrices, m.prices);
    setText(dom.stPricesTitle, T.pricesTitle);
    setText(dom.stPricesText, T.pricesText);
    setText(dom.stPricesBtn, T.pricesBtn);
    show(dom.stPosters, m.posters.length > 0);
    setHtml(dom.stPosters, postersHtml(m.posters));
}

/** @param {import('../state.js').AppState} state @param {Dom} dom */
export function renderStatistika(state, dom) {
    if (state.panel !== 'statistika') return;
    const m = statistikaModel(state, state.statsPeriod, { online: state.online });
    renderStates(m, dom);
    show(dom.stBody, !!m.hero);
    if (!m.hero) return;
    renderNumbers(m, m.hero, state, dom);
    renderExtras(m, dom);
}
