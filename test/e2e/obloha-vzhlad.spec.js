// E2E karty Nastavenie, krok 6b: Vzhľad (živá obloha, tón hlášok)
// a Appka (Zdieľať appku, Vymazať údaje). Očakávané texty počítajú tie isté funkcie
// ako appka (shared/messages.js, mozemSkyModel), takže test odhalí rozdiel medzi modelom a stránkou.
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
    APP_URL,
    LOOK_STORAGE_KEY,
    NASTAVENIE_SEKCIE,
    PLANT,
    SETTINGS_STORAGE_KEY,
    SITE,
    SITE_STORAGE_KEY,
    SKY,
    STORAGE_KEYS,
    TARIFF,
    VYMAZANE_STORAGE_KEY,
    WORKER_PV_URL,
    WORKER_TRASY_URL,
    WORKER_ZDIELAJ_URL,
} from '../../shared/config.js';
import { NASTAVENIE_TEXTS } from '../../shared/nastavenie.js';
import { NS_FOLDS } from '../../web/state.js';
import { voiceTexts } from '../../shared/messages.js';
import { mozemSkyModel } from '../../shared/mozem-sky.js';
import { settingsFromLink, shareUrl, toUser } from '../../shared/settings.js';
import { skyNow } from '../../shared/sky.js';
import { pocasieTeraz } from '../../shared/teraz.js';
import { buildForecast } from '../../shared/solar.js';
import { FIXED_NOW, fixture, fixtureData, otvorGraf, podvrhniQr } from '../helpers.js';

const { pv } = fixtureData();
const weather = fixture('open-meteo.json');
/** Pripojené meranie v testoch: zapečatený prístup ku kiosku, Worker naň odpovedá nameraným pv z fixtures. */
const TEST_ZDROJ = { sposob: 'huawei-kiosk', pecat: 'v1.TestPecat0123456789abcdefgh', nazov: 'Dvorany' };
const OWNER = { site: SITE, plant: PLANT, tariff: TARIFF, zdroj: TEST_ZDROJ };
const IGNORED_CONSOLE = /Failed to load resource|net::ERR_FAILED/;
const SLUSNY = voiceTexts('slusny');

/** Presný okamih daného času 5. 9. 2026 v Bratislave (letný čas). @param {string} hm */
const at = (hm) => new Date(`2026-09-05T${hm}:00+02:00`);

/**
 * Živá obloha tak, ako ju appka vypočíta v danej chvíli z dát, ktoré jej testy pošlú: počasie
 * neba je to isté ako v kresbe na karte Teraz (pocasieTeraz). @param {Date} time
 */
const zivaObloha = (time) => {
    const vstup = {
        ...OWNER,
        now: time,
        loading: false,
        known: /** @type {const} */ ('elektraren'),
        pv,
        forecast: buildForecast(weather, time, SITE, PLANT),
        previewMinutes: null,
    };
    return skyNow(vstup, true, pocasieTeraz(vstup));
};

/**
 * Siete z fixtures (QR knižnica z CDN neodpovedá) a úložisko pred prvým otvorením. Uloží sa
 * len raz - obnovenie stránky ho už neprepíše, takže sa dá skúšať, čo appka sama uložila.
 * @param {import('@playwright/test').Page} page
 * @param {{ settings?: typeof OWNER | null, site?: typeof SITE | null, time?: Date }} [opts]
 */
