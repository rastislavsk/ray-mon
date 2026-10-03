// Merania novej appky priamo v prehliadači pre test/e2e/obloha-kontrola.spec.js: text, jeho
// farba a čo je pod ním, veľkosť písma, orezanie, dotykové plochy a nadpisy. Spec tento súbor
// vloží do stránky (page.addInitScript) a volá ho cez window.kontrola. Nemeria zoznam menovaných
// prvkov, ale všetko, čo v stránke naozaj je - nový prvok netreba nikam dopisovať.
(() => {
    /** Meno prvku do hlásenia: id, inak značka a triedy. @param {Element} el */
    const meno = (el) =>
        el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}${el.classList.length ? `.${[...el.classList].join('.')}` : ''}`;

    /** Prvok, ktorého text nie je na obrazovke (skript, voľba v zozname, text len pre čítačku). @param {Element} el */
    const neviditelny = (el) => !!el.closest('script, style, option, .sr');

    /**
     * Každý neprázdny text v stránke, ktorý je vidieť: uzol, jeho prvok a obdĺžniky riadkov.
     * @param {{ opacity?: boolean }} [opts] `opacity` - aj priehľadný (opacity 0) je skrytý
     */
    function* texty({ opacity = true } = {}) {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const el = n.parentElement;
            if (!el || !n.textContent?.trim() || neviditelny(el)) continue;
            if (!el.checkVisibility({ opacityProperty: opacity, visibilityProperty: true })) continue;
            const range = document.createRange();
            range.selectNodeContents(n);
            const box = range.getBoundingClientRect();
            if (box.width >= 1 && box.height >= 1) yield { n, el, box, rects: [...range.getClientRects()] };
        }
    }

    /** Skutočná veľkosť písma v px - text v SVG sa zmenší či zväčší s grafom. @param {Element} el */
    function pismoPx(el) {
        const ctm = el instanceof SVGGraphicsElement ? el.getScreenCTM() : null;
        return parseFloat(getComputedStyle(el).fontSize) * (ctm ? Math.hypot(ctm.a, ctm.b) : 1);
    }

    /**
     * Tvary SVG pod stredom textu (pilulka s časom, stĺpec, políčko) ako farby od vrchnej.
     * @param {Element} el @param {DOMRect} box
     */
    function tvaryPod(el, box) {
        const owner = /** @type {SVGGraphicsElement} */ (el).ownerSVGElement;
        const point = new DOMPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2);
        /** @type {string[]} */ const out = [];
        for (const shape of owner?.querySelectorAll('rect, circle, ellipse, path, polygon') ?? []) {
            const g = /** @type {SVGGeometryElement} */ (shape);
            const m = g.getScreenCTM();
            if (!m || !(g.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
            const s = getComputedStyle(g);
            if (s.fill === 'none' || !g.isPointInFill(point.matrixTransform(m.inverse()))) continue;
            const [r, gg, b, a = 1] = (s.fill.match(/[\d.]+/g) ?? []).map(Number);
            out.unshift(`rgba(${r}, ${gg}, ${b}, ${a * Number(s.fillOpacity) * Number(s.opacity)})`);
        }
        return out;
    }

    /**
     * Čo je pod prvkom smerom von: farby pozadí predkov (a ::backdrop modálneho dialógu), či je
     * niekde obrázok (prechod plagátu), či je prvok pevne na obrazovke a súčin priehľadností.
     * @param {Element} el
     */
    function podklad(el) {
        const res = { layers: /** @type {string[]} */ ([]), image: false, fixed: false, opacity: 1 };
        for (let a = /** @type {Element | null} */ (el); a && a !== document.documentElement; a = a.parentElement) {
            const s = getComputedStyle(a);
            res.image ||= a !== document.body && s.backgroundImage !== 'none';
            if (s.backgroundColor !== 'rgba(0, 0, 0, 0)') res.layers.push(s.backgroundColor);
            if (a.matches('dialog:modal')) res.layers.push(getComputedStyle(a, '::backdrop').backgroundColor);
            res.fixed ||= s.position === 'fixed';
            res.opacity *= Number(s.opacity);
        }
        return res;
    }

    /**
     * Každý viditeľný text: farba, veľkosť, hrúbka a čo je pod ním (tvary SVG, predkovia, nakoniec
     * obloha z premenných --s1, --s2 a --s3). Kontrast počíta spec funkciami zo shared/.
     */
    function farby() {
        const out = [];
        const seen = new Set();
        for (const { n, el, box } of texty()) {
            if (seen.has(el)) continue;
            seen.add(el);
            const cs = getComputedStyle(el);
            const svg = el instanceof SVGElement;
            const p = podklad(el);
            out.push({
                ...p,
                layers: [...(svg ? tvaryPod(el, box) : []), ...p.layers],
                where: meno(el),
                text: (n.textContent ?? '').trim().slice(0, 40),
                color: svg ? cs.fill : cs.color,
                px: pismoPx(el),
                weight: Number(cs.fontWeight),
                disabled: !!el.closest(':disabled, [aria-disabled="true"]'),
                top: box.top / innerHeight,
                bottom: box.bottom / innerHeight,
            });
        }
        const root = getComputedStyle(document.documentElement);
        const sky = { top: root.getPropertyValue('--s1'), bottom: root.getPropertyValue('--s2'), shade: root.getPropertyValue('--s3') };
        return { sky, texts: out };
    }

    /**
     * Texty menšie než dovolené: bežný pod `minPx`, popisky osí (`osi`) pod `minOsPx`.
     * @param {string} osi @param {number} minPx @param {number} minOsPx
     */
    function malePismo(osi, minPx, minOsPx) {
        const out = new Set();
        for (const { n, el } of texty()) {
            const px = pismoPx(el);
            const min = el.closest(osi) ? minOsPx : minPx;
            if (px < min - 0.05) out.add(`${meno(el)} „${(n.textContent ?? '').trim().slice(0, 30)}“: ${px.toFixed(1)} px`);
        }
        return [...out];
    }

    /** Je prvok v páse, ktorý sa zámerne listuje do strán (scroll-snap-type x)? @param {Element} el */
    function vPase(el) {
        for (let a = el.parentElement; a; a = a.parentElement) if (getComputedStyle(a).scrollSnapType.startsWith('x')) return true;
        return false;
    }

    /** Predok, ktorý riadok textu oreže (overflow iné než visible a riadok mimo neho). @param {Element} el @param {DOMRect} r */
    function orezavac(el, r) {
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
            if (getComputedStyle(a).overflowX === 'visible') continue;
            const b = a.getBoundingClientRect();
            if (r.left < b.left - 0.5 || r.right > b.right + 0.5) return a;
        }
        return null;
    }

    /** Stránka širšia než okno a navigácia vyššia než miesto, ktoré jej stránka necháva dole. */
    function celaStranka() {
        const out = [];
        const W = document.documentElement.clientWidth;
        if (document.documentElement.scrollWidth > W + 0.5)
            out.push(`stránka je širšia než okno (${document.documentElement.scrollWidth} > ${W})`);
        const nav = document.querySelector('.tabs')?.getBoundingClientRect();
        const page = document.getElementById('page');
        const pad = page ? parseFloat(getComputedStyle(page).paddingBottom) : 0;
        if (nav && nav.height > pad + 0.5) out.push(`navigácia (${nav.height} px) zakryje koniec stránky (miesto ${pad} px)`);
        return out;
    }

    /**
     * Čo sa pri veľkom písme pokazí: stránka širšia než okno, text vytŕča z okna, oreže ho predok
     * alebo skončí trojbodkou, navigácia zakryje koniec stránky. Text v páse odporúčaní sa
     * posúva do strán zámerne a neráta sa.
     */
    function orezane() {
        const out = new Set(celaStranka());
        const W = document.documentElement.clientWidth;
        for (const { n, el, rects } of texty({ opacity: false })) {
            if (vPase(el)) continue;
            const text = `${meno(el)} „${(n.textContent ?? '').trim().slice(0, 24)}“`;
            for (const r of rects.filter((x) => x.width >= 1)) {
                if (r.left < -0.5 || r.right > W + 0.5) out.add(`${text} vytŕča z okna`);
                const a = orezavac(el, r);
                if (a) out.add(`${text} orezáva ${meno(a)}`);
            }
            if (getComputedStyle(el).textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 0.5)
                out.add(`${meno(el)} skončí trojbodkou`);
        }
        return [...out];
    }

    // Všetko, čo sa dá stlačiť alebo ovládať.
    const OVLADACE = [
        'button',
        'a[href]',
        'input:not([type="hidden"])',
        'select',
        'textarea',
        'summary',
        '[role="button"]',
        '[role="switch"]',
        '[role="slider"]',
        '[role="radio"]',
        '[role="checkbox"]',
        '[tabindex]:not([tabindex="-1"])',
    ].join(', ');

    /** Najvzdialenejší pevne umiestnený predok (navigácia, ponuka) - iná vrstva než stránka. @param {Element} el */
    function vrstva(el) {
        let layer = null;
        for (let a = /** @type {Element | null} */ (el); a; a = a.parentElement) if (getComputedStyle(a).position === 'fixed') layer = a;
        return layer;
    }

    /**
     * Ovládacie prvky, ktoré je vidieť: pri zaškrtávacom poli celý popis, na ktorý sa dá ťuknúť;
     * pri otvorenom modálnom dialógu len to, čo je v ňom (zvyšok stránky je nedostupný).
     */
    function ovladace() {
        const modal = document.querySelector('dialog:modal');
        /** @type {Array<{ el: Element, r: DOMRect, layer: Element | null, name: string }>} */ const out = [];
        for (const raw of document.querySelectorAll(OVLADACE)) {
            const el = raw.matches('input[type="checkbox"], input[type="radio"]') ? (raw.closest('label') ?? raw) : raw;
            if ((modal && !modal.contains(el)) || out.some((t) => t.el === el)) continue;
            const r = el.getBoundingClientRect();
            if (!el.checkVisibility({ visibilityProperty: true }) || r.width < 1 || r.height < 1) continue;
            out.push({ el, r, layer: vrstva(el), name: `${meno(el)} „${(el.textContent ?? '').trim().slice(0, 18)}“` });
        }
        return out;
    }

    /**
     * Medzera medzi dvoma ovládačmi, ak je menšia než 8 px a nejde o jeden celok bez medzery:
     * riadky zoznamu pod sebou (rovnako široké, oddelené čiarou) alebo dieliky pásu vedľa seba
     * (rovnako vysoké, medzera najviac 3 px - navigácia, prepínač obdobia). Inak null.
     * @param {DOMRect} a @param {DOMRect} b
     */
    function tesnaMedzera(a, b) {
        const dx = Math.max(b.left - a.right, a.left - b.right);
        const dy = Math.max(b.top - a.bottom, a.top - b.bottom);
        const gap = Math.max(dx, dy);
        if (gap >= 7.5) return null;
        const riadky = Math.abs(a.left - b.left) < 1 && Math.abs(a.right - b.right) < 1 && dy >= -0.5 && dy < 1.5;
        const pas = Math.abs(a.top - b.top) < 1 && Math.abs(a.bottom - b.bottom) < 1 && dx >= -0.5 && dx <= 3.5;
        return riadky || pas ? null : gap;
    }

    /** Dotykové plochy: každý ovládač aspoň 44 × 44 px a od suseda v tej istej vrstve aspoň 8 px. */
    function malePlochy() {
        const targets = ovladace();
        const out = new Set();
        for (const t of targets)
            if (t.r.width < 43.5 || t.r.height < 43.5) out.add(`${t.name}: ${Math.round(t.r.width)} × ${Math.round(t.r.height)} px`);
        targets.forEach((a, i) => {
            for (const b of targets.slice(i + 1)) {
                if (a.layer !== b.layer || a.el.contains(b.el) || b.el.contains(a.el)) continue;
                const gap = tesnaMedzera(a.r, b.r);
                if (gap !== null) out.add(`${a.name} a ${b.name}: odstup ${Math.round(gap)} px`);
            }
        });
        return [...out];
    }

    /**
     * Nadpisy v poradí: prázdny nadpis a preskočená úroveň (po h2 hneď h4).
     * @param {Element[]} hs @param {string} kde
     */
    function poradie(hs, kde) {
        const out = [];
        let prev = 0;
        for (const h of hs) {
            const level = Number(h.tagName[1]);
            const text = (h.textContent ?? '').trim();
            if (!text) out.push(`${kde}: prázdny ${meno(h)}`);
            if (prev && level > prev + 1) out.push(`${kde}: po h${prev} hneď h${level} „${text}“`);
            prev = level;
        }
        return out;
    }

    /** Otvorený dialóg: má meno a nadpisy v ňom idú bez preskakovania. @param {Element[]} headings */
    function dialog(headings) {
        const d = document.querySelector('dialog[open]');
        if (!d) return [];
        const by = d.getAttribute('aria-labelledby');
        const name = (by && document.getElementById(by)?.textContent?.trim()) || d.getAttribute('aria-label');
        return [
            ...(name ? [] : [`dialóg #${d.id} nemá meno`]),
            ...poradie(
                headings.filter((h) => d.contains(h)),
                `dialóg #${d.id}`,
            ),
        ];
    }

    /**
     * Štruktúra pre čítačku: hlavička, navigácia a obsah práve raz; mimo dialógu práve jeden
     * nadpis úrovne 1, ten je prvý a úrovne pod ním idú bez preskakovania. Nadpisy len pre
     * čítačku (.sr) sa rátajú, skryté (display: none) nie.
     */
    function struktura() {
        const out = [];
        for (const [sel, n] of [
            ['body > header', 'hlavička'],
            ['nav', 'navigácia'],
            ['main', 'obsah'],
        ])
            if (document.querySelectorAll(sel).length !== 1) out.push(`${n} (${sel}) nie je práve raz`);
        const all = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter((h) => h.checkVisibility());
        const page = all.filter((h) => !h.closest('dialog'));
        const h1 = page.filter((h) => h.tagName === 'H1');
        if (h1.length !== 1) out.push(`nadpisov h1 je ${h1.length}: ${h1.map((h) => h.textContent).join(', ')}`);
        if (page[0] && page[0].tagName !== 'H1') out.push(`prvý nadpis je ${meno(page[0])} „${page[0].textContent}“`);
        return [...out, ...poradie(page, 'stránka'), ...dialog(all)];
    }

    Object.assign(window, { kontrola: { farby, malePismo, orezane, malePlochy, struktura } });
})();
