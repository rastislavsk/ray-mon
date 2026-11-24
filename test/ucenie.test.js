// Učenie Plánu dňa z histórie (shared/ucenie.js) a jeho sekcia v Nastavení (shared/nastavenie-ucenie.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HISTORIA, HOUSE_BASE_KW, PLANT, SITE, TARIFF, UCENIE } from '../shared/config.js';
import { addDays } from '../shared/solar.js';
import {
    domProfil,
    naucenaPredpoved,
    naucene,
    nauceneZ,
    parseHistoria,
    potrebaBojlera,
    triedaOblacnosti,
    vikend,
} from '../shared/ucenie.js';
import { ucenieSekcia, UCENIE_TEXTS } from '../shared/nastavenie-ucenie.js';
import { dayCtx, freeKw } from '../shared/mozem-jadro.js';
import { fixtureData } from './helpers.js';

const DNES = '2026-11-19'; // štvrtok
/** Deň histórie: výroba `v` a dom `dom` v hodinách 8-16, bojler. @param {string} d @param {object} [o] */
function den(d, { v = 3, dom = 0.5, n = 12, b = null } = /** @type {any} */ ({})) {
    const h = Array.from({ length: 24 }, (_, hod) => (hod >= 8 && hod <= 16 ? [v, dom, n] : null));
    return /** @type {import('../shared/historia.js').DenHistorie} */ ({ d, h, b });
}
/** Snímka predpovede: `k` kW pri oblačnosti `c` v hodinách 8-16, teplota `t`. @param {string} d @param {object} [o] */
function snimka(d, { k = 4, c = 10, t = 10, m = 300 } = {}) {
    const hod = (/** @type {number} */ x) => Array.from({ length: 24 }, (_, i) => (i >= 8 && i <= 16 ? x : null));
    return { d, m, k: hod(k), c: hod(c), t };
}
const dni = (/** @type {number} */ n, /** @type {(d: string) => any} */ f) => Array.from({ length: n }, (_, i) => f(addDays(DNES, -1 - i)));

test('bez histórie: presne predvolené hodnoty', () => {
    const n = naucene({ dni: [], snimky: [], behy: [], today: DNES, od: null });
    assert.equal(n.dni, 0);
    assert.ok(n.oprava.every((r) => r.every((k) => k === 1)));
    assert.ok(n.dom.prac.every((kw) => kw === HOUSE_BASE_KW));
    assert.deepEqual(n.bojler, { pasma: [null, null, null], vsetky: null });
    assert.equal(potrebaBojlera(n, 3), 2000);
    assert.equal(potrebaBojlera(null, null), 2000);
    assert.deepEqual(domProfil(null, DNES), Array(24).fill(HOUSE_BASE_KW));
    const { forecast } = fixtureData();
    assert.equal(naucenaPredpoved(forecast, n), forecast, 'bez opravy tá istá predpoveď');
    assert.equal(naucenaPredpoved(null, n), null);
});

