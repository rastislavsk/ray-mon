// E2E karty Nastavenie novej appky „Živá obloha“, krok 6b: Vzhľad (živá obloha, tón hlášok, úvodná
// karta) a Appka (Zdieľať appku, Nastaviť celé znova). Očakávané texty počítajú tie isté funkcie
// ako appka (shared/messages.js, mozemSkyModel), takže test odhalí rozdiel medzi modelom a stránkou.
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
    LOOK_STORAGE_KEY,
    OBLOHA_URL,
    PLANT,
    SETTINGS_STORAGE_KEY,
    SITE,
    SITE_STORAGE_KEY,
    SKY,
    START_STORAGE_KEY,
    STORAGE_KEYS,
    TARIFF,
    WORKER_PV_URL,
} from '../../shared/config.js';
import { MOZEM_WORDS, voiceTexts } from '../../shared/messages.js';
import { mozemSkyModel } from '../../shared/mozem-sky.js';
import { settingsFromLink, shareUrl, toUser } from '../../shared/settings.js';
import { skyNow } from '../../shared/sky.js';
import { buildForecast } from '../../shared/solar.js';
import { FIXED_NOW, fixture, fixtureData } from '../helpers.js';

const { pv } = fixtureData();
const weather = fixture('open-meteo.json');
const TEST_KIOSK = 'https://region01eu5.fusionsolar.huawei.com/pvmswebsite/nologin/assets/build/index.html#/kiosk?kk=Test1234';
const OWNER = { site: SITE, plant: PLANT, tariff: TARIFF, kiosk: TEST_KIOSK };
const IGNORED_CONSOLE = /Failed to load resource|net::ERR_FAILED/;
const SLUSNY = voiceTexts('slusny');

/** Presný okamih daného času 5. 9. 2026 v Bratislave (letný čas). @param {string} hm */
const at = (hm) => new Date(`2026-09-05T${hm}:00+02:00`);

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
    await page.goto('/obloha/');
    await appReady(page);
    return errors;
}

/** Súčasná appka; čaká, kým prepíše „načítavam…“. @param {import('@playwright/test').Page} page */
async function otvorSucasnuAppku(page) {
    await page.goto('/');
    await expect(page.locator('#pv-updated')).not.toHaveText('načítavam…');
}

/** @param {import('@playwright/test').Page} page @param {string} panel */
const karta = (page, panel) => page.locator(`#nav-${panel}`).click();

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

/** Slovo, veta a hláška na karte Môžem?. @param {import('@playwright/test').Page} page */
const mozemVStranke = async (page) => ({
    word: await page.locator('#mz-word').textContent(),
    lead: await page.locator('#mz-lead').textContent(),
    quip: await page.locator('#mz-quip-text').textContent(),
    hint: await page.locator('#mz-quip-hint').textContent(),
});

