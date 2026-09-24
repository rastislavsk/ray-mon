// Hlavička: čas, stavová bodka (tarifa × výkon), riadok o aktuálnosti dát a farba tarify
// pre pozadie celej stránky (vrátane náhľadu iného času).

import { STALE_PV_MS } from '../../shared/config.js';
import { minutesToTimeStr } from '../../shared/format.js';
import { heroModel } from '../../shared/hero-model.js';
import { nearOwnerPlant } from '../../shared/settings.js';
import { localMinutes } from '../../shared/solar.js';

/** @param {import('../state.js').AppState} state */
export function updatedLine(state) {
    if (state.dataError || (!state.pv && !state.forecast)) return 'dáta nedostupné';
    if (state.demo) return 'ukážka · nastav si elektráreň';
    // Živé meranie má zatiaľ len elektráreň v Dvoranoch; inde je všetko odhad z predpovede.
    if (!state.pv) return nearOwnerPlant(state.site) ? 'živý výkon nedostupný' : 'odhad z predpovede';
    const updated = new Date(state.pv.updatedAt);
    const label = `aktualizované ${minutesToTimeStr(localMinutes(updated, state.site.timezone))}`;
    const stale = state.now.getTime() - updated.getTime() > STALE_PV_MS;
    const suffix = state.source === 'legacy' ? ' · záložný zdroj' : '';
    return stale ? `${label} · zastarané${suffix}` : `${label}${suffix}`;
}

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
export function renderHeader(state, dom) {
    // Čas lokality, nie telefónu - k nemu sa vzťahujú tarifné okná aj predpoveď.
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
    // Pozadie drží farbu tarifného okna (tier), nie "smart" farbu bodky (accent, tá počíta
    // aj so slnkom) - hovorí teda to isté, čo segment pod bežcom na dennom prstenci.
    dom.root.dataset.tier = shown.tier || '';
}
