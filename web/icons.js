// Inline SVG ikony (spotrebiče, počasie). Iba reťazce, žiadna logika.

/** @type {Record<string, string>} */
export const DEVICE_ICONS = {
    Práčka: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="6"/><path d="M8 4h8M9 4v2M15 4v2"/></svg>',
    Sušička: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3v2a3 3 0 003 3M18 3v2a3 3 0 01-3 3M9 8v9a3 3 0 006 0V8"/></svg>',
    Umývačka:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16v11a1 1 0 01-1 1H5a1 1 0 01-1-1V8z"/><path d="M4 8l2-4h12l2 4"/></svg>',
    Auto: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 13l2-5a2 2 0 012-1h10a2 2 0 012 1l2 5v5a1 1 0 01-1 1h-1a1 1 0 01-1-1v-1H6v1a1 1 0 01-1 1H4a1 1 0 01-1-1v-5z"/><circle cx="7.5" cy="16.5" r="1.2"/><circle cx="16.5" cy="16.5" r="1.2"/></svg>',
    Bojler: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11z"/></svg>',
};

export const ICON_SUN =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
export const ICON_CLOUD =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.5 19H6a4 4 0 1 1 .5-7.97A5.5 5.5 0 0 1 17 10a4 4 0 0 1 .5 9Z"/></svg>';
export const ICON_PARTLY =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="15" cy="8" r="3"/><path d="M15 2v1.3M19.6 4.4l-.9.9M21 8h-1.3M9.4 4.4l.9.9"/><path d="M16.5 19H7a4 4 0 1 1 .5-7.97 5.5 5.5 0 0 1 9.7 2.02A4 4 0 0 1 16.5 19Z"/></svg>';

/** Veci v karte Môžem? (kľúče sú id z MOZEM_ITEMS). Kreslené tak, aby sa spoznali aj bez popisu. */
export const MOZEM_ICONS = {
    pracka: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 2.5h14a1 1 0 0 1 1 1v17a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-17a1 1 0 0 1 1-1zM4 7h16M7.5 4.8h2M12 9.5a4.5 4.5 0 1 1 0 9a4.5 4.5 0 1 1 0-9z"/></svg>',
    umyvacka:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 2.5h14a1 1 0 0 1 1 1v17a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-17a1 1 0 0 1 1-1zM4 7h16M7 11.5h10M8.5 11.5v6M12 11.5v6M15.5 11.5v6"/></svg>',
    susicka:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 2.5h14a1 1 0 0 1 1 1v17a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-17a1 1 0 0 1 1-1zM4 7h16M12 9.5a4.5 4.5 0 1 1 0 9a4.5 4.5 0 1 1 0-9zM9.8 14.3c.7-.8 1.5-.8 2.2 0s1.5.8 2.2 0"/></svg>',
    auto: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 13l2-5a2 2 0 0 1 2-1h10a2 2 0 0 1 2 1l2 5v5a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H6v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5zM3 13h18"/></svg>',
    hranie: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8h10a4 4 0 0 1 4 4v1a4 4 0 0 1-7 2.6h-4A4 4 0 0 1 3 13v-1a4 4 0 0 1 4-4zM7.5 10.5v3M6 12h3M15.5 11.2h.01M17.5 13h.01"/></svg>',
    fen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5a4.5 4.5 0 0 1 4.5-4.5H20v9H8.5A4.5 4.5 0 0 1 4 7.5zM9 12l1.5 8.5h3L12.5 12M20 5v5"/></svg>',
};

/** Značka odpovede pri veci: fajka áno, hodiny neskôr, krížik nie, otáznik nevie. */
export const MOZEM_MARKS = {
    go: 'M5 12.5l4.5 4.5L19 7.5',
    cheap: 'M5 12.5l4.5 4.5L19 7.5',
    wait: 'M12 6v6l3.5 2',
    no: 'M6 6l12 12M18 6L6 18',
    unk: 'M9.2 9a2.9 2.9 0 1 1 3.8 2.8c-.6.3-1 .9-1 1.6v.6M12 17.2v.3',
};

/** Ikony riadkov v prehľade elektrárne (karta Nastavenie). */
export const SETUP_ICONS = {
    poloha: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0112 2.5a7 7 0 017 7C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    panel: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="1.5"/><path d="M3 11h18M9 5v12M15 5v12M12 17v3M8 20h8"/></svg>',
    menic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6"/><circle cx="12" cy="16.5" r="1"/></svg>',
    meranie: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17l5-6 4 4 5-8 4 5"/></svg>',
    chevron: '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
};
