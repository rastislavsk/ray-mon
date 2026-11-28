// Karta Teraz. Výkon, pásmo a odporúčanie sú z heroModel, plán dňa z dayPlan, odpoveď teraz a Plán dňa
// z mozemModel - tie isté ako na karte Dnes. Tu sa to len skladá - číslo, štítky s vetou a čo zapnúť.
// Dnešok a kedy lepšie (dnesCards) berie karta Dnes (shared/dnes-faza.js). Čisté funkcie,
// čas aj dáta prichádzajú v parametroch. Texty sú v shared/messages.js.

import { autoDlazdicaNabija, nabijaSa } from './auto-nabija.js';
import { autoDna } from './auto-slnko.js';
import { daSaZapisat, navrhBehu, zoZvysku } from './bezi.js';
import { interpolate } from './chart-model.js';
import { installedKw, MINUTES_PER_DAY, MOZEM_ITEMS, PLAN_DNA, TARIFF_LIMITS } from './config.js';
import { dayPlan } from './day-plan.js';
import { heroModel } from './hero-model.js';
import {
    terazAutoText,
    terazBehText,
    terazBehVecText,
    terazDalsiText,
    terazDlazdicaText,
    terazHotoveText,
    terazKonciText,
    terazNoteText,
    terazOpakText,
    terazPotomText,
    terazRiadokText,
    terazTodayText,
    terazTypicalText,
    terazVecText,
    terazWindowText,
    voiceTexts,
} from './messages-core.js';
import { TERAZ_BEZI } from './messages-teraz.js';
import { dayCtx, planWindows } from './mozem-jadro.js';
import { mozemModel } from './mozem.js';
import { chosen } from './plan-dna.js';
import { offlineLead, pvStatus } from './mozem-sky.js';
import { pocasie } from './pocasie.js';
import { pristupModel } from './pristup.js';
import { localDateKey, localMinutes, localToUtc } from './solar.js';
import { bojlerRiadeny, maDrahu } from './teraz-bojler.js';
import { casti, PANEL_TEXTS, spoluKwh } from './teraz-panel.js';
import { tokDnaModel } from './teraz-scena.js';
import { dalsieSlnko, denInyModel, dniTyzdna, hrebenModel, nudzaRiadok, nudzoveCasy } from './tyzden.js';
import { domProfil, potrebaBojlera } from './ucenie.js';
import { meria } from './zasuvka.js';

/**
 * @typedef {import('./day-plan.js').PlanInput & { zdroj: unknown, loading: boolean,
 *   known: import('./settings.js').Known, previewMinutes: number | null,
 *   pristup?: import('./pristup.js').Odmietnutie | null, vecNavrh?: { id: string, min: number } | null,
 *   autoDen?: import('./auto-slnko.js').AutoDen | null, autoNabija?: import('./auto-nabija.js').AutoInfo | null,
 *   zasuvky?: Record<string, import('./zasuvka.js').ZasuvkaInfo> }} TerazInput
 * @typedef {import('./day-chart.js').Tone} Tone
 */

/**
 * Model karty Teraz. `kind`: `ask` (appka nepozná polohu), `loading` (prvé načítanie),
 * `offline` (bez predpovede), `ok`. Pri známej polohe bez panelov (`known: 'poloha'`) karta
 * počíta s typickou strechou, ktorú má vo vstupe (typicalSettings), a priznáva to (`estimate`).
 * @param {TerazInput} input
 * Pod číslom je hrebeň týždňa (`hreben`) a plán zvoleného dňa: dnes čo zapnúť teraz a neskôr, iný
 * deň (`den`, poradie od dneška) jeho plán s hlavičkou (docs/navrhy/teraz-vyhlad-alternativy.html, C).
 * @param {{ online?: boolean, voice?: import('./messages.js').Voice, devices?: readonly string[], den?: number }} [opts]
 *   či má telefón internet (veta bez dát), tón hlášok, spotrebiče doma (s nimi ráta Plán dňa) a zvolený deň
 */
export function terazModel(input, { online = true, voice = 'drzy', devices, den = 0 } = {}) {
    const estimate = input.known === 'poloha';
    if (input.known === 'nic') return { ...empty('ask', estimate), ask: true };
    if (!input.forecast) {
        // Bez vety: čakanie ukazuje obrazec v strede obrazovky (#tz-svitanie).
        if (input.loading) return empty('loading', estimate);
        return { ...empty('offline', estimate), num: '–', sub: offlineLead(input, online, voice), retry: true };
    }
    // Meranie, ktoré mlčí, heroModel za výkon „teraz“ nepovažuje (freshPowerKw) - číslo je vtedy
    // odhad z krivky dňa a riadok pod ním povie, odkedy meranie mlčí. Karta Teraz je vždy teraz.
    const now = heroModel({ ...input, previewMinutes: null }, voice);
    const note = estimate ? null : noteOf(input, now, voice);
    const m = mozemModel(input, { voice, devices });
    const { rows, behy, bojler } = m.plan ?? { rows: [], behy: [], bojler: null };
    // Os detailu spotrebiča je celý deň 0 - 24 h ako v ostatných paneloch (docs/navrhy/teraz-panely-zladenie.html, C).
    const os = denOs({ from: 0, to: MINUTES_PER_DAY }, localMinutes(input.now, input.site.timezone));
    const teraz = { nowMin: now.minutes, behy };
    return {
        ...empty('ok', estimate),
        ...headOf(input, now, { estimate, voice }),
        note,
        guess: estimate,
        ...(m.plan ? tyzdenOf(input, rows, teraz, { span: os.span, devices: devices ?? PLAN_DNA.devices, den, voice }) : {}),
        os,
        pocasie: pocasieOf(input, now),
        // Čo plán čaká od bojlera, ktorý riadi zásuvka - pre jeho dlaždicu a panel.
        bojler,
    };
}

