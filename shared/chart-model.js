// Geometria grafov ako čisté dáta: body v súradniciach viewBoxu, mriežky, tooltipy.
// Kreslenie (SVG reťazce) je vo web/svg.js; tu nie je nič, čo by potrebovalo DOM.

import { MINUTES_PER_DAY } from './config.js';
import { weekDateLabel, weekDayName, weekDayShort } from './format.js';

/** @typedef {{ x: number, y: number }} Pt */
/** @typedef {import('./solar.js').HourPoint} HourPoint */
/** @typedef {import('./solar.js').ForecastDay} ForecastDay */
/** @typedef {{ w: number, h: number, padL: number, padR: number, padT: number, padB: number, hourStep: number, xLabelGap: number, yAxis: boolean }} Dims */

// Produkčné okno dňa: os X grafu priebehu aj stĺpce heatmapy. Jedno pre oba, aby heatmapa
// neukazovala hodinu, ktorú graf pod ňou nemá. Od piatej, lebo v lete sa v Dvoranoch vyrába
// už vtedy (východ slnka ~4:50).
export const HOUR_RANGE = { min: 5, max: 21 };
export const WEEK_HOURS = Array.from({ length: HOUR_RANGE.max - HOUR_RANGE.min + 1 }, (_, i) => HOUR_RANGE.min + i);

/**
 * Lineárna interpolácia poľa bodov podľa poľa `xField` (predvolene hour).
 * @template {Record<string, any>} T
 * @param {T[]} pts @param {number} x @param {string} [field] @param {string} [xField]
 */
export function interpolate(pts, x, field = 'kw', xField = 'hour') {
    if (!pts.length) return 0;
    if (x <= pts[0][xField]) return pts[0][field];
    const last = pts[pts.length - 1];
    if (x >= last[xField]) return last[field];
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        if (x >= a[xField] && x <= b[xField]) {
            const t = (x - a[xField]) / (b[xField] - a[xField] || 1);
            return a[field] + (b[field] - a[field]) * t;
        }
    }
    return last[field];
}

/**
 * Krok vodorovnej mriežky: najjemnejší s okrúhlymi číslami, ktorý sa na plátno ešte zmestí.
 * `maxLines` obmedzuje počet čiar podľa dostupnej výšky - na nízkom plátne by ich desať
 * splynulo do jedného stĺpca číslic. Slúži kW v grafe priebehu aj kWh v dennej výrobe, preto
 * rad siaha od štvrtín po tisícky: od malej strechy v zamračenom týždni po stovky kWh za deň.
 * @param {number} maxKw @param {number} [maxLines]
 */
