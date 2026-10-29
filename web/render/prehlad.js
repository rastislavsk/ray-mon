// Prehľad karty Nastavenie súčasnej appky: výzva dokončiť nastavenie, hlásenie o prístupe
// k meraniu, karta elektrárne a sekcie Elektráreň, Čo máš doma, Oznámenia, Vzhľad a Appka.
// Texty, riadky aj stav volieb sú z jedného modelu pre obe appky (shared/nastavenie.js) - tu je
// len to, ako ich kreslí táto appka: rozbaľovacie položky, zaškrtávacie políčka a ikonky. Voľba,
// ktorú má len táto appka (farba pozadia podľa ceny), si do sekcie Vzhľad pridáva sama.

import { APP_URL } from '../../shared/config.js';
import { dayRingModel, planesCompassModel } from '../../shared/chart-model.js';
import { escapeHtml } from '../../shared/format.js';
import { nastavenieModel } from '../../shared/nastavenie.js';
import { shareUrl } from '../../shared/settings.js';
import { scheduleTiers } from '../../shared/tariff.js';
import { SETUP_ICONS } from '../icons.js';
import { writeHtml } from '../memo.js';
import { qrPainter } from '../qr.js';
import { savedSettings } from '../state.js';
import { planesCompassSvg, tariffMiniSvg } from '../svg.js';

/** @typedef {import('../state.js').AppState} AppState */
/** @typedef {import('../dom.js').Dom} Dom */
/** @typedef {ReturnType<typeof nastavenieModel>} Model */

/** Voľba len tejto appky v sekcii Vzhľad. */
const FARBA = { label: 'Farba pozadia podľa ceny', small: 'vypni pre pokojnú čiernu' };

/** Ikonka tarify: deň ako kruh pásiem. @param {import('../../shared/config.js').Tariff} t @param {number} [i] rozvrh */
export const miniTariff = (t, i = 0) => tariffMiniSvg(dayRingModel(scheduleTiers(t, t.schedules[i])));

/** @param {HTMLElement} el @param {boolean} on */
const show = (el, on) => el.classList.toggle('hidden', !on);

/**
 * Riadky sekcie Elektráreň: ťuknutie otvorí krok sprievodcu (data-setup-edit), bez panelov
 * pokračuje v sprievodcovi (data-setup-go). Stav merania stojí dvakrát: na mobile namiesto
 * hodnoty, na desktope vpravo (viď .sum-live v style.css).
 * @param {Model['elektraren']} e @param {import('../../shared/config.js').Tariff} tariff
 */
function rowsHtml(e, tariff) {
    return e.rows
        .map((r) => {
            const icon =
                r.key === 'tarifa' ? miniTariff(tariff) : SETUP_ICONS[r.key === 'lokalita' ? 'poloha' : /** @type {'panel'} */ (r.key)];
            const go = r.start ? 'data-setup-go="start"' : `data-setup-edit="${r.edit}"`;
            const status = (/** @type {string} */ where) =>
                r.status ? `<span class="sum-live ${where} ${r.status.tone}">${escapeHtml(r.status.text)}</span>` : '';
            const extra =
                (r.extra ? `<span class="k2">${escapeHtml(r.extra)}</span>` : '') +
                (r.guess ? `<span class="est">${escapeHtml(e.guessMark)}</span>` : '') +
                status('in-line');
            return (
                `<button type="button" class="sum-row" ${go}><span class="sum-ico">${icon}</span>` +
                `<span class="t"><span class="k">${escapeHtml(r.label)}</span><span class="v">${escapeHtml(r.value)}</span>${extra}</span>` +
                `${status('at-side')}${SETUP_ICONS.chevron}</button>`
            );
        })
        .join('');
}

/** Voľba ako tlačidlo s nadpisom a podtextom. @param {string} attr @param {{ label: string, small: string }} a */
const choiceHtml = (attr, a) =>
    `<button type="button" class="choice" ${attr}><span class="t"><b>${escapeHtml(a.label)}</b><span>${escapeHtml(a.small)}</span></span>${SETUP_ICONS.chevron}</button>`;

/**
 * Riadok so zaškrtávacím políčkom alebo prepínačom, voliteľne s podtextom.
 * @param {string} attr @param {boolean} on @param {string} label @param {{ type?: 'checkbox' | 'radio', disabled?: boolean, small?: string }} [o]
 */
