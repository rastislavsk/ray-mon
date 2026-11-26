// Skript na Shelly v domácej sieti pre klimatizáciu Daikin (docs/navrhy/klima-daikin.html, cesta A). Appka ho poskladá
// s adresou Workera, pečaťou (tá istá ako pre zásuvku bojlera, `/bojler-pecat`) a adresou adaptéra klimatizácie
// a človek ho vloží do Shelly (Skripty → Nový) - patrí do Shelly s teplomerom, nie do zásuvky bojlera.
//
// Skript sa každú minútu opýta adaptéra na stav a teploty, každých KLIMA.hodinyMin minút aj na energiu a každých
// KLIMA.rokMin na mesiace a Wi-Fi. Odpovede pošle Workeru tak, ako prišli - čítať ich vie shared/klima.js. Nič
// nenastavuje, len číta. Jazyk skriptov Shelly je starší JavaScript: bez šípok, čiarok na konci a HTTP.POST s neprázdnym
// telom (rovnako ako shared/bojler-skript.js).

import { KLIMA } from './config.js';
import { ADRESA_V_SIETI } from './bojler-skript.js';

/** Pečať smie obsahovať len znaky base64url a bodky - nič, čo by vyskočilo z reťazca v skripte. */
const PECAT = /^[A-Za-z0-9._-]+$/;

/**
 * Text skriptu, alebo null, keď pečať, adresa Workera či adresa klimatizácie nie je v poriadku.
 * @param {{ url: string, pecat: string, ip: string }} v
 * @returns {string | null}
 */
export function skriptKlimy(v) {
    const ip = v.ip.trim();
    if (!PECAT.test(v.pecat) || !/^https:\/\/[^'"\\\s]+$/.test(v.url) || !ADRESA_V_SIETI.test(ip)) return null;
    return [
        '// Klimatizácia Daikin (appka Ray-mon). Každú minútu si prečíta stav klimatizácie',
        '// v domácej sieti a pošle ho appke. Nič nenastavuje, len číta.',
        `var ADRESA = '${v.url}';`,
        `var PECAT = '${v.pecat}';`,
        `var KLIMA = 'http://${ip}';`,
        `var GET_S = ${KLIMA.getS};`,
        `var HODINY = ${KLIMA.hodinyMin};`,
        `var ROK = ${KLIMA.rokMin};`,
        'var ID = Shelly.getDeviceInfo().id;',
        'var krokov = 0;',
        'var bezi = false;',
        '',
        'function cesty() {',
        "    var c = [['s', '/aircon/get_sensor_info'], ['c', '/aircon/get_control_info']];",
        '    if (krokov % HODINY === 0) {',
        "        c.push(['d', '/aircon/get_day_power_ex']);",
        "        c.push(['w', '/aircon/get_week_power_ex']);",
        "        c.push(['t', '/aircon/get_week_power']);",
        '    }',
        '    if (krokov % ROK === 0) {',
        "        c.push(['r', '/aircon/get_year_power_ex']);",
        "        c.push(['b', '/common/basic_info']);",
        '    }',
        '    return c;',
        '}',
        '',
        'function posli(telo) {',
        '    bezi = false;',
        '    if (!telo.s || !telo.c) return;',
        "    Shelly.call('HTTP.POST', { url: ADRESA, body: JSON.stringify(telo), timeout: 25 }, function () {});",
        '}',
        '',
        'function dalsi(z, i, telo) {',
        '    if (i >= z.length) {',
        '        posli(telo);',
        '        return;',
        '    }',
        "    Shelly.call('HTTP.GET', { url: KLIMA + z[i][1], timeout: GET_S }, function (res, chyba) {",
        '        if (!chyba && res && res.code === 200) telo[z[i][0]] = res.body;',
        '        dalsi(z, i + 1, telo);',
        '    });',
        '}',
        '',
        'function krok() {',
        '    if (bezi) return;',
        '    bezi = true;',
        '    var z = cesty();',
        '    krokov = krokov + 1;',
        '    dalsi(z, 0, { pecat: PECAT, id: ID });',
        '}',
        '',
        'Timer.set(60 * 1000, true, krok);',
        'krok();',
        '',
    ].join('\n');
}
