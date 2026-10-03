// E2E karty Nastavenie novej appky „Živá obloha“: prehľad elektrárne a sprievodca nastavením.
// Sprievodca je ten istý ako v súčasnej appke (shared/setup-flow.js, web/setup-wiring.js) a ukladá
// do toho istého úložiska - testy preto skúšajú aj, že si obe appky nastavenie navzájom prečítajú.
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { RING } from '../../shared/chart-model.js';
import { PLANT, SETTINGS_STORAGE_KEY, SITE, SITE_STORAGE_KEY, TARIFF, WORKER_PV_URL } from '../../shared/config.js';
import { kwpText } from '../../shared/format.js';
import { mozemSkyModel } from '../../shared/mozem-sky.js';
import { settingsFrom, settingsFromLink, shareUrl, toUser } from '../../shared/settings.js';
import { buildForecast } from '../../shared/solar.js';
import { FIXED_NOW, fixture, fixtureData } from '../helpers.js';

const { pv } = fixtureData();
const weather = fixture('open-meteo.json');
const TEST_KIOSK = 'https://region01eu5.fusionsolar.huawei.com/pvmswebsite/nologin/assets/build/index.html#/kiosk?kk=Test1234';
const OWNER = { site: SITE, plant: PLANT, tariff: TARIFF, kiosk: TEST_KIOSK };
const IGNORED_CONSOLE = /Failed to load resource|net::ERR_FAILED/;
/** Vyhľadávanie miest: Dvorany (pre ne sú fixtures počasia) a jedno mesto navyše. */
const GEOCODE = {
    results: [
        {
            name: SITE.name,
            latitude: SITE.lat,
            longitude: SITE.lon,
            elevation: SITE.elevationM,
            timezone: SITE.timezone,
            country: 'Slovensko',
        },
        {
            name: 'Dvory nad Žitavou',
            latitude: 47.99,
            longitude: 18.26,
            elevation: 116,
            timezone: 'Europe/Bratislava',
            country: 'Slovensko',
        },
    ],
};

/**
 * Otvorí novú appku s pevným časom a dátami z fixtures. Bez `settings: null` má uložené Dvorany
 * s kioskom; so `site` pozná len polohu.
 * @param {import('@playwright/test').Page} page
 * @param {{ settings?: typeof OWNER | null, site?: typeof SITE | null, hash?: string }} [opts]
 */
async function openObloha(page, { settings = OWNER, site = null, hash = '' } = {}) {
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (msg) => msg.type() === 'error' && !IGNORED_CONSOLE.test(msg.text()) && errors.push(msg.text()));
    await page.route(/cdnjs\.cloudflare\.com/, (route) => route.abort());
    await page.route(WORKER_PV_URL, (route) => route.fulfill({ json: { pv } }));
    await page.route(/api\.open-meteo\.com/, (route) => route.fulfill({ json: weather }));
    // Neskôr pridaná trasa má prednosť - vyhľadávanie miest je tiež na api.open-meteo.com.
    await page.route(/geocoding-api\.open-meteo\.com/, (route) => route.fulfill({ json: GEOCODE }));
    /** @param {string} key @param {string} value */
    const uloz = (key, value) => page.addInitScript(([k, v]) => localStorage.getItem(k) || localStorage.setItem(k, v), [key, value]);
    if (settings) await uloz(SETTINGS_STORAGE_KEY, JSON.stringify(toUser(settings)));
    if (site) await uloz(SITE_STORAGE_KEY, JSON.stringify(site));
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto(`/obloha/${hash}`);
    await expect(page.locator('#page')).toHaveAttribute('data-panel', /.+/);
    return errors;
}

/** @param {import('@playwright/test').Page} page */
const nastavenie = (page) => page.locator('#nav-nastavenie').click();
/** @param {import('@playwright/test').Page} page */
const dalej = (page) => page.locator('#wz-next').click();
/** Uložené nastavenie v tvare úložiska. @param {import('@playwright/test').Page} page */
const ulozene = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), SETTINGS_STORAGE_KEY);
/** Obrazovka sprievodcu, ktorá je vidieť. @param {import('@playwright/test').Page} page @param {string} step */
const obrazovka = (page, step) => expect(page.locator(`#wz-${step}`)).toBeVisible();

