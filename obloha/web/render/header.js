// Hlavička: vľavo miesto elektrárne, vpravo bodka živého merania a čas posledného merania (ako
// súčasná appka), bez neho slovom, čo appka ukazuje. Bez zadaných panelov je vpravo biely štítok
// „Zadaj panely ›“, ktorý otvorí kartu Nastavenie.

import { freshPowerKw, pvFreshness } from '../../../shared/hero-model.js';
import { voiceTexts } from '../../../shared/messages-core.js';
import { neplatiOf } from '../../../shared/pristup.js';

/**
 * Čo hlavička ukazuje. `tone` je farba bodky: `live` čerstvé meranie z meniča, `odhad` len
 * predpoveď (bez merania, alebo meranie chýba či je staré), `off` žiadne dáta. `status` je čas
 * posledného merania (pvFreshness, ten istý ako v súčasnej appke), pri zastaranom so slovom - samotný
 * starý čas by vyzeral ako zle idúce hodiny; bez merania slovo. `toneText` dopĺňa pre čítačku
 * obrazovky, čo bodka hovorí farbou, keď to `status` nepovie sám.
 * @param {import('../state.js').AppState} state
 * @returns {{ place: string, setup: boolean, status: string, tone: 'live' | 'odhad' | 'off', toneText: string }}
 */
export function headerModel(state) {
    const place = state.site.name || 'RAY-MON';
    const off = (/** @type {string} */ status) => ({ place, setup: false, status, tone: /** @type {const} */ ('off'), toneText: '' });
    if (state.known !== 'elektraren') return { ...off(''), setup: true };
    if (state.loading) return off('načítavam…');
    if (!state.pv && !state.forecast) return off('bez dát');
    // Živé je to, čo karty berú za výkon teraz (freshPowerKw) - čerstvé meranie bez výkonu nie.
    if (state.pv && freshPowerKw(state) !== null) {
        const { time } = pvFreshness({ now: state.now, pv: state.pv, site: state.site });
        return { place, setup: false, status: time, tone: 'live', toneText: 'živé meranie' };
    }
    return { place, setup: false, tone: 'odhad', ...odhad(state) };
}

/** Čo hlavička ukáže, keď živé meranie nie je. @param {import('../state.js').AppState} state */
function odhad(state) {
    const nedostupne = { status: 'meranie nedostupné', toneText: '' };
    if (state.pv) {
        const { time, stale } = pvFreshness({ now: state.now, pv: state.pv, site: state.site });
        return stale ? { status: `${time} · zastarané`, toneText: 'meranie zastarané' } : nedostupne;
    }
    const neplati = neplatiOf(state);
    if (neplati) return { status: neplati.hlavicka, toneText: neplati.tone };
    return state.zdroj ? nedostupne : { status: 'odhad z predpovede', toneText: '' };
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
