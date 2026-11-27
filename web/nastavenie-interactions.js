// Poslucháče karty Nastavenie. Sprievodcu (aj riadky prehľadu, ktoré otvárajú jeho
// kroky) obsluhuje web/setup-wiring.js. Tu je len to, čím sa
// appka líši: krok späť cez jej históriu, karta po odložení panelov, Escape a ponuka
// prevziať nastavenie z otvoreného odkazu. Zbaľovanie sekcií a sekcie Čo máš doma, Oznámenia,
// Vzhľad a Appka: spotrebiče, ranný plán dňa, tón hlášok, živá obloha, Zdieľať appku a Vymazať údaje.

import { VOICES, WORKER_BOJLER_URL, WORKER_KLIMA_URL, WORKER_SPOTREBIC_URL, ZASUVKA } from '../shared/config.js';
import { posunPrahy } from '../shared/bojler.js';
import { posunHranicu } from '../shared/bojler-voda.js';
import { ADRESA_V_SIETI, adresaTeplomera, skriptBojlera } from '../shared/bojler-skript.js';
import { skriptKlimy } from '../shared/klima-skript.js';
import { skriptZasuvky } from '../shared/zasuvka-skript.js';
import { backAction } from '../shared/setup-flow.js';
import { applySettings, initSetupWiring, runSetupAction } from './setup-wiring.js';
import { prepniSpotrebic } from '../shared/doma.js';
import { NS_OKNA } from '../shared/nastavenie-doma.js';
import { vypniOznamAuta, zmenOznamAuta } from './auto-nabija.js';
import { zmenOznamBojlera } from './bojler-oznam.js';
import { zmenOznamZasuvky } from './zasuvka-oznam.js';
import { bojlerPecat, ulozHranicuBojlera, zdielajPecat } from './data.js';
import { nastavOznamenia, vypniOznamenia } from './oznamenia.js';
import { zacniOdznova } from './ucenie.js';
import { clearStored, saveBojlerPrahy, saveDoma, saveKlimaNast, saveLook, saveTeplomer } from './storage.js';
import { stepBack } from './nav-back.js';
import { initSheet } from './sheet.js';
import { NS_FOLDS, panelChange } from './state.js';

/** @typedef {import('./state.js').Store} Store */
/** @typedef {import('./dom.js').Dom} Dom */

/**
 * @param {Store} store @param {Dom} dom @param {() => Promise<void>} refresh obnova dát, tá istá ako pri štarte
 */
export function initNastavenie(store, dom, refresh) {
    const app = {
        back: (/** @type {import('../shared/setup-flow.js').SetupPatch} */ patch) => stepBack(store, patch),
        refresh,
        // „Teraz nie, ukáž predpoveď“ otvorí kartu 7 dní.
        skip: () => panelChange(store.get().panel, '7dni'),
    };
    initSetupWiring(store, app, { ...dom, root: dom.setupRoot });
    // Escape v sprievodcovi je to isté ako jeho tlačidlo Späť: o obrazovku späť, z prvej do prehľadu.
    document.addEventListener('keydown', (e) => {
        const s = store.get();
        if (e.key !== 'Escape' || e.defaultPrevented || s.panel !== 'nastavenie' || !s.setupStep) return;
        e.preventDefault();
        runSetupAction(store, app, backAction(s));
    });
    dom.importAccept.addEventListener('click', () => {
        const s = store.get();
        if (!s.incoming) return;
        // Kto odkaz otvoril ako prvý, otázku na polohu už nepotrebuje.
        applySettings(store, s.incoming, refresh, { incoming: null, ...(s.known === 'nic' ? { setupStep: null } : {}) });
    });
    dom.importDecline.addEventListener('click', () => store.setState({ incoming: null, linkError: null }));
    initFolds(store, dom);
    initDoma(store, dom);
    initBojler(store, dom);
    initKlima(store, dom);
    initZasuvka(store, dom);
    initOkno(store, dom);
    initLook(store, dom);
    initOznam(store, dom);
    initAppSheets(store, dom);
}

