// E2E novej appky „Živá obloha“ na širšej obrazovke (krok 8): tablet na výšku, tablet na šírku
// a počítač. Rozloženie rozhoduje šírka okna (LAYOUT_PX v shared/config.js). Očakávané texty sa
// počítajú tými istými modelmi ako na telefóne - stĺpce sú tie isté karty, len vedľa seba.
import { expect, test } from '@playwright/test';
import { PLANT, SETTINGS_STORAGE_KEY, SITE, TARIFF, WORKER_PV_URL } from '../../shared/config.js';
import { mozemSkyModel } from '../../shared/mozem-sky.js';
import { sedemModel } from '../../shared/sedem-dni.js';
import { toUser } from '../../shared/settings.js';
import { buildForecast } from '../../shared/solar.js';
import { terazModel } from '../../shared/teraz.js';
import { fixture, pvAt } from '../helpers.js';

const weather = fixture('open-meteo.json');
const TEST_KIOSK = 'https://region01eu5.fusionsolar.huawei.com/pvmswebsite/nologin/assets/build/index.html#/kiosk?kk=Test1234';
const OWNER = { site: SITE, plant: PLANT, tariff: TARIFF, kiosk: TEST_KIOSK };
const IGNORED_CONSOLE = /Failed to load resource|net::ERR_FAILED/;

/** Presný okamih daného času 5. 9. 2026 v Bratislave (letný čas, UTC+2). @param {string} hm */
const at = (hm) => new Date(`2026-09-05T${hm}:00+02:00`);
const NOON = at('13:00');

const TELEFON = { width: 390, height: 844 };
const TABLET_VYSKA = { width: 820, height: 1180 };
const TABLET_SIRKA = { width: 1180, height: 820 };
const POCITAC = { width: 1440, height: 900 };

/**
 * Otvorí novú appku s uloženými Dvoranami, pevným časom a dátami z fixtures.
 * @param {import('@playwright/test').Page} page @param {{ width: number, height: number }} size
 * @param {{ time?: Date, settings?: typeof OWNER | null }} [opts]
 */
async function openObloha(page, size, { time = NOON, settings = OWNER } = {}) {
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (msg) => msg.type() === 'error' && !IGNORED_CONSOLE.test(msg.text()) && errors.push(msg.text()));
    await page.setViewportSize(size);
    await page.route(/cdnjs\.cloudflare\.com/, (route) => route.abort());
    await page.route(WORKER_PV_URL, (route) => route.fulfill({ json: { pv: pvAt(time) } }));
    await page.route(/api\.open-meteo\.com/, (route) => route.fulfill({ json: weather }));
    await page.route(/geocoding-api\.open-meteo\.com/, (route) => route.fulfill({ json: { results: [] } }));
    if (settings)
        await page.addInitScript(
            ([k, v]) => localStorage.getItem(k) || localStorage.setItem(k, v),
            [SETTINGS_STORAGE_KEY, JSON.stringify(toUser(settings))],
        );
    await page.clock.setFixedTime(time);
    await page.goto('/obloha/');
    await expect(page.locator('#page')).toHaveAttribute('data-panel', /.+/);
    await expect(page.locator('#hdr-status')).not.toHaveText('načítavam…');
    return errors;
}

/** Vstup modelov kariet v danej chvíli s dátami z fixtures - ten istý, aký dostane appka. @param {Date} time */
const vstup = (time) => ({
    ...OWNER,
    now: time,
    loading: false,
    known: /** @type {const} */ ('elektraren'),
    pv: pvAt(time),
    forecast: buildForecast(weather, time, SITE, PLANT),
});

/**
 * Viditeľné karty, ich poloha a nadpisy, poloha navigácie.
 * @param {import('@playwright/test').Page} page
 */
const rozlozenie = (page) =>
    page.evaluate(() => {
        const panels = [...document.querySelectorAll('.panel')]
            .filter((p) => p.checkVisibility())
            .map((p) => {
                const r = p.getBoundingClientRect();
                return {
                    id: p.id.replace('panel-', ''),
                    left: Math.round(r.left),
                    top: Math.round(r.top + scrollY),
                    right: Math.round(r.right),
                };
            });
        const nav = /** @type {Element} */ (document.querySelector('.tabs')).getBoundingClientRect();
        return {
            layout: document.documentElement.dataset.layout,
            panels,
            columns: new Set(panels.map((p) => p.left)).size,
            nav: nav.top + scrollY < innerHeight / 2 ? 'hore' : 'dole',
            current: document.querySelector('.tabs [aria-current]')?.id,
            wide: document.documentElement.scrollWidth > innerWidth,
        };
    });

