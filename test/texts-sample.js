// Vzorka všetkých textov, ktoré appky hovoria: modely kariet v rôznych chvíľach dňa a stavoch
// (s meraním, bez neho, typická strecha, bez dát, načítava sa) a priame volania textových
// funkcií pre vetvy, na ktoré modely v jednom dni nenarazia. Z drzej vzorky je zamknutý súbor
// test/golden/texty-drzy.json (texts.test.js) - dôkaz, že drzé texty sa nezmenili ani o písmeno.
// Zo slušnej sa skladá tabuľka do popisu pull requestu.

import { carbonFacts } from '../shared/carbon.js';
import { MOZEM_ITEMS, PLANT, powerThresholds, PRICE_LEVELS, SITE, TARIFF } from '../shared/config.js';
import { heroModel } from '../shared/hero-model.js';
import * as M from '../shared/messages.js';
import { mozemModel } from '../shared/mozem.js';
import { mozemSkyModel } from '../shared/mozem-sky.js';
import { sedemDayModel, sedemModel, sedemWeekModel } from '../shared/sedem-dni.js';
import { typicalSettings } from '../shared/settings.js';
import { statistikaModel } from '../shared/statistika.js';
import { STATS_PERIODS } from '../shared/stats.js';
import { summaryModel } from '../shared/summary.js';
import { dnesCards, terazModel } from '../shared/teraz.js';
import { fixtureData, pvAt } from './helpers.js';

/** Miestny čas 5. 9. 2026 v Bratislave. @param {string} hm */
const at = (hm) => new Date(`2026-09-05T${hm}:00+02:00`);
const TIMES = ['05:30', '08:00', '10:00', '13:00', '16:30', '19:00', '22:30'];
const PRICED = { ...TARIFF, bands: TARIFF.bands.map((b) => ({ ...b, price: b.id === 'nt' ? 0.14 : 0.19 })) };
const LOG = { '2026-08-20': 40, '2026-09-01': 20, '2026-09-03': 35.5, '2026-09-04': 12 };

/** Len texty z modelu: reťazce s písmenom, bez geometrie grafov (cesty SVG). @param {unknown} v @param {string} path @param {Record<string, string>} out */
function strings(v, path, out) {
    if (typeof v === 'string') {
        if (/\p{L}/u.test(v) && !/^[MLC]\s?-?\d/.test(v)) out[path] = v;
    } else if (Array.isArray(v)) v.forEach((x, i) => strings(x, `${path}[${i}]`, out));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) strings(x, path ? `${path}.${k}` : k, out);
    return out;
}

/** Vstupy kariet v danej chvíli. @param {Date} now */
function inputs(now) {
    const { forecast } = fixtureData(now);
    const base = { now, site: SITE, plant: PLANT, tariff: PRICED, loading: false, previewMinutes: null, dayLog: LOG };
    const typical = typicalSettings(SITE);
    return {
        kiosk: {
            ...base,
            zdroj: { sposob: 'huawei-kiosk', pecat: 'v1.test-pecat-0123456789', nazov: '' },
            known: 'elektraren',
            pv: pvAt(now),
            forecast,
        },
        bezKiosku: { ...base, tariff: TARIFF, zdroj: null, known: 'elektraren', pv: null, forecast },
        typicka: { ...base, ...typical, known: 'poloha', pv: null, forecast },
        nic: { ...base, zdroj: null, known: 'nic', pv: null, forecast: null },
        nacitava: {
            ...base,
            zdroj: { sposob: 'huawei-kiosk', pecat: 'v1.test-pecat-0123456789', nazov: '' },
            known: 'elektraren',
            pv: null,
            forecast: null,
            loading: true,
        },
        bezDat: {
            ...base,
            zdroj: { sposob: 'huawei-kiosk', pecat: 'v1.test-pecat-0123456789', nazov: '' },
            known: 'elektraren',
            pv: null,
            forecast: null,
        },
    };
}

/**
 * Všetky texty v danom tóne. Bez `voice` volá funkcie bez neho - tak, ako ich volá súčasná appka.
 * @param {import('../shared/messages.js').Voice} [voice]
 */