async function pripravSiet(page, { settings = OWNER, site = null, time = FIXED_NOW } = {}) {
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (msg) => msg.type() === 'error' && !IGNORED_CONSOLE.test(msg.text()) && errors.push(msg.text()));
    await page.route(/cdnjs\.cloudflare\.com/, (route) => route.abort());
    await page.route(WORKER_PV_URL, (route) => route.fulfill({ json: { pv } }));
    // Trasy autom pre Štatistiku: bez nich plagát počíta s cestou okolo Zeme a test nesiaha na Worker.
    await page.route(WORKER_TRASY_URL, (route) => route.abort());
    await page.route(/api\.open-meteo\.com/, (route) => route.fulfill({ json: weather }));
    /** @type {Record<string, string>} */ const store = {};
    if (settings) store[SETTINGS_STORAGE_KEY] = JSON.stringify(toUser(settings));
    if (site) store[SITE_STORAGE_KEY] = JSON.stringify(site);
    await page.addInitScript((s) => {
        if (sessionStorage.getItem('test-ulozene')) return;
        sessionStorage.setItem('test-ulozene', '1');
        for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
    }, store);
    await page.clock.setFixedTime(time);
    return errors;
}

/** Počká, kým appka naštartuje (data-panel zapíše až prvý render). @param {import('@playwright/test').Page} page */
const appReady = (page) => expect(page.locator('#page')).toHaveAttribute('data-panel', /.+/);

/** @param {import('@playwright/test').Page} page @param {Parameters<typeof pripravSiet>[1]} [opts] */
async function openObloha(page, opts) {
    const errors = await pripravSiet(page, opts);
    await page.goto('/');
    await appReady(page);
    return errors;
}

/** @param {import('@playwright/test').Page} page @param {string} panel */
const karta = (page, panel) => page.locator(`#nav-${panel}`).click();

/** Rozbalí sekciu karty Nastavenie - pri štarte sú všetky zbalené. @param {import('@playwright/test').Page} page @param {string} key */
async function rozbal(page, key) {
    const head = page.locator(`#ns-fold-${key}`);
    if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
}

/** Uložená hodnota z localStorage. @param {import('@playwright/test').Page} page @param {string} key */
const ulozene = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);

/** Farby oblohy na <html>. @param {import('@playwright/test').Page} page */
const obloha = (page) =>
    page.evaluate(() => {
        const s = document.documentElement.style;
        return [s.getPropertyValue('--s1'), s.getPropertyValue('--s2')];
    });

/** Model karty Môžem? tak, ako ho počíta appka po načítaní. @param {Date} time @param {import('../../shared/messages.js').Voice} voice */
const modelMozem = (time, voice) =>
    mozemSkyModel(
        { ...OWNER, now: time, loading: false, known: 'elektraren', pv, forecast: buildForecast(weather, time, SITE, PLANT) },
        { voice },
    );

