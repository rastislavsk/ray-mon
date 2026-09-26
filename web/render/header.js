// Hlavička: čas, stavová bodka (cena × výkon), riadok o aktuálnosti dát a farba plánu dňa
// pre pozadie celej stránky (vrátane náhľadu iného času).

import { minutesToTimeStr } from '../../shared/format.js';
import { heroModel, pvFreshness } from '../../shared/hero-model.js';
import { localMinutes } from '../../shared/solar.js';

/** @param {import('../state.js').AppState} state */
export function updatedLine(state) {
    if (state.loading) return 'načítavam…';
    if (!state.pv && !state.forecast) return 'dáta nedostupné';
    if (state.demo) return 'ukážka · nastav si elektráreň';
    // Kto si zadal kiosk, tomu meranie chýba; ostatní ho ani nečakajú a vidia odhad.
    if (!state.pv) return state.kiosk ? 'živý výkon nedostupný' : 'odhad z predpovede';
    const { label, stale } = pvFreshness({ now: state.now, pv: state.pv, site: state.site });
    return stale ? `${label} · zastarané` : label;
}

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
export function renderHeader(state, dom) {
    // Čas lokality, nie telefónu - k nemu sa vzťahuje rozvrh tarify aj predpoveď.
    dom.currentTimeDisplay.textContent = minutesToTimeStr(localMinutes(state.now, state.site.timezone));
    dom.pvUpdated.textContent = updatedLine(state);
    // Bodka je vždy o stave teraz, preto ju náhľad iného času nezaujíma. Pozadie naopak
    // sleduje aj bežca na prstenci, takže pri jeho posúvaní vidno farbu okna, na ktoré sa
    // práve pozeráš. Bez náhľadu je to ten istý model, netreba ho rátať dvakrát.
    const live = heroModel({ ...state, previewMinutes: null });
    const shown = state.previewMinutes === null ? live : heroModel(state);
    const accent = live.accent;
    // Farbu bodky (a s ňou aj podsvietenie ikony aktívnej karty v navigácii) drží data-accent
    // na <html> - mapovanie na konkrétnu farbu je v style.css pri --live-rgb.
    dom.root.dataset.accent = accent || '';
    // Pozadie drží farbu plánu dňa (tier: cena z tarify a výroba z krivky dňa), nie farbu bodky
    // (accent, tá počíta so živým výkonom) - hovorí teda to isté, čo segment pod bežcom na
    // dennom prstenci.
    dom.root.dataset.tier = shown.tier || '';
}