/**
 * Hrebeň týždňa a plán zvoleného dňa: dnes čo zapnúť, iný deň (`den`, poradie od dneška) jeho plán
 * s tokom dňa namiesto mena a dátumu (`co.den`, tokDna); detaily spotrebičov patria zvolenému dňu. Deň mimo predpovede je dnešok.
 * @param {TerazInput} input @param {RiadokPlanu[]} rows @param {Parameters<typeof coZapnutModel>[1]} teraz
 * @param {{ span: { from: number, to: number }, devices: readonly string[], den: number, voice: import('./messages.js').Voice }} o
 */
function tyzdenOf(input, rows, teraz, { span, devices, den, voice }) {
    const dni = dniTyzdna(input, devices);
    const hreben = hrebenModel(dni);
    const zvoleny = hreben && dni[den] ? den : 0;
    const dnes = dnesOf(input, rows, { ...teraz, tyzden: dni }, span, voice);
    const iny = hreben && zvoleny > 0 ? denInyModel(dni[zvoleny], devices, voice) : null;
    return {
        co: {
            ...dnes.co,
            den: iny ? tokDna(input, dni[zvoleny].day, devices) : null,
            riadky: iny ? iny.riadky : dnes.co.riadky,
            auto: devices.includes('auto') ? autoDlazdica(input, iny ? zvoleny : 0) : null,
        },
        veci: iny ? iny.veci : dnes.veci,
        hreben: hreben && { ...hreben, zvoleny },
    };
}

/**
 * Tok iného dňa pod pásom dní (docs/navrhy/teraz-pole-ine-dni.html, B): výroba dňa z predpovede (s učením, ak ho
 * volajúci pridal) a spotreba domu za deň - naučený profil domu (domProfil, bez učenia HOUSE_BASE_KW), bojler podľa
 * naučenej potreby pri teplote dňa (keď je doma alebo ho riadi zásuvka) a typický program každého ďalšieho spotrebiča
 * Plánu dňa, lebo plán iného dňa ich rozvrhne všetky (zo slnka alebo núdzovo). Auto v pláne nie je, nie je ani tu.
 * @param {TerazInput} input @param {import('./solar.js').ForecastDay} day @param {readonly string[]} devices
 */
function tokDna(input, day, devices) {
    const teplota = day.tempMinC !== null && day.tempMaxC !== null ? (day.tempMinC + day.tempMaxC) / 2 : null;
    const bojler = devices.includes('bojler') || (!!input.bojler && bojlerRiadeny(input.bojler, input.now));
    const veci = chosen(devices).reduce((sum, { item }) => (item.id === 'bojler' ? sum : sum + (item.runKwh ?? 0)), 0);
    const dom = domProfil(input.ucenie, day.date).reduce((a, b) => a + b, 0);
    return tokDnaModel(day.kwhTotal, dom + veci + (bojler ? potrebaBojlera(input.ucenie, teplota) / 1000 : 0));
}

/**
 * Dlaždica auta čisto zo slnka (docs/navrhy/auto-mimo-planu.html, Z1): dnes to, čo telefón ráno zamrazil a večer
 * prepísal (`autoDen`, web/auto-den.js; kým ho nemá, dlaždica nie je), iný deň (`index`) odhad z jeho predpovede.
 * Pásik je celý žltý - je to celé zo slnka; bez energie prázdny. Dnes, keď sa auto asi nabíja (docs/navrhy/auto-nabija.html,
 * T2), je dlaždica o behu - km, ktoré pribudli, od kedy a výkon; pásik podiel slnka v behu. Kým appka vie o nabíjaní
 * (`autoNabija` od Workera), dnešná dlaždica otvorí panel Auto (`detail`).
 * @param {TerazInput} input @param {number} index
 */
function autoDlazdica(input, index) {
    const detail = index === 0 && !!input.autoNabija;
    const beh = index === 0 ? nabijaSa(input.autoNabija, input.now.getTime()) : null;
    if (beh) return { ...autoDlazdicaNabija(beh, input.site.timezone), detail };
    const dnes = localDateKey(input.now, input.site.timezone);
    const den = input.forecast?.days[index];
    const a =
        index > 0 && input.forecast && den
            ? autoDna({ ...input, forecast: input.forecast }, index, domProfil(input.ucenie, den.date))
            : input.autoDen?.d === dnes
              ? input.autoDen
              : null;
    return a && { ...terazAutoText(a), podiel: a.kwh > 0 ? 100 : null, detail };
}

/**
 * Dnešok: čo zapnúť a detaily spotrebičov. Čo sa dnes na slnko nezmestí (Plán dňa to dá na iný deň
 * alebo nikam), dostane núdzový čas - kedy to dnes stojí najmenej zo siete - a čo dnes zo slnka ide,
 * odznak, kedy bude slnko na ten spotrebič najbližšie, keď to nie je zajtra (shared/tyzden.js).
 * @param {TerazInput} input @param {RiadokPlanu[]} rows
 * @param {Parameters<typeof coZapnutModel>[1] & { tyzden: ReturnType<typeof dniTyzdna> }} teraz
 * @param {{ from: number, to: number }} span os dňa @param {import('./messages.js').Voice} voice
 */
