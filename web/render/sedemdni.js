// Karta 7 dní: súhrn, heatmapa, denné stĺpce, priebeh vybraného dňa, tabuľka, správa.
// Na mobile je to rozdelené na dve obrazovky - prehľad dní a detail vybraného dňa (weekDetail
// v stave); na širokej obrazovke je miesta dosť a vidno všetko naraz.
//
// Prehľad dní má dve podoby a vidno vždy práve jednu. Na mobile je to rebríček (jedno veľké
// číslo za týždeň a sedem riadkov s pásikmi), na širokej obrazovke bubliny Dnes/Zajtra/spolu
// a tabuľka so všetkými stĺpcami. Údaje, ktoré z mobilného prehľadu odišli (využitie, špička,
// oblačnosť v percentách), ostávajú o ťuknutie ďalej v detaile dňa.

import {
    bestDayIndex,
    chartDims,
    fillDims,
    forecastChartModel,
    HEAT_LEGEND,
    usePct,
    weekBarsModel,
    weekDayTiers,
    weekHeatModel,
    weekListModel,
    weekStatsModel,
} from '../../shared/chart-model.js';
import { installedKw } from '../../shared/config.js';
import { forecastDayPlan } from '../../shared/day-plan.js';
import {
    escapeHtml,
    fmt1,
    hourLabel,
    kwpText,
    weekDateLabel,
    weekDayLong,
    weekDayName,
    weekDayPosition,
    weekDayShort,
} from '../../shared/format.js';
import { dayWindowCard, EMPTY_MESSAGES, weekMessage } from '../../shared/messages.js';
import { dayHeadSub, dayStripModel, dayWeather, mainWindow, sedemDayChart, sunWindows, windowBand } from '../../shared/sedem-dni.js';
import { localMinutes } from '../../shared/solar.js';
import { ICON_BACK, ICON_CLOUD, ICON_NEXT, ICON_PARTLY, ICON_SUN } from '../icons.js';
import { dayChartHtml, legendHtml } from '../day-chart.js';
import { writeHtml } from '../memo.js';
import { forecastChartSvg, weekBarsSvg, weekHeatSvg } from '../svg.js';

/** @typedef {import('../../shared/solar.js').ForecastDay} ForecastDay */

/**
 * Plátno grafu: keď poznáme skutočný rozmer karty, kreslíme presne naň (viewBox potom sedí
 * s pixelmi 1:1, takže sa nič neskresľuje ani nezostáva prázdne). Kým rozmer nepoznáme,
 * platí pevné plátno podľa šírky okna.
 * @param {import('../state.js').AppState} state @param {string} key
 */
function dimsFor(state, key) {
    // Len na širokej karte: fillDims berie okraje zo širokého plátna (os Y, väčšie odsadenie),
    // na mobile by tým prepísalo úmyselne úspornejšie rozloženie z chartDims(false).
    const size = state.wide ? state.chartSizes[key] : null;
    return size ? fillDims(size.w, size.h) : chartDims(state.wide);
}

/** Vstup krivky výroby vybraného dňa - zdieľaný s tooltipom. Detail dňa na mobile ju nemá, je
 * v ňom graf dňa (renderCurve).
 * @param {import('../state.js').AppState} state */
export function weekCurveModel(state) {
    const days = state.forecast ? state.forecast.days : [];
    const day = days[state.weekSelDay];
    if (!day) return null;
    const isToday = state.weekSelDay === 0;
    const nowHour = isToday ? localMinutes(state.now, state.site.timezone) / 60 : null;
    const realPts = isToday && state.pv ? state.pv.realCurveToday : [];
    return forecastChartModel({ pts: day.hourly, realPts, nowHour, dims: dimsFor(state, 'weekCurve') });
}

/** Plán vybraného dňa po štvrťhodinách (dnešok presne dayPlan, ako ciferník). @param {import('../state.js').AppState} state */
function dayPlanOf(state) {
    const forecast = /** @type {import('../../shared/solar.js').Forecast} */ (state.forecast);
    return forecastDayPlan({ ...state, forecast }, state.weekSelDay);
}