/** @param {import('@playwright/test').Page} page @param {string} query @param {string} name */
async function vyberMiesto(page, query, name) {
    await page.locator('#wz-place').fill(query);
    await page.locator('.geo-pick', { hasText: name }).click();
}

/** Plocha: smer, sklon, počet. @param {import('@playwright/test').Page} page @param {{ az: number, tilt: number, panels: number }} x */
async function plocha(page, { az, tilt, panels }) {
    await obrazovka(page, 'smer');
    await page.locator(`[data-setup-az="${az}"]`).click();
    await expect(page.locator(`[data-setup-az="${az}"]`)).toHaveAttribute('aria-checked', 'true');
    await dalej(page);
    await page.locator(`[data-setup-tilt="${tilt}"]`).click();
    await expect(page.locator('#wz-tilt')).toHaveValue(String(tilt));
    await dalej(page);
    await page.locator('#wz-panels').fill(String(panels));
    await expect(page.locator('#wz-panel-grid rect.pv')).toHaveCount(panels);
    await dalej(page);
}

/** Bod na kruhu rozvrhu tarify pre minútu dňa (poludnie hore, polomer RING.rDay vo viewBoxe 264). @param {import('@playwright/test').Page} page @param {number} minutes */
async function bodNaKruhu(page, minutes) {
    const box = await page.locator('#wz-tariff-ring').boundingBox();
    if (!box) throw new Error('kruh rozvrhu nie je vidno');
    const r = (RING.rDay / 264) * box.width;
    const rad = ((minutes / 1440) * 2 + 0.5) * Math.PI;
    return { x: box.x + box.width / 2 + r * Math.cos(rad), y: box.y + box.height / 2 + r * Math.sin(rad) };
}

/** Ťah prstom po kruhu cez CDP - naozajstný dotyk, z ktorého prehliadač robí aj pointer udalosti.
 * @param {import('@playwright/test').Page} page @param {number[]} minutes body ťahu */
