// Karta Teraz novej appky: veľké číslo kW a veta pod ním, štítky a veta o teraz, Plán dňa ako veta
// a časová os (docs/navrhy/terazky-plan-dna.html, možnosť B; večer na ďalší deň, plan-dna-zajtra.html), graf dňa s pásom plánu, náhľad iného
// času a výzvy. Pás odporúčaní kreslí karta Dnes (render/mozem.js). Všetko počíta shared/teraz.js (nad heroModel a dayPlan,
// tými istými ako karta Teraz súčasnej appky) a texty sú v shared/messages.js - tu sa len
// zapisuje do DOM.

import { escapeHtml } from '../../../shared/format.js';
import { hlavickaModel, stavRiadok } from '../../../shared/hlavicka.js';
import { PLAN_DNA_TITLE, voiceTexts } from '../../../shared/messages-core.js';
import { terazModel } from '../../../shared/teraz.js';
import { dayChartHtml, legendHtml, readoutHtml } from '../../../web/day-chart.js';
import { hviezdySvg, pocasieHtml, pocasieStav } from '../../../web/pocasie.js';
import { dashboard, shows } from '../state.js';
import { setHtml, setText, show } from './write.js';

/** @typedef {import('../../../shared/teraz.js').TerazModel} Model */
/** @typedef {import('../dom.js').Dom} Dom */
/** @typedef {ReturnType<typeof voiceTexts>} Texts pevné texty v tóne appky */

/** Texty bubliny, keď riadok bublinu nemá. */
const BEZ_BUBLINY = { nadpis: '', text: '', tlacidlo: '' };

/**
 * Riadok stavu merania pod číslom (shared/hlavicka.js, stavRiadok): bodka, čas a slovo, a bublina
 * s vysvetlením, keď je otvorená. Keď karta Teraz nie je vidieť (`m` null), náhľad nie je - riadok sa
 * píše aj tak, aby hovoril o meraní, keď sa karta vráti. Tvar bodky drží data-tone na tlačidle.
 * @param {import('../state.js').AppState} state @param {Model | null} m @param {Dom} dom
 */
function renderStav(state, m, dom) {
    const r = stavRiadok(hlavickaModel(state, state.voice), m ?? { preview: false, source: '' });
    show(dom.stav, !!r);
    const { pred, slovo, tone, toneText, tip } = r ?? { pred: '', slovo: '', tone: 'off', toneText: '', tip: null };
    // Čas a slovo o stave, slovo v .stav-slovo (podčiarknuté, keď sa dá ťuknúť). Bez textu prázdny
    // prvok - :empty drží výšku riadku.
    setHtml(dom.status, `${escapeHtml(pred)}${slovo ? `<span class="stav-slovo">${escapeHtml(slovo)}</span>` : ''}`);
    setText(dom.tone, toneText);
    dom.live.dataset.tone = tone;
    dom.live.disabled = !tip;
    const open = state.stavTip && !!tip;
    dom.stav.classList.toggle('open', open);
    dom.live.setAttribute('aria-expanded', String(open));
    show(dom.tip, open);
    show(dom.tipBg, open);
    const t = tip ?? BEZ_BUBLINY;
    setText(dom.tipTitle, t.nadpis);
    setText(dom.tipText, t.text);
    setText(dom.tipBtn, t.tlacidlo);
    show(dom.tipBtn, !!t.tlacidlo);
}

/**
 * Graf, „Späť na teraz“ a zoznam pod grafom: prvý riadok legendy, po otvorení farby pásu,
 * hodnoty v čase bodu grafu a nápis.
 * @param {Model} m @param {boolean} open @param {Dom} dom @param {Texts['TERAZ_TEXTS']} TERAZ_TEXTS
 */
function renderChart(m, open, dom, TERAZ_TEXTS) {
    show(dom.tzPlot, !!m.chart);
    if (!m.chart) return;
    const c = m.chart;
    setHtml(dom.tzChart, dayChartHtml(c));
    dom.tzChart.setAttribute('aria-label', TERAZ_TEXTS.slider);
    dom.tzChart.setAttribute('aria-valuemin', String(c.range.min));
    dom.tzChart.setAttribute('aria-valuemax', String(c.range.max));
    dom.tzChart.setAttribute('aria-valuenow', String(c.value));
    dom.tzChart.setAttribute('aria-valuetext', c.valueText);
    setText(dom.tzChartDesc, c.desc);
    setHtml(dom.tzLegend, legendHtml(c.keys));
    dom.tzListBtn.setAttribute('aria-expanded', String(open));
    show(dom.tzListBody, open);
    setHtml(dom.tzBands, legendHtml(c.bands));
    setText(dom.tzWhen, c.readout.when);
    setHtml(dom.tzValues, readoutHtml(c.readout.rows));
    setText(dom.tzHint, m.hint.text);
    show(dom.tzReset, m.hint.reset);
    setText(dom.tzReset, TERAZ_TEXTS.reset);
}

