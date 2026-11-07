// Dáta karty Radar: kompozit OPERA (mriežka 1 km v projekcii LAEA) a model z Open-Meteo. Čisté výpočty
// bez siete a DOM. Beží vo Web Workeri (web/radar-vypocet.js), index HDF5 číta aj Cloudflare Worker.
// Návrh a merania: docs/navrhy/radar.html.

import { RADAR } from './config.js';

const RAD = Math.PI / 180;
const A = 6378137;
const E2 = 0.00669437999014;
const E = Math.sqrt(E2);
const LAT0 = 55 * RAD;
const LON0 = 10;
const X0 = 1950000;
const Y0 = -2100000;

/** @param {number} s sínus zemepisnej šírky */
const qf = (s) => (1 - E2) * (s / (1 - E2 * s * s) - Math.log((1 - E * s) / (1 + E * s)) / (2 * E));
const QP = qf(1);
const RQ = A * Math.sqrt(QP / 2);
/** @param {number} lat v radiánoch */
const beta = (lat) => Math.asin(qf(Math.sin(lat)) / QP);
const B0 = beta(LAT0);
const D = (A * Math.cos(LAT0)) / Math.sqrt(1 - E2 * Math.sin(LAT0) ** 2) / (RQ * Math.cos(B0));

/**
 * Poloha v mriežke OPERA: stĺpec a riadok v km od severozápadného rohu (+proj=laea, elipsoid WGS84).
 * @param {number} lon @param {number} lat @returns {[number, number]}
 */
export function laea(lon, lat) {
    const b = beta(lat * RAD);
    const l = (lon - LON0) * RAD;
    const bb = RQ * Math.sqrt(2 / (1 + Math.sin(B0) * Math.sin(b) + Math.cos(B0) * Math.cos(b) * Math.cos(l)));
    const x = bb * D * Math.cos(b) * Math.sin(l) + X0;
    const y = (bb / D) * (Math.cos(B0) * Math.sin(b) - Math.sin(B0) * Math.cos(b) * Math.cos(l)) + Y0;
    return [x / 1000, -y / 1000];
}

/**
 * Približná zemepisná poloha bodu mriežky (na guli). Stačí na výber výrezu, presné body ráta `laea`.
 * @param {number} stlpec @param {number} riadok @returns {[number, number]} [dĺžka, šírka]
 */
function laeaSpat(stlpec, riadok) {
    const x = (stlpec * 1000 - X0) / D;
    const y = (-riadok * 1000 - Y0) * D;
    const p = Math.hypot(x, y) || 1e-9;
    const c = 2 * Math.asin(p / (2 * RQ));
    const b = Math.asin(Math.cos(c) * Math.sin(B0) + (y * Math.sin(c) * Math.cos(B0)) / p);
    const l = Math.atan2(x * Math.sin(c), p * Math.cos(B0) * Math.cos(c) - y * Math.sin(B0) * Math.sin(c));
    return [LON0 + l / RAD, b / RAD];
}

/**
 * Bloky súboru OPERA okolo miesta. Mimo mriežky null: tam radar nie je.
 * @param {number} lat @param {number} lon @returns {Array<{ row: number, col: number }> | null}
 */
export function radarBloky(lat, lon) {
    const [c, r] = laea(lon, lat);
    if (!Number.isFinite(c) || !Number.isFinite(r) || c < 0 || r < 0 || c >= RADAR.stlpce || r >= RADAR.riadky) return null;
    const { dosahKm: d, blokRiadky: br, blokStlpce: bc } = RADAR;
    const bloky = [];
    for (let row = Math.floor(Math.max(0, r - d) / br) * br; row <= Math.min(RADAR.riadky - 1, r + d); row += br)
        for (let col = Math.floor(Math.max(0, c - d) / bc) * bc; col <= Math.min(RADAR.stlpce - 1, c + d); col += bc)
            bloky.push({ row, col });
    return bloky;
}

