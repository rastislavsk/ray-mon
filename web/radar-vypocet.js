// Web Worker karty Radar: rozbalenie snímok, výrez, čistenie, pohyb a maska oblakov zo satelitu. Beží mimo hlavného
// vlákna, aby prehrávanie a mapa neťukali. Správy posiela web/radar-data.js.

import { RADAR } from '../shared/config.js';
import {
    dbzNaBajt,
    mapaBodov,
    mmNaDbz,
    oblakyZMasky,
    ocisti,
    pohyb,
    pohybBajty,
    telaBlokov,
    vlozBlok,
    vyrez,
    zjemni,
} from '../shared/radar-data.js';

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

/**
 * Polia modelu ako obrázky v bajtoch, zjemnené z mriežky nx × ny. Zrážky v mm idú na dBZ podľa podielu snehu
 * (docs/navrhy/radar-sneh.html), oblačnosť 0–100 % a podiel snehu 0–1 na 0–255.
 * @param {import('../shared/radar-data.js').ModelPolia} m @param {number} nx @param {number} ny
 */
function polia(m, nx, ny) {
    const k = RADAR.modelZjemnenie;
    /** @param {number[]} v */
    const jemne = (v) => zjemni(v, nx, ny, k);
    const sneh = m.sneh.map((v) => jemne(v).map((p) => Math.max(0, Math.min(1, p))));
    return {
        dazd: m.dazd.map((v, h) => Uint8Array.from(jemne(v), (mm, i) => dbzNaBajt(mmNaDbz(Math.max(0, mm), sneh[h][i])))),
        oblaky: m.oblaky.map((v) => Uint8Array.from(jemne(v), (p) => Math.max(0, Math.min(255, p * 2.55)))),
        sneh: sneh.map((v) => Uint8Array.from(v, (p) => Math.round(p * 255))),
    };
}

/**
 * Model ako obrázky: hrubá mriežka po poliach, detail okolo domu v jednom obrázku RGB na hodinu (R zrážky, G oblaky,
 * B podiel snehu), aby shader potreboval len dve textúry navyše.
 * @param {import('../shared/radar-data.js').RadarModel} m
 */
function model(m) {
    const { modelBodyX: nx, modelBodyY: ny, modelZjemnenie: k, detailBody: nd } = RADAR;
    const d = polia(m.detail, nd, nd);
    const detail = d.dazd.map((dz, h) => {
        const rgb = new Uint8Array(dz.length * 3);
        for (let i = 0; i < dz.length; i++) rgb.set([dz[i], d.oblaky[h][i], d.sneh[h][i]], i * 3);
        return rgb;
    });
    return { casy: m.casy, w: nx * k, h: ny * k, ...polia(m, nx, ny), dw: nd * k, detail };
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
            // Odpovie vždy, aj bez pohybu: prehrávač podľa toho vie, že sú spracované všetky snímky pred ním.
            const p = pohybZ(m.indexy);
            postMessage(p ? { druh: 'pohyb', gx: p.gx, gy: p.gy, g: p.g, bajty: pohybBajty(p) } : { druh: 'pohyb', bajty: null });
        } else if (m.druh === 'zabudni') {
            for (const k of snimky.keys()) if (k < m.pod) snimky.delete(k);
        } else if (m.druh === 'model') {
            postMessage({ druh: 'model', model: model(m.model) });
        }
    } catch (err) {
        postMessage({ druh: 'chyba', zdroj: m.druh, index: m.index, sprava: String(err) });
    }
}

/**
 * Jedna snímka masky oblakov ako sila 0–255, alebo null, keď WMS obrázok nedal (čas mimo rozsahu vráti XML s chybou).
 * @param {string} url
 */
async function maska(url) {
    const r = await fetch(url);
    if (!r.ok || !r.headers.get('content-type')?.startsWith('image/')) return null;
    const obr = await createImageBitmap(await r.blob());
    const { width: w, height: h } = obr;
    const ctx = /** @type {OffscreenCanvasRenderingContext2D} */ (new OffscreenCanvas(w, h).getContext('2d'));
    ctx.drawImage(obr, 0, 0);
    obr.close();
    return { w, h, f: oblakyZMasky(ctx.getImageData(0, 0, w, h).data, w, h) };
}

/**
 * Snímky satelitu naraz, každá ide späť hneď, ako je hotová; na konci `satelit-hotovo`.
 * @param {Array<{ ms: number, url: string }>} zoznam
 */
async function satelit(zoznam) {
    await Promise.all(
        zoznam.map(async ({ ms, url }) => {
            const m = await maska(url).catch(() => null);
            if (m) postMessage({ druh: 'satelit', ms, ...m }, { transfer: [m.f.buffer] });
        }),
    );
    postMessage({ druh: 'satelit-hotovo' });
}

// Správy idú po jednej: najnovšia snímka je hotová skôr, než sa začne ďalšia. Satelit ide mimo radu, sťahovanie
// by inak zdržalo model.
let rad = Promise.resolve();
onmessage = ({ data }) => {
    if (data.druh === 'satelit') return void satelit(data.zoznam);
    rad = rad.then(() => spracuj(data));
};
