// Spustí jednotkové testy v pásme Europe/Bratislava na každom systéme. Zápis TZ=… pred príkazom
// v package.json je syntax unixového shellu a cmd na Windows ho nepozná. Pásmo sa preto
// odovzdá podprocesu cez env a glob rozbalí `node --test` sám, nie shell.
import { spawnSync } from 'node:child_process';

const args = [
    '--test',
    '--experimental-test-coverage',
    '--test-coverage-include=shared/**',
    '--test-coverage-include=web/state.js',
    '--test-coverage-lines=90',
    'test/*.test.js',
    'worker/test/*.test.js',
];
const { status } = spawnSync(process.execPath, args, {
    stdio: 'inherit',
    env: { ...process.env, TZ: 'Europe/Bratislava' },
});
process.exit(status ?? 1);
