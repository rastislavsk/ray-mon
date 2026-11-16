// Scéna toku energie na karte Teraz (docs/navrhy/teraz-tok-energie.html, návrh 1): slnko a elektráreň vľavo,
// náš dom vpravo (čiarová kresba img/dom.png), medzi nimi stĺp s transformátorom, stožiar a vedenie. Zo slnka
// padajú do panelov zlaté čiarky, po vedení beží žiariaci bod - zlatý von do siete, modrobiely dnu. Čísla
// (po ťuknutí) sú priamo v scéne, bez slov. Čo kresliť, počíta shared/teraz-scena.js; tu sa len skladá SVG.
// Pohyb je v CSS (lúče, para) a SMIL (body na vedení); pri obmedzenom pohybe CSS body skryje a ukáže šípku.

import { escapeHtml } from '../../shared/format.js';

/** @typedef {ReturnType<typeof import('../../shared/teraz-scena.js').scenaModel>} Scena */

/** Rozmery scény v jednotkách SVG; spodok je zem, horný okraj sa na nižšej obrazovke oreže. */
export const SCENA = { w: 330, h: 234 };

/** Slnko oblohy (vľavo hore, nad hlavičkou) v súradniciach scény - odtiaľ idú lúče. */
const SLNKO = [-14, -80];

/**
 * Kresba domu: 550 × 681 px, biele čiary na priehľadnom pozadí. Na scénu ju posunie a zmenší `x`, `k`;
 * riadok kresby `dno` leží na zemi `y`. Pravý okraj kresby je odrezaný, preto je za okrajom scény.
 */
const DOM = { x: 219, y: 230, k: 0.224, dno: 650, w: 550, h: 681 };
/** Rohy poľa panelov na kresbe: hore vľavo, hore vpravo, dole vľavo, dole vpravo. */
const PANELY = [
    [168, 118],
    [345, 163],
    [100, 265],
    [268, 313],
];
/** Prípojka: vrch ľavej steny domu pod odkvapom. */
const PRIPOJKA = [40, 380];

/** Bod kresby domu v súradniciach scény. @param {number[]} p */
const T = (p) => [DOM.x + DOM.k * p[0], DOM.y - (DOM.dno - p[1]) * DOM.k];
/** @param {number[]} a @param {number[]} b @param {number} t */
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
/** Bod v štvoruholníku q (hore-ľavo, hore-pravo, dole-ľavo, dole-pravo). @param {number[][]} q @param {number} u @param {number} v */
const quad = (q, u, v) => lerp(lerp(q[0], q[1], u), lerp(q[2], q[3], u), v);
/** @param {number} n */
const r1 = (n) => Math.round(n * 10) / 10;

/** Krajina je kreslená o ZEM vyššie (posunie ju transform). */
const ZEM = 8;
/** Krajina (stĺp, stožiar, elektráreň) je kreslená sprava a zrkadlí sa doľava; bod domu do nej prepočíta. @param {number[]} p */
const doKrajiny = (p) => [SCENA.w - p[0], p[1] - ZEM];

/** Stožiar vedenia z priehradoviny. @param {number} x @param {number} b päta @param {number} h výška */
function stoziar(x, b, h) {
    const t = b - h;
    const w = h * 0.34;
    const legX = (/** @type {number} */ y, /** @type {number} */ s) => x + s * (w / 2 - ((b - y) / (h * 0.75)) * (w / 2 - w * 0.1));
    let d = `M${x - w / 2} ${b}L${x - w * 0.1} ${t + h * 0.25}L${x} ${t}L${x + w * 0.1} ${t + h * 0.25}L${x + w / 2} ${b}`;
    d += `M${x - h * 0.3} ${t + h * 0.22}L${x + h * 0.3} ${t + h * 0.22}M${x - h * 0.22} ${t + h * 0.4}L${x + h * 0.22} ${t + h * 0.4}`;
    for (let k = 0; k < 5; k++) {
        const y1 = t + h * 0.25 + ((b - t - h * 0.25) * k) / 5;
        const y2 = t + h * 0.25 + ((b - t - h * 0.25) * (k + 1)) / 5;
        d += `M${r1(legX(y1, -1))} ${r1(y1)}L${r1(legX(y2, 1))} ${r1(y2)}M${r1(legX(y1, 1))} ${r1(y1)}L${r1(legX(y2, -1))} ${r1(y2)}`;
    }
    return `<path class="sc-stoziar" d="${d}"/>`;
}
/** Konce horného ramena stožiara. @param {number} x @param {number} b @param {number} h */
const ramena = (x, b, h) => [
    [x - h * 0.3, b - h + h * 0.22],
    [x + h * 0.3, b - h + h * 0.22],
];

/** Vedenie s prehybom medzi bodmi. @param {number[][]} body */
function vedenie(body) {
    let d = `M${r1(body[0][0])} ${r1(body[0][1])}`;
    for (let i = 1; i < body.length; i++) {
        const [x1, y1] = body[i - 1];
        const [x2, y2] = body[i];
        d += `Q${r1((x1 + x2) / 2)} ${r1(Math.max(y1, y2) + Math.hypot(x2 - x1, y2 - y1) * 0.09)} ${r1(x2)} ${r1(y2)}`;
    }
    return d;
}

