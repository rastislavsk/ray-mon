// Podkladová mapa karty Radar: MapLibre z CDN so štýlom OpenFreeMap. Knižnica sa načíta až pri prvom
// otvorení karty, s kontrolou hashu. Je to jediná výnimka z pravidla o závislostiach (CLAUDE.md).

import { RADAR } from '../shared/config.js';
import { upravStyl } from '../shared/radar.js';

/** @type {Promise<any> | null} */
let kniznica = null;

/** Načíta MapLibre raz. Keď sa to nepodarí, ďalší pokus skúsi znova. */
function nacitajKniznicu() {
    // Už je v stránke: ďalšie otvorenie, alebo test s falošnou mapou (hash integrity iný súbor nepustí).
    const hotova = /** @type {any} */ (window).maplibregl;
    if (hotova) return Promise.resolve(hotova);
    kniznica ??= new Promise((res, rej) => {
        const { js, jsHash, css, cssHash } = RADAR.maplibre;
        const l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = css;
        l.integrity = cssHash;
        l.crossOrigin = 'anonymous';
        document.head.append(l);
        const s = document.createElement('script');
        s.src = js;
        s.integrity = jsHash;
        s.crossOrigin = 'anonymous';
        s.onload = () => res(/** @type {any} */ (window).maplibregl);
        s.onerror = () => {
            kniznica = null;
            l.remove();
            s.remove();
            rej(new Error('MapLibre'));
        };
        document.head.append(s);
    });
    return kniznica;
}

/** Štýl mapy. Bez neho ostane jednoliate pozadie, radar funguje ďalej. */
async function styl() {
    try {
        const r = await fetch(RADAR.styl);
        if (r.ok) return upravStyl(await r.json());
    } catch {
        // Spadne to na pozadie nižšie.
    }
    return {
        version: 8,
        sources: {},
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': RADAR.mapa.pevnina } }],
    };
}

/**
 * Mapa v prvku, stredom na polohe. Vrstva radaru je pod názvami miest.
 * @param {HTMLElement} prvok @param {{ lat: number, lon: number }} poloha @param {any} vrstva
 */
export async function vytvorMapu(prvok, poloha, vrstva) {
    const maplibregl = await nacitajKniznicu();
    const map = new maplibregl.Map({
        container: prvok,
        style: await styl(),
        center: [poloha.lon, poloha.lat],
        zoom: RADAR.zoom,
        minZoom: 4,
        maxZoom: 10,
        attributionControl: { compact: true, customAttribution: RADAR.zdroj },
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        renderWorldCopies: false,
    });
    map.touchZoomRotate.disableRotation();
    await new Promise((res) => map.once('load', res));
    const prvyNapis = map.getStyle().layers.find((/** @type {{ type: string }} */ l) => l.type === 'symbol')?.id;
    map.addLayer(vrstva, prvyNapis);
    // Zdroje sú za ikonou i, na úzkom displeji by inak prekryli mapu.
    const zdroje = prvok.querySelector('.maplibregl-ctrl-attrib');
    zdroje?.removeAttribute('open');
    zdroje?.classList.remove('maplibregl-compact-show');
    const bod = document.createElement('div');
    bod.className = 'rd-doma';
    new maplibregl.Marker({ element: bod }).setLngLat([poloha.lon, poloha.lat]).addTo(map);
    return map;
}