test.describe('tón hlášok', () => {
    test('Slušný zmení slovo na Dnes a radu v grafe dňa aj pätu plagátu a po obnovení ostane', async ({ page }) => {
        const errors = await openObloha(page);
        const drzy = modelMozem(FIXED_NOW, 'drzy');
        const slusny = modelMozem(FIXED_NOW, 'slusny');
        expect(slusny.word).toBe('Dnes bude dobrý deň');
        await otvorGraf(page);
        await expect(page.locator('#gr-hint')).toHaveText('Ťahaj prstom po grafe a pozri si iný čas.');
        await page.keyboard.press('Escape');
        await expect(page.locator('#mz-word')).toHaveText(drzy.word);

        await karta(page, 'nastavenie');
        await rozbal(page, 'vzhlad');
        const drzyBtn = page.locator('#ns-voice [data-voice="drzy"]');
        const slusnyBtn = page.locator('#ns-voice [data-voice="slusny"]');
        await expect(drzyBtn).toHaveAttribute('aria-pressed', 'true');
        await slusnyBtn.click();
        await expect(slusnyBtn).toHaveAttribute('aria-pressed', 'true');
        await expect(drzyBtn).toHaveAttribute('aria-pressed', 'false');
        expect(JSON.parse((await ulozene(page, LOOK_STORAGE_KEY)) || 'null')).toEqual({ ton: 'slusny', obloha: true, farba: true });

        await karta(page, 'mozem');
        await expect(page.locator('#mz-word')).toHaveText(slusny.word);
        await otvorGraf(page);
        await expect(page.locator('#gr-hint')).toHaveText('Ťahajte prstom po grafe a pozrite si iný čas.');
        await page.keyboard.press('Escape');

        await page.reload();
        await appReady(page);
        await otvorGraf(page);
        await expect(page.locator('#gr-hint')).toHaveText('Ťahajte prstom po grafe a pozrite si iný čas.');
        await page.keyboard.press('Escape');
        await expect(page.locator('#mz-word')).toHaveText(slusny.word);
        expect(errors).toEqual([]);
    });

    test('Slušný mení výzvy na všetkých kartách a štítok v hlavičke (typická strecha)', async ({ page }) => {
        const errors = await openObloha(page, { settings: null, site: SITE });
        await expect(page.locator('#hdr-setup')).toHaveText('Zadaj panely ›');
        await karta(page, 'mozem');
        await expect(page.locator('#mz-guess-title')).toHaveText('Hádam podľa suseda');
        await karta(page, 'nastavenie');
        await rozbal(page, 'vzhlad');
        await page.locator('#ns-voice [data-voice="slusny"]').click();
        await expect(page.locator('#hdr-setup')).toHaveText(SLUSNY.HEADER_TEXTS.setup);
        await karta(page, 'mozem');
        await expect(page.locator('#mz-guess-title')).toHaveText(SLUSNY.MOZEM_SKY_TEXTS.guessTitle);
        await expect(page.locator('#mz-guess-btn')).toHaveText(SLUSNY.MOZEM_SKY_TEXTS.guessBtn);
        await karta(page, 'terazky');
        await expect(page.locator('#tz-guess-title')).toHaveText(SLUSNY.TERAZ_TEXTS.guessTitle);
        await karta(page, '7dni');
        await expect(page.locator('#sd-guess-title')).toHaveText(SLUSNY.SEDEM_TEXTS.guessTitle);
        await expect(page.locator('#sd-hint')).toHaveText(SLUSNY.SEDEM_TEXTS.hint);
        await karta(page, 'statistika');
        await expect(page.locator('#st-setup-title')).toHaveText('Štatistika potrebuje vaše panely');
        expect(errors).toEqual([]);
    });
});

test.describe('živá obloha', () => {
    test('vypnutá stojí v pokojných tmavých farbách o 13:00 aj o 21:00, po obnovení ostane; zapnutie vráti živú', async ({ page }) => {
        const errors = await openObloha(page, { time: at('13:00') });
        const zivo = zivaObloha(at('13:00'));
        await expect.poll(() => obloha(page)).toEqual([zivo.top, zivo.bottom]);

        await karta(page, 'nastavenie');
        await rozbal(page, 'vzhlad');
        const prepinac = page.locator('#ns-live-sky');
        await expect(prepinac).toHaveAttribute('role', 'switch');
        await expect(prepinac).toHaveAttribute('aria-checked', 'true');
        await prepinac.click();
        await expect(prepinac).toHaveAttribute('aria-checked', 'false');
        await expect.poll(() => obloha(page)).toEqual(SKY.calm);
        expect(JSON.parse((await ulozene(page, LOOK_STORAGE_KEY)) || 'null')).toEqual({ ton: 'drzy', obloha: false, farba: true });
        // Pokojná obloha nemá prechod.
        expect(await page.evaluate(() => getComputedStyle(document.documentElement).transitionDuration)).toBe('0s');

        // Večer po obnovení: stále tá istá tmavá.
        await page.clock.setFixedTime(at('21:00'));
        await page.reload();
        await appReady(page);
        await expect.poll(() => obloha(page)).toEqual(SKY.calm);
        // Hlavička ukazuje čas merania, nie hodiny: dáta stiahnuté o 13:00 sú večer už staré - appka nemá spojenie.
        await expect(page.locator('#hdr-status')).toHaveText('13:00 · bez spojenia');
        await karta(page, 'nastavenie');
        await rozbal(page, 'vzhlad');
        await expect(prepinac).toHaveAttribute('aria-checked', 'false');

        // Zapnutie vráti oblohu podľa času a počasia.
        await prepinac.click();
        const vecer = zivaObloha(at('21:00'));
        await expect.poll(() => obloha(page)).toEqual([vecer.top, vecer.bottom]);
        expect(vecer.top).not.toBe(SKY.calm[0]);
        expect(errors).toEqual([]);
    });
});

