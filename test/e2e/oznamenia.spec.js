// E2E: Nastavenie › Oznámenia. Push sa v testovacom prehliadači naozaj prihlásiť
// nedá (nemá push službu), testy preto overujú voľby, ich uloženie, Plán dňa podľa spotrebičov doma,
// hlášky, keď sa oznámenia zapnúť nedajú, a že service worker sa zaregistruje (jeho importy sedia).
import { expect, test } from '@playwright/test';
import {
    DOMA_STORAGE_KEY,
    OZNAMENIA,
    OZNAMENIA_STORAGE_KEY,
    PLANT,
    REFRESH,
    SETTINGS_STORAGE_KEY,
    SITE,
    TARIFF,
    WORKER_OZNAMENIA_URL,
    WORKER_PV_URL,
} from '../../shared/config.js';
import { oznameniaTexts } from '../../shared/messages.js';
import { planDnaModel } from '../../shared/plan-dna.js';
import { toUser } from '../../shared/settings.js';
import { buildForecast } from '../../shared/solar.js';
import { FIXED_NOW, fixture, fixtureData } from '../helpers.js';

const weather = fixture('open-meteo.json');
const { pv } = fixtureData();
const OWNER = {
    site: SITE,
    plant: PLANT,
    tariff: TARIFF,
    zdroj: { sposob: 'huawei-kiosk', pecat: 'v1.TestPecat0123456789abcdefgh', nazov: 'Dvorany' },
};
const T = oznameniaTexts();

/**
 * @param {import('@playwright/test').Page} page
 * @param {NotificationPermission} [permission] stav povolenia pri štarte
 * @param {NotificationPermission} [answer] čo človek odpovie na otázku (`default` = otázku zavrel)
 * @param {{ adresa?: string, predpoved?: Promise<unknown> }} [o] adresa appky a na čo čaká predpoveď
 */
async function otvor(
    page,
    permission = 'default',
    answer = permission === 'granted' ? 'granted' : 'denied',
    { adresa = '/', predpoved } = {},
) {
    // Prehliadač bez okna má oznámenia vždy zakázané - stav povolenia aj odpoveď na otázku podvrhne test.
    await page.addInitScript(
        ([p, a]) => {
            Object.defineProperty(Notification, 'permission', { get: () => p });
            Notification.requestPermission = async () => a;
        },
        [permission, answer],
    );
    await page.route(/cdnjs\.cloudflare\.com/, (r) => r.abort());
    await page.route(WORKER_PV_URL, (r) => r.fulfill({ json: { pv } }));
    await page.route(WORKER_OZNAMENIA_URL, (r) => r.fulfill({ json: { ok: true } }));
    await page.route(/api\.open-meteo\.com/, async (r) => {
        await predpoved;
        await r.fulfill({ json: weather });
    });
    await page.addInitScript(
        ([k, v]) => localStorage.getItem(k) || localStorage.setItem(k, v),
        [SETTINGS_STORAGE_KEY, JSON.stringify(toUser(OWNER))],
    );
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto(adresa);
    await expect(page.locator('#page')).toHaveAttribute('data-panel', /.+/);
}

/** Uložená voľba oznámení. @param {import('@playwright/test').Page} page */
const ulozene = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), OZNAMENIA_STORAGE_KEY);
/** Uložené spotrebiče doma. @param {import('@playwright/test').Page} page */
const doma = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), DOMA_STORAGE_KEY);

/** Plán dňa, ako ho appka počíta so spotrebičmi doma. @param {string[]} devices */
const plan = (devices) =>
    planDnaModel({ ...OWNER, now: FIXED_NOW, loading: false, pv, forecast: buildForecast(weather, FIXED_NOW, SITE, PLANT) }, { devices });

/**
 * Zaregistruje service worker a počká na neho.
 * @param {import('@playwright/test').Page} page @param {string} [skript] @param {string} [rozsah]
 */
