// Graf importov produkčného kódu: žiadny kruh a doména (shared/) nikdy neimportuje appku.
// Kruhový import funguje, len kým sa obe strany volajú až za behu - prvá konštanta vypočítaná pri
// načítaní modulu ho zhodí chybou, ktorú je ťažké nájsť. Importy typov v komentároch JSDoc sa
// nerátajú, tie za behu neexistujú.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Súbory .js v priečinku aj pod ním, cesty od koreňa s lomkami. @param {string} dir @returns {string[]} */
function jsFiles(dir) {
    return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
        const path = posix.join(dir, e.name);
        if (e.isDirectory()) return e.name === 'node_modules' ? [] : jsFiles(path);
        return e.name.endsWith('.js') ? [path] : [];
    });
}

const FILES = ['app.js', 'boot.js', 'sw.js', ...jsFiles('web'), ...jsFiles('shared'), ...jsFiles('worker/src')];

/** Čo súbor importuje (staticky aj cez import()), bez komentárov. @param {string} file */
function importsOf(file) {
    const code = readFileSync(join(ROOT, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
    const found = [...code.matchAll(/(?:from\s+|import\s*\(\s*|^import\s+)['"](\.[^'"]+)['"]/gm)];
    return [...new Set(found.map((m) => posix.normalize(posix.join(posix.dirname(file), m[1].split('?')[0]))))];
}

const GRAPH = new Map(FILES.map((f) => [f, importsOf(f)]));

/** Kruh, ktorý vedie cez súbor, alebo null. @param {string} start */
function cycleFrom(start) {
    /** @type {Set<string>} */ const seen = new Set();
    /** @param {string} file @param {string[]} path @returns {string[] | null} */
    const walk = (file, path) => {
        for (const next of GRAPH.get(file) ?? []) {
            if (next === start) return [...path, next];
            if (seen.has(next)) continue;
            seen.add(next);
            const found = walk(next, [...path, next]);
            if (found) return found;
        }
        return null;
    };
    return walk(start, [start]);
}

test('graf importov: súbory sa našli a importy sa čítajú', () => {
    assert.ok(FILES.length > 100);
    assert.ok(GRAPH.get('app.js')?.includes('web/render/index.js'));
    assert.ok(GRAPH.get('web/parts.js')?.includes('web/part-sedem.js'), 'aj dynamický import()');
});

test('žiadny kruhový import', () => {
    const kruhy = FILES.map(cycleFrom).filter((c) => c !== null);
    assert.deepEqual(kruhy.map((c) => c.join(' → ')).slice(0, 3), []);
});

test('shared/ neimportuje appku ani Worker, Worker neimportuje appku', () => {
    for (const [file, imports] of GRAPH) {
        const mimo = imports.filter(
            (i) => (file.startsWith('shared/') && !i.startsWith('shared/')) || (file.startsWith('worker/') && i.startsWith('web/')),
        );
        assert.deepEqual(mimo, [], file);
    }
});
