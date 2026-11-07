// Ovládanie karty Radar. Os obsluhujú pointer udalosti, tie sú rovnaké pre prst aj kurzor a nič sa za
// nimi neposiela navyše. `touch-action: none` má os aj mapa, stránka sa na tejto karte neposúva.

import { RADAR } from '../shared/config.js';
import { RADAR_ROZSAHY } from '../shared/radar.js';
import { RadarHrac } from './radar-hrac.js';
import { saveRadar } from './storage.js';

/** @param {import('./state.js').Store} store @param {import('./dom.js').Dom} dom */
export function initRadar(store, dom) {
    const hrac = new RadarHrac(store, dom);

    store.subscribe((s, prev) => {
        const tu = s.panel === 'radar';
        if (tu && prev.panel !== 'radar') hrac.otvor();
        else if (!tu && s.radarHra) store.setState({ radarHra: false });
        if (s.radarHra !== prev.radarHra) hrac.hra();
        if (s.radarRozsah !== prev.radarRozsah) hrac.zmenRozsah();
        if (s.radarOblaky !== prev.radarOblaky) hrac.krasli();
        if (s.radarOblaky !== prev.radarOblaky || s.radarRychlost !== prev.radarRychlost) saveRadar(s.radarOblaky, s.radarRychlost);
    });

    // Kto kartu otvoril skôr, než sa stiahla táto časť appky, už zmenu karty neuvidí.
    if (store.get().panel === 'radar') hrac.otvor();

    dom.rdOblaky.addEventListener('click', () => store.setState({ radarOblaky: !store.get().radarOblaky }));
    dom.rdHraj.addEventListener('click', () => {
        hrac.zasiahol = true;
        store.setState({ radarHra: !store.get().radarHra });
    });
    dom.rdRychlost.addEventListener('click', () => {
        const r = RADAR.rychlosti;
        store.setState({ radarRychlost: r[(r.indexOf(store.get().radarRychlost) + 1) % r.length] });
    });
    dom.rdRozsahy.addEventListener('click', (e) => {
        const b = /** @type {HTMLElement} */ (e.target).closest('button');
        const rozsah = RADAR_ROZSAHY.find((x) => x === b?.dataset.rozsah);
        if (rozsah) store.setState({ radarRozsah: rozsah });
    });
    dom.rdZnova.addEventListener('click', () => hrac.otvor());

    const os = dom.rdOs;
    let tahaj = false;
    /** @param {PointerEvent} e */
    const posun = (e) => {
        const box = os.getBoundingClientRect();
        hrac.posun((e.clientX - box.left) / box.width);
    };
    os.addEventListener('pointerdown', (e) => {
        tahaj = true;
        os.setPointerCapture(e.pointerId);
        store.setState({ radarHra: false });
        posun(e);
    });
    os.addEventListener('pointermove', (e) => tahaj && posun(e));
    os.addEventListener('pointerup', () => (tahaj = false));
    os.addEventListener('pointercancel', () => (tahaj = false));
    os.addEventListener('keydown', (e) => {
        const smer = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
        if (!smer) return;
        e.preventDefault();
        store.setState({ radarHra: false });
        hrac.krok(smer);
    });
    new ResizeObserver(() => store.get().panel === 'radar' && hrac.kresliOs()).observe(os);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && store.get().radarHra) store.setState({ radarHra: false });
    });
}