async function malujPrstom(page, minutes) {
    await page.locator('#wz-tariff-ring').scrollIntoViewIfNeeded();
    const cdp = await page.context().newCDPSession(page);
    const points = [];
    for (const m of minutes) points.push(await bodNaKruhu(page, m));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [points[0]] });
    for (const p of points.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test.describe('sprievodca od nuly', () => {
    test.use({ hasTouch: true });

    test('celý sprievodca: poloha, 2 plochy, menič, bez merania, dve pásma maľované prstom, ceny; obe appky ho prečítajú', async ({
        page,
    }) => {
        test.slow();
        const errors = await openObloha(page, { settings: null });
        await nastavenie(page);
        await obrazovka(page, 'lokalita');
        await expect(page.locator('#wz-step')).toHaveText('Vitaj');
        await expect(page.locator('#wz-next')).toBeDisabled();
        await vyberMiesto(page, 'Dvo', SITE.name);
        await expect(page.locator('#wz-place-card')).toContainText('východ');
        await dalej(page);

        // Poloha je uložená, sprievodca pokračuje panelmi.
        await obrazovka(page, 'panel');
        await expect(page.locator('#wz-step')).toHaveText('Krok 2 z 7 · Panely');
        await expect(page.locator('#wz-prog i')).toHaveCount(7);
        expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), SITE_STORAGE_KEY)).toEqual(SITE);
        await expect(page.locator('#wz-next')).toBeDisabled();
        await page.locator('[data-setup-wp="435"]').click();
        await dalej(page);
        await plocha(page, { az: 180, tilt: 35, panels: 16 });
        await obrazovka(page, 'dalsia');
        await page.locator('#wz-roof-add').click();
        await expect(page.locator('#wz-sub')).toHaveText('Plocha 2 z 2');
        await plocha(page, { az: 90, tilt: 20, panels: 8 });
        await expect(page.locator('#wz-roofs .wz-row')).toHaveCount(2);
        await expect(page.locator('#wz-next')).toHaveText('Nie, to je všetko');
        await dalej(page);
        await obrazovka(page, 'menic');
        await page.locator('[data-setup-ac="10"]').click();
        await dalej(page);
        await obrazovka(page, 'meranie');
        await page.locator('#wz-live-no').click();
        await expect(page.locator('#wz-next')).toHaveText('Preskočiť');
        await dalej(page);

        // Tarifa: dve pásma, rozvrh maľovaný prstom - lacné pásmo cez obed.
        await obrazovka(page, 'tarifa');
        await page.locator('[data-setup-kind="dvoj"]').click();
        await dalej(page);
        await obrazovka(page, 'rozvrh');
        await page.locator('[data-setup-brush="nt"]').click();
        // Šablóna: lacno 22:00 - 6:00, inak drahé.
        await expect(page.locator('#wz-ivals li')).toHaveCount(2);
        await malujPrstom(page, [727, 760, 800, 832]);
        await expect(page.locator('#wz-ivals li')).toHaveCount(4);
        await expect(page.locator('#wz-ivals')).toContainText('12:00 – 14:00');
        await ocakavajKartu(page, 'nastavenie');
        await obrazovka(page, 'rozvrh');
        await dalej(page);
        await obrazovka(page, 'vynimky');
        await dalej(page);
        await obrazovka(page, 'ceny');
        await page.locator('[data-setup-price="nt"]').fill('0,12');
        await page.locator('[data-setup-price="vt"]').fill('0,2');
        await expect(page.locator('#wz-price-check')).toContainText('Úrovne pásiem sedia s cenami.');
        await dalej(page);

        await obrazovka(page, 'suhrn');
        const kwp = kwpText((24 * 435) / 1000);
        await expect(page.locator('#wz-summary .kwp')).toHaveText(kwp.replace(' kWp', ' kWp'));
        expect(await ulozene(page)).toBeNull();
        await expect(page.locator('#wz-next')).toHaveText('Uložiť a prepočítať');
        await dalej(page);

        await expect(page.locator('#ns-home')).toBeVisible();
        await expect(page.locator('#ns-note')).toHaveText('Uložené. Prepočítavam predpoveď.');
        await expect(page.locator('#ns-hero .kwp')).toHaveText(kwp);
        const stored = await ulozene(page);
        expect(stored.strings).toEqual([
            { panels: 16, azimuthDeg: 180, tiltDeg: 35 },
            { panels: 8, azimuthDeg: 90, tiltDeg: 20 },
        ]);
        expect([stored.panelWp, stored.acLimitKw, stored.kiosk]).toEqual([435, 10, '']);
        expect(stored.tariff.schedules[0].changes).toEqual([
            { from: '00:00', band: 'nt' },
            { from: '06:00', band: 'vt' },
            { from: '12:00', band: 'nt' },
            { from: '14:00', band: 'vt' },
            { from: '22:00', band: 'nt' },
        ]);
        expect(stored.tariff.bands.map((/** @type {any} */ b) => b.price)).toEqual([0.12, 0.2]);

        // Karta Môžem? odpovedá z novej strechy - bez výzvy a bez odhadu typickej strechy.
        const saved = settingsFrom(stored);
        await expect(page.locator('#hdr-setup')).toBeHidden();
        await page.locator('#nav-mozem').click();
        const m = mozemSkyModel({
            ...saved,
            now: FIXED_NOW,
            loading: false,
            known: 'elektraren',
            pv: null,
            forecast: buildForecast(weather, FIXED_NOW, saved.site, saved.plant),
        });
        await expect(page.locator('#mz-word')).toHaveText(m.word);
        await expect(page.locator('#mz-lead')).toHaveText(m.lead);
        await expect(page.locator('#mz-guess')).toBeHidden();

        // Súčasná appka prečíta to isté nastavenie.
        await page.goto('/');
        await expect(page.locator('#pv-updated')).not.toHaveText('načítavam…');
        await page.locator('#nav-nastavenie').click();
        const item = page.locator('#settings-plant');
        if ((await item.getAttribute('open')) === null) await item.locator('> summary').click();
        await expect(page.locator('#setup-hero .big')).toHaveText(kwp);
        await expect(page.locator('#setup-rows [data-setup-edit="tarifa"]')).toContainText('NT 0,12 · VT 0,20 €/kWh');
        expect(errors).toEqual([]);
    });
});