test.describe('tri rozloženia podľa šírky okna', () => {
    test('telefón (390 px): jedna karta, navigácia dole', async ({ page }) => {
        const errors = await openObloha(page, TELEFON);
        const r = await rozlozenie(page);
        expect(r).toMatchObject({ layout: 'narrow', columns: 1, nav: 'dole', current: 'nav-mozem', wide: false });
        expect(r.panels.map((p) => p.id)).toEqual(['mozem']);
        await expect(page.locator('#mz-word')).toHaveText(mozemSkyModel(vstup(NOON)).word);
        expect(errors).toEqual([]);
    });

    test('tablet na výšku (820 px): jedna karta s rozumnou šírkou a väčším grafom, navigácia dole', async ({ page }) => {
        // Graf dňa na telefóne pre porovnanie.
        await openObloha(page, TELEFON);
        await page.locator('#nav-terazky').click();
        const naTelefone = /** @type {{ width: number }} */ (await page.locator('#tz-chart').boundingBox()).width;

        const errors = await openObloha(page, TABLET_VYSKA);
        const r = await rozlozenie(page);
        expect(r).toMatchObject({ layout: 'narrow', columns: 1, nav: 'dole', wide: false });
        expect(r.panels.map((p) => p.id)).toEqual(['mozem']);
        // Obsah nie je roztiahnutý cez celú šírku: okraje po bokoch, stĺpec v strede.
        const [mozem] = r.panels;
        expect(mozem.right - mozem.left).toBeLessThanOrEqual(680);
        expect(Math.abs(mozem.left - (TABLET_VYSKA.width - mozem.right))).toBeLessThanOrEqual(1);
        await expect(page.locator('#mz-word')).toHaveText(mozemSkyModel(vstup(NOON)).word);
        await page.locator('#nav-terazky').click();
        const graf = /** @type {{ width: number }} */ (await page.locator('#tz-chart').boundingBox()).width;
        expect(graf).toBeGreaterThan(naTelefone * 1.4);
        expect(errors).toEqual([]);
    });

    test('tablet na šírku (1180 px): dva stĺpce - vľavo Môžem?, vpravo Teraz a pod ním 7 dní, navigácia hore', async ({ page }) => {
        const errors = await openObloha(page, TABLET_SIRKA);
        const r = await rozlozenie(page);
        expect(r).toMatchObject({ layout: 'medium', columns: 2, nav: 'hore', current: 'nav-mozem', wide: false });
        const [mozem, teraz, sedem] = r.panels;
        expect(r.panels.map((p) => p.id)).toEqual(['mozem', 'terazky', '7dni']);
        expect(teraz.left).toBeGreaterThan(mozem.right);
        expect(sedem.left).toBe(teraz.left);
        expect(sedem.top).toBeGreaterThan(teraz.top);
        expect(teraz.top).toBe(mozem.top);
        await expectTextyKariet(page);
        expect(errors).toEqual([]);
    });

    test('počítač (1440 px): tri stĺpce Môžem?, Teraz, 7 dní vedľa seba, navigácia hore s menom karty', async ({ page }) => {
        const errors = await openObloha(page, POCITAC);
        const r = await rozlozenie(page);
        expect(r).toMatchObject({ layout: 'wide', columns: 3, nav: 'hore', current: 'nav-mozem', wide: false });
        expect(r.panels.map((p) => p.id)).toEqual(['mozem', 'terazky', '7dni']);
        const [mozem, teraz, sedem] = r.panels;
        expect(teraz.left).toBeGreaterThan(mozem.right);
        expect(sedem.left).toBeGreaterThan(teraz.right);
        expect(new Set(r.panels.map((p) => p.top)).size).toBe(1);
        // Meno karty je vedľa ikony, nie pod ňou.
        const polozky = await page.locator('.tabs button').evaluateAll((buttons) =>
            buttons.map((b) => {
                const icon = /** @type {Element} */ (b.querySelector('svg')).getBoundingClientRect();
                const label = /** @type {Element} */ (b.querySelector('span')).getBoundingClientRect();
                return label.left >= icon.right && Math.abs(label.top + label.height / 2 - (icon.top + icon.height / 2)) < 4;
            }),
        );
        expect(polozky).toEqual([true, true, true, true, true]);
        await expectTextyKariet(page);
        expect(errors).toEqual([]);
    });

    test('Štatistika a Nastavenie sú na počítači samostatná stránka v strednom stĺpci', async ({ page }) => {
        const errors = await openObloha(page, POCITAC);
        for (const panel of ['statistika', 'nastavenie']) {
            await page.locator(`#nav-${panel}`).click();
            // Kód karty sa môže ešte sťahovať (obloha/web/parts.js) - dovtedy je namiesto nej hláška.
            await expect(page.locator(`#panel-${panel}`)).toBeVisible();
            const r = await rozlozenie(page);
            expect(r.panels.map((p) => p.id)).toEqual([panel]);
            const [p] = r.panels;
            expect(p.right - p.left).toBeLessThanOrEqual(680);
            expect(Math.abs(p.left - (POCITAC.width - p.right))).toBeLessThanOrEqual(1);
            expect(r.current).toBe(`nav-${panel}`);
        }
        expect(errors).toEqual([]);
    });
});