export function kwGridStep(maxKw, maxLines = 10) {
    const limit = Math.max(1, Math.min(10, Math.floor(maxLines)));
    const steps = [0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
    return steps.find((s) => maxKw / s <= limit) || steps[steps.length - 1];
}

/** Hodina v produkčnom okne grafu (HOUR_RANGE). @param {number} hour */
const inHours = (hour) => hour >= HOUR_RANGE.min && hour <= HOUR_RANGE.max;

/** Body dňa v produkčnom okne grafu (HOUR_RANGE) - mimo neho sú len nulové nočné hodiny,
 * ktoré by skreslili špičku aj text správy dňa. @template {{ hour: number }} T @param {T[]} pts */
export function visibleHours(pts) {
    return pts.filter((p) => inHours(p.hour));
}

// ---- Kruh dňa (rozvrh tarify) -----------------------------------------------------
// Kruh sa číta ako 24-hodinový: poludnie hore, 06:00 vľavo, 18:00 vpravo, polnoc dole.
// Deň ide v smere hodinových ručičiek, takže slnko prejde zľava cez vrch doprava.
// Kreslí sa ním rozvrh tarify v sprievodcovi a malé prstence tarify v Nastavení.
export const RING = { viewBox: 240, rDay: 106 };

/** Bod na kružnici pre minútu dňa, v jednotkách viewBoxu. @param {number} r @param {number} minutes */
export function ringPoint(r, minutes) {
    const rad = ((minutes / MINUTES_PER_DAY) * 2 + 0.5) * Math.PI;
    const c = RING.viewBox / 2;
    return { x: c + r * Math.cos(rad), y: c + r * Math.sin(rad) };
}

/** Uhol prsta od stredu kruhu -> minúta dňa. Opak ringPoint; polnoc nie je stena,
 * záporný uhol sa obtočí. @param {number} dx @param {number} dy vzdialenosť od stredu */
export function minutesFromAngle(dx, dy) {
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI - 90;
    return Math.round((((deg + 360) % 360) / 360) * MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/**
 * Plán dňa ako oblúky kruhu: susedné štvrťhodiny s rovnakou farbou sú jeden
 * oblúk. Krajné body a príznak dlhého oblúka sú čísla, samotné "d" skladá web/svg.js.
 * @param {Array<{ startMin: number, min: number, tier: import('./config.js').Tier | null }>} plan plán dňa (`dayPlan`)
 */
export function dayRingModel(plan) {
    /** @type {Array<{ startMin: number, min: number, cls: import('./config.js').Tier | null }>} */
    const runs = [];
    for (const s of plan) {
        const last = runs[runs.length - 1];
        if (last && last.cls === s.tier) last.min += s.min;
        else runs.push({ startMin: s.startMin, min: s.min, cls: s.tier });
    }
    // Celý deň jednou farbou (jedna cena bez slnka) sú dva polkruhy: oblúk s takmer totožnými
    // koncami by po zaokrúhlení súradníc mal konce rovnaké a nevykreslil by sa vôbec.
    if (runs.length === 1 && runs[0].min === MINUTES_PER_DAY) {
        const half = MINUTES_PER_DAY / 2;
        runs.splice(0, 1, { startMin: 0, min: half, cls: runs[0].cls }, { startMin: half, min: half, cls: runs[0].cls });
    }
    return runs.map((s) => {
        const to = s.startMin + s.min;
        return {
            cls: s.cls,
            start: ringPoint(RING.rDay, s.startMin),
            end: ringPoint(RING.rDay, to === MINUTES_PER_DAY ? to - 0.01 : to),
            large: s.min > MINUTES_PER_DAY / 2 ? 1 : 0,
        };
    });
}

/**
 * Kruh rozvrhu v sprievodcovi: tie isté oblúky ako malé prstence tarify, k nim rezy medzi pásmami,
 * ryska na každú hodinu a popis každej tretej. Poludnie hore.
 * @param {Array<{ startMin: number, min: number, tier: import('./config.js').Tier | null }>} segs rozvrh ako farby (`scheduleTiers`)
 */
export function tariffRingModel(segs) {
    const r = RING.rDay;
    const cut = (/** @type {number} */ m) => ({ a: ringPoint(r - 15, m), b: ringPoint(r + 15, m) });
    return {
        arcs: dayRingModel(segs),
        cuts: segs.length > 1 ? segs.map((s) => cut(s.startMin)) : [],
        ticks: Array.from({ length: 24 }, (_, h) => ({ a: ringPoint(r + 16, h * 60), b: ringPoint(h % 6 ? r + 20 : r + 24, h * 60) })),
        hours: Array.from({ length: 8 }, (_, i) => ({ label: String(i * 3), at: ringPoint(r - 32, i * 180) })),
    };
}

/**
 * Hranica medzi nameraným a predpovedaným: posledný nameraný bod, nikdy v budúcnosti.
 * @param {Array<{hour: number, kw: number}> | null | undefined} realCurve @param {number} nowMinutes
 */
export function realCurveBoundary(realCurve, nowMinutes) {
    if (!realCurve || !realCurve.length) return null;
    return Math.min(realCurve[realCurve.length - 1].hour * 60, nowMinutes);
}

/**
 * Výkon v ľubovoľnej minúte dňa: po hranicu meranie, za ňou predpoveď; NaN bez dát.
 * @param {number} minutes @param {Array<{hour: number, kw: number}> | null | undefined} realCurve
 * @param {HourPoint[] | null | undefined} hourlyToday @param {number} nowMinutes
 */
export function dayKwAt(minutes, realCurve, hourlyToday, nowMinutes) {
    const boundary = realCurveBoundary(realCurve, nowMinutes);
    if (boundary !== null && minutes <= boundary) return interpolate(realCurve ?? [], minutes / 60, 'kw');
    if (!hourlyToday || !hourlyToday.length) return NaN;
    return interpolate(hourlyToday, minutes / 60, 'kw');
}

// ---- Karta 7 dní -----------------------------------------------------------------

/** Farebné pásmo bunky heatmapy podľa podielu z maxima (0..1): nízky výkon = červená, vysoký = zelená. @param {number} frac */
function heatBand(frac) {
    if (frac < 1 / 3) return 'red';
    if (frac < 2 / 3) return 'amber';
    return 'green';
}

/**
 * Farebné pásmo celého dňa - tá istá logika ako v heatmape, len o úroveň vyššie: namiesto
 * podielu z najsilnejšej hodiny sa počíta podiel z najsilnejšieho dňa v týždni. Vďaka tomu
 * hovoria stĺpce, rebríček aj heatmapa na jednej obrazovke tou istou mierkou.
 *
 * Deň bez výroby (a týždeň bez jedinej kWh) nemá pásmo - `null` znamená "nefarbiť", rovnako
 * ako pri prázdnej bunke heatmapy. Inak by polárny týždeň vyšiel celý červený.
 * @param {ForecastDay[]} days @returns {('red' | 'amber' | 'green' | null)[]}
 */
export function weekDayTiers(days) {
    const max = Math.max(...days.map((d) => d.kwhTotal), 0);
    return days.map((d) => {
        const frac = max > 0 ? d.kwhTotal / max : 0;
        return frac <= 0.02 ? null : heatBand(frac);
    });
}

/**
 * Najlepší deň týždňa: najviac kWh, pri zhode skorší. Ten istý deň menuje súhrn karty 7 dní
 * weekStatsModel aj nadpis karty 7 dní (shared/sedem-dni.js).
 * @param {Array<{ kwhTotal: number }>} days
 */
export function bestDayIndex(days) {
    return days.reduce((best, d, i) => (d.kwhTotal > days[best].kwhTotal ? i : best), 0);
}

/**
 * Súhrnné čísla karty 7 dní (Dnes/Zajtra/spolu, trend, priebeh dnešnej výroby).
 * @param {ForecastDay[]} days @param {import('./kiosk.js').PvData | null | undefined} pv @param {boolean} tomorrowSunny
 */
export function weekStatsModel(days, pv, tomorrowSunny) {
    const today = days[0];
    const tomorrow = days[1] || null;
    const total = days.reduce((s, d) => s + d.kwhTotal, 0);
    const bestIndex = bestDayIndex(days);
    const best = days[bestIndex];
    // Dnešná nabehnutá výroba proti predpovedi. Iné dni namerané nie sú, takže progress
    // patrí vždy k dnešku. Kiosk, ktorý dennú výrobu neposlal, má null - Number(null) by
    // z neho spravil nameraných 0 kWh.
    const realKwh = pv && Number.isFinite(pv.dailyEnergyKwh) ? pv.dailyEnergyKwh : null;
    const progress = realKwh !== null && today.kwhTotal > 0 ? { realKwh, pct: Math.round((100 * realKwh) / today.kwhTotal) } : null;
    const trendPct = tomorrow && today.kwhTotal > 0 ? Math.round((100 * (tomorrow.kwhTotal - today.kwhTotal)) / today.kwhTotal) : null;
    return {
        today,
        tomorrow,
        tomorrowSunny,
        totalKwh: total,
        avgKwh: total / days.length,
        best: {
            label: weekDayShort(best.date, bestIndex),
            fullLabel: `${weekDayShort(best.date, bestIndex)}${bestIndex > 1 ? ' ' + weekDateLabel(best.date) : ''}`,
            kwh: best.kwhTotal,
        },
        trendPct,
        progress,
    };
}

/**
 * Rebríček dní: prehľad karty 7 dní na mobile. Jeden riadok na deň, v ňom meno, dátum,
 * obloha, výroba a dĺžka pásika.
 *
 * Pásik sa škáluje voči najsilnejšiemu dňu v týždni, nie voči stropu jasnej oblohy: otázka
 * prehľadu je "ktorý deň z týchto siedmich je dobrý", nie "koľko dnes ubrali mraky" - to
 * druhé hovorí využitie v detaile dňa. Znamená to, že aj v škaredom týždni má najsilnejší
 * deň plný pásik; číslo vedľa neho to opravuje.
 * @param {ForecastDay[]} days @param {number} selDay
 */
export function weekListModel(days, selDay) {
    // Týždeň bez jedinej kWh (polárna noc, pokazené dáta) by z delenia urobil NaN a pásiky
    // by zmizli aj s rozložením mriežky - vtedy sú prázdne, čo je pravda o takom týždni.
    const max = Math.max(...days.map((d) => d.kwhTotal), 0);
    const tiers = weekDayTiers(days);
    return days.map((d, i) => ({
        dayIndex: i,
        today: i === 0,
        sel: i === selDay,
        tier: tiers[i],
        name: weekDayName(d.date, i),
        dateLabel: weekDateLabel(d.date),
        cloudAvgPct: d.cloudAvgPct,
        // Celé kWh: pri predpovedi na týždeň je desatina falošná presnosť a v riadku
        // zaberá miesto, ktoré patrí pásiku.
        kwh: Math.round(d.kwhTotal),
        barPct: max > 0 ? Math.round((100 * d.kwhTotal) / max) : 0,
    }));
}

/** Percento využitia jasnej oblohy pre deň. @param {ForecastDay} day */
export function usePct(day) {
    return day.clearKwhTotal > 0 ? Math.round((100 * day.kwhTotal) / day.clearKwhTotal) : null;
}

// ---- Sprievodca nastavením: kompas, sklon strechy, mriežka panelov -----------------
// Kompas sa číta ako mapa: sever hore, azimut v smere hodinových ručičiek (90 = východ vpravo).

export const COMPASS = { viewBox: 300, rInner: 74, rOuter: 124, rLabel: 99, rSun: 138, sectorDeg: 45 };

/** Bod na kružnici kompasu pre azimut, v jednotkách viewBoxu. @param {number} azDeg @param {number} r @param {number} [c] stred */
export function compassPoint(azDeg, r, c = COMPASS.viewBox / 2) {
    const rad = (azDeg * Math.PI) / 180;
    return { x: c + r * Math.sin(rad), y: c - r * Math.cos(rad) };
}

/**
 * Ružica plôch v karte elektrárne (Nastavenie a zhrnutie sprievodcu). Plocha je výsek široký
 * sectorDeg medzi rMin a rMax, číslo panelov stojí za jeho špičkou, písmená smerov na rLabel
 * za obručou rRing. Text má v kresbe veľkosť, ktorá aj pri 112 px ostane nad 10 px.
 */
export const PLANES_ROSE = { viewBox: 118, rRing: 45, rMin: 8, rMax: 23, rLabel: 53, sectorDeg: 33, tick: 3 };

/** Uhlová vzdialenosť dvoch azimutov, 0-180°. @param {number} a @param {number} b */
const angDist = (a, b) => {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
};

/**
 * Ružica plôch: výsek na každú plochu v smere, kam je otočená, s plochou úmernou počtu panelov
 * (polomer rastie s odmocninou), a číslo panelov za špičkou. Plochy bližšie ako šírka výseku sa
 * spoja do jedného výseku so súčtom, inak by sa prekryli (azimut z odkazu nemusí ísť po 45°).
 * Hlavné sú všetky výseky s najväčším počtom. Polovica obruče na strane poludnia je zvýraznená
 * a na poludní stojí slnko - na severnej pologuli na juhu, na južnej na severe. Písmená: sever
 * hore vždy, strana poludnia na slnku, smery plôch tučne (`az` po 45°, skratku dá kabát).
 * @param {Array<{ panels: number, azimuthDeg: number }>} strings @param {boolean} south lokalita na južnej pologuli
 */
export function planesRoseModel(strings, south) {
    const { viewBox, rRing, rMin, rMax, rLabel, sectorDeg, tick } = PLANES_ROSE;
    const c = viewBox / 2;
    const at = (/** @type {number} */ az, /** @type {number} */ r) => compassPoint(az, r, c);
    /** @type {Array<{ az: number, panels: number }>} */
    const groups = [];
    const panels = (/** @type {number} */ p) => (Number.isFinite(p) && p > 0 ? p : 0);
    for (const s of [...strings].sort((p, q) => panels(q.panels) - panels(p.panels))) {
        const g = groups.find((x) => angDist(x.az, s.azimuthDeg) < sectorDeg);
        if (g) g.panels += panels(s.panels);
        else groups.push({ az: s.azimuthDeg, panels: panels(s.panels) });
    }
    const max = Math.max(...groups.map((g) => g.panels), 0);
    const half = sectorDeg / 2;
    const wedges = groups
        .map((g) => {
            const r1 = rMin + (rMax - rMin) * (max > 0 ? Math.sqrt(g.panels / max) : 0);
            // Číslo za špičkou; pri boku ešte o polovicu šírky textu (asi 4,2 na číslicu), aby
            // nezasahovalo do výseku.
            const side = Math.abs(Math.sin((g.az * Math.PI) / 180));
            const text = String(g.panels);
            return {
                r0: rMin,
                r1,
                outer: [at(g.az - half, r1), at(g.az + half, r1)],
                inner: [at(g.az + half, rMin), at(g.az - half, rMin)],
                num: { ...at(g.az, r1 + 7 + side * text.length * 4.2), text },
                main: max > 0 && g.panels === max,
            };
        })
        // Hlavné idú navrch.
        .sort((p, q) => Number(p.main) - Number(q.main));
    const noon = south ? 0 : 180;
    /** @type {Map<number, 'dim' | 'strong' | 'sun'>} */
    const letters = new Map([[0, 'dim']]);
    for (const g of groups) letters.set((Math.round((((g.az % 360) + 360) % 360) / 45) % 8) * 45, 'strong');
    letters.set(noon, 'sun');
    return {
        c,
        rRing,
        wedges,
        ticks: Array.from({ length: 8 }, (_, i) => ({ a: at(i * 45, rRing - tick), b: at(i * 45, rRing + tick), major: i % 2 === 0 })),
        // Polovica obruče od východu cez poludnie na západ, v dvoch oblúkoch (ako compassModel).
        noonArc: [at(90, rRing), at(noon, rRing), at(270, rRing)],
        noonSweep: south ? 0 : 1,
        sun: at(noon, rLabel),
        letters: [...letters].map(([az, kind]) => ({ ...at(az, rLabel), az, kind })),
    };
}

/**
 * Kompas smeru plochy: osem výsekov, dráha slnka a otočenie strechy v strede. Dráha ide cez
 * deň z východu cez poludnie na západ - na severnej pologuli cez juh, na južnej cez sever.
 * `buttons` sú polohy tlačidiel v percentách obalu, takže appka nemusí poznať veľkosť kompasu.
 * @param {number} azDeg zvolený smer @param {boolean} south lokalita na južnej pologuli
 */
export function compassModel(azDeg, south) {
    const { rInner, rOuter, rLabel, rSun, sectorDeg, viewBox } = COMPASS;
    const half = sectorDeg / 2;
    const sectors = Array.from({ length: 360 / sectorDeg }, (_, i) => {
        const az = i * sectorDeg;
        const label = compassPoint(az, rLabel);
        return {
            az,
            on: az === azDeg,
            outer: [compassPoint(az - half, rOuter), compassPoint(az + half, rOuter)],
            inner: [compassPoint(az + half, rInner), compassPoint(az - half, rInner)],
            button: { left: (label.x / viewBox) * 100, top: (label.y / viewBox) * 100 },
        };
    });
    const noon = south ? 0 : 180;
    return {
        sectors,
        rInner,
        rOuter,
        rSun,
        // Oblúk slnka v dvoch polovičkách (východ - poludnie - západ): jeden oblúk cez 180° by
        // nemal jednoznačný smer.
        sunPath: [compassPoint(90, rSun), compassPoint(noon, rSun), compassPoint(270, rSun)],
        // Na severnej pologuli ide oblúk v smere hodinových ručičiek (cez juh), na južnej proti.
        sunSweep: south ? 0 : 1,
        sun: compassPoint(noon, rSun),
        // Strecha je nakreslená s panelmi na juh (dole); otočí sa o rozdiel oproti juhu.
        rotateDeg: azDeg - 180,
    };
}

/**
 * Nákres strechy z boku pre daný sklon: odkvap vpravo, rovina panelov stúpa doľava, slnko
 * vpravo hore svieti na ňu. Súradnice v jednotkách viewBoxu 320 × 190.
 * @param {number} tiltDeg
 */
export function tiltModel(tiltDeg) {
    const pivot = { x: 250, y: 112 };
    const rad = (tiltDeg * Math.PI) / 180;
    const at = (/** @type {number} */ r, /** @type {number} */ a = rad) => ({ x: pivot.x - r * Math.cos(a), y: pivot.y - r * Math.sin(a) });
    const end = at(104);
    return {
        pivot,
        end,
        ground: 172,
        wallLeft: 150,
        mid: { x: (pivot.x + end.x) / 2, y: (pivot.y + end.y) / 2 },
        arc: tiltDeg > 2 ? { from: at(40, 0), to: at(40), r: 40 } : null,
        label: { ...at(60, rad / 2), y: at(60, rad / 2).y + 4 },
        sun: { x: 296, y: 30 },
    };
}

/**
 * Mriežka panelov jednej plochy - obrázok namiesto čísla, aby bol preklep (61 namiesto 16)
 * vidno hneď. Kreslí sa najviac 40 panelov, zvyšok je číslo.
 * @param {number} count
 */
export function panelGridModel(count) {
    const shown = Math.max(0, Math.min(Number.isFinite(count) ? count : 0, 40));
    const cols = 10;
    const size = { w: 24, h: 34, gap: 5 };
    const cells = Array.from({ length: shown }, (_, i) => ({
        x: (i % cols) * (size.w + size.gap) + 3,
        y: Math.floor(i / cols) * (size.h + size.gap) + 3,
    }));
    const rows = Math.max(1, Math.ceil(shown / cols));
    const more = Number.isFinite(count) && count > shown ? count - shown : 0;
    return { cells, w: size.w, h: size.h, width: 296, height: rows * (size.h + size.gap) + 6 + (more ? 14 : 0), more };
}