/** @param {import('@playwright/test').Page} page @param {string} panel */
async function ocakavajKartu(page, panel) {
    await expect(page.locator(`#panel-${panel}`)).toBeVisible();
    await expect(page.locator(`#nav-${panel}`)).toHaveAttribute('aria-current', 'page');
}

test('nastavenie uložené súčasnou appkou: prehľad, sprievodca a úprava, ktorú súčasná appka hneď vidí', async ({ page }) => {
    const errors = await openObloha(page);
    await nastavenie(page);
    await expect(page.locator('#ns-home h2')).toHaveText('Moja strecha');
    await expect(page.locator('#ns-cta')).toBeHidden();
    await expect(page.locator('#ns-hero .kwp')).toHaveText('10,44 kWp');
    await expect(page.locator('#ns-hero')).toContainText('24 panelov · juh a východ · menič 10 kW');
    await expect(page.locator('#ns-hero')).toContainText(/za jasného dňa okolo \d+ kWh/);
    await expect(page.locator('#ns-hero .planes-compass')).toHaveAttribute('aria-label', /juh 16 panelov, východ 8 panelov/);
    await expect(page.locator('#ns-rows .it')).toHaveText([
        /Poloha.*Dvorany nad Nitrou/,
        /Panely.*2 plochy · 435 Wp/,
        /Živé meranie.*pripojené · 13:00/,
        /Tarifa.*2 pásma · lacno 20 h/,
    ]);

    // Panely: záložky Výkon, Plochy a Menič; zmena meniča sa uloží hneď.
    await page.locator('#ns-rows [data-setup-edit="panel"]').click();
    await obrazovka(page, 'panel');
    await expect(page.locator('#wz-step')).toHaveText('Úprava · Panely');
    await expect(page.locator('[data-setup-wp="435"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#wz-next')).toBeDisabled();
    await page.locator('#wz-group-tabs [data-setup-tab="dalsia"]').click();
    await expect(page.locator('#wz-roofs .wz-row')).toHaveCount(2);
    await page.locator('[data-setup-roof-edit="1"]').click();
    await expect(page.locator('[data-setup-az="90"]')).toHaveAttribute('aria-checked', 'true');
    await page.locator('#wz-group-tabs [data-setup-tab="menic"]').click();
    await page.locator('[data-setup-ac="8"]').click();
    await expect(page.locator('#wz-next')).toHaveText('Uložiť zmenu');
    await dalej(page);
    await expect(page.locator('#ns-hero')).toContainText('menič 8 kW');
    expect((await ulozene(page)).acLimitKw).toBe(8);

    // Zrušenie úpravy nechá, ako bolo.
    await page.locator('#ns-rows [data-setup-edit="tarifa"]').click();
    await page.locator('[data-setup-kind="jedna"]').click();
    await page.locator('#wz-back').click();
    await expect(page.locator('#ns-rows')).toContainText('2 pásma · lacno 20 h');

    await page.goto('/');
    await expect(page.locator('#pv-updated')).not.toHaveText('načítavam…');
    await page.locator('#nav-nastavenie').click();
    const item = page.locator('#settings-plant');
    if ((await item.getAttribute('open')) === null) await item.locator('> summary').click();
    await expect(page.locator('#setup-rows [data-setup-edit="menic"]')).toContainText('8 kW');
    expect(errors).toEqual([]);
});

