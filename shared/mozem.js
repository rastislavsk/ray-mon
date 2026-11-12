// Karta Môžem?: jednoduchá odpoveď pre celú rodinu - môžem teraz zapnúť práčku, a keď nie,
// tak kedy. Čisté funkcie bez DOM. Stojí na pláne dňa (shared/day-plan.js), takže „áno“ tu
// je tá istá zelená ako v grafe dňa na karte Teraz; ďalšie dni berie z predpovede.
// Texty skladá shared/messages.js, tu sa len počíta.

import { EVERYDAY, installedKw, MOZEM_GROUPS, MOZEM_ITEMS, PLAN_DNA, TARIFF_LIMITS } from './config.js';
import { freshPowerKw, pvFreshness } from './hero-model.js';
import { pad2 } from './format.js';
import { co2SavedKg } from './carbon.js';
import {
    denWord,
    dnesDayText,
    MOZEM_GROUP_NAMES,
    mozemChipInfo,
    mozemHeroText,
    mozemItemText,
    mozemListTitle,
    mozemNetInfo,
    mozemStripText,
    mozemTileNote,
    mozemTileValue,
    planGroupNote,
    planTileText,
    voiceTexts,
} from './messages-core.js';
import { addDays, localDateKey, sunUp } from './solar.js';
import { bandById, scheduleFor, slotsOf } from './tariff.js';
import { planDnaModel } from './plan-dna.js';
import { denFaza, denSlovo, denTrieda, rannaFor } from './den-trieda.js';
import { dayCtx, itemAnswer, itemCost, laterDay, planWindows } from './mozem-jadro.js';

/** @typedef {import('./day-plan.js').PlanSlot} PlanSlot */
/** @typedef {import('./day-plan.js').PlanInput} PlanInput */
/** @typedef {import('./messages.js').Voice} Voice */
/** @typedef {import('./mozem-jadro.js').Window} Window */
/** @typedef {import('./mozem-jadro.js').DayCtx} DayCtx */
/** @typedef {import('./mozem-jadro.js').Answer} Answer */
/** @typedef {import('./mozem-jadro.js').LaterDay} LaterDay */
/** Pás dňa v širokej dlaždici: geometria (stripGeometry) a veta do panelu skupiny. @typedef {ReturnType<typeof stripGeometry> & { text: string }} Strip */
/** @typedef {'go' | 'wait' | 'slabo' | 'none' | 'offline' | 'loading' | 'bezpanelov'} MozemState */

/**
 * Poloha úseku a značky „teraz“ na páse dňa v percentách jeho šírky. Pás je deň so slnkom
 * (daylightSpan), aby hovoril o tých istých hodinách ako graf dňa na karte Teraz; `from` a `to`
 * sú jeho kraje pre popisky.
 * @param {Window | null} w @param {number} nowMin @param {import('./solar.js').Span} span
 */
export function stripGeometry(w, nowMin, span) {
    const a = span.from;
    const b = span.to;
    const pct = (/** @type {number} */ m) => Math.round(Math.max(0, Math.min(1, (m - a) / (b - a))) * 1000) / 10;
    const geo = { left: w ? pct(w.from) : 0, width: w ? Math.round((pct(w.to) - pct(w.from)) * 10) / 10 : 0, now: pct(nowMin) };
    return { ...geo, from: a, to: b };
}

/**
 * Stav karty podľa Plánu dňa: niečo z plánu ide teraz, príde ešte dnes na slnku, alebo dnes už
 * nič - vtedy slabý deň, keď dnes zelená vôbec nebola (`sunState` podľa slnka, dayState).
 * @param {PlanDnaRow[]} rows @param {MozemState} sunState @returns {MozemState}
 */
function planState(rows, sunState) {
    const sun = rows.filter((r) => r.kind === 'sun');
    if (sun.some((r) => r.now)) return 'go';
    if (sun.length) return 'wait';
    return sunState === 'slabo' ? 'slabo' : 'none';
}

