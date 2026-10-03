// Karta Nastavenie: prehľad uloženej elektrárne a sprievodca jej nastavením. Sprievodca ukazuje
// vždy jednu obrazovku (setupStep v stave); obrazovky sú v index.html, render ich len prepína
// a dopĺňa. Hodnoty polí prepíše len pri zmene settingsRev, plochy alebo obrazovky - inak by
// prepisoval to, čo človek práve píše. Texty sú spoločné s novou appkou (shared/setup-texts.js).

import { compassModel, dayRingModel, panelGridModel, planesCompassModel, tariffRingModel, tiltModel } from '../../shared/chart-model.js';
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
} from '../../shared/config.js';
import { escapeHtml, hoursText, kwpText, minutesToTimeStr } from '../../shared/format.js';
import { liveStatus } from '../../shared/hero-model.js';
import { kioskApiUrl } from '../../shared/kiosk.js';
import { checkSettings, settingsFromLink } from '../../shared/settings.js';
import { ROOF_STEPS, SETUP_SECTIONS, TARIFF_STEPS, tariffSteps } from '../../shared/setup.js';
import { brushOf, schedIndex, setupReady } from '../../shared/setup-flow.js';
import {
    AC_GUESS,
    bandHoursText,
    derivedNote,
    DIRS,
    dirName,
    effectivePick,
    EXCEPTIONS,
    fieldText,
    footModel,
    geoNote,
    GUESS_MARK,
    hasSite,
    importOfferText,
    kioskNote,
    LEVELS,
    linkPreview,
    menicModel,
    MONTH_SHORT,
    panelsLine,
    placeCard,
    plantHero,
    priceCheck,
    progressSection,
    quality,
    roofRows,
    schedDetail,
    schedLabel,
    scheduleTemplates,
    stepLabel,
    subText,
    summaryRows as summaryData,
    TARIFF_DUNNO,
    TARIFF_KINDS,
    TARIFF_TABS,
    textsFor,
    TILT_PRESETS,
    WP_GUESS,
} from '../../shared/setup-texts.js';
import { orientationShare } from '../../shared/solar.js';
import {
    bandById,
    checkTariff,
    isSeasonSchedule,
    isWeekendSchedule,
    scheduleRuns,
    scheduleTiers,
    tariffKind,
} from '../../shared/tariff.js';
import { SETUP_ICONS } from '../icons.js';
import { changedKeys, writeHtml } from '../memo.js';
import { savedSettings, setupDraft } from '../state.js';
import {
    compassSvg,
    miniCompassSvg,
    panelGridSvg,
    panelLabelSvg,
    planesCompassSvg,
    tariffMiniSvg,
    tariffRingSvg,
    tiltSvg,
} from '../svg.js';

/** @typedef {import('../state.js').AppState} AppState */
/** @typedef {import('../dom.js').Dom} Dom */
/** @typedef {import('../../shared/settings.js').Settings} Settings */
/** @typedef {import('../../shared/setup.js').SetupStep} SetupStep */
/** @typedef {import('../../shared/config.js').Tariff} Tariff */

// ---- Prehľad uloženej elektrárne a zhrnutie sprievodcu -------------------------------

/** Jeden riadok zhrnutia. Ťuknutie naň otvorí jeho krok (data-setup-edit). extra je druhý
 * riadok pod hodnotou, side stav vpravo pred šípkou. */
function sumRow(
    /** @type {string} */ key,
    /** @type {string} */ icon,
    /** @type {string} */ label,
    /** @type {string} */ value,
    { extra = '', side = '' } = {},
) {
    return (
        `<button type="button" class="sum-row" data-setup-edit="${key}"><span class="sum-ico">${icon}</span>` +
        `<span class="t"><span class="k">${label}</span><span class="v">${value}</span>${extra}</span>${side}${SETUP_ICONS.chevron}</button>`
    );
}

/**
 * Riadky zhrnutia: poloha, panel, plochy, menič, meranie, tarifa. V prehľade uloženej elektrárne
 * (withLive) má meranie vpravo aj stav pripojenia; rozpísaný kiosk v sprievodcu ešte neoveril nik.
 * @param {Settings} s @param {AppState} state
 */