const check = (attr, on, label, { type = 'checkbox', disabled = false, small = '' } = {}) =>
    `<label class="check-row"><input type="${type}" ${attr}${on ? ' checked' : ''}${disabled ? ' disabled' : ''} />` +
    `<span>${escapeHtml(label)}${small ? `<small>${escapeHtml(small)}</small>` : ''}</span></label>`;

/** Hlásenie o prístupe k meraniu s tlačidlami; obsluhuje ich web/setup-wiring.js. @param {NonNullable<Model['pristup']>} p */
function pristupHtml(p) {
    const err = p.druh === 'neplati' ? ' err' : '';
    return (
        `<p class="plant-msg${err}"><b>${escapeHtml(p.nadpis)}.</b> ${escapeHtml(p.text)}</p>` +
        (p.skus ? `<p class="plant-msg err">${escapeHtml(p.skus)}</p>` : '') +
        `<button type="button" class="plant-save" data-setup-znova>${escapeHtml(p.tlacidlo)}</button>` +
        (p.druh === 'neplati' ? '<button type="button" class="link-btn" data-pristup-skus>Skúsiť znova</button>' : '')
    );
}

/** Výzva, hlásenie o prístupe, karta elektrárne a nadpis. @param {AppState} state @param {Model} m @param {Dom} dom */
function renderTop(state, m, dom) {
    dom.settingsTitle.textContent = m.title;
    show(dom.setupCta, !!m.cta);
    if (m.cta) {
        dom.setupCtaTitle.textContent = m.cta.title;
        writeHtml(dom.setupCtaSteps, m.cta.steps.map((on) => `<i${on ? ' class="on"' : ''}></i>`).join(''), 'setupCtaSteps');
        dom.setupCtaSteps.setAttribute('aria-label', m.cta.stepsLabel);
        dom.setupCtaText.textContent = m.cta.text;
        dom.setupCtaBtn.textContent = m.cta.button;
        dom.setupCtaLink.textContent = m.cta.link;
    }
    show(dom.setupPristup, !!m.pristup);
    writeHtml(dom.setupPristup, m.pristup ? pristupHtml(m.pristup) : '', 'setupPristup');
    show(dom.setupHero, !!m.hero);
    writeHtml(
        dom.setupHero,
        m.hero
            ? `<div class="hero-t"><div class="big">${m.hero.kwp}<small> kWp</small></div>` +
                  `<div class="sub">${escapeHtml(m.hero.line)}</div><div class="sub">${escapeHtml(m.hero.clear)}</div></div>` +
                  planesCompassSvg(planesCompassModel(state.plant.strings), m.hero.label)
            : '',
        'setupHero',
    );
    dom.setupNote.textContent = m.note;
}

/** Sekcia Elektráreň. @param {AppState} state @param {Model['elektraren']} e @param {Dom} dom */
function renderElektraren(state, e, dom) {
    dom.settingsPlantTitle.textContent = e.title;
    // Zbalená Elektráreň povie, že vnútri čaká hlásenie o meraní.
    dom.settingsPlantHint.textContent = e.hint;
    dom.settingsPlantHint.classList.toggle('err', e.hintErr);
    writeHtml(dom.setupRows, rowsHtml(e, savedSettings(state).tariff), 'setupRows');
    writeHtml(dom.setupWarnings, e.warnings.map((w) => `<p class="plant-msg">${escapeHtml(w)}</p>`).join(''), 'setupWarnings');
    writeHtml(
        dom.setupActions,
        (e.odkaz ? choiceHtml('data-setup-go="odkaz"', e.odkaz) : '') +
            (e.sprievodca ? choiceHtml('data-setup-restart', e.sprievodca) : ''),
        'setupActions',
    );
}

