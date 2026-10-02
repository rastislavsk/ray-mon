// E2E pre novú appku „Živá obloha“ v obloha/. Rovnako ako pri súčasnej appke: pevný čas, dáta
// z fixtures a očakávané hodnoty počítané tou istou funkciou (shared/), ktorú volá appka.
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
    PANELS,
    PLANT,
    SETTINGS_STORAGE_KEY,
    SITE,
    SITE_STORAGE_KEY,
    SKY,
    START_STORAGE_KEY,
    TARIFF,
    WORKER_PV_URL,
} from '../../shared/config.js';
import { toUser } from '../../shared/settings.js';
import { skyNow } from '../../shared/sky.js';
import { buildForecast } from '../../shared/solar.js';
import { FIXED_NOW, fixture, fixtureData } from '../helpers.js';

const { pv } = fixtureData();
const weather = fixture('open-meteo.json');
const TEST_KIOSK = 'https://region01eu5.fusionsolar.huawei.com/pvmswebsite/nologin/assets/build/index.html#/kiosk?kk=Test1234';
const OWNER = { site: SITE, plant: PLANT, tariff: TARIFF, kiosk: TEST_KIOSK };
const IGNORED_CONSOLE = /Failed to load resource|net::ERR_FAILED/;
const TITLES = { mozem: 'Môžem?', terazky: 'Teraz', '7dni': '7 dní', statistika: 'Štatistika', nastavenie: 'Nastavenie' };

/** Presný okamih daného času 5. 9. 2026 v Bratislave (letný čas, UTC+2). @param {string} hm */
const at = (hm) => new Date(`2026-09-05T${hm}:00+02:00`);

/**
 * Siete a úložisko ako pri súčasnej appke: Worker a Open-Meteo odpovedajú z fixtures (alebo
 * vôbec, `offline`), nastavenie sa uloží len vtedy, keď tam ešte nič nie je.
 * @param {import('@playwright/test').Page} page
 * @param {{ offline?: boolean, settings?: typeof OWNER | null, site?: typeof SITE | null }} [opts]
 */
async function pripravSiet(page, { offline = false, settings = OWNER, site = null } = {}) {
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (msg) => msg.type() === 'error' && !IGNORED_CONSOLE.test(msg.text()) && errors.push(msg.text()));
    await page.route(/cdnjs\.cloudflare\.com/, (route) => route.abort());
    await page.route(WORKER_PV_URL, (route) => (offline ? route.abort() : route.fulfill({ json: { pv } })));
    await page.route(/api\.open-meteo\.com/, (route) => (offline ? route.abort() : route.fulfill({ json: weather })));
    /** @param {string} key @param {string} value */
    const uloz = (key, value) => page.addInitScript(([k, v]) => localStorage.getItem(k) || localStorage.setItem(k, v), [key, value]);
    if (settings) await uloz(SETTINGS_STORAGE_KEY, JSON.stringify(toUser(settings)));
    if (site) await uloz(SITE_STORAGE_KEY, JSON.stringify(site));
    return errors;
}

/**
 * Počká, kým appka naštartuje: `data-panel` na stránke zapíše až prvý render.
 * @param {import('@playwright/test').Page} page
 */
async function appReady(page) {
    await expect(page.locator('#page')).toHaveAttribute('data-panel', /.+/);
}

/**
 * Otvorí novú appku s pevným časom. Bez `settings: null` má uložené Dvorany s kioskom.
 * @param {import('@playwright/test').Page} page
 * @param {{ time?: Date, offline?: boolean, settings?: typeof OWNER | null, site?: typeof SITE | null }} [opts]
 */
async function openObloha(page, { time = FIXED_NOW, ...opts } = {}) {
    const errors = await pripravSiet(page, opts);
    await page.clock.setFixedTime(time);
    await page.goto('/obloha/');
    await appReady(page);
    return errors;
}

/** Farby oblohy, ktoré appka zapísala na <html>, a počasie. @param {import('@playwright/test').Page} page */
const oblohaVStranke = (page) =>
    page.evaluate(() => {
        const s = document.documentElement.style;
        return { top: s.getPropertyValue('--s1'), bottom: s.getPropertyValue('--s2'), sky: document.documentElement.dataset.sky };
    });

/** Obloha tak, ako ju appka vypočíta v danej chvíli s dátami z fixtures. @param {Date} time */
const ocakavanaObloha = (time) =>
    skyNow({ now: time, known: 'elektraren', site: SITE, forecast: buildForecast(weather, time, SITE, PLANT), loading: false });