/** @param {boolean} sunny @param {number | null} cloudPct */
function weatherBadge(sunny, cloudPct) {
    if (sunny) return `<span class="stat-badge sun">${ICON_SUN}slnečno</span>`;
    if (cloudPct == null) return '';
    return `<span class="stat-badge cloud">${ICON_CLOUD}${Math.round(cloudPct)} % oblačno</span>`;
}

/** @param {ForecastDay} day */
function peakMetaLine(day) {
    if (!Number.isFinite(day.peakKw) || day.peakHour == null) return '';
    const pct = usePct(day);
    let html = `<span>⚡ <b>${fmt1(day.peakKw)} kW</b> o ${hourLabel(day.peakHour)}</span>`;
    if (pct != null) html += `<span>${pct} % z jasnej oblohy</span>`;
    return html;
}

/** @param {number | null} pct */
function trendBadge(pct) {
    if (pct === null || pct === 0) return '';
    return pct > 0 ? `<span class="trend up">▲ ${pct} %</span>` : `<span class="trend down">▼ ${Math.abs(pct)} %</span>`;
}

/** @param {ReturnType<typeof weekStatsModel>} s @param {import('../dom.js').Dom} dom @param {boolean} detail */
function renderStats(s, dom, detail) {
    dom.weekToday.textContent = fmt1(s.today.kwhTotal);
    dom.weekTodayBadge.innerHTML = weatherBadge(false, s.today.cloudAvgPct);
    dom.weekTodayMeta.innerHTML = peakMetaLine(s.today);
    dom.weekTodayProgress.classList.toggle('has-data', !!s.progress);
    if (s.progress) {
        dom.weekTodayProgressFill.style.width = `${Math.max(0, Math.min(100, s.progress.pct))}%`;
        dom.weekTodayProgressTxt.innerHTML = `doteraz <b>${fmt1(s.progress.realKwh)} kWh</b>`;
        dom.weekTodayProgressPct.innerHTML = `<b>${s.progress.pct} %</b> z predpovede`;
    }
    dom.weekTomorrow.textContent = s.tomorrow ? fmt1(s.tomorrow.kwhTotal) : '–';
    dom.weekTomorrowBadge.innerHTML = s.tomorrow ? weatherBadge(s.tomorrowSunny, s.tomorrow.cloudAvgPct) : '';
    dom.weekTomorrowMeta.innerHTML = s.tomorrow ? peakMetaLine(s.tomorrow) : '';
    dom.weekTomorrowTrend.innerHTML = trendBadge(s.trendPct);
    dom.weekTotal.textContent = String(Math.round(s.totalKwh));
    dom.weekTotalMeta.innerHTML = `<span>ø <b>${fmt1(s.avgKwh)} kWh</b>/deň</span><span>najlepší: <b>${escapeHtml(s.best.label)}</b></span>`;
    // Najsilnejší deň hovorí o celom týždni - na detaile dňa ho už povedala správa pod
    // prehľadom dní, tam by bol druhýkrát.
    dom.weekBarsStat.innerHTML =
        `<span>Spolu za 7 dní <b>${fmt1(s.totalKwh)} kWh</b></span><span>Priemer <b>${fmt1(s.avgKwh)} kWh/deň</b></span>` +
        (detail ? '' : `<span>Najsilnejší deň <b>${escapeHtml(s.best.fullLabel)} · ${fmt1(s.best.kwh)} kWh</b></span>`);
}

/** @param {number | null} cloudPct */
function skyCell(cloudPct) {
    // Aj neznáma obloha vracia ten istý obal: v rebríčku je bunka mriežky a holý text by
    // stĺpce rozhodil.
    if (cloudPct == null) return '<span class="cloud-cell">–</span>';
    if (cloudPct < 30) return `<span class="cloud-cell sun" title="slnečno">${ICON_SUN}</span>`;
    if (cloudPct < 70) return `<span class="cloud-cell partly" title="polooblačno">${ICON_PARTLY}</span>`;
    return `<span class="cloud-cell cloud" title="zamračené">${ICON_CLOUD}</span>`;
}

/**
 * Odtieň percenta využitia: silný deň (od 80 % stropu jasnej oblohy) svieti, slabý (pod
 * 50 %) stmavne. Ide o to, aby sa dobrý deň dal v tabuľke nájsť očami bez čítania čísel.
 * @param {number | null} pct
 */