/**
 * Zbaliteľné sekcie (Elektráreň, Čo máš doma, Oznámenia, Vzhľad). Rozbalenie je krok navigácie, zbalenie
 * nadpisom ten istý krok ako tlačidlo Späť - inak by sekcia ostala v histórii a Späť by ju znovu rozbalilo.
 * @param {Store} store @param {Dom} dom
 */
function initFolds(store, dom) {
    for (const f of dom.nsFolds) {
        const key = NS_FOLDS.find((k) => k === f.key);
        if (!key) continue;
        f.head.addEventListener('click', () => {
            if (store.get().nsOpen === key) stepBack(store, { nsOpen: null });
            else store.setState({ nsOpen: key });
        });
    }
}

/** Appka je v koreni, tam má aj service worker (sw.js). */
const APP = './';

/**
 * Čo máš doma (docs/navrhy/nastavenie-co-mas-doma.html): prepínač vec pridá či uberie a uloží (doma-v1), riadok pripojenia
 * otvorí okno veci (krok navigácie). Vypnutá vec vypne aj oznámenia tohto telefónu, ktoré k nej patria (P1) - inak by
 * chodili ďalej a vypínač by nebolo kde nájsť. Oznámenie o konci platí pre všetky zásuvky, preto sa vypne, len keď
 * zapnutý neostal žiadny spotrebič so zásuvkou.
 * @param {Store} store @param {Dom} dom
 */
function initDoma(store, dom) {
    dom.nsDoma.addEventListener('click', (e) => {
        const el = e.target instanceof Element ? e.target : null;
        const okno = el?.closest('[data-ns-okno]');
        const sheet = okno instanceof HTMLElement && NS_OKNA.find((o) => o === okno.dataset.nsOkno);
        const nic = /** @type {const} */ ({ stav: 'nic', text: '', schranka: false });
        if (sheet) return store.setState({ appSheet: sheet, ...(sheet.startsWith('zasuvka:') ? { zasuvkaSkript: nic } : {}) });
        const btn = el?.closest('[data-device]');
        if (!(btn instanceof HTMLButtonElement) || btn.disabled || !btn.dataset.device) return;
        const id = btn.dataset.device;
        const doma = prepniSpotrebic(store.get().doma, id);
        saveDoma(doma);
        store.setState({ doma });
        if (!doma.includes(id)) vypniOznamyVeci(store, id, doma);
    });
}

/**
 * Oznámenia vypnutej veci `id` (P1). @param {Store} store @param {string} id @param {readonly string[]} doma voľba po vypnutí
 */
function vypniOznamyVeci(store, id, doma) {
    const s = store.get();
    if (id === 'auto') vypniOznamAuta(store);
    if (id === 'bojler' && s.bojlerOznam) zmenOznamBojlera(store, false);
    const zasuvky = s.zasuvky ?? {};
    const inaZasuvka = ZASUVKA.veci.some((v) => v !== id && doma.includes(v) && !!zasuvky[v]);
    if (ZASUVKA.veci.includes(id) && s.zasuvkaOznam && !inaZasuvka) zmenOznamZasuvky(store, false);
}

/**
 * Okno veci: prepínače oznámení (P3) - tie isté ako v paneloch karty Teraz. Zatvorenie (krížik, Escape, ťuknutie vedľa)
 * je ten istý krok ako tlačidlo Späť.
 * @param {Store} store @param {Dom} dom
 */
function initOkno(store, dom) {
    initSheet(dom.nsOkno, () => stepBack(store, { appSheet: null }));
    dom.nsOknoOznam.addEventListener('click', (e) => {
        const btn = e.target instanceof Element ? e.target.closest('[data-oznam]') : null;
        if (!(btn instanceof HTMLButtonElement) || btn.disabled) return;
        const s = store.get();
        const key = btn.dataset.oznam;
        if (key === 'bojler') zmenOznamBojlera(store, !s.bojlerOznam);
        else if (key === 'zasuvka') zmenOznamZasuvky(store, !s.zasuvkaOznam);
        else if (key === 'z' || key === 'k') zmenOznamAuta(store, key, !(s.autoOznam ?? { z: false, k: false })[key]);
    });
}

