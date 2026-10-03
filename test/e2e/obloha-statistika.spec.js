// E2E pre kartu Štatistika a plagát na zdieľanie v novej appke „Živá obloha“ (obloha/). Pevný čas,
// dáta z fixtures a očakávané hodnoty počítané tou istou funkciou (shared/statistika.js), ktorú
// volá appka - test tak odhalí rozdiel medzi modelom a tým, čo je naozaj v DOM.
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
    DAYLOG_STORAGE_KEY,
    LAUNCH_STORAGE_KEY,
    PLANT,
    SETTINGS_STORAGE_KEY,
    SITE,
    SITE_STORAGE_KEY,
    TARIFF,
    WORKER_PV_URL,
} from '../../shared/config.js';
import { recordDay } from '../../shared/daylog.js';
import { kwpText } from '../../shared/format.js';
import { posterLinkText, STATISTIKA_TEXTS } from '../../shared/messages.js';
import { toUser } from '../../shared/settings.js';
import { buildForecast, localMinutes } from '../../shared/solar.js';
import { STATS_PERIODS } from '../../shared/stats.js';
import { kwhText, posterModel, statistikaModel } from '../../shared/statistika.js';
import { FIXED_NOW, fixture, fixtureData } from '../helpers.js';

const { pv } = fixtureData();
const weather = fixture('open-meteo.json');
const TEST_KIOSK = 'https://region01eu5.fusionsolar.huawei.com/pvmswebsite/nologin/assets/build/index.html#/kiosk?kk=Test1234';
const IGNORED_CONSOLE = /Failed to load resource|net::ERR_FAILED/;
/** Tarifa Dvorian s cenami: NT lacné, VT drahé. */
const PRICED = { ...TARIFF, bands: TARIFF.bands.map((b) => ({ ...b, price: b.id === 'nt' ? 0.14 : 0.19 })) };
const OWNER = { site: SITE, plant: PLANT, tariff: PRICED, kiosk: TEST_KIOSK };
/** Denník výroby: tri dni septembra (3. chýba) a jeden augustový. */
const LOG = { '2026-08-31': 30, '2026-09-01': 38.2, '2026-09-02': 52.1, '2026-09-04': 41.7 };
/** Zápisy „Pustil/a som“: dve prania na slnku, jedno večer, umývačka. */
const LAUNCHES = [
    { d: '2026-09-01', id: 'pracka', m: 660, sun: true },
    { d: '2026-09-02', id: 'pracka', m: 1260, sun: false },
    { d: '2026-09-04', id: 'pracka', m: 720, sun: true },
    { d: '2026-09-04', id: 'umyvacka', m: 760, sun: true },
];

/**
 * Otvorí novú appku s pevným časom, uloženým nastavením, denníkom a zápismi spustení. `net.off`
 * zhodí Worker aj Open-Meteo, kým ho test neprepne späť. `onPv` odpovedá namiesto Workera.
 * @param {import('@playwright/test').Page} page
 * @param {{ settings?: typeof OWNER | null, site?: typeof SITE | null, net?: { off: boolean }, panel?: string,
 *   onPv?: (route: import('@playwright/test').Route) => unknown }} [opts]
 */
async function openStat(page, { settings = OWNER, site = null, net = { off: false }, panel = 'statistika', onPv } = {}) {
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (msg) => msg.type() === 'error' && !IGNORED_CONSOLE.test(msg.text()) && errors.push(msg.text()));
    await page.route(/cdnjs\.cloudflare\.com/, (route) => route.abort());
    await page.route(WORKER_PV_URL, onPv ?? ((route) => (net.off ? route.abort() : route.fulfill({ json: { pv } }))));
    await page.route(/api\.open-meteo\.com/, (route) => (net.off ? route.abort() : route.fulfill({ json: weather })));
    /** @param {string} key @param {string} value */
    const uloz = (key, value) => page.addInitScript(([k, v]) => localStorage.getItem(k) || localStorage.setItem(k, v), [key, value]);
    if (settings) await uloz(SETTINGS_STORAGE_KEY, JSON.stringify(toUser(settings)));
    if (site) await uloz(SITE_STORAGE_KEY, JSON.stringify(site));
    await uloz(DAYLOG_STORAGE_KEY, JSON.stringify(LOG));
    await uloz(LAUNCH_STORAGE_KEY, JSON.stringify(LAUNCHES));
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto('/obloha/');
    await expect(page.locator('#page')).toHaveAttribute('data-panel', /.+/);
    await page.locator(`#nav-${panel}`).click();
    await expect(page.locator(`#panel-${panel}`)).toBeVisible();
    return errors;
}