export function useTier(pct) {
    if (pct == null) return '';
    if (pct >= 80) return ' use-hi';
    return pct < 50 ? ' use-lo' : '';
}

/** @param {ForecastDay[]} days @param {number} sel @param {import('../dom.js').Dom} dom */
function renderTableAndTabs(days, sel, dom) {
    writeHtml(
        dom.weekDayTabs,
        days
            .map(
                (d, i) =>
                    `<button type="button" role="tab" class="utab${i === sel ? ' active' : ''}" aria-selected="${i === sel}" data-day-index="${i}">${weekDayShort(d.date, i)}</button>`,
            )
            .join(''),
        'weekDayTabs',
    );
    const tiers = weekDayTiers(days);
    const rows = days
        .map((d, i) => {
            const pct = usePct(d);
            const dateSub = i > 1 ? `<span class="sub">${weekDateLabel(d.date)}</span>` : '';
            const peakAt = d.peakHour == null ? '–' : `o ${hourLabel(d.peakHour)}`;
            return (
                `<tr class="${i === 0 ? 'today' : ''}${i === sel ? ' sel' : ''}" data-day-index="${i}"><td>${weekDayShort(d.date, i)}${dateSub}</td>` +
                `<td class="${tiers[i] ? `tier-${tiers[i]}` : ''}">${fmt1(d.kwhTotal)} kWh</td><td class="mid">${skyCell(d.cloudAvgPct)}</td><td class="mid${useTier(pct)}">${pct == null ? '–' : `${pct} %`}</td>` +
                `<td>${fmt1(d.peakKw)} kW<span class="sub">${peakAt}</span></td></tr>`
            );
        })
        .join('');
    writeHtml(dom.weekTbody, rows, 'weekTbody');
}

/**
 * Rebríček dní - prehľad karty na mobile. Hore bublina so súčtom za týždeň (je to tlačidlo
 * a otvára detail týždňa), pod ňou karta s riadkom na deň: meno s dátumom, obloha, pás okien
 * a výroba. Riadok je tlačidlo, otvára detail toho dňa.
 *
 * Farby sú tie isté ako v karte 7 dní novej appky (shared/sedem-dni.js): pás ide cez produkčné
 * okno dňa a zelené sú v ňom úseky, kedy je ideálne pustiť veľké spotrebiče (zelené štvrťhodiny
 * plánu dňa - slnko aj tarifa). Deň bez okna má pás prázdny. Stĺpčeky v súčte týždňa sú
 * zmenšené stĺpce z detailu týždňa: výška aj farba je pásmo dňa (weekDayTiers). Najlepší deň týždňa (najviac kWh, bestDayIndex) má výkon podčiarknutý zelenou linkou.
 *
 * Dnešok tu nemá vlastnú triedu: v rebríčku stojí vždy prvý a volá sa "Dnes", takže niet
 * čo zvýrazňovať. Príznak `r.today` z modelu ostáva, značí sa ním prepínač dní a tabuľka.
 * @param {ReturnType<typeof weekStatsModel>} s @param {ReturnType<typeof weekListModel>} rows
 * @param {Array<Array<{ left: number, width: number }>>} bands zelené úseky pásu pre každý deň
 * @param {number} best index najlepšieho dňa
 * @param {import('../dom.js').Dom} dom
 */
function renderList(s, rows, bands, best, dom) {
    dom.weekListTotal.textContent = String(Math.round(s.totalKwh));
    dom.weekListAvg.textContent = `${fmt1(s.avgKwh)} kWh`;
    // Týždeň v malom: tie isté stĺpce ako v detaile týždňa - výška je výroba, farba pásmo dňa.
    dom.weekListSpark.classList.toggle('hidden', !rows.length);
    writeHtml(
        dom.weekListSpark,
        rows.map((r) => `<i class="${r.tier ? `tier-${r.tier}` : ''}" style="height:${Math.max(r.barPct, 4)}%"></i>`).join(''),
        'weekSpark',
    );
    const html = rows
        .map(
            (r, i) =>
                `<button type="button" class="wday${r.sel ? ' sel' : ''}${i === best ? ' best' : ''}" data-day-index="${r.dayIndex}">` +
                `<span class="wday-name">${escapeHtml(r.name)}<span class="wday-date">${escapeHtml(r.dateLabel)}</span></span>` +
                skyCell(r.cloudAvgPct) +
                `<span class="wday-bar">${bands[i].map((b) => `<i style="left:${b.left}%;width:${b.width}%"></i>`).join('')}</span>` +
                `<span class="wday-kwh">${r.kwh}<span class="u">kWh</span></span></button>`,
        )
        .join('');
    writeHtml(dom.weekList, html, 'weekList');
}

