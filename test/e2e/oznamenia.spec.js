// E2E: Nastavenie › Oznámenia v oboch appkách. Push sa v testovacom prehliadači naozaj prihlásiť
// nedá (nemá push službu), testy preto overujú voľby, ich uloženie, Plán dňa podľa spotrebičov doma,
// hlášky, keď sa oznámenia zapnúť nedajú, a že service worker sa zaregistruje (jeho importy sedia).
import { expect, test } from '@playwright/test';
import {
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

/** @param {import('@playwright/test').Page} page @param {'sucasna' | 'obloha'} app  {NotificationPermission} [permission] */
async function otvor(page, app, permission = 'default') {
    // Prehliadač bez okna má oznámenia vždy zakázané - stav povolenia aj odpoveď na otázku podvrhne test.
    await page.addInitScript((p) => {
        Object.defineProperty(Notification, 'permission', { get: () => p });
        Notification.requestPermission = async () => (p === 'granted' ? 'granted' : 'denied');
    }, permission);
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
        await page.locator('#oznam-body [data-oznam-hour="7"]').check();
        await page.locator('#oznam-body [data-oznam-device="auto"]').uncheck();
        await expect.poll(() => ulozene(page)).toEqual({ on: false, hour: 7, devices: ['pracka', 'umyvacka', 'susicka'] });
        await page.locator('#nav-mozem').click();
        const rows = plan(['pracka', 'umyvacka', 'susicka'])?.rows ?? [];
        await expect(page.locator('.mozem-plan-list li')).toHaveText(rows.map((r) => `${r.time}${r.name}${r.now ? 'teraz' : ''}${r.why}`));
        await expect(page.locator('.mozem-plan-list')).not.toContainText('Auto');
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
        await expect(page.locator('#ns-oznam-title')).toHaveText(T.title);
        await expect(page.locator('#ns-oznam')).toHaveAttribute('aria-checked', 'false');
        await expect(page.locator('#ns-oznam-hour [aria-pressed="true"]')).toHaveText('9:00');
        await page.locator('#ns-oznam-hour [data-hour="8"]').click();
        await page.locator('#ns-oznam-dev [data-device="bojler"]').click();
        await expect(page.locator('#ns-oznam-dev [data-device="bojler"]')).toHaveAttribute('aria-pressed', 'true');
        await expect
            .poll(() => ulozene(page))
            .toEqual({ on: false, hour: 8, devices: ['pracka', 'umyvacka', 'susicka', 'auto', 'bojler'] });
        await page.locator('#nav-mozem').click();
        const rows = plan(['pracka', 'umyvacka', 'susicka', 'auto', 'bojler'])?.rows ?? [];
        await expect(page.locator('#mz-plan-rows li')).toHaveText(rows.map((r) => `${r.time}${r.name}${r.now ? 'teraz' : ''}${r.why}`));
    });

    test('odmietnuté povolenie: prepínač vypnutý a hláška', async ({ page }) => {
        await otvor(page, 'obloha');
        await page.locator('#nav-nastavenie').click();
        await page.locator('#ns-oznam').click();
        await expect(page.locator('#ns-oznam-stav')).toHaveText(T.stav.zakazane);
        await expect(page.locator('#ns-oznam')).toHaveAttribute('aria-checked', 'false');
    });
});
