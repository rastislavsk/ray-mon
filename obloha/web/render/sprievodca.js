// Sprievodca nastavením v novej appke: tie isté kroky, otázky a kontroly ako v súčasnej appke
// (texty shared/setup-texts.js, logika shared/setup-flow.js), len vo vzhľade oblohy. Obrazovky
// sú v index.html, render ukáže jednu a doplní ju. Hodnoty polí prepíše len pri zmene
// settingsRev, plochy alebo obrazovky - inak by prepisoval to, čo človek práve píše.

import { compassModel, dayRingModel, panelGridModel, planesCompassModel, tariffRingModel, tiltModel } from '../../../shared/chart-model.js';
import {
    ALL_MONTHS,
    CURRENCIES,
    LEVEL_TIER,
    PLANT,
    PRICE_LEVELS,
    SETTINGS_LIMITS,
    SETUP,
    TARIFF_LIMITS,
    TARIFF_TEMPLATES,
} from '../../../shared/config.js';
import { escapeHtml, hoursText, kwpText, minutesToTimeStr } from '../../../shared/format.js';
import { kioskApiUrl } from '../../../shared/kiosk.js';
import { editTabs } from '../../../shared/nastavenie.js';
import { checkSettings, settingsFromLink } from '../../../shared/settings.js';
import { SETUP_SECTIONS, TARIFF_STEPS } from '../../../shared/setup.js';
import { brushOf, schedIndex, setupDraft, setupReady } from '../../../shared/setup-flow.js';
import * as T from '../../../shared/setup-texts.js';
import { orientationShare } from '../../../shared/solar.js';
import {
    bandById,
    checkTariff,
    isSeasonSchedule,
    isWeekendSchedule,
    scheduleRuns,
    scheduleTiers,
    tariffKind,
} from '../../../shared/tariff.js';
import {
    compassSvg,
    miniCompassSvg,
    panelGridSvg,
    panelLabelSvg,
    planesCompassSvg,
    tariffMiniSvg,
    tariffRingSvg,
    tiltSvg,
} from '../../../web/svg.js';
import { setHtml, setText, show } from './write.js';

/** @typedef {import('../state.js').AppState} AppState */
/** @typedef {import('../dom.js').Dom} Dom */
/** @typedef {import('../../../shared/settings.js').Settings} Settings */
/** @typedef {import('../../../shared/setup.js').SetupStep} SetupStep */
/** @typedef {import('../../../shared/config.js').Tariff} Tariff */
/** @typedef {{ text: string, err?: boolean, ok?: boolean }} Msg */

/** Hlásenie pod poľom. @param {Msg | null} m */
const msgHtml = (m) => (m ? `<p class="wz-msg${m.err ? ' err' : m.ok ? ' ok' : ''}">${escapeHtml(m.text)}</p>` : '');

/** Voľba s nadpisom a popisom. @param {string} attrs @param {string} title @param {string} sub @param {boolean} on @param {string} [extra] */
const optHtml = (attrs, title, sub, on, extra = '') =>
    `<button type="button" class="opt" ${attrs} aria-pressed="${on}"><b>${escapeHtml(title)}</b><span>${escapeHtml(sub)}</span>${extra}</button>`;

/** Malý prstenec rozvrhu. @param {Tariff} t @param {number} [i] */
const miniTariff = (t, i = 0) => tariffMiniSvg(dayRingModel(scheduleTiers(t, t.schedules[i])));

/** Posledné kľúče polí: hodnoty sa zapíšu, len keď sa zmenia. */
const last = { fields: '', tariff: '' };

// ---- Prehľad pred uložením a obrazovky polohy, panelov a plôch ------------------------

