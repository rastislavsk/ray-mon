// Karta Môžem? novej appky: oblúk slnka, štítky, veľké slovo a veta, fakt v mobiloch, výzvy,
// dlaždice skupín vecí, riadok o mesiaci, hláška a panel veci či skupiny zospodu. Všetko počíta
// shared/mozem-sky.js a texty sú v shared/messages.js - tu sa len zapisuje do DOM.

import { escapeHtml, minutesToTimeStr } from '../../../shared/format.js';
import { voiceTexts } from '../../../shared/messages-core.js';
import { mozemSkyModel } from '../../../shared/mozem-sky.js';
import { shows } from '../state.js';
import { setHtml, setText, show } from './write.js';

/** @typedef {import('../../../shared/mozem-sky.js').MozemSkyModel} Model */
/** @typedef {import('../dom.js').Dom} Dom */

/**
 * Veľkosť veľkého slova v px podľa jeho dĺžky, ako v návrhu: krátke slovo najväčšie. Na úzkom
 * displeji ho štýl zmenší ešte podľa najdlhšieho slova v ňom (`--word-len`), aby sa nikdy
 * neorezalo. @param {string} word
 */
export function wordSize(word) {
    return word.length <= 7 ? 66 : word.length <= 11 ? 50 : 42;
}

// Oblúk v súradniciach návrhu: polovica elipsy nad obzorom, východ vľavo, západ vpravo.
const ARC = { cx: 160, cy: 118, rx: 140, ry: 88 };
const MOON = { x: 262, y: 42 };

/** Bod na oblúku, 0 = východ, 1 = západ. @param {number} f */
function arcPoint(f) {
    const a = Math.PI * (1 - f);
    return `${(ARC.cx + ARC.rx * Math.cos(a)).toFixed(1)} ${(ARC.cy - ARC.ry * Math.sin(a)).toFixed(1)}`;
}

/**
 * Oblúk slnka: prerušovaná dráha, zelený úsek dnešného okna, slnko na dráhe (v noci mesiac)
 * a časy východu a západu. Bez dát je slnko len sivý kruh a okno nie je.
 * @param {NonNullable<Model['arc']>} arc @param {boolean} off
 */
function arcSvg(arc, off) {
    const { cx, cy, rx, ry } = ARC;
    const win =
        arc.win && arc.win.to > arc.win.from
            ? `<path class="arc-win" d="M${arcPoint(arc.win.from)} A${rx} ${ry} 0 0 1 ${arcPoint(arc.win.to)}"/>`
            : '';
    const at = arc.sun === null ? `${MOON.x} ${MOON.y}` : arcPoint(arc.sun);
    const body = off
        ? '<circle r="12" class="arc-off"/>'
        : arc.sun === null
          ? '<circle r="11" class="arc-moon"/><circle cx="6" cy="-4" r="9" class="arc-moon-cut"/>'
          : '<circle r="24" class="arc-glow"/><circle r="13" class="arc-sun"/>';
    const label = (/** @type {number | null} */ m, /** @type {number} */ x) =>
        m === null ? '' : `<text x="${x}" y="130" class="arc-t">${minutesToTimeStr(m)}</text>`;
    return (
        `<svg viewBox="0 0 320 132"><path class="arc-path" d="M${cx - rx} ${cy} A${rx} ${ry} 0 0 1 ${cx + rx} ${cy}"/>${win}` +
        `<line x1="0" y1="${cy}" x2="320" y2="${cy}" class="arc-ground"/>${label(arc.rise, cx - rx)}${label(arc.set, cx + rx)}` +
        `<g transform="translate(${at})">${body}</g></svg>`
    );
}