/**
 * Štítok pod číslom je tlačidlo, ťuknutie otvorí jeho panel. Tlačidlo je rám s dotykovou plochou,
 * štítok v ňom vyzerá ako doteraz. Počas náhľadu iného času je vypnuté - štítok platí pre teraz.
 * Starý shared/mozem.js z cache po nasadení štítku kľúč ani panel nedáva - vtedy je štítok len
 * nápis (CLAUDE.md, Nasadenie a cache).
 * @param {import('../../../shared/mozem.js').Chip} c @param {boolean} nahlad
 */
const chipHtml = (c, nahlad) =>
    c.key && c.info
        ? `<button type="button" class="chip-btn" data-chip="${c.key}" aria-haspopup="dialog"${nahlad ? ' disabled' : ''}><span class="chip" data-tone="${c.tone}">${escapeHtml(c.text)}</span></button>`
        : `<span class="chip" data-tone="${c.tone}">${escapeHtml(c.text)}</span>`;

/** Štítky a veta o teraz pod číslom. @param {Model} m @param {Dom} dom */
function renderSay(m, dom) {
    show(dom.tzSay, !!m.say);
    // Počas náhľadu iného času sú štítky, veta aj Plán dňa bledosivé a vypnuté - platia pre teraz
    // (docs/navrhy/teraz-nahlad-neaktivne.html). Otvorený plán ostane otvorený: leží nad grafom
    // a zbalený by graf posunul spod prsta. `=== true`:
    // starý shared/teraz.js z cache po nasadení `preview` nemá a toggleAttribute s undefined by
    // značku pri každom prekreslení prepol (CLAUDE.md, Nasadenie a cache).
    const nahlad = m.preview === true;
    dom.tzSay.toggleAttribute('data-nahlad', nahlad);
    dom.tzPlan.toggleAttribute('data-nahlad', nahlad);
    dom.tzPlanBtn.disabled = nahlad;
    setHtml(dom.tzChips, m.say ? m.say.chips.map((c) => chipHtml(c, nahlad)).join('') : '');
    setText(dom.tzSayText, m.say ? m.say.text : '');
}

/**
 * Obsah panelu štítka. @param {import('../../../shared/mozem.js').Chip} chip
 * @param {Dom} dom @param {Texts['TERAZ_TEXTS']} TERAZ_TEXTS
 */
function fillChipSheet(chip, dom, TERAZ_TEXTS) {
    dom.tzChipTag.dataset.tone = chip.tone;
    setText(dom.tzChipTag, chip.text);
    setText(dom.tzChipTitle, chip.info.title);
    show(dom.tzChipNow, chip.info.now !== '');
    setText(dom.tzChipNow, chip.info.now);
    setText(dom.tzChipQ, TERAZ_TEXTS.chipWhy);
    setText(dom.tzChipWhy, chip.info.why);
    setText(dom.tzChipClose, TERAZ_TEXTS.chipClose);
}

/**
 * Štítok, ktorého panel je otvorený - null, keď nie je otvorený žiadny alebo ho karta práve nemá.
 * @param {string | null} key @param {Model | null} m @returns {import('../../../shared/mozem.js').Chip | null}
 */
const openChip = (key, m) => (key && m?.say ? (m.say.chips.find((c) => c.key === key && c.info) ?? null) : null);

/** Štítok, ktorého panel bol otvorený - po zatvorení naň vráti fokus. @type {string | null} */
let chipOpener = null;

/**
 * Panel štítka (docs/navrhy/teraz-odznaky-vysvetlenie.html): štítok, nadpis, čo platí teraz, a čo
 * štítok znamená. Otvorený je, kým je v stave
 * a karta má taký štítok - keď štítok zmizne (pásmo sa zmenilo, iná karta), panel sa zavrie.
 * @param {import('../state.js').AppState} state @param {Model | null} m @param {Dom} dom @param {Texts['TERAZ_TEXTS']} TERAZ_TEXTS
 */