/** Sekcie Čo máš doma, Oznámenia a Vzhľad. @param {AppState} state @param {Model} m @param {Dom} dom */
function renderSekcie(state, m, dom) {
    const { doma, oznamenia: o, vzhlad: v } = m;
    dom.domaTitle.textContent = doma.title;
    dom.domaHint.textContent = doma.hint;
    writeHtml(
        dom.domaBody,
        `<div class="share-options">${doma.devices.map((d) => check(`data-doma="${d.id}"`, d.on, d.name)).join('')}</div>` +
            `<p class="oznam-note">${escapeHtml(doma.note)}</p>`,
        'domaBody',
    );
    dom.oznamTitle.textContent = o.title;
    dom.oznamHint.textContent = o.hint;
    const hours = o.hours
        .map((h) => check(`name="oznam-hour" data-oznam-hour="${h.h}"`, h.on, h.label, { type: 'radio', disabled: o.busy }))
        .join('');
    writeHtml(
        dom.oznamBody,
        `<div class="share-options">${check('data-oznam-on', o.on, o.label, { disabled: o.blocked, small: o.small })}</div>` +
            (o.stav ? `<p class="oznam-stav" role="status">${escapeHtml(o.stav)}</p>` : '') +
            `<div class="group-lbl">${escapeHtml(o.when)} · ${escapeHtml(o.whenSmall)}</div>` +
            `<div class="share-options oznam-hours" role="radiogroup" aria-label="${escapeHtml(o.when)}">${hours}</div>` +
            `<p class="oznam-note">${escapeHtml(o.uses)}</p><p class="oznam-note">${escapeHtml(o.privacy)}</p>`,
        'oznamBody',
    );
    dom.vzhladTitle.textContent = v.title;
    dom.vzhladHint.textContent = v.hint;
    const voices = v.voices.map((x) => check(`name="vzhlad-voice" data-voice="${x.id}"`, x.on, x.label, { type: 'radio' })).join('');
    writeHtml(
        dom.vzhladBody,
        `<div class="group-lbl">${escapeHtml(v.voiceLabel)}</div>` +
            `<div class="share-options oznam-hours" role="radiogroup" aria-label="${escapeHtml(v.voiceLabel)}">${voices}</div>` +
            `<p class="oznam-note">${escapeHtml(v.voiceSmall)}</p>` +
            `<div class="share-options">${check('data-farba', state.bgTint, FARBA.label, { small: FARBA.small })}</div>`,
        'vzhladBody',
    );
}

/** QR kód z knižnice; vytvorí sa pri prvom otvorení karty. */
const paintQr = qrPainter();

/** Odkaz, ktorý sa práve zdieľa. @param {AppState} state */
export function currentShareUrl(state) {
    // Typickú strechu nemá zmysel posielať ďalej - k odkazu sa pribaľuje len uložená elektráreň.
    const settings = state.shareSettings && state.known === 'elektraren' ? savedSettings(state) : null;
    return shareUrl(APP_URL, settings, state.shareKiosk);
}

/** Sekcia Appka: Zdieľať appku, Vymazať údaje a podpis. @param {AppState} state @param {Model} m @param {Dom} dom */
function renderAppka(state, m, dom) {
    const { share, clear } = m;
    dom.appItemsTitle.textContent = m.appka.title;
    dom.shareTitle.textContent = share.title;
    dom.shareHint.textContent = share.small;
    dom.shareText.textContent = share.text;
    show(dom.shareOptions, share.options);
    dom.shareWithSettings.checked = share.settingsOn;
    dom.shareWithSettingsLabel.textContent = share.settings;
    dom.shareWithKiosk.checked = share.kioskOn;
    dom.shareWithKioskLabel.textContent = share.kiosk;
    show(dom.shareKioskRow, share.kioskShown);
    dom.shareWaLabel.textContent = share.wa;
    const url = currentShareUrl(state);
    dom.shareLink.href = url;
    dom.shareLink.textContent = url;
    dom.shareWhatsapp.href = `https://wa.me/?text=${encodeURIComponent(url)}`;
    // Ak knižnica ešte nie je načítaná (pomalá sieť), skúsi sa to pri ďalšom prekreslení; zvyšok karty funguje.
    // Odkaz, ktorý sa do kódu nezmestí, ostane len ako odkaz a na tlačidle WhatsApp.
    const ok = paintQr(dom.qrcode, url);
    if (ok !== null) show(dom.qrcode, ok);
    dom.clearTitle.textContent = clear.title;
    dom.clearHint.textContent = clear.small;
    dom.clearAsk.textContent = clear.ask;
    dom.clearText.textContent = clear.text;
    dom.clearData.textContent = clear.ok;
    dom.clearCancel.textContent = clear.cancel;
    m.credit.forEach((c, i) => (dom.credits[i].textContent = c));
}

/**
 * Prehľad karty: celý z modelu a rozbalená položka zo stavu - rozbalená je najviac jedna.
 * @param {AppState} state @param {Dom} dom
 */
export function renderPrehlad(state, dom) {
    const m = nastavenieModel(state);
    renderTop(state, m, dom);
    renderElektraren(state, m.elektraren, dom);
    renderSekcie(state, m, dom);
    renderAppka(state, m, dom);
    for (const [key, el] of Object.entries(dom.infoItems)) el.open = key === state.infoOpen;
}
