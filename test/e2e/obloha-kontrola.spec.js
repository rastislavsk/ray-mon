// E2E kontroly kvality novej appky „Živá obloha“ na telefóne (krok 7): kontrast textu na oblohe
// a na skle, najmenšie písmo, väčšie písmo v systéme, dotykové plochy a nadpisy pre čítačku.
// Testy neprechádzajú zoznam menovaných prvkov, ale všetko, čo v stránke naozaj je - nový prvok
// tak netreba nikam dopisovať, test ho uvidí sám (ako „.hidden skryje každý prvok“).
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
    DAYLOG_STORAGE_KEY,
    LAUNCH_STORAGE_KEY,
    LOOK_STORAGE_KEY,
    PLANT,
    SETTINGS_STORAGE_KEY,
    SITE,
    SITE_STORAGE_KEY,
    TARIFF,
    WORKER_PV_URL,
} from '../../shared/config.js';
import { contrastTarget, parseColor, textContrast, over } from '../../shared/contrast.js';
import { lookToStored, toUser } from '../../shared/settings.js';
import { skyAt } from '../../shared/sky.js';
import { fixture, fixtureData, pvAt } from '../helpers.js';
import { mozemSkyModel } from '../../shared/mozem-sky.js';
import { buildForecast } from '../../shared/solar.js';

const { pv } = fixtureData();
/** Merania priamo v prehliadači (window.kontrola). */
const MERANIA = fileURLToPath(new URL('./obloha-kontrola-stranka.js', import.meta.url));
const weather = fixture('open-meteo.json');
const TEST_KIOSK = 'https://region01eu5.fusionsolar.huawei.com/pvmswebsite/nologin/assets/build/index.html#/kiosk?kk=Test1234';
const IGNORED_CONSOLE = /Failed to load resource|net::ERR_FAILED/;
/** Tarifa Dvorian s cenami, aby Štatistika ukázala aj peniaze. */
const PRICED = { ...TARIFF, bands: TARIFF.bands.map((b) => ({ ...b, price: b.id === 'nt' ? 0.14 : 0.19 })) };
const OWNER = { site: SITE, plant: PLANT, tariff: PRICED, kiosk: TEST_KIOSK };
/** Denník výroby (plagát potrebuje dni mesiaca) a zápisy „Pustil/a som“. */
const LOG = { '2026-08-31': 30, '2026-09-01': 38.2, '2026-09-02': 52.1, '2026-09-04': 41.7 };
const LAUNCHES = [{ d: '2026-09-04', id: 'pracka', m: 720, sun: true }];
const GEOCODE = {
    results: [
        {
            name: SITE.name,
            latitude: SITE.lat,
            longitude: SITE.lon,
            elevation: SITE.elevationM,
            timezone: SITE.timezone,
            country: 'Slovensko',
        },
    ],
};

/** Presný okamih daného času 5. 9. 2026 v Bratislave (letný čas, UTC+2). Fixtures majú celý deň jasno. @param {string} hm */
const at = (hm) => new Date(`2026-09-05T${hm}:00+02:00`);

/**
 * Otvorí novú appku s pevným časom a dátami z fixtures. Predvolene má uložené Dvorany s kioskom,
 * cenami, denníkom a jedným zápisom; so `settings: null` a `site` pozná len polohu.
 * @param {import('@playwright/test').Page} page
 * @param {{ time?: Date, settings?: typeof OWNER | null, site?: typeof SITE | null, liveSky?: boolean }} [opts]
 */
async function openObloha(page, { time = at('13:00'), settings = OWNER, site = null, liveSky = true } = {}) {
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (msg) => msg.type() === 'error' && !IGNORED_CONSOLE.test(msg.text()) && errors.push(msg.text()));
    await page.route(/cdnjs\.cloudflare\.com/, (route) => route.abort());
    await page.addInitScript({ path: MERANIA });
    await page.route(WORKER_PV_URL, (route) => route.fulfill({ json: { pv } }));
    await page.route(/api\.open-meteo\.com/, (route) => route.fulfill({ json: weather }));
    await page.route(/geocoding-api\.open-meteo\.com/, (route) => route.fulfill({ json: GEOCODE }));
    /** @param {string} key @param {string} value */
    const uloz = (key, value) => page.addInitScript(([k, v]) => localStorage.getItem(k) || localStorage.setItem(k, v), [key, value]);
    if (settings) await uloz(SETTINGS_STORAGE_KEY, JSON.stringify(toUser(settings)));
    if (site) await uloz(SITE_STORAGE_KEY, JSON.stringify(site));
    await uloz(DAYLOG_STORAGE_KEY, JSON.stringify(LOG));
    await uloz(LAUNCH_STORAGE_KEY, JSON.stringify(LAUNCHES));
    if (!liveSky) await uloz(LOOK_STORAGE_KEY, JSON.stringify(lookToStored({ voice: 'drzy', liveSky: false })));
    await page.clock.setFixedTime(time);
    await page.goto('/obloha/');
    await expect(page.locator('#page')).toHaveAttribute('data-panel', /.+/);
    return errors;
}