/** Zhrnutie: karta strechy a riadky, ťuknutie na riadok ho opraví. @param {AppState} state @param {Settings} draft */
function summaryHtml(state, draft) {
    const h = T.plantHero(draft, state.now);
    const hero = h
        ? `<div class="glass plant"><div><p class="kwp"><b>${kwpText(h.kwp).replace(' kWp', '')}</b> kWp</p>` +
          `<p>${h.panels} panelov · menič ${h.ac}<br>dnes za jasnej oblohy približne ${h.clearKwh} kWh</p></div>` +
          `${planesCompassSvg(planesCompassModel(draft.plant.strings), `Plochy panelov: ${h.planes}`)}</div>`
        : '<div class="glass plant"><p class="kwp"><b>–</b> kWp</p></div>';
    const rows = T.summaryRows(draft, state)
        .map((r) => {
            const icon = r.az !== null ? miniCompassSvg(r.az) : r.key === 'tarifa' ? miniTariff(draft.tariff) : '';
            const extra =
                (r.extra ? `<small>${escapeHtml(r.extra)}</small>` : '') + (r.guess ? `<small class="est">${T.GUESS_MARK}</small>` : '');
            return (
                `<button type="button" class="it" data-setup-edit="${r.key}">${icon}<span><b>${escapeHtml(r.label)}</b>` +
                `<small>${escapeHtml(r.value)}</small>${extra}</span><span aria-hidden="true">›</span></button>`
            );
        })
        .join('');
    const derived = T.derivedNote(state, draft);
    const { errors, warnings } = checkSettings(draft);
    const msgs = derived?.err
        ? msgHtml(derived)
        : errors.map((e) => msgHtml({ text: e, err: true })).join('') + warnings.map((w) => msgHtml({ text: w })).join('');
    return `${hero}<div class="glass set">${rows}</div>${msgs}`;
}

/** @param {AppState} state @param {Dom} dom */
function renderOdkaz(state, dom) {
    const found = settingsFromLink(state.setupLink);
    show(dom.wzLinkNote, !!state.setupLink.trim() && !found);
    show(dom.wzLinkPreview, !!found);
    if (!found) return;
    const p = T.linkPreview(found);
    setHtml(dom.wzLinkPreview, `<small>V odkaze je</small><p><b>${escapeHtml(p.name)}</b> · ${p.kwp}</p><p>${escapeHtml(p.meta)}</p>`);
}

/** @param {AppState} state @param {Settings} draft @param {Dom} dom */
function renderLokalita(state, draft, dom) {
    const note = T.geoNote(state.geo);
    const list = state.geo.status === 'done' && !note;
    setHtml(
        dom.wzGeo,
        note
            ? `<p class="wz-line">${note}</p>`
            : list
              ? `<ul class="glass geo-list">${state.geo.results
                    .map(
                        (r, i) =>
                            `<li><button type="button" class="geo-pick" data-geo="${i}"><b>${escapeHtml(r.site.name)}</b><small>${escapeHtml(r.detail)}</small></button></li>`,
                    )
                    .join('')}</ul>`
              : '',
    );
    const c = T.placeCard(draft, state.now);
    setHtml(
        dom.wzPlaceCard,
        c
            ? `<div class="glass place"><p><b>${escapeHtml(c.name)}</b> · ${c.date}</p>` +
                  `<p class="sunline"><span>${c.rise}<small>východ</small></span>` +
                  `<svg viewBox="0 0 120 38" aria-hidden="true"><line class="ground" x1="2" y1="34" x2="118" y2="34"/><path class="arc" d="M 4 34 Q 60 -18 116 34"/><circle class="sun" cx="60" cy="9" r="5"/></svg>` +
                  `<span>${c.set}<small>západ</small></span></p><p class="meta">${escapeHtml(c.meta)}</p></div>`
            : '',
    );
    show(dom.wzWelcome, state.known === 'nic');
    // Odložiť panely sa dá, až keď je poloha vybraná - bez nej nie je čo ukázať.
    show(dom.wzLater, setupReady(state));
}

/** Tlačidlá s bežnými hodnotami, „Iný“ a „Neviem“. @param {number[]} choices @param {number} value @param {string} pick @param {string} attr @param {string} unit */
function pillsHtml(choices, value, pick, attr, unit) {
    const pill = (/** @type {string} */ v, /** @type {string} */ label, /** @type {boolean} */ on) =>
        `<button type="button" class="pill" data-${attr}="${v}" aria-pressed="${on}">${label}</button>`;
    return (
        choices.map((c) => pill(String(c), `${T.fieldText(c)} ${unit}`, pick === 'chip' && value === c)).join('') +
        pill('other', 'Iný', pick === 'other') +
        pill('guess', 'Neviem', pick === 'guess')
    );
}

