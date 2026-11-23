import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HLASKA_DNA, PLAN_DNA, PLANT, SITE, TARIFF } from '../shared/config.js';
import { dniHlasky, hlaskaDna } from '../shared/den-hlaska.js';
import { terazHlaskaText } from '../shared/messages.js';
import { FIXED_NOW, fixtureData } from './helpers.js';

/** @typedef {import('../shared/den-hlaska.js').DenHlasky} DenHlasky */

/** Deň pre hlášku: predvolene dobrý, bez zrážok, teplo. @param {Partial<DenHlasky>} [d] @returns {DenHlasky} */
const den = (d = {}) => ({ cls: 'dobry', kwh: 10, svetlo: 10, dazd: 0, sneh: 0, tempMaxC: 15, ...d });
const NANIC = den({ cls: 'nanic', kwh: 1 });

test('hláška dňa: bez novej veci trieda dňa', () => {
    const dni = [den({ kwh: 20 }), den(), den({ cls: 'slaby', kwh: 5 }), NANIC];
    assert.deepEqual(hlaskaDna(dni, 1), { druh: 'trieda', cls: 'dobry', pocet: 0 });
    assert.deepEqual(hlaskaDna(dni, 2), { druh: 'trieda', cls: 'slaby', pocet: 0 });
    // Jeden deň bez slnka na konci nie je „posledné slnko“ ani „konečne“.
    assert.equal(hlaskaDna(dni, 3).druh, 'trieda');
});

test('hláška dňa: najlepší deň týždňa len silný a len prvý s najviac kWh', () => {
    assert.equal(hlaskaDna([den(), den({ kwh: 30 }), den({ kwh: 30 })], 1).druh, 'najlepsi');
    assert.equal(hlaskaDna([den(), den({ kwh: 30 }), den({ kwh: 30 })], 2).druh, 'trieda');
    // Dnes je najlepší - iný deň ním byť nemôže.
    assert.equal(hlaskaDna([den({ kwh: 40 }), den({ kwh: 30 })], 1).druh, 'trieda');
    // Slabý deň s najviac kWh (celý týždeň slabý) najlepší nie je.
    assert.equal(hlaskaDna([den({ cls: 'slaby' }), den({ cls: 'slaby', kwh: 12 })], 1).druh, 'trieda');
});

test('hláška dňa: posledné slnko a konečne slnko podľa dní bez slnka okolo', () => {
    const po = [den({ kwh: 20 }), den(), NANIC, NANIC, NANIC];
    assert.deepEqual(hlaskaDna(po, 1), { druh: 'posledne', cls: 'dobry', pocet: 3 });
    const pred = [NANIC, NANIC, den({ cls: 'slaby' }), den({ kwh: 20 })];
    assert.deepEqual(hlaskaDna(pred, 2), { druh: 'konecne', cls: 'slaby', pocet: 2 });
    // Menej ako HLASKA_DNA.bezDni dní bez slnka nestačí.
    assert.equal(HLASKA_DNA.bezDni, 2);
    assert.equal(hlaskaDna([den({ kwh: 20 }), den(), NANIC, den()], 1).druh, 'trieda');
    // Najlepší deň má prednosť pred posledným slnkom.
    assert.equal(hlaskaDna([den(), den({ kwh: 30 }), NANIC, NANIC], 1).druh, 'najlepsi');
});

test('hláška dňa: dážď, sneh a mráz', () => {
    const dni = (/** @type {Partial<DenHlasky>} */ d) => [den({ kwh: 50 }), den(d)];
    assert.equal(hlaskaDna(dni({ dazd: 8 }), 1).druh, 'prsi');
    // Dážď len poobede (polovica hodín svetla) nie je „celý deň“.
    assert.equal(hlaskaDna(dni({ dazd: 7 }), 1).druh, 'trieda');
    assert.equal(hlaskaDna(dni({ svetlo: 0, dazd: 0 }), 1).druh, 'trieda');
    assert.equal(hlaskaDna(dni({ cls: 'nanic', dazd: 9 }), 1).druh, 'prsi');
    assert.equal(hlaskaDna(dni({ sneh: 2 }), 1).druh, 'sneh');
    assert.equal(hlaskaDna(dni({ sneh: 1 }), 1).druh, 'trieda');
    assert.equal(hlaskaDna(dni({ tempMaxC: 3 }), 1).druh, 'mraz');
    assert.equal(hlaskaDna(dni({ tempMaxC: 3.5 }), 1).druh, 'trieda');
    assert.equal(hlaskaDna(dni({ tempMaxC: null }), 1).druh, 'trieda');
    // Mráz len v silný deň - v slabý panely veľa nedajú.
    assert.equal(hlaskaDna(dni({ cls: 'slaby', tempMaxC: -2 }), 1).druh, 'trieda');
});

