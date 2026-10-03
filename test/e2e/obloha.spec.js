// E2E pre novú appku „Živá obloha“ v obloha/. Rovnako ako pri súčasnej appke: pevný čas, dáta
// z fixtures a očakávané hodnoty počítané tou istou funkciou (shared/), ktorú volá appka.
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { wordSize } from '../../obloha/web/render/mozem.js';
import {
    LAUNCH_STORAGE_KEY,
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
import { MOZEM_WORDS } from '../../shared/messages.js';
import { mozemSkyModel } from '../../shared/mozem-sky.js';
import { cellAt, chartX, DAY_CHART, planCells } from '../../shared/day-chart.js';
import { dayPlan } from '../../shared/day-plan.js';
import { heroModel } from '../../shared/hero-model.js';
import { terazModel } from '../../shared/teraz.js';
import { sedemDayModel, sedemModel, sedemWeekModel } from '../../shared/sedem-dni.js';
import { toUser, typicalSettings } from '../../shared/settings.js';
import { skyNow } from '../../shared/sky.js';
import { buildForecast } from '../../shared/solar.js';
import { FIXED_NOW, fixture, fixtureData, pvAt } from '../helpers.js';

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
 * @param {{ offline?: boolean, settings?: typeof OWNER | null, site?: typeof SITE | null, pvData?: typeof pv }} [opts]
 *   `pvData` meranie, ktoré pošle Worker (predvolene snímka z fixtures o 13:00)
 */
async function pripravSiet(page, { offline = false, settings = OWNER, site = null, pvData = pv } = {}) {
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (msg) => msg.type() === 'error' && !IGNORED_CONSOLE.test(msg.text()) && errors.push(msg.text()));
    await page.route(/cdnjs\.cloudflare\.com/, (route) => route.abort());
    await page.route(WORKER_PV_URL, (route) => (offline ? route.abort() : route.fulfill({ json: { pv: pvData } })));
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
 * Otvorí súčasnú appku a počká, kým naštartuje. Udalosť load na to nestačí: boot.js načíta appku
 * dynamickým import(), ktorý sa môže dokončiť až po nej - klik hneď po page.goto by trafil statické
 * HTML bez poslucháčov a stratil sa. „načítavam…“ v hlavičke prepíše až appka (rovnako čaká
 * appReady v app.spec.js).
 * @param {import('@playwright/test').Page} page
 */
async function otvorSucasnuAppku(page) {
    await page.goto('/');
    await expect(page.locator('#pv-updated')).not.toHaveText('načítavam…');
}

/**
 * Otvorí novú appku s pevným časom. Bez `settings: null` má uložené Dvorany s kioskom.
 * @param {import('@playwright/test').Page} page
 * @param {{ time?: Date, offline?: boolean, settings?: typeof OWNER | null, site?: typeof SITE | null, pvData?: typeof pv }} [opts]
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
            // Nastavenie (krok 6) ukazuje prehľad elektrárne.
            if (panel === 'nastavenie') await expect(page.locator('#ns-home h2')).toHaveText('Moja strecha');
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
    await otvorSucasnuAppku(page);
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

    /** Ťah prstom po stránke - začína nad veľkým číslom či slovom, nie nad grafom karty Teraz,
     * kde ťah do strán ukazuje náhľad a kartu neprelistuje (to skúša skupina „karta Teraz prstom“).
     * @param {import('@playwright/test').Page} page @param {number} dx @param {number} [dy] */
    async function tah(page, dx, dy = 0) {
        const start = { x: 200, y: 180 };
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

// Karty 7 dní, Štatistika a Nastavenie sa sťahujú až po štarte (obloha/web/parts.js) - boot.js ich
// nechráni. Starý modul z cache tu hrá shared/statistika.js bez exportov: kód karty Štatistika sa
// nezlinkuje, zvyšok appky beží.
test.describe('nasadenie a cache: karty načítané neskôr (obloha/web/parts.js)', () => {
    /** @param {import('@playwright/test').Page} page @param {number} times koľkokrát vrátiť starú verziu */
    async function staraStatistika(page, times) {
        let left = times;
        await page.route('**/shared/statistika.js', (route) =>
            left-- > 0 ? route.fulfill({ contentType: 'text/javascript', body: 'export {};' }) : route.continue(),
        );
        let loads = 0;
        page.on('load', () => loads++);
        return () => loads;
    }

    test('pri štarte sa sťahuje len úvodná karta, ostatné karty až po prvom vykreslení', async ({ page }) => {
        /** @type {string[]} */
        const urls = [];
        page.on('request', (r) => urls.push(new URL(r.url()).pathname));
        const errors = await openObloha(page);
        const neskore = (/** @type {string} */ u) =>
            /\/obloha\/web\/part-|\/render\/(sedem|statistika|nastavenie|sprievodca)\.js|\/shared\/messages\.js/.test(u);
        expect(urls.filter(neskore)).toEqual([]);
        // Keď je prehliadač voľný, stiahnu sa aj ostatné - karta je potom pri prvom otvorení hneď hotová.
        await expect.poll(() => urls.filter((u) => u.includes('/obloha/web/part-')).length).toBe(3);
        await page.locator('#nav-statistika').click();
        await ocakavajKartu(page, 'statistika');
        await expect(page.locator('#cakam')).toBeHidden();
        expect(errors).toEqual([]);
    });

    test('starý modul karty: hláška namiesto prázdnej karty, tlačidlo stiahne súbory znova a raz obnoví stránku', async ({ page }) => {
        const loads = await staraStatistika(page, 1);
        const errors = await openObloha(page);
        await page.locator('#nav-statistika').click();
        await expect(page.locator('#cakam')).toBeVisible();
        await expect(page.locator('#panel-statistika')).toBeHidden();
        await expect(page.locator('#ck-fail')).toBeVisible();
        await expect(page.locator('#ck-later')).toBeHidden();
        await expect(page.locator('.tabs')).toBeVisible();
        expect(errors).toEqual([expect.stringContaining('does not provide an export named')]);
        await page.locator('#ck-retry').click();
        await expect.poll(loads).toBe(2);
        await appReady(page);
        await page.locator('#nav-statistika').click();
        await ocakavajKartu(page, 'statistika');
        await expect(page.locator('#cakam')).toBeHidden();
        // Keď sa načítali všetky karty, záznam o obnove zmizne - ďalšie nasadenie sa dá obnoviť znova.
        await expect.poll(() => page.evaluate(() => sessionStorage.getItem('ray-mon-obloha-obnova-casti'))).toBeNull();
    });

    test('chyba, ktorú obnovenie nevyrieši: jedno obnovenie, potom hláška bez tlačidla namiesto slučky', async ({ page }) => {
        const loads = await staraStatistika(page, Infinity);
        await openObloha(page);
        await page.locator('#nav-statistika').click();
        await page.locator('#ck-retry').click();
        await expect.poll(loads).toBe(2);
        await appReady(page);
        await page.locator('#nav-statistika').click();
        await expect(page.locator('#ck-later')).toBeVisible();
        await expect(page.locator('#ck-retry')).toBeHidden();
        // Ostatné karty fungujú ďalej.
        await page.locator('#nav-terazky').click();
        await ocakavajKartu(page, 'terazky');
        expect(loads()).toBe(2);
    });
});

// ---- Karta Môžem? (krok 2) ---------------------------------------------------------
// Očakávané texty počíta tá istá funkcia ako appka (shared/mozem-sky.js, a pod ňou mozemModel
// súčasnej appky) z tých istých dát, takže test odhalí rozdiel medzi modelom a stránkou.

/**
 * Model karty pre dáta z fixtures v danej chvíli, tak ako ho počíta appka.
 * @param {Date} time @param {object} [extra] @param {Parameters<typeof mozemSkyModel>[1]} [opts]
 */
const modelKarty = (time, extra = {}, opts = {}) =>
    mozemSkyModel(
        {
            ...OWNER,
            now: time,
            loading: false,
            known: /** @type {const} */ ('elektraren'),
            pv,
            forecast: buildForecast(weather, time, SITE, PLANT),
            ...extra,
        },
        opts,
    );

/** Čo karta ukazuje: slovo, veta, štítky, fakt, nadpis zoznamu, krátke odpovede a hláška. @param {import('@playwright/test').Page} page */
const kartaVStranke = (page) =>
    page.evaluate(() => {
        const text = (/** @type {string} */ sel) => document.querySelector(sel)?.textContent ?? '';
        const all = (/** @type {string} */ sel) => [...document.querySelectorAll(sel)].map((el) => el.textContent);
        return {
            word: text('#mz-word'),
            lead: text('#mz-lead'),
            chips: all('#mz-chips .chip'),
            phones: text('#mz-phones-text'),
            title: text('#mz-list-title'),
            shorts: all('#mz-items .app b'),
            quip: text('#mz-quip-text'),
        };
    });

/** To isté z modelu. @param {ReturnType<typeof modelKarty>} m */
const kartaZModelu = (m) => ({
    word: m.word,
    lead: m.lead,
    chips: m.chips.map((c) => c.text),
    phones: m.phones,
    title: m.list?.title ?? '',
    shorts: m.list ? m.items.map((it) => it.short) : [],
    quip: m.quip,
});

/** Ťuknutie a ťah prstom cez CDP, teda ako naozajstný prst - prehliadač pri ťahu posúva stránku sám.
 * @param {import('@playwright/test').Page} page @param {{ x: number, y: number, dy?: number }} gesto */
async function prst(page, { x, y, dy = 0 }) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    if (dy)
        for (const t of [0.34, 0.67, 1]) {
            await page.waitForTimeout(130);
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + dy * t }] });
        }
    else await page.waitForTimeout(80);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
}

