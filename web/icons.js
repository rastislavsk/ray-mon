// Inline SVG ikony (počasie, sprievodca). Iba reťazce, žiadna logika.

export const ICON_SUN =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
export const ICON_CLOUD =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.5 19H6a4 4 0 1 1 .5-7.97A5.5 5.5 0 0 1 17 10a4 4 0 0 1 .5 9Z"/></svg>';
export const ICON_PARTLY =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="15" cy="8" r="3"/><path d="M15 2v1.3M19.6 4.4l-.9.9M21 8h-1.3M9.4 4.4l.9.9"/><path d="M16.5 19H7a4 4 0 1 1 .5-7.97 5.5 5.5 0 0 1 9.7 2.02A4 4 0 0 1 16.5 19Z"/></svg>';

/** Šípky na tlačidlách Späť a Ďalej v obsahu kariet. */
export const ICON_BACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
export const ICON_NEXT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';

/** Ikony riadkov v prehľade elektrárne (karta Nastavenie). */
export const SETUP_ICONS = {
    poloha: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0112 2.5a7 7 0 017 7C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    panel: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="1.5"/><path d="M3 11h18M9 5v12M15 5v12M12 17v3M8 20h8"/></svg>',
    menic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6"/><circle cx="12" cy="16.5" r="1"/></svg>',
    meranie: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17l5-6 4 4 5-8 4 5"/></svg>',
    chevron: '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
};