function renderChipSheet(state, m, dom, TERAZ_TEXTS) {
    const chip = openChip(state.tzChip, m);
    const d = dom.tzChipSheet;
    if (chip) {
        fillChipSheet(chip, dom, TERAZ_TEXTS);
        if (!d.open) {
            d.showModal();
            chipOpener = chip.key;
        }
    } else if (d.open) {
        d.close();
        const btn = chipOpener ? dom.tzChips.querySelector(`[data-chip="${chipOpener}"]`) : null;
        if (btn instanceof HTMLElement && shows(state, 'terazky')) btn.focus();
        chipOpener = null;
    }
}

/**
 * Časová os plánu: pás každého spotrebiča, hodiny pod osou, čiara teraz (pri ďalšom dni nie je)
 * a nad osou pruh s dňom, keď je os iného dňa (`strip`).
 * @param {Pick<NonNullable<Model['plan']>['lanes'], 'lanes' | 'ticks' | 'now'>} os @param {string} strip
 */
function axisHtml({ lanes, ticks, now }, strip) {
    const rows = lanes
        .map(
            (l) =>
                `<li><span class="tl-n">${escapeHtml(l.name)}</span><span class="tl-track">` +
                `<i style="left:${l.left}%;width:${Math.max(l.width, 1)}%"></i></span></li>`,
        )
        .join('');
    const axis = ticks.map((t) => `<span style="left:${t.at}%">${t.label}</span>`).join('');
    return (
        `<div class="tl" aria-hidden="true">` +
        (strip ? `<div class="tl-strip">${escapeHtml(strip)}</div>` : '') +
        `<ul>${rows}</ul><div class="tl-axis">${axis}</div>` +
        (now === null ? '' : `<span class="tl-now" style="--at:${now}"></span>`) +
        `</div>`
    );
}

/**
 * Plán dňa ako veta a časová os: čo ide teraz, ďalšie dve veci s časom, pás každého spotrebiča
 * na dnešnom slnku s čiarou teraz a hodinami pod osou. Čo dnes na slnko nejde, je pod osou
 * ako štítok s časom. Keď dnes na slnko nejde nič, plán ukáže ďalší deň so slnkom (`plan.next`):
 * deň v nadpise a nad osou, dnešnú lacnú sieť vetou, bez čiary teraz
 * (docs/navrhy/plan-dna-zajtra.html, návrh 1). Bez plánu (bez predpovede, nič doma) nie je.
 * Zbalený ukáže len nadpis a vetu v hlavičke, zvyšok je až po otvorení
 * (docs/navrhy/teraz-plan-rozbalovaci.html).
 * @param {Model['plan']} plan @param {boolean} open @param {Dom} dom
 */
function renderPlan(plan, open, dom) {
    show(dom.tzPlan, !!plan && plan.rows.length > 0);
    dom.tzPlanBtn.setAttribute('aria-expanded', String(open));
    show(dom.tzPlanBody, open);
    if (!plan || !plan.rows.length) return setHtml(dom.tzPlanBody, '');
    const next = plan.next;
    // Dnešok a ďalší deň majú ten istý tvar: nadpis, veta, os so štítkami a pätka.
    const v = next
        ? { ...next, title: `${escapeHtml(next.title)} <span class="tl-day">${escapeHtml(next.day)}</span>` }
        : { ...plan, head: { ...plan.head, tonight: '' }, strip: '', title: escapeHtml(PLAN_DNA_TITLE) };
    const { head, lanes } = v;
    const chips = lanes.others.map((o) => `<span class="tl-chip">${escapeHtml(o.name)} · ${escapeHtml(o.value)}</span>`).join('');
    setHtml(dom.tzPlanTitle, v.title);
    setText(dom.tzPlanLead, head.lead);
    setHtml(
        dom.tzPlanBody,
        (head.tonight ? `<p class="tl-tonight">${escapeHtml(head.tonight)}</p>` : '') +
            (head.then ? `<p class="tl-then">${escapeHtml(head.then)}</p>` : '') +
            (lanes.lanes.length ? axisHtml(lanes, v.strip) : '') +
            (chips ? `<div class="tl-chips">${chips}</div>` : '') +
            `<p class="tl-note">${escapeHtml(v.note)}</p>`,
    );
}

