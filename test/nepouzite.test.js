// Nepoužitý kód: export, ktorý nikto nepoužíva - ani iný súbor, ani testy, ani jeho vlastný súbor.
// Taký ostane, keď zmena prestane niečo používať a definíciu zabudne zmazať (texty Plánu dňa po #369).
// Export používaný len v testoch sa ráta ako použitý - mnohé funkcie sú exportované práve kvôli nim.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Kód appky a Workera, v ktorom sa hľadajú exporty. */
const PRODUKCIA = ['app.js', 'boot.js', 'sw.js', 'web', 'obloha', 'shared', 'worker/src'];
/** Kde sa hľadá použitie: všetko vlastné, s testami a skriptmi. */
const VSETKO = [...PRODUKCIA, 'test', 'scripts', 'worker/test'];

/** Súbory .js a .html v cestách (priečinky do hĺbky). @param {string[]} paths */
function files(paths) {
    /** @type {string[]} */
    const out = [];
    /** @param {string} path */
    const walk = (path) => {
        if (statSync(path).isDirectory()) readdirSync(path).forEach((name) => walk(join(path, name)));
        else if (/\.(js|html)$/.test(path)) out.push(path);
    };
    paths.forEach(walk);
    return out;
}

/** Zmienka v komentári nie je použitie. Typy v JSDoc ostávajú, tie kontroluje tsc. @param {string} src */
const bezKomentarov = (src) => src.replace(/\/\*(?![*\s]*@)[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

test('každý export appky a Workera niekto používa', () => {
    const texty = new Map(files(VSETKO).map((f) => [f, bezKomentarov(readFileSync(f, 'utf8'))]));
    /** @type {string[]} */
    const nepouzite = [];
    for (const file of files(PRODUKCIA).filter((f) => f.endsWith('.js'))) {
        const src = /** @type {string} */ (texty.get(file));
        for (const [, name] of src.matchAll(/^export (?:async )?(?:function\*?|const|let|class) (\w+)/gm)) {
            const slovo = new RegExp(`\\b${name}\\b`);
            const vSubore = (src.match(new RegExp(slovo, 'g')) ?? []).length > 1;
            if (!vSubore && ![...texty].some(([f, t]) => f !== file && slovo.test(t))) nepouzite.push(`${file}: ${name}`);
        }
    }
    assert.deepEqual(nepouzite, [], 'Nikto ich nepoužíva - zmaž ich, alebo ich začni používať.');
});
