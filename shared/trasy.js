// Na čo stačia kilometre autom: podnadpis riadku „km autom“ na plagáte karty Štatistika.
// Skutočné trasy autom z domu do miest zo zoznamu (shared/trasy-mesta.js) ráta Worker raz pre polohu
// (POST /trasy, smerovač OSRM); appka si ich odloží a tu sa z nich vyberá. Čisté funkcie, texty
// skladá shared/messages-statistika.js.
//
// Výber: trasy tam aj tam a späť a míľniky, ktoré sa od kilometrov líšia najviac o TRASY.tolerancia;
// z nich jedna podľa dňa a obdobia, aby sa text neopakoval. Keď nesedí nič, najbližšia trasa
// s poctivým „skoro“ či „ďalej než“; od TRASY.zemOdKm (a bez trás vždy) podiel cesty okolo Zeme,
// od jedného kola násobky a nakoniec Mesiac.

import { TRASY } from './config.js';
import { MESTA } from './trasy-mesta.js';
import { isObj } from './valid.js';

/** @typedef {{ lat: number, lon: number }} Poloha */
/** @typedef {{ id: string, km: number }} Trasa */
/** @typedef {{ lat: number, lon: number, trasy: Trasa[] }} UlozeneTrasy */
/**
 * Čo povie podnadpis. `mesto`: trasa z domu (`spat` tam a späť), `presne` ako sedí na kilometre -
 * `ako` v tolerancii, `skoro` kilometre na ňu nestačia, `dalej` sú dlhšie, `kus` je to len kus cesty.
 * `zem`: násobok cesty okolo Zeme, `mesiac`: až na Mesiac (`spat` aj späť).
 * @typedef {{ kind: 'mesto', do: string, km: number, spat: boolean, presne: 'ako' | 'skoro' | 'dalej' | 'kus' }
 *   | { kind: 'milnik', id: string, km: number }
 *   | { kind: 'zem', nasobok: number }
 *   | { kind: 'mesiac', spat: boolean }} Cesta
 */

/** Meno mesta v tvare „do …“ podľa id. */
const MENO = new Map(MESTA.map(([id, meno]) => [id, meno]));

/** Poloha zaokrúhlená na stotiny stupňa (asi 1 km): presnejšiu trasy nepotrebujú a ďalej nejde. @param {Poloha} p */
export const zaokruhli = (p) => ({ lat: Math.round(p.lat * 100) / 100, lon: Math.round(p.lon * 100) / 100 });

/** Vzdialenosť vzdušnou čiarou v km (haversine). @param {Poloha} a @param {Poloha} b */
export function vzdusneKm(a, b) {
    const r = Math.PI / 180;
    const x =
        Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(x));
}

/**
 * Mestá, do ktorých sa oplatí rátať trasu: najbližšie vzdušnou čiarou, do TRASY.dosahKm, najviac
 * TRASY.najviacMiest. Mesto v tom istom mieste ako dom (do 2 km) nie - „ako z domu do domu“ nič nehovorí.
 * @param {Poloha} doma @returns {Array<{ id: string, lat: number, lon: number }>}
 */
export function mestaPre(doma) {
    return MESTA.map(([id, , lat, lon]) => ({ id, lat, lon, km: vzdusneKm(doma, { lat, lon }) }))
        .filter((m) => m.km > 2 && m.km <= TRASY.dosahKm)
        .sort((a, b) => a.km - b.km)
        .slice(0, TRASY.najviacMiest)
        .map(({ id, lat, lon }) => ({ id, lat, lon }));
}

/** Adresa tabuľky vzdialeností OSRM: z domu (prvý bod) do každého mesta. @param {Poloha} doma @param {Poloha[]} mesta */
export function osrmAdresa(doma, mesta) {
    const body = [doma, ...mesta].map((p) => `${p.lon},${p.lat}`).join(';');
    return `${TRASY.osrmUrl}${body}?sources=0&annotations=distance`;
}

/** Vzdialenosť, na ktorú smerovač prichytil bod k ceste (m); bez údaja nekonečno. @param {unknown} w */
const prichytenie = (w) => (isObj(w) && typeof w.distance === 'number' ? w.distance : Infinity);

/**
 * Trasy z odpovede OSRM. Mesto bez cesty, alebo prichytené ďaleko od seba (ostrov), vypadne; dom
 * prichytený ďaleko od seba (bez ciest) znamená žiadne trasy. Čokoľvek nečakané je null.
 * @param {unknown} json @param {Array<{ id: string }>} mesta @returns {Trasa[] | null}
 */
