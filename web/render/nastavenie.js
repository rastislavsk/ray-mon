// Karta Nastavenie: prehľad uloženej elektrárne a sprievodca jej nastavením. Sprievodca ukazuje
// vždy jednu obrazovku (setupStep v stave); obrazovky sú v index.html, render ich len prepína
// a dopĺňa. Hodnoty polí prepíše len pri zmene settingsRev, plochy alebo obrazovky - inak by
// prepisoval to, čo človek práve píše.

import { compassModel, panelGridModel, tiltModel } from '../../shared/chart-model.js';
import { installedKw, PLANT, SETTINGS_LIMITS, SETUP } from '../../shared/config.js';
import { escapeHtml, kwpText, minutesToTimeStr } from '../../shared/format.js';
import { kioskApiUrl } from '../../shared/kiosk.js';
import { checkSettings, sameSettings, settingsFromLink, settingsHint, siteMetaText } from '../../shared/settings.js';
import { ROOF_STEPS, SETUP_SECTIONS, setupSection, setupStepOk, totalPanels } from '../../shared/setup.js';
import { clearDayKwh, localDateKey, orientationShare, sunTimes } from '../../shared/solar.js';
import { SETUP_ICONS } from '../icons.js';
import { changedKeys, writeHtml } from '../memo.js';
import { setupDraft } from '../state.js';
import { compassSvg, miniCompassSvg, panelGridSvg, panelLabelSvg, tiltSvg } from '../svg.js';

/** @typedef {import('../state.js').AppState} AppState */
/** @typedef {import('../dom.js').Dom} Dom */
/** @typedef {import('../../shared/settings.js').Settings} Settings */
/** @typedef {import('../../shared/setup.js').SetupStep} SetupStep */

/** Smery kompasu po 45°. */
const DIRS = [
    { az: 0, short: 'S', name: 'Sever' },
    { az: 45, short: 'SV', name: 'Severovýchod' },
    { az: 90, short: 'V', name: 'Východ' },
    { az: 135, short: 'JV', name: 'Juhovýchod' },
    { az: 180, short: 'J', name: 'Juh' },
    { az: 225, short: 'JZ', name: 'Juhozápad' },
    { az: 270, short: 'Z', name: 'Západ' },
    { az: 315, short: 'SZ', name: 'Severozápad' },
];

/** Typy striech - to, čo človek o svojej streche vie, namiesto stupňov. */
const TILT_PRESETS = [
    { deg: 10, name: 'Plochá', sub: 'na stojanoch, ~10°' },
    { deg: 20, name: 'Mierna', sub: '~20°' },
    { deg: 35, name: 'Bežná šikmá', sub: '~35°' },
    { deg: 45, name: 'Strmá', sub: '~45°' },
    { deg: 90, name: 'Na stene', sub: 'fasáda, 90°' },
];

/** @type {Record<SetupStep, { title: string, lead: string }>} */
const TEXTS = {
    start: {
        title: 'Nastavme tvoju elektráreň',
        lead: 'Šesť krátkych otázok. Na čo nevieš odpoveď, preskočíš tlačidlom „Neviem“ a všetko sa dá neskôr zmeniť.',
    },
    odkaz: {
        title: 'Vlož odkaz s nastavením',
        lead: 'Odkaz ti mohol poslať niekto, kto appku už používa. Pred uložením uvidíš, čo obsahuje.',
    },
    lokalita: {
        title: 'Kde je tvoja elektráreň?',
        lead: 'Podľa polohy appka vie, kde je na oblohe slnko a ktorá hodina je tam miestna.',
    },
    panel: {
        title: 'Aký výkon má jeden panel?',
        lead: 'Nájdeš ho na štítku na zadnej strane panelu pri „Pmax“, alebo v zmluve, napríklad „24 × 435 Wp“.',
    },
    smer: {
        title: 'Kam smerujú panely?',
        lead: 'Ťukni na stranu, na ktorú je strecha s panelmi otočená. Oranžový oblúk je dráha slnka cez deň.',
    },
    sklon: { title: 'Aká strmá je strecha?', lead: 'Vyber typ strechy. Kto pozná presné stupne, doladí ich posúvačom.' },
    pocet: { title: 'Koľko panelov je na tejto ploche?', lead: '' },
    dalsia: {
        title: 'Máš panely aj na inej strane strechy?',
        lead: 'Napríklad časť na juh a časť na východ. Každá strana je samostatná plocha, najviac tri.',
    },
    menic: { title: 'Aký veľký je menič?', lead: '' },
    meranie: {
        title: 'Chceš vidieť skutočný výkon?',
        lead: 'Bez merania appka ukazuje odhad z predpovede počasia. S meraním vidíš aj to, čo panely naozaj vyrábajú.',
    },
    suhrn: { title: 'Skontroluj a ulož', lead: 'Ťuknutím na riadok ho opravíš a vrátiš sa sem.' },
};

