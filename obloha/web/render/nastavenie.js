// Karta Nastavenie novej appky: prehľad z jedného modelu pre obe appky (shared/nastavenie.js) -
// výzva dokončiť, hlásenie o prístupe, karta strechy s kompasom plôch a sekcie Elektráreň, Čo máš
// doma, Oznámenia, Vzhľad a Appka -, alebo otvorený sprievodca, a ponuka prevziať nastavenie
// z odkazu. Sprievodcu kreslí render/sprievodca.js. Okná sekcie Appka: Zdieľať appku (QR kód
// z knižnice na CDN, odkaz, WhatsApp) a potvrdenie Vymazať údaje.

import { planesCompassModel } from '../../../shared/chart-model.js';
import { OBLOHA_URL } from '../../../shared/config.js';
import { shareUrl } from '../../../shared/settings.js';
import { savedSettings } from '../../../shared/setup-flow.js';
import { escapeHtml } from '../../../shared/format.js';
import { nastavenieModel } from '../../../shared/nastavenie.js';
import { IMPORT_OFFER, importOfferText, LINK_ERRORS } from '../../../shared/setup-texts.js';
import { qrPainter } from '../../../web/qr.js';
import { planesCompassSvg } from '../../../web/svg.js';
import { renderWizard } from './sprievodca.js';
import { setHtml, setText, show } from './write.js';

/** @typedef {import('../state.js').AppState} AppState */
/** @typedef {import('../dom.js').Dom} Dom */
/** @typedef {ReturnType<typeof nastavenieModel>} Model */

/**
 * Riadky sekcie Elektráreň: každý je tlačidlo, ktoré otvorí svoj krok sprievodcu. Pod hodnotou
 * stav merania, ceny tarify a značka odhadu z „Neviem“.
 * @param {Model['elektraren']} e
 */
const rowsHtml = (e) =>
    e.rows
        .map((r) => {
            const go = r.start ? 'data-setup-go="start"' : `data-setup-edit="${r.edit}"`;
            const value = [r.value, r.status?.text, r.extra].filter(Boolean).join(' · ');
            const err = r.status?.tone === 'off' ? ' class="err"' : '';
            return (
                `<button type="button" class="it" ${go}><span><b>${escapeHtml(r.label)}</b>` +
                `<small${err}>${escapeHtml(value)}</small>${r.guess ? `<small class="est">${escapeHtml(e.guessMark)}</small>` : ''}</span>` +
                `<span aria-hidden="true">›</span></button>`
            );
        })
        .join('');

/** Voľba ako riadok s nadpisom a podtextom. @param {string} attr @param {{ label: string, small: string }} a */
const actionHtml = (attr, a) =>
    `<button type="button" class="it" ${attr}><span><b>${escapeHtml(a.label)}</b><small>${escapeHtml(a.small)}</small></span><span aria-hidden="true">›</span></button>`;

/**
 * Hlásenie o prístupe k meraniu: dôvod, „Pripojiť znova“ (či „Obnoviť prístup“) a pri odmietnutom
 * prístupe aj „Skúsiť znova“. Tlačidlá obsluhuje web/setup-wiring.js.
 * @param {NonNullable<Model['pristup']>} p
 */
function pristupHtml(p) {
    const skus = p.druh === 'neplati' ? '<button type="button" class="pbtn ghost" data-pristup-skus>Skúsiť znova</button>' : '';
    return (
        `<b class="big">${escapeHtml(p.nadpis)}</b><p>${escapeHtml(p.text)}</p>` +
        (p.skus ? `<p class="wz-msg err">${escapeHtml(p.skus)}</p>` : '') +
        `<div class="btns"><button type="button" class="pbtn" data-setup-znova>${escapeHtml(p.tlacidlo)}</button>${skus}</div>`
    );
}

/** Tlačidlá volieb (minis). @param {Array<{ attr: string, label: string, on: boolean }>} items @param {string} [off] */
const minisHtml = (items, off = '') =>
    items.map((x) => `<button type="button" class="mini" ${x.attr} aria-pressed="${x.on}"${off}>${escapeHtml(x.label)}</button>`).join('');