/** Stĺpce prehľadu majú tie isté texty ako karty na telefóne - z tých istých modelov. @param {import('@playwright/test').Page} page */
async function expectTextyKariet(page) {
    const v = vstup(NOON);
    const mozem = mozemSkyModel(v);
    await expect(page.locator('#mz-word')).toHaveText(mozem.word);
    await expect(page.locator('#mz-lead')).toHaveText(mozem.lead);
    await expect(page.locator('#mz-items .tile-name')).toHaveText(mozem.groups.map((g) => g.name));
    const teraz = terazModel({ ...v, previewMinutes: null });
    await expect(page.locator('#tz-num-val')).toHaveText(teraz.num);
    await expect(page.locator('#tz-now-head')).toHaveText(teraz.cards?.now.head ?? '');
    const sedem = sedemModel(v);
    await expect(page.locator('#sd-title')).toHaveText(sedem.title);
    await expect(page.locator('#sd-days .day em')).toHaveText(sedem.rows.map((r) => r.kwh));
    // Spoločný nadpis prehľadu pre čítačku, nadpisy stĺpcov o úroveň nižšie.
    await expect(page.locator('h1:not([aria-level]):visible')).toHaveCount(1);
    for (const p of ['mozem', 'terazky', '7dni']) await expect(page.locator(`#ttl-${p}`)).toHaveAttribute('aria-level', '2');
}