test('„Neviem“: bežný panel, menič ako panely a jedna cena, v zhrnutí označené ako odhad', async ({ page }) => {
    const errors = await openObloha(page, { settings: null, site: SITE });
    await nastavenie(page);
    await page.locator('#ns-cta-btn').click();
    await obrazovka(page, 'panel');
    await page.locator('[data-setup-wp="guess"]').click();
    await expect(page.locator('#wz-wp-guess')).toHaveText(
        'Počítam s bežnými 430 Wp. V zhrnutí to bude označené ako odhad, kedykoľvek to opravíš.',
    );
    await dalej(page);
    for (let i = 0; i < 4; i++) await dalej(page);
    await obrazovka(page, 'menic');
    await page.locator('[data-setup-ac="guess"]').click();
    await expect(page.locator('#wz-ac-guess')).toBeVisible();
    await expect(page.locator('[data-setup-ac="4"]')).toHaveCount(0);
    await dalej(page);
    await dalej(page);
    await obrazovka(page, 'tarifa');
    await page.locator('[data-setup-kind="dunno"]').click();
    await expect(page.locator('#wz-tariff-dunno')).toBeVisible();
    await expect(page.locator('[data-setup-kind="jedna"]')).toHaveAttribute('aria-pressed', 'true');
    await dalej(page);
    await obrazovka(page, 'ceny');
    await dalej(page);
    await obrazovka(page, 'suhrn');
    await expect(page.locator('#wz-summary [data-setup-edit="panel"]')).toContainText('430 Wp');
    await expect(page.locator('#wz-summary [data-setup-edit="panel"] .est')).toHaveText('odhad · oprav, keď zistíš');
    await expect(page.locator('#wz-summary [data-setup-edit="menic"]')).toContainText('4 kW');
    await expect(page.locator('#wz-summary [data-setup-edit="tarifa"]')).toContainText('Jedna cena celý deň');
    await dalej(page);
    const stored = await ulozene(page);
    expect([stored.panelWp, stored.acLimitKw, stored.tariff.bands.length]).toEqual([430, 4, 1]);
    expect(errors).toEqual([]);
});

test.describe('prevzatie nastavenia z odkazu', () => {
    const LINK = shareUrl('https://rastislavsk.github.io/ray-mon/', OWNER, true);
    const HASH = `#${LINK.split('#')[1]}`;

    test('odkaz vložený v sprievodcovi: náhľad, zhrnutie a uloženie až po potvrdení', async ({ page }) => {
        const errors = await openObloha(page, { settings: null });
        await nastavenie(page);
        await page.locator('#wz-welcome [data-setup-go="odkaz"]').click();
        await obrazovka(page, 'odkaz');
        await page.locator('#wz-link').fill('https://example.com/nieco');
        await expect(page.locator('#wz-link-note')).toBeVisible();
        await expect(page.locator('#wz-next')).toBeDisabled();
        await page.locator('#wz-link').fill(LINK);
        await expect(page.locator('#wz-link-preview')).toContainText('Dvorany nad Nitrou');
        await expect(page.locator('#wz-link-preview')).toContainText('so živým meraním');
        await dalej(page);
        await obrazovka(page, 'suhrn');
        expect(await ulozene(page)).toBeNull();
        await dalej(page);
        await expect(page.locator('#ns-hero .kwp')).toHaveText('10,44 kWp');
        expect(await ulozene(page)).toEqual(toUser(OWNER));
        expect(errors).toEqual([]);
    });

    // Appka pridaná na plochu iPhonu nevidí úložisko Safari - prenesie si len adresu.
    test('odkaz v adrese: ponuka na každej karte, po prevzatí uložené a adresa ho nesie ďalej', async ({ page }) => {
        const errors = await openObloha(page, { settings: null, hash: HASH });
        await expect(page.locator('#import-offer')).toBeVisible();
        await expect(page.locator('#import-offer-text')).toHaveText('Dvorany nad Nitrou · 10,44 kWp · so živým meraním.');
        expect(new URL(page.url()).hash, 'pridanie na plochu pred rozhodnutím si odkaz prenesie').toBe(HASH);
        await page.locator('#import-accept').click();
        await expect(page.locator('#import-offer')).toBeHidden();
        expect(await ulozene(page)).toEqual(toUser(OWNER));
        await expect(page.locator('#hdr-status')).toHaveText('13:00');
        expect(settingsFromLink(page.url())).toEqual(OWNER);
        expect(errors).toEqual([]);
    });

    test('odmietnutie nič neuloží a adresa ostane holá', async ({ page }) => {
        await openObloha(page, { settings: null, hash: HASH });
        await page.locator('#import-decline').click();
        await expect(page.locator('#import-offer')).toBeHidden();
        expect(await ulozene(page)).toBeNull();
        expect(new URL(page.url()).hash).toBe('');
    });
});

