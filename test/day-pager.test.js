// Listovanie dní v detaile dňa (shared/day-pager.js): kedy je ťah listovaním, gumička na kraji,
// kam pás po pustení dobehne a ako dlho. Čísla sú z DAY_PAGER, test ich neopakuje natvrdo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_PAGER } from '../shared/config.js';
import { pagerAxis, pagerOffset, pagerSettleMs, pagerTarget, pagerVelocity } from '../shared/day-pager.js';

const W = 400;
const both = { prev: true, next: true };

test('pagerAxis: pod prahom nerozhodne, potom vodorovne listuje a šikmo-zvislo scrolluje', () => {
    assert.equal(pagerAxis(DAY_PAGER.lockPx - 1, 0), null);
    assert.equal(pagerAxis(-20, 4), 'x');
    assert.equal(pagerAxis(12, 12), 'y', 'šikmý pohyb je scroll');
    assert.equal(pagerAxis(2, -30), 'y');
});

test('pagerOffset: kým je kam listovať, ide pás 1:1 za prstom', () => {
    assert.equal(pagerOffset(-150, W, both), -150);
    assert.equal(pagerOffset(150, W, both), 150);
});

test('pagerOffset: na prvom a poslednom dni sa pás len poddá, najviac o rubberMax šírky', () => {
    const vpravo = pagerOffset(300, W, { prev: false, next: true });
    assert.ok(vpravo > 0 && vpravo < 300, 'gumička tlmí');
    assert.ok(pagerOffset(3000, W, { prev: false, next: true }) <= DAY_PAGER.rubberMax * W);
    const vlavo = pagerOffset(-300, W, { prev: true, next: false });
    assert.ok(vlavo < 0 && vlavo > -300);
    assert.ok(pagerOffset(-80, W, { prev: true, next: false }) > -80, 'aj krátky ťah na kraji sa tlmí');
});

test('pagerOffset: za susedným dňom sa ďalej neťahá - pás sa poddá ako na kraji', () => {
    const step = W + DAY_PAGER.gapPx;
    const o = pagerOffset(-(step + 300), W, both);
    assert.ok(o < -step && o >= -step - DAY_PAGER.rubberMax * W);
});

test('pagerVelocity: z posledných velocityMs ťahu, bez vzoriek nula', () => {
    assert.equal(pagerVelocity([]), 0);
    assert.equal(pagerVelocity([{ t: 0, x: 100 }]), 0);
    const v = pagerVelocity([
        { t: 0, x: 300 },
        { t: 500, x: 290 },
        { t: 540, x: 250 },
        { t: 560, x: 230 },
    ]);
    // Pomalý začiatok sa nepočíta, len posledných 80 ms.
    assert.equal(v, (230 - 290) / 60);
    assert.equal(
        pagerVelocity([
            { t: 0, x: 0 },
            { t: 400, x: 40 },
        ]),
        0.1,
        's dvoma vzorkami ďaleko od seba berie aj tie',
    );
});

test('pagerTarget: za prahom commit sa listuje, pod ním pás ostane', () => {
    assert.equal(pagerTarget(-(DAY_PAGER.commit * W + 1), 0, W, both), 1);
    assert.equal(pagerTarget(DAY_PAGER.commit * W + 1, 0, W, both), -1);
    assert.equal(pagerTarget(-(DAY_PAGER.commit * W - 1), 0, W, both), 0);
});

test('pagerTarget: rýchly švih prelistuje aj pod prahom, švih späť ťah zruší', () => {
    const svih = DAY_PAGER.flickPxMs + 0.1;
    assert.equal(pagerTarget(-40, -svih, W, both), 1);
    assert.equal(pagerTarget(40, svih, W, both), -1);
    assert.equal(pagerTarget(-(DAY_PAGER.commit * W + 50), svih, W, both), 0, 'švih späť ruší aj ťah za prahom');
});

test('pagerTarget: na kraji nikam', () => {
    assert.equal(pagerTarget(-W, -2, W, { prev: true, next: false }), 0);
    assert.equal(pagerTarget(W, 2, W, { prev: false, next: true }), 0);
});

test('pagerSettleMs: kratšia dráha, kratší dojazd, v hraniciach minMs a maxMs', () => {
    assert.equal(pagerSettleMs(0, W), DAY_PAGER.minMs);
    assert.equal(pagerSettleMs(-W, W), DAY_PAGER.maxMs);
    assert.equal(pagerSettleMs(5 * W, W), DAY_PAGER.maxMs);
    assert.ok(pagerSettleMs(W / 2, W) > DAY_PAGER.minMs && pagerSettleMs(W / 2, W) < DAY_PAGER.maxMs);
    assert.equal(pagerSettleMs(100, 0), DAY_PAGER.maxMs, 'bez šírky celý dojazd');
});