/** Obrysové ikony vecí (24 × 24), kľúče sú id z MOZEM_SKY_ITEMS. @type {Record<string, string>} */
const ICONS = {
    pracka: '<rect x="4" y="3" width="16" height="18" rx="2.5"/><circle cx="12" cy="13" r="4.5"/><path d="M7 6.5h2"/>',
    umyvacka: '<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M4 8h16M8 12.5h8M8 16h8"/>',
    susicka:
        '<rect x="4" y="3" width="16" height="18" rx="2.5"/><circle cx="12" cy="13" r="4.5"/><path d="M10 12c1-1 3 1 4 0M10 14.5c1-1 3 1 4 0"/>',
    auto: '<path d="M4 16.5v-4l2.2-5h11.6l2.2 5v4z"/><path d="M4 12.5h16"/><circle cx="8" cy="16.5" r="1.8"/><circle cx="16" cy="16.5" r="1.8"/>',
    bojler: '<rect x="7" y="2.5" width="10" height="17" rx="5"/><path d="M12 8c-1.7 2.2-2.2 3.2-2.2 4.3a2.2 2.2 0 0 0 4.4 0c0-1.1-.5-2.1-2.2-4.3z"/><path d="M10 19.5v2M14 19.5v2"/>',
    hranie: '<path d="M7.5 8h9a4.5 4.5 0 0 1 4.5 4.5v1a3 3 0 0 1-5.3 1.9L14.5 14h-5l-1.2 1.4A3 3 0 0 1 3 13.5v-1A4.5 4.5 0 0 1 7.5 8z"/><path d="M8 10v3.5M6.25 11.75h3.5"/>',
    fen: '<circle cx="9" cy="9" r="5"/><circle cx="9" cy="9" r="1.6"/><path d="M14 6.5h6v5h-6M11 13.8l-1.2 6.7h3L14 12"/>',
};

