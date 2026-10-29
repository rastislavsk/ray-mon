// E2E: Nastavenie › Oznámenia v oboch appkách. Push sa v testovacom prehliadači naozaj prihlásiť
// nedá (nemá push službu), testy preto overujú voľby, ich uloženie, Plán dňa podľa spotrebičov doma,
// hlášky, keď sa oznámenia zapnúť nedajú, a že service worker sa zaregistruje (jeho importy sedia).
import { expect, test } from '@playwright/test';
import {
    DOMA_STORAGE_KEY,
    OZNAMENIA_STORAGE_KEY,
    PLANT,
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
 * @param {import('@playwright/test').Page} page @param {'sucasna' | 'obloha'} app
 * @param {NotificationPermission} [permission] stav povolenia pri štarte
 * @param {NotificationPermission} [answer] čo človek odpovie na otázku (`default` = otázku zavrel)
 */
async function otvor(page, app, permission = 'default', answer = permission === 'granted' ? 'granted' : 'denied') {
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
    await page.route(/api\.open-meteo\.com/, (r) => r.fulfill({ json: weather }));
    await page.addInitScript(
        ([k, v]) => localStorage.getItem(k) || localStorage.setItem(k, v),
        [SETTINGS_STORAGE_KEY, JSON.stringify(toUser(OWNER))],
    );
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto(app === 'sucasna' ? '/' : '/obloha/');
    await expect(page.locator('#page')).toHaveAttribute('data-panel', /.+/);
}

/** Uložená voľba oznámení. @param {import('@playwright/test').Page} page */
const ulozene = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), OZNAMENIA_STORAGE_KEY);
/** Uložené spotrebiče doma. @param {import('@playwright/test').Page} page */
const doma = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), DOMA_STORAGE_KEY);

/** Plán dňa, ako ho appka počíta so spotrebičmi doma. @param {string[]} devices */
const plan = (devices) =>
    planDnaModel({ ...OWNER, now: FIXED_NOW, loading: false, pv, forecast: buildForecast(weather, FIXED_NOW, SITE, PLANT) }, { devices });

test.describe('oznámenia: súčasná appka', () => {
    test('voľby v Nastavení: hodina a spotrebiče sa uložia a Plán dňa ráta len s tým, čo je doma', async ({ page }) => {
        await otvor(page, 'sucasna');
        await page.locator('#nav-nastavenie').click();
        await page.locator('#settings-oznamenia summary').click();
        await expect(page.locator('#oznam-title')).toHaveText(T.title);
        await expect(page.locator('#oznam-body [data-oznam-on]')).not.toBeChecked();
        await expect(page.locator('#oznam-body [data-oznam-hour="9"]')).toBeChecked();
        await expect(page.locator('#oznam-body')).toContainText(T.uses);
        await page.locator('#oznam-body [data-oznam-hour="7"]').check();
        await expect.poll(() => ulozene(page)).toEqual({ on: false, hour: 7 });
        await page.locator('#settings-doma summary').click();
        await page.locator('#doma-body [data-doma="auto"]').uncheck();
        await expect.poll(() => doma(page)).toEqual({ devices: ['pracka', 'umyvacka', 'susicka'] });
        await expect(page.locator('#doma-hint')).toHaveText('Práčka, umývačka a sušička');
        await page.locator('#nav-terazky').click();
        const rows = plan(['pracka', 'umyvacka', 'susicka'])?.rows ?? [];
        await expect(page.locator('.tz-plan-rows li')).toHaveText(
            rows.map((r, i) => `${String(i + 1).padStart(2, '0')}${r.name}${r.now ? 'teraz' : r.value}${r.why}`),
        );
        await expect(page.locator('.tz-plan-rows')).not.toContainText('Auto');
    });

    test('odmietnuté povolenie: prepínač ostane vypnutý a hláška povie prečo', async ({ page }) => {
        await otvor(page, 'sucasna');
        await page.locator('#nav-nastavenie').click();
        await page.locator('#settings-oznamenia summary').click();
        await page.locator('#oznam-body [data-oznam-on]').click();
        await expect(page.locator('#oznam-body .oznam-stav')).toHaveText(T.stav.zakazane);
        await expect(page.locator('#oznam-body [data-oznam-on]')).not.toBeChecked();
        expect((await ulozene(page)).on).toBe(false);
    });

    test('povolené, ale bez push služby: service worker sa zaregistruje, zapnutie zlyhá s hláškou', async ({ page }) => {
        await otvor(page, 'sucasna', 'granted');
        await page.locator('#nav-nastavenie').click();
        await page.locator('#settings-oznamenia summary').click();
        await page.locator('#oznam-body [data-oznam-on]').click();
        await expect(page.locator('#oznam-body .oznam-stav')).toHaveText(T.stav.chyba);
        await expect(page.locator('#oznam-body [data-oznam-on]')).not.toBeChecked();
        // Service worker beží - jeho importy zo shared/ sa načítali bez chyby.
        const active = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration('./sw.js'))?.active?.state ?? null);
        expect(active).toBe('activated');
    });
});

