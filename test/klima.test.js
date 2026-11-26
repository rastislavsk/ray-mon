// Klimatizácia Daikin (docs/navrhy/klima-daikin.html): čítanie odpovedí adaptéra, stav a body vo Workeri, zdroje hodín,
// skript na Shelly v podvrhnutom prostredí, dlaždica, panel a sekcia v Nastavení. Odpovede sú skutočné z adaptéra
// BRP069B4X (26. 11. 2026 o 11:17).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { ALL_DAYS, ALL_MONTHS, KLIMA, TARIFF, WORKER_KLIMA_URL } from '../shared/config.js';
import { bodyDna, daikin, klimaSpojena, klimaStavZ, klimaUkaz, pridajBod, slnkoKlimy, zHlasenia } from '../shared/klima.js';
import { skriptKlimy } from '../shared/klima-skript.js';
import { KLIMA_NAST_TEXTS, klimaNastZ, klimaSekcia } from '../shared/nastavenie-klima.js';
import { klimaDetail, klimaDlazdica, TERAZ_KLIMA_TEXTS } from '../shared/teraz-klima.js';

const TZ = 'Europe/Bratislava';
const NOW = Date.parse('2026-11-26T10:17:00Z');

const ODPOVEDE = {
    s: 'ret=OK,htemp=22.0,hhum=-,otemp=2.0,err=0,cmpfreq=68,mompow=12',
    c: 'ret=OK,pow=1,mode=4,adv=,stemp=23.5,shum=0,dt1=25.0,f_rate=A,f_dir=0,alert=255',
    d:
        'ret=OK,curr_day_heat=12/12/10/12/11/11/11/11/12/12/15/0/0/0/0/0/0/0/0/0/0/0/0/0,' +
        'prev_1day_heat=10/9/10/10/10/9/11/9/10/12/11/12/12/12/11/11/12/12/12/11/16/12/11/12,' +
        'curr_day_cool=0/0/0/0/0/0/0/0/0/0/0/0/0/0/0/0/0/0/0/0/0/0/0/0,prev_1day_cool=0/0/0/0/0/0/0/0/0/0/0/0/0/0/0/0/0/0/0/0/0/0/0/0',
    w: 'ret=OK,s_dayw=4,week_heat=129/267/198/174/153/96/86/97/107/136/155/167/174/153,week_cool=0/0/0/0/0/0/0/0/0/0/0/0/0/0',
    t: 'ret=OK,today_runtime=677,datas=300/200/300/200/300/300/100',
    r:
        'ret=OK,curr_year_heat=8513/6343/3448/1976/415/0/0/0/30/1330/3748/0,prev_year_heat=8447/7887/4258/1839/1033/0/0/0/77/1808/4410/6824,' +
        'curr_year_cool=0/0/0/3/9/229/121/690/6/0/0/0,prev_year_cool=0/0/0/5/7/12/12/20/8/1/0/0',
    b: 'ret=OK,type=aircon,reg=eu,ver=4_2_303,pow=1,err=0,radio1=-56,pw=,lpw_flag=0',
};

/** Stav z plného hlásenia. */
const stav = () => /** @type {import('../shared/klima.js').KlimaInfo} */ (zHlasenia(ODPOVEDE, null, NOW, TZ));

test('daikin: hodnoty z odpovede OK, iná odpoveď null', () => {
    assert.deepEqual(daikin('ret=OK,a=1,b=-,c='), { ret: 'OK', a: '1', b: '-', c: '' });
    assert.equal(daikin('ret=PARAM NG'), null);
    assert.equal(daikin(42), null);
});

test('zHlasenia: stav, teploty, príkon v W, hodiny, 14 dní, rok, Wi-Fi a firmvér', () => {
    const k = stav();
    assert.equal(k.pow, true);
    assert.equal(k.rezim, 'kurenie');
    assert.equal(k.stempC, 23.5);
    assert.equal(k.domaC, 22);
    assert.equal(k.vonkuC, 2);
    assert.equal(k.hz, 68);
    assert.equal(k.w, 1200);
    assert.equal(k.ventilator, 'A');
    assert.equal(k.lamely, false);
    assert.equal(k.chyba, 0);
    assert.equal(k.behMin, 677);
    assert.equal(k.hod?.d, '2026-11-26');
    assert.equal(k.hod?.k[10], 1500);
    assert.equal(k.vcera, 26700);
    assert.equal(k.dni?.k[0], 12900);
    assert.equal(k.rok?.r, 2026);
    assert.equal(k.rok?.k[0], 851300);
    assert.equal(k.rok?.cMin[7], 2000);
    assert.equal(k.wifi, -56);
    assert.equal(k.fw, '4.2.303');
});

