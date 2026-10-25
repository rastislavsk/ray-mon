// E2E pre kartu Štatistika s plagátom obdobia v novej appke „Živá obloha“ (obloha/). Pevný čas,
// dáta z fixtures a očakávané hodnoty počítané tou istou funkciou (shared/statistika.js), ktorú
// volá appka - test tak odhalí rozdiel medzi modelom a tým, čo je naozaj v DOM.
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { DAYLOG_STORAGE_KEY, PLANT, SETTINGS_STORAGE_KEY, SITE, SITE_STORAGE_KEY, TARIFF, WORKER_PV_URL } from '../../shared/config.js';
import { recordDay } from '../../shared/daylog.js';
import { kwpText } from '../../shared/format.js';
import { STATISTIKA_TEXTS } from '../../shared/messages.js';
import { toUser } from '../../shared/settings.js';
import { buildForecast, localMinutes } from '../../shared/solar.js';
import { STATS_PERIODS } from '../../shared/stats.js';
import { doplnSucty, suctyZdroj } from '../../shared/sucty.js';
import { statistikaModel } from '../../shared/statistika.js';
import { bigText } from '../../shared/summary.js';
import { FIXED_NOW, fixture, fixtureData } from '../helpers.js';

const { pv } = fixtureData();
const weather = fixture('open-meteo.json');
/** Pripojené meranie v testoch: zapečatený prístup ku kiosku, Worker naň odpovedá nameraným pv z fixtures. */
const TEST_ZDROJ = { sposob: 'huawei-kiosk', pecat: 'v1.TestPecat0123456789abcdefgh', nazov: 'Dvorany' };
const IGNORED_CONSOLE = /Failed to load resource|net::ERR_FAILED/;
/** Tarifa Dvorian s cenami: NT lacné, VT drahé. */
const PRICED = { ...TARIFF, bands: TARIFF.bands.map((b) => ({ ...b, price: b.id === 'nt' ? 0.14 : 0.19 })) };
const OWNER = { site: SITE, plant: PLANT, tariff: PRICED, zdroj: TEST_ZDROJ };
/** Denník výroby: tri dni septembra (3. chýba) a jeden augustový. */
const LOG = { '2026-08-31': 30, '2026-09-01': 38.2, '2026-09-02': 52.1, '2026-09-04': 41.7 };

/**
 * Otvorí novú appku s pevným časom, uloženým nastavením a denníkom. `net.off`
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
    ...extra,
});

/** Čo ukazuje plagát na karte. @param {import('@playwright/test').Page} page */
const plagatVStranke = (page) =>
    page.evaluate(() => {
        const pc = /** @type {HTMLElement} */ (document.getElementById('st-poster'));
        return {
            shown: !pc.closest('.hidden'),
            heading: pc.querySelector('h2')?.textContent ?? '',
            big: pc.querySelector('.pn')?.textContent ?? '',
            rows: [...pc.querySelectorAll('.prow span')].map((s) => s.textContent),
            note: pc.querySelector('.pnote')?.textContent ?? '',
        };
    });

/** To isté z modelu. @param {ReturnType<typeof statistikaModel>} m */
const plagatZModelu = (m) => {
    const s = /** @type {NonNullable<typeof m.summary>} */ (m.summary);
    return { shown: true, heading: s.heading, big: `${s.big} kWh`, rows: s.rows.map((r) => r.t + r.s), note: s.note };
};

/** Závažné a kritické nálezy axe v celej stránke. @param {import('@playwright/test').Page} page @returns {Promise<string[]>} */
const vazneNalezy = async (page) =>
    (await new AxeBuilder({ page }).analyze()).violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);