function summaryRows(s, state, withLive = false) {
    const live = withLive ? liveStatus({ ...state, kiosk: s.kiosk }) : null;
    // Stav dvakrát: na mobile namiesto podnadpisu, na desktope vpravo (viď .sum-live v style.css).
    const status = (/** @type {string} */ where) => (live ? `<span class="sum-live ${where} ${live.tone}">${live.text}</span>` : '');
    return summaryData(s, state)
        .map((r) => {
            const icon =
                r.az !== null
                    ? miniCompassSvg(r.az)
                    : r.key === 'tarifa'
                      ? miniTariff(s.tariff)
                      : SETUP_ICONS[/** @type {keyof typeof SETUP_ICONS} */ (r.icon)];
            const extra =
                (r.extra ? `<span class="k2">${escapeHtml(r.extra)}</span>` : '') +
                (r.guess ? `<span class="est">${GUESS_MARK}</span>` : '') +
                (r.key === 'meranie' ? status('in-line') : '');
            return sumRow(r.key, icon, r.label, escapeHtml(r.value), { extra, side: r.key === 'meranie' ? status('at-side') : '' });
        })
        .join('');
}

/** Karta elektrárne nad riadkami: meno, celkový výkon, zostava, výroba za jasného dneška
 * a vpravo kompas s plochami panelov. @param {Settings} s @param {AppState} state */
function heroHtml(s, state) {
    const h = plantHero(s, state.now);
    if (!h) return `<div class="hero-t"><div class="big">– kWp</div></div>`;
    return (
        `<div class="hero-t"><b class="name">${escapeHtml(h.name)}</b>` +
        `<div class="big">${kwpText(h.kwp).replace(' kWp', '<small> kWp</small>')}</div>` +
        `<div class="sub">${h.panels} panelov · menič ${h.ac}</div>` +
        `<div class="sub">dnes za jasnej oblohy približne ${h.clearKwh} kWh</div></div>` +
        planesCompassSvg(planesCompassModel(s.plant.strings), `Plochy panelov: ${h.planes}`)
    );
}

/** Hlásenia pod zhrnutím: chyby blokujú uloženie, varovania nie. @param {Settings} s */
function messagesHtml(s) {
    const { errors, warnings } = checkSettings(s);
    return (
        errors.map((e) => `<p class="plant-msg err">${escapeHtml(e)}</p>`).join('') +
        warnings.map((w) => `<p class="plant-msg">${escapeHtml(w)}</p>`).join('')
    );
}

/** Prehľad karty: poloha a výzva dokončiť elektráreň (panely nie sú zadané), alebo zhrnutie
 * uloženej elektrárne. @param {AppState} state @param {Dom} dom */
function renderHome(state, dom) {
    const noPanels = state.known !== 'elektraren';
    dom.setupSite.classList.toggle('hidden', !noPanels);
    dom.setupSiteName.textContent = state.site.name;
    dom.setupCta.classList.toggle('hidden', !noPanels);
    dom.setupOverview.classList.toggle('hidden', noPanels);
    dom.setupNote.textContent = state.settingsNote;
    if (noPanels) return;
    const saved = savedSettings(state);
    writeHtml(dom.setupHero, heroHtml(saved, state), 'setupHero');
    writeHtml(dom.setupRows, summaryRows(saved, state, true), 'setupRows');
    writeHtml(
        dom.setupWarnings,
        checkSettings(saved)
            .warnings.map((w) => `<p class="plant-msg">${escapeHtml(w)}</p>`)
            .join(''),
        'setupWarnings',
    );
}

// ---- Obrazovky sprievodcu ---------------------------------------------------------

/** @param {AppState} state @param {Dom} dom */
function renderOdkaz(state, dom) {
    const found = settingsFromLink(state.setupLink);
    dom.wzLinkNote.classList.toggle('hidden', !state.setupLink.trim() || !!found);
    dom.wzLinkPreview.classList.toggle('hidden', !found);
    if (!found) return;
    const p = linkPreview(found);
    writeHtml(
        dom.wzLinkPreview,
        `<span class="lbl">V odkaze je</span><div class="name"><b>${escapeHtml(p.name)}</b><span class="meta">${p.kwp}</span></div><div class="meta">${escapeHtml(p.meta)}</div>`,
        'wzLinkPreview',
    );
}

/** @param {AppState['geo']} geo */
function geoHtml(geo) {
    const note = geoNote(geo);
    if (note) return `<p class="geo-status">${note}</p>`;
    if (geo.status !== 'done') return '';
    const items = geo.results
        .map(
            (r, i) =>
                `<li><button type="button" class="geo-pick" data-geo="${i}">${escapeHtml(r.site.name)}<small>${escapeHtml(r.detail)}</small></button></li>`,
        )
        .join('');
    return `<ul class="geo-list">${items}</ul>`;
}