/** @param {import('@playwright/test').Page} page @param {(typeof PANELS)[number]} panel */
async function ocakavajKartu(page, panel) {
    await expect(page.locator(`#panel-${panel}`)).toBeVisible();
    await expect(page.locator(`#panel-${panel} h1`)).toHaveText(TITLES[panel]);
    await expect(page.locator(`#nav-${panel}`)).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.panel:not(.hidden)')).toHaveCount(1);
    await expect(page.locator('.tabs [aria-current]')).toHaveCount(1);
}

for (const width of [390, 320]) {
    test(`navigácia prepína všetkých 5 kariet, popisky sú celé a položky aspoň 44 px (šírka ${width} px)`, async ({ page }) => {
        await page.setViewportSize({ width, height: 700 });
        const errors = await openObloha(page);
        await ocakavajKartu(page, 'mozem');
        for (const panel of [...PANELS].reverse()) {
            await page.locator(`#nav-${panel}`).click();
            await ocakavajKartu(page, panel);
            await expect(page.locator(`#panel-${panel} .sub`)).toHaveText('Táto karta príde v ďalšom kroku.');
        }
        const polozky = await page.locator('.tabs button').evaluateAll((buttons) =>
            buttons.map((b) => {
                const box = b.getBoundingClientRect();
                const label = /** @type {HTMLElement} */ (b.querySelector('span'));
                const text = label.getBoundingClientRect();
                return {
                    text: label.textContent,
                    height: box.height,
                    // Popiska sa nesmie orezať: celá v tlačidle, tlačidlo celé v okne.
                    inside: text.left >= box.left - 0.5 && text.right <= box.right + 0.5 && box.left >= 0 && box.right <= innerWidth,
                    fits: label.scrollWidth <= label.clientWidth + 0.5,
                };
            }),
        );
        expect(polozky.map((p) => p.text)).toEqual(PANELS.map((p) => TITLES[p]));
        for (const p of polozky) {
            expect(p.height, p.text).toBeGreaterThanOrEqual(44);
            expect(p.inside && p.fits, `${p.text} je orezaná`).toBe(true);
        }
        expect(errors).toEqual([]);
    });
}

test('obloha o 13:00 a o 21:00 má iné farby, tie isté ako výpočet v shared/sky.js', async ({ page }) => {
    const errors = await openObloha(page, { time: at('13:00') });
    const poludnie = ocakavanaObloha(at('13:00'));
    await expect.poll(() => oblohaVStranke(page)).toEqual({ top: poludnie.top, bottom: poludnie.bottom, sky: poludnie.weather });

    await page.clock.setFixedTime(at('21:00'));
    await page.reload();
    await appReady(page);
    const vecer = ocakavanaObloha(at('21:00'));
    await expect.poll(() => oblohaVStranke(page)).toEqual({ top: vecer.top, bottom: vecer.bottom, sky: vecer.weather });
    expect(vecer.top).not.toBe(poludnie.top);
    expect(vecer.bottom).not.toBe(poludnie.bottom);
    expect(errors).toEqual([]);
});

test('bez dát je obloha sivá a hlavička to povie', async ({ page }) => {
    await openObloha(page, { offline: true });
    await expect(page.locator('#hdr-status')).toHaveText('bez dát');
    await expect(page.locator('#hdr-live')).toHaveAttribute('data-tone', 'off');
    expect(await oblohaVStranke(page)).toEqual({ top: SKY.offline[0], bottom: SKY.offline[1], sky: 'offline' });
});

test('hlavička: miesto elektrárne, čas a bodka živého merania', async ({ page }) => {
    const errors = await openObloha(page, { time: at('13:00') });
    await expect(page.locator('#hdr-place')).toHaveText(SITE.name);
    await expect(page.locator('#hdr-status')).toHaveText('13:00');
    await expect(page.locator('#hdr-live')).toHaveAttribute('data-tone', 'live');
    await expect(page.locator('#hdr-tone')).toHaveText('živé meranie');
    await expect(page.locator('#hdr-setup')).toBeHidden();
    expect(errors).toEqual([]);
});

test('útlm pohybu: obloha sa mení bez prechodu', async ({ page }) => {
    await openObloha(page);
    const prechod = () => page.evaluate(() => getComputedStyle(document.documentElement).transitionDuration);
    expect(await prechod()).not.toMatch(/^0s(, 0s)*$/);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await prechod()).toMatch(/^0s(, 0s)*$/);
});