test.describe('úvodná karta', () => {
    test('appka sa otvára na karte Teraz, voľba v Nastavení nie je a stará uložená sa zmaže', async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem('prva-karta-v1', 'mozem'));
        const errors = await openObloha(page);
        await expect(page.locator('#panel-terazky')).toBeVisible();
        expect(await ulozene(page, 'prva-karta-v1')).toBeNull();
        await karta(page, 'nastavenie');
        await expect(page.locator('#ns-start, [data-start]')).toHaveCount(0);
        expect(errors).toEqual([]);
    });
});

test.describe('zbaliteľné sekcie', () => {
    test('pri štarte zbalené, nadpis rozbalí a zbalí, Späť na telefóne zbalí; rozbalená je najviac jedna', async ({ page }) => {
        const errors = await openObloha(page);
        await karta(page, '7dni');
        await karta(page, 'nastavenie');
        const sekcie = NS_FOLDS;
        // Poradie sekcií je to isté - dáva ho jadro. Appka sa nezbaľuje.
        expect(sekcie).toEqual(NASTAVENIE_SEKCIE.filter((k) => k !== 'appka'));
        await expect(page.locator('#ns-app-title')).toHaveText(NASTAVENIE_TEXTS.appka);
        expect(
            await page.locator('[data-ns-fold]').evaluateAll((els) => els.map((e) => /** @type {HTMLElement} */ (e).dataset.nsFold)),
        ).toEqual([...sekcie]);
        for (const key of sekcie) {
            await expect(page.locator(`#ns-fold-${key}`)).toHaveAttribute('aria-expanded', 'false');
            await expect(page.locator(`#ns-body-${key}`)).toBeHidden();
        }
        for (const key of sekcie) {
            await page.locator(`#ns-fold-${key}`).click();
            await expect(page.locator(`#ns-fold-${key}`)).toHaveAttribute('aria-expanded', 'true');
            await expect(page.locator(`#ns-body-${key}`)).toBeVisible();
            for (const ina of sekcie.filter((x) => x !== key)) await expect(page.locator(`#ns-body-${ina}`)).toBeHidden();
            await page.goBack();
            await expect(page.locator('#panel-nastavenie')).toBeVisible();
            await expect(page.locator(`#ns-body-${key}`)).toBeHidden();
        }
        // Zbalenie nadpisom ide cez históriu: ďalšie Späť už prepne kartu, sekciu znovu nerozbalí.
        await page.locator('#ns-fold-vzhlad').click();
        await page.locator('#ns-fold-vzhlad').click();
        await expect(page.locator('#ns-body-vzhlad')).toBeHidden();
        await page.goBack();
        await expect(page.locator('#panel-7dni')).toBeVisible();
        // S kartou sa sekcia zbalí.
        await karta(page, 'nastavenie');
        await rozbal(page, 'doma');
        await karta(page, 'terazky');
        await karta(page, 'nastavenie');
        await expect(page.locator('#ns-body-doma')).toBeHidden();
        expect(errors).toEqual([]);
    });
});

