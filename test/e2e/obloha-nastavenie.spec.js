// E2E karty Nastavenie: prehľad elektrárne a sprievodca nastavením.
// Sprievodca: shared/setup-flow.js, web/setup-wiring.js.
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { RING } from '../../shared/chart-model.js';
import {
    PLANT,
    PRISTUP_STORAGE_KEY,
    SETTINGS_STORAGE_KEY,
    SITE,
    SITE_STORAGE_KEY,
    TARIFF,
    BOJLER_STORAGE_KEY,
    DOMA_STORAGE_KEY,
    TEPLOMER_STORAGE_KEY,
    OZNAMENIA,
    BEZI_CAKA_STORAGE_KEY,
    WORKER_BEZI_URL,
    WORKER_BOJLER_PECAT_URL,
    WORKER_BOJLER_STAV_URL,
    WORKER_BOJLER_REZIM_URL,
    WORKER_BOJLER_URL,
    WORKER_PRIPOJ_URL,
    WORKER_PV_URL,
    SHARE_HASH_KEY,
    SHARE_LINK_VERSION,
    PRIPOJENIE_BUBLINA_MS,
} from '../../shared/config.js';
import { pripojenieText } from '../../shared/messages-core.js';
import { skriptBojlera } from '../../shared/bojler-skript.js';
import { domaToStored } from '../../shared/doma.js';
import { BOJLER_TEXTS, bojlerSekcia } from '../../shared/nastavenie-bojler.js';
import { bojlerDetail, bojlerDlazdica, TERAZ_BOJLER_TEXTS, tokDetail } from '../../shared/teraz-bojler.js';
import { scenaModel } from '../../shared/teraz-scena.js';
import { kwpText, minutesToTimeStr } from '../../shared/format.js';
import { mozemSkyModel } from '../../shared/mozem-sky.js';
import { odmietnute, pristupModel } from '../../shared/pristup.js';
import { settingsFrom, settingsFromLink, shareUrl, toUser } from '../../shared/settings.js';
import { buildForecast, localMinutes } from '../../shared/solar.js';
import { LINK_ERRORS } from '../../shared/setup-texts.js';
import { FIXED_NOW, fixture, fixtureData } from '../helpers.js';

const { pv } = fixtureData();
const weather = fixture('open-meteo.json');
const TEST_KIOSK = 'https://region01eu5.fusionsolar.huawei.com/pvmswebsite/nologin/assets/build/index.html#/kiosk?kk=Test1234';
/** Pripojené meranie v testoch: zapečatený prístup ku kiosku, Worker naň odpovedá nameraným pv z fixtures. */
const TEST_ZDROJ = { sposob: 'huawei-kiosk', pecat: 'v1.TestPecat0123456789abcdefgh', nazov: 'Dvorany' };
const OWNER = { site: SITE, plant: PLANT, tariff: TARIFF, zdroj: TEST_ZDROJ };
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
 * Otvorí appku s pevným časom a dátami z fixtures. Bez `settings: null` má uložené Dvorany
 * s kioskom; so `site` pozná len polohu.
 * @param {import('@playwright/test').Page} page
 * @param {{ settings?: typeof OWNER | null, site?: typeof SITE | null, hash?: string }} [opts]
 */
async function openObloha(
    page,
    { settings = OWNER, site = null, hash = '', bojler = /** @type {object | null} */ (null), pvNavyse = /** @type {object} */ ({}) } = {},
) {
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (msg) => msg.type() === 'error' && !IGNORED_CONSOLE.test(msg.text()) && errors.push(msg.text()));
    await page.route(/cdnjs\.cloudflare\.com/, (route) => route.abort());
    // Stav bojlera na prebytky pribalí Worker k meraniu, keď ho zásuvka hlási.
    const meranie = { ...pv, ...pvNavyse };
    await page.route(WORKER_PV_URL, (route) => route.fulfill({ json: bojler ? { pv: meranie, bojler } : { pv: meranie } }));
    // Pripojenie v sprievodcovi: Worker nájde jednu elektráreň so zapečateným prístupom.
    await page.route(WORKER_PRIPOJ_URL, (route) =>
        route.fulfill({ json: { stanice: [{ nazov: 'Dvorany', pecat: TEST_ZDROJ.pecat, pv: pv }] } }),
    );
    await page.route(/api\.open-meteo\.com/, (route) => route.fulfill({ json: weather }));
    // Neskôr pridaná trasa má prednosť - vyhľadávanie miest je tiež na api.open-meteo.com.
    await page.route(/geocoding-api\.open-meteo\.com/, (route) => route.fulfill({ json: GEOCODE }));
    /** @param {string} key @param {string} value */
    const uloz = (key, value) => page.addInitScript(([k, v]) => localStorage.getItem(k) || localStorage.setItem(k, v), [key, value]);
    if (settings) await uloz(SETTINGS_STORAGE_KEY, JSON.stringify(toUser(settings)));
    if (site) await uloz(SITE_STORAGE_KEY, JSON.stringify(site));
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto(`/${hash}`);
    await expect(page.locator('#page')).toHaveAttribute('data-panel', /.+/);
    return errors;
}

/** @param {import('@playwright/test').Page} page */
async function nastavenie(page) {
    await page.locator('#nav-nastavenie').click();
    // Riadky elektrárne sú v zbalenej sekcii - testy tu pracujú s nimi, tak ju rozbalí (ak je).
    // Karta sa sťahuje až po štarte; čaká, kým je na nej prehľad alebo sprievodca.
    await expect(page.locator('#ns-home:visible, #wizard:visible')).toHaveCount(1);
    const head = page.locator('#ns-fold-elektraren');
    if ((await head.isVisible()) && (await head.getAttribute('aria-expanded')) !== 'true') await head.click();
}
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

    test('celý sprievodca: poloha, 2 plochy, menič, bez merania, dve pásma maľované prstom, ceny', async ({ page }) => {
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
        expect([stored.panelWp, stored.acLimitKw, stored.zdroj]).toEqual([435, 10, null]);
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
        await expect(page.locator('#mz-karty [data-kind="strecha"] .k-val')).toHaveText(m.day?.value ?? '');
        await expect(page.locator('#mz-guess')).toBeHidden();
        expect(errors).toEqual([]);
    });
});