/** Číslo do poľa formulára, s desatinnou čiarkou; neplatné ostane prázdne. @param {number | null} n */
const fieldText = (n) => (n !== null && Number.isFinite(n) ? String(n).replace('.', ',') : '');

/** Názov smeru; mimo ôsmich smerov (staré nastavenie) aspoň stupne. @param {number} az */
const dirName = (az) => (DIRS.find((d) => d.az === az) || { name: `${az}°` }).name;

/** Výkon v kW bez zbytočných núl: 10 kW, 7,5 kW. @param {number} kw */
const kwText = (kw) => `${fieldText(Math.round(kw * 10) / 10)} kW`;

/** Je lokalita v nastavení úplná (vybraná, nie rozpísaná)? @param {Settings} s */
const hasSite = (s) => !!s.site.name && Number.isFinite(s.site.lat) && Number.isFinite(s.site.lon) && !!s.site.timezone;

/** Ako bol zadaný výkon: vlastné číslo, ktoré nie je medzi tlačidlami, sa ráta ako „iný“.
 * @param {'chip' | 'other' | 'guess'} pick @param {number} value @param {number[]} choices */
function effectivePick(pick, value, choices) {
    return pick === 'chip' && Number.isFinite(value) && !choices.includes(value) ? 'other' : pick;
}

// ---- Prehľad uloženej elektrárne a zhrnutie sprievodcu -------------------------------

/** Jeden riadok zhrnutia. Ťuknutie naň otvorí jeho krok (data-setup-edit). */
function sumRow(
    /** @type {string} */ key,
    /** @type {string} */ icon,
    /** @type {string} */ label,
    /** @type {string} */ value,
    extra = '',
) {
    return (
        `<button type="button" class="sum-row" data-setup-edit="${key}"><span class="sum-ico">${icon}</span>` +
        `<span class="t"><span class="k">${label}</span><span class="v">${value}</span>${extra}</span>${SETUP_ICONS.chevron}</button>`
    );
}

/** Riadky zhrnutia: poloha, panel, plochy, menič, meranie. @param {Settings} s @param {AppState} state */
function summaryRows(s, state) {
    const guess = '<span class="est">odhad · oprav, keď zistíš</span>';
    const wpExtra =
        state.setupKwp !== null
            ? `<span class="k2">dopočítané z ${kwpText(state.setupKwp)}</span>`
            : state.setupPick.wp === 'guess'
              ? guess
              : '';
    let html = sumRow('lokalita', SETUP_ICONS.poloha, 'Poloha', escapeHtml(s.site.name || '–'));
    html += sumRow(
        'panel',
        SETUP_ICONS.panel,
        'Panel',
        Number.isFinite(s.plant.panelWp) ? `${Math.round(s.plant.panelWp)} Wp` : '–',
        wpExtra,
    );
    s.plant.strings.forEach((x, i) => {
        const kwp = Number.isFinite(s.plant.panelWp) ? kwpText(installedKw({ ...s.plant, strings: [x] })) : '–';
        html += sumRow(
            `roof:${i}`,
            miniCompassSvg(x.azimuthDeg),
            `Plocha ${i + 1}`,
            `${dirName(x.azimuthDeg)} · ${x.tiltDeg}° · ${x.panels} panelov`,
            `<span class="k2">${kwp}</span>`,
        );
    });
    html += sumRow(
        'menic',
        SETUP_ICONS.menic,
        'Menič',
        Number.isFinite(s.plant.acLimitKw) ? kwText(s.plant.acLimitKw) : '–',
        state.setupPick.ac === 'guess' ? guess : '',
    );
    return html + sumRow('meranie', SETUP_ICONS.meranie, 'Živé meranie', s.kiosk ? 'kiosk FusionSolar' : 'bez merania, odhad z predpovede');
}