/** @param {string} id */
const icon = (id) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[id] || ''}</svg>`;

/** Pás dňa v širokej dlaždici: uplynulá časť okna stlmená. Čítačke nič nehovorí. @param {NonNullable<Model['groups'][number]['bar']>} b */
function barHtml(b) {
    const end = b.left + b.width;
    const past = Math.max(0, Math.min(b.now, end) - b.left);
    const seg = (/** @type {number} */ from, /** @type {number} */ w, /** @type {string} */ cls) =>
        w > 0 ? `<i${cls} style="left:${from}%;width:${w}%"></i>` : '';
    return (
        `<div class="tile-bar" aria-hidden="true">${seg(b.left, past, ' class="past"')}${seg(b.left + past, b.width - past, '')}` +
        `<span style="left:${b.now}%"></span></div>` +
        `<div class="tile-ticks" aria-hidden="true">${b.ticks.map((t) => `<span>${t}</span>`).join('')}</div>`
    );
}

/** Dlaždice skupín: celá dlaždica je tlačidlo, ktoré otvorí panel veci či skupiny. @param {Model['groups']} groups */
function tilesHtml(groups) {
    return groups
        .map((g) => {
            const icons = g.items.map(icon).join('');
            const name = `<span class="tile-name">${escapeHtml(g.name)}</span>`;
            const value = `<b>${escapeHtml(g.value)}</b>`;
            const head = g.size === 'slim' ? `${icons}${name}` : `<span class="tile-hd">${icons}${name}</span>`;
            const note = g.note ? `<small>${escapeHtml(g.note)}</small>` : '';
            return (
                `<button type="button" class="tile" data-item="${g.key}" data-size="${g.size}" data-tone="${g.tone}" aria-haspopup="dialog">` +
                `${head}${value}${note}${g.bar ? barHtml(g.bar) : ''}</button>`
            );
        })
        .join('');
}

/** Riadky panelu skupiny: meno, krátka odpoveď, prečo a pri spotrebiči zápis. @param {Model['items']} rows */
function rowsHtml(rows) {
    return rows
        .map(
            (it) =>
                `<div class="sheet-row"><h3>${escapeHtml(it.name)}</h3>` +
                `<span class="row-t" data-tone="${it.running ? 'run' : it.tone}">${escapeHtml(it.short)}</span>` +
                `<p>${escapeHtml(it.text)}</p>` +
                (it.log
                    ? `<button type="button" class="pbtn${it.log.pressed ? ' ghost' : ''}" data-log="${it.id}" data-sun="${it.log.sun ? '1' : '0'}">` +
                      `${escapeHtml(it.log.label)}</button>`
                    : '') +
                '</div>',
        )
        .join('');
}

/** Hlavná časť karty. @param {Model} m @param {Dom} dom @param {import('../../../shared/messages.js').Voice} voice */
function renderCard(m, dom, voice) {
    const MOZEM_SKY_TEXTS = voiceTexts(voice).MOZEM_SKY_TEXTS;
    show(dom.mzArc, !!m.arc);
    if (m.arc) setHtml(dom.mzArc, arcSvg(m.arc, m.state === 'offline'));
    show(dom.mzAnswer, !m.ask);
    setHtml(dom.mzChips, m.chips.map((c) => `<span class="chip" data-tone="${c.tone}">${escapeHtml(c.text)}</span>`).join(''));
    show(dom.mzChips, m.chips.length > 0);
    setText(dom.mzWord, m.word);
    dom.mzWord.style.setProperty('--word', `${wordSize(m.word)}px`);
    dom.mzWord.style.setProperty('--word-len', String(Math.max(1, ...m.word.split(/\s+/).map((w) => w.length))));
    setText(dom.mzLead, m.lead);
    show(dom.mzPhones, !!m.phones);
    setText(dom.mzPhonesText, m.phones);
    show(dom.mzRetry, m.retry);
    setText(dom.mzRetry, MOZEM_SKY_TEXTS.retry);
    show(dom.mzGuess, !!m.guess);
    setText(dom.mzGuessTitle, MOZEM_SKY_TEXTS.guessTitle);
    setText(dom.mzGuessText, m.guess);
    setText(dom.mzGuessBtn, MOZEM_SKY_TEXTS.guessBtn);
    show(dom.mzAsk, m.ask);
    setText(dom.mzAskTitle, MOZEM_SKY_TEXTS.askTitle);
    setText(dom.mzAskText, MOZEM_SKY_TEXTS.askText);
    setText(dom.mzAskBtn, MOZEM_SKY_TEXTS.askBtn);
    show(dom.mzList, !!m.list);
    dom.mzList.classList.toggle('est', !!m.list?.estimate);
    setText(dom.mzListTitle, m.list ? m.list.title : '');
    setHtml(dom.mzItems, m.list ? tilesHtml(m.groups) : '');
    show(dom.mzCount, !!m.count);
    setText(dom.mzCount, m.count);
    show(dom.mzQuip, !!m.quip);
    setText(dom.mzQuipText, m.quip);
    setText(dom.mzQuipHint, MOZEM_SKY_TEXTS.quipHint);
}

/**
 * Ohlásenie pre čítačku (role="status"): len keď sa odpoveď zmení sama - časom alebo novým
 * meraním, napr. z POČKAJ na ÁNO. Nie každú minútu, nie pri načítaní ani pri návrate na kartu,
 * vtedy čítačka prečíta kartu aj tak. Predchádzajúcu odpoveď si pamätá prvok ohlásenia.
 * @param {Model | null} m null = karta nie je vidieť @param {Dom} dom
 */
function renderAnnounce(m, dom) {
    if (!m) {
        delete dom.mzLive.dataset.state;
        setText(dom.mzLive, '');
        return;
    }
    if (m.state === 'loading' || m.ask) return;
    const before = dom.mzLive.dataset.state;
    dom.mzLive.dataset.state = m.state;
    if (before && before !== m.state) setText(dom.mzLive, `${m.word}. ${m.lead}`);
}

/** Dlaždica, ktorej panel je práve otvorený - po zatvorení sa fokus vráti na ňu. @type {string | null} */
let shown = null;

/**
 * Čo je v paneli: vec (ťuknutie na dlaždicu s jednou vecou) alebo skupina so zoznamom vecí.
 * @typedef {{ key: string, item: Model['items'][number] } | { key: string, group: NonNullable<Model['groups'][number]['sheet']> }} Open
 */

/**
 * Panel veci či skupiny: texty a otvorenie či zatvorenie dialógu podľa stavu. Po zatvorení
 * (krížik, Escape, Späť) sa fokus vráti na dlaždicu, z ktorej sa panel otvoril.
 * @param {Open | null} open @param {Dom} dom @param {import('../../../shared/messages.js').Voice} [voice]
 */
function renderSheet(open, dom, voice) {
    const MOZEM_SKY_TEXTS = voiceTexts(voice).MOZEM_SKY_TEXTS;
    if (!open) {
        if (dom.mzSheet.open) dom.mzSheet.close();
        const tile = shown && dom.mzItems.querySelector(`[data-item="${shown}"]`);
        shown = null;
        if (tile instanceof HTMLElement) tile.focus();
        return;
    }
    dom.mzSheetX.setAttribute('aria-label', MOZEM_SKY_TEXTS.close);
    const group = 'group' in open ? open.group : null;
    show(dom.mzSheetLead, !!group?.lead);
    show(dom.mzSheetRows, !!group);
    for (const el of [dom.mzSheetDoQ, dom.mzSheetDo, dom.mzSheetWhyQ, dom.mzSheetWhy]) show(el, !group);
    if ('item' in open) itemSheet(open.item, dom, MOZEM_SKY_TEXTS);
    else groupSheet(open.group, dom);
    if (!dom.mzSheet.open) dom.mzSheet.showModal();
    shown = open.key;
}

/** Panel skupiny: nadpis, veta o slnku a veci skupiny. @param {NonNullable<Model['groups'][number]['sheet']>} group @param {Dom} dom */
function groupSheet(group, dom) {
    setText(dom.mzSheetTitle, group.title);
    setText(dom.mzSheetLead, group.lead);
    setHtml(dom.mzSheetRows, rowsHtml(group.rows));
    show(dom.mzSheetMoreQ, false);
    show(dom.mzSheetMore, false);
    show(dom.mzSheetLog, false);
}

/**
 * Panel veci: čo robiť, prečo, otázka s odpoveďou a zápis.
 * @param {Model['items'][number]} it @param {Dom} dom @param {ReturnType<typeof voiceTexts>['MOZEM_SKY_TEXTS']} T
 */
function itemSheet(it, dom, T) {
    setText(dom.mzSheetTitle, it.title);
    setHtml(dom.mzSheetRows, '');
    setText(dom.mzSheetDoQ, T.sheetDo);
    setText(dom.mzSheetDo, it.head);
    setText(dom.mzSheetWhyQ, T.sheetWhy);
    setText(dom.mzSheetWhy, it.text);
    show(dom.mzSheetMoreQ, !!it.more);
    show(dom.mzSheetMore, !!it.more);
    setText(dom.mzSheetMoreQ, it.more ? it.more.q : '');
    setText(dom.mzSheetMore, it.more ? it.more.a : '');
    show(dom.mzSheetLog, !!it.log);
    if (!it.log) return;
    setText(dom.mzSheetLog, it.log.label);
    dom.mzSheetLog.classList.toggle('ghost', it.log.pressed);
    dom.mzSheetLog.dataset.log = it.id;
    dom.mzSheetLog.dataset.sun = it.log.sun ? '1' : '0';
}

/**
 * Panel, ktorý stav otvára: vec podľa id, alebo skupina podľa id. Iné id (napr. zo starého
 * odkazu v histórii) nič neotvorí.
 * @param {Model} m @param {string | null} key @returns {Open | null}
 */
function openOf(m, key) {
    if (!key) return null;
    const group = m.groups.find((g) => g.key === key && g.sheet);
    if (group?.sheet) return { key, group: group.sheet };
    const item = m.items.find((it) => it.id === key);
    return item ? { key, item } : null;
}

/** @param {import('../state.js').AppState} state @param {Dom} dom */
export function renderMozem(state, dom) {
    // Panel veci patrí karte Môžem?; keď nie je na obrazovke, je vždy zatvorený.
    if (!shows(state, 'mozem')) {
        renderAnnounce(null, dom);
        return renderSheet(null, dom);
    }
    const m = mozemSkyModel(state, { quip: state.mozemQuip, launches: state.launches, online: state.online, voice: state.voice });
    renderCard(m, dom, state.voice);
    renderAnnounce(m, dom);
    renderSheet(openOf(m, state.mozemItem), dom, state.voice);
}