test('riadok Živé meranie: stav má farbu podľa tónu, značka ostáva tlmená', async ({ page }) => {
    const errors = await openObloha(page);
    await nastavenie(page);
    const riadok = page.locator('#ns-rows [data-setup-edit="meranie"] small');
    /** Farba CSS premennej, ako ju vypočíta prehliadač. @param {string} name */
    const farba = (name) =>
        page.evaluate((n) => {
            const el = document.body.appendChild(document.createElement('i'));
            el.style.color = `var(${n})`;
            const c = getComputedStyle(el).color;
            el.remove();
            return c;
        }, name);
    /** @param {string} tone @param {string} text @param {string} name */
    const stav = async (tone, text, name) => {
        await expect(riadok).toHaveText(`Huawei · ${text}`);
        await expect(riadok.locator('[data-tone]')).toHaveAttribute('data-tone', tone);
        await expect(riadok.locator('[data-tone]')).toHaveText(text);
        await expect(riadok.locator('[data-tone]')).toHaveCSS('color', await farba(name));
        await expect(riadok).toHaveCSS('color', await farba('--dim'));
    };
    const znova = async () => {
        await page.reload();
        await expect(page.locator('#page')).toHaveAttribute('data-panel', /.+/);
        await nastavenie(page);
    };
    await stav('ok', 'pripojené · 13:00', '--yes');

    // Appka sa 30 minút nedostala k dátam: Worker stále posiela čas stiahnutia 13:00.
    await page.clock.setFixedTime(new Date(FIXED_NOW.getTime() + 30 * 60e3));
    await znova();
    await stav('stale', 'bez spojenia · 13:00', '--amber-text');

    // Bez posledného uloženého merania (nastavenie vráti openObloha) a bez odpovede Workera.
    await page.route(WORKER_PV_URL, (route) => route.abort());
    await page.evaluate(() => localStorage.clear());
    await znova();
    await stav('off', 'nepripojené', '--costly-text');
    expect(errors).toEqual([]);
});

/** @param {import('@playwright/test').Page} page @param {string} panel */
async function ocakavajKartu(page, panel) {
    await expect(page.locator(`#panel-${panel}`)).toBeVisible();
    await expect(page.locator(`#nav-${panel}`)).toHaveAttribute('aria-current', 'page');
}

test('uložené nastavenie: prehľad, sprievodca a úprava', async ({ page }) => {
    const errors = await openObloha(page);
    await nastavenie(page);
    await expect(page.locator('#ns-home h2')).toHaveText('Moja elektráreň');
    await expect(page.locator('#ns-cta')).toBeHidden();
    await expect(page.locator('#ns-hero .kwp')).toHaveText('10,44 kWp');
    // V karte je len ružica plôch a výkon - panely, menič ani výroba za jasného dňa nie.
    await expect(page.locator('#ns-hero')).not.toContainText('menič');
    await expect(page.locator('#ns-hero')).not.toContainText('kWh');
    await expect(page.locator('#ns-hero .planes-compass')).toHaveAttribute('aria-label', /juh 16 panelov, východ 8 panelov/);
    await expect(page.locator('#ns-rows .it')).toHaveText([
        /Poloha.*Dvorany nad Nitrou/,
        /Panely.*2 plochy · 24 × 435 Wp/,
        /Menič.*10 kW/,
        /Živé meranie.*Huawei · pripojené · 13:00/,
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
    expect((await ulozene(page)).acLimitKw).toBe(8);

    // Zrušenie úpravy nechá, ako bolo.
    await page.locator('#ns-rows [data-setup-edit="tarifa"]').click();
    await page.locator('[data-setup-kind="jedna"]').click();
    await page.locator('#wz-back').click();
    await expect(page.locator('#ns-rows')).toContainText('2 pásma · lacno 20 h');
    expect(errors).toEqual([]);
});

test('pripojenie kľúčom (Fox ESS) z prehľadu: návod, skryté pole, pripojenie a uloženie len pečate', async ({ page }) => {
    const errors = await openObloha(page);
    /** @type {string[]} */ const bodies = [];
    page.on('request', (r) => r.url() === WORKER_PRIPOJ_URL && bodies.push(r.postData() || ''));
    await nastavenie(page);
    await page.locator('#ns-rows [data-setup-edit="meranie"]').click();
    await page.locator('[data-setup-zmen]').click();
    await obrazovka(page, 'znacka');
    // Fox ESS nikto neoveril na skutočnom meniči: odznak Beta a veta pod zoznamom; Huawei odznak nemá.
    await expect(page.locator('[data-setup-znacka="foxess"]')).toHaveAttribute('data-beta');
    await expect(page.locator('[data-setup-znacka="huawei"]')).not.toHaveAttribute('data-beta');
    await expect(page.locator('[data-setup-znacka="fronius"]')).not.toHaveAttribute('data-beta');
    await expect(page.locator('#wz-beta')).toBeVisible();
    await page.locator('[data-setup-znacka="foxess"]').click();
    await obrazovka(page, 'pripoj');
    await expect(page.locator('#wz-title')).toHaveText('Kľúč z FoxESS Cloud');
    await expect(page.locator('#wz-kroky li')).toHaveCount(3);
    const pole = page.locator('[data-setup-pole="kluc"]');
    await expect(pole).toHaveAttribute('type', 'password');
    await expect(page.locator('#wz-pripojit')).toBeDisabled();
    await pole.fill('tajny-kluc-fox');
    await page.locator('#wz-pripojit').click();
    await expect(page.locator('#wz-stanice [data-setup-stanica="0"]')).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse(bodies[0])).toEqual({ sposob: 'foxess-kluc', udaje: { kluc: 'tajny-kluc-fox' } });
    await expect(page.locator('#wz-next')).toHaveText('Uložiť zmenu');
    await dalej(page);
    await expect(page.locator('#ns-rows')).toContainText('Fox ESS · pripojené');
    const stored = await ulozene(page);
    expect(stored.zdroj).toEqual({ sposob: 'foxess-kluc', pecat: TEST_ZDROJ.pecat, nazov: 'Dvorany' });
    expect(JSON.stringify(stored)).not.toContain('tajny-kluc-fox');
    expect(errors).toEqual([]);
});

test('nové pripojenie merania: bublina na karte Teraz počká na ňu a sama zhasne', async ({ page }) => {
    const errors = await openObloha(page);
    // Každé pripojenie dá novú pečať - appka tak pozná, že nejde o to isté meranie uložené znova.
    await page.route(WORKER_PRIPOJ_URL, (route) =>
        route.fulfill({ json: { stanice: [{ nazov: 'Dvorany', pecat: 'v1.NovaPecat0123456789abcdefgh', pv }] } }),
    );
    await nastavenie(page);
    await page.locator('#ns-rows [data-setup-edit="meranie"]').click();
    await page.locator('[data-setup-zmen]').click();
    await page.locator('[data-setup-znacka="foxess"]').click();
    await page.locator('[data-setup-pole="kluc"]').fill('tajny-kluc-fox');
    await page.locator('#wz-pripojit').click();
    await expect(page.locator('#wz-stanice [data-setup-stanica="0"]')).toHaveAttribute('aria-pressed', 'true');
    await dalej(page);
    // V Nastavení bublina nie je - čaká na kartu Teraz.
    await expect(page.locator('#ns-rows')).toContainText('Fox ESS · pripojené');
    await expect(page.locator('#pripojene')).toBeHidden();
    await page.locator('#nav-terazky').click();
    await expect(page.locator('#pripojene')).toBeVisible();
    await expect(page.locator('#pripojene-title')).toHaveText('Meranie pripojené');
    await expect(page.locator('#pripojene-text')).toHaveText(pripojenieText('zive', 'Fox ESS · Dvorany').text);
    await expect(page.locator('#pripojene')).toBeHidden({ timeout: PRIPOJENIE_BUBLINA_MS + 3000 });
    expect(errors).toEqual([]);
});

test('Huawei API účet od inštalatéra: správa na skopírovanie, server len FusionSolar, po uložení bez druhého merania', async ({ page }) => {
    const errors = await openObloha(page);
    /** @type {string[]} */ const pripoj = [];
    let merania = 0;
    page.on('request', (r) => {
        if (r.url() === WORKER_PRIPOJ_URL) pripoj.push(r.postData() || '');
        if (r.url() === WORKER_PV_URL) merania++;
    });
    await nastavenie(page);
    await page.locator('#ns-rows [data-setup-edit="meranie"]').click();
    await page.locator('[data-setup-zmen]').click();
    await page.locator('[data-setup-znacka="huawei"]').click();
    await obrazovka(page, 'sposob');
    await expect(page.locator('[data-setup-sposob="huawei-northbound"] .tag.top')).toHaveText('najbezpečnejšie');
    await page.locator('[data-setup-sposob="huawei-northbound"]').click();
    await obrazovka(page, 'pripoj');
    await expect(page.locator('#wz-sprava')).toBeVisible();
    await expect(page.locator('#wz-sprava-text')).toContainText('Northbound API účtu');
    await expect(page.locator('#wz-sprava-copy')).toHaveAttribute('data-setup-copy', /Northbound Management/);
    await page.locator('[data-setup-pole="meno"]').fill('api-dvorany');
    await page.locator('[data-setup-pole="heslo"]').fill('tajne-heslo');
    await expect(page.locator('[data-setup-pole="heslo"]')).toHaveAttribute('type', 'password');
    await page.locator('[data-setup-pole="server"]').fill('example.com');
    await expect(page.locator('#wz-pripoj-note')).toHaveClass(/err/);
    await expect(page.locator('#wz-pripojit')).toBeDisabled();
    await page.locator('[data-setup-pole="server"]').fill('eu5.fusionsolar.huawei.com');
    await expect(page.locator('#wz-pripojit')).toBeEnabled();
    await page.locator('#wz-pripojit').click();
    await expect(page.locator('#wz-stanice [data-setup-stanica="0"]')).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse(pripoj[0])).toEqual({
        sposob: 'huawei-northbound',
        udaje: { meno: 'api-dvorany', heslo: 'tajne-heslo', server: 'eu5.fusionsolar.huawei.com' },
    });
    const predUlozenim = merania;
    await dalej(page);
    await expect(page.locator('#ns-rows')).toContainText('Huawei · pripojené');
    // Meranie z pripojenia stačí - Huawei by druhé do 5 minút odmietol.
    await page.waitForTimeout(500);
    expect(merania, 'po uložení sa appka hneď znova nepýta').toBe(predUlozenim);
    const stored = await ulozene(page);
    expect(stored.zdroj.sposob).toBe('huawei-northbound');
    expect(JSON.stringify(stored)).not.toContain('tajne-heslo');
    expect(errors).toEqual([]);
});