test('zHlasenia: bez stavu či teplôt null; nezmysly a chýbajúce hodnoty sú null', () => {
    assert.equal(zHlasenia({ s: ODPOVEDE.s }, null, NOW, TZ), null);
    assert.equal(zHlasenia({ s: ODPOVEDE.s, c: 'ret=OK,pow=9' }, null, NOW, TZ), null);
    assert.equal(zHlasenia(null, null, NOW, TZ), null);
    const k = zHlasenia({ s: 'ret=OK,htemp=99,otemp=-,cmpfreq=--', c: 'ret=OK,pow=0,mode=6,stemp=M,f_dir=3' }, null, NOW, TZ);
    assert.equal(k?.domaC, null);
    assert.equal(k?.vonkuC, null);
    assert.equal(k?.hz, null);
    assert.equal(k?.w, null);
    assert.equal(k?.stempC, null);
    assert.equal(k?.rezim, 'ventilator');
    assert.equal(k?.lamely, true);
    assert.equal(k?.hod, null);
    assert.equal(k?.rok, null);
    assert.equal(zHlasenia({ s: 'ret=OK,otemp=-12.5', c: 'ret=OK,pow=1,mode=9' }, null, NOW, TZ)?.vonkuC, -12.5);
});

test('zHlasenia: bez novej energie ostane stará z dneška, po polnoci nie', () => {
    const k = stav();
    const len = { s: ODPOVEDE.s, c: ODPOVEDE.c };
    const neskor = zHlasenia(len, k, NOW + 60000, TZ);
    assert.deepEqual(neskor?.hod, k.hod);
    assert.equal(neskor?.vcera, k.vcera);
    assert.deepEqual(neskor?.dni, k.dni);
    assert.deepEqual(neskor?.rok, k.rok);
    assert.equal(neskor?.behMin, 677);
    assert.equal(neskor?.wifi, -56);
    const zajtra = zHlasenia(len, k, NOW + 24 * 3600 * 1000, TZ);
    assert.equal(zajtra?.hod, null);
    assert.equal(zajtra?.vcera, null);
    assert.equal(zajtra?.dni, null);
    // Rok ostáva, kým je ten istý.
    assert.deepEqual(zajtra?.rok, k.rok);
    assert.equal(zHlasenia(len, k, Date.parse('2027-01-02T10:00:00Z'), TZ)?.rok, null);
});

test('pridajBod a bodyDna: bod najviac každých KLIMA.bodKrokMin minút, staré odpadnú, dnešné pre appku', () => {
    const k = stav();
    const b1 = pridajBod([], k, NOW);
    assert.deepEqual(b1, [[Math.floor(NOW / 60000), 220, 20, 1200]]);
    assert.equal(pridajBod(b1, k, NOW + 60000), b1);
    const b2 = pridajBod(b1, { ...k, domaC: null }, NOW + KLIMA.bodKrokMin * 60000);
    assert.equal(b2.length, 2);
    assert.equal(b2[1][1], null);
    const neskor = pridajBod(b2, k, NOW + (KLIMA.bodyDni * 24 + 1) * 3600 * 1000);
    assert.equal(neskor.length, 1);
    const dnes = bodyDna(b2, new Date(NOW), TZ);
    assert.deepEqual(dnes[0], [11 * 60 + 17, 22, 2, 1200]);
    assert.equal(dnes[1][1], null);
    assert.equal(bodyDna(b2, new Date(NOW + 24 * 3600 * 1000), TZ).length, 0);
});