/** Info o vybranom dni pod grafom: čo sa čaká, koľko z toho je jasná obloha a - pri dnešku -
 * koľko už nabehlo. To posledné počíta weekStatsModel, rovnako ako pre bublinu Dnes.
 * @param {ForecastDay} day @param {ReturnType<typeof weekStatsModel>['progress']} progress len pri dnešku */
function dayInfo(day, progress) {
    const parts = [];
    if (Number.isFinite(day.peakKw) && day.peakHour != null)
        parts.push(`<span>Špička <b>${fmt1(day.peakKw)} kW</b> o ${hourLabel(day.peakHour)}</span>`);
    parts.push(`<span>Výroba <b>${fmt1(day.kwhTotal)} kWh</b></span>`);
    const pct = usePct(day);
    if (pct != null) parts.push(`<span>Využitie <b>${pct} %</b> z jasnej oblohy</span>`);
    if (day.cloudAvgPct != null) parts.push(`<span>Oblačnosť <b>${Math.round(day.cloudAvgPct)} %</b></span>`);
    if (progress) parts.push(`<span>Doteraz <b>${fmt1(progress.realKwh)} kWh</b> · ${progress.pct} % z predpovede</span>`);
    return parts.join('');
}

/**
 * Tri čísla dňa pod grafom v detaile dňa na mobile: predpoveď, pri dnešku koľko už nabehlo
 * (iný deň priemerná oblačnosť) a špička.
 * @param {ForecastDay} day @param {ReturnType<typeof weekStatsModel>['progress']} progress len pri dnešku
 */
function dayKpis(day, progress) {
    const kpi = (/** @type {string} */ label, /** @type {string} */ v, /** @type {string} */ u, /** @type {string} */ note) =>
        `<span class="kpi"><span>${label}</span><b>${v}<small>${u}</small></b><span>${note}</span></span>`;
    const cloud = day.cloudAvgPct;
    let html = kpi('Predpoveď', fmt1(day.kwhTotal), ' kWh', 'na celý deň');
    html += progress
        ? kpi('Zatiaľ', fmt1(progress.realKwh), ' kWh', `${progress.pct} % plánu`)
        : kpi('Oblačnosť', cloud == null ? '–' : String(Math.round(cloud)), cloud == null ? '' : ' %', 'priemer dňa');
    html +=
        Number.isFinite(day.peakKw) && day.peakHour != null
            ? kpi('Špička', fmt1(day.peakKw), ' kW', `okolo ${hourLabel(day.peakHour)}`)
            : kpi('Špička', '–', '', '');
    return html;
}

/**
 * Karta okna na veľké spotrebiče nad grafom detailu dňa: hlavné okno plánu dňa (to isté ako
 * zelený pás v rebríčku), stav a riadok so spotrebičmi.
 * @param {import('../state.js').AppState} state @param {ForecastDay} day @param {import('../dom.js').Dom} dom
 */
function renderDayWindow(state, day, dom) {
    const nowMin = state.weekSelDay === 0 ? localMinutes(state.now, state.site.timezone) : null;
    const c = dayWindowCard(mainWindow(sunWindows(dayPlanOf(state))), nowMin, day.peakHour ?? null);
    dom.weekDayWindow.innerHTML =
        `<span class="dw-lbl">Okno na veľké spotrebiče</span><span class="dw-val">${escapeHtml(c.value)}</span>` +
        `<span class="dw-state${c.live ? ' live' : ''}">${escapeHtml(c.state)}</span>` +
        (c.note ? `<span class="dw-note">${escapeHtml(c.note)}</span>` : '');
}

