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
import { toUser, typicalSettings } from '../../shared/settings.js';
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
            // Karta Môžem? už má obsah (krok 2), ostatné ešte čakajú.
            if (panel !== 'mozem') await expect(page.locator(`#panel-${panel} .sub`)).toHaveText('Táto karta príde v ďalšom kroku.');
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
        expect(await page.evaluate(() => history.state)).toEqual({ step: { panel: 'mozem', item: null } });
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
        await page.goto('/');
        await expect(page.locator('#pv-updated')).not.toHaveText('načítavam…');
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

        await page.goto('/');
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
        await page.goto('/');
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