/** Celkový výkon a výroba za jasného dneška. @param {Settings} s @param {AppState} state */
function heroHtml(s, state) {
    const check = checkSettings(s);
    if (check.kwp === null || !hasSite(s)) return `<div class="big">– kWp</div>`;
    const today = localDateKey(state.now, s.site.timezone);
    const kwh = Math.round(clearDayKwh(s.site, s.plant, today));
    return `<div class="big">${kwpText(check.kwp)}</div><div class="sub">${escapeHtml(s.site.name)} · dnes za jasnej oblohy približne ${kwh} kWh</div>`;
}

/** Hlásenia pod zhrnutím: chyby blokujú uloženie, varovania nie. @param {Settings} s */
function messagesHtml(s) {
    const { errors, warnings } = checkSettings(s);
    return (
        errors.map((e) => `<p class="plant-msg err">${escapeHtml(e)}</p>`).join('') +
        warnings.map((w) => `<p class="plant-msg">${escapeHtml(w)}</p>`).join('')
    );
}

/** Prehľad karty: výzva k sprievodcovi (ukážka), alebo zhrnutie uloženej elektrárne. @param {AppState} state @param {Dom} dom */
function renderHome(state, dom) {
    dom.setupDemo.classList.toggle('hidden', !state.demo);
    dom.setupCta.classList.toggle('hidden', !state.demo);
    dom.setupOverview.classList.toggle('hidden', state.demo);
    dom.setupNote.textContent = state.settingsNote;
    if (state.demo) return;
    const saved = { site: state.site, plant: state.plant, kiosk: state.kiosk };
    writeHtml(dom.setupHero, heroHtml(saved, state), 'setupHero');
    writeHtml(dom.setupRows, summaryRows(saved, state), 'setupRows');
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
    const dirs = found.plant.strings.map((x) => dirName(x.azimuthDeg).toLowerCase()).join(', ');
    const meta = `${found.plant.strings.length === 1 ? '1 plocha' : `${found.plant.strings.length} plochy`} (${dirs}) · ${totalPanels(found)} panelov · menič ${kwText(found.plant.acLimitKw)}${found.kiosk ? ' · so živým meraním' : ''}`;
    writeHtml(
        dom.wzLinkPreview,
        `<span class="lbl">V odkaze je</span><div class="name"><b>${escapeHtml(found.site.name)}</b><span class="meta">${kwpText(installedKw(found.plant))}</span></div><div class="meta">${escapeHtml(meta)}</div>`,
        'wzLinkPreview',
    );
}

/** @param {AppState['geo']} geo */
function geoHtml(geo) {
    if (geo.status === 'loading') return '<p class="geo-status">Hľadám…</p>';
    if (geo.status === 'error') return '<p class="geo-status">Vyhľadávanie teraz nefunguje. Skús to znova alebo zadaj súradnice.</p>';
    if (geo.status !== 'done') return '';
    if (!geo.results.length) return '<p class="geo-status">Nič som nenašiel. Skús väčšie mesto v okolí alebo súradnice.</p>';
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
    if (!hasSite(s)) return '';
    const today = localDateKey(state.now, s.site.timezone);
    const sun = sunTimes(s.site, today);
    const time = (/** @type {number | null} */ m) => (m === null ? '–' : minutesToTimeStr(m));
    const [, month, day] = today.split('-').map(Number);
    return (
        `<div class="place-card"><div class="name"><b>${escapeHtml(s.site.name)}</b><span class="meta">dnes, ${day}. ${month}.</span></div>` +
        `<div class="sunline"><span>${time(sun.rise)}<small>východ</small></span>` +
        `<svg viewBox="0 0 120 38" aria-hidden="true"><line class="ground" x1="2" y1="34" x2="118" y2="34"/><path class="arc" d="M 4 34 Q 60 -18 116 34"/><circle class="sun" cx="60" cy="9" r="5"/></svg>` +
        `<span class="end">${time(sun.set)}<small>západ</small></span></div>` +
        `<div class="meta">${escapeHtml(siteMetaText(s.site))}</div></div>`
    );
}

/** @param {AppState} state @param {Settings} draft @param {Dom} dom */
function renderLokalita(state, draft, dom) {
    writeHtml(dom.wzGeo, geoHtml(state.geo), 'wzGeo');
    writeHtml(dom.wzPlaceCard, placeCardHtml(draft, state), 'wzPlaceCard');
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
    dom.wzWpGuess.textContent = `Počítam s bežnými ${SETUP.guessPanelWp} Wp. V zhrnutí to bude označené ako odhad, kedykoľvek to opravíš.`;
}