/** Chladiaca veža. @param {number} cx @param {number} base @param {number} h @param {number} wb šírka päty */
function veza(cx, base, h, wb) {
    const top = base - h;
    return (
        `<path class="sc-veza" d="M${cx - wb / 2} ${base}C${r1(cx - wb * 0.3)} ${r1(base - h * 0.55)} ${r1(cx - wb * 0.27)} ${r1(base - h * 0.82)} ${r1(cx - wb * 0.33)} ${top}` +
        `L${r1(cx + wb * 0.33)} ${top}C${r1(cx + wb * 0.27)} ${r1(base - h * 0.82)} ${r1(cx + wb * 0.3)} ${r1(base - h * 0.55)} ${cx + wb / 2} ${base}Z"/>` +
        `<ellipse class="sc-veza-hrdlo" cx="${cx}" cy="${top}" rx="${r1(wb * 0.33)}" ry="${r1(wb * 0.06)}"/>`
    );
}

/** Para nad vežou: obláčiky stúpajú a rozplývajú sa (CSS). @param {number} cx @param {number} top @param {number} n */
function para(cx, top, n) {
    let s = '';
    for (let i = 0; i < n; i++)
        s += `<circle class="sc-para" cx="${cx + (i % 2 ? 3 : -3)}" cy="${top - 3}" r="${r1(5 + (i % 3) * 1.6)}" style="animation-delay:${r1((-i * 7) / n)}s"/>`;
    return `<g class="sc-pary">${s}</g>`;
}

/** Elektráreň v opare: dve chladiace veže, blok, komín s výstražným svetlom. */
function elektraren() {
    let g = '<g class="sc-elektraren">';
    g += '<rect class="sc-blok" x="258" y="170" width="44" height="18"/><rect class="sc-blok2" x="266" y="162" width="20" height="9"/>';
    g +=
        '<rect class="sc-komin" x="296" y="132" width="4" height="56"/><rect class="sc-pas" x="296" y="136" width="4" height="3"/><rect class="sc-pas" x="296" y="146" width="4" height="3"/>';
    g += veza(318, 190, 34, 26) + veza(282, 192, 42, 32);
    for (let i = 0; i < 6; i++) g += `<rect class="sc-okno" x="${261 + i * 7}" y="178" width="2" height="2"/>`;
    g += '<circle class="sc-blik" cx="298" cy="131" r="1.6"/></g>';
    return g + para(282, 150, 5) + para(318, 156, 4);
}

/** Stĺp nízkeho napätia s transformátorom. @param {number} x */
const trafo = (x) =>
    `<g class="sc-trafo"><line x1="${x}" y1="222" x2="${x}" y2="150" stroke-width="2.4"/><line x1="${x - 10}" y1="156" x2="${x + 10}" y2="156" stroke-width="1.6"/>` +
    `<rect x="${x - 6}" y="178" width="12" height="13" rx="1.5"/></g>`;

/** Lúče zo slnka do panelov: zlaté čiarky, ich počet a jas podľa výroby. @param {Scena} s */
function luce(s) {
    if (!s.luce) return '';
    const ciele = [0.12, 0.26, 0.4, 0.55, 0.68, 0.8, 0.9].map((u, i) => T(quad(PANELY, u, i % 2 ? 0.3 : 0.7)));
    let g = `<g class="sc-luce" style="opacity:${s.jas}">`;
    for (let i = 0; i < s.luce; i++) {
        const [x, y] = ciele[Math.round((i * (ciele.length - 1)) / Math.max(1, s.luce - 1))];
        const st = `--d:${r1(0.55 + (i % 3) * 0.07)}s;animation-delay:${-r1((i * 0.37) % 0.6)}s`;
        const ciara = `x1="${SLNKO[0]}" y1="${SLNKO[1]}" x2="${r1(x)}" y2="${r1(y)}" style="${st}"`;
        g += `<line class="sc-luc-g" ${ciara}/><line class="sc-luc" ${ciara}/>`;
    }
    return g + '</g>';
}

/** Žiariace body na vedení (SMIL) a šípka smeru pre obmedzený pohyb. @param {Scena} s */
function body(s) {
    if (!s.siet) return '';
    const von = s.siet.smer === 'von';
    const dur = 3.8;
    let g = '';
    for (let i = 0; i < s.body; i++)
        g +=
            `<g class="sc-bod" data-smer="${s.siet.smer}"><circle r="9" fill="url(#sc-bod)"/><circle r="2.4" class="sc-jadro"/>` +
            `<animateMotion dur="${dur}s" begin="${-r1((dur * i) / s.body)}s" repeatCount="indefinite"${von ? '' : ' keyPoints="1;0" keyTimes="0;1" calcMode="linear"'}>` +
            `<mpath href="#sc-vedenie"/></animateMotion></g>`;
    // Šípka v polovici vedenia (v krajine, ktorá je zrkadlová: vo vlastných súradniciach ide od domu doprava).
    g += `<g class="sc-sipka" data-smer="${s.siet.smer}" transform="translate(164 170) rotate(${von ? -8 : 172})"><circle r="6"/><path d="M-4 -3.5L3 0L-4 3.5Z"/></g>`;
    return g;
}