/**
 * Čo z plánu povie veta pod veľkým slovom: čo ide teraz, najbližšie ďalšie na slnku a prvé
 * v lacnom pásme. @param {PlanDnaRow[]} rows riadky podľa času
 * @returns {import('./messages-core.js').PlanHero}
 */
function planHero(rows) {
    const next = rows.find((r) => r.kind === 'sun' && !r.now);
    const cheap = rows.find((r) => r.kind === 'cheap');
    return {
        now: rows.filter((r) => r.kind === 'sun' && r.now).map((r) => r.name),
        next: next && next.kind === 'sun' ? { name: next.name, start: next.start } : null,
        cheap: cheap && cheap.kind === 'cheap' ? { name: cheap.name, start: cheap.start } : null,
    };
}

/**
 * Stav celej karty: zelená teraz, slnko príde ešte dnes, dnes vôbec (slabý deň), už nie.
 * @param {Window[]} windows @param {number} nowMin @param {boolean} sun
 * @returns {{ state: MozemState, window: Window | null }}
 */
function dayState(windows, nowMin, sun) {
    const cur = windows.find((w) => w.from <= nowMin && nowMin < w.to);
    if (cur) return { state: 'go', window: cur };
    const next = windows.find((w) => w.from > nowMin);
    if (next) return { state: 'wait', window: next };
    const last = windows.filter((w) => w.to <= nowMin).pop() || null;
    return { state: !last && sun ? 'slabo' : 'none', window: last };
}

/**
 * Čo veľké slovo povie o celom dni: trieda dňa, časť dňa a zmena oproti rannej triede. Večer
 * hodnotí len namerané - bez nameranej krivky dneška ostáva ranná hláška.
 * @param {PlanInput} input @param {readonly string[]} devices @param {import('./den-trieda.js').RannaTrieda | null | undefined} ranna
 */
function denOf(input, devices, ranna) {
    const measured = !!input.pv && input.pv.realCurveToday.length > 0;
    const rano = rannaFor(ranna, localDateKey(input.now, input.site.timezone), devices);
    return denSlovo(denTrieda(input, devices), denFaza(input), rano, measured);
}

/** Hlavička karty bez predpovede: panely nie sú zadané, načítava sa, alebo dáta nie sú.
 * @param {boolean} loading @param {boolean} noPanels @param {Voice} voice */
function emptyHead(loading, noPanels, voice) {
    /** @type {'bezpanelov' | 'loading' | 'offline'} */ const state = noPanels ? 'bezpanelov' : loading ? 'loading' : 'offline';
    const hero = mozemHeroText(state, null, voice);
    return {
        state,
        word: voiceTexts(voice).MOZEM_WORDS[state],
        hero,
        say: hero.lead,
        strip: null,
        stavInfo: mozemChipInfo(state, null, voice),
        net: null,
    };
}

/**
 * Model karty Môžem?. `known`: čo appka o elektrárni vie
 * (bez neho uložená elektráreň). Pri známej polohe bez panelov (`poloha`) karta odpovedá
 * z typickej strechy, ktorú má vo vstupe (typicalSettings), a model to priznáva v `estimate` -
 *. Bez polohy (`nic`) neodpovedá.
 *
 * `facts` sú údaje dňa (null bez odpovede): cena siete teraz, dnešné okno so slnkom (to isté
 * ako pás dňa v dlaždici), živý výkon (null bez merania) a výkon z plánu dňa. `list` je nadpis dlaždíc
 * vecí (null, kým sa načítava) a `groups` dlaždice skupín.
 * Stav, veta pod veľkým slovom aj dlaždice sa riadia Plánom dňa (`plan`), takže karta nikde
 * nepovie nič iné než plán. Karta Teraz z neho skladá, čo zapnúť, a vysvetľuje štítky (`chips`);
 * `say` je len tá časť vety, ktorá plán neopakuje. Karta Dnes ukazuje, čo dá
 * strecha za celý deň (`day`, null bez predpovede na dnešok).
 * @param {PlanInput & { loading: boolean, known?: import('./settings.js').Known }} input
 * Veľké slovo hovorí o celom dni (`den`: trieda, časť dňa a zmena oproti rannej triede `ranna`,
 * shared/den-trieda.js), veta pod ním o tom, čo teraz.
 * @param {{ voice?: Voice, devices?: readonly string[], ranna?: import('./den-trieda.js').RannaTrieda | null }} [opts]
 *   `voice` tón textov, `devices` spotrebiče doma, `ranna` trieda dňa, ktorú appka videla ráno (platí len pre dnešok a tie isté spotrebiče)
 */