test('slnkoKlimy: zo slnka to, čo ostalo z výroby po zvyšku domu, najviac celá hodina; bez súhrnu null', () => {
    const hod = [1000, 1000, 1000, 1000, ...Array.from({ length: 20 }, () => 0)];
    /** @type {import('../shared/historia.js').DenHistorie} */
    const den = {
        d: '2026-11-26',
        h: [[0, 1.2, 12], [1.6, 1.4, 12], [3, 1.2, 12], [0.5, null, 12], ...Array.from({ length: 20 }, () => null)],
        b: null,
    };
    const z = slnkoKlimy(hod, den);
    assert.deepEqual(z[0], [0, 1000]);
    assert.deepEqual(z[1], [1000, 0]);
    assert.deepEqual(z[2], [1000, 0]);
    assert.equal(z[3], null);
    assert.equal(z[4], null);
    // Výroba 1,2 kW, dom s klimou 1,5 kW (klima 1 kWh): zvyšok domu 0,5, na klimu ostane 0,7.
    assert.deepEqual(slnkoKlimy([1000], { d: 'x', h: [[1.2, 1.5, 12]], b: null })[0], [700, 300]);
    assert.equal(slnkoKlimy([1000], null)[0], null);
});

/** Stav, ako ho appka dostane od Workera. @param {Partial<import('../shared/klima.js').KlimaStav>} [x] */
function odWorkera(x = {}) {
    const k = stav();
    const raw = JSON.parse(
        JSON.stringify({
            ...k,
            body: [
                [0, 21.5, 0.5, 1100],
                [300, 22, -1, 1200],
                [677, 22, 2, 1200],
            ],
            zdroje: [
                ...Array.from({ length: 8 }, () => null),
                [600, 600],
                [1200, 0],
                [500, 1000],
                ...Array.from({ length: 13 }, () => null),
            ],
            ...x,
        }),
    );
    return /** @type {import('../shared/klima.js').KlimaStav} */ (klimaStavZ(raw));
}

test('klimaStavZ: platný stav prejde, zlý je null, chybné polia vypadnú', () => {
    const k = odWorkera();
    assert.equal(k.w, 1200);
    assert.equal(k.body.length, 3);
    assert.equal(k.zdroje.length, 24);
    assert.equal(klimaStavZ(null), null);
    assert.equal(klimaStavZ({ at: 1 }), null);
    const zly = klimaStavZ({
        ...k,
        rezim: 'iny',
        hod: { d: 'zle', k: [], c: [] },
        dni: { d: '2026-11-26', k: [1] },
        rok: { r: 2026, k: [1] },
        body: [[1, 'x', 2, 3]],
        zdroje: [],
    });
    assert.equal(zly?.rezim, 'auto');
    assert.equal(zly?.hod, null);
    assert.equal(zly?.dni, null);
    assert.equal(zly?.rok, null);
    assert.equal(zly?.body.length, 0);
    assert.equal(zly?.zdroje.length, 0);
    const bez = klimaStavZ({ at: 1, pow: false, rezim: 'kurenie', ventilator: 3, lamely: 'x', fw: 1 });
    assert.equal(bez?.ventilator, null);
    assert.equal(bez?.lamely, null);
    assert.equal(bez?.fw, null);
    assert.deepEqual(odWorkera({ zdroje: /** @type {any} */ ([...Array.from({ length: 23 }, () => null), [-1, 2]]) }).zdroje[23], null);
});

test('klimaSpojena a klimaUkaz: čerstvé hlásenie a dokedy ukázať dlaždicu', () => {
    assert.equal(klimaSpojena({ at: NOW }, NOW + KLIMA.tichoMin * 60000), true);
    assert.equal(klimaSpojena({ at: NOW }, NOW + KLIMA.tichoMin * 60000 + 1), false);
    assert.equal(klimaUkaz({ at: NOW }, NOW + KLIMA.ukazHod * 3600000 - 1), true);
    assert.equal(klimaUkaz({ at: NOW }, NOW + KLIMA.ukazHod * 3600000), false);
    assert.equal(klimaUkaz(null, NOW), false);
});