test.describe('zmena šírky okna nič nestratí', () => {
    test('otvorený detail dňa: na telefóne karta 7 dní, na tablete aj počítači v stĺpci 7 dní', async ({ page }) => {
        const errors = await openObloha(page, POCITAC);
        await page.locator('#sd-days [data-day="2"]').click();
        await expect(page.locator('#sd-day')).toBeVisible();
        const nadpis = await page.locator('#sd-day-title').textContent();
        for (const size of [TELEFON, TABLET_SIRKA, TABLET_VYSKA, POCITAC]) {
            await page.setViewportSize(size);
            await expect(page.locator('#sd-day')).toBeVisible();
            await expect(page.locator('#sd-day-title')).toHaveText(nadpis ?? '');
            await expect(page.locator('#sd-list')).toBeHidden();
        }
        // Na telefóne je to karta 7 dní - jediná viditeľná.
        await page.setViewportSize(TELEFON);
        await expect.poll(async () => (await rozlozenie(page)).panels.map((p) => p.id)).toEqual(['7dni']);
        expect(errors).toEqual([]);
    });

    test('náhľad času na grafe: ostane ten istý čas aj číslo', async ({ page }) => {
        const errors = await openObloha(page, POCITAC);
        await page.locator('#tz-chart').focus();
        for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
        const cas = await page.locator('#tz-chart .dc-at-t').textContent();
        const num = await page.locator('#tz-num-val').textContent();
        expect(cas).toMatch(/^\d\d:\d\d$/);
        for (const size of [TELEFON, TABLET_SIRKA, TABLET_VYSKA, POCITAC]) {
            await page.setViewportSize(size);
            await expect(page.locator('#tz-chart')).toBeVisible();
            await expect(page.locator('#tz-chart .dc-at-t')).toHaveText(cas ?? '');
            await expect(page.locator('#tz-num-val')).toHaveText(num ?? '');
            await expect(page.locator('#tz-reset')).toBeVisible();
        }
        expect(errors).toEqual([]);
    });

    test('rozpísaný sprievodca: ostane tá istá obrazovka aj s tým, čo je napísané', async ({ page }) => {
        const errors = await openObloha(page, POCITAC);
        await page.locator('#nav-nastavenie').click();
        await page.locator('#ns-rows [data-setup-edit]').first().click();
        await expect(page.locator('#wizard')).toBeVisible();
        const nadpis = await page.locator('#wz-title').textContent();
        const pole = page.locator('#wizard input:visible:not([type="checkbox"]):not([type="radio"]):not([type="range"])').first();
        const mamPole = (await pole.count()) > 0;
        if (mamPole) await pole.fill('7');
        for (const size of [TELEFON, TABLET_SIRKA, TABLET_VYSKA, POCITAC]) {
            await page.setViewportSize(size);
            await expect(page.locator('#wizard')).toBeVisible();
            await expect(page.locator('#wz-title')).toHaveText(nadpis ?? '');
            if (mamPole) await expect(pole).toHaveValue('7');
        }
        expect(errors).toEqual([]);
    });

    test('otvorený panel veci: z panelu zospodu je dialóg v strede a naopak, ostane otvorený', async ({ page }) => {
        const errors = await openObloha(page, TELEFON);
        await page.locator('[data-item="velke"]').click();
        await expect(page.locator('#mz-sheet')).toBeVisible();
        const zospodu = /** @type {{ y: number, height: number }} */ (await page.locator('#mz-sheet').boundingBox());
        expect(Math.round(zospodu.y + zospodu.height)).toBe(TELEFON.height);
        await page.setViewportSize(POCITAC);
        await expect(page.locator('#mz-sheet')).toBeVisible();
        await expect(page.locator('#mz-sheet-title')).not.toBeEmpty();
        await vStrede(page, '#mz-sheet');
        expect(errors).toEqual([]);
    });
});

/**
 * Prvok je v strede okna (dialóg na širokej obrazovke).
 * @param {import('@playwright/test').Page} page @param {string} sel
 */
async function vStrede(page, sel) {
    const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (await page.locator(sel).boundingBox());
    const size = /** @type {{ width: number, height: number }} */ (page.viewportSize());
    expect(Math.abs(box.x + box.width / 2 - size.width / 2), `${sel} nie je v strede vodorovne`).toBeLessThanOrEqual(2);
    expect(Math.abs(box.y + box.height / 2 - size.height / 2), `${sel} nie je v strede zvislo`).toBeLessThanOrEqual(2);
    expect(box.width).toBeLessThan(size.width * 0.6);
}

test.describe('navigácia na počítači', () => {
    test('Môžem?, Teraz a 7 dní presunú fokus na stĺpec a zvýraznia ho, obrazovka ani história sa nemenia', async ({ page }) => {
        const errors = await openObloha(page, POCITAC);
        const kroky = await page.evaluate(() => history.length);
        for (const panel of ['terazky', '7dni', 'mozem']) {
            await page.locator(`#nav-${panel}`).click();
            await expect(page.locator(`#panel-${panel}`)).toBeFocused();
            await expect(page.locator(`#panel-${panel}`)).toHaveAttribute('data-on', '');
            await expect(page.locator('.panel[data-on]')).toHaveCount(1);
            await expect(page.locator(`#nav-${panel}`)).toHaveAttribute('aria-current', 'page');
            await expect(page.locator('.tabs [aria-current]')).toHaveCount(1);
            await expect.poll(async () => (await rozlozenie(page)).panels.map((p) => p.id)).toEqual(['mozem', 'terazky', '7dni']);
        }
        expect(await page.evaluate(() => history.length)).toBe(kroky);
        expect(errors).toEqual([]);
    });

    test('na tablete na šírku posunie navigácia stránku k stĺpcu 7 dní pod Teraz', async ({ page }) => {
        const errors = await openObloha(page, TABLET_SIRKA);
        await page.locator('#nav-7dni').click();
        await expect(page.locator('#panel-7dni')).toBeFocused();
        await expect(page.locator('#panel-7dni')).toBeInViewport();
        const nav = /** @type {{ y: number, height: number }} */ (await page.locator('.tabs').boundingBox());
        const sedem = /** @type {{ y: number }} */ (await page.locator('#panel-7dni').boundingBox());
        expect(sedem.y).toBeGreaterThanOrEqual(nav.y + nav.height - 1);
        expect(errors).toEqual([]);
    });

    test('Štatistika a Nastavenie sa otvoria ako stránka, Späť vráti prehľad so stĺpcami', async ({ page }) => {
        const errors = await openObloha(page, POCITAC);
        await page.locator('#nav-terazky').click();
        for (const panel of ['statistika', 'nastavenie']) {
            await page.locator(`#nav-${panel}`).click();
            await expect.poll(async () => (await rozlozenie(page)).panels.map((p) => p.id)).toEqual([panel]);
            await expect(page.locator(`#nav-${panel}`)).toHaveAttribute('aria-current', 'page');
            await page.goBack();
            await expect.poll(async () => (await rozlozenie(page)).panels.map((p) => p.id)).toEqual(['mozem', 'terazky', '7dni']);
            await expect(page.locator('#nav-terazky')).toHaveAttribute('aria-current', 'page');
        }
        expect(errors).toEqual([]);
    });
});