test.describe('Zdieľať appku', () => {
    test('odkaz, ktorý sa do QR kódu nezmestí: okno sa otvorí a ukáže len odkaz', async ({ page }) => {
        // Kód unesie odkaz bez nastavenia, s nastavením elektrárne už nie.
        await podvrhniQr(page, APP_URL.length + 20);
        const errors = await openObloha(page);
        await karta(page, 'nastavenie');
        await page.locator('#ns-share').click();
        await expect(page.locator('#ns-share-sheet')).toBeVisible();
        await expect(page.locator('#ns-qr [data-qr]')).toHaveAttribute('data-qr', APP_URL);
        await expect(page.locator('#ns-qr')).toBeVisible();
        expect(await page.evaluate(() => /** @type {any} */ (globalThis).qrLevels)).toEqual([0]);

        await page.locator('#ns-share-settings').check();
        const dlhy = shareUrl(APP_URL, OWNER, false);
        await expect(page.locator('#ns-share-link')).toHaveText(dlhy);
        await expect(page.locator('#ns-qr')).toBeHidden();

        // Zatvorené okno sa s odkazom, ktorý sa nezmestí, otvorí znova - výnimka neprekazí showModal.
        await page.keyboard.press('Escape');
        await expect(page.locator('#ns-share-sheet')).toBeHidden();
        await page.locator('#ns-share').click();
        await expect(page.locator('#ns-share-sheet')).toBeVisible();
        await expect(page.locator('#ns-share-link')).toHaveText(dlhy);
        await expect(page.locator('#ns-qr')).toBeHidden();
        expect(errors).toEqual([]);
    });

    test('odkaz vedie na appku, s nastavením ho appka prevezme; bez QR knižnice len odkaz', async ({ page, browser }) => {
        const errors = await openObloha(page);
        await karta(page, 'nastavenie');
        await page.locator('#ns-share').click();
        const okno = page.locator('#ns-share-sheet');
        await expect(okno).toBeVisible();
        const odkaz = page.locator('#ns-share-link');
        await expect(odkaz).toHaveText(APP_URL);
        expect(APP_URL).toMatch(/\/ray-mon\/$/);
        // QR knižnica z CDN neodpovedá: okno ukáže len odkaz a WhatsApp.
        await expect(page.locator('#ns-qr')).toBeHidden();
        await expect(page.locator('#ns-share-wa')).toHaveAttribute('href', `https://wa.me/?text=${encodeURIComponent(APP_URL)}`);

        await expect(page.locator('#ns-share-kiosk-row')).toBeHidden();
        await page.locator('#ns-share-settings').check();
        await expect(page.locator('#ns-share-kiosk-row')).toBeVisible();
        const sNastavenim = shareUrl(APP_URL, OWNER, false);
        await expect(odkaz).toHaveText(sNastavenim);
        await expect(odkaz).toHaveAttribute('href', sNastavenim);
        expect(settingsFromLink(sNastavenim)?.zdroj).toBe(null);
        // Meranie ide do odkazu len s pečaťou na čas, ktorú vydá Worker - trvalá z telefónu neodchádza.
        const docasna = `v1.${'d'.repeat(40)}`;
        /** @type {string[]} */ const poslane = [];
        await page.route(WORKER_ZDIELAJ_URL, (route) => {
            poslane.push(route.request().postData() ?? '');
            return route.fulfill({ json: { pecat: docasna } });
        });
        await page.locator('#ns-share-kiosk').check();
        const sMeranim = shareUrl(APP_URL, { ...OWNER, zdroj: { ...TEST_ZDROJ, pecat: docasna } }, true);
        await expect(odkaz).toHaveText(sMeranim);
        expect(poslane).toEqual([TEST_ZDROJ.pecat]);
        expect(sMeranim).not.toContain(shareUrl(APP_URL, OWNER, true).split('=')[1]);
        await page.locator('#ns-share-kiosk').uncheck();
        await expect(odkaz).toHaveText(sNastavenim);
        // Worker pečať nevydá: odkaz ostane bez merania a voľba to povie.
        await page.route(WORKER_ZDIELAJ_URL, (route) => route.fulfill({ status: 503, json: { chyba: 'server' } }));
        // click, nie check: voľba sa po odmietnutí hneď vráti a check by čakal na zaškrtnutie.
        await page.locator('#ns-share-kiosk').click();
        await expect(page.locator('#ns-share-kiosk-label')).toContainText('pribaliť nedá');
        await expect(page.locator('#ns-share-kiosk')).not.toBeChecked();
        await expect(odkaz).toHaveText(sNastavenim);

        // Escape zavrie okno a fokus sa vráti na riadok.
        await page.keyboard.press('Escape');
        await expect(okno).toBeHidden();
        await expect(page.locator('#ns-share')).toBeFocused();
        // Späť v telefóne ho zavrie tiež.
        await page.locator('#ns-share').click();
        await expect(okno).toBeVisible();
        await page.goBack();
        await expect(okno).toBeHidden();
        await expect(page.locator('#panel-nastavenie')).toBeVisible();

        // Druhý telefón bez nastavenia otvorí odkaz a nastavenie prevezme.
        const druhyKontext = await browser.newContext({ baseURL: test.info().project.use.baseURL });
        const druhy = await druhyKontext.newPage();
        const errors2 = await pripravSiet(druhy, { settings: null });
        await druhy.goto(`/${new URL(sNastavenim).hash}`);
        await appReady(druhy);
        await expect(druhy.locator('#import-offer')).toBeVisible();
        await druhy.locator('#import-accept').click();
        await expect(druhy.locator('#import-offer')).toBeHidden();
        expect(JSON.parse((await ulozene(druhy, SETTINGS_STORAGE_KEY)) || 'null')).toEqual(toUser({ ...OWNER, zdroj: null }));
        await druhyKontext.close();
        expect(errors).toEqual([]);
        expect(errors2).toEqual([]);
    });

    test('bez uloženej elektrárne voľby s nastavením nie sú', async ({ page }) => {
        await openObloha(page, { settings: null, site: SITE });
        await karta(page, 'nastavenie');
        await page.locator('#ns-share').click();
        await expect(page.locator('#ns-share-opts')).toBeHidden();
        await expect(page.locator('#ns-share-link')).toHaveText(APP_URL);
    });
});

