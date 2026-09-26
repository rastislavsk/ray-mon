// Karta Info: ktorá položka je rozbalená, a položka „Zdieľať appku": QR kód (knižnica z CDN, generuje sa pri prvom
// otvorení karty) a odkaz na WhatsApp. Odkaz môže niesť aj nastavenie elektrárne, takže sa
// QR kód prekreslí, keď sa zmení to, čo sa pribaľuje.

import { APP_URL } from '../../shared/config.js';
import { shareUrl } from '../../shared/settings.js';
import { changed } from '../memo.js';
import { savedSettings } from '../state.js';

/** @type {any} */
let qr = null;

/** Odkaz, ktorý sa práve zdieľa. @param {import('../state.js').AppState} state */
export function currentShareUrl(state) {
    // Ukážku nemá zmysel posielať ďalej - k odkazu sa pribaľuje len uložené nastavenie.
    const settings = state.shareSettings && !state.demo ? savedSettings(state) : null;
    return shareUrl(APP_URL, settings, state.shareKiosk);
}

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
export function renderInfo(state, dom) {
    for (const [key, el] of Object.entries(dom.infoItems)) el.open = key === state.infoOpen;
    renderZdielat(state, dom);
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