export function mozemModel(input, { voice = 'drzy', devices = PLAN_DNA.devices, ranna } = {}) {
    const known = input.known || 'elektraren';
    const estimate = known === 'poloha';
    const noPanels = known === 'nic';
    const ctx = input.forecast && !noPanels ? dayCtx(input) : null;
    const items = mozemItems(input, ctx, voice);
    const plan = ctx ? planDnaModel(input, { devices, voice }) : null;
    const rows = plan ? plan.rows : [];
    const head = ctx
        ? dayHead(input, ctx, voice, estimate ? installedKw(input.plant) : null, { rows, den: denOf(input, devices, ranna) })
        : { ...emptyHead(input.loading, noPanels, voice), facts: null, den: null };
    const { stavInfo, net, ...rest } = head;
    return {
        ...rest,
        chips: chipsOf(head.state, head.facts, voice, { stavInfo, net }),
        day: dnesDayModel(input, ctx),
        estimate,
        items,
        plan,
        // Kým sa načítava, karta nič netvrdí - dlaždice nie sú.
        list: head.state === 'loading' ? null : { title: mozemListTitle(estimate), estimate },
        groups: planGroups(items, head.strip, rows),
    };
}

/** @typedef {ReturnType<typeof planDnaModel>} MozemModelPlan */
/** @typedef {NonNullable<MozemModelPlan>['rows'][number]} PlanDnaRow */

/**
 * Dlaždice skupín podľa Plánu dňa: skupina bez spotrebiča doma sa neukáže. Veľká odpoveď patrí
 * tomu, čo je v pláne na rade najskôr; pri viacerých veciach riadok pod ňou vymenuje všetky
 * s časom z plánu (planGroupNote) a panel skupiny ukáže ich časy z plánu. Polovičná dlaždica,
 * ktorej chýba pár, ide na celú šírku. Bez plánu (nič doma, dáta nie sú) dlaždice z odpovedí vecí.
 * @param {ReturnType<typeof mozemItems>} items @param {Strip | null} strip @param {PlanDnaRow[]} rows riadky plánu podľa času
 */
function planGroups(items, strip, rows) {
    if (!rows.length) return groupsOf(items, strip);
    const shown = MOZEM_GROUPS.flatMap((g) => {
        const own = rows.filter((r) => g.items.includes(r.id));
        return own.length ? [{ g, own }] : [];
    });
    const halves = shown.filter(({ g }) => g.size === 'half');
    const lonely = halves.length % 2 ? halves[halves.length - 1].g : null;
    return shown.map(({ g, own }) => {
        const first = planTileText(own[0]);
        const name = MOZEM_GROUP_NAMES[/** @type {keyof typeof MOZEM_GROUP_NAMES} */ (g.id)];
        const base = { id: g.id, size: g === lonely ? 'wide' : g.size, name, items: g.items, value: first.value, tone: first.tone };
        if (own.length === 1) return { ...base, key: own[0].id, note: first.note, bar: null, sheet: null };
        const tiles = own.map((r) => ({ id: r.id, name: r.name, ...planTileText(r) }));
        const sheetRows = tiles.flatMap((t) => {
            const it = items.find((i) => i.id === t.id);
            return it ? [{ ...it, short: t.short, tone: t.tone }] : [];
        });
        return {
            ...base,
            key: g.id,
            note: planGroupNote(tiles),
            bar: g.size === 'wide' ? barOf(strip) : null,
            sheet: { title: `${name}: ${first.value}`, lead: strip?.text ?? '', rows: sheetRows },
        };
    });
}

/** Poradie odpovedí od najlepšej: dlaždica skupiny ukáže najlepšiu odpoveď svojich vecí. */
const RANK = { go: 0, wait: 1, cheap: 2, later: 3, none: 4, unk: 5 };