test.describe('len poloha', () => {
    /** Animácie výzvy: meno a počet opakovaní. @param {import('@playwright/test').Page} page */
    const pulz = (page) =>
        page.locator('#ns-cta').evaluate((el) =>
            el.getAnimations().map((a) => ({
                name: /** @type {CSSAnimation} */ (a).animationName,
                iterations: a.effect?.getComputedTiming().iterations,
            })),
        );

    test('výzva „Ešte 6 krokov“: postup 1 zo 7, biela, trikrát zapulzuje a vedie na panely', async ({ page }) => {
        const errors = await openObloha(page, { settings: null, site: SITE });
        await nastavenie(page);
        await expect(page.locator('#ns-cta-title')).toHaveText('Ešte 6 krokov a appka bude tvoja');
        await expect(page.locator('#ns-cta-steps')).toHaveAttribute('aria-label', 'Hotový 1 zo 7 krokov');
        await expect(page.locator('#ns-cta-steps i.on')).toHaveCount(1);
        await expect(page.locator('#ns-cta-steps i')).toHaveCount(7);
        await expect(page.locator('#ns-cta-text')).toHaveText(/^Poloha je hotová\./);
        expect(await page.locator('#ns-cta').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
        expect(await pulz(page)).toEqual([{ name: 'pulse-card', iterations: 3 }]);
        await expect.poll(() => pulz(page), { timeout: 6000 }).toEqual([]);
        await expect(page.locator('#ns-hero')).toBeHidden();
        await expect(page.locator('#ns-rows .it')).toHaveText([/Dvorany nad Nitrou/, /nezadané/, /nepripojené, nepovinné/, /nezadaná/]);
        await page.locator('#ns-cta-btn').click();
        await obrazovka(page, 'panel');
        expect(errors).toEqual([]);
    });

    test('pri útlme pohybu výzva nepulzuje', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await openObloha(page, { settings: null, site: SITE });
        await nastavenie(page);
        await expect(page.locator('#ns-cta')).toBeVisible();
        expect(await pulz(page)).toEqual([]);
    });

    test('„Zadaj panely ›“ v hlavičke otvorí krok s panelmi, Späť vráti do prehľadu Nastavenia', async ({ page }) => {
        const errors = await openObloha(page, { settings: null, site: SITE });
        await page.locator('#hdr-setup').click();
        await ocakavajKartu(page, 'nastavenie');
        await obrazovka(page, 'panel');
        await page.goBack();
        await expect(page.locator('#ns-cta')).toBeVisible();
        await page.goBack();
        await ocakavajKartu(page, 'mozem');
        // Aj tlačidlo „Zadaj panely“ na karte.
        await page.getByRole('button', { name: 'Zadaj panely', exact: true }).click();
        await obrazovka(page, 'panel');
        expect(errors).toEqual([]);
    });

    test('zmena polohy z prehľadu uloží len polohu', async ({ page }) => {
        const errors = await openObloha(page, { settings: null, site: SITE });
        await nastavenie(page);
        await page.locator('#ns-rows [data-setup-edit="lokalita"]').click();
        await vyberMiesto(page, 'Dvo', 'Dvory nad Žitavou');
        await dalej(page);
        await expect(page.locator('#ns-rows')).toContainText('Dvory nad Žitavou');
        expect(await ulozene(page)).toBeNull();
        expect(errors).toEqual([]);
    });
});