/** @param {AppState} state @param {Dom} dom */
function renderPanel(state, dom) {
    const kwpMode = state.setupKwp !== null;
    dom.wzWpModePanel.setAttribute('aria-pressed', String(!kwpMode));
    dom.wzWpModeKwp.setAttribute('aria-pressed', String(kwpMode));
    show(dom.wzWpPanel, !kwpMode);
    show(dom.wzWpTotal, kwpMode);
    const wp = state.settingsDraft.plant.panelWp;
    const pick = T.effectivePick(state.setupPick.wp, wp, SETUP.panelWpChoices);
    setHtml(dom.wzWpLabel, panelLabelSvg(Number.isFinite(wp) ? String(wp) : '···'));
    setHtml(dom.wzWpChips, pillsHtml(SETUP.panelWpChoices, wp, pick, 'setup-wp', 'Wp'));
    show(dom.wzWpOther, pick === 'other');
    show(dom.wzWpGuess, pick === 'guess');
    setText(dom.wzWpGuess, T.WP_GUESS);
}

/** Pás „koľko energie to dá oproti najlepšiemu“. @param {Settings} draft @param {number} roof @param {string} what */
function qualityHtml(draft, roof, what) {
    if (!T.hasSite(draft)) return '';
    const q = T.quality(orientationShare(draft.site, draft.plant.strings[roof], PLANT.albedo));
    return (
        `<div class="glass quality"><p><b>${q.label}</b><span>~${q.pct} % najlepšieho ${what}</span></p>` +
        `<div class="bar" aria-hidden="true"><i class="tier-${q.tier}" style="width:${q.pct}%"></i></div></div>`
    );
}

/** @param {Settings} draft @param {number} roof @param {Dom} dom */
function renderSmer(draft, roof, dom) {
    const az = draft.plant.strings[roof].azimuthDeg;
    const m = compassModel(az, draft.site.lat < 0);
    const buttons = m.sectors
        .map((s) => {
            const d = T.DIRS.find((x) => x.az === s.az) || T.DIRS[0];
            return (
                `<button type="button" role="radio" class="dir-btn${s.on ? ' on' : ''}" style="left:${s.button.left.toFixed(2)}%;top:${s.button.top.toFixed(2)}%" ` +
                `aria-checked="${s.on}" tabindex="${s.on ? 0 : -1}" aria-label="${d.name}" data-setup-az="${s.az}">${d.short}</button>`
            );
        })
        .join('');
    setHtml(dom.wzCompass, `<div class="dir-dial" role="radiogroup" aria-label="Smer plochy">${compassSvg(m)}${buttons}</div>`);
    setText(dom.wzDirName, T.dirName(az));
    setText(dom.wzDirDeg, `${az}°`);
    setHtml(dom.wzDirQuality, qualityHtml(draft, roof, 'smeru'));
}

/** @param {Settings} draft @param {number} roof @param {Dom} dom */
function renderSklon(draft, roof, dom) {
    const tilt = draft.plant.strings[roof].tiltDeg;
    setHtml(dom.wzTiltArt, tiltSvg(tiltModel(tilt), tilt));
    setHtml(
        dom.wzTiltPresets,
        T.TILT_PRESETS.map(
            (p) =>
                `<button type="button" class="pill col" data-setup-tilt="${p.deg}" aria-pressed="${tilt === p.deg}"><b>${p.name}</b><small>${p.sub}</small></button>`,
        ).join(''),
    );
    setText(dom.wzTiltOut, `${tilt}°`);
    setHtml(dom.wzTiltQuality, qualityHtml(draft, roof, 'sklonu a smeru'));
}

/** @param {AppState} state @param {Settings} draft @param {number} roof @param {Dom} dom */
function renderPocet(state, draft, roof, dom) {
    setHtml(dom.wzPanelGrid, panelGridSvg(panelGridModel(draft.plant.strings[roof].panels)));
    const line = T.panelsLine(state, draft, roof);
    setHtml(dom.wzPanelsKwp, `${escapeHtml(line.text)}${line.strong ? `<b>${line.strong}</b>` : ''}`);
}