test.describe('tón hlášok', () => {
    test('Slušný zmení slovo, vetu a hlášku na Môžem? aj pätu plagátu a po obnovení ostane; súčasná appka ostáva drzá', async ({
        page,
    }) => {
        const errors = await openObloha(page);
        const drzy = modelMozem(FIXED_NOW, 'drzy');
        const slusny = modelMozem(FIXED_NOW, 'slusny');
        expect(slusny.word).toBe('ÁNO, TERAZ');
        await expect
            .poll(() => mozemVStranke(page))
            .toEqual({ word: drzy.word, lead: drzy.lead, quip: drzy.quip, hint: 'ťukni, príde ďalšia' });

        await karta(page, 'nastavenie');
        const drzyBtn = page.locator('#ns-voice [data-voice="drzy"]');
        const slusnyBtn = page.locator('#ns-voice [data-voice="slusny"]');
        await expect(drzyBtn).toHaveAttribute('aria-pressed', 'true');
        await slusnyBtn.click();
        await expect(slusnyBtn).toHaveAttribute('aria-pressed', 'true');
        await expect(drzyBtn).toHaveAttribute('aria-pressed', 'false');
        expect(JSON.parse((await ulozene(page, LOOK_STORAGE_KEY)) || 'null')).toEqual({ ton: 'slusny', obloha: true });

        await karta(page, 'mozem');
        const ocakavane = { word: slusny.word, lead: slusny.lead, quip: slusny.quip, hint: SLUSNY.MOZEM_SKY_TEXTS.quipHint };
        await expect.poll(() => mozemVStranke(page)).toEqual(ocakavane);
        // Päta plagátu bez „slnko nefakturuje“.
        await page.locator('#mz-summary').click();
        await expect(page.locator('#poster-foot')).toHaveText('RAY-MON');
        await page.keyboard.press('Escape');
        await expect(page.locator('#poster')).not.toBeVisible();

        await page.reload();
        await appReady(page);
        await expect.poll(() => mozemVStranke(page)).toEqual(ocakavane);

        // Súčasná appka nový kľúč nečíta a hovorí drzo.
        await otvorSucasnuAppku(page);
        await expect(page.locator('#mozem-body')).toContainText(MOZEM_WORDS.go);
        await expect(page.locator('#mozem-body')).not.toContainText(SLUSNY.MOZEM_WORDS.go);
        expect(errors).toEqual([]);
    });

    test('Slušný mení výzvy na všetkých kartách a štítok v hlavičke (typická strecha)', async ({ page }) => {
        const errors = await openObloha(page, { settings: null, site: SITE });
        await expect(page.locator('#hdr-setup')).toHaveText('Zadaj panely ›');
        await expect(page.locator('#mz-guess-title')).toHaveText('Hádam podľa suseda');
        await karta(page, 'nastavenie');
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
        const zivo = skyNow({
            now: at('13:00'),
            known: 'elektraren',
            site: SITE,
            loading: false,
            forecast: buildForecast(weather, at('13:00'), SITE, PLANT),
        });
        await expect.poll(() => obloha(page)).toEqual([zivo.top, zivo.bottom]);

        await karta(page, 'nastavenie');
        const prepinac = page.locator('#ns-live-sky');
        await expect(prepinac).toHaveAttribute('role', 'switch');
        await expect(prepinac).toHaveAttribute('aria-checked', 'true');
        await prepinac.click();
        await expect(prepinac).toHaveAttribute('aria-checked', 'false');
        await expect.poll(() => obloha(page)).toEqual(SKY.calm);
        expect(JSON.parse((await ulozene(page, LOOK_STORAGE_KEY)) || 'null')).toEqual({ ton: 'drzy', obloha: false });
        // Pokojná obloha nemá prechod.
        expect(await page.evaluate(() => getComputedStyle(document.documentElement).transitionDuration)).toBe('0s');

        // Večer po obnovení: stále tá istá tmavá.
        await page.clock.setFixedTime(at('21:00'));
        await page.reload();
        await appReady(page);
        await expect.poll(() => obloha(page)).toEqual(SKY.calm);
        await expect(page.locator('#hdr-status')).toHaveText('21:00');
        await karta(page, 'nastavenie');
        await expect(prepinac).toHaveAttribute('aria-checked', 'false');

        // Zapnutie vráti oblohu podľa času a počasia.
        await prepinac.click();
        const vecer = skyNow({
            now: at('21:00'),
            known: 'elektraren',
            site: SITE,
            loading: false,
            forecast: buildForecast(weather, at('21:00'), SITE, PLANT),
        });
        await expect.poll(() => obloha(page)).toEqual([vecer.top, vecer.bottom]);
        expect(vecer.top).not.toBe(SKY.calm[0]);
        expect(errors).toEqual([]);
    });
});

test.describe('úvodná karta', () => {
    test('voľba v novej appke platí v súčasnej a naopak', async ({ page }) => {
        const errors = await openObloha(page);
        await karta(page, 'nastavenie');
        const teraz = page.locator('#ns-start [data-start="terazky"]');
        await expect(page.locator('#ns-start [data-start="mozem"]')).toHaveAttribute('aria-pressed', 'true');
        await teraz.click();
        await expect(teraz).toHaveAttribute('aria-pressed', 'true');
        expect(await ulozene(page, START_STORAGE_KEY)).toBe('terazky');

        // Súčasná appka sa otvorí na Terazky.
        await otvorSucasnuAppku(page);
        await expect(page.locator('#panel-terazky')).toBeVisible();
        await expect(page.locator('#panel-mozem')).toBeHidden();
        // V nej späť na Môžem?…
        await page.locator('#nav-nastavenie').click();
        const polozka = page.locator('#settings-start');
        if ((await polozka.getAttribute('open')) === null) await polozka.locator('> summary').click();
        await page.locator('[data-start-panel="mozem"]').click();
        await expect(page.locator('[data-start-panel="mozem"]')).toHaveAttribute('aria-pressed', 'true');

        // …a nová appka sa otvorí na Môžem? s tou istou voľbou v Nastavení.
        await page.goto('/obloha/');
        await appReady(page);
        await expect(page.locator('#panel-mozem')).toBeVisible();
        await karta(page, 'nastavenie');
        await expect(page.locator('#ns-start [data-start="mozem"]')).toHaveAttribute('aria-pressed', 'true');
        expect(errors).toEqual([]);
    });
});

