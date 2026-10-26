// Hlavička: vľavo miesto elektrárne, vpravo bodka živého merania a čas posledného merania (ako
// súčasná appka), bez neho slovom, čo appka ukazuje. Ťuknutie na bodku a čas otvorí pod nimi
// bublinu s vysvetlením stavu. Bez zadaných panelov je vpravo biely štítok „Zadaj panely ›“,
// ktorý otvorí kartu Nastavenie.

import { bodkaMerania, stavMerania } from '../../../shared/hero-model.js';
import { stavMeraniaSlovo, stavMeraniaText, voiceTexts } from '../../../shared/messages-core.js';

/** @typedef {ReturnType<typeof stavMeraniaText>} Tip */

/** Čo hlavička ukáže bez času merania: `status` a `toneText` pre čítačku obrazovky. */
const BEZ_CASU = {
    neprislo: { status: 'meranie nedostupné', toneText: '' },
    odhad: { status: 'odhad z predpovede', toneText: '' },
};

/** Čo bodka hovorí tvarom, pre čítačku obrazovky - plná a polovičná bodka stoja pri čase merania. */
const TONE_TEXT = { live: 'živé meranie', stale: 'meranie zastarané' };

/**
 * Čo hlavička ukazuje. `tone` je tvar bodky z jadra (bodkaMerania, ten istý ako v súčasnej appke):
 * `live` plná, `stale` polovičná, `odhad` krúžok, `off` žiadne dáta. `status` je čas posledného
 * merania (pvFreshness), pri zastaranom a v noci so slovom (stavMeraniaSlovo) - samotný starý čas
 * by vyzeral ako zle idúce hodiny; bez merania slovo. `toneText` dopĺňa pre čítačku obrazovky, čo
 * bodka hovorí tvarom, keď to `status` nepovie sám. `tip` je vysvetlenie stavu do bubliny (null,
 * kým appka stav merania nepozná - vtedy sa bodka a čas neťukajú).
 * @param {import('../state.js').AppState} state
 * @returns {{ place: string, setup: boolean, status: string, tone: 'live' | 'stale' | 'odhad' | 'off', toneText: string, tip: Tip | null }}
 */
export function headerModel(state) {
    const place = state.site.name || 'RAY-MON';
    const off = (/** @type {string} */ status) => ({
        place,
        setup: false,
        status,
        tone: /** @type {const} */ ('off'),
        toneText: '',
        tip: null,
    });
    if (state.known !== 'elektraren') return { ...off(''), setup: true };
    if (state.loading) return off('načítavam…');
    if (!state.pv && !state.forecast) return off('bez dát');
    const stav = stavMerania(state);
    const tip = stavMeraniaText(stav, state.voice);
    const tone = bodkaMerania(stav);
    if (stav.druh === 'znova' && stav.neplati)
        return { place, setup: false, status: stav.neplati.hlavicka, tone, toneText: stav.neplati.tone, tip };
    if (tone !== 'odhad') {
        const slovo = stavMeraniaSlovo(stav);
        return { place, setup: false, tone, status: slovo ? `${stav.cas} · ${slovo}` : stav.cas, toneText: TONE_TEXT[tone], tip };
    }
    return { place, setup: false, tone, ...BEZ_CASU[stav.druh === 'neprislo' ? 'neprislo' : 'odhad'], tip };
}

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
export function renderHeader(state, dom) {
    const m = headerModel(state);
    dom.place.textContent = m.place;
    dom.status.textContent = m.status;
    dom.tone.textContent = m.toneText;
    dom.live.dataset.tone = m.tone;
    dom.live.classList.toggle('hidden', m.setup);
    dom.live.disabled = !m.tip;
    dom.setup.classList.toggle('hidden', !m.setup);
    dom.setup.textContent = voiceTexts(state.voice).HEADER_TEXTS.setup;
    const open = state.stavTip && !!m.tip;
    dom.live.setAttribute('aria-expanded', String(open));
    dom.tip.classList.toggle('hidden', !open);
    dom.tipBg.classList.toggle('hidden', !open);
    dom.tipTitle.textContent = m.tip?.nadpis ?? '';
    dom.tipText.textContent = m.tip?.text ?? '';
    dom.tipBtn.textContent = m.tip?.tlacidlo ?? '';
    dom.tipBtn.classList.toggle('hidden', !m.tip?.tlacidlo);
}
