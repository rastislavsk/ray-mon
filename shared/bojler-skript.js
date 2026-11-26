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

/**
 * Adresa zariadenia v domácej sieti (teplomer, klimatizácia - shared/klima-skript.js): IP alebo meno, nič iné (žiadna
 * cesta, úvodzovky ani zavináč), aby nevyskočila z reťazca v skripte.
 */
export const ADRESA_V_SIETI = /^[A-Za-z0-9][A-Za-z0-9.-]{0,62}$/;

/**
 * Adresa, na ktorej zásuvka prečíta teplotu, alebo null, keď adresa či heslo nesedí. Meno je vždy `admin` (Shelly Gen2+),
 * heslo ide do adresy zakódované - tak ho HTTP.GET v skripte použije aj na digest. Apostrof kódovanie nechá, preto zvlášť.
 * @param {{ ip: string, heslo: string }} t
 */
export function adresaTeplomera(t) {
    const ip = t.ip.trim();
    if (!ADRESA_V_SIETI.test(ip) || !t.heslo) return null;
    const heslo = encodeURIComponent(t.heslo).replace(/'/g, '%27');
    return `http://admin:${heslo}@${ip}/rpc/Temperature.GetStatus?id=${BOJLER.teplomerId}`;
}

/** Bez Workera počká BOJLER.tichoMin minút a vypne, s ním poslúchne (v ručnom režime nikdy neprepína). */
const BEZ_HRANICE = [
    '        if (zapni === null) {',
    '            ticho = ticho + 1;',
    '            if (ticho < TICHO || rucne) return;',
    '            zapni = false;',
    '        } else {',
    '            ticho = 0;',
    '        }',
];

/**
 * S hranicou teploty (docs/navrhy/bojler-hranica.html): nahriatu vodu (`nad`) vypne hneď a nepustí, aj keď Worker povie
 * zapni, aj keď mlčí. V ručnom režime ani tak neprepína.
 */
const HRANICA_ROZHODNUTIE = [
    '        if (zapni === null) {',
    '            ticho = ticho + 1;',
    '            if (rucne) return;',
    '            if (ticho < TICHO && !nad) return;',
    '            zapni = false;',
    '        } else {',
    '            ticho = 0;',
    '            if (nad) zapni = false;',
    '        }',
];

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
        '        id: ID,',
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
        ...(sTeplotou
            ? [
                  "                maxC = typeof o.maxC === 'number' ? o.maxC : null;",
                  "                minC = typeof o.minC === 'number' ? o.minC : null;",
              ]
            : []),
        '            } catch (e) {',
        '                zapni = null;',
        '            }',
        '        }',
        ...(sTeplotou ? HRANICA_ROZHODNUTIE : BEZ_HRANICE),
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
    // To isté pravidlo ako strazVodu v shared/bojler-voda.js: od hranice nahriata, kým neklesne na minC.
    '        if (t === null || maxC === null) nad = false;',
    '        else if (t >= maxC) nad = true;',
    '        else if (t <= minC) nad = false;',
    '        posli(t);',
    '    });',
    '}',
];

/**
 * Text skriptu, alebo null, keď pečať, adresa Workera či teplomer nie je v poriadku. Skript sa vkladá do zásuvky
 * s bojlerom, nie do Shelly s teplomerom - hlásenie zariadenia bez merania príkonu Worker odmietne.
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
        ...(teplomer
            ? [
                  '// Teplotu vody si pred každým hlásením prečíta z teplomera Shelly v domácej sieti.',
                  '// Keď voda dosiahne hranicu nastavenú v appke, bojler vypne aj bez internetu.',
              ]
            : []),
        `var ADRESA = '${v.url}';`,
        `var PECAT = '${v.pecat}';`,
        `var ZAP = ${v.zapKw};`,
        `var VYP = ${v.vypKw};`,
        `var TICHO = ${BOJLER.tichoMin};`,
        ...(teplomer
            ? [
                  `var TEPLOMER = '${teplomer}';`,
                  `var TEPLOMER_S = ${BOJLER.teplomerS};`,
                  'var maxC = null;',
                  'var minC = null;',
                  'var nad = false;',
              ]
            : []),
        // Worker podľa ID prijíma hlásenia len od jednej zásuvky (docs/navrhy/bojler-jedno-zariadenie.html).
        'var ID = Shelly.getDeviceInfo().id;',
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