test.describe('karta Môžem?', () => {
    for (const hm of ['13:00', '21:00', '05:30']) {
        test(`o ${hm} ukazuje to isté slovo, vetu, štítky a odpovede ako model`, async ({ page }) => {
            const errors = await openObloha(page, { time: at(hm) });
            const m = modelKarty(at(hm));
            await expect.poll(() => kartaVStranke(page)).toEqual(kartaZModelu(m));
            await expect(page.locator('#mz-items .app')).toHaveCount(6);
            await expect(page.locator('#mz-retry')).toBeHidden();
            await expect(page.locator('#mz-guess')).toBeHidden();
            // Zelený úsek oblúka je dnešné okno so slnkom; v noci je na oblúku mesiac.
            await expect(page.locator('#mz-arc .arc-win')).toHaveCount(m.arc?.win ? 1 : 0);
            await expect(page.locator('#mz-arc .arc-moon')).toHaveCount(m.arc?.sun === null ? 1 : 0);
            expect(errors).toEqual([]);
        });
    }

    for (const width of [390, 320]) {
        test(`šírka ${width} px: 6 riadkov aspoň 44 px, nič sa neoreže, žiadne veľké slovo nepretečie`, async ({ page }) => {
            await page.setViewportSize({ width, height: 800 });
            const errors = await openObloha(page);
            await expect(page.locator('#mz-items .app')).toHaveCount(6);
            const riadky = await page.locator('#mz-items .app').evaluateAll((rows) =>
                rows.map((row) => {
                    const box = row.getBoundingClientRect();
                    const parts = [...row.children].map((c) => c.getBoundingClientRect());
                    return {
                        text: row.textContent,
                        h: box.height,
                        inside:
                            box.left >= 0 &&
                            box.right <= innerWidth &&
                            parts.every((p) => p.left >= box.left - 0.5 && p.right <= box.right + 0.5),
                        fits: row.scrollWidth <= row.clientWidth + 0.5,
                    };
                }),
            );
            for (const r of riadky) {
                expect(r.h, r.text ?? '').toBeGreaterThanOrEqual(44);
                expect(r.inside && r.fits, `${r.text} je orezaný`).toBe(true);
            }
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'stránka ide do strán').toBe(true);
            // Každé veľké slovo, aké karta pozná, s veľkosťou podľa wordSize ako v appke.
            for (const word of new Set(Object.values(MOZEM_WORDS))) {
                const ok = await page.evaluate(
                    ([w, size]) => {
                        const el = /** @type {HTMLElement} */ (document.getElementById('mz-word'));
                        el.textContent = String(w);
                        el.style.setProperty('--word', `${size}px`);
                        el.style.setProperty(
                            '--word-len',
                            String(
                                Math.max(
                                    ...String(w)
                                        .split(/\s+/)
                                        .map((x) => x.length),
                                ),
                            ),
                        );
                        const box = el.getBoundingClientRect();
                        return el.scrollWidth <= el.clientWidth + 0.5 && box.left >= 0 && box.right <= innerWidth;
                    },
                    [word, wordSize(word)],
                );
                expect(ok, `„${word}“ sa nezmestí`).toBe(true);
            }
            expect(errors).toEqual([]);
        });
    }

    test('ťuknutie na vec otvorí panel; Escape, Späť aj krížik ho zavrú a fokus sa vráti na riadok', async ({ page }) => {
        const errors = await openObloha(page);
        const pr = modelKarty(FIXED_NOW).items.find((it) => it.id === 'pracka');
        if (!pr) throw new Error('práčka v modeli chýba');
        const riadok = page.locator('[data-item="pracka"]');
        const panel = page.getByRole('dialog', { name: pr.title });

        await riadok.click();
        await expect(panel).toBeVisible();
        await expect(page.locator('#mz-sheet-do')).toHaveText(pr.head);
        await expect(page.locator('#mz-sheet-why')).toHaveText(pr.text);
        await expect(page.locator('#mz-sheet-more-q')).toHaveText(pr.more?.q ?? '');
        await expect(page.locator('#mz-sheet-more')).toHaveText(pr.more?.a ?? '');
        await expect(page.locator('#mz-sheet-log')).toHaveText(pr.log?.label ?? '');
        await page.keyboard.press('Escape');
        await expect(panel).toBeHidden();
        await expect(riadok).toBeFocused();

        await riadok.click();
        await expect(panel).toBeVisible();
        await page.goBack();
        await expect(panel).toBeHidden();
        await expect(riadok).toBeFocused();
        await ocakavajKartu(page, 'mozem');

        await riadok.click();
        await expect(panel).toBeVisible();
        await page.getByRole('button', { name: 'Zavrieť' }).click();
        await expect(panel).toBeHidden();
        await expect(riadok).toBeFocused();
        // Zatvorenie bolo krokom späť v histórii: ďalšie Späť panel znovu neotvorí.
        expect(await page.evaluate(() => history.state)).toEqual({
            step: { panel: 'mozem', item: null, preview: null, detail: null, poster: null, setup: null, roof: 0, sheet: null },
        });
        expect(errors).toEqual([]);
    });

    test('Pustil/a som: zapíše spustenie, riadok beží, druhé ťuknutie ho zruší', async ({ page }) => {
        const errors = await openObloha(page);
        const riadok = page.locator('[data-item="pracka"]');
        await riadok.click();
        const log = page.locator('#mz-sheet-log');
        await expect(log).toHaveText('Pustil/a som');
        await log.click();
        await expect(log).toHaveText('Beží do 15:00 · zrušiť');
        await expect(riadok.locator('b')).toHaveText('beží do 15:00');
        await expect(page.locator('#mz-count')).toHaveText('Tento mesiac si pustil/a 1× niečo, z toho 1× na slnku.');
        // Ten istý kľúč a formát ako v súčasnej appke.
        expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), LAUNCH_STORAGE_KEY)).toEqual([
            { d: '2026-09-05', id: 'pracka', m: 13 * 60, sun: true },
        ]);
        await log.click();
        await expect(log).toHaveText('Pustil/a som');
        await expect(page.locator('#mz-count')).toBeHidden();
        expect(await page.evaluate((key) => localStorage.getItem(key), LAUNCH_STORAGE_KEY)).toBe('[]');
        expect(errors).toEqual([]);
    });

    test('spustenie zapísané súčasnou appkou nová appka ukáže ako bežiace a naopak', async ({ page }) => {
        const errors = await pripravSiet(page);
        await page.clock.setFixedTime(FIXED_NOW);
        await otvorSucasnuAppku(page);
        await page.locator('#nav-mozem').click();
        await page.locator('[data-mozem-list]').click();
        await page.locator('[data-mozem-item="susicka"]').click();
        await page.locator('[data-mozem-log="susicka"]').click();
        await expect(page.locator('[data-mozem-item="susicka"] .mozem-t span')).toHaveText('beží do 14:30');

        await page.goto('/obloha/');
        await appReady(page);
        await expect(page.locator('[data-item="susicka"] b')).toHaveText('beží do 14:30');
        await page.locator('[data-item="pracka"]').click();
        await page.locator('#mz-sheet-log').click();
        await expect(page.locator('[data-item="pracka"] b')).toHaveText('beží do 15:00');

        await otvorSucasnuAppku(page);
        await page.locator('#nav-mozem').click();
        await page.locator('[data-mozem-list]').click();
        await expect(page.locator('[data-mozem-item="pracka"] .mozem-t span')).toHaveText('beží do 15:00');
        expect(errors).toEqual([]);
    });

    test('bez dát: veta s príčinou, Skúsiť znova a po ňom s dátami karta odpovie', async ({ page }) => {
        let offline = true;
        const errors = await pripravSiet(page);
        await page.unrouteAll();
        await page.route(/cdnjs\.cloudflare\.com/, (route) => route.abort());
        await page.route(WORKER_PV_URL, (route) => (offline ? route.abort() : route.fulfill({ json: { pv } })));
        await page.route(/api\.open-meteo\.com/, (route) => (offline ? route.abort() : route.fulfill({ json: weather })));
        await page.clock.setFixedTime(FIXED_NOW);
        await page.goto('/obloha/');
        await appReady(page);

        await expect.poll(() => kartaVStranke(page)).toEqual(kartaZModelu(modelKarty(FIXED_NOW, { pv: null, forecast: null })));
        await expect(page.locator('#mz-word')).toHaveText(MOZEM_WORDS.offline);
        await expect(page.locator('#mz-lead')).toHaveText(/^Predpoveď počasia neprišla.* Ani meranie zo strechy neodpovedá\./);
        await expect(page.locator('#mz-list-title')).toHaveText('Čo môžem · ? zo 6 ide hneď');
        await expect(page.locator('[data-item="pracka"] b')).toHaveText('neviem');
        await expect(page.locator('#mz-phones')).toBeHidden();
        const znova = page.getByRole('button', { name: 'Skúsiť znova' });
        await expect(znova).toBeVisible();

        offline = false;
        await znova.click();
        await expect.poll(() => kartaVStranke(page)).toEqual(kartaZModelu(modelKarty(FIXED_NOW)));
        await expect(znova).toBeHidden();
        expect(errors).toEqual([]);
    });

    test('bez internetu to karta povie', async ({ page }) => {
        await openObloha(page, { offline: true });
        await page.context().setOffline(true);
        await expect(page.locator('#mz-lead')).toHaveText(/^Nie je internet/);
    });

    test('poloha bez panelov: odpoveď z typickej strechy s ODHAD a výzva, súčasná appka ostáva pri „Neviem.“', async ({ page }) => {
        const errors = await openObloha(page, { settings: null, site: SITE });
        const typical = typicalSettings(SITE);
        const m = mozemSkyModel({
            ...typical,
            now: FIXED_NOW,
            loading: false,
            known: 'poloha',
            pv: null,
            forecast: buildForecast(weather, FIXED_NOW, SITE, typical.plant),
        });
        await expect.poll(() => kartaVStranke(page)).toEqual(kartaZModelu(m));
        await expect(page.locator('#mz-list-title')).toHaveText(/ · odhad$/);
        await expect(page.locator('#mz-phones-text')).toHaveText(/asi|ani jeden/);
        await expect(page.locator('#mz-guess-title')).toHaveText('Hádam podľa suseda');
        await expect(page.locator('#mz-guess-text')).toHaveText(m.guess);
        // Biela výzva, nie červená.
        expect(await page.locator('#mz-guess').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
        await page.getByRole('button', { name: 'Zadaj panely', exact: true }).click();
        await ocakavajKartu(page, 'nastavenie');

        // Súčasná appka v tom istom stave odpovedá ako doteraz: bez panelov neodpovedá.
        await otvorSucasnuAppku(page);
        await page.locator('#nav-mozem').click();
        await expect(page.locator('#mozem-body .mozem-word')).toHaveText(MOZEM_WORDS.bezpanelov);
        expect(errors).toEqual([]);
    });

    test('bez polohy: len výzva zadať polohu, bez zoznamu odpovedí', async ({ page }) => {
        const errors = await openObloha(page, { settings: null });
        await expect(page.locator('#mz-ask')).toBeVisible();
        await expect(page.locator('#mz-list')).toBeHidden();
        await expect(page.locator('#mz-answer')).toBeHidden();
        await page.getByRole('button', { name: 'Zadaj polohu' }).click();
        await ocakavajKartu(page, 'nastavenie');
        expect(errors).toEqual([]);
    });

    test('ťuknutie na hlášku ukáže ďalšiu', async ({ page }) => {
        const errors = await openObloha(page);
        const hlaska = page.locator('#mz-quip-text');
        const prva = modelKarty(FIXED_NOW).quip;
        await expect(hlaska).toHaveText(prva);
        await page.locator('#mz-quip').click();
        await expect(hlaska).toHaveText(modelKarty(FIXED_NOW, {}, { quip: 1 }).quip);
        await expect(hlaska).not.toHaveText(prva);
        await expect(page.locator('#mz-quip small')).toHaveText('ťukni, príde ďalšia');
        expect(errors).toEqual([]);
    });

    test('prístupnosť: žiadne závažné nálezy axe s otvoreným panelom veci', async ({ page }) => {
        await openObloha(page);
        await page.locator('[data-item="auto"]').click();
        await expect(page.locator('#mz-sheet')).toBeVisible();
        expect(await vazneNalezy(page)).toEqual([]);
    });

    test('prístupnosť: bez polohy žiadne závažné nálezy axe', async ({ page }) => {
        await openObloha(page, { settings: null });
        expect(await vazneNalezy(page)).toEqual([]);
    });
});