/** Potvrdenie lokality tým, čo človek pozná: kedy u neho dnes vychádza a zapadá slnko. @param {Settings} s @param {AppState} state */
function placeCardHtml(s, state) {
    const c = placeCard(s, state.now);
    if (!c) return '';
    return (
        `<div class="place-card"><div class="name"><b>${escapeHtml(c.name)}</b><span class="meta">${c.date}</span></div>` +
        `<div class="sunline"><span>${c.rise}<small>východ</small></span>` +
        `<svg viewBox="0 0 120 38" aria-hidden="true"><line class="ground" x1="2" y1="34" x2="118" y2="34"/><path class="arc" d="M 4 34 Q 60 -18 116 34"/><circle class="sun" cx="60" cy="9" r="5"/></svg>` +
        `<span class="end">${c.set}<small>západ</small></span></div>` +
        `<div class="meta">${escapeHtml(c.meta)}</div></div>`
    );
}

/** @param {AppState} state @param {Settings} draft @param {Dom} dom */
function renderLokalita(state, draft, dom) {
    writeHtml(dom.wzGeo, geoHtml(state.geo), 'wzGeo');
    writeHtml(dom.wzPlaceCard, placeCardHtml(draft, state), 'wzPlaceCard');
    dom.wzWelcome.classList.toggle('hidden', state.known !== 'nic');
    // Odložiť panely sa dá, až keď je poloha vybraná - bez nej nie je čo ukázať.
    dom.wzLater.classList.toggle('hidden', !setupReady(state));
}

/** Tlačidlá s bežnými hodnotami, „Iný“ a „Neviem“. @param {number[]} choices @param {number} value @param {string} pick @param {string} attr @param {string} unit */
function chipsHtml(choices, value, pick, attr, unit) {
    const chip = (/** @type {string} */ v, /** @type {string} */ label, /** @type {boolean} */ on, cls = 'chip') =>
        `<button type="button" class="${cls}" data-${attr}="${v}" aria-pressed="${on}">${label}</button>`;
    return (
        choices.map((c) => chip(String(c), `${fieldText(c)} ${unit}`, pick === 'chip' && value === c)).join('') +
        chip('other', 'Iný', pick === 'other') +
        chip('guess', 'Neviem', pick === 'guess', 'chip soft')
    );
}

/** @param {AppState} state @param {Dom} dom */
function renderPanel(state, dom) {
    const kwpMode = state.setupKwp !== null;
    dom.wzWpModePanel.setAttribute('aria-pressed', String(!kwpMode));
    dom.wzWpModeKwp.setAttribute('aria-pressed', String(kwpMode));
    dom.wzWpPanel.classList.toggle('hidden', kwpMode);
    dom.wzWpTotal.classList.toggle('hidden', !kwpMode);
    const wp = state.settingsDraft.plant.panelWp;
    const pick = effectivePick(state.setupPick.wp, wp, SETUP.panelWpChoices);
    writeHtml(dom.wzWpLabel, panelLabelSvg(Number.isFinite(wp) ? String(wp) : '···'), 'wzWpLabel');
    writeHtml(dom.wzWpChips, chipsHtml(SETUP.panelWpChoices, wp, pick, 'setup-wp', 'Wp'), 'wzWpChips');
    dom.wzWpOther.classList.toggle('hidden', pick !== 'other');
    dom.wzWpGuess.classList.toggle('hidden', pick !== 'guess');
    dom.wzWpGuess.textContent = WP_GUESS;
}

/** Pás „koľko energie to dá oproti najlepšiemu“. @param {number} share 0-1 @param {string} what */
function qualityHtml(share, what) {
    const q = quality(share);
    return (
        `<div class="quality"><div class="row"><b>${q.label}</b><span>~${q.pct} % najlepšieho ${what}</span></div>` +
        `<div class="meter"><i class="tier-${q.tier}" style="width:${q.pct}%"></i></div></div>`
    );
}

/** @param {Settings} draft @param {number} roof */
function shareOf(draft, roof) {
    const x = draft.plant.strings[roof];
    return hasSite(draft) ? orientationShare(draft.site, x, PLANT.albedo) : null;
}

/** @param {Settings} draft @param {number} roof @param {Dom} dom */
function renderSmer(draft, roof, dom) {
    const az = draft.plant.strings[roof].azimuthDeg;
    const m = compassModel(az, draft.site.lat < 0);
    const buttons = m.sectors
        .map((s) => {
            const d = DIRS.find((x) => x.az === s.az) || DIRS[0];
            return (
                `<button type="button" role="radio" class="dir-btn${s.on ? ' on' : ''}" style="left:${s.button.left.toFixed(2)}%;top:${s.button.top.toFixed(2)}%" ` +
                `aria-checked="${s.on}" tabindex="${s.on ? 0 : -1}" aria-label="${d.name}" data-setup-az="${s.az}">${d.short}</button>`
            );
        })
        .join('');
    writeHtml(
        dom.wzCompass,
        `<div class="dir-dial" role="radiogroup" aria-label="Smer plochy">${compassSvg(m)}${buttons}</div>`,
        'wzCompass',
    );
    dom.wzDirName.textContent = dirName(az);
    dom.wzDirDeg.textContent = `${az}°`;
    const share = shareOf(draft, roof);
    writeHtml(dom.wzDirQuality, share === null ? '' : qualityHtml(share, 'smeru'), 'wzDirQuality');
}

