// E2E: appka s pevným časom a dátami z fixtures. Očakávané texty sa počítajú tou istou
// doménovou logikou (shared/), takže test chytí rozdiel medzi modelom a tým, čo je v DOM.
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { bestDayIndex, dayTimelineModel, RING, usePct, weekDayTiers, weekHeatMax, weekHeatModel } from '../../shared/chart-model.js';
import {
    ALL_MONTHS,
    APP_URL,
    installedKw,
    PLANT,
    powerThresholds,
    DAYLOG_STORAGE_KEY,
    OLD_STORAGE_KEYS,
    SETTINGS_STORAGE_KEY,
    SITE_STORAGE_KEY,
    START_STORAGE_KEY,
    STORAGE_KEYS,
    SITE,
    SWIPE,
    TARIFF,
    TARIFF_LIMITS,
    TOOLTIP_FADE_MS,
    TOOLTIP_HOLD_MS,
    WEEK_MSG_MIN_H,
    WORKER_PRIPOJ_URL,
    WORKER_PV_URL,
    SHARE_HASH_KEY,
    SHARE_LINK_VERSION,
} from '../../shared/config.js';
import * as config from '../../shared/config.js';
import { dayPlan, fitSegments, forecastDayPlan } from '../../shared/day-plan.js';
import { cellAt, chartX, DAY_CHART, planCells } from '../../shared/day-chart.js';
import { terazModel } from '../../shared/teraz.js';
import { odmietnute, pristupModel } from '../../shared/pristup.js';
import { mainWindow, sunWindows, windowBand } from '../../shared/sedem-dni.js';
import { heroModel } from '../../shared/hero-model.js';
import { dayNameShort, fmt1, fmtSum, hourLabel, kwpText, minutesToTimeStr, weekDayLong } from '../../shared/format.js';
import { PANELS } from '../../web/dom.js';
import { useTier } from '../../web/render/sedemdni.js';
import { kwhText, moneyText } from '../../web/render/statistika.js';
import { statsModel } from '../../shared/stats.js';
import { doplnSucty, suctyZdroj } from '../../shared/sucty.js';
import { mozemModel } from '../../shared/mozem.js';
import { SUMMARY_PERIODS, summaryModel } from '../../shared/summary.js';
import { dayWindowCard, fitLabel, MOZEM_SKY_TEXTS, mozemListTitle, terazTypicalText, weekMessage } from '../../shared/messages.js';
import { settingsFromLink, shareUrl, startFromLink, toUser, typicalSettings } from '../../shared/settings.js';
import { buildForecast, localDateKey, localMinutes, sunTimes } from '../../shared/solar.js';
import { LINK_ERRORS } from '../../shared/setup-texts.js';
import { FIXED_NOW, fixture, fixtureData, podvrhniQr } from '../helpers.js';

const { pv, forecast } = fixtureData();
// Počasie z Open-Meteo; predpoveď si z neho postaví prehliadač sám, rovnako ako naživo.
const weather = fixture('open-meteo.json');
/** Pripojené meranie v testoch: zapečatený prístup ku kiosku, Worker naň odpovedá nameraným pv z fixtures. */
const TEST_ZDROJ = { sposob: 'huawei-kiosk', pecat: 'v1.TestPecat0123456789abcdefgh', nazov: 'Dvorany' };
/** Elektráreň v Dvoranoch - pre ňu sú fixtures aj očakávané texty. */
const OWNER = { site: SITE, plant: PLANT, tariff: TARIFF, zdroj: TEST_ZDROJ };
/** Predpoveď tak, ako ju prehliadač postaví v danej chvíli. @param {Date} time */
const forecastAt = (time) => buildForecast(weather, time, SITE, PLANT);
/** Odpoveď vyhľadávania miest: jedno mesto na severe, jedno na juhu. */
const GEOCODE = {
    results: [
        {
            name: 'Sevilla',
            latitude: 37.39,
            longitude: -5.98,
            elevation: 10,
            timezone: 'Europe/Madrid',
            admin1: 'Andalúzia',
            country: 'Španielsko',
        },
        {
            name: 'Sydney',
            latitude: -33.87,
            longitude: 151.21,
            elevation: 40,
            timezone: 'Australia/Sydney',
            admin1: 'Nový Južný Wales',
            country: 'Austrália',
        },
    ],
};

// Testy bežia bez siete: QR knižnica z CDN sa nenačíta, zdroje dát odpovedajú podľa scenára.
// Písma sú v repozitári, takže testy merajú rozloženie s tými istými písmami ako appka. Zlyhanie zámerne zablokovaného zdroja nie je chyba appky,
// preto sa z konzoly zbierajú len skutočné výnimky a chyby, nie hlásenia o nenačítaní zdroja.
const IGNORED_CONSOLE = /Failed to load resource|net::ERR_FAILED/;

/**
 * QR knižnica z CDN - jediný externý zdroj stránky. Má v stránke hash (integrity), takže
 * podvrhnuté telo by prehliadač zamietol s chybou v konzole; v testoch sa preto nenačíta
 * vôbec. Nedostupná knižnica je pre appku bežný stav, QR kód je nepovinný.
 * @param {import('@playwright/test').Page} page
 */
async function blokujCdn(page) {
    await page.route(/cdnjs\.cloudflare\.com/, (route) => route.abort());
}

/**
 * Uloží samotnú polohu (panely nie sú zadané), len ak tam ešte nič nie je - rovnako ako openApp.
 * @param {import('@playwright/test').Page} page @param {typeof SITE} site
 */
async function ulozPolohu(page, site) {
    await page.addInitScript(
        ([key, value]) => localStorage.getItem(key) || localStorage.setItem(key, value),
        [SITE_STORAGE_KEY, JSON.stringify(site)],
    );
}

/**
 * Otvorí appku s pevným časom a dátami z fixtures. Bez `settings: null` má uložené Dvorany
 * (len ak tam ešte nič nie je - opätovné načítanie stránky si nechá, čo test uložil). So
 * `settings: null` a `site` pozná appka len polohu, bez oboch sa na ňu pýta. Appka sa otvára
 * na predvolenej karte Môžem?; `start: 'terazky'` je telefón, ktorý si v Nastavení vybral
 * ciferník (tiež len ak voľbu ešte nemá) - pre testy, ktoré skúšajú ciferník.
 * @param {import('@playwright/test').Page} page
 * @param {{ time?: Date, offline?: boolean, settings?: typeof OWNER | null, site?: typeof SITE | null, hash?: string,
 *   start?: 'mozem' | 'terazky' | null, pvData?: typeof pv }} [opts] `pvData` odpovie Worker namiesto merania z fixtures
 */
async function openApp(
    page,
    { time = FIXED_NOW, offline = false, settings = OWNER, site = null, hash = '', start = null, pvData = pv } = {},
) {
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (msg) => msg.type() === 'error' && !IGNORED_CONSOLE.test(msg.text()) && errors.push(msg.text()));
    await blokujCdn(page);
    await page.route(WORKER_PV_URL, (route) => (offline ? route.abort() : route.fulfill({ json: { pv: pvData } })));
    // Pripojenie v sprievodcovi: Worker nájde jednu elektráreň so zapečateným prístupom.
    await page.route(WORKER_PRIPOJ_URL, (route) =>
        route.fulfill({ json: { stanice: [{ nazov: 'Dvorany', pecat: TEST_ZDROJ.pecat, pv: pv }] } }),
    );
    await page.route(/api\.open-meteo\.com/, (route) => (offline ? route.abort() : route.fulfill({ json: weather })));
    await page.route(/geocoding-api\.open-meteo\.com/, (route) => route.fulfill({ json: GEOCODE }));
    if (settings)
        await page.addInitScript(
            ([key, value]) => localStorage.getItem(key) || localStorage.setItem(key, value),
            [SETTINGS_STORAGE_KEY, JSON.stringify(toUser(settings))],
        );
    if (site) await ulozPolohu(page, site);
    if (start)
        await page.addInitScript(
            ([key, value]) => localStorage.getItem(key) || localStorage.setItem(key, value),
            [START_STORAGE_KEY, start],
        );
    await page.clock.setFixedTime(time);
    await page.goto(`/${hash}`);
    await appReady(page);
    return errors;
}

/**
 * Počká, kým appka naštartuje. Udalosť load na to nestačí: boot.js načíta appku dynamickým
 * import(), ktorý sa môže dokončiť až po nej - klik hneď po page.reload() by potom trafil
 * statické HTML bez poslucháčov. „načítavam…“ prepíše až appka.
 * @param {import('@playwright/test').Page} page
 */
async function appReady(page) {
    await expect(page.locator('#pv-updated')).not.toHaveText('načítavam…');
}

/** Presný okamih daného času 5. 9. 2026 v Bratislave (letný čas, UTC+2). @param {string} hm */
function atTime(hm) {
    return { instant: new Date(`2026-09-05T${hm}:00+02:00`) };
}

/** Model hlavnej karty v danej chvíli, s predpoveďou postavenou v tej istej chvíli ako v appke. @param {Date} instant */
const modelAt = (instant) => heroModel({ now: instant, pv, forecast: forecastAt(instant), previewMinutes: null, ...OWNER });

// ---- Karta Terazky ------------------------------------------------------------
// Rozloženie karty Teraz novej appky (návrh A v docs/navrhy/terazky-ako-obloha.html). Očakávané
// texty počíta tá istá funkcia ako appka (terazModel v shared/teraz.js) z tých istých dát.

/**
 * Vstup karty Terazky v danej chvíli, tak ako ho skladá appka: meranie z fixtures, predpoveď
 * postavená v tej istej chvíli. @param {Date} instant @param {object} [extra]
 * @returns {import('../../shared/teraz.js').TerazInput}
 */
const terazVstup = (instant, extra = {}) => ({
    ...OWNER,
    now: instant,
    loading: false,
    known: 'elektraren',
    pristup: null,
    pv,
    forecast: forecastAt(instant),
    previewMinutes: null,
    ...extra,
});

/** Model karty Terazky v danej chvíli. @param {Date} instant @param {object} [extra] */
const terazAt = (instant, extra = {}) => terazModel(terazVstup(instant, extra));

/** Minúta dňa pre čas „HH:MM“. @param {string} hm */
const minuta = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));

