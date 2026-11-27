// E2E: pevný čas, dáta
// z fixtures a očakávané hodnoty počítané tou istou funkciou (shared/), ktorú volá appka.
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { wordSize } from '../../web/render/mozem.js';
import { pocasieStav } from '../../web/pocasie.js';
import { PARTS } from '../../web/state.js';
import {
    BEZI_STORAGE_KEY,
    HVIEZDY,
    LOOK_STORAGE_KEY,
    OLD_STORAGE_KEYS,
    PANELS,
    PLANT,
    SETTINGS_STORAGE_KEY,
    SITE,
    SITE_STORAGE_KEY,
    SKY,
    SPAT,
    TARIFF,
    WORKER_PV_URL,
    WORKER_TRASY_URL,
} from '../../shared/config.js';
import { DNES_BUBLINY, MOZEM_WORDS } from '../../shared/messages.js';
import { mozemSkyModel } from '../../shared/mozem-sky.js';
import { cellAt, planCells } from '../../shared/day-chart.js';
import { dayPlan } from '../../shared/day-plan.js';
import { heroModel, stavMerania } from '../../shared/hero-model.js';
import { HEADER_TEXTS, stavMeraniaText, TERAZ_BEZI, terazAutoText, vetaDlazdice } from '../../shared/messages-core.js';
import { autoDnes } from '../../shared/auto-slnko.js';
import { BUBLINY, dnesBublina } from '../../shared/dnes-bubliny.js';
import { denVysvetlenie, dnesFaza, dnesKarty } from '../../shared/dnes-faza.js';
import { dnesNeboModel } from '../../shared/dnes-nebo.js';
import { pocasieTeraz, terazModel } from '../../shared/teraz.js';
import { oknaSvietia, scenaModel } from '../../shared/teraz-scena.js';
import { stlpceDlazdic } from '../../shared/teraz-stlpce.js';
import { sedemDayModel, sedemModel, sedemWeekModel } from '../../shared/sedem-dni.js';
import { lookToStored, toUser, typicalSettings } from '../../shared/settings.js';
import { skyNow } from '../../shared/sky.js';
import { buildForecast } from '../../shared/solar.js';
import { bigWords, dazdKresba, FIXED_NOW, fixture, fixtureData, overHlavicku, pvAt, rozdielStavovehoRiadku } from '../helpers.js';

const { pv } = fixtureData();
const weather = fixture('open-meteo.json');
/** Pripojené meranie v testoch: zapečatený prístup ku kiosku, Worker naň odpovedá nameraným pv z fixtures. */
const TEST_ZDROJ = { sposob: 'huawei-kiosk', pecat: 'v1.TestPecat0123456789abcdefgh', nazov: 'Dvorany' };
const OWNER = { site: SITE, plant: PLANT, tariff: TARIFF, zdroj: TEST_ZDROJ };
const IGNORED_CONSOLE = /Failed to load resource|net::ERR_FAILED/;
const TITLES = { mozem: 'Dnes', terazky: 'Teraz', radar: 'Radar', '7dni': '7 dní', statistika: 'Štatistika', nastavenie: 'Nastavenie' };

/** Presný okamih daného času 5. 9. 2026 v Bratislave (letný čas, UTC+2). @param {string} hm */
const at = (hm) => new Date(`2026-09-05T${hm}:00+02:00`);

/**
 * Siete a úložisko: Worker a Open-Meteo odpovedajú z fixtures (alebo
 * vôbec, `offline`), nastavenie sa uloží len vtedy, keď tam ešte nič nie je.
 * @param {import('@playwright/test').Page} page
 * @param {{ offline?: boolean, settings?: typeof OWNER | null, site?: typeof SITE | null, pvData?: typeof pv }} [opts]
 *   `pvData` meranie, ktoré pošle Worker (predvolene snímka z fixtures o 13:00)
 */
async function pripravSiet(page, { offline = false, settings = OWNER, site = null, pvData = pv, pocasie = weather } = {}) {
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (msg) => msg.type() === 'error' && !IGNORED_CONSOLE.test(msg.text()) && errors.push(msg.text()));
    await page.route(/cdnjs\.cloudflare\.com/, (route) => route.abort());
    await page.route(WORKER_PV_URL, (route) => (offline ? route.abort() : route.fulfill({ json: { pv: pvData } })));
    // Trasy autom pre Štatistiku: bez nich plagát počíta s cestou okolo Zeme a test nesiaha na Worker.
    await page.route(WORKER_TRASY_URL, (route) => route.abort());
    await page.route(/api\.open-meteo\.com/, (route) => (offline ? route.abort() : route.fulfill({ json: pocasie })));
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
 * Otvorí appku s pevným časom. Bez `settings: null` má uložené Dvorany s kioskom.
 * @param {import('@playwright/test').Page} page
 * @param {{ time?: Date, offline?: boolean, settings?: typeof OWNER | null, site?: typeof SITE | null, pvData?: typeof pv,
 *   pocasie?: typeof weather }} [opts]
 */
async function openObloha(page, { time = FIXED_NOW, ...opts } = {}) {
    const errors = await pripravSiet(page, opts);
    await page.clock.setFixedTime(time);
    await page.goto('/');
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
const ocakavanaObloha = (time) => {
    // Počasie neba je to isté ako v kresbe na karte Teraz; appka má meranie z fixtures (pv).
    const vstup = vstupTeraz(time, { pv });
    return skyNow(vstup, true, pocasieTeraz(vstup));
};

/** @param {import('@playwright/test').Page} page @param {(typeof PANELS)[number]} panel */
async function ocakavajKartu(page, panel) {
    await expect(page.locator(`#panel-${panel}`)).toBeVisible();
    // Karta Teraz má počas náhľadu v nadpise čas („O 09:00“), ku ktorému patrí číslo pod ním.
    const title = panel === 'terazky' ? new RegExp(`^(${TITLES[panel]}|O \\d\\d:\\d\\d)$`) : TITLES[panel];
    await expect(page.locator(`#panel-${panel} h1`)).toHaveText(title);
    await expect(page.locator(`#nav-${panel}`)).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.panel:not(.hidden)')).toHaveCount(1);
    await expect(page.locator('.tabs [aria-current]')).toHaveCount(1);
}

for (const width of [390, 320]) {
    test(`navigácia prepína všetkých 6 kariet, popisky sú celé a položky aspoň 44 px (šírka ${width} px)`, async ({ page }) => {
        await page.setViewportSize({ width, height: 700 });
        const errors = await openObloha(page);
        await ocakavajKartu(page, 'terazky');
        for (const panel of [...PANELS].reverse()) {
            await page.locator(`#nav-${panel}`).click();
            await ocakavajKartu(page, panel);
            // Nastavenie (krok 6) ukazuje prehľad elektrárne.
            if (panel === 'nastavenie') await expect(page.locator('#ns-home h2')).toHaveText('Moja elektráreň');
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

test('hlavička je priehľadná a pri posune odíde so stránkou', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 600 });
    const errors = await openObloha(page);
    await overHlavicku(page, '.st');
    expect(errors).toEqual([]);
});

test('stavový riadok telefónu má farbu vrchu oblohy', async ({ page }) => {
    // Bez prechodu: farba oblohy sa inak prelína 0,7 s a vrch stránky by ešte nesedel.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // Porovnáva sa farba oblohy: počasie karty Teraz (#wx) je kresba nad ňou, ktorá zámerne
    // svieti aj spod stavového riadku (slnko v pravom hornom rohu), a pri meraní je skryté.
    // Cez vlastnosť prvku, nie vloženým <style> - ten CSP stránky nepustí.
    const skryPocasie = () =>
        page.locator('#wx').evaluate((el) => {
            el.style.visibility = 'hidden';
        });
    const errors = await openObloha(page, { time: at('13:00') });
    await skryPocasie();
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', ocakavanaObloha(at('13:00')).top);
    expect(await rozdielStavovehoRiadku(page)).toBeLessThanOrEqual(3);

    await page.clock.setFixedTime(at('21:00'));
    await page.reload();
    await appReady(page);
    await skryPocasie();
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', ocakavanaObloha(at('21:00')).top);
    expect(await rozdielStavovehoRiadku(page)).toBeLessThanOrEqual(3);
    expect(errors).toEqual([]);
});

test('bez dát je obloha sivá a riadok stavu to povie', async ({ page }) => {
    await openObloha(page, { offline: true });
    await expect(page.locator('#hdr-status')).toHaveText('bez dát');
    await expect(page.locator('#hdr-live')).toHaveAttribute('data-tone', 'off');
    expect(await oblohaVStranke(page)).toEqual({ top: SKY.offline[0], bottom: SKY.offline[1], sky: 'offline' });
});

test('hlavička: miesto elektrárne a za ním bodka živého merania; čas a slovo až po ťuknutí', async ({ page }) => {
    const errors = await openObloha(page, { time: at('13:00') });
    await expect(page.locator('#hdr-place')).toHaveText(SITE.name);
    await expect(page.locator('#hdr-status')).toHaveText('13:00 · živé meranie');
    await expect(page.locator('#hdr-live')).toHaveAttribute('data-tone', 'live');
    // Slovo povie riadok sám, čítačka nepotrebuje dopĺňať, čo hovorí bodka.
    await expect(page.locator('#hdr-tone')).toHaveText('');
    await expect(page.locator('#hdr-setup')).toBeHidden();
    // Bodka je v hlavičke za miestom (docs/navrhy/teraz-tok-energie.html), čas a slovo sú zakryté aj po ťuknutí -
    // stav vysvetľuje bublina, ktorej nadpis začína tou istou bodkou.
    // Veta pod scénou je len pri typickej streche, s vlastnou je skrytá.
    await expect(page.locator('header .miesto #hdr-live')).toHaveCount(1);
    await expect(page.locator('#tz-sub')).toBeHidden();
    const sirka = () => page.locator('#hdr-status').evaluate((el) => el.getBoundingClientRect().width);
    expect(await sirka()).toBeLessThanOrEqual(1);
    await page.locator('#hdr-live').click();
    await expect(page.locator('#hdr-tip')).toBeVisible();
    await expect(page.locator('#hdr-tip')).toHaveAttribute('data-tone', 'live');
    expect(await sirka()).toBeLessThanOrEqual(1);
    // Bodka stojí v strede riadku s miestom (na pol pixela).
    const stred = (/** @type {string} */ sel) =>
        page.locator(sel).evaluate((el) => {
            const r = el.getBoundingClientRect();
            return r.top + r.height / 2;
        });
    expect(Math.abs((await stred('#hdr-live i')) - (await stred('#hdr-place')))).toBeLessThanOrEqual(0.5);
    expect(errors).toEqual([]);
});

test('riadok stavu: čerstvé meranie bez výkonu nie je živé, rovnako ako na karte Teraz', async ({ page }) => {
    const errors = await openObloha(page, { time: at('13:00'), pvData: { ...pv, realTimePowerKw: null } });
    await expect(page.locator('#hdr-live')).toHaveAttribute('data-tone', 'odhad');
    await expect(page.locator('#hdr-status')).toHaveText('meranie nedostupné');
    expect(errors).toEqual([]);
});

test('riadok stavu: čas posledného merania, nie hodiny; zastarané so slovom, bez merania slovom', async ({ page }) => {
    // Meranie z 13:00 (posledný bod krivky), appka o 13:10: čas merania, nie 13:10.
    const errors = await openObloha(page, { time: at('13:10') });
    await expect(page.locator('#hdr-live')).toHaveAttribute('data-tone', 'live');
    await expect(page.locator('#hdr-status')).toHaveText('13:00 · živé meranie');
    // Bez oválu, len text a bodka; malé „›“ (len v CSS, čítačka ho nečíta) hovorí, že sa dá ťuknúť.
    const naznak = () =>
        page.evaluate(() => [
            getComputedStyle(/** @type {Element} */ (document.querySelector('#hdr-live'))).backgroundColor,
            getComputedStyle(/** @type {Element} */ (document.querySelector('#hdr-status')), '::after').content,
        ]);
    expect((await naznak())[0]).toBe('rgba(0, 0, 0, 0)');
    expect((await naznak())[1]).toContain('›');
    // Appka sa 30 minút nedostala k dátam (Worker posiela čas stiahnutia 13:00): polovičná bodka, bez spojenia.
    await page.clock.setFixedTime(at('13:30'));
    await page.reload();
    await expect(page.locator('#hdr-status')).toHaveText('13:00 · bez spojenia');
    await expect(page.locator('#hdr-live')).toHaveAttribute('data-tone', 'stale');
    await expect(page.locator('#hdr-tone')).toHaveText('meranie zastarané');
    expect((await naznak())[1]).toContain('›');
    expect(errors).toEqual([]);
});

test('riadok stavu: menič mlčí za slnka, alebo v noci spí', async ({ browser }) => {
    // Dáta chodia (čas stiahnutia je teraz), krivka končí 13:00 a slnko svieti: polovičná bodka, zastarané.
    const mlci = await browser.newPage();
    const errors = await openObloha(mlci, { time: at('14:30'), pvData: { ...pv, updatedAt: at('14:30').toISOString() } });
    await expect(mlci.locator('#hdr-status')).toHaveText('13:00 · zastarané');
    await expect(mlci.locator('#hdr-live')).toHaveAttribute('data-tone', 'stale');
    await mlci.locator('#hdr-live').click();
    await expect(mlci.locator('#hdr-tip-title')).toHaveText('Meranie je zastarané');
    await expect(mlci.locator('#hdr-tip-text')).toContainText('Menič mlčí od 13:00, už 1 h 30 min, hoci slnko svieti.');
    // V noci menič spí: plná bodka, „›“ - bublina sa dá otvoriť.
    const noc = await browser.newPage();
    await openObloha(noc, { time: at('23:10'), pvData: { ...pv, updatedAt: at('23:10').toISOString() } });
    await expect(noc.locator('#hdr-status')).toHaveText('13:00 · menič spí');
    await expect(noc.locator('#hdr-live')).toHaveAttribute('data-tone', 'live');
    await expect(noc.locator('#hdr-tone')).toHaveText('živé meranie');
    expect(
        await noc.evaluate(() => getComputedStyle(/** @type {Element} */ (document.querySelector('#hdr-status')), '::after').content),
    ).toContain('›');
    await noc.locator('#hdr-live').click();
    await expect(noc.locator('#hdr-tip-title')).toHaveText('Menič spí');
    expect(errors).toEqual([]);
});

test('riadok stavu: pripojené meranie neprišlo, alebo meranie nie je pripojené', async ({ browser }) => {
    const bezMerania = await browser.newPage();
    await openObloha(bezMerania, { settings: /** @type {any} */ ({ ...OWNER, zdroj: null }) });
    await expect(bezMerania.locator('#hdr-status')).toHaveText('odhad z predpovede');
    await expect(bezMerania.locator('#hdr-live')).toHaveAttribute('data-tone', 'odhad');
    const neprislo = await browser.newPage();
    await openObloha(neprislo, { pvData: /** @type {any} */ (null) });
    await expect(neprislo.locator('#hdr-status')).toHaveText('meranie nedostupné');
    await expect(neprislo.locator('#hdr-live')).toHaveAttribute('data-tone', 'odhad');
});

test('bublina stavu: ťuknutie na riadok pod číslom vysvetlí stav, ťuknutie mimo a Escape ju zavrú', async ({ page }) => {
    const errors = await openObloha(page, { time: at('13:10') });
    const live = page.locator('#hdr-live');
    const tip = page.locator('#hdr-tip');
    await expect(tip).toBeHidden();
    await live.click();
    await expect(tip).toBeVisible();
    await expect(live).toHaveAttribute('aria-expanded', 'true');
    // Text počíta to isté jadro ako appka.
    const ocak = stavMeraniaText(stavMerania({ now: at('13:10'), pv, site: SITE, zdroj: OWNER.zdroj, pristup: null }));
    await expect(page.locator('#hdr-tip-title')).toHaveText(ocak.nadpis);
    await expect(page.locator('#hdr-tip-text')).toHaveText(ocak.text);
    await expect(page.locator('#hdr-tip-btn')).toBeHidden();
    // Ťuknutie mimo bubliny ju zavrie a nič pod ňou nespustí - karta ostáva tá istá.
    const karta = await page.locator('#page').getAttribute('data-panel');
    await page.locator('#hdr-tip-bg').click({ position: { x: 30, y: 400 } });
    await expect(tip).toBeHidden();
    await expect(live).toHaveAttribute('aria-expanded', 'false');
    expect(await page.locator('#page').getAttribute('data-panel')).toBe(karta);
    // Escape ju zavrie a fokus ostane na bodke a čase.
    await live.click();
    await expect(tip).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tip).toBeHidden();
    await expect(live).toBeFocused();
    expect(errors).toEqual([]);
});

test('bublina stavu bez merania: tlačidlo Pripojiť meranie otvorí Nastavenie a bublinu zavrie', async ({ page }) => {
    const errors = await openObloha(page, { settings: /** @type {any} */ ({ ...OWNER, zdroj: null }) });
    await page.locator('#hdr-live').click();
    await expect(page.locator('#hdr-tip-title')).toHaveText('Odhad z predpovede');
    const btn = page.locator('#hdr-tip-btn');
    await expect(btn).toHaveText('Pripojiť meranie ›');
    await btn.click();
    await expect(page.locator('#page')).toHaveAttribute('data-panel', 'nastavenie');
    await expect(page.locator('#hdr-tip')).toBeHidden();
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
    await expect(page.locator('#tz-stav')).toBeHidden();
    await stitok.click();
    await ocakavajKartu(page, 'nastavenie');
    expect(errors).toEqual([]);
});

test('uložené nastavenie appka ukáže a nič v ňom nemení', async ({ page }) => {
    const chata = { ...OWNER, site: { ...SITE, name: 'Chata pod Zoborom' } };
    const errors = await pripravSiet(page, { settings: chata });
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto('/');
    await appReady(page);
    const ulozene = await page.evaluate(() => JSON.stringify(localStorage));

    await page.goto('/');
    await appReady(page);
    await expect(page.locator('#hdr-status')).toHaveText(/^\d\d:\d\d · /);
    await expect(page.locator('#hdr-place')).toHaveText('Chata pod Zoborom');
    await ocakavajKartu(page, 'terazky');
    expect(await page.evaluate(() => JSON.stringify(localStorage)), 'appka uložené nastavenie neprepisuje').toBe(ulozene);
    expect(errors).toEqual([]);
});

/**
 * Závažné a kritické nálezy axe v celej stránke. `vynechajKontrast`: prvky, na ktorých sa nemeria kontrast
 * (vypnuté a zámerne bledé), ostatné pravidlá na nich platia.
 * @param {import('@playwright/test').Page} page @param {{ vynechajKontrast?: string }} [opts] @returns {Promise<string[]>}
 */
const vazneNalezy = async (page, { vynechajKontrast } = {}) => {
    const runs = vynechajKontrast
        ? [
              new AxeBuilder({ page }).disableRules(['color-contrast']),
              new AxeBuilder({ page }).withRules(['color-contrast']).exclude(vynechajKontrast),
          ]
        : [new AxeBuilder({ page })];
    const nalezy = [];
    for (const axe of runs) nalezy.push(...(await axe.analyze()).violations);
    return nalezy
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
};

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

/** Každý panel zdola má krížik vpravo hore (docs/navrhy/zatvaranie-popupov.html). Nový panel netreba
 *  nikam dopisovať, test ho uvidí sám. Panely Nastavenia sa zapoja až s jeho časťou appky. */
test('každý panel zdola má krížik Zavrieť', async ({ page }) => {
    const errors = await openObloha(page);
    await page.locator('#nav-nastavenie').click();
    await ocakavajKartu(page, 'nastavenie');
    const panely = await page.locator('dialog.sheet').evaluateAll((ds) => ds.map((d) => d.id));
    expect(panely.length).toBeGreaterThanOrEqual(6);
    for (const id of panely) {
        await expect(page.locator(`#${id} .sheet-x`), `#${id} nemá krížik`).toHaveCount(1);
        await expect(page.locator(`#${id} .sheet-x`)).toHaveAttribute('aria-label', 'Zavrieť');
    }
    expect(errors).toEqual([]);
});

/** Iná karta začína navrchu, nie na výške, kam bola odscrollovaná predošlá. */
test('po prepnutí karty je stránka navrchu', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 400 });
    const errors = await openObloha(page);
    await page.locator('#nav-7dni').click();
    await ocakavajKartu(page, '7dni');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    expect(await page.evaluate(() => window.scrollY), 'karta musí byť vyššia ako obrazovka, inak test nič neoverí').toBeGreaterThan(100);
    await page.locator('#nav-mozem').click();
    await ocakavajKartu(page, 'mozem');
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    // Späť vedie na kartu 7 dní tiež navrch.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.goBack();
    await ocakavajKartu(page, '7dni');
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    expect(errors).toEqual([]);
});

