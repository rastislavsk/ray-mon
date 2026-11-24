// Auto čisto zo slnka (docs/navrhy/auto-mimo-planu.html, A1 + K2 + B1 + Z1): prebytok nad domom a bojlerom, len nad
// minimom nabíjačky, ranný odhad, večerný prepis skutočnosťou a dlaždica na karte Teraz.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTO_SLNKO, BOJLER, PLAN_ZIVE, PLANT, SITE, TARIFF, UCENIE } from '../shared/config.js';
import { autoDenZ, autoDna, autoDnes, autoKrok, autoKwh, domDnes } from '../shared/auto-slnko.js';
import { autoDlazdicaNabija } from '../shared/auto-nabija.js';
import { terazAutoText } from '../shared/messages.js';
import { kmOf } from '../shared/mozem-jadro.js';
import { terazModel } from '../shared/teraz.js';
import { fixtureData } from './helpers.js';

/** Miestny čas 5. 9. 2026 v Bratislave (letný čas). @param {string} hm */
const at = (hm) => new Date(`2026-09-05T${hm}:00+02:00`);
const D = '2026-09-05';

/** Vstup s predpoveďou z fixtures, bez merania. @param {string} hm @param {object} [extra] */
function vstup(hm, extra = {}) {
    const now = at(hm);
    const { forecast } = fixtureData(now);
    return { now, site: SITE, plant: PLANT, tariff: TARIFF, loading: false, pv: null, forecast, ...extra };
}

/** Bojler, ktorý riadi zásuvka. @param {object} [o] */
const bojlerInfo = (o = {}) => ({
    kontaktAt: at('07:00').getTime(),
    rele: false,
    w: 0,
    prebytokKw: 0,
    prahy: { zapKw: BOJLER.zapKw, vypKw: BOJLER.vypKw },
    den: null,
    rucne: false,
    ...o,
});

test('autoKwh: len minúty s prebytkom aspoň na minimum nabíjačky, najviac jej príkon', () => {
    const pod = AUTO_SLNKO.minKw - 0.1;
    assert.equal(autoKwh([pod, pod, 0]), 0, 'pod minimom nabíjačka nenabíja');
    assert.ok(Math.abs(autoKwh([AUTO_SLNKO.minKw, 20]) - (AUTO_SLNKO.minKw + 11) / 60) < 1e-9, 'nad 11 kW len 11');
});

test('autoDnes: celý deň od polnoci, km z kWh, bojler riadený zásuvkou ide pred autom', () => {
    const rano = autoDnes(vstup('07:00'));
    assert.ok(rano.kwh > 5, `${rano.kwh}`);
    assert.equal(rano.km, kmOf(rano.kwh));
    // To isté ráno aj večer - je to číslo za celý deň, nie od teraz (bez merania je to predpoveď).
    assert.equal(autoDnes(vstup('12:00')).kwh, rano.kwh);
    const sBojlerom = autoDnes(vstup('07:00', { bojler: bojlerInfo() }));
    assert.ok(sBojlerom.kwh < rano.kwh, `${sBojlerom.kwh} < ${rano.kwh}`);
    // Bojler, ktorý dnes už nahrial, si zo slnka nič neberie.
    const den = { den: D, behy: [], hotovo: at('06:00').getTime(), posledneAt: at('06:00').getTime() };
    assert.equal(autoDnes(vstup('07:00', { bojler: bojlerInfo({ den, nahriata: true }) })).kwh, rano.kwh);
    // Väčšia spotreba domu nechá autu menej.
    const dom = Array.from({ length: 24 }, () => PLAN_ZIVE.domMax);
    assert.ok(autoDnes(vstup('07:00'), dom).kwh < rano.kwh);
});

test('autoDna: iný deň z jeho predpovede, odhad; bojler zo studenej vody', () => {
    const i = vstup('07:00');
    const dom = Array.from({ length: 24 }, () => 0.4);
    const zajtra = autoDna(i, 1, dom);
    assert.equal(zajtra.vecer, false);
    assert.ok(zajtra.kwh > 0);
    assert.equal(zajtra.km, kmOf(zajtra.kwh));
    // Dnes nahriaty - zajtra začína odznova a ide pred autom. Za jasna ohreje ráno, keď je prebytok ešte pod minimom
    // nabíjačky, takže autu nič neuberie; s väčšou potrebou (zima) hreje aj do silného slnka.
    const hreje = { ...i, bojler: bojlerInfo({ rele: true, w: 2000, nahriata: true }) };
    assert.equal(autoDna(hreje, 1, dom).kwh, zajtra.kwh);
    const ucenie = { dni: 9, od: null, oprava: [], dom: { prac: dom, vik: dom }, bojler: { pasma: [null, null, null], vsetky: 6000 } };
    assert.ok(autoDna({ ...hreje, ucenie }, 1, dom).kwh < zajtra.kwh);
});

test('domDnes: uzavreté hodiny histórie, okrem behov z „Už beží“, malých hodín a toho, čo do domu nepatrí', () => {
    const profil = Array.from({ length: 24 }, () => 0.4);
    const h = Array.from({ length: 24 }, () => /** @type {[number | null, number | null, number] | null} */ (null));
    h[8] = [3, 0.6, 12];
    h[9] = [4, 0.9, 12];
    h[10] = [5, 8, 12];
    h[11] = [5, 0.5, UCENIE.minMerani - 1];
    h[12] = [5, null, 12];
    const dni = [{ d: D, h, b: null }];
    const behy = [{ id: 'pracka', d: D, m: 9 * 60 + 30, k: 11 * 60 + 30 }];
    const dom = domDnes(profil, dni, behy, D);
    assert.equal(dom[8], 0.6, 'nameraná hodina');
    assert.equal(dom[9], 0.4, 'počas prania naučený profil');
    assert.equal(dom[10], 0.4, `nad ${PLAN_ZIVE.domMax} kW nabíjalo auto - nie je to dom`);
    assert.equal(dom[11], 0.4, 'málo meraní');
    assert.equal(dom[12], 0.4, 'bez merania domu');
    assert.equal(dom[13], 0.4, 'hodina ešte nie je uzavretá');
    assert.deepEqual(domDnes(profil, dni, behy, '2026-09-06'), profil, 'iný deň histórie nič');
});