/**
 * Bojler na prebytky: prahy (uložia sa, bojler-v1), teplomer (prepínač a adresa, teplomer-v1; heslo sa len prečíta
 * z poľa) a „Skopíruj skript“ - appka si od Workera vypýta pečať pre zásuvku, poskladá skript a dá ho do schránky.
 * Kde schránka nie je, skript ukáže v poli na ručné skopírovanie.
 * @param {Store} store @param {Dom} dom
 */
function initBojler(store, dom) {
    dom.nsBojlerPrahy.addEventListener('click', (e) => {
        const btn = e.target instanceof Element ? e.target.closest('[data-bojler-prah]') : null;
        if (!(btn instanceof HTMLElement)) return;
        const ktory = btn.dataset.bojlerPrah === 'vypKw' ? 'vypKw' : 'zapKw';
        const bojlerPrahy = posunPrahy(store.get().bojlerPrahy, ktory, btn.dataset.smer === '-1' ? -1 : 1);
        saveBojlerPrahy(bojlerPrahy);
        // Starý skript má staré prahy - pole s ním zmizne.
        store.setState({ bojlerPrahy, bojlerSkript: { stav: 'nic', text: '', schranka: false } });
    });
    /** Starý skript nemá nový teplomer - pole s ním zmizne. @param {import('../shared/nastavenie-bojler.js').Teplomer} teplomer */
    const ulozTeplomer = (teplomer) => {
        saveTeplomer(teplomer);
        store.setState({ teplomer, bojlerSkript: { stav: 'nic', text: '', schranka: false } });
    };
    dom.nsTeplomer.addEventListener('click', () => {
        const t = store.get().teplomer;
        ulozTeplomer({ ...t, on: !t.on });
    });
    dom.nsTeplomerIp.addEventListener('change', () => {
        const ip = dom.nsTeplomerIp.value.trim();
        if (ip !== store.get().teplomer.ip) ulozTeplomer({ ...store.get().teplomer, ip });
    });
    // Hranica teploty (docs/navrhy/bojler-hranica.html): drží ju Worker, zásuvka ju dostane pri ďalšom hlásení.
    dom.nsHranica.addEventListener('click', async (e) => {
        const btn = e.target instanceof Element ? e.target.closest('[data-hranica]') : null;
        const { zdroj, bojler, bojlerHranica } = store.get();
        if (!(btn instanceof HTMLElement) || !zdroj || !bojler || bojlerHranica === 'uklada') return;
        const hranica = posunHranicu(bojler.hranica ?? null, btn.dataset.hranica === '-1' ? -1 : 1);
        store.setState({ bojler: { ...bojler, hranica }, bojlerHranica: 'uklada' });
        const r = await ulozHranicuBojlera(zdroj.pecat, hranica);
        const teraz = store.get().bojler;
        store.setState(
            r
                ? { bojler: r.bojler ?? teraz, bojlerHranica: null }
                : { bojler: teraz && { ...teraz, hranica: bojler.hranica ?? null }, bojlerHranica: 'chyba' },
        );
    });
    // Učenie z histórie: odteraz sa appka učí len z nových dní (web/ucenie.js).
    dom.nsUcenieOdznova.addEventListener('click', () => void zacniOdznova(store));
    dom.nsBojlerSkript.addEventListener('click', async () => {
        const { zdroj, bojlerPrahy, teplomer } = store.get();
        if (!zdroj) return;
        const sTeplomerom = teplomer.on ? { ip: dom.nsTeplomerIp.value, heslo: dom.nsTeplomerHeslo.value } : null;
        if (sTeplomerom && !adresaTeplomera(sTeplomerom)) {
            store.setState({ bojlerSkript: { stav: 'teplomer', text: '', schranka: false } });
            return;
        }
        store.setState({ bojlerSkript: { stav: 'robim', text: '', schranka: false } });
        const pecat = await bojlerPecat(zdroj.pecat);
        const text = pecat && skriptBojlera({ url: WORKER_BOJLER_URL, pecat, ...bojlerPrahy, teplomer: sTeplomerom });
        if (!text) {
            store.setState({ bojlerSkript: { stav: 'chyba', text: '', schranka: false } });
            return;
        }
        const schranka = await navigator.clipboard?.writeText(text).then(
            () => true,
            () => false,
        );
        store.setState({ bojlerSkript: { stav: 'hotovo', text, schranka: schranka === true } });
    });
}

