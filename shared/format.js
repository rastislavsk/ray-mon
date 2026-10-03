// Formátovanie času a čísel pre slovenské UI. Čisté funkcie bez DOM.

import { MINUTES_PER_DAY } from './config.js';

const WEEK_DAYS_SHORT = ['Ne', 'Po', 'Ut', 'St', 'Št', 'Pi', 'So'];
const WEEK_DAYS_LONG = ['Nedeľa', 'Pondelok', 'Utorok', 'Streda', 'Štvrtok', 'Piatok', 'Sobota'];

/** @param {number} n */
export function pad2(n) {
    return String(n).padStart(2, '0');
}

/** Minúty dňa -> "HH:MM", s ošetrením pretečenia cez polnoc. @param {number} minutes */
export function minutesToTimeStr(minutes) {
    const m = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** "HH:MM" -> minúty dňa. @param {string} str */
export function timeStrToMinutes(str) {
    const [h, m] = str.split(':').map(Number);
    return h * 60 + m;
}

/** Desatinná hodina (13.5) -> "13:30". Zaokrúhľuje celý čas na minúty, nie minúty zvlášť -
 * inak by 13,995 h dalo "13:60". @param {number} hourFloat */
export function hourFloatToTimeStr(hourFloat) {
    return minutesToTimeStr(hourFloat * 60);
}

/** Minúty ako hodiny s desatinnou čiarkou: 20 h, 7,5 h, 0,25 h. @param {number} min */
export function hoursText(min) {
    return `${String(Math.round((min / 60) * 100) / 100).replace('.', ',')} h`;
}

/** Celá hodina -> "HH:00". @param {number} hour */
export function hourLabel(hour) {
    return `${pad2(hour)}:00`;
}

/** Číslo s jedným desatinným miestom a slovenskou čiarkou. @param {number} n */
export function fmt1(n) {
    return n.toFixed(1).replace('.', ',');
}

/** Číslo s dvomi desatinnými miestami a slovenskou čiarkou. @param {number} n */
export function fmt2(n) {
    return n.toFixed(2).replace('.', ',');
}

/**
 * Súčet do štatistiky: pod tisíc s `decimals` desatinnými miestami, od tisíc celé číslo
 * s tisícmi oddelenými nezlomiteľnou medzerou („9 112“) - desatiny pri tisícoch kWh či eur
 * nič nehovoria a číslo by sa nezmestilo. @param {number} n @param {number} decimals
 */
export function fmtSum(n, decimals) {
    if (Math.abs(n) < 1000) return n.toFixed(decimals).replace('.', ',');
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Výkon elektrárne pre text, napr. „10,44 kWp“ - všade rovnako, s dvomi desatinnými miestami,
 * ako sa výkon zostavy udáva (24 × 435 Wp = 10,44 kWp). @param {number} kwp */
export function kwpText(kwp) {
    return `${fmt2(kwp)} kWp`;
}

/** Výkon strechy zhruba, pre človeka: „asi 5 kWp“ - na celé kWp, najmenej 1. Presné číslo
 * (kwpText) patrí tam, kde sa strecha zadáva; zaokrúhľuje sa len text, výpočet ostáva. @param {number} kwp */
export function kwpRoughText(kwp) {
    return `asi ${Math.max(1, Math.round(kwp))} kWp`;
}

/** Popisok mriežky v kW: celé číslo bez desatín, inak max. dve desatiny bez koncovej nuly. @param {number} kw */
export function formatGridKw(kw) {
    if (Number.isInteger(kw)) return String(kw);
    return kw.toFixed(2).replace(/0$/, '').replace('.', ',');
}

/** Rozloží "YYYY-MM-DD" na deň, mesiac a deň v týždni (0 = nedeľa). @param {string} dateStr */
export function dateParts(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return { day: d, month: m, dow };
}

/** Celé meno dňa v týždni pre dátum: "Štvrtok". @param {string} dateStr */
export function dayNameLong(dateStr) {
    return WEEK_DAYS_LONG[dateParts(dateStr).dow];
}

/** Skratka dňa v týždni pre dátum: "Št". @param {string} dateStr */
export function dayNameShort(dateStr) {
    return WEEK_DAYS_SHORT[dateParts(dateStr).dow];
}

/** "Dnes", "Zajtra", inak skratka dňa v týždni. @param {string} dateStr @param {number} index */
export function weekDayShort(dateStr, index) {
    if (index === 0) return 'Dnes';
    if (index === 1) return 'Zajtra';
    return WEEK_DAYS_SHORT[dateParts(dateStr).dow];
}

/** "6.9." @param {string} dateStr */
export function weekDateLabel(dateStr) {
    const { day, month } = dateParts(dateStr);
    return `${day}.${month}.`;
}

/** "Dnes", "Zajtra", inak "St 8.9.". @param {string} dateStr @param {number} index */
export function weekDayLabel(dateStr, index) {
    if (index < 2) return weekDayShort(dateStr, index);
    return `${weekDayShort(dateStr, index)} ${weekDateLabel(dateStr)}`;
}

/** "Dnes", "Zajtra", inak celé meno dňa ("Štvrtok") - bez dátumu. V rebríčku dní stojí
 * dátum pod menom vo vlastnom riadku, takže ho meno nesmie niesť v sebe.
 * @param {string} dateStr @param {number} index */
export function weekDayName(dateStr, index) {
    if (index < 2) return weekDayShort(dateStr, index);
    return WEEK_DAYS_LONG[dateParts(dateStr).dow];
}

/** "Dnes 5.9.", "Zajtra 6.9.", inak "Štvrtok 10.9." - nadpis obrazovky s detailom dňa,
 * kde je na celé slovo aj dátum miesto (v tabuľke a v grafoch ho na skratku tlačí šírka
 * stĺpca).
 *
 * Dátum nesie aj Dnes a Zajtra, hoci inde v appke nie. V detaile je nadpis jediné, čo
 * hovorí, o ktorý deň ide, a pri listovaní medzi dňami tak dátum stojí na tom istom mieste
 * pri každom z nich - nie až od tretieho.
 * @param {string} dateStr @param {number} index */
export function weekDayLong(dateStr, index) {
    return `${weekDayName(dateStr, index)} ${weekDateLabel(dateStr)}`;
}

/** Ošetrenie textu pred vložením do HTML/SVG reťazca. @param {unknown} value */
export function escapeHtml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