test.describe('karta Štatistika', () => {
    test('každé obdobie: plagát ako statistikaModel, obrázok obdobia a prepínač na plagáte', async ({ page }) => {
        const errors = await openStat(page);
        await expect(page.locator('#st-sub')).toHaveText(kwpText(10.44));
        for (const period of STATS_PERIODS) {
            const btn = page.locator(`#st-poster [data-period="${period}"]`);
            await btn.click();
            await expect(btn).toHaveAttribute('aria-pressed', 'true');
            await expect(btn, 'fokus ostane na prepínači aj po prekreslení plagátu').toBeFocused();
            await expect(page.locator('#st-poster [aria-pressed="true"]')).toHaveCount(1);
            await expect.poll(() => plagatVStranke(page), period).toEqual(plagatZModelu(statistikaModel(vstup(), period)));
            // Veľké číslo v jednom riadku v karte (ročné „9 112 kWh“ je dlhšie).
            const preteka = await page.locator('#st-poster .pn').evaluate((el) => el.scrollWidth > el.clientWidth);
            expect(preteka, `${period}: veľké číslo pretečie kartu`).toBe(false);
        }
        await page.locator('#st-poster [data-period="dnes"]').click();
        await expect(page.locator('#st-poster .pmeter p')).toContainText('z predpovede');
        await page.locator('#st-poster [data-period="mesiac"]').click();
        await expect(page.locator('#st-poster .pcal i')).toHaveCount(30);
        await expect(page.locator('#st-poster .pcal i.missing'), '3. september v denníku chýba').toHaveCount(1);
        await page.locator('#st-poster [data-period="rok"]').click();
        await expect(page.locator('#st-poster .cols span')).toHaveCount(12);
        await page.locator('#st-poster [data-period="spolu"]').click();
        await expect(page.locator('#st-poster .pmeter p')).toContainText('uhlík z výroby panelov');
        for (const id of ['#st-measure', '#st-prices', '#st-measure-off']) await expect(page.locator(id)).toBeHidden();
        await expect(page.locator('#poster, #st-posters'), 'plagát v dialógu ani zdieľanie do story nie je').toHaveCount(0);
        // Prepínač: štyri tlačidlá aspoň 44 px vysoké.
        const heights = await page
            .locator('#st-poster [data-period]')
            .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
        expect(heights).toHaveLength(4);
        for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
        expect(errors).toEqual([]);
    });

    test('bez merania (kiosk nie je): sivý plagát dneška z predpovede, ostatné obdobia nejdú, výzva pripojiť meranie', async ({ page }) => {
        const errors = await openStat(page, { settings: { ...OWNER, zdroj: null } });
        const m = statistikaModel(vstup({ zdroj: null, pv: null }), 'mesiac');
        expect(m.summary?.kind).toBe('estimate');
        await expect.poll(() => plagatVStranke(page)).toEqual(plagatZModelu(m));
        await expect(page.locator('#st-poster')).toHaveClass(/\best\b/);
        await expect(page.locator('#st-poster .pn')).toHaveClass(/\best\b/);
        await expect(page.locator('#st-poster [data-period="dnes"]')).toHaveAttribute('aria-pressed', 'true');
        for (const p of ['mesiac', 'rok', 'spolu']) await expect(page.locator(`#st-poster [data-period="${p}"]`)).toBeDisabled();
        await expect(page.locator('#st-measure-title')).toHaveText(STATISTIKA_TEXTS.measureTitle);
        await page.locator('#st-measure-btn').click();
        await expect(page.locator('#panel-nastavenie')).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('meranie neodpovedá: dnešok z predpovede a veta namiesto výzvy', async ({ page }) => {
        await openStat(page, { onPv: (route) => route.abort() });
        await expect(page.locator('#st-measure-off')).toHaveText(STATISTIKA_TEXTS.measureOff);
        await expect(page.locator('#st-measure')).toBeHidden();
        await expect(page.locator('#st-poster h2')).toHaveText('Dnes podľa predpovede');
    });

    test('bez cien v tarife: bez hodnoty a výzva doplniť ceny', async ({ page }) => {
        await openStat(page, { settings: { ...OWNER, tariff: TARIFF } });
        const m = statistikaModel(vstup({ tariff: TARIFF }), 'dnes');
        await expect.poll(() => plagatVStranke(page)).toEqual(plagatZModelu(m));
        expect(m.summary?.rows.some((r) => r.t.startsWith('Hodnota'))).toBe(false);
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
        await expect(page.locator('#st-poster .pn')).toHaveText(`${bigText(pv.dailyEnergyKwh)} kWh`);
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
        await expect(page.locator('#st-poster .pn')).toHaveText(`${bigText(pv.dailyEnergyKwh)} kWh`);
    });

    test('poloha bez panelov: biela výzva, tlačidlo trikrát zapulzuje, plagát nie je; súčasná appka ostáva', async ({ page }) => {
        const errors = await openStat(page, { settings: null, site: SITE });
        await expect(page.locator('#st-sub')).toHaveText(STATISTIKA_TEXTS.setupSub);
        await expect(page.locator('#st-setup-title')).toHaveText(STATISTIKA_TEXTS.setupTitle);
        await expect(page.locator('#st-later-title')).toHaveText(STATISTIKA_TEXTS.laterTitle);
        await expect(page.locator('#st-body')).toBeHidden();
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

        // Súčasná appka v tom istom stave: Štatistika s výzvou nastaviť panely.
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

    test('prístupnosť: žiadne závažné nálezy axe na karte, bez merania ani bez panelov', async ({ page }) => {
        await openStat(page);
        expect(await vazneNalezy(page), 'karta').toEqual([]);
        await openStat(page, { settings: { ...OWNER, zdroj: null, tariff: TARIFF } });
        expect(await vazneNalezy(page), 'bez merania a bez cien').toEqual([]);
        await openStat(page, { settings: null, site: SITE });
        expect(await vazneNalezy(page), 'bez panelov').toEqual([]);
    });
});

test.describe('súčty, ktoré výrobca neposiela', () => {
    test('Fox ESS bez roka: rok od prvého merania v nadpise plagátu aj vo vete pod ním', async ({ page }) => {
        const FOX = { ...TEST_ZDROJ, sposob: 'foxess-kluc' };
        const surove = { ...pv, yearEnergyKwh: null };
        const errors = await openStat(page, {
            settings: { ...OWNER, zdroj: FOX },
            onPv: (route) => route.fulfill({ json: { pv: surove } }),
        });
        const doplnene = doplnSucty(null, suctyZdroj(FOX), surove, '2026-09-05', '13:00').pv;
        const v = vstup({ zdroj: FOX, pv: doplnene });
        for (const period of STATS_PERIODS) {
            await page.locator(`#st-poster [data-period="${period}"]`).click();
            await expect.poll(() => plagatVStranke(page), period).toEqual(plagatZModelu(statistikaModel(v, period)));
        }
        await page.locator('#st-poster [data-period="rok"]').click();
        await expect(page.locator('#st-poster h2')).toHaveText('Rok 2026 na streche od 5. 9.');
        await expect(page.locator('#st-poster .pnote')).toContainText(
            'Fox ESS neposiela súčet za rok. Rátam ho sám z celkovej výroby, zatiaľ od 5. 9. – skôr som meranie nemal.',
        );
        expect(errors).toEqual([]);
    });

    test('kiosk so všetkými súčtami: žiadne „od“ ani veta', async ({ page }) => {
        await openStat(page);
        await page.locator('#st-poster [data-period="rok"]').click();
        await expect(page.locator('#st-poster h2')).toHaveText('Rok 2026 na streche');
        await expect(page.locator('#st-poster .pnote')).not.toContainText('neposiela súčet');
    });
});
