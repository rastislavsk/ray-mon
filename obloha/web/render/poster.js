// Plagát na zdieľanie: dialóg nad kartou Štatistika alebo Môžem? a nenápadný odkaz naň na karte
// Môžem?. Čísla počíta shared/statistika.js (posterModel nad súhrnom súčasnej appky), texty sú
// v shared/messages.js - tu sa len zapisuje do DOM.

import { escapeHtml } from '../../../shared/format.js';
import { posterLinkText, voiceTexts } from '../../../shared/messages.js';
import { posterModel } from '../../../shared/statistika.js';
import { setHtml, setText, show } from './write.js';

/** @typedef {import('../dom.js').Dom} Dom */
/** @typedef {import('../state.js').AppState} AppState */

/** Stĺpce dní: výška v % najlepšieho dňa, chýbajúci deň len obrys. @param {import('../../../shared/statistika.js').PosterModel['cols']} cols */
const colsHtml = (cols) =>
    cols.map((c) => (c.h === null ? '<i class="missing"></i>' : `<i${c.best ? ' class="best"' : ''} style="height:${c.h}%"></i>`)).join('');

/** Čísla plagátu: veľké číslo a popisok pod ním. @param {import('../../../shared/statistika.js').PosterModel['tiles']} tiles */
const tilesHtml = (tiles) => tiles.map((t) => `<p><strong>${escapeHtml(t.value)}</strong>${escapeHtml(t.label)}</p>`).join('');

/** Odkiaľ sa otvorený plagát otvoril - po zatvorení sa tam vráti fokus. @type {{ panel: AppState['panel'], period: string } | null} */
let shown = null;

/** Tlačidlo, ktorým sa plagát otvoril. @param {NonNullable<typeof shown>} from @param {Dom} dom */
function opener(from, dom) {
    if (from.panel === 'mozem') return dom.mzSummary;
    return dom.stPosters.querySelector(`[data-poster="${from.period}"]`);
}

/** @param {AppState} state @param {Dom} dom */
export function renderPoster(state, dom) {
    // Odkaz na karte Môžem?: mesiac na streche, ako súhrn v súčasnej appke. Bez merania nie je.
    const link = state.panel === 'mozem' ? posterModel(state, 'mesiac', state.voice) : null;
    show(dom.mzSummary, !!link);
    setText(dom.mzSummaryText, link ? posterLinkText(link.kick, link.total) : '');

    const m = state.poster ? posterModel(state, state.poster, state.voice) : null;
    if (!m) {
        if (dom.poster.open) dom.poster.close();
        const back = shown && shown.panel === state.panel ? opener(shown, dom) : null;
        shown = null;
        if (back instanceof HTMLElement) back.focus();
        return;
    }
    setText(dom.posterTitle, m.title);
    setText(dom.posterKwh, m.kwh);
    setHtml(dom.posterCols, colsHtml(m.cols));
    setHtml(dom.posterTiles, tilesHtml(m.tiles));
    setText(dom.posterFoot, m.foot);
    show(dom.posterNote, m.note !== '');
    setText(dom.posterNote, m.note);
    const T = voiceTexts(state.voice).STATISTIKA_TEXTS;
    setText(dom.posterShare, T.posterShare);
    setText(dom.posterClose, T.posterClose);
    if (!dom.poster.open) dom.poster.showModal();
    shown = { panel: state.panel, period: m.period };
}