export function sampleTexts(voice) {
    /** @type {Record<string, string>} */ const out = {};
    const v = voice;
    for (const hm of TIMES) {
        const now = at(hm);
        for (const [name, input] of Object.entries(inputs(now))) {
            const p = `${hm}.${name}`;
            const i = /** @type {any} */ (input);
            strings(mozemModel(i, { voice: v }), `${p}.mozem`, out);
            // Pás odporúčaní karty Dnes.
            if (i.forecast) strings(dnesCards({ ...i, previewMinutes: null }, v), `${p}.dnesCards`, out);
            for (const online of [true, false]) {
                const o = `${p}.${online ? 'online' : 'offline'}`;
                strings(mozemSkyModel(i, { online, voice: v }), `${o}.mozemSky`, out);
                strings(terazModel(i, { online, voice: v }), `${o}.teraz`, out);
                strings(sedemModel(i, { online, voice: v }), `${o}.sedem`, out);
                for (const period of STATS_PERIODS) strings(statistikaModel(i, period, { online, voice: v }), `${o}.stats.${period}`, out);
            }
            if (i.forecast) {
                strings(heroModel(i, v), `${p}.hero`, out);
                strings(heroModel({ ...i, previewMinutes: 600 }, v), `${p}.heroPreview`, out);
                strings(terazModel({ ...i, previewMinutes: 840 }, { voice: v }), `${p}.terazPreview`, out);
                i.forecast.days.forEach((/** @type {unknown} */ _, /** @type {number} */ d) =>
                    strings(sedemDayModel(i, d, v), `${p}.day${d}`, out),
                );
                strings(sedemWeekModel(i, v), `${p}.week`, out);
            }
            for (const period of STATS_PERIODS) strings(summaryModel(i, period, v), `${p}.summary.${period}`, out);
        }
    }
    direct(out, v);
    return out;
}

/** Vetvy textových funkcií, ktoré modely v jednom dni neukážu. @param {Record<string, string>} out @param {import('../shared/messages.js').Voice} [v] */
function direct(out, v) {
    directDay(out, v);
    directItems(out, v);
    directPlan(out, v);
    directMisc(out, v);
    directConsts(out, v);
}

/** Odporúčania a hlášky dňa. @param {Record<string, string>} out @param {import('../shared/messages.js').Voice} [v] */
function directDay(out, v) {
    const th = powerThresholds(PLANT);
    for (const level of PRICE_LEVELS) {
        for (const kw of [0.5, 3, 6]) {
            for (const [f, forecast] of Object.entries({
                nic: null,
                silnejsie: { strongerWindowAhead: true, windowDaypart: 'poobede', tomorrowSunny: false },
                zajtraSlnko: { tomorrowSunny: true },
                zajtraNie: { tomorrowSunny: false },
            }))
                strings(M.getSlotMessage(level, kw, forecast, th, v), `slot.${level}.${kw}.${f}`, out);
        }
    }
    const pts = [
        { hour: 8, kw: 1 },
        { hour: 11, kw: 4 },
        { hour: 13, kw: 6 },
        { hour: 15, kw: 4.5 },
        { hour: 18, kw: 1 },
    ];
    const weak = [{ hour: 12, kw: 0.8 }];
    strings(M.dayDetailMessage(pts, th, v), 'dayDetail.silny', out);
    strings(M.dayDetailMessage(weak, th, v), 'dayDetail.slaby', out);
    strings(M.sedemDayMessage(pts, th, false, v), 'sedemDay.bezOkna', out);
    strings(M.EMPTY_MESSAGES, 'empty', out);
}

