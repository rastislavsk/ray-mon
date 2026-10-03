// Ikony počasia novej appky: jasno, polojasno, zamračené. Vlastná malá sada podľa návrhu
// (docs/navrhy/smer-b-obloha.html, `wIcon`), nie emoji - tie kreslí každý telefón inak. Dážď
// nie je: appka zrážky nesťahuje, preto ani zamračené nemá kvapky. Ikona je len ozdoba
// (aria-hidden), počasie slovom nesie text vedľa nej.

/** Slnko v strede plochy 24 × 24. */
const SUN =
    '<circle cx="12" cy="12" r="4.5" class="wi-sun"/>' +
    '<path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M5.3 18.7l1.5-1.5M17.2 6.8l1.5-1.5" class="wi-rays"/>';

/** Oblak dole v ploche 24 × 24. @param {string} cls */
const cloud = (cls) => `<path d="M7 18h10a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 7 11.2 3.4 3.4 0 0 0 7 18z" class="${cls}"/>`;

/** @type {Record<import('../../../shared/sky.js').SkyWeather, string>} */
const INNER = {
    jasno: SUN,
    polojasno: `<g transform="translate(-3 -3) scale(.85)">${SUN}</g><g transform="translate(3 3) scale(.85)">${cloud('wi-cloud')}</g>`,
    zamracene: cloud('wi-cloud wi-dark'),
};

/** Ikona počasia. `data-w` nesie stav, aby ho testy aj štýly poznali bez čítania tvaru. @param {import('../../../shared/sky.js').SkyWeather} w */
export function weatherIcon(w) {
    return `<svg class="wi" data-w="${w}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${INNER[w]}</svg>`;
}