/** Bod na grafe dňa pre minútu dňa, v pixeloch stránky. @param {import('@playwright/test').Page} page @param {number} min */
async function bodGrafu(page, min) {
    // Kým nie je karta celá (pás odporúčaní, písma), stránka ešte rastie - keď sa pritom objaví
    // posuvník (Linux v CI), graf sa zúži a bod zmeraný skôr by trafil iný čas. Meria sa preto
    // až po ustálení: ten istý rozmer v dvoch snímkach za sebou.
    await expect(page.locator('#tz-recs')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.locator('#tz-chart').scrollIntoViewIfNeeded();
    const rozmer = () => page.locator('#tz-chart svg').boundingBox();
    let box = await rozmer();
    for (let i = 0; i < 20; i++) {
        await dveSnimky(page);
        const dalsi = await rozmer();
        if (box && dalsi && box.x === dalsi.x && box.y === dalsi.y && box.width === dalsi.width) break;
        box = dalsi;
    }
    if (!box) throw new Error('graf nie je vidno');
    return { x: box.x + (chartX(min) / DAY_CHART.w) * box.width, y: box.y + box.height * 0.45 };
}

/** Farba bunky pásu plánu, do ktorej padne minúta dňa. @param {import('@playwright/test').Page} page @param {number} min */
const farbaPasu = (page, min) => page.locator(`#tz-chart rect[data-from="${Math.floor(min / 30) * 30}"]`).getAttribute('data-tone');

/** Riadok nad číslom: nadpis modelu, čas (len bez náhľadu) a obec. @param {ReturnType<typeof terazModel>} m @param {string} [hm] */
const kick = (m, hm) => `${m.title}${hm ? ` · ${hm}` : ''} · ${SITE.name}`;

test('bez merania: pás pod číslom povie, že je to odhad, a vedie na krok Meranie', async ({ page }) => {
    const errors = await openApp(page, { settings: { ...OWNER, zdroj: null }, start: 'terazky' });
    const m = terazAt(FIXED_NOW, { zdroj: null, pv: null });
    await expect(page.locator('#tz-note')).toBeVisible();
    await expect(page.locator('#tz-note-title')).toHaveText(m.note?.title ?? '');
    await expect(page.locator('#tz-note-text')).toHaveText(m.note?.text ?? '');
    await expect(page.locator('#tz-src')).toBeHidden();
    // S meraním pás nie je.
    expect(terazAt(FIXED_NOW).note).toBe(null);
    await page.locator('#tz-note-btn').click();
    await ocakavajKartu(page, 'nastavenie');
    await expect(page.locator('#wz-meranie')).toBeVisible();
    await page.goBack();
    await ocakavajKartu(page, 'terazky');
    expect(errors).toEqual([]);
});

test('meranie mlčí: číslo nie je meranie spred hodiny, ale odhad, a povie odkedy; Môžem? to isté', async ({ page }) => {
    // Krivka z fixtures končí o 13:00, o 14:30 za slnka ju Worker posiela stále rovnakú.
    const { instant } = atTime('14:30');
    const pvData = { ...pv, updatedAt: instant.toISOString() };
    const errors = await openApp(page, { start: 'terazky', time: instant, pvData });
    const m = terazAt(instant, { pv: pvData });
    await expect(page.locator('#pv-updated')).toHaveText('meranie · zastarané');
    await expect(page.locator('#tz-num-val')).toHaveText(m.num);
    await expect(page.locator('#tz-num-val')).not.toHaveText(String(pv.realTimePowerKw));
    // Odhad povie jantárový pás pod číslom, riadok odhadu ho neopakuje; tlačidlo nie je - meranie je nastavené.
    expect(m.note?.text).toMatch(/^Meranie neodpovedá od 13:00\. /);
    await expect(page.locator('#tz-src')).toBeHidden();
    await expect(page.locator('#tz-note-title')).toHaveText(m.note?.title ?? '');
    await expect(page.locator('#tz-note-text')).toHaveText(m.note?.text ?? '');
    await expect(page.locator('#tz-note-btn')).toBeHidden();
    await expect(page.locator('#tz-now-head')).toHaveText(m.cards?.now.head ?? '');
    await page.locator('#nav-mozem').click();
    await expect(page.locator('.mozem-fact')).toContainText('meranie neodpovedá od 13:00');
    await expect(page.locator('.mozem-fact')).toContainText('odhad z predpovede');
    expect(errors).toEqual([]);
});

test('karta Terazky o 13:00 zodpovedá modelu: číslo, graf dňa, pás odporúčaní', async ({ page }) => {
    const errors = await openApp(page, { start: 'terazky' });
    const { instant } = atTime('13:00');
    const m = terazAt(instant);
    const k = m.cards;
    if (!k || !m.chart) throw new Error('model o 13:00 nemá graf ani odporúčania');
    await expect(page.locator('#pv-time')).toHaveText('13:00');
    await expect(page.locator('#tz-title')).toHaveText(kick(m, '13:00'));
    await expect(page.locator('#tz-num-val')).toHaveText('6.41');
    expect(m.num).toBe('6.41');
    await expect(page.locator('#tz-src')).toHaveText('živé meranie');
    await expect(page.locator('#tz-sub')).toHaveText(m.sub);
    await expect(page.locator('#tz-retry')).toBeHidden();
    // Graf dňa: predpoveď, nameraná krivka, hranica s popiskom a pás plánu po polhodinách.
    await expect(page.locator('#tz-chart .dc-area')).toHaveCount(1);
    await expect(page.locator('#tz-chart .dc-real')).toHaveCount(1);
    await expect(page.locator('#tz-chart .dc-limit-t')).toHaveText('veľké spotrebiče');
    await expect(page.locator('#tz-chart rect[data-tone]')).toHaveCount(48);
    await expect(page.locator('#tz-chart .dc-t')).toHaveText(['0', '6', '12', '18', '24']);
    await expect(page.locator('#tz-legend span')).toHaveText(m.chart.legend.map((l) => l.text));
    await expect(page.locator('#tz-chart')).toHaveAttribute('aria-valuetext', m.chart.valueText);
    await expect(page.locator('#tz-chart-desc')).toHaveText(m.chart.desc);
    await expect(page.locator('#tz-hint')).toHaveText('Ťahaj prstom po grafe a pozri si iný čas.');
    // Pás odporúčaní: štyri karty, prvá je „čo robiť teraz“.
    await expect(page.locator('#tz-now-head')).toHaveText(k.now.head);
    await expect(page.locator('#tz-now-body')).toHaveText(k.now.body);
    expect(k.devices.map((d) => d.name)).toEqual(['Práčka', 'Umývačka', 'Sušička', 'Auto', 'Bojler']);
    await expect(page.locator('#tz-devices')).toHaveText(k.devices.map((d) => `${d.name} ${d.short}`).join(' · '));
    await expect(page.locator('#tz-today')).toHaveText(k.today.line);
    await expect(page.locator('#tz-window')).toHaveText(k.today.window);
    await expect(page.locator('#tz-later')).toHaveText(k.later);
    await expect(page.locator('#tz-dots i')).toHaveCount(4);
    await expect(page.locator('#tz-dots i').first()).toHaveClass('on');
    // Pás plánu má v čase „teraz“ farbu toho istého plánu dňa ako pozadie: slnko v lacnom pásme.
    expect(await farbaPasu(page, minuta('13:00'))).toBe(cellAt(planCells(dayPlan(terazVstup(instant))), minuta('13:00')).tone);
    await expect(page.locator('html')).toHaveAttribute('data-tier', 'green');
    // Ciferník zanikol aj s popupom k nemu.
    await expect(page.locator('#dial-wrap, [data-info-open], #info-overlay')).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('pás odporúčaní sa listuje do strán, bodky idú za ním a na kraji sa zastaví', async ({ page }) => {
    const errors = await openApp(page, { start: 'terazky' });
    const dots = page.locator('#tz-dots i');
    const strip = page.locator('#tz-strip');
    await expect(strip).toHaveAttribute('tabindex', '0');
    await expect(dots.nth(0)).toHaveClass('on');

    // Posun do strán nad pásom = to isté gesto ako prst; stránku dopočíta scroll-snap.
    await strip.hover();
    await page.mouse.wheel(400, 0);
    await expect(dots.nth(1)).toHaveClass('on');
    await expect(page.locator('#tz-devices')).toBeInViewport();
    await page.mouse.wheel(400, 0);
    await page.mouse.wheel(400, 0);
    await expect(dots.nth(3)).toHaveClass('on');
    await expect(page.locator('#tz-later')).toBeInViewport();
    // Za poslednou kartou nič nie je - pás sa nezacyklí.
    await page.mouse.wheel(400, 0);
    await expect(dots.nth(3)).toHaveClass('on');
    await expect(page.locator('#panel-terazky')).toBeVisible();

    // Posuvná oblasť bez prístupu z klávesnice je vážny nález axe - preto sa kontroluje tu.
    const results = await new AxeBuilder({ page }).include('#panel-terazky').analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => v.id)).toEqual([]);
    expect(errors).toEqual([]);
});

for (const [hm, label] of [
    ['08:00', 'drahé pásmo ráno'],
    ['19:30', 'lacný podvečer'],
    ['21:00', 'drahé pásmo večer'],
    ['02:00', 'noc'],
]) {
    test(`odporúčanie o ${hm} (${label}) sedí s modelom`, async ({ page }) => {
        const { instant } = atTime(hm);
        const errors = await openApp(page, { start: 'terazky', time: instant });
        const m = terazAt(instant);
        await expect(page.locator('#tz-now-head')).toHaveText(m.cards?.now.head ?? '');
        await expect(page.locator('#tz-num-val')).toHaveText(m.num);
        // Pozadie stránky drží farbu plánu dňa. Tieto časy pokryjú červenú (21:00, VT bez
        // slnka) aj oranžovú (19:30 a 02:00, NT bez slnka), 13:00 zelenú v teste vyššie.
        await expect(page.locator('html')).toHaveAttribute('data-tier', modelAt(instant).tier || '');
        expect(errors).toEqual([]);
    });
}

for (const [hm, label] of [
    ['13:00', 'zelená'],
    ['21:00', 'červená'],
    ['02:00', 'oranžová'],
]) {
    test(`podsvietenie ikony aktívnej karty má rovnakú farbu ako stavová bodka (${hm}, ${label})`, async ({ page }) => {
        const { instant } = atTime(hm);
        await openApp(page, { time: instant });
        await expect(page.locator('html')).toHaveAttribute('data-accent', modelAt(instant).accent || '');
        // Appka štartuje zelenou a bodka aj podsvietenie sa do novej farby prelínajú. Uprostred
        // prechodu sa ich farby o chlp líšia, preto sa číta až ustálená farba.
        await page.evaluate(() =>
            Promise.all(
                document
                    .getAnimations()
                    .filter((a) => 'transitionProperty' in a && a.transitionProperty === 'background-color')
                    // Prerušený prechod (nové prekreslenie) odmietne `finished` - aj tak je po ňom.
                    .map((a) => a.finished.catch(() => {})),
            ),
        );
        const dot = await page.locator('.appbar-clock .live-dot').evaluate((el) => getComputedStyle(el).backgroundColor);
        const glow = await page.locator('.nav-item.active').evaluate((el) => getComputedStyle(el, '::after').backgroundColor);
        expect(dot).toMatch(/^rgb\(/);
        expect(glow).toBe(dot);
    });
}

test('jedna cena celý deň: v noci sivé pozadie, bodka aj pás plánu bez oranžovej a červenej', async ({ page }) => {
    /** @type {import('../../shared/config.js').Tariff} */
    const flat = {
        currency: '€',
        bands: [{ id: 'j', name: 'Cena', level: 'bezna', price: null }],
        schedules: [
            { days: [1, 2, 3, 4, 5, 6, 7], months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], changes: [{ from: '00:00', band: 'j' }] },
        ],
    };
    const { instant } = atTime('22:00');
    const errors = await openApp(page, { start: 'terazky', time: instant, settings: { ...OWNER, tariff: flat } });
    const expected = heroModel({ now: instant, pv, forecast: forecastAt(instant), previewMinutes: null, ...OWNER, tariff: flat });
    await expect(page.locator('html')).toHaveAttribute('data-tier', 'grey');
    // Bodka počíta so živým výkonom z kiosku - ten je v testovacích dátach celý deň rovnaký.
    await expect(page.locator('html')).toHaveAttribute('data-accent', expected.accent || '');
    await expect(page.locator('#tz-now-head')).toHaveText(expected.message.headline);
    await expect(page.locator('#tz-chart rect[data-tone="plain"]').first()).toBeAttached();
    await expect(page.locator('#tz-chart rect[data-tone="cheap"], #tz-chart rect[data-tone="costly"]')).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('kurzorom: ťahanie po grafe ukáže náhľad aj s farbou pozadia, „Späť na teraz“ ho zruší', async ({ page }) => {
    const errors = await openApp(page, { start: 'terazky', time: atTime('13:00').instant });
    const { instant } = atTime('13:00');
    const teraz = terazAt(instant);
    const nahlad = terazAt(instant, { previewMinutes: minuta('21:00') });
    const z = await bodGrafu(page, minuta('10:00'));
    const na = await bodGrafu(page, minuta('21:00'));
    await page.mouse.move(z.x, z.y);
    await page.mouse.down();
    await page.mouse.move(na.x, na.y, { steps: 8 });
    await page.mouse.up();
    // Nadpis povie, ku ktorému času číslo patrí; čas je aj v grafe pri čiare.
    expect(nahlad.title).toBe('O 21:00');
    await expect(page.locator('#tz-title')).toHaveText(kick(nahlad));
    await expect(page.locator('#tz-num-val')).toHaveText(nahlad.num);
    await expect(page.locator('#tz-now-head')).toHaveText(nahlad.cards?.now.head ?? '');
    await expect(page.locator('#tz-chart .dc-at-t')).toHaveText('21:00');
    await expect(page.locator('#tz-chart .dc-cell-on')).toHaveAttribute('data-tone', (await farbaPasu(page, minuta('21:00'))) ?? '');
    await expect(page.locator('#tz-hint')).toHaveText('');
    // Pozadie ide s náhľadom (21:00 je drahé pásmo bez slnka), bodka ostáva o stave teraz.
    await expect(page.locator('html')).toHaveAttribute('data-tier', 'red');
    await expect(page.locator('html')).toHaveAttribute('data-accent', modelAt(instant).accent || '');
    // Graf pod kurzorom sa nepohol.
    expect((await bodGrafu(page, minuta('21:00'))).y).toBe(na.y);

    const spat = page.getByRole('button', { name: 'Späť na teraz' });
    await spat.click();
    await expect(page.locator('#tz-title')).toHaveText(kick(teraz, '13:00'));
    await expect(page.locator('#tz-num-val')).toHaveText(teraz.num);
    await expect(spat).toBeHidden();
    await expect(page.locator('#tz-chart')).toBeFocused();
    await expect(page.locator('html')).toHaveAttribute('data-tier', 'green');
    expect(errors).toEqual([]);
});

test('klávesnica: šípky posúvajú čas po štvrťhodinách, Home a End na kraje dňa, Escape vráti teraz', async ({ page }) => {
    const errors = await openApp(page, { start: 'terazky' });
    const { instant } = atTime('13:00');
    const graf = page.getByRole('slider', { name: 'Graf dňa, šípkami si pozrieš iný čas' });
    const hodnota = (/** @type {string} */ hm) => terazAt(instant, { previewMinutes: minuta(hm) }).chart?.valueText ?? '';
    await graf.focus();
    await page.keyboard.press('ArrowRight');
    await expect(graf).toHaveAttribute('aria-valuetext', hodnota('13:15'));
    await expect(page.locator('#tz-chart .dc-at-t')).toHaveText('13:15');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(graf).toHaveAttribute('aria-valuenow', String(minuta('12:45')));
    await expect(page.locator('#tz-num-val')).toHaveText(terazAt(instant, { previewMinutes: minuta('12:45') }).num);
    await page.keyboard.press('End');
    await expect(graf).toHaveAttribute('aria-valuenow', String(minuta('23:45')));
    await page.keyboard.press('Home');
    await expect(graf).toHaveAttribute('aria-valuenow', '0');
    await page.keyboard.press('Escape');
    await expect(graf).toHaveAttribute('aria-valuetext', terazAt(instant).chart?.valueText ?? '');
    await expect(page.locator('#tz-reset')).toBeHidden();
    expect(errors).toEqual([]);
});

test('prístupnosť karty Terazky: žiadne závažné nálezy axe počas náhľadu', async ({ page }) => {
    const errors = await openApp(page, { start: 'terazky' });
    await page.locator('#tz-chart').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#tz-reset')).toBeVisible();
    const results = await new AxeBuilder({ page }).include('#panel-terazky').analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => v.id)).toEqual([]);
    expect(errors).toEqual([]);
});

/** Poradie viditeľných blokov karty 7 dní zhora nadol - tak, ako ich vidí používateľ
 * (CSS `order` mení poradie oproti HTML). @param {import('@playwright/test').Page} page */
function viditelneBloky(page) {
    return page.evaluate(() =>
        [...document.querySelectorAll('#panel-7dni .week-block')]
            .filter((b) => b.getBoundingClientRect().height > 0)
            .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
            .map((b) => b.id),
    );
}

/**
 * Karta 7 dní je na mobile rozdelená na dve obrazovky: prehľad (rebríček dní) a detail dňa,
 * ktorý sa otvorí klikom na riadok rebríčka. V detaile ide Denná výroba, Priebeh výroby
 * a až potom Heatmapa so zvýrazneným dňom.
 *
 * Prehľad je na mobile rebríček, nie bubliny s tabuľkou - tie patria širokej obrazovke.
 * Údaje, ktoré z neho odišli (využitie, špička), sú o ťuknutie ďalej v detaile dňa.
 */
test('7 dní na mobile: prehľad dní, detail dňa a návrat späť', async ({ page }) => {
    const errors = await openApp(page);
    await page.locator('#nav-7dni').click();

    // Prehľad: rebríček so siedmimi dňami, grafy sú až v detaile.
    await expect(page.locator('#week-list .wday')).toHaveCount(7);
    await expect(page.locator('#week-list-total')).toHaveText(String(Math.round(forecast.days.reduce((a, d) => a + d.kwhTotal, 0))));
    // Bubliny a tabuľka na mobile nie sú vôbec - prehľad je práve jeden.
    await expect(page.locator('#week-trio')).toBeHidden();
    await expect(page.locator('#week-block-table')).toBeHidden();
    // Správa je v prehľade len na dosť vysokom okne (WEEK_MSG_MIN_H). Predvolené plátno
    // testov je nižšie, takže tu ostáva skrytá; obe strany hranice preveruje vlastná skupina nižšie.
    await expect(page.locator('#week-msg-block')).toBeHidden();
    await expect(page.locator('#week-day-head')).toBeHidden();
    expect(await viditelneBloky(page)).toEqual(['week-block-list']);

    // Pás dňa ukazuje okná na veľké spotrebiče - tie isté zelené úseky ako v novej appke.
    // Očakávanie sa počíta tou istou funkciou ako v appke, takže test chytí rozdiel medzi
    // modelom a tým, čo je v DOM. Číslo kWh už farbu nenesie.
    const vstup = { ...OWNER, now: FIXED_NOW, pv, forecast: forecastAt(FIXED_NOW) };
    for (let i = 0; i < 7; i++) {
        const riadok = page.locator(`#week-list [data-day-index="${i}"]`);
        const band = windowBand(sunWindows(forecastDayPlan(vstup, i)));
        const vStranke = await riadok.locator('.wday-bar i').evaluateAll((els) =>
            els.map((el) => ({
                left: parseFloat(/** @type {HTMLElement} */ (el).style.left),
                width: parseFloat(/** @type {HTMLElement} */ (el).style.width),
            })),
        );
        expect(vStranke).toEqual(band);
        await expect(riadok.locator('.wday-kwh')).toHaveClass('wday-kwh');
    }
    expect(await page.locator('#week-list .wday-bar i').count()).toBeGreaterThan(0);
    // Mini-graf v súčte týždňa má farby stĺpcov z detailu týždňa - pásmo dňa.
    for (const [i, tier] of weekDayTiers(forecast.days).entries())
        await expect(page.locator('#week-list-spark i').nth(i)).toHaveClass(tier ? `tier-${tier}` : '');
    // Najlepší deň má zelený rám - práve jeden, ten s najviac kWh.
    await expect(page.locator('#week-list .wday.best')).toHaveCount(1);
    await expect(page.locator('#week-list .wday.best')).toHaveAttribute('data-day-index', String(bestDayIndex(forecast.days)));

    // Klik na deň otvorí jeho detail: okno na veľké spotrebiče, časovú os dňa a tri čísla.
    await page.locator('#week-list [data-day-index="5"]').click();
    await expect(page.locator('#week-day-title')).toHaveText(weekDayLong(forecast.days[5].date, 5));
    await expect(page.locator('#week-block-list')).toBeHidden();
    await expect(page.locator('#week-day-tabs')).toBeHidden();
    expect(await viditelneBloky(page)).toEqual(['week-block-curve']);

    // Všetko hovorí o tom istom dni - očakávania sa počítajú tými istými funkciami ako v appke.
    const den5 = forecast.days[5];
    const plan5 = forecastDayPlan(vstup, 5);
    // Hore okno na veľké spotrebiče - to isté zelené ako pás v rebríčku. Správu nahrádza.
    const okno = dayWindowCard(mainWindow(sunWindows(plan5)), null, den5.peakHour);
    await expect(page.locator('#week-day-window .dw-val')).toHaveText(okno.value);
    await expect(page.locator('#week-day-window .dw-state')).toHaveText(okno.state);
    await expect(page.locator('#week-msg-block')).toBeHidden();
    // Pod grafom tri čísla; iný deň než dnešok má v strede oblačnosť dňa.
    await expect(page.locator('#week-curve-stat .kpi')).toHaveCount(3);
    await expect(page.locator('#week-curve-stat')).toContainText(`${fmt1(den5.kwhTotal)} kWh`);
    await expect(page.locator('#week-curve-stat .kpi').nth(1)).toHaveText(`Oblačnosť${Math.round(Number(den5.cloudAvgPct))} %priemer dňa`);
    // Časová os: hore riadok heatmapy dňa - tie isté farby ako riadok dňa v heatmape týždňa -,
    // pod ním krivka oblačnosti a pás spotrebičov z plánu dňa s popismi. Očakávanie ráta ten
    // istý model ako appka.
    const heatMax = weekHeatMax(forecast.days);
    const os = dayTimelineModel({ pts: den5.hourly, heatMax, segments: fitSegments(plan5, powerThresholds(PLANT)), label: fitLabel });
    if (!os) throw new Error('časová os bez modelu');
    const riadok5 = weekHeatModel(forecast.days, 5).cells.filter((c) => c.dayIndex === 5);
    expect(await page.locator('#week-curve .heat-cell').evaluateAll((els) => els.map((el) => el.getAttribute('class')))).toEqual(
        riadok5.map((c) => `heat-cell${c.tier ? ` tier-${c.tier}` : ''}`),
    );
    await expect(page.locator('#week-curve path.tl-cloud')).toHaveCount(1);
    await expect(page.locator('#week-curve-scale')).toBeVisible();
    await expect(page.locator('#week-curve-scale')).toContainText(`${fmt1(heatMax)} kW`);
    expect(await page.locator('#week-curve .tl-fit').evaluateAll((els) => els.map((el) => el.getAttribute('class')))).toEqual(
        os.fit.map((f) => `tl-fit ${f.level}`),
    );
    expect(await page.locator('#week-curve .tl-fit-label').allTextContents()).toEqual(os.fit.map((f) => f.label).filter(Boolean));
    await expect(page.locator('#week-curve .tl-wash')).toHaveCount(os.wash.length);
    // Iný deň než dnešok nemá „teraz“.
    await expect(page.locator('#week-curve .tl-now')).toHaveCount(0);
    // Pod detailom susedné dni: predchádzajúci aj ďalší.
    await expect(page.locator('.day-steps .day-step')).toHaveCount(2);
    await expect(page.locator('.day-steps .day-step.prev')).toHaveAttribute('data-day-index', '4');
    await expect(page.locator('.day-steps .day-step.next')).toHaveAttribute('data-day-index', '6');

    // Z detailu vedie späť jedine šípka vľavo hore. Atribút data-panel nesie aj #page, takže
    // klik kdekoľvek v stránke sa kedysi tváril ako prepnutie karty a detail zavrel.
    await page.locator('#week-curve-stat').click();
    await page.locator('#week-block-curve .chart-top').click();
    await expect(page.locator('#week-day-head')).toBeVisible();
    expect(await viditelneBloky(page)).toEqual(['week-block-curve']);

    // Späť sa vraciame na prehľad, výber dňa v ňom ostáva.
    await page.locator('#week-day-back').click();
    await expect(page.locator('#week-day-head')).toBeHidden();
    await expect(page.locator('#week-list .wday.sel')).toHaveAttribute('data-day-index', '5');
    expect(await viditelneBloky(page)).toEqual(['week-block-list']);

    // Odchod na inú kartu a návrat začína zase na prehľade.
    await page.locator('#nav-terazky').click();
    await page.locator('#nav-7dni').click();
    await expect(page.locator('#week-day-head')).toBeHidden();
    expect(errors).toEqual([]);
});

/**
 * Dnes a Zajtra sú v rebríčku prvé dva riadky a majú robiť presne to, čo ktorýkoľvek iný
 * deň - meno navrchu ich nerobí výnimkou. Kým to boli bubliny nad tabuľkou, bola to druhá
 * cesta do detailu; teraz je jedna.
 */
test('7 dní na mobile: riadky Dnes a Zajtra otvárajú detail toho dňa', async ({ page }) => {
    const errors = await openApp(page);
    await page.locator('#nav-7dni').click();

    await page.locator('#week-list [data-day-index="0"]').click();
    await expect(page.locator('#week-day-title')).toHaveText(weekDayLong(forecast.days[0].date, 0));
    await expect(page.locator('#week-curve-stat')).toContainText(`${fmt1(forecast.days[0].kwhTotal)} kWh`);
    await page.locator('#week-day-back').click();

    await page.locator('#week-list [data-day-index="1"]').click();
    await expect(page.locator('#week-day-title')).toHaveText(weekDayLong(forecast.days[1].date, 1));
    await expect(page.locator('#week-curve-stat')).toContainText(`${fmt1(forecast.days[1].kwhTotal)} kWh`);
    // Výber sa prenáša do celej karty rovnako ako z ktoréhokoľvek iného riadka.
    await page.locator('#week-day-back').click();
    await expect(page.locator('#week-list .wday.sel')).toHaveAttribute('data-day-index', '1');

    expect(errors).toEqual([]);
});

/**
 * V detaile dňa je ťah prstom jediná cesta k susednému dňu a nič ju neohlasovalo. Pás dní pod
 * hlavičkou hovorí, koľko dní týždeň má a na ktorom z nich stojíme; čipy sú tlačidlá, takže
 * ten istý skok zvládne aj myš a klávesnica.
 */
test('7 dní na mobile: pás dní pod hlavičkou ukazuje a prepína deň', async ({ page }) => {
    const errors = await openApp(page);
    await page.locator('#nav-7dni').click();

    // V prehľade dní nie je čo listovať - pás patrí k detailu dňa.
    await expect(page.locator('.day-strip:visible')).toHaveCount(0);

    await page.locator('#week-list [data-day-index="2"]').click();
    const cipy = page.locator('.day-strip .day-chip');
    await expect(cipy).toHaveCount(forecast.days.length);
    await expect(page.locator('.day-strip .day-chip.sel')).toHaveAttribute('data-day-index', '2');
    // Popiska čipu je ten istý názov dňa, aký nesie hlavička, na čipe je skratka dňa v týždni
    // aj pri dnešku - počíta ich tá istá funkcia ako appka.
    await expect(cipy.nth(4)).toHaveAttribute('aria-label', weekDayLong(forecast.days[4].date, 4));
    await expect(cipy.nth(0)).toHaveText(dayNameShort(forecast.days[0].date));

    // Klik na čip prepne deň a ostane v detaile: hlavička, graf aj plný čip idú za ním.
    await cipy.nth(4).click();
    await expect(page.locator('#week-day-title')).toHaveText(weekDayLong(forecast.days[4].date, 4));
    await expect(page.locator('.day-strip .day-chip.sel')).toHaveAttribute('data-day-index', '4');
    await expect(page.locator('#week-curve-stat')).toContainText(`${fmt1(forecast.days[4].kwhTotal)} kWh`);
    expect(await viditelneBloky(page)).toEqual(['week-block-curve']);

    // Tlačidlo susedného dňa pod detailom robí to isté, čo čip.
    await page.locator('.day-steps .day-step.next').click();
    await expect(page.locator('#week-day-title')).toHaveText(weekDayLong(forecast.days[5].date, 5));
    await expect(page.locator('.day-strip .day-chip.sel')).toHaveAttribute('data-day-index', '5');
    await page.locator('.day-steps .day-step.prev').click();
    await expect(page.locator('.day-strip .day-chip.sel')).toHaveAttribute('data-day-index', '4');

    // Výber sa prenáša do celej karty rovnako ako z ktoréhokoľvek iného miesta.
    await page.locator('#week-day-back').click();
    await expect(page.locator('#week-list .wday.sel')).toHaveAttribute('data-day-index', '4');

    // Detail týždňa je jediná obrazovka - tam by pás dní sľuboval listovanie, ktoré nie je.
    await page.locator('.week-list-hero').click();
    await expect(page.locator('#week-day-title')).toHaveText('Celý týždeň');
    await expect(page.locator('.day-strip:visible')).toHaveCount(0);
    await expect(page.locator('.day-steps:visible')).toHaveCount(0);
    expect(errors).toEqual([]);
});

/**
 * Bublina so súčtom ("Spolu za 7 dní") nepatrí k dňu, ale k celému týždňu - otvára preto
 * detail týždňa: dennú výrobu a mapu výroby, bez krivky jedného dňa. Je to tá istá cesta,
 * akou na širokej obrazovke vedie bublina "7 dní spolu".
 */
test('7 dní na mobile: bublina so súčtom otvára detail týždňa', async ({ page }) => {
    const errors = await openApp(page);
    await page.locator('#nav-7dni').click();
    await page.locator('.week-list-hero').click();

    await expect(page.locator('#week-day-title')).toHaveText('Celý týždeň');
    expect(await viditelneBloky(page)).toEqual(['week-block-bars', 'week-block-heat']);
    // Mapa ukazuje celý týždeň, nie jeden riadok, a pod ňou je správa o najsilnejšom dni.
    await expect(page.locator('#week-heat .day-label')).toHaveCount(7);
    await expect(page.locator('#week-msg-title')).toContainText('Najsilnejší deň');
    await expect(page.locator('#week-bars-stat')).toContainText(`${fmt1(forecast.days.reduce((a, d) => a + d.kwhTotal, 0))} kWh`);

    // Späť vedie na prehľad dní rovnako ako z detailu dňa.
    await page.locator('#week-day-back').click();
    await expect(page.locator('#week-day-head')).toBeHidden();
    expect(await viditelneBloky(page)).toEqual(['week-block-list']);
    expect(errors).toEqual([]);
});

/**
 * Detail dňa na mobile je predpoveď: nameranú výrobu nekreslí ani pri dnešku. Dnešok má navyše
 * len „teraz“ na časovej osi a v číslach pod ňou, koľko už nabehlo.
 */
test('7 dní: detail dnešného dňa má „teraz“, nameranú výrobu len v číslach', async ({ page }) => {
    const errors = await openApp(page);
    await page.locator('#nav-7dni').click();
    await page.locator('#week-list [data-day-index="0"]').click();
    // Časová os je predpoveď dňa - nameraná krivka v nej nie je, a tak ani v legende.
    await expect(page.locator('#week-curve path.line-real')).toHaveCount(0);
    await expect(page.locator('#week-curve circle.dot-real')).toHaveCount(0);
    await expect(page.locator('#week-curve-live-legend')).toBeHidden();
    // Dnešok má „teraz“ s časom a karta okna počíta s ním.
    await expect(page.locator('#week-curve .tl-now')).toHaveCount(1);
    await expect(page.locator('#week-curve .tl-now-text')).toHaveText(minutesToTimeStr(localMinutes(FIXED_NOW, SITE.timezone)));
    const vstup0 = { ...OWNER, now: FIXED_NOW, pv, forecast: forecastAt(FIXED_NOW) };
    const okno0 = dayWindowCard(
        mainWindow(sunWindows(forecastDayPlan(vstup0, 0))),
        localMinutes(FIXED_NOW, SITE.timezone),
        forecast.days[0].peakHour,
    );
    await expect(page.locator('#week-day-window .dw-state')).toHaveText(okno0.state);
    // Koľko už z predpovede nabehlo, patrí tiež len dnešku.
    await expect(page.locator('#week-curve-stat')).toContainText(`Zatiaľ${fmt1(pv.dailyEnergyKwh)} kWh`);

    await page.locator('#week-day-back').click();
    await page.locator('#week-list [data-day-index="3"]').click();
    await expect(page.locator('#week-curve path.line-real')).toHaveCount(0);
    await expect(page.locator('#week-curve-live-legend')).toBeHidden();
    await expect(page.locator('#week-curve-stat')).not.toContainText('Zatiaľ');
    expect(errors).toEqual([]);
});

/**
 * Správa týždňa pod rebríčkom dní je vec miesta, nie obsahu: ukáže sa len vtedy, keď sa celý
 * prehľad aj s ňou zmestí na obrazovku. Hranicu drží WEEK_MSG_MIN_H a testujú sa obe jej strany -
 * v oboch prípadoch musí platiť to hlavné, že prehľad nescrolluje.
 */
test.describe('správa týždňa v prehľade dní', () => {
    /** @param {import('@playwright/test').Page} page */
    const scrollujeSa = (page) => page.evaluate(() => document.documentElement.scrollHeight > document.documentElement.clientHeight);

    test('na vysokom okne je správa vidno a prehľad sa nescrolluje', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: WEEK_MSG_MIN_H + 40 });
        const errors = await openApp(page);
        await page.locator('#nav-7dni').click();
        await expect(page.locator('#week-msg-block')).toBeVisible();
        await expect(page.locator('#week-msg-title')).toHaveText(weekMessage(forecast.days).title);
        expect(await scrollujeSa(page)).toBe(false);
        expect(errors).toEqual([]);
    });

    test('na nízkom okne správa nie je a prehľad sa nescrolluje', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: WEEK_MSG_MIN_H - 40 });
        const errors = await openApp(page);
        await page.locator('#nav-7dni').click();
        await expect(page.locator('#week-msg-block')).toBeHidden();
        expect(await scrollujeSa(page)).toBe(false);
        // V detaile dňa správu nahrádza karta okna na veľké spotrebiče - tá patrí k obsahu,
        // nie k miestu, takže je aj na nízkom okne. V detaile týždňa správa ostáva.
        await page.locator('#week-list [data-day-index="2"]').click();
        await expect(page.locator('#week-msg-block')).toBeHidden();
        await expect(page.locator('#week-day-window')).toBeVisible();
        await page.locator('#week-day-back').click();
        await page.locator('.week-list-hero').click();
        await expect(page.locator('#week-msg-block')).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('zmenšenie okna správu odoberie, zväčšenie vráti', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: WEEK_MSG_MIN_H + 40 });
        const errors = await openApp(page);
        await page.locator('#nav-7dni').click();
        await expect(page.locator('#week-msg-block')).toBeVisible();
        await page.setViewportSize({ width: 390, height: WEEK_MSG_MIN_H - 40 });
        await expect(page.locator('#week-msg-block')).toBeHidden();
        await page.setViewportSize({ width: 390, height: WEEK_MSG_MIN_H + 40 });
        await expect(page.locator('#week-msg-block')).toBeVisible();
        expect(errors).toEqual([]);
    });
});

/** Na širokej obrazovke je na celú kartu miesto naraz - detail dňa sa tam neotvára a klik
 * v tabuľke, v prepínači dní aj v grafoch len prepína vybraný deň, ako doteraz. */
test('7 dní na desktope: karta ostáva celá, výber dňa naprieč komponentmi', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const errors = await openApp(page);
    await page.locator('#nav-7dni').click();
    // Tabuľka je len tu - na mobile ju nahradil rebríček, takže odtieň percenta využitia
    // patrí do desktopového testu. Očakávanie sa počíta tou istou funkciou ako v appke.
    // Štvrtý stĺpec tabuľky je Využitie.
    for (const [i, day] of forecast.days.entries())
        await expect(page.locator(`#week-tbody tr[data-day-index="${i}"] td:nth-child(4)`)).toHaveClass(`mid${useTier(usePct(day))}`);

    // Druhý stĺpec tabuľky je Výroba - nesie to isté pásmo dňa ako stĺpce grafu vedľa nej.
    for (const [i, tier] of weekDayTiers(forecast.days).entries()) {
        await expect(page.locator(`#week-tbody tr[data-day-index="${i}"] td:nth-child(2)`)).toHaveClass(tier ? `tier-${tier}` : '');
        await expect(page.locator('#week-bars rect.bar').nth(i)).toHaveClass(tier ? new RegExp(`\\btier-${tier}\\b`) : /^bar$/);
    }

    await page.locator('#week-day-tabs [data-day-index="3"]').click();
    await expect(page.locator('#week-day-tabs .utab.active')).toHaveAttribute('data-day-index', '3');
    await expect(page.locator('#week-tbody tr.sel')).toHaveAttribute('data-day-index', '3');
    await expect(page.locator('#week-bars rect.bar.sel')).toHaveCount(1);
    await page.locator('#week-tbody tr[data-day-index="5"]').click();
    await expect(page.locator('#week-day-tabs .utab.active')).toHaveAttribute('data-day-index', '5');
    await expect(page.locator('#week-day-head')).toBeHidden();
    await expect(page.locator('#week-block-table')).toBeVisible();
    await expect(page.locator('#week-block-heat')).toBeVisible();
    expect(errors).toEqual([]);
});

/** Karta 7 dní sa prekresľuje pri každom tiknutí hodín a obnove dát. Prepísané tlačidlo by
 * zobralo so sebou aj fokus klávesnice - človek by z rebríčka vypadol každých pár sekúnd. */
test('7 dní: fokus klávesnice prežije obnovu dát aj výber dňa v prepínači', async ({ page }) => {
    const errors = await openApp(page);
    await page.locator('#nav-7dni').click();
    const riadok = page.locator('#week-list [data-day-index="2"]');
    await riadok.focus();
    // Značka na prvku: nové tlačidlo s rovnakým obsahom by ju nemalo.
    await riadok.evaluate((el) => (el.dataset.povodne = '1'));
    // Vyššie okno prekreslí kartu (ukáže sa správa týždňa) - rovnaké prekreslenie ako pri
    // tiknutí hodín, len ho netreba čakať pol minúty.
    await page.setViewportSize({ width: 390, height: WEEK_MSG_MIN_H + 40 });
    await expect(page.locator('#week-msg-block')).toBeVisible();
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-povodne')), 'prekreslenie zhodilo fokus z rebríčka').toBe(
        '1',
    );

    // Na širokej obrazovke: Enter na dni v prepínači zmení výber a prepíše prepínač - fokus
    // ostane na tom istom dni.
    await page.setViewportSize({ width: 1366, height: 768 });
    const tab = page.locator('#week-day-tabs [data-day-index="4"]');
    await tab.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#week-day-tabs .utab.active')).toHaveAttribute('data-day-index', '4');
    expect(
        await page.evaluate(
            () => document.activeElement?.closest('#week-day-tabs') && document.activeElement.getAttribute('data-day-index'),
        ),
    ).toBe('4');
    expect(errors).toEqual([]);
});

test('kým sa dáta sťahujú, hlavička hovorí "načítavam…", nie "dáta nedostupné"', async ({ page }) => {
    /** @type {() => void} */
    let pustit = () => {};
    const zadrzane = new Promise((r) => (pustit = () => r(undefined)));
    // Počasie príde až na pokyn; dovtedy appka len načítava.
    await page.route(/api\.open-meteo\.com/, async (route) => {
        await zadrzane;
        await route.fulfill({ json: weather });
    });
    await blokujCdn(page);
    await ulozPolohu(page, SITE);
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto('/');
    // Čas v hlavičke prepíše až appka (v HTML je 00:00) - "načítavam…" potom nie je len text
    // zo statickej stránky, ale to, čo appka sama napísala.
    await expect(page.locator('#pv-time')).toHaveText('–:–');
    await expect(page.locator('#pv-updated')).toHaveText('načítavam…');
    pustit();
    await expect(page.locator('#pv-setup-go')).toHaveText('nastav panely ›');
});

