// Pás kariet na karte Dnes (docs/navrhy/dnes-upravy.html): posúva ho prehliadač sám (CSS scroll-snap),
// tu sa len zladia bodky a šípky s tým, kde pás stojí, a šípka ho posunie o kartu (pre myš; bodky sú len
// ukazovateľ - pri ôsmich kartách by sa ako tlačidlá na prst do riadku nezmestili). Posun pásu nie je
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
 * Rozsvieti bodku karty, na ktorej pás stojí, a vypne šípku, za ktorou už karta nie je. Volá ho render po
 * prepísaní bodiek aj posúvanie pásu.
 * @param {HTMLElement} pas @param {HTMLElement} bodky @param {HTMLButtonElement[]} [sipky] späť a ďalej
 */
export function syncBodky(pas, bodky, sipky = []) {
    if (!bodky.children.length) return;
    const i = aktivna(pas);
    [...bodky.children].forEach((b, k) => b.toggleAttribute('data-on', k === i));
    const [spat, dalej] = sipky;
    if (spat) spat.disabled = i === 0;
    if (dalej) dalej.disabled = i === bodky.children.length - 1;
}

/**
 * Posúvanie pásu rozsvieti bodku; šípka posunie pás na susednú kartu.
 * @param {HTMLElement} pas @param {HTMLElement} bodky @param {HTMLButtonElement[]} sipky späť a ďalej
 */
export function bindKarty(pas, bodky, sipky) {
    pas.addEventListener('scroll', () => syncBodky(pas, bodky, sipky), { passive: true });
    for (const s of sipky)
        s.addEventListener('click', () => {
            const card = /** @type {HTMLElement | undefined} */ (pas.children[aktivna(pas) + Number(s.dataset.smer)]);
            if (!card) return;
            const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
            pas.scrollTo({ left: card.offsetLeft - parseFloat(getComputedStyle(pas).paddingLeft), behavior: smooth ? 'smooth' : 'auto' });
        });
}