/** Bloky do adresy Workera. @param {Array<{ row: number, col: number }>} bloky */
export const blokyParam = (bloky) => bloky.map((b) => `${b.row}_${b.col}`).join(',');

/** @param {number} lon */
export const mercX = (lon) => (lon + 180) / 360;
/** @param {number} lat */
export const mercY = (lat) => 0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2)) / (2 * Math.PI);
/** @param {number} x */
const lonZ = (x) => x * 360 - 180;
/** @param {number} y */
const latZ = (y) => (2 * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - Math.PI / 2) / RAD;

/**
 * Výrez karty: obdĺžnik blokov ako obdĺžnik v súradniciach mapy (Mercator, 0–1), rozmery obrázka
 * s bodom asi 2 km a pôvod plochy v mriežke OPERA.
 * @typedef {{ x0: number, y0: number, x1: number, y1: number, w: number, h: number,
 *   riadok: number, stlpec: number, pw: number, ph: number }} Oblast
 * @param {Array<{ row: number, col: number }>} bloky @returns {Oblast}
 */
export function oblastBlokov(bloky) {
    const riadok = Math.min(...bloky.map((b) => b.row));
    const stlpec = Math.min(...bloky.map((b) => b.col));
    const pw = Math.max(...bloky.map((b) => b.col)) + RADAR.blokStlpce - stlpec;
    const ph = Math.max(...bloky.map((b) => b.row)) + RADAR.blokRiadky - riadok;
    /** @type {Array<[number, number]>} */
    const rohy = [];
    for (const t of [0, 0.5, 1]) {
        rohy.push(laeaSpat(stlpec + pw * t, riadok), laeaSpat(stlpec + pw * t, riadok + ph));
        rohy.push(laeaSpat(stlpec, riadok + ph * t), laeaSpat(stlpec + pw, riadok + ph * t));
    }
    const xs = rohy.map((p) => mercX(p[0]));
    const ys = rohy.map((p) => mercY(p[1]));
    return {
        x0: Math.min(...xs),
        y0: Math.min(...ys),
        x1: Math.max(...xs),
        y1: Math.max(...ys),
        w: Math.round(pw / RADAR.zmensenie),
        h: Math.round(ph / RADAR.zmensenie),
        riadok,
        stlpec,
        pw,
        ph,
    };
}

/**
 * Pre každý bod obrázka index do plochy blokov (riadok * pw + stlpec), mimo plochy -1.
 * Počíta sa raz, ostatné snímky ju len používajú.
 * @param {Oblast} o @returns {Int32Array}
 */
export function mapaBodov(o) {
    const out = new Int32Array(o.w * o.h);
    for (let y = 0; y < o.h; y++) {
        const lat = latZ(o.y0 + ((y + 0.5) / o.h) * (o.y1 - o.y0));
        for (let x = 0; x < o.w; x++) {
            const [c, r] = laea(lonZ(o.x0 + ((x + 0.5) / o.w) * (o.x1 - o.x0)), lat);
            const cc = Math.floor(c) - o.stlpec;
            const rr = Math.floor(r) - o.riadok;
            out[y * o.w + x] = cc >= 0 && rr >= 0 && cc < o.pw - 1 && rr < o.ph - 1 ? rr * o.pw + cc : -1;
        }
    }
    return out;
}

/** Sila ozveny v bajte: 0 je bez dažďa. @param {number} dbz */
export function dbzNaBajt(dbz) {
    const { od, do: po, prah } = RADAR.dbz;
    return dbz < prah ? 0 : Math.max(1, Math.min(255, Math.round(((dbz - od) / (po - od)) * 254) + 1));
}

/** dBZ z bajtu. @param {number} b */
export const bajtNaDbz = (b) => RADAR.dbz.od + ((b - 1) / 254) * (RADAR.dbz.do - RADAR.dbz.od);