test('oprava predpovede: pomer meranie / predpoveď po hodinách a oblačnosti, od minDni dní, s váhou podľa veku', () => {
    // Za jasna dáva strecha 3 z predpovedaných 4 kW.
    const n = naucene({
        dni: dni(UCENIE.minDni, (d) => den(d)),
        snimky: dni(UCENIE.minDni, (d) => snimka(d)),
        behy: [],
        today: DNES,
        od: null,
    });
    assert.equal(n.dni, UCENIE.minDni);
    assert.equal(n.oprava[0][10], 0.75);
    assert.equal(n.oprava[1][10], 1, 'polojasno sa ešte neučilo');
    assert.equal(n.oprava[0][18], 1, 'hodina bez dát');
    // O deň menej: políčko ešte neplatí.
    const malo = naucene({
        dni: dni(UCENIE.minDni - 1, (d) => den(d)),
        snimky: dni(UCENIE.minDni, (d) => snimka(d)),
        behy: [],
        today: DNES,
        od: null,
    });
    assert.equal(malo.oprava[0][10], 1);
    // Novší deň váži viac: včera 4 kW, staršie 2 kW - výsledok bližšie k 1.
    const vahy = naucene({
        dni: dni(UCENIE.minDni, (d) => den(d, { v: d === addDays(DNES, -1) ? 4 : 2 })),
        snimky: dni(UCENIE.minDni, (d) => snimka(d)),
        behy: [],
        today: DNES,
        od: null,
    });
    assert.ok(vahy.oprava[0][10] > 0.6 && vahy.oprava[0][10] < 0.75);
    // Orezanie, slabá predpoveď, málo meraní, hodina pred snímkou, oblačnosť bez údaja.
    const veľa = naucene({
        dni: dni(UCENIE.minDni, (d) => den(d, { v: 40 })),
        snimky: dni(UCENIE.minDni, (d) => snimka(d)),
        behy: [],
        today: DNES,
        od: null,
    });
    assert.equal(veľa.oprava[0][10], UCENIE.oprava[1]);
    const slaba = naucene({ dni: dni(9, (d) => den(d)), snimky: dni(9, (d) => snimka(d, { k: 0.1 })), behy: [], today: DNES, od: null });
    assert.equal(slaba.oprava[0][10], 1);
    const riedko = naucene({ dni: dni(9, (d) => den(d, { n: 2 })), snimky: dni(9, (d) => snimka(d)), behy: [], today: DNES, od: null });
    assert.equal(riedko.oprava[0][10], 1);
    assert.equal(riedko.dni, 0, 'deň bez použiteľnej hodiny sa nepočíta');
    const neskoro = naucene({
        dni: dni(9, (d) => den(d)),
        snimky: dni(9, (d) => snimka(d, { m: 12 * 60 })),
        behy: [],
        today: DNES,
        od: null,
    });
    assert.deepEqual([neskoro.oprava[0][10], neskoro.oprava[0][13]], [1, 0.75], 'hodiny pred snímkou nie');
    const bezOblacnosti = dni(9, (d) => ({ ...snimka(d), c: Array(24).fill(null) }));
    assert.equal(naucene({ dni: dni(9, (d) => den(d)), snimky: bezOblacnosti, behy: [], today: DNES, od: null }).oprava[0][10], 1);
});

test('okno učenia: len dokončené dni, nie staršie než HISTORIA.dni, nie pred „Začať odznova“', () => {
    const vsetky = [den(DNES, { v: 1 }), ...dni(HISTORIA.dni + 10, (d) => den(d))];
    const snimky = [snimka(DNES), ...dni(HISTORIA.dni + 10, (d) => snimka(d))];
    assert.equal(naucene({ dni: vsetky, snimky, behy: [], today: DNES, od: null }).dni, HISTORIA.dni);
    assert.equal(naucene({ dni: vsetky, snimky, behy: [], today: DNES, od: addDays(DNES, -3) }).dni, 3);
    assert.equal(naucene({ dni: vsetky, snimky, behy: [], today: DNES, od: DNES }).dni, 0);
});

test('spotreba domu: po hodinách zvlášť pracovný deň a víkend, bez hodín, keď bežal spotrebič', () => {
    const historia = dni(21, (d) => den(d, { dom: vikend(d) ? 1.2 : 0.3 }));
    const behy = dni(21, (d) => ({ id: 'pracka', d, m: 10 * 60 + 30, k: 12 * 60 }));
    const pokazena = historia.map((x) => ({ ...x, h: x.h.map((s, hod) => (s && (hod === 10 || hod === 11) ? [s[0], 2.5, s[2]] : s)) }));
    const n = naucene({ dni: pokazena, snimky: [], behy, today: DNES, od: null });
    assert.deepEqual([n.dom.prac[9], n.dom.vik[9]], [0.3, 1.2]);
    assert.deepEqual([n.dom.prac[10], n.dom.prac[11]], [HOUSE_BASE_KW, HOUSE_BASE_KW], 'počas práčky sa neučí');
    assert.equal(n.dom.prac[3], HOUSE_BASE_KW, 'noc bez meraní');
    assert.equal(domProfil(n, '2026-11-21')[9], 1.2, 'sobota');
    assert.equal(domProfil(n, DNES)[9], 0.3);
    assert.deepEqual([vikend('2026-11-22'), vikend('2026-11-23')], [true, false]);
});