/** @param {import('@playwright/test').Page} page @param {string} panel */
async function karta(page, panel) {
    await page.locator(`#nav-${panel}`).click();
    await expect(page.locator(`#panel-${panel}`)).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
}

/** @param {import('@playwright/test').Page} page */
const dalej = (page) => page.locator('#wz-next').click();
/** @param {import('@playwright/test').Page} page @param {string} step */
const obrazovka = (page, step) => expect(page.locator(`#wz-${step}`)).toBeVisible();

/**
 * Prejde všetky karty, ich detaily a dialógy uloženej elektrárne a na každom mieste zavolá
 * `check` s menom miesta.
 * @param {import('@playwright/test').Page} page @param {(name: string) => Promise<void>} check
 */
async function kazdaKarta(page, check) {
    await karta(page, 'mozem');
    await check('Môžem?');
    await page.locator('[data-item="velke"]').click();
    await expect(page.locator('#mz-sheet')).toBeVisible();
    await check('Môžem? › panel skupiny');
    await page.keyboard.press('Escape');
    await expect(page.locator('#mz-sheet')).toBeHidden();
    await page.locator('[data-item="bojler"]').click();
    await expect(page.locator('#mz-sheet')).toBeVisible();
    await check('Môžem? › panel veci');
    await page.keyboard.press('Escape');
    await expect(page.locator('#mz-sheet')).toBeHidden();

    await karta(page, 'terazky');
    await check('Teraz');

    await karta(page, '7dni');
    await check('7 dní');
    await page.locator('#sd-days .day').nth(1).click();
    await expect(page.locator('#sd-day')).toBeVisible();
    await check('7 dní › deň');
    await page.locator('#sd-day-back').click();
    await page.locator('#sd-sum').click();
    await expect(page.locator('#sd-week')).toBeVisible();
    await check('7 dní › týždeň');
    await page.locator('#sd-week-back').click();
    await expect(page.locator('#sd-list')).toBeVisible();

    await karta(page, 'statistika');
    await check('Štatistika');
    await page.locator('#st-posters [data-poster]').first().click();
    await expect(page.locator('#poster')).toBeVisible();
    await check('Štatistika › plagát');
    await page.locator('#poster-close').click();
    await expect(page.locator('#poster')).toBeHidden();

    await karta(page, 'nastavenie');
    await check('Nastavenie');
    await page.locator('#ns-share').click();
    await expect(page.locator('#ns-share-sheet')).toBeVisible();
    await page.locator('#ns-share-settings').check();
    await check('Nastavenie › Zdieľať appku');
    await page.locator('#ns-share-x').click();
    await page.locator('#ns-reset').click();
    await expect(page.locator('#ns-reset-sheet')).toBeVisible();
    await check('Nastavenie › Nastaviť celé znova');
    await page.locator('#ns-reset-cancel').click();
    await page.locator('#ns-rows [data-setup-edit]').first().click();
    await expect(page.locator('#wizard')).toBeVisible();
    await check('Nastavenie › úprava z prehľadu');
}

/**
 * Prejde celého sprievodcu od známej polohy (úvod, odkaz, poloha so zoznamom miest, panely,
 * plocha, menič, meranie, tarifa s tromi pásmami, výnimka, ceny, zhrnutie) a na každej
 * obrazovke zavolá `check`.
 * @param {import('@playwright/test').Page} page @param {(name: string) => Promise<void>} check
 */