test('rýchly štart: počasie z minulého otvorenia ukáže predpoveď hneď, kým sa sťahuje nové', async ({ page }) => {
    const errors = await openApp(page);
    /** @type {() => void} */
    let pustit = () => {};
    const zadrzane = new Promise((r) => (pustit = () => r(undefined)));
    await page.route(/api\.open-meteo\.com/, async (route) => {
        await zadrzane;
        await route.fulfill({ json: weather });
    });
    await page.route(WORKER_PV_URL, async (route) => {
        await zadrzane;
        await route.fulfill({ json: { pv } });
    });
    // O dve hodiny: počasie treba stiahnuť znova, no predpoveď je tu z odloženého.
    await page.clock.setFixedTime(new Date(FIXED_NOW.getTime() + 2 * 3_600_000));
    await page.reload();
    // data-panel zapíše až prvý render - poslucháči sú vtedy prihlásení a klik sa nestratí.
    await expect(page.locator('#page')).toHaveAttribute('data-panel', /.+/);
    await page.locator('#nav-7dni').click();
    await expect(page.locator('#pv-updated')).toHaveText('načítavam…');
    await expect(page.locator('#week-day-tabs [data-day-index]')).toHaveCount(7);
    pustit();
    await appReady(page);
    expect(errors).toEqual([]);
});

/**
 * Bubliny sú od zavedenia rebríčka len na širokej obrazovke, kde majú všetky tri meta riadok
 * so špičkou a využitím. Na mobile to, čo v ňom stálo, hovorí detail dňa.
 */
test('7 dní na desktope: bubliny majú meta riadok so špičkou a využitím', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const errors = await openApp(page);
    await page.locator('#nav-7dni').click();
    const today = forecast.days[0];
    const pct = usePct(today);
    const expectedMeta = `⚡ ${fmt1(today.peakKw)} kW o ${hourLabel(today.peakHour)}` + (pct == null ? '' : `${pct} % z jasnej oblohy`);
    await expect(page.locator('#week-today-meta')).toBeVisible();
    await expect(page.locator('#week-today-meta')).toHaveText(expectedMeta);
    await expect(page.locator('#week-tomorrow-meta')).toBeVisible();
    await expect(page.locator('#week-total-meta')).toBeVisible();
    expect(errors).toEqual([]);
});

test('nastavenie: položka Zdieľať appku v sekcii Appka sa otvorí až ťuknutím', async ({ page }) => {
    const errors = await openApp(page);
    // Zdieľanie je v Nastavení (kedysi karta Info).
    await expect(page.locator('#nav-info')).toHaveCount(0);
    await page.locator('#nav-nastavenie').click();
    await expect(page.locator('#app-items-title')).toHaveText('Appka');
    await expect(page.locator('#panel-nastavenie #info-share')).toHaveCount(1);

    // Karta je zoznam položiek: položka je vidno, jej obsah až po ťuknutí na ňu.
    await expect(page.locator('#info-share summary')).toBeVisible();
    await expect(page.locator('#share-whatsapp')).toBeHidden();
    await page.locator('#info-share summary').click();
    await expect(page.locator('#qrcode')).toBeVisible();
    await expect(page.locator('#share-whatsapp')).toBeVisible();
    await expect(page.locator('#share-whatsapp')).toHaveAttribute('href', /wa\.me/);

    // Druhé ťuknutie položku zase zavrie - nič iné na karte sa tým nemení.
    await page.locator('#info-share summary').click();
    await expect(page.locator('#share-whatsapp')).toBeHidden();
    expect(errors).toEqual([]);
});

/** Dve snímky prehliadača: čo appka po udalosti zapísala, je potom na obrazovke. @param {import('@playwright/test').Page} page */
const dveSnimky = (page) =>
    page.evaluate(() => new Promise((hotovo) => requestAnimationFrame(() => requestAnimationFrame(() => hotovo(undefined)))));

/** O minútu neskôr - meranie je zas na rade (kiosk sa pýta raz za minútu, shared/zdroje.js). @param {import('@playwright/test').Page} page */
const poMinute = (page) => page.clock.setFixedTime(new Date(FIXED_NOW.getTime() + 60 * 1000));

/** Jedna nevydarená obnova nemá prepnúť živý výkon na odhad - o minútu by sa vrátil späť
 * a nameraná krivka by medzitým z grafu zmizla. */
test('výpadok kiosku na jednu obnovu: ostáva posledné meranie, nie odhad', async ({ page }) => {
    const errors = await openApp(page, { start: 'terazky' });
    await expect(page.locator('#tz-src')).toHaveText('živé meranie');

    await page.route(WORKER_PV_URL, (route) => route.abort());
    await poMinute(page);
    const zlyhala = page.waitForEvent('requestfailed', (r) => r.url() === WORKER_PV_URL);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await zlyhala;
    await dveSnimky(page);
    // Jedno čítanie, nie čakanie: stav hneď po nevydarenej obnove.
    expect(await page.locator('#tz-src').textContent()).toBe('živé meranie');
    expect(await page.locator('#pv-updated').textContent()).not.toBe('živý výkon nedostupný');
    expect(errors).toEqual([]);
});

/** Výrobca prístup odmietol (vypršal, zrušený, iné heslo): nie „meranie neodpovedá“, ale prečo
 * a cesta k oprave - a appka ho prestane zaťažovať (shared/pristup.js). */
test('prístup k meraniu neplatí: pás, hlásenie v Nastavení, Skúsiť znova a Pripojiť znova', async ({ page }) => {
    const errors = await openApp(page, { start: 'terazky' });
    let odmieta = true;
    let volania = 0;
    await page.route(WORKER_PV_URL, (route) => {
        volania++;
        return odmieta ? route.fulfill({ status: 400, json: { chyba: 'udaje' } }) : route.fulfill({ json: { pv } });
    });
    const obnov = async (/** @type {number} */ minut) => {
        await page.clock.setFixedTime(new Date(FIXED_NOW.getTime() + minut * 60 * 1000));
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await dveSnimky(page);
    };
    const bar = page.locator('#panels-bar');
    // Jedno odmietnutie ešte nič neznamená.
    await obnov(1);
    await expect.poll(() => volania).toBe(1);
    await expect(bar).toBeHidden();
    await obnov(2);
    await expect.poll(() => volania).toBe(2);
    const zaDve = odmietnute(odmietnute(null, TEST_ZDROJ, FIXED_NOW, '', false), TEST_ZDROJ, FIXED_NOW, '', false);
    const m = /** @type {any} */ (pristupModel({ zdroj: TEST_ZDROJ, pristup: zaDve, now: FIXED_NOW, timezone: SITE.timezone }));
    await expect(bar).toBeVisible();
    await expect(page.locator('#panels-bar-title')).toHaveText(m.pas.nadpis);
    await expect(page.locator('#panels-bar-text')).toHaveText(m.pas.text);
    await expect(page.locator('#pv-updated')).toHaveText(m.hlavicka);
    // Potom sa pýta len raz za hodinu - ani nové otvorenie appky neskúša zlý prístup hneď.
    await obnov(10);
    await page.reload();
    await appReady(page);
    await page.waitForTimeout(300);
    expect(volania, 'po usúdení, že prístup neplatí, sa nepýta každú minútu').toBe(2);
    await expect(bar).toBeVisible();

    // Pás vedie do Nastavenia, Elektráreň je rozbalená a hlásenie povie prečo.
    await page.locator('#panels-bar-go').click();
    await expect(page.locator('#settings-plant')).toHaveAttribute('open', '');
    await expect(page.locator('#settings-plant-hint')).toHaveText(m.karta.nadpis);
    await expect(page.locator('#setup-warnings .plant-msg').first()).toContainText(m.karta.text);
    await expect(page.locator('[data-setup-edit="meranie"] .sum-live.in-line')).toHaveText(m.stavKratko);
    // Skúsiť znova sa opýta hneď; keď to nepomôže, povie to.
    await page.locator('[data-pristup-skus]').click();
    await expect.poll(() => volania).toBe(3);
    await expect(page.locator('#setup-warnings')).toContainText('Huawei prístup stále neprijíma.');
    // Pripojiť znova: rovno formulár kiosku, dôvod navrchu, návod pre nové pripojenie skrytý.
    await page.locator('[data-setup-znova]').click();
    await expect(page.locator('#wz-title')).toHaveText(m.sprievodca.nadpis);
    await expect(page.locator('#wz-lead')).toHaveText(m.sprievodca.uvod);
    await expect(page.locator('#wz-kroky')).toBeHidden();
    await expect(page.locator('[data-setup-pole="odkaz"]')).toBeVisible();
    await page.locator('#wz-close').click();
    // Výrobca prístup znova prijíma: hlásenie zmizne aj z úložiska.
    odmieta = false;
    await page.locator('[data-pristup-skus]').click();
    await expect(page.locator('#setup-warnings')).not.toContainText(m.karta.nadpis);
    await expect(page.locator('#settings-plant-hint')).toHaveText('Poloha, panely, menič, meranie a tarifa');
    expect(await page.evaluate((k) => localStorage.getItem(k), config.PRISTUP_STORAGE_KEY)).toBe(null);
    expect(errors).toEqual([]);
});

/** Limit Huawei (dáta raz za 5 minút) je na účet, nie na appku: obe appky v tom istom prehliadači
 * idú jedným rytmom (meranie-v1) a tou istou pečaťou, bez merania sa nepýtajú každú minútu. */
test('spoločný rytmus meraní: druhá appka, nová pečať, bez merania nie každú minútu', async ({ page }) => {
    const nb = { sposob: 'huawei-northbound', pecat: 'v1.NbPecat0123456789abcdefghij', nazov: 'Dvorany' };
    const pvTeraz = { ...pv, updatedAt: FIXED_NOW.toISOString() };
    // Druhá appka práve namerala: táto sa po otvorení nepýta a ukáže jej meranie.
    await page.addInitScript(
        ([k, v]) => localStorage.getItem(k) || localStorage.setItem(k, v),
        [config.MERANIE_STORAGE_KEY, JSON.stringify({ sposob: nb.sposob, nazov: nb.nazov, at: FIXED_NOW.getTime(), pv: pvTeraz })],
    );
    const errors = await openApp(page, { settings: { ...OWNER, zdroj: nb }, start: 'terazky' });
    /** @type {string[]} */ const telo = [];
    let odpoved = /** @type {number} */ (502);
    await page.route(WORKER_PV_URL, (route) => {
        telo.push(route.request().postData() || '');
        return route.fulfill({ status: odpoved, json: odpoved === 200 ? { pv } : { chyba: 'vyrobca', kod: 'meranie:407' } });
    });
    const obnov = async (/** @type {number} */ minut) => {
        await page.clock.setFixedTime(new Date(FIXED_NOW.getTime() + minut * 60 * 1000));
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await dveSnimky(page);
    };
    await expect(page.locator('#tz-src')).toHaveText('živé meranie');
    expect(telo, 'meranie z druhej appky, žiadny dopyt').toEqual([]);
    // Po 5 minútach je na rade. Huawei odmietne (limit): ďalší pokus až po ďalších 5 minútach.
    await obnov(5);
    await expect.poll(() => telo.length).toBe(1);
    await obnov(6);
    await obnov(7);
    await page.waitForTimeout(300);
    expect(telo.length, 'nevydarený dopyt sa ráta - nie každú minútu').toBe(1);
    // Druhá appka medzitým obnovila prístup: ďalší dopyt ide s jej pečaťou.
    const nova = 'v1.NovaNbPecat0123456789abcdefgh';
    await page.evaluate(
        ([k, v]) => localStorage.setItem(k, v),
        [SETTINGS_STORAGE_KEY, JSON.stringify(toUser({ ...OWNER, zdroj: { ...nb, pecat: nova } }))],
    );
    odpoved = 200;
    await obnov(10);
    await expect.poll(() => telo.length).toBe(2);
    expect(telo[1]).toBe(nova);
    expect(errors).toEqual([]);
});

/** Pri pomalej sieti by každý minútový časovač a návrat z pozadia pridal ďalšiu požiadavku
 * a staršia odpoveď mohla prepísať novšiu. */
test('obnova dát beží najviac raz naraz, ďalšie volania sa pridajú k rozbehnutej', async ({ page }) => {
    const errors = await openApp(page, { start: 'terazky' });
    let volania = 0;
    /** @type {() => void} */
    let pustit = () => {};
    const zadrzane = new Promise((r) => (pustit = () => r(undefined)));
    await page.route(WORKER_PV_URL, async (route) => {
        volania++;
        await zadrzane;
        await route.fulfill({ json: { pv } });
    });
    await poMinute(page);
    for (let i = 0; i < 3; i++) await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(() => volania).toBe(1);
    // Chvíľa na to, aby prípadné ďalšie požiadavky stihli prísť.
    await page.waitForTimeout(300);
    expect(volania, 'súbežné obnovy poslali viac požiadaviek').toBe(1);
    pustit();
    await expect(page.locator('#tz-src')).toHaveText('živé meranie');
    expect(errors).toEqual([]);
});

/** Cudzí skript na CDN by mal prístup k uloženému nastaveniu aj odkazu na kiosk - prehliadač
 * ho preto spustí, len ak sedí hash v atribúte integrity. */
test('QR knižnica z CDN sa spustí, len ak je to presne očakávaný súbor', async ({ page }) => {
    // CORS hlavička je tu naschvál: skript sa má zastaviť na hashi, nie na CORS.
    await page.route(/cdnjs\.cloudflare\.com/, (route) =>
        route.fulfill({
            status: 200,
            body: 'window.podvrhnute = true;',
            contentType: 'application/javascript',
            headers: { 'access-control-allow-origin': '*' },
        }),
    );
    await page.route(/api\.open-meteo\.com/, (route) => route.fulfill({ json: weather }));
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto('/');
    await page.waitForLoadState('load');
    await expect(page.locator('#pv-time')).not.toHaveText('00:00');
    expect(await page.evaluate(() => /** @type {any} */ (window).podvrhnute)).toBeUndefined();
    await expect(page.locator('script[src*="qrcode"]')).toHaveAttribute('crossorigin', 'anonymous');
});

test('bez dát: appka neukáže chybu, iba stav "dáta nedostupné"', async ({ page }) => {
    const errors = await openApp(page, { start: 'terazky', offline: true });
    await expect(page.locator('#pv-updated')).toHaveText('dáta nedostupné');
    await expect(page.locator('#tz-num-val')).toHaveText('–');
    await expect(page.locator('#tz-sub')).not.toHaveText('Načítavam…');
    await expect(page.locator('#tz-retry')).toBeVisible();
    await expect(page.locator('#tz-plot')).toBeHidden();
    await expect(page.locator('#tz-recs')).toBeHidden();
    await page.locator('#nav-7dni').click();
    await expect(page.locator('#week-msg-title')).toHaveText('Predpoveď sa pripravuje');
    expect(errors).toEqual([]);
});

/**
 * Utilita .hidden je jediná trieda (špecificita 0,1,0). Bez `!important` ju prebilo akékoľvek
 * pravidlo s `display` a vyššou špecificitou - ID selektor (#panel-x), ale rovnako aj
 * potomkovský (.chart-legend span) - a appka by prvok "skryla", hoci by ostal na obrazovke.
 * Preto má `!important` ako jediné miesto v style.css (viď CLAUDE.md). Test neberie zoznam
 * prvkov, ktorý by sa dal zabudnúť doplniť, ale prejde všetky prvky v stránke a overí, že
 * .hidden na každom z nich naozaj zaberie.
 */
test('.hidden skryje každý prvok v stránke, nič ju neprebíja', async ({ page }) => {
    const errors = await openApp(page);
    // Karty sa vykresľujú až po otvorení, aby test videl aj ich obsah.
    for (const panel of [...PANELS.filter((p) => p !== 'terazky'), 'terazky']) await page.locator(`#nav-${panel}`).click();

    const broken = await page.evaluate(() => {
        const out = [];
        for (const el of document.body.querySelectorAll('*')) {
            if (el.closest('script, style, template')) continue;
            const had = el.classList.contains('hidden');
            el.classList.add('hidden');
            const display = getComputedStyle(el).display;
            if (!had) el.classList.remove('hidden');
            if (display !== 'none') {
                const where = el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}.${el.className}`;
                out.push(`${where} -> display: ${display}`);
            }
        }
        return out;
    });
    expect(broken, 'tieto prvky .hidden neskryje - niečo s vyššou špecificitou nastavuje display').toEqual([]);
    expect(errors).toEqual([]);
});

/** Počká, kým dobehne prisunutie novej karty. Axe musí posudzovať ustálenú kartu: uprostred
 * prechodu je ešte priehľadná a hlásilo by to nedostatočný kontrast textu.
 * @param {import('@playwright/test').Page} page */
const pockajNaPrechod = (page) =>
    page.evaluate(() =>
        Promise.all(
            document
                .getAnimations()
                .filter((a) => 'animationName' in a && String(a.animationName).startsWith('panel-in'))
                .map((a) => a.finished),
        ).then(() => undefined),
    );

test('prístupnosť: žiadne závažné nálezy axe na žiadnej karte', async ({ page }) => {
    // Axe prejde celú stránku raz za kartu a raz za detail dňa - pri súbežnom behu testov
    // sa to do základného limitu 30 s nezmestí (sám beží okolo 23 s).
    test.slow();
    await openApp(page);
    for (const panel of PANELS) {
        await page.locator(`#nav-${panel}`).click();
        await pockajNaPrechod(page);
        const results = await new AxeBuilder({ page }).analyze();
        const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    }
    // Detail dňa je vlastná obrazovka s vlastným ovládaním (šípka späť), preto sa kontroluje zvlášť.
    await page.locator('#nav-7dni').click();
    await pockajNaPrechod(page);
    await page.locator('#week-list [data-day-index="5"]').click();
    const detail = await new AxeBuilder({ page }).analyze();
    const vazne = detail.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(vazne.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
});

test('prístupnosť: otázka na polohu a sivé karty bez panelov bez závažných nálezov axe', async ({ page }) => {
    test.slow();
    const vazne = async () =>
        (await new AxeBuilder({ page }).analyze()).violations
            .filter((v) => v.impact === 'serious' || v.impact === 'critical')
            .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
    await openApp(page, { settings: null });
    await page.locator('#wz-place').fill('Sev');
    await page.locator('.geo-pick', { hasText: 'Sevilla' }).click();
    await expect(page.locator('#wz-later')).toBeVisible();
    expect(await vazne()).toEqual([]);
    await page.locator('#wz-later').click();
    for (const panel of ['terazky', 'mozem']) {
        await page.locator(`#nav-${panel}`).click();
        await pockajNaPrechod(page);
        expect(await vazne(), panel).toEqual([]);
    }
});

/**
 * Karta Terazky má na širokej obrazovke celú šírku stránky - kým existovala karta
 * Dnes-Zajtra, delili si ju na polovicu. Stránka je tu položkou zvislého flexu a vystredenie
 * cez `margin: 0 auto` jej vypína naťahovanie na šírku; karta pritom vlastnú šírku nemá
 * (graf dňa je `container-type: inline-size`), takže bez `width: 100%` by sa stránka scvrkla
 * na svoje okraje. Vľavo je číslo s grafom, vpravo odporúčania pod sebou - listovať netreba.
 */
test('široká obrazovka: karta Terazky má celú šírku stránky, graf vľavo a odporúčania vpravo pod sebou', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const errors = await openApp(page, { start: 'terazky' });
    await expect(page.locator('#panel-terazky')).toBeVisible();

    const rozlozenie = await page.evaluate(() => {
        const stranka = document.getElementById('page');
        const style = getComputedStyle(stranka);
        const obsah = stranka.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        const box = (/** @type {string} */ id) => document.getElementById(id).getBoundingClientRect();
        const karty = [...document.querySelectorAll('#tz-strip .tz-rec')].map((k) => k.getBoundingClientRect());
        return {
            stranka: Math.round(stranka.getBoundingClientRect().width),
            obsah: Math.round(obsah),
            panel: Math.round(box('panel-terazky').width),
            grafVpravo: box('tz-chart').right,
            odporucaniaVlavo: box('tz-recs').left,
            podSebou: karty.every((k, i) => i === 0 || k.top >= karty[i - 1].bottom),
            pasSaPosuva: document.getElementById('tz-strip').scrollWidth > document.getElementById('tz-strip').clientWidth,
        };
    });
    // Stránka je široká na maximum, ktoré jej dáva --page-max (1120 px na desktope).
    expect(rozlozenie.stranka, 'stránka sa scvrkla, karta nedostala celú šírku').toBe(1120);
    expect(Math.abs(rozlozenie.panel - rozlozenie.obsah), 'karta nevyplní celú šírku stránky').toBeLessThanOrEqual(1);
    expect(rozlozenie.odporucaniaVlavo, 'odporúčania nie sú vedľa grafu').toBeGreaterThan(rozlozenie.grafVpravo);
    expect(rozlozenie.podSebou, 'karty odporúčaní nie sú pod sebou').toBe(true);
    expect(rozlozenie.pasSaPosuva, 'pás odporúčaní sa na širokej obrazovke posúva do strán').toBe(false);
    await expect(page.locator('#tz-dots')).toBeHidden();
    for (const id of ['tz-now-head', 'tz-devices', 'tz-today', 'tz-later']) await expect(page.locator(`#${id}`)).toBeInViewport();
    await expect(page.locator('#tz-now-head')).toHaveText(terazAt(atTime('13:00').instant).cards?.now.head ?? '');
    expect(errors).toEqual([]);
});

/**
 * Plátno grafu sa na širokej karte kreslí na jej skutočný rozmer (fillDims), nie na pevné
 * 680x420 - viewBox preto musí sedieť s pixelmi 1:1, inak by sa graf naťahoval a popisky
 * skresľovali. Zároveň mu musí ostať kladná plocha pod okrajmi plátna.
 */
test('široká obrazovka: plátno grafu sedí s rozmerom karty 1:1', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const errors = await openApp(page);
    await page.locator('#nav-7dni').click();
    const chart = await page.evaluate(() => {
        const el = document.getElementById('week-curve');
        const [, , vw, vh] = (el.getAttribute('viewBox') || '').split(/\s+/).map(Number);
        const r = el.getBoundingClientRect();
        return { vw, vh, w: Math.round(r.width), h: Math.round(r.height) };
    });
    expect(Math.abs(chart.vw - chart.w), `šírka plátna ${chart.vw} nesedí s kartou ${chart.w}`).toBeLessThanOrEqual(1);
    expect(Math.abs(chart.vh - chart.h), `výška plátna ${chart.vh} nesedí s kartou ${chart.h}`).toBeLessThanOrEqual(1);
    // padT (18) + padB (34) z chartDims; pod tým by graf kreslil do zápornej plochy.
    expect(chart.vh, 'plátno grafu je nižšie než jeho vlastné okraje').toBeGreaterThan(18 + 34);
    expect(errors).toEqual([]);
});

/**
 * Na desktope má appka sadnúť na obrazovku bez scrollovania - grafy sa prispôsobia výške
 * okna. Najtesnejší bežný prípad je notebook 1366x768; tam sa to buď zmestí, alebo nikde.
 * Tabuľka sa kontroluje zvlášť: jej riadky sa na rozdiel od grafov zmenšiť nedajú, tak má
 * vlastný stĺpec cez obe rady mriežky.
 */
test('desktop: appka sa zmestí na obrazovku bez scrollovania', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const errors = await openApp(page);

    for (const [nav, panel] of PANELS.map((p) => [`#nav-${p}`, `#panel-${p}`])) {
        await page.locator(nav).click();
        await expect(page.locator(panel)).toBeVisible();
        const scroll = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
        expect(scroll, `karta ${panel} preteká cez výšku obrazovky o ${scroll} px`).toBeLessThanOrEqual(0);
    }

    // Na karte 7 dní musia byť vidno všetky dni naraz, nie po scrollovaní v tabuľke.
    await page.locator('#nav-7dni').click();
    const tabulka = await page.evaluate(() => {
        const wrap = document.querySelector('.week-tbl-wrap');
        const spodok = wrap.getBoundingClientRect().bottom;
        const riadky = [...document.querySelectorAll('#week-tbody tr')];
        return {
            spolu: riadky.length,
            vidno: riadky.filter((tr) => tr.getBoundingClientRect().bottom <= spodok + 1).length,
        };
    });
    expect(tabulka.vidno, 'v tabuľke 7 dní nie je vidno všetky riadky naraz').toBe(tabulka.spolu);
    expect(errors).toEqual([]);
});

/**
 * Karta Terazky je na mobile bežný dokument ako ostatné karty: čo sa nezmestí, doscrolluje sa.
 * Na nízkej obrazovke na výšku aj na telefóne na šírku musí byť po doscrollovaní celý pás
 * odporúčaní nad spodnou navigáciou - dostupný, nie odstrihnutý ani zakrytý.
 */
test('mobil: karta Terazky sa dá doscrollovať a pás odporúčaní ostane nad navigáciou', async ({ page }) => {
    for (const { width, height } of [
        { width: 390, height: 844 },
        { width: 390, height: 520 },
        { width: 740, height: 360 },
    ]) {
        await page.setViewportSize({ width, height });
        const errors = await openApp(page, { start: 'terazky' });
        const rozmer = `${width}x${height}`;
        await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
        const geometria = await page.evaluate(() => ({
            pasSpodok: document.getElementById('tz-dots').getBoundingClientRect().bottom,
            navVrch: document.querySelector('.bottomnav').getBoundingClientRect().top,
        }));
        expect(geometria.pasSpodok, `${rozmer}: pás odporúčaní sa ani po doscrollovaní nedostane nad spodnú navigáciu`).toBeLessThanOrEqual(
            geometria.navVrch,
        );
        await expect(page.locator('#tz-chart svg'), rozmer).toBeVisible();
        expect(errors).toEqual([]);
    }
});

