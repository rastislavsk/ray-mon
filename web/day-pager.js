// Listovanie dní v detaile dňa karty 7 dní, spoločné pre obe appky: obsah dňa ide za prstom
// a susedný deň je vidno už počas ťahu. Kam pás dobehne, rozhoduje shared/day-pager.js; tu je
// prst, transform a kópie susedných dní. Návrh: docs/navrhy/7dni-listovanie-dni.html.
//
// Posun počas ťahu zámerne nie je v stave appky. Mení sa s každým pohybom prsta a prekreslenie
// celej appky naň nie je stavané - je to dočasný vzhľad ako tooltip. Do stavu ide až deň, na
// ktorom pás zastal (`commit`), a ten prekreslí render ako každú inú zmenu.
//
// Susedné dni kreslí ten istý render ako deň na obrazovke: appka ho na chvíľu zavolá so
// susedným dňom a hotový obsah skopíruje (`snapshot`). Iný kód, ktorý by vedel nakresliť deň,
// tak neexistuje a kópia vyzerá presne ako deň, na ktorý pás dobehne. Kópie nemajú žiadne `id`
// (v stránke by boli dvakrát) - štýly obsahu dňa preto nesmú stáť na `id`, len na triedach. Žijú
// len počas ťahu a dojazdu, sú `inert` a skryté pred čítačkou.
//
// Prst obsluhujú touch udalosti (pravidlo v CLAUDE.md, časť Dotyk a kurzor). Myš ťahať nemusí:
// dni prepínajú čipy nad detailom a klávesnica šípkami.

import { DAY_PAGER } from '../shared/config.js';
import { pagerAxis, pagerOffset, pagerSettleMs, pagerTarget, pagerVelocity } from '../shared/day-pager.js';

/** @typedef {{ index: number, count: number }} Day otvorený deň a počet dní v predpovedi */
/** @typedef {{ track: HTMLElement, area: HTMLElement, commit: (index: number) => void }} BandOpts */

/** Krivka dojazdu: rýchly štart, mäkké dosadnutie. */
const EASE = 'cubic-bezier(0.2, 0, 0, 1)';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Pás s dňom: posun, kópie susedných dní vedľa neho a dojazd na miesto.
 * @param {BandOpts} o
 */
function createBand({ track, area, commit }) {
    /** @type {{ timer: number, done: () => void } | null} */
    let anim = null;
    let shown = 0;

    /** @param {number} x */
    const move = (x) => {
        shown = x;
        track.style.transform = x ? `translate3d(${x}px, 0, 0)` : '';
    };

    const clear = () => {
        for (const el of track.querySelectorAll(':scope > .pager-ghost')) el.remove();
        track.style.transition = '';
        move(0);
    };

    /** Nový deň začína na rovnakej výške, kým je začiatok detailu vidno; inak stránka vyskočí hore k nemu. */
    const keepTop = () => {
        const top = area.getBoundingClientRect().top;
        if (top < 0) window.scrollBy(0, top - DAY_PAGER.gapPx * 6);
    };

    return {
        move,
        keepTop,
        /** Kópia dňa vedľa skutočného: `dir` -1 vľavo, 1 vpravo. @param {HTMLElement} el @param {number} dir @param {number} width */
        place(el, dir, width) {
            for (const n of [el, ...el.querySelectorAll('[id]')]) n.removeAttribute('id');
            el.style.transform = '';
            el.style.transition = '';
            el.classList.add('pager-ghost');
            el.style.left = `${dir * (width + DAY_PAGER.gapPx)}px`;
            el.inert = true;
            el.setAttribute('aria-hidden', 'true');
            track.append(el);
        },
        /** Dobehnutie pásu na `x` a zápis dňa `to`. @param {number} x @param {number} to @param {number} from @param {number} width */
        settle(x, to, from, width) {
            const done = () => {
                if (anim) clearTimeout(anim.timer);
                anim = null;
                // Najprv nový deň do skutočného obsahu, až potom preč s kópiou - inak by medzi
                // tým na jednu snímku preblikol starý deň.
                if (to !== from) commit(to);
                clear();
                if (to !== from) keepTop();
            };
            const ms = reducedMotion() ? 0 : pagerSettleMs(x - shown, width);
            if (!ms) return done();
            track.style.transition = `transform ${ms}ms ${EASE}`;
            move(x);
            // Časovač, nie transitionend: ten nepríde, keď transform už na cieli stojí alebo
            // keď prechody vypne zníženie pohybu.
            anim = { timer: window.setTimeout(done, ms + 30), done };
        },
        /** Rozbehnutý dojazd sa dokončí hneď - nový ťah alebo skok začína z hotového dňa. */
        finish: () => anim?.done(),
    };
}

/** @typedef {ReturnType<typeof createBand>} Band */

/**
 * Pohyb a koniec ťahu počúva prvok, na ktorom ťah začal, nie plocha. Kópie susedných dní kreslí
 * render do stránky (snapshot) a ten prvok pri tom nahradí novým - dotyky však ďalej chodia na
 * pôvodný, ktorý je už mimo stránky, takže plocha by sa o nich nedozvedela.
 * @param {EventTarget} target @param {(e: Event) => void} move @param {(cancel: boolean) => void} end
 * @returns {() => void} odhlásenie
 */