/** @param {Settings} draft @param {number} roof @param {Dom} dom */
function renderSklon(draft, roof, dom) {
    const tilt = draft.plant.strings[roof].tiltDeg;
    writeHtml(dom.wzTiltArt, tiltSvg(tiltModel(tilt), tilt), 'wzTiltArt');
    writeHtml(
        dom.wzTiltPresets,
        TILT_PRESETS.map(
            (p) =>
                `<button type="button" class="chip chip-col" data-setup-tilt="${p.deg}" aria-pressed="${tilt === p.deg}"><b>${p.name}</b><small>${p.sub}</small></button>`,
        ).join(''),
        'wzTiltPresets',
    );
    dom.wzTiltOut.textContent = `${tilt}°`;
    const share = shareOf(draft, roof);
    writeHtml(dom.wzTiltQuality, share === null ? '' : qualityHtml(share, 'sklonu a smeru'), 'wzTiltQuality');
}

/** @param {AppState} state @param {Settings} draft @param {number} roof @param {Dom} dom */
function renderPocet(state, draft, roof, dom) {
    const x = draft.plant.strings[roof];
    writeHtml(dom.wzPanelGrid, panelGridSvg(panelGridModel(x.panels)), 'wzPanelGrid');
    const line = panelsLine(state, draft, roof);
    writeHtml(dom.wzPanelsKwp, line.strong ? `${line.text}<b>${line.strong}</b>` : line.text, 'wzPanelsKwp');
}

/** @param {AppState} state @param {Settings} draft @param {Dom} dom */
function renderDalsia(state, draft, dom) {
    const many = draft.plant.strings.length > 1;
    const rows = roofRows(draft)
        .map(
            (r, i) =>
                `<div class="roof-row">${miniCompassSvg(r.az)}<span class="t"><b>${r.title}</b>` +
                `<span>${r.sub}</span></span>` +
                `<button type="button" class="mini-act" data-setup-roof-edit="${i}">Upraviť</button>` +
                (many ? `<button type="button" class="mini-act" data-setup-roof-del="${i}">Odstrániť</button>` : '') +
                `</div>`,
        )
        .join('');
    writeHtml(dom.wzRoofs, rows, 'wzRoofs');
    dom.wzRoofAdd.classList.toggle('hidden', draft.plant.strings.length >= SETTINGS_LIMITS.maxStrings);
    writeHtml(dom.wzDerived, derivedHtml(state, draft), 'wzDerived');
}

/** Výkon panelu dopočítaný z celkového výkonu - ukáže sa, keď sú spočítané všetky plochy. @param {AppState} state @param {Settings} draft */
function derivedHtml(state, draft) {
    const note = derivedNote(state, draft);
    return note ? `<p class="plant-msg${note.err ? ' err' : ''}">${note.text}</p>` : '';
}

/** @param {AppState} state @param {Settings} draft @param {Dom} dom */
function renderMenic(state, draft, dom) {
    const ac = state.settingsDraft.plant.acLimitKw;
    const m = menicModel(draft, ac);
    const msg = m.note ? `<p class="plant-msg${m.note.ok ? ' ok' : ''}">${m.note.text}</p>` : '';
    const bar = (/** @type {string} */ label, /** @type {{ share: number, text: string }} */ v, /** @type {string} */ cls) =>
        `<div class="cb"><span>${label}</span><span class="track"><i class="${cls}" style="width:${(v.share * 100).toFixed(1)}%"></i></span><b>${v.text}</b></div>`;
    writeHtml(dom.wzAcBars, bar('Panely', m.pv, 'pv') + bar('Menič', m.ac, 'ac') + msg, 'wzAcBars');
    const pick = effectivePick(state.setupPick.ac, ac, SETUP.acChoices);
    writeHtml(dom.wzAcChips, chipsHtml(SETUP.acChoices, ac, pick, 'setup-ac', 'kW'), 'wzAcChips');
    dom.wzAcOther.classList.toggle('hidden', pick !== 'other');
    dom.wzAcGuess.classList.toggle('hidden', pick !== 'guess');
    dom.wzAcGuess.textContent = AC_GUESS;
}

