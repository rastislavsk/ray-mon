// Hlavička: stavová bodka (cena × výkon) s časom poslednej aktualizácie dát, pod ním čo ten
// čas znamená, a farba plánu dňa pre pozadie celej stránky (vrátane náhľadu iného času).

import { heroModel, pvFreshness } from '../../shared/hero-model.js';
import { neplatiOf } from '../../shared/pristup.js';
import { powerState } from '../state.js';

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

/** Pás pod hlavičkou bez zadaných panelov - texty z index.html, render ich vracia po hlásení o prístupe. */
const PANELS_BAR = { nadpis: 'Chýbajú panely', text: 'Bez nich nepoznám výkon.', tlacidlo: 'Nastaviť' };

/**
 * Pás pod hlavičkou na kartách Terazky a Môžem?: chýbajúce panely, alebo prístup k meraniu, ktorý
 * výrobca prestal prijímať (shared/pristup.js). Tlačidlo vedie do Nastavenia; pri prístupe
 * `data-pristup-go` povie, že tam má rozbaliť Elektráreň s hlásením (web/interactions.js).
 * @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom
 */
function renderPanelsBar(state, dom) {
    const onCard = state.panel === 'terazky' || state.panel === 'mozem';
    const grey = state.known === 'poloha' && onCard;
    const pas = !grey && onCard && state.known === 'elektraren' ? (neplatiOf(state)?.pas ?? null) : null;
    dom.panelsBar.classList.toggle('hidden', !grey && !pas);
    const t = pas ?? PANELS_BAR;
    dom.panelsBarTitle.textContent = t.nadpis;
    dom.panelsBarText.textContent = t.text;
    dom.panelsBarGo.textContent = `${t.tlacidlo} →`;
    dom.panelsBarGo.toggleAttribute('data-pristup-go', !!pas);
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
    // Výzva bez zadaných panelov - len na kartách, ktoré bez nich nevedia odpovedať. Karta 7 dní
    // ukazuje predpoveď pre typickú strechu (hovorí to v podnadpise), Štatistika má vlastnú výzvu.
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
    const power = powerState(state);
    const live = heroModel({ ...power, previewMinutes: null });
    const shown = power.previewMinutes === null ? live : heroModel(power);
    const accent = live.accent;
    // Farbu bodky (a s ňou aj podsvietenie ikony aktívnej karty v navigácii) drží data-accent
    // na <html> - mapovanie na konkrétnu farbu je v style.css pri --live-rgb.
    dom.root.dataset.accent = accent || '';
    // Pozadie drží farbu plánu dňa (tier: cena z tarify a výroba z krivky dňa), nie farbu bodky
    // (accent, tá počíta so živým výkonom) - hovorí teda to isté, čo segment pod bežcom na
    // dennom prstenci.
    dom.root.dataset.tier = shown.tier || '';
}