test.describe('pohyb v sprievodcovi', () => {
    test.use({ hasTouch: true });

    /** Ťah prstom do strán nad prvkom. @param {import('@playwright/test').Page} page @param {string} sel @param {number} dx */
    async function tah(page, sel, dx) {
        await page.locator(sel).evaluate((el, d) => {
            const box = el.getBoundingClientRect();
            const s = { x: box.left + box.width / 2, y: box.top + Math.min(box.height / 2, 20) };
            const touch = (/** @type {number} */ x) => new Touch({ identifier: 1, target: el, clientX: x, clientY: s.y });
            const fire = (/** @type {string} */ type, /** @type {Touch[]} */ t, /** @type {Touch[]} */ c) =>
                el.dispatchEvent(new TouchEvent(type, { touches: t, changedTouches: c, bubbles: true, cancelable: true }));
            const a = touch(s.x);
            const b = touch(s.x + d);
            fire('touchstart', [a], [a]);
            fire('touchmove', [b], [b]);
            fire('touchend', [], [b]);
        }, dx);
    }

    test('Späť v telefóne a Escape idú o krok späť, z prvého kroku do prehľadu; ťah kartu neprepne', async ({ page }) => {
        const errors = await openObloha(page, { settings: null, site: SITE });
        await nastavenie(page);
        await page.locator('#ns-cta-btn').click();
        await page.locator('[data-setup-wp="435"]').click();
        await dalej(page);
        await dalej(page);
        await obrazovka(page, 'sklon');
        await page.goBack();
        await obrazovka(page, 'smer');
        await page.keyboard.press('Escape');
        await obrazovka(page, 'panel');
        // Ťah do strán počas sprievodcu kartu neprepne.
        await tah(page, '#wz-title', -150);
        await tah(page, '#wz-title', 150);
        await ocakavajKartu(page, 'nastavenie');
        await obrazovka(page, 'panel');
        await page.goBack();
        await expect(page.locator('#ns-cta')).toBeVisible();
        await expect(page.locator('#wizard')).toBeHidden();
        // Mimo sprievodcu ťah listuje karty ako inde.
        await tah(page, '#ns-cta', 150);
        await ocakavajKartu(page, 'statistika');
        expect(errors).toEqual([]);
    });

    test('rozpísaný sprievodca sa pri odchode z karty nestratí', async ({ page }) => {
        const errors = await openObloha(page, { settings: null, site: SITE });
        await nastavenie(page);
        await page.locator('#ns-cta-btn').click();
        await page.locator('[data-setup-wp="450"]').click();
        await dalej(page);
        await page.locator('[data-setup-az="135"]').click();
        await page.locator('#nav-7dni').click();
        await nastavenie(page);
        await obrazovka(page, 'smer');
        await expect(page.locator('[data-setup-az="135"]')).toHaveAttribute('aria-checked', 'true');
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-setup-wp="450"]')).toHaveAttribute('aria-pressed', 'true');
        expect(errors).toEqual([]);
    });

    test('maľovanie po kruhu tarify prstom kartu neprelistuje', async ({ page }) => {
        const errors = await openObloha(page);
        await nastavenie(page);
        await page.locator('#ns-rows [data-setup-edit="tarifa"]').click();
        await page.locator('#wz-tariff-tabs [data-setup-tab="rozvrh"]').click();
        await page.locator('[data-setup-brush="vt"]').click();
        const pred = await page.locator('#wz-ivals li').count();
        await malujPrstom(page, [120, 150, 180, 220]);
        await expect(page.locator('#wz-ivals li')).not.toHaveCount(pred);
        await expect(page.locator('#wz-ivals')).toContainText('02:00 – 03:45');
        await ocakavajKartu(page, 'nastavenie');
        await obrazovka(page, 'rozvrh');
        expect(errors).toEqual([]);
    });
});

/**
 * Prejde celého sprievodcu (od úvodu po zhrnutie, s tromi pásmami a výnimkou na časť roka) a na
 * každej obrazovke zavolá `check`. Začína pri známej polohe v prehľade Nastavenia.
 * @param {import('@playwright/test').Page} page @param {(name: string) => Promise<void>} check
 */