/** @param {AppState} state @param {Settings} draft @param {Dom} dom */
function renderDalsia(state, draft, dom) {
    const many = draft.plant.strings.length > 1;
    setHtml(
        dom.wzRoofs,
        T.roofRows(draft)
            .map(
                (r, i) =>
                    `<div class="wz-row">${miniCompassSvg(r.az)}<p><b>${r.title}</b><small>${r.sub}</small></p>` +
                    `<button type="button" class="mini" data-setup-roof-edit="${i}">Upraviť</button>` +
                    (many ? `<button type="button" class="mini" data-setup-roof-del="${i}">Odstrániť</button>` : '') +
                    `</div>`,
            )
            .join(''),
    );
    show(dom.wzRoofAdd, draft.plant.strings.length < SETTINGS_LIMITS.maxStrings);
    setHtml(dom.wzDerived, msgHtml(T.derivedNote(state, draft)));
}

/** @param {AppState} state @param {Settings} draft @param {Dom} dom */
function renderMenic(state, draft, dom) {
    const ac = state.settingsDraft.plant.acLimitKw;
    const m = T.menicModel(draft, ac);
    const bar = (/** @type {string} */ label, /** @type {{ share: number, text: string }} */ v, /** @type {string} */ cls) =>
        `<p class="cb"><span>${label}</span><span class="bar" aria-hidden="true"><i class="${cls}" style="width:${(v.share * 100).toFixed(1)}%"></i></span><b>${v.text}</b></p>`;
    setHtml(dom.wzAcBars, bar('Panely', m.pv, 'pv') + bar('Menič', m.ac, 'ac') + msgHtml(m.note));
    const pick = T.effectivePick(state.setupPick.ac, ac, SETUP.acChoices);
    setHtml(dom.wzAcChips, pillsHtml(SETUP.acChoices, ac, pick, 'setup-ac', 'kW'));
    show(dom.wzAcOther, pick === 'other');
    show(dom.wzAcGuess, pick === 'guess');
    setText(dom.wzAcGuess, T.AC_GUESS);
}

/** @param {AppState} state @param {Dom} dom */
function renderMeranie(state, dom) {
    dom.wzLiveYes.setAttribute('aria-pressed', String(state.setupLive));
    dom.wzLiveNo.setAttribute('aria-pressed', String(!state.setupLive));
    show(dom.wzKioskBlock, state.setupLive);
    const kiosk = state.settingsDraft.kiosk;
    const note = T.kioskNote(kiosk, !!kioskApiUrl(kiosk));
    dom.wzKioskNote.classList.toggle('err', !!note?.err);
    show(dom.wzKioskNote, !!note);
    if (note) setText(dom.wzKioskNote, note.text);
}

// ---- Tarifa ---------------------------------------------------------------------------

/** @param {AppState} state @param {Settings} draft @param {Dom} dom */
function renderTarifa(state, draft, dom) {
    const kind = tariffKind(draft.tariff);
    const icon = (/** @type {string} */ k) =>
        k === 'spot' ? '' : miniTariff(k === kind ? draft.tariff : TARIFF_TEMPLATES[/** @type {'jedna' | 'dvoj' | 'viac'} */ (k)]);
    setHtml(
        dom.wzTariffKinds,
        T.TARIFF_KINDS.map(
            (c) =>
                `<button type="button" class="opt ico" data-setup-kind="${c.kind}" aria-pressed="${c.kind === kind}"${c.kind === 'spot' ? ' disabled' : ''}>` +
                `<b>${c.title}</b><span>${c.sub}</span>${icon(c.kind)}</button>`,
        ).join(''),
    );
    show(dom.wzTariffDunno, state.setupDunno);
    setText(dom.wzTariffDunno, T.TARIFF_DUNNO_PLAN);
}

/** Farebná značka pásma: modrá lacná, červená drahá sieť. @param {import('../../../shared/config.js').PriceLevel} level */
const sw = (level) => `<i class="sw ${LEVEL_TIER[level]}"></i>`;