/** @param {AppState} state @param {Dom} dom */
function renderMeranie(state, dom) {
    dom.wzLiveYes.setAttribute('aria-pressed', String(state.setupLive));
    dom.wzLiveNo.setAttribute('aria-pressed', String(!state.setupLive));
    dom.wzKioskBlock.classList.toggle('hidden', !state.setupLive);
    const kiosk = state.settingsDraft.kiosk;
    const note = kioskNote(kiosk, !!kioskApiUrl(kiosk));
    dom.wzKioskNote.classList.toggle('err', !!note?.err);
    dom.wzKioskNote.classList.toggle('hidden', !note);
    if (note) dom.wzKioskNote.textContent = note.text;
}

/** @param {AppState} state @param {Settings} draft @param {Dom} dom */
function renderSuhrn(state, draft, dom) {
    const derived = derivedNote(state, draft);
    const html =
        `<div class="setup-hero">${heroHtml(draft, state)}</div><div class="sum-list">${summaryRows(draft, state)}</div>` +
        `<div class="plant-msgs">${derived?.err ? derivedHtml(state, draft) : messagesHtml(draft)}</div>`;
    writeHtml(dom.wzSummary, html, 'wzSummary');
}

// ---- Obrazovky tarify -------------------------------------------------------------

/** Malý prstenec rozvrhu. @param {Tariff} t @param {number} [i] */
const miniTariff = (t, i = 0) => tariffMiniSvg(dayRingModel(scheduleTiers(t, t.schedules[i])));

/** @param {AppState} state @param {Settings} draft @param {Dom} dom */
function renderTarifa(state, draft, dom) {
    const kind = tariffKind(draft.tariff);
    const icon = (/** @type {string} */ k) =>
        k === 'spot' ? '' : miniTariff(k === kind ? draft.tariff : TARIFF_TEMPLATES[/** @type {'jedna' | 'dvoj' | 'viac'} */ (k)]);
    writeHtml(
        dom.wzTariffKinds,
        TARIFF_KINDS.map(
            (c) =>
                `<button type="button" class="choice" data-setup-kind="${c.kind}" aria-pressed="${c.kind === kind}"${c.kind === 'spot' ? ' disabled' : ''}>` +
                `<span class="dot"></span><span class="t"><b>${c.title}</b><span>${c.sub}</span></span>${icon(c.kind)}</button>`,
        ).join(''),
        'wzTariffKinds',
    );
    dom.wzTariffDunno.classList.toggle('hidden', !state.setupDunno);
    dom.wzTariffDunno.textContent = TARIFF_DUNNO;
}

/** @param {Settings} draft @param {Dom} dom @param {boolean} refill */
function renderPasma(draft, dom, refill) {
    const t = draft.tariff;
    const rows = t.bands
        .map(
            (b, i) =>
                `<div class="band-row"><div class="band-top"><i class="sw ${LEVEL_TIER[b.level]}"></i>` +
                `<input class="field-input" type="text" maxlength="${TARIFF_LIMITS.nameMax}" autocomplete="off" aria-label="Meno pásma ${i + 1}" data-setup-band-name="${b.id}" />` +
                (t.bands.length > 3 ? `<button type="button" class="mini-act" data-setup-band-del="${b.id}">Odstrániť</button>` : '') +
                `</div><div class="seg lvl" role="group" aria-label="Úroveň pásma ${i + 1}">` +
                PRICE_LEVELS.map(
                    (l) =>
                        `<button type="button" data-setup-band="${b.id}" data-setup-level="${l}" aria-pressed="${b.level === l}">${LEVELS[l].name}</button>`,
                ).join('') +
                `</div></div>`,
        )
        .join('');
    const written = writeHtml(dom.wzBands, rows, 'wzBands');
    if (written || refill)
        for (const input of dom.wzBands.querySelectorAll('input[data-setup-band-name]')) {
            const el = /** @type {HTMLInputElement} */ (input);
            el.value = bandById(t, el.dataset.setupBandName || '').name;
        }
    dom.wzBandAdd.classList.toggle('hidden', t.bands.length >= TARIFF_LIMITS.maxBands);
}

/** Možnosti výberu času po štvrťhodinách; hodnota je číslo štvrťhodiny (0 = 00:00, 96 = 24:00). @param {number} from @param {number} to */
function timeOptions(from, to) {
    let html = '';
    for (let i = from; i <= to; i++)
        html += `<option value="${i}">${i === 96 ? '24:00' : minutesToTimeStr(i * TARIFF_LIMITS.stepMin)}</option>`;
    return html;
}

