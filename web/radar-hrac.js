// Prehrávač karty Radar: mapa, snímky a poloha na osi. Poloha sa mení v každom obraze, preto nie je
// v stave a nekreslí sa cez render (rovnako ako posun pásu dní). V stave je len to, čo si človek zvolil.

import { RADAR } from '../shared/config.js';
import { dazdVBode, mercX, mercY, oblastBlokov, radarBloky } from '../shared/radar-data.js';
import { farbaBajtu, krokovMinulost, osRadaru, pasOsi, popisChvile } from '../shared/radar.js';
import { indexKroku, RadarData } from './radar-data.js';
import { RadarVrstva } from './radar-gl.js';
import { vytvorMapu } from './radar-mapa.js';

const SVG = 'http://www.w3.org/2000/svg';
const KROK_MS = RADAR.krokMin * 60000;
const HODINA_MS = 3600000;

/** @param {string} meno @param {Record<string, string | number>} attr */
function svg(meno, attr) {
    const el = document.createElementNS(SVG, meno);
    for (const [k, v] of Object.entries(attr)) el.setAttribute(k, String(v));
    return el;
}

/** Posun miestneho času od UTC v minútach. @param {number} ms */
const posunCasu = (ms) => -new Date(ms).getTimezoneOffset();

/** Dnešná polnoc v miestnom čase. @param {number} ms */
function polnoc(ms) {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

/**
 * Model po hodinách s textúrami.
 * @typedef {{ casy: number[], w: number, h: number, dazd: Uint8Array[], oblaky: Uint8Array[],
 *   tDazd: Array<WebGLTexture | null>, tOblaky: Array<WebGLTexture | null> }} Model
 */

export class RadarHrac {
    /** @type {any} */ map = null;
    /** @type {RadarVrstva | null} */ gl = null;
    /** @type {RadarData | null} */ data = null;
    /** @type {import('../shared/radar-data.js').Oblast | null} */ oblast = null;
    /** @type {Map<number, { t: WebGLTexture | null, f: Uint8Array }>} snímky podľa indexu kroku */
    snimky = new Map();
    /** @type {Model | null} */ model = null;
    /** @type {[number, number]} poloha domu v bodoch obrázka */
    bod = [0, 0];
    terazMs = 0;
    poz = krokovMinulost;
    pocet = 2 * krokovMinulost;
    zaKoncom = 0;
    posledny = 0;
    beh = 0;
    /** @type {{ gx: number, gy: number, g: number, bajty: Uint8Array } | null} */ pole = null;
    /** @type {Promise<void> | null} */ zaciatok = null;
    pasCaka = 0;
    obnovene = 0;
    // Snímky sú načítané a človek ešte nezasiahol: karta sa vtedy pustí sama.
    pripravena = false;
    zasiahol = false;

    /** @param {import('./state.js').Store} store @param {import('./dom.js').Dom} dom */
    constructor(store, dom) {
        this.store = store;
        this.dom = dom;
    }

    get rozsah() {
        return this.store.get().radarRozsah;
    }

    /** Index kroku pre miesto na osi merania. @param {number} i */
    krokOsi(i) {
        return indexKroku(this.terazMs) - krokovMinulost + i;
    }

    /** Najbližšia načítaná snímka k indexu kroku. @param {number} i */
    najblizsia(i) {
        for (let d = 0; d <= krokovMinulost; d++) {
            const s = this.snimky.get(i - d) ?? this.snimky.get(i + d);
            if (s) return s;
        }
        return null;
    }

    /** Hodiny modelu okolo času a podiel medzi nimi. @param {number} ms */
    hodina(ms) {
        const m = this.model;
        if (!m) return null;
        const k = (ms - m.casy[0]) / HODINA_MS;
        const a = Math.max(0, Math.min(m.casy.length - 1, Math.floor(k)));
        return { a, b: Math.min(m.casy.length - 1, a + 1), f: Math.max(0, Math.min(1, k - a)) };
    }

    /** Čas zobrazenej chvíle. */
    casPolohy() {
        if (this.rozsah === '2h') return this.terazMs + (this.poz - krokovMinulost) * KROK_MS;
        return polnoc(this.terazMs) + ((this.rozsah === 'dnes' ? 0 : 24) + this.poz) * HODINA_MS;
    }

    /** @param {'tDazd' | 'tOblaky'} druh */
    textury(druh) {
        const h = this.hodina(this.casPolohy());
        const t = this.model?.[druh];
        return { a: h ? (t?.[h.a] ?? null) : null, b: h ? (t?.[h.b] ?? null) : null, f: h?.f ?? 0 };
    }

    /** Dážď v rozsahu 2 h: meranie medzi dvoma snímkami, predpoveď z poslednej. */
    obrazMerania() {
        const doba = this.poz - krokovMinulost;
        const pohyb = !!this.pole;
        if (doba > 0) {
            const a = this.najblizsia(this.krokOsi(krokovMinulost))?.t ?? null;
            return { a, b: a, f: 0, pohyb, doba, slabne: RADAR.predpovedSlabne ** doba };
        }
        const i = Math.floor(this.poz);
        const a = this.najblizsia(this.krokOsi(i))?.t ?? null;
        return { a, b: this.najblizsia(this.krokOsi(i + 1))?.t ?? null, f: this.poz - i, pohyb, doba: 0, slabne: 1 };
    }

    /** @returns {import('./radar-gl.js').Obraz} */
    obraz() {
        const c = this.textury('tOblaky');
        const oblaky = { ca: c.a, cb: c.b, cf: c.f, oblaky: this.store.get().radarOblaky };
        return {
            ...oblaky,
            ...(this.rozsah === '2h' ? this.obrazMerania() : { ...this.textury('tDazd'), pohyb: false, doba: 0, slabne: 1 }),
        };
    }

    /** Čas a jazdec. Volá sa v každom obraze, zapisuje len zmenu. */
    ukaz() {
        if (!this.terazMs) return;
        const { rdCas, rdDruh, rdOs, rdJazdec } = this.dom;
        const p = popisChvile(this.rozsah, this.poz, this.terazMs, polnoc(this.terazMs), posunCasu(this.terazMs));
        if (rdCas.textContent !== p.cas) rdCas.textContent = p.cas;
        if (rdDruh.textContent !== p.druh) {
            rdDruh.textContent = p.druh;
            rdDruh.classList.toggle('predpoved', p.predpoved);
            rdOs.setAttribute('aria-valuetext', `${p.cas}, ${p.druh}`);
            rdOs.setAttribute('aria-valuenow', String(Math.round(this.poz)));
        }
        rdJazdec.style.transform = `translateX(${(this.poz / this.pocet) * rdOs.clientWidth}px)`;
    }

    /** Miesto v poslednej snímke, z ktorého o `krokov` dôjde dážď k domu. @param {number} krokov @returns {[number, number]} */
    poPohybe(krokov) {
        const p = this.pole;
        if (!p) return this.bod;
        const [x, y] = this.bod;
        const n = (Math.round(y / p.g) * p.gx + Math.round(x / p.g)) * 2;
        return [x - ((p.bajty[n] - 127) / RADAR.pohyb.mierka) * krokov, y - ((p.bajty[n + 1] - 127) / RADAR.pohyb.mierka) * krokov];
    }

    /** Dážď pri dome po krokoch osi, v rozsahu 2 h. @param {NonNullable<RadarHrac['oblast']>} o */
    pasMerania(o) {
        const posledna = this.najblizsia(this.krokOsi(krokovMinulost));
        return Array.from({ length: this.pocet + 1 }, (_, i) => {
            if (i <= krokovMinulost) {
                const s = this.snimky.get(this.krokOsi(i));
                return s ? dazdVBode(s.f, o, this.bod) : 0;
            }
            return posledna ? dazdVBode(posledna.f, o, this.poPohybe(i - krokovMinulost)) : 0;
        });
    }

    /** Dážď pri dome po hodinách. @param {NonNullable<RadarHrac['oblast']>} o @param {Model} m */
    pasModelu(o, m) {
        const px = Math.round((this.bod[0] / o.w) * (m.w - 1));
        const py = Math.round((this.bod[1] / o.h) * (m.h - 1));
        return Array.from({ length: 24 }, (_, i) => {
            const h = this.hodina(polnoc(this.terazMs) + ((this.rozsah === 'dnes' ? 0 : 24) + i) * HODINA_MS);
            return h ? m.dazd[h.a][py * m.w + px] : 0;
        });
    }

    /** Stĺpce pásu a čiary osi. @param {ReturnType<typeof osRadaru>} o @param {number} w @param {number} zaklad */
    pasOsi(o, w, zaklad) {
        const { oblast, model } = this;
        const hodnoty = !oblast ? [] : this.rozsah === '2h' ? this.pasMerania(oblast) : model ? this.pasModelu(oblast, model) : [];
        const sirka = Math.max(1.5, w / Math.max(1, hodnoty.length) - 1);
        const deti = pasOsi(hodnoty).map((s) => {
            const v = s.vyska * (zaklad - 4);
            return svg('rect', {
                x: (s.poz * (w - sirka)).toFixed(1),
                y: (zaklad - v).toFixed(1),
                width: sirka.toFixed(1),
                height: v.toFixed(1),
                rx: 1,
                fill: farbaBajtu(s.bajt),
                opacity: o.teraz === null || s.poz * o.pocet > o.teraz ? 0.55 : 1,
            });
        });
        const nx = o.teraz === null ? 0 : (o.teraz / o.pocet) * w;
        const y = zaklad + 0.5;
        if (nx > 0) deti.push(svg('line', { x1: 0, x2: nx, y1: y, y2: y, class: 'rd-os-min' }));
        deti.push(svg('line', { x1: nx, x2: w, y1: y, y2: y, class: 'rd-os-bud' }));
        if (o.teraz !== null) deti.push(svg('line', { x1: nx, x2: nx, y1: zaklad - 4, y2: zaklad + 4, class: 'rd-os-teraz' }));
        return deti;
    }

    /** Pás a popisy osi. */
    kresliOs() {
        const { rdOs, rdOsSvg } = this.dom;
        const w = rdOs.clientWidth;
        const h = rdOsSvg.clientHeight;
        if (!w || !h || !this.terazMs) return;
        const o = osRadaru(this.rozsah, this.terazMs, polnoc(this.terazMs), posunCasu(this.terazMs));
        this.pocet = o.pocet;
        rdOs.setAttribute('aria-valuemax', String(o.pocet));
        rdOsSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);
        const deti = this.pasOsi(o, w, h - 16);
        o.znacky.forEach((z, i) => {
            const kraj = i === 0 ? 'start' : i === o.znacky.length - 1 ? 'end' : 'middle';
            const t = svg('text', {
                x: (z.poz / o.pocet) * w,
                y: h - 2,
                'text-anchor': kraj,
                class: z.hlavna ? 'rd-os-text hlavna' : 'rd-os-text',
            });
            t.textContent = z.text;
            deti.push(t);
        });
        rdOsSvg.replaceChildren(...deti);
    }

    /** Pás sa prekreslí najviac raz za obraz, snímky chodia rýchlo za sebou. */
    pasNeskor() {
        if (this.pasCaka) return;
        this.pasCaka = requestAnimationFrame(() => {
            this.pasCaka = 0;
            this.kresliOs();
        });
    }

    krasli() {
        this.ukaz();
        this.map?.triggerRepaint();
    }

    /** @param {number} t */
    tik(t) {
        const s = this.store.get();
        if (!s.radarHra) return void (this.beh = 0);
        this.beh = requestAnimationFrame((x) => this.tik(x));
        const dt = Math.min(0.1, (t - this.posledny) / 1000);
        this.posledny = t;
        if (this.zaKoncom > 0) {
            this.zaKoncom -= dt * 1000;
            if (this.zaKoncom <= 0) this.poz = 0;
        } else {
            this.poz += dt * (s.radarRozsah === '2h' ? RADAR.krokovZaS : RADAR.hodinZaS) * s.radarRychlost;
            if (this.poz >= this.pocet) {
                this.poz = this.pocet;
                this.zaKoncom = RADAR.pauzaNaKonciMs;
            }
        }
        this.krasli();
    }

    /** @param {number} index @param {Uint8Array} f */
    naSnimku(index, f) {
        const { gl, oblast } = this;
        if (!gl || !oblast) return;
        gl.zmaz(this.snimky.get(index)?.t ?? null);
        this.snimky.set(index, { t: gl.textura(oblast.w, oblast.h, f, true), f });
        if (index === indexKroku(this.terazMs)) this.store.setState({ radarStav: 'ok' });
        this.pasNeskor();
        this.krasli();
    }

    /** @param {Omit<Model, 'tDazd' | 'tOblaky'>} m */
    naModel(m) {
        const g = this.gl;
        if (!g) return;
        for (const t of [...(this.model?.tDazd ?? []), ...(this.model?.tOblaky ?? [])]) g.zmaz(t);
        this.model = { ...m, tDazd: m.dazd.map((d) => g.textura(m.w, m.h, d)), tOblaky: m.oblaky.map((d) => g.textura(m.w, m.h, d)) };
        this.pasNeskor();
        this.krasli();
    }

    /** @param {{ gx: number, gy: number, g: number, bajty: Uint8Array }} m */
    naPohyb(m) {
        this.pole = m;
        this.gl?.pohyb(m);
        this.pasNeskor();
        this.krasli();
    }

    async spusti() {
        const { site, known } = this.store.get();
        if (known === 'nic') return this.store.setState({ radarStav: 'bezpolohy' });
        const bloky = radarBloky(site.lat, site.lon);
        if (!bloky) return this.store.setState({ radarStav: 'mimo' });
        const o = oblastBlokov(bloky);
        this.oblast = o;
        this.bod = [((mercX(site.lon) - o.x0) / (o.x1 - o.x0)) * o.w, ((mercY(site.lat) - o.y0) / (o.y1 - o.y0)) * o.h];
        this.gl = new RadarVrstva(o, () => this.obraz());
        this.map = await vytvorMapu(this.dom.rdMapa, site, this.gl);
        this.data = new RadarData({
            bloky,
            oblast: o,
            naSnimku: (i, f) => this.naSnimku(i, f),
            naPohyb: (m) => this.naPohyb(m),
            naModel: (m) => this.naModel(m),
        });
        await this.obnov();
    }

    /** Najnovšie snímky a model. */
    async obnov() {
        const data = this.data;
        if (!data) return;
        const now = Date.now();
        this.obnovene = now;
        const t = await data.najnovsia(now);
        if (t === null) throw new Error('radar: žiadna snímka');
        if (t !== this.terazMs) {
            // Staršie než dve hodiny už na osi nie sú.
            const pod = indexKroku(t) - krokovMinulost;
            for (const [i, s] of this.snimky) {
                if (i >= pod) continue;
                this.gl?.zmaz(s.t);
                this.snimky.delete(i);
            }
            this.terazMs = t;
        }
        if (this.snimky.has(indexKroku(t))) this.store.setState({ radarStav: 'ok' });
        this.kresliOs();
        this.ukaz();
        data.dopln(t).then(
            () => this.nacitane(),
            () => {},
        );
        data.nacitajModel(now).catch(() => {});
    }

    /** Všetky snímky sú na ceste: pri prvom otvorení sa prehrávanie začne od najstaršej. */
    nacitane() {
        const prvy = !this.pripravena;
        this.pripravena = true;
        if (prvy && !this.zasiahol && this.store.get().panel === 'radar') this.pust(true);
    }

    /** Pustí kartu, keď tlmenie pohybu nechce opak. @param {boolean} [odZaciatku] */
    pust(odZaciatku = false) {
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        if (odZaciatku) this.poz = 0;
        this.store.setState({ radarHra: true });
    }

    /** Karta je na obrazovke. Prvé otvorenie stiahne mapu aj dáta, ďalšie len doplní nové. */
    otvor() {
        if (this.zaciatok) {
            if (this.data && Date.now() - this.obnovene > RADAR.obnovaMs) this.obnov().catch(() => {});
            this.map?.resize();
            if (this.pripravena) this.pust();
            return this.kresliOs();
        }
        this.store.setState({ radarStav: 'nacitavam' });
        this.zaciatok = this.spusti().catch((err) => {
            console.warn('radar', err);
            this.zaciatok = null;
            this.map?.remove();
            this.map = null;
            this.data = null;
            this.store.setState({ radarStav: 'chyba', radarHra: false });
        });
    }

    /** Prehrávanie podľa stavu. */
    hra() {
        if (!this.store.get().radarHra || this.beh) return;
        this.posledny = performance.now();
        this.zaKoncom = 0;
        if (this.poz >= this.pocet) this.poz = 0;
        this.beh = requestAnimationFrame((t) => this.tik(t));
    }

    /** Nový rozsah: 2 h začína na „teraz“, Dnes na tejto hodine, Zajtra od polnoci. */
    zmenRozsah() {
        const o = osRadaru(this.rozsah, this.terazMs, polnoc(this.terazMs), posunCasu(this.terazMs));
        this.pocet = o.pocet;
        this.poz = o.teraz ?? 0;
        this.zaKoncom = 0;
        this.kresliOs();
        this.krasli();
    }

    /** Poloha z prsta, podiel osi od 0 do 1. @param {number} podiel */
    posun(podiel) {
        this.zasiahol = true;
        this.poz = Math.max(0, Math.min(this.pocet, podiel * this.pocet));
        this.krasli();
    }

    /** Poloha z klávesnice. @param {number} krokov */
    krok(krokov) {
        this.zasiahol = true;
        this.poz = Math.max(0, Math.min(this.pocet, Math.round(this.poz) + krokov));
        this.krasli();
    }
}