/**
 * Klimatizácia Daikin (docs/navrhy/klima-daikin.html): adresa sa uloží pri opustení poľa (klima-v1), „Skopíruj skript“
 * si od Workera vypýta pečať (tá istá ako pre zásuvku bojlera), poskladá skript na Shelly a dá ho do schránky. Kde
 * schránka nie je, skript ukáže v poli na ručné skopírovanie.
 * @param {Store} store @param {Dom} dom
 */
function initKlima(store, dom) {
    dom.nsKlimaIp.addEventListener('change', () => {
        const ip = dom.nsKlimaIp.value.trim();
        if (ip === store.get().klimaNast.ip) return;
        saveKlimaNast({ ip });
        // Starý skript má starú adresu - pole s ním zmizne.
        store.setState({ klimaNast: { ip }, klimaSkript: { stav: 'nic', text: '', schranka: false } });
    });
    dom.nsKlimaSkript.addEventListener('click', async () => {
        const { zdroj } = store.get();
        if (!zdroj) return;
        const ip = dom.nsKlimaIp.value.trim();
        if (!ADRESA_V_SIETI.test(ip)) {
            store.setState({ klimaSkript: { stav: 'adresa', text: '', schranka: false } });
            return;
        }
        if (ip !== store.get().klimaNast.ip) {
            saveKlimaNast({ ip });
            store.setState({ klimaNast: { ip } });
        }
        store.setState({ klimaSkript: { stav: 'robim', text: '', schranka: false } });
        const pecat = await bojlerPecat(zdroj.pecat);
        const text = pecat && skriptKlimy({ url: WORKER_KLIMA_URL, pecat, ip });
        if (!text) {
            store.setState({ klimaSkript: { stav: 'chyba', text: '', schranka: false } });
            return;
        }
        const schranka = await navigator.clipboard?.writeText(text).then(
            () => true,
            () => false,
        );
        store.setState({ klimaSkript: { stav: 'hotovo', text, schranka: schranka === true } });
    });
}

/**
 * Zásuvka Shelly spotrebiča (docs/navrhy/pracka-zasuvka.html): spotrebič je ten, ktorého okno je otvorené. „Skopíruj
 * skript“ si od Workera vypýta pečať (tá istá ako pre zásuvku bojlera), poskladá skript a dá ho do schránky. Kde schránka
 * nie je, skript ukáže v poli na ručné skopírovanie. Pole so skriptom zmizne pri každom otvorení okna (initDoma) - mohlo by
 * byť pre iný spotrebič.
 * @param {Store} store @param {Dom} dom
 */
function initZasuvka(store, dom) {
    dom.nsZasuvkaSkript.addEventListener('click', async () => {
        const { zdroj, appSheet } = store.get();
        const zasuvkaVec = appSheet?.startsWith('zasuvka:') ? appSheet.slice('zasuvka:'.length) : null;
        if (!zdroj || !zasuvkaVec) return;
        store.setState({ zasuvkaSkript: { stav: 'robim', text: '', schranka: false } });
        const pecat = await bojlerPecat(zdroj.pecat);
        const text = pecat && skriptZasuvky({ url: WORKER_SPOTREBIC_URL, pecat, vec: zasuvkaVec });
        if (!text) {
            store.setState({ zasuvkaSkript: { stav: 'chyba', text: '', schranka: false } });
            return;
        }
        const schranka = await navigator.clipboard?.writeText(text).then(
            () => true,
            () => false,
        );
        store.setState({ zasuvkaSkript: { stav: 'hotovo', text, schranka: schranka === true } });
    });
}

/**
 * Oznámenia: prepínač a hodina. Zapnutie, vypnutie a uloženie
 * (web/oznamenia.js), voľba platí v oboch.
 * @param {Store} store @param {Dom} dom
 */
