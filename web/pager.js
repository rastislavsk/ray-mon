// Pásy, ktoré listuje a prichytáva prehliadač sám (.pager): odporúčania na karte Terazky
// a hlášky na karte Môžem?. JS len číta, na ktorej stránke pás stojí.

import { PAGER_SETTLE_MS } from '../shared/config.js';

/** Index stránky pod prstom práve teraz, aj keď je pás ešte v pohybe. Skrytá stránka
 * (napr. "lepšie bude" bez času čakania) z toku vypadne, takže do poradia nepatrí - preto
 * sa počíta zo skutočne zobrazených stránok a nie z pevného čísla. @param {HTMLElement} pager */
export function currentPage(pager) {
    const pages = pager.querySelectorAll('.pager-page:not(.hidden)').length;
    const index = Math.round(pager.scrollLeft / (pager.clientWidth || 1));
    return Math.min(Math.max(index, 0), pages - 1);
}

/** Posunie pás na stránku `index` (null = ďalšia, za poslednou znova prvá); stránku do stavu
 * zapíše až poslucháč posunu, ako pri prste. Cieľ je samotná stránka (scrollIntoView), nie index
 * krát clientWidth - ten je celočíselný, kým skutočná šírka stránky býva desatinná, čo na
 * desktope nechávalo pás o pár pixelov mimo prichytenia a cez okraj presvital kúsok susednej
 * stránky. Skryté stránky do poradia nepatria, rovnako ako ich neráta currentPage.
 * @param {HTMLElement} pager @param {number | null} index */
export function scrollPager(pager, index) {
    const pages = pager.querySelectorAll('.pager-page:not(.hidden)');
    const page = pages[index ?? (currentPage(pager) + 1) % pages.length];
    if (page instanceof HTMLElement) page.scrollIntoView({ inline: 'start', block: 'nearest' });
}

/**
 * Posun pásu, ktorý listuje a prichytáva prehliadač sám; JS len číta, kde pás stojí. Bodky idú
 * za prstom hneď (len kozmeticky prepnú triedu), do stavu ide až ustálená stránka - inak by
 * prekreslenie uprostred gesta prepisovalo bodky tam a späť. Vráti obsluhu udalosti scroll.
 * @param {() => Iterable<Element>} dots bodky pásu (pri prekresľovanom páse sa hľadajú nanovo)
 * @param {(page: number) => void} settle zápis ustálenej stránky do stavu
 */
export function pagerScroll(dots, settle) {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    return (/** @type {HTMLElement} */ pager) => {
        const index = currentPage(pager);
        let i = 0;
        for (const dot of dots()) dot.classList.toggle('active', i++ === index);
        clearTimeout(timer);
        timer = setTimeout(() => settle(currentPage(pager)), PAGER_SETTLE_MS);
    };
}
