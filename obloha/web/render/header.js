// Hlavička: vľavo miesto elektrárne, vpravo čas a bodka živého merania. Bez zadaných panelov
// je vpravo biely štítok „Zadaj panely ›“, ktorý otvorí kartu Nastavenie.

import { pvFreshness } from '../../../shared/hero-model.js';
import { minutesToTimeStr } from '../../../shared/format.js';
import { voiceTexts } from '../../../shared/messages.js';
import { localMinutes } from '../../../shared/solar.js';

/**
 * Čo hlavička ukazuje. `tone` je farba bodky: `live` čerstvé meranie z kiosku, `odhad` len
 * predpoveď (bez kiosku, alebo meranie chýba či je staré), `off` žiadne dáta. `toneText` je to
 * isté slovom pre čítačku obrazovky.
 * @param {import('../state.js').AppState} state
 * @returns {{ place: string, setup: boolean, status: string, tone: 'live' | 'odhad' | 'off', toneText: string }}
 */
export function headerModel(state) {
    const place = state.site.name || 'RAY-MON';
    const off = (/** @type {string} */ status) => ({ place, setup: false, status, tone: /** @type {const} */ ('off'), toneText: '' });
    if (state.known !== 'elektraren') return { ...off(''), setup: true };
    if (state.loading) return off('načítavam…');
    if (!state.pv && !state.forecast) return off('bez dát');
    const status = minutesToTimeStr(localMinutes(state.now, state.site.timezone));
    if (state.pv && !pvFreshness({ now: state.now, pv: state.pv, site: state.site }).stale)
        return { place, setup: false, status, tone: 'live', toneText: 'živé meranie' };
    const toneText = state.pv ? 'meranie zastarané' : state.kiosk ? 'živé meranie nedostupné' : 'odhad z predpovede';
    return { place, setup: false, status, tone: 'odhad', toneText };
}

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
export function renderHeader(state, dom) {
    const m = headerModel(state);
    dom.place.textContent = m.place;
    dom.status.textContent = m.status;
    dom.tone.textContent = m.toneText;
    dom.live.dataset.tone = m.tone;
    dom.live.classList.toggle('hidden', m.setup);
    dom.setup.classList.toggle('hidden', !m.setup);
    dom.setup.textContent = voiceTexts(state.voice).HEADER_TEXTS.setup;
}
