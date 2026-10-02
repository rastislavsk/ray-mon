// Uložené nastavenie a adresa v prehliadači. Čítanie a zápis do localStorage je vo
// web/storage.js (používa ho aj nová appka v obloha/), tu je len zrkadlenie stavu do adresy.

import { shareHash } from '../shared/settings.js';
import { savedSettings } from './state.js';

export * from './storage.js';

/**
 * Adresa v prehliadači nesie vždy uložené nastavenie (`#nastavenie=…`, aj s kioskom), bez
 * zadaných panelov je holá. Na iPhone totiž appka pridaná na plochu nevidí úložisko Safari - jediné,
 * čo si zo Safari prinesie, je adresa. Pri prvom spustení z plochy tak ponúkne nastavenie
 * prevziať, namiesto toho, aby sa pýtala na polohu. Kým čaká ponuka z otvoreného odkazu, adresa
 * nesie ten odkaz, aby sa dal pridať na plochu aj pred rozhodnutím.
 * @param {import('./state.js').Store} store
 */
export function initUrlMirror(store) {
    /** @param {import('./state.js').AppState} s */
    const mirror = (s) => {
        if (s.incoming) return;
        // Aj prvá karta: appka pridaná na plochu iPhonu si ju inak z Safari neprenesie.
        const hash = shareHash(s.known === 'elektraren' ? savedSettings(s) : null, true, s.startPanel);
        if (location.hash !== hash) history.replaceState(history.state, '', location.pathname + location.search + hash);
    };
    mirror(store.get());
    store.subscribe(mirror);
}