test.describe('dialógy na počítači', () => {
    test('panel veci je dialóg v strede; Escape aj Späť ho zavrú a fokus sa vráti na riadok', async ({ page }) => {
        const errors = await openObloha(page, POCITAC);
        const riadok = page.locator('[data-item="velke"]');
        await riadok.click();
        await expect(page.locator('#mz-sheet')).toBeVisible();
        await vStrede(page, '#mz-sheet');
        await page.keyboard.press('Escape');
        await expect(page.locator('#mz-sheet')).toBeHidden();
        await expect(riadok).toBeFocused();
        await riadok.click();
        await expect(page.locator('#mz-sheet')).toBeVisible();
        await page.goBack();
        await expect(page.locator('#mz-sheet')).toBeHidden();
        await expect(riadok).toBeFocused();
        // Stĺpce ostali, kde boli.
        await expect.poll(async () => (await rozlozenie(page)).panels.map((p) => p.id)).toEqual(['mozem', 'terazky', '7dni']);
        expect(errors).toEqual([]);
    });

    test('plagát je dialóg v strede; Escape aj Späť ho zavrú a fokus sa vráti na tlačidlo', async ({ page }) => {
        const errors = await openObloha(page, POCITAC);
        // Zo Štatistiky.
        await page.locator('#nav-statistika').click();
        const tlacidlo = page.locator('#st-posters [data-poster]').first();
        await tlacidlo.click();
        await expect(page.locator('#poster')).toBeVisible();
        await vStrede(page, '#poster .poster-in');
        await page.keyboard.press('Escape');
        await expect(page.locator('#poster')).toBeHidden();
        await expect(tlacidlo).toBeFocused();
        await tlacidlo.click();
        await expect(page.locator('#poster')).toBeVisible();
        await page.goBack();
        await expect(page.locator('#poster')).toBeHidden();
        await expect(tlacidlo).toBeFocused();
        // Z odkazu v stĺpci Môžem?.
        await page.locator('#nav-mozem').click();
        await page.locator('#mz-summary').click();
        await expect(page.locator('#poster')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#poster')).toBeHidden();
        await expect(page.locator('#mz-summary')).toBeFocused();
        expect(errors).toEqual([]);
    });

    test('detail dňa a týždňa sa otvoria v stĺpci 7 dní; Escape, Späť aj „‹ 7 dní“ vrátia prehľad a fokus', async ({ page }) => {
        const errors = await openObloha(page, POCITAC);
        const stlpec = /** @type {{ x: number, width: number }} */ (await page.locator('#panel-7dni').boundingBox());
        await page.locator('#sd-days [data-day="1"]').click();
        await expect(page.locator('#sd-day')).toBeVisible();
        const detail = /** @type {{ x: number, width: number }} */ (await page.locator('#sd-day').boundingBox());
        expect(detail.x).toBeGreaterThanOrEqual(stlpec.x - 0.5);
        expect(detail.x + detail.width).toBeLessThanOrEqual(stlpec.x + stlpec.width + 0.5);
        await expect(page.locator('#sd-day-back')).toBeFocused();
        // Ostatné stĺpce ostávajú.
        await expect(page.locator('#panel-mozem')).toBeVisible();
        await expect(page.locator('#panel-terazky')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#sd-list')).toBeVisible();
        await expect(page.locator('#sd-days [data-day="1"]')).toBeFocused();
        await page.locator('#sd-sum').click();
        await expect(page.locator('#sd-week')).toBeVisible();
        await page.goBack();
        await expect(page.locator('#sd-list')).toBeVisible();
        await expect(page.locator('#sd-sum')).toBeFocused();
        await page.locator('#sd-days [data-day="3"]').click();
        await page.locator('#sd-day-back').click();
        await expect(page.locator('#sd-days [data-day="3"]')).toBeFocused();
        expect(errors).toEqual([]);
    });

    test('Escape v náhľade grafu vráti teraz, otvorený detail dňa v stĺpci 7 dní nechá', async ({ page }) => {
        const errors = await openObloha(page, POCITAC);
        await page.locator('#sd-days [data-day="1"]').click();
        await page.locator('#tz-chart').focus();
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('#tz-reset')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#tz-reset')).toBeHidden();
        await expect(page.locator('#sd-day')).toBeVisible();
        expect(errors).toEqual([]);
    });
});

test.describe('tablet na šírku prstom', () => {
    test.use({ hasTouch: true });

    /**
     * Ťah prstom cez CDP ako na skutočnom displeji.
     * @param {import('@playwright/test').Page} page @param {string} sel nad čím ťah začne @param {number} dx
     */
    async function tah(page, sel, dx) {
        const box = await page.locator(sel).boundingBox();
        if (!box) throw new Error(`${sel} nie je vidno`);
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        for (const t of [0.2, 0.4, 0.6, 0.8, 1]) {
            await page.waitForTimeout(25);
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * t, y }] });
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await cdp.detach();
    }

    test('ťah do strán karty neprelistuje; v detaile dňa prejde na susedný deň, mimo stĺpca 7 dní nie', async ({ page }) => {
        const errors = await openObloha(page, TABLET_SIRKA);
        for (const dx of [-160, 160]) {
            await tah(page, '#mz-word', dx);
            await page.waitForTimeout(200);
            await expect(page.locator('#nav-mozem')).toHaveAttribute('aria-current', 'page');
            await expect.poll(async () => (await rozlozenie(page)).panels.map((p) => p.id)).toEqual(['mozem', 'terazky', '7dni']);
        }
        await tah(page, '#tz-num', -160);
        await page.waitForTimeout(200);
        await expect(page.locator('#nav-mozem')).toHaveAttribute('aria-current', 'page');

        await page.locator('#sd-days [data-day="0"]').click();
        await expect(page.locator('#sd-day-title')).toHaveText(/^Dnes/);
        await tah(page, '#sd-day-sub', -160);
        await expect(page.locator('#sd-day-title')).toHaveText(/^Zajtra/);
        // Ťah v stĺpci Môžem? dni nelistuje.
        await tah(page, '#mz-word', -160);
        await page.waitForTimeout(200);
        await expect(page.locator('#sd-day-title')).toHaveText(/^Zajtra/);
        await tah(page, '#sd-day-sub', 160);
        await expect(page.locator('#sd-day-title')).toHaveText(/^Dnes/);
        await tah(page, '#sd-day-sub', 160);
        await expect(page.locator('#sd-list')).toBeVisible();
        await expect.poll(async () => (await rozlozenie(page)).panels.map((p) => p.id)).toEqual(['mozem', 'terazky', '7dni']);
        expect(errors).toEqual([]);
    });
});