async function kazdaObrazovka(page, check) {
    await karta(page, 'nastavenie');
    await check('sprievodca › výzva');
    await page.locator('#ns-cta-btn').click();
    await obrazovka(page, 'panel');
    await page.locator('#wz-back').click();
    await obrazovka(page, 'lokalita');
    await page.locator('#wz-place').fill('Dvo');
    await expect(page.locator('.geo-pick').first()).toBeVisible();
    await page.locator('#wz-lokalita details summary').click();
    await check('sprievodca › poloha');
    await page.locator('#wz-back').click();
    await obrazovka(page, 'start');
    await check('sprievodca › úvod');
    await page.locator('#wz-start [data-setup-go="odkaz"]').click();
    await obrazovka(page, 'odkaz');
    await check('sprievodca › odkaz');
    await page.locator('#wz-back').click();
    await dalej(page);
    await obrazovka(page, 'lokalita');
    await dalej(page);
    await obrazovka(page, 'panel');
    await page.locator('[data-setup-wp="other"]').click();
    await page.locator('#wz-wp').fill('440');
    await check('sprievodca › panel');
    for (const step of ['smer', 'sklon', 'pocet', 'dalsia']) {
        await dalej(page);
        await obrazovka(page, step);
        await check(`sprievodca › ${step}`);
    }
    await dalej(page);
    await page.locator('[data-setup-ac="other"]').click();
    await check('sprievodca › menič');
    await page.locator('#wz-ac').fill('5');
    await dalej(page);
    await page.locator('#wz-live-yes').click();
    await page.locator('#wz-kiosk').fill(TEST_KIOSK);
    await check('sprievodca › meranie');
    await dalej(page);
    await page.locator('[data-setup-kind="viac"]').click();
    await check('sprievodca › tarifa');
    for (const step of ['pasma', 'rozvrh']) {
        await dalej(page);
        await obrazovka(page, step);
        await check(`sprievodca › ${step}`);
    }
    await dalej(page);
    await page.locator('[data-setup-exc="season"]').click();
    await check('sprievodca › výnimky');
    await dalej(page);
    await check('sprievodca › ceny');
    await dalej(page);
    await obrazovka(page, 'suhrn');
    await check('sprievodca › zhrnutie');
}

/**
 * Širšie obrazovky (krok 8): tablet na výšku má rozloženie telefónu so širšími okrajmi, tablet na
 * šírku dva stĺpce, počítač tri a navigáciu hore. Každá kontrola beží aj na nich.
 * @type {Array<{ width: number, height: number, name: string }>}
 */
const SIROKE = [
    { width: 820, height: 1180, name: 'tablet na výšku' },
    { width: 1180, height: 820, name: 'tablet na šírku' },
    { width: 1440, height: 900, name: 'počítač' },
];
/** Telefón v predvolenej veľkosti testov a širšie obrazovky. */
const VSETKY = [{ width: 390, height: 844, name: 'telefón' }, ...SIROKE];

/** Výšky obrazovky, v ktorých sa meria text, ktorý sa posúva so stránkou. */
const HEIGHTS = Array.from({ length: 21 }, (_, i) => i / 20);

/**
 * Texty s kontrastom pod cieľom WCAG (4,5 : 1, veľké 3 : 1) - s najhoršou výškou a pomerom.
 * Text na plagáte (vlastný farebný prechod, nie obloha) a vypnuté tlačidlá sa nemerajú.
 * @param {{ sky: { top: string, bottom: string, shade: string }, texts: Array<{ where: string, text: string, color: string,
 *   px: number, weight: number, layers: string[], fixed: boolean, image: boolean, opacity: number, disabled: boolean,
 *   top: number, bottom: number }> }} stranka výsledok window.kontrola.farby()
 */
function slabyKontrast({ sky, texts }) {
    const out = [];
    for (const t of texts) {
        if (t.image || t.disabled) continue;
        const [r, g, b, a] = parseColor(t.color);
        const color = /** @type {import('../../shared/contrast.js').Rgba} */ ([r, g, b, a * t.opacity]);
        const heights = t.fixed ? [Math.max(0, Math.min(1, t.top)), Math.max(0, Math.min(1, t.bottom))] : HEIGHTS;
        let worst = Infinity;
        for (const h of heights) {
            const bg = t.layers.reduceRight((under, layer) => over(parseColor(layer), under), skyAt(sky, h));
            worst = Math.min(worst, textContrast(color, bg));
        }
        const target = contrastTarget(t.px, t.weight);
        if (worst < target) out.push(`${t.where} „${t.text}“: ${worst.toFixed(2)} : 1 (treba ${target})`);
    }
    return out;
}

