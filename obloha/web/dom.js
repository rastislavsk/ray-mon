// Všetky DOM referencie novej appky, načítané raz po naparsovaní stránky. Render funkcie
// dostávajú tento objekt a nikdy nevolajú querySelector samy.

import { PANELS } from '../../shared/config.js';

/** Prvok podľa id. Chýbajúci prvok je chyba (napr. staré index.html z cache) - boot.js ju zachytí. */
const byId = (/** @type {string} */ id) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Chýba element #${id}`);
    return el;
};

/** @param {string} prefix */
const perPanel = (prefix) =>
    /** @type {Record<import('./state.js').Panel, HTMLElement>} */ (Object.fromEntries(PANELS.map((p) => [p, byId(`${prefix}-${p}`)])));

export function collectDom() {
    return {
        // <html> nesie farby oblohy (--s1, --s2) a počasie (data-sky).
        root: document.documentElement,
        page: byId('page'),
        place: byId('hdr-place'),
        live: byId('hdr-live'),
        status: byId('hdr-status'),
        tone: byId('hdr-tone'),
        setup: byId('hdr-setup'),
        panels: perPanel('panel'),
        navs: perPanel('nav'),
    };
}

/** @typedef {ReturnType<typeof collectDom>} Dom */