/** Veci karty Môžem? a ich zápis. @param {Record<string, string>} out @param {import('../shared/messages.js').Voice} [v] */
function directItems(out, v) {
    // Veci karty Môžem? pri každej odpovedi, s cenou aj bez nej, v drahom pásme aj mimo neho.
    const day = { name: 'Zajtra', index: 1, start: 660 };
    const later = { name: 'Pondelok', index: 3, start: 600 };
    /** @type {Array<[string, import('../shared/mozem.js').Answer]>} */
    const answers = [
        ['goAuto', { kind: 'go', end: 900, until: 900, km: 40 }],
        ['goAutoBezKm', { kind: 'go', end: 900, until: 900, km: 0 }],
        ['goDo', { kind: 'go', end: 900, until: 800, km: null }],
        ['goHned', { kind: 'go', end: 900, until: 700, km: null }],
        ['wait', { kind: 'wait', start: 720 }],
        ['cheap', { kind: 'cheap', next: day }],
        ['cheapBez', { kind: 'cheap', next: null }],
        ['zajtra', { kind: 'later', day, weakSkipped: false }],
        ['neskor', { kind: 'later', day: later, weakSkipped: true }],
        ['none', { kind: 'none' }],
        ['unk', { kind: 'unk' }],
    ];
    for (const item of MOZEM_ITEMS)
        for (const [k, a] of answers)
            for (const draha of [true, false])
                for (const cost of [null, 0.19]) {
                    const ctx = /** @type {any} */ ({ nowMin: 750, draha, currency: '€' });
                    strings(M.mozemItemText(item, a, { ctx, cost }, v), `item.${item.id}.${k}.${draha}.${cost}`, out);
                }
    for (const [k, a] of answers) {
        out[`tile.${k}`] = M.mozemTileValue(a, 'krátka');
        out[`tileNote.${k}`] = M.mozemTileNote(a) || '(prázdne)';
    }
    out['tileNote.km'] = M.mozemTileNote({ kind: 'go', end: 900, until: 900, km: 60 });
    // Dlaždica podľa riadku Plánu dňa: každý druh riadku, auto s km.
    /** @type {Array<[string, any]>} */ const rows = [
        ['teraz', { id: 'pracka', kind: 'sun', start: 600, end: 720, km: null, now: true, time: '10:00', tone: 'go' }],
        ['autoTeraz', { id: 'auto', kind: 'sun', start: 600, end: 900, km: 120, now: true, time: '10:00–15:00', tone: 'go' }],
        ['neskor', { id: 'auto', kind: 'sun', start: 660, end: 900, km: 90, now: false, time: '11:00–15:00', tone: 'go' }],
        ['lacno', { id: 'auto', kind: 'cheap', start: 1320, now: false, time: 'od 22:00', tone: 'cheap' }],
        ['inyDen', { id: 'pracka', kind: 'later', now: false, time: 'zajtra 08:00', tone: 'wait' }],
    ];
    for (const [k, r] of rows) strings(M.planTileText(r), `planTile.${k}`, out);
    out['planGroupNote'] = M.planGroupNote([
        { name: 'Práčka', short: 'teraz' },
        { name: 'Umývačka', short: 'teraz' },
        { name: 'Sušička', short: 'o 11:00' },
    ]);
    strings(M.mozemItemText(MOZEM_ITEMS[0], { kind: 'go', end: 900, until: 800, km: null }, null, v), 'item.bezEnv', out);
}

/** Plán dňa a ranné oznámenie: každý druh riadku, dňa a pripomienky. @param {Record<string, string>} out @param {import('../shared/messages.js').Voice} [v] */
function directPlan(out, v) {
    const day = { name: 'Zajtra', index: 1, start: 660 };
    const later = { name: 'Pondelok', index: 3, start: 600 };
    // Plán dňa: každý druh riadku pre každú vec, auto aj s úsporou pod a nad euro.
    /** @type {Array<[string, import('../shared/plan-dna.js').PlanRow]>} */
    const rows = [
        ['sun', { id: '', kind: 'sun', start: 540, end: 660, after: null, km: 120, save: 2.85, currency: '€' }],
        ['sunPo', { id: '', kind: 'sun', start: 660, end: 750, after: 'pracka', km: 0, save: 0.4, currency: '€' }],
        ['sunBez', { id: '', kind: 'sun', start: 660, end: 750, after: null, km: null, save: null, currency: '€' }],
        ['cheap', { id: '', kind: 'cheap', start: 1320 }],
        ['zajtra', { id: '', kind: 'later', day }],
        ['neskor', { id: '', kind: 'later', day: later }],
        ['none', { id: '', kind: 'none' }],
    ];
    for (const item of MOZEM_ITEMS.filter((i) => i.device))
        for (const [k, r] of rows) strings(M.planDnaRowText({ ...r, id: item.id }, v), `plan.${item.id}.${k}`, out);
    Object.assign(out, { 'plan.title': M.PLAN_DNA_TITLE, 'plan.now': M.PLAN_DNA_NOW, 'plan.note': M.PLAN_DNA_NOTE });
    // Ranné oznámenie: pevné texty, nadpis a text pre každý druh dňa a pripomienky.
    const T = M.oznameniaTexts(v);
    strings(T, 'oznam', out);
    out['oznam.remind'] = T.remind(555);
    const withId = (/** @type {string} */ id, /** @type {import('../shared/plan-dna.js').PlanRow} */ r) => ({ ...r, id });
    const notices = {
        jasno: [withId('pracka', rows[0][1]), withId('susicka', rows[1][1]), withId('auto', rows[0][1])],
        inyDen: [withId('pracka', rows[4][1]), withId('umyvacka', rows[5][1]), withId('bojler', rows[3][1]), withId('auto', rows[3][1])],
        nic: [withId('pracka', rows[6][1])],
    };
    for (const [k, list] of Object.entries(notices))
        for (const weak of [true, false])
            strings(M.planNoticeText({ rows: list, sunEnd: k === 'jasno' ? 1050 : null, weak }, v), `notice.${k}.${weak}`, out);
    for (const [k, r] of rows) strings(M.reminderText(withId('umyvacka', r), 540, v), `remind.${k}`, out);
}

