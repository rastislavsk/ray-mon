// Drobné kontroly nedôveryhodných dát (úložisko, odkaz, formulár), ktoré potrebuje viac modulov.
// Tu sú preto, aby sa nepísali v každom znova.

/** @param {unknown} v @returns {v is Record<string, any>} */
export const isObj = (v) => !!v && typeof v === 'object';

/** Konečné číslo v rozsahu vrátane krajov. @param {number} v @param {{ min: number, max: number }} r */
export const inRange = (v, r) => Number.isFinite(v) && v >= r.min && v <= r.max;

/** Miestny dátum `YYYY-MM-DD`. */
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
