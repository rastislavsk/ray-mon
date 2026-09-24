// Karta Nastavenie, položka „Moja elektráreň“: formulár s lokalitou a zostavou panelov.
// Hodnoty polí sa prepíšu len pri zmene settingsRev - inak by render prepisoval to, čo
// človek práve píše. Všetko ostatné (súčty, hlásenia, tlačidlá) sa odvíja od rozpísaného
// nastavenia v stave.

import { SETTINGS_LIMITS } from '../../shared/config.js';
import { escapeHtml } from '../../shared/format.js';
import { checkSettings, kwpText, sameSettings, settingsHint, siteMetaText } from '../../shared/settings.js';
import { changed, writeHtml } from '../memo.js';

/** Číslo do poľa formulára; neplatné ostane prázdne. @param {number} n */
const fieldText = (n) => (Number.isFinite(n) ? String(n) : '');

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
function writeFields(state, dom) {
    const { site, plant } = state.settingsDraft;
    dom.setPlace.value = site.name;
    dom.setLat.value = fieldText(site.lat);
    dom.setLon.value = fieldText(site.lon);
    dom.setWp.value = fieldText(plant.panelWp);
    dom.setAc.value = fieldText(plant.acLimitKw);
    dom.setKiosk.value = state.settingsDraft.kiosk;
    dom.setImport.value = '';
    plant.strings.forEach((x, i) => {
        const r = dom.setRoofs[i];
        r.panels.value = fieldText(x.panels);
        r.tilt.value = fieldText(x.tiltDeg);
    });
}

/** @param {import('../state.js').AppState['geo']} geo */
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

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
export function renderNastavenie(state, dom) {
    const saved = { site: state.site, plant: state.plant, kiosk: state.kiosk };
    const draft = state.settingsDraft;
    dom.settingsDemo.classList.toggle('hidden', !state.demo);
    dom.setHint.textContent = settingsHint(saved, state.demo);
    if (changed('settingsRev', state.settingsRev)) writeFields(state, dom);

    writeHtml(dom.setGeo, geoHtml(state.geo), 'setGeo');
    dom.setPlaceMeta.textContent = siteMetaText(draft.site);
    dom.setKioskMeta.textContent = draft.kiosk ? 'Po uložení overím, či kiosk odpovedá.' : 'Bez odkazu ukážem len predpoveď.';

    const count = draft.plant.strings.length;
    dom.setRoofs.forEach((r, i) => {
        const x = draft.plant.strings[i];
        r.box.classList.toggle('hidden', !x);
        r.del.classList.toggle('hidden', count < 2);
        if (!x) return;
        r.kwp.textContent =
            Number.isFinite(x.panels) && Number.isFinite(draft.plant.panelWp) ? kwpText((x.panels * draft.plant.panelWp) / 1000) : '–';
        r.tiltOut.textContent = `${x.tiltDeg}°`;
        for (const b of r.compass) b.setAttribute('aria-pressed', String(Number(b.dataset.az) === x.azimuthDeg));
    });
    dom.setRoofAdd.classList.toggle('hidden', count >= SETTINGS_LIMITS.maxStrings);

    const check = checkSettings(draft);
    dom.setTotalKwp.textContent = check.kwp === null ? '– kWp' : kwpText(check.kwp);
    dom.setTotalMeta.textContent = `${check.panels} panelov · menič ${Number.isFinite(draft.plant.acLimitKw) ? String(draft.plant.acLimitKw).replace('.', ',') : '–'} kW`;
    writeHtml(
        dom.setMsgs,
        check.errors.map((e) => `<p class="plant-msg err">${escapeHtml(e)}</p>`).join('') +
            check.warnings.map((w) => `<p class="plant-msg">${escapeHtml(w)}</p>`).join(''),
        'setMsgs',
    );
    dom.setSave.disabled = check.errors.length > 0 || (!state.demo && sameSettings(draft, saved));
    dom.setNote.textContent = state.settingsNote;
    dom.setImportNote.textContent = state.importNote;
}

/**
 * Ponuka prevziať nastavenie z odkazu. Je mimo kariet, aby ju bolo vidno hneď po otvorení
 * odkazu, nech je appka na ktorejkoľvek karte.
 * @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom
 */
export function renderImportOffer(state, dom) {
    const s = state.incoming;
    dom.importOffer.classList.toggle('hidden', !s);
    if (!s) return;
    const live = s.kiosk ? ' · so živým meraním' : '';
    const replaces = state.demo ? '' : ' Nahradí tvoje doterajšie nastavenie.';
    dom.importOfferText.textContent = `${settingsHint(s, false)}${live}.${replaces}`;
}