/**
 * Spodná navigácia má pod ikonou meno karty - bez neho ľudia nevedeli, čo ktorá ikona znamená.
 * Na 320px širokom displeji má položka len 64px, „Nastavenie“ sa tam musí zmestiť na jeden
 * riadok bez orezania. Výška položky je ťukací cieľ, Apple odporúča aspoň 44px. Pás je vyšší
 * než bez popisiek, preto sa skúša aj --nav-h: koniec každej karty musí ostať nad pásom.
 */
test('mobil: každá položka navigácie má viditeľný text na jeden riadok a výšku aspoň 44 px', async ({ page }) => {
    const errors = await openApp(page);
    for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 700 });
        for (const panel of PANELS) {
            const item = page.locator(`#nav-${panel}`);
            const lbl = item.locator('.lbl');
            await expect(lbl, `${width}px: ${panel}`).toBeVisible();
            await expect(lbl).not.toHaveText('');
            const m = await item.evaluate((btn) => {
                const l = /** @type {HTMLElement} */ (btn.querySelector('.lbl'));
                const b = btn.getBoundingClientRect();
                const r = l.getBoundingClientRect();
                return {
                    vyska: b.height,
                    riadkov: Math.round(r.height / parseFloat(getComputedStyle(l).lineHeight)),
                    orezana: l.scrollWidth > l.clientWidth + 0.5 || r.left < b.left - 0.5 || r.right > b.right + 0.5,
                    pismo: parseFloat(getComputedStyle(l).fontSize),
                };
            });
            const nazov = `${width}px, ${await lbl.textContent()}`;
            expect(m.vyska, nazov).toBeGreaterThanOrEqual(44);
            expect(m.riadkov, nazov).toBe(1);
            expect(m.orezana, nazov).toBe(false);
            expect(m.pismo, nazov).toBeGreaterThanOrEqual(11);
        }
        for (const panel of PANELS) {
            await page.locator(`#nav-${panel}`).click();
            await ocakavajKartu(page, panel);
            await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
            const g = await page.evaluate(
                (id) => ({
                    spodok: /** @type {HTMLElement} */ (document.getElementById(id)).getBoundingClientRect().bottom,
                    navVrch: /** @type {HTMLElement} */ (document.querySelector('.bottomnav')).getBoundingClientRect().top,
                }),
                `panel-${panel}`,
            );
            expect(g.spodok, `${width}px: koniec karty ${panel} je schovaný pod navigáciou`).toBeLessThanOrEqual(g.navVrch);
        }
    }
    expect(errors).toEqual([]);
});

/**
 * Obnovu ťahom nadol (pull to refresh) robí prehliadač sám: ponúkne ju, keď je stránka na
 * vrchu a dá sa potiahnuť nadol. Stačí jedno overflow: hidden na <body> - prenáša sa na
 * výrez okna - a gesto ticho zmizne. Presne to sa kedysi stalo karte Terazky, ktorá si telo
 * zamykala kvôli garancii bez scrollovania. Telo musí ostať voľné, inak karta stratí obnovu,
 * ktorú ostatné karty majú.
 */
test('mobil: ťahom nadol sa dá obnoviť každá karta', async ({ page }) => {
    const errors = await openApp(page);
    for (const panel of PANELS) {
        await page.locator(`#nav-${panel}`).click();
        await expect(page.locator(`#panel-${panel}`)).toBeVisible();
        const zamknute = await page.evaluate(() =>
            [document.documentElement, document.body]
                .map((el) => `${el.tagName.toLowerCase()}: ${getComputedStyle(el).overflowY}`)
                .filter((s) => s.endsWith('hidden') || s.endsWith('clip')),
        );
        expect(zamknute, `karta ${panel}: telo stránky je zamknuté, prehliadač neponúkne obnovu ťahom`).toEqual([]);
    }
    expect(errors).toEqual([]);
});

test('široká obrazovka: prepnutie na 7 dní skryje kartu Terazky', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const errors = await openApp(page);
    await page.locator('#nav-7dni').click();
    await expect(page.locator('#panel-7dni')).toBeVisible();
    await expect(page.locator('#panel-terazky')).toBeHidden();
    await page.locator('#nav-nastavenie').click();
    await expect(page.locator('#panel-terazky')).toBeHidden();
    expect(errors).toEqual([]);
});

/**
 * Strop jasnej oblohy (bodkovaná čiara nad stĺpcom) na širokej karte prechádzal cez
 * číslo výroby nad stĺpcom. Na desktope sa preto nekreslí - a keďže sa nekreslí, ani
 * legenda k nemu nesmie zostať vidno (rovnaký prípad ako živá krivka v Predpovedi).
 */
test('7 dní - strop jasnej oblohy: na desktope zmizne aj s legendou, na mobile ostáva', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const errors = await openApp(page);
    await page.locator('#nav-7dni').click();
    await expect(page.locator('#week-bars .clear-cap')).toHaveCount(0);
    await expect(page.locator('#week-bars-clear-legend')).toBeHidden();

    // Na mobile žijú stĺpce v detaile dňa - strop aj jeho legenda sa kontrolujú tam.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.week-list-hero').click();
    await expect(page.locator('#week-bars .clear-cap')).toHaveCount(7);
    await expect(page.locator('#week-bars-clear-legend')).toBeVisible();
    expect(errors).toEqual([]);
});

/**
 * Správa "Najsilnejší deň" (.msg-block) je v HTML posledným potomkom .week-grid, hneď za
 * kartou tabuľky. Na desktope zdieľa s kartou tabuľky (.week-block:nth-child(4)) tú istú
 * bunku a align-self ju zospodu zasunie do voľného miesta pod siedmimi riadkami - nesmie
 * prekryť ani posunúť samotnú tabuľku. Na mobile patrí k detailu týždňa a ide v ňom
 * posledná, až za mapou výroby.
 */
test('7 dní - správa "Najsilnejší deň": na desktope pod tabuľkou, na mobile v detaile týždňa', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const errors = await openApp(page);
    await page.locator('#nav-7dni').click();

    const desktop = await page.evaluate(() => {
        const rect = (sel) => document.querySelector(sel).getBoundingClientRect();
        const rows = [...document.querySelectorAll('#week-tbody tr')];
        return {
            msg: rect('#panel-7dni .msg-block'),
            table: rect('#panel-7dni .week-block:nth-child(4)'),
            lastRowBottom: rows[rows.length - 1].getBoundingClientRect().bottom,
            rowCount: rows.length,
        };
    });
    // Zdieľa kartu s tabuľkou - rovnaký ľavý aj pravý okraj, žiadny vlastný rám navyše.
    expect(Math.abs(desktop.msg.left - desktop.table.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(desktop.msg.right - desktop.table.right)).toBeLessThanOrEqual(1);
    // Pod posledným riadkom tabuľky, nie cez neho.
    expect(desktop.msg.top).toBeGreaterThanOrEqual(desktop.lastRowBottom - 1);
    // Zasunutá dolu, k päte tej istej karty.
    expect(Math.abs(desktop.msg.bottom - desktop.table.bottom)).toBeLessThanOrEqual(2);
    // Tabuľku to neovplyvnilo - všetkých 7 riadkov je stále vidno.
    expect(desktop.rowCount).toBe(7);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#week-msg-block')).toBeHidden();
    await page.locator('.week-list-hero').click();
    const mobile = await page.evaluate(() => ({
        msgTop: document.querySelector('#panel-7dni .msg-block').getBoundingClientRect().top,
        heatBottom: document.querySelector('#week-block-heat').getBoundingClientRect().bottom,
    }));
    expect(mobile.msgTop, 'správa nie je až za mapou výroby').toBeGreaterThanOrEqual(mobile.heatBottom - 1);
    expect(errors).toEqual([]);
});

/** Ťah prstom z bodu (x, y) o (dx, dy) za `ms` milisekúnd. Dotyk ide cez CDP, teda ako
 * naozajstný prst - test tak vidí aj to, čo po geste urobí prehliadač sám (kompatibilný klik
 * tam, kde prst skončil).
 *
 * Trvanie gesta neurčujú skutočné hodiny, ale časové pečiatky udalostí: z `timestamp` v CDP
 * prehliadač berie `event.timeStamp`, ktorým appka meria rýchlosť ťahu. Pod záťažou celej sady
 * sa totiž aj štyri správy CDP natiahli nad SWIPE.flickMs a rýchle švihnutie ponad graf vyšlo
 * ako pomalé sledovanie krivky. Čakanie medzi krokmi ostáva, aby veci v appke na časovačoch
 * bežali rovnako ako pod skutočným prstom - o gestách už ale nerozhoduje.
 * @param {import('@playwright/test').Page} page
 * @param {{ x: number, y: number, dx: number, dy?: number, ms?: number }} gesto */
async function tah(page, { x, y, dx, dy = 0, ms = 0 }) {
    const kroky = [0.5, 1];
    const t0 = Date.now() / 1000;
    const cdp = await page.context().newCDPSession(page);
    /** @param {'touchStart' | 'touchMove' | 'touchEnd'} type @param {{ x: number, y: number }[]} touchPoints @param {number} t podiel trvania */
    const posli = (type, touchPoints, t) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints, timestamp: t0 + (ms * t) / 1000 });
    await posli('touchStart', [{ x, y }], 0);
    for (const t of kroky) {
        if (ms) await page.waitForTimeout(ms / kroky.length);
        await posli('touchMove', [{ x: x + dx * t, y: y + dy * t }], t);
    }
    await posli('touchEnd', [], 1);
    await cdp.detach();
}

/** Potiahnutie prstom naprieč prvkom, stred ťahu je v strede prvku.
 * @param {import('@playwright/test').Page} page @param {string} sel prvok, ponad ktorý sa ťahá
 * @param {{ dx: number, dy?: number, ms?: number }} gesto posun prsta v pixeloch a jeho trvanie */
async function swipe(page, sel, { dx, dy = 0, ms = 0 }) {
    const box = await page.locator(sel).boundingBox();
    if (!box) throw new Error(`Prvok ${sel} nie je vidno`);
    await tah(page, { x: box.x + box.width / 2 - dx / 2, y: box.y + box.height / 2 - dy / 2, dx, dy, ms });
}

/** Ťah prstom v danom mieste obrazovky. Prázdne miesto pod krátkou kartou nie je prvok,
 * takže sa nedá zamerať selektorom ako pri `swipe`.
 * @param {import('@playwright/test').Page} page @param {{ x: number, y: number, dx: number }} opts */
function tahajVBode(page, opts) {
    return tah(page, opts);
}

/** Ťuknutie prstom: krátke podržanie a mikropohyb, ako pri skutočnej ruke. @param {import('@playwright/test').Page} page @param {number} x @param {number} y */
async function tuknutie(page, x, y) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await page.waitForTimeout(SWIPE.flickMs + 50);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 2, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
}

/** Ťuknutie úplne bez pohybu: prst sa nepohol ani o pixel, takže neprišiel žiadny touchmove
 * a appka má na rozhodnutie len touchstart a touchend. @param {import('@playwright/test').Page} page @param {number} x @param {number} y */
async function tuknutieBezPohybu(page, x, y) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await page.waitForTimeout(80);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
}

/** Preblikol tooltip niekedy počas gesta? Stav po geste nestačí: appka tooltip po prepnutí
 * karty aj tak zatvára a sám sa zatvára po TOOLTIP_HOLD_MS, takže kontrola „potom" by
 * preblikutie nikdy nechytila. Preto sa trieda sleduje cez MutationObserver od začiatku gesta.
 * @param {import('@playwright/test').Page} page @param {string} id */
async function sledujTooltip(page, id) {
    await page.evaluate((id) => {
        const el = /** @type {HTMLElement} */ (document.getElementById(id));
        window.tooltipBolVidno = el.classList.contains('visible');
        new MutationObserver(() => {
            if (el.classList.contains('visible')) window.tooltipBolVidno = true;
        }).observe(el, { attributes: true, attributeFilter: ['class'] });
    }, id);
}

/** @param {import('@playwright/test').Page} page */
function boloVidno(page) {
    return page.evaluate(() => window.tooltipBolVidno);
}

/** Animácia trvá 200 ms, takže na pohľad po geste už môže byť preč - test preto zbiera
 * `animationstart` rovnako, ako sledujTooltip zbiera preblikanie tooltipu.
 * @param {import('@playwright/test').Page} page */
async function sledujAnimacie(page) {
    await page.evaluate(() => {
        // Poslucháč sa vešia raz za stránku; ďalšie volania len vynulujú zoznam. Druhý
        // poslucháč by do toho istého poľa zapisoval každú animáciu dvakrát.
        if (!window.spusteneAnimacie)
            document.addEventListener('animationstart', (e) => window.spusteneAnimacie.push(e.animationName), true);
        window.spusteneAnimacie = [];
    });
}

/**
 * Mená animácií prisunutia dňa, ktoré odvtedy naskočili.
 *
 * Najprv sa počká na dva snímky. Triedu s animáciou pridá render synchrónne, ale
 * `animationstart` ohlási prehliadač až vo svojom ďalšom snímku - na zaťaženom stroji tak
 * test čítal zoznam skôr, než doň čokoľvek pribudlo, a prisunutie mu vychádzalo ako
 * nenaskočené (na štyroch jadrách padal asi každý dvanásty pokus). Čaká sa rovnako aj tam,
 * kde je správne očakávanie nula: inak by "nič sa nespustilo" prešlo len preto, že sa čítalo
 * priskoro.
 * @param {import('@playwright/test').Page} page
 */
async function animacieDna(page) {
    await page.evaluate(() => new Promise((hotovo) => requestAnimationFrame(() => requestAnimationFrame(() => hotovo(undefined)))));
    const mena = await page.evaluate(() => window.spusteneAnimacie);
    return mena.filter((/** @type {string} */ n) => n.startsWith('day-in'));
}

/** @param {import('@playwright/test').Page} page @param {string} panel */
async function ocakavajKartu(page, panel) {
    await expect(page.locator(`#panel-${panel}`)).toBeVisible();
    await expect(page.locator(`#nav-${panel}`)).toHaveAttribute('aria-current', 'page');
}

/** Položky v karte Nastavenie sú zbalené, kým na ne človek neťukne. Rozbalí ju, ak ešte nie je.
 * @param {import('@playwright/test').Page} page @param {string} id */
async function otvorPolozku(page, id) {
    const item = page.locator(`#${id}`);
    if ((await item.getAttribute('open')) === null) await item.locator('> summary').click();
    await expect(item).toHaveAttribute('open', '');
}

/** Graf priebehu dňa je na mobile až v detaile vybraného dňa - otvára sa klikom na riadok
 * rebríčka. @param {import('@playwright/test').Page} page @param {number} [den] */
async function otvorDetailDna(page, den = 0) {
    await page.locator('#nav-7dni').click();
    await page.locator(`#week-list [data-day-index="${den}"]`).click();
    await expect(page.locator('#week-curve-wrap')).toBeVisible();
}

test('prechod medzi kartami: smer podľa poradia a nič nepretečie do strán', async ({ page }) => {
    const errors = await openApp(page);

    // Smer prechodu si CSS berie z #page[data-dir]; karta sa podľa neho prisunie zľava alebo sprava.
    const smerAAnimacia = () =>
        page.evaluate(() => ({
            dir: document.getElementById('page')?.dataset.dir,
            animacia: getComputedStyle(/** @type {Element} */ (document.querySelector('.panel:not(.hidden)'))).animationName,
        }));

    await page.locator('#nav-7dni').click();
    expect(await smerAAnimacia()).toEqual({ dir: 'next', animacia: 'panel-in-next' });
    await page.locator('#nav-terazky').click();
    expect(await smerAAnimacia()).toEqual({ dir: 'prev', animacia: 'panel-in-prev' });

    // Posunutá karta na okamih presiahne stránku do strany. Meria sa to počas celého prechodu,
    // nie až po ňom: vodorovný scroll, ktorý sa objaví na 200 ms, je aj tak chyba.
    const sledujPretecenie = page.evaluate(
        () =>
            new Promise((resolve) => {
                let max = 0;
                const zaciatok = performance.now();
                const krok = () => {
                    const el = document.documentElement;
                    max = Math.max(max, el.scrollWidth - el.clientWidth);
                    if (performance.now() - zaciatok < 500) requestAnimationFrame(krok);
                    else resolve(max);
                };
                requestAnimationFrame(krok);
            }),
    );
    await page.locator('#nav-nastavenie').click();
    expect(await sledujPretecenie, 'stránku sa dalo počas prechodu poscrollovať do strán').toBe(0);
    expect(errors).toEqual([]);
});

/**
 * Tlačidlo novej karty ide do stránky skôr než skript, ktorý ju zapojí (pravidlo o cache
 * v CLAUDE.md). Nová stránka so starým skriptom z cache ho teda môže ukázať - a klik naň
 * nesmie skryť všetky karty. Test ho odkryje a klikne naň ako na kartu, ktorú skript nepozná.
 */
test('klik na tlačidlo karty, ktorú skript nepozná, nezmení kartu', async ({ page }) => {
    const errors = await openApp(page);
    await page.evaluate(() => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'nav-neznama';
        btn.dataset.panel = 'neznama';
        btn.textContent = 'Neznáma';
        document.querySelector('.bottomnav-inner')?.append(btn);
    });
    await page.locator('#nav-neznama').click();
    await ocakavajKartu(page, 'mozem');
    expect(errors).toEqual([]);
});

/**
 * Tlačidlo Späť na telefóne a tablete (a šípka v prehliadači) je jediná vec, ktorá sa
 * v appke dá „vrátiť": kroky navigácie - prepnutie karty a otvorenie detailu dňa.
 * Adresa sa pritom nemení, položky histórie nesú len krok navigácie.
 */
test('tlačidlo Späť vracia o krok v appke, dopredu ide zase tam', async ({ page }) => {
    const errors = await openApp(page);
    const adresa = page.url();

    await page.locator('#nav-nastavenie').click();
    await page.locator('#nav-7dni').click();
    await page.locator('#week-list [data-day-index="5"]').click();
    await expect(page.locator('#week-day-head')).toBeVisible();
    expect(page.url(), 'appka nemení adresu, odkaz na ňu ostáva jeden').toBe(adresa);

    // Späť najprv zavrie detail dňa, potom sa vracia po kartách - v opačnom poradí, než sa šlo.
    await page.goBack();
    await expect(page.locator('#week-day-head')).toBeHidden();
    await ocakavajKartu(page, '7dni');
    await page.goBack();
    await ocakavajKartu(page, 'nastavenie');
    await page.goBack();
    await ocakavajKartu(page, 'mozem');

    // Dopredu vedie tá istá cesta naspäť, vrátane otvoreného detailu dňa.
    await page.goForward();
    await ocakavajKartu(page, 'nastavenie');
    await page.goForward();
    await ocakavajKartu(page, '7dni');
    await page.goForward();
    await expect(page.locator('#week-day-head')).toBeVisible();
    expect(errors).toEqual([]);
});

/** Krokom navigácie je karta a detail dňa, nič iné. Listovanie odporúčaní či výber dňa sa
 * deje vnútri karty, takže Späť ich nepočíta - inak by sa z appky nedalo odísť. */
test('Späť nepočíta výber vnútri karty, po vyčerpaní krokov opustí appku', async ({ page }) => {
    const errors = await openApp(page, { start: 'terazky' });
    const zaciatok = await page.evaluate(() => history.length);

    // Prelistovanie odporúčaní aj náhľad iného času sú výber vnútri karty, nie krok navigácie.
    await page.locator('#tz-strip').evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
    await expect(page.locator('#tz-dots i').nth(3)).toHaveClass('on');
    await page.locator('#tz-chart').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#tz-reset')).toBeVisible();
    await page.locator('#nav-7dni').click();
    expect(await page.evaluate(() => history.length), 'do histórie pribudlo len prepnutie karty').toBe(zaciatok + 1);

    // Jediný krok späť je teda návrat na prvú kartu; ďalší už z appky odchádza (v nainštalovanej
    // appke je odchod z prvej karty jej zatvorením - zavrieť sa sama nevie a ani nemá).
    await page.goBack();
    await ocakavajKartu(page, 'terazky');
    expect(await page.evaluate(() => history.state), 'na prvej karte už appka v histórii nič nedrží').toEqual({
        step: { panel: 'terazky', weekDetail: null, setup: null, roof: 0, info: null, summary: false, list: false },
    });
    expect(errors).toEqual([]);
});

/** Šípka v hlavičke detailu je ten istý krok ako tlačidlo Späť. Keby zapísala nový krok
 * (prehľad), ostal by detail v histórii za ním a Späť na telefóne by ho znovu otvorilo. */
test('šípka späť z detailu dňa je krok späť: Späť potom detail znovu neotvorí', async ({ page }) => {
    const errors = await openApp(page);
    await page.locator('#nav-7dni').click();
    await page.locator('#week-list [data-day-index="5"]').click();
    await expect(page.locator('#week-day-head')).toBeVisible();

    await page.locator('#week-day-back').click();
    await expect(page.locator('#week-day-head')).toBeHidden();
    await ocakavajKartu(page, '7dni');

    // Ďalší krok späť vedie tam, odkiaľ sa na kartu 7 dní prišlo - nie do detailu.
    await page.goBack();
    await ocakavajKartu(page, 'mozem');
    await expect(page.locator('#week-day-head')).toBeHidden();
    expect(errors).toEqual([]);
});

test('Zdieľať appku: odkaz, ktorý sa do QR kódu nezmestí, ostane len na tlačidle WhatsApp', async ({ page }) => {
    // Kód unesie odkaz bez nastavenia, s nastavením elektrárne už nie.
    await podvrhniQr(page, APP_URL.length + 20);
    const errors = await openApp(page);
    await page.locator('#nav-nastavenie').click();
    await page.locator('#info-share > summary').click();
    await expect(page.locator('#qrcode [data-qr]')).toHaveAttribute('data-qr', APP_URL);
    await expect(page.locator('#qrcode')).toBeVisible();
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).qrLevels)).toEqual([0]);

    await page.locator('#share-with-settings').check();
    await expect(page.locator('#qrcode')).toBeHidden();
    const dlhy = shareUrl(APP_URL, OWNER, false);
    await expect(page.locator('#share-whatsapp')).toBeVisible();
    await expect(page.locator('#share-whatsapp')).toHaveAttribute('href', `https://wa.me/?text=${encodeURIComponent(dlhy)}`);

    // Kratší odkaz sa do kódu zase zmestí.
    await page.locator('#share-with-settings').uncheck();
    await expect(page.locator('#qrcode')).toBeVisible();
    await expect(page.locator('#qrcode [data-qr]')).toHaveAttribute('data-qr', APP_URL);
    expect(errors).toEqual([]);
});

/** Rozbalená položka sekcie Appka je krok navigácie: Späť na telefóne ju zbalí a ukáže zoznam,
 * až ďalšie Späť prepne kartu. Zbalenie ťuknutím je ten istý krok - Späť ju potom znovu nerozbalí. */
test('Späť v sekcii Appka zbalí položku a vráti na zoznam, nie na predchádzajúcu kartu', async ({ page }) => {
    const errors = await openApp(page);
    await page.locator('#nav-7dni').click();
    await page.locator('#nav-nastavenie').click();
    await page.locator('#info-share > summary').click();
    await expect(page.locator('#qrcode')).toBeVisible();

    await page.goBack();
    await ocakavajKartu(page, 'nastavenie');
    await expect(page.locator('#qrcode')).toBeHidden();
    await expect(page.locator('#info-share > summary')).toBeVisible();

    // Zbalenie ťuknutím ide cez históriu: ďalšie Späť už prepne kartu, položku znovu nerozbalí.
    await page.locator('#info-share > summary').click();
    await expect(page.locator('#qrcode')).toBeVisible();
    await page.locator('#info-share > summary').click();
    await expect(page.locator('#qrcode')).toBeHidden();
    await page.goBack();
    await ocakavajKartu(page, '7dni');

    // Po návrate na kartu Nastavenie je zoznam zbalený, nič neostalo rozbalené z minula.
    await page.locator('#nav-nastavenie').click();
    await expect(page.locator('#qrcode')).toBeHidden();
    expect(errors).toEqual([]);
});