/** Zrážky v mm/h ako ozvena (Marshall-Palmer). @param {number} mm */
export const mmNaDbz = (mm) => (mm < 0.08 ? 0 : 10 * Math.log10(200 * mm ** 1.6));

/**
 * Index blokov prvej dátovej množiny v hlavičke súboru HDF5 (B-tree v1 nad 2D dátami).
 * Rozbaliť bloky netreba: Worker z neho zistí, ktoré bajty poslať.
 * @param {ArrayBuffer} buf @returns {Array<{ row: number, col: number, size: number, addr: number }> | null}
 */
export function hdf5Bloky(buf) {
    const b = new Uint8Array(buf);
    const v = new DataView(buf);
    for (let i = 0; i + 24 < b.length; i++) {
        if (b[i] !== 84 || b[i + 1] !== 82 || b[i + 2] !== 69 || b[i + 3] !== 69 || b[i + 4] !== 1 || b[i + 5] !== 0) continue;
        const n = v.getUint16(i + 6, true);
        if (i + 24 + n * 40 > b.length) return null;
        return Array.from({ length: n }, (_, k) => {
            const o = i + 24 + k * 40;
            return {
                size: v.getUint32(o, true),
                row: Number(v.getBigUint64(o + 8, true)),
                col: Number(v.getBigUint64(o + 16, true)),
                addr: Number(v.getBigUint64(o + 32, true)),
            };
        });
    }
    return null;
}

/**
 * Odpoveď Workera: dĺžka hlavičky, hlavička JSON a za ňou komprimované bloky.
 * @param {ArrayBuffer} buf @returns {Array<{ row: number, col: number, data: Uint8Array }>}
 */
export function telaBlokov(buf) {
    const dlzka = new DataView(buf).getUint32(0, true);
    const meta = /** @type {Array<{ row: number, col: number, size: number }>} */ (
        JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, dlzka)))
    );
    let o = 4 + dlzka;
    return meta.map((m) => {
        const data = new Uint8Array(buf, o, m.size);
        o += m.size;
        return { row: m.row, col: m.col, data };
    });
}

/**
 * Rozbalený blok (double po riadkoch) do plochy bajtov.
 * @param {Float64Array} blok @param {number} row @param {number} col @param {Uint8Array} plocha @param {Oblast} o
 */
export function vlozBlok(blok, row, col, plocha, o) {
    const { blokRiadky: br, blokStlpce: bc } = RADAR;
    const oy = row - o.riadok;
    const ox = col - o.stlpec;
    for (let y = 0; y < br; y++) {
        const p = (oy + y) * o.pw + ox;
        const s = y * bc;
        for (let x = 0; x < bc; x++) plocha[p + x] = dbzNaBajt(blok[s + x]);
    }
}

/**
 * Obrázok výrezu z plochy: najsilnejšia ozvena zo štyroch bodov, aby úzke pásy dažďa nezmizli.
 * @param {Uint8Array} plocha @param {Int32Array} mapa @param {Oblast} o
 */
export function vyrez(plocha, mapa, o) {
    const out = new Uint8Array(o.w * o.h);
    const pw = o.pw;
    for (let i = 0; i < out.length; i++) {
        const p = mapa[i];
        if (p >= 0) out[i] = Math.max(plocha[p], plocha[p + 1], plocha[p + pw], plocha[p + pw + 1]);
    }
    return out;
}

/** Počet dažďa v štvorci 3 × 3 okolo bodu. @param {Uint8Array} f @param {number} p @param {number} w */
function susedia(f, p, w) {
    let c = 0;
    for (let b = -w; b <= w; b += w) for (let a = -1; a <= 1; a++) if (f[p + b + a]) c++;
    return c;
}

/**
 * Súvislý ostrov dažďa od bodu.
 * @param {Uint8Array} g @param {Uint8Array} videne @param {number} p @param {number} w
 */
