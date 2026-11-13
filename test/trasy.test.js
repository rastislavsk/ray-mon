import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVERYDAY, PLANT, SITE, TARIFF, TRASY } from '../shared/config.js';
import { fmtSum } from '../shared/format.js';
import { cestaText } from '../shared/messages.js';
import { summaryModel } from '../shared/summary.js';
import { MESTA } from '../shared/trasy-mesta.js';
import {
    koloZeme,
    mestaPre,
    osrmAdresa,
    parseTrasy,
    parseZoznam,
    trasyPre,
    trasyZTabulky,
    vyberCestu,
    vzdusneKm,
    zaokruhli,
} from '../shared/trasy.js';
import { FIXED_NOW, fixtureData } from './helpers.js';

const DVORANY = { lat: 48.48, lon: 18.12 };
/** Trasy z Dvorian, ako ich 13. 11. 2026 zmeral OSRM. */
const Z_DVORIAN = [
    { id: 'nitra', km: 25 },
    { id: 'bratislava', km: 112 },
    { id: 'brno', km: 244 },
    { id: 'kosice', km: 331 },
    { id: 'krakov', km: 342 },
    { id: 'graz', km: 356 },
    { id: 'londyn', km: 1680 },
];
const km = (/** @type {number} */ n) => `${fmtSum(n, 0)} km`;

test('zoznam miest: id raz, meno v tvare „do …“, platné súradnice', () => {
    const ids = MESTA.map(([id]) => id);
    assert.equal(new Set(ids).size, ids.length, 'id sa neopakuje');
    for (const [id, meno, lat, lon] of MESTA) {
        assert.match(id, /^[a-z-]+$/, id);
        assert.ok(meno.length > 1 && meno.trim() === meno, id);
        assert.ok(Math.abs(lat) <= 90 && Math.abs(lon) <= 180, id);
    }
});

test('poloha: zaokrúhlenie na stotiny a vzdialenosť vzdušnou čiarou', () => {
    assert.deepEqual(zaokruhli({ lat: 48.4812, lon: 18.1249 }), { lat: 48.48, lon: 18.12 });
    assert.equal(Math.round(vzdusneKm(DVORANY, { lat: 49.2, lon: 16.61 })), 136, 'Dvorany – Brno');
    assert.equal(vzdusneKm(DVORANY, DVORANY), 0);
});

test('mestaPre: najbližšie do dosahu, nie mesto v tom istom mieste, najviac TRASY.najviacMiest', () => {
    const mesta = mestaPre(DVORANY);
    assert.equal(mesta.length, TRASY.najviacMiest, 'okolo Slovenska je miest dosť');
    assert.equal(mesta[0].id, 'nitra');
    const kmy = mesta.map((m) => vzdusneKm(DVORANY, m));
    assert.ok(
        kmy.every((k, i) => i === 0 || k >= kmy[i - 1]),
        'od najbližšieho',
    );
    assert.ok(!mestaPre({ lat: 48.31, lon: 18.09 }).some((m) => m.id === 'nitra'), 'z Nitry nie do Nitry');
    assert.deepEqual(mestaPre({ lat: 0, lon: -140 }), [], 'uprostred oceánu nič');
});

test('osrmAdresa: dom prvý, dĺžka pred šírkou, vzdialenosti len z domu', () => {
    assert.equal(osrmAdresa(DVORANY, [{ lat: 49.2, lon: 16.61 }]), `${TRASY.osrmUrl}18.12,48.48;16.61,49.2?sources=0&annotations=distance`);
});

test('trasyZTabulky: km z metrov, ostrov a mesto bez cesty vypadnú, dom bez ciest nič, nečakané null', () => {
    const mesta = [{ id: 'brno' }, { id: 'tchaj-pej' }, { id: 'praha' }];
    const ok = {
        code: 'Ok',
        sources: [{ distance: 40 }],
        destinations: [{ distance: 40 }, { distance: 12 }, { distance: 178152 }, { distance: 3 }],
        distances: [[0, 244310, 862000, null]],
    };
    assert.deepEqual(trasyZTabulky(ok, mesta), [{ id: 'brno', km: 244 }]);
    assert.deepEqual(trasyZTabulky({ ...ok, sources: [{ distance: 90000 }] }, mesta), []);
    assert.equal(trasyZTabulky({ ...ok, code: 'NoTable' }, mesta), null);
    assert.equal(trasyZTabulky({ ...ok, destinations: [] }, mesta), null);
    assert.equal(trasyZTabulky({ ...ok, distances: [] }, mesta), null);
    assert.equal(trasyZTabulky(null, mesta), null);
    assert.deepEqual(trasyZTabulky({ ...ok, sources: null }, mesta), []);
});

test('parseZoznam, parseTrasy a trasyPre: neznáme mestá vypadnú, trasy platia len pre svoju polohu', () => {
    assert.deepEqual(parseZoznam([{ id: 'brno', km: 244 }, { id: 'atlantida', km: 5 }, { id: 'nitra', km: -1 }, 'x']), [
        { id: 'brno', km: 244 },
    ]);
    assert.equal(parseZoznam({}), null);
    const t = parseTrasy({ lat: 48.48, lon: 18.12, trasy: [{ id: 'brno', km: 244 }] });
    assert.deepEqual(t, { lat: 48.48, lon: 18.12, trasy: [{ id: 'brno', km: 244 }] });
    assert.equal(parseTrasy({ lat: '48', lon: 18, trasy: [] }), null);
    assert.equal(parseTrasy({ lat: 48, lon: 18, trasy: null }), null);
    assert.equal(parseTrasy(null), null);
    assert.deepEqual(trasyPre(t, { lat: 48.4812, lon: 18.1203 }), t?.trasy);
    assert.equal(trasyPre(t, { lat: 48.5, lon: 18.12 }), null, 'iná poloha');
    assert.equal(trasyPre(null, DVORANY), null);
});