test('Huawei API účet: odmietnuté prihlásenie ukáže kód a možnú príčinu (relácia v Shelly)', async ({ page }) => {
    const errors = await openObloha(page);
    await page.route(WORKER_PRIPOJ_URL, (route) => route.fulfill({ status: 400, json: { chyba: 'udaje', kod: 'prihlasenie:20400' } }));
    await nastavenie(page);
    await page.locator('#ns-rows [data-setup-edit="meranie"]').click();
    await page.locator('[data-setup-zmen]').click();
    await page.locator('[data-setup-znacka="huawei"]').click();
    await page.locator('[data-setup-sposob="huawei-northbound"]').click();
    await page.locator('[data-setup-pole="meno"]').fill('api-dvorany');
    await page.locator('[data-setup-pole="heslo"]').fill('tajne-heslo');
    await page.locator('[data-setup-pole="server"]').fill('eu5.fusionsolar.huawei.com');
    await page.locator('#wz-pripojit').click();
    await expect(page.locator('#wz-pripoj-note')).toHaveClass(/err/);
    await expect(page.locator('#wz-pripoj-note')).toContainText('kód 20400');
    await expect(page.locator('#wz-pripoj-note')).toContainText('Shelly');
    expect(errors).toEqual([]);
});

test('Solis a Deye: správa pre podporu, štyri polia Deye, pripojenie bez uloženia hesla', async ({ page }) => {
    const errors = await openObloha(page);
    /** @type {string[]} */ const pripoj = [];
    page.on('request', (r) => r.url() === WORKER_PRIPOJ_URL && pripoj.push(r.postData() || ''));
    await nastavenie(page);
    await page.locator('#ns-rows [data-setup-edit="meranie"]').click();
    await page.locator('[data-setup-zmen]').click();
    // Solis: kľúč od podpory, hotová správa.
    await page.locator('[data-setup-znacka="solis"]').click();
    await obrazovka(page, 'pripoj');
    await expect(page.locator('#wz-title')).toHaveText('Kľúč od podpory Solis');
    await expect(page.locator('#wz-sprava-text')).toContainText('API prístupu');
    await page.locator('#wz-back').click();
    // Deye: vlastná aplikácia, e-mail a heslo.
    await page.locator('[data-setup-znacka="deye"]').click();
    await obrazovka(page, 'pripoj');
    await expect(page.locator('#wz-pola input')).toHaveCount(4);
    await expect(page.locator('[data-setup-pole="email"]')).toHaveAttribute('type', 'email');
    await expect(page.locator('[data-setup-pole="heslo"]')).toHaveAttribute('type', 'password');
    await page.locator('[data-setup-pole="appId"]').fill('202406270000000');
    await page.locator('[data-setup-pole="appSecret"]').fill('app-tajne');
    await page.locator('[data-setup-pole="email"]').fill('a@b.sk');
    await expect(page.locator('#wz-pripojit')).toBeDisabled();
    await page.locator('[data-setup-pole="heslo"]').fill('moje-heslo');
    await page.locator('#wz-pripojit').click();
    await expect(page.locator('#wz-stanice [data-setup-stanica="0"]')).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse(pripoj[0]).sposob).toBe('deye-aplikacia');
    await dalej(page);
    await expect(page.locator('#ns-rows')).toContainText('Deye · pripojené');
    expect(JSON.stringify(await ulozene(page))).not.toContain('moje-heslo');
    expect(errors).toEqual([]);
});