/**
 * Dlaždice skupín (MOZEM_GROUPS): jedna odpoveď za skupinu. `key` je to, čo ťuknutie otvorí -
 * pri jednej veci jej panel, pri viacerých panel skupiny so zoznamom vecí. Pri viacerých veciach
 * riadok pod odpoveďou vymenuje tie, ktoré odpovedajú inak; pri jednej veci povie,
 * odkiaľ pôjde prúd. Široká dlaždica má pás dňa s oknom slnka.
 * @param {ReturnType<typeof mozemItems>} items @param {Strip | null} strip
 */
function groupsOf(items, strip) {
    return MOZEM_GROUPS.map((g) => {
        const own = items.filter((it) => g.items.includes(it.id));
        const best = own.reduce((a, b) => (RANK[b.answer.kind] < RANK[a.answer.kind] ? b : a));
        const name = MOZEM_GROUP_NAMES[/** @type {keyof typeof MOZEM_GROUP_NAMES} */ (g.id)];
        const value = mozemTileValue(best.answer, best.short);
        const base = { id: g.id, size: g.size, name, items: g.items };
        if (own.length === 1) {
            return { ...base, key: best.id, value, tone: best.tone, note: mozemTileNote(best.answer), bar: null, sheet: null };
        }
        const note = own
            .filter((it) => it.tone !== best.tone)
            .map((it) => `${it.name} ${it.short}`)
            .join(' · ');
        return {
            ...base,
            key: g.id,
            value,
            tone: best.tone,
            note,
            bar: g.size === 'wide' ? barOf(strip) : null,
            sheet: { title: `${name}: ${value}`, lead: strip?.text ?? '', rows: own },
        };
    });
}

/**
 * Panel, ktorý otvára ťuknutie na dlaždicu (`key` dlaždice, v appke uložený v stave): skupina so
 * zoznamom vecí, alebo jedna vec. Iné id (napr. zo starého kroku v histórii) nič neotvorí.
 * @param {{ groups: ReturnType<typeof groupsOf>, items: ReturnType<typeof mozemItems> }} m @param {string | null} key
 * @returns {{ key: string, group: NonNullable<ReturnType<typeof groupsOf>[number]['sheet']> } | { key: string, item: ReturnType<typeof mozemItems>[number] } | null}
 */
export function mozemSheetOf(m, key) {
    if (!key) return null;
    const sheet = m.groups.find((g) => g.key === key)?.sheet;
    if (sheet) return { key, group: sheet };
    const item = m.items.find((it) => it.id === key);
    return item ? { key, item } : null;
}

/**
 * Pás dňa v dlaždici: okno slnka a „teraz“ v percentách dňa so slnkom (stripGeometry) a pod ním
 * časy kraja, stredu a konca. Bez okna pás nie je.
 * @param {Strip | null} strip
 */
function barOf(strip) {
    if (!strip || !strip.width) return null;
    const label = (/** @type {number} */ m) => `${Math.floor(m / 60)}:${pad2(m % 60)}`;
    const ticks = [strip.from, (strip.from + strip.to) / 2, strip.to].map(label);
    return { left: strip.left, width: strip.width, now: strip.now, ticks };
}

/**
 * Veci karty s odpoveďou. Bez predpovede (`ctx` null) karta o žiadnej nevie. Pri
 * veci ostáva aj odpoveď (`answer`) - z nej appka skladá dlaždice skupín.
 * @param {PlanInput} input @param {DayCtx | null} ctx @param {Voice} [voice]
 */
function mozemItems(input, ctx, voice = 'drzy') {
    return MOZEM_ITEMS.map((item) => {
        /** @type {Answer} */ const answer = ctx ? itemAnswer(item, ctx) : { kind: 'unk' };
        const text = mozemItemText(item, answer, ctx && { ctx, cost: itemCost(item, ctx) }, voice);
        return { id: item.id, ...text, title: `${text.name}: ${text.short}`, answer };
    });
}