/** @param {AppState} state @param {Settings} draft @param {Dom} dom */
function renderRozvrh(state, draft, dom) {
    const t = draft.tariff;
    const i = schedIndex(state, t);
    const schedule = t.schedules[i];
    dom.wzSchedTabs.classList.toggle('hidden', t.schedules.length < 2);
    writeHtml(
        dom.wzSchedTabs,
        t.schedules
            .map(
                (_, j) =>
                    `<button type="button" data-setup-sched="${j}" aria-pressed="${j === i}">${escapeHtml(schedLabel(t, j))}</button>`,
            )
            .join(''),
        'wzSchedTabs',
    );
    const brush = brushOf(state, t);
    writeHtml(dom.wzBrushes, brushesHtml(t, brush), 'wzBrushes');
    writeHtml(
        dom.wzTariffRingG,
        tariffRingSvg(tariffRingModel(scheduleTiers(t, schedule)), {
            name: brush.name,
            level: LEVELS[brush.level].label,
            tier: LEVEL_TIER[brush.level],
        }),
        'wzTariffRing',
    );
    dom.wzRingSum.textContent = bandHoursText(t, schedule);
    const tpls = scheduleTemplates(t)
        .map((x) => `<button type="button" class="chip${x.soft ? ' soft' : ''}" data-setup-tpl="${x.tpl}">${x.label}</button>`)
        .join('');
    writeHtml(dom.wzSchedTpls, tpls, 'wzSchedTpls');
    writeHtml(dom.wzIvals, runsHtml(scheduleRuns(t, schedule)), 'wzIvals');
    renderRunForm(t, brush, dom);
}

/** Pásma na výber, ktorým sa maľuje. @param {Tariff} t @param {import('../../shared/config.js').Band} brush */
function brushesHtml(t, brush) {
    return t.bands
        .map(
            (b) =>
                `<button type="button" class="brush" role="radio" aria-checked="${b.id === brush.id}" data-setup-brush="${b.id}">` +
                `<i class="sw ${LEVEL_TIER[b.level]}"></i>${escapeHtml(b.name)}<small>${LEVELS[b.level].label}</small></button>`,
        )
        .join('');
}

/** Formulár úseku pod zoznamom - presná cesta aj pre klávesnicu. Možnosti sa zapíšu raz,
 * výber pásma ostáva, kým sa pásma nezmenia. @param {Tariff} t @param {import('../../shared/config.js').Band} brush @param {Dom} dom */
function renderRunForm(t, brush, dom) {
    writeHtml(dom.wzIvalFrom, timeOptions(0, 95), 'wzIvalFrom');
    writeHtml(dom.wzIvalTo, timeOptions(1, 96), 'wzIvalTo');
    const bandOptions = t.bands.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
    if (writeHtml(dom.wzIvalBand, bandOptions, 'wzIvalBand')) dom.wzIvalBand.value = brush.id;
}

/** Zoznam úsekov rozvrhu s krížikom na zmazanie. @param {ReturnType<typeof scheduleRuns>} runs */
function runsHtml(runs) {
    return runs
        .map((r, j) => {
            const to = minutesToTimeStr(r.startMin + r.min);
            const del =
                runs.length > 1
                    ? `<button type="button" class="x" data-setup-run-del="${j}" aria-label="Zmazať úsek ${minutesToTimeStr(r.startMin)} až ${to}"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8"/></svg></button>`
                    : '<span></span>';
            return `<li><i class="sw ${LEVEL_TIER[r.band.level]}"></i><span>${escapeHtml(r.band.name)}</span><span class="tm">${minutesToTimeStr(r.startMin)} – ${to}<small>${hoursText(r.min)}</small></span>${del}</li>`;
        })
        .join('');
}

/** @param {AppState} state @param {Settings} draft @param {Dom} dom */
function renderVynimky(state, draft, dom) {
    const t = draft.tariff;
    const exceptions = t.schedules.slice(1);
    const season = exceptions.find(isSeasonSchedule);
    const full = t.schedules.length >= TARIFF_LIMITS.maxSchedules;
    /** @type {Record<string, boolean>} */
    const on = { none: !exceptions.length, weekend: exceptions.some(isWeekendSchedule), season: !!season };
    // Výnimku, ktorú už nemožno pridať, ani neponúkať (zmazať ju vždy ide).
    const choices = EXCEPTIONS.map((c) => {
        const can = c.what === 'none' || !full || on[c.what];
        return `<button type="button" class="choice" data-setup-exc="${c.what}" aria-pressed="${on[c.what]}"${can ? '' : ' disabled'}><span class="dot"></span><span class="t"><b>${c.title}</b><span>${c.sub}</span></span></button>`;
    }).join('');
    const months = season
        ? `<div class="field-label">Mesiace výnimky</div><div class="months" role="group" aria-label="Mesiace výnimky">` +
          ALL_MONTHS.map(
              (m) =>
                  `<button type="button" class="chip" data-setup-month="${m}" aria-pressed="${season.months.includes(m)}">${MONTH_SHORT[m - 1]}</button>`,
          ).join('') +
          `</div>`
        : '';
    const list = t.schedules
        .map(
            (_, j) =>
                `<div class="roof-row">${miniTariff(t, j)}<span class="t"><b>${escapeHtml(schedLabel(t, j))}</b><span>${escapeHtml(schedDetail(t, j))}</span></span>` +
                `<button type="button" class="mini-act" data-setup-sched-edit="${j}">Upraviť</button></div>`,
        )
        .join('');
    writeHtml(
        dom.wzExc,
        `<div class="wz-kinds">${choices}</div>${months}<div class="field-label">Rozvrhy</div><div class="roofs">${list}</div>` +
            (full ? `<p class="plant-msg">Rozvrhov je ${TARIFF_LIMITS.maxSchedules}, viac výnimiek sa nedá.</p>` : ''),
        'wzExc',
    );
}

