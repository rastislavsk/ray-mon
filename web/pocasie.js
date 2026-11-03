// Počasie v pozadí karty Teraz (docs/navrhy/teraz-pocasie-2.html): vrstvy kresby pre obe appky.
// Čo je vidno, rozhoduje web/pocasie.css podľa data-wx a data-noc na nosiči, farby a polohu
// mesiaca každá appka vo svojom style.css. Stav počasia počíta shared/pocasie.js (terazModel).
// Neutrálny modul: nesiaha na DOM ani na stav appky, len skladá HTML a atribúty.

import { HVIEZDY } from '../shared/config.js';

/** Delenie fázy Mesiaca: pol dňa. Jemnejšie by kresba prepisovala vrstvy (a reštartovala pohyb) pri každom prekreslení. */
const FAZY = 59;

/**
 * Mesiac vo fáze `faza` (0 nov, 0,5 spln): osvetlená časť ohraničená polkruhom a polelipsou
 * terminátora, neosvetlená len tušená. Na severnej pologuli dorastá sprava a ubúda zľava, na
 * južnej (`juh`) naopak - kresba je zrkadlová.
 * @param {number} faza @param {boolean} juh
 */
function mesiacSvg(faza, juh) {
    const rx = (Math.abs(Math.cos(2 * Math.PI * faza)) * 23).toFixed(1);
    const ubuda = faza > 0.5;
    const kosak = faza < 0.25 || faza > 0.75;
    const okraj = ubuda ? 0 : 1;
    const hrana = ubuda === kosak ? 1 : 0;
    return (
        '<svg viewBox="0 0 46 46"><circle class="wx-moon-dark" cx="23" cy="23" r="23"/>' +
        `<path class="wx-moon-lit"${juh ? ' transform="matrix(-1 0 0 1 46 0)"' : ''} d="M23 0A23 23 0 0 ${okraj} 23 46A${rx} 23 0 0 ${hrana} 23 0z"/></svg>`
    );
}

/**
 * Kvapky dažďa (docs/navrhy/dazd-sily.html): tri hĺbky, každá je dlaždica w × h px (ďaleko, stred,
 * blízko). Pre každú silu dažďa počet kvapiek `n`, ich dĺžka, hrúbka a jas od-do a rozmazanie
 * nakreslené rovno v obrázku (vrstva sa potom len posúva, rozmazanie sa v snímkoch nepočíta).
 * Rýchlosť, sklon a ostatné vrstvy dažďa určuje web/pocasie.css. Mrholenie blízke kvapky nemá.
 */
const KVAPKY = {
    mrholenie: [
        { n: 150, len: [5, 8], wid: [0.6, 0.9], al: [0.18, 0.38], blur: 0.5 },
        { n: 50, len: [8, 12], wid: [0.8, 1.1], al: [0.3, 0.55], blur: 0.3 },
    ],
    slaby: [
        { n: 60, len: [8, 13], wid: [0.7, 1], al: [0.2, 0.4], blur: 0.6 },
        { n: 20, len: [15, 24], wid: [1, 1.4], al: [0.35, 0.6], blur: 0.3 },
        { n: 4, len: [30, 44], wid: [1.4, 2], al: [0.5, 0.75], blur: 0 },
    ],
    dazd: [
        { n: 120, len: [10, 16], wid: [0.7, 1.1], al: [0.2, 0.42], blur: 0.6 },
        { n: 40, len: [20, 32], wid: [1, 1.5], al: [0.35, 0.65], blur: 0.3 },
        { n: 9, len: [42, 62], wid: [1.5, 2.2], al: [0.55, 0.85], blur: 0 },
    ],
    silny: [
        { n: 220, len: [12, 20], wid: [0.7, 1.1], al: [0.22, 0.45], blur: 0.6 },
        { n: 72, len: [26, 40], wid: [1, 1.6], al: [0.35, 0.7], blur: 0.3 },
        { n: 16, len: [54, 80], wid: [1.6, 2.4], al: [0.55, 0.9], blur: 0 },
    ],
};
/** Rozmery dlaždíc v px; výšky musia sedieť s posunom vrstiev (wx-kv0 až wx-kv2) vo web/pocasie.css. */
const DLAZDICA = [
    [160, 200],
    [220, 260],
    [300, 340],
];