test('vyberCestu: trasy v tolerancii, striedanie podľa semienka, míľnik, inak skoro, ďalej, kus', () => {
    const brno = vyberCestu(251, Z_DVORIAN, 'a');
    assert.equal(brno.kind, 'mesto');
    // Pri 251 km sedí Brno (244) aj Bratislava a späť (224); rôzne dni dajú obe.
    const texty = new Set(
        ['2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17'].map((d) =>
            cestaText(vyberCestu(251, Z_DVORIAN, d), 251, 'dnes'),
        ),
    );
    assert.deepEqual([...texty].sort(), [`ako z domu do Bratislavy a späť (${km(224)})`, `ako z domu do Brna (${km(244)})`]);
    assert.deepEqual(vyberCestu(251, Z_DVORIAN, 'x'), vyberCestu(251, Z_DVORIAN, 'x'), 'to isté semienko, ten istý výber');
    assert.deepEqual(vyberCestu(3700, [], 'a'), { kind: 'milnik', id: 'route66', km: 3940 }, 'míľnik aj bez trás');
    assert.deepEqual(vyberCestu(3000, [], 'a'), { kind: 'zem', nasobok: 3000 / TRASY.zemKm }, 'bez trás cesta okolo Zeme');
    assert.deepEqual(vyberCestu(30, Z_DVORIAN, 'a'), { kind: 'mesto', do: 'Nitry', km: 25, spat: false, presne: 'dalej' });
    assert.equal(vyberCestu(19, Z_DVORIAN, 'a').kind === 'mesto' && vyberCestu(19, Z_DVORIAN, 'a').presne, 'skoro');
    assert.equal(vyberCestu(6, Z_DVORIAN, 'a').kind === 'mesto' && vyberCestu(6, Z_DVORIAN, 'a').presne, 'kus');
    assert.equal(
        vyberCestu(2500, Z_DVORIAN, 'a').kind === 'mesto' && vyberCestu(2500, Z_DVORIAN, 'a').presne,
        'skoro',
        'bližšie je Londýn a späť (3 360 km) než tam (1 680 km)',
    );
    assert.equal(vyberCestu(15000, Z_DVORIAN, 'a').kind, 'zem', 'od zemOdKm cesta okolo Zeme');
    assert.deepEqual(vyberCestu(400000, Z_DVORIAN, 'a'), { kind: 'mesiac', spat: false });
    assert.deepEqual(vyberCestu(800000, Z_DVORIAN, 'a'), { kind: 'mesiac', spat: true });
});

test('koloZeme a cestaText: kolo okolo Zeme len pri celom čase', () => {
    assert.deepEqual(koloZeme(48000), { kolo: 2, chyba: 2 * TRASY.zemKm - 48000 });
    const c = vyberCestu(48000, Z_DVORIAN, 'a');
    assert.equal(cestaText(c, 48000, 'rok'), '1,1-krát okolo Zeme');
    assert.equal(cestaText(c, 48000, 'spolu'), `1,1-krát okolo Zeme · do druhého kola chýba ${km(32000)}`);
    assert.equal(cestaText({ kind: 'zem', nasobok: 0.37 }, 15000, 'spolu'), `37 % cesty okolo Zeme · do prvého kola chýba ${km(25000)}`);
    assert.equal(cestaText({ kind: 'zem', nasobok: 12.4 }, 40075 * 12.4, 'spolu'), `12-krát okolo Zeme · do 13. kola chýba ${km(24000)}`);
    assert.equal(
        cestaText({ kind: 'zem', nasobok: 1.99 }, 40075 * 2 - 100, 'spolu'),
        `1,9-krát okolo Zeme · do druhého kola chýba ${km(100)}`,
    );
    assert.equal(cestaText({ kind: 'zem', nasobok: 2 }, 40075 * 2 - 3, 'spolu'), `dvakrát okolo Zeme · do druhého kola chýba ${km(10)}`);
    assert.equal(cestaText({ kind: 'mesiac', spat: false }, 400000, 'spolu'), `až na Mesiac (${km(384400)})`);
    assert.equal(cestaText({ kind: 'milnik', id: 'transsib', km: 9289 }, 9000, 'rok'), `ako celá Transsibírska magistrála (${km(9289)})`);
});

test('summaryModel: podnadpis km autom z trás tejto polohy, s inou polohou cesta okolo Zeme', () => {
    const { pv, forecast } = fixtureData();
    const kwh = 251 / EVERYDAY.evKmPerKwh;
    const input = {
        now: FIXED_NOW,
        site: SITE,
        plant: PLANT,
        tariff: TARIFF,
        zdroj: { sposob: 'huawei-kiosk', pecat: 'v1.test-pecat-0123456789', nazov: '' },
        loading: false,
        pv: { ...pv, dailyEnergyKwh: kwh },
        forecast,
        dayLog: {},
        trasy: { ...zaokruhli(SITE), trasy: Z_DVORIAN },
    };
    const s = summaryModel(/** @type {any} */ (input), 'dnes').rows[1].s;
    assert.match(s, /^ako z domu do (Brna|Bratislavy a späť) \(/);
    const inde = summaryModel(/** @type {any} */ ({ ...input, trasy: { lat: 1, lon: 1, trasy: Z_DVORIAN } }), 'dnes').rows[1].s;
    assert.equal(inde, '0,6 % cesty okolo Zeme');
    const odhad = summaryModel(/** @type {any} */ ({ ...input, pv: null, zdroj: null }), 'dnes').rows[1].s;
    assert.ok(odhad.length > 0, 'aj odhad z predpovede má podnadpis');
});
