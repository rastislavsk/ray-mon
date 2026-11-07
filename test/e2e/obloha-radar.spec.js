// Karta Radar. MapLibre, radar aj model sú falošné: skutočný obraz sa nedá v teste porovnať, overuje sa
// ovládanie, texty a hlášky. Očakávané popisy sa rátajú tou istou funkciou ako v appke.

import { deflateSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import {
    PLANT,
    RADAR,
    RADAR_STORAGE_KEY,
    SETTINGS_STORAGE_KEY,
    SITE,
    TARIFF,
    WORKER_PV_URL,
    WORKER_RADAR_URL,
} from '../../shared/config.js';
import { toUser } from '../../shared/settings.js';
import { FIXED_NOW, fixture, fixtureData } from '../helpers.js';

const { pv } = fixtureData();
const weather = fixture('open-meteo.json');

/** Odpoveď Workera: dva suché bloky. */
function teloRadaru() {
    const blok = deflateSync(Buffer.from(new Float64Array(RADAR.blokRiadky * RADAR.blokStlpce).buffer));
    const meta = Buffer.from(
        JSON.stringify([
            { row: 2280, col: 1760, size: blok.length },
            { row: 2280, col: 2640, size: blok.length },
        ]),
    );
    const dlzka = Buffer.alloc(4);
    dlzka.writeUInt32LE(meta.length);
    return Buffer.concat([dlzka, meta, blok, blok]);
}

/** Najmenší MapLibre, ktorý karte stačí. */
const FALOSNA_MAPA = `window.maplibregl = {
    Map: class {
        touchZoomRotate = { disableRotation() {} };
        once(_e, fn) { setTimeout(fn); }
        getStyle() { return { layers: [] }; }
        addLayer() {}
        triggerRepaint() {}
        resize() {}
        remove() {}
    },
    Marker: class { constructor() {} setLngLat() { return this; } addTo() { return this; } },
};`;

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ mapa?: boolean, site?: typeof SITE | null }} [opts]
 */
async function otvor(page, { mapa = true, site = SITE } = {}) {
    /** @type {string[]} */ const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const telo = teloRadaru();
    await page.route(/cdnjs\.cloudflare\.com/, (r) => r.abort());
    if (mapa) await page.addInitScript(FALOSNA_MAPA);
    await page.route(/tiles\.openfreemap\.org/, (r) => r.abort());
    await page.route(WORKER_PV_URL, (r) => r.fulfill({ json: { pv } }));
    await page.route(/api\.open-meteo\.com/, (r) => r.fulfill({ json: weather }));
    await page.route(`${WORKER_RADAR_URL}*`, (r) => r.fulfill({ body: telo, headers: { 'access-control-allow-origin': '*' } }));
    if (site)
        await page.addInitScript(
            ([k, v]) => localStorage.setItem(k, v),
            [SETTINGS_STORAGE_KEY, JSON.stringify(toUser({ site, plant: PLANT, tariff: TARIFF }))],
        );
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto('/');
    await expect(page.locator('#page')).toHaveAttribute('data-panel', /.+/);
    await page.locator('#nav-radar').click();
    return errors;
}

test('Radar: načíta sa, ukáže čas a dá sa ovládať', async ({ page }) => {
    const errors = await otvor(page);
    await expect(page.locator('#rd-hlaska')).toBeHidden();
    await expect(page.locator('#rd-druh')).toHaveText('Teraz');
    await expect(page.locator('#rd-os-svg text')).toHaveCount(5);
    await expect(page.locator('#rd-hraj')).toHaveAttribute('aria-label', 'Pustiť');
    await page.locator('#rd-hraj').click();
    await expect(page.locator('#rd-hraj')).toHaveAttribute('aria-label', 'Zastaviť');
    await page.locator('#rd-hraj').click();

    await page.locator('#rd-rychlost').click();
    await expect(page.locator('#rd-rychlost')).toHaveText('2×');
    await page.locator('#rd-rychlost').click();
    await page.locator('#rd-rychlost').click();
    await expect(page.locator('#rd-rychlost')).toHaveText('1×');

    await page.locator('[data-rozsah="zajtra"]').click();
    await expect(page.locator('[data-rozsah="zajtra"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#rd-druh')).toHaveText('Zajtra · predpoveď modelu');
    await page.locator('[data-rozsah="2h"]').click();
    await expect(page.locator('#rd-druh')).toHaveText('Teraz');
    expect(errors).toEqual([]);
});