test.describe('Zdieľať appku', () => {
    test('odkaz vedie na novú appku, s nastavením ho nová appka prevezme; bez QR knižnice len odkaz', async ({ page, browser }) => {
        const errors = await openObloha(page);
        await karta(page, 'nastavenie');
        await page.locator('#ns-share').click();
        const okno = page.locator('#ns-share-sheet');
        await expect(okno).toBeVisible();
        const odkaz = page.locator('#ns-share-link');
        await expect(odkaz).toHaveText(OBLOHA_URL);
        expect(OBLOHA_URL).toMatch(/\/ray-mon\/obloha\/$/);
        // QR knižnica z CDN neodpovedá: okno ukáže len odkaz a WhatsApp.
        await expect(page.locator('#ns-qr')).toBeHidden();
        await expect(page.locator('#ns-share-wa')).toHaveAttribute('href', `https://wa.me/?text=${encodeURIComponent(OBLOHA_URL)}`);

        await expect(page.locator('#ns-share-kiosk-row')).toBeHidden();
        await page.locator('#ns-share-settings').check();
        await expect(page.locator('#ns-share-kiosk-row')).toBeVisible();
        const sNastavenim = shareUrl(OBLOHA_URL, OWNER, false);
        await expect(odkaz).toHaveText(sNastavenim);
        await expect(odkaz).toHaveAttribute('href', sNastavenim);
        expect(settingsFromLink(sNastavenim)?.kiosk).toBe('');
        await page.locator('#ns-share-kiosk').check();
        await expect(odkaz).toHaveText(shareUrl(OBLOHA_URL, OWNER, true));
        await page.locator('#ns-share-kiosk').uncheck();

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
        await druhy.goto(`/obloha/${new URL(sNastavenim).hash}`);
        await appReady(druhy);
        await expect(druhy.locator('#import-offer')).toBeVisible();
        await druhy.locator('#import-accept').click();
        await expect(druhy.locator('#import-offer')).toBeHidden();
        expect(JSON.parse((await ulozene(druhy, SETTINGS_STORAGE_KEY)) || 'null')).toEqual(toUser({ ...OWNER, kiosk: '' }));
        await druhyKontext.close();
        expect(errors).toEqual([]);
        expect(errors2).toEqual([]);
    });

    test('bez uloženej elektrárne voľby s nastavením nie sú', async ({ page }) => {
        await openObloha(page, { settings: null, site: SITE });
        await karta(page, 'nastavenie');
        await page.locator('#ns-share').click();
        await expect(page.locator('#ns-share-opts')).toBeHidden();
        await expect(page.locator('#ns-share-link')).toHaveText(OBLOHA_URL);
    });
});

test.describe('Nastaviť celé znova', () => {
    test('po zrušení sa nič nezmení, po potvrdení je appka ako pri prvom otvorení', async ({ page }) => {
        const errors = await openObloha(page);
        await karta(page, 'nastavenie');
        await page.locator('#ns-voice [data-voice="slusny"]').click();
        await page.locator('#ns-start [data-start="terazky"]').click();
        const predtym = await page.evaluate(() => JSON.stringify(localStorage));

        await page.locator('#ns-reset').click();
        const okno = page.locator('#ns-reset-sheet');
        await expect(okno).toBeVisible();
        await expect(page.locator('#ns-reset-text')).toContainText('v novej aj v súčasnej appke');
        await page.locator('#ns-reset-cancel').click();
        await expect(okno).toBeHidden();
        await expect(page.locator('#ns-reset')).toBeFocused();
        expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(predtym);
        await expect(page.locator('#ns-rows')).toContainText(SITE.name);

        await page.locator('#ns-reset').click();
        await Promise.all([page.waitForEvent('load'), page.locator('#ns-reset-ok').click()]);
        await appReady(page);
        const zostalo = await page.evaluate((keys) => keys.filter((k) => localStorage.getItem(k) !== null), STORAGE_KEYS);
        expect(zostalo).toEqual([]);
        expect(new URL(page.url()).hash).toBe('');
        // Ako pri prvom otvorení: Môžem? sa pýta na polohu, drzo a na živej (sivej) oblohe.
        await expect(page.locator('#panel-mozem')).toBeVisible();
        await expect(page.locator('#mz-ask')).toBeVisible();
        await expect(page.locator('#mz-ask-title')).toHaveText('Kde máš strechu?');
        expect(errors).toEqual([]);
    });
});

test('sprievodca pri tarife v novej appke nespomína ciferník, v súčasnej áno', async ({ page }) => {
    const errors = await openObloha(page);
    await karta(page, 'nastavenie');
    await page.locator('#ns-rows [data-setup-edit="tarifa"]').click();
    await expect(page.locator('#wz-tarifa')).toBeVisible();
    await expect(page.locator('#wz-lead')).toContainText('pás plánu dňa');
    await expect(page.locator('#wz-lead')).not.toContainText(/ciferník|prstenec/);
    await page.locator('#wz-tarifa [data-setup-kind="dunno"]').click();
    await expect(page.locator('#wz-tariff-dunno')).not.toContainText('ciferník');

    await otvorSucasnuAppku(page);
    await page.locator('#nav-nastavenie').click();
    const polozka = page.locator('#settings-plant');
    if ((await polozka.getAttribute('open')) === null) await polozka.locator('> summary').click();
    await page.locator('#setup-rows [data-setup-edit="tarifa"]').click();
    await expect(page.locator('#wz-lead')).toContainText('zafarbí ciferník');
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
        await page.locator('#ns-share').click();
        await page.locator('#ns-share-settings').check();
        expect(await page.evaluate(zlePrvky, '#ns-share-sheet')).toEqual([]);
        await page.keyboard.press('Escape');
        await page.locator('#ns-reset').click();
        expect(await page.evaluate(zlePrvky, '#ns-reset-sheet')).toEqual([]);
        expect(errors).toEqual([]);
    });
}