test.describe('kontrast textu na oblohe a na skle', () => {
    // Poludnie za jasna je najsvetlejšia obloha dňa, súmrak má teplý svetlý obzor, o 8:00 je
    // spodok najsvetlejší vôbec. Nevypnutá aj vypnutá živá obloha.
    for (const [time, liveSky] of /** @type {Array<[string, boolean]>} */ ([
        ['13:00', true],
        ['19:30', true],
        ['08:00', true],
        ['13:00', false],
    ])) {
        test(`o ${time}${liveSky ? '' : ' s vypnutou živou oblohou'}: každý text na každej karte, v detailoch a dialógoch má dosť kontrastu`, async ({
            page,
        }) => {
            test.slow();
            const errors = await openObloha(page, { time: at(time), liveSky });
            /** @type {string[]} */
            const zle = [];
            await kazdaKarta(page, async (name) => {
                for (const z of slabyKontrast(await page.evaluate(() => window.kontrola.farby()))) zle.push(`${name}: ${z}`);
            });
            expect(zle).toEqual([]);
            expect(errors).toEqual([]);
        });
    }

    test('karta Môžem? napoludnie a za súmraku: skutočné farby z DOM, aj zelené časy pri veciach a „ťukni, príde ďalšia“', async ({
        page,
    }) => {
        for (const time of ['13:00', '19:30']) {
            await openObloha(page, { time: at(time) });
            const stranka = await page.evaluate(() => window.kontrola.farby());
            // Zelené odpovede pri veciach a nápis pod hláškou sú v meraní naozaj zahrnuté.
            expect(stranka.texts.some((t) => t.where.startsWith('b') && t.color !== 'rgb(255, 255, 255)')).toBe(true);
            expect(stranka.texts.some((t) => t.where === '#mz-quip-hint')).toBe(true);
            expect(slabyKontrast(stranka), time).toEqual([]);
        }
    });

    for (const { width, height, name } of SIROKE) {
        for (const time of ['13:00', '19:30']) {
            test(`${name} (${width} × ${height}) o ${time}: každý text na každej karte, v detailoch a dialógoch má dosť kontrastu`, async ({
                page,
            }) => {
                test.slow();
                await page.setViewportSize({ width, height });
                const errors = await openObloha(page, { time: at(time) });
                /** @type {string[]} */
                const zle = [];
                await kazdaKarta(page, async (miesto) => {
                    for (const z of slabyKontrast(await page.evaluate(() => window.kontrola.farby()))) zle.push(`${miesto}: ${z}`);
                });
                expect(zle).toEqual([]);
                expect(errors).toEqual([]);
            });
        }
    }

    for (const { width, height, name } of VSETKY) {
        test(`sprievodca, ${name} (${width} × ${height}): každý text na každej obrazovke má dosť kontrastu (poludnie)`, async ({
            page,
        }) => {
            test.slow();
            await page.setViewportSize({ width, height });
            const errors = await openObloha(page, { settings: null, site: SITE });
            /** @type {string[]} */
            const zle = [];
            await kazdaObrazovka(page, async (miesto) => {
                for (const z of slabyKontrast(await page.evaluate(() => window.kontrola.farby()))) zle.push(`${miesto}: ${z}`);
            });
            expect(zle).toEqual([]);
            expect(errors).toEqual([]);
        });
    }
});

// Popisky osí grafov (čas pod grafom, dni pod stĺpcami, hodiny mapy a kruhu tarify, východ
// a západ pod oblúkom, svetové strany na kompasoch): smú byť menšie než ostatný text, nie však pod 10 px.
const OSI = '.dc-t, .dc-limit-t, .wb-n, .hm-t, .hm-d, .tariff-ring .hour, .arc-t, .planes-compass text, .mini-compass text';
const MIN_PX = 12;
const MIN_OS_PX = 10;

/**
 * Dve prechádzky celou appkou: karty, detaily a dialógy uloženej elektrárne a sprievodca od
 * známej polohy. Každá začína v čistom prehliadači.
 * @type {Array<{ name: string, opts: Parameters<typeof openObloha>[1], walk: typeof kazdaKarta }>}
 */
const PRECHADZKY = [
    { name: 'karty, detaily a dialógy', opts: {}, walk: kazdaKarta },
    { name: 'sprievodca', opts: { settings: null, site: SITE }, walk: kazdaObrazovka },
];