test.describe('ťah prstom a tlačidlo Späť', () => {
    test.use({ hasTouch: true });

    /** Ťah prstom z prvku `sel` o `dx` (a `dy`) - jeden pohyb, bez meraného času, takže o
     * prelistovaní dňa rozhoduje len dĺžka ťahu.
     * @param {import('@playwright/test').Page} page @param {string} sel @param {number} dx @param {number} [dy] */
    async function tah(page, sel, dx, dy = 0) {
        const box = await page.locator(sel).boundingBox();
        if (!box) throw new Error(`${sel} nie je vidno`);
        const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
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

    /** Detail dňa je otvorený na `den`: nadpis je celé meno dňa, ktoré nesie znenie jeho čipu.
     * @param {import('@playwright/test').Page} page @param {number} den */
    async function ocakavajDen(page, den) {
        const meno = await page.locator(`#sd-day-strip [data-day="${den}"]`).getAttribute('aria-label');
        await expect(page.locator('#sd-day-title')).toHaveText((meno ?? '').split(', ')[1]);
        await expect(page.locator('.pager-ghost')).toHaveCount(0);
        await ocakavajKartu(page, '7dni');
    }

    /** Karty sa prepínajú len ťuknutím v navigácii (docs/navrhy/7dni-listovanie-dni.html). */
    test('ťah do strán kartu neprelistuje', async ({ page }) => {
        const errors = await openObloha(page);
        await ocakavajKartu(page, 'terazky');
        for (const dx of [-200, 200]) {
            await tah(page, '#tz-scena', dx);
            await ocakavajKartu(page, 'terazky');
        }
        expect(errors).toEqual([]);
    });

    test('v detaile dňa ťah listuje dni, na kraji ostane; čipy a čítačka idú s ním', async ({ page }) => {
        const errors = await openObloha(page);
        await page.locator('#nav-7dni').click();
        await page.locator('#sd-days [data-day="2"]').click();
        await ocakavajDen(page, 2);
        await expect(page.locator('#sd-day-strip [aria-current="true"]')).toHaveAttribute('data-day', '2');

        await tah(page, '#sd-day-title', -220);
        await ocakavajDen(page, 3);
        await expect(page.locator('#sd-day-strip [aria-current="true"]')).toHaveAttribute('data-day', '3');
        const pocet = await page.locator('#sd-day-strip [data-day]').count();
        await expect(page.locator('#sd-day-live')).toHaveText(`${await page.locator('#sd-day-title').textContent()}, deň 4 zo ${pocet}`);
        await tah(page, '#sd-day-title', 220);
        await ocakavajDen(page, 2);
        // Zvislý ťah deň neprelistuje. (Tu prídu
        // udalosti bez pauzy, teda ako veľmi rýchly švih.)
        await tah(page, '#sd-day-title', -20, 200);
        await ocakavajDen(page, 2);

        // Čip prelistuje na deň, ktorý nesie; z prvého dňa ťah doprava detail nezatvorí.
        await page.locator('#sd-day-strip [data-day="0"]').click();
        await ocakavajDen(page, 0);
        await tah(page, '#sd-day-title', 220);
        await ocakavajDen(page, 0);
        await expect(page.locator('#sd-day')).toBeVisible();
        await page.locator('#sd-day-strip [data-day="6"]').click();
        await ocakavajDen(page, 6);
        await tah(page, '#sd-day-title', -220);
        await ocakavajDen(page, 6);

        // Šípka späť je prvá v riadku čipov a vráti do prehľadu.
        await expect(page.locator('#sd-day-back')).toHaveAccessibleName('Späť na 7 dní');
        await page.locator('#sd-day-back').click();
        await expect(page.locator('#sd-list')).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('rýchly druhý ťah počas dojazdu posunie o ďalší deň', async ({ page }) => {
        const errors = await openObloha(page);
        await page.locator('#nav-7dni').click();
        await page.locator('#sd-days [data-day="2"]').click();
        await ocakavajDen(page, 2);
        // Dva ťahy doľava priamo v stránke, druhý 40 ms po prvom - ešte počas dojazdu prvého
        // (dojazd trvá najmenej DAY_PAGER.minMs). Každý musí posunúť o ďalší deň.
        await page.evaluate(async () => {
            const tah = () => {
                const el = /** @type {HTMLElement} */ (document.querySelector('#sd-day-title'));
                const r = el.getBoundingClientRect();
                const y = r.top + r.height / 2;
                const x = r.left + r.width / 2 + 80;
                const touch = (/** @type {number} */ px) => new Touch({ identifier: 1, target: el, clientX: px, clientY: y });
                const fire = (/** @type {string} */ type, /** @type {Touch[]} */ touches, /** @type {Touch} */ t) =>
                    el.dispatchEvent(new TouchEvent(type, { touches, changedTouches: [t], bubbles: true, cancelable: true }));
                fire('touchstart', [touch(x)], touch(x));
                fire('touchmove', [touch(x - 80)], touch(x - 80));
                fire('touchmove', [touch(x - 160)], touch(x - 160));
                fire('touchend', [], touch(x - 160));
            };
            tah();
            await new Promise((r) => setTimeout(r, 40));
            if (!document.querySelector('.pager-ghost')) throw new Error('dojazd prvého ťahu už skončil, test by nič nemeral');
            tah();
        });
        await ocakavajDen(page, 4);
        expect(errors).toEqual([]);
    });

    test('v detaile týždňa ťah do strán nerobí nič', async ({ page }) => {
        const errors = await openObloha(page);
        await page.locator('#nav-7dni').click();
        await page.locator('#sd-sum').click();
        await expect(page.locator('#sd-week')).toBeVisible();
        for (const dx of [-220, 220]) {
            await tah(page, '#sd-week-title', dx);
            await expect(page.locator('#sd-week')).toBeVisible();
            await ocakavajKartu(page, '7dni');
        }
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
        await ocakavajKartu(page, 'terazky');
        await page.goForward();
        await ocakavajKartu(page, '7dni');
        expect(errors).toEqual([]);
    });

    test('Späť vráti posledných SPAT.krokov krokov, potom Teraz, potom bublinu a až ďalšie appku zavrie', async ({ page }) => {
        const errors = await openObloha(page);
        const app = page.url();
        const karty = /** @type {const} */ (['7dni', 'mozem', 'statistika', 'nastavenie', '7dni', 'mozem', 'statistika']);
        for (const k of karty) {
            await page.locator(`#nav-${k}`).click();
            await ocakavajKartu(page, k);
        }
        // Späť ide po krokoch od posledného, najviac SPAT.krokov ...
        for (const k of karty.slice(0, -1).reverse().slice(0, SPAT.krokov)) {
            await page.goBack();
            await ocakavajKartu(page, k);
        }
        // ... ďalšie skočí na Teraz, nech bolo krokov koľkokoľvek.
        await page.goBack();
        await ocakavajKartu(page, 'terazky');
        const bublina = page.locator('#spat-bublina');
        await expect(bublina).toBeHidden();
        await page.goBack();
        await ocakavajKartu(page, 'terazky');
        await expect(bublina).toBeVisible();
        await expect(bublina).toHaveText(HEADER_TEXTS.spat);
        // Zmizne sama.
        await expect(bublina).toBeHidden({ timeout: SPAT.bublinaMs + 2000 });
        expect(errors).toEqual([]);
        // Ďalšie Späť z appky odíde.
        await page.goBack();
        await expect.poll(() => page.url()).not.toBe(app);
    });

    test('z detailu dňa po listovaní: Späť do 7 dní, Teraz, bublina, odchod', async ({ page }) => {
        const errors = await openObloha(page);
        const app = page.url();
        await page.locator('#nav-7dni').click();
        await page.locator('#sd-days [data-day="1"]').click();
        await expect(page.locator('#sd-day')).toBeVisible();
        // Listovanie dní nie je krok.
        for (const den of ['2', '3']) {
            await page.locator(`#sd-day-strip [data-day="${den}"]`).click();
            await expect(page.locator('#sd-day-strip [aria-current="true"]')).toHaveAttribute('data-day', den);
        }
        await page.goBack();
        await expect(page.locator('#sd-list')).toBeVisible();
        await ocakavajKartu(page, '7dni');
        await page.goBack();
        await ocakavajKartu(page, 'terazky');
        await page.goBack();
        await expect(page.locator('#spat-bublina')).toBeVisible();
        await ocakavajKartu(page, 'terazky');
        expect(errors).toEqual([]);
        await page.goBack();
        await expect.poll(() => page.url()).not.toBe(app);
    });
});

// Nasadenie a cache: starý modul z cache
// hrá route - shared/config.js bez exportov, ktoré appka importuje.
test.describe('stará adresa obloha/', () => {
    test('presmeruje do koreňa a zachová odkaz s nastavením', async ({ page }) => {
        await pripravSiet(page);
        await page.goto('/obloha/#nastavenie=abc');
        await expect(page).toHaveURL(/:\d+\/#nastavenie=abc$/);
    });

    test('service worker starých odberov ostáva', async ({ page }) => {
        expect((await page.request.get('/obloha/sw.js')).status()).toBe(200);
    });
});

test.describe('nasadenie a cache (boot.js)', () => {
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
        await expect(page.locator('#hdr-status')).toHaveText(/^\d\d:\d\d · /);
        await expect.poll(loads).toBe(2);
        expect(errors).toEqual([expect.stringContaining('does not provide an export named')]);
        expect(await page.evaluate(() => sessionStorage.getItem('ray-mon-obloha-obnova'))).toBeNull();
    });

    test('chyba, ktorú obnovenie nevyrieši: jedno obnovenie, potom hláška namiesto slučky', async ({ page }) => {
        const loads = await staryModul(page, Infinity);
        await pripravSiet(page);
        await page.clock.setFixedTime(FIXED_NOW);
        await page.goto('/');
        await expect(page.locator('#hdr-status')).toHaveText('appka sa nenačítala, skús to o chvíľu');
        expect(loads()).toBe(2);
        // Svitanie by inak tvrdilo, že sa ešte načítava.
        await expect(page.locator('#tz-svitanie')).toBeHidden();
    });

    test('chýbajúci prvok v starom index.html: to isté ako starý modul', async ({ page }) => {
        let left = 1;
        await page.route(/:\d+\/$/, async (route) => {
            if (left-- <= 0) return route.continue();
            const res = await route.fetch();
            route.fulfill({ response: res, body: (await res.text()).replace('id="hdr-tone"', '') });
        });
        let loads = 0;
        page.on('load', () => loads++);
        const errors = await openObloha(page);
        await expect.poll(() => loads).toBe(2);
        await expect(page.locator('#hdr-status')).toHaveText(/^\d\d:\d\d · /);
        expect(errors).toEqual([expect.stringContaining('Chýba element #hdr-tone')]);
    });
});

// Svitanie (docs/navrhy/nacitanie.html): krivka dňa na karte Teraz, kým appka čaká na prvé dáta.
// Je v statickom HTML, takže beží aj skôr, ako sa stiahne appka; skryje ju render.
test.describe('svitanie počas načítania', () => {
    test('vidno ho, kým sa appka sťahuje', async ({ page }) => {
        await pripravSiet(page);
        // boot.js nikdy neodpovie: v stránke ostane statické HTML.
        await page.route('**/boot.js', () => {});
        await page.goto('/', { waitUntil: 'commit' });
        await expect(page.locator('#tz-svitanie')).toBeVisible();
        // Text „načítavam…“ nie je, riadok stavu ostane skrytý - čakanie ukazuje len obrazec.
        await expect(page.locator('#hdr-status')).toBeEmpty();
        await expect(page.locator('#tz-stav')).toBeHidden();
    });

    test('vidno ho, kým appka čaká na predpoveď, potom zmizne', async ({ page }) => {
        const errors = await pripravSiet(page);
        /** @type {() => void} */
        let pust = () => {};
        const cakaj = new Promise((r) => (pust = () => r(undefined)));
        // Neskôr registrovaná route má prednosť pred tou z pripravSiet.
        await page.route(/api\.open-meteo\.com/, async (route) => {
            await cakaj;
            await route.fulfill({ json: weather });
        });
        await page.clock.setFixedTime(FIXED_NOW);
        await page.goto('/');
        await appReady(page);
        await expect(page.locator('#tz-svitanie')).toBeVisible();
        pust();
        await expect(page.locator('#hdr-status')).toHaveText(/^\d\d:\d\d · /);
        await expect(page.locator('#tz-svitanie')).toBeHidden();
        expect(errors).toEqual([]);
    });

    test('bez polohy ho po štarte nevidno', async ({ page }) => {
        const errors = await openObloha(page, { settings: null });
        await expect(page.locator('#tz-svitanie')).toBeHidden();
        expect(errors).toEqual([]);
    });
});

// Karty 7 dní, Štatistika a Nastavenie sa sťahujú až po štarte (web/parts.js) - boot.js ich
// nechráni. Starý modul z cache tu hrá shared/statistika.js bez exportov: kód karty Štatistika sa
// nezlinkuje, zvyšok appky beží.
test.describe('nasadenie a cache: karty načítané neskôr (web/parts.js)', () => {
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
            /\/web\/part-|\/render\/(sedem|statistika|nastavenie|sprievodca)\.js|\/shared\/messages\.js/.test(u);
        expect(urls.filter(neskore)).toEqual([]);
        // Keď je prehliadač voľný, stiahnu sa aj ostatné - karta je potom pri prvom otvorení hneď hotová.
        await expect.poll(() => urls.filter((u) => u.includes('/web/part-')).length).toBe(PARTS.length);
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
// jadra) z tých istých dát, takže test odhalí rozdiel medzi modelom a stránkou.

/**
 * Model karty pre dáta z fixtures v danej chvíli, tak ako ho počíta appka.
 * @param {Date} time @param {object} [extra] @param {Parameters<typeof mozemSkyModel>[1]} [opts]
 */
const modelKarty = (time, extra = {}, opts = {}) => {
    const input = {
        ...OWNER,
        now: time,
        loading: false,
        known: /** @type {const} */ ('elektraren'),
        pv,
        forecast: buildForecast(weather, time, SITE, PLANT),
        ...extra,
    };
    const m = mozemSkyModel(input, opts);
    // Čo sa mení s časťou dňa - appka to skladá tou istou funkciou (web/render/mozem.js).
    const faza = m.ask || m.state === 'loading' ? null : dnesFaza(input, m.den, m.window, { voice: opts.voice, devices: opts.devices });
    return { ...m, faza, nebo: m.ask ? null : dnesNeboModel(input, null, opts.voice) };
};

/**
 * Čo karta Dnes ukazuje: výkon a čo je to za číslo hore a pás dlaždíc - Dnes, Veľké veci, Zo strechy, večer
 * Zajtra a karty časti dňa, po jednej či po dvoch na dlaždici. Každá karta ako [druh, nadpis, hodnota či slovo, veta,
 * štítok či prirovnania].
 * @param {import('@playwright/test').Page} page
 */
const kartaVStranke = (page) =>
    page.evaluate(() => {
        const vidno = (/** @type {string} */ sel) => !document.querySelector(sel)?.classList.contains('hidden');
        const text = (/** @type {Element} */ el, /** @type {string} */ sel) => el.querySelector(sel)?.textContent ?? '';
        return {
            nebo: vidno('#mz-nebo') ? [text(document, '#mz-kw'), text(document, '#mz-stav')] : null,
            karty: vidno('#mz-karty')
                ? [...document.querySelectorAll('#mz-karty .karta')].map((d) =>
                      [...d.querySelectorAll('.cast')].map((el) => [
                          el.getAttribute('data-kind'),
                          text(el, '.glass-ttl'),
                          text(el, '.k-val, .k-popis, .k-slovo'),
                          text(el, '.k-text, .k-teplo'),
                          el.querySelector('.eq')
                              ? [...el.querySelectorAll('.eq b')].map((b) => b.textContent).join('|')
                              : (el.querySelector('[data-bublina="dnes"], [data-bublina="zajtra"]')?.getAttribute('aria-label') ?? ''),
                      ]),
                  )
                : [],
        };
    });

/** Dlaždica z modelu, ako ju ukazuje stránka. @param {import('../../shared/dnes-faza.js').Karta} k */
const kartaZDlazdice = (k) => {
    if (k.kind === 'predpoved') return [k.kind, k.title, k.popis, `najnižšia ${k.min}najvyššia ${k.max}`, ''];
    // Trieda dňa je v mene tlačidla cez pole (docs/navrhy/dnes-bubliny-poli.html); bez nej pole bublinu nemá.
    if (k.kind === 'dnes' || k.kind === 'zajtra')
        return [k.kind, k.title, k.word, k.text, k.chip ? `${k.title}: ${k.chip}, ${DNES_BUBLINY.podrobnosti}` : ''];
    if (k.kind === 'eq') return [k.kind, k.title, '', '', k.eq.map((e) => e.value).join('|')];
    if (k.kind === 'oblacnost') return [k.kind, k.title, k.value, '', ''];
    return [k.kind, k.title, k.value, k.text, ''];
};

/** To isté z modelu - pás skladá appka tou istou funkciou (dnesKarty). @param {ReturnType<typeof modelKarty>} m */
const kartaZModelu = (m) => ({
    nebo: m.nebo ? [`${m.nebo.kw}kW`, `${m.nebo.slovo}${m.nebo.cas}`] : null,
    karty: m.ask ? [] : dnesKarty(m, m.faza).map((d) => d.map(kartaZDlazdice)),
});

/** Dlaždica pásu karty Dnes podľa druhu. @param {import('@playwright/test').Page} page @param {string} kind */
const dlazdica = (page, kind) => page.locator(`#mz-karty [data-kind="${kind}"]`);

/** Otvorí kartu Dnes - appka sa otvára na Teraz. @param {import('@playwright/test').Page} page */
async function naDnes(page) {
    await page.locator('#nav-mozem').click();
    await ocakavajKartu(page, 'mozem');
}

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

test.describe('karta Dnes', () => {
    for (const hm of ['13:00', '21:00', '05:30']) {
        test(`o ${hm} ukazuje to isté slovo, deň v číslach a časť dňa ako model`, async ({ page }) => {
            const errors = await openObloha(page, { time: at(hm) });
            await naDnes(page);
            const m = modelKarty(at(hm));
            await expect.poll(() => kartaVStranke(page)).toEqual(kartaZModelu(m));
            await expect(page.locator('#mz-retry')).toBeHidden();
            await expect(page.locator('#mz-guess')).toBeHidden();
            // Ráno plán, cez deň odpočet, večer ako dopadol dnešok a zajtrajšok - porovnané v kartaVStranke.
            await expect(dlazdica(page, 'zajtra')).toHaveCount(hm === '21:00' ? 1 : 0);
            // Po otvorení karty stojí bežec na teraz a odtlačku niet.
            await expect(page.locator('#mz-os')).toHaveAttribute('aria-valuenow', String(minuta(hm)));
            await expect(page.locator('#mz-odtlacok')).toBeHidden();
            expect(errors).toEqual([]);
        });
    }

    test('časy okna sú tučne: odpočet cez deň, plán ráno aj zajtrajšok večer', async ({ page }) => {
        for (const [hm, sel] of /** @type {const} */ ([
            ['13:00', '#mz-karty [data-kind="velke"] .k-text'],
            ['05:30', '#mz-karty [data-kind="velke"] .k-text'],
            ['21:00', '#mz-karty [data-kind="zajtra"] .k-text'],
        ])) {
            const errors = await openObloha(page, { time: at(hm) });
            await naDnes(page);
            const cas = page.locator(`${sel} strong.cas`);
            await expect(cas).toHaveCount(1);
            await expect(cas).toHaveText(/^\d\d:\d\d( – \d\d:\d\d)?$/);
            expect(Number(await cas.evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(700);
            expect(errors).toEqual([]);
        }
    });

    // Posuvník dňa stojí v tej istej výške ako stred poľa toku na karte Teraz a pás dlaždíc dostane výšku pod ním
    // (docs/navrhy/dnes-nizsie-dlazdice.html, Z2). Prepnutie kariet tak posuvníkom ani poľom nepohne.
    for (const size of [
        { width: 360, height: 780 },
        { width: 412, height: 915 },
        { width: 320, height: 640 },
    ])
        test(`posuvník dňa vo výške poľa toku karty Teraz (${size.width} × ${size.height})`, async ({ page }) => {
            await page.setViewportSize(size);
            const errors = await openObloha(page, { time: at('13:00') });
            const tok = await page.locator('#tz-tok').boundingBox();
            await naDnes(page);
            const ciara = await page.locator('#mz-os .mz-os-ciara').boundingBox();
            const pas = await page.locator('#mz-karty .karta').first().boundingBox();
            if (!tok || !ciara || !pas) throw new Error('pole toku, posuvník alebo dlaždica nie je vidno');
            expect(Math.abs(ciara.y + ciara.height / 2 - (tok.y + tok.height / 2))).toBeLessThanOrEqual(1);
            expect(Math.round(pas.height)).toBeGreaterThanOrEqual(124);
            expect(errors).toEqual([]);
        });

    test('posuvník dňa: iný čas ukáže jeho výkon a oblohu, odtlačok vráti bežec na teraz, iná karta tiež', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 800 });
        const time = at('13:00');
        const errors = await openObloha(page, { time });
        await naDnes(page);
        const vstup = {
            ...OWNER,
            now: time,
            loading: false,
            known: /** @type {const} */ ('elektraren'),
            pv,
            forecast: buildForecast(weather, time, SITE, PLANT),
        };
        const os = page.locator('#mz-os');
        const odtlacok = page.locator('#mz-odtlacok');
        /** Výkon a riadok pod ním v čase posuvníka, ako ich počíta appka. */
        const nebo = async () => {
            const cas = Number(await os.getAttribute('aria-valuenow'));
            const n = dnesNeboModel(vstup, cas === minuta('13:00') ? null : cas);
            return n ? [`${n.kw}kW`, `${n.slovo}${n.cas}`] : null;
        };
        const vStranke = async () => (await kartaVStranke(page)).nebo;
        // Kurzorom (ťuknutie myšou) na 9:00 - dopoludnia namerané, bežec tam a na teraz ostane odtlačok.
        const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (await os.boundingBox());
        await page.mouse.click(box.x + (box.width * minuta('09:00')) / 1440, box.y + box.height / 2);
        await expect(os).toHaveAttribute('aria-valuenow', /^5[34]\d$/);
        await expect(page.locator('#mz-stav')).toHaveAttribute('data-druh', 'namerane');
        await expect.poll(vStranke).toEqual(await nebo());
        await expect(os).toHaveAttribute('aria-valuetext', /^Namerané 0?9:\d\d, /);
        await expect(odtlacok).toBeVisible();
        expect(await page.locator('#wx').getAttribute('data-dnes')).not.toBeNull();
        // Odtlačok je pod bežcom aj na prst (44 px) a ťuknutie naň vráti bežec na teraz.
        const o = /** @type {{ width: number, height: number }} */ (await odtlacok.boundingBox());
        expect(Math.min(o.width, o.height)).toBeGreaterThanOrEqual(44);
        await odtlacok.click();
        await expect(page.locator('#mz-stav')).toHaveAttribute('data-druh', 'teraz');
        await expect(odtlacok).toBeHidden();
        await expect(os).toBeFocused();
        // Šípka posunie po štvrťhodine dopredu - predpoveď.
        await page.keyboard.press('ArrowRight');
        await expect(os).toHaveAttribute('aria-valuenow', String(minuta('13:15')));
        await expect(page.locator('#mz-stav')).toHaveAttribute('data-druh', 'predpoved');
        await expect.poll(vStranke).toEqual(await nebo());
        await page.keyboard.press('Escape');
        await expect(page.locator('#mz-stav')).toHaveAttribute('data-druh', 'teraz');
        // Prst: ťuknutie na 16:00, pri teraz sa bežec prilepí na teraz.
        await prst(page, { x: box.x + (box.width * minuta('16:00')) / 1440, y: box.y + box.height / 2 });
        await expect(page.locator('#mz-stav')).toHaveAttribute('data-druh', 'predpoved');
        await prst(page, { x: box.x + (box.width * (minuta('13:00') + 5)) / 1440, y: box.y + box.height / 2 });
        await expect(page.locator('#mz-stav')).toHaveAttribute('data-druh', 'teraz');
        // Iná karta a späť: bežec je znova na teraz.
        await page.keyboard.press('ArrowLeft');
        await expect(odtlacok).toBeVisible();
        await page.locator('#nav-terazky').click();
        await ocakavajKartu(page, 'terazky');
        await naDnes(page);
        await expect(os).toHaveAttribute('aria-valuenow', String(minuta('13:00')));
        await expect(odtlacok).toBeHidden();
        expect(errors).toEqual([]);
    });

    test('pás kariet: bodka ukazuje, kde pás stojí, šípky ho posunú o kartu; zvislý ťah posúva stránku', async ({ page }) => {
        // Nízke okno: karta je vyššia ako ono, stránka sa má kam posunúť.
        await page.setViewportSize({ width: 390, height: 560 });
        const errors = await openObloha(page, { time: at('13:00') });
        await naDnes(page);
        const karty = page.locator('#mz-karty .karta');
        await expect(karty).toHaveCount(4);
        const bodky = page.locator('#mz-bodky i');
        await expect(bodky).toHaveCount(4);
        const spat = page.getByRole('button', { name: 'Predchádzajúca karta' });
        const dalej = page.getByRole('button', { name: 'Ďalšia karta' });
        const aktivna = () => bodky.evaluateAll((b) => b.findIndex((x) => x.hasAttribute('data-on')));
        await expect.poll(aktivna).toBe(0);
        await expect(spat).toBeDisabled();
        // Susedná karta vykukuje sprava - je vidno, že pás ide ďalej.
        const druha = await karty.nth(1).boundingBox();
        expect(druha && druha.x < 390 && druha.x + druha.width > 390, 'druhá karta vykukuje').toBe(true);
        await dalej.click();
        await expect.poll(aktivna).toBe(1);
        await dalej.click();
        await expect.poll(aktivna).toBe(2);
        // Karta zastane na začiatku pásu (pás posúva plynulo - čaká sa na koniec).
        await expect.poll(async () => Math.round((await karty.nth(2).boundingBox())?.x ?? -1)).toBe(14);
        await spat.click();
        await expect.poll(aktivna).toBe(1);
        // Posun pásu (ako prstom) rozsvieti bodku sám, na konci je šípka ďalej vypnutá.
        await page.locator('#mz-karty').evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
        await expect.poll(aktivna).toBe(3);
        await expect(dalej).toBeDisabled();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'stránka ide do strán').toBe(true);
        // Zvislý ťah prstom cez pás posúva stránku.
        await page.locator('#mz-karty').scrollIntoViewIfNeeded();
        await page.evaluate(() => scrollTo(0, 0));
        const box = await page.locator('#mz-karty').boundingBox();
        expect(box).not.toBeNull();
        if (box) await prst(page, { x: box.x + 100, y: box.y + 40, dy: -200 });
        await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
        expect(errors).toEqual([]);
    });

    test('ťuknutie na pole Dnes vysvetlí triedu dňa modelom; Escape, ťuknutie vedľa a Späť ho zavrú', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 812 });
        const time = at('13:00');
        const errors = await openObloha(page, { time });
        await naDnes(page);
        const input = {
            ...OWNER,
            now: time,
            loading: false,
            known: /** @type {const} */ ('elektraren'),
            pv,
            forecast: buildForecast(weather, time, SITE, PLANT),
        };
        const v = /** @type {import('../../shared/dnes-faza.js').DenVysvetlenie} */ (denVysvetlenie(input, 'dnes'));
        expect(v).not.toBeNull();
        const panel = page.locator('#mz-trieda-sheet');
        const chip = page.locator('#mz-karty [data-bublina="dnes"]');
        await chip.click();
        await expect(panel).toBeVisible();
        await expect(page.locator('#mz-trieda-chip')).toHaveText(v.chip);
        await expect(page.locator('#mz-trieda-title')).toHaveText(v.title);
        await expect(page.locator('#mz-trieda-text')).toHaveText(v.text);
        await expect(page.locator('#mz-trieda-veci > li')).toHaveCount(v.veci.length);
        await expect(page.locator('#mz-trieda-veci > li[data-ok="true"]')).toHaveCount(v.veci.filter((x) => x.ok).length);
        await expect(page.locator('#mz-trieda-stupnica > li b')).toHaveText(v.stupnica.map((s) => s.label));
        await expect(page.locator('#mz-trieda-stupnica > li[aria-current]')).toHaveAttribute('data-cls', v.cls);
        expect(await vazneNalezy(page)).toEqual([]);
        // Jediné tlačidlo je krížik vpravo hore (docs/navrhy/zatvaranie-popupov.html). Zavrie panel krokom späť,
        // karta ostane.
        await expect(panel.locator('button')).toHaveCount(1);
        await panel.getByRole('button', { name: 'Zavrieť' }).click();
        await expect(panel).toBeHidden();
        await ocakavajKartu(page, 'mozem');
        // Escape, ťuknutie vedľa a Späť ostávajú.
        await chip.click();
        await page.keyboard.press('Escape');
        await expect(panel).toBeHidden();
        await expect(chip).toBeFocused();
        // Ťuknutie vedľa panelu (na stmavenú stránku nad ním) trafí dialóg a zavrie ho.
        await chip.click();
        await page.mouse.click(187, 60);
        await expect(panel).toBeHidden();
        await chip.click();
        await page.goBack();
        await expect(panel).toBeHidden();
        await ocakavajKartu(page, 'mozem');
        expect(errors).toEqual([]);
    });

    test('večer vysvetlí triedu zajtrajška; večerný Dnešok bublinu nemá', async ({ page }) => {
        const time = at('21:00');
        const errors = await openObloha(page, { time });
        await naDnes(page);
        const input = {
            ...OWNER,
            now: time,
            loading: false,
            known: /** @type {const} */ ('elektraren'),
            pv,
            forecast: buildForecast(weather, time, SITE, PLANT),
        };
        const v = denVysvetlenie(input, 'zajtra');
        await expect(page.locator('#mz-karty [data-bublina="dnes"]')).toHaveCount(0);
        await page.locator('#mz-karty [data-bublina="zajtra"]').click();
        await expect(page.locator('#mz-trieda-sheet')).toBeVisible();
        await expect(page.locator('#mz-trieda-chip')).toHaveText(v?.chip ?? '-');
        await expect(page.locator('#mz-trieda-text')).toHaveText(v?.text ?? '-');
        await page.keyboard.press('Escape');
        await expect(page.locator('#mz-karty [data-bublina="zajtra"]')).toBeFocused();
        expect(errors).toEqual([]);
    });

    test('ťuknutie na pole dlaždice otvorí jeho bublinu modelom; šípka je na každom poli s bublinou', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 812 });
        const time = at('13:00');
        const errors = await openObloha(page, { time });
        await naDnes(page);
        const input = {
            ...OWNER,
            now: time,
            loading: false,
            known: /** @type {const} */ ('elektraren'),
            pv,
            forecast: buildForecast(weather, time, SITE, PLANT),
        };
        const sky = mozemSkyModel(input);
        const d = dnesFaza(input, sky.den, sky.window);
        // Každé pole pásu má bublinu - Dnes vysvetlenie triedy, ostatné svoju (docs/navrhy/dnes-bubliny-poli.html).
        await expect(page.locator('#mz-karty .cast')).toHaveCount(BUBLINY.length + 1);
        await expect(page.locator('#mz-karty .cast-tap')).toHaveCount(BUBLINY.length + 1);
        const panel = page.locator('#mz-bublina-sheet');
        for (const kind of BUBLINY) {
            const b = dnesBublina(kind, input, sky, d);
            expect(b, kind).not.toBeNull();
            const pole = page.locator(`#mz-karty [data-bublina="${kind}"]`);
            // Ťuká sa na celú polovicu dlaždice: tlačidlo ju prekryje.
            const [tap, cast] = await Promise.all([pole.boundingBox(), page.locator(`#mz-karty .cast[data-kind="${kind}"]`).boundingBox()]);
            expect(tap && cast && tap.width >= cast.width && tap.height >= cast.height, kind).toBe(true);
            await pole.evaluate((el) => {
                const t = /** @type {HTMLElement} */ (el.closest('.karta'));
                t.parentElement?.scrollTo({ left: t.offsetLeft - 14 });
            });
            await pole.click();
            await expect(panel).toBeVisible();
            await expect(page.locator('#mz-bublina-q')).toHaveText(b?.q ?? '-');
            await expect(page.locator('#mz-bublina-title')).toHaveText(b?.title ?? '-');
            await expect(panel).toHaveAttribute('data-kind', kind);
            expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth), `${kind} ide do strán`).toBe(true);
            if (kind === 'strecha') expect(await vazneNalezy(page)).toEqual([]);
            await page.keyboard.press('Escape');
            await expect(panel).toBeHidden();
            await expect(pole).toBeFocused();
        }
        // Späť bublinu zavrie a karta ostane.
        await page.locator('#mz-karty [data-bublina="eq"]').click();
        await expect(panel).toBeVisible();
        await page.goBack();
        await expect(panel).toBeHidden();
        await ocakavajKartu(page, 'mozem');
        expect(errors).toEqual([]);
    });

    for (const width of [390, 320]) {
        test(`šírka ${width} px: čísla dňa sa neorežú, žiadne veľké slovo nepretečie`, async ({ page }) => {
            await page.setViewportSize({ width, height: 800 });
            const errors = await openObloha(page);
            await naDnes(page);
            // Dlaždica Zo strechy | Ako keby je tretia v páse - posunie sa na ňu ako prstom.
            const dvojica = page.locator('#mz-karty .karta:has([data-kind="eq"])');
            await page
                .locator('#mz-karty')
                .evaluate((el, x) => el.scrollTo({ left: x }), await dvojica.evaluate((el) => el.offsetLeft - 14));
            await expect.poll(async () => Math.round((await dvojica.boundingBox())?.x ?? -1)).toBe(14);
            const eq = dlazdica(page, 'eq');
            await expect(eq.locator('.eq > li')).toHaveCount(3);
            const cisla = await eq.locator('.eq > li').evaluateAll((els) =>
                els.map((el) => {
                    const box = el.getBoundingClientRect();
                    return { text: el.textContent, ok: box.left >= 0 && box.right <= innerWidth && el.scrollWidth <= el.clientWidth + 0.5 };
                }),
            );
            for (const c of cisla) expect(c.ok, `${c.text} je orezané`).toBe(true);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'stránka ide do strán').toBe(true);
            await page.locator('#mz-karty').evaluate((el) => el.scrollTo({ left: 0 }));
            await expect.poll(async () => Math.round((await page.locator('#mz-word').boundingBox())?.x ?? -1)).toBeGreaterThan(0);
            // Každé veľké slovo, aké karta pozná, s veľkosťou podľa wordSize ako v appke.
            for (const word of [...bigWords('drzy'), ...bigWords('slusny')]) {
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
                        // Aj na výšku: slovo sa zmestí do nízkej dlaždice (docs/navrhy/dnes-nizsie-dlazdice.html).
                        const cast = /** @type {HTMLElement} */ (el.closest('.cast'));
                        // Tlačidlo cez celé pole presahuje kartu zámerne (ťuká sa až po okraj skla) - meria sa len obsah.
                        const spodok = Math.max(
                            ...[...cast.children].filter((c) => !c.matches('.cast-tap')).map((c) => c.getBoundingClientRect().bottom),
                        );
                        return (
                            el.scrollWidth <= el.clientWidth + 0.5 &&
                            box.left >= 0 &&
                            box.right <= innerWidth &&
                            spodok <= cast.getBoundingClientRect().bottom + 1
                        );
                    },
                    [word, wordSize(word)],
                );
                expect(ok, `„${word}“ sa nezmestí`).toBe(true);
            }
            expect(errors).toEqual([]);
        });
    }

    test('staré zápisy „Pustil/a som“ appka pri štarte zmaže', async ({ page }) => {
        const errors = await openObloha(page);
        const stare = JSON.stringify([{ d: '2026-09-05', id: 'pracka', m: 12 * 60, sun: true }]);
        await page.evaluate(
            ([keys, v]) => keys.forEach((k) => localStorage.setItem(k, v)),
            /** @type {const} */ ([OLD_STORAGE_KEYS, stare]),
        );
        await page.reload();
        await appReady(page);
        expect(await page.evaluate((keys) => keys.map((k) => localStorage.getItem(k)), OLD_STORAGE_KEYS)).toEqual(
            OLD_STORAGE_KEYS.map(() => null),
        );
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
        await page.goto('/');
        await appReady(page);
        await naDnes(page);

        await expect.poll(() => kartaVStranke(page)).toEqual(kartaZModelu(modelKarty(FIXED_NOW, { pv: null, forecast: null })));
        await expect(page.locator('#mz-word')).toHaveText(MOZEM_WORDS.offline);
        await expect(dlazdica(page, 'dnes').locator('.k-text')).toHaveText(
            /^Predpoveď počasia neprišla.* Ani meranie zo strechy neodpovedá\./,
        );
        // Bez predpovede nie je výkon ani posuvník.
        await expect(page.locator('#mz-nebo')).toBeHidden();
        await expect(page.locator('#mz-os-obal')).toBeHidden();
        await expect(page.locator('#tz-co')).toBeHidden();
        const znova = page.locator('#mz-retry');
        await expect(znova).toBeVisible();

        offline = false;
        await znova.click();
        await expect.poll(() => kartaVStranke(page)).toEqual(kartaZModelu(modelKarty(FIXED_NOW)));
        await expect(znova).toBeHidden();
        await expect(page.locator('#mz-karty')).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('bez internetu to karta povie', async ({ page }) => {
        await openObloha(page, { offline: true });
        await page.context().setOffline(true);
        await naDnes(page);
        await expect(dlazdica(page, 'dnes').locator('.k-text')).toHaveText(/^Nie je internet/);
    });

    test('poloha bez panelov: deň z typickej strechy a výzva', async ({ page }) => {
        const errors = await openObloha(page, { settings: null, site: SITE });
        await naDnes(page);
        const typical = typicalSettings(SITE);
        /** @type {Parameters<typeof mozemSkyModel>[0]} */
        const input = {
            ...typical,
            zdroj: null,
            now: FIXED_NOW,
            loading: false,
            known: 'poloha',
            pv: null,
            forecast: buildForecast(weather, FIXED_NOW, SITE, typical.plant),
        };
        const sky = mozemSkyModel(input);
        const m = { ...sky, faza: dnesFaza(input, sky.den, sky.window), nebo: dnesNeboModel(input, null) };
        await expect.poll(() => kartaVStranke(page)).toEqual(kartaZModelu(m));
        await expect(page.locator('#mz-guess-title')).toHaveText('Hádam podľa suseda');
        await expect(page.locator('#mz-guess-text')).toHaveText(m.guess);
        // Biela výzva, nie červená.
        expect(await page.locator('#mz-guess').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
        await page.locator('#mz-guess-btn').click();
        await ocakavajKartu(page, 'nastavenie');
        expect(errors).toEqual([]);
    });

    test('bez polohy: na Teraz len výzva zadať polohu, bez toho, čo zapnúť', async ({ page }) => {
        const errors = await openObloha(page, { settings: null });
        await expect(page.locator('#tz-ask')).toBeVisible();
        await expect(page.locator('#tz-co')).toBeHidden();
        await page.locator('#tz-ask-btn').click();
        await ocakavajKartu(page, 'nastavenie');
        expect(errors).toEqual([]);
    });

    test('prístupnosť: bez polohy žiadne závažné nálezy axe', async ({ page }) => {
        await openObloha(page, { settings: null });
        expect(await vazneNalezy(page)).toEqual([]);
    });
});

// ---- Karta Teraz (krok 3) ----------------------------------------------------------
// Očakávané texty počíta tá istá funkcia ako appka (shared/teraz.js nad heroModel a dayPlan
// jadra) z tých istých dát. Meranie je pvAt - snímka kiosku taká, aká by prišla
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
 * Otvorí appku na karte Teraz s meraním, aké by prišlo v danej chvíli.
 * @param {import('@playwright/test').Page} page @param {Parameters<typeof openObloha>[1]} [opts]
 */
async function openTeraz(page, opts = {}) {
    const time = opts.time ?? FIXED_NOW;
    const errors = await openObloha(page, { pvData: pvAt(time), ...opts, time });
    await page.locator('#nav-terazky').click();
    await ocakavajKartu(page, 'terazky');
    return errors;
}

/** Čo karta ukazuje: nadpis, scénu toku energie (veta pre čítačku, skrytá je prázdna) a riadok pod ňou. @param {import('@playwright/test').Page} page */
const terazVStranke = (page) =>
    page.evaluate(() => {
        const text = (/** @type {string} */ sel) => document.querySelector(sel)?.textContent ?? '';
        const scena = document.querySelector('#tz-scena:not(.hidden)');
        return { title: text('#ttl-terazky'), scena: scena?.getAttribute('aria-label') ?? '', sub: text('#tz-sub') };
    });

/** To isté z modelu (meranie elektromera v týchto dátach nie je). @param {ReturnType<typeof terazModel>} m */
const terazZModelu = (m) => ({
    title: m.title,
    scena: m.kind === 'ok' ? scenaModel({ vyrobaKw: m.vykon, odhad: m.odhadVykonu, sietKw: null }).popis : '',
    sub: m.sub,
});

/** Čo zapnúť v stránke: tok iného dňa (veta pre čítačku a čísla) a mriežka dlaždíc s odznakom a pásikom. @param {import('@playwright/test').Page} page */
const coVStranke = (page) =>
    page.evaluate(() => {
        const t = (/** @type {Element | null} */ el) => el?.textContent ?? '';
        return {
            den: document.querySelector('#tz-tok[data-den]:not(.hidden)')
                ? `${t(document.querySelector('#tz-tok .sr'))} | ${[...document.querySelectorAll('#tz-tok .tp-u')].map(t).join(' ')}`
                : '',
            // Pásik je podiel programu zo slnka; prázdny drží miesto a nič neukazuje. Na oko len čísla (malé čísla `.mv`,
            // odznak `.odz` pri ikone), slová má čítačka za menom (docs/navrhy/teraz-dlazdice-cisla.html, B).
            // Auto (zo slnka, mimo Plánu dňa) má vlastné testy.
            dlazdice: [...document.querySelectorAll('#tz-dlazdice [data-vec]:not([data-vec="auto"])')].map((d) => ({
                id: /** @type {HTMLElement} */ (d).dataset.vec,
                tone: d.getAttribute('data-tone'),
                kind: d.getAttribute('data-kind') ?? '',
                text:
                    `${t(d.querySelector('.velky'))} ${t(d.querySelector('b'))} [${[...d.querySelectorAll('.mv > span')].map(t).join(' · ')}]` +
                    t(d.querySelector('.mv ~ .sr')),
                podiel: /** @type {HTMLElement | null} */ (d.querySelector('.podiel'))?.style.getPropertyValue('--s') ?? '',
                potom: t(d.querySelector('.odz')),
            })),
        };
    });

/**
 * Rozmery dlaždíc Čo zapnúť: rôzne výšky dlaždíc a koľko dlaždíc nemá číslo,
 * pásik a odrážky na rovnakej výške ako dlaždica vedľa nej (docs/navrhy/teraz-pasik-zdroje.html,
 * teraz-dlazdice-stlpce.html - všetky rovnako veľké, rady zarovnané).
 * @param {import('@playwright/test').Page} page
 */
const rozmeryDlazdic = (page) =>
    page.evaluate(() => {
        const bloky = [...document.querySelectorAll('#tz-dlazdice > *')];
        const dl = bloky.filter((d) => d.matches('.dl'));
        const top = (/** @type {Element} */ d, /** @type {string} */ sel) =>
            Math.round(d.querySelector(sel)?.getBoundingClientRect().top ?? -1);
        const vysky = new Set(bloky.map((d) => Math.round(d.getBoundingClientRect().height)));
        const vedla = dl.filter((d, i) => {
            const sused = dl[i - 1];
            if (!sused || top(sused, '.dl-ico') !== top(d, '.dl-ico')) return false;
            return ['.velky', '.podiel', '.mv'].some((sel) => top(sused, sel) !== top(d, sel));
        });
        return { vysky: vysky.size, nezarovnane: vedla.length };
    });

/**
 * Dlaždica tak, ako ju má v sebe render, a ako ju vidí coVStranke.
 * @typedef {{ id: string, tone: string, kind: string, pred?: string, velky: string, meno: string, odr: string[],
 *   mv?: Array<{ t: string }>, podiel: number, potom?: { text: string, kratko: string } | null }} DlazdicaModelu
 */
/** @param {DlazdicaModelu} d */
const dlazdicaVStranke = (d) => ({
    id: d.id,
    tone: d.tone,
    kind: d.kind,
    text:
        `${d.pred ? `${d.pred} ` : ''}${d.velky} ${d.meno} [${(d.mv ?? []).map((m) => m.t).join(' · ')}]` +
        [...d.odr, ...(d.potom ? [d.potom.text] : [])].map((x) => `, ${x}`).join(''),
    podiel: `${d.podiel}%`,
    potom: d.potom?.kratko ?? '',
});

/** Dlaždice dneška, ktoré idú teraz, alebo najbližšia vec. @param {NonNullable<ReturnType<typeof terazModel>['co']>['hore']} h @returns {DlazdicaModelu[]} */
const horeZModelu = (h) => [
    ...h.dlazdice.map((d) => ({ ...d, kind: '' })),
    ...(h.dalsi
        ? [
              {
                  id: h.dalsi.id,
                  tone: 'tiche',
                  kind: '',
                  velky: h.dalsi.cas,
                  meno: h.dalsi.name,
                  odr: h.dalsi.odr,
                  mv: h.dalsi.mv,
                  podiel: h.dalsi.podiel,
                  potom: h.dalsi.potom,
              },
          ]
        : []),
];

/** Ďalší spotrebič zvoleného dňa ako dlaždica na skle. @param {NonNullable<ReturnType<typeof terazModel>['co']>['riadky'][number]} r @returns {DlazdicaModelu} */
const riadokZModelu = (r) => ({
    id: r.id,
    tone: 'tiche',
    kind: r.kind,
    pred: r.pred,
    velky: r.cas,
    meno: r.name,
    odr: r.odr,
    mv: r.mv,
    podiel: r.podiel,
    potom: 'potom' in r ? r.potom : null,
});

/**
 * Poradie v stránke: dva stĺpce (shared/teraz-stlpce.js) striedavo po dlaždiciach.
 * @param {DlazdicaModelu[]} veci
 */
const vStlpcoch = (veci) => {
    const { lavy, pravy } = stlpceDlazdic(veci);
    return Array.from({ length: Math.max(lavy.length, pravy.length) }, (_, i) => [lavy[i], pravy[i]])
        .flat()
        .filter((d) => d !== undefined)
        .map(dlazdicaVStranke);
};

/** To isté z modelu. @param {ReturnType<typeof terazModel>} m */
const coZModelu = (m) => {
    const co = m.co;
    if (!co) return { den: '', dlazdice: [] };
    return {
        den: co.den
            ? `${co.den.popis} | ${[co.den.cisla.slnko, co.den.cisla.dom, co.den.cisla.siet.kw].map((v) => `${v}kWh`).join(' ')}`
            : '',
        dlazdice: vStlpcoch([...(co.den ? [] : horeZModelu(co.hore)), ...co.riadky.map(riadokZModelu)]),
    };
};

/** Minúta dňa pre čas „HH:MM“. @param {string} hm */
const minuta = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));