test.describe('Vymazať údaje', () => {
    test('po zrušení sa nič nezmení, po potvrdení je appka ako pri prvom otvorení', async ({ page }) => {
        const errors = await openObloha(page);
        await karta(page, 'nastavenie');
        await rozbal(page, 'vzhlad');
        await page.locator('#ns-voice [data-voice="slusny"]').click();
        const predtym = await page.evaluate(() => JSON.stringify(localStorage));

        await page.locator('#ns-reset').click();
        const okno = page.locator('#ns-reset-sheet');
        await expect(okno).toBeVisible();
        await expect(page.locator('#ns-reset-title')).toHaveText(NASTAVENIE_TEXTS.clear.ask);
        await expect(page.locator('#ns-reset-text')).toHaveText(NASTAVENIE_TEXTS.clear.text);
        await page.locator('#ns-reset-cancel').click();
        await expect(okno).toBeHidden();
        await expect(page.locator('#ns-reset')).toBeFocused();
        expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(predtym);
        await expect(page.locator('#ns-rows')).toContainText(SITE.name);

        const stara = page.url();
        await page.locator('#ns-reset').click();
        await Promise.all([page.waitForEvent('load'), page.locator('#ns-reset-ok').click()]);
        await appReady(page);
        const zostalo = await page.evaluate((keys) => keys.filter((k) => localStorage.getItem(k) !== null), STORAGE_KEYS);
        expect(zostalo, 'ostane len značka vymazania').toEqual([VYMAZANE_STORAGE_KEY]);
        expect(new URL(page.url()).hash).toBe('');
        // Stará adresa z histórie prehliadača staré nastavenie neponúkne.
        await page.goto(stara);
        await appReady(page);
        await expect(page.locator('#import-offer')).toBeHidden();
        // Ako pri prvom otvorení: Teraz sa pýta na polohu, drzo a na živej (sivej) oblohe.
        await expect(page.locator('#panel-terazky')).toBeVisible();
        await expect(page.locator('#tz-ask')).toBeVisible();
        await expect(page.locator('#tz-ask-title')).toHaveText('Kde máš strechu?');
        expect(errors).toEqual([]);
    });
});