test.describe('listovanie kariet prstom', () => {
    test.use({ hasTouch: true });

    /** Detail dňa je otvorený na `den`. @param {import('@playwright/test').Page} page @param {number} den */
    async function ocakavajDetailDna(page, den) {
        await expect(page.locator('#week-day-title')).toHaveText(weekDayLong(forecast.days[den].date, den));
        await expect(page.locator('#week-day-head')).toBeVisible();
        await ocakavajKartu(page, '7dni');
    }

    test('ťah do strán prepína karty v poradí navigácie, na kraji sa zastaví', async ({ page }) => {
        const errors = await openApp(page);
        await ocakavajKartu(page, 'mozem');

        // Pred prvou kartou nič nie je - listovanie sa nezacyklí.
        await swipe(page, '#mozem-body', { dx: 120 });
        await ocakavajKartu(page, 'mozem');

        // Doľava sa ide dopredu v poradí navigácie, doprava späť.
        await swipe(page, '#mozem-body', { dx: -120 });
        await ocakavajKartu(page, 'terazky');
        await swipe(page, '.tz-head', { dx: -120 });
        await ocakavajKartu(page, '7dni');
        await swipe(page, '#week-sub', { dx: -120 });
        await ocakavajKartu(page, 'statistika');
        await swipe(page, '#stats-sub', { dx: -120 });
        await ocakavajKartu(page, 'nastavenie');

        // Za poslednou kartou už nič nie je.
        await swipe(page, '#setup', { dx: -120 });
        await ocakavajKartu(page, 'nastavenie');

        await swipe(page, '#setup', { dx: 120 });
        await ocakavajKartu(page, 'statistika');
        await swipe(page, '#stats-sub', { dx: 120 });
        await ocakavajKartu(page, '7dni');
        await swipe(page, '#week-sub', { dx: 120 });
        await ocakavajKartu(page, 'terazky');
        await swipe(page, '.tz-head', { dx: 120 });
        await ocakavajKartu(page, 'mozem');

        // Na prvej karte znova ostane.
        await swipe(page, '#mozem-body', { dx: 120 });
        await ocakavajKartu(page, 'mozem');
        await swipe(page, '#mozem-body', { dx: -120 });
        await ocakavajKartu(page, 'terazky');

        // Šikmý ťah je posúvanie po stránke, nie listovanie.
        await swipe(page, '.tz-head', { dx: -120, dy: 120 });
        await ocakavajKartu(page, 'terazky');
        expect(errors).toEqual([]);
    });

    /**
     * Na vysokom displeji je karta Nastavenie bez zadaných panelov (výzva k sprievodcovi a dve položky
     * Appka) kratšia než obrazovka. Kus plochy pod ňou pre prst ku karte patrí - a musí tam
     * listovať rovnako ako nad obsahom. Kým poslucháče gesta sedeli na #page (tá je vysoká
     * presne podľa obsahu karty), ťah v tomto mieste neurobil nič a karta sa dala prelistovať
     * len nad jej hornou časťou.
     */
    test('ťah v prázdnom mieste pod krátkou kartou listuje rovnako ako nad jej obsahom', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 1400 });
        const errors = await openApp(page, { settings: null, site: SITE });
        await page.locator('#nav-nastavenie').click();
        await ocakavajKartu(page, 'nastavenie');

        const karta = await page.locator('#panel-nastavenie').boundingBox();
        const prazdno = { x: 195, y: karta.y + karta.height + 40, dx: 120 };
        expect(prazdno.y, 'prázdne miesto musí byť nad pásom navigácie').toBeLessThan(1400 - 120);

        await tahajVBode(page, prazdno);
        await ocakavajKartu(page, 'statistika');
        expect(errors).toEqual([]);
    });

    /** Posúvač (sklon strechy v sprievodcovi) sa ťahá do strán - ťah po ňom nesmie prepnúť
     * kartu. Je to menovaná úchytka v swipe.js, rovnako ako jazdec na ciferníku. */
    test('ťahanie posúvača sklonu neprepne kartu', async ({ page }) => {
        const errors = await openApp(page);
        await page.locator('#nav-nastavenie').click();
        await otvorPolozku(page, 'settings-plant');
        await page.locator('#setup-rows [data-setup-edit="roof:0"]').click();
        await page.locator('[data-setup-tab="sklon"]').click();
        // Posúvač je nízko na obrazovke - ťah musí začať naozaj na ňom, nie pod okrajom displeja
        // ani pod tlačidlami sprievodcu, ktoré sa lepia k spodku. Človek ťahá posúvač, ktorý vidí.
        await page.locator('#wz-tilt').evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await swipe(page, '#wz-tilt', { dx: -120 });
        await ocakavajKartu(page, 'nastavenie');
        await expect(page.locator('#wz-sklon')).toBeVisible();
        expect(errors).toEqual([]);
    });

    /** Po kruhu rozvrhu tarify prst maľuje pásmo - ťah po ňom nesmie prepnúť kartu. Aj on je
     * menovaná úchytka v swipe.js. */
    test('ťah po kruhu rozvrhu tarify neprepne kartu', async ({ page }) => {
        const errors = await openApp(page);
        await page.locator('#nav-nastavenie').click();
        await otvorPolozku(page, 'settings-plant');
        await page.locator('#setup-rows [data-setup-edit="tarifa"]').click();
        await page.locator('#wz-tariff-tabs [data-setup-tab="rozvrh"]').click();
        await page.locator('#wz-tariff-ring').evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await swipe(page, '#wz-tariff-ring', { dx: -120 });
        await ocakavajKartu(page, 'nastavenie');
        await expect(page.locator('#wz-rozvrh')).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('pás odporúčaní si ťahanie necháva pre seba aj na krajnej karte', async ({ page }) => {
        const errors = await openApp(page, { start: 'terazky' });
        const pas = page.locator('#tz-strip');
        await pas.scrollIntoViewIfNeeded();

        // Pás pod grafom sa listuje sám, takže gesto nad ním patrí jemu a karta appky ostáva -
        // aj na prvej karte pásu, z ktorej naspäť nevedie nič.
        await swipe(page, '#tz-strip', { dx: 120 });
        await ocakavajKartu(page, 'terazky');
        await swipe(page, '#tz-strip', { dx: -120 });
        await ocakavajKartu(page, 'terazky');

        // To isté na poslednej karte pásu.
        await pas.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
        await expect(page.locator('#tz-dots i').nth(3)).toHaveClass('on');
        await swipe(page, '#tz-strip', { dx: -120 });
        await ocakavajKartu(page, 'terazky');
        expect(errors).toEqual([]);
    });

    test('nad grafom listuje švihnutie, pomalé sledovanie krivky nie', async ({ page }) => {
        const errors = await openApp(page);
        await otvorDetailDna(page);

        // Ťahaním po krivke sa graf prezerá (tooltip ide za prstom) - to nie je listovanie.
        // Tooltip sa sám zatvára po TOOLTIP_HOLD_MS, takže sa pozerá na sledovanú triedu, nie
        // na stav po kontrole karty - na zaťaženom stroji by sa trafila až za ten čas.
        await sledujTooltip(page, 'week-curve-tooltip');
        await swipe(page, '#week-curve-wrap', { dx: -120, ms: 500 });
        expect(await boloVidno(page), 'pomalý ťah po krivke neukázal tooltip').toBe(true);
        await ocakavajDetailDna(page, 0);

        // Rýchle švihnutie ponad ten istý graf prelistuje na ďalší deň a tooltip po sebe
        // upratá - hodnota pod prstom už patrí inej krivke.
        await swipe(page, '#week-curve-wrap', { dx: -120 });
        await ocakavajDetailDna(page, 1);
        await expect(page.locator('#week-curve-tooltip')).not.toHaveClass(/visible/);
        expect(errors).toEqual([]);
    });

    test('pri švihnutí ponad graf tooltip ani neprebliskne, ťuknutie ho ukáže', async ({ page }) => {
        const errors = await openApp(page);
        await otvorDetailDna(page);

        await sledujTooltip(page, 'week-curve-tooltip');
        await swipe(page, '#week-curve-wrap', { dx: -120 });
        await ocakavajDetailDna(page, 1);
        expect(await boloVidno(page), 'tooltip preblikol počas švihnutia').toBe(false);

        // Ťuknutie na graf ho naopak ukázať musí - inak by sa hodnota nedala prečítať.
        // Aj tu sa pozerá na sledovanú triedu, nie na stav po chvíli: tooltip sa sám zatvára
        // po TOOLTIP_HOLD_MS a na zaťaženom stroji by sa kontrola trafila až za ten čas.
        await otvorDetailDna(page);
        await sledujTooltip(page, 'week-curve-tooltip');
        await swipe(page, '#week-curve-wrap', { dx: 0 });
        expect(await boloVidno(page), 'ťuknutie na graf neukázalo tooltip').toBe(true);
        await ocakavajDetailDna(page, 0);
        expect(errors).toEqual([]);
    });

    /** Grafy sa čítajú po vodorovnej osi, takže zvislý ťah nie je ich prezeranie, ale posúvanie
     * stránky - a to patrí prehliadaču (`.chart-wrap { touch-action: pan-y }`). Test drží obe
     * polovice: že sa stránka cez graf naozaj posunie, aj že pritom tooltip ani nepreblikne.
     * Ide cez detail týždňa: tam sú dva grafy pod sebou, takže je kam scrollovať (v detaile
     * dňa sa obsah na displej zmestí a test by nemeral nič). */
    test('zvislý ťah cez graf posúva stránku a tooltip neukáže', async ({ page }) => {
        // Nižší displej (375x667, veľkosť menšieho telefónu): na tom, z ktorého sú ostatné
        // testy, sa karta zmestí celá.
        await page.setViewportSize({ width: 375, height: 667 });
        const errors = await openApp(page);
        await page.locator('#nav-7dni').click();
        await page.locator('.week-list-hero').click();
        await expect(page.locator('#week-bars-wrap')).toBeVisible();
        expect(
            await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
            'karta sa celá zmestí na displej, nie je kam scrollovať - test by nič nemeral',
        ).toBeGreaterThan(0);

        await sledujTooltip(page, 'week-bars-tooltip');
        await swipe(page, '#week-bars-wrap', { dx: 0, dy: -120, ms: 400 });
        expect(await boloVidno(page), 'tooltip preblikol pri posúvaní stránky').toBe(false);
        expect(await page.evaluate(() => window.scrollY), 'stránka sa cez graf neposunula').toBeGreaterThan(0);

        // Aj krátky scroll je scroll: prst prešiel menej, než je hranica švihnutia, takže na
        // dĺžku vyzerá ako ťuknutie - rozhoduje to, že sa stránka posunula.
        await page.evaluate(() => window.scrollTo(0, 0));
        await sledujTooltip(page, 'week-bars-tooltip');
        await swipe(page, '#week-bars-wrap', { dx: 0, dy: -40, ms: 400 });
        expect(await boloVidno(page), 'tooltip sa ukázal po krátkom posunutí stránky').toBe(false);
        await ocakavajKartu(page, '7dni');
        expect(errors).toEqual([]);
    });

    /** Ťuknutie, pri ktorom sa prst ani nepohne, nepošle jediný touchmove - appka má na
     * rozhodnutie len začiatok a koniec gesta. Aj tak musí hodnotu ukázať, a nechať ju na
     * displeji: prehliadač po ťuknutí dopošle kurzorové udalosti a tooltip z nich kedysi
     * zhasol do 15 ms, takže z neho ostalo bliknutie. Test preto kontroluje aj to, že tam
     * po chvíli ešte stále je. */
    test('ťuknutie na graf bez pohybu prsta ukáže tooltip a ten ostane', async ({ page }) => {
        const errors = await openApp(page);
        await otvorDetailDna(page);
        const graf = await page.locator('#week-curve-wrap').boundingBox();
        if (!graf) throw new Error('graf priebehu dňa nie je vidno');

        await sledujTooltip(page, 'week-curve-tooltip');
        await tuknutieBezPohybu(page, graf.x + graf.width / 2, graf.y + graf.height / 2);
        expect(await boloVidno(page), 'ťuknutie bez pohybu prsta neukázalo tooltip').toBe(true);
        // Polovica času, po ktorom sa tooltip zatvára sám - dovtedy musí byť vidno.
        await page.waitForTimeout(TOOLTIP_HOLD_MS / 2);
        expect(
            await page.evaluate(() => document.getElementById('week-curve-tooltip')?.classList.contains('visible')),
            'tooltip po ťuknutí hneď zhasol',
        ).toBe(true);
        expect(errors).toEqual([]);
    });

    /** Každé zdvihnutie prsta naplánuje zhasnutie tooltipu. Druhé ťuknutie preto musí zrušiť
     * časovač prvého - inak by tooltip z druhého ťuknutia zhasol skôr, než by sa dal prečítať. */
    test('druhé ťuknutie na graf nechá tooltip svietiť celý čas, nezhasne ho časovač prvého', async ({ page }) => {
        const errors = await openApp(page);
        await otvorDetailDna(page);
        const graf = await page.locator('#week-curve-wrap').boundingBox();
        if (!graf) throw new Error('graf priebehu dňa nie je vidno');
        const y = graf.y + graf.height / 2;
        const svieti = () => page.evaluate(() => document.getElementById('week-curve-tooltip')?.classList.contains('visible'));

        await tuknutieBezPohybu(page, graf.x + graf.width * 0.4, y);
        await page.waitForTimeout(TOOLTIP_HOLD_MS * 0.6);
        await tuknutieBezPohybu(page, graf.x + graf.width * 0.6, y);
        // Časovač prvého ťuknutia už vypršal, druhého ešte nie.
        await page.waitForTimeout(TOOLTIP_HOLD_MS * 0.6);
        expect(await svieti(), 'tooltip druhého ťuknutia zhasol po časovači prvého').toBe(true);
        expect(errors).toEqual([]);
    });

    test('ťah doprava z detailu dňa je krok späť: Späť potom detail znovu neotvorí', async ({ page }) => {
        const errors = await openApp(page);
        await page.locator('#nav-7dni').click();
        await page.locator('#week-list [data-day-index="0"]').click();
        await ocakavajDetailDna(page, 0);

        // Z prvého dňa nie je kam listovať, ťah doprava zavrie detail - rovnako ako šípka.
        await swipe(page, '#week-day-head', { dx: 120 });
        await expect(page.locator('#week-day-head')).toBeHidden();
        await ocakavajKartu(page, '7dni');

        await page.goBack();
        await ocakavajKartu(page, 'mozem');
        await expect(page.locator('#week-day-head')).toBeHidden();
        expect(errors).toEqual([]);
    });

    test('ťah ponad rebríček dní prepne kartu a neotvorí detail dňa', async ({ page }) => {
        const errors = await openApp(page);
        await page.locator('#nav-7dni').click();

        // Rebríček sa nemá kam posúvať do strán, gesto teda patrí karte. Klik, ktorý by po
        // ťahu otvoril detail dňa, appka zruší.
        await swipe(page, '#week-list', { dx: -120 });
        await ocakavajKartu(page, 'statistika');
        await page.locator('#nav-7dni').click();
        await expect(page.locator('#week-day-head')).toBeHidden();
        expect(errors).toEqual([]);
    });

    /**
     * Prehľad dní sa na mobile nesmie dať posunúť do strán. Kým tu stála tabuľka s piatimi
     * stĺpcami, na úzkom displeji pretekala a prvý ťah posunul ju - kartu prelistoval až ten
     * druhý, z pohľadu človeka "swipe nefunguje". Rebríček sa vojde do každej šírky, lebo
     * pásik je pružný stĺpec mriežky (`1fr` v .wday) a zvyšok má pevné šírky.
     *
     * Testujú sa obe hranice naraz: bežný úzky telefón (360 px, Galaxy S22 a spol.) aj
     * vonkajší displej skladačky (280 px), kde tabuľka pretekala vždy.
     */
    test('rebríček dní sa zmestí aj na 280 px a ťah rovno prepne kartu', async ({ page }) => {
        for (const width of [360, 280]) {
            await page.setViewportSize({ width, height: 844 });
            const errors = await openApp(page);
            await page.locator('#nav-7dni').click();

            const pretecenie = await page.locator('#week-block-list').evaluate((el) => {
                const pasy = [el, ...el.querySelectorAll('*')].map((n) => n.scrollWidth - n.clientWidth);
                return Math.max(...pasy);
            });
            expect(pretecenie, `šírka ${width}px: prehľad dní pretekal do strán`).toBeLessThanOrEqual(0);

            await swipe(page, '#week-list', { dx: -120 });
            await ocakavajKartu(page, 'statistika');
            expect(errors).toEqual([]);
        }
    });

    test('ťuknutie na graf dňa bez pohybu ukáže náhľad v tom čase a nechá ho svietiť', async ({ page }) => {
        const errors = await openApp(page, { start: 'terazky' });
        const bod = await bodGrafu(page, minuta('16:00'));
        await tuknutie(page, bod.x, bod.y);
        // Ťuknutie sa o 2 px pohne (tuknutie), čas náhľadu je štvrťhodina pod prstom.
        const cas = page.locator('#tz-chart .dc-at-t');
        await expect(cas).toHaveText(/^16:(00|15)$/);
        const ukazany = await cas.textContent();
        await page.waitForTimeout(TOOLTIP_HOLD_MS + 200);
        await expect(cas).toHaveText(ukazany ?? '');
        await ocakavajKartu(page, 'terazky');
        expect(errors).toEqual([]);
    });

    test('zvislý ťah cez graf dňa posunie stránku a náhľad neukáže', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        const errors = await openApp(page, { start: 'terazky' });
        const bod = await bodGrafu(page, minuta('12:00'));
        await tah(page, { x: bod.x, y: bod.y, dx: 0, dy: -160, ms: 300 });
        await expect.poll(() => page.evaluate(() => window.scrollY), 'stránka sa cez graf neposunula').toBeGreaterThan(0);
        await page.waitForTimeout(300);
        await expect(page.locator('#tz-hint')).toHaveText('Ťahaj prstom po grafe a pozri si iný čas.');
        await expect(page.locator('#tz-reset')).toBeHidden();
        await ocakavajKartu(page, 'terazky');
        expect(errors).toEqual([]);
    });

    /** Graf dňa je úchytka (DRAG_HANDLE vo web/gesture.js): gesto, ktoré by inde prelistovalo
     * kartu, na ňom posúva náhľad času. Preto rýchlo a ďaleko - kratší ťah než SWIPE.minDistPx
     * by za listovanie neprešiel ani bez tej výnimky a test by nekontroloval nič. */
    test('rýchly vodorovný ťah po grafe dňa ukazuje náhľad a kartu neprelistuje', async ({ page }) => {
        const errors = await openApp(page, { start: 'terazky' });
        const bod = await bodGrafu(page, minuta('16:00'));
        const ciel = await bodGrafu(page, minuta('09:00'));
        expect(Math.abs(ciel.x - bod.x), 'ťah je kratší než hranica listovania, test by nič nekontroloval').toBeGreaterThan(
            SWIPE.minDistPx,
        );
        await tah(page, { x: bod.x, y: bod.y, dx: ciel.x - bod.x, dy: 0, ms: 60 });
        await expect(page.locator('#tz-chart .dc-at-t')).toHaveText('09:00');
        await page.waitForTimeout(300);
        await ocakavajKartu(page, 'terazky');
        expect(errors).toEqual([]);
    });

    test('v detaile dňa listuje ťah dni, za posledným sa zastaví a z prvého vedie do prehľadu', async ({ page }) => {
        const errors = await openApp(page);
        await page.locator('#nav-7dni').click();
        await page.locator('#week-list [data-day-index="3"]').click();
        await ocakavajDetailDna(page, 3);

        // Doľava sa ide na ďalší deň, doprava na predchádzajúci - ako inde na karty, len
        // vnútri detailu. Karta ostáva tá istá a detail otvorený.
        await swipe(page, '#week-day-head', { dx: -120 });
        await ocakavajDetailDna(page, 4);
        await swipe(page, '#week-day-head', { dx: 120 });
        await ocakavajDetailDna(page, 3);

        // Posledný deň týždňa: doľava už nie je kam ísť a ťah nesmie prepnúť kartu.
        await page.locator('#week-day-back').click();
        await page.locator('#week-list [data-day-index="6"]').click();
        await swipe(page, '#week-day-head', { dx: -120 });
        await ocakavajDetailDna(page, 6);

        // Prvý deň: doprava už nie je kam listovať, tak ťah zavrie detail - to isté, čo šípka
        // späť v jeho hlavičke. Karta pod ním ostáva 7 dní.
        await page.locator('#week-day-back').click();
        await page.locator('#week-list [data-day-index="0"]').click();
        await ocakavajDetailDna(page, 0);
        await swipe(page, '#week-day-head', { dx: 120 });
        await expect(page.locator('#week-day-head')).toBeHidden();
        await ocakavajKartu(page, '7dni');
        expect(errors).toEqual([]);
    });

    /** Prisunutie je jediné, čo o prelistovaní dňa povie oko - bez neho sa obsah len prepne.
     * Test drží obe polovice: že animácia naskočí, aj že naskočí znovu pri druhom ťahu tým
     * istým smerom (vtedy sa karta neprekresľuje z display:none a bez striedania dvoch
     * rovnakých animácií by prehliadač druhýkrát nespustil nič). */
    test('prelistovanie dňa prisunie detail z tej strany, ktorou sa ťahalo', async ({ page }) => {
        const errors = await openApp(page);
        await page.locator('#nav-7dni').click();
        await page.locator('#week-list [data-day-index="2"]').click();
        await ocakavajDetailDna(page, 2);

        // Ťah doľava: nový deň príde sprava (bez triedy day-in-prev), na hlavičke aj na mriežke.
        await sledujAnimacie(page);
        await swipe(page, '#week-day-head', { dx: -120 });
        await ocakavajDetailDna(page, 3);
        expect(await animacieDna(page), 'prisunutie nenaskočilo').toHaveLength(2);
        await expect(page.locator('#week-grid')).not.toHaveClass(/day-in-prev/);

        // Druhý ťah tým istým smerom musí animáciu spustiť znovu.
        await sledujAnimacie(page);
        await swipe(page, '#week-day-head', { dx: -120 });
        await ocakavajDetailDna(page, 4);
        expect(await animacieDna(page), 'druhé prelistovanie nič nespustilo').toHaveLength(2);

        // Ťah doprava prisunie deň zľava.
        await sledujAnimacie(page);
        await swipe(page, '#week-day-head', { dx: 120 });
        await ocakavajDetailDna(page, 3);
        expect(await animacieDna(page), 'prisunutie späť nenaskočilo').toHaveLength(2);
        await expect(page.locator('#week-grid')).toHaveClass(/day-in-prev/);

        // Otvorenie detailu z prehľadu nie je listovanie - tam sa neprisúva nič.
        await page.locator('#week-day-back').click();
        await sledujAnimacie(page);
        await page.locator('#week-list [data-day-index="5"]').click();
        await ocakavajDetailDna(page, 5);
        expect(await animacieDna(page), 'otvorenie detailu sa tvárilo ako listovanie').toHaveLength(0);
        expect(errors).toEqual([]);
    });

    test('v detaile týždňa ťah doľava neurobí nič, doprava sa vráti do prehľadu', async ({ page }) => {
        const errors = await openApp(page);
        await page.locator('#nav-7dni').click();
        await page.locator('.week-list-hero').click();
        await expect(page.locator('#week-day-title')).toHaveText('Celý týždeň');

        // Doľava nie je kam ísť - je tam jediná obrazovka a vpred z detailu cesta nevedie.
        await swipe(page, '#week-day-head', { dx: -120 });
        await expect(page.locator('#week-day-title')).toHaveText('Celý týždeň');
        await ocakavajKartu(page, '7dni');

        // Doprava je krok späť: detail sa zavrie a ostane prehľad dní.
        await swipe(page, '#week-day-head', { dx: 120 });
        await expect(page.locator('#week-day-head')).toBeHidden();
        await ocakavajKartu(page, '7dni');
        expect(errors).toEqual([]);
    });
});

/**
 * Nič v stránke nesmie pretiecť do strán. Mobilné prehliadače na to reagujú tak, že rozšíria
 * layout viewport - appka sa potom kreslí širšia než displej a dá sa zoomovať "von" pod 100 %.
 * Chytilo nás to už trikrát: tabuľka 7 dní bez `min-width: 0`, tooltip pri okraji grafu bez
 * orezania, a naposledy tooltip, ktorý si po otočení displeja niesol pixelové súradnice zo
 * širokej obrazovky. Preto to stráži test celej triedy chýb, nie jednej príčiny.
 */
test.describe('otočenie displeja', () => {
    test.use({ hasTouch: true });

    test('po otočení na výšku stránka nepretečie do strán', async ({ page }) => {
        await page.setViewportSize({ width: 844, height: 390 });
        const errors = await openApp(page);
        // Na šírku je displej široký (768 px a viac), takže karta 7 dní ukazuje všetky bloky
        // naraz a graf priebehu je vidno bez otvárania detailu dňa.
        await page.locator('#nav-7dni').click();
        const wrap = page.locator('#week-curve-wrap');
        await wrap.scrollIntoViewIfNeeded();
        const graf = await wrap.boundingBox();
        if (!graf) throw new Error('graf priebehu dňa nie je vidno');

        // Ťuknutie čo najbližšie k pravému okraju grafu - tam má tooltip najväčšie súradnice.
        await tuknutie(page, Math.min(graf.x + graf.width - 3, 842), Math.min(Math.max(graf.y + graf.height / 2, 2), 388));
        await expect(page.locator('#week-curve-tooltip')).toHaveClass(/visible/);
        await page.waitForTimeout(TOOLTIP_HOLD_MS + TOOLTIP_FADE_MS + 100);

        await page.setViewportSize({ width: 390, height: 844 });
        await expect
            .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), {
                message: 'po otočení na výšku stránka trčí do strán',
            })
            .toBeLessThanOrEqual(0);
        expect(errors).toEqual([]);
    });
});

/**
 * iPhone s výrezom: po pridaní na plochu beží appka bez lišty prehliadača a jej stránka
 * začína až pod stavovým riadkom systému, teda pod hodinami a batériou (viewport-fit=cover
 * a black-translucent v index.html). Prehliadač o tejto zóne povie len cez
 * env(safe-area-inset-top), ktoré sa v teste nastaviť nedá - appka ju preto číta cez
 * premennú --safe-top a test si do nej dosadí výšku stavového riadku iPhonu.
 * Celá hlavička musí ostať pod ňou: inak sa názov firmy schová za systémové hodiny
 * a vykukne len na okamih pri ťahaní prstom nadol (presne to sa dialo).
 */