function initOznam(store, dom) {
    /** @param {Partial<import('../shared/oznamenia.js').Oznamenia>} zmena */
    const nastav = async (zmena) => {
        const s = store.get();
        // Kým sa zapína, ďalšia zmena by sa po dobehnutí prepísala starou voľbou.
        if (s.oznamStav === 'caka') return;
        if (zmena.on || (zmena.hour !== undefined && s.oznamenia.on)) store.setState({ oznamStav: 'caka' });
        store.setState(await nastavOznamenia(s.oznamenia, zmena, { app: APP, timeZone: s.site.timezone }));
    };
    dom.nsOznam.addEventListener('click', () => nastav({ on: !store.get().oznamenia.on }));
    dom.nsOznamHour.addEventListener('click', (e) => {
        const btn = e.target instanceof Element ? e.target.closest('[data-hour]') : null;
        if (btn instanceof HTMLElement) nastav({ hour: Number(btn.dataset.hour) });
    });
}

/**
 * Vzhľad (vzhlad-v1): tón, živá obloha len tejto. Ukladá sa len
 * zmena.
 * @param {Store} store @param {Dom} dom
 */
function initLook(store, dom) {
    /** @param {Partial<Pick<import('./state.js').AppState, 'voice' | 'liveSky'>>} patch */
    const look = (patch) => {
        saveLook(patch);
        store.setState(patch);
    };
    dom.nsLiveSky.addEventListener('click', () => look({ liveSky: !store.get().liveSky }));
    dom.nsVoice.addEventListener('click', (e) => {
        const btn = e.target instanceof Element ? e.target.closest('[data-voice]') : null;
        const voice = btn instanceof HTMLElement && VOICES.find((v) => v === btn.dataset.voice);
        if (voice) look({ voice });
    });
}

/**
 * Okná sekcie Appka. Otvorenie je krok navigácie, zatvorenie (krížik, Escape, ťuknutie vedľa, Nechať
 * tak) ten istý krok ako tlačidlo Späť. Vymazať údaje po potvrdení zmaže všetko uložené
 * a obnoví stránku - appka naštartuje ako pri prvom otvorení. Adresu treba vyčistiť tiež: nesie uložené nastavenie a appka by ho po obnovení ponúkla prevziať.
 * @param {Store} store @param {Dom} dom
 */
function initAppSheets(store, dom) {
    const close = () => stepBack(store, { appSheet: null });
    // Pečať do odkazu platí len pár dní, preto si ju okno pri každom otvorení pýta nanovo.
    const bezMerania = { shareKiosk: false, sharePecat: null, shareKioskFail: false };
    dom.nsShare.addEventListener('click', () => store.setState({ appSheet: 'share', ...bezMerania }));
    dom.nsReset.addEventListener('click', () => store.setState({ appSheet: 'reset' }));
    initSheet(dom.nsShareSheet, close);
    initSheet(dom.nsResetSheet, close);
    dom.nsResetCancel.addEventListener('click', close);
    dom.nsShareSettings.addEventListener('change', () => store.setState({ shareSettings: dom.nsShareSettings.checked }));
    dom.nsShareKiosk.addEventListener('change', async () => {
        const { zdroj } = store.get();
        if (!dom.nsShareKiosk.checked || !zdroj) return store.setState(bezMerania);
        store.setState({ ...bezMerania, shareKiosk: true });
        const sharePecat = await zdielajPecat(zdroj.pecat);
        // Kým Worker odpovedal, človek mohol voľbu zrušiť alebo okno zavrieť a otvoriť znova.
        const s = store.get();
        if (!s.shareKiosk || s.zdroj?.pecat !== zdroj.pecat) return;
        store.setState(sharePecat ? { sharePecat } : { ...bezMerania, shareKioskFail: true });
    });
    dom.nsResetOk.addEventListener('click', async () => {
        // Aj ranné oznámenie: inak by Worker telefón budil ďalej s nastavením, ktoré už nie je.
        await vypniOznamenia();
        clearStored();
        history.replaceState(null, '', location.pathname + location.search);
        location.reload();
    });
}