function dnesOf(input, rows, teraz, span, voice) {
    const slnko = /** @type {Extract<RiadokPlanu, { kind: 'sun' }>[]} */ (rows.filter((r) => r.kind === 'sun'));
    // Sušička zo siete hneď po praní má tiež svoj čas - núdzový čas iného spotrebiča naň nepadne.
    const siet = rows.filter((r) => r.kind === 'siet');
    const cakaju = rows.filter((r) => r.kind === 'later' || r.kind === 'none');
    // Čo človek zapol a ešte beží, si zo slnka tiež berie a sušička naň čaká. Dobehnuté pranie už sušička
    // nečaká na iný deň - keď ho nesušila, plán ju dal hneď po ňom.
    const bezia = (teraz.behy ?? []).filter((b) => b.kind === 'run');
    const nudza = nudzoveCasy(
        dayCtx(input),
        [...bezia, ...slnko, ...siet],
        cakaju.map((r) => r.id),
    ).map((n) => {
        const r = /** @type {RiadokPlanu} */ (cakaju.find((x) => x.id === n.id));
        return nudzaRiadok(n, { name: r.name, span, den: '', potom: r.kind === 'later' ? r.day.name : null }, voice);
    });
    /** @type {Record<string, ReturnType<typeof terazPotomText>>} */ const potom = {};
    for (const r of teraz.tyzden.length > 1 ? slnko : []) {
        const dalsi = dalsieSlnko(teraz.tyzden, r.id);
        if (dalsi?.index !== 1) potom[r.id] = terazPotomText(dalsi);
    }
    // Čo sa dá zapísať („Už beží“), má v detaile tlačidlo a čo dnes už dobehlo; čo beží, detail so zápisom.
    const hotove = (/** @type {string} */ id) =>
        terazHotoveText(
            id,
            (teraz.behy ?? []).filter((b) => b.id === id && b.kind === 'done'),
        );
    // Nastavenie času (docs/navrhy/spotrebic-cas-nastavenie.html): pri bežiacom behu vždy, pri nebežiacom po „Už beží“ -
    // vtedy je v stave návrh (`vecNavrh`), ktorý ešte nie je uložený.
    const d = localDateKey(input.now, input.site.timezone);
    const navrh = (/** @type {string} */ id) => (input.vecNavrh?.id === id ? input.vecNavrh.min : null);
    const cas = (/** @type {string} */ id) => nastavenieCasu(input.bezi ?? [], id, d, teraz.nowMin, navrh(id));
    // Spotrebič, ktorý meria zásuvka (docs/navrhy/pracka-zasuvka.html, U1): beh je vždy z merania, „Už beží“ ani nastavenie
    // času nemá - len zmeraný príkon.
    const zasuvka = (/** @type {string} */ id) => (meria(input.zasuvky, id, input.now.getTime()) ? (input.zasuvky?.[id] ?? null) : null);
    /** @param {string} id @returns {VecZapis | null} */
    const meraZapis = (id) => {
        const z = zasuvka(id);
        return z ? { stav: 'meria', hotove: hotove(id), cas: null, w: z.w } : null;
    };
    const dnesBehy = dnesBehyOf(input, teraz, span);
    const moze = (/** @type {VecDetail} */ v) =>
        daSaZapisat(v.id)
            ? {
                  ...v,
                  ...dnesBehy(v.id),
                  zapis: meraZapis(v.id) ?? {
                      stav: /** @type {const} */ ('moze'),
                      hotove: hotove(v.id),
                      cas: navrh(v.id) === null ? null : cas(v.id),
                  },
              }
            : v;
    return {
        co: coZapnutModel(rows, { ...teraz, nudza: nudza.map((n) => n.riadok), potom }, voice),
        veci: [
            ...rows.filter((r) => dnesny(r)).map((r) => moze(vecDetail(r, teraz.nowMin, span))),
            ...nudza.map((n) => moze(n.detail)),
            ...bezia.map((b) => {
                const z = meraZapis(b.id);
                const d = { ...behDetail(b, span, z ?? { stav: 'bezi', hotove: hotove(b.id), cas: cas(b.id) }), ...dnesBehy(b.id) };
                return z ? { ...d, why: TERAZ_BEZI.zasuvka.why } : d;
            }),
        ],
    };
}

/**
 * Detail spotrebiča, ktorý beží: od-do, jeho úsek na osi dňa a zápis - nastavenie času a čo dnes už dobehlo, pri
 * spotrebiči na zásuvke zmeraný príkon.
 * @param {Beh} b @param {{ from: number, to: number }} span os dňa @param {VecZapis} zapis @returns {VecDetail}
 */
function behDetail(b, span, zapis) {
    const slot =
        b.end <= span.from || b.start >= span.to
            ? null
            : {
                  left: spanPct(span, b.start),
                  width: Math.round((spanPct(span, b.end) - spanPct(span, b.start)) * 10) / 10,
                  tone: /** @type {const} */ ('bezi'),
                  dnes: true,
              };
    return { id: b.id, name: b.name, tone: 'bezi', den: '', ...terazBehVecText(b, b.name, zoZvysku(b.id)), slot, zapis };
}

/**
 * Dnešné behy spotrebiča `id` na osi a energia z nich (odhad z typického programu) - behyVeci pre dnešok.
 * @param {TerazInput} input @param {{ behy?: import('./plan-dna.js').BehRow[], nowMin: number }} teraz @param {{ from: number, to: number }} span
 */
