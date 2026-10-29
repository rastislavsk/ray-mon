// Hlavička: RAY-MON a pod ním miesto elektrárne, vpravo bodka stavu merania a čas posledného
// merania - to isté ako Obloha (shared/hlavicka.js). Okrem toho farba plánu dňa pre pozadie celej
// stránky (vrátane náhľadu iného času).

import { installedKw } from '../../shared/config.js';
import { heroModel } from '../../shared/hero-model.js';
import { hlavickaModel } from '../../shared/hlavicka.js';
import { voiceTexts } from '../../shared/messages-core.js';
import { MOZEM_SKY_TEXTS, terazTypicalText } from '../../shared/messages.js';
import { neplatiOf } from '../../shared/pristup.js';

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
 * Hlavička: miesto, bodka a čas, bez zadaných panelov výzva namiesto nich, a bublina stavu merania.
 * @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom
 */
function renderHlavicka(state, dom) {
    const m = hlavickaModel(state);
    dom.pvPlace.textContent = m.place;
    dom.pvUpdated.textContent = m.status;
    dom.pvTone.textContent = m.toneText;
    // Tvar bodky drží data-tone na tlačidle s bodkou a časom - kreslí ho style.css pri .live-dot.
    dom.pvClock.dataset.tone = m.tone;
    dom.pvClock.classList.toggle('hidden', m.setup);
    dom.pvClock.disabled = !m.tip;
    dom.pvSetupGo.classList.toggle('hidden', !m.setup);
    dom.pvSetupGo.textContent = voiceTexts().HEADER_TEXTS.setup;
    const open = state.stavTip && !!m.tip;
    dom.pvClock.setAttribute('aria-expanded', String(open));
    dom.pvTip.classList.toggle('hidden', !open);
    dom.pvTipBg.classList.toggle('hidden', !open);
    dom.pvTipTitle.textContent = m.tip?.nadpis ?? '';
    dom.pvTipText.textContent = m.tip?.text ?? '';
    dom.pvTipBtn.textContent = m.tip?.tlacidlo ?? '';
    dom.pvTipBtn.classList.toggle('hidden', !m.tip?.tlacidlo);
    dom.pvTipBtn.toggleAttribute('data-pristup-go', !!m.tip?.znova);
}

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
export function renderHeader(state, dom) {
    renderHlavicka(state, dom);
    // Pás o odhade z typickej strechy - len na kartách, ktoré z nej odpovedajú bez slova o nej. Karta
    // 7 dní to hovorí v podnadpise, Štatistika má vlastnú výzvu.
    renderPanelsBar(state, dom);
    // Kým appka nepozná polohu, nie je čo zafarbiť - a bez časového pásma ani čo rátať.
    if (state.known === 'nic') {
        dom.root.dataset.tier = '';
        return;
    }
    // Pozadie drží farbu plánu dňa (tier: cena z tarify a výroba z krivky dňa) a sleduje aj
    // náhľad iného času - hovorí teda to isté, čo pás plánu pod zvoleným časom v grafe dňa.
    dom.root.dataset.tier = heroModel(state).tier || '';
}
