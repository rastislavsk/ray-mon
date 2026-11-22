// Ťuknutie na oznámenie: appka ukáže kartu Teraz a ožije ikona dlaždice - spotrebiča, o ktorom oznámenie bolo, pri
// rannom pláne prvého spotrebiča v pláne (docs/navrhy/oznamenia-animacie.html). Zatvorená appka sa to dozvie
// z adresy, bežiaca zo správy service workera (klik v sw.js). Bežné otvorenie appky sa tohto netýka.

import { OZNAMENIA } from '../shared/config.js';
import { klikCiel, klikZAdresy } from '../shared/oznamenia.js';
import { zOznamenia } from './state.js';

/**
 * Dlaždice sa pri štarte objavia až s predpoveďou - posun aj oživenie na ne počkajú, najviac
 * OZNAMENIA.ozivCakaMs. Keď dlaždica v stránke je, oživenie trvá OZNAMENIA.ozivMs a zhasne aj bez animácie
 * (útlm pohybu, tam má kruh s ikonou len obrys). Keď sa počas čakania nezobrazí a človek odíde z karty,
 * panelChange čakanie zruší.
 * @param {import('./state.js').Store} store @param {import('./dom.js').Dom} dom
 */
export function initOznamKlik(store, dom) {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let limit;
    let caka = false;
    const zhasni = () => {
        clearTimeout(limit);
        caka = false;
        store.setState({ tzOziv: null });
    };
    const ukaz = () => {
        if (!store.get().tzOziv) caka = false;
        const el = /** @type {HTMLElement | null} */ (dom.tzCo.querySelector('[data-oziv]'));
        if (!caka || !el || dom.tzCo.classList.contains('hidden')) return;
        caka = false;
        // Plán: navrch Plánu dňa, ako vždy - riadok nad dlaždicami musí byť vidno. Spotrebič: jeho dlaždica do stredu,
        // nad spodnú navigáciu.
        if (el.dataset.oziv === 'plan') dom.tzCo.scrollIntoView({ block: 'start' });
        else el.scrollIntoView({ block: 'center' });
        clearTimeout(limit);
        limit = setTimeout(zhasni, OZNAMENIA.ozivMs);
    };
    /** @param {import('../shared/oznamenia.js').Ciel} ciel */
    const otvor = (ciel) => {
        // Správa môže prísť skôr, než je appka v popredí - ikona by ožila nevidená.
        if (document.hidden) return void document.addEventListener('visibilitychange', () => otvor(ciel), { once: true });
        // Nové ťuknutie počas oživenia: dlaždice sa najprv prekreslia bez neho, aby sa animácia spustila znova.
        store.setState({ tzOziv: null });
        caka = true;
        // Najprv limit čakania - keď je dlaždica hneď v stránke, ukaz ho po prekreslení nahradí trvaním oživenia.
        clearTimeout(limit);
        limit = setTimeout(zhasni, OZNAMENIA.ozivCakaMs);
        store.setState(zOznamenia(store.get(), ciel));
    };
    store.subscribe(ukaz);
    navigator.serviceWorker?.addEventListener('message', (e) => {
        const ciel = klikCiel(e.data);
        if (ciel) otvor(ciel);
    });
    const k = klikZAdresy(location.href);
    if (k === null) return;
    history.replaceState(history.state, '', k.adresa);
    otvor(k.ciel);
}