/** @param {Settings} draft @param {Dom} dom @param {boolean} refill */
function renderPasma(draft, dom, refill) {
    const t = draft.tariff;
    const rows = t.bands
        .map(
            (b, i) =>
                `<div class="glass band"><div class="band-top">${sw(b.level)}` +
                `<input class="fld" type="text" maxlength="${TARIFF_LIMITS.nameMax}" autocomplete="off" aria-label="Meno pásma ${i + 1}" data-setup-band-name="${b.id}" />` +
                (t.bands.length > 3 ? `<button type="button" class="mini" data-setup-band-del="${b.id}">Odstrániť</button>` : '') +
                `</div><div class="seg" role="group" aria-label="Úroveň pásma ${i + 1}">` +
                PRICE_LEVELS.map(
                    (l) =>
                        `<button type="button" data-setup-band="${b.id}" data-setup-level="${l}" aria-pressed="${b.level === l}">${T.LEVELS[l].name}</button>`,
                ).join('') +
                `</div></div>`,
        )
        .join('');
    if (setHtml(dom.wzBands, rows) || refill)
        for (const input of dom.wzBands.querySelectorAll('input[data-setup-band-name]')) {
            const el = /** @type {HTMLInputElement} */ (input);
            el.value = bandById(t, el.dataset.setupBandName || '').name;
        }
    show(dom.wzBandAdd, t.bands.length < TARIFF_LIMITS.maxBands);
}

/** Možnosti výberu času po štvrťhodinách; hodnota je číslo štvrťhodiny (0 = 00:00, 96 = 24:00). @param {number} from @param {number} to */
function timeOptions(from, to) {
    let html = '';
    for (let i = from; i <= to; i++)
        html += `<option value="${i}">${i === 96 ? '24:00' : minutesToTimeStr(i * TARIFF_LIMITS.stepMin)}</option>`;
    return html;
}

/** Zoznam úsekov rozvrhu s krížikom na zmazanie. @param {ReturnType<typeof scheduleRuns>} runs */
function runsHtml(runs) {
    return runs
        .map((r, j) => {
            const from = minutesToTimeStr(r.startMin);
            const to = minutesToTimeStr(r.startMin + r.min);
            const del =
                runs.length > 1
                    ? `<button type="button" class="x" data-setup-run-del="${j}" aria-label="Zmazať úsek ${from} až ${to}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg></button>`
                    : '<span></span>';
            return `<li>${sw(r.band.level)}<span>${escapeHtml(r.band.name)}</span><span class="tm">${from} – ${to}<small>${hoursText(r.min)}</small></span>${del}</li>`;
        })
        .join('');
}

/** @param {AppState} state @param {Settings} draft @param {Dom} dom */
function renderRozvrh(state, draft, dom) {
    const t = draft.tariff;
    const i = schedIndex(state, t);
    const schedule = t.schedules[i];
    show(dom.wzSchedTabs, t.schedules.length > 1);
    setHtml(
        dom.wzSchedTabs,
        t.schedules
            .map(
                (_, j) =>
                    `<button type="button" data-setup-sched="${j}" aria-pressed="${j === i}">${escapeHtml(T.schedLabel(t, j))}</button>`,
            )
            .join(''),
    );
    const brush = brushOf(state, t);
    setHtml(
        dom.wzBrushes,
        t.bands
            .map(
                (b) =>
                    `<button type="button" class="pill brush" role="radio" aria-checked="${b.id === brush.id}" data-setup-brush="${b.id}">` +
                    `${sw(b.level)}${escapeHtml(b.name)}<small>${T.LEVELS[b.level].label}</small></button>`,
            )
            .join(''),
    );
    setHtml(
        dom.wzTariffRingG,
        tariffRingSvg(tariffRingModel(scheduleTiers(t, schedule)), {
            name: brush.name,
            level: T.LEVELS[brush.level].label,
            tier: LEVEL_TIER[brush.level],
        }),
    );
    setText(dom.wzRingSum, T.bandHoursText(t, schedule));
    setHtml(
        dom.wzSchedTpls,
        T.scheduleTemplates(t)
            .map((x) => `<button type="button" class="pill" data-setup-tpl="${x.tpl}">${x.label}</button>`)
            .join(''),
    );
    setHtml(dom.wzIvals, runsHtml(scheduleRuns(t, schedule)));
    setHtml(dom.wzIvalFrom, timeOptions(0, 95));
    setHtml(dom.wzIvalTo, timeOptions(1, 96));
    if (setHtml(dom.wzIvalBand, t.bands.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('')))
        dom.wzIvalBand.value = brush.id;
}