/** Pás „koľko energie to dá oproti najlepšiemu“. @param {number} share 0-1 @param {string} what */
function qualityHtml(share, what) {
    const pct = Math.round(share * 100);
    const [label, tier] =
        share >= 0.95 ? ['Výborné', 'green'] : share >= 0.85 ? ['Dobré', 'green'] : share >= 0.7 ? ['Slušné', 'amber'] : ['Slabšie', 'red'];
    return (
        `<div class="quality"><div class="row"><b>${label}</b><span>~${pct} % najlepšieho ${what}</span></div>` +
        `<div class="meter"><i class="tier-${tier}" style="width:${pct}%"></i></div></div>`
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
    const n = Number.isFinite(x.panels) ? x.panels : 0;
    const line =
        state.setupKwp !== null
            ? `${n} panelov · výkon panelu dopočítam z ${kwpText(state.setupKwp)}, keď budú spočítané všetky plochy`
            : Number.isFinite(draft.plant.panelWp)
              ? `${n} × ${fieldText(draft.plant.panelWp)} Wp = <b>${kwpText(installedKw({ ...draft.plant, strings: [x] }))}</b>`
              : '';
    writeHtml(dom.wzPanelsKwp, line, 'wzPanelsKwp');
}

/** @param {AppState} state @param {Settings} draft @param {Dom} dom */
function renderDalsia(state, draft, dom) {
    const many = draft.plant.strings.length > 1;
    const rows = draft.plant.strings
        .map((x, i) => {
            const kwp = Number.isFinite(draft.plant.panelWp) ? ` · ${kwpText(installedKw({ ...draft.plant, strings: [x] }))}` : '';
            return (
                `<div class="roof-row">${miniCompassSvg(x.azimuthDeg)}<span class="t"><b>Plocha ${i + 1} · ${dirName(x.azimuthDeg)}</b>` +
                `<span>${x.tiltDeg}° · ${x.panels} panelov${kwp}</span></span>` +
                `<button type="button" class="mini-act" data-setup-roof-edit="${i}">Upraviť</button>` +
                (many ? `<button type="button" class="mini-act" data-setup-roof-del="${i}">Odstrániť</button>` : '') +
                `</div>`
            );
        })
        .join('');
    writeHtml(dom.wzRoofs, rows, 'wzRoofs');
    dom.wzRoofAdd.classList.toggle('hidden', draft.plant.strings.length >= SETTINGS_LIMITS.maxStrings);
    writeHtml(dom.wzDerived, derivedHtml(state, draft), 'wzDerived');
}

/** Výkon panelu dopočítaný z celkového výkonu - ukáže sa, keď sú spočítané všetky plochy. @param {AppState} state @param {Settings} draft */
function derivedHtml(state, draft) {
    if (state.setupKwp === null) return '';
    const n = totalPanels(draft);
    const wp = draft.plant.panelWp;
    const L = SETTINGS_LIMITS.panelWp;
    if (Number.isFinite(wp) && wp >= L.min && wp <= L.max)
        return `<p class="plant-msg">Spolu ${n} panelov a ${kwpText(state.setupKwp)}, teda ${Math.round(wp)} Wp na panel.</p>`;
    return `<p class="plant-msg err">Z ${kwpText(state.setupKwp)} a ${n} panelov vychádza ${Number.isFinite(wp) ? Math.round(wp) : '–'} Wp na panel, to nie je možné (${L.min} až ${L.max} Wp). Skontroluj počty panelov alebo celkový výkon.</p>`;
}

/** @param {AppState} state @param {Settings} draft @param {Dom} dom */
function renderMenic(state, draft, dom) {
    const ac = state.settingsDraft.plant.acLimitKw;
    const kwp = Number.isFinite(draft.plant.panelWp) ? installedKw(draft.plant) : 0;
    const top = Math.max(kwp, Number.isFinite(ac) ? ac : 0) * 1.05 || 1;
    const ratio = kwp / ac;
    const msg = !Number.isFinite(ratio)
        ? ''
        : ratio > SETTINGS_LIMITS.dcAcWarnRatio
          ? `<p class="plant-msg">Panely majú viac, než menič zvládne. Za jasných dní bude menič orezávať špičky na ${kwText(ac)}.</p>`
          : ratio > 1
            ? '<p class="plant-msg ok">Menič je o trochu menší než panely. To je bežné a skoro nič to nestojí.</p>'
            : '<p class="plant-msg ok">Menič zvládne plný výkon panelov.</p>';
    const bar = (/** @type {string} */ label, /** @type {number} */ v, /** @type {string} */ text, /** @type {string} */ cls) =>
        `<div class="cb"><span>${label}</span><span class="track"><i class="${cls}" style="width:${((v / top) * 100).toFixed(1)}%"></i></span><b>${text}</b></div>`;
    writeHtml(
        dom.wzAcBars,
        bar('Panely', kwp, kwpText(kwp), 'pv') +
            bar('Menič', Number.isFinite(ac) ? ac : 0, Number.isFinite(ac) ? kwText(ac) : '–', 'ac') +
            msg,
        'wzAcBars',
    );
    const pick = effectivePick(state.setupPick.ac, ac, SETUP.acChoices);
    writeHtml(dom.wzAcChips, chipsHtml(SETUP.acChoices, ac, pick, 'setup-ac', 'kW'), 'wzAcChips');
    dom.wzAcOther.classList.toggle('hidden', pick !== 'other');
    dom.wzAcGuess.classList.toggle('hidden', pick !== 'guess');
}

/** @param {AppState} state @param {Dom} dom */
function renderMeranie(state, dom) {
    dom.wzLiveYes.setAttribute('aria-pressed', String(state.setupLive));
    dom.wzLiveNo.setAttribute('aria-pressed', String(!state.setupLive));
    dom.wzKioskBlock.classList.toggle('hidden', !state.setupLive);
    const kiosk = state.settingsDraft.kiosk;
    const ok = !!kioskApiUrl(kiosk);
    dom.wzKioskNote.classList.toggle('err', !!kiosk && !ok);
    dom.wzKioskNote.classList.toggle('hidden', !kiosk);
    dom.wzKioskNote.textContent = ok
        ? 'Vyzerá to ako kiosk FusionSolar. Po uložení overím, či odpovedá.'
        : 'Toto nie je odkaz na kiosk FusionSolar. Skopíruj ho v appke FusionSolar pri zdieľaní elektrárne cez kiosk.';
}

/** @param {AppState} state @param {Settings} draft @param {Dom} dom */
function renderSuhrn(state, draft, dom) {
    const html =
        `<div class="setup-hero">${heroHtml(draft, state)}</div><div class="sum-list">${summaryRows(draft, state)}</div>` +
        `<div class="plant-msgs">${derivedHtml(state, draft).includes(' err') ? derivedHtml(state, draft) : messagesHtml(draft)}</div>`;
    writeHtml(dom.wzSummary, html, 'wzSummary');
}

// ---- Hlavička, polia a tlačidlá sprievodcu ---------------------------------------

/** Titulok a úvodná veta obrazovky; niektoré závisia od toho, čo už človek zadal. @param {AppState} state @param {Settings} draft @param {SetupStep} step */
function textsFor(state, draft, step) {
    if (step === 'panel' && state.setupKwp !== null)
        return {
            title: 'Aký výkon má celá elektráreň?',
            lead: 'Nájdeš ho v zmluve alebo na faktúre, napríklad „10,44 kWp“. Výkon jedného panelu dopočítam, keď spočítame panely na strechách.',
        };
    if (step === 'dalsia' && draft.plant.strings.length >= SETTINGS_LIMITS.maxStrings)
        return { title: 'Tri plochy sú maximum', lead: 'Viac plôch appka nepočíta.' };
    if (step === 'menic') {
        const kwp = Number.isFinite(draft.plant.panelWp) ? `Panely majú spolu ${kwpText(installedKw(draft.plant))}. ` : '';
        return { title: TEXTS.menic.title, lead: `${kwp}Výkon meniča je na jeho štítku alebo v zmluve, napríklad SUN2000-10KTL je 10 kW.` };
    }
    return TEXTS[step];
}

/** @param {AppState} state @param {Settings} draft @param {SetupStep} step @param {number} roof @param {Dom} dom */
function renderHead(state, draft, step, roof, dom) {
    const section = setupSection(step);
    const edit = state.setupReturn !== null;
    const name = section >= 0 ? SETUP_SECTIONS[section].name : '';
    dom.wzStep.textContent = edit
        ? `Úprava · ${name}`
        : section >= 0
          ? `Krok ${section + 1} z ${SETUP_SECTIONS.length} · ${name}`
          : step === 'odkaz'
            ? 'Nastavenie z odkazu'
            : 'Moja elektráreň';
    dom.wzClose.setAttribute('aria-label', edit ? 'Zrušiť úpravu' : 'Zavrieť sprievodcu');
    const prog =
        edit || section < 0
            ? ''
            : SETUP_SECTIONS.map((_, i) => `<i class="${i < section ? 'done' : i === section ? 'now' : ''}"></i>`).join('');
    writeHtml(dom.wzProg, prog, 'wzProg');
    const n = draft.plant.strings.length;
    const onRoof = /** @type {readonly string[]} */ (ROOF_STEPS).includes(step);
    dom.wzSub.textContent = onRoof ? `Plocha ${roof + 1}${n > 1 ? ` z ${n}` : ''}` : '';
    const t = textsFor(state, draft, step);
    dom.wzTitle.textContent = t.title;
    dom.wzLead.textContent = t.lead;
    dom.wzLead.classList.toggle('hidden', !t.lead);
    dom.wzRoofTabs.classList.toggle('hidden', !edit || !onRoof);
    for (const b of dom.wzRoofTabs.children)
        b.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (b).dataset.setupTab === step));
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