test('potreba bojlera: medián dní, keď ho vypol termostat, po pásmach teploty', () => {
    const wh = [3400, 3600, 3500, 2600, 2400, 2500, 9000];
    const t = [0, 1, 2, 10, 11, 12, 20];
    const historia = wh.map((x, i) => den(addDays(DNES, -1 - i), { b: { wh: x, hotovo: true } }));
    const snimky = t.map((x, i) => snimka(addDays(DNES, -1 - i), { t: x }));
    const nedohrial = den(addDays(DNES, -8), { b: { wh: 100, hotovo: false } });
    const n = naucene({ dni: [...historia, nedohrial], snimky, behy: [], today: DNES, od: null });
    assert.deepEqual(n.bojler, { pasma: [3500, 2500, null], vsetky: 3400 });
    assert.equal(potrebaBojlera(n, 2), 3500);
    assert.equal(potrebaBojlera(n, 25), 3400, 'v teple ešte nenaučené - za všetky dni');
    assert.equal(potrebaBojlera(n, null), 3400);
    const bezTeploty = naucene({ dni: historia, snimky: [], behy: [], today: DNES, od: null });
    assert.deepEqual(bezTeploty.bojler.pasma, [null, null, null]);
    assert.equal(bezTeploty.bojler.vsetky, 3400);
    const obrovsky = naucene({
        dni: wh.map((_, i) => den(addDays(DNES, -1 - i), { b: { wh: 20000, hotovo: true } })),
        snimky: [],
        behy: [],
        today: DNES,
        od: null,
    });
    assert.equal(obrovsky.bojler.vsetky, UCENIE.bojlerWh[1]);
});

test('naučená predpoveď: hodiny krát násobok ich oblačnosti, nikdy nad bezoblačný strop, súčty dní prepočítané', () => {
    const { forecast } = fixtureData();
    const oprava = [0, 1, 2].map((t) => Array.from({ length: 24 }, (_, h) => (t === 0 && h >= 9 && h <= 15 ? 0.5 : t === 2 ? 1.5 : 1)));
    const n = /** @type {any} */ ({
        dni: 10,
        od: null,
        oprava,
        dom: { prac: [], vik: [] },
        bojler: { pasma: [null, null, null], vsetky: null },
    });
    const f = /** @type {import('../shared/solar.js').Forecast} */ (naucenaPredpoved(forecast, n));
    const bod = forecast.hourlyToday.find((p) => p.hour === 12 && p.cloud !== null && p.cloud < UCENIE.oblacnost[0]);
    if (bod) assert.equal(f.hourlyToday.find((p) => p.hour === 12)?.kw, Math.round(bod.kw * 0.5 * 1000) / 1000);
    for (const [i, d] of f.days.entries()) {
        const povodny = forecast.days[i];
        assert.equal(d.kwhTotal, Math.round(d.hourly.reduce((s, h) => s + h.kw, 0) * 10) / 10);
        d.hourly.forEach((h, j) => assert.ok(h.kw <= Math.max(povodny.hourly[j].kw, povodny.hourly[j].clearKw) + 1e-9, 'strop'));
        assert.equal(d.peakKw, Math.round(Math.max(...d.hourly.map((h) => h.kw)) * 100) / 100);
    }
    assert.deepEqual([triedaOblacnosti(0), triedaOblacnosti(50), triedaOblacnosti(90)], [0, 1, 2]);
});

test('parseHistoria: od Workera či z úložiska len platné dni', () => {
    const ok = den('2026-11-18', { b: { wh: 1000, hotovo: true } });
    assert.deepEqual(parseHistoria(null), []);
    assert.deepEqual(
        parseHistoria([
            ok,
            null,
            { ...ok, d: '18. 11.' },
            { ...ok, h: [] },
            { ...ok, h: Array(24).fill([1, 2]) },
            { ...ok, b: { wh: 'x', hotovo: true } },
            { ...ok, d: '2026-11-17', b: null },
        ]),
        [ok, { ...ok, d: '2026-11-17', b: null }],
    );
    assert.equal(parseHistoria(Array.from({ length: HISTORIA.dni + 3 }, (_, i) => den(addDays(DNES, -i)))).length, HISTORIA.dni);
});

