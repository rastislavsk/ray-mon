// Skladanie SVG reťazcov z modelov (shared/chart-model.js). Žiadne výpočty, iba zápis.
// Farby idú cez CSS triedy (css/), nie cez atribúty.

import { compassPoint, planesRoseModel, RING } from '../shared/chart-model.js';
import { escapeHtml } from '../shared/format.js';
import { dirShort } from '../shared/setup-texts.js';

const n = (/** @type {number} */ v) => Number(v.toFixed(2));

/** Denný prstenec: plán dňa (alebo rozvrh tarify) ako oblúky po obvode.
 * @param {ReturnType<typeof import('../shared/chart-model.js').dayRingModel>} m */
export function dayRingSvg(m) {
    const r = RING.rDay;
    return m
        .map(
            (a) =>
                `<path class="day-band ${a.cls}" d="M ${n(a.start.x)} ${n(a.start.y)} A ${r} ${r} 0 ${a.large} 1 ${n(a.end.x)} ${n(a.end.y)}"/>`,
        )
        .join('');
}

// ---- Sprievodca nastavením elektrárne ---------------------------------------------

/** @param {{ x: number, y: number }} p */
const xy = (p) => `${n(p.x)} ${n(p.y)}`;

/**
 * Kompas smeru plochy. Kresba je len obrázok (aria-hidden); vyberá sa tlačidlami nad ňou,
 * ktoré skladá render - každé má svoj názov pre čítačku a dá sa naň prejsť klávesnicou.
 * @param {ReturnType<typeof import('../shared/chart-model.js').compassModel>} m
 */
export function compassSvg(m) {
    const { rInner: ri, rOuter: ro, rSun: rs } = m;
    const sectors = m.sectors
        .map(
            (s) =>
                `<path class="sector${s.on ? ' on' : ''}" d="M ${xy(s.outer[0])} A ${ro} ${ro} 0 0 1 ${xy(s.outer[1])} L ${xy(s.inner[0])} A ${ri} ${ri} 0 0 0 ${xy(s.inner[1])} Z"/>`,
        )
        .join('');
    const [a, b, c] = m.sunPath;
    const panels = [0, 1, 2, 3]
        .flatMap((i) => [0, 1].map((j) => `<rect class="pv" x="${117 + i * 17}" y="${155 + j * 15}" width="14" height="12" rx="1"/>`))
        .join('');
    return (
        `<svg class="compass-art" viewBox="0 0 300 300" aria-hidden="true">` +
        `<circle class="ring" cx="150" cy="150" r="126"/>` +
        `<path class="sun-path" d="M ${xy(a)} A ${rs} ${rs} 0 0 ${m.sunSweep} ${xy(b)} A ${rs} ${rs} 0 0 ${m.sunSweep} ${xy(c)}"/>` +
        `<circle class="sun" cx="${n(m.sun.x)}" cy="${n(m.sun.y)}" r="7"/>${sectors}` +
        `<g transform="rotate(${m.rotateDeg} 150 150)"><rect class="roof-top" x="112" y="112" width="76" height="76" rx="4"/>` +
        `<line class="ridge" x1="112" y1="150" x2="188" y2="150"/>${panels}` +
        `<line class="arrow" x1="150" y1="190" x2="150" y2="214"/><polygon class="arrow-head" points="150,222 144.5,212 155.5,212"/></g></svg>`
    );
}

/**
 * Ružica plôch v karte elektrárne: výseky plôch s počtom panelov, strana poludnia so slnkom
 * a písmená smerov. Farby a veľkosť písma idú cez triedy v CSS.
 * @param {ReturnType<typeof import('../shared/chart-model.js').planesRoseModel>} m @param {string} label
 */