/** Tlačidlá dole: čo robí „Ďalej“ a či sa dá, rozhoduje interactions.js podľa toho istého stavu.
 * @param {AppState} state @param {Settings} draft @param {SetupStep} step @param {boolean} ok @param {Dom} dom */
function renderFoot(state, draft, step, ok, dom) {
    const ret = state.setupReturn;
    const saved = { site: state.site, plant: state.plant, kiosk: state.kiosk };
    /** @type {Partial<Record<SetupStep, string>>} */
    const labels = {
        start: 'Začať',
        odkaz: 'Pozrieť a prevziať',
        dalsia: draft.plant.strings.length >= SETTINGS_LIMITS.maxStrings ? 'Ďalej' : 'Nie, to je všetko',
        meranie: state.setupLive ? 'Ďalej' : 'Preskočiť',
        suhrn: 'Uložiť a prepočítať',
    };
    const nextLabel = ret === 'suhrn' ? 'Späť na zhrnutie' : ret === 'prehlad' ? 'Uložiť zmenu' : labels[step] || 'Ďalej';
    dom.wzNext.textContent = nextLabel;
    dom.wzNext.disabled = !ok || (ret === 'prehlad' && !state.demo && sameSettings(draft, saved));
    dom.wzBack.textContent = ret === 'prehlad' ? 'Zrušiť' : step === 'start' ? 'Neskôr' : 'Späť';
    dom.wzBack.classList.toggle('hidden', ret === 'suhrn');
}

