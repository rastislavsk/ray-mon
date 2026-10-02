// Úložisko stavu: jeden objekt a odberatelia. setState zlúči zmenu a zavolá odberateľov
// práve raz; rovnaké hodnoty nič nespustia. Nevie nič o tom, čo v stave je, takže ho používa
// súčasná appka (web/state.js) aj nová (obloha/).

/**
 * @template T
 * @param {T} initial
 */
export function createStore(initial) {
    let state = initial;
    /** @type {Array<(state: T, prev: T) => void>} */
    const listeners = [];
    return {
        get: () => state,
        /** @param {Partial<T>} patch */
        setState(patch) {
            const keys = /** @type {Array<keyof T>} */ (Object.keys(patch));
            if (!keys.some((k) => patch[k] !== state[k])) return;
            const prev = state;
            state = { ...state, ...patch };
            listeners.forEach((fn) => fn(state, prev));
        },
        /** @param {(state: T, prev: T) => void} fn */
        subscribe(fn) {
            listeners.push(fn);
            return () => listeners.splice(listeners.indexOf(fn), 1);
        },
    };
}
