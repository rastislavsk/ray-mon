// Bubliny polí dlaždíc karty Dnes (docs/navrhy/dnes-bubliny-poli.html, A): panel zdola s menom poľa, vetou s hlavným
// číslom a obrázkom. Model počíta shared/dnes-bubliny.js, tu sa len kreslí. Stĺpce a os sú HTML s výškou či polohou
// v %, krivka dňa SVG roztiahnuté na šírku panela - popisky sú vždy text v písme appky, aj v širokom prehľade.

import { HOUR_RANGE } from '../../shared/chart-model.js';
import { escapeHtml } from '../../shared/format.js';
import { DNES_BUBLINY } from '../../shared/messages-core.js';
import { kartaIcon, vecIcon, weatherIcon } from './icons.js';

/** @typedef {import('../../shared/dnes-bubliny.js').DnesBublina} DnesBublina */

const DEN = 24 * 60;
/** Poloha minúty dňa na osi 0 – 24 h v %. @param {number} min */
const naOsi = (min) => `${((100 * min) / DEN).toFixed(2)}%`;

/** Popisky hodín pod osou: `hodiny` na pozíciách `x` v %. @param {{ text: string, x: number }[]} body */
const popisky = (body) =>
    `<div class="bb-popisky" aria-hidden="true">${body.map((b) => `<span style="left:${b.x.toFixed(2)}%">${b.text}</span>`).join('')}</div>`;

/** Legenda pod grafom. @param {{ druh: string, text: string }[]} veci */
const legenda = (veci) =>
    `<p class="bb-leg" aria-hidden="true">${veci.map((v) => `<span><i data-druh="${v.druh}"></i>${escapeHtml(v.text)}</span>`).join('')}</p>`;

/** Poznámka pod obrázkom. @param {string} text */
const pozn = (text) => (text ? `<p class="bb-pozn">${escapeHtml(text)}</p>` : '');

/** Veľké veci: os dňa s oknom a teraz, pod ňou veci s časom. @param {Extract<DnesBublina, { kind: 'velke' }>} b */
function velke(b) {
    const den =
        b.den.rise !== null && b.den.set !== null
            ? `<i class="bb-den" style="left:${naOsi(b.den.rise)};width:${naOsi(b.den.set - b.den.rise)}"></i>`
            : '';
    const okno = b.okno ? `<i class="bb-okno" style="left:${naOsi(b.okno.od)};width:${naOsi(b.okno.do - b.okno.od)}"></i>` : '';
    const os =
        `<div class="bb-os" aria-hidden="true">${den}${okno}<i class="bb-teraz" style="left:${naOsi(b.nowMin)}"></i></div>` +
        popisky([0, 6, 12, 18, 24].map((h) => ({ text: String(h), x: (100 * h) / 24 })));
    const leg = legenda([
        ...(b.okno ? [{ druh: 'okno', text: `${DNES_BUBLINY.okno} ${b.oknoText}` }] : []),
        { druh: 'teraz', text: DNES_BUBLINY.teraz },
    ]);
    const veci = b.veci.length
        ? `<ul class="bb-veci">${b.veci
              .map(
                  (v) =>
                      `<li${v.slnko ? ' data-slnko' : ''}><span class="bb-kruh">${vecIcon(v.id)}</span>${escapeHtml(v.name)}<b>${v.cas}</b></li>`,
              )
              .join('')}</ul>`
        : '';
    return os + leg + veci + pozn(b.pozn);
}

/**
 * Zo strechy: predpoveď prerušovanou čiarou, namerané zelenou plochou, cez deň čiara teraz. Os x sú hodiny HOUR_RANGE,
 * os y od nuly po najvyšší výkon. @param {Extract<DnesBublina, { kind: 'strecha' }>} b
 */
function strecha(b) {
    const W = 240;
    const H = 100;
    const od = HOUR_RANGE.min;
    const po = HOUR_RANGE.max;
    const top = Math.max(0.1, ...b.predpoved.map((p) => p.kw), ...b.namerane.map((p) => p.kw)) * 1.08;
    const x = (/** @type {number} */ h) => ((Math.min(po, Math.max(od, h)) - od) / (po - od)) * W;
    const y = (/** @type {number} */ kw) => H - (kw / top) * H;
    const ciara = (/** @type {{ hour: number, kw: number }[]} */ pts) =>
        pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.hour).toFixed(1)},${y(p.kw).toFixed(1)}`).join('');
    const plocha = (/** @type {{ hour: number, kw: number }[]} */ pts) =>
        pts.length ? `${ciara(pts)}L${x(pts[pts.length - 1].hour).toFixed(1)},${H}L${x(pts[0].hour).toFixed(1)},${H}Z` : '';
    const pred = b.predpoved.filter((p) => p.hour >= od && p.hour <= po);
    const mer = b.namerane.filter((p) => p.hour >= od && p.hour <= po);
    const teraz =
        b.nowMin === null ? '' : `<i class="bb-teraz" style="left:${(((b.nowMin / 60 - od) / (po - od)) * 100).toFixed(2)}%"></i>`;
    const cisla = `<div class="bb-cisla">${b.cisla.map((c) => `<p><b>${escapeHtml(c.value)}</b> ${escapeHtml(c.label)}</p>`).join('')}</div>`;
    const graf =
        `<div class="bb-krivka" aria-hidden="true"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">` +
        `<path class="bb-pred-plocha" d="${plocha(pred)}"/><path class="bb-pred" d="${ciara(pred)}"/>` +
        (mer.length ? `<path class="bb-mer-plocha" d="${plocha(mer)}"/><path class="bb-mer" d="${ciara(mer)}"/>` : '') +
        `</svg>${teraz}</div>` +
        popisky([6, 9, 12, 15, 18, 21].map((h) => ({ text: String(h), x: ((h - od) / (po - od)) * 100 })));
    return (
        cisla +
        graf +
        legenda([
            { druh: 'namerane', text: DNES_BUBLINY.namerane },
            { druh: 'predpoved', text: DNES_BUBLINY.predpoved },
        ])
    );
}