test.describe('karta Môžem? prstom', () => {
    test.use({ hasTouch: true });

    test('ťuknutie prstom na riadok otvorí panel, zvislý ťah cez zoznam posunie stránku bez panelu', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        const errors = await openObloha(page);
        const zoznam = await page.locator('#mz-items').boundingBox();
        if (!zoznam) throw new Error('zoznam vecí nie je vidno');
        await prst(page, { x: zoznam.x + zoznam.width / 2, y: zoznam.y + zoznam.height / 2, dy: -160 });
        await expect.poll(() => page.evaluate(() => window.scrollY), 'stránka sa cez zoznam neposunula').toBeGreaterThan(0);
        await page.waitForTimeout(300);
        await expect(page.locator('#mz-sheet')).toBeHidden();
        await ocakavajKartu(page, 'mozem');

        const riadok = await page.locator('[data-item="umyvacka"]').boundingBox();
        if (!riadok) throw new Error('riadok nie je vidno');
        await prst(page, { x: riadok.x + 40, y: riadok.y + riadok.height / 2 });
        await expect(page.locator('#mz-sheet')).toBeVisible();
        await expect(page.locator('#mz-sheet-title')).toHaveText(/^Umývačka: /);
        expect(errors).toEqual([]);
    });
});

// ---- Karta Teraz (krok 3) ----------------------------------------------------------
// Očakávané texty počíta tá istá funkcia ako appka (shared/teraz.js nad heroModel a dayPlan
// súčasnej appky) z tých istých dát. Meranie je pvAt - snímka kiosku taká, aká by prišla
// v danej chvíli (ráno nie poludňajší výkon).

/**
 * Vstup karty Teraz pre dáta z fixtures v danej chvíli, tak ako ho skladá appka.
 * @param {Date} time @param {object} [extra] @returns {import('../../shared/teraz.js').TerazInput}
 */
const vstupTeraz = (time, extra = {}) => ({
    ...OWNER,
    now: time,
    loading: false,
    known: 'elektraren',
    pv: pvAt(time),
    forecast: buildForecast(weather, time, SITE, PLANT),
    previewMinutes: null,
    ...extra,
});

/**
 * Otvorí novú appku na karte Teraz s meraním, aké by prišlo v danej chvíli.
 * @param {import('@playwright/test').Page} page @param {Parameters<typeof openObloha>[1]} [opts]
 */
async function openTeraz(page, opts = {}) {
    const time = opts.time ?? FIXED_NOW;
    const errors = await openObloha(page, { pvData: pvAt(time), ...opts, time });
    await page.locator('#nav-terazky').click();
    await ocakavajKartu(page, 'terazky');
    return errors;
}

/** Čo karta ukazuje: číslo, riadky pod ním, nápis pod grafom a odporúčanie. @param {import('@playwright/test').Page} page */
const terazVStranke = (page) =>
    page.evaluate(() => {
        const text = (/** @type {string} */ sel) => document.querySelector(sel)?.textContent ?? '';
        return {
            num: text('#tz-num-val'),
            source: text('#tz-src'),
            sub: text('#tz-sub'),
            hint: text('#tz-hint'),
            head: text('#tz-now-head'),
        };
    });

/** To isté z modelu. @param {ReturnType<typeof terazModel>} m */
const terazZModelu = (m) => ({ num: m.num, source: m.source, sub: m.sub, hint: m.hint.text, head: m.cards?.now.head ?? '' });

/** Minúta dňa pre čas „HH:MM“. @param {string} hm */
const minuta = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));