/** @param {Settings} draft @param {Dom} dom @param {boolean} refill */
function renderCeny(draft, dom, refill) {
    const t = draft.tariff;
    writeHtml(
        dom.wzCurrency,
        CURRENCIES.map(
            (c) =>
                `<button type="button" class="chip" data-setup-cur="${escapeHtml(c)}" aria-pressed="${t.currency === c}">${escapeHtml(c)}</button>`,
        ).join(''),
        'wzCurrency',
    );
    const rows = t.bands
        .map(
            (b) =>
                `<label class="price-row"><i class="sw ${LEVEL_TIER[b.level]}"></i><span>${escapeHtml(b.name)}</span>` +
                `<input class="field-input num" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00" data-setup-price="${b.id}" />` +
                `<span class="cur">${escapeHtml(t.currency)}</span></label>`,
        )
        .join('');
    if (writeHtml(dom.wzPrices, rows, 'wzPrices') || refill)
        for (const input of dom.wzPrices.querySelectorAll('input[data-setup-price]')) {
            const el = /** @type {HTMLInputElement} */ (input);
            el.value = fieldText(bandById(t, el.dataset.setupPrice || '').price);
        }
    writeHtml(dom.wzPriceCheck, priceCheckHtml(t), 'wzPriceCheck');
}

/** Úrovne podľa cien a či sedia s tými, ktoré má človek pri pásmach. @param {Tariff} t */
function priceCheckHtml(t) {
    const c = priceCheck(t);
    const msg = `<p class="plant-msg${c.ok ? ' ok' : ''}">${escapeHtml(c.text)}</p>`;
    if (!c.auto) return msg;
    const list = c.auto.map((x) => `<div><i class="sw ${LEVEL_TIER[x.level]}"></i>${escapeHtml(x.text)}</div>`).join('');
    return (
        `<div class="auto-levels">${list}</div>${msg}` +
        (c.fix ? `<button type="button" class="link-btn" data-setup-autolevels>Použiť úrovne podľa cien</button>` : '')
    );
}

/** Chyby tarify pod obrazovkami tarify (okrem voľby typu, tá chybu mať nemôže). @param {Settings} draft @param {SetupStep} step @param {Dom} dom */
function renderTariffMsgs(draft, step, dom) {
    const show = /** @type {readonly string[]} */ (TARIFF_STEPS).includes(step) && step !== 'tarifa';
    const errors = show ? checkTariff(draft.tariff).errors : [];
    dom.wzTariffMsgs.classList.toggle('hidden', !errors.length);
    writeHtml(dom.wzTariffMsgs, errors.map((e) => `<p class="plant-msg err">${escapeHtml(e)}</p>`).join(''), 'wzTariffMsgs');
}

// ---- Hlavička, polia a tlačidlá sprievodcu ---------------------------------------

/** @param {AppState} state @param {Settings} draft @param {SetupStep} step @param {number} roof @param {Dom} dom */
function renderHead(state, draft, step, roof, dom) {
    const edit = state.setupReturn !== null;
    const foot = footModel(state, draft, step, false);
    dom.wzClose.classList.toggle('hidden', !foot.closeShown);
    dom.wzStep.textContent = stepLabel(state, step);
    dom.wzClose.setAttribute('aria-label', foot.close);
    const section = progressSection(state, step);
    const prog =
        section < 0 ? '' : SETUP_SECTIONS.map((_, i) => `<i class="${i < section ? 'done' : i === section ? 'now' : ''}"></i>`).join('');
    writeHtml(dom.wzProg, prog, 'wzProg');
    const onRoof = /** @type {readonly string[]} */ (ROOF_STEPS).includes(step);
    dom.wzSub.textContent = subText(state, draft, step, roof);
    const texts = textsFor(state, draft, step);
    dom.wzTitle.textContent = texts.title;
    dom.wzLead.textContent = texts.lead;
    dom.wzLead.classList.toggle('hidden', !texts.lead);
    dom.wzRoofTabs.classList.toggle('hidden', !edit || !onRoof);
    for (const b of dom.wzRoofTabs.children)
        b.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (b).dataset.setupTab === step));
    renderTariffTabs(draft, step, edit, dom);
}

