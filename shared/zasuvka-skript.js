// Skript do zásuvky Shelly so spotrebičom (docs/navrhy/pracka-zasuvka.html, A + S2): práčka, sušička či umývačka. Appka
// ho poskladá s adresou Workera, pečaťou (tá istá ako pre zásuvku bojlera, `/bojler-pecat`) a spotrebičom a človek ho
// vloží do zásuvky (Skripty → Nový). Skript každú minútu pošle príkon a počítadlo energie, beh z nich rozozná Worker
// (shared/zasuvka.js). Relé nikdy neprepína - vypnutie by prerušilo pranie. Jazyk skriptov Shelly je starší JavaScript:
// bez šípok, čiarok na konci a HTTP.POST s neprázdnym telom (rovnako ako shared/bojler-skript.js).

import { MOZEM_ITEMS } from './config.js';
import { vecZasuvky } from './zasuvka.js';

/** Pečať smie obsahovať len znaky base64url a bodky - nič, čo by vyskočilo z reťazca v skripte. */
const PECAT = /^[A-Za-z0-9._-]+$/;

/**
 * Text skriptu, alebo null, keď pečať, adresa Workera či spotrebič nie je v poriadku.
 * @param {{ url: string, pecat: string, vec: string }} v
 * @returns {string | null}
 */
export function skriptZasuvky(v) {
    if (!PECAT.test(v.pecat) || !/^https:\/\/[^'"\\\s]+$/.test(v.url) || !vecZasuvky(v.vec)) return null;
    const meno = MOZEM_ITEMS.find((i) => i.id === v.vec)?.device ?? v.vec;
    return [
        `// ${meno} na zásuvke (appka Ray-mon). Každú minútu pošle appke, koľko spotrebič berie.`,
        '// Zásuvku nikdy nevypína ani nezapína.',
        `var ADRESA = '${v.url}';`,
        `var PECAT = '${v.pecat}';`,
        `var VEC = '${v.vec}';`,
        'var ID = Shelly.getDeviceInfo().id;',
        '',
        'function krok() {',
        "    var sw = Shelly.getComponentStatus('switch', 0);",
        '    var telo = JSON.stringify({',
        '        pecat: PECAT,',
        '        id: ID,',
        '        vec: VEC,',
        '        w: sw.apower,',
        '        e: sw.aenergy ? sw.aenergy.total : 0',
        '    });',
        "    Shelly.call('HTTP.POST', { url: ADRESA, body: telo, timeout: 25 }, function () {});",
        '}',
        '',
        'Timer.set(60 * 1000, true, krok);',
        'krok();',
        '',
    ].join('\n');
}