test('mobil: hlavička ostane pod stavovým riadkom telefónu', async ({ page }) => {
    const SAFE_TOP = 59;
    const errors = await openApp(page);
    await page.addStyleTag({ content: `:root { --safe-top: ${SAFE_TOP}px; }` });

    for (const panel of PANELS) {
        await page.locator(`#nav-${panel}`).click();
        const vrch = await page.evaluate(() => document.querySelector('.appbar-inner').getBoundingClientRect().top);
        expect(vrch, `karta ${panel}: hlavička zasahuje do stavového riadku`).toBeGreaterThanOrEqual(SAFE_TOP);
    }

    expect(errors).toEqual([]);
});

test.describe('moja elektráreň', () => {
    /** Prvé otvorenie appky: sprievodca začína otázkou na polohu. @param {import('@playwright/test').Page} page */
    async function otvorSprievodcu(page) {
        await expect(page.locator('#wz-lokalita')).toBeVisible();
        await expect(page.locator('#wz-step')).toHaveText('Vitaj');
    }
    /** @param {import('@playwright/test').Page} page */
    const dalej = (page) => page.locator('#wz-next').click();
    /** @param {import('@playwright/test').Page} page @param {string} query @param {string} name */
    async function vyberMiesto(page, query, name) {
        await page.locator('#wz-place').fill(query);
        await page.locator('.geo-pick', { hasText: name }).click();
    }
    /** Od otázky na polohu po obrazovku merania: Sevilla, panel 435 Wp, jedna plocha, menič 5 kW. @param {import('@playwright/test').Page} page */
    async function poMeranie(page) {
        await vyberMiesto(page, 'Sev', 'Sevilla');
        await dalej(page);
        await page.locator('[data-setup-wp="435"]').click();
        for (const step of ['panel', 'smer', 'sklon', 'pocet', 'dalsia']) {
            await expect(page.locator(`#wz-${step}`)).toBeVisible();
            await dalej(page);
        }
        await page.locator('[data-setup-ac="5"]').click();
        await dalej(page);
        await expect(page.locator('#wz-meranie')).toBeVisible();
    }
    /** @param {import('@playwright/test').Page} page */
    const ulozene = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), SETTINGS_STORAGE_KEY);

    /** Samotná poloha uložená v prehliadači (panely nie sú zadané). @param {import('@playwright/test').Page} page */
    const ulozenaPoloha = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), SITE_STORAGE_KEY);

    test('prvé otvorenie: len otázka na polohu, bez navigácie a bez sťahovania predpovede', async ({ page }) => {
        /** @type {string[]} */ const forecasts = [];
        page.on('request', (r) => /api\.open-meteo\.com/.test(r.url()) && forecasts.push(r.url()));
        const errors = await openApp(page, { settings: null });
        await otvorSprievodcu(page);
        await expect(page.locator('#wz-title')).toHaveText('Kde máš elektráreň?');
        await expect(page.locator('#pv-updated')).toHaveText('vitaj');
        await expect(page.locator('#bottomnav')).toBeHidden();
        await expect(page.locator('#panels-bar')).toBeHidden();
        // Za otázkou zatiaľ nie je nič, kam sa vrátiť.
        await expect(page.locator('#wz-close')).toBeHidden();
        await expect(page.locator('#wz-back')).toBeHidden();
        await expect(page.locator('#wz-prog')).toBeEmpty();
        // Panely sa dajú odložiť, až keď je poloha vybraná.
        await expect(page.locator('#wz-next')).toHaveText('Nastaviť panely');
        await expect(page.locator('#wz-next')).toBeDisabled();
        await expect(page.locator('#wz-later')).toBeHidden();
        await expect(page.locator('#wz-welcome [data-setup-go="odkaz"]')).toBeVisible();
        // Listovať nie je kam - ostatné karty ešte nič nevedia.
        await swipe(page, '#wizard', { dx: -120 });
        await ocakavajKartu(page, 'nastavenie');
        expect(forecasts).toEqual([]);
        expect(errors).toEqual([]);
    });

    test('„Teraz nie“: uloží sa len poloha, 7 dní ukáže predpoveď pre typickú strechu, Terazky a Môžem? sú sivé', async ({ page }) => {
        const errors = await openApp(page, { settings: null });
        await vyberMiesto(page, 'Sev', 'Sevilla');
        await page.locator('#wz-later').click();
        await ocakavajKartu(page, '7dni');
        await expect(page.locator('#bottomnav')).toBeVisible();
        // Ten istý výkon ako v Nastavení - kWp sa počíta aj píše na jednom mieste.
        await expect(page.locator('#week-sub')).toHaveText(`Sevilla · typická strecha ${kwpText((12 * 435) / 1000)}`);
        await expect(page.locator('#week-today')).not.toHaveText('–');
        // Karta 7 dní je o počasí, výzvu nepotrebuje.
        await expect(page.locator('#panels-bar')).toBeHidden();
        expect(await ulozene(page)).toBeNull();
        expect((await ulozenaPoloha(page)).name).toBe('Sevilla');

        // Po načítaní stránky sa appka otvára na svojej karte, už bez otázky na polohu.
        await page.reload();
        await appReady(page);
        await ocakavajKartu(page, 'mozem');
        await expect(page.locator('#pv-setup-go')).toHaveText('nastav panely ›');
        // Bez panelov odpovedá z typickej strechy, ako Obloha, a pás povie, s čím počíta.
        await expect(page.locator('.mozem-word')).not.toHaveText('Neviem.');
        await expect(page.locator('.mozem-fact')).toContainText('typická strecha');
        await expect(page.locator('#panels-bar')).toBeVisible();
        await expect(page.locator('#panels-bar')).toHaveClass(/\bodhad\b/);
        await page.locator('#nav-terazky').click();
        await expect(page.locator('#tz-num-val')).toHaveText(/^~[0-9]/);
        await expect(page.locator('#tz-num')).toHaveClass('tz-num est');
        await expect(page.locator('#panels-bar')).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('„Nastaviť panely“: poloha sa uloží hneď, sprievodca pokračuje panelmi a dá sa zavrieť', async ({ page }) => {
        const errors = await openApp(page, { settings: null });
        await vyberMiesto(page, 'Sev', 'Sevilla');
        await dalej(page);
        await expect(page.locator('#wz-panel')).toBeVisible();
        await expect(page.locator('#wz-step')).toHaveText('Krok 2 z 7 · Panely');
        await expect(page.locator('#bottomnav')).toBeVisible();
        expect((await ulozenaPoloha(page)).name).toBe('Sevilla');
        // Kto sprievodcu zavrie, má v Nastavení polohu a výzvu dokončiť elektráreň.
        await page.locator('#wz-close').click();
        await expect(page.locator('#setup-site')).toContainText('Sevilla');
        await expect(page.locator('#setup-cta')).toBeVisible();
        await expect(page.locator('#setup-overview')).toBeHidden();
        await page.locator('#setup-cta [data-setup-go="start"]').click();
        await expect(page.locator('#wz-panel')).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('len poloha: zmena polohy z Nastavenia uloží novú, panely ostávajú nezadané', async ({ page }) => {
        const errors = await openApp(page, { settings: null, site: SITE });
        await page.locator('#nav-nastavenie').click();
        await expect(page.locator('#setup-site-name')).toHaveText(SITE.name);
        await page.locator('#setup-site [data-setup-edit="lokalita"]').click();
        await expect(page.locator('#wz-next')).toHaveText('Uložiť zmenu');
        await expect(page.locator('#wz-next')).toBeDisabled();
        await vyberMiesto(page, 'Syd', 'Sydney');
        await dalej(page);
        await expect(page.locator('#setup-site-name')).toHaveText('Sydney');
        expect((await ulozenaPoloha(page)).name).toBe('Sydney');
        expect(await ulozene(page)).toBeNull();
        expect(errors).toEqual([]);
    });

    test('bez panelov: karty odpovedajú z typickej strechy ako Obloha, jantárový pás vedie do Nastavenia', async ({ page }) => {
        const errors = await openApp(page, { settings: null, site: SITE });
        const typical = typicalSettings(SITE);
        const vstup = { ...typical, known: /** @type {const} */ ('poloha'), now: FIXED_NOW, loading: false, pv: null };
        const forecast = buildForecast(weather, FIXED_NOW, SITE, typical.plant);
        const m = mozemModel({ ...vstup, forecast });
        const teraz = terazModel({ ...vstup, forecast, previewMinutes: null, zdroj: null, pristup: null });
        const kwp = installedKw(typical.plant);
        await ocakavajKartu(page, 'mozem');
        await expect(page.locator('#panels-bar')).toBeVisible();
        await expect(page.locator('#panels-bar')).toHaveClass(/\bodhad\b/);
        await expect(page.locator('#panels-bar-title')).toHaveText(MOZEM_SKY_TEXTS.guessTitle);
        const typicka = terazTypicalText(kwp);
        await expect(page.locator('#panels-bar-text')).toHaveText(`${typicka[0].toUpperCase()}${typicka.slice(1)}.`);
        await expect(page.locator('#panels-bar-go')).toHaveText(MOZEM_SKY_TEXTS.guessBtn);
        await expect(page.locator('.mozem-word')).toHaveText(m.word);
        await expect(page.locator('.mozem-fact')).toHaveText(m.hero.factK + m.hero.factV);
        expect(m.hero.factK).toBe('typická strecha');
        await expect(page.locator('.mozem-glance small')).toHaveText(mozemListTitle(true));
        await page.locator('[data-mozem-list]').click();
        await expect(page.locator('.mozem-list-kick')).toHaveText(new RegExp(' · odhad$'));
        await expect(page.locator('.mozem-short')).toHaveText(m.items.filter((i) => i.answer.kind !== 'always').map((i) => i.short));
        await page.locator('#nav-7dni').click();
        await expect(page.locator('#panels-bar')).toBeHidden();
        await page.locator('#nav-terazky').click();
        // Ten istý odhad ako karta Teraz novej appky: „~“ a veta o typickej streche.
        await expect(page.locator('#tz-num-val')).toHaveText(teraz.num);
        expect(teraz.num).toMatch(/^~[0-9]/);
        await expect(page.locator('#tz-sub')).toHaveText(teraz.sub);
        await expect(page.locator('#tz-now-head')).toHaveText(teraz.cards?.now.head ?? '');
        await page.locator('#nav-mozem').click();
        await expect(page.locator('#panels-bar')).toBeVisible();
        const vazne = (await new AxeBuilder({ page }).include('#panels-bar').analyze()).violations
            .filter((v) => v.impact === 'serious' || v.impact === 'critical')
            .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
        expect(vazne).toEqual([]);
        await page.locator('#panels-bar-go').click();
        await expect(page.locator('#panel-nastavenie')).toBeVisible();
        await expect(page.locator('#setup-cta')).toBeVisible();
        await expect(page.locator('#panels-bar')).toBeHidden();
        // Tlačidlo je krok navigácie ako ikona v spodnej lište: Späť vráti na Môžem? aj s pásom.
        await page.goBack();
        await expect(page.locator('#panel-mozem')).toBeVisible();
        await expect(page.locator('#panels-bar')).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('s uloženou elektrárňou výzva nie je na žiadnej karte', async ({ page }) => {
        await openApp(page);
        for (const panel of PANELS) {
            await page.locator(`#nav-${panel}`).click();
            await expect(page.locator('#panels-bar'), panel).toBeHidden();
            await expect(page.locator('#pv-setup-go'), panel).toBeHidden();
        }
        // Výzvy, ktoré bez panelov pulzujú, tu nie sú - a nič iné v kartách nepulzuje.
        await expect(page.locator('[data-stats-go="nastavenie"], #setup-cta:not(.hidden)')).toHaveCount(0);
        const pulzy = await page.evaluate(
            () => document.getAnimations().filter((a) => /** @type {CSSAnimation} */ (a).animationName === 'setup-pulse').length,
        );
        expect(pulzy).toBe(0);
    });

    /** Animácie bežiace na prvku (CSS animácie aj prechody). @param {import('@playwright/test').Locator} el */
    const animacie = (el) =>
        el.evaluate((e) =>
            e
                .getAnimations()
                .map((a) => ({ name: /** @type {CSSAnimation} */ (a).animationName, end: a.effect?.getComputedTiming().endTime })),
        );

    test('bez panelov: odkaz „nastav panely ›“ v hlavičke otvorí sprievodcu na kroku Panely, v Nastavení je text', async ({ page }) => {
        const errors = await openApp(page, { settings: null, site: SITE });
        await page.locator('#nav-statistika').click();
        await expect(page.locator('#pv-setup-go')).toHaveText('nastav panely ›');
        await expect(page.locator('#pv-updated')).toBeHidden();
        const vazne = (
            await new AxeBuilder({ page }).include('.appbar').withRules(['color-contrast', 'button-name']).analyze()
        ).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
        expect(vazne).toEqual([]);
        await page.locator('#pv-setup-go').click();
        await expect(page.locator('#panel-nastavenie')).toBeVisible();
        await expect(page.locator('#wz-panel')).toBeVisible();
        await expect(page.locator('#wz-step')).toHaveText('Krok 2 z 7 · Panely');
        // V Nastavení, kde človek už je, ostáva obyčajný text.
        await expect(page.locator('#pv-setup-go')).toBeHidden();
        await expect(page.locator('#pv-updated')).toHaveText('panely nie sú zadané');
        // Odkaz je jeden krok navigácie: Späť vráti na Štatistiku aj s odkazom.
        await page.goBack();
        await expect(page.locator('#panel-statistika')).toBeVisible();
        await expect(page.locator('#pv-setup-go')).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('bez panelov: výzvy na Štatistike a v Nastavení pulzujú pri každom vstupe na kartu najviac 5 s', async ({ page }) => {
        const errors = await openApp(page, { settings: null, site: SITE });
        const vyzvy = /** @type {const} */ ([
            ['statistika', '[data-stats-go="nastavenie"]'],
            ['nastavenie', '#setup-cta [data-setup-go="start"]'],
        ]);
        for (const [panel, selector] of vyzvy) {
            await page.locator(`#nav-${panel}`).click();
            const vyzva = page.locator(selector);
            await expect(vyzva).toBeVisible();
            const [pulz] = await animacie(vyzva);
            expect(pulz.name, panel).toBe('setup-pulse');
            expect(pulz.end, panel).toBeLessThanOrEqual(5000);
            // Po pár pulzoch skončí ...
            await expect.poll(() => animacie(vyzva), { timeout: 7000 }).toEqual([]);
            // ... a pri ďalšom vstupe na kartu začne odznova.
            await page.locator('#nav-7dni').click();
            await page.locator(`#nav-${panel}`).click();
            expect(
                (await animacie(vyzva)).map((a) => a.name),
                panel,
            ).toEqual(['setup-pulse']);
        }
        expect(errors).toEqual([]);
    });

    test('bez panelov s útlmom pohybu výzvy nepulzujú', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const errors = await openApp(page, { settings: null, site: SITE });
        await page.locator('#nav-statistika').click();
        await expect(page.locator('[data-stats-go="nastavenie"]')).toBeVisible();
        expect(await animacie(page.locator('[data-stats-go="nastavenie"]'))).toEqual([]);
        await page.locator('#nav-nastavenie').click();
        await expect(page.locator('#setup-cta [data-setup-go="start"]')).toBeVisible();
        expect(await animacie(page.locator('#setup-cta [data-setup-go="start"]'))).toEqual([]);
        expect(errors).toEqual([]);
    });

    test('sprievodca: prvé nastavenie od polohy po uloženie, prežije načítanie stránky', async ({ page }) => {
        const errors = await openApp(page, { settings: null });
        await otvorSprievodcu(page);

        // Poloha: kým nie je vybraná, ďalej sa nedá. Potvrdí ju dnešný východ a západ slnka.
        await expect(page.locator('#wz-next')).toBeDisabled();
        await vyberMiesto(page, 'Sev', 'Sevilla');
        const sevilla = GEOCODE.results[0];
        const site = {
            name: 'Sevilla',
            lat: sevilla.latitude,
            lon: sevilla.longitude,
            elevationM: sevilla.elevation,
            timezone: sevilla.timezone,
        };
        const sun = sunTimes(site, localDateKey(FIXED_NOW, site.timezone));
        await expect(page.locator('#wz-place-card')).toContainText(minutesToTimeStr(/** @type {number} */ (sun.rise)));
        await expect(page.locator('#wz-place-card')).toContainText(minutesToTimeStr(/** @type {number} */ (sun.set)));
        await dalej(page);

        // Výkon panelu: bez výberu sa ďalej nedá, „Neviem“ dosadí bežnú hodnotu.
        await expect(page.locator('#wz-next')).toBeDisabled();
        await page.locator('[data-setup-wp="guess"]').click();
        await expect(page.locator('#wz-wp-guess')).toBeVisible();
        await page.locator('[data-setup-wp="435"]').click();
        await expect(page.locator('#wz-wp-guess')).toBeHidden();
        await dalej(page);

        // Smer, sklon a počet prvej plochy.
        await expect(page.locator('#wz-sub')).toHaveText('Plocha 1');
        await page.locator('[data-setup-az="135"]').click();
        await expect(page.locator('[data-setup-az="135"]')).toHaveAttribute('aria-checked', 'true');
        await expect(page.locator('#wz-dir-name')).toHaveText('Juhovýchod');
        await dalej(page);
        await page.locator('[data-setup-tilt="45"]').click();
        await expect(page.locator('#wz-tilt')).toHaveValue('45');
        await dalej(page);
        await page.locator('[data-setup-step="1"]').click();
        await expect(page.locator('#wz-panels')).toHaveValue('11');
        await expect(page.locator('#wz-panel-grid rect.pv')).toHaveCount(11);
        await dalej(page);

        // Jedna plocha stačí, menič, meranie preskočiť.
        await expect(page.locator('#wz-next')).toHaveText('Nie, to je všetko');
        await dalej(page);
        await page.locator('[data-setup-ac="5"]').click();
        await dalej(page);
        await expect(page.locator('#wz-next')).toHaveText('Preskočiť');
        await dalej(page);

        // Tarifa: nový používateľ začína jednou cenou, takže po type sadzby idú rovno ceny.
        await expect(page.locator('#wz-step')).toHaveText('Krok 6 z 7 · Tarifa');
        await expect(page.locator('[data-setup-kind="jedna"]')).toHaveAttribute('aria-pressed', 'true');
        await page.locator('[data-setup-kind="dunno"]').click();
        await expect(page.locator('#wz-tariff-dunno')).toBeVisible();
        await dalej(page);
        await expect(page.locator('#wz-ceny')).toBeVisible();
        await dalej(page);

        // Zhrnutie: nič sa ešte neuložilo.
        await expect(page.locator('#wz-step')).toHaveText('Krok 7 z 7 · Kontrola');
        await expect(page.locator('#wz-summary [data-setup-edit="tarifa"]')).toContainText('Jedna cena celý deň');
        await expect(page.locator('#wz-summary .big')).toHaveText(kwpText((11 * 435) / 1000));
        expect(await ulozene(page)).toBeNull();
        await dalej(page);

        await otvorPolozku(page, 'settings-plant');
        await expect(page.locator('#setup-overview')).toBeVisible();
        await expect(page.locator('#setup-note')).toHaveText('Uložené. Prepočítavam predpoveď.');
        await expect(page.locator('#pv-updated')).toHaveText('odhad z predpovede');
        const stored = await ulozene(page);
        expect(stored.site.name).toBe('Sevilla');
        expect(stored.strings).toEqual([{ panels: 11, azimuthDeg: 135, tiltDeg: 45 }]);
        expect(stored.acLimitKw).toBe(5);
        expect(stored.tariff.bands).toEqual([{ id: 'j', name: 'Cena', level: 'bezna', price: null }]);
        expect(stored.zdroj).toBe(null);

        await page.reload();
        await expect(page.locator('#pv-updated')).toHaveText('odhad z predpovede');
        await page.locator('#nav-7dni').click();
        await expect(page.locator('#week-sub')).toHaveText(`Sevilla · ${kwpText((11 * 435) / 1000)}`);
        expect(errors).toEqual([]);
    });

    test('tlačidlo Späť na telefóne vracia o obrazovku sprievodcu, „Späť“ v sprievodcovi je ten istý krok', async ({ page }) => {
        const errors = await openApp(page, { settings: null, site: SITE });
        await page.locator('#nav-nastavenie').click();
        await page.locator('#setup-cta [data-setup-go="start"]').click();
        await page.locator('[data-setup-wp="435"]').click();
        await dalej(page);
        await dalej(page);
        await expect(page.locator('#wz-sklon')).toBeVisible();

        await page.goBack();
        await expect(page.locator('#wz-smer')).toBeVisible();
        // Tlačidlo „Späť“ ide cez históriu: ďalšie Späť na telefóne potom neotvorí to, odkiaľ sa prišlo.
        await page.locator('#wz-back').click();
        await expect(page.locator('#wz-panel')).toBeVisible();
        await page.goBack();
        await expect(page.locator('#setup-cta')).toBeVisible();
        await expect(page.locator('#wizard')).toBeHidden();
        expect(errors).toEqual([]);
    });

    test('celkový výkon namiesto panelu: výkon panelu sa dopočíta a nezmysel nepustí ďalej', async ({ page }) => {
        const errors = await openApp(page, { settings: null });
        await otvorSprievodcu(page);
        await vyberMiesto(page, 'Sev', 'Sevilla');
        await dalej(page);
        await page.locator('#wz-wpmode-kwp').click();
        await expect(page.locator('#wz-title')).toHaveText('Aký výkon má celá elektráreň?');
        await page.locator('#wz-kwp').fill('10,44');
        await dalej(page);
        await dalej(page);
        await dalej(page);
        await page.locator('#wz-panels').fill('24');
        await expect(page.locator('#wz-panels-kwp')).toContainText('dopočítam');
        await dalej(page);
        await expect(page.locator('#wz-derived')).toHaveText('Spolu 24 panelov a 10,44 kWp, teda 435 Wp na panel.');
        await expect(page.locator('#wz-next')).toBeEnabled();

        // Tri panely na 10 kWp by mali po 3 480 Wp - taký panel neexistuje.
        await page.locator('[data-setup-roof-edit="0"]').click();
        await dalej(page);
        await dalej(page);
        await page.locator('#wz-panels').fill('3');
        await dalej(page);
        await expect(page.locator('#wz-derived .err')).toContainText('3480 Wp');
        await expect(page.locator('#wz-next')).toBeDisabled();
        expect(errors).toEqual([]);
    });

    test('plochy: pridať do troch, odstrániť', async ({ page }) => {
        const errors = await openApp(page, { settings: null });
        await otvorSprievodcu(page);
        await vyberMiesto(page, 'Sev', 'Sevilla');
        await dalej(page);
        await page.locator('[data-setup-wp="435"]').click();
        for (let i = 0; i < 4; i++) await dalej(page);
        for (const roof of [2, 3]) {
            await page.locator('#wz-roof-add').click();
            await expect(page.locator('#wz-sub')).toHaveText(`Plocha ${roof} z ${roof}`);
            for (let i = 0; i < 3; i++) await dalej(page);
        }
        await expect(page.locator('#wz-roofs .roof-row')).toHaveCount(3);
        await expect(page.locator('#wz-roof-add')).toBeHidden();
        await expect(page.locator('#wz-title')).toHaveText('Tri plochy sú maximum');
        await page.locator('[data-setup-roof-del="0"]').click();
        await expect(page.locator('#wz-roofs .roof-row')).toHaveCount(2);
        await expect(page.locator('#wz-roof-add')).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('južná pologuľa: nová plocha sa otočí na sever, uložená plocha na juh dostane varovanie', async ({ page }) => {
        const errors = await openApp(page, { settings: null });
        await otvorSprievodcu(page);
        await vyberMiesto(page, 'Syd', 'Sydney');
        await dalej(page);
        await page.locator('[data-setup-wp="435"]').click();
        await dalej(page);
        await expect(page.locator('[data-setup-az="0"]')).toHaveAttribute('aria-checked', 'true');

        // Uložená elektráreň v Dvoranoch (plochy na juh a východ) presunutá do Sydney.
        await page.goto('/');
        await page.evaluate(([key, value]) => localStorage.setItem(key, value), [SETTINGS_STORAGE_KEY, JSON.stringify(toUser(OWNER))]);
        await page.reload();
        await appReady(page);
        await page.locator('#nav-nastavenie').click();
        await otvorPolozku(page, 'settings-plant');
        await page.locator('#setup-rows [data-setup-edit="lokalita"]').click();
        await vyberMiesto(page, 'Syd', 'Sydney');
        await dalej(page);
        await expect(page.locator('#setup-warnings')).toContainText('južnej pologuli');
        expect(errors).toEqual([]);
    });

    test('úprava z prehľadu: len jeden krok, uloží sa hneď; zrušenie nechá, ako bolo', async ({ page }) => {
        const errors = await openApp(page);
        await page.locator('#nav-nastavenie').click();
        await otvorPolozku(page, 'settings-plant');
        await expect(page.locator('#setup-hero .big')).toHaveText('10,44 kWp');

        await page.locator('#setup-rows [data-setup-edit="roof:1"]').click();
        await expect(page.locator('#wz-step')).toHaveText('Úprava · Strecha');
        await expect(page.locator('#wz-roof-tabs')).toBeVisible();
        await expect(page.locator('#wz-next')).toHaveText('Uložiť zmenu');
        await expect(page.locator('#wz-next')).toBeDisabled();
        await page.locator('[data-setup-az="180"]').click();
        await page.locator('[data-setup-tab="sklon"]').click();
        await page.locator('[data-setup-tilt="20"]').click();
        await dalej(page);
        await expect(page.locator('#setup-overview')).toBeVisible();
        const stored = await ulozene(page);
        expect(stored.strings[1]).toEqual({ panels: 8, azimuthDeg: 180, tiltDeg: 20 });
        expect(toUser(/** @type {any} */ (settingsFromLink(page.url()))), 'adresa nesie nové nastavenie').toEqual({
            ...stored,
            zdroj: null,
        });

        // × pri úprave zahodí zmenu.
        await page.locator('#setup-rows [data-setup-edit="menic"]').click();
        await page.locator('[data-setup-ac="5"]').click();
        await page.locator('#wz-close').click();
        await expect(page.locator('#setup-rows [data-setup-edit="menic"]')).toContainText('10 kW');
        expect((await ulozene(page)).acLimitKw).toBe(10);
        expect(errors).toEqual([]);
    });

    test('Enter vo vyhľadávaní lokality nič neuloží, len hľadá', async ({ page }) => {
        const errors = await openApp(page, { settings: null });
        await otvorSprievodcu(page);
        await page.locator('#wz-place').fill('Sev');
        await page.locator('#wz-place').press('Enter');
        await expect(page.locator('.geo-pick', { hasText: 'Sevilla' })).toBeVisible();
        await expect(page.locator('#wz-lokalita')).toBeVisible();
        expect(await ulozene(page)).toBeNull();
        expect(errors).toEqual([]);
    });

    test('pripojenie merania: značka, cudzí odkaz nepustí, kiosk sa pripojí a uloží len zapečatený', async ({ page }) => {
        const errors = await openApp(page, { settings: null });
        /** @type {Record<string, string[]>} */ const bodies = { pv: [], pripoj: [] };
        page.on('request', (r) => {
            if (r.url() === WORKER_PV_URL) bodies.pv.push(r.postData() || '');
            if (r.url() === WORKER_PRIPOJ_URL) bodies.pripoj.push(r.postData() || '');
        });
        await otvorSprievodcu(page);
        await poMeranie(page);
        await page.locator('#wz-live-yes').click();
        await dalej(page);
        await expect(page.locator('#wz-znacka')).toBeVisible();
        await expect(page.locator('#wz-title')).toHaveText('Akú značku má tvoj menič?');
        await expect(page.locator('#wz-next')).toBeDisabled();
        // Značka, ktorá sa nedá: povie prečo a ponúkne odhad.
        await page.locator('[data-setup-znacka="fronius"]').click();
        await expect(page.locator('#wz-title')).toHaveText('Fronius zatiaľ pripojiť nevieme');
        await expect(page.locator('#wz-nie')).toBeVisible();
        await page.locator('#wz-back').click();
        // Huawei má dva spôsoby: API účet od inštalatéra je prvý, kiosk druhý.
        await page.locator('[data-setup-znacka="huawei"]').click();
        await expect(page.locator('#wz-title')).toHaveText('Ako pripojíš Huawei?');
        await expect(page.locator('#wz-sposoby [data-setup-sposob]').first()).toHaveAttribute('data-setup-sposob', 'huawei-northbound');
        await page.locator('[data-setup-sposob="huawei-kiosk"]').click();
        await expect(page.locator('#wz-pripoj')).toBeVisible();
        await expect(page.locator('#wz-title')).toHaveText('Odkaz na kiosk');
        await expect(page.locator('#wz-next')).toBeDisabled();
        const pole = page.locator('[data-setup-pole="odkaz"]');
        await pole.fill('https://example.com/?kk=Abc123xyz');
        await expect(page.locator('#wz-pripoj-note')).toHaveClass(/err/);
        await expect(page.locator('#wz-pripojit')).toBeDisabled();
        const kiosk = 'https://region01eu5.fusionsolar.huawei.com/pvmswebsite/nologin/assets/build/index.html#/kiosk?kk=Abc123xyz';
        await pole.fill(kiosk);
        await expect(page.locator('#wz-pripoj-note')).toHaveText('Vyzerá to ako kiosk FusionSolar.');
        await page.locator('#wz-pripojit').click();
        // Jedna nájdená elektráreň je rovno pripojená a ukáže, čo práve namerala.
        await expect(page.locator('#wz-stanice')).toContainText('Pripojené');
        await expect(page.locator('#wz-stanice [data-setup-stanica="0"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#wz-stanice [data-setup-stanica="0"]')).toContainText('Dvorany');
        await expect(page.locator('#wz-pripojit')).toBeHidden();
        expect(JSON.parse(bodies.pripoj[0])).toEqual({ sposob: 'huawei-kiosk', udaje: { odkaz: kiosk } });
        await dalej(page);
        // Tarifa: jedna cena, typ a ceny.
        await dalej(page);
        await dalej(page);
        await expect(page.locator('#wz-summary')).toContainText('Huawei · Dvorany');
        await dalej(page);
        // Sevilla, FIXED_NOW 11:00 UTC = 13:00 miestneho.
        await expect(page.locator('#pv-updated')).toHaveText('meranie');
        // Prehľad v Nastavení ukáže, že kiosk odpovedá, aj čas posledného merania - na mobile
        // namiesto podnadpisu, ten sa skryje.
        await otvorPolozku(page, 'settings-plant');
        const meranie = page.locator('#setup-rows [data-setup-edit="meranie"]');
        await expect(meranie.locator('.sum-live.in-line.ok')).toHaveText('pripojené · 13:00');
        await expect(meranie.locator('.sum-live.in-line')).toBeVisible();
        await expect(meranie.locator('.sum-live.at-side')).toBeHidden();
        await expect(meranie.locator('.v')).toBeHidden();
        // Meranie z pripojenia stačí, appka sa hneď po uložení znova nepýta (pripojenePv). Odkaz
        // nie je v úložisku ani v adrese.
        expect(bodies.pv).toEqual([]);
        expect((await ulozene(page)).zdroj).toEqual(TEST_ZDROJ);
        expect(JSON.stringify(await ulozene(page))).not.toContain('Abc123xyz');
        expect(page.url()).not.toContain(TEST_ZDROJ.pecat);
        expect(errors).toEqual([]);
    });

    /** Bod na kruhu rozvrhu tarify pre minútu dňa: kruh má rovnakú geometriu ako ciferník
     * (poludnie hore, polomer rDay), len iný viewBox (-12 … 252). @param {import('@playwright/test').Page} page @param {number} minutes */
    async function bodNaKruhu(page, minutes) {
        const box = await page.locator('#wz-tariff-ring').boundingBox();
        if (!box) throw new Error('kruh rozvrhu nie je vidno');
        const r = (RING.rDay / 264) * box.width;
        const rad = ((minutes / 1440) * 2 + 0.5) * Math.PI;
        return { x: box.x + box.width / 2 + r * Math.cos(rad), y: box.y + box.height / 2 + r * Math.sin(rad) };
    }

    test('úprava tarify z prehľadu: tri pásma, maľovanie po kruhu, víkend, ceny a uloženie', async ({ page }) => {
        const errors = await openApp(page);
        await page.locator('#nav-nastavenie').click();
        await otvorPolozku(page, 'settings-plant');
        await expect(page.locator('#setup-rows [data-setup-edit="tarifa"]')).toContainText('2 pásma · lacno 20 h');
        await expect(page.locator('#setup-rows [data-setup-edit="tarifa"]')).toContainText('bez cien');
        await page.locator('#setup-rows [data-setup-edit="tarifa"]').click();
        await expect(page.locator('#wz-tarifa')).toBeVisible();
        await expect(page.locator('#wz-step')).toHaveText('Úprava · Tarifa');
        await expect(page.locator('[data-setup-kind="dvoj"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('[data-setup-kind="spot"]')).toBeDisabled();
        await expect(page.locator('#wz-tariff-tabs button')).toHaveCount(4);

        // Tri pásma: pribudne záložka Pásma, meno sa dá prepísať.
        await page.locator('[data-setup-kind="viac"]').click();
        await expect(page.locator('#wz-tariff-tabs button')).toHaveCount(5);
        await page.locator('#wz-tariff-tabs [data-setup-tab="pasma"]').click();
        await expect(page.locator('#wz-bands .band-row')).toHaveCount(3);
        await page.locator('[data-setup-band-name="p3"]').fill('Noc');
        await expect(page.locator('[data-setup-band="p3"][data-setup-level="lacna"]')).toHaveAttribute('aria-pressed', 'true');

        // Rozvrh: šablóna má šesť úsekov, ťah po kruhu od 01:00 po 03:00 pridá špičku v noci.
        await page.locator('#wz-tariff-tabs [data-setup-tab="rozvrh"]').click();
        await expect(page.locator('#wz-ivals li')).toHaveCount(6);
        await expect(page.locator('#wz-ivals li').first()).toContainText('Noc');
        await page.locator('[data-setup-brush="p1"]').click();
        await expect(page.locator('#wz-tariff-ring-g')).toContainText('Špička');
        await page.locator('#wz-tariff-ring').scrollIntoViewIfNeeded();
        const start = await bodNaKruhu(page, 60);
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        for (const m of [90, 120, 150, 180]) {
            const p = await bodNaKruhu(page, m);
            await page.mouse.move(p.x, p.y);
        }
        await page.mouse.up();
        await expect(page.locator('#wz-ivals li')).toHaveCount(8);
        await expect(page.locator('#wz-ivals li').nth(1)).toContainText('Špička');

        // Formulár pod zoznamom (cesta pre klávesnicu): 05:30 – 06:00 bežné pásmo.
        await page.locator('#wz-ival-from').selectOption('22');
        await page.locator('#wz-ival-to').selectOption('24');
        await page.locator('#wz-ival-band').selectOption('p2');
        await page.locator('#wz-ival-set').click();
        await expect(page.locator('#wz-ivals')).toContainText('05:30 – 06:00');

        // Výnimka na víkend: kópia základu, v rozvrhu pribudne záložka.
        await page.locator('#wz-tariff-tabs [data-setup-tab="vynimky"]').click();
        await page.locator('[data-setup-exc="weekend"]').click();
        await expect(page.locator('#wz-exc .roof-row')).toHaveCount(2);
        await page.locator('[data-setup-sched-edit="1"]').click();
        await expect(page.locator('#wz-rozvrh')).toBeVisible();
        await expect(page.locator('#wz-sub')).toHaveText('Rozvrh · Víkend');
        await page.locator('[data-setup-tpl="all"]').click();
        await expect(page.locator('#wz-ivals li')).toHaveCount(1);

        // Ceny: sedia s úrovňami, potom jedna naopak a appka navrhne opravu.
        await page.locator('#wz-tariff-tabs [data-setup-tab="ceny"]').click();
        await page.locator('[data-setup-cur="Kč"]').click();
        await page.locator('[data-setup-price="p3"]').fill('3,1');
        await page.locator('[data-setup-price="p2"]').fill('4,6');
        await page.locator('[data-setup-price="p1"]').fill('6,2');
        await expect(page.locator('#wz-price-check')).toContainText('Úrovne pásiem sedia s cenami.');
        await page.locator('[data-setup-price="p2"]').fill('7');
        await expect(page.locator('#wz-price-check')).toContainText('máš to inak');
        await page.locator('[data-setup-autolevels]').click();
        await expect(page.locator('#wz-price-check')).toContainText('sedia');

        await expect(page.locator('#wz-next')).toHaveText('Uložiť zmenu');
        await page.locator('#wz-next').click();
        await expect(page.locator('#setup-overview')).toBeVisible();
        const row = page.locator('#setup-rows [data-setup-edit="tarifa"]');
        await expect(row).toContainText('3 pásma');
        await expect(row).toContainText('víkend inak');
        await expect(row).toContainText('Noc 3,10 · Bežné 7,00 · Špička 6,20 Kč/kWh');
        const stored = await ulozene(page);
        expect(stored.tariff.bands.map((/** @type {any} */ b) => [b.id, b.name, b.level, b.price])).toEqual([
            ['p3', 'Noc', 'lacna', 3.1],
            ['p2', 'Bežné', 'draha', 7],
            ['p1', 'Špička', 'bezna', 6.2],
        ]);
        expect(stored.tariff.currency).toBe('Kč');
        expect(stored.tariff.schedules).toHaveLength(2);
        expect(stored.tariff.schedules[1]).toEqual({ days: [6, 7], months: ALL_MONTHS, changes: [{ from: '00:00', band: 'p3' }] });
        expect(errors).toEqual([]);
    });

    test('plná tarifa: výnimku, ktorá by rozvrh pridala, neponúka, a povie prečo', async ({ page }) => {
        const base = TARIFF.schedules[0];
        const season = (/** @type {number[]} */ months) => ({ days: [1, 2, 3, 4, 5, 6, 7], months, changes: base.changes });
        const schedules = [base, season([1, 2, 12]), season([6, 7, 8]), season([3, 4])];
        expect(schedules).toHaveLength(TARIFF_LIMITS.maxSchedules);
        const errors = await openApp(page, { settings: { ...OWNER, tariff: { ...TARIFF, schedules } } });
        await page.locator('#nav-nastavenie').click();
        await otvorPolozku(page, 'settings-plant');
        await page.locator('#setup-rows [data-setup-edit="tarifa"]').click();
        await page.locator('#wz-tariff-tabs [data-setup-tab="vynimky"]').click();
        await expect(page.locator('[data-setup-exc="weekend"]')).toBeDisabled();
        await expect(page.locator('[data-setup-exc="season"]')).toBeEnabled();
        await expect(page.locator('#wz-exc')).toContainText(`Rozvrhov je ${TARIFF_LIMITS.maxSchedules}, viac výnimiek sa nedá.`);
        expect(errors).toEqual([]);
    });

    test('prístupnosť sprievodcu: kompas, zhrnutie a prehľad bez závažných nálezov axe', async ({ page }) => {
        await openApp(page);
        await page.locator('#nav-nastavenie').click();
        const vazne = async () =>
            (await new AxeBuilder({ page }).include('#panel-nastavenie').analyze()).violations
                .filter((v) => v.impact === 'serious' || v.impact === 'critical')
                .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
        expect(await vazne()).toEqual([]);
        await otvorPolozku(page, 'settings-plant');
        await page.locator('#setup-rows [data-setup-edit="roof:0"]').click();
        // Kompas z klávesnice: šípky otáčajú o 45°.
        await page.locator('[data-setup-az="180"]').focus();
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('[data-setup-az="225"]')).toHaveAttribute('aria-checked', 'true');
        await expect(page.locator('[data-setup-az="225"]')).toBeFocused();
        expect(await vazne()).toEqual([]);
    });
});

test.describe('karta Štatistika', () => {
    /** Tarifa Dvorian s cenami: NT lacné, VT drahé. */
    const PRICED = { ...TARIFF, bands: TARIFF.bands.map((b) => ({ ...b, price: b.id === 'nt' ? 0.14 : 0.19 })) };
    /** Model karty tak, ako ho appka počíta v pevnom čase testov. @param {typeof OWNER} settings @param {import('../../shared/stats.js').StatsPeriod} period */
    const model = (settings, period) =>
        statsModel(
            { ...settings, now: FIXED_NOW, loading: false, pv: settings.zdroj ? pv : null, forecast: forecastAt(FIXED_NOW) },
            period,
        );

    test('s meraním a cenami: počítadlo po obdobiach s hodnotou podľa tarify', async ({ page }) => {
        const settings = { ...OWNER, tariff: PRICED };
        const errors = await openApp(page, { settings });
        await page.locator('#nav-statistika').click();
        await ocakavajKartu(page, 'statistika');
        await expect(page.locator('#stats-sub')).toHaveText(`${SITE.name} · ${kwpText(10.44)}`);

        const dnes = model(settings, 'dnes');
        await expect(page.locator('.stats-hero .lbl')).toHaveText('Vyrobené dnes');
        await expect(page.locator('.stats-hero .num')).toHaveText(kwhText(dnes.hero.kwh));
        await expect(page.locator('.stats-eur')).toContainText(moneyText(/** @type {number} */ (dnes.hero.value), '€'));
        await expect(page.locator('.stats-hero .progress-caption')).toContainText(`${dnes.progress?.pct} %`);
        await expect(page.locator('.stats-row')).toHaveCount(3);
        await expect(page.locator('.stats-go')).toHaveCount(0);

        // Obdobie je nastavenie vnútri karty: prepne veľké číslo aj riadky pod ním.
        const rok = model(settings, 'rok');
        await page.locator('[data-stats-period="rok"]').click();
        await expect(page.locator('[data-stats-period="rok"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('.stats-hero .lbl')).toHaveText('Vyrobené v roku 2026');
        await expect(page.locator('.stats-hero .num')).toHaveText(kwhText(rok.hero.kwh));
        await expect(page.locator('.stats-eur')).toContainText(moneyText(/** @type {number} */ (rok.hero.value), '€'));
        await expect(page.locator('.stats-meta')).toContainText(`${fmt1(/** @type {number} */ (rok.hero.perDay))} kWh`);
        await expect(page.locator('.stats-row .k')).toHaveText(['Dnes', 'September', 'Od spustenia']);
        expect(errors).toEqual([]);
    });

    test('bez cien: len kWh a výzva, ktorá otvorí ceny v tarife; Späť vráti do Štatistiky', async ({ page }) => {
        const errors = await openApp(page);
        await page.locator('#nav-statistika').click();
        await expect(page.locator('.stats-hero .num')).toHaveText(kwhText(model(OWNER, 'dnes').hero.kwh));
        await expect(page.locator('.stats-eur')).toHaveCount(0);

        await page.locator('[data-stats-go="ceny"]').click();
        await ocakavajKartu(page, 'nastavenie');
        await expect(page.locator('#wz-ceny')).toBeVisible();
        await page.goBack();
        await ocakavajKartu(page, 'statistika');
        expect(errors).toEqual([]);
    });

    test('bez merania: dnešok podľa predpovede a výzva pripojiť meranie', async ({ page }) => {
        const settings = { ...OWNER, tariff: PRICED, zdroj: null };
        const errors = await openApp(page, { settings });
        await page.locator('#nav-statistika').click();
        const m = model(settings, 'dnes');
        await expect(page.locator('.stats-hero .lbl')).toHaveText('Dnes podľa predpovede');
        await expect(page.locator('.stats-hero .num')).toHaveText(
            fmt1(/** @type {NonNullable<typeof m.forecastToday>} */ (m.forecastToday).kwh),
        );
        await expect(page.locator('#stats-body .seg')).toHaveCount(0);

        await page.locator('[data-stats-go="meranie"]').click();
        await ocakavajKartu(page, 'nastavenie');
        await expect(page.locator('#wz-meranie')).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('bez panelov: jediná výzva vedie k sprievodcovi v Nastavení', async ({ page }) => {
        const errors = await openApp(page, { settings: null, site: SITE });
        await page.locator('#nav-statistika').click();
        await expect(page.locator('.stats-go')).toHaveCount(1);
        await page.locator('[data-stats-go="nastavenie"]').click();
        await ocakavajKartu(page, 'nastavenie');
        await expect(page.locator('#setup-cta')).toBeVisible();
        expect(errors).toEqual([]);
    });
});

test.describe('karta Môžem?', () => {
    /** Model karty tak, ako ho appka počíta v pevnom čase testov. */
    const model = () => mozemModel({ ...OWNER, now: FIXED_NOW, loading: false, pv, forecast: forecastAt(FIXED_NOW) });
    /** Spotrebiče - riadky zoznamu, hranie a fén sú v bloku Kedykoľvek. @param {ReturnType<typeof model>} m */
    const devices = (m) => m.items.filter((i) => i.answer.kind !== 'always');

    test('o 13:00 za jasna: veľké slovo, veta, pás dneška a riadok Čo môžem podľa modelu', async ({ page }) => {
        const errors = await openApp(page);
        await page.locator('#nav-mozem').click();
        await ocakavajKartu(page, 'mozem');
        const m = model();
        await expect(page.locator('.mozem-word')).toHaveText(m.word);
        await expect(page.locator('.mozem-lead')).toHaveText(m.hero.lead);
        await expect(page.locator('.mozem-fact')).toContainText(m.hero.factV);
        await expect(page.locator('.mozem-strip-lbl')).toHaveText(m.strip?.text || '');
        await expect(page.locator('.mozem-glance b')).toHaveText(m.glance.title);
        await expect(page.locator('.mozem-glance-sub')).toHaveText(m.glance.sub);
        await expect(page.locator('.mozem-pips i'), 'bodka za každý spotrebič').toHaveCount(devices(m).length);
        await expect(page.locator('.mozem-row'), 'veci s ikonami sú až v zozname').toHaveCount(0);
        expect(errors).toEqual([]);
    });

    test('zoznam vecí: otvorí sa z riadku, pás, riadky vecí a Kedykoľvek podľa modelu, Späť ho zavrie', async ({ page }) => {
        const errors = await openApp(page, { start: 'terazky' });
        await page.locator('#nav-mozem').click();
        await ocakavajKartu(page, 'mozem');
        const m = model();
        const band = /** @type {NonNullable<typeof m.band>} */ (m.band);
        await page.locator('[data-mozem-list]').click();
        await expect(page.locator('.mozem-band-top')).toHaveText(band.label + band.value);
        await expect(page.locator('.mozem-band-ticks')).toContainText(band.mid);
        await expect(page.locator('.mozem-band-text')).toHaveText(band.text);
        await expect(page.locator('.mozem-row-top b')).toHaveText(devices(m).map((i) => i.name));
        await expect(page.locator('.mozem-short')).toHaveText(devices(m).map((i) => i.short));
        await expect(page.locator('.mozem-anytime span')).toHaveText(m.anytime.map((a) => a.name));
        await expect(page.locator('.mozem-hero'), 'zoznam je samostatná obrazovka').toHaveCount(0);

        // Zoznam je obrazovka karty: Späť na telefóne ho zavrie, ďalšie Späť už vedie preč z karty.
        await page.goBack();
        await expect(page.locator('.mozem-hero')).toBeVisible();
        await ocakavajKartu(page, 'mozem');
        await page.locator('[data-mozem-list]').click();
        await page.locator('[data-mozem-list-back]').click();
        await expect(page.locator('.mozem-list')).toHaveCount(0);
        await page.goBack();
        await ocakavajKartu(page, 'terazky');
        expect(errors).toEqual([]);
    });

    test('riadok veci ukáže hneď vetu, prečo aj vysvetlenie; ťuknutie naň nič nerobí', async ({ page }) => {
        const errors = await openApp(page);
        await page.locator('#nav-mozem').click();
        await page.locator('[data-mozem-list]').click();
        const m = model();
        await expect(page.locator('.mozem-head')).toHaveText(devices(m).map((i) => i.head));
        await expect(page.locator('.mozem-why')).toHaveText(devices(m).map((i) => i.text));
        const pracka = /** @type {ReturnType<typeof model>['items'][number]} */ (m.items.find((i) => i.id === 'pracka'));
        const row = page.locator('[data-mozem-item="pracka"]');
        await expect(row.locator('.mozem-extra')).toHaveText(pracka.extra);
        await expect(row.locator('.mozem-extra b'), 'otázka pred vysvetlením je tučná').toHaveText(pracka.extra.split(' ')[0]);
        const pred = await page.evaluate(() => history.length);
        const html = await page.locator('#mozem-body').innerHTML();
        await row.click();
        expect(await page.locator('#mozem-body').innerHTML(), 'riadok sa nerozbaľuje').toBe(html);
        expect(await page.evaluate(() => history.length)).toBe(pred);
        expect(errors).toEqual([]);
    });

    test('bojler: piaty riadok zoznamu; na Terazky je medzi spotrebičmi s tou istou odpoveďou', async ({ page }) => {
        const errors = await openApp(page);
        await page.locator('#nav-mozem').click();
        await page.locator('[data-mozem-list]').click();
        const bojler = /** @type {ReturnType<typeof model>['items'][number]} */ (model().items.find((i) => i.id === 'bojler'));
        await expect(page.locator('.mozem-row')).toHaveCount(5);
        await expect(page.locator('.mozem-row').nth(4)).toHaveAttribute('data-mozem-item', 'bojler');
        await expect(page.locator('[data-mozem-item="bojler"] .mozem-head')).toHaveText(bojler.head);

        await page.locator('#nav-terazky').click();
        await expect(page.locator('#tz-devices')).toContainText(`Bojler ${bojler.short}`);
        expect(errors).toEqual([]);
    });

    test('staré zápisy „Pustil/a som“ appka pri štarte zmaže a vec v zozname nemá čo zapisovať', async ({ page }) => {
        const errors = await openApp(page);
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
        await page.locator('#nav-mozem').click();
        await page.locator('[data-mozem-list]').click();
        await expect(page.locator('[data-mozem-item="pracka"]')).toBeVisible();
        await expect(page.locator('.mozem-rows button')).toHaveCount(0);
        expect(errors).toEqual([]);
    });

    test('bez dát: Neviem., bez pásu dneška', async ({ page }) => {
        const errors = await openApp(page, { offline: true });
        await page.locator('#nav-mozem').click();
        await expect(page.locator('.mozem-word')).toHaveText('Neviem.');
        await expect(page.locator('.mozem-strip')).toHaveCount(0);
        await expect(page.locator('.summary-link'), 'bez merania súhrn nie je').toHaveCount(0);
        await page.locator('[data-mozem-list]').click();
        await expect(page.locator('.mozem-band'), 'bez pásu dneška nie je ani pás nad vecami').toHaveCount(0);
        await expect(page.locator('[data-mozem-item="pracka"] .mozem-short')).toHaveText('neviem');
        await expect(page.locator('.mozem-anytime')).toContainText('Hranie');
        expect(errors).toEqual([]);
    });

    /** Súhrn tak, ako ho appka počíta v pevnom čase testov. @param {'tyzden' | 'mesiac'} period */
    const suhrn = (period) =>
        /** @type {NonNullable<ReturnType<typeof summaryModel>>} */ (
            summaryModel({ ...OWNER, now: FIXED_NOW, loading: false, pv, forecast: forecastAt(FIXED_NOW), dayLog: {} }, period)
        );

    test('súhrn: otvorí sa z karty, prepína obdobie a Späť ho zavrie', async ({ page }) => {
        const errors = await openApp(page, { start: 'terazky' });
        await page.locator('#nav-mozem').click();
        const mesiac = suhrn('mesiac');
        await expect(page.locator('.summary-link')).toContainText(`${mesiac.kick}: ${fmtSum(Math.round(mesiac.kwh), 0)} kWh`);
        await page.locator('.summary-link').click();
        await expect(page.locator('.summary-kick')).toHaveText(mesiac.kick);
        await expect(page.locator('.summary-big')).toHaveText(`${fmtSum(Math.round(mesiac.kwh), 0)} kWh`);
        await expect(page.locator('.summary-row span')).toHaveCount(mesiac.rows.length);
        await expect(page.locator('.summary-cal i')).toHaveCount(mesiac.days.length);

        await page.locator('[data-summary-period="tyzden"]').click();
        const tyzden = suhrn('tyzden');
        await expect(page.locator('.summary-kick')).toHaveText(tyzden.kick);
        await expect(page.locator('.summary-bars span')).toHaveCount(7);
        await expect(page.locator('.summary-note')).toHaveText(tyzden.note);

        // Rok: súčet z kiosku a 12 mesiacov - denník pozná len dnešok, takže september je neúplný,
        // január až august bez čísla a október až december ešte len prídu.
        await page.locator('[data-summary-period="rok"]').click();
        const rok = suhrn('rok');
        await expect(page.locator('.summary-kick')).toHaveText(rok.kick);
        await expect(page.locator('.summary-big')).toHaveText(`${fmtSum(Math.round(rok.kwh), 0)} kWh`);
        await expect(page.locator('.summary-bars.year span')).toHaveCount(12);
        await expect(page.locator('.summary-bars.year i.missing')).toHaveCount(8);
        await expect(page.locator('.summary-bars.year i.partial')).toHaveCount(1);
        await expect(page.locator('.summary-bars.year i.future')).toHaveCount(3);
        await expect(page.locator('.summary-row span')).toHaveCount(rok.rows.length);
        await expect(page.locator('.summary-note')).toHaveText(rok.note);

        // Súhrn je obrazovka karty: Späť na telefóne ho zavrie, ďalšie Späť už vedie preč z karty.
        await page.goBack();
        await expect(page.locator('.mozem-hero')).toBeVisible();
        await ocakavajKartu(page, 'mozem');
        await page.locator('.summary-link').click();
        await page.locator('[data-summary-back]').click();
        await expect(page.locator('.summary')).toHaveCount(0);
        await page.goBack();
        await ocakavajKartu(page, 'terazky');
        expect(errors).toEqual([]);
    });

    test('súčty, ktoré výrobca neposiela (Fox ESS): rok od prvého merania v Štatistike aj v súhrne', async ({ page }) => {
        const FOX = { ...TEST_ZDROJ, sposob: 'foxess-kluc' };
        const surove = { ...pv, yearEnergyKwh: null };
        const errors = await openApp(page, { settings: { ...OWNER, zdroj: FOX }, pvData: surove });
        // Appka rok dopočíta z celkovej výroby: od začiatku dneška, prvého dňa merania.
        const doplnene = doplnSucty(null, suctyZdroj(FOX), surove, '2026-09-05', '13:00').pv;
        expect(doplnene.od).toEqual({ rok: '2026-09-05' });
        const vstup = { ...OWNER, zdroj: FOX, now: FIXED_NOW, loading: false, pv: doplnene, forecast: forecastAt(FIXED_NOW) };
        const s = statsModel(vstup, 'dnes');
        const rok = /** @type {NonNullable<typeof s.rows[number]>} */ (s.rows.find((r) => r.period === 'rok'));
        await page.locator('#nav-statistika').click();
        await expect(page.locator('.stats-row', { hasText: 'Rok' }).locator('.k')).toHaveText(`${rok.label} ${rok.od}`);
        await expect(page.locator('.stats-row', { hasText: 'Rok' }).locator('.v')).toHaveText(`${kwhText(rok.kwh)} kWh`);
        await expect(page.locator('.stats-note').first()).toHaveText(s.odNote);
        expect(s.odNote).toContain('Fox ESS neposiela súčet za rok');
        await page.locator('[data-stats-period="rok"]').click();
        await expect(page.locator('.stats-hero .lbl')).toHaveText('Vyrobené v roku 2026 od 5. 9.');

        await page.locator('#nav-mozem').click();
        await page.locator('.summary-link').click();
        await page.locator('[data-summary-period="rok"]').click();
        const m = /** @type {NonNullable<ReturnType<typeof summaryModel>>} */ (
            summaryModel({ ...vstup, dayLog: { '2026-09-05': /** @type {number} */ (pv.dailyEnergyKwh) } }, 'rok')
        );
        await expect(page.locator('.summary-kick')).toHaveText(m.heading);
        expect(m.heading).toBe('Rok 2026 na streche od 5. 9.');
        await expect(page.locator('.summary-big')).toHaveText(`${fmtSum(Math.round(m.kwh), 0)} kWh`);
        await expect(page.locator('.summary-note')).toHaveText(m.note);
        expect(m.note).toMatch(/^Súčet roka je od 5. 9. – skôr appka meranie z Fox ESS nemala./);
        expect(errors).toEqual([]);
    });

    test('súhrn do story: aj s cenami a uhlíkom sa všetky riadky zmestia nad pätičku', async ({ page }) => {
        // Najviac riadkov: prepočty, najlepší deň, hodnota (tarifa s cenami) a uhlík - úspora
        // CO2eq s návratnosťou v jednom riadku (kiosk posiela súčet od spustenia).
        const priced = { ...TARIFF, bands: TARIFF.bands.map((b) => ({ ...b, price: b.id === 'nt' ? 0.14 : 0.19 })) };
        const zoznamy = SUMMARY_PERIODS.map(
            (period) =>
                /** @type {NonNullable<ReturnType<typeof summaryModel>>} */ (
                    summaryModel(
                        {
                            ...OWNER,
                            tariff: priced,
                            now: FIXED_NOW,
                            loading: false,
                            pv,
                            forecast: forecastAt(FIXED_NOW),
                            dayLog: {},
                        },
                        period,
                    )
                ).rows,
        );
        expect(zoznamy.map((r) => r.length)).toEqual([5, 5, 5]);
        await openApp(page);
        const vysledok = await page.evaluate(async (zoznamy) => {
            const { look, rows, rowsScale, ROWS_END } = await import('/web/share-image.js');
            const t = look();
            await Promise.all([document.fonts.load(`700 100px ${t.sans}`), document.fonts.load(`700 40px ${t.mono}`)]);
            const ctx = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d'));
            const mierky = zoznamy.map((list) => rowsScale(ctx, list, t));
            return { mierky, konce: zoznamy.map((list, i) => rows(ctx, list, t, false, mierky[i])), ROWS_END };
        }, zoznamy);
        for (const koniec of vysledok.konce) expect(koniec).toBeLessThanOrEqual(vysledok.ROWS_END);
        // Zmenšené len mierne - pod 70 % by sa text v story ťažko čítal a rowsScale by ho pustil cez pätičku.
        for (const k of vysledok.mierky) expect(k).toBeGreaterThan(0.7);
    });

    test('súhrn: denník si zapíše dnešok a zdieľanie pošle obrázok systému', async ({ page }) => {
        await page.addInitScript(() => {
            /** @type {any} */ const w = window;
            w.zdielane = null;
            navigator.canShare = () => true;
            navigator.share = async (/** @type {any} */ data) => {
                const f = data.files[0];
                w.zdielane = { name: f.name, type: f.type, size: f.size };
            };
        });
        const errors = await openApp(page);
        const log = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), DAYLOG_STORAGE_KEY);
        expect(log).toEqual({ '2026-09-05': pv.dailyEnergyKwh });
        await page.locator('#nav-mozem').click();
        await page.locator('.summary-link').click();
        await page.locator('[data-summary-share]').click();
        await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).zdielane?.name)).toBe('ray-mon-mesiac.png');
        const shared = await page.evaluate(() => /** @type {any} */ (window).zdielane);
        expect(shared.type).toBe('image/png');
        expect(shared.size, 'obrázok nie je prázdny').toBeGreaterThan(10000);
        expect(errors).toEqual([]);
    });
});

test.describe('prvá karta tohto telefónu', () => {
    test('bez uloženej voľby sa appka otvorí na Môžem? a nič neuloží ani nepridá do adresy', async ({ page }) => {
        const errors = await openApp(page);
        await ocakavajKartu(page, 'mozem');
        await expect(page.locator('#nav-terazky')).not.toHaveAttribute('aria-current', 'page');
        expect(await page.evaluate((key) => localStorage.getItem(key), START_STORAGE_KEY)).toBeNull();
        expect(startFromLink(page.url()), 'predvolená karta sa do adresy nepíše').toBeNull();
        expect(await page.evaluate(() => history.state?.step?.panel)).toBe('mozem');
        expect(errors).toEqual([]);
    });

    test('s uloženou voľbou Terazky sa appka otvorí na Terazky', async ({ page }) => {
        await page.addInitScript((key) => localStorage.setItem(key, 'terazky'), START_STORAGE_KEY);
        const errors = await openApp(page);
        await ocakavajKartu(page, 'terazky');
        await expect(page.locator('#nav-mozem')).not.toHaveAttribute('aria-current', 'page');
        expect(startFromLink(page.url()), 'appka pridaná na plochu iPhonu si voľbu prenesie z adresy').toBe('terazky');
        expect(errors).toEqual([]);
    });

    test('voľba v Nastavení: po ďalšom otvorení appky je prvá Terazky, adresa ju nesie', async ({ page }) => {
        const errors = await openApp(page);
        await ocakavajKartu(page, 'mozem');
        await page.locator('#nav-nastavenie').click();
        await otvorPolozku(page, 'settings-start');
        const terazky = page.locator('[data-start-panel="terazky"]');
        await expect(page.locator('[data-start-panel="mozem"]')).toHaveAttribute('aria-pressed', 'true');
        await terazky.click();
        await expect(terazky).toHaveAttribute('aria-pressed', 'true');
        expect(await page.evaluate((key) => localStorage.getItem(key), START_STORAGE_KEY)).toBe('terazky');
        expect(startFromLink(page.url()), 'appka pridaná na plochu iPhonu si voľbu prenesie z adresy').toBe('terazky');

        await page.reload();
        await ocakavajKartu(page, 'terazky');
        expect(await page.evaluate(() => history.state?.step?.panel)).toBe('terazky');

        // Návrat k predvolenej: z adresy prvá karta zmizne.
        await page.locator('#nav-nastavenie').click();
        await otvorPolozku(page, 'settings-start');
        await page.locator('[data-start-panel="mozem"]').click();
        expect(await page.evaluate((key) => localStorage.getItem(key), START_STORAGE_KEY)).toBe('mozem');
        expect(startFromLink(page.url())).toBeNull();
        expect(errors).toEqual([]);
    });

    test('odkaz s prvou kartou: telefón bez voľby sa otvorí na Terazky a zapamätá si to', async ({ page }) => {
        const errors = await openApp(page, { hash: '#prva=terazky' });
        await ocakavajKartu(page, 'terazky');
        expect(await page.evaluate((key) => localStorage.getItem(key), START_STORAGE_KEY)).toBe('terazky');
        expect(errors).toEqual([]);
    });

    test('starší odkaz pre rodinu (prva=mozem) ďalej funguje: telefón bez voľby si Môžem? zapamätá', async ({ page }) => {
        const errors = await openApp(page, { hash: '#prva=mozem' });
        await ocakavajKartu(page, 'mozem');
        expect(await page.evaluate((key) => localStorage.getItem(key), START_STORAGE_KEY)).toBe('mozem');
        expect(errors).toEqual([]);
    });

    test('odkaz pre rodinu neprepíše vlastnú voľbu telefónu', async ({ page }) => {
        await page.addInitScript((key) => localStorage.setItem(key, 'terazky'), START_STORAGE_KEY);
        const errors = await openApp(page, { hash: '#prva=mozem' });
        await ocakavajKartu(page, 'terazky');
        expect(errors).toEqual([]);
    });

    test('zdieľanie: odkaz prvú kartu nenesie, ani keď si telefón vybral Terazky', async ({ page }) => {
        // Zaškrtávatko „pre rodinu“ pridávalo prva=mozem; Môžem? je teraz predvolená, takže zaniklo.
        const errors = await openApp(page, { start: 'terazky' });
        await page.locator('#nav-nastavenie').click();
        await page.locator('#info-share > summary').click();
        await expect(page.locator('#share-options input[type="checkbox"]')).toHaveCount(2);
        const wa = page.locator('#share-whatsapp');
        const shared = async () => decodeURIComponent(((await wa.getAttribute('href')) || '').replace('https://wa.me/?text=', ''));
        expect(await shared()).toBe(shareUrl(APP_URL, null, false));
        await page.locator('#share-with-settings').check();
        const url = await shared();
        expect(startFromLink(url)).toBeNull();
        expect(settingsFromLink(url)).toEqual({ ...OWNER, zdroj: null });
        expect(errors).toEqual([]);
    });
});

test.describe('vymazanie údajov', () => {
    test('zmaže všetky vlastné kľúče aj nastavenie v adrese, cudzie nechá; appka začne od polohy', async ({ page }) => {
        // Nový kľúč v config.js, ktorý by v STORAGE_KEYS chýbal, by po vymazaní ostal v prehliadači.
        const vsetky = Object.entries(config)
            .filter(([name]) => name.endsWith('_STORAGE_KEY'))
            .map(([, key]) => key);
        expect([...STORAGE_KEYS].sort()).toEqual(vsetky.sort());

        // Bez openApp(settings): jeho init skript by po obnovení stránky nastavenie uložil znova.
        const errors = await openApp(page, { settings: null });
        await page.evaluate(
            ([keys, settingsKey, settings]) => {
                for (const key of keys) localStorage.setItem(key, key === settingsKey ? settings : 'x');
                localStorage.setItem('cudzia-appka', 'ostane');
            },
            [STORAGE_KEYS, SETTINGS_STORAGE_KEY, JSON.stringify(toUser(OWNER))],
        );
        await page.reload();
        await appReady(page);
        expect(settingsFromLink(page.url()), 'adresa nesie uložené nastavenie').not.toBeNull();

        await page.locator('#nav-nastavenie').click();
        await otvorPolozku(page, 'settings-clear');
        page.once('dialog', (d) => d.accept());
        await page.locator('#clear-data').click();

        await expect(page.locator('#wz-lokalita')).toBeVisible();
        await appReady(page);
        const ulozene = await page.evaluate(() => ({ ...localStorage }));
        expect(ulozene).toEqual({ 'cudzia-appka': 'ostane' });
        expect(settingsFromLink(page.url())).toBeNull();
        await expect(page.locator('#import-offer')).toBeHidden();
        expect(errors).toEqual([]);
    });

    test('zrušenie otázky nič nezmaže', async ({ page }) => {
        const errors = await openApp(page);
        await page.locator('#nav-nastavenie').click();
        await otvorPolozku(page, 'settings-clear');
        page.once('dialog', (d) => d.dismiss());
        await page.locator('#clear-data').click();
        expect(await page.evaluate((key) => localStorage.getItem(key), SETTINGS_STORAGE_KEY)).not.toBeNull();
        await expect(page.locator('#settings-clear')).toBeVisible();
        expect(errors).toEqual([]);
    });
});

test.describe('zdieľanie nastavenia odkazom', () => {
    const LINK = shareUrl(APP_URL, OWNER, true);
    const HASH = `#${LINK.split('#')[1]}`;

    /** Odkazy, ktoré appka nevie prevziať: neúplný a z novšej verzie appky. */
    const NOVSI = `#${SHARE_HASH_KEY}=${Buffer.from(JSON.stringify({ v: SHARE_LINK_VERSION + 1, ...toUser(OWNER) })).toString('base64url')}`;
    const ZLE = /** @type {const} */ ([
        ['poskodeny', HASH.slice(0, -12)],
        ['novsi', NOVSI],
    ]);

    for (const [druh, hash] of ZLE) {
        test(`odkaz, ktorý appka nevie prevziať (${druh}): povie prečo, Zavrieť ho zmaže z adresy`, async ({ page }) => {
            const errors = await openApp(page, { settings: null, hash });
            const offer = page.locator('#import-offer');
            await expect(offer).toBeVisible();
            await expect(offer).toHaveAttribute('data-err', druh);
            await expect(page.locator('#import-offer-title')).toHaveText(LINK_ERRORS[druh].title);
            await expect(page.locator('#import-offer-text')).toHaveText(LINK_ERRORS[druh].text);
            await expect(page.locator('#import-accept')).toBeHidden();
            await expect(page.locator('#import-decline')).toHaveText('Zavrieť');
            expect(new URL(page.url()).hash, 'kým hlášku nezavrie, odkaz ostáva v adrese').toBe(hash);
            await page.locator('#import-decline').click();
            await expect(offer).toBeHidden();
            expect(new URL(page.url()).hash).toBe('');
            expect(await page.evaluate((key) => localStorage.getItem(key), SETTINGS_STORAGE_KEY)).toBeNull();
            await expect(page.locator('#wz-lokalita')).toBeVisible();
            expect(errors).toEqual([]);
        });
    }

    test('vložený odkaz, ktorý appka nevie prevziať, povie prečo; dobrá ponuka má späť svoje texty', async ({ page }) => {
        const errors = await openApp(page, { settings: null });
        await page.locator('#wz-welcome [data-setup-go="odkaz"]').click();
        await page.locator('#wz-link').fill(APP_URL + NOVSI);
        await expect(page.locator('#wz-link-note')).toHaveText(LINK_ERRORS.novsi.paste);
        await expect(page.locator('#wz-next')).toBeDisabled();
        await page.locator('#wz-link').fill(APP_URL + HASH.slice(0, -12));
        await expect(page.locator('#wz-link-note')).toHaveText(LINK_ERRORS.poskodeny.paste);
        expect(errors).toEqual([]);
    });

    // Na iPhone je toto prvé spustenie appky pridanej na plochu: prázdne úložisko, v adrese odkaz.
    test('odkaz s nastavením: ponuka, odkaz ostáva v adrese, po prevzatí Dvorany so živým meraním', async ({ page }) => {
        const errors = await openApp(page, { settings: null, hash: HASH });
        const offer = page.locator('#import-offer');
        await expect(offer).toBeVisible();
        await expect(page.locator('#import-offer-text')).toHaveText('Dvorany nad Nitrou · 10,44 kWp · so živým meraním.');
        expect(new URL(page.url()).hash, 'pridanie na plochu pred rozhodnutím si odkaz prenesie').toBe(HASH);
        await expect(page.locator('#wz-lokalita')).toBeVisible();
        await page.locator('#import-accept').click();
        await expect(offer).toBeHidden();
        // Otázka na polohu už netreba - appka sa otvorí na svojej prvej karte.
        await ocakavajKartu(page, 'mozem');
        await expect(page.locator('#bottomnav')).toBeVisible();
        await expect(page.locator('#pv-updated')).toHaveText('meranie');
        const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), SETTINGS_STORAGE_KEY);
        expect(stored).toEqual(toUser(OWNER));
        expect(settingsFromLink(page.url()), 'adresa nesie nastavenie, prístup k meraniu nie').toEqual({ ...OWNER, zdroj: null });
        expect(errors).toEqual([]);
    });

    // Appka na ploche iPhonu nevidí úložisko Safari - prenesie si len adresu.
    test('adresa nesie uložené nastavenie, prístup k meraniu nikdy; po obnovení sa neponúka prevziať', async ({ page }) => {
        await openApp(page);
        expect(settingsFromLink(page.url())).toEqual({ ...OWNER, zdroj: null });
        await page.reload();
        await expect(page.locator('#pv-updated')).toHaveText('meranie');
        await expect(page.locator('#import-offer')).toBeHidden();
    });

    test('bez zadaných panelov je adresa holá', async ({ page }) => {
        await openApp(page, { settings: null, site: SITE });
        expect(new URL(page.url()).hash).toBe('');
    });

    test('odmietnutie nič neuloží, rovnaké nastavenie sa ani neponúkne', async ({ page }) => {
        await openApp(page, { settings: null, hash: HASH });
        await page.locator('#import-decline').click();
        await expect(page.locator('#import-offer')).toBeHidden();
        await expect(page.locator('#wz-lokalita')).toBeVisible();
        expect(await page.evaluate((key) => localStorage.getItem(key), SETTINGS_STORAGE_KEY)).toBeNull();
        expect(new URL(page.url()).hash, 'odmietnutý odkaz v adrese neostane').toBe('');
    });

    test('rovnaké nastavenie, aké už je uložené, sa neponúka', async ({ page }) => {
        await openApp(page, { hash: HASH });
        await expect(page.locator('#import-offer')).toBeHidden();
    });

    test('zdieľanie: odkaz nesie nastavenie a meranie len po zaškrtnutí', async ({ page }) => {
        await openApp(page);
        await page.locator('#nav-nastavenie').click();
        await page.locator('#info-share > summary').click();
        const wa = page.locator('#share-whatsapp');
        const shared = async () => decodeURIComponent(((await wa.getAttribute('href')) || '').replace('https://wa.me/?text=', ''));
        expect(await shared()).toBe(APP_URL);
        await expect(page.locator('#share-kiosk-row')).toBeHidden();
        await page.locator('#share-with-settings').check();
        expect(settingsFromLink(await shared())).toEqual({ ...OWNER, zdroj: null });
        await expect(page.locator('#share-kiosk-row')).toBeVisible();
        await page.locator('#share-with-kiosk').check();
        expect(settingsFromLink(await shared())).toEqual(OWNER);
    });

    test('bez zadaných panelov sa nastavenie zdieľať nedá, len holý odkaz', async ({ page }) => {
        await openApp(page, { settings: null, site: SITE });
        await page.locator('#nav-nastavenie').click();
        await page.locator('#info-share > summary').click();
        await expect(page.locator('#share-options')).toBeHidden();
    });

    /** Odkaz vložený v sprievodcovi sa neuloží hneď - najprv ukáže, čo obsahuje, a zhrnutie. */
    test('odkaz vložený v sprievodcovi: náhľad, zhrnutie a uloženie až po potvrdení', async ({ page }) => {
        const errors = await openApp(page, { settings: null });
        await page.locator('#wz-welcome [data-setup-go="odkaz"]').click();
        await expect(page.locator('#wz-next')).toBeDisabled();
        await page.locator('#wz-link').fill(LINK);
        await page.locator('#wz-link').press('Enter');
        await expect(page.locator('#wz-link-preview')).toContainText('Dvorany nad Nitrou');
        await expect(page.locator('#wz-link-preview')).toContainText('so živým meraním');
        expect(await page.evaluate((key) => localStorage.getItem(key), SETTINGS_STORAGE_KEY)).toBeNull();
        await page.locator('#wz-next').click();
        await expect(page.locator('#wz-suhrn')).toBeVisible();
        await expect(page.locator('#wz-summary .big')).toHaveText('10,44 kWp');
        await page.locator('#wz-next').click();
        await expect(page.locator('#pv-updated')).toHaveText('meranie');
        const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), SETTINGS_STORAGE_KEY);
        expect(stored).toEqual(toUser(OWNER));
        expect(errors).toEqual([]);
    });

    test('prilepený odkaz bez nastavenia ohlási chybu a nepustí ďalej', async ({ page }) => {
        await openApp(page, { settings: null });
        await page.locator('#wz-welcome [data-setup-go="odkaz"]').click();
        await page.locator('#wz-link').fill('https://example.com/nieco');
        await expect(page.locator('#wz-link-note')).toBeVisible();
        await expect(page.locator('#wz-link-preview')).toBeHidden();
        await expect(page.locator('#wz-next')).toBeDisabled();
        // Späť vedie na otázku o polohe - za ňou pri prvom otvorení nič nie je.
        await page.locator('#wz-back').click();
        await expect(page.locator('#wz-lokalita')).toBeVisible();
        await expect(page.locator('#wz-step')).toHaveText('Vitaj');
    });
});

// Po nasadení vie prehliadač z cache miešať staré moduly s novými (viď boot.js). Lokálny server
// cache nemá, preto starý modul hrá route: shared/config.js bez exportov, ktoré appka importuje.
test.describe('nasadenie a cache', () => {
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
        const errors = await openApp(page);
        await expect(page.locator('#pv-updated')).toHaveText('meranie');
        await expect.poll(loads).toBe(2);
        expect(errors).toEqual([expect.stringContaining('does not provide an export named')]);
        expect(await page.evaluate(() => sessionStorage.getItem('ray-mon-obnova'))).toBeNull();
    });

    test('chyba, ktorú obnovenie nevyrieši: jedno obnovenie, potom hláška namiesto slučky', async ({ page }) => {
        const loads = await staryModul(page, Infinity);
        await openApp(page);
        await expect(page.locator('#pv-updated')).toHaveText('appka sa nenačítala, skús to o chvíľu');
        expect(loads()).toBe(2);
    });
});