/** Otvorenie SVG scény: rovnaké pre kresbu aj vrstvu čísel, aby ležali presne na sebe. */
const SVG = `<svg viewBox="0 0 ${SCENA.w} ${SCENA.h}" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false"`;

/**
 * Čísla v scéne (po ťuknutí): pod slnkom výroba, nad domom spotreba, nad vedením sieť. Bez slov. Sú vo vlastnej
 * vrstve nad kresbou - ich ukázanie tak kresbu neprepíše a pohyb v nej nezačne odznova. Skryté sú prázdny text.
 * @param {Scena} s @param {boolean} ukaz
 */
export function cislaSvg(s, ukaz) {
    if (!ukaz) return '';
    /** @param {string} k @param {number[]} p @param {string} v */
    const c = (k, p, v) =>
        `<text class="sc-cislo" data-k="${k}" x="${p[0]}" y="${p[1]}"><tspan>${escapeHtml(v)}</tspan><tspan class="sc-kw" dx="2">kW</tspan></text>`;
    let o = '';
    if (s.vyroba) o += c('slnko', [64, 54], s.vyroba);
    if (s.dom) o += c('dom', [288, 62], s.dom);
    if (s.siet) o += c(s.siet.smer, [96, 120], s.siet.kw);
    return `${SVG}>${o}</svg>`;
}

/**
 * Kresba scény ako SVG. `noc` stmaví krajinu a dom.
 * @param {Scena} s @param {boolean} noc
 */
export function scenaSvg(s, noc) {
    const r2 = ramena(238, 198, 40);
    const hlavna = vedenie([doKrajiny(T(PRIPOJKA)), [206, 156], r2[0], [262, 172]]);
    const druha = vedenie([[206, 156], [216, 156], r2[1], [270, 168]]);
    const panely = [PANELY[0], PANELY[1], PANELY[3], PANELY[2]].map((p) => T(p).map(r1).join(',')).join(' ');
    const stred = T(quad(PANELY, 0.5, 0.5));
    const y = DOM.y - DOM.dno * DOM.k;
    return (
        `${SVG}${noc ? ' data-noc' : ''}>` +
        `<defs><linearGradient id="sc-luc" gradientUnits="userSpaceOnUse" x1="${SLNKO[0]}" y1="${SLNKO[1]}" x2="${r1(stred[0])}" y2="${r1(stred[1])}">` +
        '<stop offset="0" stop-color="#ffe7a0" stop-opacity="0"/><stop offset=".35" stop-color="#ffe7a0" stop-opacity=".15"/>' +
        '<stop offset=".8" stop-color="#ffd166" stop-opacity=".95"/><stop offset="1" stop-color="#fff2c4"/></linearGradient>' +
        '<linearGradient id="sc-zem" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="sc-zem0"/><stop offset="1" class="sc-zem1"/></linearGradient>' +
        '<linearGradient id="sc-veza" x1="0" x2="1"><stop offset="0" class="sc-veza0"/><stop offset=".65" class="sc-veza1"/><stop offset="1" class="sc-veza2"/></linearGradient>' +
        '<linearGradient id="sc-panely" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1c2a5a"/><stop offset="1" stop-color="#0f1838"/></linearGradient>' +
        '<linearGradient id="sc-lesk" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6d8"/><stop offset=".5" stop-color="#fff6d8" stop-opacity=".1"/><stop offset="1" stop-color="#fff6d8" stop-opacity="0"/></linearGradient>' +
        '<radialGradient id="sc-bod"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="currentColor"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></radialGradient></defs>' +
        // Krajina sprava, zrkadlená doľava: elektráreň pri slnku, dom na druhej strane.
        `<g transform="translate(0 ${ZEM}) matrix(-1 0 0 1 ${SCENA.w} 0)">` +
        '<path class="sc-kopce" d="M-10 196 C40 186 90 192 150 186 S250 178 340 184 L340 240 L-10 240Z"/>' +
        elektraren() +
        '<path class="sc-pod" d="M-10 214 C60 204 140 210 210 204 S300 198 340 202 L340 240 L-10 240Z"/>' +
        stoziar(238, 198, 40) +
        `<path class="sc-drot" d="${druha}"/><path id="sc-vedenie" class="sc-drot" d="${hlavna}"/>` +
        trafo(206) +
        body(s) +
        '</g>' +
        // Dom: panely sú jediná plná plocha, aby bolo vidno, kam padajú lúče.
        `<polygon class="sc-panely" points="${panely}"/>` +
        (s.luce ? `<polygon class="sc-lesk" points="${panely}"/>` : '') +
        `<image class="sc-dom" href="img/dom.png" x="${DOM.x}" y="${r1(y)}" width="${r1(DOM.w * DOM.k)}" height="${r1(DOM.h * DOM.k)}"/>` +
        luce(s) +
        '</svg>'
    );
}