/** Bod na grafe pre minútu dňa, v pixeloch stránky. @param {import('@playwright/test').Page} page @param {number} min */
async function bodGrafu(page, min) {
    const box = await page.locator('#tz-chart svg').boundingBox();
    if (!box) throw new Error('graf nie je vidno');
    return { x: box.x + (chartX(min) / DAY_CHART.w) * box.width, y: box.y + box.height * 0.45 };
}

/** Farba bunky pásu plánu, do ktorej padne minúta dňa. @param {import('@playwright/test').Page} page @param {number} min */
const farbaPasu = (page, min) => page.locator(`#tz-chart rect[data-from="${Math.floor(min / 30) * 30}"]`).getAttribute('data-tone');

test.describe('karta Teraz', () => {
    // Napoludnie slnko, podvečer lacná sieť, večerná špička drahá sieť, v noci lacná sieť;
    // ráno živé meranie ešte slabé, plán dňa už počíta so slnkom.
    /** @type {Record<string, string | null>} */
    const pasma = { '13:00': 'sun', '19:30': 'cheap', '20:45': 'costly', '02:00': 'cheap', '08:00': null };
    for (const [hm, tone] of Object.entries(pasma)) {
        test(`o ${hm} ukazuje ten istý výkon, vetu a odporúčanie ako model aj karta Terazky súčasnej appky`, async ({ page }) => {
            const time = at(hm);
            const errors = await openTeraz(page, { time });
            const vstup = vstupTeraz(time);
            const m = terazModel(vstup);
            const hero = heroModel(vstup);
            await expect.poll(() => terazVStranke(page)).toEqual(terazZModelu(m));
            // Pri čerstvom meraní je to presne heroModel - to isté, čo počíta karta Terazky.
            expect(m.num).toBe(hero.powerText);
            expect(m.cards?.now.head).toBe(hero.message.headline);
            await expect(page.locator('#tz-now-body')).toHaveText(hero.message.body);
            // Pás plánu má v čase „teraz“ farbu toho istého plánu dňa.
            const ocakavana = cellAt(planCells(dayPlan(vstup)), minuta(hm)).tone;
            if (tone) expect(ocakavana).toBe(tone);
            expect(await farbaPasu(page, minuta(hm))).toBe(ocakavana);
            await expect(page.locator('#tz-chart')).toHaveAttribute('aria-valuetext', m.chart?.valueText ?? '');
            await expect(page.locator('#tz-chart-desc')).toHaveText(m.chart?.desc ?? '');
            await expect(page.locator('#tz-retry')).toBeHidden();
            await expect(page.locator('#tz-guess')).toBeHidden();
            await expect(page.locator('#tz-dots i')).toHaveCount(4);

            // Súčasná appka v tom istom čase s tými istými dátami: ten istý výkon a odporúčanie.
            await otvorSucasnuAppku(page);
            await page.locator('#nav-terazky').click();
            await expect(page.locator('#pv-power')).toHaveText(m.num);
            await expect(page.locator('#verdict-headline')).toHaveText(m.cards?.now.head ?? '');
            expect(errors).toEqual([]);
        });
    }

    test('nameraná krivka dneška je biela čiara cez predpoveď, hranica veľkých spotrebičov s popiskom', async ({ page }) => {
        const errors = await openTeraz(page, { time: at('13:00') });
        await expect(page.locator('#tz-chart .dc-area')).toHaveCount(1);
        await expect(page.locator('#tz-chart .dc-real')).toHaveCount(1);
        await expect(page.locator('#tz-chart .dc-limit-t')).toHaveText('veľké spotrebiče');
        await expect(page.locator('#tz-chart rect[data-tone]')).toHaveCount(48);
        await expect(page.locator('#tz-chart .dc-t')).toHaveText(['0', '6', '12', '18', '24']);
        await expect(page.locator('#tz-legend span')).toHaveText(['slnko stačí', 'lacná sieť', 'drahá sieť']);
        expect(errors).toEqual([]);
    });

    test('kurzorom: ťahanie po grafe ukáže náhľad, „Späť na teraz“ aj tlačidlo Späť ho zrušia', async ({ page }) => {
        const errors = await openTeraz(page, { time: at('13:00') });
        const teraz = terazZModelu(terazModel(vstupTeraz(at('13:00'))));
        const nahlad = terazZModelu(terazModel(vstupTeraz(at('13:00'), { previewMinutes: minuta('15:30') })));
        const z = await bodGrafu(page, minuta('10:00'));
        const na = await bodGrafu(page, minuta('15:30'));
        await page.mouse.move(z.x, z.y);
        await page.mouse.down();
        await page.mouse.move(na.x, na.y, { steps: 8 });
        await page.mouse.up();
        await expect.poll(() => terazVStranke(page)).toEqual(nahlad);
        expect(nahlad.hint).toBe('Pozeráš 15:30.');
        await expect(page.locator('#tz-chart .dc-pill-t')).toHaveText(/^15:30 · /);
        const spat = page.getByRole('button', { name: 'Späť na teraz' });
        await spat.click();
        await expect.poll(() => terazVStranke(page)).toEqual(teraz);
        await expect(spat).toBeHidden();
        await expect(page.locator('#tz-chart')).toBeFocused();

        // Tlačidlo Späť v telefóne: najprv vráti teraz, ďalšie sa správa ako doteraz (predošlá karta).
        await page.mouse.click(na.x, na.y);
        await expect.poll(() => terazVStranke(page)).toEqual(nahlad);
        await page.goBack();
        await expect.poll(() => terazVStranke(page)).toEqual(teraz);
        await ocakavajKartu(page, 'terazky');
        await page.goBack();
        await ocakavajKartu(page, 'mozem');
        expect(errors).toEqual([]);
    });

    test('klávesnica: šípky posúvajú čas po štvrťhodinách, Home a End na kraje dňa, Escape vráti teraz', async ({ page }) => {
        const errors = await openTeraz(page, { time: at('13:00') });
        const graf = page.getByRole('slider', { name: 'Graf dňa, šípkami si pozrieš iný čas' });
        const hodnota = (/** @type {string} */ hm) =>
            terazModel(vstupTeraz(at('13:00'), { previewMinutes: minuta(hm) })).chart?.valueText ?? '';
        await graf.focus();
        await page.keyboard.press('ArrowRight');
        await expect(graf).toHaveAttribute('aria-valuetext', hodnota('13:15'));
        await expect(page.locator('#tz-hint')).toHaveText('Pozeráš 13:15.');
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('ArrowLeft');
        await expect(graf).toHaveAttribute('aria-valuenow', String(minuta('12:45')));
        await expect(page.locator('#tz-num-val')).toHaveText(terazModel(vstupTeraz(at('13:00'), { previewMinutes: minuta('12:45') })).num);
        await page.keyboard.press('End');
        await expect(graf).toHaveAttribute('aria-valuenow', String(minuta('23:45')));
        await page.keyboard.press('Home');
        await expect(graf).toHaveAttribute('aria-valuenow', '0');
        await page.keyboard.press('Escape');
        await expect(graf).toHaveAttribute('aria-valuetext', terazModel(vstupTeraz(at('13:00'))).chart?.valueText ?? '');
        await expect(page.locator('#tz-reset')).toBeHidden();
        expect(errors).toEqual([]);
    });

    test('meranie neodpovedá: číslo je odhad a povie, kedy prišlo posledné meranie', async ({ page }) => {
        const stare = pvAt(at('11:40'));
        const errors = await openObloha(page, { time: at('13:00'), pvData: stare });
        await page.locator('#nav-terazky').click();
        const m = terazModel(vstupTeraz(at('13:00'), { pv: stare }));
        await expect.poll(() => terazVStranke(page)).toEqual(terazZModelu(m));
        await expect(page.locator('#tz-src')).toHaveText(/^odhad z predpovede · meranie neodpovedá od \d\d:\d\d$/);
        await expect(page.locator('#tz-chart')).toBeVisible();
        await expect(page.locator('#tz-strip')).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('bez dát: pomlčka, veta s príčinou, Skúsiť znova a po ňom s dátami karta odpovie', async ({ page }) => {
        let offline = true;
        const errors = await pripravSiet(page);
        await page.unrouteAll();
        await page.route(/cdnjs\.cloudflare\.com/, (route) => route.abort());
        await page.route(WORKER_PV_URL, (route) => (offline ? route.abort() : route.fulfill({ json: { pv: pvAt(FIXED_NOW) } })));
        await page.route(/api\.open-meteo\.com/, (route) => (offline ? route.abort() : route.fulfill({ json: weather })));
        await page.clock.setFixedTime(FIXED_NOW);
        await page.goto('/obloha/');
        await appReady(page);
        await page.locator('#nav-terazky').click();

        const bez = terazModel(vstupTeraz(FIXED_NOW, { pv: null, forecast: null }));
        await expect.poll(() => terazVStranke(page)).toEqual(terazZModelu(bez));
        await expect(page.locator('#tz-num-val')).toHaveText('–');
        await expect(page.locator('#tz-sub')).toHaveText(/^Predpoveď počasia neprišla.* Ani meranie zo strechy neodpovedá\./);
        // Žiadne vymyslené čísla: graf ani odporúčania sa neukážu.
        await expect(page.locator('#tz-plot')).toBeHidden();
        await expect(page.locator('#tz-recs')).toBeHidden();
        const znova = page.locator('#tz-retry');
        await expect(znova).toHaveText('Skúsiť znova');
        await expect(znova).toBeVisible();

        offline = false;
        await znova.click();
        await expect.poll(() => terazVStranke(page)).toEqual(terazZModelu(terazModel(vstupTeraz(FIXED_NOW))));
        await expect(znova).toBeHidden();
        await expect(page.locator('#tz-plot')).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('poloha bez panelov: „~“, typická strecha a výzva do Nastavenia; súčasná appka ostáva bez výkonu', async ({ page }) => {
        const errors = await openTeraz(page, { settings: null, site: SITE });
        const typical = typicalSettings(SITE);
        const m = terazModel({
            ...vstupTeraz(FIXED_NOW),
            ...typical,
            known: 'poloha',
            pv: null,
            forecast: buildForecast(weather, FIXED_NOW, SITE, typical.plant),
        });
        await expect.poll(() => terazVStranke(page)).toEqual(terazZModelu(m));
        await expect(page.locator('#tz-num-val')).toHaveText(/^~\d/);
        await expect(page.locator('#tz-sub')).toHaveText('typická strecha asi 5 kWp v tvojej obci, nie tvoja');
        await expect(page.locator('#tz-guess-title')).toHaveText('Koľko dáva tvoja strecha?');
        expect(await page.locator('#tz-guess').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
        await page.locator('#tz-guess-btn').click();
        await ocakavajKartu(page, 'nastavenie');

        // Súčasná appka v tom istom stave: karta Terazky bez výkonu, ako doteraz.
        await otvorSucasnuAppku(page);
        await page.locator('#nav-terazky').click();
        await expect(page.locator('#panel-terazky')).toHaveClass(/no-panels/);
        await expect(page.locator('#pv-power')).toHaveText('–');
        expect(errors).toEqual([]);
    });

    test('bez polohy: len výzva zadať polohu, bez grafu a odporúčaní', async ({ page }) => {
        const errors = await openTeraz(page, { settings: null });
        await expect(page.locator('#tz-ask')).toBeVisible();
        await expect(page.locator('#tz-plot')).toBeHidden();
        await expect(page.locator('#tz-recs')).toBeHidden();
        await expect(page.locator('#tz-num')).toBeHidden();
        await page.locator('#tz-ask-btn').click();
        await ocakavajKartu(page, 'nastavenie');
        expect(errors).toEqual([]);
    });

    test('načítavanie: pokojný stav bez chybovej hlášky a bez tlačidla Skúsiť znova', async ({ page }) => {
        /** @type {() => void} */
        let pusti = () => {};
        const brana = new Promise((r) => (pusti = () => r(undefined)));
        await pripravSiet(page);
        await page.route(/api\.open-meteo\.com/, async (route) => {
            await brana;
            await route.fulfill({ json: weather });
        });
        await page.clock.setFixedTime(FIXED_NOW);
        await page.goto('/obloha/');
        await appReady(page);
        await page.locator('#nav-terazky').click();
        await expect(page.locator('#tz-sub')).toHaveText('Načítavam…');
        await expect(page.locator('#tz-retry')).toBeHidden();
        await expect(page.locator('#tz-num')).toBeHidden();
        pusti();
        await expect(page.locator('#tz-plot')).toBeVisible();
    });

    test('prístupnosť: žiadne závažné nálezy axe počas náhľadu ani bez dát', async ({ page }) => {
        await openTeraz(page, { time: at('13:00') });
        await page.locator('#tz-chart').focus();
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('#tz-reset')).toBeVisible();
        expect(await vazneNalezy(page)).toEqual([]);
        await openTeraz(page, { offline: true });
        expect(await vazneNalezy(page)).toEqual([]);
    });
});

/** Ťah prstom cez CDP po krokoch, ako naozajstný prst - prehliadač pri ňom posúva stránku aj pás sám.
 * @param {import('@playwright/test').Page} page @param {{ x: number, y: number, dx?: number, dy?: number, krokMs?: number }} gesto */
async function prstTah(page, { x, y, dx = 0, dy = 0, krokMs = 40 }) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (const t of [0.2, 0.4, 0.6, 0.8, 1]) {
        await page.waitForTimeout(krokMs);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * t, y: y + dy * t }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
}

test.describe('karta Teraz prstom', () => {
    test.use({ hasTouch: true });

    test('ťuknutie bez pohybu ukáže náhľad a nechá ho svietiť', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        const errors = await openTeraz(page, { time: at('13:00') });
        const bod = await bodGrafu(page, minuta('16:00'));
        await prst(page, bod);
        await expect(page.locator('#tz-hint')).toHaveText('Pozeráš 16:00.');
        await page.waitForTimeout(2000);
        await expect(page.locator('#tz-hint')).toHaveText('Pozeráš 16:00.');
        await expect(page.locator('#tz-num-val')).toHaveText(terazModel(vstupTeraz(at('13:00'), { previewMinutes: minuta('16:00') })).num);
        expect(errors).toEqual([]);
    });

    test('zvislý ťah cez graf posunie stránku a náhľad neukáže', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        const errors = await openTeraz(page, { time: at('13:00') });
        const bod = await bodGrafu(page, minuta('12:00'));
        await prst(page, { ...bod, dy: -160 });
        await expect.poll(() => page.evaluate(() => window.scrollY), 'stránka sa cez graf neposunula').toBeGreaterThan(0);
        await page.waitForTimeout(300);
        await expect(page.locator('#tz-hint')).toHaveText('Ťahaj prstom po grafe a pozri si iný čas.');
        await expect(page.locator('#tz-reset')).toBeHidden();
        await ocakavajKartu(page, 'terazky');
        expect(errors).toEqual([]);
    });

    test('rýchly vodorovný ťah po grafe ukazuje náhľad a kartu neprelistuje', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        const errors = await openTeraz(page, { time: at('13:00') });
        const bod = await bodGrafu(page, minuta('16:00'));
        const ciel = await bodGrafu(page, minuta('09:00'));
        // Švihnutie doľava ako pri listovaní kariet: rýchle a ďaleko.
        await prstTah(page, { ...bod, dx: ciel.x - bod.x, krokMs: 20 });
        await expect(page.locator('#tz-hint')).toHaveText('Pozeráš 09:00.');
        await page.waitForTimeout(300);
        await ocakavajKartu(page, 'terazky');
        expect(errors).toEqual([]);
    });

    test('pás odporúčaní sa posúva prstom do strán a listovanie kariet ho nepreberie', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        const errors = await openTeraz(page, { time: at('13:00') });
        const pas = page.locator('#tz-strip');
        await pas.scrollIntoViewIfNeeded();
        const box = await pas.boundingBox();
        if (!box) throw new Error('pás odporúčaní nie je vidno');
        await prstTah(page, { x: box.x + box.width * 0.8, y: box.y + box.height / 2, dx: -220 });
        await expect.poll(() => pas.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
        await page.waitForTimeout(400);
        await ocakavajKartu(page, 'terazky');
        await expect(page.locator('#tz-dots i.on')).toHaveCount(1);
        await expect(page.locator('#tz-dots i').first()).not.toHaveClass('on');
        expect(errors).toEqual([]);
    });
});

