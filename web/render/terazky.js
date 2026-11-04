// Karta Teraz súčasnej appky v rozložení karty Teraz z novej appky: číslo kW s riadkami pod ním, štítky a veta
// o teraz, Plán dňa ako plagát (docs/navrhy/terazky-plan-dna.html, možnosť A; večer na ďalší deň,
// plan-dna-zajtra.html), graf dňa s pásom
// plánu a náhľad iného času. Kedy bude lepšie povie karta Dnes (render/mozem.js). Všetko počíta shared/teraz.js - ten istý model ako
// v novej appke, takže obe povedia to isté - a texty sú v shared/messages-core.js. Tu sa len
// zapisuje do DOM. Farbu čísla a pozadia dáva style.css podľa data-tier (render/header.js).

import { escapeHtml } from '../../shared/format.js';
import { hlavickaModel, stavRiadok } from '../../shared/hlavicka.js';
import { PLAN_DNA_NOW, PLAN_DNA_TITLE, voiceTexts } from '../../shared/messages-core.js';
import { terazModel } from '../../shared/teraz.js';
import { dayChartHtml, legendHtml, readoutHtml } from '../day-chart.js';
import { changed, writeHtml } from '../memo.js';
import { hviezdySvg, pocasieHtml, pocasieStav } from '../pocasie.js';

/** @typedef {import('../../shared/teraz.js').TerazModel} Model */
/** @typedef {import('../dom.js').Dom} Dom */

/** Pevné texty karty v tóne appky. @param {import('../state.js').AppState} state */
const textsOf = (state) => voiceTexts(state.voice).TERAZ_TEXTS;

/** @param {HTMLElement} el @param {boolean} on */
const show = (el, on) => el.classList.toggle('hidden', !on);

/** Číslo a riadky pod ním. @param {import('../state.js').AppState} state @param {Model} m @param {Dom} dom */
function renderHead(state, m, dom) {
    // Len „Teraz“, počas náhľadu „O 12:15“ - čas a miesto ukazuje hlavička, ako v novej appke.
    dom.tzTitle.textContent = m.title;
    show(dom.tzNum, m.num !== '');
    dom.tzNum.classList.toggle('est', m.estimate);
    dom.tzNumVal.textContent = m.num;
    show(dom.tzSub, m.sub !== '');
    dom.tzSub.textContent = m.sub;
    show(dom.tzNote, !!m.note);
    dom.tzNoteTitle.textContent = m.note?.title ?? '';
    dom.tzNoteText.textContent = m.note?.text ?? '';
    show(dom.tzNoteBtn, !!m.note?.btn);
    dom.tzNoteBtn.textContent = m.note?.btn ?? '';
    dom.tzNoteBtn.toggleAttribute('data-pristup-go', !!m.note?.znova);
    show(dom.tzRetry, m.retry);
    dom.tzRetry.textContent = textsOf(state).retry;
}

/** Texty bubliny, keď riadok bublinu nemá. */
const BEZ_BUBLINY = { nadpis: '', text: '', tlacidlo: '', znova: false };

/**
 * Riadok stavu merania pod číslom (shared/hlavicka.js, stavRiadok): bodka, čas a slovo, a bublina
 * s vysvetlením, keď je otvorená. Na inej karte (`m` null) náhľad nie je - riadok sa píše aj tak, aby
 * hovoril o meraní, keď sa karta Teraz vráti. Tvar bodky drží data-tone na tlačidle (style.css).
 * @param {import('../state.js').AppState} state @param {Model | null} m @param {Dom} dom
 */
function renderStav(state, m, dom) {
    const r = stavRiadok(hlavickaModel(state, state.voice), m ?? { preview: false, source: '' });
    show(dom.tzStav, !!r);
    const { text, tone, toneText, tip } = r ?? { text: '', tone: 'off', toneText: '', tip: null };
    dom.pvUpdated.textContent = text;
    dom.pvTone.textContent = toneText;
    dom.pvClock.dataset.tone = tone;
    dom.pvClock.disabled = !tip;
    const open = state.stavTip && !!tip;
    dom.tzStav.classList.toggle('open', open);
    dom.pvClock.setAttribute('aria-expanded', String(open));
    show(dom.pvTip, open);
    show(dom.pvTipBg, open);
    const t = tip ?? BEZ_BUBLINY;
    dom.pvTipTitle.textContent = t.nadpis;
    dom.pvTipText.textContent = t.text;
    dom.pvTipBtn.textContent = t.tlacidlo;
    show(dom.pvTipBtn, !!t.tlacidlo);
    dom.pvTipBtn.toggleAttribute('data-pristup-go', t.znova);
}

/**
 * Graf, „Späť na teraz“ a zoznam pod grafom: prvý riadok legendy, po otvorení farby pásu,
 * hodnoty v čase bodu grafu a nápis. @param {Model} m @param {boolean} open @param {Dom} dom
 * @param {ReturnType<typeof textsOf>} TERAZ_TEXTS
 */