/** Je obrazovka hotová, dá sa z nej ísť ďalej? Zdieľa ju render aj interactions.js. @param {AppState} state */
export function setupReady(state) {
    const step = state.setupStep;
    if (!step) return false;
    if (step === 'odkaz') return !!settingsFromLink(state.setupLink);
    const roof = Math.min(state.setupRoof, state.settingsDraft.plant.strings.length - 1);
    return setupStepOk({ step, roof }, setupDraft(state), { totalKwp: state.setupKwp, live: state.setupLive });
}

/** @param {AppState} state @param {Dom} dom */
function renderWizard(state, dom) {
    const step = /** @type {SetupStep} */ (state.setupStep);
    const draft = setupDraft(state);
    const roof = Math.max(0, Math.min(state.setupRoof, draft.plant.strings.length - 1));
    renderHead(state, draft, step, roof, dom);
    for (const [key, el] of Object.entries(dom.wzScreens)) el.classList.toggle('hidden', key !== step);
    writeFields(state, roof, dom);
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
        suhrn: () => renderSuhrn(state, draft, dom),
    };
    screens[step]?.();
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
    const live = s.kiosk ? ' · so živým meraním' : '';
    const replaces = state.demo ? '' : ' Nahradí tvoje doterajšie nastavenie.';
    dom.importOfferText.textContent = `${settingsHint(s, false)}${live}.${replaces}`;
}
