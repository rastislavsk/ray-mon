// Sťahovanie dát karty Radar. Najnovšia snímka ide prvá, aby bolo „Teraz“ hneď na displeji, staršie sa
// dopĺňajú popri tom. Výpočty robí Web Worker (web/radar-vypocet.js).

import { radarModelUrl, RADAR, WORKER_RADAR_URL } from '../shared/config.js';
import { blokyParam, modelBody, modelSnimky } from '../shared/radar-data.js';
import { krokovMinulost, radarKrok, radarTag } from '../shared/radar.js';
import { loadRadarModel, saveRadarModel } from './storage.js';

const KROK_MS = RADAR.krokMin * 60000;

/** Index snímky je čas v krokoch od začiatku epochy. @param {number} ms */
export const indexKroku = (ms) => Math.round(ms / KROK_MS);

export class RadarData {
    /** @type {Set<number>} */ hotove = new Set();
    /** @type {Set<number>} */ bezia = new Set();
    modelAt = 0;

    /**
     * @param {{ bloky: Array<{ row: number, col: number }>, oblast: import('../shared/radar-data.js').Oblast,
     *   naSnimku: (index: number, f: Uint8Array) => void, naPohyb: (m: { gx: number, gy: number, g: number, bajty: Uint8Array }) => void,
     *   naModel: (m: any) => void }} o
     */
    constructor({ bloky, oblast, naSnimku, naPohyb, naModel }) {
        this.oblast = oblast;
        this.param = blokyParam(bloky);
        this.worker = new Worker(new URL('./radar-vypocet.js', import.meta.url), { type: 'module' });
        // Model má vlastné vlákno: v rade za snímkami a pohybom by oblaky čakali aj pol minúty.
        this.modelWorker = new Worker(new URL('./radar-vypocet.js', import.meta.url), { type: 'module' });
        this.modelWorker.onmessage = ({ data: m }) => {
            if (m.druh === 'model') naModel(m.model);
        };
        this.worker.postMessage({ druh: 'oblast', oblast });
        this.worker.onmessage = ({ data: m }) => {
            if (m.druh === 'snimka') {
                this.hotove.add(m.index);
                this.bezia.delete(m.index);
                naSnimku(m.index, m.f);
            } else if (m.druh === 'pohyb') naPohyb(m);
            else if (m.druh === 'chyba') this.bezia.delete(m.index);
        };
    }

    /** @param {number} ms */
    async stiahni(ms) {
        const r = await fetch(`${WORKER_RADAR_URL}${radarTag(ms)}?b=${this.param}`);
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(`radar ${r.status}`);
        return r.arrayBuffer();
    }

    /** @param {number} ms @param {ArrayBuffer} buf */
    posli(ms, buf) {
        this.worker.postMessage({ druh: 'snimka', index: indexKroku(ms), buf }, [buf]);
    }

    /**
     * Najnovšia snímka: vráti jej čas, alebo null, keď žiadna z posledných nie je.
     * @param {number} nowMs
     */
    async najnovsia(nowMs) {
        let t = radarKrok(nowMs);
        for (let i = 0; i < RADAR.pokusov; i++, t -= KROK_MS) {
            if (this.hotove.has(indexKroku(t))) return t;
            const buf = await this.stiahni(t);
            if (buf) {
                this.bezia.add(indexKroku(t));
                this.posli(t, buf);
                return t;
            }
        }
        return null;
    }

    /** Staršie snímky do poslednej, potom pohyb. @param {number} najnovsia */
    async dopln(najnovsia) {
        const rad = Array.from({ length: krokovMinulost }, (_, i) => najnovsia - (i + 1) * KROK_MS).filter(
            (ms) => !this.hotove.has(indexKroku(ms)) && !this.bezia.has(indexKroku(ms)),
        );
        const stahuj = async () => {
            while (rad.length) {
                const ms = /** @type {number} */ (rad.shift());
                this.bezia.add(indexKroku(ms));
                const buf = await this.stiahni(ms).catch(() => null);
                if (buf) this.posli(ms, buf);
                else this.bezia.delete(indexKroku(ms));
            }
        };
        await Promise.all(Array.from({ length: RADAR.subezne }, stahuj));
        const n = indexKroku(najnovsia);
        this.worker.postMessage({ druh: 'zabudni', pod: n - krokovMinulost - 1 });
        this.worker.postMessage({ druh: 'pohyb', indexy: [n, n - 2, n - 4] });
    }

    /** @param {number} nowMs */
    async nacitajModel(nowMs) {
        if (nowMs - this.modelAt < RADAR.modelObnovaMs) return;
        const kluc = this.oblast.x0.toFixed(4);
        const ulozeny = loadRadarModel(nowMs, kluc);
        if (ulozeny) {
            this.modelAt = ulozeny.at;
            return this.modelWorker.postMessage({ druh: 'model', model: ulozeny.model });
        }
        this.modelAt = nowMs;
        const body = modelBody(this.oblast);
        /** @type {unknown[]} */ const vsetko = [];
        for (let i = 0; i < body.length; i += RADAR.modelBodovNaDopyt) {
            const r = await fetch(radarModelUrl(body.slice(i, i + RADAR.modelBodovNaDopyt)));
            if (!r.ok) throw new Error(`model ${r.status}`);
            vsetko.push(...[await r.json()].flat());
        }
        const snimky = modelSnimky(vsetko);
        if (!snimky) throw new Error('model');
        saveRadarModel(nowMs, kluc, snimky);
        this.modelWorker.postMessage({ druh: 'model', model: snimky });
    }
}
