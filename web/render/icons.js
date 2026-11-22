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

/** Fajka po dobehnutom programe (docs/navrhy/oznamenia-animacie.html): skrytá, nakreslí ju CSS. @param {string} d */
const fajka = (d) => `<path class="vi-fajka" pathLength="1" d="${d}"/>`;

/**
 * Spotrebiče v Pláne dňa (karta Teraz, docs/navrhy/teraz-navrh-2.html): strohé čiarové ikony
 * ako v navigácii, nie obrázky - aby karta nebola detská. Ikona je len ozdoba, meno nesie text.
 * Triedy `vi-*` sú časti, ktorými CSS hýbe po ťuknutí na oznámenie: bubon, kvapka, vnútro a fajka.
 * @type {Record<string, string>}
 */
const VECI = {
    pracka:
        '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M4 7.5h16M7.5 5.3h.01M10.5 5.3h.01"/>' +
        `<circle class="vi-bubon" cx="12" cy="14" r="4"/>${fajka('M9.9 14.1l1.4 1.4 2.8-3')}`,
    umyvacka:
        '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M4 8h16M7.5 5.5h4"/>' +
        `<path class="vi-vnutro" d="M8 12.5h8M8 16.5h8"/>${fajka('M9 14.6l2 2 4-4.2')}`,
    susicka:
        '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M4 7.5h16M7.5 5.3h.01"/><circle class="vi-bubon" cx="12" cy="14" r="4"/>' +
        `<path class="vi-vnutro" d="M9.6 14.2c.8-.9 1.6.9 2.4 0s1.6.9 2.4 0"/>${fajka('M9.9 14.1l1.4 1.4 2.8-3')}`,
    auto:
        '<path d="M3.5 15.5v-3.2L5.6 7.6a1.5 1.5 0 0 1 1.4-1h10a1.5 1.5 0 0 1 1.4 1l2.1 4.7v3.2a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z"/>' +
        '<path d="M3.5 12.3h17"/><circle cx="7.5" cy="16.5" r="1.7"/><circle cx="16.5" cy="16.5" r="1.7"/>',
    bojler:
        '<rect x="6" y="2.5" width="12" height="19" rx="6"/>' +
        '<path class="vi-kvapka" d="M12 8.5c-1.6 2-2.4 3.3-2.4 4.4a2.4 2.4 0 0 0 4.8 0c0-1.1-.8-2.4-2.4-4.4z"/>',
};

/** Ikona spotrebiča podľa id veci (MOZEM_ITEMS); neznámy spotrebič ikonu nemá. @param {string} id */
export function vecIcon(id) {
    const inner = VECI[id];
    return inner ? `<svg class="vi" data-ikona="${id}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${inner}</svg>` : '';
}

/**
 * Tok elektriny na karte Teraz (docs/navrhy/teraz-auto-tok.html): slnko (panely), dom a stĺp siete
 * čiarou ako spotrebiče. `attrs` umiestni ikonu vnútri iného SVG (panel Elektrina teraz).
 * @type {Record<'slnko' | 'dom' | 'stlp', string>}
 */
const TOK = {
    slnko:
        '<circle cx="12" cy="12" r="4"/>' +
        '<path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
    dom: '<path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>',
    stlp: '<path d="M12 2.5 7.5 21.5M12 2.5l4.5 19"/><path d="M5 7h14M6.5 11.5h11M9 16.5h6"/><path d="M5 7v2M19 7v2"/>',
};

/** Ikona toku elektriny. @param {'slnko' | 'dom' | 'stlp'} id @param {string} [attrs] */
export const tokIcon = (id, attrs = '') =>
    `<svg class="vi" data-ikona="${id}"${attrs ? ` ${attrs}` : ''} viewBox="0 0 24 24" aria-hidden="true" focusable="false">${TOK[id]}</svg>`;

/** Ruka: bojler sa zapína ručne (docs/navrhy/teraz-dlazdice-odrazky.html, A). */
const RUKA =
    '<path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5"/>' +
    '<path d="M14 10.5V5.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.5a6 6 0 0 1-4.6-2.2L4.2 15a1.5 1.5 0 0 1 2.3-1.9L8 14.5"/>';

/** Značka režimu bojlera v rohu dlaždice: ruka (ručne), slnko (riadi appka). @param {'appka' | 'rucne'} rezim */
export const rezimIcon = (rezim) =>
    rezim === 'rucne'
        ? `<svg class="vi" data-ikona="ruka" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${RUKA}</svg>`
        : tokIcon('slnko');