test.describe('prístup k meraniu neplatí či vyprší', () => {
    /** Odmietnutie, ktoré appka po otvorení nájde v úložisku: dve za sebou, práve teraz. */
    const zaDve = odmietnute(odmietnute(null, TEST_ZDROJ, FIXED_NOW, '', false), TEST_ZDROJ, FIXED_NOW, '', false);
    const m = /** @type {any} */ (pristupModel({ zdroj: TEST_ZDROJ, pristup: zaDve, now: FIXED_NOW, timezone: SITE.timezone }));

    test('Teraz povie prečo a vedie do Nastavenia; Skúsiť znova a Pripojiť znova', async ({ page }) => {
        await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [PRISTUP_STORAGE_KEY, JSON.stringify(zaDve)]);
        const errors = await openObloha(page);
        let volania = 0;
        await page.route(WORKER_PV_URL, (route) => {
            volania++;
            return route.fulfill({ status: 400, json: { chyba: 'udaje' } });
        });
        await page.locator('#nav-terazky').click();
        await expect(page.locator('#tz-note-text')).toContainText(m.riadok);
        await page.locator('#tz-note-btn').click();
        await expect(page.locator('#ns-pristup')).toBeVisible();
        await expect(page.locator('#ns-pristup')).toContainText(m.karta.text);
        await expect(page.locator('#ns-rows')).toContainText(m.stav);
        expect(volania, 'odmietnutý prístup sa po otvorení neskúša hneď znova').toBe(0);
        // Skúsiť znova sa opýta hneď; keď to nepomôže, povie to.
        await page.locator('#ns-pristup [data-pristup-skus]').click();
        await expect(page.locator('#ns-pristup')).toContainText('Huawei prístup stále neprijíma.');
        expect(volania).toBe(1);
        // Pripojiť znova: formulár kiosku s dôvodom navrchu.
        await page.locator('#ns-pristup [data-setup-znova]').click();
        await obrazovka(page, 'pripoj');
        await expect(page.locator('#wz-title')).toHaveText(m.sprievodca.nadpis);
        await expect(page.locator('#wz-kroky')).toBeHidden();
        // Každé pripojenie vydá novú pečať (náhodný vektor šifry), aj s tým istým odkazom.
        await page.route(WORKER_PRIPOJ_URL, (route) =>
            route.fulfill({ json: { stanice: [{ nazov: 'Dvorany', pecat: 'v1.NovaPecat0123456789abcdefgh', pv }] } }),
        );
        await page.locator('[data-setup-pole="odkaz"]').fill(TEST_KIOSK);
        await page.locator('#wz-pripojit').click();
        await dalej(page);
        // Nové pripojenie: hlásenie zmizne.
        await expect(page.locator('#ns-pristup')).toBeHidden();
        expect(errors).toEqual([]);
    });

    test('Deye: týždeň vopred pripomenie obnovu, tá pýta len heslo', async ({ page }) => {
        const platiDo = new Date(FIXED_NOW.getTime() + 5 * 864e5 - 60_000).toISOString();
        const deye = { sposob: 'deye-aplikacia', pecat: TEST_ZDROJ.pecat, nazov: 'Chata', platiDo };
        const errors = await openObloha(page, { settings: { ...OWNER, zdroj: deye } });
        /** @type {string[]} */ const pripoj = [];
        const nova = new Date(FIXED_NOW.getTime() + 60 * 864e5).toISOString();
        await page.route(WORKER_PRIPOJ_URL, (route) => {
            pripoj.push(route.request().postData() || '');
            return route.fulfill({ json: { stanice: [{ nazov: 'Chata', pecat: 'v1.NovaPecat0123456789abcdefgh', pv, platiDo: nova }] } });
        });
        const v = /** @type {any} */ (pristupModel({ zdroj: deye, pristup: null, now: FIXED_NOW, timezone: SITE.timezone }));
        await nastavenie(page);
        await expect(page.locator('#ns-pristup')).toContainText(v.karta.nadpis);
        await expect(page.locator('#ns-rows')).toContainText(v.stav);
        await page.locator('#ns-pristup [data-setup-znova]').click();
        await obrazovka(page, 'pripoj');
        await expect(page.locator('#wz-title')).toHaveText(v.sprievodca.nadpis);
        await expect(page.locator('#wz-pola input')).toHaveCount(1);
        await page.locator('[data-setup-pole="heslo"]').fill('nove-heslo');
        await page.locator('#wz-pripojit').click();
        await expect(page.locator('#wz-stanice [data-setup-stanica="0"]')).toHaveAttribute('aria-pressed', 'true');
        expect(JSON.parse(pripoj[0])).toEqual({ sposob: 'deye-aplikacia', udaje: { heslo: 'nove-heslo' }, pecat: deye.pecat });
        await dalej(page);
        await expect(page.locator('#ns-pristup')).toBeHidden();
        expect((await ulozene(page)).zdroj.platiDo).toBe(nova);
        expect(JSON.stringify(await ulozene(page))).not.toContain('nove-heslo');
        expect(errors).toEqual([]);
    });
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
        await expect(page.locator('#hdr-status')).toHaveText('13:00 · živé meranie');
        expect(settingsFromLink(page.url()), 'adresa nesie nastavenie, prístup k meraniu nie').toEqual({ ...OWNER, zdroj: null });
        expect(errors).toEqual([]);
    });

    // Karty majú spoločné úložisko, no každá vlastnú adresu: stará karta nesie nastavenie
    // z chvíle, keď ho zapísala, a prevzatie po obnovení by novšie nastavenie prepísalo starším.
    test('stará karta po zmene nastavenia inde: vlastnú adresu neponúkne, cudzí odkaz v tej istej karte áno', async ({ page }) => {
        const errors = await openObloha(page);
        const novsie = { ...OWNER, plant: { ...OWNER.plant, panelWp: OWNER.plant.panelWp + 10 } };
        await page.evaluate(([k, v]) => localStorage.setItem(k, v), [SETTINGS_STORAGE_KEY, JSON.stringify(toUser(novsie))]);
        await page.reload();
        await expect(page.locator('#hdr-status')).toHaveText('13:00 · živé meranie');
        await expect(page.locator('#import-offer')).toBeHidden();
        expect(await ulozene(page)).toEqual(toUser(novsie));
        expect(settingsFromLink(page.url()), 'adresa nesie novšie uložené').toEqual({ ...novsie, zdroj: null });
        // Odkaz s iným nastavením otvorený v tej istej karte appka zapísaný nemá - ponúkne ho.
        await page.goto(page.url().split('#')[0] + HASH);
        await page.reload();
        await expect(page.locator('#import-offer')).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('odkaz, ktorý appka nevie prevziať: povie prečo a len Zavrieť; vložený v sprievodcovi tiež', async ({ page }) => {
        const novsi = `#${SHARE_HASH_KEY}=${Buffer.from(JSON.stringify({ v: SHARE_LINK_VERSION + 1, ...toUser(OWNER) })).toString('base64url')}`;
        const errors = await openObloha(page, { settings: null, hash: novsi });
        await expect(page.locator('#import-offer')).toBeVisible();
        await expect(page.locator('#import-offer-title')).toHaveText(LINK_ERRORS.novsi.title);
        await expect(page.locator('#import-offer-text')).toHaveText(LINK_ERRORS.novsi.text);
        await expect(page.locator('#import-accept')).toBeHidden();
        await expect(page.locator('#import-decline')).toHaveText('Zavrieť');
        await page.locator('#import-decline').click();
        await expect(page.locator('#import-offer')).toBeHidden();
        expect(new URL(page.url()).hash).toBe('');
        expect(await ulozene(page)).toBeNull();

        await nastavenie(page);
        await page.locator('#wz-welcome [data-setup-go="odkaz"]').click();
        await obrazovka(page, 'odkaz');
        await page.locator('#wz-link').fill(`https://rastislavsk.github.io/ray-mon/${novsi}`);
        await expect(page.locator('#wz-link-note')).toHaveText(LINK_ERRORS.novsi.paste);
        await page.locator('#wz-link').fill(LINK.slice(0, -12));
        await expect(page.locator('#wz-link-note')).toHaveText(LINK_ERRORS.poskodeny.paste);
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
        await expect(page.locator('#ns-cta-text')).toHaveText(new RegExp(`^Poloha ${SITE.name} je hotová\.`));
        expect(await page.locator('#ns-cta').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
        expect(await pulz(page)).toEqual([{ name: 'pulse-card', iterations: 3 }]);
        await expect.poll(() => pulz(page), { timeout: 6000 }).toEqual([]);
        await expect(page.locator('#ns-hero')).toBeHidden();
        await expect(page.locator('#ns-rows .it')).toHaveText([
            /Dvorany nad Nitrou/,
            /nezadané/,
            /nezadaný/,
            /nepripojené, nepovinné/,
            /nezadaná/,
        ]);
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
        await ocakavajKartu(page, 'terazky');
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
        // Ani mimo sprievodcu ťah karty nelistuje - len ťuknutie v navigácii.
        await tah(page, '#ns-cta', 150);
        await ocakavajKartu(page, 'nastavenie');
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
    await check('meranie');
    await dalej(page);
    await obrazovka(page, 'znacka');
    await check('znacka');
    await page.locator('[data-setup-znacka="huawei"]').click();
    await page.locator('[data-setup-sposob="huawei-kiosk"]').click();
    await obrazovka(page, 'pripoj');
    await page.locator('[data-setup-pole="odkaz"]').fill(TEST_KIOSK);
    await check('pripoj');
    await page.locator('#wz-pripojit').click();
    await expect(page.locator('#wz-stanice')).toBeVisible();
    await check('pripojene');
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

test.describe('bojler na prebytky', () => {
    const NB_ZDROJ = { sposob: 'huawei-northbound', pecat: 'v1.TestPecat0123456789abcdefgh', nazov: 'Dvorany' };
    const PECAT_ZASUVKY = 'v1.Zasuvka0123456789abcdefgh';
    /** Zásuvka sa ozvala pred minútou a bojler hreje. */
    const BOJLER_INFO = {
        kontaktAt: FIXED_NOW.getTime() - 60000,
        rele: true,
        w: 2210,
        prebytokKw: 2.6,
        prahy: { zapKw: 2.3, vypKw: 2 },
        den: null,
    };

    /** @param {import('@playwright/test').Page} page */
    async function otvor(page) {
        // Schránka: test si skopírovaný text odloží, prehliadač bez povolenia by ho zahodil.
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'clipboard', {
                value: { writeText: (/** @type {string} */ t) => /** @type {any} */ ((window.__schranka = t), Promise.resolve()) },
            });
        });
        await page.route(WORKER_BOJLER_PECAT_URL, (route) => route.fulfill({ json: { pecat: PECAT_ZASUVKY } }));
        // Sekcia je len s bojlerom v Čo máš doma.
        await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [DOMA_STORAGE_KEY, JSON.stringify(domaToStored(['bojler']))]);
        const errors = await openObloha(page, { settings: { ...OWNER, zdroj: NB_ZDROJ }, bojler: BOJLER_INFO });
        await page.locator('#nav-nastavenie').click();
        await page.locator('#ns-fold-doma').click();
        return errors;
    }

    test('stav zásuvky, prahy a skript do schránky', async ({ page }) => {
        const errors = await otvor(page);
        const sekcia = page.locator('#ns-bojler');
        await expect(sekcia).toBeVisible();
        const model = /** @type {any} */ (
            bojlerSekcia({
                zdroj: NB_ZDROJ,
                doma: ['bojler'],
                bojler: BOJLER_INFO,
                bojlerPrahy: { zapKw: 2.3, vypKw: 2 },
                bojlerSkript: { stav: 'nic', text: '', schranka: false },
                now: FIXED_NOW,
                site: SITE,
                voice: 'drzy',
            })
        );
        await expect(page.locator('#ns-bojler-stav')).toHaveText(model.stav.text);
        await expect(page.locator('#ns-bojler-prahy .prah-v')).toHaveText(['2,3 kW', '2,0 kW']);
        // Zapnutie o krok vyššie: uloží sa a skript ho ponesie.
        await page.locator('[data-bojler-prah="zapKw"][data-smer="1"]').click();
        await expect(page.locator('#ns-bojler-prahy .prah-v')).toHaveText(['2,4 kW', '2,0 kW']);
        expect(await page.evaluate((k) => localStorage.getItem(k), BOJLER_STORAGE_KEY)).toBe(JSON.stringify({ zapKw: 2.4, vypKw: 2 }));
        await expect(page.locator('#ns-bojler-ine')).toHaveText(model.ine || /prahy 2,3 a 2,0 kW/);
        await page.locator('#ns-bojler-skript').click();
        await expect(page.locator('#ns-bojler-sprava')).toHaveText(BOJLER_TEXTS.hotovo[0]);
        const skript = await page.evaluate(() => /** @type {any} */ (window).__schranka);
        expect(skript).toBe(skriptBojlera({ url: WORKER_BOJLER_URL, pecat: PECAT_ZASUVKY, zapKw: 2.4, vypKw: 2 }));
        await expect(page.locator('#ns-bojler-text')).toBeHidden();
        const axe = await new AxeBuilder({ page }).include('#ns-bojler').analyze();
        expect(axe.violations).toEqual([]);
        expect(errors).toEqual([]);
    });

    test('teplomer (docs/navrhy/bojler-teplota.html): teplota na dlaždici, krivka v paneli a skript s teplomerom', async ({ page }) => {
        // Teplomer hlási 52,4 °C, dnes ráno voda vychladla a teraz ju slnko ohrieva.
        const teraz = localMinutes(FIXED_NOW, SITE.timezone);
        const teploty = /** @type {Array<[number, number]>} */ (
            Array.from({ length: 49 }, (_, i) => [teraz - (48 - i) * 5, 44 + (i / 48) * 8.4])
        );
        const info = { ...BOJLER_INFO, rucne: false, voda: { t: 52.4, at: FIXED_NOW.getTime() - 60000 }, teploty };
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'clipboard', {
                value: { writeText: (/** @type {string} */ t) => /** @type {any} */ ((window.__schranka = t), Promise.resolve()) },
            });
        });
        await page.route(WORKER_BOJLER_PECAT_URL, (route) => route.fulfill({ json: { pecat: PECAT_ZASUVKY } }));
        await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [DOMA_STORAGE_KEY, JSON.stringify(domaToStored(['bojler']))]);
        const errors = await openObloha(page, { settings: { ...OWNER, zdroj: NB_ZDROJ }, bojler: info });
        // T1: veľké číslo dlaždice je teplota vody.
        const dl = page.locator('#tz-dlazdice [data-vec="bojler"]');
        await expect(dl.locator('.velky')).toHaveText(bojlerDlazdica(info, FIXED_NOW, SITE.timezone).velky);
        await expect(dl.locator('.velky')).toHaveText('52 °C');
        // P1: krivka teploty v paneli Bojler dnes.
        await dl.click();
        const d = bojlerDetail(info, FIXED_NOW, SITE.timezone);
        const voda = page.locator('#tz-bojler-voda');
        await expect(voda).toBeVisible();
        await expect(voda).toHaveAccessibleName(/** @type {NonNullable<typeof d.voda>} */ (d.voda).popis);
        await expect(voda.locator('.bj-voda-c')).toHaveCount(1);
        await expect(voda.locator('.bj-voda-t')).toHaveText('52 °C');
        await expect(voda.locator('.bj-voda-ct')).toHaveText('55 °C');
        expect((await new AxeBuilder({ page }).include('#tz-bojler-sheet').analyze()).violations).toEqual([]);
        await page.locator('#tz-bojler-sheet').screenshot({ path: test.info().outputPath('bojler-dnes.png') });
        await page.keyboard.press('Escape');
        // N2: prepínač ukáže adresu a heslo; bez hesla skript nebude, s heslom ponesie teplomer.
        await page.locator('#nav-nastavenie').click();
        await page.locator('#ns-fold-doma').click();
        const prepinac = page.locator('#ns-teplomer');
        await expect(page.locator('#ns-teplomer-small')).toHaveText(
            BOJLER_TEXTS.teplomer.voda('52 °C', minutesToTimeStr(localMinutes(new Date(info.voda.at), SITE.timezone))),
        );
        await expect(page.locator('#ns-teplomer-polia')).toBeHidden();
        await prepinac.click();
        await expect(prepinac).toHaveAttribute('aria-checked', 'true');
        await expect(page.locator('#ns-teplomer-polia')).toBeVisible();
        await page.locator('#ns-teplomer-ip').fill('10.10.10.50');
        await page.locator('#ns-teplomer-heslo').click();
        expect(await page.evaluate((k) => localStorage.getItem(k), TEPLOMER_STORAGE_KEY)).toBe(
            JSON.stringify({ on: true, ip: '10.10.10.50' }),
        );
        await page.locator('#ns-bojler-skript').click();
        await expect(page.locator('#ns-bojler-sprava')).toHaveText(BOJLER_TEXTS.teplomer.chyba[0]);
        await page.locator('#ns-teplomer-heslo').fill('Tajne-heslo1');
        await page.locator('#ns-bojler-skript').click();
        await expect(page.locator('#ns-bojler-sprava')).toHaveText(BOJLER_TEXTS.hotovo[0]);
        const skript = await page.evaluate(() => /** @type {any} */ (window).__schranka);
        expect(skript).toBe(
            skriptBojlera({
                url: WORKER_BOJLER_URL,
                pecat: PECAT_ZASUVKY,
                zapKw: 2.3,
                vypKw: 2,
                teplomer: { ip: '10.10.10.50', heslo: 'Tajne-heslo1' },
            }),
        );
        expect(JSON.stringify(await page.evaluate(() => ({ ...localStorage })))).not.toContain('Tajne-heslo1');
        await page.locator('#ns-bojler').screenshot({ path: test.info().outputPath('nastavenie-teplomer.png') });
        expect((await new AxeBuilder({ page }).include('#ns-bojler').analyze()).violations).toEqual([]);
        expect(errors).toEqual([]);
    });

    test('bez bojlera doma či pri inom meraní sekcia nie je', async ({ page }) => {
        const errors = await openObloha(page);
        await page.locator('#nav-nastavenie').click();
        await page.locator('#ns-fold-doma').click();
        await expect(page.locator('#ns-doma')).toBeVisible();
        await expect(page.locator('#ns-bojler')).toBeHidden();
        expect(errors).toEqual([]);
    });

    test('karta Teraz: smer toku, dlaždica Bojler a panel Bojler dnes', async ({ page }) => {
        await page.addInitScript(
            ([k, v]) => localStorage.setItem(k, v),
            [DOMA_STORAGE_KEY, JSON.stringify(domaToStored(['pracka', 'bojler']))],
        );
        // Dnes od 10:40 dva behy, druhý beží; zásuvka sa ozvala pred minútou a bojler hreje.
        const den = {
            den: '2026-09-05',
            behy: [
                { od: 640, do: 685, wh: 1650, whSiet: 0, e0: 1000, hrejeMin: 45 },
                { od: 705, do: null, wh: 2050, whSiet: 120, e0: 2650, hrejeMin: 55 },
            ],
            hotovo: null,
            posledneAt: FIXED_NOW.getTime() - 60000,
        };
        const info = { ...BOJLER_INFO, den };
        const errors = await openObloha(page, {
            settings: { ...OWNER, zdroj: NB_ZDROJ },
            bojler: info,
            pvNavyse: { sietKw: 0.4, measuredAt: FIXED_NOW.toISOString() },
        });
        // Scéna toku energie (docs/navrhy/teraz-tok-energie.html) je len kresba, čísla sú v poli toku pod pásom dní
        // (docs/navrhy/teraz-pole-noc-bezi.html, 1A): bez slov, vetu dostane čítačka. Ťuknutie na pole aj na scénu
        // otvorí panel Elektrina teraz.
        const s = scenaModel({ vyrobaKw: pv.realTimePowerKw, odhad: false, sietKw: 0.4 });
        const scena = page.locator('#tz-scena');
        const pole = page.locator('#tz-tok');
        await expect(scena).toHaveAccessibleName(s.popis);
        await expect(scena.locator('.sc-bod[data-smer="von"]')).toHaveCount(s.body);
        await expect(pole).toHaveAccessibleName(s.popis);
        await expect(pole.locator('.tp-u b')).toHaveText([`${s.vyroba}`, `${s.dom}`, `${s.siet?.kw}`]);
        await expect(pole.locator('.tp-v[data-smer]')).toHaveCount(2);
        await expect(pole.locator('.tp-v').last()).toHaveAttribute('data-smer', 'von');
        await pole.click();
        const tokSheet = page.locator('#tz-tok-sheet');
        await expect(tokSheet).toBeVisible();
        const td = /** @type {NonNullable<ReturnType<typeof tokDetail>>} */ (
            tokDetail({ vyrobaKw: pv.realTimePowerKw, sietKw: 0.4, meraneAt: FIXED_NOW.getTime() }, FIXED_NOW, SITE.timezone)
        );
        await expect(page.locator('#tz-tok-ttl')).toHaveText(td.nadpis);
        await expect(page.locator('#tz-tok-pod')).toHaveText(td.pod);
        await expect(page.locator('#tz-tok-graf > svg')).toHaveAttribute('aria-label', td.popis);
        await expect(page.locator('#tz-tok-graf .tok-bod')).toHaveCount(2);
        expect((await new AxeBuilder({ page }).include('#tz-tok-sheet').analyze()).violations).toEqual([]);
        await page.keyboard.press('Escape');
        await expect(tokSheet).toBeHidden();
        await expect(scena).toBeFocused();
        await scena.click();
        await expect(tokSheet).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(tokSheet).toBeHidden();
        // Pole stojí na mieste hlavičky iného dňa: dlaždice sú dnes aj zajtra na tej istej výške.
        const hore = () => page.locator('#tz-dlazdice').evaluate((el) => Math.round(el.getBoundingClientRect().top + scrollY));
        const dnes = await hore();
        await page.locator('#tz-hreben-dni [data-den="1"]').click();
        await expect(pole).toBeHidden();
        expect(await hore()).toBe(dnes);
        await page.locator('#tz-hreben-dni [data-den="0"]').click();
        await expect(pole).toBeVisible();
        // Všetky dlaždice v tvare Bojlera (A3): s veľkým číslom.
        await expect(page.locator('#tz-dlazdice .dl .velky')).toHaveCount(await page.locator('#tz-dlazdice .dl').count());
        const t = bojlerDlazdica(info, FIXED_NOW, SITE.timezone);
        const dl = page.locator('#tz-dlazdice [data-vec="bojler"]');
        await expect(dl).toHaveAttribute('data-tone', t.tone);
        await expect(dl).toContainText(t.meno);
        await expect(dl.locator('small > span:not(.sr)')).toHaveText(t.odr);
        // Značka pri ikone: riadi appka. Bojler hreje, preto má zelenú ikonu a obrys (docs/navrhy/teraz-pole-noc-bezi.html, 3A).
        await expect(dl.locator('.dl-ico .dl-rz')).toHaveAttribute('data-rezim', 'appka');
        await expect(dl).toHaveAttribute('data-zapnuty', '');
        await expect(dl.locator('.dl-ico')).toHaveCSS('color', 'rgb(185, 242, 140)');
        await expect(page.locator('#tz-co [data-vec="bojler"]'), 'bojler, ktorý riadi zásuvka, appka neradí').toHaveCount(1);
        await dl.click();
        const sheet = page.locator('#tz-bojler-sheet');
        await expect(sheet).toBeVisible();
        await expect(page.locator('#tz-vec-sheet')).toBeHidden();
        const d = bojlerDetail(info, FIXED_NOW, SITE.timezone);
        await expect(page.locator('#tz-bojler-pod')).toHaveText(d.pod);
        await expect(page.locator('#tz-bojler-cisla b')).toHaveText(d.cisla.map((c) => c.v));
        await expect(page.locator('#tz-bojler-behy p')).toHaveCount(2);
        // Riadok behu: čas, kWh zo slnka a zo siete, na jeden riadok a všetky rovnako vysoké.
        await expect(page.locator('#tz-bojler-behy p > span')).toHaveText(d.behy.map((r) => r.cas));
        await expect(page.locator('#tz-bojler-behy i[data-tone="slnko"]')).toHaveText(
            d.behy.map((r) => `${r.slnko} ${TERAZ_BOJLER_TEXTS.zoSlnka}`),
        );
        const vysky = await page.locator('#tz-bojler-behy p').evaluateAll((ps) => ps.map((p) => p.getBoundingClientRect().height));
        expect(new Set(vysky).size, 'riadky behov rovnako vysoké').toBe(1);
        await expect(page.locator('#tz-bojler-pas .os-usek')).toHaveCount(d.pas.useky.length);
        const axe = await new AxeBuilder({ page }).include('#tz-bojler-sheet').analyze();
        expect(axe.violations).toEqual([]);
        await page.keyboard.press('Escape');
        await expect(sheet).toBeHidden();
        expect(errors).toEqual([]);
    });
    test('dlaždica Bojler sa prekreslí s hlásením zásuvky, nečaká na meranie; push zmeny ohrevu ju obnoví hneď', async ({ page }) => {
        await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [DOMA_STORAGE_KEY, JSON.stringify(domaToStored(['bojler']))]);
        /** @type {object} */
        let stav = { ...BOJLER_INFO, rele: false, w: 0, kontaktAt: FIXED_NOW.getTime() };
        /** @type {string[]} */
        const dopyty = [];
        await page.route(WORKER_BOJLER_STAV_URL, (route) => {
            dopyty.push(route.request().postData() ?? '');
            return route.fulfill({ json: { bojler: stav } });
        });
        let merania = 0;
        page.on('request', (r) => r.url() === WORKER_PV_URL && merania++);
        const errors = await openObloha(page, { settings: { ...OWNER, zdroj: NB_ZDROJ }, bojler: BOJLER_INFO });
        const dl = page.locator('#tz-dlazdice [data-vec="bojler"]');
        await expect(dl).toHaveAttribute('data-zapnuty', '');
        // Minútová obnova (tu návrat z pozadia): meranie ešte nie je na rade, stav bojlera príde z /bojler-stav.
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        // Prvý riadok je stav zo zásuvky; druhý (kedy zapne) ráta appka z predpovede.
        const vyp = bojlerDlazdica(/** @type {any} */ (stav), FIXED_NOW, SITE.timezone);
        await expect(dl.locator('small > span:not(.sr)').first()).toHaveText(vyp.odr[0]);
        await expect(dl).not.toHaveAttribute('data-zapnuty', '');
        expect(JSON.parse(dopyty[0])).toEqual({ pecat: NB_ZDROJ.pecat });
        expect(merania, 'na meranie sa appka znova nepýta').toBe(1);
        // Push o zmene ohrevu: service worker pošle oknu správu a appka si stav stiahne hneď.
        stav = { ...BOJLER_INFO, kontaktAt: FIXED_NOW.getTime() };
        await page.evaluate((d) => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: d })), OZNAMENIA.bojler);
        await expect(dl).toHaveAttribute('data-zapnuty', '');
        expect(dopyty).toHaveLength(2);
        expect(errors).toEqual([]);
    });

    test('spoločné behy: beh z druhého telefónu príde s obnovou dát, „Nastaviť“ ide hneď Workeru, nepotvrdená zmena čaká', async ({
        page,
    }) => {
        // docs/navrhy/bezi-spolocne.html: Worker podvrhnutý zoznamom, ktorý drží aj „druhý telefón“.
        await page.addInitScript(
            ([k, v]) => localStorage.setItem(k, v),
            [DOMA_STORAGE_KEY, JSON.stringify(domaToStored(['pracka', 'umyvacka']))],
        );
        const d = '2026-09-05';
        const umyvacka = { id: 'umyvacka', d, m: 12 * 60, k: 14 * 60 + 30 };
        /** @type {object[]} */ let spolocne = [umyvacka];
        /** @type {any[]} */ const dopyty = [];
        let vypadok = false;
        await page.route(WORKER_BEZI_URL, (route) => {
            const telo = JSON.parse(route.request().postData() ?? '{}');
            dopyty.push(telo);
            if (vypadok) return route.fulfill({ status: 503, json: { chyba: 'server' } });
            for (const z of telo.zmeny) spolocne = [...spolocne.filter((b) => /** @type {any} */ (b).id !== z.id), ...z.behy];
            return route.fulfill({ json: { bezi: spolocne } });
        });
        const errors = await openObloha(page, { settings: { ...OWNER, zdroj: NB_ZDROJ } });
        const umDl = page.locator('#tz-co [data-vec="umyvacka"]');
        const prDl = page.locator('#tz-co [data-vec="pracka"]');
        await expect(umDl, 'umývačku zapol druhý telefón').toHaveAttribute('data-zapnuty', '');
        expect(dopyty[0]).toEqual({ pecat: NB_ZDROJ.pecat, d, zmeny: [] });
        // „Už beží“ a „Nastaviť“ na tomto telefóne ide Workeru hneď, s behmi práčky.
        await prDl.click();
        await page.locator('#tz-vec-zapol').click();
        await page.locator('#tz-vec-ok').click();
        await expect.poll(() => dopyty.at(-1)?.zmeny?.[0]?.id).toBe('pracka');
        expect(dopyty.at(-1).zmeny[0].behy).toHaveLength(1);
        await expect(prDl).toHaveAttribute('data-zapnuty', '');
        expect(await page.evaluate((k) => localStorage.getItem(k), BEZI_CAKA_STORAGE_KEY)).toBe('[]');
        // Druhý telefón umývačku zrušil: po návrate do appky zmizne aj tu.
        spolocne = spolocne.filter((b) => /** @type {any} */ (b).id !== 'umyvacka');
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await expect(umDl).not.toHaveAttribute('data-zapnuty');
        await expect(prDl).toHaveAttribute('data-zapnuty', '');
        // Bez Workera: „Nebeží“ platí v telefóne a čaká; odpoveď Workera s práčkou ju potom neprepíše, zmena ide znova.
        vypadok = true;
        await prDl.click();
        await page.locator('#tz-vec-zrus').click();
        await expect(prDl).not.toHaveAttribute('data-zapnuty');
        await expect
            .poll(() => page.evaluate((k) => localStorage.getItem(k), BEZI_CAKA_STORAGE_KEY))
            .toBe(JSON.stringify([{ id: 'pracka', d }]));
        vypadok = false;
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), BEZI_CAKA_STORAGE_KEY)).toBe('[]');
        expect(dopyty.at(-1).zmeny).toEqual([{ id: 'pracka', d, behy: [] }]);
        expect(spolocne).toEqual([]);
        await expect(prDl).not.toHaveAttribute('data-zapnuty');
        expect(errors).toEqual([]);
    });

    test('ručný režim: prepínač v paneli Bojler dnes uloží režim a dlaždica prestane radiť', async ({ page }) => {
        await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [DOMA_STORAGE_KEY, JSON.stringify(domaToStored(['bojler']))]);
        /** @type {any[]} */ const ulozene = [];
        let zlyhaj = false;
        await page.route(WORKER_BOJLER_REZIM_URL, (route) => {
            const telo = JSON.parse(route.request().postData() ?? '{}');
            ulozene.push(telo);
            return zlyhaj
                ? route.fulfill({ status: 503, json: { chyba: 'server' } })
                : route.fulfill({ json: { ok: true, bojler: { ...BOJLER_INFO, rucne: telo.rucne } } });
        });
        const errors = await openObloha(page, { settings: { ...OWNER, zdroj: NB_ZDROJ }, bojler: BOJLER_INFO });
        const R = TERAZ_BOJLER_TEXTS.rezim;
        await page.locator('#tz-dlazdice [data-vec="bojler"]').click();
        const appka = page.locator('[data-bojler-rezim="appka"]');
        const rucne = page.locator('[data-bojler-rezim="rucne"]');
        await expect(appka).toHaveText(R.appka);
        await expect(appka).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#tz-bojler-rezim-t')).toHaveText(R.popisAppka('2,3', '2,0'));
        await expect(page.locator('#tz-bojler-rezim')).toHaveAttribute('data-rucne', 'false');
        await rucne.click();
        await expect(rucne).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#tz-bojler-rezim'), 'biela plocha prejde pod Ručne').toHaveAttribute('data-rucne', 'true');
        // Worker uložil: na chvíľu zelené „Uložené“ namiesto popisu, potom sa popis vráti sám.
        const ok = page.locator('#tz-bojler-rezim-ok');
        await expect(ok).toBeVisible();
        await expect(ok).toHaveText(R.ulozene(true));
        await expect(page.locator('#tz-bojler-rezim-t')).toBeHidden();
        await expect(ok).toBeHidden();
        await expect(page.locator('#tz-bojler-rezim-t')).toHaveText(R.popisRucne);
        expect(ulozene).toEqual([{ pecat: NB_ZDROJ.pecat, rucne: true }]);
        const info = { ...BOJLER_INFO, rucne: true };
        await expect(page.locator('#tz-bojler-pod')).toHaveText(bojlerDetail(info, FIXED_NOW, SITE.timezone).pod);
        expect((await new AxeBuilder({ page }).include('#tz-bojler-sheet').analyze()).violations).toEqual([]);
        // Obnovenie stránky pred ďalším meraním: režim drží (uložený rytmus nesie nový stav bojlera).
        await page.reload();
        await expect(page.locator('#tz-dlazdice [data-vec="bojler"]')).toHaveAttribute('data-tone', 'tiche');
        await page.locator('#tz-dlazdice [data-vec="bojler"]').click();
        await expect(rucne).toHaveAttribute('aria-pressed', 'true');
        // Nepodarí sa uložiť: prepínač sa vráti a povie to.
        zlyhaj = true;
        await appka.click();
        await expect(page.locator('#tz-bojler-rezim-chyba')).toHaveText(R.chyba);
        await expect(ok, 'neuložené nepotvrdí').toBeHidden();
        await expect(rucne).toHaveAttribute('aria-pressed', 'true');
        await page.keyboard.press('Escape');
        const t = bojlerDlazdica(info, FIXED_NOW, SITE.timezone);
        const dl = page.locator('#tz-dlazdice [data-vec="bojler"]');
        await expect(dl).toHaveAttribute('data-tone', 'tiche');
        await expect(dl).toContainText(t.meno);
        await expect(dl.locator('small > span:not(.sr)')).toHaveText(t.odr);
        // Ručný režim ukáže značka s rukou, nie slovo v texte; čítačka ho počuje v mene dlaždice.
        await expect(dl.locator('.dl-rz')).toHaveAttribute('data-rezim', 'rucne');
        await expect(dl).not.toContainText('ručne');
        await expect(dl).toHaveAccessibleName(new RegExp(R.rucne));
        expect(errors).toEqual([]);
    });
});
