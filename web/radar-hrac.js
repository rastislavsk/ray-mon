// Prehrávač karty Radar: mapa, snímky a poloha na osi. Poloha sa mení v každom obraze, preto nie je
// v stave a nekreslí sa cez render (rovnako ako posun pásu dní). V stave je len to, čo si človek zvolil.

import { RADAR } from '../shared/config.js';
import { dazdVBode, detailBody, mercX, mercY, oblastBlokov, radarBloky } from '../shared/radar-data.js';
import { farbaBajtu, krokovMinulost, obnovitRadar, osRadaru, pasOsi, popisChvile, typZrazok } from '../shared/radar.js';
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
 * `detail` je detail okolo domu, obrázok RGB dw × dw na hodinu (R zrážky, G oblaky, B podiel snehu), dom je v jeho strede.
 * @typedef {{ casy: number[], w: number, h: number, dazd: Uint8Array[], oblaky: Uint8Array[], sneh: Uint8Array[],
 *   dw: number, detail: Uint8Array[], tDazd: Array<WebGLTexture | null>, tOblaky: Array<WebGLTexture | null>,
 *   tSneh: Array<WebGLTexture | null>, tDetail: Array<WebGLTexture | null> }} Model
 * Dáta z obnovy, ktoré čakajú bokom, kým nepríde všetko a os nestojí: prehrávanie tak nikdy nemieša staré s novými.
 * @typedef {{ terazMs: number, hotove: boolean, snimky: Map<number, Uint8Array>,
 *   pole: { gx: number, gy: number, g: number, bajty: Uint8Array } | null, model: Omit<Model, 'tDazd' | 'tOblaky' | 'tSneh' | 'tDetail'> | null }} Nove
 */

export class RadarHrac {
    /** @type {any} */ map = null;
    /** @type {RadarVrstva | null} */ gl = null;
    /** @type {RadarData | null} */ data = null;
    /** @type {import('../shared/radar-data.js').Oblast | null} */ oblast = null;
    /** @type {Map<number, { t: WebGLTexture | null, f: Uint8Array }>} snímky podľa indexu kroku */
    snimky = new Map();
    /** @type {Model | null} */ model = null;
    /** Okraj detailu modelu okolo domu v súradniciach obrázka 0–1: x0, y0, x1, y1. */
    detailUv = [-2, -2, -1, -1];
    /** @type {[number, number]} poloha domu v bodoch obrázka */
    bod = [0, 0];
    terazMs = 0;
    poz = krokovMinulost;
    pocet = 2 * krokovMinulost;
    posledny = 0;
    beh = 0;
    /** @type {{ gx: number, gy: number, g: number, bajty: Uint8Array } | null} */ pole = null;
    /** @type {Promise<void> | null} */ zaciatok = null;
    /** Prvé Play po prvom načítaní ide od „teraz“, nie od začiatku osi. */
    odTeraz = false;
    pasCaka = 0;
    obnovene = 0;
    /** @type {any} model, ktorý prišiel skôr než mapa */ cakaModel = null;
    /** @type {Nove | null} */ nove = null;
    /** Prst alebo kurzor práve ťahá os: nové dáta počkajú, kým ju pustí. */
    tahaj = false;

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

