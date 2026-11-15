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
 * Text skriptu, alebo null, keď pečať nie je v poriadku.
 * @param {{ url: string, pecat: string, zapKw: number, vypKw: number }} v
 * @returns {string | null}
 */
export function skriptBojlera(v) {
    if (!PECAT.test(v.pecat) || !/^https:\/\/[^'"\\\s]+$/.test(v.url)) return null;
    return [
        '// Bojler na prebytky (appka Živá obloha). Každú minútu sa opýta, či má bojler zapnúť,',
        `// a poslúchne. Keď ${BOJLER.tichoMin} minút nedostane odpoveď, vypne ho.`,
        '// V ručnom režime (prepínač v appke) bojler neprepína, len hlási, čo robí.',
        `// Prahy: zapni od ${v.zapKw} kW, vypni pod ${v.vypKw} kW prebytku. Zmeníš ich v appke.`,
        `var ADRESA = '${v.url}';`,
        `var PECAT = '${v.pecat}';`,
        `var ZAP = ${v.zapKw};`,
        `var VYP = ${v.vypKw};`,
        `var TICHO = ${BOJLER.tichoMin};`,
        'var ticho = 0;',
        'var rucne = false;',
        '',
        'function krok() {',
        "    var sw = Shelly.getComponentStatus('switch', 0);",
        '    var telo = JSON.stringify({',
        '        pecat: PECAT,',
        '        rele: sw.output,',
        '        w: sw.apower,',
        '        e: sw.aenergy ? sw.aenergy.total : 0,',
        '        zapKw: ZAP,',
        '        vypKw: VYP',
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
        '',
        'Timer.set(60 * 1000, true, krok);',
        'krok();',
        '',
    ].join('\n');
}