/**
 * Hlavička karty: stav, veľké slovo a veta podľa Plánu dňa, pás dňa pre dlaždicu podľa slnka
 * (zelenej). `typicalKwp` je výkon typickej strechy, keď appka panely nepozná (null s vlastnými panelmi).
 * @param {PlanInput} input @param {DayCtx} ctx @param {Voice} voice @param {number | null} typicalKwp
 * @param {{ rows: PlanDnaRow[], den: ReturnType<typeof denOf> }} day riadky Plánu dňa (bez spotrebičov doma
 *   prázdne - vtedy stav podľa slnka) a čo veľké slovo povie o celom dni
 */
function dayHead(input, ctx, voice, typicalKwp, { rows, den }) {
    const general = planWindows(ctx.plan, (s) => s.tier === 'green');
    const sun = dayState(general, ctx.nowMin, sunUp(input.now, input.site));
    const { window } = sun;
    const state = rows.length ? planState(rows, sun.state) : sun.state;
    const nextDay = laterDay(ctx, ctx.th.lowKw, true).day;
    const facts = heroFacts(input, ctx);
    const slot = ctx.plan[Math.floor(ctx.nowMin / TARIFF_LIMITS.stepMin)];
    const plan = rows.length ? planHero(rows) : null;
    const sunLeft = sun.state === 'go' || sun.state === 'wait';
    const data = { ctx, window, nextDay, ...facts, typicalKwp, plan, sunLeft };
    return {
        state,
        word: denWord(den, voice),
        den,
        hero: mozemHeroText(state, data, voice),
        // Tá istá veta bez spotrebičov a časov - tie povie Plán dňa hneď pod ňou.
        say: mozemHeroText(state, { ...data, plan: null }, voice).lead,
        stavInfo: mozemChipInfo(state, data, voice),
        net: netRun(input, ctx),
        strip: { ...stripGeometry(window, ctx.nowMin, ctx.span), text: mozemStripText(sun.state, { ctx, window, nextDay }) },
        facts: {
            level: slot.level,
            window,
            liveKw: facts.live ? facts.kwNow : null,
            planKw: Number.isFinite(slot.kw) ? slot.kw : 0,
        },
    };
}

/**
 * Čísla do hlavičky: výkon teraz (živý len z čerstvého merania, inak z plánu), odkedy meranie
 * mlčí (null, keď nemlčí alebo nie je), či je dnešok nameraný, a výroba dnes a zajtra.
 * @param {PlanInput} input @param {DayCtx} ctx
 */
function heroFacts(input, ctx) {
    const slot = ctx.plan[Math.floor(ctx.nowMin / TARIFF_LIMITS.stepMin)];
    const live = freshPowerKw(input);
    const tomorrow = ctx.later.find((x) => x.index === 1);
    return {
        live: live !== null,
        silentSince: silentSince(input),
        ...todayFacts(input),
        kwNow: live ?? (slot && Number.isFinite(slot.kw) ? slot.kw : 0),
        tomorrowKwh: tomorrow ? tomorrow.day.kwhTotal : null,
    };
}

/** Odkedy meranie mlčí (čas posledného merania), alebo null, keď nemlčí alebo nie je. @param {PlanInput} input */
function silentSince({ now, pv, site, pokusAt }) {
    if (!pv) return null;
    const fresh = pvFreshness({ now, pv, site, pokusAt });
    return fresh.stale ? fresh.time : null;
}

/** Výroba dnes: z merania, inak z predpovede - a ktoré to je. @param {PlanInput} input */
function todayFacts({ pv, forecast }) {
    const kwh = pv ? pv.dailyEnergyKwh : null;
    if (Number.isFinite(kwh)) return { measured: true, todayKwh: /** @type {number} */ (kwh) };
    return { measured: false, todayKwh: forecast?.days[0]?.kwhTotal ?? null };
}

/**
 * Štítok pod číslom na karte Teraz. `key` hovorí, ktorý to je (stav dňa, alebo cena siete) - podľa
 * neho appka vie, ktorý panel je otvorený; `info` je obsah panelu, ktorý ťuknutie otvorí.
 * @typedef {{ key: 'stav' | 'siet', text: string, tone: 'go' | 'plain' | 'cheap' | 'costly',
 *   info: import('./messages-core.js').ChipInfo }} Chip
 */