/** Výzva, hlásenie o prístupe, karta strechy a sekcia Elektráreň. @param {AppState} state @param {Model} m @param {Dom} dom */
function renderHome(state, m, dom) {
    setText(dom.nsTitle, m.title);
    show(dom.nsCta, !!m.cta);
    if (m.cta) {
        setText(dom.nsCtaTitle, m.cta.title);
        setHtml(dom.nsCtaSteps, m.cta.steps.map((on) => `<i${on ? ' class="on"' : ''}></i>`).join(''));
        dom.nsCtaSteps.setAttribute('aria-label', m.cta.stepsLabel);
        setText(dom.nsCtaText, m.cta.text);
        setText(dom.nsCtaBtn, m.cta.button);
        setText(dom.nsCtaLink, m.cta.link);
    }
    show(dom.nsPristup, !!m.pristup);
    if (m.pristup) {
        dom.nsPristup.dataset.druh = m.pristup.druh;
        setHtml(dom.nsPristup, pristupHtml(m.pristup));
    }
    show(dom.nsHero, !!m.hero);
    if (m.hero)
        setHtml(
            dom.nsHero,
            `<div><p class="kwp"><b>${m.hero.kwp}</b> kWp</p><p>${escapeHtml(m.hero.line)}<br>${escapeHtml(m.hero.clear)}</p></div>` +
                planesCompassSvg(planesCompassModel(state.plant.strings), m.hero.label),
        );
    show(dom.nsNote, !!m.note);
    setText(dom.nsNote, m.note);
    const e = m.elektraren;
    setText(dom.nsRowsTitle, e.title);
    setHtml(dom.nsRows, rowsHtml(e));
    setHtml(dom.nsWarn, e.warnings.map((w) => `<p class="wz-msg">${escapeHtml(w)}</p>`).join(''));
    setHtml(
        dom.nsActions,
        (e.odkaz ? actionHtml('data-setup-go="odkaz"', e.odkaz) : '') +
            (e.sprievodca ? actionHtml('data-setup-restart', e.sprievodca) : ''),
    );
}

/** Čo máš doma: spotrebiče. @param {Model} m @param {Dom} dom */
function renderDoma(m, dom) {
    setText(dom.nsDomaTitle, m.doma.title);
    setHtml(dom.nsDoma, minisHtml(m.doma.devices.map((d) => ({ attr: `data-device="${d.id}"`, label: d.name, on: d.on }))));
    setText(dom.nsDomaNote, m.doma.note);
}

/**
 * Oznámenia: ranný plán dňa a hodina. Kým sa nedajú zapnúť (iPhone v Safari, zakázané, bez
 * polohy), prepínač je vypnutý a hláška povie prečo.
 * @param {Model} m @param {Dom} dom
 */
function renderOznamenia(m, dom) {
    const o = m.oznamenia;
    setText(dom.nsOznamTitle, o.title);
    setText(dom.nsOznamLabel, o.label);
    setText(dom.nsOznamSmall, o.small);
    dom.nsOznam.setAttribute('aria-checked', String(o.on));
    dom.nsOznam.toggleAttribute('disabled', o.blocked);
    show(dom.nsOznamStav, !!o.stav);
    setText(dom.nsOznamStav, o.stav);
    setText(dom.nsOznamHourLabel, o.when);
    setText(dom.nsOznamHourSmall, o.whenSmall);
    // Kým sa zapína, nedá sa meniť nič - zmena by sa po dobehnutí prepísala.
    setHtml(
        dom.nsOznamHour,
        minisHtml(
            o.hours.map((h) => ({ attr: `data-hour="${h.h}"`, label: h.label, on: h.on })),
            o.busy ? ' disabled' : '',
        ),
    );
    setText(dom.nsOznamUses, o.uses);
    setText(dom.nsOznamNote, o.privacy);
}

/** Vzhľad: tón hlášok z modelu a živá obloha (len táto appka). @param {AppState} state @param {Model} m @param {Dom} dom */
function renderLook(state, m, dom) {
    const v = m.vzhlad;
    setText(dom.nsLookTitle, v.title);
    setText(dom.nsVoiceLabel, v.voiceLabel);
    setText(dom.nsVoiceSmall, v.voiceSmall);
    setHtml(dom.nsVoice, minisHtml(v.voices.map((x) => ({ attr: `data-voice="${x.id}"`, label: x.label, on: x.on }))));
    dom.nsLiveSky.setAttribute('aria-checked', String(state.liveSky));
}

/** Sekcia Appka: riadky okien a podpis. @param {Model} m @param {Dom} dom */
function renderAppka(m, dom) {
    setText(dom.nsAppTitle, m.appka.title);
    setText(dom.nsShareRowTitle, m.share.title);
    setText(dom.nsShareRowSmall, m.share.small);
    setText(dom.nsResetRowTitle, m.clear.title);
    setText(dom.nsResetRowSmall, m.clear.small);
    m.credit.forEach((c, i) => setText(dom.nsCredits[i], c));
}

/**
 * Odkaz, ktorý okno Zdieľať appku posiela: na novú appku, kým je testovacia verzia. Typickú strechu
 * nemá zmysel posielať ďalej - pribaľuje sa len uložená elektráreň, ako v súčasnej appke.
 * @param {AppState} state
 */