test.describe('klávesnica na počítači', () => {
    test('Tab ide stĺpcami zľava doprava, potom navigáciou; fokus je vždy vidieť', async ({ page }) => {
        const errors = await openObloha(page, POCITAC);
        /** @type {Array<{ name: string, column: number, nav: boolean, visible: boolean, inView: boolean }>} */
        const kroky = [];
        for (let i = 0; i < 80; i++) {
            await page.keyboard.press('Tab');
            const k = await page.evaluate(() => {
                const el = /** @type {HTMLElement} */ (document.activeElement);
                const cs = getComputedStyle(el);
                const r = el.getBoundingClientRect();
                const nav = /** @type {Element} */ (document.querySelector('.tabs')).getBoundingClientRect();
                const panel = el.closest('.panel');
                const inNav = !!el.closest('.tabs');
                return {
                    name: el.id || `${el.tagName.toLowerCase()}.${el.className}`,
                    column: panel ? ['panel-mozem', 'panel-terazky', 'panel-7dni'].indexOf(panel.id) : -1,
                    nav: inNav,
                    // Obrys aspoň 2 px - ten istý biely, ktorý majú všetky ovládače na oblohe.
                    visible: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2,
                    // Prvok je v okne a nie pod pásom navigácie.
                    inView: r.bottom > 0 && r.top < innerHeight && (inNav || r.top >= nav.bottom - 1),
                };
            });
            kroky.push(k);
            if (k.nav) break;
        }
        const vStlpcoch = kroky.filter((k) => !k.nav);
        expect(kroky.at(-1)?.nav, 'Tab sa nedostal do navigácie').toBe(true);
        expect(
            vStlpcoch.every((k) => k.column >= 0),
            JSON.stringify(vStlpcoch.filter((k) => k.column < 0)),
        ).toBe(true);
        const stlpce = vStlpcoch.map((k) => k.column);
        expect(stlpce).toEqual([...stlpce].sort((a, b) => a - b));
        expect(new Set(stlpce)).toEqual(new Set([0, 1, 2]));
        expect(kroky.filter((k) => !k.visible).map((k) => k.name)).toEqual([]);
        expect(kroky.filter((k) => !k.inView).map((k) => k.name)).toEqual([]);
        expect(errors).toEqual([]);
    });

    test('kurzor nad grafom ukáže náhľad času ako na telefóne', async ({ page }) => {
        const errors = await openObloha(page, POCITAC);
        const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (
            await page.locator('#tz-chart svg').boundingBox()
        );
        await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.72, box.y + box.height / 2);
        await page.mouse.up();
        await expect(page.locator('#tz-chart .dc-at-t')).toHaveText(/^\d\d:\d\d$/);
        await expect(page.locator('#nav-terazky')).toHaveAttribute('aria-current', 'page');
        expect(errors).toEqual([]);
    });
});