function ostrov(g, videne, p, w) {
    const zasobnik = [p];
    const body = [];
    videne[p] = 1;
    while (zasobnik.length) {
        const q = /** @type {number} */ (zasobnik.pop());
        body.push(q);
        for (const t of [q - 1, q + 1, q - w, q + w]) {
            if (t < 0 || t >= g.length || !g[t] || videne[t]) continue;
            videne[t] = 1;
            zasobnik.push(t);
        }
    }
    return body;
}

/**
 * Odstráni rušenie: dážď tvorí súvislé plochy, rušenie sú osamelé body a malé ostrovy.
 * @param {Uint8Array} f @param {number} w @param {number} h @returns {Uint8Array}
 */
export function ocisti(f, w, h) {
    const g = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++)
        for (let x = 1; x < w - 1; x++) {
            const p = y * w + x;
            if (f[p] && susedia(f, p, w) >= RADAR.cistenie.susedia) g[p] = f[p];
        }
    const videne = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) {
        if (!g[p] || videne[p]) continue;
        const body = ostrov(g, videne, p, w);
        if (body.length < RADAR.cistenie.ostrov) for (const q of body) g[q] = 0;
    }
    return g;
}

/**
 * Rozmazanie obdĺžnikom (dva prechody), pre hľadanie pohybu.
 * @param {Uint8Array} f @param {number} w @param {number} h @param {number} r
 */
function rozmaz(f, w, h, r) {
    let a = Float32Array.from(f);
    let b = new Float32Array(w * h);
    for (let n = 0; n < 2; n++) {
        for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
                let s = 0;
                const x0 = Math.max(0, x - r);
                const x1 = Math.min(w - 1, x + r);
                for (let i = x0; i <= x1; i++) s += a[y * w + i];
                b[y * w + x] = s / (x1 - x0 + 1);
            }
        [a, b] = [b, a];
        for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
                let s = 0;
                const y0 = Math.max(0, y - r);
                const y1 = Math.min(h - 1, y + r);
                for (let i = y0; i <= y1; i++) s += a[i * w + x];
                b[y * w + x] = s / (y1 - y0 + 1);
            }
        [a, b] = [b, a];
    }
    return a;
}

/**
 * Najlepší posun bloku medzi dvoma snímkami.
 * @param {Float32Array} a @param {Float32Array} b @param {number} w
 * @param {{ x0: number, x1: number, y0: number, y1: number }} blok @param {number} s dosah hľadania
 * @returns {[number, number]}
 */
function posunBloku(a, b, w, { x0, x1, y0, y1 }, s) {
    /** @param {number} dx @param {number} dy */
    const chyba = (dx, dy) => {
        let e = 0;
        for (let y = y0; y < y1; y += 3)
            for (let x = x0; x < x1; x += 3) {
                const d = a[y * w + x] - b[(y + dy) * w + x + dx];
                e += d * d;
            }
        return e * (1 + 0.002 * (dx * dx + dy * dy));
    };
    let best = Infinity;
    /** @type {[number, number]} */ let out = [0, 0];
    for (let dy = -s; dy <= s; dy++)
        for (let dx = -s; dx <= s; dx++) {
            const e = chyba(dx, dy);
            if (e < best) {
                best = e;
                out = [dx, dy];
            }
        }
    return out;
}

/** Súčet sily v bloku, riedko. @param {Float32Array} a @param {number} w @param {{ x0: number, x1: number, y0: number, y1: number }} blok */
function energia(a, w, { x0, x1, y0, y1 }) {
    let en = 0;
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) en += a[y * w + x];
    return en;
}