/** Výzvy, veta bez dát, najlepší deň a súhrn. @param {Record<string, string>} out @param {import('../shared/messages.js').Voice} [v] */
function directMisc(out, v) {
    for (const online of [true, false])
        for (const kiosk of [true, false])
            for (const [pk, pv] of Object.entries({
                ok: { pvOk: true, pvSince: null },
                od: { pvOk: false, pvSince: '11:20' },
                nikdy: { pvOk: false, pvSince: null },
            }))
                out[`offline.${online}.${kiosk}.${pk}`] = M.mozemOfflineText({ online, zdroj: kiosk, ...pv }, v);
    out['guess'] = M.mozemGuessText(5, v);
    out['list'] = M.mozemListTitle(false);
    out['listOdhad'] = M.mozemListTitle(true);
    strings(M.MOZEM_GROUP_NAMES, 'group', out);
    out['teraz.typical'] = M.terazTypicalText(5, v);
    out['sedem.guess'] = M.sedemGuessText(5, v);
    for (const k of /** @type {const} */ (['vsetko', 'cast', 'nic']))
        for (const missing of [0, 1, 3])
            strings(
                M.summaryTexts(
                    {
                        period: 'mesiac',
                        month: 'september',
                        year: '2026',
                        kwh: 300,
                        phones: 20000,
                        km: 1800,
                        best: { date: '2026-09-03', kwh: 35.5, today: false },
                        value: 50,
                        valuePerDay: 1.6,
                        currency: '€',
                        rest: null,
                        missing,
                        // Uhlík: rozpracovaný, splatený aj bez súčtu od spustenia.
                        co2Kg: 14.4,
                        ...{
                            vsetko: { payback: 0.129, debtT: 11 },
                            cast: { payback: 1.2, debtT: 11 },
                            nic: { payback: null, debtT: null },
                        }[k],
                        carbon: carbonFacts(300, null, PLANT).carbon,
                        od: null,
                        znacka: 'Huawei',
                    },
                    v,
                ),
                `summary.${k}.${missing}`,
                out,
            );
    directSucty(out);
}

/** Súčty len od prvého merania (shared/sucty.js): veta Štatistiky, podnadpis a súhrn. @param {Record<string, string>} out */
function directSucty(out) {
    for (const [k, od] of Object.entries({
        rok: { rok: '2026-10-21' },
        mesiacRok: { mesiac: '2026-10-21', rok: '2026-10-21' },
        victron: { den: '09:12', mesiac: '2026-10-22', rok: '2026-10-22' },
    }))
        out[`sucty.${k}`] = M.suctyOdNote('Fox ESS', od);
    for (const period of /** @type {const} */ (['mesiac', 'rok']))
        strings(
            M.summaryTexts({
                period,
                month: 'október',
                year: '2026',
                kwh: 46.2,
                phones: 3080,
                km: 277,
                best: { date: '2026-10-21', kwh: 24.8, today: false },
                value: null,
                valuePerDay: null,
                currency: '€',
                rest: null,
                missing: 0,
                co2Kg: 3,
                payback: null,
                debtT: null,
                carbon: carbonFacts(46.2, null, PLANT).carbon,
                od: '2026-10-21',
                znacka: 'Fox ESS',
            }),
            `sucty.summary.${period}`,
            out,
        );
}

/** Pevné texty. @param {Record<string, string>} out @param {import('../shared/messages.js').Voice} [v] */
function directConsts(out, v) {
    for (const [k, c] of Object.entries({
        MOZEM_WORDS: M.MOZEM_WORDS,
        MOZEM_CHIPS: M.MOZEM_CHIPS,
        MOZEM_SKY_TEXTS: M.MOZEM_SKY_TEXTS,
        MOZEM_ITEM_TEXTS: M.MOZEM_ITEM_TEXTS,
        MOZEM_UNKNOWN: M.MOZEM_UNKNOWN,
        NIGHT_MESSAGES: M.NIGHT_MESSAGES,
        PRICE_MESSAGES: M.PRICE_MESSAGES,
        TERAZ_TEXTS: M.TERAZ_TEXTS,
        SEDEM_TEXTS: M.SEDEM_TEXTS,
        STATISTIKA_TEXTS: M.STATISTIKA_TEXTS,
    }))
        strings(v ? /** @type {any} */ (M.voiceTexts(v))[k] : c, `const.${k}`, out);
}