/** Pseudonáhoda so semienkom (mulberry32): tá istá kresba pri každom otvorení. @param {number} seed */
function nahoda(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Dlaždica kvapiek ako obrázok SVG pre CSS masku. Kvapka je úzky klin, hore priehľadný a dole
 * plný, ako stopa padajúcej kvapky. Kvapka, ktorá presahuje okraj, má kópiu na druhej strane,
 * aby švík dlaždíc nebolo vidno.
 * @param {(typeof KVAPKY)['dazd'][number]} v @param {number} w @param {number} h @param {number} seed
 */
function dlazdica(v, w, h, seed) {
    const r = nahoda(seed);
    const od = (/** @type {number[]} */ [a, b]) => a + (b - a) * r();
    const f = (/** @type {number} */ x) => +x.toFixed(1);
    let cesty = '';
    for (let i = 0; i < v.n; i++) {
        const x = r() * w;
        const y = r() * h;
        const len = od(v.len);
        const hr = od(v.wid);
        const al = od(v.al).toFixed(2);
        for (const dx of [-w, 0, w])
            for (const dy of [-h, 0, h]) {
                const xx = x + dx;
                const yy = y + dy;
                if (xx + hr < 0 || xx - hr > w || yy + len < 0 || yy > h) continue;
                cesty += `<path fill-opacity='${al}' d='M${f(xx)} ${f(yy)}l${f(hr / 2)} ${f(len)}h${f(-hr)}z'/>`;
            }
    }
    const rozmaz = v.blur ? `<filter id='f' x='-2' y='-.5' width='5' height='2'><feGaussianBlur stdDeviation='${v.blur}'/></filter>` : '';
    const svg =
        `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'><defs><linearGradient id='g' x2='0' y2='1'>` +
        `<stop offset='0' stop-color='#fff' stop-opacity='0'/><stop offset='.65' stop-color='#fff' stop-opacity='.75'/>` +
        `<stop offset='1' stop-color='#fff'/></linearGradient>${rozmaz}</defs><g fill='url(#g)'${v.blur ? " filter='url(#f)'" : ''}>${cesty}</g></svg>`;
    // Kódujú sa aj apostrofy: masky stoja v atribúte style ohraničenom apostrofmi.
    return `url("data:image/svg+xml,${svg.replace(/[#<>%']/g, (c) => '%' + c.charCodeAt(0).toString(16))}")`;
}

/** Masky kvapiek pre všetky sily ako premenné CSS (--kv<vrstva>-<sila>); počítajú sa raz. */
let masky = '';
function maskyKvapiek() {
    if (!masky)
        masky = Object.entries(KVAPKY)
            .flatMap(([sila, vrstvy], k) =>
                vrstvy.map((v, i) => `--kv${i}-${sila}:${dlazdica(v, DLAZDICA[i][0], DLAZDICA[i][1], 7 + 101 * i + 13 * k)}`),
            )
            .join(';');
    return masky;
}

/**
 * Vrstvy kresby: rozptýlené svetlo, mesiac a hviezdy, slnko s lúčmi, oblaky, stmavenie pri daždi
 * a zrážky (tie v obale, ktorý končí nad vetou pod číslom). Kvapky dostanú masky všetkých síl
 * dažďa naraz a silu vyberie CSS podľa data-dazd, takže zmena sily HTML nemení. Pri tej istej fáze Mesiaca je HTML to isté.
 * Hviezdy do vrstiev .wx-stars a .wx-stars2 zapisuje render zvlášť (hviezdySvg), aby ich posun
 * nereštartoval pohyb oblakov.
 * @param {number} faza fáza Mesiaca 0-1 @param {boolean} [juh] južná pologuľa - starší modul ho nepošle
 */
export function pocasieHtml(faza, juh = false) {
    const f = (Math.round(faza * FAZY) % FAZY) / FAZY;
    return (
        '<i class="wx-diffuse"></i><i class="wx-moonglow"></i><i class="wx-stars"></i><i class="wx-stars2"></i>' +
        `<i class="wx-moon">${mesiacSvg(f, juh === true)}</i>` +
        '<i class="wx-halo"></i><i class="wx-rays wx-r2"></i><i class="wx-rays wx-r1"></i><i class="wx-flare"></i>' +
        '<i class="wx-deck"></i><i class="wx-cloud wx-c2"></i><i class="wx-cloud wx-c1"></i><i class="wx-cloud wx-c3"></i>' +
        '<i class="wx-sero"></i>' +
        `<div class="wx-prec"><i class="wx-zavoj"></i><div class="wx-dazd" style='${maskyKvapiek()}'>` +
        '<i class="wx-kv wx-kv0"></i><i class="wx-kv wx-kv1"></i><i class="wx-kv wx-kv2"></i></div>' +
        '<i class="wx-snow wx-snow1"></i><i class="wx-snow wx-snow2"></i></div>'
    );
}

/**
 * Čo kresba ukáže: zrážky prebijú jas (pri daždi je obloha zatiahnutá, aj keď je oblačnosť
 * hraničná). @param {import('../shared/pocasie.js').Pocasie} p @returns {string}
 */
export const pocasieStav = (p) => p.zrazky ?? p.jas;

/**
 * Skutočné hviezdy (shared/hviezdy.js) ako SVG vrstvy: párne do prvej, nepárne do druhej, aby
 * blikali striedavo ako hviezdy z CSS. Pole sa roztiahne na celú vrstvu (slice), takže jednotka
 * má na telefóne aj na počítači podobne veľa pixelov a úzka obrazovka ukáže užší výsek oblohy.
 * Jasnejšia hviezda je väčšia a plnšia.
 * @param {import('../shared/hviezdy.js').Hviezda[]} zoznam @returns {[string, string]}
 */
export function hviezdySvg(zoznam) {
    const kruhy = zoznam.map((h) => {
        const r = Math.max(0.2, 0.46 - 0.07 * h.mag).toFixed(2);
        const a = Math.min(1, Math.max(0.6, 1 - 0.1 * h.mag)).toFixed(2);
        return `<circle cx="${h.x}" cy="${h.y}" r="${r}" opacity="${a}"/>`;
    });
    const svg = (/** @type {number} */ zvysok) =>
        `<svg viewBox="0 0 ${HVIEZDY.sirka} ${HVIEZDY.vyska}" preserveAspectRatio="xMidYMid slice">` +
        kruhy.filter((_, i) => i % 2 === zvysok).join('') +
        '</svg>';
    return [svg(0), svg(1)];
}