test.describe('karta Teraz', () => {
    // Napoludnie slnko, podvečer lacná sieť, večerná špička drahá sieť, v noci lacná sieť;
    // ráno živé meranie ešte slabé, plán dňa už počíta so slnkom.
    /** @type {Record<string, string | null>} */
    const pasma = { '13:00': 'sun', '19:30': 'cheap', '20:45': 'costly', '02:00': 'cheap', '08:00': null };
    for (const [hm, tone] of Object.entries(pasma)) {
        test(`o ${hm} ukazuje ten istý výkon, čo zapnúť a deň ako model`, async ({ page }) => {
            const time = at(hm);
            const errors = await openTeraz(page, { time });
            const vstup = vstupTeraz(time);
            const m = terazModel(vstup);
            const hero = heroModel(vstup);
            await expect.poll(() => terazVStranke(page)).toEqual(terazZModelu(m));
            // Pri čerstvom meraní je to presne heroModel - to isté, čo počíta karta Teraz.
            expect(m.num).toBe(hero.powerText);
            await expect.poll(() => coVStranke(page)).toEqual(coZModelu(m));
            // Všetky dlaždice rovnako vysoké, číslo, pásik aj odrážky vedľa seba na rovnakej výške.
            expect(await rozmeryDlazdic(page)).toEqual({ vysky: m.co ? 1 : 0, nezarovnane: 0 });
            await expect(page.locator('#tz-retry')).toBeHidden();
            await expect(page.locator('#tz-guess')).toBeHidden();
            // Plán dňa v tej chvíli: farba pásma, s ktorou ráta aj čo zapnúť.
            if (tone) expect(cellAt(planCells(dayPlan(vstup)), minuta(hm)).tone).toBe(tone);
            expect(errors).toEqual([]);
        });
    }

    test('dlaždica aj riadok otvoria detail spotrebiča z modelu; Escape, ťuknutie vedľa aj Späť ho zavrú', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 812 });
        const time = at('13:00');
        const errors = await openTeraz(page, { time });
        const m = terazModel(vstupTeraz(time));
        const panel = page.locator('#tz-vec-sheet');
        const vec = (/** @type {string} */ id) => page.locator(`#tz-co [data-vec="${id}"]`);
        await expect(panel).toBeHidden();
        for (const id of ['pracka', 'susicka']) {
            const v = m.veci.find((x) => x.id === id);
            if (!v) throw new Error(`model nemá ${id}`);
            await vec(id).click();
            await expect(panel).toBeVisible();
            await expect(page.locator('#tz-vec-name')).toHaveText(v.name);
            await expect(page.locator('#tz-vec-kedy')).toHaveText(v.kedy);
            await expect(page.locator('#tz-vec-cas')).toHaveText(v.cas);
            await expect(page.locator('#tz-vec-why')).toHaveText(v.why);
            await expect(page.locator('#tz-vec-note')).toHaveText('Naraz len toľko, koľko strecha utiahne.');
            // Úsek spotrebiča na osi dňa a dnes aj „teraz“.
            await expect(page.locator('#tz-vec-pas .os-usek')).toHaveAttribute('data-tone', v.slot?.tone ?? '');
            await expect(page.locator('#tz-vec-pas .os-teraz')).toHaveCount(1);
            expect(await vazneNalezy(page)).toEqual([]);
            // Okrem krížika vpravo hore je jediné tlačidlo „Už beží“. Escape vráti fokus na dlaždicu či riadok,
            // z ktorého sa detail otvoril.
            await expect(panel.locator('button:visible:not(.sheet-x)')).toHaveText([TERAZ_BEZI.zapol]);
            await page.keyboard.press('Escape');
            await expect(panel).toBeHidden();
            await expect(vec(id)).toBeFocused();
        }
        // Ťuknutie vedľa panelu (na stmavenú stránku nad ním) trafí dialóg a zavrie ho.
        await vec('pracka').click();
        await page.mouse.click(187, 60);
        await expect(panel).toBeHidden();
        // Krížik vpravo hore detail zavrie.
        await vec('susicka').click();
        await panel.getByRole('button', { name: 'Zavrieť' }).click();
        await expect(panel).toBeHidden();
        // Tlačidlo Späť v telefóne detail zavrie a ostane na karte.
        await vec('umyvacka').click();
        await expect(page.locator('#tz-vec-name')).toHaveText('Umývačka');
        await page.goBack();
        await expect(panel).toBeHidden();
        await ocakavajKartu(page, 'terazky');
        expect(errors).toEqual([]);
    });

    test('„Už beží“: kolieska zvyšku práčky, „Nastaviť“ zavrie panel s bublinou a „Vrátiť“, beh ostane po obnovení, „Nebeží“ ho zruší; umývačka s výberom času', async ({
        page,
    }) => {
        await page.setViewportSize({ width: 375, height: 812 });
        const time = at('13:00');
        const errors = await openTeraz(page, { time });
        const panel = page.locator('#tz-vec-sheet');
        const dlazdica = page.locator('#tz-co [data-vec="pracka"]');
        const bublina = page.locator('#vec-bublina');
        const kh = page.locator('#tz-vec-kh');
        const km = page.locator('#tz-vec-km');
        const d = '2026-09-05';
        await dlazdica.click();
        await page.locator('#tz-vec-zapol').click();
        // „Už beží“ len ukáže kolieska s celým programom - uloží až „Nastaviť“.
        await expect(page.locator('#tz-vec-zapol')).toBeHidden();
        await expect(page.locator('#tz-vec-ttl')).toHaveText(TERAZ_BEZI.zostava);
        await expect(kh).toHaveAttribute('aria-valuenow', '2');
        await expect(km).toHaveAttribute('aria-valuenow', '0');
        await expect(kh).toHaveAttribute('aria-label', TERAZ_BEZI.hodiny);
        await expect(page.locator('#tz-vec-konci')).toHaveText('skončí o 15:00');
        await expect(page.locator('#tz-vec-od')).toBeHidden();
        await expect(panel.locator('button:visible:not(.sheet-x)')).toHaveText([TERAZ_BEZI.nastav]);
        await expect(dlazdica).not.toHaveAttribute('data-tone', 'bezi');
        expect(await vazneNalezy(page)).toEqual([]);
        // Koliesko otočené na stred (2 h) a minúty ťahom - posúva ich prehliadač, appka si prečíta, kde zastali.
        expect(await kh.evaluate((e) => Math.round(e.scrollTop / /** @type {HTMLElement} */ (e.firstElementChild).offsetHeight))).toBe(2);
        await km.evaluate((e) => e.scrollTo({ top: 35 * /** @type {HTMLElement} */ (e.firstElementChild).offsetHeight }));
        await expect(km).toHaveAttribute('aria-valuenow', '35');
        await expect(page.locator('#tz-vec-konci')).toHaveText('skončí o 15:35');
        // Klávesnica: šípka hore ubere hodinu, ťuknutie na číslo ho dá do stredu.
        await kh.focus();
        await page.keyboard.press('ArrowUp');
        await expect(kh).toHaveAttribute('aria-valuenow', '1');
        await km.locator('div').nth(25).click();
        await expect(km).toHaveAttribute('aria-valuenow', '25');
        await expect(page.locator('#tz-vec-konci')).toHaveText('skončí o 14:25');
        expect(await page.evaluate((k) => localStorage.getItem(k), BEZI_STORAGE_KEY)).toBeNull();
        // „Nastaviť“ uloží, zavrie panel a bublina povie, čo sa nastavilo.
        await page.locator('#tz-vec-ok').click();
        await expect(panel).toBeHidden();
        await expect(bublina).toBeVisible();
        await expect(page.locator('#vec-bublina-text')).toHaveText(/^Práčka skončí o 14:25( · .+)?$/);
        await expect(page.locator('#vec-bublina-vrat')).toHaveText(TERAZ_BEZI.vratit);
        await expect(dlazdica).toHaveAttribute('data-tone', 'bezi');
        // „Vrátiť“ zmenu vráti - pred ňou práčka nebežala.
        await page.locator('#vec-bublina-vrat').click();
        await expect(bublina).toBeHidden();
        await expect(dlazdica).not.toHaveAttribute('data-tone', 'bezi');
        expect(await page.evaluate((k) => localStorage.getItem(k), BEZI_STORAGE_KEY)).toBe('[]');
        // Znova, tentoraz to ostane.
        await dlazdica.click();
        await page.locator('#tz-vec-zapol').click();
        await kh.focus();
        await page.keyboard.press('ArrowUp');
        await km.focus();
        await page.keyboard.press('PageDown');
        await page.keyboard.press('PageDown');
        await page.keyboard.press('PageDown');
        await page.keyboard.press('PageDown');
        await page.keyboard.press('PageDown');
        await expect(page.locator('#tz-vec-konci')).toHaveText('skončí o 14:25');
        await page.locator('#tz-vec-ok').click();
        await expect(panel).toBeHidden();
        const posunuty = terazModel(vstupTeraz(time, { bezi: [{ id: 'pracka', d, m: 12 * 60 + 25, k: 14 * 60 + 25 }] }));
        const t = posunuty.co?.bezi[0];
        await expect(dlazdica).toHaveAttribute('data-tone', 'bezi');
        // Bežiaci spotrebič má plný biely kruh ikony (docs/navrhy/teraz-zapnuty-farba.html, F1), sušička nie.
        await expect(dlazdica).toHaveAttribute('data-zapnuty', '');
        await expect(dlazdica.locator('.dl-ico')).toHaveCSS('background-color', 'rgb(242, 245, 251)');
        await expect(dlazdica.locator('.dl-ico')).toHaveCSS('box-shadow', 'rgba(242, 245, 251, 0.65) 0px 0px 16px 0px');
        await expect(page.locator('#tz-co [data-vec="susicka"]')).not.toHaveAttribute('data-zapnuty');
        await expect(dlazdica.locator('.velky')).toHaveText(`${t?.pred} ${t?.velky}`);
        // Na oko značka konca a koľko ešte, slová má čítačka (docs/navrhy/teraz-dlazdice-cisla.html, B).
        await expect(dlazdica.locator('.velky .zn')).toHaveAttribute('data-zn', 'koniec');
        await expect(dlazdica.locator('.mv > span')).toHaveText((t?.mv ?? []).map((x) => x.t));
        await expect(dlazdica.locator('.mv ~ .sr')).toHaveText((t?.odr ?? []).map((x) => `, ${x}`).join(''));
        expect(await rozmeryDlazdic(page)).toEqual({ vysky: 1, nezarovnane: 0 });
        // Zápis je v telefóne: po obnovení stránky práčka stále beží a detail ukáže jej zvyšok.
        await page.reload();
        await page.locator('#nav-terazky').click();
        await expect(dlazdica).toHaveAttribute('data-tone', 'bezi');
        await dlazdica.click();
        const v = terazModel(vstupTeraz(time, { bezi: [{ id: 'pracka', d, m: 12 * 60 + 25, k: 14 * 60 + 25 }] })).veci.find(
            (x) => x.id === 'pracka',
        );
        await expect(page.locator('#tz-vec-kedy')).toHaveText(v?.kedy ?? '');
        await expect(page.locator('#tz-vec-why')).toHaveText(v?.why ?? '');
        await expect(kh).toHaveAttribute('aria-valuenow', '1');
        await expect(km).toHaveAttribute('aria-valuenow', '25');
        await expect(page.locator('#tz-vec-note')).toBeHidden();
        await expect(panel.locator('button:visible:not(.sheet-x)')).toHaveText([TERAZ_BEZI.nastav, TERAZ_BEZI.nebezi]);
        // „Nebeží“ tiež zavrie panel s bublinou.
        await page.locator('#tz-vec-zrus').click();
        await expect(panel).toBeHidden();
        await expect(page.locator('#vec-bublina-text')).toHaveText('Práčka nebeží');
        await expect(dlazdica).not.toHaveAttribute('data-tone', 'bezi');
        await expect(dlazdica).not.toHaveAttribute('data-zapnuty');
        expect(await page.evaluate((k) => localStorage.getItem(k), BEZI_STORAGE_KEY)).toBe('[]');
        // Umývačka zvyšok na displeji nemá: čas zapnutia výberom času telefónu, neskôr než teraz nie.
        await page.locator('#tz-co [data-vec="umyvacka"]').click();
        await page.locator('#tz-vec-zapol').click();
        await expect(page.locator('#tz-vec-kolesa')).toBeHidden();
        await expect(page.locator('#tz-vec-ttl')).toHaveText(TERAZ_BEZI.zapnuta);
        await expect(page.locator('#tz-vec-od')).toHaveValue('13:00');
        await expect(page.locator('#tz-vec-od')).toHaveAttribute('max', '13:00');
        await page.locator('#tz-vec-od').fill('12:45');
        await expect(page.locator('#tz-vec-konci')).toHaveText('skončí o 15:15');
        await page.locator('#tz-vec-ok').click();
        await expect(panel).toBeHidden();
        await expect(page.locator('#vec-bublina-text')).toHaveText(/^Umývačka skončí o 15:15( · .+)?$/);
        await expect(page.locator('#tz-co [data-vec="umyvacka"]')).toHaveAttribute('data-zapnuty', '');
        expect(errors).toEqual([]);
    });

    test('večer: auto zo slnka prepísané skutočnosťou, ostatné s núdzovým časom; zajtrajšok po ťuknutí v hrebeni s dňom aj v detaile', async ({
        page,
    }) => {
        // 21:20 po západe slnka: auto v Pláne dňa nie je, jeho dlaždica povie, čo by slnko dnes naozaj dalo
        // (docs/navrhy/auto-mimo-planu.html). Bez Huawei Northbound je dom naučený profil.
        const time = at('21:20');
        const errors = await openTeraz(page, { time });
        const m = terazModel(vstupTeraz(time));
        const auto = page.locator('#tz-dlazdice [data-vec="auto"]');
        const t = terazAutoText({ ...autoDnes(vstupTeraz(time)), vecer: true });
        await expect(auto.locator('.velky')).toHaveText(`${t.velky} ${t.za}`);
        await expect(auto.locator('b')).toHaveText('Auto');
        // Na oko kWh so značkou, slová má čítačka za menom (docs/navrhy/teraz-dlazdice-cisla.html, B).
        await expect(auto.locator('.mv > span')).toHaveText(t.mv.map((x) => x.t));
        await expect(auto.locator('.mv ~ .sr')).toHaveText(t.odr.map((x) => `, ${x}`).join(''));
        expect(await auto.evaluate((e) => [e.tagName, e.getAttribute('data-stlpec')])).toEqual(['BUTTON', 'p']);
        // Bez správ o nabíjaní (P1): detail len s menom a vetou, bez času a poznámky Plánu dňa.
        await auto.click();
        await expect(page.locator('#tz-vec-sheet')).toBeVisible();
        await expect(page.locator('#tz-vec-name')).toHaveText('Auto');
        await expect(page.locator('#tz-vec-veta')).toHaveText(vetaDlazdice(t.odr));
        await expect(page.locator('#tz-vec-cas')).toBeHidden();
        await expect(page.locator('#tz-vec-note')).toBeHidden();
        await page.keyboard.press('Escape');
        await expect(page.locator('#tz-vec-sheet')).toBeHidden();
        // Zamrazené číslo ostane po obnovení stránky.
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem('auto-den-v1') ?? 'null')?.vecer)).toBe(true);
        await expect.poll(() => coVStranke(page)).toEqual(coZModelu(m));
        // Čo sa dnes na slnko už nezmestí, má núdzový čas a povie, kedy pôjde celé zo slnka.
        await expect(page.locator('#tz-dlazdice .dl[data-kind="nudza"] .mv ~ .sr').first()).toHaveText(/, celá zajtra$/);
        // Zajtrajšok: ťuknutie na deň v hrebeni ukáže jeho plán s tokom dňa, dnešné dlaždice zmiznú.
        await page.locator('#tz-hreben-dni [data-den="1"]').click();
        const zajtra = terazModel(vstupTeraz(time), { den: 1 });
        await expect(page.locator('#tz-tok .sr')).toHaveText(zajtra.co?.den?.popis ?? '-');
        await expect(page.locator('#tz-dlazdice [data-tone="go"], #tz-dlazdice [data-tone="cheap"]')).toHaveCount(0);
        await expect.poll(() => coVStranke(page)).toEqual(coZModelu(zajtra));
        // Detail zajtrajšej veci: deň nad časom, úsek na osi, ale bez „teraz“.
        const later = zajtra.veci.find((v) => v.slot);
        if (!later) throw new Error('model nemá vec na zajtra');
        await page.locator(`#tz-dlazdice [data-vec="${later.id}"]`).click();
        await expect(page.locator('#tz-vec-cas .vec-den')).toHaveText('Zajtra');
        await expect(page.locator('#tz-vec-cas')).toHaveText(`Zajtra${later.cas}`);
        await expect(page.locator('#tz-vec-pas .os-usek')).toHaveCount(1);
        await expect(page.locator('#tz-vec-pas .os-teraz')).toHaveCount(0);
        expect(await vazneNalezy(page)).toEqual([]);
        expect(errors).toEqual([]);
    });

    test('slnko až o viac dní: hrebeň so zamračenými dňami pod hranicou a núdzové časy', async ({ page }) => {
        // Nedeľa a pondelok zamračené: slnko až v utorok 8. 9.
        const zamracene = structuredClone(weather);
        const keys = ['shortwave_radiation_instant', 'direct_normal_irradiance_instant', 'diffuse_radiation_instant'];
        for (const [i, t] of zamracene.hourly.time.entries())
            if (t.startsWith('2026-09-06') || t.startsWith('2026-09-07')) for (const k of keys) zamracene.hourly[k][i] *= 0.05;
        const time = at('19:50');
        const errors = await openTeraz(page, { time, pocasie: zamracene });
        const m = terazModel(vstupTeraz(time, { forecast: buildForecast(zamracene, time, SITE, PLANT) }));
        const h = m.hreben;
        if (!h) throw new Error('model nemá hrebeň');
        expect(h.dni.slice(0, 4).map((d) => d.nad)).toEqual([true, false, false, true]);
        await expect.poll(() => coVStranke(page)).toEqual(coZModelu(m));
        const dni = page.locator('#tz-hreben-dni button');
        await expect(dni).toHaveText(h.dni.map((d) => `${d.den} – ${d.nad ? d.name : `${d.name}, slnko na veľké spotrebiče nestačí`}`));
        expect(await dni.evaluateAll((s) => s.map((e) => [e.hasAttribute('data-nad'), e.getAttribute('aria-pressed')]))).toEqual(
            h.dni.map((d, i) => [d.nad, String(i === 0)]),
        );
        await expect(dni.nth(1)).toHaveAccessibleName('Ne – Zajtra, slnko na veľké spotrebiče nestačí');
        await expect(page.locator('#tz-hreben-dni .wi')).toHaveCount(h.dni.filter((d) => d.pocasie).length);
        await expect(page.locator('#tz-hreben-dni .pd-okna i')).toHaveCount(h.dni.reduce((n, d) => n + d.okna.length, 0));
        await expect(page.locator('#tz-dlazdice .dl[data-kind="nudza"] .mv ~ .sr').first()).toHaveText(/, celá v utorok$/);
        expect(await vazneNalezy(page)).toEqual([]);
        expect(errors).toEqual([]);
    });

    test('hrebeň týždňa: zajtra bez slnka - odznak na dlaždici, ťuknutie na deň ukáže jeho plán, zatvorenie detailu deň nechá a iná karta ho vráti na dnešok', async ({
        page,
    }) => {
        const zamracene = structuredClone(weather);
        const keys = ['shortwave_radiation_instant', 'direct_normal_irradiance_instant', 'diffuse_radiation_instant'];
        for (const [i, t] of zamracene.hourly.time.entries())
            if (t.startsWith('2026-09-06')) for (const k of keys) zamracene.hourly[k][i] *= 0.05;
        const time = at('10:00');
        const errors = await openTeraz(page, { time, pocasie: zamracene });
        const vstup = vstupTeraz(time, { forecast: buildForecast(zamracene, time, SITE, PLANT) });
        const dnes = terazModel(vstup);
        /** Veta toku dňa `den` pre čítačku. @param {number} den */
        const tokDna = (den) => terazModel(vstup, { den }).co?.den?.popis ?? '-';
        await expect.poll(() => coVStranke(page)).toEqual(coZModelu(dnes));
        // Odznak pri ikone je skratka dňa, veta „potom v pondelok“ je v skrytom texte dlaždice.
        await expect(page.locator('#tz-dlazdice .odz').first()).toHaveText('Po');
        await expect(page.locator('#tz-dlazdice .mv ~ .sr').first()).toContainText('potom v pondelok');
        await expect(page.locator('#tz-hreben-dni .pd-teraz')).toHaveCount(1);
        const dni = page.locator('#tz-hreben-dni button');
        // Zajtrajšok bez slnka: v toku dňa elektrina zo siete chýba a núdzové časy s pásikom podielu slnka.
        await dni.nth(1).click();
        const zajtra = terazModel(vstup, { den: 1 });
        await expect(dni.nth(1)).toHaveAttribute('aria-pressed', 'true');
        await expect(dni.nth(1)).toBeFocused();
        expect(zajtra.co?.den?.cisla.siet.k).toBe('dnu');
        await expect(page.locator('#tz-tok .sr')).toHaveText(tokDna(1));
        await expect.poll(() => coVStranke(page)).toEqual(coZModelu(zajtra));
        expect(
            await page
                .locator('#tz-dlazdice [data-kind]')
                .evaluateAll((e) => [...new Set(e.map((x) => /** @type {HTMLElement} */ (x).dataset.kind))]),
        ).toEqual(['nudza']);
        expect(await page.locator('#tz-dlazdice .podiel:not([data-prazdny])').count()).toBeGreaterThan(0);
        expect(await vazneNalezy(page)).toEqual([]);
        // Detail spotrebiča a jeho zatvorenie nechá zvolený deň.
        await page.locator('#tz-dlazdice [data-vec]').first().click();
        await expect(page.locator('#tz-vec-kedy')).toHaveText('Najmenej zo siete');
        await expect(page.locator('#tz-vec-cas .vec-den')).toHaveText('Zajtra');
        await page.keyboard.press('Escape');
        await expect(page.locator('#tz-vec-sheet')).toBeHidden();
        await expect(page.locator('#tz-tok .sr')).toHaveText(tokDna(1));
        // Deň so slnkom a späť na dnešok.
        await dni.nth(2).click();
        await expect(page.locator('#tz-tok .sr')).toHaveText(tokDna(2));
        await expect(page.locator('#tz-dlazdice [data-kind]').first()).toHaveAttribute('data-kind', 'later');
        await dni.nth(0).click();
        await expect(page.locator('#tz-tok')).not.toHaveAttribute('data-den');
        await expect.poll(() => coVStranke(page)).toEqual(coZModelu(dnes));
        // Odchod z karty zvolený deň zahodí.
        await dni.nth(2).click();
        await page.locator('nav [data-panel="mozem"]').click();
        await ocakavajKartu(page, 'mozem');
        await page.locator('nav [data-panel="terazky"]').click();
        await ocakavajKartu(page, 'terazky');
        await expect(page.locator('#tz-tok')).not.toHaveAttribute('data-den');
        await expect(dni.nth(0)).toHaveAttribute('aria-pressed', 'true');
        expect(errors).toEqual([]);
    });

    test('bez merania: biely pás pod číslom povie, že je to odhad, a vedie do Nastavenia', async ({ page }) => {
        const errors = await openObloha(page, { time: at('13:00'), settings: { ...OWNER, zdroj: null } });
        await page.locator('#nav-terazky').click();
        const m = terazModel(vstupTeraz(at('13:00'), { zdroj: null, pv: null }));
        await expect.poll(() => terazVStranke(page)).toEqual(terazZModelu(m));
        await expect(page.locator('#hdr-live')).toHaveAttribute('data-tone', 'odhad');
        await expect(page.locator('#tz-note-title')).toHaveText(m.note?.title ?? '');
        await expect(page.locator('#tz-note-text')).toHaveText(m.note?.text ?? '');
        await expect(page.locator('#tz-note-btn')).toHaveText(m.note?.btn ?? '');
        await page.locator('#tz-note-btn').click();
        await ocakavajKartu(page, 'nastavenie');
        expect(errors).toEqual([]);
    });

    test('meranie neodpovedá: číslo je odhad a povie, kedy prišlo posledné meranie', async ({ page }) => {
        const stare = pvAt(at('11:40'));
        const errors = await openObloha(page, { time: at('13:00'), pvData: stare });
        await page.locator('#nav-terazky').click();
        const m = terazModel(vstupTeraz(at('13:00'), { pv: stare }));
        await expect.poll(() => terazVStranke(page)).toEqual(terazZModelu(m));
        await expect(page.locator('#hdr-live')).toHaveAttribute('data-tone', 'stale');
        await expect(page.locator('#tz-note-title')).toHaveText(m.note?.title ?? '');
        await expect(page.locator('#tz-note-text')).toHaveText(
            /^Meranie neodpovedá od \d\d:\d\d\. Kým sa neozve, číslo počíta z počasia\.$/,
        );
        await expect(page.locator('#tz-note-btn')).toBeHidden();
        await expect(page.locator('#tz-co')).toBeVisible();
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
        await page.goto('/');
        await appReady(page);
        await page.locator('#nav-terazky').click();

        const bez = terazModel(vstupTeraz(FIXED_NOW, { pv: null, forecast: null }));
        await expect.poll(() => terazVStranke(page)).toEqual(terazZModelu(bez));
        await expect(page.locator('#tz-scena')).toBeHidden();
        await expect(page.locator('#tz-sub')).toHaveText(/^Predpoveď počasia neprišla.* Ani meranie zo strechy neodpovedá\./);
        // Žiadne vymyslené čísla: čo zapnúť sa neukáže.
        await expect(page.locator('#tz-co')).toBeHidden();
        const znova = page.locator('#tz-retry');
        await expect(znova).toHaveText('Skúsiť znova');
        await expect(znova).toBeVisible();

        offline = false;
        await znova.click();
        await expect.poll(() => terazVStranke(page)).toEqual(terazZModelu(terazModel(vstupTeraz(FIXED_NOW))));
        await expect(znova).toBeHidden();
        await expect(page.locator('#tz-co')).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('poloha bez panelov: „~“, typická strecha a výzva do Nastavenia', async ({ page }) => {
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
        await expect(page.locator('#tz-scena')).toHaveAttribute('aria-label', /^Zo slnka ~\d/);
        await expect(page.locator('#tz-sub')).toHaveText('typická strecha asi 5 kWp v tvojej obci, nie tvoja');
        await expect(page.locator('#tz-guess-title')).toHaveText('Koľko dáva tvoja strecha?');
        expect(await page.locator('#tz-guess').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
        await page.locator('#tz-guess-btn').click();
        await ocakavajKartu(page, 'nastavenie');
        expect(errors).toEqual([]);
    });

    test('bez polohy: len výzva zadať polohu, bez odporúčaní', async ({ page }) => {
        const errors = await openTeraz(page, { settings: null });
        await expect(page.locator('#tz-ask')).toBeVisible();
        await expect(page.locator('#tz-co')).toBeHidden();
        await expect(page.locator('#tz-scena')).toBeHidden();
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
        await page.goto('/');
        await appReady(page);
        await page.locator('#nav-terazky').click();
        // Bez vety „Načítavam…“: čakanie ukazuje len obrazec v strede obrazovky.
        await expect(page.locator('#tz-svitanie')).toBeVisible();
        await expect(page.locator('#tz-sub')).toBeHidden();
        await expect(page.locator('#tz-stav')).toBeHidden();
        await expect(page.locator('#tz-retry')).toBeHidden();
        await expect(page.locator('#tz-scena')).toBeHidden();
        pusti();
        await expect(page.locator('#tz-co')).toBeVisible();
    });

    test('prístupnosť: žiadne závažné nálezy axe na Teraz ani bez dát', async ({ page }) => {
        await openTeraz(page, { time: at('13:00') });
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

test.describe('posuvník dňa prstom', () => {
    test.use({ hasTouch: true });

    /** Bod na posuvníku dňa pre minútu dňa, v pixeloch okna. @param {import('@playwright/test').Page} page @param {number} min */
    const bodOsi = async (page, min) => {
        const box = await page.locator('#mz-os').boundingBox();
        if (!box) throw new Error('posuvník nie je vidno');
        return { x: box.x + (box.width * min) / 1440, y: box.y + 20 };
    };

    test('ťuknutie bez pohybu presunie bežec a nechá ho tam', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        const errors = await openObloha(page, { time: at('13:00') });
        await naDnes(page);
        await prst(page, await bodOsi(page, minuta('16:00')));
        await expect(page.locator('#mz-stav span')).toHaveText('16:00');
        await page.waitForTimeout(2000);
        await expect(page.locator('#mz-stav span')).toHaveText('16:00');
        await expect(page.locator('#mz-odtlacok')).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('zvislý ťah cez posuvník čas nezmení', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        const errors = await openObloha(page, { time: at('13:00') });
        await naDnes(page);
        await prst(page, { ...(await bodOsi(page, minuta('09:00'))), dy: 160 });
        await page.waitForTimeout(300);
        await expect(page.locator('#mz-os')).toHaveAttribute('aria-valuenow', String(minuta('13:00')));
        await expect(page.locator('#mz-odtlacok')).toBeHidden();
        expect(errors).toEqual([]);
    });

    test('rýchly vodorovný ťah po posuvníku posunie čas a kartu neprelistuje', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        const errors = await openObloha(page, { time: at('13:00') });
        await naDnes(page);
        const bod = await bodOsi(page, minuta('16:00'));
        const ciel = await bodOsi(page, minuta('09:00'));
        // Švihnutie doľava ako pri listovaní kariet: rýchle a ďaleko.
        await prstTah(page, { ...bod, dx: ciel.x - bod.x, krokMs: 20 });
        await expect(page.locator('#mz-stav span')).toHaveText('09:00');
        await page.waitForTimeout(300);
        await ocakavajKartu(page, 'mozem');
        expect(errors).toEqual([]);
    });
});

test.describe('karta Dnes po kontrole kroku 2', () => {
    for (const width of [390, 320]) {
        test(`šírka ${width} px: časy východu a západu pod posuvníkom sú celé a odsadené od okraja`, async ({ page }) => {
            await page.setViewportSize({ width, height: 800 });
            const errors = await openObloha(page);
            await naDnes(page);
            const casy = await page.locator('#mz-os .mz-os-cas').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
            expect(casy).toHaveLength(2);
            const sirka = await page.evaluate(() => innerWidth);
            for (const t of casy) {
                expect(t.left, 'čas pod posuvníkom je pri ľavom okraji').toBeGreaterThanOrEqual(14);
                expect(sirka - t.right, 'čas pod posuvníkom je pri pravom okraji').toBeGreaterThanOrEqual(14);
            }
            expect(errors).toEqual([]);
        });
    }

    test('výzva bez panelov píše výkon typickej strechy zaokrúhlene', async ({ page }) => {
        const errors = await openObloha(page, { settings: null, site: SITE });
        await naDnes(page);
        await expect(page.locator('#mz-guess-text')).toHaveText(/Rátam s typickou strechou asi 5 kWp\./);
        await expect(page.locator('#mz-guess-text')).not.toHaveText(/5,22/);
        expect(errors).toEqual([]);
    });
});

for (const width of [390, 320]) {
    test(`karta Teraz a Dnes na šírke ${width} px: nič nepretečie, číslo a dlaždice sú celé, tlačidlá aspoň 44 px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        const errors = await openTeraz(page, { time: at('13:00') });
        /** Prvky, ktoré trčia z obrazovky. @param {string[]} sels */
        const trcia = (sels) =>
            page.evaluate(
                (list) =>
                    list
                        .map((sel) => ({ sel, box: /** @type {Element} */ (document.querySelector(sel)).getBoundingClientRect() }))
                        .filter(({ box }) => box.left < 0 || box.right > innerWidth + 0.5)
                        .map(({ sel }) => sel),
                sels,
            );
        expect(await trcia(['#tz-scena', '#tz-stav', '#tz-dlazdice']), 'tieto prvky trčia z obrazovky').toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'stránka ide do strán').toBe(true);
        for (const sel of ['#tz-dlazdice [data-vec]'])
            for (const box of await page.locator(sel).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height)))
                expect(box, sel).toBeGreaterThanOrEqual(44);
        // Mená v dlaždiciach sa nezalomia uprostred slova: ani nepretečú, ani slovo nemá časť na ďalšom riadku
        // (overflow-wrap: anywhere by ho inak potichu rozdelil, docs/navrhy/teraz-dlazdice.html).
        const zlomene = await page.locator('#tz-dlazdice b').evaluateAll((els) =>
            els
                .filter((b) => {
                    if (b.scrollWidth > b.clientWidth + 0.5) return true;
                    const uzol = b.firstChild;
                    if (!uzol) return false;
                    const text = uzol.textContent ?? '';
                    const range = document.createRange();
                    return [...text.matchAll(/\S+/g)].some((w) => {
                        range.setStart(uzol, w.index);
                        range.setEnd(uzol, w.index + w[0].length);
                        return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size > 1;
                    });
                })
                .map((b) => b.textContent),
        );
        expect(zlomene).toEqual([]);
        // Karta Dnes: v nízkych dlaždiciach (aj v polovici dvojice) sa nič neoreže (docs/navrhy/dnes-nizsie-dlazdice.html).
        await page.locator('#nav-mozem').click();
        await ocakavajKartu(page, 'mozem');
        const pretecie = await page.locator('#mz-karty .cast').evaluateAll((els) =>
            els
                .filter((e) => {
                    // Tlačidlo cez celé pole presahuje kartu zámerne (docs/navrhy/dnes-bubliny-poli.html) - kým sa meria, nie je.
                    const tap = e.querySelector(':scope > .cast-tap');
                    tap?.classList.add('hidden');
                    const von = e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1;
                    tap?.classList.remove('hidden');
                    return von;
                })
                .map((e) => e.getAttribute('data-kind')),
        );
        expect(pretecie, 'tieto karty v dlaždici pretečú').toEqual([]);
        expect(errors).toEqual([]);
    });
}

// ---- Karta 7 dní (krok 4) ----------------------------------------------------------
// Očakávané texty počíta tá istá funkcia ako appka (shared/sedem-dni.js nad weekStatsModel,
// weekListModel a plánom dňa) z tých istých dát.

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
 * Otvorí appku na karte 7 dní.
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
            expect(m.title).toBe('Veľké pranie? Štvrtok.');
            await expect(page.locator('#sd-days .day')).toHaveCount(7);
            await expect(page.locator('#sd-days .day.best')).toHaveCount(1);
            await expect(page.locator('#sd-hint')).toHaveText(
                'Zelený pás ukazuje, odkedy dokedy slnko stačí na veľké spotrebiče, zelená linka pod číslom najlepší deň týždňa. Ťukni na deň.',
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
        await expect(page.locator('#sd-days .day').nth(2)).toHaveAttribute('aria-label', /, Pondelok, zamračené, /);
        expect(errors).toEqual([]);
    });

    test('detail dneška: tri čísla, hláška a „teraz“ ako model; iný deň bez „teraz“', async ({ page }) => {
        const errors = await openSedem(page);
        await page.locator('#sd-days [data-day="0"]').click();
        await expect(page.locator('#sd-day')).toBeVisible();
        await expect(page.locator('#sd-list')).toBeHidden();
        const d = sedemDayModel(vstupSedem(), 0);
        await expect.poll(() => denVStranke(page)).toEqual(denZModelu(d));
        // „Teraz“ je bod na krivke, čiara s časom a stlmené bunky pásu, ktoré už prešli.
        await expect(page.locator('#sd-day-chart .dc-now-dot')).toHaveCount(1);
        const prešlo = d.chart.cells.filter((c) => c.past).length;
        expect(prešlo).toBeGreaterThan(0);
        await expect(page.locator('#sd-day-chart .dc-past')).toHaveCount(prešlo);
        await expect(page.locator('#sd-day-chart .dc-prev')).toHaveCount(1);
        await expect(page.locator('#sd-day-chart .dc-at-t')).toHaveText('13:00');
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
        await expect(page.locator('#sd-day-chart .dc-now-dot')).toHaveCount(0);
        await expect(page.locator('#sd-day-chart .dc-prev')).toHaveCount(0);
        await expect(page.locator('#sd-day-chart .dc-past')).toHaveCount(0);
        await expect(page.locator('#sd-day-done')).toBeHidden();
        expect(errors).toEqual([]);
    });

    test('deň bez okna: prázdny pás v riadku, v detaile „bez okna“ a hláška pre slabý deň', async ({ page }) => {
        const errors = await pripravSiet(page);
        await page.unroute(/api\.open-meteo\.com/);
        await page.route(/api\.open-meteo\.com/, (route) => route.fulfill({ json: slabyTyzden }));
        await page.clock.setFixedTime(FIXED_NOW);
        await page.goto('/');
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
        await ocakavajKartu(page, 'terazky');
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
        await ocakavajKartu(page, 'terazky');
        expect(errors).toEqual([]);
    });
});

test.describe('karta 7 dní: detail dňa bez cien zo siete', () => {
    // Zoznam cien po úsekoch v detaile nie je: lacnú a drahú sieť ukazuje farebný pás plánu
    // s legendou. Pod grafom ostáva len to, čo už nabehlo, a čo by dala jasná obloha.
    const PRICED = { ...TARIFF, bands: TARIFF.bands.map((b) => ({ ...b, price: b.id === 'nt' ? 0.14 : 0.19 })) };
    for (const size of [
        { width: 390, height: 844 },
        { width: 1440, height: 900 },
    ])
        for (const [tarifa, tariff] of /** @type {const} */ ([
            ['s cenami', PRICED],
            ['bez cien', TARIFF],
        ]))
            for (const voice of /** @type {const} */ (['drzy', 'slusny']))
                test(`šírka ${size.width} px, tarifa ${tarifa}, tón ${voice}: dnes aj iný deň bez „Cena zo siete“`, async ({ page }) => {
                    await page.setViewportSize(size);
                    const look = JSON.stringify(lookToStored({ voice, liveSky: true }));
                    await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [LOOK_STORAGE_KEY, look]);
                    const errors = await openObloha(page, { settings: { ...OWNER, tariff } });
                    if (size.width === 390) await page.locator('#nav-7dni').click();
                    for (const index of [0, 4]) {
                        await page.locator(`#sd-days [data-day="${index}"]`).click();
                        await expect(page.locator('#sd-day')).toBeVisible();
                        const d = sedemDayModel(vstupSedem({ tariff }), index, voice);
                        await expect(page.locator('#sd-day-title')).toHaveText(d.title);
                        await expect(page.locator('#sd-day-msg-title')).toHaveText(d.message.title);
                        await expect(page.locator('#sd-day')).not.toContainText('Cena zo siete');
                        await expect(page.locator('#sd-day-facts > *')).toHaveCount(2);
                        const riadky = [d.done, d.clear].filter(Boolean);
                        await expect(page.locator('#sd-day-facts > :visible')).toHaveText(riadky);
                        await expect(page.locator('#sd-day-facts')).toBeVisible({ visible: riadky.length > 0 });
                        await expect(page.locator('#sd-day-chart rect[data-from]')).toHaveCount(d.chart.cells.length);
                        await expect(page.locator('#sd-day-legend span')).toHaveText(d.chart.legend.map((l) => l.text));
                        await page.locator('#sd-day-back').click();
                        await expect(page.locator('#sd-list')).toBeVisible();
                    }
                    expect(errors).toEqual([]);
                });
});

test.describe('karta 7 dní prstom', () => {
    test.use({ hasTouch: true });

    test('v detaile dňa ťah doľava ide na ďalší deň, doprava späť, z dneška doprava nikam', async ({ page }) => {
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
        // Z dneška ťah doprava detail nezatvorí - späť vedie šípka v riadku čipov.
        await tahNad(page, '#sd-day-sub', 160);
        await page.waitForTimeout(400);
        await expect(page.locator('#sd-day-title')).toHaveText('Dnes 5.9.');
        await page.locator('#sd-day-back').click();
        await expect(page.locator('#sd-list')).toBeVisible();
        await ocakavajKartu(page, '7dni');
        // Listovanie dní nebolo krokom navigácie: Späť z prehľadu ide na predošlú kartu.
        await page.goBack();
        await ocakavajKartu(page, 'terazky');
        expect(errors).toEqual([]);
    });

    test('v detaile týždňa ani v prehľade ťah do strán nerobí nič', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        const errors = await openSedem(page);
        await page.locator('#sd-sum').click();
        await expect(page.locator('#sd-week')).toBeVisible();
        await tahNad(page, '#sd-week-range', -160);
        await expect(page.locator('#sd-week')).toBeVisible();
        await tahNad(page, '#sd-week-range', 160);
        await expect(page.locator('#sd-week')).toBeVisible();
        await page.locator('#sd-week-back').click();
        await expect(page.locator('#sd-list')).toBeVisible();
        await tahNad(page, '#sd-title', 160);
        await ocakavajKartu(page, '7dni');
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
        await page.goto('/');
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
        await page.goto('/');
        await appReady(page);
        await page.locator('#nav-7dni').click();
        await expect(page.locator('#sd-sub')).toHaveText('Načítavam…');
        await expect(page.locator('#sd-retry')).toBeHidden();
        await expect(page.locator('#sd-days')).toBeHidden();
        pusti();
        await expect(page.locator('#sd-days .day')).toHaveCount(7);
    });

    test('rýchly štart: počasie z minulého otvorenia ukáže dni hneď, staršie než 12 hodín nie', async ({ page }) => {
        const errors = await openSedem(page);
        await expect(page.locator('#sd-days .day')).toHaveCount(7);
        // Ďalšie otvorenia s pomalou sieťou: Open-Meteo ani Worker neodpovedia, kým ich test nepustí.
        /** @type {() => void} */
        let pusti = () => {};
        let brana = new Promise((r) => (pusti = () => r(undefined)));
        await page.route(/api\.open-meteo\.com/, async (route) => {
            await brana;
            await route.fulfill({ json: weather });
        });
        await page.route(WORKER_PV_URL, async (route) => {
            await brana;
            await route.fulfill({ json: { pv } });
        });
        /** @param {number} hodin */
        const otvorNeskor = async (hodin) => {
            await page.clock.setFixedTime(new Date(FIXED_NOW.getTime() + hodin * 3_600_000));
            await page.reload();
            await appReady(page);
            await page.locator('#nav-7dni').click();
        };
        // O dve hodiny: počasie treba stiahnuť znova, no dni sú tu z odloženého, kým appka ešte načítava.
        await otvorNeskor(2);
        await expect(page.locator('#hdr-status')).toHaveText('');
        await expect(page.locator('#sd-days .day')).toHaveCount(7);
        pusti();
        await expect(page.locator('#hdr-status')).toHaveText(/\S/);
        await expect(page.locator('#sd-days .day')).toHaveCount(7);
        // O 15 hodín je aj posledné stiahnuté počasie (o 2 hodiny) priveľmi staré: len načítavanie.
        brana = new Promise((r) => (pusti = () => r(undefined)));
        await otvorNeskor(15);
        await expect(page.locator('#sd-sub')).toHaveText('Načítavam…');
        await expect(page.locator('#sd-days')).toBeHidden();
        pusti();
        await expect(page.locator('#sd-days .day')).toHaveCount(7);
        expect(errors).toEqual([]);
    });

    test('poloha bez panelov: typická strecha, odhad v riadkoch a výzva do Nastavenia', async ({ page }) => {
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

test.describe('počasie v pozadí karty Teraz', () => {
    test('stav z jadra cez deň aj v noci, len na karte Teraz', async ({ page }) => {
        const errors = await openTeraz(page, { time: at('13:00') });
        const den = terazModel(vstupTeraz(at('13:00'))).pocasie;
        if (!den) throw new Error('model o 13:00 nemá počasie');
        await expect(page.locator('#wx')).toBeVisible();
        await expect(page.locator('#wx')).toHaveAttribute('data-wx', pocasieStav(den));
        if (den.dazd) await expect(page.locator('#wx')).toHaveAttribute('data-dazd', den.dazd);
        else await expect(page.locator('#wx')).not.toHaveAttribute('data-dazd');
        await expect(page.locator('#wx')).not.toHaveAttribute('data-noc');
        // Kresba je dekorácia: čítačka ju nevidí a dotyk prejde cez ňu.
        await expect(page.locator('#wx')).toHaveAttribute('aria-hidden', 'true');
        expect(await page.locator('#wx').evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
        // Na karte Dnes je kresba v čase jej posuvníka (teraz po otvorení) a slnko na dennej dráhe.
        await page.locator('#nav-mozem').click();
        await expect(page.locator('#wx')).toHaveAttribute('data-dnes', '');
        await expect(page.locator('#wx')).toHaveAttribute('data-wx', pocasieStav(den));
        await page.locator('#nav-radar').click();
        await expect(page.locator('#wx')).toBeHidden();
        await page.locator('#nav-terazky').click();
        await expect(page.locator('#wx')).not.toHaveAttribute('data-dnes');
        expect(errors).toEqual([]);
    });

    for (const sel of ['#wx'])
        test(`dážď v štyroch silách (${sel}): každá má svoje kvapky, mrholenie bez blízkych`, async ({ page }) => {
            const errors = await openTeraz(page, { time: at('13:00') });
            await page.locator(sel).scrollIntoViewIfNeeded();
            const kresby = [];
            for (const sila of ['mrholenie', 'slaby', 'dazd', 'silny']) kresby.push(await dazdKresba(page, sila, sel));
            for (const k of kresby) expect(k[1]).toMatch(/^url\("data:image\/svg\+xml,/);
            expect(kresby.map((k) => k[2] === 'skryté')).toEqual([true, false, false, false]);
            expect(new Set(kresby.map((k) => k[0])).size).toBe(4);
            expect(errors).toEqual([]);
        });

    test('v noci bez slnka, Mesiac len tam, kde naozaj je', async ({ page }) => {
        const vecer = at('22:30');
        const errors = await openTeraz(page, { time: vecer });
        expect(terazModel(vstupTeraz(vecer)).pocasie?.mesiac, 'o 22:30 ešte nevyšiel do poľa').toBeNull();
        await expect(page.locator('#wx')).toHaveAttribute('data-noc', '');
        // Sklo dlaždíc podľa oblohy (docs/navrhy/teraz-dlazdice-sklo.html, 1): na tmavej nočnej oblohe vyjde svetlé.
        const sklo = await page.evaluate(() => document.documentElement.style.getPropertyValue('--dl-sklo'));
        expect(sklo).toMatch(/^rgba\(/);
        await expect(page.locator('#tz-dlazdice .dl').first()).toHaveCSS('background-color', sklo);
        expect(Number(sklo.slice(5).split(',')[0]), 'svetlé sklo').toBeGreaterThan(50);
        await expect(page.locator('#wx .wx-moon svg')).toHaveCount(0);
        await expect(page.locator('#wx .wx-moonglow svg')).toHaveCount(0);
        await expect(page.locator('#wx .wx-halo')).toBeHidden();
        expect(errors).toEqual([]);
    });

    test('okná domu v scéne svietia v tme, od polnoci do piatej nie', async ({ browser }) => {
        for (const [cas, svieti] of /** @type {[Date, boolean][]} */ ([
            [at('13:00'), false],
            [at('22:30'), true],
            [new Date('2026-09-06T01:30:00+02:00'), false],
        ])) {
            const noc = terazModel(vstupTeraz(cas)).pocasie?.noc === true;
            expect(oknaSvietia(noc, cas, SITE.timezone), `výpočet o ${cas.toISOString()}`).toBe(svieti);
            const page = await browser.newPage();
            const errors = await openTeraz(page, { time: cas });
            await expect(page.locator('#tz-scena')).toBeVisible();
            await expect(page.locator('#tz-scena-kresba .sc-okna')).toHaveCount(svieti ? 1 : 0);
            expect(errors).toEqual([]);
            await page.close();
        }
    });

    test('Mesiac stojí v tom istom poli ako hviezdy a osvetlenou stranou k Slnku', async ({ page }) => {
        const rano = new Date('2026-09-06T02:30:00+02:00');
        const errors = await openTeraz(page, { time: rano });
        const m = terazModel(vstupTeraz(rano)).pocasie?.mesiac;
        if (!m) throw new Error('model nemá Mesiac');
        const stav = await page.locator('#wx').evaluate((wx) => ({
            transform: wx.querySelector('.wx-moon g')?.getAttribute('transform'),
            hviezdy: wx.querySelector('.wx-stars svg')?.getBoundingClientRect().toJSON(),
            mesiac: wx.querySelector('.wx-moon svg')?.getBoundingClientRect().toJSON(),
        }));
        expect(stav.transform).toContain(`translate(${m.x} ${m.y})`);
        expect(stav.transform).toContain(`rotate(${270 - m.uhol})`);
        expect(stav.mesiac).toEqual(stav.hviezdy);
        await expect(page.locator('#wx .wx-moon g')).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('na karte Dnes je obloha od čiary posuvníka (obzor) po vrch obrazovky (zenit), Mesiac v nej', async ({ page }) => {
        await page.setViewportSize({ width: 360, height: 780 });
        const rano = new Date('2026-09-06T02:30:00+02:00');
        const errors = await openTeraz(page, { time: rano });
        await naDnes(page);
        const n = dnesNeboModel(vstupTeraz(rano), null);
        const m = n?.pocasie?.mesiac;
        if (!m) throw new Error('model karty Dnes nemá Mesiac');
        expect(n?.pocasie?.pole).toEqual(HVIEZDY.dnes);
        await expect(page.locator('#wx .wx-moon g')).toHaveAttribute('transform', new RegExp(`translate\\(${m.x} ${m.y}\\)`));
        const stav = await page.evaluate(() => ({
            wx: document.querySelector('#wx')?.getBoundingClientRect().toJSON(),
            hviezdy: document.querySelector('#wx .wx-stars svg')?.getBoundingClientRect().toJSON(),
            mesiac: document.querySelector('#wx .wx-moon svg')?.getBoundingClientRect().toJSON(),
            ciara: document.querySelector('#mz-os .mz-os-ciara')?.getBoundingClientRect().toJSON(),
            viewBox: document.querySelector('#wx .wx-stars svg')?.getAttribute('viewBox'),
        }));
        if (!stav.wx || !stav.hviezdy || !stav.ciara) throw new Error('pole hviezd alebo posuvník nie je');
        expect(stav.viewBox).toBe(`0 0 ${HVIEZDY.dnes.sirka} ${HVIEZDY.dnes.vyska}`);
        expect(stav.mesiac).toEqual(stav.hviezdy);
        expect(Math.abs(stav.hviezdy.top - stav.wx.top)).toBeLessThanOrEqual(1);
        expect(Math.abs(stav.hviezdy.bottom - (stav.ciara.top + stav.ciara.height / 2))).toBeLessThanOrEqual(1);
        expect(errors).toEqual([]);
    });

    test('vypnutá živá obloha vypne aj počasie', async ({ page }) => {
        await page.addInitScript(
            ([k, v]) => localStorage.setItem(k, v),
            [LOOK_STORAGE_KEY, JSON.stringify(lookToStored({ voice: 'drzy', liveSky: false }))],
        );
        const errors = await openTeraz(page);
        await expect(page.locator('#wx')).toBeHidden();
        expect(errors).toEqual([]);
    });

    test('v prehľade so stĺpcami nie je', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const errors = await openObloha(page, { pvData: pvAt(FIXED_NOW) });
        await expect(page.locator('#panel-terazky')).toBeVisible();
        await expect(page.locator('#wx')).toBeHidden();
        expect(errors).toEqual([]);
    });
});