/** Úprava tarify z prehľadu: záložky na jej obrazovky, ako pri ploche strechy.
 * @param {Settings} draft @param {SetupStep} step @param {boolean} edit @param {Dom} dom */
function renderTariffTabs(draft, step, edit, dom) {
    const onTariff = /** @type {readonly string[]} */ (TARIFF_STEPS).includes(step);
    dom.wzTariffTabs.classList.toggle('hidden', !edit || !onTariff);
    writeHtml(
        dom.wzTariffTabs,
        tariffSteps(tariffKind(draft.tariff))
            .map((k) => `<button type="button" data-setup-tab="${k}" aria-pressed="${k === step}">${TARIFF_TABS[k]}</button>`)
            .join(''),
        'wzTariffTabs',
    );
}

/** Hodnoty polí - len keď sa zmení to, k čomu patria, nie pri každom písmene. @param {AppState} state @param {number} roof @param {Dom} dom */
function writeFields(state, roof, dom) {
    if (!changedKeys('setupFields', [state.settingsRev, roof, state.setupStep])) return;
    const { site, plant, kiosk } = state.settingsDraft;
    const x = plant.strings[roof];
    dom.wzLink.value = state.setupLink;
    dom.wzPlace.value = site.name;
    dom.wzLat.value = fieldText(site.lat);
    dom.wzLon.value = fieldText(site.lon);
    dom.wzWp.value = fieldText(plant.panelWp);
    dom.wzKwp.value = fieldText(state.setupKwp);
    dom.wzAc.value = fieldText(plant.acLimitKw);
    dom.wzKiosk.value = kiosk;
    if (!x) return;
    dom.wzTilt.value = String(x.tiltDeg);
    dom.wzPanels.value = fieldText(x.panels);
}

/** Tlačidlá dole: čo robí „Ďalej“ a či sa dá, rozhoduje shared/setup-flow.js podľa toho istého stavu.
 * @param {AppState} state @param {Settings} draft @param {SetupStep} step @param {boolean} ok @param {Dom} dom */
function renderFoot(state, draft, step, ok, dom) {
    const foot = footModel(state, draft, step, ok);
    dom.wzNext.textContent = foot.next;
    dom.wzNext.disabled = foot.nextOff;
    dom.wzBack.textContent = foot.back;
    dom.wzBack.classList.toggle('hidden', !foot.backShown);
}

/** @param {AppState} state @param {Dom} dom */
function renderWizard(state, dom) {
    const step = /** @type {SetupStep} */ (state.setupStep);
    const draft = setupDraft(state);
    const roof = Math.max(0, Math.min(state.setupRoof, draft.plant.strings.length - 1));
    renderHead(state, draft, step, roof, dom);
    for (const [key, el] of Object.entries(dom.wzScreens)) el.classList.toggle('hidden', key !== step);
    writeFields(state, roof, dom);
    // Polia tarify (mená pásiem, ceny) sa plnia len pri načítaní a pri zmene obrazovky, nie pri
    // každom písmene - rovnako ako ostatné polia (writeFields).
    const refill = changedKeys('tariffFields', [state.settingsRev, step]);
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
        vynimky: () => renderVynimky(state, draft, dom),
        ceny: () => renderCeny(draft, dom, refill),
        suhrn: () => renderSuhrn(state, draft, dom),
    };
    screens[step]?.();
    renderTariffMsgs(draft, step, dom);
    renderFoot(state, draft, step, setupReady(state), dom);
}

/** @param {AppState} state @param {Dom} dom */
export function renderNastavenie(state, dom) {
    // Sprievodca je v HTML skrytý, kým ho appka nezapne - vtedy style.css skryje starý formulár.
    dom.setup.classList.remove('hidden');
    const open = state.setupStep !== null;
    dom.settingsHead.classList.toggle('hidden', open);
    dom.setupHome.classList.toggle('hidden', open);
    dom.wizard.classList.toggle('hidden', !open);
    if (open) renderWizard(state, dom);
    else renderHome(state, dom);
}

/**
 * Ponuka prevziať nastavenie z odkazu. Je mimo kariet, aby ju bolo vidno hneď po otvorení
 * odkazu, nech je appka na ktorejkoľvek karte.
 * @param {AppState} state @param {Dom} dom
 */
export function renderImportOffer(state, dom) {
    const s = state.incoming;
    dom.importOffer.classList.toggle('hidden', !s);
    if (!s) return;
    dom.importOfferText.textContent = importOfferText(s, state.known);
}