test('hláška dňa: texty v oboch tónoch, nové veci rovnaké, trieda sa líši', () => {
    /** @param {Partial<import('../shared/den-hlaska.js').Hlaska>} h @param {'drzy' | 'slusny'} [voice] */
    const t = (h, voice) => terazHlaskaText({ druh: 'trieda', cls: 'dobry', pocet: 0, ...h }, voice);
    assert.equal(t({ druh: 'najlepsi' }), 'Najlepší deň týždňa.');
    assert.equal(t({ druh: 'posledne', pocet: 2 }), 'Posledné slnko, potom 2 dni bez.');
    assert.equal(t({ druh: 'posledne', pocet: 5 }, 'slusny'), 'Posledné slnko, potom 5 dní bez.');
    assert.equal(t({ druh: 'konecne', pocet: 3 }), 'Konečne slnko, po 3 dňoch.');
    assert.equal(t({ druh: 'prsi' }), 'Prší celý deň.');
    assert.equal(t({ druh: 'sneh' }), 'Sneží, panely môžu zapadnúť.');
    assert.equal(t({ druh: 'mraz' }), 'Mráz a jasno, panely to majú radi.');
    assert.equal(t({ cls: 'vyborny' }), 'Slnko utiahne všetko.');
    assert.equal(t({ cls: 'dobry' }), 'Na veľké veci to stačí.');
    assert.equal(t({ cls: 'slaby' }), 'Slnko len na chvíľu.');
    assert.equal(t({ cls: 'nanic' }), 'Zamračené, veľké veci zo siete.');
    assert.equal(t({ cls: 'dobry' }, 'slusny'), 'Slnka bude na veľké veci dosť.');
    assert.equal(t({ cls: 'slaby' }, 'slusny'), 'Slnka bude len na chvíľu.');
    assert.equal(t({ cls: 'nanic' }, 'slusny'), 'Zamračené, veľké veci pôjdu zo siete.');
});

test('dniHlasky: každý deň predpovede s triedou, kWh, hodinami svetla, zrážok a teplotou', () => {
    const { forecast } = fixtureData(FIXED_NOW);
    // Druhý deň: dážď v troch hodinách svetla a sneh v jednej, noc s dažďom sa nepočíta.
    const hourly = forecast.days[1].hourly.map((h, i) => {
        const svieti = h.clearKw > 0;
        const prvy = forecast.days[1].hourly.findIndex((x) => x.clearKw > 0);
        if (svieti && i < prvy + 3) return { ...h, precip: /** @type {const} */ ('dazd'), mm: 1 };
        if (svieti && i === prvy + 3) return { ...h, precip: /** @type {const} */ ('sneh') };
        if (!svieti) return { ...h, precip: /** @type {const} */ ('dazd'), mm: 1 };
        return h;
    });
    const input = {
        now: FIXED_NOW,
        site: SITE,
        plant: PLANT,
        tariff: TARIFF,
        pv: null,
        forecast: { ...forecast, days: forecast.days.map((d, i) => (i === 1 ? { ...d, hourly } : d)) },
    };
    const dni = dniHlasky(input, PLAN_DNA.devices);
    assert.equal(dni.length, forecast.days.length);
    assert.ok(dni.every((d, i) => d.kwh === forecast.days[i].kwhTotal && d.tempMaxC === forecast.days[i].tempMaxC));
    assert.ok(dni.every((d) => d.svetlo > 6 && d.svetlo < 20));
    assert.deepEqual([dni[1].dazd, dni[1].sneh], [3, 1]);
    assert.ok(dni.every((d) => ['vyborny', 'dobry', 'slaby', 'nanic'].includes(d.cls)));
});
