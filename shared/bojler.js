// Bojler na prebytky (návrh docs/navrhy/bojler-prebytky.html): rozhodnutie, či zásuvka Shelly
// s bojlerom má byť zapnutá, a záznam dňa pre panel „Bojler dnes“. Čisté funkcie - čas, meranie
// aj stav prichádzajú ako parametre. Volá ich Durable Object účtu Huawei (worker/src/ucet.js)
// pri každom dopyte zásuvky; appka z nich číta stav dlaždice.

import { BOJLER } from './config.js';
import { localDateKey, localMinutes } from './solar.js';
import { isObj } from './valid.js';

const MIN = 60 * 1000;

/** @typedef {{ zapKw: number, vypKw: number }} Prahy */

/**
 * Pamäť rozhodovania medzi dopytmi zásuvky. `meranieAt` je čas posledného započítaného merania
 * Huawei (to sa mení raz za 5 minút, zásuvka sa pýta každú minútu), `nad`/`pod` koľko meraní za
 * sebou bol prebytok nad prahom zapnutia / pod prahom vypnutia, `rele` stav relé pri poslednom
 * dopyte a `zmenaAt` kedy sa naposledy zmenil.
 * @typedef {{ meranieAt: number, nad: number, pod: number, rele: boolean, zmenaAt: number }} Pamat
 */

/** @type {Pamat} */
export const PAMAT_ZACIATOK = { meranieAt: 0, nad: 0, pod: 0, rele: false, zmenaAt: 0 };

/**
 * Prahy zo skriptu zásuvky, keď dávajú zmysel (v rozsahu a vypnutie aspoň o BOJLER.medzeraKw nižšie),
 * inak predvolené.
 * @param {unknown} p @returns {Prahy}
 */
export function prahyZ(p) {
    const ok = (/** @type {unknown} */ v) => typeof v === 'number' && v >= BOJLER.minKw && v <= BOJLER.maxKw;
    if (!isObj(p) || !ok(p.zapKw) || !ok(p.vypKw)) return { zapKw: BOJLER.zapKw, vypKw: BOJLER.vypKw };
    const { zapKw, vypKw } = /** @type {Prahy} */ (p);
    return zapKw - vypKw >= BOJLER.medzeraKw - 1e-9 ? { zapKw, vypKw } : { zapKw: BOJLER.zapKw, vypKw: BOJLER.vypKw };
}

/**
 * Prebytok bez bojlera v kW: dodávka do siete (záporná = odber) a k nej to, čo práve berie bojler -
 * elektromer meria celý dom, takže zapnutý bojler dodávku sám zníži.
 * @param {number} sietKw @param {boolean} rele @param {number} w príkon zásuvky
 */
export const prebytokBezBojlera = (sietKw, rele, w) => Math.round((sietKw + (rele ? Math.max(0, w) / 1000 : 0)) * 1000) / 1000;

/**
 * Má byť bojler zapnutý? Nové meranie Huawei (iný `meranieAt` než posledné) sa započíta do `nad`
 * alebo `pod`; zapne sa po BOJLER.potvrdenia meraniach nad `zapKw`, vypne po toľkých pod `vypKw`,
 * najskôr po BOJLER.minChodMin od zapnutia a BOJLER.minPauzaMin od vypnutia. Meranie staršie než
 * BOJLER.tichoMin či bez elektromera vypne. Relé prepnuté ručne sa berie ako zmena. V ručnom režime
 * (`rucne`, prepínač v appke) nechá relé, ako je - počítanie merania beží ďalej, aby sa po návrate
 * k riadeniu nezačínalo od nuly.
 * @param {Pamat} pamat
 * @param {{ rele: boolean, w: number, sietKw: number | null, meranieAt: number, now: number, prahy: Prahy, rucne?: boolean }} v
 * @returns {{ zapni: boolean, pamat: Pamat, prebytokKw: number | null }}
 */