async function sluzba(page, skript = '/sw.js', rozsah = '/') {
    await page.evaluate(
        async ([s, r]) => {
            const reg = await navigator.serviceWorker.register(s, { type: 'module', updateViaCache: 'none', scope: r });
            const sw = /** @type {ServiceWorker} */ (reg.active ?? reg.installing ?? reg.waiting);
            await new Promise((ok) =>
                sw.state === 'activated' ? ok(null) : sw.addEventListener('statechange', () => sw.state === 'activated' && ok(null)),
            );
        },
        [skript, rozsah],
    );
    await expect
        .poll(() =>
            page
                .context()
                .serviceWorkers()
                .some((w) => w.url().endsWith(skript)),
        )
        .toBe(true);
    return /** @type {import('@playwright/test').Worker} */ (
        page
            .context()
            .serviceWorkers()
            .find((w) => w.url().endsWith(skript))
    );
}

/**
 * Ťuknutie na oznámenie v service workeri. Skutočný notificationclick z testu nejde a prehliadač
 * bez ťuknutia focus aj openWindow odmietne - tie dve volania sú preto len zapísané. Správa oknu je
 * skutočná. Na telefóne to treba overiť ručne.
 * @param {import('@playwright/test').Worker} sw @returns {Promise<string[][]>} zavolané focus a openWindow
 */
const tukni = (sw) =>
    sw.evaluate(async () => {
        const glob = /** @type {any} */ (self);
        /** @type {string[][]} */ const volania = [];
        Object.defineProperty(glob.clients, 'openWindow', {
            configurable: true,
            value: async (/** @type {string} */ url) => void volania.push(['openWindow', url]),
        });
        glob.WindowClient.prototype.focus = async function () {
            volania.push(['focus']);
            return this;
        };
        /** @type {Promise<unknown> | undefined} */ let hotovo;
        const e = Object.assign(new Event('notificationclick'), {
            action: '',
            notification: { data: { app: './' }, close() {} },
            waitUntil: (/** @type {Promise<unknown>} */ p) => (hotovo = p),
        });
        glob.dispatchEvent(e);
        await hotovo;
        return volania;
    });

/** Zapisuje mená CSS animácií, ktoré sa v stránke spustili. @param {import('@playwright/test').Page} page */
const sledujAnimacie = (page) =>
    page.addInitScript(() => {
        const glob = /** @type {any} */ (window);
        glob.animacie = [];
        document.addEventListener('animationstart', (e) => glob.animacie.push(e.animationName), true);
    });
/** Koľkokrát obrys okolo toho, čo zapnúť, začal. @param {import('@playwright/test').Page} page */
const obrysov = (page) =>
    page.evaluate(() => /** @type {any} */ (window).animacie.filter((/** @type {string} */ a) => a === 'plan-obrys').length);

/** Karta na obrazovke. @param {import('@playwright/test').Page} page @param {string} panel */
async function ukazuje(page, panel) {
    await expect(page.locator('#page')).toHaveAttribute('data-panel', panel);
}

/** Obrys prebehol raz a zhasol. @param {import('@playwright/test').Page} page */
async function obrysPrebehol(page) {
    await expect.poll(() => obrysov(page)).toBe(1);
    await expect(page.locator('#tz-co')).not.toHaveAttribute('data-obrys');
}