// Graf dňa (krok 8, úloha z kontroly): popisky - hodiny, nápis hranice veľkých spotrebičov a čas
// náhľadu - majú na každej šírke tú istú vykreslenú veľkosť ako na telefóne, graf sa zväčšuje sám.
// Nápis hranice neprekrýva krivky, značku „teraz“ ani čiaru náhľadu s časom v žiadnom čase (polohu
// počíta shared/day-chart.js).

/**
 * Vykreslené popisky grafu a čo nápis hranice prekrýva: body kriviek (predpoveď, nameraná),
 * značku „teraz“, čiaru náhľadu a čas nad ňou v jeho obdĺžniku.
 * @param {import('@playwright/test').Page} page @param {string} sel graf (#tz-chart, #sd-day-chart)
 */
const popiskyGrafu = (page, sel) =>
    page.locator(sel).evaluate((chart) => {
        const lim = /** @type {Element} */ (chart.querySelector('.dc-limit-t')).getBoundingClientRect();
        const svg = /** @type {SVGSVGElement} */ (chart.querySelector('svg'));
        const ctm = /** @type {DOMMatrix} */ (svg.getScreenCTM());
        const inside = (/** @type {{ x: number, y: number }} */ p) =>
            p.x >= lim.left && p.x <= lim.right && p.y >= lim.top && p.y <= lim.bottom;
        /** @type {string[]} */
        const hits = [];
        for (const path of chart.querySelectorAll('.dc-area, .dc-real')) {
            const curve = /** @type {SVGPathElement} */ (path);
            const len = curve.getTotalLength();
            for (let i = 0; i <= len; i += 0.5)
                if (inside(curve.getPointAtLength(i).matrixTransform(ctm))) hits.push(curve.getAttribute('class') ?? '');
        }
        const across = (/** @type {string} */ s) => {
            const r = chart.querySelector(s)?.getBoundingClientRect();
            return !!r && r.right >= lim.left && r.left <= lim.right && r.bottom >= lim.top && r.top <= lim.bottom;
        };
        if (across('.dc-now-dot')) hits.push('teraz');
        if (across('.dc-prev')) hits.push('náhľad');
        if (across('.dc-at-t')) hits.push('čas náhľadu');
        const px = (/** @type {string} */ s) => [...chart.querySelectorAll(s)].map((e) => e.getBoundingClientRect().height);
        return {
            ticks: px('.dc-t'),
            limit: lim.height,
            time: px('.dc-at-t'),
            graf: svg.getBoundingClientRect().width,
            hits: [...new Set(hits)],
        };
    });

