// Hlavička: stavová bodka (cena × výkon) s časom poslednej aktualizácie dát, pod ním čo ten
// čas znamená, a farba plánu dňa pre pozadie celej stránky (vrátane náhľadu iného času).

import { installedKw } from '../../shared/config.js';
import { heroModel, pvFreshness, stavMerania } from '../../shared/hero-model.js';
import { stavMeraniaText } from '../../shared/messages-core.js';
import { MOZEM_SKY_TEXTS, terazTypicalText } from '../../shared/messages.js';
import { neplatiOf } from '../../shared/pristup.js';

/**
 * Pravý horný roh hlavičky: čas aktualizácie dát a pod ním text k nemu. Kde čas nie je, stojí
 * tam „–:–“, aby riadok nemenil tvar. Bez zadaných panelov je namiesto textu odkaz `go`, ktorý
 * otvorí sprievodcu na kroku Panel - výzvu nemá každá karta, hlavičku vidno na všetkých. V Nastavení,
 * kde človek už je, ostáva obyčajný text.
 * @param {import('../state.js').AppState} state @returns {{ time: string, text: string, go?: boolean }}
 */
export function updatedLine(state) {
    const none = (/** @type {string} */ text) => ({ time: '–:–', text });
    if (state.known === 'nic') return none('vitaj');
    if (state.loading) return none('načítavam…');
    if (!state.pv && !state.forecast) return none('dáta nedostupné');
    if (state.known !== 'elektraren')
        return state.panel === 'nastavenie' ? none('panely nie sú zadané') : { ...none('nastav panely ›'), go: true };
    // Kto si pripojil meranie, tomu chýba; ostatní ho ani nečakajú a vidia odhad.
    const neplati = state.pv ? null : neplatiOf(state);
    if (neplati) return none(neplati.hlavicka);
    if (!state.pv) return none(state.zdroj ? 'živý výkon nedostupný' : 'odhad z predpovede');
    const { label, time, stale } = pvFreshness({ now: state.now, pv: state.pv, site: state.site });
    return { time, text: stale ? `${label} · zastarané` : label };
}

/**
 * Pás bez zadaných panelov: karty odpovedajú z typickej strechy a pás povie s čím - texty Oblohy
 * (výzva na karte Môžem? a veta pod číslom karty Teraz). @param {number} kwp výkon typickej strechy
 */
function guessBar(kwp) {
    const typical = terazTypicalText(kwp);
    return {
        nadpis: MOZEM_SKY_TEXTS.guessTitle,
        text: `${typical[0].toUpperCase()}${typical.slice(1)}.`,
        tlacidlo: MOZEM_SKY_TEXTS.guessBtn,
    };
}

/**
 * Pás pod hlavičkou na kartách Terazky a Môžem?: odhad z typickej strechy (jantárový, `odhad`),
 * alebo prístup k meraniu, ktorý výrobca prestal prijímať (shared/pristup.js, červený). Tlačidlo
 * vedie do Nastavenia; pri prístupe `data-pristup-go` povie, že tam má rozbaliť Elektráreň
 * s hlásením (web/interactions.js).
 * @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom
 */
function renderPanelsBar(state, dom) {
    const bar = barOf(state);
    dom.panelsBar.classList.toggle('hidden', !bar);
    dom.panelsBar.classList.toggle('odhad', !!bar?.odhad);
    if (!bar) return;
    dom.panelsBarTitle.textContent = bar.t.nadpis;
    dom.panelsBarText.textContent = bar.t.text;
    dom.panelsBarGo.textContent = bar.odhad ? bar.t.tlacidlo : `${bar.t.tlacidlo} →`;
    dom.panelsBarGo.toggleAttribute('data-pristup-go', !bar.odhad);
}

/**
 * Ktorý pás a s akými textami, alebo null, keď žiadny. @param {import('../state.js').AppState} state
 * @returns {{ odhad: boolean, t: { nadpis: string, text: string, tlacidlo: string } } | null}
 */
