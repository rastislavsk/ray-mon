// Obrázky kariet do README. Dáta sú tie isté fixtures a ten istý pevný čas ako v testoch,
// takže sa obrázky pri opakovanom spustení nemenia bez zmeny appky. Spusti: npm run screenshots
//
// Prehliadač berie skript ten, ktorý má nainštalovaný Playwright. Keď treba iný (napr. keď
// je v systéme len staršia verzia), dá sa podstrčiť cez CHROMIUM_PATH=/cesta/k/chromium.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { PLANT, SETTINGS_STORAGE_KEY, SITE, WORKER_PV_URL } from '../../shared/config.js';
import { toUser } from '../../shared/settings.js';
import { FIXED_NOW, fixture, fixtureData } from '../helpers.js';

const PORT = 8123;
const SIRKA = 390;
const VYSKA = 844;
// Karta Nastavenie tu nie je. Na karte Info sa rozbalí len návod k ciferníku, inak by bol
// na snímke iba zoznam položiek. Zdieľať appku ostáva zavreté: QR kód v ňom kreslí knižnica
// z CDN, takže bez prístupu naň by z neho bol prázdny biely rámik.
const KARTY = [
    { subor: 'terazky.png', nav: 'nav-terazky' },
    { subor: '7dni.png', nav: 'nav-7dni' },
    { subor: 'info.png', nav: 'nav-info', otvor: '#info-guide > summary' },
];

/** Počká, kým server odpovie, aby sa prvý pokus o snímku netrafil do prázdna. */
async function pockajNaServer(url, pokusy = 40) {
    for (let i = 0; i < pokusy; i++) {
        try {
            if ((await fetch(url)).ok) return;
        } catch {
            /* server ešte nebeží */
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`Server na ${url} nenaskočil`);
}

// Priamo cez node, nie cez npx: na Windows je npx len .cmd, ktorý spawn bez shellu nenájde.
const httpServer = fileURLToPath(new URL('../../node_modules/http-server/bin/http-server', import.meta.url));
const server = spawn(process.execPath, [httpServer, '-p', String(PORT), '-c-1', '-s', '.'], { stdio: 'ignore' });
try {
    const url = `http://127.0.0.1:${PORT}/`;
    await pockajNaServer(url);
    const { pv } = fixtureData();
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    // reducedMotion vypne v appke prechody (style.css), takže snímka zachytí konečný stav.
    // Inak prstenec ciferníka na prvej karte ešte dobiehal a o výsledku rozhodovalo, ako
    // rýchlo prišli písma z CDN - tá istá appka dala raz takú, raz inú terazky.png.
    const page = await browser.newPage({
        viewport: { width: SIRKA, height: VYSKA },
        locale: 'sk-SK',
        timezoneId: 'Europe/Bratislava',
        reducedMotion: 'reduce',
    });
    // Živé zdroje sa nahradia fixtures, zvyšok (písma) sa načíta ako v appke.
    // Obrázky ukazujú elektráreň v Dvoranoch, nie ukážku - pre ňu sú fixtures.
    await page.route(WORKER_PV_URL, (r) => r.fulfill({ json: { pv, servedAt: FIXED_NOW.toISOString() } }));
    await page.route(/api\.open-meteo\.com/, (r) => r.fulfill({ json: fixture('open-meteo.json') }));
    await page.addInitScript(
        ([key, value]) => localStorage.setItem(key, value),
        [
            SETTINGS_STORAGE_KEY,
            JSON.stringify(toUser({ site: SITE, plant: PLANT, kiosk: 'https://fusionsolar.huawei.com/?kk=Screenshot' })),
        ],
    );
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto(url);
    await page.locator('#pv-updated').filter({ hasNotText: 'načítavam…' }).waitFor();

    for (const { subor, nav, otvor } of KARTY) {
        await page.locator(`#${nav}`).click();
        if (otvor) await page.locator(otvor).click();
        // Prvé prekreslenie po prepnutí karty.
        await page.waitForTimeout(400);
        await page.screenshot({ path: fileURLToPath(new URL(`../../docs/img/${subor}`, import.meta.url)) });
        console.log(`hotovo: docs/img/${subor}`);
    }
    await browser.close();
} finally {
    server.kill();
}
