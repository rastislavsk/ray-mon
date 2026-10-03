// Karta Nastavenie novej appky: prehľad elektrárne (výzva dokončiť, karta strechy s kompasom plôch,
// riadky ELEKTRÁREŇ), Vzhľad a Appka, alebo otvorený sprievodca, a ponuka prevziať nastavenie
// z odkazu. Čísla a texty skladá shared/nastavenie.js, sprievodcu kreslí render/sprievodca.js.
// Okná sekcie Appka: Zdieľať appku (QR kód z knižnice na CDN, odkaz, WhatsApp) a potvrdenie
// Nastaviť celé znova.

import { planesCompassModel } from '../../../shared/chart-model.js';
import { OBLOHA_URL } from '../../../shared/config.js';
import { shareUrl } from '../../../shared/settings.js';
import { savedSettings } from '../../../shared/setup-flow.js';
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

/** Vzhľad: živá obloha, tón hlášok a úvodná karta. @param {AppState} state @param {Dom} dom */
function renderLook(state, dom) {
    dom.nsLiveSky.setAttribute('aria-checked', String(state.liveSky));
    for (const b of dom.nsVoice.querySelectorAll('[data-voice]'))
        b.setAttribute('aria-pressed', String(b.getAttribute('data-voice') === state.voice));
    for (const b of dom.nsStart.querySelectorAll('[data-start]'))
        b.setAttribute('aria-pressed', String(b.getAttribute('data-start') === state.startPanel));
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

/** QR kód z knižnice; vytvorí sa pri prvom otvorení okna. @type {any} */
let qr = null;
/** Odkaz, ktorý QR kód práve nesie. */
let qrUrl = '';

/**
 * QR kód s odkazom. Knižnica z CDN je nepovinná: kým nie je (pomalá sieť, zablokovaná), okno ukáže
 * len odkaz a skúsi to znova pri ďalšom prekreslení.
 * @param {string} url @param {Dom} dom
 */
function renderQr(url, dom) {
    const QRCode = /** @type {any} */ (globalThis).QRCode;
    show(dom.nsQr, typeof QRCode !== 'undefined');
    if (typeof QRCode === 'undefined' || url === qrUrl) return;
    if (qr) qr.makeCode(url);
    else
        qr = new QRCode(dom.nsQr, {
            text: url,
            width: 256,
            height: 256,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H,
        });
    qrUrl = url;
}

/** Okno sekcie Appka, ktoré je práve otvorené - po zatvorení sa fokus vráti na jeho riadok. @type {HTMLElement | null} */
let opener = null;

/**
 * Okná sekcie Appka podľa stavu: otvorí, prekreslí a zavrie. Okno patrí karte Nastavenie.
 * @param {AppState} state @param {Dom} dom
 */
function renderAppSheets(state, dom) {
    const sheet = state.panel === 'nastavenie' ? state.appSheet : null;
    const share = sheet === 'share';
    if (share) {
        show(dom.nsShareOpts, state.known === 'elektraren');
        dom.nsShareSettings.checked = state.shareSettings;
        dom.nsShareKiosk.checked = state.shareKiosk;
        show(dom.nsShareKioskRow, state.shareSettings && !!state.kiosk);
        const url = currentShareUrl(state);
        dom.nsShareLink.href = url;
        setText(dom.nsShareLink, url);
        dom.nsShareWa.href = `https://wa.me/?text=${encodeURIComponent(url)}`;
        renderQr(url, dom);
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

/** @param {AppState} state @param {Dom} dom */
export function renderNastavenie(state, dom) {
    const open = state.setupStep !== null;
    show(dom.nsHome, !open);
    show(dom.wizard, open);
    if (open) renderWizard(state, dom);
    else {
        renderHome(state, dom);
        renderLook(state, dom);
    }
    renderAppSheets(state, dom);
}

/** Ponuka prevziať nastavenie z otvoreného odkazu - na ktorejkoľvek karte. @param {AppState} state @param {Dom} dom */
export function renderImportOffer(state, dom) {
    const s = state.incoming;
    show(dom.importOffer, !!s);
    if (!s) return;
    setText(dom.importOfferText, importOfferText(s, state.known));
}
