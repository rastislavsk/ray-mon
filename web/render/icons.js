// Ikony počasia: jasno, polojasno, zamračené. Vlastná malá sada podľa návrhu
// (docs/navrhy/smer-b-obloha.html, `wIcon`), nie emoji - tie kreslí každý telefón inak. Dážď
// nie je: appka zrážky nesťahuje, preto ani zamračené nemá kvapky. Ikona je len ozdoba
// (aria-hidden), počasie slovom nesie text vedľa nej.

/** Slnko v strede plochy 24 × 24. */
const SUN =
    '<circle cx="12" cy="12" r="4.5" class="wi-sun"/>' +
    '<path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M5.3 18.7l1.5-1.5M17.2 6.8l1.5-1.5" class="wi-rays"/>';

/** Oblak dole v ploche 24 × 24. @param {string} cls */
const cloud = (cls) => `<path d="M7 18h10a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 7 11.2 3.4 3.4 0 0 0 7 18z" class="${cls}"/>`;

/** @type {Record<import('../../shared/sky.js').SkyWeather, string>} */
const INNER = {
    jasno: SUN,
    polojasno: `<g transform="translate(-3 -3) scale(.85)">${SUN}</g><g transform="translate(3 3) scale(.85)">${cloud('wi-cloud')}</g>`,
    zamracene: cloud('wi-cloud wi-dark'),
};

/** Ikona počasia. `data-w` nesie stav, aby ho testy aj štýly poznali bez čítania tvaru. @param {import('../../shared/sky.js').SkyWeather} w */
export function weatherIcon(w) {
    return `<svg class="wi" data-w="${w}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${INNER[w]}</svg>`;
}

/**
 * Spotrebiče v Pláne dňa (karta Teraz, docs/navrhy/teraz-navrh-2.html): strohé čiarové ikony
 * ako v navigácii, nie obrázky - aby karta nebola detská. Ikona je len ozdoba, meno nesie text.
 * @type {Record<string, string>}
 */
const VECI = {
    pracka: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M4 7.5h16M7.5 5.3h.01M10.5 5.3h.01"/><circle cx="12" cy="14" r="4"/>',
    umyvacka: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M4 8h16M7.5 5.5h4M8 12.5h8M8 16.5h8"/>',
    susicka:
        '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M4 7.5h16M7.5 5.3h.01"/><circle cx="12" cy="14" r="4"/>' +
        '<path d="M9.6 14.2c.8-.9 1.6.9 2.4 0s1.6.9 2.4 0"/>',
    auto:
        '<path d="M3.5 15.5v-3.2L5.6 7.6a1.5 1.5 0 0 1 1.4-1h10a1.5 1.5 0 0 1 1.4 1l2.1 4.7v3.2a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z"/>' +
        '<path d="M3.5 12.3h17"/><circle cx="7.5" cy="16.5" r="1.7"/><circle cx="16.5" cy="16.5" r="1.7"/>',
    bojler: '<rect x="6" y="2.5" width="12" height="19" rx="6"/><path d="M12 8.5c-1.6 2-2.4 3.3-2.4 4.4a2.4 2.4 0 0 0 4.8 0c0-1.1-.8-2.4-2.4-4.4z"/>',
};

/** Ikona spotrebiča podľa id veci (MOZEM_ITEMS); neznámy spotrebič ikonu nemá. @param {string} id */
export function vecIcon(id) {
    const inner = VECI[id];
    return inner ? `<svg class="vi" data-ikona="${id}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${inner}</svg>` : '';
}