function renderChart(m, open, dom, TERAZ_TEXTS) {
    show(dom.tzPlot, !!m.chart);
    if (!m.chart) return;
    const c = m.chart;
    writeHtml(dom.tzChart, dayChartHtml(c), 'tz-chart');
    dom.tzChart.setAttribute('aria-label', TERAZ_TEXTS.slider);
    dom.tzChart.setAttribute('aria-valuemin', String(c.range.min));
    dom.tzChart.setAttribute('aria-valuemax', String(c.range.max));
    dom.tzChart.setAttribute('aria-valuenow', String(c.value));
    dom.tzChart.setAttribute('aria-valuetext', c.valueText);
    dom.tzChartDesc.textContent = c.desc;
    writeHtml(dom.tzLegend, legendHtml(c.keys), 'tz-legend');
    dom.tzListBtn.setAttribute('aria-expanded', String(open));
    show(dom.tzListBody, open);
    writeHtml(dom.tzBands, legendHtml(c.bands), 'tz-bands');
    dom.tzWhen.textContent = c.readout.when;
    writeHtml(dom.tzValues, readoutHtml(c.readout.rows), 'tz-values');
    dom.tzHint.textContent = m.hint.text;
    show(dom.tzReset, m.hint.reset);
    dom.tzReset.textContent = TERAZ_TEXTS.reset;
}

/**
 * Štítok pod číslom je tlačidlo, ťuknutie otvorí jeho panel. Tlačidlo je rám s dotykovou plochou,
 * štítok v ňom vyzerá ako doteraz. Počas náhľadu iného času je vypnuté - štítok platí pre teraz.
 * Starý shared/mozem.js z cache po nasadení štítku kľúč ani panel nedáva - vtedy je štítok len
 * nápis (CLAUDE.md, Nasadenie a cache).
 * @param {import('../../shared/mozem.js').Chip} c @param {boolean} nahlad
 */
const chipHtml = (c, nahlad) =>
    c.key && c.info
        ? `<button type="button" class="tz-chip-btn" data-chip="${c.key}" aria-haspopup="dialog"${nahlad ? ' disabled' : ''}><span class="tz-chip" data-tone="${c.tone}">${escapeHtml(c.text)}</span></button>`
        : `<span class="tz-chip" data-tone="${c.tone}">${escapeHtml(c.text)}</span>`;

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
    if (!m.say) return;
    writeHtml(dom.tzChips, m.say.chips.map((c) => chipHtml(c, nahlad)).join(''), 'tz-chips');
    dom.tzSayText.textContent = m.say.text;
}

/**
 * Obsah panelu štítka. @param {import('../../shared/mozem.js').Chip} chip
 * @param {Dom} dom @param {ReturnType<typeof textsOf>} T
 */
function fillChipSheet(chip, dom, T) {
    dom.tzChipTag.dataset.tone = chip.tone;
    dom.tzChipTag.textContent = chip.text;
    dom.tzChipTitle.textContent = chip.info.title;
    show(dom.tzChipNow, chip.info.now !== '');
    dom.tzChipNow.textContent = chip.info.now;
    dom.tzChipQ.textContent = T.chipWhy;
    dom.tzChipWhy.textContent = chip.info.why;
    dom.tzChipClose.textContent = T.chipClose;
}

/**
 * Štítok, ktorého panel je otvorený - null, keď nie je otvorený žiadny alebo ho karta práve nemá.
 * @param {string | null} key @param {Model | null} m @returns {import('../../shared/mozem.js').Chip | null}
 */
const openChip = (key, m) => (key && m?.say ? (m.say.chips.find((c) => c.key === key && c.info) ?? null) : null);

/** Štítok, ktorého panel bol otvorený - po zatvorení naň vráti fokus. @type {string | null} */
let chipOpener = null;

/**
 * Panel štítka (docs/navrhy/teraz-odznaky-vysvetlenie.html): štítok, nadpis, čo platí teraz, a čo
 * štítok znamená. Otvorený je, kým je v stave
 * a karta má taký štítok - keď štítok zmizne (pásmo sa zmenilo, iná karta), panel sa zavrie.
 * @param {import('../state.js').AppState} state @param {Model | null} m @param {Dom} dom
 */
function renderChipSheet(state, m, dom) {
    const chip = openChip(state.tzChip, m);
    const d = dom.tzChipSheet;
    if (chip) {
        fillChipSheet(chip, dom, textsOf(state));
        if (!d.open) {
            d.showModal();
            chipOpener = chip.key;
        }
    } else if (d.open) {
        d.close();
        const btn = chipOpener ? dom.tzChips.querySelector(`[data-chip="${chipOpener}"]`) : null;
        if (btn instanceof HTMLElement && state.panel === 'terazky') btn.focus();
        chipOpener = null;
    }
}