test('autoKrok: ráno zamrazí odhad, po západe raz prepíše skutočnosťou', () => {
    const zapad = 19 * 60 + 30;
    const vecerMin = zapad + AUTO_SLNKO.vecerMin;
    const rano = { d: D, kwh: 10, km: 60, vecer: false };
    assert.equal(autoKrok(null, { d: D, nowMin: 7 * 60, zapad }), 'rano');
    assert.equal(autoKrok({ ...rano, d: '2026-09-04' }, { d: D, nowMin: 7 * 60, zapad }), 'rano', 'včerajšok nie je dnešok');
    assert.equal(autoKrok(rano, { d: D, nowMin: 15 * 60, zapad }), null, 'cez deň sa nemení');
    assert.equal(autoKrok(rano, { d: D, nowMin: vecerMin - 1, zapad }), null);
    assert.equal(autoKrok(rano, { d: D, nowMin: vecerMin, zapad }), 'vecer');
    assert.equal(autoKrok({ ...rano, vecer: true }, { d: D, nowMin: 22 * 60, zapad }), null, 'prepis len raz');
    assert.equal(autoKrok(null, { d: D, nowMin: 22 * 60, zapad }), 'vecer', 'prvé otvorenie večer rovno skutočnosť');
});

test('autoDenZ: len platný uložený deň', () => {
    const ok = { d: D, kwh: 10.4, km: 60, vecer: true };
    assert.deepEqual(autoDenZ(ok), ok);
    assert.deepEqual(autoDenZ({ ...ok, navyse: 1 }), ok);
    for (const zle of [null, 'x', { ...ok, d: '5. 9.' }, { ...ok, kwh: -1 }, { ...ok, km: NaN }, { ...ok, vecer: 1 }])
        assert.equal(autoDenZ(zle), null, JSON.stringify(zle));
});

test('dlaždica auta na karte Teraz: dnes zamrazené číslo, iný deň odhad, bez auta doma nič', () => {
    const autoDen = { d: D, kwh: 12.37, km: 70, vecer: false };
    const devices = ['pracka', 'auto'];
    const dnes = terazModel(vstup('13:00', { autoDen }), { devices }).co;
    assert.deepEqual(dnes?.auto, { ...terazAutoText(autoDen), podiel: 100, detail: false });
    assert.deepEqual(dnes?.auto?.odr, ['12,4 kWh zo slnka', 'odhad na celý deň']);
    assert.deepEqual([dnes?.auto?.velky, dnes?.auto?.za], ['~70', 'km']);
    assert.equal(terazModel(vstup('13:00', { autoDen: { ...autoDen, d: '2026-09-04' } }), { devices }).co?.auto, null, 'včerajšie nie');
    assert.equal(terazModel(vstup('13:00', { autoDen }), { devices: ['pracka'] }).co?.auto, null, 'bez auta doma');
});

test('dlaždica auta na karte Teraz: kým sa auto asi nabíja, je o behu (T2) a otvorí panel; iný deň nie', () => {
    const autoDen = { d: D, kwh: 12.37, km: 70, vecer: false };
    const devices = ['pracka', 'auto'];
    const now = at('13:00').getTime();
    const beh = { m: now - 60 * 60000, k: null, wh: 7200, whSiet: 0, kw: 7.2, q: [] };
    const autoNabija = { at: now - 60000, behy: [beh] };
    const dnes = terazModel(vstup('13:00', { autoDen, autoNabija }), { devices }).co?.auto;
    assert.deepEqual(dnes, { ...autoDlazdicaNabija(beh, SITE.timezone), detail: true });
    const hotovy = terazModel(vstup('13:00', { autoDen, autoNabija: { ...autoNabija, behy: [{ ...beh, k: now }] } }), { devices }).co?.auto;
    assert.deepEqual(hotovy, { ...terazAutoText(autoDen), podiel: 100, detail: true }, 'po nabíjaní slnko dňa, panel ostáva');
    const zajtra = terazModel(vstup('13:00', { autoDen, autoNabija }), { devices, den: 1 }).co?.auto;
    assert.equal(zajtra?.detail, false);
    assert.equal(zajtra?.odr[1], 'odhad na celý deň');
});

test('dlaždica auta na karte Teraz: iný deň odhad z jeho predpovede, deň bez slnka prázdny pásik', () => {
    const autoDen = { d: D, kwh: 12.37, km: 70, vecer: false };
    const devices = ['pracka', 'auto'];
    const zajtra = terazModel(vstup('13:00', { autoDen }), { devices, den: 1 }).co?.auto;
    assert.ok(zajtra && zajtra.podiel === 100 && zajtra.odr[1] === 'odhad na celý deň');
    // Deň bez slnka: 0 km, prázdny pásik.
    const nic = terazAutoText({ kwh: 0, km: 0, vecer: true });
    assert.deepEqual(nic, { velky: '0', za: 'km', meno: 'Auto', odr: ['0,0 kWh zo slnka', 'dnes naozaj'] });
    const tma = terazModel(vstup('13:00', { autoDen: { ...autoDen, kwh: 0, km: 0 } }), { devices }).co?.auto;
    assert.equal(tma?.podiel, null);
});
