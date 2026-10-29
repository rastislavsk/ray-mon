// Hlavička oboch appiek: RAY-MON, pod ním lokalita elektrárne, vpravo bodka stavu merania a čas
// posledného merania (bez neho slovom, čo appka ukazuje). Ťuknutie na bodku a čas otvorí bublinu
// s vysvetlením stavu. Bez zadaných panelov je vpravo namiesto času výzva „Zadaj panely ›“.
// Návrh: docs/navrhy/hlavicka-jednotna.html.

import { bodkaMerania, stavMerania } from './hero-model.js';
import { stavMeraniaSlovo, stavMeraniaText } from './messages-core.js';

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
 *   zdroj: import('./zdroje.js').Zdroj | null, pristup: import('./pristup.js').Odmietnutie | null }} HlavickaVstup
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