/** @typedef {{ to: number, next: { level: import('./config.js').PriceLevel, to: number } | null }} NetRun */

/**
 * Pásmo siete teraz podľa plánu dňa: dokedy trvá a čo príde po ňom (aj s koncom), v minútach od
 * dnešnej polnoci. Za polnocou pokračuje zajtrajším rozvrhom tarify - lacná noc trvá do rána,
 * nie do 24:00. Na konci zajtrajška sa končí aj pásmo (`next` null).
 * @param {PlanInput} input @param {DayCtx} ctx @returns {NetRun}
 */
function netRun(input, ctx) {
    const step = TARIFF_LIMITS.stepMin;
    const tomorrow = addDays(localDateKey(input.now, input.site.timezone), 1);
    const later = slotsOf(scheduleFor(input.tariff, tomorrow)).map((id) => bandById(input.tariff, id).level);
    const levels = [...ctx.plan.map((s) => s.level), ...later];
    const runEnd = (/** @type {number} */ i) => {
        let j = i;
        while (j < levels.length && levels[j] === levels[i]) j++;
        return j;
    };
    const end = runEnd(Math.floor(ctx.nowMin / step));
    return { to: end * step, next: end < levels.length ? { level: levels[end], to: runEnd(end) * step } : null };
}

/**
 * Štítky k odpovedi: stav (ÁNO, NESKÔR…) a lacná či drahá sieť teraz, každý s obsahom svojho
 * panelu. Bez údajov dňa len stav.
 * @param {MozemState} state @param {{ level: import('./config.js').PriceLevel } | null} facts @param {Voice} voice
 * @param {{ stavInfo: import('./messages-core.js').ChipInfo, net: NetRun | null }} info panel stavu a pásmo siete teraz
 * @returns {Chip[]}
 */
function chipsOf(state, facts, voice, { stavInfo, net }) {
    const MOZEM_CHIPS = voiceTexts(voice).MOZEM_CHIPS;
    /** @type {Chip[]} */ const chips = [];
    if (MOZEM_CHIPS[state]) chips.push({ key: 'stav', text: MOZEM_CHIPS[state], tone: state === 'go' ? 'go' : 'plain', info: stavInfo });
    const level = facts?.level;
    if (net && (level === 'lacna' || level === 'draha')) {
        const tone = level === 'lacna' ? 'cheap' : 'costly';
        chips.push({ key: 'siet', text: MOZEM_CHIPS[level], tone, info: mozemNetInfo(level, net, voice) });
    }
    return chips;
}

/**
 * Čo dá strecha za celý dnešok: predpoveď dňa, a keď už meranie nabehlo viac, to nabehnuté. Po západe
 * slnka len namerané.
 * V jednotkách, ktoré pozná každý (tie isté prepočty ako Štatistika). Bez predpovede na dnešok null.
 * @param {PlanInput} input
 */
export function dnesDay({ now, site, pv, forecast }) {
    const day = forecast?.days.find((d) => d.date === localDateKey(now, site.timezone));
    if (!day) return null;
    const measured = pv && Number.isFinite(pv.dailyEnergyKwh) ? /** @type {number} */ (pv.dailyEnergyKwh) : null;
    // Po západe slnka je deň uzavretý: namerané je celá výroba, aj keď predpoveď sľubovala viac.
    const kwh = measured !== null && denFaza({ now, site }) === 'vecer' ? measured : Math.max(day.kwhTotal, measured ?? 0);
    return { kwh, phones: kwh / EVERYDAY.phoneChargeKwh, km: kwh * EVERYDAY.evKmPerKwh, co2Kg: co2SavedKg(kwh) };
}

/** Texty dneška pre kartu Dnes; bez odpovede karty (`ctx` null) či predpovede na dnešok null. @param {PlanInput} input @param {DayCtx | null} ctx */
function dnesDayModel(input, ctx) {
    const d = ctx && dnesDay(input);
    return d ? dnesDayText(d) : null;
}