/** @param {Settings} draft @param {Dom} dom */
function renderVynimky(draft, dom) {
    const t = draft.tariff;
    const exceptions = t.schedules.slice(1);
    const season = exceptions.find(isSeasonSchedule);
    const full = t.schedules.length >= TARIFF_LIMITS.maxSchedules;
    /** @type {Record<string, boolean>} */
    const on = { none: !exceptions.length, weekend: exceptions.some(isWeekendSchedule), season: !!season };
    // Výnimku, ktorú už nemožno pridať, ani neponúkať (zmazať ju vždy ide).
    const choices = T.EXCEPTIONS.map((c) =>
        optHtml(`data-setup-exc="${c.what}"${c.what === 'none' || !full || on[c.what] ? '' : ' disabled'}`, c.title, c.sub, on[c.what]),
    ).join('');
    const months = season
        ? `<h3 class="flbl">Mesiace výnimky</h3><div class="pills months" role="group" aria-label="Mesiace výnimky">` +
          ALL_MONTHS.map(
              (m) =>
                  `<button type="button" class="pill" data-setup-month="${m}" aria-pressed="${season.months.includes(m)}">${T.MONTH_SHORT[m - 1]}</button>`,
          ).join('') +
          `</div>`
        : '';
    const list = t.schedules
        .map(
            (_, j) =>
                `<div class="wz-row">${miniTariff(t, j)}<p><b>${escapeHtml(T.schedLabel(t, j))}</b><small>${escapeHtml(T.schedDetail(t, j))}</small></p>` +
                `<button type="button" class="mini" data-setup-sched-edit="${j}">Upraviť</button></div>`,
        )
        .join('');
    setHtml(
        dom.wzExc,
        `${choices}${months}<h3 class="flbl">Rozvrhy</h3><div class="glass wz-rows">${list}</div>` +
            (full ? msgHtml({ text: `Rozvrhov je ${TARIFF_LIMITS.maxSchedules}, viac výnimiek sa nedá.` }) : ''),
    );
}

/** @param {Settings} draft @param {Dom} dom @param {boolean} refill */
function renderCeny(draft, dom, refill) {
    const t = draft.tariff;
    setHtml(
        dom.wzCurrency,
        CURRENCIES.map(
            (c) =>
                `<button type="button" class="pill" data-setup-cur="${escapeHtml(c)}" aria-pressed="${t.currency === c}">${escapeHtml(c)}</button>`,
        ).join(''),
    );
    const rows = t.bands
        .map(
            (b) =>
                `<label class="price">${sw(b.level)}<span>${escapeHtml(b.name)}</span>` +
                `<input class="fld" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00" data-setup-price="${b.id}" />` +
                `<span>${escapeHtml(t.currency)}</span></label>`,
        )
        .join('');
    if (setHtml(dom.wzPrices, rows) || refill)
        for (const input of dom.wzPrices.querySelectorAll('input[data-setup-price]')) {
            const el = /** @type {HTMLInputElement} */ (input);
            el.value = T.fieldText(bandById(t, el.dataset.setupPrice || '').price);
        }
    const c = T.priceCheck(t, false);
    const list = c.auto
        ? `<div class="glass">${c.auto.map((x) => `<p class="auto">${sw(x.level)}${escapeHtml(x.text)}</p>`).join('')}</div>`
        : '';
    const fix = c.fix ? `<button type="button" class="pbtn ghost" data-setup-autolevels>Použiť úrovne podľa cien</button>` : '';
    setHtml(dom.wzPriceCheck, list + msgHtml({ text: c.text, ok: c.ok }) + fix);
}

// ---- Hlavička, polia a tlačidlá -------------------------------------------------------

/** Záložky pri úprave z prehľadu. @param {HTMLElement} el @param {Array<{ step: string, label: string, on: boolean }> | null} tabs */
function renderTabs(el, tabs) {
    show(el, !!tabs);
    if (tabs)
        setHtml(
            el,
            tabs.map((t) => `<button type="button" data-setup-tab="${t.step}" aria-pressed="${t.on}">${t.label}</button>`).join(''),
        );
}