async function kazdaObrazovka(page, check) {
    await check('prehľad');
    await page.locator('#ns-cta-btn').click();
    await obrazovka(page, 'panel');
    // Z panelov späť na polohu a úvod - aj tie sú obrazovky sprievodcu.
    await page.locator('#wz-back').click();
    await obrazovka(page, 'lokalita');
    await check('lokalita');
    await page.locator('#wz-back').click();
    await obrazovka(page, 'start');
    await check('start');
    await page.locator('#wz-start [data-setup-go="odkaz"]').click();
    await obrazovka(page, 'odkaz');
    await check('odkaz');
    await page.locator('#wz-back').click();
    await page.locator('#wz-next').click();
    await obrazovka(page, 'lokalita');
    await dalej(page);
    await obrazovka(page, 'panel');
    await page.locator('[data-setup-wp="other"]').click();
    await page.locator('#wz-wp').fill('440');
    await check('panel');
    for (const step of ['smer', 'sklon', 'pocet', 'dalsia']) {
        await dalej(page);
        await obrazovka(page, step);
        await check(step);
    }
    await dalej(page);
    await page.locator('[data-setup-ac="other"]').click();
    await check('menic');
    await page.locator('#wz-ac').fill('5');
    await dalej(page);
    await page.locator('#wz-live-yes').click();
    await page.locator('#wz-kiosk').fill(TEST_KIOSK);
    await check('meranie');
    await dalej(page);
    await page.locator('[data-setup-kind="viac"]').click();
    await check('tarifa');
    for (const step of ['pasma', 'rozvrh']) {
        await dalej(page);
        await obrazovka(page, step);
        await check(step);
    }
    await dalej(page);
    await page.locator('[data-setup-exc="season"]').click();
    await check('vynimky');
    await dalej(page);
    await check('ceny');
    await dalej(page);
    await obrazovka(page, 'suhrn');
    await check('suhrn');
}

test('prístupnosť: prehľad a každá obrazovka sprievodcu bez vážnych nálezov axe', async ({ page }) => {
    test.slow();
    const errors = await openObloha(page, { settings: null, site: SITE });
    await nastavenie(page);
    /** @type {Record<string, string[]>} */
    const nalezy = {};
    await kazdaObrazovka(page, async (name) => {
        const r = await new AxeBuilder({ page }).analyze();
        const vazne = r.violations
            .filter((v) => v.impact === 'serious' || v.impact === 'critical')
            .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
        if (vazne.length) nalezy[name] = vazne;
    });
    expect(nalezy).toEqual({});
    expect(errors).toEqual([]);
});

for (const settings of [OWNER, null]) {
    test(`prístupnosť: ${settings ? 'prehľad uloženej elektrárne' : 'otázka na polohu pri prvom otvorení'} bez vážnych nálezov axe`, async ({
        page,
    }) => {
        await openObloha(page, { settings });
        await nastavenie(page);
        const r = await new AxeBuilder({ page }).analyze();
        expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
    });
}

/** Ovládacie prvky karty Nastavenie, ktoré sú nižšie ako 44 px, vytŕčajú z okna alebo nezmestia
 * text, a či je stránka širšia než okno. Beží v prehliadači. */
function zlePrvky() {
    const out = [];
    if (document.documentElement.scrollWidth > innerWidth) out.push(`stránka je širšia (${document.documentElement.scrollWidth})`);
    const sel = ['button', 'input', 'select', 'summary'].map((t) => `#panel-nastavenie ${t}`).join(', ');
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
    test(`šírka ${width} px: tlačidlá, polia a riadky aspoň 44 px, nič sa neoreže`, async ({ page }) => {
        test.slow();
        await page.setViewportSize({ width, height: 800 });
        const errors = await openObloha(page, { settings: null, site: SITE });
        await nastavenie(page);
        /** @type {string[]} */
        const zle = [];
        await kazdaObrazovka(page, async (name) => {
            const chyby = await page.evaluate(zlePrvky);
            for (const c of chyby) zle.push(`${name}: ${c}`);
        });
        expect(zle).toEqual([]);
        expect(errors).toEqual([]);
    });
}