export function rozhodni(pamat, v) {
    const zmenaAt = v.rele === pamat.rele ? pamat.zmenaAt : v.now;
    const stare = v.sietKw === null || v.now - v.meranieAt > BOJLER.tichoMin * MIN;
    if (stare) return vysledok(!!v.rucne && v.rele, { ...pamat, rele: v.rele, zmenaAt, nad: 0, pod: 0 }, v, null);
    const prebytokKw = prebytokBezBojlera(/** @type {number} */ (v.sietKw), v.rele, v.w);
    const nove = v.meranieAt !== pamat.meranieAt;
    const nad = nove ? (prebytokKw >= v.prahy.zapKw - 1e-9 ? pamat.nad + 1 : 0) : pamat.nad;
    const pod = nove ? (prebytokKw < v.prahy.vypKw - 1e-9 ? pamat.pod + 1 : 0) : pamat.pod;
    const p = { meranieAt: v.meranieAt, nad, pod, rele: v.rele, zmenaAt };
    return vysledok(v.rucne ? v.rele : zapnut(p, v.rele, v.now - zmenaAt), p, v, prebytokKw);
}

/**
 * Prepnúť? Zapnutý vypne po BOJLER.potvrdenia meraniach pod prahom, vypnutý zapne po toľkých nad -
 * najskôr po minimálnom behu či pauze od poslednej zmeny.
 * @param {{ nad: number, pod: number }} p @param {boolean} rele @param {number} odZmeny ms
 */
const zapnut = (p, rele, odZmeny) =>
    rele
        ? !(p.pod >= BOJLER.potvrdenia && odZmeny >= BOJLER.minChodMin * MIN)
        : p.nad >= BOJLER.potvrdenia && odZmeny >= BOJLER.minPauzaMin * MIN;

/**
 * Výsledok rozhodnutia: keď sa relé prepne, začína nové počítanie a nový čas zmeny.
 * @param {boolean} zapni @param {Pamat} p @param {{ rele: boolean, now: number }} v @param {number | null} prebytokKw
 */
function vysledok(zapni, p, v, prebytokKw) {
    const pamat = zapni === v.rele ? p : { ...p, rele: zapni, zmenaAt: v.now, nad: 0, pod: 0 };
    return { zapni, pamat, prebytokKw };
}

/**
 * Jeden beh bojlera v dni: od a do (minúty od polnoci, `do` null kým beží), energia behu vo Wh
 * (z počítadla zásuvky, `e0` je jeho stav na začiatku), koľko z nej išlo zo siete (`whSiet`) a koľko
 * minút bojler naozaj hrial (`hrejeMin`; relé môže byť zapnuté aj s nahriatou vodou).
 * @typedef {{ od: number, do: number | null, wh: number, whSiet: number, e0: number, hrejeMin: number }} Beh
 */
/**
 * Záznam dňa: dátum (v pásme elektrárne), behy (ich počet = počet zapnutí) a kedy termostat
 * bojler vypol (`hotovo`, minúty). `posledneAt` je čas posledného dopytu zásuvky.
 * @typedef {{ den: string, behy: Beh[], hotovo: number | null, posledneAt: number }} Den
 */

/**
 * Záznam dňa po dopyte zásuvky. Nový deň začína prázdny (bežiaci beh pokračuje od polnoci).
 * Podiel zo siete: pri odbere (záporný `sietKw`) ide na bojler najviac jeho príkon, za čas od
 * posledného dopytu (najviac BOJLER.tichoMin).
 * @param {Den | null} den
 * @param {{ now: Date, tz: string, rele: boolean, w: number, energiaWh: number, sietKw: number | null }} v
 * @returns {Den}
 */
export function zaznamenaj(den, v) {
    const kluc = localDateKey(v.now, v.tz);
    const min = localMinutes(v.now, v.tz);
    const t = v.now.getTime();
    const dnes = den !== null && den.den === kluc;
    const behy = behyDna(den, dnes, v);
    let aktivny = behy.find((b) => b.do === null);
    // Čas od posledného dopytu (hodiny) patrí behu, len keď vtedy už bežal.
    const cas = aktivny && den ? Math.min(t - den.posledneAt, BOJLER.tichoMin * MIN) / (60 * MIN) : 0;
    if (v.rele && !aktivny) {
        aktivny = novyBeh(min, v.energiaWh);
        behy.push(aktivny);
    }
    const hreje = v.rele && v.w >= BOJLER.hotovoW;
    if (aktivny) zapocitaj(aktivny, v, cas, hreje, min);
    return {
        den: kluc,
        behy,
        hotovo: kedyHotovo(dnes ? /** @type {Den} */ (den).hotovo : null, hreje, v.rele, aktivny, min),
        posledneAt: t,
    };
}

