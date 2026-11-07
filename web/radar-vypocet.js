// Web Worker karty Radar: rozbalenie snímok, výrez, čistenie a pohyb. Beží mimo hlavného vlákna, aby
// prehrávanie a mapa neťukali. Správy posiela web/radar-data.js.

import { RADAR } from '../shared/config.js';
import { dbzNaBajt, mapaBodov, mmNaDbz, ocisti, pohyb, pohybBajty, telaBlokov, vlozBlok, vyrez, zjemni } from '../shared/radar-data.js';

/** @typedef {import('../shared/radar-data.js').Oblast} Oblast */

/** @type {Oblast} */ let oblast;
/** @type {Int32Array} */ let mapa;
/** @type {Map<number, Uint8Array>} snímky podľa indexu krokov, kvôli pohybu */
const snimky = new Map();

/** @param {Uint8Array} data */
async function rozbal(data) {
    const ds = new DecompressionStream('deflate');
    const zapis = ds.writable.getWriter();
    zapis.write(/** @type {Uint8Array<ArrayBuffer>} */ (data)).catch(() => {});
    zapis.close().catch(() => {});
    return new Float64Array(await new Response(ds.readable).arrayBuffer());
}

/** @param {ArrayBuffer} buf */
async function snimka(buf) {
    const plocha = new Uint8Array(oblast.pw * oblast.ph);
    for (const b of telaBlokov(buf)) vlozBlok(await rozbal(b.data), b.row, b.col, plocha, oblast);
    return ocisti(vyrez(plocha, mapa, oblast), oblast.w, oblast.h);
}

/** Snímky v odstupe 20 minút, ako v spätnom teste (docs/navrhy/radar.html). @param {number[]} indexy indexy od najnovšej */
function pohybZ(indexy) {
    const krokov = 20 / RADAR.krokMin;
    /** @type {Array<[Uint8Array, Uint8Array]>} */
    const dvojice = [];
    for (const i of indexy) {
        const a = snimky.get(i - krokov);
        const b = snimky.get(i);
        if (a && b) dvojice.push([a, b]);
    }
    return dvojice.length ? pohyb(dvojice, oblast.w, oblast.h, krokov) : null;
}

/** @param {{ casy: number[], dazd: number[][], oblaky: number[][] }} m */
function model(m) {
    const { modelBodyX: nx, modelBodyY: ny, modelZjemnenie: k } = RADAR;
    /** @param {number[]} v */
    const dazd = (v) => Uint8Array.from(zjemni(v, nx, ny, k), (mm) => dbzNaBajt(mmNaDbz(Math.max(0, mm))));
    /** @param {number[]} v */
    const oblaky = (v) => Uint8Array.from(zjemni(v, nx, ny, k), (p) => Math.max(0, Math.min(255, p * 2.55)));
    return { casy: m.casy, w: nx * k, h: ny * k, dazd: m.dazd.map(dazd), oblaky: m.oblaky.map(oblaky) };
}

/** @param {any} m */
async function spracuj(m) {
    try {
        if (m.druh === 'oblast') {
            oblast = m.oblast;
            mapa = mapaBodov(oblast);
            snimky.clear();
        } else if (m.druh === 'snimka') {
            const f = await snimka(m.buf);
            snimky.set(m.index, f);
            postMessage({ druh: 'snimka', index: m.index, f: f.slice() });
        } else if (m.druh === 'pohyb') {
            const p = pohybZ(m.indexy);
            if (p) postMessage({ druh: 'pohyb', gx: p.gx, gy: p.gy, g: p.g, bajty: pohybBajty(p) });
        } else if (m.druh === 'zabudni') {
            for (const k of snimky.keys()) if (k < m.pod) snimky.delete(k);
        } else if (m.druh === 'model') {
            postMessage({ druh: 'model', model: model(m.model) });
        }
    } catch (err) {
        postMessage({ druh: 'chyba', index: m.index, sprava: String(err) });
    }
}

// Správy idú po jednej: najnovšia snímka je hotová skôr, než sa začne ďalšia.
let rad = Promise.resolve();
onmessage = ({ data }) => {
    rad = rad.then(() => spracuj(data));
};