/** @param {import('../state.js').AppState} state @param {ForecastDay} day
 * @param {ReturnType<typeof weekStatsModel>['progress']} progress @param {boolean} detail detail dňa na mobile
 * @param {import('../dom.js').Dom} dom */
function renderCurve(state, day, progress, detail, dom) {
    const m = weekCurveModel(state);
    writeHtml(dom.weekCurve, m ? forecastChartSvg(m) : '', 'weekCurve');
    if (m) dom.weekCurve.setAttribute('viewBox', `0 0 ${m.dims.w} ${m.dims.h}`);
    // Detail dňa má namiesto krivky graf dňa ako karta Teraz - ten istý ako v detaile dňa novej
    // appky (sedemDayChart). Ktorý z nich vidno, rozhoduje CSS podľa .detail.
    const chart = detail ? sedemDayChart(/** @type {import('../../shared/sedem-dni.js').SedemData} */ (state), state.weekSelDay) : null;
    writeHtml(dom.weekDayChart, chart ? dayChartHtml(chart) : '', 'weekDayChart');
    writeHtml(dom.weekDayLegend, chart ? legendHtml(chart.legend) : '', 'weekDayLegend');
    if (chart) dom.weekDayChart.setAttribute('aria-label', chart.desc);
    dom.weekDayWindow.classList.toggle('hidden', !detail);
    if (detail) renderDayWindow(state, day, dom);
    // Položka legendy patrí ku krivke - keď sa krivka nekreslí, legenda by ohlasovala
    // niečo, čo v grafe nie je.
    dom.weekCurveLiveLegend.classList.toggle('hidden', !m || !m.real.length);
    const todayProgress = state.weekSelDay === 0 ? progress : null;
    dom.weekCurveStat.innerHTML = detail ? dayKpis(day, todayProgress) : dayInfo(day, todayProgress);
}

/**
 * Prehľad a detaily sú na mobile obrazovky tej istej karty: prehľad má bubliny, tabuľku
 * a správu, detail dňa ukazuje priebeh vybraného dňa a detail týždňa dennú výrobu s mapou.
 * Na širokej obrazovke (`narrow` je false) sú detaily vypnuté a karta ostáva celá pokope.
 * @param {'day' | 'week' | null} detail @param {boolean} narrow @param {boolean} tall
 * @param {import('../dom.js').Dom} dom
 */
function renderView(detail, narrow, tall, dom) {
    dom.panels['7dni'].classList.toggle('detail', !!detail);
    dom.weekHead.classList.toggle('hidden', !!detail);
    // Prehľad dní má dve podoby a vidno vždy práve jednu: na mobile rebríček, na širokej
    // obrazovke bubliny a tabuľku. V detaile nie je ani jedna. Detail existuje len na mobile
    // (viď renderSedemdni), takže bubliny a tabuľku stačí viazať na šírku.
    dom.weekBlockList.classList.toggle('hidden', !narrow || !!detail);
    for (const el of [dom.weekTrio, dom.weekBlockTable]) el.classList.toggle('hidden', narrow);
    // Správa patrí k tomu, čo je otvorené: v detaile dňa hovorí o tom dni, inde o najsilnejšom
    // dni týždňa. V prehľade dní na mobile je len vtedy, keď sa zvyšok zmestil na obrazovku
    // a ostalo na ňu miesto (`tall`, viď WEEK_MSG_MIN_H) - prehľad sa nemá kvôli nej rozscrollovať.
    // V detaile dňa správu nahrádza karta okna na veľké spotrebiče nad grafom.
    dom.weekMsgBlock.classList.toggle('hidden', (narrow && !detail && !tall) || detail === 'day');
    // Detail dňa má svoj riadok heatmapy na časovej osi - celá heatmapa by hovorila to isté.
    const vidno = detail === 'day' ? ['weekBlockCurve'] : detail === 'week' ? ['weekBlockBars', 'weekBlockHeat'] : [];
    for (const key of /** @type {const} */ (['weekBlockHeat', 'weekBlockBars', 'weekBlockCurve']))
        dom[key].classList.toggle('hidden', detail ? !vidno.includes(key) : narrow);
    dom.weekDayHead.classList.toggle('hidden', !detail);
    // Riadok so šípkou späť je v oboch detailoch; čipy dní len v detaile dňa - v detaile týždňa
    // ani v prehľade nie je čo listovať.
    dom.weekDayNav.classList.toggle('hidden', !detail);
    dom.weekDayStrip.classList.toggle('hidden', detail !== 'day');
    // Deň si používateľ vybral klikom v prehľade, prepínač dní nad krivkou je tu navyše.
    dom.weekDayTabs.classList.toggle('hidden', !!detail);
}