/** Vyhladí pole priemerom susedov. @param {Float32Array} v @param {number} gx @param {number} gy @returns {Float32Array} */
function vyhlad(v, gx, gy) {
    const out = new Float32Array(v.length);
    for (let j = 0; j < gy; j++)
        for (let i = 0; i < gx; i++) {
            let s = 0;
            let c = 0;
            for (let q = Math.max(0, j - 1); q <= Math.min(gy - 1, j + 1); q++)
                for (let r = Math.max(0, i - 1); r <= Math.min(gx - 1, i + 1); r++) {
                    s += v[q * gx + r];
                    c++;
                }
            out[j * gx + i] = s / c;
        }
    return out;
}

/**
 * Súčty posunov vážené energiou cez všetky bloky mriežky.
 * @param {Array<[Uint8Array, Uint8Array]>} dvojice @param {number} w @param {number} h @param {number} gx @param {number} gy
 */
function suctyPosunov(dvojice, w, h, gx, gy) {
    const { mriezka: g, hladanie: s, okno: k, minEnergia } = RADAR.pohyb;
    const sx = new Float32Array(gx * gy);
    const sy = new Float32Array(gx * gy);
    const sw = new Float32Array(gx * gy);
    for (const [ra, rb] of dvojice) {
        const a = rozmaz(ra, w, h, 2);
        const b = rozmaz(rb, w, h, 2);
        for (let p = 0; p < gx * gy; p++) {
            const i = p % gx;
            const j = Math.floor(p / gx);
            const blok = {
                x0: Math.max(s, i * g - k),
                x1: Math.min(w - s, i * g + k),
                y0: Math.max(s, j * g - k),
                y1: Math.min(h - s, j * g + k),
            };
            const en = energia(a, w, blok);
            if (en < minEnergia) continue;
            const [bx, by] = posunBloku(a, b, w, blok, s);
            sx[p] += bx * en;
            sy[p] += by * en;
            sw[p] += en;
        }
    }
    return { sx, sy, sw };
}

/**
 * Pohyb dažďa v mriežke výrezu, v bodoch obrázka za jeden krok snímok. Hľadá sa blokovým porovnaním
 * dvojíc snímok; miesta bez dažďa dostanú priemer a pole sa zjemní.
 * @param {Array<[Uint8Array, Uint8Array]>} dvojice snímky v odstupe `krokov` krokov
 * @param {number} w @param {number} h @param {number} krokov
 * @returns {{ gx: number, gy: number, g: number, dx: Float32Array, dy: Float32Array }}
 */
export function pohyb(dvojice, w, h, krokov) {
    const { mriezka: g, mierny } = RADAR.pohyb;
    const gx = Math.ceil(w / g) + 1;
    const gy = Math.ceil(h / g) + 1;
    const { sx, sy, sw } = suctyPosunov(dvojice, w, h, gx, gy);
    const vaha = sw.reduce((a, b) => a + b, 0) || 1;
    const mx = sx.reduce((a, b) => a + b, 0) / vaha;
    const my = sy.reduce((a, b) => a + b, 0) / vaha;
    /** @type {Float32Array} */ let dx = sx.map((v, i) => (v + mx * mierny) / (sw[i] + mierny));
    /** @type {Float32Array} */ let dy = sy.map((v, i) => (v + my * mierny) / (sw[i] + mierny));
    for (let n = 0; n < 6; n++) {
        dx = vyhlad(dx, gx, gy);
        dy = vyhlad(dy, gx, gy);
    }
    return { gx, gy, g, dx: dx.map((v) => v / krokov), dy: dy.map((v) => v / krokov) };
}

/**
 * Pole pohybu ako dvojkanálová textúra: 127 je nula, RADAR.pohyb.mierka dielikov je jeden bod.
 * @param {{ dx: Float32Array, dy: Float32Array }} p @returns {Uint8Array}
 */
export function pohybBajty(p) {
    const m = RADAR.pohyb.mierka;
    /** @param {number} v */
    const b = (v) => Math.round(127 + Math.max(-127, Math.min(127, v * m)));
    const out = new Uint8Array(p.dx.length * 2);
    for (let i = 0; i < p.dx.length; i++) {
        out[i * 2] = b(p.dx[i]);
        out[i * 2 + 1] = b(p.dy[i]);
    }
    return out;
}