test.describe('karta Môžem? po kontrole kroku 2', () => {
    for (const width of [390, 320]) {
        test(`šírka ${width} px: časy východu a západu pod oblúkom sú celé a odsadené od okraja ako ostatný obsah`, async ({ page }) => {
            await page.setViewportSize({ width, height: 800 });
            const errors = await openObloha(page);
            const casy = await page.locator('#mz-arc .arc-t').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
            expect(casy).toHaveLength(2);
            // Odstup obsahu karty: odsadenie vety pod slovom.
            const odstup = await page.locator('#mz-answer').evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
            const sirka = await page.evaluate(() => innerWidth);
            for (const t of casy) {
                expect(t.left, 'čas pod oblúkom je pri ľavom okraji').toBeGreaterThanOrEqual(odstup - 0.5);
                expect(sirka - t.right, 'čas pod oblúkom je pri pravom okraji').toBeGreaterThanOrEqual(odstup - 0.5);
            }
            expect(errors).toEqual([]);
        });
    }

    test('výzva bez panelov píše výkon typickej strechy zaokrúhlene', async ({ page }) => {
        const errors = await openObloha(page, { settings: null, site: SITE });
        await expect(page.locator('#mz-guess-text')).toHaveText(/Rátam s typickou strechou asi 5 kWp\./);
        await expect(page.locator('#mz-guess-text')).not.toHaveText(/5,22/);
        expect(errors).toEqual([]);
    });
});