/**
 * Kedy termostat bojler vypol: zostáva, kým bojler znova nehreje; nové, keď je relé zapnuté, beh už
 * niečo zohrial a príkon klesol.
 * @param {number | null} predtym @param {boolean} hreje @param {boolean} rele @param {Beh | undefined} beh @param {number} min
 */
function kedyHotovo(predtym, hreje, rele, beh, min) {
    if (hreje) return null;
    return predtym ?? (rele && beh && beh.wh > 0 ? min : null);
}

/** @param {number} od @param {number} e0 @returns {Beh} */
const novyBeh = (od, e0) => ({ od, do: null, wh: 0, whSiet: 0, e0, hrejeMin: 0 });

/**
 * Behy, ku ktorým sa dopyt pripíše: dnešné (kópia), v novom dni prázdne - bežiaci beh v ňom
 * pokračuje od polnoci.
 * @param {Den | null} den @param {boolean} dnes @param {{ rele: boolean, energiaWh: number }} v @returns {Beh[]}
 */
function behyDna(den, dnes, v) {
    if (!den) return [];
    if (dnes) return den.behy.map((b) => ({ ...b }));
    return den.behy.some((b) => b.do === null) && v.rele ? [novyBeh(0, v.energiaWh)] : [];
}

/**
 * Dopyt do bežiaceho behu: energia z počítadla, podiel zo siete a čas ohrevu za `cas` hodín.
 * @param {Beh} beh @param {{ rele: boolean, w: number, energiaWh: number, sietKw: number | null }} v
 * @param {number} cas @param {boolean} hreje @param {number} min
 */
function zapocitaj(beh, v, cas, hreje, min) {
    beh.wh = Math.max(0, v.energiaWh - beh.e0);
    const odber = v.sietKw !== null && v.sietKw < 0 ? -v.sietKw * 1000 : 0;
    beh.whSiet += v.rele ? Math.min(Math.max(0, v.w), odber) * cas : 0;
    beh.hrejeMin += hreje ? cas * 60 : 0;
    if (!v.rele) beh.do = min;
}

/**
 * Stav bojlera pre appku: čo hlásila zásuvka naposledy, záznam dňa a či bojler zapína človek (`rucne`).
 * @typedef {{ kontaktAt: number, rele: boolean, w: number, prebytokKw: number | null, prahy: Prahy, den: Den | null, rucne: boolean }} BojlerInfo
 */

/**
 * Čo dlaždica Bojler ukáže: `mlci` zásuvka sa dlhšie neozvala, `hreje` relé zapnuté a bojler berie,
 * `hotovo` relé zapnuté, ale termostat vypol (voda nahriata), `caka` relé vypnuté a appka čaká na
 * prebytok, `vypnuty` relé vypnuté v ručnom režime.
 * @param {BojlerInfo} b @param {number} now @returns {'mlci' | 'hreje' | 'hotovo' | 'caka' | 'vypnuty'}
 */
export function bojlerStav(b, now) {
    if (now - b.kontaktAt > BOJLER.tichoMin * MIN) return 'mlci';
    if (!b.rele) return b.rucne ? 'vypnuty' : 'caka';
    return b.w >= BOJLER.hotovoW ? 'hreje' : 'hotovo';
}

/** Hreje bojler naozaj (relé zapnuté a príkon aspoň BOJLER.hotovoW)? @param {{ rele: boolean, w: number }} b */
const hrejeTo = (b) => b.rele && b.w >= BOJLER.hotovoW;

/**
 * Zmena ohrevu medzi dvoma hláseniami zásuvky pre oznámenie (docs/navrhy/spotrebic-koniec-opakovanie.html): zapol sa či
 * vypol a prečo - termostat (relé ostalo zapnuté), ručne v Shelly (ručný režim), zásuvka nemala spojenie (od
 * predchádzajúceho hlásenia prešlo viac než BOJLER.tichoMin - vypla sa sama), inak appka podľa prebytku `kw`.
 * Bez predchádzajúceho hlásenia či bez zmeny null.
 * @param {BojlerInfo | null} stary @param {BojlerInfo} novy
 * @returns {{ zapol: boolean, dovod: 'appka' | 'termostat' | 'rucne' | 'spojenie', kw: number | null } | null}
 */