test('bez zadaných panelov je v hlavičke „Zadaj panely ›“ a otvorí Nastavenie', async ({ page }) => {
    const errors = await openObloha(page, { settings: null, site: SITE });
    const stitok = page.locator('#hdr-setup');
    await expect(stitok).toHaveText('Zadaj panely ›');
    await expect(page.locator('#hdr-live')).toBeHidden();
    await stitok.click();
    await ocakavajKartu(page, 'nastavenie');
    expect(errors).toEqual([]);
});

test('nastavenie uložené súčasnou appkou nová appka vidí a nič v ňom nemení', async ({ page }) => {
    const chata = { ...OWNER, site: { ...SITE, name: 'Chata pod Zoborom' } };
    const errors = await pripravSiet(page, { settings: chata });
    await page.clock.setFixedTime(FIXED_NOW);
    // Súčasná appka: úvodnú kartu Terazky si človek vyberie v jej Nastavení.
    await page.goto('/');
    await expect(page.locator('#pv-updated')).not.toHaveText('načítavam…');
    await page.locator('#nav-nastavenie').click();
    const polozka = page.locator('#settings-start');
    if ((await polozka.getAttribute('open')) === null) await polozka.locator('> summary').click();
    await page.locator('[data-start-panel="terazky"]').click();
    await expect(page.locator('[data-start-panel="terazky"]')).toHaveAttribute('aria-pressed', 'true');
    const ulozene = await page.evaluate(() => JSON.stringify(localStorage));

    await page.goto('/obloha/');
    await appReady(page);
    await expect(page.locator('#hdr-status')).toHaveText(/^\d\d:\d\d$/);
    await expect(page.locator('#hdr-place')).toHaveText('Chata pod Zoborom');
    // Uložená karta Terazky sa v novej appke volá Teraz.
    await ocakavajKartu(page, 'terazky');
    expect(await page.evaluate((key) => localStorage.getItem(key), START_STORAGE_KEY)).toBe('terazky');
    expect(await page.evaluate(() => JSON.stringify(localStorage)), 'nová appka uložené nastavenie neprepisuje').toBe(ulozene);
    expect(errors).toEqual([]);
});

/** Závažné a kritické nálezy axe v celej stránke. @param {import('@playwright/test').Page} page @returns {Promise<string[]>} */
const vazneNalezy = async (page) =>
    (await new AxeBuilder({ page }).analyze()).violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);

test('prístupnosť: žiadne závažné nálezy axe na žiadnej karte', async ({ page }) => {
    test.slow();
    for (const time of [at('13:00'), at('21:00')]) {
        await openObloha(page, { time });
        for (const panel of PANELS) {
            await page.locator(`#nav-${panel}`).click();
            await ocakavajKartu(page, panel);
            expect(await vazneNalezy(page), `${panel} o ${time.toISOString()}`).toEqual([]);
        }
    }
});

test('prístupnosť: bez panelov a bez dát žiadne závažné nálezy axe', async ({ page }) => {
    await openObloha(page, { settings: null, site: SITE, offline: true });
    expect(await vazneNalezy(page)).toEqual([]);
});

