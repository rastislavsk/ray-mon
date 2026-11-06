// Ťuknutie na oznámenie: appka ukáže kartu Teraz s rozbaleným Plánom dňa a jeho obrysom
// (docs/navrhy/oznamenie-plan-dna.html). Zatvorená appka sa to dozvie z adresy, bežiaca zo správy
// service workera (klik v sw.js). Bežné otvorenie appky sa tohto netýka.

import { OZNAMENIA } from '../shared/config.js';
import { klikZAdresy } from '../shared/oznamenia.js';
import { zOznamenia } from './state.js';

/**
 * Plán dňa sa pri štarte objaví až s predpoveďou - posun aj obrys na neho počkajú, najviac
 * OZNAMENIA.obrysCakaMs. Obrys tak zhasne aj vtedy, keď nebeží (útlm pohybu) alebo plán nie je čo
 * ukázať. Keď sa plán počas čakania nezobrazí a človek odíde z karty, panelChange čakanie zruší.
 * @param {import('./state.js').Store} store @param {import('./dom.js').Dom} dom
 */
export function initOznamKlik(store, dom) {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let limit;
    let posun = false;
    const zhasni = () => {
        clearTimeout(limit);
        store.setState({ tzObrys: false });
    };
    const posunNaPlan = () => {
        if (!store.get().tzObrys) posun = false;
        if (!posun || dom.tzPlan.classList.contains('hidden')) return;
        posun = false;
        dom.tzPlan.scrollIntoView({ block: 'nearest' });
    };
    const otvor = () => {
        // Správa môže prísť skôr, než je appka v popredí - obrys by dobehol nevidený.
        if (document.hidden) return void document.addEventListener('visibilitychange', otvor, { once: true });
        posun = true;
        store.setState(zOznamenia(store.get()));
        clearTimeout(limit);
        limit = setTimeout(zhasni, OZNAMENIA.obrysCakaMs);
        posunNaPlan();
    };
    store.subscribe(posunNaPlan);
    dom.tzPlan.addEventListener('animationend', (e) => e.animationName === 'plan-obrys' && zhasni());
    navigator.serviceWorker?.addEventListener('message', (e) => e.data === OZNAMENIA.klik && otvor());
    const adresa = klikZAdresy(location.href);
    if (adresa === null) return;
    history.replaceState(history.state, '', adresa);
    otvor();
}
