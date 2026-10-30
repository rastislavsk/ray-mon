// Karta Dnes podľa časti dňa (smer C v docs/navrhy/dnes-tri-smery.html): ráno plán na dnes, cez deň
// odpočet okna na veľké veci a koľko už nabehlo, večer vysvedčenie dneška a zajtrajšok. Veľké
// slovo a čo dá strecha za celý deň počíta shared/mozem.js, tu je len to, čo sa mení s časťou
// dňa - obe appky to kreslia z toho istého modelu. Čisté funkcie bez DOM, texty sú v messages-core.js.

import { PLAN_DNA } from './config.js';
import { forecastDayPlan } from './day-plan.js';
import { denTriedaDna } from './den-trieda.js';
import { DEN_NAZVY, DNES_TEXTS, dnesCountText, dnesGradeText, dnesPlanText, dnesProgressText, dnesZajtraText } from './messages-core.js';
import { mainWindow, sunWindows } from './mozem.js';
import { localMinutes } from './solar.js';
import { dnesCards, todayOf } from './teraz.js';

/** @typedef {import('./mozem.js').Window} Window */
/** @typedef {{ cls: import('./den-trieda.js').DenTrieda, faza: import('./den-trieda.js').DenFaza }} Den */
/** @typedef {ReturnType<typeof dnesZajtraText> & { cls: import('./den-trieda.js').DenTrieda }} Tomorrow */

/**
 * Čo karta Dnes ukáže podľa časti dňa. `faza` je časť dňa veľkého slova (denSlovo: večer bez
 * nameraného ostáva ráno). `chip` trieda dneška slovami (večer prázdna - hovorí zajtrajšok),
 * `kick` riadok nad slovom, `count` odpočet okna (cez deň, kým okno prebieha alebo príde),
 * `progress` koľko z predpovede už nabehlo, `grade` večer namerané za dnešok, `line` veta o okne
 * či predpovedi, `later` kedy bude lepšie a `tomorrow` večer zajtrajšok. Bez slova o dni (`den`
 * null - načítava sa, dáta nie sú) alebo bez predpovede null.
 * @param {Omit<import('./teraz.js').TerazInput, 'previewMinutes'>} input
 * @param {Den | null} den slovo o dni z mozemModel @param {Window | null} window dnešné okno so slnkom z mozemModel (`facts.window`)
 * @param {{ voice?: import('./messages.js').Voice, devices?: readonly string[] }} [opts] tón textov a spotrebiče doma
 */
export function dnesFaza(input, den, window, { voice = 'drzy', devices = PLAN_DNA.devices } = {}) {
    const cards = den && dnesCards({ ...input, previewMinutes: null }, voice);
    if (!den || !cards) return null;
    const base = {
        faza: den.faza,
        chip: DEN_NAZVY[den.cls],
        kick: '',
        /** @type {ReturnType<typeof dnesCountText> | null} */ count: null,
        /** @type {{ text: string, pct: number | null } | null} */ progress: null,
        /** @type {{ label: string, value: string } | null} */ grade: null,
        line: '',
        later: cards.later,
        /** @type {Tomorrow | null} */ tomorrow: null,
    };
    if (den.faza === 'rano') return { ...base, kick: DNES_TEXTS.plan, line: dnesPlanText(window, voice) };
    if (den.faza === 'den') return { ...base, ...cezDen(input, window, cards.today) };
    const t = cards.today;
    const grade = dnesGradeText(t.doneKwh, t.forecastKwh);
    const tomorrow = tomorrowOf(input, devices, voice);
    return {
        ...base,
        chip: '',
        kick: DNES_TEXTS.grade,
        grade: { label: DNES_TEXTS.gradeLabel, value: grade.value },
        line: grade.line,
        // Zajtrajšok nahradí riadok Kedy lepšie - povie to isté o najbližšom dni presnejšie.
        later: tomorrow ? '' : cards.later,
        tomorrow,
    };
}

/**
 * Cez deň: odpočet okna, kým prebieha alebo príde, inak veta o okne; a koľko z predpovede už nabehlo.
 * @param {Omit<import('./teraz.js').TerazInput, 'previewMinutes'>} input @param {Window | null} window
 * @param {ReturnType<typeof import('./teraz.js').todayCard>} t
 */
function cezDen(input, window, t) {
    const nowMin = localMinutes(input.now, input.site.timezone);
    const kind = !window ? null : window.from > nowMin ? 'wait' : window.to > nowMin ? 'go' : null;
    return {
        count: window && kind ? dnesCountText(kind, window, kind === 'go' ? window.to - nowMin : window.from - nowMin) : null,
        progress: t.forecastKwh === null ? null : { text: dnesProgressText({ ...t, forecastKwh: t.forecastKwh }), pct: t.pct },
        line: kind ? '' : t.window,
    };
}

/**
 * Zajtrajšok z predpovede: trieda dňa, koľko dá strecha a hlavné okno na veľké veci. Keď predpoveď
 * nezačína dneškom alebo zajtrajšok nemá, null.
 * @param {Omit<import('./teraz.js').TerazInput, 'previewMinutes'>} input @param {readonly string[]} devices @param {import('./messages.js').Voice} voice
 */
function tomorrowOf(input, devices, voice) {
    const next = todayOf(input) && input.forecast ? input.forecast.days[1] : null;
    if (!next || !input.forecast) return null;
    const data = { ...input, forecast: input.forecast };
    const cls = denTriedaDna(data, 1, devices);
    return { cls, ...dnesZajtraText({ cls, kwh: next.kwhTotal, window: mainWindow(sunWindows(forecastDayPlan(data, 1))) }, voice) };
}

/** @typedef {NonNullable<ReturnType<typeof dnesFaza>>} DnesFaza */