/**
 * Dážď v mieste: najsilnejšia ozvena v štvorci okolo bodu, ktorý sa posunie proti pohybu (predpoveď).
 * @param {Uint8Array} f @param {Oblast} o @param {[number, number]} bod [x, y] v bodoch obrázka
 * @param {number} [okolie] polomer štvorca v bodoch
 */
export function dazdVBode(f, o, [x, y], okolie = 3) {
    let m = 0;
    for (let b = -okolie; b <= okolie; b++)
        for (let a = -okolie; a <= okolie; a++) {
            const X = Math.round(x) + a;
            const Y = Math.round(y) + b;
            if (X >= 0 && Y >= 0 && X < o.w && Y < o.h && f[Y * o.w + X] > m) m = f[Y * o.w + X];
        }
    return m;
}

/**
 * Body, v ktorých sa pýtame modelu: rovnomerne v obdĺžniku mapy, po riadkoch od severu.
 * @param {Oblast} o @returns {Array<{ lat: number, lon: number }>}
 */
export function modelBody(o) {
    const { modelBodyX: nx, modelBodyY: ny } = RADAR;
    const out = [];
    for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++)
            out.push({ lat: latZ(o.y0 + (j / (ny - 1)) * (o.y1 - o.y0)), lon: lonZ(o.x0 + (i / (nx - 1)) * (o.x1 - o.x0)) });
    return out;
}

/** @param {number} a @param {number} b @param {number} c @param {number} d @param {number} t */
const cub = (a, b, c, d, t) => b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));

/**
 * Hladký obrázok z mriežky bodov modelu (bikubicky).
 * @param {ArrayLike<number>} v @param {number} nx @param {number} ny @param {number} k zväčšenie
 * @returns {Float32Array}
 */
export function zjemni(v, nx, ny, k) {
    const w = nx * k;
    const h = ny * k;
    /** @param {number} i @param {number} j */
    const g = (i, j) => v[Math.max(0, Math.min(ny - 1, j)) * nx + Math.max(0, Math.min(nx - 1, i))];
    const o = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
            const u = (x / (w - 1)) * (nx - 1);
            const t = (y / (h - 1)) * (ny - 1);
            const i = Math.floor(u);
            const j = Math.floor(t);
            const a = u - i;
            const r = [-1, 0, 1, 2].map((d) => cub(g(i - 1, j + d), g(i, j + d), g(i + 1, j + d), g(i + 2, j + d), a));
            o[y * w + x] = cub(r[0], r[1], r[2], r[3], t - j);
        }
    return o;
}

/**
 * Odpovede Open-Meteo (pole bodov po riadkoch) ako snímky po hodinách, rovnako dlhé. Cudzia odpoveď je null.
 * @param {unknown} data
 * @returns {{ casy: number[], dazd: number[][], oblaky: number[][] } | null} časy v ms, hodnoty [hodina][bod]
 */
export function modelSnimky(data) {
    const { modelBodyX: nx, modelBodyY: ny } = RADAR;
    if (!Array.isArray(data) || data.length !== nx * ny) return null;
    const prvy = data[0]?.hourly;
    if (!Array.isArray(prvy?.time) || !prvy.time.length) return null;
    const n = prvy.time.length;
    if (!data.every((b) => b?.hourly?.precipitation?.length === n && b?.hourly?.cloud_cover?.length === n)) return null;
    const hodiny = Array.from({ length: n }, (_, i) => i);
    return {
        casy: prvy.time.map((/** @type {number} */ t) => t * 1000),
        dazd: hodiny.map((t) => data.map((b) => b.hourly.precipitation[t] ?? 0)),
        oblaky: hodiny.map((t) => data.map((b) => b.hourly.cloud_cover[t] ?? 0)),
    };
}