test.describe('oznámenia: Živá obloha', () => {
    test('sekcia Oznámenia: prepínač, hodina 9:00 predvolená a spotrebiče; voľba platí aj v Pláne dňa', async ({ page }) => {
        await otvor(page, 'obloha');
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
        const os = plan(['pracka', 'umyvacka', 'susicka', 'auto', 'bojler'])?.lanes;
        await expect(page.locator('#tz-plan .tl-n')).toHaveText(os?.lanes.map((l) => l.name) ?? []);
        await expect(page.locator('#tz-plan .tl-chip')).toHaveText(os?.others.map((o) => `${o.name} · ${o.value}`) ?? []);
        await expect(page.locator('#tz-plan')).toContainText('Bojler');
    });

    test('odmietnuté povolenie: prepínač vypnutý a hláška', async ({ page }) => {
        await otvor(page, 'obloha');
        await page.locator('#nav-nastavenie').click();
        await page.locator('#ns-fold-oznamenia').click();
        await page.locator('#ns-oznam').click();
        await expect(page.locator('#ns-oznam-stav')).toHaveText(T.stav.zakazane);
        await expect(page.locator('#ns-oznam')).toHaveAttribute('aria-checked', 'false');
    });
    test('povolené, ale bez push služby: vlastný service worker oblohy s rozsahom obloha/, zapnutie zlyhá s hláškou', async ({ page }) => {
        await otvor(page, 'obloha', 'granted');
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
        // Rozsah obloha/ - Android potom oznámenie pripíše nainštalovanej oblohe (jej logo), nie Chrome.
        // Koreňový sa nezaregistroval: oznámenie posiela len appka, v ktorej sa zaplo.
        expect(regs).toEqual([{ scope: '/obloha/', script: '/obloha/sw.js', state: 'activated' }]);
    });
});

test.describe('oznámenia: obe appky', () => {
    test('zavretá otázka na povolenie: žiadna hláška o zákaze, dá sa skúsiť znova', async ({ page }) => {
        await otvor(page, 'sucasna', 'default', 'default');
        await page.locator('#nav-nastavenie').click();
        await page.locator('#settings-oznamenia summary').click();
        await page.locator('#oznam-body [data-oznam-on]').click();
        await expect(page.locator('#oznam-body [data-oznam-on]')).not.toBeChecked();
        await expect(page.locator('#oznam-body [data-oznam-on]')).toBeEnabled();
        await expect(page.locator('#oznam-body .oznam-stav')).toHaveCount(0);
    });

    for (const app of /** @type {const} */ (['sucasna', 'obloha']))
        test(`${app}: zapnuté oznámenie bez odberu v telefóne sa pri štarte prepne na vypnuté`, async ({ page }) => {
            await page.addInitScript(
                ([k, v]) => localStorage.setItem(k, v),
                [OZNAMENIA_STORAGE_KEY, JSON.stringify({ on: true, hour: 9, devices: ['pracka'] })],
            );
            await otvor(page, app, 'granted');
            await expect.poll(() => ulozene(page)).toEqual({ on: false, hour: 9 });
            // Spotrebiče zo staršej verzie sa presunuli do Čo máš doma.
            expect(await doma(page)).toEqual({ devices: ['pracka'] });
        });
    // Push tu oznámenie neukáže (prehliadač bez okna nedá povolenie oznámení), sw.js ale berie logo
    // z koreňa rozsahu, v ktorom ho appka zaregistrovala - stačí, že tam každá appka svoje má.
    for (const [app, scope] of /** @type {const} */ ([
        ['sucasna', '/'],
        ['obloha', '/obloha/'],
    ]))
        test(`${app}: logo pre oznámenie leží v koreni rozsahu service workera`, async ({ page }) => {
            const res = await page.request.get(`${scope}icon-192.png`);
            expect(res.status()).toBe(200);
            expect(res.headers()['content-type']).toBe('image/png');
            const manifest = await (await page.request.get(`${scope}manifest.webmanifest`)).json();
            expect(manifest.icons[0].src).toBe('icon-192.png');
        });
    test('zrkadlo pre service worker: po vypnutí (zmazaná cache) a novom zapnutí sa zapíše znova', async ({ page }) => {
        await otvor(page, 'sucasna');
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
