// Karta Radar: texty a prepínače zo stavu. Mapu, snímky a polohu na osi kreslí prehrávač (web/radar-hrac.js).

import { legendaPrechod } from '../../shared/radar.js';
import { show } from './write.js';

/** @type {Record<string, string>} */
const HLASKY = {
    nacitavam: 'Načítavam radar…',
    chyba: 'Radar sa nepodarilo načítať.',
    mimo: 'Pre toto miesto radar nemáme. Pokrýva len Európu.',
    bezpolohy: 'Radar ukáže tvoje okolie, keď v Nastavení zadáš polohu.',
};

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
export function renderRadar(state, dom) {
    if (state.panel !== 'radar') return;
    dom.rdOblaky.setAttribute('aria-pressed', String(state.radarOblaky));
    dom.rdHraj.setAttribute('aria-label', state.radarHra ? 'Zastaviť' : 'Pustiť');
    show(dom.rdIkonaHraj, !state.radarHra);
    show(dom.rdIkonaStoj, state.radarHra);
    dom.rdRychlost.textContent = `${state.radarRychlost}×`;
    dom.rdRychlost.setAttribute('aria-label', `Rýchlosť ${state.radarRychlost}×`);
    for (const b of dom.rdRozsahy.querySelectorAll('button'))
        b.setAttribute('aria-pressed', String(b.dataset.rozsah === state.radarRozsah));
    const legenda = legendaPrechod();
    if (dom.rdLegenda.style.background !== legenda) dom.rdLegenda.style.background = legenda;
    const hlaska = state.radarStav === 'ok' ? '' : HLASKY[state.radarStav];
    show(dom.rdHlaska, !!hlaska);
    dom.rdHlaskaText.textContent = hlaska;
    show(dom.rdZnova, state.radarStav === 'chyba');
    // Bez radaru niet čo prehrať ani čím merať, rozsah a intenzita hore zmiznú spolu s osou.
    const sRadarom = state.radarStav !== 'mimo' && state.radarStav !== 'bezpolohy';
    show(dom.rdDok, sRadarom);
    show(dom.rdRozsahy, sRadarom);
    show(dom.rdIntenzita, sRadarom);
}