test.describe('ťuknutie na oznámenie', () => {
    test('appka beží na inej karte: Teraz s obrysom okolo toho, čo zapnúť, Späť sa vráti na kartu', async ({ page }) => {
        await sledujAnimacie(page);
        await otvor(page);
        await expect(page.locator('#tz-co')).toBeVisible();
        const sw = await sluzba(page);
        await page.locator('#nav-mozem').click();
        await ukazuje(page, 'mozem');
        expect(await tukni(sw)).toEqual([['focus']]);
        await ukazuje(page, 'terazky');
        await expect(page.locator('#tz-co')).toBeVisible();
        await obrysPrebehol(page);
        await page.goBack();
        await ukazuje(page, 'mozem');
    });

    test('appka je zatvorená: adresa so značkou ukáže obrys, značka zmizne a obnovenie nič nezopakuje', async ({ page }) => {
        await sledujAnimacie(page);
        await otvor(page);
        const sw = await sluzba(page);
        await page.goto('about:blank');
        const [[volanie, adresa]] = await tukni(sw);
        expect(volanie).toBe('openWindow');
        await page.goto(adresa);
        await ukazuje(page, 'terazky');
        await obrysPrebehol(page);
        expect(new URL(page.url()).search).toBe('');
        await page.reload();
        await expect(page.locator('#tz-co')).toBeVisible();
        await ukazuje(page, 'terazky');
        expect(await obrysov(page)).toBe(0);
    });

    test('bežné otvorenie appky: bez obrysu', async ({ page }) => {
        await sledujAnimacie(page);
        await otvor(page);
        await expect(page.locator('#tz-co')).toBeVisible();
        await ukazuje(page, 'terazky');
        expect(await obrysov(page)).toBe(0);
    });

    test('útlm pohybu: obrys nie je vidieť', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await sledujAnimacie(page);
        await otvor(page, 'default', 'denied', { adresa: '/?z=oznamenie' });
        await expect(page.locator('#tz-co')).toBeVisible();
        await ukazuje(page, 'terazky');
        expect(await obrysov(page)).toBe(0);
        const obrys = await page.evaluate(
            () => getComputedStyle(/** @type {Element} */ (document.querySelector('#tz-co')), '::after').opacity,
        );
        expect(obrys).toBe('0');
    });

    test('dáta ešte nie sú: obrys počká, kým je čo zapnúť', async ({ page }) => {
        await sledujAnimacie(page);
        /** @type {(v?: unknown) => void} */ let pusti = () => {};
        const predpoved = new Promise((ok) => (pusti = ok));
        await otvor(page, 'default', 'denied', { adresa: '/?z=oznamenie', predpoved });
        await expect(page.locator('#tz-co')).toBeHidden();
        await ukazuje(page, 'terazky');
        expect(await obrysov(page)).toBe(0);
        pusti();
        await expect(page.locator('#tz-co')).toBeVisible();
        await obrysPrebehol(page);
    });

    test('čo zapnúť sa dlho neukáže: obrys prepadne a neskorá predpoveď ho nespustí', async ({ page }) => {
        await sledujAnimacie(page);
        /** @type {(v?: unknown) => void} */ let pusti = () => {};
        const predpoved = new Promise((ok) => (pusti = ok));
        await page.clock.install({ time: FIXED_NOW });
        await otvor(page, 'default', 'denied', { adresa: '/?z=oznamenie', predpoved });
        await expect(page.locator('#tz-co')).toHaveAttribute('data-obrys');
        await page.clock.fastForward(OZNAMENIA.obrysCakaMs);
        await expect(page.locator('#tz-co')).not.toHaveAttribute('data-obrys');
        // Prvá požiadavka medzitým vypršala, predpoveď príde s ďalšou obnovou dát.
        pusti();
        await page.clock.fastForward(REFRESH.dataMs);
        await expect(page.locator('#tz-co')).toBeVisible();
        expect(await obrysov(page)).toBe(0);
    });

    test('čo zapnúť mimo obrazovky: stránka sa k nemu posunie, riadok nad dlaždicami nad spodnú navigáciu', async ({ page }) => {
        await page.setViewportSize({ width: 360, height: 480 });
        await otvor(page);
        await expect(page.locator('#tz-co')).toBeVisible();
        const sw = await sluzba(page);
        // Stránka je nízka, blok by neodišiel celý - výšku dodá test.
        await page.evaluate(() => {
            document.body.style.paddingBottom = '1500px';
            window.scrollTo(0, document.documentElement.scrollHeight);
        });
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
        await expect(page.locator('#tz-co')).not.toBeInViewport();
        await tukni(sw);
        await expect(page.locator('#tz-oko')).toBeInViewport({ ratio: 1 });
        const hranice = await page.evaluate(() => [
            /** @type {Element} */ (document.querySelector('#tz-oko')).getBoundingClientRect().bottom,
            /** @type {Element} */ (document.querySelector('.tabs')).getBoundingClientRect().top,
        ]);
        expect(hranice[0]).toBeLessThanOrEqual(hranice[1]);
    });

    test('správa príde, kým je appka v pozadí: počká, kým je vidieť', async ({ page }) => {
        await sledujAnimacie(page);
        await page.addInitScript(() => {
            Object.defineProperty(document, 'hidden', { configurable: true, get: () => /** @type {any} */ (window).vPozadi === true });
        });
        await otvor(page);
        await expect(page.locator('#tz-co')).toBeVisible();
        const sw = await sluzba(page);
        await page.locator('#nav-mozem').click();
        await page.evaluate(() => /** @type {any} */ (window.vPozadi = true));
        await tukni(sw);
        await page.evaluate(() => navigator.serviceWorker.getRegistration());
        await ukazuje(page, 'mozem');
        await page.evaluate(() => {
            /** @type {any} */ (window).vPozadi = false;
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await ukazuje(page, 'terazky');
        await obrysPrebehol(page);
    });

    test('starý odber: správa dôjde do okna v koreni aj bez ovládania, adresa prežije presmerovanie', async ({ page }) => {
        await sledujAnimacie(page);
        await otvor(page);
        await expect(page.locator('#tz-co')).toBeVisible();
        const sw = await sluzba(page, '/obloha/sw.js', '/obloha/');
        await page.locator('#nav-mozem').click();
        expect(await tukni(sw)).toEqual([['focus']]);
        await ukazuje(page, 'terazky');
        await obrysPrebehol(page);
        await page.goto('/obloha/?z=oznamenie');
        await ukazuje(page, 'terazky');
        await expect(page).toHaveURL(/\/#nastavenie=/);
    });
});

test.describe('oznámenia', () => {
    test('sekcia Oznámenia: prepínač, hodina 9:00 predvolená a spotrebiče; voľba platí aj v Pláne dňa', async ({ page }) => {
        await otvor(page);
        await page.locator('#nav-nastavenie').click();
        await page.locator('#ns-fold-oznamenia').click();
        await expect(page.locator('#ns-oznam-title')).toHaveText(T.title);
        await expect(page.locator('#ns-oznam')).toHaveAttribute('aria-checked', 'false');
        await expect(page.locator('#ns-oznam-hour [aria-pressed="true"]')).toHaveText('9:00');
        await page.locator('#ns-oznam-hour [data-hour="8"]').click();
        await expect.poll(() => ulozene(page)).toEqual({ on: false, hour: 8 });
        await page.locator('#ns-fold-doma').click();
        await page.locator('#ns-doma [data-device="bojler"]').click();
        await expect(page.locator('#ns-doma [data-device="bojler"]')).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(() => doma(page)).toEqual({ devices: ['pracka', 'umyvacka', 'susicka', 'auto', 'bojler'] });
        await page.locator('#nav-terazky').click();
        const rows = plan(['pracka', 'umyvacka', 'susicka', 'auto', 'bojler'])?.rows ?? [];
        await expect(page.locator('#tz-co [data-vec]')).toHaveCount(rows.length);
        await expect(page.locator('#tz-co [data-vec="bojler"]')).toContainText('Bojler');
    });

    test('odmietnuté povolenie: prepínač vypnutý a hláška', async ({ page }) => {
        await otvor(page);
        await page.locator('#nav-nastavenie').click();
        await page.locator('#ns-fold-oznamenia').click();
        await page.locator('#ns-oznam').click();
        await expect(page.locator('#ns-oznam-stav')).toHaveText(T.stav.zakazane);
        await expect(page.locator('#ns-oznam')).toHaveAttribute('aria-checked', 'false');
    });
    test('povolené, ale bez push služby: service worker v koreni, zapnutie zlyhá s hláškou', async ({ page }) => {
        await otvor(page, 'granted');
        await page.locator('#nav-nastavenie').click();
        await page.locator('#ns-fold-oznamenia').click();
        await page.locator('#ns-oznam').click();
        await expect(page.locator('#ns-oznam-stav')).toHaveText(T.stav.chyba);
        await expect(page.locator('#ns-oznam')).toHaveAttribute('aria-checked', 'false');
        const regs = await page.evaluate(async () =>
            (await navigator.serviceWorker.getRegistrations()).map((r) => ({
                scope: new URL(r.scope).pathname,
                script: r.active ? new URL(r.active.scriptURL).pathname : null,
                state: r.active?.state ?? null,
            })),
        );
        expect(regs).toEqual([{ scope: '/', script: '/sw.js', state: 'activated' }]);
    });
    test('zavretá otázka na povolenie: žiadna hláška o zákaze, dá sa skúsiť znova', async ({ page }) => {
        await otvor(page, 'default', 'default');
        await page.locator('#nav-nastavenie').click();
        await page.locator('#ns-fold-oznamenia').click();
        await page.locator('#ns-oznam').click();
        await expect(page.locator('#ns-oznam')).toHaveAttribute('aria-checked', 'false');
        await expect(page.locator('#ns-oznam')).toBeEnabled();
        await expect(page.locator('#ns-oznam-stav')).toHaveText('');
    });

    test('zapnuté oznámenie bez odberu v telefóne sa pri štarte prepne na vypnuté', async ({ page }) => {
        await page.addInitScript(
            ([k, v]) => localStorage.setItem(k, v),
            [OZNAMENIA_STORAGE_KEY, JSON.stringify({ on: true, hour: 9, devices: ['pracka'] })],
        );
        await otvor(page, 'granted');
        await expect.poll(() => ulozene(page)).toEqual({ on: false, hour: 9 });
        // Spotrebiče zo staršej verzie sa presunuli do Čo máš doma.
        expect(await doma(page)).toEqual({ devices: ['pracka'] });
    });
    // Push tu oznámenie neukáže (prehliadač bez okna nedá povolenie oznámení), sw.js ale berie logo
    // z koreňa rozsahu - odber z čias, keď appka bývala v obloha/, ho musí nájsť aj tam.
    test('starý odber: service worker v obloha/ naštartuje a logo v jeho rozsahu leží', async ({ page }) => {
        await otvor(page);
        const stav = await page.evaluate(async () => {
            const reg = await navigator.serviceWorker.register('/obloha/sw.js', {
                type: 'module',
                updateViaCache: 'none',
                scope: '/obloha/',
            });
            const sw = /** @type {ServiceWorker} */ (reg.active ?? reg.installing ?? reg.waiting);
            await new Promise((r) =>
                sw.state === 'activated' ? r(null) : sw.addEventListener('statechange', () => sw.state === 'activated' && r(null)),
            );
            return sw.state;
        });
        expect(stav).toBe('activated');
        const res = await page.request.get('/obloha/icon-192.png');
        expect(res.status()).toBe(200);
        expect(res.headers()['content-type']).toBe('image/png');
    });

    test('logo pre oznámenie leží v koreni rozsahu service workera', async ({ page }) => {
        expect((await page.request.get('/icon-192.png')).status()).toBe(200);
        const manifest = await (await page.request.get('/manifest.webmanifest')).json();
        expect(manifest.icons[0].src).toBe('icon-192.png');
    });

    test('zrkadlo pre service worker: po vypnutí (zmazaná cache) a novom zapnutí sa zapíše znova', async ({ page }) => {
        await otvor(page);
        const zapisane = await page.evaluate(async () => {
            const m = await import('/web/oznamenia.js');
            const { OZNAMENIA } = await import('/shared/config.js');
            /** @type {Array<(s: any) => void>} */ const fns = [];
            let s = {
                site: { timezone: 'Europe/Bratislava' },
                plant: {},
                tariff: {},
                known: 'elektraren',
                oznamenia: { on: true, hour: 9 },
                doma: ['pracka'],
                voice: 'drzy',
            };
            const store = { get: () => s, subscribe: (/** @type {any} */ fn) => fns.push(fn) };
            const nastav = (/** @type {any} */ patch) => {
                s = { ...s, ...patch };
                fns.forEach((fn) => fn(s));
            };
            const precitaj = async () => (await (await caches.open(OZNAMENIA.cache)).match(OZNAMENIA.mirror))?.json() ?? null;
            const pockaj = () => new Promise((r) => setTimeout(r, 200));
            m.initOznamZrkadlo(store, './');
            await pockaj();
            const prve = await precitaj();
            nastav({ oznamenia: { ...s.oznamenia, on: false } });
            await caches.delete(OZNAMENIA.cache);
            nastav({ oznamenia: { ...s.oznamenia, on: true } });
            await pockaj();
            return { prve, druhe: await precitaj() };
        });
        expect(zapisane.prve?.devices).toEqual(['pracka']);
        expect(zapisane.prve?.hour).toBe(9);
        expect(zapisane.druhe).toEqual(zapisane.prve);
    });
});