/** Ako keby: ikona, číslo s menom a z čoho sa ráta. @param {Extract<DnesBublina, { kind: 'eq' }>} b */
const eq = (b) =>
    `<ul class="bb-eq">${b.riadky
        .map((r) => `<li>${kartaIcon(r.ikona)}<b>${escapeHtml(`${r.value} ${r.label}`)}</b><span>${escapeHtml(r.ako)}</span></li>`)
        .join('')}</ul>`;

/** Predpoveď: šesť hodín s ikonou, teplotou a zrážkami. @param {Extract<DnesBublina, { kind: 'predpoved' }>} b */
const predpoved = (b) =>
    `<ul class="bb-hodiny">${b.hodiny
        .map(
            (h) =>
                `<li><span>${h.cas}</span>${h.weather ? weatherIcon(h.weather) : '<i class="wi"></i>'}<b>${h.temp ?? ''}</b>` +
                `${h.zrazky ? `<span class="bb-zrazky">${escapeHtml(h.zrazky)}</span>` : ''}</li>`,
        )
        .join('')}</ul>${pozn(b.pozn)}`;

/**
 * Stĺpce hodín či dní: výška v % najvyššieho, hodnota nad stĺpcom, popis pod ním (len ten, ktorý sa má ukázať).
 * @param {{ pct: number, nad: string, pod: string, druh?: string }[]} st @param {string} [trieda]
 */
const stlpce = (st, trieda = '') =>
    `<ol class="bb-stlpce${trieda ? ` ${trieda}` : ''}" aria-hidden="true">${st
        .map(
            (s) =>
                `<li${s.druh ? ` data-druh="${s.druh}"` : ''}><span class="bb-s"><b>${s.nad}</b><i style="height:${Math.max(2, s.pct).toFixed(1)}%"></i></span>` +
                `<span>${s.pod}</span></li>`,
        )
        .join('')}</ol>`;

/** Oblačnosť po hodinách: plný stĺpec je 100 %, nad ním percento. @param {Extract<DnesBublina, { kind: 'oblacnost' }>} b */
const oblacnost = (b) =>
    stlpce(
        b.hodiny.map((h) => ({ pct: h.pct, nad: String(h.pct), pod: h.hour % 3 === 0 ? String(h.hour) : '' })),
        'bb-oblaky',
    ) + pozn(b.pozn);

/** Najviac slnka: stĺpce hodín s kW, najsilnejšia zelená, prešlé tlmené. @param {Extract<DnesBublina, { kind: 'slnko' }>} b */
function slnko(b) {
    const top = Math.max(0.1, ...b.stlpce.map((s) => s.kw));
    return (
        stlpce(
            b.stlpce.map((s) => ({
                pct: (100 * s.kw) / top,
                nad: s.kw >= top * 0.25 ? s.text : '',
                pod: s.hour % 3 === 0 ? String(s.hour) : '',
                druh: s.max ? 'max' : s.preslo ? 'preslo' : '',
            })),
        ) + pozn(b.pozn)
    );
}

/** Kedy lepšie: dni v kWh, najsilnejší zelený. @param {Extract<DnesBublina, { kind: 'lepsie' }>} b */
function lepsie(b) {
    const top = Math.max(0.1, ...b.dni.map((d) => d.kwh));
    return (
        stlpce(
            b.dni.map((d) => ({ pct: (100 * d.kwh) / top, nad: d.text, pod: escapeHtml(d.name), druh: d.max ? 'max' : '' })),
            'bb-dni',
        ) + pozn(b.pozn)
    );
}

/**
 * Obsah bubliny pod nadpisom. Obrázky sú pre čítačku skryté, to podstatné povie nadpis a text vedľa nich.
 * @param {DnesBublina} b
 */
export function bublinaHtml(b) {
    if (b.kind === 'velke') return velke(b);
    if (b.kind === 'strecha') return strecha(b);
    if (b.kind === 'eq') return eq(b);
    if (b.kind === 'predpoved') return predpoved(b);
    if (b.kind === 'oblacnost') return oblacnost(b);
    if (b.kind === 'slnko') return slnko(b);
    return lepsie(b);
}