export function trasyZTabulky(json, mesta) {
    if (!isObj(json) || json.code !== 'Ok' || !Array.isArray(json.distances) || !Array.isArray(json.distances[0])) return null;
    if (!Array.isArray(json.destinations) || json.destinations.length !== mesta.length + 1) return null;
    if (!Array.isArray(json.sources) || prichytenie(json.sources[0]) > TRASY.prichytenieM) return [];
    const riadok = json.distances[0];
    const ciele = json.destinations;
    return mesta.flatMap((m, i) => {
        const m2 = riadok[i + 1];
        return typeof m2 === 'number' && m2 > 0 && prichytenie(ciele[i + 1]) <= TRASY.prichytenieM
            ? [{ id: m.id, km: Math.round(m2 / 1000) }]
            : [];
    });
}

/** Zoznam trás: len známe mestá s kladnými kilometrami, ostatné vypadnú. @param {unknown} raw @returns {Trasa[] | null} */
export function parseZoznam(raw) {
    if (!Array.isArray(raw)) return null;
    return raw.filter(
        (t) => isObj(t) && typeof t.id === 'string' && MENO.has(t.id) && typeof t.km === 'number' && Number.isFinite(t.km) && t.km > 0,
    );
}

/** Uložené trasy (TRASY_STORAGE_KEY); poškodené null. @param {unknown} raw @returns {UlozeneTrasy | null} */
export function parseTrasy(raw) {
    if (!isObj(raw) || typeof raw.lat !== 'number' || typeof raw.lon !== 'number') return null;
    const trasy = parseZoznam(raw.trasy);
    return trasy && { lat: raw.lat, lon: raw.lon, trasy };
}

/** Trasy pre túto polohu, alebo null - stiahnuté boli pre inú, či ešte vôbec. @param {UlozeneTrasy | null} ulozene @param {Poloha} site */
export function trasyPre(ulozene, site) {
    const p = zaokruhli(site);
    return ulozene && ulozene.lat === p.lat && ulozene.lon === p.lon ? ulozene.trasy : null;
}

/** Číslo zo semienka (deň a obdobie): rovnaké semienko, rovnaký výber. @param {string} s */
function hash(s) {
    let h = 2166136261;
    for (const ch of s) h = Math.imul(h ^ (ch.codePointAt(0) ?? 0), 16777619);
    return h >>> 0;
}

/**
 * Čo povie podnadpis pri týchto kilometroch. `semienko` (napr. deň a obdobie) vyberá medzi
 * trasami, ktoré sedia rovnako dobre. Bez trás (`trasy` prázdne) cesta okolo Zeme.
 * @param {number} km @param {Trasa[]} trasy @param {string} semienko @returns {Cesta}
 */
export function vyberCestu(km, trasy, semienko) {
    if (km >= TRASY.mesiacKm) return { kind: 'mesiac', spat: km >= 2 * TRASY.mesiacKm };
    const mesta = trasy.flatMap((t) => {
        const meno = /** @type {string} */ (MENO.get(t.id));
        return [
            { kind: /** @type {const} */ ('mesto'), do: meno, km: t.km, spat: false },
            { kind: /** @type {const} */ ('mesto'), do: meno, km: 2 * t.km, spat: true },
        ];
    });
    const milniky = TRASY.milniky.map((m) => ({ kind: /** @type {const} */ ('milnik'), ...m }));
    const sedia = [...mesta, ...milniky].filter((c) => Math.abs(km / c.km - 1) <= TRASY.tolerancia);
    if (sedia.length) {
        const c = sedia[hash(semienko) % sedia.length];
        return c.kind === 'mesto' ? { ...c, presne: 'ako' } : c;
    }
    if (km >= TRASY.zemOdKm || !mesta.length) return { kind: 'zem', nasobok: km / TRASY.zemKm };
    const najblizsia = mesta.reduce((a, b) => (Math.abs(Math.log(km / b.km)) < Math.abs(Math.log(km / a.km)) ? b : a));
    const presne = km > najblizsia.km ? 'dalej' : km >= najblizsia.km / 2 ? 'skoro' : 'kus';
    return { ...najblizsia, presne };
}

/** Koľké kolo okolo Zeme je rozbehnuté a koľko km mu chýba do konca. @param {number} km */
export function koloZeme(km) {
    const kolo = Math.floor(km / TRASY.zemKm) + 1;
    return { kolo, chyba: kolo * TRASY.zemKm - km };
}
