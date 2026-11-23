// Skript do zásuvky Shelly (Plug M Gen3 a iné Gen2+) pre bojler na prebytky. Appka ho poskladá
// s adresou Workera, pečaťou zásuvky a prahmi a človek ho vloží do zásuvky (Skripty → Nový).
//
// Skript sa každú minútu opýta Workera (`/bojler`) a poslúchne. Keď Worker BOJLER.tichoMin minút
// neodpovedá, vypne - pri výpadku internetu bojler nepôjde zo siete. V ručnom režime (prepínač
// v appke, Worker pošle `rucne`) relé neprepína vôbec, ani pri tichu - len hlási stav. Jazyk
// skriptov Shelly je starší JavaScript: bez šípok, čiarok na konci a s telom HTTP.POST nikdy
// prázdnym (inak chyba -103, overené na zásuvke 15. 11. 2026).

import { BOJLER } from './config.js';

/** Pečať smie obsahovať len znaky base64url a bodky - nič, čo by vyskočilo z reťazca v skripte. */
const PECAT = /^[A-Za-z0-9._-]+$/;

/** Adresa teplomera v domácej sieti: IP alebo meno, nič iné (žiadna cesta, úvodzovky ani zavináč). */
const ADRESA_TEPLOMERA = /^[A-Za-z0-9][A-Za-z0-9.-]{0,62}$/;

/**
 * Adresa, na ktorej zásuvka prečíta teplotu, alebo null, keď adresa či heslo nesedí. Meno je vždy `admin` (Shelly Gen2+),
 * heslo ide do adresy zakódované - tak ho HTTP.GET v skripte použije aj na digest. Apostrof kódovanie nechá, preto zvlášť.
 * @param {{ ip: string, heslo: string }} t
 */
export function adresaTeplomera(t) {
    const ip = t.ip.trim();
    if (!ADRESA_TEPLOMERA.test(ip) || !t.heslo) return null;
    const heslo = encodeURIComponent(t.heslo).replace(/'/g, '%27');
    return `http://admin:${heslo}@${ip}/rpc/Temperature.GetStatus?id=${BOJLER.teplomerId}`;
}

/**
 * Funkcia, ktorá zásuvku nahlási Workerovi a poslúchne ho. S teplomerom dostane teplotu (`t`, null keď ju nemá).
 * @param {boolean} sTeplotou
 */
function hlasenie(sTeplotou) {
    return [
        sTeplotou ? 'function posli(t) {' : 'function krok() {',
        "    var sw = Shelly.getComponentStatus('switch', 0);",
        '    var telo = JSON.stringify({',
        '        pecat: PECAT,',
        '        rele: sw.output,',
        '        w: sw.apower,',
        '        e: sw.aenergy ? sw.aenergy.total : 0,',
        '        zapKw: ZAP,',
        ...(sTeplotou ? ['        vypKw: VYP,', '        t: t'] : ['        vypKw: VYP']),
        '    });',
        "    Shelly.call('HTTP.POST', { url: ADRESA, body: telo, timeout: 25 }, function (res, chyba) {",
        '        var zapni = null;',
        '        if (!chyba && res && res.code === 200) {',
        '            try {',
        '                var o = JSON.parse(res.body);',
        '                zapni = o.zapni === true;',
        '                rucne = o.rucne === true;',
        '            } catch (e) {',
        '                zapni = null;',
        '            }',
        '        }',
        '        if (zapni === null) {',
        '            ticho = ticho + 1;',
        '            if (ticho < TICHO || rucne) return;',
        '            zapni = false;',
        '        } else {',
        '            ticho = 0;',
        '        }',
        "        if (!rucne && zapni !== sw.output) Shelly.call('Switch.Set', { id: 0, on: zapni });",
        '    });',
        '}',
    ];
}

/** Krok s teplomerom: najprv teplota zo Shelly v domácej sieti, potom hlásenie - aj keď teplomer neodpovie. */
const KROK_S_TEPLOTOU = [
    'function krok() {',
    "    Shelly.call('HTTP.GET', { url: TEPLOMER, timeout: TEPLOMER_S }, function (res, chyba) {",
    '        var t = null;',
    '        if (!chyba && res && res.code === 200) {',
    '            try {',
    '                var o = JSON.parse(res.body);',
    "                if (typeof o.tC === 'number') t = o.tC;",
    '            } catch (e) {',
    '                t = null;',
    '            }',
    '        }',
    '        posli(t);',
    '    });',
    '}',
];

/**
 * Text skriptu, alebo null, keď pečať, adresa Workera či teplomer nie je v poriadku. Bez teplomera je skript
 * presne ten, aký bol pred ním (docs/navrhy/bojler-teplota.html, N2).
 * @param {{ url: string, pecat: string, zapKw: number, vypKw: number, teplomer?: { ip: string, heslo: string } | null }} v
 * @returns {string | null}
 */
export function skriptBojlera(v) {
    if (!PECAT.test(v.pecat) || !/^https:\/\/[^'"\\\s]+$/.test(v.url)) return null;
    const teplomer = v.teplomer ? adresaTeplomera(v.teplomer) : null;
    if (v.teplomer && !teplomer) return null;
    return [
        '// Bojler na prebytky (appka Živá obloha). Každú minútu sa opýta, či má bojler zapnúť,',
        `// a poslúchne. Keď ${BOJLER.tichoMin} minút nedostane odpoveď, vypne ho.`,
        '// V ručnom režime (prepínač v appke) bojler neprepína, len hlási, čo robí.',
        `// Prahy: zapni od ${v.zapKw} kW, vypni pod ${v.vypKw} kW prebytku. Zmeníš ich v appke.`,
        ...(teplomer ? ['// Teplotu vody si pred každým hlásením prečíta z teplomera Shelly v domácej sieti.'] : []),
        `var ADRESA = '${v.url}';`,
        `var PECAT = '${v.pecat}';`,
        `var ZAP = ${v.zapKw};`,
        `var VYP = ${v.vypKw};`,
        `var TICHO = ${BOJLER.tichoMin};`,
        ...(teplomer ? [`var TEPLOMER = '${teplomer}';`, `var TEPLOMER_S = ${BOJLER.teplomerS};`] : []),
        'var ticho = 0;',
        'var rucne = false;',
        '',
        ...(teplomer ? [...KROK_S_TEPLOTOU, '', ...hlasenie(true)] : hlasenie(false)),
        '',
        'Timer.set(60 * 1000, true, krok);',
        'krok();',
        '',
    ].join('\n');
}