function planesRoseSvg(m, label) {
    const { c, rRing: r } = m;
    const [e, noon, w] = m.noonArc;
    const vb = 2 * c;
    let out = `<svg class="planes-compass" viewBox="0 0 ${vb} ${vb}" role="img" aria-label="${escapeHtml(label)}">`;
    out += `<circle class="ring" cx="${c}" cy="${c}" r="${r}"/>`;
    out += `<path class="noon" d="M ${xy(e)} A ${r} ${r} 0 0 ${m.noonSweep} ${xy(noon)} A ${r} ${r} 0 0 ${m.noonSweep} ${xy(w)}"/>`;
    for (const t of m.ticks)
        out += `<line class="tick${t.major ? ' major' : ''}" x1="${n(t.a.x)}" y1="${n(t.a.y)}" x2="${n(t.b.x)}" y2="${n(t.b.y)}"/>`;
    for (const v of m.wedges) {
        const [o1, o2] = v.outer;
        const [i1, i2] = v.inner;
        out +=
            `<path class="wedge${v.main ? ' main' : ''}" d="M ${xy(i2)} L ${xy(o1)} A ${n(v.r1)} ${n(v.r1)} 0 0 1 ${xy(o2)} L ${xy(i1)} A ${v.r0} ${v.r0} 0 0 0 ${xy(i2)} Z"/>` +
            // +5 posadí číslo (14) opticky na bod - text sa kreslí od účaria.
            `<text class="num" x="${n(v.num.x)}" y="${n(v.num.y + 5)}">${v.num.text}</text>`;
    }
    out += `<circle class="sun" cx="${n(m.sun.x)}" cy="${n(m.sun.y)}" r="6"/>`;
    for (const l of m.letters)
        out += `<text class="dir ${l.kind}" x="${n(l.x)}" y="${n(l.y + (l.kind === 'sun' ? 4 : 4.5))}">${dirShort(l.az)}</text>`;
    return `${out}<circle class="hub" cx="${c}" cy="${c}" r="3"/></svg>`;
}

/**
 * Ružica plôch karty elektrárne z plôch a modelu karty (plantHero).
 * @param {Array<{ panels: number, azimuthDeg: number }>} strings @param {{ south: boolean, planes: string }} h
 */
export function plantRoseSvg(strings, h) {
    return planesRoseSvg(planesRoseModel(strings, h.south), h.planes);
}

/** Malý kompas so šípkou - smer plochy v zhrnutí a v prehľade plôch. @param {number} azDeg */
export function miniCompassSvg(azDeg) {
    const tip = compassPoint(azDeg, 11, 17);
    return (
        `<svg class="mini-compass" viewBox="0 0 34 34" aria-hidden="true"><circle class="ring" cx="17" cy="17" r="15"/>` +
        `<text x="17" y="7">S</text><line class="arrow" x1="17" y1="17" x2="${n(tip.x)}" y2="${n(tip.y)}"/><circle class="hub" cx="17" cy="17" r="2.5"/></svg>`
    );
}

/** Malý prstenec tarify (zhrnutie, typ sadzby, zoznam rozvrhov). @param {ReturnType<typeof import('../shared/chart-model.js').dayRingModel>} arcs */
export function tariffMiniSvg(arcs) {
    return `<svg class="tariff-mini" viewBox="-10 -10 260 260" aria-hidden="true">${dayRingSvg(arcs)}</svg>`;
}

/**
 * Obsah kruhu rozvrhu v sprievodcovi (vnútro `<g>` - samotné `<svg>` ostáva v stránke, lebo drží
 * zachytený prst počas ťahania). V strede pásmo, ktorým sa práve maľuje.
 * @param {ReturnType<typeof import('../shared/chart-model.js').tariffRingModel>} m
 * @param {{ name: string, level: string, tier: string }} brush
 */
