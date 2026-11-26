// Karta Radar: texty a prepínače zo stavu. Mapu, snímky a polohu na osi kreslí prehrávač (web/radar-hrac.js).

import { legendaPrechod } from '../../shared/radar.js';
import { show } from './write.js';

/** @type {Record<string, string>} */
const HLASKY = {
    chyba: 'Radar sa nepodarilo načítať.',
    mimo: 'Pre toto miesto radar nemáme. Pokrýva len Európu.',
    bezpolohy: 'Radar ukáže tvoje okolie, keď v Nastavení zadáš polohu.',
};

/** Prechody legendy: dážď, dážď so snehom, sneh (`data-typ`). @param {HTMLElement} el */
function farbyLegendy(el) {
    for (const b of el.querySelectorAll('b')) {
        const legenda = legendaPrechod(/** @type {import('../../shared/radar.js').TypZrazok} */ (Number(b.dataset.typ)));
        if (b.style.background !== legenda) b.style.background = legenda;
    }
}

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
    farbyLegendy(dom.rdIntenzita);
    // Kým nie je načítané všetko, obiehajú slnko a mesiac a prehrávanie čaká: najnovšia snímka je už na mape,
    // no os by preskakovala po snímkach, ktoré ešte len prídu.
    const caka = state.radarStav === 'nacitavam' || (state.radarStav === 'ok' && !state.radarHotovo);
    show(dom.rdSvitanie, caka);
    /** @type {HTMLButtonElement} */ (dom.rdHraj).disabled = caka;
    dom.rdOs.setAttribute('aria-disabled', String(caka));
    dom.rdDok.classList.toggle('caka', caka);
    for (const b of dom.rdRozsahy.querySelectorAll('button')) b.disabled = caka;
    show(dom.rdBezModelu, state.radarStav === 'ok' && state.radarHotovo && state.radarBezModelu);
    const hlaska = HLASKY[state.radarStav] ?? '';
    show(dom.rdHlaska, !!hlaska);
    dom.rdHlaskaText.textContent = hlaska;
    show(dom.rdZnova, state.radarStav === 'chyba');
    // Bez radaru niet čo prehrať ani čím merať, rozsah a intenzita hore zmiznú spolu s osou.
    const sRadarom = state.radarStav !== 'mimo' && state.radarStav !== 'bezpolohy';
    show(dom.rdDok, sRadarom);
    show(dom.rdRozsahy, sRadarom);
    show(dom.rdIntenzita, sRadarom);
}
