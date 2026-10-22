// Uložené nastavenie a adresa v prehliadači. Čítanie a zápis do localStorage je vo
// web/storage.js, tu je len zrkadlenie stavu do adresy. Modul je neutrálny - používajú ho obe
// appky (súčasná aj nová v obloha/).

import { shareHash } from '../shared/settings.js';
import { savedSettings } from '../shared/setup-flow.js';

export * from './storage.js';

/**
 * Časť stavu, ktorú adresa nesie: uložené nastavenie, či ho appka pozná, nastavenie z odkazu
 * čakajúce na rozhodnutie a prvá karta tohto telefónu.
 * @typedef {Pick<import('../shared/setup-flow.js').SetupState, 'site' | 'plant' | 'tariff' | 'zdroj' | 'known'> & {
 *   incoming: import('../shared/settings.js').Settings | null,
 *   linkError: import('../shared/settings.js').LinkError | null,
 *   startPanel: import('../shared/settings.js').StartPanel,
 * }} MirrorState
 */

/**
 * Adresa v prehliadači nesie vždy uložené nastavenie (`#nastavenie=…`), bez zadaných panelov je
 * holá. Prístup k živému meraniu v nej nie je nikdy - adresa končí v histórii, v synchronizácii
 * prehliadača aj na snímkach obrazovky. Na iPhone totiž appka pridaná na plochu nevidí úložisko Safari - jediné,
 * čo si zo Safari prinesie, je adresa. Pri prvom spustení z plochy tak ponúkne nastavenie
 * prevziať, namiesto toho, aby sa pýtala na polohu. Kým čaká ponuka z otvoreného odkazu, adresa
 * nesie ten odkaz, aby sa dal pridať na plochu aj pred rozhodnutím; odkaz, ktorý appka nevie
 * prevziať, ostáva v adrese, kým človek hlášku nezavrie.
 * @param {{ get: () => MirrorState, subscribe: (fn: (state: MirrorState) => void) => unknown }} store
 */
export function initUrlMirror(store) {
    /** @param {MirrorState} s */
    const mirror = (s) => {
        if (s.incoming || s.linkError) return;
        // Aj prvá karta: appka pridaná na plochu iPhonu si ju inak z Safari neprenesie.
        const hash = shareHash(s.known === 'elektraren' ? savedSettings(s) : null, false, s.startPanel);
        if (location.hash !== hash) history.replaceState(history.state, '', location.pathname + location.search + hash);
    };
    mirror(store.get());
    store.subscribe(mirror);
}
