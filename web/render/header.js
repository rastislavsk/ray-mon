// Hlavička: stavová bodka (cena × výkon) s časom poslednej aktualizácie dát, pod ním čo ten
// čas znamená, a farba plánu dňa pre pozadie celej stránky (vrátane náhľadu iného času).

import { heroModel, pvFreshness } from '../../shared/hero-model.js';
import { powerState } from '../state.js';

/**
 * Pravý horný roh hlavičky: čas aktualizácie dát a pod ním text k nemu. Kde čas nie je, stojí
 * tam „–:–“, aby riadok nemenil tvar.
 * @param {import('../state.js').AppState} state @returns {{ time: string, text: string }}
 */
export function updatedLine(state) {
    const none = (/** @type {string} */ text) => ({ time: '–:–', text });
    if (state.welcome) return none('vitaj');
    if (state.loading) return none('načítavam…');
    if (!state.pv && !state.forecast) return none('dáta nedostupné');
    if (state.demo) return none('panely nie sú zadané');
    // Kto si zadal kiosk, tomu meranie chýba; ostatní ho ani nečakajú a vidia odhad.
    if (!state.pv) return none(state.kiosk ? 'živý výkon nedostupný' : 'odhad z predpovede');
    const { label, time, stale } = pvFreshness({ now: state.now, pv: state.pv, site: state.site });
    return { time, text: stale ? `${label} · zastarané` : label };
}

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
export function renderHeader(state, dom) {
    const updated = updatedLine(state);
    dom.pvTime.textContent = updated.time;
    dom.pvUpdated.textContent = updated.text;
    // Výzva bez zadaných panelov - len na kartách, ktoré bez nich nevedia odpovedať. Karta 7 dní
    // ukazuje predpoveď pre typickú strechu (hovorí to v podnadpise), Štatistika má vlastnú výzvu.
    const grey = state.demo && !state.welcome && (state.panel === 'terazky' || state.panel === 'mozem');
    dom.demoBar.classList.toggle('hidden', !grey);
    // Kým appka nepozná polohu, nie je čo zafarbiť - a bez časového pásma ani čo rátať.
    if (state.welcome) {
        dom.root.dataset.accent = '';
        dom.root.dataset.tier = '';
        return;
    }
    // Bodka je vždy o stave teraz, preto ju náhľad iného času nezaujíma. Pozadie naopak
    // sleduje aj bežca na prstenci, takže pri jeho posúvaní vidno farbu okna, na ktoré sa
    // práve pozeráš. Bez náhľadu je to ten istý model, netreba ho rátať dvakrát.
    const power = powerState(state);
    const live = heroModel({ ...power, previewMinutes: null });
    const shown = power.previewMinutes === null ? live : heroModel(power);
    const accent = live.accent;
    // Farbu bodky (a s ňou aj podsvietenie ikony aktívnej karty v navigácii) drží data-accent
    // na <html> - mapovanie na konkrétnu farbu je v style.css pri --live-rgb.
    dom.root.dataset.accent = accent || '';
    // Pozadie drží farbu plánu dňa (tier: cena z tarify a výroba z krivky dňa), nie farbu bodky
    // (accent, tá počíta so živým výkonom) - hovorí teda to isté, čo segment pod bežcom na
    // dennom prstenci.
    dom.root.dataset.tier = shown.tier || '';
}