/** VT 8:00 - 20:00, inak NT. @type {import('../shared/config.js').Tariff} */
const TARIFA = {
    ...TARIFF,
    bands: [
        { id: 'nt', name: 'NT', level: 'lacna', price: 0.1 },
        { id: 'vt', name: 'VT', level: 'draha', price: 0.2 },
    ],
    schedules: [
        {
            days: ALL_DAYS,
            months: ALL_MONTHS,
            changes: [
                { from: '00:00', band: 'nt' },
                { from: '08:00', band: 'vt' },
                { from: '20:00', band: 'nt' },
            ],
        },
    ],
};
test('klimaDlazdica: príkon, vonku / nastavená, dnešné kWh, pásik so slnkom a drahým pásmom, zapnutá', () => {
    const d = klimaDlazdica(odWorkera(), new Date(NOW), TZ, null);
    assert.equal(d.velky, '1,2');
    assert.equal(d.za, 'kW');
    assert.equal(d.meno, TERAZ_KLIMA_TEXTS.meno);
    assert.deepEqual(d.odr, ['2° / 23,5°', 'dnes 12,9 kWh']);
    assert.equal(d.riadi, 'bezi');
    // Zo slnka 600 + 1200 + 500 Wh z 12 900.
    assert.equal(d.podiel, Math.round((100 * 2300) / 12900));
    assert.equal(d.draha, 0);
    const vt = klimaDlazdica(odWorkera(), new Date(NOW), TZ, TARIFA);
    assert.ok(vt.draha > 0);
    assert.equal(klimaDlazdica(odWorkera({ hz: 0 }), new Date(NOW), TZ, null).riadi, 'vyp');
    assert.equal(klimaDlazdica(odWorkera({ pow: false }), new Date(NOW), TZ, null).riadi, 'vyp');
    const bez = klimaDlazdica(odWorkera({ hod: null, vonkuC: null, stempC: null, w: null }), new Date(NOW), TZ, null);
    assert.equal(bez.podiel, null);
    assert.equal(bez.velky, '0,0');
    assert.deepEqual(bez.odr, ['– / –', 'dnes 0,0 kWh']);
    assert.equal(klimaDlazdica(odWorkera({ vonkuC: -12.5 }), new Date(NOW), TZ, null).odr[0], '−12,5° / 23,5°'.replace('−', '-'));
});

test('klimaDlazdica: skript mlčí - tón chyba a ako dlho', () => {
    const d = klimaDlazdica(odWorkera(), new Date(NOW + 20 * 60000), TZ, null);
    assert.equal(d.tone, 'chyba');
    assert.equal(d.velky, '20 min');
    assert.deepEqual(d.odr, [TERAZ_KLIMA_TEXTS.mlci, TERAZ_KLIMA_TEXTS.bezSpojenia]);
    assert.equal(klimaDlazdica(odWorkera(), new Date(NOW + 3 * 3600000), TZ, null).velky, '3 h');
});

test('klimaDetail: nadpis, graf, energia, beh, 14 dní, rok a podrobnosti', () => {
    const d = klimaDetail(odWorkera(), new Date(NOW), TZ, TARIFA);
    assert.equal(d.nadpis, 'Klíma');
    assert.equal(d.pod, 'Kúri na 23,5 °C · 1,2 kW teraz');
    assert.ok(d.graf);
    assert.match(d.graf.doma, /^M0 /);
    assert.equal(d.graf.popisky.length, 2);
    assert.ok(Math.abs(d.graf.popisky[0].y - d.graf.popisky[1].y) >= 16);
    assert.equal(d.graf.stlpce[10].k, 75);
    assert.ok(d.graf.nastavena);
    assert.ok(d.graf.nula !== null);
    assert.equal(d.graf.teraz, Math.round(((11 * 60 + 17) / 1440) * 10000) / 100);
    assert.deepEqual(
        d.energia.map((c) => c.tone),
        ['slnko', 'siet', 'vt'],
    );
    assert.equal(d.beh, 'Dnes 12,9 kWh · beží 11 h 17 min · včera 26,7 kWh');
    assert.equal(d.dni?.stlpce.length, 14);
    assert.equal(d.dni?.stlpce[13].dnes, true);
    assert.equal(d.dni?.najviac, 'Najviac v stredu 25. 11.: 26,7 kWh');
    assert.equal(d.rok?.mesiace[11].tento, null);
    assert.equal(d.rok?.sucty[0].v, `${(2580).toLocaleString('sk-SK')} kWh`);
    assert.equal(d.rok?.sucty[1].v, '106 kWh');
    assert.match(d.rok?.pozn ?? '', /^November zatiaľ 375 kWh, celý minulý 441 kWh/);
    assert.deepEqual(d.podrobnosti[0], ['Režim', 'kúrenie']);
    assert.deepEqual(
        d.podrobnosti.map((r) => r[0]),
        ['Režim', 'Kompresor', 'Ventilátor', 'Lamely', 'Chyba', 'Wi-Fi adaptéra', 'Firmvér adaptéra', 'Údaje'],
    );
    assert.equal(d.podrobnosti[5][1], '−56 dBm');
});