export function zmenaOhrevu(stary, novy) {
    if (!stary || hrejeTo(stary) === hrejeTo(novy)) return null;
    const zapol = hrejeTo(novy);
    const rele = zapol ? stary.rele : novy.rele;
    const ticho = novy.kontaktAt - stary.kontaktAt > BOJLER.tichoMin * MIN;
    const dovod = rele ? 'termostat' : !zapol && ticho ? 'spojenie' : novy.rucne ? 'rucne' : 'appka';
    return { zapol, dovod, kw: novy.prebytokKw };
}

/**
 * Súčty dňa pre panel: počet zapnutí, ako dlho bojler hrial (minúty), energia zo slnka a zo siete (kWh).
 * @param {Den} den
 */
export function suctyDna(den) {
    const wh = den.behy.reduce((a, b) => a + b.wh, 0);
    const whSiet = Math.min(
        wh,
        den.behy.reduce((a, b) => a + b.whSiet, 0),
    );
    const min = Math.round(den.behy.reduce((a, b) => a + b.hrejeMin, 0));
    return { zapnuti: den.behy.length, min, slnkoKwh: (wh - whSiet) / 1000, sietKwh: whSiet / 1000 };
}

/**
 * Prah posunutý o BOJLER.krokKw nahor (`smer` 1) či nadol (-1), v rozsahu BOJLER.minKw až maxKw.
 * Vypnutie ostane aspoň o BOJLER.medzeraKw pod zapnutím - druhý prah sa pri tom posunie s ním.
 * @param {Prahy} p @param {'zapKw' | 'vypKw'} ktory @param {1 | -1} smer @returns {Prahy}
 */
export function posunPrahy(p, ktory, smer) {
    const r = (/** @type {number} */ x) => Math.round(x * 10) / 10;
    const v = r(Math.min(BOJLER.maxKw, Math.max(BOJLER.minKw, p[ktory] + smer * BOJLER.krokKw)));
    if (ktory === 'zapKw') {
        const zap = Math.max(v, BOJLER.minKw + BOJLER.medzeraKw);
        return { zapKw: zap, vypKw: r(Math.min(p.vypKw, zap - BOJLER.medzeraKw)) };
    }
    const vyp = Math.min(v, BOJLER.maxKw - BOJLER.medzeraKw);
    return { zapKw: r(Math.max(p.zapKw, vyp + BOJLER.medzeraKw)), vypKw: vyp };
}

/**
 * Stav bojlera z odpovede Workera (`bojler` pri meraní), alebo null, keď nemá očakávaný tvar.
 * Záznam dňa sa preberá len s behmi z čísel.
 * @param {unknown} raw @returns {BojlerInfo | null}
 */
export function bojlerInfoZ(raw) {
    if (!isObj(raw)) return null;
    const o = /** @type {Record<string, unknown>} */ (raw);
    const num = (/** @type {unknown} */ v) => typeof v === 'number' && Number.isFinite(v);
    if (!num(o.kontaktAt) || typeof o.rele !== 'boolean' || !num(o.w)) return null;
    const prebytokKw = num(o.prebytokKw) ? /** @type {number} */ (o.prebytokKw) : null;
    return {
        kontaktAt: /** @type {number} */ (o.kontaktAt),
        rele: o.rele,
        w: /** @type {number} */ (o.w),
        prebytokKw,
        prahy: prahyZ(o.prahy),
        den: denZ(o.den),
        // Starší Worker režim neposiela - vtedy riadi appka.
        rucne: o.rucne === true,
    };
}

/** Záznam dňa z odpovede Workera, alebo null. @param {unknown} raw @returns {Den | null} */
function denZ(raw) {
    if (!isObj(raw)) return null;
    const d = /** @type {Record<string, unknown>} */ (raw);
    const num = (/** @type {unknown} */ v) => typeof v === 'number' && Number.isFinite(v);
    if (typeof d.den !== 'string' || !Array.isArray(d.behy) || !num(d.posledneAt)) return null;
    const behy = d.behy.filter(
        (b) => isObj(b) && num(b.od) && (b.do === null || num(b.do)) && num(b.wh) && num(b.whSiet) && num(b.e0) && num(b.hrejeMin),
    );
    return {
        den: d.den,
        behy: /** @type {Beh[]} */ (behy),
        hotovo: num(d.hotovo) ? /** @type {number} */ (d.hotovo) : null,
        posledneAt: /** @type {number} */ (d.posledneAt),
    };
}