test('plán dňa: spotreba domu a potreba bojlera z učenia', () => {
    // 5. 9. 2026 je sobota - platí spotreba domu cez víkend.
    const now = new Date('2026-09-05T10:00:00+02:00');
    const { forecast } = fixtureData(now);
    const ucenie = /** @type {any} */ ({
        dni: 20,
        od: null,
        oprava: [0, 1, 2].map(() => Array(24).fill(1)),
        dom: { prac: Array(24).fill(1.4), vik: Array(24).fill(0.2) },
        bojler: { pasma: [null, null, null], vsetky: 3000 },
    });
    const i = { now, site: SITE, plant: PLANT, tariff: TARIFF, loading: false, pv: null, forecast, ucenie };
    const ctx = dayCtx(i);
    assert.equal(ctx.dom[12], 0.2);
    const slot = ctx.plan[Math.floor((13 * 60) / 15)].kw;
    assert.equal(freeKw(ctx, 13 * 60), Math.max(0, slot - 0.2));
});

test('Nastavenie: učenie z histórie - dni, grafy, bojler a začať odznova', () => {
    assert.equal(ucenieSekcia({ ucenie: null, doma: [] }), null);
    const zaciatok = /** @type {NonNullable<ReturnType<typeof ucenieSekcia>>} */ (
        ucenieSekcia({ ucenie: naucene({ dni: [], snimky: [], behy: [], today: DNES, od: null }), doma: ['bojler'] })
    );
    assert.deepEqual(
        [zaciatok.nazov, zaciatok.dni, zaciatok.zatial, zaciatok.bojler],
        [UCENIE_TEXTS.nazov, '0 dní', UCENIE_TEXTS.zatial, UCENIE_TEXTS.bojlerNic],
    );
    assert.equal(zaciatok.grafy, null, 'kým sa nenaučila, grafy nie sú');
    const oprava = [0, 1, 2].map(() => Array(24).fill(1));
    oprava[0][8] = 1.2;
    oprava[0][15] = 0.7;
    const n = /** @type {any} */ ({
        dni: 23,
        od: null,
        oprava,
        dom: { prac: Array.from({ length: 24 }, (_, h) => (h === 19 ? 0.9 : 0.3)), vik: [] },
        bojler: { pasma: [3400, 2600, null], vsetky: 3000 },
    });
    const s = /** @type {NonNullable<ReturnType<typeof ucenieSekcia>>} */ (ucenieSekcia({ ucenie: n, doma: ['pracka', 'bojler'] }));
    assert.deepEqual([s.dni, s.zatial], ['23 dní', '']);
    const g = /** @type {NonNullable<typeof s.grafy>} */ (s.grafy);
    const c8 = g.strecha.stlpce.find((c) => c.hod === 8);
    const c15 = g.strecha.stlpce.find((c) => c.hod === 15);
    assert.deepEqual([c8?.viac, c8?.h, c15?.viac, c15?.h], [true, 14, false, 21]);
    assert.equal(g.strecha.stlpce.length, 11);
    assert.equal(g.dom.popisMax, 'najviac 0,9 kW o 19:00');
    assert.equal(g.dom.body.split(' ').length, 24);
    assert.equal(s.bojler, 'Bojler pod 5 °C ~3,4 kWh · 5 – 15 °C ~2,6 kWh');
    assert.equal(
        ucenieSekcia({ ucenie: { ...n, bojler: { pasma: [null, null, null], vsetky: 2800 } }, doma: ['bojler'] })?.bojler,
        'Bojler ~2,8 kWh',
    );
    assert.equal(ucenieSekcia({ ucenie: n, doma: ['pracka'] })?.bojler, '', 'bez bojlera doma nič');
    assert.equal(UCENIE_TEXTS.dni(1), '1 deň');
});

test('nauceneZ: model zo zrkadla pre ranné oznámenie, poškodený null', () => {
    const n = naucene({ dni: [], snimky: [], behy: [], today: '2026-11-24', od: null });
    assert.equal(nauceneZ(JSON.parse(JSON.stringify(n))) !== null, true);
    assert.equal(nauceneZ({ ...n, od: '2026-11-01' }) !== null, true);
    for (const zle of [
        null,
        'x',
        { ...n, dni: '3' },
        { ...n, od: 'vcera' },
        { ...n, oprava: [[1]] },
        { ...n, dom: { prac: [], vik: [] } },
    ]) {
        assert.equal(nauceneZ(zle), null);
    }
    assert.equal(nauceneZ({ ...n, bojler: { pasma: ['x'], vsetky: null } }), null);
    assert.equal(nauceneZ({ ...n, bojler: { pasma: [], vsetky: 'x' } }), null);
    assert.equal(nauceneZ({ ...n, bojler: null }), null);
});