    /** @param {'tDazd' | 'tOblaky' | 'tSneh' | 'tDetail'} druh */
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
        const s = this.textury('tSneh');
        const d = this.textury('tDetail');
        const oblaky = { ca: c.a, cb: c.b, cf: c.f, sa: s.a, sb: s.b, sf: s.f, oblaky: this.store.get().radarOblaky };
        // Bez modelu je okraj detailu mimo obrázka, shader ho nepoužije.
        const det = this.model ? this.detailUv : [-2, -2, -1, -1];
        return {
            ...oblaky,
            da: d.a,
            db: d.b,
            det,
            detDazd: this.rozsah !== '2h',
            ...(this.rozsah === '2h' ? this.obrazMerania() : { ...this.textury('tDazd'), pohyb: false, doba: 0, slabne: 1 }),
        };
    }

    /** Čas a jazdec. Volá sa v každom obraze, zapisuje len zmenu. */
    ukaz() {
        if (!this.terazMs) return;
        const { rdCas, rdDruh, rdOs, rdJazdec } = this.dom;
        const t = this.terazMs;
        const p = popisChvile(this.rozsah, this.poz, { terazMs: t, polnocMs: polnoc(t), posunMin: posunCasu(t), nowMs: Date.now() });
        if (rdCas.textContent !== p.cas) rdCas.textContent = p.cas;
        if (rdDruh.textContent !== p.druh) {
            rdDruh.textContent = p.druh;
            rdDruh.classList.toggle('predpoved', p.predpoved);
            rdDruh.classList.toggle('meska', p.meska);
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

    /** Hodnota detailu modelu pri dome (v strede detailu). @param {Model} m @param {number} hodina @param {0 | 1 | 2} kanal R, G, B */
    priDome(m, hodina, kanal) {
        const c = Math.floor(m.dw / 2);
        return m.detail[hodina][(c * m.dw + c) * 3 + kanal];
    }

    /** Dážď pri dome po hodinách, z detailu modelu. @param {Model} m */
    pasModelu(m) {
        return Array.from({ length: 24 }, (_, i) => {
            const h = this.hodina(polnoc(this.terazMs) + ((this.rozsah === 'dnes' ? 0 : 24) + i) * HODINA_MS);
            return h ? this.priDome(m, h.a, 0) : 0;
        });
    }

    /** Časy stĺpcov pásu: kroky merania a predpovede, alebo hodiny dňa. @param {number} n */
    casyPasu(n) {
        if (this.rozsah === '2h') return Array.from({ length: n }, (_, i) => this.terazMs + (i - krokovMinulost) * KROK_MS);
        return Array.from({ length: n }, (_, i) => polnoc(this.terazMs) + ((this.rozsah === 'dnes' ? 0 : 24) + i) * HODINA_MS);
    }

    /**
     * Typ zrážok pri dome v daných časoch z podielu snehu v detaile modelu; bez modelu dážď.
     * @param {number[]} casy @returns {import('../shared/radar.js').TypZrazok[]}
     */
    typyPasu(casy) {
        const m = this.model;
        if (!m) return [];
        return casy.map((ms) => {
            const h = this.hodina(ms);
            return typZrazok(h ? this.priDome(m, h.a, 2) / 255 : 0);
        });
    }

    /** Stĺpce pásu a čiary osi. @param {ReturnType<typeof osRadaru>} o @param {number} w @param {number} zaklad */
    pasOsi(o, w, zaklad) {
        const { oblast, model } = this;
        const hodnoty = !oblast ? [] : this.rozsah === '2h' ? this.pasMerania(oblast) : model ? this.pasModelu(model) : [];
        const typy = this.typyPasu(this.casyPasu(hodnoty.length));
        const sirka = Math.max(1.5, w / Math.max(1, hodnoty.length) - 1);
        const deti = pasOsi(hodnoty, typy).map((s) => {
            const v = s.vyska * (zaklad - 4);
            return svg('rect', {
                x: (s.poz * (w - sirka)).toFixed(1),
                y: (zaklad - v).toFixed(1),
                width: sirka.toFixed(1),
                height: v.toFixed(1),
                rx: 1,
                fill: farbaBajtu(s.bajt, s.typ),
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
        // Popisy stoja stredom na svojom čase, aj krajné – inak by sa posledný zlepil s predposledným.
        // Miesto na ich presah dáva okraj osi v css/.
        o.znacky.forEach((z) => {
            const t = svg('text', {
                x: (z.poz / o.pocet) * w,
                y: h - 2,
                'text-anchor': 'middle',
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
        this.poz = Math.min(this.pocet, this.poz + dt * (s.radarRozsah === '2h' ? RADAR.krokovZaS : RADAR.hodinZaS) * s.radarRychlost);
        this.krasli();
        // Os sa prehrá raz a na konci zastane.
        if (this.poz >= this.pocet) this.store.setState({ radarHra: false });
    }

    /** @param {number} index @param {Uint8Array} f */
    vlozSnimku(index, f) {
        const { gl, oblast } = this;
        if (!gl || !oblast) return;
        gl.zmaz(this.snimky.get(index)?.t ?? null);
        this.snimky.set(index, { t: gl.textura(oblast.w, oblast.h, f, true), f });
    }

    /** @param {number} index @param {Uint8Array} f */
    naSnimku(index, f) {
        if (this.nove) return void this.nove.snimky.set(index, f);
        this.vlozSnimku(index, f);
        if (index === indexKroku(this.terazMs)) this.store.setState({ radarStav: 'ok' });
        this.pasNeskor();
        this.krasli();
    }

    /** @param {Omit<Model, 'tDazd' | 'tOblaky' | 'tSneh' | 'tDetail'>} m */
    naModel(m) {
        if (this.nove) return void (this.nove.model = m);
        const g = this.gl;
        // Mapa ešte nie je hotová, textúry počkajú na ňu.
        if (!g?.gl) return void (this.cakaModel = m);
        const stary = this.model;
        if (stary) for (const t of [...stary.tDazd, ...stary.tOblaky, ...stary.tSneh, ...stary.tDetail]) g.zmaz(t);
        /** @param {Uint8Array[]} v */
        const textury = (v) => v.map((d) => g.textura(m.w, m.h, d));
        const tDetail = m.detail.map((d) => g.texturaRgb(m.dw, m.dw, d));
        this.model = { ...m, tDazd: textury(m.dazd), tOblaky: textury(m.oblaky), tSneh: textury(m.sneh), tDetail };
        this.pasNeskor();
        this.krasli();
    }

    /** @param {{ gx: number, gy: number, g: number, bajty: Uint8Array }} m */
    naPohyb(m) {
        if (this.nove) return void (this.nove.pole = m);
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
        const d = detailBody(site.lat, site.lon).okraj;
        /** @param {number} x */
        const u = (x) => (x - o.x0) / (o.x1 - o.x0);
        /** @param {number} y */
        const v = (y) => (y - o.y0) / (o.y1 - o.y0);
        this.detailUv = [u(d.x0), v(d.y0), u(d.x1), v(d.y1)];
        this.gl = new RadarVrstva(o, () => this.obraz());
        this.data = new RadarData({
            bloky,
            oblast: o,
            stred: { lat: site.lat, lon: site.lon },
            naSnimku: (i, f) => this.naSnimku(i, f),
            naPohyb: (m) => this.naPohyb(m),
            naModel: (m) => this.naModel(m),
        });
        // Model sa začne sťahovať hneď, nečaká na mapu ani na snímky.
        this.data.nacitajModel(Date.now()).catch(() => {});
        const map = await vytvorMapu(this.dom.rdMapa, site, this.gl, o);
        this.map = map;
        // Mapa je „idle“, keď má všetky dlaždice výrezu.
        const mapa = new Promise((res) => map.once('idle', res));
        if (this.cakaModel) this.naModel(this.cakaModel);
        await this.obnov(mapa);
    }

    /**
     * Najnovšie snímky a model. Prvé načítanie ukazuje snímky hneď (najnovšia je na mape, kým sa dopĺňa zvyšok)
     * a na konci pustí prehrávanie. Ďalšie obnovy sťahujú bokom (`nove`) a vymenia všetko naraz.
     * @param {Promise<unknown>} [mapa] dlaždice mapy pri prvom načítaní
     */
    async obnov(mapa) {
        const data = this.data;
        if (!data || this.nove) return;
        const now = Date.now();
        this.obnovene = now;
        /** @type {Nove | null} */
        const nove = this.terazMs ? { terazMs: 0, hotove: false, snimky: new Map(), pole: null, model: null } : null;
        this.nove = nove;
        try {
            const t = await data.najnovsia(now);
            if (t === null) throw new Error('radar: žiadna snímka');
            if (nove) nove.terazMs = t;
            else {
                this.terazMs = t;
                if (this.snimky.has(indexKroku(t))) this.store.setState({ radarStav: 'ok' });
                this.kresliOs();
                this.ukaz();
            }
            const vsetko = Promise.all([data.dopln(t).catch(() => {}), data.nacitajModel(now).catch(() => {}), mapa]);
            await Promise.race([vsetko, new Promise((res) => setTimeout(res, RADAR.cakanieMs))]);
        } catch (err) {
            this.nove = null;
            throw err;
        }
        if (!nove) {
            this.odTeraz = true;
            return this.store.setState({ radarHotovo: true, radarBezModelu: !this.model });
        }
        nove.hotove = true;
        this.prevezmi();
    }

    /** V rozsahu 2 h ostane zastavená os na tej istej chvíli, „teraz“ ide s najnovšou snímkou. @param {number} noveMs */
    drzChvilu(noveMs) {
        if (this.rozsah !== '2h' || Math.round(this.poz) === krokovMinulost) return;
        this.poz = Math.max(0, this.poz - (indexKroku(noveMs) - indexKroku(this.terazMs)));
    }

    /** Dáta z obnovy na os, keď sú všetky a os stojí. */
    prevezmi() {
        const n = this.nove;
        if (!n?.hotove || this.tahaj || this.store.get().radarHra) return;
        this.nove = null;
        this.drzChvilu(n.terazMs);
        // Staršie než dve hodiny už na osi nie sú.
        const pod = indexKroku(n.terazMs) - krokovMinulost;
        for (const [i, s] of this.snimky) {
            if (i >= pod) continue;
            this.gl?.zmaz(s.t);
            this.snimky.delete(i);
        }
        this.terazMs = n.terazMs;
        for (const [i, f] of n.snimky) if (i >= pod) this.vlozSnimku(i, f);
        if (n.pole) this.naPohyb(n.pole);
        if (n.model) this.naModel(n.model);
        this.store.setState({ radarBezModelu: !this.model });
        this.kresliOs();
        this.krasli();
    }

    /** Karta je na obrazovke. Prvé otvorenie stiahne mapu aj dáta, ďalšie len doplní nové. */
    otvor() {
        if (this.zaciatok) {
            this.skusObnovit();
            this.map?.resize();
            return this.kresliOs();
        }
        this.store.setState({ radarStav: 'nacitavam' });
        this.zaciatok = this.spusti().catch((err) => {
            console.warn('radar', err);
            this.zaciatok = null;
            this.map?.remove();
            this.map = null;
            this.data = null;
            this.nove = null;
            this.terazMs = 0;
            this.store.setState({ radarStav: 'chyba', radarHra: false, radarHotovo: false });
        });
    }

    /**
     * Vek snímky v hlavičke (ráta sa od teraz) a obnova, keď už mala vyjsť ďalšia snímka.
     * Volá sa pri prepnutí karty, návrate do appky a každú minútu.
     */
    skusObnovit() {
        this.ukaz();
        if (this.zaciatok && this.data && obnovitRadar(this.terazMs, this.obnovene, Date.now())) this.obnov().catch(() => {});
    }

    /** Ťuknutie na chvíľu: obnova hneď, bez čakania na čas zverejnenia. Krúžok sa točí, kým sťahuje. */
    obnovRucne() {
        if (!this.zaciatok || !this.data || this.nove || this.store.get().radarObnovuje) return;
        this.store.setState({ radarObnovuje: true });
        this.obnov()
            .catch(() => {})
            .finally(() => this.store.setState({ radarObnovuje: false }));
    }

    /** Prehrávanie podľa stavu. */
    hra() {
        // Os zastala: teraz môžu prísť dáta, ktoré obnova pripravila bokom.
        if (!this.store.get().radarHra) return this.prevezmi();
        if (this.beh) return;
        this.posledny = performance.now();
        // Prvé Play po načítaní ide od „teraz“ dopredu. Potom z konca alebo z „teraz“ od začiatku, inak odtiaľ,
        // kam ju človek dal.
        if (this.odTeraz && this.poz < this.pocet) this.odTeraz = false;
        else if (this.poz >= this.pocet || this.poz === this.teraz()) this.poz = 0;
        this.beh = requestAnimationFrame((t) => this.tik(t));
    }

    /** Poloha „teraz“ na osi. */
    teraz() {
        return osRadaru(this.rozsah, this.terazMs, polnoc(this.terazMs), posunCasu(this.terazMs)).teraz;
    }

    /** Nový rozsah: 2 h začína na „teraz“, Dnes na tejto hodine, Zajtra od polnoci. */
    zmenRozsah() {
        const o = osRadaru(this.rozsah, this.terazMs, polnoc(this.terazMs), posunCasu(this.terazMs));
        this.pocet = o.pocet;
        this.poz = o.teraz ?? 0;
        this.kresliOs();
        this.krasli();
    }

    /** Poloha z prsta, podiel osi od 0 do 1. @param {number} podiel */
    posun(podiel) {
        this.poz = Math.max(0, Math.min(this.pocet, podiel * this.pocet));
        this.krasli();
    }

    /** Poloha z klávesnice. @param {number} krokov */
    krok(krokov) {
        this.poz = Math.max(0, Math.min(this.pocet, Math.round(this.poz) + krokov));
        this.krasli();
    }
}