test.describe('graf dňa na každej šírke', () => {
    const SIRKY = [TELEFON, TABLET_VYSKA, TABLET_SIRKA, POCITAC];
    const CASY = ['07:30', '13:00', '15:30', '18:00', '21:00'];

    test('popisky hodín, nápis hranice aj čas náhľadu majú rovnakú vykreslenú veľkosť (±1 px), graf rastie', async ({ page }) => {
        /** @type {Array<Awaited<ReturnType<typeof popiskyGrafu>>>} */
        const merania = [];
        for (const size of SIRKY) {
            await openObloha(page, size);
            if (size === TELEFON || size === TABLET_VYSKA) await page.locator('#nav-terazky').click();
            await page.locator('#tz-chart').focus();
            // Šípka na grafe zapne náhľad (čas nad čiarou).
            await page.keyboard.press('ArrowRight');
            await expect(page.locator('#tz-chart .dc-at-t')).toBeVisible();
            merania.push(await popiskyGrafu(page, '#tz-chart'));
        }
        const [telefon] = merania;
        expect(telefon.ticks).toHaveLength(5);
        for (const m of merania) {
            for (const t of m.ticks) expect(Math.abs(t - telefon.ticks[0])).toBeLessThanOrEqual(1);
            expect(Math.abs(m.limit - telefon.limit)).toBeLessThanOrEqual(1);
            expect(Math.abs(m.time[0] - telefon.time[0])).toBeLessThanOrEqual(1);
        }
        expect(Math.max(...merania.map((m) => m.graf))).toBeGreaterThan(telefon.graf * 1.5);
    });

    for (const size of SIRKY)
        test(`šírka ${size.width} px: nápis „veľké spotrebiče“ neprekrýva krivku ani „teraz“ na karte Teraz ani v detaile dňa`, async ({
            page,
        }) => {
            test.slow();
            /** @type {string[]} */
            const zle = [];
            for (const hm of CASY) {
                const errors = await openObloha(page, size, { time: at(hm) });
                const stlpce = size === TABLET_SIRKA || size === POCITAC;
                if (!stlpce) await page.locator('#nav-terazky').click();
                await expect(page.locator('#tz-chart .dc-limit-t')).toHaveText('veľké spotrebiče');
                for (const h of (await popiskyGrafu(page, '#tz-chart')).hits) zle.push(`Teraz o ${hm}: ${h}`);
                // Detail dňa: dnes (so značkou „teraz“) a pozajtra.
                for (const day of [0, 2]) {
                    if (!stlpce) await page.locator('#nav-7dni').click();
                    await page.locator(`#sd-days [data-day="${day}"]`).click();
                    await expect(page.locator('#sd-day-chart .dc-limit-t')).toBeVisible();
                    for (const h of (await popiskyGrafu(page, '#sd-day-chart')).hits) zle.push(`detail dňa ${day} o ${hm}: ${h}`);
                    await page.locator('#sd-day-back').click();
                }
                expect(errors).toEqual([]);
            }
            expect(zle).toEqual([]);
        });

    for (const size of SIRKY)
        test(`šírka ${size.width} px: nápis „veľké spotrebiče“ neprekrýva čiaru náhľadu ani čas nad ňou v žiadnom čase dňa`, async ({
            page,
        }) => {
            test.slow();
            const errors = await openObloha(page, size, { time: at('13:00') });
            if (size === TELEFON || size === TABLET_VYSKA) await page.locator('#nav-terazky').click();
            const graf = page.locator('#tz-chart');
            await graf.focus();
            await page.keyboard.press('Home');
            /** @type {string[]} */
            const zle = [];
            // Po polhodinách celý deň: šípka posúva náhľad o štvrťhodinu.
            for (let i = 0; i < 48; i++) {
                const cas = (await page.locator('#tz-chart .dc-at-t').textContent()) ?? '';
                for (const h of (await popiskyGrafu(page, '#tz-chart')).hits) zle.push(`náhľad ${cas}: ${h}`);
                await page.keyboard.press('ArrowRight');
                await page.keyboard.press('ArrowRight');
            }
            expect(zle).toEqual([]);
            expect(errors).toEqual([]);
        });
});