function dnesBehyOf(input, teraz, span) {
    const sVt = maDrahu(input.tariff, localDateKey(input.now, input.site.timezone));
    return (/** @type {string} */ id) =>
        behyVeci(
            (teraz.behy ?? []).filter((b) => b.id === id),
            { span, nowMin: teraz.nowMin, runKwh: MOZEM_ITEMS.find((x) => x.id === id)?.runKwh ?? 0, sVt },
        );
}

/**
 * Dnešné behy spotrebiča (Plán dňa, `behy`) v detaile: úseky na osi (`useky`, plné - čo už bežalo, bežiaci po teraz;
 * farba podľa zdroja, ktorý v behu prevládal) a energia dneška (`energia`) - odhad z typického programu (`runKwh`, bežiaci
 * podľa toho, koľko z neho prešlo) rozdelený podielom slnka a drahého pásma, ktorý ráta Plán dňa. Bez behov `energia` null.
 * @param {import('./plan-dna.js').BehRow[]} behy @param {{ span: { from: number, to: number }, nowMin: number, runKwh: number, sVt: boolean }} k
 */
function behyVeci(behy, { span, nowMin, runKwh, sVt }) {
    const useky = behy.flatMap((b) => {
        const po = b.kind === 'run' ? Math.min(b.end, Math.max(b.start, nowMin)) : b.end;
        if (po <= b.start) return [];
        const tone = b.podiel >= 50 ? 'slnko' : b.draha >= 50 ? 'vt' : 'siet';
        return [{ left: spanPct(span, b.start), width: Math.round((spanPct(span, po) - spanPct(span, b.start)) * 10) / 10, tone }];
    });
    if (!behy.length) return { useky, energia: null };
    const e = behy.reduce(
        (sum, b) => {
            const cast = b.kind === 'run' ? Math.min(1, Math.max(0, (nowMin - b.start) / Math.max(1, b.end - b.start))) : 1;
            const wh = runKwh * 1000 * cast;
            const slnko = (wh * b.podiel) / 100;
            const vt = Math.min(wh - slnko, (wh * b.draha) / 100);
            return { slnko: sum.slnko + slnko, siet: sum.siet + wh - slnko - vt, vt: sum.vt + vt };
        },
        { slnko: 0, siet: 0, vt: 0 },
    );
    return { useky, energia: { casti: casti(e, sVt), spolu: `≈ ${spoluKwh(casti(e, sVt))}`, suhrn: PANEL_TEXTS.odhad(behy.length) } };
}

/** Minúta dňa ako hodnota výberu času, „09:05“. @param {number} min */
const hodnotaCasu = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/**
 * Nastavenie času v detaile spotrebiča (docs/navrhy/spotrebic-cas-nastavenie.html, A + D) - beh, ktorý by uložilo
 * „Nastaviť“ (navrhBehu): pri práčke a sušičke zvyšok programu na kolieskach (`zvysok`, hodiny a minúty), pri umývačke
 * čas zapnutia pre výber času telefónu (`od`, najviac teraz - `max`), a kedy skončí.
 * @param {import('./bezi.js').Zapis[]} list @param {string} id @param {string} d @param {number} nowMin
 * @param {number | null} min čo človek nastavil a ešte neuložil @returns {NastavCas}
 */
function nastavenieCasu(list, id, d, nowMin, min) {
    const b = navrhBehu(list, id, d, nowMin, min);
    const zost = b.k - nowMin;
    const z = zoZvysku(id);
    return {
        zvysok: z ? { h: Math.floor(zost / 60), m: zost % 60 } : null,
        od: z ? null : hodnotaCasu(b.m),
        max: hodnotaCasu(nowMin),
        konci: terazKonciText(b.k, nowMin),
    };
}

/**
 * Počasie karty Teraz v zvolenej chvíli (teraz, alebo pri náhľade iného času v ňom - dopredu
 * z predpovede, dozadu z merania) bez zvyšku modelu karty. Z neho je farba Oblohy na všetkých
 * kartách (docs/navrhy/obloha-farba-podla-pocasia.html), takže nebo a kresba počasia hovoria to
 * isté. Bez predpovede null. Mesiac a hviezdy sú v poli pohľadu `pole` (karta Dnes má vlastné, HVIEZDY.dnes).
 * @param {TerazInput} input @param {import('./hviezdy.js').Pole} [pole]
 */
export function pocasieTeraz(input, pole) {
    if (input.known === 'nic' || !input.forecast) return null;
    return pocasieOf(input, heroModel(input), pole);
}

/**
 * Počasie v pozadí karty v zvolenej chvíli (aj v náhľade iného času): hodina predpovede, a keď
 * je výkon v tej chvíli nameraný, aj jeho podiel z jasnej oblohy (shared/pocasie.js). Mesiac
 * a hviezdy sú z tej istej chvíle, nie z teraz, v poli pohľadu `pole` (bez neho karta Teraz).
 * @param {TerazInput} input @param {ReturnType<typeof heroModel>} hero @param {import('./hviezdy.js').Pole} [pole]
 */
function pocasieOf(input, hero, pole) {
    const hour = Math.floor(hero.minutes / 60);
    const point = input.forecast?.hourlyToday.find((h) => h.hour === hour);
    // Zrážky z hodiny, ktorá sa končí po tejto chvíli (o 23:xx je to polnoc zajtrajška).
    const zrazkyPoint =
        hour < 23 ? input.forecast?.hourlyToday.find((h) => h.hour === hour + 1) : input.forecast?.hourlyTomorrow.find((h) => h.hour === 0);
    const today = todayOf(input);
    const merane =
        today && (hero.source === 'live' || hero.source === 'measured')
            ? { kw: hero.power, clearKw: interpolate(today.hourly, hero.minutes / 60, 'clearKw'), installedKw: installedKw(input.plant) }
            : null;
    // Minúta náhľadu je miestny čas elektrárne, hviezdy a mesiac potrebujú okamih v UTC.
    const tz = input.site.timezone;
    const chvila = hero.preview ? localToUtc(localDateKey(input.now, tz), hero.minutes, tz) : input.now;
    return pocasie({ point, zrazkyPoint, noc: hero.isNight, chvila, site: input.site, merane, pole });
}