/** Telefóny pre veľkosť písma a dotykové plochy (najužší a bežný) a širšie obrazovky. */
const SIRKY = [{ width: 320, height: 800 }, { width: 390, height: 800 }, ...SIROKE];

test.describe('veľkosť písma', () => {
    for (const { width, height } of SIRKY) {
        for (const { name, opts, walk } of PRECHADZKY) {
            test(`šírka ${width} px, ${name}: žiadny text pod 12 px, popisky osí v grafoch nie pod 10 px`, async ({ page }) => {
                test.slow();
                await page.setViewportSize({ width, height });
                const errors = await openObloha(page, opts);
                /** @type {string[]} */
                const zle = [];
                await walk(page, async (where) => {
                    for (const z of await page.evaluate(
                        ([o, a, b]) => window.kontrola.malePismo(o, a, b),
                        /** @type {const} */ ([OSI, MIN_PX, MIN_OS_PX]),
                    ))
                        zle.push(`${where}: ${z}`);
                });
                expect(zle).toEqual([]);
                expect(errors).toEqual([]);
            });
        }
    }
});

test.describe('väčšie písmo v systéme (200 %)', () => {
    for (const { width, height } of [{ width: 320, height: 640 }, ...SIROKE]) {
        for (const { name, opts, walk } of PRECHADZKY) {
            test(`šírka ${width} px, ${name}: písmo rastie, nič sa neoreže ani nevytŕča, dá sa posúvať`, async ({ page }) => {
                test.slow();
                await page.setViewportSize({ width, height });
                // To isté ako Väčší text v nastavení prehliadača: predvolené písmo 32 px namiesto 16 px.
                const cdp = await page.context().newCDPSession(page);
                await cdp.send('Page.setFontSizes', { fontSizes: { standard: 32 } });
                const errors = await openObloha(page, opts);
                expect(await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize))).toBe(32);
                /** @type {string[]} */
                const zle = [];
                await walk(page, async (where) => {
                    for (const z of await page.evaluate(() => window.kontrola.orezane())) zle.push(`${where}: ${z}`);
                });
                expect(zle).toEqual([]);
                expect(errors).toEqual([]);
            });
        }
    }
});

test.describe('dotykové plochy', () => {
    for (const { width, height } of SIRKY) {
        for (const { name, opts, walk } of PRECHADZKY) {
            test(`šírka ${width} px, ${name}: každý ovládací prvok aspoň 44 × 44 px a od suseda aspoň 8 px`, async ({ page }) => {
                test.slow();
                await page.setViewportSize({ width, height });
                const errors = await openObloha(page, opts);
                /** @type {string[]} */
                const zle = [];
                await walk(page, async (where) => {
                    for (const z of await page.evaluate(() => window.kontrola.malePlochy())) zle.push(`${where}: ${z}`);
                });
                expect(zle).toEqual([]);
                expect(errors).toEqual([]);
            });
        }
    }
});