/**
 * Nadpis detailu pod riadkom so šípkou späť: deň s ikonou oblohy a slovom pod ním, ako v detaile
 * dňa novej appky (počasie dňa, slovo aj teplota sú z jadra, dayWeather a dayHeadSub). Po prelistovaní
 * dňa ho ohlási čítačka (#week-day-live, mimo pásu, ktorý sa pri ťahu kopíruje).
 * @param {'day' | 'week' | null} detail @param {ForecastDay[]} days @param {number} sel @param {import('../dom.js').Dom} dom */
function renderDayHead(detail, days, sel, dom) {
    const day = days[sel];
    const weather = detail === 'day' ? dayWeather(day) : null;
    dom.weekDayTitle.textContent = detail === 'week' ? 'Celý týždeň' : weekDayLong(day.date, sel);
    writeHtml(dom.weekDayIcon, weather ? SKY_ICONS[weather] : '', 'weekDayIcon');
    const sub = detail === 'day' ? dayHeadSub(day) : '';
    dom.weekDaySub.textContent = sub;
    dom.weekDaySub.classList.toggle('hidden', !sub);
    dom.weekDayLive.textContent = detail === 'day' ? weekDayPosition(day.date, sel, days.length) : '';
}

/** Ikona oblohy pri nadpise dňa. Len ozdoba - počasie slovom nesie riadok pod nadpisom.
 * @type {Record<import('../../shared/sky.js').SkyWeather, string>} */
const SKY_ICONS = { jasno: ICON_SUN, polojasno: ICON_PARTLY, zamracene: ICON_CLOUD };

/**
 * Čipy dní vedľa šípky späť: koľko dní týždeň má, na ktorom stojíme a že sa dá listovať ďalej.
 * Ťah prstom sa sám neohlási, takže bez nich nič nenaznačovalo, že susedný deň je o gesto
 * vedľa. Čip nesie skratku dňa v týždni aj pri dnešku a zajtrajšku - "Dnes" a "Zajtra" stojí
 * v nadpise pod ním. Najlepší deň týždňa tu zelenú linku z prehľadu nemá: pod skratkou dňa
 * mätie - pôsobí ako vybraný deň alebo dnešok.
 *
 * Čip je tlačidlo s data-day-index, takže deň prepne ten istý poslucháč ako riadok
 * rebríčka (viď web/interactions.js) - a s ním aj myš a klávesnica.
 * @param {'day' | 'week' | null} detail @param {ForecastDay[]} days @param {number} sel
 * @param {import('../dom.js').Dom} dom
 */
function renderDayStrip(detail, days, sel, dom) {
    if (detail !== 'day') return;
    const html = dayStripModel(days, sel)
        .map((c) => {
            // aria-current hovorí čítačke to, čo oku hovorí plný čip.
            const teraz = c.current ? ' aria-current="true"' : '';
            return `<button type="button" class="day-chip${c.current ? ' sel' : ''}" data-day-index="${c.index}" aria-label="${escapeHtml(c.label)}"${teraz}>${escapeHtml(c.short)}</button>`;
        })
        .join('');
    writeHtml(dom.weekDayStrip, html, 'dayStrip');
}

/**
 * Susedné dni pod detailom dňa: tlačidlá „‹ Streda 41 kWh“ a „Piatok 32 kWh ›“. Nesú
 * data-day-index, takže deň prelistujú tak ako čip - tým istým dojazdom ako po ťahu prstom
 * (initNavigation v interactions.js).
 * @param {'day' | 'week' | null} detail @param {ForecastDay[]} days @param {number} sel @param {import('../dom.js').Dom} dom
 */