/**
 * Nadpis, číslo teraz (aj ako číslo pre scénu toku energie) a riadok pod ním (pri vlastnej streche prázdny). Pri typickej streche „~“
 * a veta, že to nie je vlastná strecha. Medzi číslom a vetou je riadok stavu merania (stavRiadok
 * v shared/hlavicka.js).
 * @param {TerazInput} input @param {ReturnType<typeof heroModel>} now
 * @param {{ estimate: boolean, voice: import('./messages.js').Voice }} o
 */
function headOf(input, now, { estimate, voice }) {
    const title = voiceTexts(voice).TERAZ_TEXTS.title;
    // Výkon teraz ako číslo pre scénu toku energie (shared/teraz-scena.js); z predpovede je to odhad.
    const vykon = { vykon: now.power, odhadVykonu: estimate || now.source === 'forecast' };
    if (estimate) {
        const num = Number.isFinite(now.power) ? `~${now.powerText}` : now.powerText;
        return { title, num, sub: terazTypicalText(installedKw(input.plant), voice), ...vykon };
    }
    return { title, num: now.powerText, sub: '', ...vykon };
}

/**
 * Pás pod číslom, keď appka teraz nemá údaje z meniča a číslo je odhad z predpovede: bez merania
 * vedie k jeho pripojeniu, pri odmietnutom prístupe povie prečo a vedie k oprave
 * (shared/pristup.js), keď meranie mlčí, povie odkedy. Rozhoduje výkon teraz, nie náhľad - pás
 * počas ťahania po grafe ostáva, aby sa graf pod prstom nepohol. Inak null. `btn` je text
 * tlačidla, prázdny bez tlačidla; `znova`: tlačidlo vedie k opätovnému pripojeniu, nie k prvému.
 * @param {TerazInput} input @param {ReturnType<typeof heroModel>} now
 * @param {import('./messages.js').Voice} voice
 */
function noteOf(input, now, voice) {
    if (now.source !== 'forecast') return null;
    const T = voiceTexts(voice).TERAZ_TEXTS;
    if (!input.zdroj) return { title: T.noteTitle, text: T.noteText, btn: T.noteBtn, znova: false };
    const zdroj = /** @type {import('./zdroje.js').Zdroj} */ (input.zdroj);
    const p = pristupModel({ zdroj, pristup: input.pristup ?? null, now: input.now, timezone: input.site.timezone });
    const riadok = p && p.druh === 'neplati' ? p.riadok : '';
    const text = terazNoteText({ since: pvStatus(input).since, riadok }, voice);
    return { title: T.noteTitle, text, btn: riadok ? T.noteAgainBtn : '', znova: !!riadok };
}

/** Karta bez grafu a odporúčaní. @param {'ask' | 'loading' | 'offline' | 'ok'} kind @param {boolean} estimate */
function empty(kind, estimate) {
    return {
        kind,
        estimate,
        ask: false,
        title: voiceTexts().TERAZ_TEXTS.title,
        num: '',
        sub: '',
        vykon: NaN,
        odhadVykonu: false,
        note: /** @type {ReturnType<typeof noteOf>} */ (null),
        retry: false,
        guess: false,
        co: /** @type {(ReturnType<typeof coZapnutModel> & { den: ReturnType<typeof tokDnaModel> | null, auto: ReturnType<typeof autoDlazdica> }) | null} */ (
            null
        ),
        veci: /** @type {Array<VecDetail>} */ ([]),
        hreben: /** @type {(NonNullable<ReturnType<typeof hrebenModel>> & { zvoleny: number }) | null} */ (null),
        os: /** @type {ReturnType<typeof denOs> | null} */ (null),
        pocasie: /** @type {import('./pocasie.js').Pocasie | null} */ (null),
        bojler: /** @type {import('./plan-dna.js').BojlerPlan | null} */ (null),
    };
}

/** Dnešok v predpovedi, alebo null, keď predpoveď začína iným dňom (po polnoci pred obnovou). @param {import('./day-plan.js').PlanInput} input */
export function todayOf(input) {
    const day = input.forecast ? input.forecast.days[0] : null;
    return day && day.date === localDateKey(input.now, input.site.timezone) ? day : null;
}

/**
 * Dnešok (predpoveď, koľko už nabehlo, okno na veľké veci) a čas, keď bude ešte dnes lepšie
 * (waitTime z heroModel) - z toho skladá kartu Dnes shared/dnes-faza.js. Bez predpovede null.
 * @param {TerazInput} input @param {import('./messages.js').Voice} [voice]
 */
export function dnesCards(input, voice = 'drzy') {
    if (!input.forecast) return null;
    const now = heroModel({ ...input, previewMinutes: null }, voice);
    return { today: todayCard(input, dayPlan(input), now.minutes), wait: now.waitTime };
}