/**
 * Vstup modelu tak, ako ho skladá appka: nastavenie, meranie a predpoveď z fixtures v pevnom
 * čase a denník, do ktorého appka po načítaní zapísala dnešok z merania.
 * @param {object} [extra]
 */
const vstup = (extra = {}) => ({
    ...OWNER,
    now: FIXED_NOW,
    loading: false,
    known: /** @type {import('../../shared/settings.js').Known} */ ('elektraren'),
    pv,
    forecast: buildForecast(weather, FIXED_NOW, SITE, PLANT),
    dayLog: recordDay(LOG, '2026-09-05', localMinutes(FIXED_NOW, SITE.timezone), pv.dailyEnergyKwh),
    launches: LAUNCHES,
    ...extra,
});

/** Čo karta ukazuje. @param {import('@playwright/test').Page} page */
const kartaVStranke = (page) =>
    page.evaluate(() => {
        const text = (/** @type {string} */ id) => document.getElementById(id)?.textContent ?? '';
        const visible = (/** @type {string} */ id) => !document.getElementById(id)?.closest('.hidden');
        return {
            num: text('st-num-val'),
            src: text('st-src'),
            value: visible('st-value') ? text('st-value') : null,
            progress: visible('st-progress') ? text('st-progress-text') : null,
            equiv: visible('st-equiv') ? [text('st-phones'), text('st-km')] : null,
            rows: [...document.querySelectorAll('#st-rows p')].map((p) => p.textContent),
            best: visible('st-best') ? text('st-best-text') : null,
            posters: [...document.querySelectorAll('#st-posters [data-poster]')].map((b) => b.textContent),
        };
    });

/** To isté z modelu. @param {ReturnType<typeof statistikaModel>} m */
const kartaZModelu = (m) => ({
    num: kwhText(m.hero?.kwh ?? null),
    src: m.hero?.sub ?? '',
    value: m.value,
    progress: m.progress?.text ?? null,
    equiv: m.equiv && [m.equiv.phones, m.equiv.km],
    rows: m.rows.map((r) => `${r.name}${kwhText(r.kwh)} kWh`),
    best: m.best?.text ?? null,
    posters: m.posters.map((p) => p.label),
});

/** Čo ukazuje plagát. @param {import('@playwright/test').Page} page */
const plagatVStranke = (page) =>
    page.evaluate(() => ({
        title: document.getElementById('poster-title')?.textContent,
        kwh: document.getElementById('poster-kwh')?.textContent,
        cols: [...document.querySelectorAll('#poster-cols i')].map((i) =>
            i.classList.contains('missing') ? null : i.getAttribute('style'),
        ),
        tiles: [...document.querySelectorAll('#poster-tiles p')].map((p) => p.textContent),
        note: document.getElementById('poster-note')?.closest('.hidden') ? '' : document.getElementById('poster-note')?.textContent,
    }));

/** @param {NonNullable<ReturnType<typeof posterModel>>} m */
const plagatZModelu = (m) => ({
    title: m.title,
    kwh: m.kwh,
    cols: m.cols.map((c) => (c.h === null ? null : `height:${c.h}%`)),
    tiles: m.tiles.map((t) => `${t.value}${t.label}`),
    note: m.note,
});

/** Závažné a kritické nálezy axe v celej stránke. @param {import('@playwright/test').Page} page @returns {Promise<string[]>} */
const vazneNalezy = async (page) =>
    (await new AxeBuilder({ page }).analyze()).violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);