test('Radar: ťah po osi zastaví prehrávanie a posunie čas, klávesnica ide po krokoch', async ({ page }) => {
    const errors = await otvor(page);
    await expect(page.locator('#rd-hlaska')).toBeHidden();
    const os = /** @type {{ x: number, y: number, width: number, height: number }} */ (await page.locator('#rd-os').boundingBox());
    await page.mouse.move(os.x + os.width * 0.5, os.y + 10);
    await page.mouse.down();
    await page.mouse.move(os.x + os.width * 0.25, os.y + 10, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('#rd-hraj')).toHaveAttribute('aria-label', 'Pustiť');
    await expect(page.locator('#rd-druh')).toHaveText('Pred 1 h · meranie');
    await page.locator('#rd-os').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#rd-druh')).toHaveText('Pred 55 min · meranie');
    expect(errors).toEqual([]);
});

test('Radar: nespustí sa sám, prehrá os raz od začiatku a zastane', async ({ page }) => {
    const errors = await otvor(page);
    await expect(page.locator('#rd-hlaska')).toBeHidden();
    await page.waitForTimeout(600);
    await expect(page.locator('#rd-hraj')).toHaveAttribute('aria-label', 'Pustiť');
    await expect(page.locator('#rd-druh')).toHaveText('Teraz');
    await page.locator('#rd-rychlost').click();
    await page.locator('#rd-rychlost').click();
    await page.locator('#rd-hraj').click();
    await expect(page.locator('#rd-druh')).toContainText('Pred ');
    await expect(page.locator('#rd-hraj')).toHaveAttribute('aria-label', 'Pustiť', { timeout: 10000 });
    await expect(page.locator('#rd-druh')).toHaveText('O 2 h · predpoveď');
    expect(errors).toEqual([]);
});

test('Radar: oblaky a rýchlosť si appka pamätá', async ({ page }) => {
    await otvor(page);
    await page.locator('#rd-oblaky').click();
    await expect(page.locator('#rd-oblaky')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#rd-rychlost').click();
    await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), RADAR_STORAGE_KEY)).toBe('{"oblaky":false,"rychlost":2}');
    await page.reload();
    await expect(page.locator('#page')).toHaveAttribute('data-panel', /.+/);
    await page.locator('#nav-radar').click();
    await expect(page.locator('#rd-oblaky')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#rd-rychlost')).toHaveText('2×');
});

test('Radar: bez mapy povie, že sa nenačítal, a dá sa skúsiť znova', async ({ page }) => {
    await otvor(page, { mapa: false });
    await expect(page.locator('#rd-hlaska-text')).toHaveText('Radar sa nepodarilo načítať.');
    await page.evaluate(FALOSNA_MAPA);
    await page.locator('#rd-znova').click();
    await expect(page.locator('#rd-hlaska')).toBeHidden();
});

test('Radar: mimo Európy a bez polohy len povie prečo', async ({ page }) => {
    await otvor(page, { site: { ...SITE, name: 'Sydney', lat: -33.9, lon: 151.2, timezone: 'Australia/Sydney' } });
    await expect(page.locator('#rd-hlaska-text')).toHaveText('Pre toto miesto radar nemáme. Pokrýva len Európu.');
    await expect(page.locator('#rd-dok')).toBeHidden();
});

test('Radar: bez polohy pošle do Nastavenia', async ({ page }) => {
    await otvor(page, { site: null });
    await expect(page.locator('#rd-hlaska-text')).toHaveText('Radar ukáže tvoje okolie, keď v Nastavení zadáš polohu.');
});