/**
 * Karta Dnešok: predpoveď dňa, koľko už nabehlo (z kiosku, bez neho podľa predpovede) a okno
 * na veľké veci - zelený úsek plánu, ten istý ako na páse a na karte Môžem? (prebieha, príde,
 * alebo posledný, ktorý už bol). Riadok o predpovedi a o tom, čo už nabehlo, ukazuje aj detail
 * dneška na karte 7 dní.
 * @param {import('./day-plan.js').PlanInput} input @param {import('./day-plan.js').PlanSlot[]} plan @param {number} nowMin
 */
export function todayCard(input, plan, nowMin) {
    const windows = planWindows(plan, (s) => s.tier === 'green');
    const ahead = windows.find((w) => w.to > nowMin) || null;
    const window = ahead || windows[windows.length - 1] || null;
    const day = todayOf(input);
    const kwh = input.pv ? input.pv.dailyEnergyKwh : null;
    const measured = kwh !== null && Number.isFinite(kwh);
    const done = measured ? /** @type {number} */ (kwh) : day ? soFar(day.hourly, nowMin) : 0;
    return {
        ...dayDone(day, done, measured),
        window: terazWindowText(window, !ahead && !!window),
    };
}

/**
 * Čo z predpovede dneška už nabehlo: čísla pre kartu Dnes cez deň (shared/dnes-faza.js) - predpoveď
 * dňa (null bez nej), nabehnuté a či je namerané -, riadok a percento pre pás. Bez predpovede na dnešok prázdne.
 * @param {import('./solar.js').ForecastDay | null} day @param {number} done @param {boolean} measured
 */
function dayDone(day, done, measured) {
    if (!day) return { forecastKwh: null, doneKwh: done, measured, line: '', pct: null };
    return {
        forecastKwh: day.kwhTotal,
        doneKwh: done,
        measured,
        line: terazTodayText({ forecastKwh: day.kwhTotal, doneKwh: done, measured }),
        pct: day.kwhTotal > 0 ? Math.min(100, Math.round((100 * done) / day.kwhTotal)) : null,
    };
}

/**
 * Koľko z predpovede dneška už nabehlo. Hodnota hodiny je výkon v jej celú hodinu, a tak
 * zastupuje polhodinu pred ňou aj po nej - súčet celého dňa je potom presne `kwhTotal`.
 * @param {Array<{ hour: number, kw: number }>} hourly @param {number} nowMin
 */
function soFar(hourly, nowMin) {
    return hourly.reduce((sum, p) => sum + p.kw * Math.max(0, Math.min(1, (nowMin - (p.hour * 60 - 30)) / 60)), 0);
}

/** @typedef {ReturnType<typeof terazModel>} TerazModel */
/**
 * Detail spotrebiča pre panel: `slot` je jeho úsek na osi dňa v % - zo slnka zelený, z lacnej siete
 * modrý, núdzový čas s kúskom slnka zlatý (`part`), čo beží, krémový (`bezi`). `zapis`: spotrebič sa dá zapísať.
 * @typedef {{ id: string, name: string, tone: string, den: string, kedy: string, cas: string, why: string,
 *   slot: { left: number, width: number, tone: 'go' | 'cheap' | 'part' | 'bezi', dnes: boolean } | null,
 *   zapis?: VecZapis, useky?: Array<{ left: number, width: number, tone: string }>, energia?: VecEnergia | null }} VecDetail
 */
/**
 * Energia dneška v detaile spotrebiča: časti podľa zdroja, súčet a riadok pod nimi.
 * @typedef {{ casti: ReturnType<typeof casti>, spolu: string, suhrn: string }} VecEnergia
 */
/**
 * Zápis v detaile spotrebiča: dnes sa dá zapísať, že beží (`moze`, tlačidlo „Už beží“), alebo už beží (`bezi`). Spotrebič,
 * ktorý meria zásuvka (`meria`, docs/navrhy/pracka-zasuvka.html, U1), zapísať nejde - má zmeraný príkon `w` (W).
 * `cas`: nastavenie času - pri bežiacom behu vždy, pri `moze` po „Už beží“, inak null. `hotove`: behy, ktoré dnes už dobehli.
 * @typedef {{ stav: 'moze' | 'bezi' | 'meria', hotove: Array<{ text: string, cas: string }>, cas: NastavCas | null, w?: number }} VecZapis
 */
/**
 * Nastavenie času: zvyšok programu na kolieskach (práčka, sušička) alebo čas zapnutia „HH:MM“ (umývačka, `max` je teraz)
 * a kedy beh skončí.
 * @typedef {{ zvysok: { h: number, m: number } | null, od: string | null, max: string, konci: string }} NastavCas
 */
/** Spotrebič, ktorý človek dnes zapol, s menom (planDnaModel, `behy`). @typedef {import('./plan-dna.js').BehRow & { name: string }} Beh */

// ---- Nová karta Teraz (docs/navrhy/teraz-navrh-2.html) ----------------------------------
// Čo zapnúť (mriežka dlaždíc z Plánu dňa) a detail spotrebiča. Graf dňa s odčítaním zvoleného času
// je v paneli karty Dnes (grafModel), číslo karty Teraz je vždy teraz.

/** @typedef {import('./plan-dna.js').PlanRow & { name: string, why: string }} RiadokPlanu */
/** @typedef {Extract<RiadokPlanu, { kind: 'sun' | 'siet' | 'cheap' }>} DnesnyRiadok */

const STEP = TARIFF_LIMITS.stepMin;

/** Podiel 0 až 1 ako celé percentá pre pásik dlaždice. @param {number} p */
const pct = (p) => Math.round(p * 100);