test('sprievodca pri tarife nespomína ciferník, hovorí o páse plánu dňa', async ({ page }) => {
    const errors = await openObloha(page);
    await karta(page, 'nastavenie');
    await rozbal(page, 'elektraren');
    await page.locator('#ns-rows [data-setup-edit="tarifa"]').click();
    await expect(page.locator('#wz-tarifa')).toBeVisible();
    await expect(page.locator('#wz-lead')).toContainText('pás plánu dňa');
    await expect(page.locator('#wz-lead')).not.toContainText(/ciferník|prstenec/);
    await page.locator('#wz-tarifa [data-setup-kind="dunno"]').click();
    await expect(page.locator('#wz-tariff-dunno')).not.toContainText('ciferník');
    expect(errors).toEqual([]);
});

/** Závažné a kritické nálezy axe. @param {import('@playwright/test').Page} page */
const vazneNalezy = async (page) =>
    (await new AxeBuilder({ page }).analyze()).violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);

test('prístupnosť: Nastavenie, okno Zdieľať appku aj potvrdenie bez závažných nálezov axe', async ({ page }) => {
    await openObloha(page);
    await karta(page, 'nastavenie');
    expect(await vazneNalezy(page), 'Nastavenie so zbalenými sekciami').toEqual([]);
    await rozbal(page, 'vzhlad');
    await page.locator('#ns-live-sky').click();
    await page.locator('#ns-voice [data-voice="slusny"]').click();
    expect(await vazneNalezy(page), 'Nastavenie').toEqual([]);
    await page.locator('#ns-share').click();
    await page.locator('#ns-share-settings').check();
    expect(await vazneNalezy(page), 'Zdieľať appku').toEqual([]);
    await page.keyboard.press('Escape');
    await page.locator('#ns-reset').click();
    expect(await vazneNalezy(page), 'potvrdenie').toEqual([]);
});

/** Tlačidlá, odkazy a riadky so zaškrtávacím poľom (celý <label> je ťukací), ktoré sú nižšie ako 44 px,
 * vytŕčajú z okna alebo nezmestia text, a či je stránka širšia než okno. Odkaz v okne zdieľania je
 * text na podržanie, nie tlačidlo. Beží v prehliadači. @param {string} root */
function zlePrvky(root) {
    const out = [];
    if (document.documentElement.scrollWidth > innerWidth) out.push(`stránka je širšia (${document.documentElement.scrollWidth})`);
    const sel = ['button', 'a:not(#ns-share-link)', 'label'].map((t) => `${root} ${t}`).join(', ');
    for (const el of document.querySelectorAll(sel)) {
        const box = el.getBoundingClientRect();
        if (!box.width) continue;
        const id = el.id || (el.textContent ?? '').trim().slice(0, 20);
        if (box.height < 43.5) out.push(`${id}: výška ${box.height}`);
        if (box.left < -0.5 || box.right > innerWidth + 0.5) out.push(`${id}: mimo okna`);
        if (el.tagName === 'BUTTON' && el.scrollWidth > el.clientWidth + 1) out.push(`${id}: text sa nezmestí`);
    }
    return out;
}

for (const width of [320, 390]) {
    test(`šírka ${width} px: prepínače a tlačidlá Vzhľadu, Appky a okien aspoň 44 px, nič sa neoreže`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        const errors = await openObloha(page);
        await karta(page, 'nastavenie');
        expect(await page.evaluate(zlePrvky, '#ns-home')).toEqual([]);
        for (const key of NS_FOLDS) {
            await rozbal(page, key);
            expect(await page.evaluate(zlePrvky, '#ns-home'), key).toEqual([]);
        }
        await page.locator('#ns-share').click();
        await page.locator('#ns-share-settings').check();
        expect(await page.evaluate(zlePrvky, '#ns-share-sheet')).toEqual([]);
        await page.keyboard.press('Escape');
        await page.locator('#ns-reset').click();
        expect(await page.evaluate(zlePrvky, '#ns-reset-sheet')).toEqual([]);
        expect(errors).toEqual([]);
    });
}