/** Pásik pod číslom: koľko z jasnej oblohy, v noci prázdny. @param {Model['jas']} jas @param {Dom} dom */
function renderJas(jas, dom) {
    show(dom.tzJas, !!jas);
    dom.tzJas.style.setProperty('--jas', String((jas?.pct ?? 0) / 100));
    setText(dom.tzJasLabel, jas?.label ?? '');
    setText(dom.tzJasText, jas?.text ?? '');
}

/** @param {import('../state.js').AppState} state @param {Dom} dom */
export function renderTeraz(state, dom) {
    const TERAZ_TEXTS = voiceTexts(state.voice).TERAZ_TEXTS;
    if (!shows(state, 'terazky')) {
        renderStav(state, null, dom);
        renderChipSheet(state, null, dom, TERAZ_TEXTS);
        return;
    }
    const m = terazModel(
        { ...state, previewMinutes: state.terazPreview },
        { online: state.online, voice: state.voice, devices: state.doma },
    );
    renderPocasie(state, m, dom);
    renderStav(state, m, dom);
    setText(dom.tzTitle, m.title);
    show(dom.tzNum, m.num !== '');
    dom.tzNum.classList.toggle('est', m.estimate);
    setText(dom.tzNumVal, m.num);
    renderJas(m.jas, dom);
    show(dom.tzSub, m.sub !== '');
    setText(dom.tzSub, m.sub);
    show(dom.tzNote, !!m.note);
    setText(dom.tzNoteTitle, m.note?.title ?? '');
    setText(dom.tzNoteText, m.note?.text ?? '');
    show(dom.tzNoteBtn, !!m.note?.btn);
    setText(dom.tzNoteBtn, m.note?.btn ?? '');
    show(dom.tzRetry, m.retry);
    setText(dom.tzRetry, TERAZ_TEXTS.retry);
    show(dom.tzGuess, m.guess);
    setText(dom.tzGuessTitle, TERAZ_TEXTS.guessTitle);
    setText(dom.tzGuessText, TERAZ_TEXTS.guessText);
    setText(dom.tzGuessBtn, TERAZ_TEXTS.guessBtn);
    show(dom.tzAsk, m.ask);
    setText(dom.tzAskTitle, TERAZ_TEXTS.askTitle);
    setText(dom.tzAskText, TERAZ_TEXTS.askText);
    setText(dom.tzAskBtn, TERAZ_TEXTS.askBtn);
    renderSay(m, dom);
    renderChipSheet(state, m, dom, TERAZ_TEXTS);
    renderPlan(m.plan, state.tzPlanOpen, dom);
    renderChart(m, state.tzListOpen, dom, TERAZ_TEXTS);
}

/**
 * Počasie v pozadí karty (docs/navrhy/teraz-pocasie-2.html). Bez dát o počasí nie je, s vypnutou
 * živou oblohou (Nastavenie › Vzhľad) tiež - kto ju vypol, chcel pokoj. V prehľade so stĺpcami
 * nie je: vrstva siaha cez celú šírku obrazovky, nie len cez stĺpec Teraz.
 * @param {import('../state.js').AppState} state @param {Model} m @param {Dom} dom
 */
function renderPocasie(state, m, dom) {
    const p = state.liveSky && !dashboard(state) ? m.pocasie : null;
    show(dom.wx, !!p);
    if (!p) return;
    setHtml(dom.wx, pocasieHtml(p.mesiac, p.juh));
    dom.wx.dataset.wx = pocasieStav(p);
    // Sila dažďa (docs/navrhy/dazd-sily.html); staršie jadro z cache ju nepošle - kresba ukáže bežný dážď.
    if (p.dazd) dom.wx.dataset.dazd = p.dazd;
    else delete dom.wx.dataset.dazd;
    dom.wx.toggleAttribute('data-noc', p.noc);
    // Skutočné hviezdy do vlastných vrstiev, mimo HTML počasia - ich posun nereštartuje oblaky.
    // Bez nich (cez deň, alebo staršie jadro z cache po nasadení) ostanú hviezdy z CSS.
    const ma = Array.isArray(p.hviezdy);
    dom.wx.toggleAttribute('data-hviezdy', ma);
    const [a, b] = ma ? hviezdySvg(/** @type {import('../../../shared/hviezdy.js').Hviezda[]} */ (p.hviezdy)) : ['', ''];
    const vrstvy = dom.wx.querySelectorAll('.wx-stars, .wx-stars2');
    setHtml(vrstvy[0], a);
    setHtml(vrstvy[1], b);
}