export function tariffRingSvg(m, brush) {
    const line = (/** @type {{ a: {x: number, y: number}, b: {x: number, y: number} }} */ l, /** @type {string} */ cls) =>
        `<line class="${cls}" x1="${n(l.a.x)}" y1="${n(l.a.y)}" x2="${n(l.b.x)}" y2="${n(l.b.y)}"/>`;
    return (
        dayRingSvg(m.arcs) +
        m.cuts.map((c) => line(c, 'cut')).join('') +
        m.ticks.map((t) => line(t, 'tick')).join('') +
        m.hours.map((h) => `<text class="hour" x="${n(h.at.x)}" y="${n(h.at.y)}">${h.label}</text>`).join('') +
        `<text class="brush-lbl" x="120" y="104">MAĽUJEŠ</text>` +
        `<text class="brush-name ${brush.tier}" x="120" y="126">${escapeHtml(brush.name)}</text>` +
        `<text class="brush-lbl" x="120" y="144">${escapeHtml(brush.level)}</text>`
    );
}

/** Strecha z boku so sklonom. @param {ReturnType<typeof import('../shared/chart-model.js').tiltModel>} m @param {number} tiltDeg */
export function tiltSvg(m, tiltDeg) {
    const { pivot: p, end: e } = m;
    const arc = m.arc ? `<path class="angle" d="M ${xy(m.arc.from)} A ${m.arc.r} ${m.arc.r} 0 0 1 ${xy(m.arc.to)}"/>` : '';
    return (
        `<svg class="tilt-art" viewBox="0 0 320 190" aria-hidden="true"><line class="ground" x1="14" y1="${m.ground}" x2="306" y2="${m.ground}"/>` +
        `<rect class="wall" x="${m.wallLeft}" y="${p.y}" width="${p.x - m.wallLeft}" height="${m.ground - p.y}"/>` +
        `<polygon class="wedge" points="${p.x},${p.y} ${n(e.x)},${n(e.y)} ${n(e.x)},${p.y}"/>` +
        `<line class="level" x1="${p.x}" y1="${p.y}" x2="${p.x - 110}" y2="${p.y}"/>` +
        `<line class="plane" x1="${p.x}" y1="${p.y}" x2="${n(e.x)}" y2="${n(e.y)}"/>` +
        `<line class="ray" x1="${n(m.mid.x)}" y1="${n(m.mid.y)}" x2="${m.sun.x}" y2="${m.sun.y}"/><circle class="sun" cx="${m.sun.x}" cy="${m.sun.y}" r="10"/>` +
        `${arc}<text x="${n(m.label.x)}" y="${n(m.label.y)}">${tiltDeg}°</text></svg>`
    );
}

/** Mriežka panelov. @param {ReturnType<typeof import('../shared/chart-model.js').panelGridModel>} m */
export function panelGridSvg(m) {
    const cells = m.cells
        .map(
            (c) =>
                `<rect class="pv" x="${c.x}" y="${c.y}" width="${m.w}" height="${m.h}" rx="2"/><line class="pv-line" x1="${c.x}" y1="${c.y + m.h / 2}" x2="${c.x + m.w}" y2="${c.y + m.h / 2}"/>`,
        )
        .join('');
    const more = m.more ? `<text x="${m.width - 6}" y="${m.height - 4}" text-anchor="end">+${m.more}</text>` : '';
    return `<svg class="panel-grid" viewBox="0 0 ${m.width} ${m.height}" aria-hidden="true">${cells}${more}</svg>`;
}

/** Štítok zo zadnej strany panelu so zvýrazneným výkonom (Pmax). @param {string} wpText */
export function panelLabelSvg(wpText) {
    return (
        `<svg class="panel-label" viewBox="0 0 240 132" aria-hidden="true"><rect class="label-bg" x="1" y="1" width="238" height="130" rx="8"/>` +
        `<text x="14" y="24">PHOTOVOLTAIC MODULE</text><text x="14" y="42">Model  XY-${escapeHtml(wpText)}M-54HL</text>` +
        `<rect class="mark" x="8" y="52" width="224" height="24" rx="4"/><text class="pmax" x="14" y="69">Pmax  ${escapeHtml(wpText)} W</text>` +
        `<text x="14" y="94">Voc 39,4 V   Isc 13,9 A</text><text x="14" y="112">Vmp 32,6 V   Imp 13,3 A</text></svg>`
    );
}