function renderDaySteps(detail, days, sel, dom) {
    const pas = dom.weekDaySteps;
    pas.classList.toggle('hidden', detail !== 'day');
    if (detail !== 'day') return;
    const step = (/** @type {number} */ i, /** @type {'prev' | 'next'} */ kam) => {
        const d = days[i];
        if (!d) return '';
        const sipka = kam === 'prev' ? ICON_BACK : ICON_NEXT;
        const text = `<span class="t"><b>${escapeHtml(weekDayName(d.date, i))}</b><small>${Math.round(d.kwhTotal)} kWh</small></span>`;
        return `<button type="button" class="day-step ${kam}" data-day-index="${i}">${kam === 'prev' ? sipka + text : text + sipka}</button>`;
    };
    writeHtml(pas, step(sel - 1, 'prev') + step(sel + 1, 'next'), 'daySteps');
}

/** Heatmapa celého týždňa: na širokej obrazovke a v detaile týždňa. Detail dňa ju nemá -
 * má graf dňa s oblačnosťou po hodinách.
 * @param {import('../state.js').AppState} state @param {ForecastDay[]} days @param {number} sel
 * @param {import('../dom.js').Dom} dom */
function renderHeat(state, days, sel, dom) {
    // Mapa dostane skutočný rozmer karty len na širokej obrazovke; na mobile si plátno určí sama.
    const size = state.wide ? state.chartSizes.weekHeat : null;
    const heat = weekHeatModel(days, sel, size ? { W: size.w, H: size.h } : null);
    dom.weekHeat.setAttribute('viewBox', `0 0 ${heat.W} ${heat.H}`);
    dom.weekHeat.setAttribute('height', String(heat.H));
    writeHtml(dom.weekHeat, weekHeatSvg(heat), 'weekHeat');
    dom.weekHeatScale.innerHTML = heatScaleHtml(heat.max);
}

/** Stupnica heatmapy od nuly po maximum - pod heatmapou týždňa. @param {number} max */
function heatScaleHtml(max) {
    const sw = HEAT_LEGEND.map((l) => `<i class="tier-${l.tier}" style="opacity:${(0.12 + l.frac * 0.8).toFixed(2)}"></i>`).join('');
    return `<span>0 kW</span><span class="sw">${sw}</span><span>${fmt1(max)} kW</span>`;
}

/** @param {import('../dom.js').Dom} dom */
function renderEmpty(dom) {
    // Prvky, do ktorých render píše cez writeHtml, sa vyprázdňujú tiež cez neho - zápis okolo
    // pamäte by memo nevidelo a po návrate rovnakých dát by ich nechalo prázdne.
    for (const [el, name] of /** @type {const} */ ([
        [dom.weekHeat, 'weekHeat'],
        [dom.weekBars, 'weekBars'],
        [dom.weekCurve, 'weekCurve'],
        [dom.weekDayChart, 'weekDayChart'],
        [dom.weekDayLegend, 'weekDayLegend'],
        [dom.weekDayTabs, 'weekDayTabs'],
        [dom.weekTbody, 'weekTbody'],
        [dom.weekList, 'weekList'],
        [dom.weekListSpark, 'weekSpark'],
    ]))
        writeHtml(el, '', name);
    for (const el of [dom.weekBarsStat, dom.weekCurveStat, dom.weekHeatScale]) el.innerHTML = '';
    for (const el of [dom.weekToday, dom.weekTomorrow, dom.weekTotal, dom.weekListTotal, dom.weekListAvg]) el.textContent = '–';
    dom.weekCurveLiveLegend.classList.add('hidden');
    // Bez dát detail neexistuje (viď renderSedemdni), susedné dni pod ním teda tiež nie.
    dom.weekDaySteps.classList.add('hidden');
    for (const el of [
        dom.weekTodayBadge,
        dom.weekTodayMeta,
        dom.weekTomorrowBadge,
        dom.weekTomorrowMeta,
        dom.weekTomorrowTrend,
        dom.weekTotalMeta,
    ])
        el.innerHTML = '';
    dom.weekTodayProgress.classList.remove('has-data');
    dom.weekMsgTitle.textContent = EMPTY_MESSAGES.week.title;
    dom.weekMsgBody.textContent = EMPTY_MESSAGES.week.body;
}