test.describe('karta Štatistika', () => {
    test('každé obdobie: veľké číslo, odkiaľ je, „to je ako“ a ostatné riadky ako statistikaModel', async ({ page }) => {
        const errors = await openStat(page);
        await expect(page.locator('#st-sub')).toHaveText(kwpText(10.44));
        for (const period of STATS_PERIODS) {
            await page.locator(`#st-seg [data-period="${period}"]`).click();
            await expect(page.locator(`#st-seg [data-period="${period}"]`)).toHaveAttribute('aria-pressed', 'true');
            await expect(page.locator('#st-seg [aria-pressed="true"]')).toHaveCount(1);
            await expect.poll(() => kartaVStranke(page), period).toEqual(kartaZModelu(statistikaModel(vstup(), period)));
        }
        await expect(page.locator('#st-note')).toHaveText(STATISTIKA_TEXTS.note);
        await expect(page.locator('#st-measure, #st-prices, #st-measure-off')).toHaveCount(3);
        for (const id of ['#st-measure', '#st-prices', '#st-measure-off']) await expect(page.locator(id)).toBeHidden();
        // Prepínač: štyri tlačidlá aspoň 44 px vysoké.
        const heights = await page.locator('#st-seg button').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
        expect(heights).toHaveLength(4);
        for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
        expect(errors).toEqual([]);
    });

    test('dnes: pás voči predpovedi a najlepší deň mesiaca z denníka', async ({ page }) => {
        await openStat(page);
        const m = statistikaModel(vstup(), 'dnes');
        await expect(page.locator('#st-progress-text')).toHaveText(/** @type {string} */ (m.progress?.text));
        expect(await page.locator('#st-bar').evaluate((el) => el.style.width)).toBe(`${m.progress?.pct}%`);
        await expect(page.locator('#st-best-title')).toHaveText('Najlepší deň septembra');
        await expect(page.locator('#st-best-text')).toHaveText('Streda 2. · 52,1 kWh. Strecha vtedy makala ako blázon.');
    });

    test('bez merania (kiosk nie je): dnešok z predpovede ako odhad, bez prepínača a výzva pripojiť meranie', async ({ page }) => {
        const errors = await openStat(page, { settings: { ...OWNER, kiosk: '' } });
        const m = statistikaModel(vstup({ kiosk: '', pv: null }), 'dnes');
        await expect.poll(() => kartaVStranke(page)).toEqual(kartaZModelu(m));
        await expect(page.locator('#st-src')).toHaveText('odhad z predpovede na celý dnešok');
        await expect(page.locator('#st-num')).toHaveClass(/\best\b/);
        await expect(page.locator('#st-seg')).toBeHidden();
        await expect(page.locator('#st-rows')).toBeHidden();
        await expect(page.locator('#st-posters')).toBeHidden();
        await expect(page.locator('#st-measure-title')).toHaveText(STATISTIKA_TEXTS.measureTitle);
        await page.locator('#st-measure-btn').click();
        await expect(page.locator('#panel-nastavenie')).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('meranie neodpovedá: dnešok z predpovede a veta namiesto výzvy', async ({ page }) => {
        await openStat(page, { onPv: (route) => route.abort() });
        await expect(page.locator('#st-measure-off')).toHaveText(STATISTIKA_TEXTS.measureOff);
        await expect(page.locator('#st-measure')).toBeHidden();
        await expect(page.locator('#st-src')).toHaveText(STATISTIKA_TEXTS.forecastSub);
    });

    test('bez cien v tarife: len kWh a výzva doplniť ceny', async ({ page }) => {
        await openStat(page, { settings: { ...OWNER, tariff: TARIFF } });
        await expect.poll(() => kartaVStranke(page)).toEqual(kartaZModelu(statistikaModel(vstup({ tariff: TARIFF }), 'dnes')));
        await expect(page.locator('#st-value')).toBeHidden();
        await expect(page.locator('#st-note')).toBeHidden();
        await expect(page.locator('#st-prices-title')).toHaveText(STATISTIKA_TEXTS.pricesTitle);
        await page.locator('#st-prices-btn').click();
        await expect(page.locator('#panel-nastavenie')).toBeVisible();
    });

    test('bez dát: veta s príčinou, Skúsiť znova a po ňom s dátami čísla', async ({ page }) => {
        const net = { off: true };
        const errors = await openStat(page, { net });
        await expect(page.locator('#st-sub')).toHaveText(statistikaModel(vstup({ pv: null, forecast: null }), 'dnes').sub);
        await expect(page.locator('#st-retry')).toHaveText(STATISTIKA_TEXTS.retry);
        await expect(page.locator('#st-body')).toBeHidden();
        net.off = false;
        await page.locator('#st-retry').click();
        await expect(page.locator('#st-retry')).toBeHidden();
        await expect(page.locator('#st-num-val')).toHaveText(kwhText(pv.dailyEnergyKwh));
        expect(errors).toEqual([]);
    });

    test('načítavanie: pokojný stav bez chybovej hlášky a bez Skúsiť znova', async ({ page }) => {
        /** @type {Array<() => void>} */ const cakaju = [];
        await openStat(page, {
            onPv: (route) => new Promise((done) => cakaju.push(() => done(route.fulfill({ json: { pv } })))),
        });
        await expect(page.locator('#st-sub')).toHaveText(STATISTIKA_TEXTS.loading);
        await expect(page.locator('#st-retry')).toBeHidden();
        await expect(page.locator('#st-body')).toBeHidden();
        cakaju.forEach((f) => f());
        await expect(page.locator('#st-num-val')).toHaveText(kwhText(pv.dailyEnergyKwh));
    });

    test('poloha bez panelov: biela výzva, tlačidlo trikrát zapulzuje, plagát nie je; súčasná appka ostáva', async ({ page }) => {
        const errors = await openStat(page, { settings: null, site: SITE });
        await expect(page.locator('#st-sub')).toHaveText(STATISTIKA_TEXTS.setupSub);
        await expect(page.locator('#st-setup-title')).toHaveText(STATISTIKA_TEXTS.setupTitle);
        await expect(page.locator('#st-later-title')).toHaveText(STATISTIKA_TEXTS.laterTitle);
        await expect(page.locator('#st-body')).toBeHidden();
        await expect(page.locator('#st-posters [data-poster]')).toHaveCount(0);
        expect(await page.locator('#st-setup .cta').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
        /** Animácie tlačidla: meno a počet opakovaní. */
        const pulz = () =>
            page.locator('#st-setup-btn').evaluate((el) =>
                el.getAnimations().map((a) => ({
                    name: /** @type {CSSAnimation} */ (a).animationName,
                    iterations: a.effect?.getComputedTiming().iterations,
                })),
            );
        expect(await pulz()).toEqual([{ name: 'pulse', iterations: 3 }]);
        // Po treťom pulze sa zastaví a pri ďalšom vstupe na kartu zapulzuje znova.
        await expect.poll(pulz, { timeout: 6000 }).toEqual([]);
        await page.locator('#nav-mozem').click();
        await page.locator('#nav-statistika').click();
        expect(await pulz()).toEqual([{ name: 'pulse', iterations: 3 }]);
        await page.locator('#st-setup-btn').click();
        await expect(page.locator('#panel-nastavenie')).toBeVisible();

        // Súčasná appka v tom istom stave: Štatistika ako doteraz, s výzvou nastaviť panely.
        await page.goto('/');
        await expect(page.locator('#pv-updated')).not.toHaveText('načítavam…');
        await page.locator('#nav-statistika').click();
        await expect(page.locator('#stats-body')).toContainText('Nastav si svoje panely');
        expect(errors).toEqual([]);
    });

    test('poloha bez panelov pri útlme pohybu: tlačidlo nepulzuje vôbec', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await openStat(page, { settings: null, site: SITE });
        expect(await page.locator('#st-setup-btn').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
        expect(await page.locator('#st-setup-btn').evaluate((el) => el.getAnimations().length)).toBe(0);
    });

    test('nič nezadané: krátka výzva zadať polohu a tlačidlo do Nastavenia', async ({ page }) => {
        await openStat(page, { settings: null });
        await expect(page.locator('#st-ask-title')).toHaveText(STATISTIKA_TEXTS.askTitle);
        await expect(page.locator('#st-body')).toBeHidden();
        await expect(page.locator('#st-setup')).toBeHidden();
        await page.locator('#st-ask-btn').click();
        await expect(page.locator('#panel-nastavenie')).toBeVisible();
    });
});

test.describe('plagát na zdieľanie', () => {
    test('mesiac aj týždeň: čísla ako posterModel, chýbajúce dni povedané', async ({ page }) => {
        const errors = await openStat(page);
        for (const period of /** @type {const} */ (['mesiac', 'tyzden'])) {
            await page.locator(`[data-poster="${period}"]`).click();
            await expect(page.locator('#poster')).toBeVisible();
            const m = /** @type {NonNullable<ReturnType<typeof posterModel>>} */ (posterModel(vstup(), period));
            expect(await plagatVStranke(page)).toEqual(plagatZModelu(m));
            expect(m.note, 'v denníku chýbajú dni - plagát to musí povedať').not.toBe('');
            await expect(page.locator('#poster-foot')).toHaveText('RAY-MON · slnko nefakturuje');
            expect(m.tiles.map((t) => t.label)).toContain('pranie zo slnka');
            await page.locator('#poster-close').click();
            await expect(page.locator('#poster')).toBeHidden();
            await expect(page.locator(`[data-poster="${period}"]`)).toBeFocused();
        }
        expect(await plagatZModelu(/** @type {any} */ (posterModel(vstup(), 'tyzden'))).cols).toHaveLength(7);
        expect(errors).toEqual([]);
    });

    test('Zavrieť, Escape aj Späť plagát zatvoria a fokus sa vráti na tlačidlo', async ({ page }) => {
        await openStat(page);
        const btn = page.locator('[data-poster="mesiac"]');
        await btn.click();
        await expect(page.locator('#poster')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#poster')).toBeHidden();
        await expect(btn).toBeFocused();
        await btn.click();
        await expect(page.locator('#poster')).toBeVisible();
        await page.goBack();
        await expect(page.locator('#poster')).toBeHidden();
        await expect(btn).toBeFocused();
        await expect(page.locator('#panel-statistika')).toBeVisible();
        // Zatvorenie bol krok späť - ďalšie Späť vedie z karty preč, plagát sa neotvorí znova.
        await page.goBack();
        await expect(page.locator('#panel-mozem')).toBeVisible();
        await expect(page.locator('#poster')).toBeHidden();
    });

    test('odkaz na karte Môžem? otvorí ten istý plagát mesiaca', async ({ page }) => {
        const errors = await openStat(page, { panel: 'mozem' });
        const m = /** @type {NonNullable<ReturnType<typeof posterModel>>} */ (posterModel(vstup(), 'mesiac'));
        await expect(page.locator('#mz-summary-text')).toHaveText(posterLinkText(m.kick, m.total));
        await page.locator('#mz-summary').click();
        await expect(page.locator('#poster')).toBeVisible();
        expect(await plagatVStranke(page)).toEqual(plagatZModelu(m));
        await page.locator('#poster-close').click();
        await expect(page.locator('#mz-summary')).toBeFocused();
        expect(errors).toEqual([]);
    });

    test('bez merania odkaz na Môžem? ani tlačidlá plagátu nie sú', async ({ page }) => {
        await openStat(page, { settings: { ...OWNER, kiosk: '' }, panel: 'mozem' });
        await expect(page.locator('#mz-word')).not.toHaveText('');
        await expect(page.locator('#mz-summary')).toBeHidden();
    });

    test('Zdieľať do story pošle systému obrázok 1080 × 1920', async ({ page }) => {
        await page.addInitScript(() => {
            /** @type {any} */ const w = window;
            w.zdielane = null;
            navigator.canShare = () => true;
            navigator.share = async (/** @type {any} */ data) => {
                const f = data.files[0];
                const img = await createImageBitmap(f);
                w.zdielane = { name: f.name, type: f.type, size: f.size, width: img.width, height: img.height };
            };
        });
        const errors = await openStat(page);
        await page.locator('[data-poster="tyzden"]').click();
        await page.locator('#poster-share').click();
        await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).zdielane?.name)).toBe('ray-mon-tyzden.png');
        const shared = await page.evaluate(() => /** @type {any} */ (window).zdielane);
        expect(shared).toMatchObject({ type: 'image/png', width: 1080, height: 1920 });
        expect(shared.size, 'obrázok nie je prázdny').toBeGreaterThan(10000);
        expect(errors).toEqual([]);
    });

    test('bez zdieľania súborov (počítač) sa obrázok 1080 × 1920 stiahne', async ({ page }) => {
        await page.addInitScript(() => {
            /** @type {any} */ (navigator).canShare = undefined;
        });
        await openStat(page);
        await page.locator('[data-poster="mesiac"]').click();
        const download = page.waitForEvent('download');
        await page.locator('#poster-share').click();
        const file = await download;
        expect(file.suggestedFilename()).toBe('ray-mon-mesiac.png');
        const png = await page.evaluate(
            async (url) => {
                const img = await createImageBitmap(await (await fetch(url)).blob());
                return { width: img.width, height: img.height };
            },
            `data:image/png;base64,${(await import('node:fs')).readFileSync(/** @type {string} */ (await file.path())).toString('base64')}`,
        );
        expect(png).toEqual({ width: 1080, height: 1920 });
    });

    test('prístupnosť: žiadne závažné nálezy axe na karte ani s otvoreným plagátom', async ({ page }) => {
        await openStat(page);
        expect(await vazneNalezy(page), 'karta').toEqual([]);
        await page.locator('[data-poster="mesiac"]').click();
        await expect(page.locator('#poster')).toBeVisible();
        expect(await vazneNalezy(page), 'plagát').toEqual([]);
        await openStat(page, { settings: { ...OWNER, kiosk: '', tariff: TARIFF } });
        expect(await vazneNalezy(page), 'bez merania a bez cien').toEqual([]);
        await openStat(page, { settings: null, site: SITE });
        expect(await vazneNalezy(page), 'bez panelov').toEqual([]);
    });
});