function barOf(state) {
    if (state.panel !== 'terazky' && state.panel !== 'mozem') return null;
    if (state.known === 'poloha') return { odhad: true, t: guessBar(installedKw(state.plant)) };
    const pas = state.known === 'elektraren' ? (neplatiOf(state)?.pas ?? null) : null;
    return pas ? { odhad: false, t: pas } : null;
}

/**
 * Vysvetlenie stavu merania do bubliny pod bodkou a časom - to isté jadro a texty ako v Oblohe.
 * Null, kým appka stav merania nepozná (vitaj, načítavam…, bez panelov, bez dát) - vtedy sa bodka
 * a čas neťukajú. `znova`: tlačidlo vedie na hlásenie o neplatnom prístupe v Nastavení.
 * @param {import('../state.js').AppState} state
 */
export function stavTipOf(state) {
    if (state.known !== 'elektraren' || state.loading || (!state.pv && !state.forecast)) return null;
    const stav = stavMerania(state);
    return { ...stavMeraniaText(stav), znova: stav.druh === 'znova' };
}

/** Bublina stavu merania: obsah, a či je otvorená. @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
function renderStavTip(state, dom) {
    const tip = stavTipOf(state);
    const open = state.stavTip && !!tip;
    dom.pvClock.disabled = !tip;
    dom.pvClock.setAttribute('aria-expanded', String(open));
    dom.pvTip.classList.toggle('hidden', !open);
    dom.pvTipBg.classList.toggle('hidden', !open);
    dom.pvTipTitle.textContent = tip?.nadpis ?? '';
    dom.pvTipText.textContent = tip?.text ?? '';
    dom.pvTipBtn.textContent = tip?.tlacidlo ?? '';
    dom.pvTipBtn.classList.toggle('hidden', !tip?.tlacidlo);
    dom.pvTipBtn.toggleAttribute('data-pristup-go', !!tip?.znova);
}

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
export function renderHeader(state, dom) {
    const updated = updatedLine(state);
    dom.pvTime.textContent = updated.time;
    const go = updated.go === true;
    dom.pvUpdated.textContent = go ? '' : updated.text;
    dom.pvSetupGo.textContent = go ? updated.text : '';
    dom.pvUpdated.classList.toggle('hidden', go);
    dom.pvSetupGo.classList.toggle('hidden', !go);
    renderStavTip(state, dom);
    // Pás o odhade z typickej strechy - len na kartách, ktoré z nej odpovedajú bez slova o nej. Karta
    // 7 dní to hovorí v podnadpise, Štatistika má vlastnú výzvu.
    renderPanelsBar(state, dom);
    // Kým appka nepozná polohu, nie je čo zafarbiť - a bez časového pásma ani čo rátať.
    if (state.known === 'nic') {
        dom.root.dataset.accent = '';
        dom.root.dataset.tier = '';
        return;
    }
    // Bodka je vždy o stave teraz, preto ju náhľad iného času nezaujíma. Pozadie naopak
    // sleduje aj bežca na prstenci, takže pri jeho posúvaní vidno farbu okna, na ktoré sa
    // práve pozeráš. Bez náhľadu je to ten istý model, netreba ho rátať dvakrát.
    const live = heroModel({ ...state, previewMinutes: null });
    const shown = state.previewMinutes === null ? live : heroModel(state);
    const accent = live.accent;
    // Farbu bodky (a s ňou aj podsvietenie ikony aktívnej karty v navigácii) drží data-accent
    // na <html> - mapovanie na konkrétnu farbu je v style.css pri --live-rgb.
    dom.root.dataset.accent = accent || '';
    // Pozadie drží farbu plánu dňa (tier: cena z tarify a výroba z krivky dňa), nie farbu bodky
    // (accent, tá počíta so živým výkonom) - hovorí teda to isté, čo segment pod bežcom na
    // dennom prstenci.
    dom.root.dataset.tier = shown.tier || '';
}
