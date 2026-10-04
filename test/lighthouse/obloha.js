// Meranie rýchlosti novej appky Lighthouse-om: Chromium z Playwrightu, emulácia mobilu so
// spomalenou sieťou a procesorom (predvolené nastavenie Lighthouse). Trikrát po sebe, vypíše
// medián. Do CI to zámerne nepatrí - z toho istého dôvodu ako snímky (CLAUDE.md, Ako overovať).
//
//   npm run lighthouse:obloha                        lokálne (spustí vlastný server)
//   npm run lighthouse:obloha -- https://…/obloha/   nasadená verzia
//
// Lokálny server hovorí HTTP/2 ako GitHub Pages. Pri HTTP/1.1 Lighthouse počíta najviac so 6
// spojeniami na server, čo appku bez bundlera (veľa malých modulov) trestá viac než skutočnosť.
// Certifikát si vyrobí openssl pri behu; bez neho meria cez HTTP/1.1 a povie to.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createSecureServer } from 'node:http2';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';

const LIGHTHOUSE = 'lighthouse@13.5.0';
const RUNS = Number(process.env.LH_RUNS) || 3;
const PORT = 8093;

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
};

/**
 * Lokálny server ako GitHub Pages: text posiela skomprimovaný (gzip). Bez toho by meranie
 * počítalo s niekoľkonásobne väčšími súbormi, než aké telefón naozaj sťahuje.
 */
/** Samopodpísaný certifikát na jeden deň; bez openssl null. */
function certificate() {
    try {
        const dir = mkdtempSync(join(tmpdir(), 'ray-mon-lh-'));
        const [key, cert] = [join(dir, 'key.pem'), join(dir, 'cert.pem')];
        const args = ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1'];
        execFileSync('openssl', [...args, '-keyout', key, '-out', cert], { stdio: 'ignore' });
        return { key: readFileSync(key), cert: readFileSync(cert) };
    } catch {
        return null;
    }
}

/** @param {{ key: Buffer, cert: Buffer } | null} tls */
function serve(tls) {
    /** @param {import('node:http').IncomingMessage | import('node:http2').Http2ServerRequest} req @param {any} res */
    const handler = async (req, res) => {
        const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
        const path = normalize(pathname.endsWith('/') ? `${pathname}index.html` : pathname);
        try {
            const body = await readFile(join('.', path));
            const type = TYPES[/** @type {keyof typeof TYPES} */ (extname(path))] ?? 'application/octet-stream';
            const gzip = /text|json|svg/.test(type);
            res.writeHead(200, { 'content-type': type, ...(gzip ? { 'content-encoding': 'gzip' } : {}) });
            res.end(gzip ? gzipSync(body) : body);
        } catch {
            res.writeHead(404).end();
        }
    };
    return tls ? createSecureServer({ ...tls, allowHTTP1: true }, handler) : createServer(handler);
}

const tls = process.argv[2] ? null : certificate();
if (!process.argv[2] && !tls) console.log('openssl chýba - meria sa cez HTTP/1.1 (Pages hovorí HTTP/2)');
const url = process.argv[2] ?? `${tls ? 'https' : 'http'}://127.0.0.1:${PORT}/obloha/`;
const server = process.argv[2] ? null : serve(tls);
if (server) await new Promise((done) => server.listen(PORT, '127.0.0.1', () => done(undefined)));

/**
 * Lighthouse ako samostatný proces. Čaká sa naň asynchrónne - server stránky beží v tomto
 * procese a pri zablokovanom čakaní by neodpovedal.
 * @param {string[]} args @returns {Promise<string>}
 */
function lighthouse(args) {
    return new Promise((resolve, reject) => {
        const child = spawn('npx', args, { shell: true });
        let out = '';
        let err = '';
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (err += d));
        child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`Lighthouse zlyhal:\n${err}`))));
    });
}

/** Jedno meranie: čísla, na ktorých záleží. */
async function measure() {
    const lhr = JSON.parse(
        await lighthouse([
            '-y',
            LIGHTHOUSE,
            url,
            '--only-categories=performance,accessibility',
            '--output=json',
            '--output-path=stdout',
            '--quiet',
            `--chrome-path="${chromium.executablePath()}"`,
            // Samopodpísaný certifikát lokálneho servera prehliadač inak odmietne.
            '--chrome-flags="--headless=new --ignore-certificate-errors"',
        ]),
    );
    // LH_REPORT=cesta.json uloží celú správu posledného merania (čo poskakuje, čo brzdí).
    if (process.env.LH_REPORT) await writeFile(process.env.LH_REPORT, JSON.stringify(lhr));
    const audit = (/** @type {string} */ id) => lhr.audits[id].numericValue;
    // Čo prehliadač stiahol pred prvým zobrazením obsahu (pozorované LCP, nie simulované): všetko, čo
    // začal sťahovať dovtedy. Neskoré moduly a dáta po vykreslení sa nerátajú.
    const lcpAt = lhr.audits.metrics.details.items[0].observedLargestContentfulPaint;
    /** @type {{ networkRequestTime: number, transferSize: number }[]} */
    const requests = lhr.audits['network-requests'].details.items.filter(
        (/** @type {{ networkRequestTime: number }} */ r) => r.networkRequestTime <= lcpAt,
    );
    return {
        files: requests.length,
        kb: requests.reduce((sum, r) => sum + r.transferSize, 0) / 1024,
        lcp: audit('largest-contentful-paint'),
        cls: audit('cumulative-layout-shift'),
        tbt: audit('total-blocking-time'),
        fcp: audit('first-contentful-paint'),
        perf: Math.round(lhr.categories.performance.score * 100),
        a11y: Math.round(lhr.categories.accessibility.score * 100),
    };
}

const runs = [];
for (let i = 0; i < RUNS; i++) {
    runs.push(await measure());
    process.stdout.write(`meranie ${i + 1}/${RUNS} hotové\n`);
}
server?.close();

/** @param {number[]} values */
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const pick = (/** @type {keyof (typeof runs)[number]} */ key) => median(runs.map((r) => r[key]));
console.log(`\n${url} - medián z ${RUNS} meraní (Lighthouse, mobil, spomalená sieť a procesor)`);
console.log(`LCP  ${(pick('lcp') / 1000).toFixed(2)} s   (cieľ pod 2,5 s)`);
console.log(`CLS  ${pick('cls').toFixed(3)}    (cieľ pod 0,1)`);
console.log(`TBT  ${Math.round(pick('tbt'))} ms   (náhrada INP v laboratóriu)`);
console.log(`FCP  ${(pick('fcp') / 1000).toFixed(2)} s`);
console.log(`Výkon ${pick('perf')} / 100, prístupnosť ${pick('a11y')} / 100`);
console.log(`Pred prvým zobrazením ${pick('files')} súborov, ${Math.round(pick('kb'))} kB`);