/** Riadok, ktorý ide dnes (na slnku, zo siete po inej veci alebo v lacnom pásme). @param {RiadokPlanu} r @returns {r is DnesnyRiadok} */
const dnesny = (r) => r.kind === 'sun' || r.kind === 'siet' || r.kind === 'cheap';

/**
 * Ďalší spotrebič v mriežke Čo zapnúť (docs/navrhy/teraz-dlazdice.html): veľký čas, meno, najviac dve odrážky
 * a podiel programu zo slnka v % pre pásik (docs/navrhy/teraz-pasik-zdroje.html, B) a zo siete v drahom pásme (`draha`, v %,
 * docs/navrhy/plan-dna-oznamenie-vt.html, P1). Kreslí sa ako dlaždica na skle.
 * Na dlaždici sú len čísla (docs/navrhy/teraz-dlazdice-cisla.html, B): čas so značkou (`zn`), malé čísla (`mv`) a odznak
 * pri ikone (`odz`: kedy bude slnko, „2×“); slová (`odr`) číta čítačka a ukáže detail.
 * @typedef {import('./messages-teraz.js').Znacka} Znacka
 * @typedef {import('./messages-teraz.js').MaleCislo} MaleCislo
 * @typedef {{ id: string, name: string, kind: string, pred?: string, zn?: Znacka, cas: string, odr: string[], mv: MaleCislo[], podiel: number,
 *   draha: number, potom?: Potom | null }} Riadok
 */
/**
 * Odznak, kedy bude slnko na spotrebič najbližšie: veta (`text`) a na dlaždici skratka dňa (`kratko`); „2×“ spotrebiča, ktorý
 * dnes už dobehol, má vetu „dnes už 2×“. @typedef {{ text: string, kratko: string, dlho: boolean }} Potom
 */

/**
 * Čo zapnúť dnes (docs/navrhy/teraz-dlazdice.html): dlaždice toho, čo ide teraz (zo slnka, zo siete po praní alebo
 * z lacnej siete), a keď teraz nejde nič, najbližšia vec s odpočtom; za nimi v tej istej mriežke `riadky` - zvyšok
 * dneška podľa času a čo sa dnes na slnko nezmestí, s núdzovým časom (`nudza`, počíta shared/tyzden.js).
 * Riadky sú z Plánu dňa (planDnaModel), nič sa nepočíta znova. Vec v lacnom pásme ide teraz, keď v tom
 * pásme teraz sme. Čo ide zo slnka, nesie odznak, kedy bude slnko najbližšie (`potom`, podľa id veci).
 * Čo človek dnes zapol (`behy`, docs/navrhy/teraz-bezi-spotrebic.html) a ešte beží, má vlastné dlaždice (`bezi`, podľa
 * skutočného štartu - v stĺpci ide hore). Čo dobehlo, má dlaždicu s ďalším časom a odrážkou „dnes už 1×“
 * (docs/navrhy/spotrebic-koniec-opakovanie.html).
 * @param {RiadokPlanu[]} rows
 * @param {{ nowMin: number, nudza?: Riadok[], potom?: Record<string, Potom>, behy?: Beh[] }} teraz minúta dňa
 * @param {import('./messages.js').Voice} [voice]
 */
export function coZapnutModel(rows, { nowMin, nudza = [], potom = {}, behy = [] }, voice = 'drzy') {
    // Ten istý štart „teraz“ ako v Pláne dňa: najbližšia štvrťhodina.
    const now = Math.ceil(nowMin / STEP) * STEP;
    const ide = (/** @type {DnesnyRiadok} */ r) => r.start <= now && now < r.end;
    const dnesne = rows.filter(dnesny);
    const teraz = dnesne.filter(ide);
    const dnes = dnesne.filter((r) => !ide(r)).sort((a, b) => a.start - b.start);
    const hore = teraz.length ? horeTeraz(teraz, potom, voice) : horeDalsi(dnes.shift() ?? null, nowMin);
    const riadok = (/** @type {DnesnyRiadok} */ r) => {
        const t = terazRiadokText(r);
        const p = r.kind === 'sun' ? potom[r.id] : null;
        return {
            id: r.id,
            name: r.name,
            kind: r.kind,
            ...(t.pred ? { pred: t.pred } : {}),
            ...(t.zn ? { zn: t.zn } : {}),
            cas: t.cas,
            odr: t.odr,
            mv: t.mv,
            podiel: pct(r.podiel),
            draha: pct(r.draha),
            potom: p ?? null,
        };
    };
    const beh = (/** @type {Beh} */ b) => ({
        id: b.id,
        tone: /** @type {const} */ ('bezi'),
        meno: b.name,
        ...terazBehText(b, nowMin),
        podiel: pct(b.podiel),
        draha: pct(b.draha),
    });
    // Spotrebič, ktorý dnes už dobehol, má na dlaždici s ďalším časom odznak „1×“ (veta „dnes už 1×“) - namiesto
    // odznaku, kedy bude slnko.
    /** @template {{ id: string, potom?: Potom | null }} T @param {T} d @returns {T} */
    const opak = (d) => {
        const n = behy.filter((b) => b.id === d.id && b.kind === 'done').length;
        return n ? { ...d, potom: { text: terazOpakText(n), kratko: `${n}×`, dlho: false } } : d;
    };
    return {
        hore: { dlazdice: hore.dlazdice.map(opak), dalsi: hore.dalsi && opak(hore.dalsi) },
        /** @type {Riadok[]} */ riadky: [...dnes.map(riadok), ...nudza].map(opak),
        bezi: behy
            .filter((b) => b.kind === 'run')
            .sort((a, b) => a.start - b.start)
            .map(beh),
    };
}