test.describe('čítačka obrazovky', () => {
    for (const { width, height, name: kde } of VSETKY) {
        for (const { name, opts, walk } of PRECHADZKY) {
            test(`${kde} (${width} × ${height}), ${name}: oblasti, jeden nadpis úrovne 1 a nadpisy bez preskakovania úrovní`, async ({
                page,
            }) => {
                test.slow();
                await page.setViewportSize({ width, height });
                const errors = await openObloha(page, opts);
                /** @type {string[]} */
                const zle = [];
                await walk(page, async (where) => {
                    for (const z of await page.evaluate(() => window.kontrola.struktura())) zle.push(`${where}: ${z}`);
                });
                expect(zle).toEqual([]);
                expect(errors).toEqual([]);
            });
        }
    }

    test('Môžem? ohlási len zmenu odpovede, nie každú minútu ani pri načítaní', async ({ page }) => {
        // Meranie zo strechy ide s časom - Worker odpovedá snímkou z chvíle, v ktorej appka je.
        let cas = at('16:58');
        await page.route(WORKER_PV_URL, (route) => route.fulfill({ json: { pv: pvAt(cas) } }));
        await page.route(/api\.open-meteo\.com/, (route) => route.fulfill({ json: weather }));
        await page.route(/cdnjs\.cloudflare\.com/, (route) => route.abort());
        await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [SETTINGS_STORAGE_KEY, JSON.stringify(toUser(OWNER))]);
        await page.clock.install({ time: cas });
        await page.goto('/obloha/');
        await expect(page.locator('#page')).toHaveAttribute('data-panel', 'mozem');
        const live = page.locator('#mz-live');
        await expect(live).toHaveAttribute('role', 'status');
        const pred = modelMozem(cas);
        await expect(page.locator('#mz-word')).toHaveText(pred.word);
        await expect(live).toHaveText('');

        // Minúta ubehne, odpoveď je tá istá: čítačka nič nepočuje.
        cas = at('16:59');
        await page.clock.runFor(60_000);
        await expect(page.locator('#hdr-status')).toHaveText('16:59');
        await expect(live).toHaveText('');

        // O hodinu je odpoveď iná: ohlási sa nové slovo a veta.
        cas = at('18:05');
        await page.clock.fastForward('01:06:00');
        const po = modelMozem(cas);
        expect(po.state).not.toBe(pred.state);
        await expect(page.locator('#mz-word')).toHaveText(po.word);
        await expect(live).toHaveText(`${po.word}. ${po.lead}`);

        // Odchod z karty a návrat ohlásenie nezopakuje.
        await page.locator('#nav-terazky').click();
        await page.locator('#nav-mozem').click();
        await expect(page.locator('#mz-word')).toHaveText(po.word);
        await expect(live).toHaveText('');
    });

    test('grafy majú textový popis pre čítačku', async ({ page }) => {
        await openObloha(page);
        await karta(page, 'terazky');
        await expect(page.locator('#tz-chart')).toHaveAttribute('aria-valuetext', /.+/);
        await expect(page.locator('#tz-chart-desc')).not.toBeEmpty();
        await karta(page, '7dni');
        await page.locator('#sd-days .day').first().click();
        await expect(page.locator('#sd-day-chart')).toHaveAttribute('aria-label', /.+/);
        await page.locator('#sd-day-back').click();
        await page.locator('#sd-sum').click();
        await expect(page.locator('#sd-bars')).toHaveAttribute('aria-label', /.+/);
        await expect(page.locator('#sd-heat')).toHaveAttribute('aria-label', /.+/);
    });
});

/** Model karty Môžem? v danej chvíli s dátami z fixtures. @param {Date} now */
const modelMozem = (now) =>
    mozemSkyModel({
        ...OWNER,
        now,
        pv: pvAt(now),
        forecast: buildForecast(weather, now, SITE, PLANT),
        loading: false,
        known: 'elektraren',
    });

for (const { width, height, name: kde } of VSETKY) {
    for (const { name, opts, walk } of PRECHADZKY) {
        test(`prístupnosť, ${kde} (${width} × ${height}), ${name}: žiadne vážne nálezy axe nikde`, async ({ page }) => {
            test.slow();
            await page.setViewportSize({ width, height });
            await openObloha(page, opts);
            /** @type {string[]} */
            const zle = [];
            await walk(page, async (where) => {
                const r = await new AxeBuilder({ page }).analyze();
                for (const v of r.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical'))
                    zle.push(`${where}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
            });
            expect(zle).toEqual([]);
        });
    }
}

test('plagát: popisky čísel na obrázku 1080 × 1920 sú každý v jednom riadku, aj „najlepší deň, 52,1 kWh“', async ({ page }) => {
    await openObloha(page);
    await karta(page, 'statistika');
    await page.locator('[data-poster="mesiac"]').click();
    await expect(page.locator('#poster')).toBeVisible();
    const vysledok = await page.evaluate(async () => {
        const tiles = [...document.querySelectorAll('#poster-tiles p')].map((p) => ({
            value: p.querySelector('strong')?.textContent ?? '',
            label: [...p.childNodes]
                .filter((n) => n.nodeType === Node.TEXT_NODE)
                .map((n) => n.textContent)
                .join(''),
        }));
        const { look, tileLabels } = await import('/obloha/web/poster-image.js');
        const t = look();
        await document.fonts.load(`500 42px ${t.font}`);
        const ctx = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d'));
        const { size, lines } = tileLabels(ctx, tiles, t);
        return { size, labels: tiles.map((x) => x.label), lines };
    });
    expect(vysledok.labels).toContain('najlepší deň, 52,1 kWh');
    expect(vysledok.size).toBeGreaterThanOrEqual(32);
    expect(vysledok.lines).toEqual(vysledok.labels.map((l) => [l]));
});