test('.hidden skryje každý prvok v stránke, nič ju neprebíja', async ({ page }) => {
    const errors = await openObloha(page);
    const broken = await page.evaluate(() => {
        const out = [];
        for (const el of document.body.querySelectorAll('*')) {
            const had = el.classList.contains('hidden');
            el.classList.add('hidden');
            const display = getComputedStyle(el).display;
            if (!had) el.classList.remove('hidden');
            if (display !== 'none') out.push(`${el.id ? `#${el.id}` : el.tagName.toLowerCase()} -> display: ${display}`);
        }
        return out;
    });
    expect(broken, 'tieto prvky .hidden neskryje - niečo s vyššou špecificitou nastavuje display').toEqual([]);
    expect(errors).toEqual([]);
});

test.describe('listovanie kariet prstom a tlačidlo Späť', () => {
    test.use({ hasTouch: true });

    /** Ťah prstom po stránke. @param {import('@playwright/test').Page} page @param {number} dx @param {number} [dy] */
    async function tah(page, dx, dy = 0) {
        const start = { x: 200, y: 400 };
        await page.evaluate(
            ([s, d]) => {
                const target = /** @type {Element} */ (document.elementFromPoint(s.x, s.y));
                const touch = (/** @type {number} */ x, /** @type {number} */ y) =>
                    new Touch({ identifier: 1, target, clientX: x, clientY: y });
                const fire = (/** @type {string} */ type, /** @type {Touch[]} */ touches, /** @type {Touch[]} */ changed) =>
                    target.dispatchEvent(new TouchEvent(type, { touches, changedTouches: changed, bubbles: true, cancelable: true }));
                const a = touch(s.x, s.y);
                const b = touch(s.x + d.x, s.y + d.y);
                fire('touchstart', [a], [a]);
                fire('touchmove', [b], [b]);
                fire('touchend', [], [b]);
            },
            [start, { x: dx, y: dy }],
        );
    }

    test('ťah doľava prelistuje na ďalšiu kartu, doprava späť, na kraji nikam', async ({ page }) => {
        const errors = await openObloha(page);
        await ocakavajKartu(page, 'mozem');
        await tah(page, 120);
        await ocakavajKartu(page, 'mozem');
        await tah(page, -120);
        await ocakavajKartu(page, 'terazky');
        await tah(page, -120);
        await ocakavajKartu(page, '7dni');
        await tah(page, 120);
        await ocakavajKartu(page, 'terazky');
        // Zvislý ťah nie je listovanie.
        await tah(page, -40, 200);
        await ocakavajKartu(page, 'terazky');
        expect(errors).toEqual([]);
    });

    test('tlačidlo Späť vracia po kartách, Dopredu ich vráti', async ({ page }) => {
        const errors = await openObloha(page);
        await page.locator('#nav-7dni').click();
        await page.locator('#nav-nastavenie').click();
        await ocakavajKartu(page, 'nastavenie');
        await page.goBack();
        await ocakavajKartu(page, '7dni');
        await page.goBack();
        await ocakavajKartu(page, 'mozem');
        await page.goForward();
        await ocakavajKartu(page, '7dni');
        expect(errors).toEqual([]);
    });
});

// To isté ako skupina „nasadenie a cache“ pre súčasnú appku (app.spec.js): starý modul z cache
// hrá route - shared/config.js bez exportov, ktoré appka importuje.
test.describe('nasadenie a cache (obloha/boot.js)', () => {
    /** @param {import('@playwright/test').Page} page @param {number} times koľkokrát vrátiť starú verziu */
    async function staryModul(page, times) {
        let left = times;
        await page.route('**/shared/config.js', (route) =>
            left-- > 0 ? route.fulfill({ contentType: 'text/javascript', body: 'export {};' }) : route.continue(),
        );
        let loads = 0;
        page.on('load', () => loads++);
        return () => loads;
    }

    test('starý modul v cache: stránka sa raz obnoví a appka naštartuje', async ({ page }) => {
        const loads = await staryModul(page, 1);
        const errors = await openObloha(page);
        await expect(page.locator('#hdr-status')).toHaveText(/^\d\d:\d\d$/);
        await expect.poll(loads).toBe(2);
        expect(errors).toEqual([expect.stringContaining('does not provide an export named')]);
        expect(await page.evaluate(() => sessionStorage.getItem('ray-mon-obloha-obnova'))).toBeNull();
    });

    test('chyba, ktorú obnovenie nevyrieši: jedno obnovenie, potom hláška namiesto slučky', async ({ page }) => {
        const loads = await staryModul(page, Infinity);
        await pripravSiet(page);
        await page.clock.setFixedTime(FIXED_NOW);
        await page.goto('/obloha/');
        await expect(page.locator('#hdr-status')).toHaveText('appka sa nenačítala, skús to o chvíľu');
        expect(loads()).toBe(2);
    });

    test('chýbajúci prvok v starom index.html: to isté ako starý modul', async ({ page }) => {
        let left = 1;
        await page.route('**/obloha/', async (route) => {
            if (left-- <= 0) return route.continue();
            const res = await route.fetch();
            route.fulfill({ response: res, body: (await res.text()).replace('id="hdr-tone"', '') });
        });
        let loads = 0;
        page.on('load', () => loads++);
        const errors = await openObloha(page);
        await expect.poll(() => loads).toBe(2);
        await expect(page.locator('#hdr-status')).toHaveText(/^\d\d:\d\d$/);
        expect(errors).toEqual([expect.stringContaining('Chýba element #hdr-tone')]);
    });
});
