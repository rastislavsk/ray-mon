// Karta Nastavenie novej appky: prehľad elektrárne (výzva dokončiť, karta strechy s kompasom plôch,
// riadky ELEKTRÁREŇ) alebo otvorený sprievodca, a ponuka prevziať nastavenie z odkazu. Čísla
// a texty skladá shared/nastavenie.js, sprievodcu kreslí render/sprievodca.js.

import { planesCompassModel } from '../../../shared/chart-model.js';
import { escapeHtml } from '../../../shared/format.js';
import { nastavenieModel } from '../../../shared/nastavenie.js';
import { importOfferText } from '../../../shared/setup-texts.js';
import { planesCompassSvg } from '../../../web/svg.js';
import { renderWizard } from './sprievodca.js';
import { setHtml, setText, show } from './write.js';

/** @typedef {import('../state.js').AppState} AppState */
/** @typedef {import('../dom.js').Dom} Dom */

/** Riadky ELEKTRÁREŇ: každý je tlačidlo, ktoré otvorí svoj krok sprievodcu. @param {ReturnType<typeof nastavenieModel>['rows']} rows */
const rowsHtml = (rows) =>
    rows
        .map((r) => {
            const go = r.start ? 'data-setup-go="start"' : `data-setup-edit="${r.edit}"`;
            return (
                `<button type="button" class="it" ${go}><span><b>${escapeHtml(r.label)}</b>` +
                `<small>${escapeHtml(r.value)}</small></span><span aria-hidden="true">›</span></button>`
            );
        })
        .join('');

/** @param {AppState} state @param {Dom} dom */
function renderHome(state, dom) {
    const m = nastavenieModel(state);
    show(dom.nsCta, !!m.cta);
    if (m.cta) {
        setText(dom.nsCtaTitle, m.cta.title);
        setHtml(dom.nsCtaSteps, m.cta.steps.map((on) => `<i${on ? ' class="on"' : ''}></i>`).join(''));
        dom.nsCtaSteps.setAttribute('aria-label', m.cta.stepsLabel);
        setText(dom.nsCtaText, m.cta.text);
        setText(dom.nsCtaBtn, m.cta.button);
    }
    show(dom.nsHero, !!m.hero);
    if (m.hero)
        setHtml(
            dom.nsHero,
            `<div><p class="kwp"><b>${m.hero.kwp}</b> kWp</p><p>${escapeHtml(m.hero.line)}<br>${escapeHtml(m.hero.clear)}</p></div>` +
                planesCompassSvg(planesCompassModel(state.plant.strings), m.hero.label),
        );
    setHtml(dom.nsRows, rowsHtml(m.rows));
    setHtml(dom.nsWarn, m.warnings.map((w) => `<p class="wz-msg">${escapeHtml(w)}</p>`).join(''));
    show(dom.nsNote, !!m.note);
    setText(dom.nsNote, m.note);
}

/** @param {AppState} state @param {Dom} dom */
export function renderNastavenie(state, dom) {
    const open = state.setupStep !== null;
    show(dom.nsHome, !open);
    show(dom.wizard, open);
    if (open) renderWizard(state, dom);
    else renderHome(state, dom);
}

/** Ponuka prevziať nastavenie z otvoreného odkazu - na ktorejkoľvek karte. @param {AppState} state @param {Dom} dom */
export function renderImportOffer(state, dom) {
    const s = state.incoming;
    show(dom.importOffer, !!s);
    if (!s) return;
    setText(dom.importOfferText, importOfferText(s, state.known));
}