/**
 * Plán dňa ako plagát: veta, čo ide teraz, očíslované riadky (spotrebič, čas alebo „teraz“, prečo)
 * a pätka. Bez plánu (bez predpovede, nič doma) nie je. Zbalený ukáže len nadpis a vetu v hlavičke,
 * riadky a pätka sú až po otvorení (docs/navrhy/teraz-plan-rozbalovaci.html). Keď dnes na slnko
 * nejde nič, plagát je plán na ďalší deň so slnkom (`plan.next`): deň v nadpise, veta a riadky
 * o tom dni, dnešná lacná sieť jednou vetou nad riadkami (docs/navrhy/plan-dna-zajtra.html).
 * @param {Model['plan']} plan @param {boolean} open @param {Dom} dom
 */
function renderPlan(plan, open, dom) {
    show(dom.tzPlan, !!plan && plan.rows.length > 0);
    dom.tzPlanBtn.setAttribute('aria-expanded', String(open));
    show(dom.tzPlanBody, open);
    if (!plan || !plan.rows.length) return;
    const next = plan.next;
    // Dnešok a ďalší deň majú ten istý tvar: nadpis, veta, riadky a pätka.
    const v = next
        ? { ...next, title: `${escapeHtml(next.title)} <span class="tz-plan-day">${escapeHtml(next.day)}</span>` }
        : { ...plan, head: { ...plan.head, tonight: '' }, title: escapeHtml(PLAN_DNA_TITLE) };
    const rows = v.rows.map(
        (r, i) =>
            `<li data-tone="${r.tone}"><span class="tz-plan-n">${String(i + 1).padStart(2, '0')}</span>` +
            `<span class="tz-plan-what">${escapeHtml(r.name)}</span>` +
            `<span class="tz-plan-when">${r.now ? `<em>${escapeHtml(PLAN_DNA_NOW)}</em>` : escapeHtml(r.value)}</span>` +
            `<span class="tz-plan-why">${escapeHtml(r.why)}</span></li>`,
    );
    writeHtml(dom.tzPlanTitle, v.title, 'tz-plan-title');
    dom.tzPlanLead.textContent = v.head.lead;
    writeHtml(
        dom.tzPlanBody,
        (v.head.tonight ? `<p class="tz-plan-tonight">${escapeHtml(v.head.tonight)}</p>` : '') +
            `<ol class="tz-plan-rows">${rows.join('')}</ol><p class="tz-plan-note">${escapeHtml(v.note)}</p>`,
        'tz-plan',
    );
}

/**
 * Počasie v pozadí karty (docs/navrhy/teraz-pocasie-2.html). Bez dát o počasí nie je, a keď
 * človek vypne farbu pozadia (Nastavenie › Vzhľad), zmizne s ňou - chcel pokoj.
 * @param {import('../state.js').AppState} state @param {Model} m @param {Dom} dom
 */
function renderPocasie(state, m, dom) {
    const p = state.bgTint ? m.pocasie : null;
    show(dom.wx, !!p);
    if (!p) return;
    const nove = writeHtml(dom.wx, pocasieHtml(p.mesiac, p.juh), 'wx');
    dom.wx.dataset.wx = pocasieStav(p);
    // Sila dažďa (docs/navrhy/dazd-sily.html); staršie jadro z cache ju nepošle - kresba ukáže bežný dážď.
    if (p.dazd) dom.wx.dataset.dazd = p.dazd;
    else delete dom.wx.dataset.dazd;
    dom.wx.toggleAttribute('data-noc', p.noc);
    renderHviezdy(p.hviezdy, nove, dom);
}

/**
 * Skutočné hviezdy do vlastných vrstiev, mimo HTML počasia - ich posun nereštartuje oblaky.
 * Bez nich (cez deň, alebo staršie jadro z cache po nasadení) ostanú hviezdy z CSS.
 * @param {import('../../shared/hviezdy.js').Hviezda[] | null | undefined} hviezdy
 * @param {boolean} noveVrstvy HTML počasia sa práve prepísalo, vrstvy hviezd sú prázdne
 * @param {Dom} dom
 */
function renderHviezdy(hviezdy, noveVrstvy, dom) {
    const ma = Array.isArray(hviezdy);
    dom.wx.toggleAttribute('data-hviezdy', ma);
    const [a, b] = ma ? hviezdySvg(hviezdy) : ['', ''];
    if (!changed('wx-hviezdy', a + b) && !noveVrstvy) return;
    const vrstvy = dom.wx.querySelectorAll('.wx-stars, .wx-stars2');
    vrstvy[0].innerHTML = a;
    vrstvy[1].innerHTML = b;
}

/** @param {import('../state.js').AppState} state @param {Dom} dom */
export function renderTerazky(state, dom) {
    if (state.panel !== 'terazky') {
        renderStav(state, null, dom);
        renderChipSheet(state, null, dom);
        return;
    }
    const m = terazModel(state, { voice: state.voice, devices: state.doma });
    renderPocasie(state, m, dom);
    renderHead(state, m, dom);
    renderStav(state, m, dom);
    renderSay(m, dom);
    renderChipSheet(state, m, dom);
    renderPlan(m.plan, state.tzPlanOpen, dom);
    renderChart(m, state.tzListOpen, dom, textsOf(state));
}