test('klimaDetail: vypnutá, mlčí, bez dát a ventilátor', () => {
    const vyp = klimaDetail(
        odWorkera({
            pow: false,
            hz: 0,
            behMin: 45,
            vcera: null,
            dni: null,
            rok: null,
            body: [],
            hod: null,
            ventilator: '5',
            lamely: true,
            chyba: 7,
        }),
        new Date(NOW),
        TZ,
        null,
    );
    assert.equal(vyp.pod, TERAZ_KLIMA_TEXTS.vypnuta);
    assert.equal(vyp.graf, null);
    assert.equal(vyp.dni, null);
    assert.equal(vyp.rok, null);
    assert.equal(vyp.beh, 'Dnes 0,0 kWh · beží 45 min');
    assert.deepEqual(vyp.podrobnosti.slice(0, 5), [
        ['Režim', 'vypnutá'],
        ['Kompresor', 'stojí'],
        ['Ventilátor', 'stupeň 3'],
        ['Lamely', 'pohybujú sa'],
        ['Chyba', '7'],
    ]);
    assert.equal(klimaDetail(odWorkera(), new Date(NOW + 2 * 3600000), TZ, null).pod, 'neozýva sa 2 h');
    assert.equal(TERAZ_KLIMA_TEXTS.ventilator('B'), 'tichý');
    assert.equal(TERAZ_KLIMA_TEXTS.ventilator('X'), 'X');
    // Len hodiny bez bodov: graf so stĺpcami, bez kriviek; teraz vpravo.
    const len = klimaDetail(odWorkera({ body: [], stempC: null }), new Date(NOW), TZ, null).graf;
    assert.equal(len?.doma, '');
    assert.equal(len?.nastavena, null);
    assert.equal(len?.popisky.length, 0);
});

test('skriptKlimy: zlá pečať, adresa Workera či klimatizácie - null', () => {
    assert.equal(skriptKlimy({ url: WORKER_KLIMA_URL, pecat: "v1.a';x", ip: '10.10.10.148' }), null);
    assert.equal(skriptKlimy({ url: 'http://x.sk/', pecat: 'v1.a', ip: '10.10.10.148' }), null);
    assert.equal(skriptKlimy({ url: WORKER_KLIMA_URL, pecat: 'v1.a', ip: "10.0.0.1/'" }), null);
    assert.equal(skriptKlimy({ url: WORKER_KLIMA_URL, pecat: 'v1.a', ip: '' }), null);
});