function follow(target, move, end) {
    const onEnd = () => end(false);
    const onCancel = () => end(true);
    target.addEventListener('touchmove', move, { passive: false });
    target.addEventListener('touchend', onEnd);
    target.addEventListener('touchcancel', onCancel);
    return () => {
        target.removeEventListener('touchmove', move);
        target.removeEventListener('touchend', onEnd);
        target.removeEventListener('touchcancel', onCancel);
    };
}

/**
 * Prvý vodorovný pohyb: šírka pásu, či je kam listovať, a kópie susedných dní vedľa pásu.
 * @param {Day} day @param {HTMLElement} track @param {Band} band @param {(days: number[]) => HTMLElement[]} snapshot
 */
function neighbors({ index, count }, track, band, snapshot) {
    const width = track.clientWidth;
    const has = { prev: index > 0, next: index < count - 1 };
    const dirs = [has.prev ? -1 : 0, has.next ? 1 : 0].filter(Boolean);
    snapshot(dirs.map((dir) => index + dir)).forEach((el, i) => band.place(el, dirs[i], width));
    return { width, has };
}

/**
 * Ťah prstom po páse: rozhodne, či je to listovanie alebo scroll, vedie pás za prstom
 * a po pustení ho nechá dobehnúť.
 * @param {HTMLElement} area @param {HTMLElement} track @param {Band} band
 * @param {() => Day | null} day @param {(days: number[]) => HTMLElement[]} snapshot
 */
function bindTouch(area, track, band, day, snapshot) {
    /** @type {{ x: number, y: number, axis: 'x' | 'y' | null, day: Day, width: number, has: { prev: boolean, next: boolean },
     *   offset: number, samples: import('../shared/day-pager.js').Sample[], stop: () => void } | null} */
    let drag = null;

    /** @param {boolean} cancel */
    const end = (cancel) => {
        const g = drag;
        drag = null;
        if (!g) return;
        g.stop();
        if (g.axis !== 'x') return;
        const dir = cancel ? 0 : pagerTarget(g.offset, pagerVelocity(g.samples), g.width, g.has);
        band.settle(-dir * (g.width + DAY_PAGER.gapPx), g.day.index + dir, g.day.index, g.width);
    };

    /** @param {Event} ev */
    const move = (ev) => {
        const e = /** @type {TouchEvent} */ (ev);
        const g = drag;
        if (!g) return;
        // Druhý prst je zoom, nie listovanie.
        if (e.touches.length !== 1) return end(true);
        const t = e.touches[0];
        const dx = t.clientX - g.x;
        if (!g.axis) {
            g.axis = pagerAxis(dx, t.clientY - g.y);
            // Zvislý pohyb je scroll - ten patrí prehliadaču a gesto už nič nerobí.
            if (g.axis === 'y') return end(true);
            if (!g.axis) return;
            Object.assign(g, neighbors(g.day, track, band, snapshot));
        }
        // Pás ide do strán, stránka sa pod ním nemá hýbať.
        if (e.cancelable) e.preventDefault();
        g.offset = pagerOffset(dx, g.width, g.has);
        band.move(g.offset);
        g.samples.push({ t: e.timeStamp, x: t.clientX });
        if (g.samples.length > 12) g.samples.shift();
    };

    area.addEventListener(
        'touchstart',
        (e) => {
            end(true);
            const d = e.touches.length === 1 ? day() : null;
            if (!d || !e.target) return;
            band.finish();
            const t = e.touches[0];
            const samples = [{ t: e.timeStamp, x: t.clientX }];
            const stop = follow(e.target, move, end);
            drag = {
                x: t.clientX,
                y: t.clientY,
                axis: null,
                day: d,
                width: 0,
                has: { prev: false, next: false },
                offset: 0,
                samples,
                stop,
            };
        },
        { passive: true },
    );
}

/**
 * @param {{
 *   area: HTMLElement,
 *   keys: HTMLElement,
 *   track: HTMLElement,
 *   day: () => Day | null,
 *   snapshot: (days: number[]) => HTMLElement[],
 *   commit: (index: number) => void,
 * }} o `area` - plocha, na ktorej ťah začína (patrí jej `touch-action: pan-y`); `keys` - kde listujú
 *   šípky na klávesnici (detail aj s čipmi dní); `track` - čo ide za prstom; `day` - otvorený deň,
 *   `null` mimo detailu dňa; `snapshot` - kópie `track` so zadanými dňami; `commit` - zápis dňa,
 *   na ktorom pás zastal, do stavu
 * @returns {{ goTo: (index: number) => void }}
 */
export function initDayPager({ area, keys, track, day, snapshot, commit }) {
    const band = createBand({ track, area, commit });
    bindTouch(area, track, band, day, snapshot);

    /** Skok na deň z čipu, tlačidla susedného dňa alebo klávesnice - s tým istým dojazdom ako po ťahu. @param {number} to */
    function goTo(to) {
        band.finish();
        const d = day();
        if (!d || to === d.index || to < 0 || to >= d.count) return;
        if (reducedMotion()) {
            commit(to);
            return band.keepTop();
        }
        const width = track.clientWidth;
        const dir = to > d.index ? 1 : -1;
        band.place(snapshot([to])[0], dir, width);
        band.settle(-dir * (width + DAY_PAGER.gapPx), to, d.index, width);
    }

    keys.addEventListener('keydown', (e) => {
        const d = day();
        if (!d || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
        e.preventDefault();
        goTo(d.index + (e.key === 'ArrowRight' ? 1 : -1));
    });

    return { goTo };
}