/** @param {AppState} state @param {Settings} draft @param {SetupStep} step @param {number} roof @param {Dom} dom */
function renderHead(state, draft, step, roof, dom) {
    const foot = T.footModel(state, draft, step, setupReady(state));
    show(dom.wzClose, foot.closeShown);
    dom.wzClose.setAttribute('aria-label', foot.close);
    setText(dom.wzStep, T.stepLabel(state, step));
    const section = T.progressSection(state, step);
    setHtml(dom.wzProg, section < 0 ? '' : SETUP_SECTIONS.map((_, i) => `<i${i <= section ? ' class="on"' : ''}></i>`).join(''));
    const sub = T.subText(state, draft, step, roof);
    show(dom.wzSub, !!sub);
    setText(dom.wzSub, sub);
    const texts = T.textsFor(state, draft, step, false);
    setText(dom.wzTitle, texts.title);
    setText(dom.wzLead, texts.lead);
    show(dom.wzLead, !!texts.lead);
    const tabs = editTabs(state, draft, step);
    renderTabs(dom.wzGroupTabs, tabs.group);
    show(dom.wzRoofTabs, tabs.roof);
    for (const b of dom.wzRoofTabs.children)
        b.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (b).dataset.setupTab === step));
    renderTabs(dom.wzTariffTabs, tabs.tariff);
    const errors = TARIFF_STEPS.some((x) => x === step) && step !== 'tarifa' ? checkTariff(draft.tariff).errors : [];
    show(dom.wzTariffMsgs, errors.length > 0);
    setHtml(dom.wzTariffMsgs, errors.map((e) => msgHtml({ text: e, err: true })).join(''));
    setText(dom.wzNext, foot.next);
    dom.wzNext.disabled = foot.nextOff;
    setText(dom.wzBack, foot.back);
    show(dom.wzBack, foot.backShown);
}

/** Hodnoty polí - len keď sa zmení to, k čomu patria, nie pri každom písmene. @param {AppState} state @param {number} roof @param {Dom} dom */
function writeFields(state, roof, dom) {
    const key = `${state.settingsRev}|${roof}|${state.setupStep}`;
    if (key === last.fields) return;
    last.fields = key;
    const { site, plant, kiosk } = state.settingsDraft;
    const x = plant.strings[roof];
    dom.wzLink.value = state.setupLink;
    dom.wzPlace.value = site.name;
    dom.wzLat.value = T.fieldText(site.lat);
    dom.wzLon.value = T.fieldText(site.lon);
    dom.wzWp.value = T.fieldText(plant.panelWp);
    dom.wzKwp.value = T.fieldText(state.setupKwp);
    dom.wzAc.value = T.fieldText(plant.acLimitKw);
    dom.wzKiosk.value = kiosk;
    if (!x) return;
    dom.wzTilt.value = String(x.tiltDeg);
    dom.wzPanels.value = T.fieldText(x.panels);
}

/** @param {AppState} state @param {Dom} dom */
export function renderWizard(state, dom) {
    const step = /** @type {SetupStep} */ (state.setupStep);
    const draft = setupDraft(state);
    const roof = Math.max(0, Math.min(state.setupRoof, draft.plant.strings.length - 1));
    renderHead(state, draft, step, roof, dom);
    for (const [key, el] of Object.entries(dom.wzScreens)) show(el, key === step);
    writeFields(state, roof, dom);
    // Mená pásiem a ceny sa plnia len pri načítaní a pri zmene obrazovky, nie pri každom písmene.
    const tariffKey = `${state.settingsRev}|${step}`;
    const refill = tariffKey !== last.tariff;
    last.tariff = tariffKey;
    /** @type {Partial<Record<SetupStep, () => void>>} */
    const screens = {
        odkaz: () => renderOdkaz(state, dom),
        lokalita: () => renderLokalita(state, draft, dom),
        panel: () => renderPanel(state, dom),
        smer: () => renderSmer(draft, roof, dom),
        sklon: () => renderSklon(draft, roof, dom),
        pocet: () => renderPocet(state, draft, roof, dom),
        dalsia: () => renderDalsia(state, draft, dom),
        menic: () => renderMenic(state, draft, dom),
        meranie: () => renderMeranie(state, dom),
        tarifa: () => renderTarifa(state, draft, dom),
        pasma: () => renderPasma(draft, dom, refill),
        rozvrh: () => renderRozvrh(state, draft, dom),
        vynimky: () => renderVynimky(draft, dom),
        ceny: () => renderCeny(draft, dom, refill),
        suhrn: () => setHtml(dom.wzSummary, summaryHtml(state, draft)),
    };
    screens[step]?.();
}