export function currentShareUrl(state) {
    const settings = state.shareSettings && state.known === 'elektraren' ? savedSettings(state) : null;
    return shareUrl(OBLOHA_URL, settings, state.shareKiosk);
}

/** QR kód z knižnice; vytvorí sa pri prvom otvorení okna. */
const paintQr = qrPainter();

/**
 * QR kód s odkazom. Kým knižnica z CDN nie je (pomalá sieť, zablokovaná) alebo keď sa odkaz do
 * kódu nezmestí, okno ukáže len odkaz.
 * @param {string} url @param {Dom} dom
 */
function renderQr(url, dom) {
    show(dom.nsQr, paintQr(dom.nsQr, url) === true);
}

/** Okno sekcie Appka, ktoré je práve otvorené - po zatvorení sa fokus vráti na jeho riadok. @type {HTMLElement | null} */
let opener = null;

/**
 * Okná sekcie Appka podľa stavu: otvorí, prekreslí a zavrie. Okno patrí karte Nastavenie.
 * @param {AppState} state @param {Model} m @param {Dom} dom
 */
function renderAppSheets(state, m, dom) {
    const sheet = state.panel === 'nastavenie' ? state.appSheet : null;
    const share = sheet === 'share';
    if (share) {
        const t = m.share;
        setText(dom.nsShareTitle, t.title);
        setText(dom.nsShareText, t.text);
        show(dom.nsShareOpts, t.options);
        dom.nsShareSettings.checked = t.settingsOn;
        setText(dom.nsShareSettingsLabel, t.settings);
        dom.nsShareKiosk.checked = t.kioskOn;
        setText(dom.nsShareKioskLabel, t.kiosk);
        show(dom.nsShareKioskRow, t.kioskShown);
        setText(dom.nsShareWa, t.wa);
        const url = currentShareUrl(state);
        dom.nsShareLink.href = url;
        setText(dom.nsShareLink, url);
        dom.nsShareWa.href = `https://wa.me/?text=${encodeURIComponent(url)}`;
        renderQr(url, dom);
    }
    if (sheet === 'reset') {
        setText(dom.nsResetTitle, m.clear.ask);
        setText(dom.nsResetText, m.clear.text);
        setText(dom.nsResetOk, m.clear.ok);
        setText(dom.nsResetCancel, m.clear.cancel);
    }
    for (const [d, on, from] of /** @type {const} */ ([
        [dom.nsShareSheet, share, dom.nsShare],
        [dom.nsResetSheet, sheet === 'reset', dom.nsReset],
    ])) {
        if (on && !d.open) {
            d.showModal();
            opener = from;
        } else if (!on && d.open) {
            d.close();
            if (opener === from && state.panel === 'nastavenie') from.focus();
            if (opener === from) opener = null;
        }
    }
}

/** Zbaliteľné sekcie: rozbalená je najviac jedna (nsOpen). @param {AppState} state @param {Dom} dom */
function renderFolds(state, dom) {
    for (const f of dom.nsFolds) {
        const open = f.key === state.nsOpen;
        f.head.setAttribute('aria-expanded', String(open));
        show(f.body, open);
    }
}

/** @param {AppState} state @param {Dom} dom */
export function renderNastavenie(state, dom) {
    const open = state.setupStep !== null;
    show(dom.nsHome, !open);
    show(dom.wizard, open);
    const m = nastavenieModel(state);
    if (open) renderWizard(state, dom);
    else {
        renderHome(state, m, dom);
        renderFolds(state, dom);
        renderDoma(m, dom);
        renderOznamenia(m, dom);
        renderLook(state, m, dom);
        renderAppka(m, dom);
    }
    renderAppSheets(state, m, dom);
}

/** Ponuka prevziať nastavenie z otvoreného odkazu - na ktorejkoľvek karte. @param {AppState} state @param {Dom} dom */
export function renderImportOffer(state, dom) {
    const s = state.incoming;
    const err = s ? null : state.linkError;
    show(dom.importOffer, !!s || !!err);
    if (!s && !err) return;
    // Odkaz, ktorý appka nevie prevziať: prečo, a len Zavrieť.
    setText(dom.importOfferTitle, err ? LINK_ERRORS[err].title : IMPORT_OFFER.title);
    setText(
        dom.importOfferText,
        err ? LINK_ERRORS[err].text : importOfferText(/** @type {import('../../../shared/settings.js').Settings} */ (s), state.known),
    );
    show(dom.importAccept, !err);
    setText(dom.importDecline, err ? IMPORT_OFFER.close : IMPORT_OFFER.decline);
}
