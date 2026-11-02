// Hlavička oboch appiek: RAY-MON, pod ním lokalita elektrárne, vpravo bodka stavu merania a čas
// posledného merania (bez neho slovom, čo appka ukazuje). Ťuknutie na bodku a čas otvorí bublinu
// s vysvetlením stavu. Bez zadaných panelov je vpravo namiesto času výzva „Zadaj panely ›“.
// Návrh: docs/navrhy/hlavicka-jednotna.html.

import { bodkaMerania, stavMerania } from './hero-model.js';
import { pripojenieText, stavMeraniaSlovo, stavMeraniaText } from './messages-core.js';
import { zdrojText } from './zdroje.js';

/** Čo hlavička ukáže bez času merania: `status` a `toneText` pre čítačku obrazovky. */
const BEZ_CASU = {
    neprislo: { status: 'meranie nedostupné', toneText: '' },
    odhad: { status: 'odhad z predpovede', toneText: '' },
};

/** Čo bodka hovorí tvarom, pre čítačku obrazovky - plná a polovičná bodka stoja pri čase merania. */
const TONE_TEXT = { live: 'živé meranie', stale: 'meranie zastarané' };

/**
 * @typedef {{ known: import('./settings.js').Known, loading: boolean, now: Date,
 *   pv: import('./kiosk.js').PvData | null, forecast: unknown, site: import('./config.js').Site,
 *   zdroj: import('./zdroje.js').Zdroj | null, pristup: import('./pristup.js').Odmietnutie | null, pokusAt?: number }} HlavickaVstup
 */

/**
 * Čo hlavička ukazuje. `place` je lokalita z nastavenia (bez nej prázdna). `setup`: panely nie sú
 * zadané, namiesto času je výzva. `tone` je tvar bodky (bodkaMerania): `live` plná, `stale`
 * polovičná, `odhad` krúžok, `off` žiadne dáta. `status` je čas posledného merania, pri zastaranom
 * a v noci so slovom (stavMeraniaSlovo) - samotný starý čas by vyzeral ako zle idúce hodiny; bez
 * merania slovo. `toneText` dopĺňa pre čítačku obrazovky, čo bodka hovorí tvarom, keď to `status`
 * nepovie sám. `tip` je vysvetlenie stavu do bubliny (null, kým appka stav merania nepozná - vtedy
 * sa bodka a čas neťukajú); `znova`: tlačidlo v nej vedie na hlásenie o neplatnom prístupe.
 * @param {HlavickaVstup} s @param {import('./messages-core.js').Voice} [voice]
 * @returns {{ place: string, setup: boolean, status: string, tone: 'live' | 'stale' | 'odhad' | 'off', toneText: string,
 *   tip: (ReturnType<typeof stavMeraniaText> & { znova: boolean }) | null }}
 */
export function hlavickaModel(s, voice = 'drzy') {
    const place = s.site.name;
    const off = (/** @type {string} */ status) => ({
        place,
        setup: false,
        status,
        tone: /** @type {const} */ ('off'),
        toneText: '',
        tip: null,
    });
    if (s.known !== 'elektraren') return { ...off(''), setup: true };
    if (s.loading) return off('načítavam…');
    if (!s.pv && !s.forecast) return off('bez dát');
    const stav = stavMerania(s);
    const tip = { ...stavMeraniaText(stav, voice), znova: stav.druh === 'znova' };
    const tone = bodkaMerania(stav);
    if (stav.druh === 'znova' && stav.neplati)
        return { place, setup: false, status: stav.neplati.hlavicka, tone, toneText: stav.neplati.tone, tip };
    if (tone !== 'odhad') {
        const slovo = stavMeraniaSlovo(stav);
        return { place, setup: false, tone, status: slovo ? `${stav.cas} · ${slovo}` : stav.cas, toneText: TONE_TEXT[tone], tip };
    }
    return { place, setup: false, tone, ...BEZ_CASU[stav.druh === 'neprislo' ? 'neprislo' : 'odhad'], tip };
}

/**
 * Bublina, ktorú appka ešte neukázala (`caka`): po novom pripojení merania (`pripojene`) alebo po
 * návrate merania z výpadku (`obnovene`, obnovaMerania). Ukáže sa, až keď meranie naozaj prišlo -
 * vtedy karta Teraz prestane ukazovať odhad, a bublina povie prečo. Kým nepríde, null a počká.
 * @param {HlavickaVstup & { caka: '' | 'pripojene' | 'obnovene' }} s
 */
export function pripojenieBublina(s) {
    if (!s.caka || !s.zdroj) return null;
    const druh = stavMerania(s).druh;
    if (druh !== 'zive' && (druh !== 'spi' || s.caka === 'obnovene')) return null;
    return pripojenieText(druh, zdrojText(s.zdroj), s.caka);
}

/**
 * Vrátilo sa meranie z výpadku? Pred zmenou appka hlásila, že meranie mlčí alebo neprišlo, a to po
 * dokončenom pokuse o stiahnutie (nie pri štarte či pri načítaní, `pokusAt`), teraz je živé - to isté
 * meranie (nové pripojenie má vlastnú bublinu a začína načítaním). Do noci (`spi`) sa meranie nevracia:
 * „menič mlčí“ po západe slnka len prestane platiť, menič sa neozval.
 * @param {HlavickaVstup} pred @param {HlavickaVstup} teraz
 */
export function obnovaMerania(pred, teraz) {
    // To isté meranie podľa spôsobu a elektrárne - pečať sa mení aj pri obnovenom tokene (web/refresh.js).
    const ten = pred.zdroj && pred.zdroj.sposob === teraz.zdroj?.sposob && pred.zdroj.nazov === teraz.zdroj.nazov;
    if (!ten || pred.loading || !pred.pokusAt) return false;
    const bolo = stavMerania(pred).druh;
    return (bolo === 'zastarane' || bolo === 'neprislo') && stavMerania(teraz).druh === 'zive';
}
