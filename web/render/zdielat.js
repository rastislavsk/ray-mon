// Sekcia Appka v karte Nastavenie (kedysi karta Info): ktorá položka je rozbalená, a položka „Zdieľať appku": QR kód (knižnica z CDN, generuje sa pri prvom
// otvorení karty) a odkaz na WhatsApp. Odkaz môže niesť aj nastavenie elektrárne, takže sa
// QR kód prekreslí, keď sa zmení to, čo sa pribaľuje.

import { APP_URL } from '../../shared/config.js';
import { shareUrl } from '../../shared/settings.js';
import { changed, writeHtml } from '../memo.js';
import { savedSettings } from '../state.js';

/** @type {any} */
let qr = null;

/** Odkaz, ktorý sa práve zdieľa. @param {import('../state.js').AppState} state */
export function currentShareUrl(state) {
    // Typickú strechu nemá zmysel posielať ďalej - k odkazu sa pribaľuje len uložená elektráreň.
    const settings = state.shareSettings && !state.demo ? savedSettings(state) : null;
    return shareUrl(APP_URL, settings, state.shareKiosk, state.shareStart ? 'mozem' : undefined);
}

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
export function renderInfo(state, dom) {
    for (const [key, el] of Object.entries(dom.infoItems)) el.open = key === state.infoOpen;
    renderStartPick(state, dom);
    renderZdielat(state, dom);
}

/** Voľby prvej karty: čo sa na tomto telefóne otvorí po spustení. */
const START_CHOICES = [
    { panel: 'mozem', title: 'Otvárať kartu Môžem?', text: 'Jednoduché odpovede pre celú rodinu: môžem zapnúť práčku, kedy nabiť auto.' },
    { panel: 'terazky', title: 'Otvárať kartu Terazky', text: 'Ciferník s výkonom, tarifou a podrobnosťami.' },
];

/**
 * Položka „Úvodná karta“ v sekcii Appka (voľba karty, na ktorej sa appka na tomto telefóne
 * otvára) a zaškrtávatko „pre rodinu“ pri zdieľaní.
 * @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom
 */
function renderStartPick(state, dom) {
    const buttons = START_CHOICES.map(
        (c) =>
            `<button type="button" class="choice" data-start-panel="${c.panel}" aria-pressed="${c.panel === state.startPanel}">` +
            `<span class="dot"></span><span class="t"><b>${c.title}</b><span>${c.text}</span></span></button>`,
    ).join('');
    writeHtml(
        dom.startPick,
        `<div class="start-choices" role="group" aria-label="Karta, na ktorej sa appka otvára">${buttons}</div>`,
        'startPick',
    );
    dom.shareStart.checked = state.shareStart;
}

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
function renderZdielat(state, dom) {
    dom.shareOptions.classList.toggle('hidden', state.demo);
    dom.shareWithSettings.checked = state.shareSettings;
    dom.shareWithKiosk.checked = state.shareKiosk;
    dom.shareKioskRow.classList.toggle('hidden', !state.shareSettings || !state.kiosk);

    const url = currentShareUrl(state);
    dom.shareWhatsapp.href = `https://wa.me/?text=${encodeURIComponent(url)}`;
    // Ak knižnica ešte nie je načítaná (pomalá sieť), skúsi sa to pri ďalšom prekreslení; zvyšok karty funguje.
    const QRCode = /** @type {any} */ (globalThis).QRCode;
    if (typeof QRCode === 'undefined') return;
    if (!qr) {
        qr = new QRCode(dom.qrcode, {
            text: url,
            width: 256,
            height: 256,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H,
        });
        changed('qrUrl', url);
    } else if (changed('qrUrl', url)) qr.makeCode(url);
}
