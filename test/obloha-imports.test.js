// Jadro novej appky sa sťahuje v jednej vlne: obloha/app.js importuje priamo každý modul, ktorý
// jadro potrebuje, aj ten, ktorý sám nevolá. Bez build kroku je každá úroveň importov jedna otáčka
// siete navyše - prehliadač o module zistí, až keď stiahne ten, ktorý ho importuje. Tento test drží
// zoznam v app.js zhodný so skutočným stromom importov: chýbajúci modul by sa sťahoval neskôr,
// nadbytočný zbytočne.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, posix, relative, resolve } from 'node:path';

const APP = resolve('obloha/app.js');

/** Statické importy súboru: s menami (`import { a } from`, `export … from`) a holé (`import '…'`). @param {string} file */
function importsOf(file) {
    const src = readFileSync(file, 'utf8');
    /** @param {RegExp} re */
    const all = (re) => [...src.matchAll(re)].map((m) => resolve(dirname(file), m[1]));
    return {
        named: all(/^\s*(?:import|export)\s[^;'"]*?\sfrom\s*['"](\.[^'"]+)['"]/gm),
        bare: all(/^\s*import\s*['"](\.[^'"]+)['"]/gm),
    };
}

/** Moduly, ktoré jadro naozaj používa: z app.js len importy s menami, ďalej všetky statické. */
function coreModules() {
    const seen = new Set();
    const queue = importsOf(APP).named;
    while (queue.length) {
        const file = /** @type {string} */ (queue.shift());
        if (seen.has(file)) continue;
        seen.add(file);
        const { named, bare } = importsOf(file);
        queue.push(...named, ...bare);
    }
    return seen;
}

/** Cesta tak, ako sa píše v importe v app.js. @param {string} file */
const spec = (file) => {
    const rel = relative(dirname(APP), file).split(/[\\/]/).join(posix.sep);
    return rel.startsWith('.') ? rel : `./${rel}`;
};

test('obloha/app.js importuje priamo každý modul jadra (jedna vlna sťahovania)', () => {
    const { named, bare } = importsOf(APP);
    const expected = [...coreModules()].filter((f) => !named.includes(f)).map(spec);
    const listed = bare.map(spec);
    const missing = expected.filter((s) => !listed.includes(s));
    const extra = listed.filter((s) => !expected.includes(s));
    assert.deepEqual(missing, [], `doplň do obloha/app.js:\n${missing.map((s) => `import '${s}';`).join('\n')}`);
    assert.deepEqual(extra, [], 'jadro tieto moduly už nepoužíva, z obloha/app.js ich vyhoď');
});

test('neskoré karty (part-*.js) ostávajú mimo jadra', () => {
    const core = [...coreModules()].map(spec);
    assert.ok(core.length > 10, 'strom importov sa nenačítal');
    assert.deepEqual(
        core.filter((s) => /part-|render\/(sedem|statistika|poster|nastavenie|sprievodca)\.js$/.test(s)),
        [],
    );
});
