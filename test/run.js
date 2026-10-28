// Spustí jednotkové testy v pásme Europe/Bratislava na každom systéme. Zápis TZ=… pred príkazom
// v package.json je syntax unixového shellu a cmd na Windows ho nepozná. Pásmo sa preto
// odovzdá podprocesu cez env a glob rozbalí `node --test` sám, nie shell.
//
// Prah pokrytia platí dvakrát: pre všetky súbory spolu (Node, --test-coverage-*) a pre každý
// súbor zvlášť (FILE_MIN nižšie). Súhrn by inak skryl nový modul bez testov medzi dobre
// pokrytými - tak sa kedysi stratil web/refresh.js s 55 % riadkov.
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Najmenšie pokrytie jedného súboru v percentách. Nižšie než súhrn, aby neťahalo každú vetvu parsera. */
const FILE_MIN = { lines: 85, branches: 75 };

const lcovPath = join(tmpdir(), `ray-mon-lcov-${process.pid}.info`);
const env = { ...process.env, TZ: 'Europe/Bratislava' };

const args = [
    '--test',
    '--experimental-test-coverage',
    '--test-coverage-include=shared/**',
    '--test-coverage-include=web/state.js',
    '--test-coverage-include=web/store.js',
    '--test-coverage-include=web/data.js',
    '--test-coverage-include=web/memo.js',
    '--test-coverage-include=web/refresh.js',
    '--test-coverage-include=obloha/web/state.js',
    '--test-coverage-lines=90',
    '--test-coverage-branches=90',
    // Výpis ako bez voľby (spec v termináli, inak tap) a k nemu lcov pre kontrolu po súboroch.
    `--test-reporter=${process.stdout.isTTY ? 'spec' : 'tap'}`,
    '--test-reporter-destination=stdout',
    '--test-reporter=lcov',
    `--test-reporter-destination=${lcovPath}`,
    'test/*.test.js',
    'worker/test/*.test.js',
];

/**
 * Súbory pod FILE_MIN z lcov výpisu.
 * @param {string} lcov @returns {string[]}
 */
function underMin(lcov) {
    return lcov
        .split('end_of_record')
        .map((rec) => {
            const num = (/** @type {string} */ key) => Number(rec.match(new RegExp(`^${key}:(\\d+)`, 'm'))?.[1] ?? 0);
            const pct = (/** @type {number} */ hit, /** @type {number} */ all) => (all ? (100 * hit) / all : 100);
            return { file: rec.match(/^SF:(.+)$/m)?.[1], lines: pct(num('LH'), num('LF')), branches: pct(num('BRH'), num('BRF')) };
        })
        .filter((f) => f.file && (f.lines < FILE_MIN.lines || f.branches < FILE_MIN.branches))
        .map((f) => `${f.file}: riadky ${f.lines.toFixed(1)} %, vetvy ${f.branches.toFixed(1)} %`);
}

const main = spawnSync(process.execPath, args, { stdio: 'inherit', env });
let status = main.status ?? 1;
try {
    const low = underMin(readFileSync(lcovPath, 'utf8'));
    if (low.length) {
        console.error(`\nPokrytie pod ${FILE_MIN.lines} % riadkov alebo ${FILE_MIN.branches} % vetiev v súbore:\n  ${low.join('\n  ')}`);
        status = status || 1;
    }
} catch {
    // Bez lcov (testy spadli skôr, než ho Node zapísal) hovorí výsledok behu sám.
} finally {
    rmSync(lcovPath, { force: true });
}

// Testy, ktoré načítajú ten istý modul viackrát (nové otvorenie appky), pokazia meranie pokrytia
// v celom behu - bežia preto zvlášť, bez neho.
const solo = spawnSync(process.execPath, ['--test', 'test/bez-pokrytia/*.test.js'], { stdio: 'inherit', env });
process.exit(status || (solo.status ?? 1));
