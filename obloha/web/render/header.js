// Hlavička: RAY-MON a pod ním miesto elektrárne, vpravo bodka živého merania a čas posledného
// merania, bez neho slovom, čo appka ukazuje - to isté ako súčasná appka (shared/hlavicka.js).
// Ťuknutie na bodku a čas otvorí pod nimi bublinu s vysvetlením stavu. Bez zadaných panelov je
// vpravo biely štítok „Zadaj panely ›“, ktorý otvorí kartu Nastavenie.

import { hlavickaModel } from '../../../shared/hlavicka.js';
import { voiceTexts } from '../../../shared/messages-core.js';

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
export function renderHeader(state, dom) {
    const m = hlavickaModel(state, state.voice);
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
