import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CHARS } from '../scripts/font-subset.js';

/** Súbory, z ktorých nová appka berie texty: obloha/, shared/ a neutrálne moduly vo web/ (nie web/render/). */
function sources() {
    /** @type {string[]} */
    const files = [];
    /** @param {string} dir @param {boolean} deep */
    const walk = (dir, deep) => {
        for (const name of readdirSync(dir)) {
            const path = join(dir, name);
            if (statSync(path).isDirectory()) {
                if (deep) walk(path, deep);
            } else if (/\.(js|html)$/.test(name)) files.push(path);
        }
    };
    walk('obloha', true);
    walk('shared', true);
    walk('web', false);
    return files;
}

test('písmo novej appky (fonts/archivo-obloha.woff2) má každý znak, ktorý appka píše', () => {
    const have = new Set(CHARS);
    /** @type {Map<string, string>} */
    const missing = new Map();
    for (const file of sources())
        for (const ch of readFileSync(file, 'utf8')) if (ch > '~' && !have.has(ch) && !missing.has(ch)) missing.set(ch, file);
    assert.deepEqual(
        [...missing].map(([ch, file]) => `${ch} (U+${ch.codePointAt(0)?.toString(16).toUpperCase()}) v ${file}`),
        [],
        'doplň znak do CHARS v scripts/font-subset.js a vyrob písmo znova (návod je v skripte)',
    );
});