/**
 * Dlaždice toho, čo ide teraz: zo slnka, zo siete po praní alebo z lacnej siete. Čo ide zo slnka, nesie odznak
 * `potom` (podľa id veci). @param {DnesnyRiadok[]} teraz @param {Record<string, Potom>} potom
 * @param {import('./messages.js').Voice} voice @returns {CoZapnutHore}
 */
function horeTeraz(teraz, potom, voice) {
    return {
        dlazdice: teraz.map((r) => {
            const t = terazDlazdicaText(r, voice);
            const p = r.kind === 'sun' ? (potom[r.id] ?? null) : null;
            return {
                id: r.id,
                tone: r.kind === 'sun' ? 'go' : r.kind,
                ...t,
                podiel: pct(r.podiel),
                draha: pct(r.draha),
                potom: p,
            };
        }),
        dalsi: null,
    };
}

/**
 * Keď teraz nejde nič: dlaždica najbližšej veci dneška `p` s odpočtom (null, keď dnes už nič).
 * @param {DnesnyRiadok | null} p @param {number} nowMin @returns {CoZapnutHore}
 */
function horeDalsi(p, nowMin) {
    return {
        dlazdice: [],
        dalsi: p && {
            id: p.id,
            name: p.name,
            ...(({ zn, cas, mv }) => ({ zn, cas, mv }))(terazRiadokText(p)),
            odr: terazDalsiText(p, nowMin),
            podiel: pct(p.podiel),
            draha: pct(p.draha),
        },
    };
}

/**
 * Hore v Čo zapnúť: dlaždice toho, čo ide teraz (`tone` odkiaľ: `go` slnko, `siet` sieť po praní, `cheap` lacná
 * sieť), alebo najbližšia vec.
 * @typedef {{ dlazdice: Array<{ id: string, tone: 'go' | 'siet' | 'cheap', pred: string, zn: Znacka, velky: string, meno: string, odr: string[],
 *   mv: MaleCislo[], podiel: number, draha: number, potom: Potom | null }>,
 *   dalsi: { id: string, name: string, zn?: Znacka, cas: string, odr: string[], mv: MaleCislo[], podiel: number, draha: number, potom?: Potom | null } | null }} CoZapnutHore
 */

/**
 * Detail spotrebiča (panel po ťuknutí na dlaždicu či riadok): kedy a odkiaľ, od-do, prečo práve
 * vtedy (to isté ako Plán dňa) a jeho úsek na osi dňa (`slot` v % osi: zo slnka zelený, z lacnej
 * siete modrý; `dnes` - len vtedy má os aj „teraz“). Pri inom dni `den` („Zajtra“, „Streda“) - čas
 * bez dňa by sa čítal ako dnešný. „Tento týždeň nie“ úsek nemá.
 * @param {RiadokPlanu} r @param {number} nowMin @param {{ from: number, to: number }} span os dňa
 * @returns {VecDetail}
 */
function vecDetail(r, nowMin, span) {
    const now = Math.ceil(nowMin / STEP) * STEP;
    const ide = dnesny(r) && r.start <= now && now < r.end;
    // Úsek celý mimo osi dňa (lacná sieť v noci) by sa prilepil na jej kraj - os vtedy nie je.
    const slot = r.kind === 'none' ? null : vecSlot(r, span);
    const tone = !ide ? '' : r.kind === 'sun' ? 'go' : r.kind;
    return { id: r.id, name: r.name, tone, den: r.kind === 'later' ? r.day.name : '', ...terazVecText(r, ide), slot };
}

/**
 * Úsek veci na osi dňa v %: zo slnka zelený, z lacnej siete modrý, zo siete po praní zlatý ako núdzový čas
 * s kúskom slnka (`part`); `dnes` - len vtedy má os „teraz“.
 * Celý mimo osi null.
 * @param {Exclude<RiadokPlanu, { kind: 'none' }>} r @param {{ from: number, to: number }} span
 */
function vecSlot(r, span) {
    const od = r.kind === 'later' ? r.day.start : r.start;
    if (r.end <= span.from || od >= span.to) return null;
    return {
        left: spanPct(span, od),
        width: Math.round((spanPct(span, r.end) - spanPct(span, od)) * 10) / 10,
        tone:
            r.kind === 'cheap'
                ? /** @type {const} */ ('cheap')
                : r.kind === 'siet'
                  ? /** @type {const} */ ('part')
                  : /** @type {const} */ ('go'),
        dnes: r.kind !== 'later',
    };
}

/** Minúta dňa ako % osi `span`, mimo osi na jej kraji. @param {{ from: number, to: number }} span @param {number} m */
function spanPct(span, m) {
    return Math.round(((Math.max(span.from, Math.min(span.to, m)) - span.from) / (span.to - span.from)) * 1000) / 10;
}

/**
 * Os pre detail spotrebiča: hodiny po šiestich a „teraz“ v % osi (mimo osi null).
 * @param {{ from: number, to: number }} span @param {number} nowMin
 */
function denOs(span, nowMin) {
    const pct = (/** @type {number} */ m) => spanPct(span, m);
    /** @type {Array<{ label: string, at: number }>} */ const ticks = [];
    for (let h = Math.ceil(span.from / 360) * 6; h * 60 <= span.to; h += 6) ticks.push({ label: String(h), at: pct(h * 60) });
    return { span, ticks, now: nowMin >= span.from && nowMin <= span.to ? pct(nowMin) : null };
}