/**
 * Prehľad týždňa: rebríček dní, mapa hodina × deň, denné stĺpce a tabuľka s prepínačom dní.
 * @param {import('../state.js').AppState} state @param {ForecastDay[]} days @param {number} sel
 * @param {ReturnType<typeof weekStatsModel>} stats @param {import('../dom.js').Dom} dom
 */
function renderWeek(state, days, sel, stats, dom) {
    const forecast = /** @type {import('../../shared/solar.js').Forecast} */ (state.forecast);
    const bands = days.map((_, i) => windowBand(sunWindows(forecastDayPlan({ ...state, forecast }, i))));
    renderList(stats, weekListModel(days, sel), bands, bestDayIndex(days), dom);

    // Mapa a stĺpce dostanú skutočný rozmer karty len na širokej obrazovke; na mobile si
    // plátno určia samy, aby rozloženie ostalo také, aké bolo.
    renderHeat(state, days, sel, dom);

    // Na desktope má karta dosť miesta na to, aby strop jasnej oblohy zbytočne
    // neprekrýval čísla nad stĺpcami - tam ho preto nekreslíme, na mobile ostáva.
    const barsSize = state.wide ? state.chartSizes.weekBars : null;
    const bars = weekBarsModel(days, sel, barsSize ? { W: barsSize.w, H: barsSize.h } : undefined, !state.wide);
    dom.weekBars.setAttribute('viewBox', `0 0 ${bars.W} ${bars.H}`);
    dom.weekBars.setAttribute('height', String(bars.H));
    writeHtml(dom.weekBars, weekBarsSvg(bars), 'weekBars');
    dom.weekBarsClearLegend.classList.toggle('hidden', state.wide);

    renderTableAndTabs(days, sel, dom);
}

/** @param {import('../state.js').AppState} state @param {import('../dom.js').Dom} dom */
export function renderSedemdni(state, dom) {
    // Bez zadaných panelov počíta predpoveď s typickou strechou - a musí to povedať.
    const roof = state.known !== 'elektraren' ? 'typická strecha ' : '';
    dom.weekSub.textContent = `${state.site.name} · ${roof}${kwpText(installedKw(state.plant))}`;
    const days = state.forecast && Array.isArray(state.forecast.days) ? state.forecast.days : [];
    // Bez dát nie je čo otvárať - karta ostáva na prehľade so správou "Predpoveď sa pripravuje".
    const detail = !state.wide && days.length > 0 ? state.weekDetail : null;
    renderView(detail, !state.wide, state.tall, dom);
    if (!days.length) {
        // Prázdny rebríček by na mobile ukazoval kartu so samými pomlčkami - z prehľadu preto
        // ostáva len tá správa, a tú musí byť vidno aj tam, kde ju renderView inak skrýva.
        dom.weekBlockList.classList.add('hidden');
        dom.weekMsgBlock.classList.remove('hidden');
        return renderEmpty(dom);
    }
    const sel = Math.min(state.weekSelDay, days.length - 1);

    renderDayHead(detail, days, sel, dom);
    renderDayStrip(detail, days, sel, dom);
    const stats = weekStatsModel(days, state.pv, state.forecast ? state.forecast.tomorrowSunny : false);
    renderStats(stats, dom, !!detail);
    // Detail dňa ukazuje len deň; prehľad týždňa pod ním je skrytý. Pri listovaní sa render volá
    // pri každom ťahu viackrát (kópie susedných dní, web/day-pager.js) a prehľad - plán každého
    // zo siedmich dní, mapa, stĺpce, tabuľka - bol väčšina jeho času. Prekreslí sa, keď ho bude vidno.
    if (detail !== 'day') renderWeek(state, days, sel, stats, dom);
    renderCurve(state, days[sel], stats.progress, detail === 'day', dom);
    renderDaySteps(detail, days, sel, dom);
    const msg = weekMessage(days);
    dom.weekMsgTitle.textContent = msg.title;
    dom.weekMsgBody.textContent = msg.body;
}