for (const width of [390, 320]) {
    test(`karta Teraz na šírke ${width} px: nič nepretečie, číslo aj legenda sú celé, tlačidlá aspoň 44 px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        const errors = await openTeraz(page, { time: at('13:00') });
        await page.locator('#tz-chart').focus();
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('#tz-reset')).toBeVisible();
        const mimo = await page.evaluate(() =>
            ['#tz-num', '#tz-src', '#tz-sub', '#tz-chart', '#tz-legend', '.hint', '#tz-reset']
                .map((sel) => ({ sel, box: /** @type {Element} */ (document.querySelector(sel)).getBoundingClientRect() }))
                .filter(({ box }) => box.left < 0 || box.right > innerWidth + 0.5)
                .map(({ sel }) => sel),
        );
        expect(mimo, 'tieto prvky trčia z obrazovky').toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'stránka ide do strán').toBe(true);
        expect((await page.locator('#tz-reset').boundingBox())?.height).toBeGreaterThanOrEqual(44);
        expect(errors).toEqual([]);
    });
}

// ---- Karta 7 dní (krok 4) ----------------------------------------------------------
// Očakávané texty počíta tá istá funkcia ako appka (shared/sedem-dni.js nad weekStatsModel,
// weekListModel a plánom dňa súčasnej appky) z tých istých dát.

/**
 * Vstup karty 7 dní pre dáta z fixtures, tak ako ho skladá appka: Dvorany s kioskom, meranie
 * z fixtures (openObloha ho posiela predvolene) a pevný čas.
 * @param {object} [extra] @returns {import('../../shared/sedem-dni.js').SedemData}
 */
const vstupSedem = (extra = {}) => ({
    ...OWNER,
    now: FIXED_NOW,
    loading: false,
    known: 'elektraren',
    pv,
    forecast: buildForecast(weather, FIXED_NOW, SITE, PLANT),
    ...extra,
});

/** Počasie, v ktorom má streda 9. 9. žiarenie stiahnuté na zlomok - deň bez okna. */
const slabyTyzden = (() => {
    const w = structuredClone(weather);
    const keys = ['shortwave_radiation_instant', 'direct_normal_irradiance_instant', 'diffuse_radiation_instant'];
    for (const [i, t] of w.hourly.time.entries()) if (t.startsWith('2026-09-09')) for (const k of keys) w.hourly[k][i] *= 0.15;
    return w;
})();

/**
 * Otvorí novú appku na karte 7 dní.
 * @param {import('@playwright/test').Page} page @param {Parameters<typeof openObloha>[1]} [opts]
 */
async function openSedem(page, opts = {}) {
    const errors = await openObloha(page, opts);
    await page.locator('#nav-7dni').click();
    await ocakavajKartu(page, '7dni');
    return errors;
}

/** Čo ukazuje prehľad: nadpis, súčet a riadky (meno, kWh, počasie, znenie pre čítačku, najlepší, pás). @param {import('@playwright/test').Page} page */
const prehladVStranke = (page) =>
    page.evaluate(() => ({
        title: document.querySelector('#sd-title')?.textContent ?? '',
        sum: document.querySelector('#sd-sum-text')?.textContent ?? '',
        rows: [...document.querySelectorAll('#sd-days .day')].map((r) => ({
            name: r.querySelector('.dn')?.textContent ?? '',
            kwh: r.querySelector('em')?.textContent ?? '',
            weather: r.querySelector('svg.wi')?.getAttribute('data-w') ?? null,
            label: r.getAttribute('aria-label'),
            best: r.classList.contains('best'),
            band: [...r.querySelectorAll('.rng i')].map((i) => ({
                left: parseFloat(/** @type {HTMLElement} */ (i).style.left),
                width: parseFloat(/** @type {HTMLElement} */ (i).style.width),
            })),
        })),
    }));

/** To isté z modelu. @param {ReturnType<typeof sedemModel>} m */
const prehladZModelu = (m) => ({
    title: m.title,
    sum: m.sum,
    rows: m.rows.map((r) => ({ name: r.name, kwh: r.kwh, weather: r.weather, label: r.label, best: r.best, band: r.band })),
});

/** Čo ukazuje detail dňa: nadpis, slovo počasia, tri čísla a hláška. @param {import('@playwright/test').Page} page */
const denVStranke = (page) =>
    page.evaluate(() => ({
        title: document.querySelector('#sd-day-title')?.textContent ?? '',
        sub: document.querySelector('#sd-day-sub')?.textContent ?? '',
        nums: [...document.querySelectorAll('#sd-day-nums > div')].map((n) => n.textContent),
        msg: `${document.querySelector('#sd-day-msg-title')?.textContent} | ${document.querySelector('#sd-day-msg-body')?.textContent}`,
    }));

/** To isté z modelu. @param {ReturnType<typeof sedemDayModel>} d */
const denZModelu = (d) => ({
    title: d.title,
    sub: d.sub,
    nums: d.nums.map((n) => `${n.value}${n.label}`),
    msg: `${d.message.title} | ${d.message.body}`,
});

/** Ťah prstom do strán nad prvkom (cez CDP, ako naozajstný prst). @param {import('@playwright/test').Page} page @param {string} sel @param {number} dx */
async function tahNad(page, sel, dx) {
    const box = await page.locator(sel).boundingBox();
    if (!box) throw new Error(`${sel} nie je vidno`);
    await prstTah(page, { x: box.x + box.width / 2, y: box.y + box.height / 2, dx, krokMs: 25 });
}

test.describe('karta 7 dní', () => {
    for (const width of [390, 320]) {
        test(`šírka ${width} px: nadpis, súčet a 7 riadkov ako model, riadky aspoň 44 px a nič sa neoreže`, async ({ page }) => {
            await page.setViewportSize({ width, height: 800 });
            const errors = await openSedem(page);
            const m = sedemModel(vstupSedem());
            await expect.poll(() => prehladVStranke(page)).toEqual(prehladZModelu(m));
            // Najlepší deň menuje nadpis aj súhrn karty 7 dní súčasnej appky.
            expect(m.title).toBe('Veľké pranie? Štvrtok.');
            await expect(page.locator('#sd-days .day')).toHaveCount(7);
            await expect(page.locator('#sd-days .day.best')).toHaveCount(1);
            await expect(page.locator('#sd-hint')).toHaveText(
                'Zelený pás ukazuje, odkedy dokedy slnko stačí na veľké spotrebiče. Ťukni na deň.',
            );
            const riadky = await page.locator('#sd-days .day, #sd-sum').evaluateAll((els) =>
                els.map((el) => {
                    const box = el.getBoundingClientRect();
                    const vnutri = [...el.querySelectorAll('span, em, svg')].every((c) => {
                        const b = c.getBoundingClientRect();
                        return b.left >= box.left - 0.5 && b.right <= box.right + 0.5;
                    });
                    const em = el.querySelector('em');
                    return {
                        id: el.getAttribute('data-day') ?? el.id,
                        height: box.height,
                        ok: vnutri && box.left >= 0 && box.right <= innerWidth + 0.5 && (!em || em.scrollWidth <= em.clientWidth + 0.5),
                    };
                }),
            );
            for (const r of riadky) {
                expect(r.height, r.id).toBeGreaterThanOrEqual(44);
                expect(r.ok, `${r.id} je orezaný`).toBe(true);
            }
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'stránka ide do strán').toBe(true);
            expect(errors).toEqual([]);
        });
    }

    test('ikony počasia: každý z troch stavov má svoju ikonu, zamračené bez kvapiek', async ({ page }) => {
        const errors = await openSedem(page);
        const ikony = await page
            .locator('#sd-days svg.wi')
            .evaluateAll((svgs) =>
                svgs.map((s) => ({ w: s.getAttribute('data-w'), html: s.innerHTML, hidden: s.getAttribute('aria-hidden') })),
            );
        const podlaStavu = Object.fromEntries(ikony.map((i) => [i.w, i]));
        expect(Object.keys(podlaStavu).sort()).toEqual(['jasno', 'polojasno', 'zamracene']);
        expect(new Set(Object.values(podlaStavu).map((i) => i.html)).size, 'tri rôzne ikony').toBe(3);
        expect(
            ikony.every((i) => i.hidden === 'true'),
            'ikona je ozdoba',
        ).toBe(true);
        // Zamračené je len oblak: jeden tvar, žiadne čiary kvapiek ani slnko.
        const zamracene = page.locator('#sd-days svg.wi[data-w="zamracene"]').first();
        expect(await zamracene.evaluate((s) => [...s.children].map((c) => `${c.tagName}.${c.getAttribute('class')}`))).toEqual([
            'path.wi-cloud wi-dark',
        ]);
        // Slovo počasia je v znení riadku pre čítačku.
        await expect(page.locator('#sd-days .day').nth(2)).toHaveAttribute('aria-label', /^Pondelok, zamračené, /);
        expect(errors).toEqual([]);
    });

    test('detail dneška: tri čísla, hláška a „teraz“ ako model; iný deň bez „teraz“', async ({ page }) => {
        const errors = await openSedem(page);
        await page.locator('#sd-days [data-day="0"]').click();
        await expect(page.locator('#sd-day')).toBeVisible();
        await expect(page.locator('#sd-list')).toBeHidden();
        const d = sedemDayModel(vstupSedem(), 0);
        await expect.poll(() => denVStranke(page)).toEqual(denZModelu(d));
        await expect(page.locator('#sd-day-chart .dc-now')).toHaveCount(1);
        await expect(page.locator('#sd-day-chart .dc-real')).toHaveCount(1);
        await expect(page.locator('#sd-day-chart')).toHaveAttribute('aria-label', d.chart.desc);
        await expect(page.locator('#sd-day-done')).toHaveText(d.done);
        await expect(page.locator('#sd-day-clear')).toHaveText(d.clear);
        await expect(page.locator('#sd-day-legend span')).toHaveText(d.chart.legend.map((l) => l.text));
        await expect(page.locator('#sd-day-hint')).toHaveText('Potiahni do strán na susedný deň.');
        await expect(page.locator('#sd-day-back')).toBeFocused();

        await page.locator('#sd-day-back').click();
        await page.locator('#sd-days [data-day="4"]').click();
        await expect.poll(() => denVStranke(page)).toEqual(denZModelu(sedemDayModel(vstupSedem(), 4)));
        await expect(page.locator('#sd-day-chart .dc-now')).toHaveCount(0);
        await expect(page.locator('#sd-day-done')).toBeHidden();
        expect(errors).toEqual([]);
    });

    test('deň bez okna: prázdny pás v riadku, v detaile „bez okna“ a hláška pre slabý deň', async ({ page }) => {
        const errors = await pripravSiet(page);
        await page.unroute(/api\.open-meteo\.com/);
        await page.route(/api\.open-meteo\.com/, (route) => route.fulfill({ json: slabyTyzden }));
        await page.clock.setFixedTime(FIXED_NOW);
        await page.goto('/obloha/');
        await appReady(page);
        await page.locator('#nav-7dni').click();
        const vstup = vstupSedem({ forecast: buildForecast(slabyTyzden, FIXED_NOW, SITE, PLANT) });
        await expect.poll(() => prehladVStranke(page)).toEqual(prehladZModelu(sedemModel(vstup)));
        await expect(page.locator('#sd-days [data-day="4"] .rng i')).toHaveCount(0);
        await expect(page.locator('#sd-days [data-day="4"]')).toHaveAttribute('aria-label', /, bez okna$/);
        await page.locator('#sd-days [data-day="4"]').click();
        await expect.poll(() => denVStranke(page)).toEqual(denZModelu(sedemDayModel(vstup, 4)));
        await expect(page.locator('#sd-day-nums > div').nth(2)).toHaveText('–bez okna');
        await expect(page.locator('#sd-day-msg-title')).toHaveText('Slabý deň');
        expect(errors).toEqual([]);
    });

    test('detail týždňa: tri čísla, 7 stĺpcov, mapa 7 × hodiny a hláška z weekMessage', async ({ page }) => {
        const errors = await openSedem(page);
        await page.locator('#sd-sum').click();
        await expect(page.locator('#sd-week')).toBeVisible();
        const w = sedemWeekModel(vstupSedem());
        await expect(page.locator('#sd-week-title')).toHaveText('Týždeň');
        await expect(page.locator('#sd-week-range')).toHaveText(w.range);
        await expect(page.locator('#sd-week-nums > div')).toHaveText(w.nums.map((n) => `${n.value}${n.label}`));
        await expect(page.locator('#sd-bars rect.wb')).toHaveCount(7);
        await expect(page.locator('#sd-bars rect.wb.best')).toHaveCount(1);
        await expect(page.locator('#sd-bars text.wb-v')).toHaveText(w.bars.map((b) => b.value));
        await expect(page.locator('#sd-heat rect.hc')).toHaveCount(7 * 17);
        await expect(page.locator('#sd-heat rect.hc.sun')).toHaveCount(w.heat.cells.filter((c) => c.sun).length);
        await expect(page.locator('#sd-heat-note')).toHaveText('Zelené políčko = v tú hodinu slnko stačí na veľké spotrebiče.');
        await expect(page.locator('#sd-bars')).toHaveAttribute('aria-label', w.barsText);
        await expect(page.locator('#sd-heat')).toHaveAttribute('aria-label', w.heatText);
        await expect(page.locator('#sd-week-msg-title')).toHaveText(w.message.title);
        await expect(page.locator('#sd-week-msg-body')).toHaveText(w.message.body);
        expect(errors).toEqual([]);
    });

    test('tlačidlo Späť, Escape aj „‹ 7 dní“ vrátia do prehľadu na to isté miesto a fokus na riadok', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 560 });
        const errors = await openSedem(page);
        await page.evaluate(() => window.scrollTo(0, 160));
        const y = await page.evaluate(() => window.scrollY);
        expect(y).toBeGreaterThan(100);
        await page.locator('#sd-days [data-day="5"]').click();
        await expect(page.locator('#sd-day')).toBeVisible();
        expect(await page.evaluate(() => window.scrollY)).toBe(0);

        await page.goBack();
        await expect(page.locator('#sd-list')).toBeVisible();
        await expect(page.locator('#sd-days [data-day="5"]')).toBeFocused();
        expect(await page.evaluate(() => window.scrollY)).toBe(y);
        // Ďalšie Späť sa správa ako doteraz: predošlá karta.
        await page.goBack();
        await ocakavajKartu(page, 'mozem');
        await page.locator('#nav-7dni').click();

        await page.locator('#sd-sum').click();
        await expect(page.locator('#sd-week')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#sd-list')).toBeVisible();
        await expect(page.locator('#sd-sum')).toBeFocused();

        await page.locator('#sd-days [data-day="2"]').click();
        await page.locator('#sd-day-back').click();
        await expect(page.locator('#sd-days [data-day="2"]')).toBeFocused();
        // Šípka ide krokom v histórii: Späť potom detail znovu neotvorí, ale vráti predošlú kartu.
        await page.goBack();
        await ocakavajKartu(page, 'mozem');
        expect(errors).toEqual([]);
    });
});

test.describe('karta 7 dní prstom', () => {
    test.use({ hasTouch: true });

    test('v detaile dňa ťah doľava ide na ďalší deň, doprava späť, z dneška doprava do prehľadu', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        const errors = await openSedem(page);
        await page.locator('#sd-days [data-day="0"]').click();
        await expect(page.locator('#sd-day-title')).toHaveText('Dnes 5.9.');
        await tahNad(page, '#sd-day-sub', -160);
        await expect(page.locator('#sd-day-title')).toHaveText('Zajtra 6.9.');
        // Aj ťah cez graf listuje dni - graf v detaile nie je posúvač času.
        await tahNad(page, '#sd-day-chart', -160);
        await expect(page.locator('#sd-day-title')).toHaveText('Pondelok 7.9.');
        await tahNad(page, '#sd-day-sub', 160);
        await expect(page.locator('#sd-day-title')).toHaveText('Zajtra 6.9.');
        await tahNad(page, '#sd-day-sub', 160);
        await expect(page.locator('#sd-day-title')).toHaveText('Dnes 5.9.');
        await tahNad(page, '#sd-day-sub', 160);
        await expect(page.locator('#sd-list')).toBeVisible();
        await ocakavajKartu(page, '7dni');
        // Listovanie dní nebolo krokom navigácie: Späť z prehľadu ide na predošlú kartu.
        await page.goBack();
        await ocakavajKartu(page, 'mozem');
        expect(errors).toEqual([]);
    });

    test('v detaile týždňa ťah doprava vráti do prehľadu, mimo detailu ťah listuje karty', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        const errors = await openSedem(page);
        await page.locator('#sd-sum').click();
        await expect(page.locator('#sd-week')).toBeVisible();
        await tahNad(page, '#sd-week-range', -160);
        await expect(page.locator('#sd-week')).toBeVisible();
        await tahNad(page, '#sd-week-range', 160);
        await expect(page.locator('#sd-list')).toBeVisible();
        await tahNad(page, '#sd-title', 160);
        await ocakavajKartu(page, 'terazky');
        expect(errors).toEqual([]);
    });

    test('zvislý ťah cez riadky aj cez graf posunie stránku a nič neotvorí ani neprelistuje', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 560 });
        const errors = await openSedem(page);
        const riadok = await page.locator('#sd-days [data-day="3"]').boundingBox();
        if (!riadok) throw new Error('riadok nie je vidno');
        await prst(page, { x: riadok.x + riadok.width / 2, y: riadok.y + riadok.height / 2, dy: -160 });
        await expect.poll(() => page.evaluate(() => window.scrollY), 'stránka sa cez riadky neposunula').toBeGreaterThan(0);
        await page.waitForTimeout(300);
        await expect(page.locator('#sd-list')).toBeVisible();
        await expect(page.locator('#sd-day')).toBeHidden();
        await ocakavajKartu(page, '7dni');

        await page.locator('#sd-days [data-day="1"]').click();
        await expect(page.locator('#sd-day-title')).toHaveText('Zajtra 6.9.');
        const graf = await page.locator('#sd-day-chart').boundingBox();
        if (!graf) throw new Error('graf nie je vidno');
        await prst(page, { x: graf.x + graf.width / 2, y: graf.y + graf.height / 2, dy: -160 });
        await expect.poll(() => page.evaluate(() => window.scrollY), 'stránka sa cez graf neposunula').toBeGreaterThan(0);
        await page.waitForTimeout(300);
        await expect(page.locator('#sd-day-title')).toHaveText('Zajtra 6.9.');
        expect(errors).toEqual([]);
    });

    test('ťuknutie prstom na riadok otvorí detail toho dňa', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        const errors = await openSedem(page);
        const riadok = await page.locator('#sd-days [data-day="5"]').boundingBox();
        if (!riadok) throw new Error('riadok nie je vidno');
        await prst(page, { x: riadok.x + 40, y: riadok.y + riadok.height / 2 });
        await expect(page.locator('#sd-day-title')).toHaveText('Štvrtok 10.9.');
        expect(errors).toEqual([]);
    });
});

test.describe('karta 7 dní: stavy', () => {
    test('bez dát: veta s príčinou, Skúsiť znova a po ňom s dátami karta ukáže dni', async ({ page }) => {
        let offline = true;
        const errors = await pripravSiet(page);
        await page.unrouteAll();
        await page.route(/cdnjs\.cloudflare\.com/, (route) => route.abort());
        await page.route(WORKER_PV_URL, (route) => (offline ? route.abort() : route.fulfill({ json: { pv } })));
        await page.route(/api\.open-meteo\.com/, (route) => (offline ? route.abort() : route.fulfill({ json: weather })));
        await page.clock.setFixedTime(FIXED_NOW);
        await page.goto('/obloha/');
        await appReady(page);
        await page.locator('#nav-7dni').click();
        const bez = sedemModel(vstupSedem({ pv: null, forecast: null }));
        await expect(page.locator('#sd-sub')).toHaveText(bez.sub);
        await expect(page.locator('#sd-sub')).toHaveText(/^Predpoveď počasia neprišla/);
        // Žiadne vymyslené čísla: ani súčet, ani riadky.
        await expect(page.locator('#sd-days')).toBeHidden();
        await expect(page.locator('#sd-sum')).toBeHidden();
        const znova = page.locator('#sd-retry');
        await expect(znova).toHaveText('Skúsiť znova');
        offline = false;
        await znova.click();
        await expect.poll(() => prehladVStranke(page)).toEqual(prehladZModelu(sedemModel(vstupSedem())));
        await expect(znova).toBeHidden();
        expect(errors).toEqual([]);
    });

    test('bez internetu s predpoveďou: posledná známa predpoveď', async ({ page }) => {
        await openSedem(page);
        await page.context().setOffline(true);
        await expect(page.locator('#sd-sum-text')).toHaveText(/ · posledná známa predpoveď$/);
        await expect(page.locator('#sd-days .day')).toHaveCount(7);
        await page.context().setOffline(false);
        await expect(page.locator('#sd-sum-text')).not.toHaveText(/posledná známa/);
    });

    test('načítavanie: pokojný stav bez chybovej hlášky a bez tlačidla Skúsiť znova', async ({ page }) => {
        /** @type {() => void} */
        let pusti = () => {};
        const brana = new Promise((r) => (pusti = () => r(undefined)));
        await pripravSiet(page);
        await page.route(/api\.open-meteo\.com/, async (route) => {
            await brana;
            await route.fulfill({ json: weather });
        });
        await page.clock.setFixedTime(FIXED_NOW);
        await page.goto('/obloha/');
        await appReady(page);
        await page.locator('#nav-7dni').click();
        await expect(page.locator('#sd-sub')).toHaveText('Načítavam…');
        await expect(page.locator('#sd-retry')).toBeHidden();
        await expect(page.locator('#sd-days')).toBeHidden();
        pusti();
        await expect(page.locator('#sd-days .day')).toHaveCount(7);
    });

    test('poloha bez panelov: typická strecha, odhad v riadkoch a výzva do Nastavenia; súčasná appka ostáva', async ({ page }) => {
        const errors = await openSedem(page, { settings: null, site: SITE });
        const typical = typicalSettings(SITE);
        const forecast = buildForecast(weather, FIXED_NOW, SITE, typical.plant);
        const m = sedemModel(vstupSedem({ ...typical, known: 'poloha', pv: null, forecast }));
        await expect.poll(() => prehladVStranke(page)).toEqual(prehladZModelu(m));
        await expect(page.locator('#sd-sum-text')).toHaveText(/ · typická strecha$/);
        await expect(page.locator('#sd-days')).toHaveClass(/\best\b/);
        expect(
            await page
                .locator('#sd-days .day em')
                .first()
                .evaluate((el) => getComputedStyle(el).fontStyle),
        ).toBe('italic');
        await expect(page.locator('#sd-guess-title')).toHaveText('Najlepší deň sedí, kWh nie');
        await expect(page.locator('#sd-guess-text')).toHaveText(
            'Ktorý deň je najlepší, viem z počasia. Koľko kWh, záleží od tvojich panelov. Teraz ukazujem typickú strechu asi 5 kWp.',
        );
        expect(await page.locator('#sd-guess').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
        await page.locator('#sd-guess-btn').click();
        await ocakavajKartu(page, 'nastavenie');

        // Súčasná appka v tom istom stave: karta 7 dní ako doteraz, s typickou strechou v podnadpise.
        await otvorSucasnuAppku(page);
        await page.locator('#nav-7dni').click();
        await expect(page.locator('#week-sub')).toHaveText(/typická strecha/);
        expect(errors).toEqual([]);
    });

    test('bez polohy: len výzva zadať polohu', async ({ page }) => {
        const errors = await openSedem(page, { settings: null });
        await expect(page.locator('#sd-ask')).toBeVisible();
        await expect(page.locator('#sd-ask-title')).toHaveText('Kde máš strechu?');
        await expect(page.locator('#sd-days')).toBeHidden();
        await expect(page.locator('#sd-sum')).toBeHidden();
        await page.locator('#sd-ask-btn').click();
        await ocakavajKartu(page, 'nastavenie');
        expect(errors).toEqual([]);
    });

    test('prístupnosť: žiadne závažné nálezy axe v prehľade ani v oboch detailoch', async ({ page }) => {
        await openSedem(page);
        expect(await vazneNalezy(page), 'prehľad').toEqual([]);
        await page.locator('#sd-days [data-day="0"]').click();
        await expect(page.locator('#sd-day')).toBeVisible();
        expect(await vazneNalezy(page), 'detail dňa').toEqual([]);
        await page.keyboard.press('Escape');
        await page.locator('#sd-sum').click();
        await expect(page.locator('#sd-week')).toBeVisible();
        expect(await vazneNalezy(page), 'detail týždňa').toEqual([]);
        await openSedem(page, { settings: null, site: SITE });
        expect(await vazneNalezy(page), 'bez panelov').toEqual([]);
    });
});
