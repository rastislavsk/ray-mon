// Pás kariet na karte Dnes (docs/navrhy/dnes-upravy.html): posúva ho prehliadač sám (CSS scroll-snap),
// tu sa len zladia bodky s tým, kde pás stojí, a ťuknutie na bodku pás posunie. Posun pásu nie je
// v stave appky - ako posun dňa počas ťahu v detaile karty 7 dní; v stave sú len karty samotné.

/**
 * Index karty, na ktorej pás stojí: tá, ktorej ľavý okraj je najbližšie k začiatku pásu. Na konci
 * pásu posledná - tá sa k začiatku nedostane, vedľa nej už nič nie je.
 * @param {HTMLElement} pas
 */
function aktivna(pas) {
    const cards = /** @type {HTMLElement[]} */ ([...pas.children]);
    if (pas.scrollLeft >= pas.scrollWidth - pas.clientWidth - 2) return cards.length - 1;
    const start = pas.getBoundingClientRect().left + parseFloat(getComputedStyle(pas).paddingLeft);
    let best = 0;
    cards.forEach((c, i) => {
        if (Math.abs(c.getBoundingClientRect().left - start) < Math.abs(cards[best].getBoundingClientRect().left - start)) best = i;
    });
    return best;
}

/**
 * Rozsvieti bodku karty, na ktorej pás stojí. Volá ho render po prepísaní bodiek aj posúvanie pásu.
 * @param {HTMLElement} pas @param {HTMLElement} bodky
 */
export function syncBodky(pas, bodky) {
    if (!bodky.children.length) return;
    const i = aktivna(pas);
    [...bodky.children].forEach((b, k) => b.toggleAttribute('aria-current', k === i));
}

/**
 * Posúvanie pásu rozsvieti bodku; ťuknutie na bodku posunie pás na jej kartu.
 * @param {HTMLElement} pas @param {HTMLElement} bodky
 */
export function bindKarty(pas, bodky) {
    pas.addEventListener('scroll', () => syncBodky(pas, bodky), { passive: true });
    bodky.addEventListener('click', (e) => {
        const btn = e.target instanceof Element ? e.target.closest('[data-i]') : null;
        const card = btn instanceof HTMLElement ? /** @type {HTMLElement | undefined} */ (pas.children[Number(btn.dataset.i)]) : undefined;
        if (!card) return;
        const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
        pas.scrollTo({ left: card.offsetLeft - parseFloat(getComputedStyle(pas).paddingLeft), behavior: smooth ? 'smooth' : 'auto' });
    });
}