test('skriptKlimy: číta adaptér a posiela odpovede; energiu každých KLIMA.hodinyMin, rok každých KLIMA.rokMin minút', () => {
    const kod = /** @type {string} */ (skriptKlimy({ url: WORKER_KLIMA_URL, pecat: 'v1.abc_DEF-123', ip: ' 10.10.10.148 ' }));
    /** @type {any[]} */ const posty = [];
    /** @type {string[]} */ const gety = [];
    /** @type {Array<() => void>} */ const casovace = [];
    let ticho = false;
    const Shelly = {
        getDeviceInfo: () => ({ id: 'shelly1g3-abc' }),
        call: (/** @type {string} */ m, /** @type {any} */ p, /** @type {any} */ cb) => {
            if (m === 'HTTP.GET') {
                gety.push(p.url);
                const cesta = p.url.replace('http://10.10.10.148', '');
                cb(ticho ? null : { code: 200, body: `ret=OK,cesta=${cesta}` }, ticho ? -114 : 0, '');
                return;
            }
            assert.equal(m, 'HTTP.POST');
            assert.ok(p.body.length > 0);
            posty.push({ url: p.url, telo: JSON.parse(p.body) });
            cb({ code: 200, body: '{"ok":true}' }, 0, '');
        },
    };
    const Timer = { set: (/** @type {number} */ ms, /** @type {boolean} */ opak, /** @type {() => void} */ fn) => casovace.push(fn) };
    vm.runInNewContext(kod, { Shelly, Timer, JSON });
    assert.equal(posty.length, 1);
    assert.equal(posty[0].url, WORKER_KLIMA_URL);
    assert.equal(posty[0].telo.pecat, 'v1.abc_DEF-123');
    assert.equal(posty[0].telo.id, 'shelly1g3-abc');
    assert.deepEqual(Object.keys(posty[0].telo).sort(), ['b', 'c', 'd', 'id', 'pecat', 'r', 's', 't', 'w']);
    assert.equal(posty[0].telo.s, 'ret=OK,cesta=/aircon/get_sensor_info');
    casovace[0]();
    assert.deepEqual(Object.keys(posty[1].telo).sort(), ['c', 'id', 'pecat', 's']);
    for (let i = 2; i <= KLIMA.hodinyMin; i++) casovace[0]();
    assert.ok('d' in posty[posty.length - 1].telo);
    assert.ok(!('r' in posty[posty.length - 1].telo));
    // Klimatizácia neodpovedá: nič sa nepošle.
    ticho = true;
    const pred = posty.length;
    casovace[0]();
    assert.equal(posty.length, pred);
    assert.ok(gety.every((u) => u.startsWith('http://10.10.10.148/')));
});

test('klimaSekcia: len pri Huawei Northbound; stav, správy a kroky v tóne', () => {
    const zaklad = {
        zdroj: { sposob: 'huawei-northbound' },
        now: new Date(NOW),
        site: { timezone: TZ },
        voice: /** @type {const} */ ('drzy'),
    };
    assert.equal(klimaSekcia({ ...zaklad, zdroj: { sposob: 'huawei-kiosk' } }), null);
    const nic = klimaSekcia(zaklad);
    assert.equal(nic?.stav.tone, 'wait');
    assert.equal(nic?.ip, '');
    assert.equal(nic?.sprava, null);
    assert.equal(nic?.kroky.length, KLIMA_NAST_TEXTS.kroky.length);
    const ok = klimaSekcia({
        ...zaklad,
        klima: { at: NOW - 60000 },
        klimaNast: { ip: '10.10.10.148' },
        klimaSkript: { stav: 'hotovo', text: 'x', schranka: false },
    });
    assert.equal(ok?.stav.tone, 'ok');
    assert.equal(ok?.stav.text, 'ozvala sa o 11:16');
    assert.equal(ok?.skript, 'x');
    assert.equal(ok?.sprava?.text, KLIMA_NAST_TEXTS.rucne[0]);
});

test('klimaSekcia: klimatizácia mlčí, chýba adresa, vykanie a príprava skriptu', () => {
    const zaklad = {
        zdroj: { sposob: 'huawei-northbound' },
        now: new Date(NOW),
        site: { timezone: TZ },
        voice: /** @type {const} */ ('slusny'),
    };
    const mlci = klimaSekcia({
        ...zaklad,
        voice: 'slusny',
        klima: { at: NOW - 2 * 86400000 },
        klimaSkript: { stav: 'adresa', text: '', schranka: false },
    });
    assert.equal(mlci?.stav.tone, 'stale');
    assert.equal(mlci?.stav.text, 'neozýva sa od 24. 11. 11:17');
    assert.equal(mlci?.sprava?.chyba, true);
    assert.equal(mlci?.tlacidlo, KLIMA_NAST_TEXTS.tlacidlo[1]);
    assert.equal(klimaSekcia({ ...zaklad, klimaSkript: { stav: 'robim', text: '', schranka: false } })?.robim, true);
});

test('klimaNastZ: adresa z úložiska, inak prázdna', () => {
    assert.deepEqual(klimaNastZ({ ip: '10.10.10.148' }), { ip: '10.10.10.148' });
    assert.deepEqual(klimaNastZ(null), { ip: '' });
    assert.deepEqual(klimaNastZ({ ip: 5 }), { ip: '' });
});
