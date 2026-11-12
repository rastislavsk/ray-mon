// Content-Security-Policy v index.html: čo appka načítava a kam sa pripája, musí byť povolené -
// inak nová adresa v shared/config.js prejde testami (tie sieť podvrhujú) a zlyhá až v prehliadači.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { geocodeUrl, openMeteoUrl, RADAR, radarModelUrl, SITE, WORKER_URL } from '../shared/config.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const content = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? '';
/** @type {Record<string, string[]>} */
const csp = Object.fromEntries(
    content
        .split(';')
        .map((d) => d.trim().split(/\s+/))
        .map(([name, ...values]) => [name, values]),
);
const origin = (/** @type {string} */ url) => new URL(url).origin;

test('CSP: stránka ju má a skripty smú byť len vlastné a z cdnjs, nič vložené', () => {
    assert.deepEqual(csp['default-src'], ["'self'"]);
    assert.deepEqual(csp['script-src'], ["'self'", 'https://cdnjs.cloudflare.com']);
    assert.deepEqual(csp['object-src'], ["'none'"]);
    assert.deepEqual(csp['base-uri'], ["'none'"]);
    assert.ok(!content.includes("'unsafe-eval'"));
    // Vložené štýly len v atribúte `style` (grafy), nie v značke <style>.
    assert.ok(!csp['style-src'].includes("'unsafe-inline'"));
    assert.equal(/<script(?![^>]*\bsrc=)[^>]*>/.test(html), false, 'skript vložený v HTML by CSP zastavila');
    assert.equal(/<style[\s>]/.test(html), false, 'značku <style> by CSP zastavila');
    assert.equal(/\son[a-z]+="/.test(html), false, 'obsluhu udalosti v atribúte by CSP zastavila');
});

test('CSP: každá adresa, z ktorej appka číta dáta, je v connect-src', () => {
    const adresy = [WORKER_URL, openMeteoUrl(SITE), geocodeUrl('Dvorany'), RADAR.styl, radarModelUrl([{ lat: 48, lon: 17 }])];
    for (const url of adresy) assert.ok(csp['connect-src'].includes(origin(url)), `connect-src nepovoľuje ${origin(url)}`);
});

test('CSP: knižnice z CDN (QR kód, mapa) sú povolené ako skript aj štýl', () => {
    const skripty = [...html.matchAll(/<script[^>]*\bsrc="(https:[^"]+)"/g)].map((m) => m[1]);
    assert.equal(skripty.length, 1, 'jediný cudzí skript v HTML je QR kód');
    for (const url of [...skripty, RADAR.maplibre.js]) assert.ok(csp['script-src'].includes(origin(url)), url);
    assert.ok(csp['style-src'].includes(origin(RADAR.maplibre.css)));
    // MapLibre spúšťa vlastný Web Worker z adresy blob: a obrázky značiek kreslí z data: a blob:.
    assert.ok(csp['worker-src'].includes('blob:'));
    assert.ok(csp['img-src'].includes('blob:') && csp['img-src'].includes('data:'));
});
