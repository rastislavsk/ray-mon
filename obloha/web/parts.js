// Neskoré časti appky (PARTS v state.js): karta 7 dní, Štatistika s plagátom a Nastavenie so
// sprievodcom. Pri štarte sa sťahuje len to, čo je na obrazovke - na telefóne úvodná karta
// s hlavičkou, navigáciou a oblohou. Ostatné sa načíta dynamickým import(), keď to obrazovka
// potrebuje, inak keď je prehliadač po prvom vykreslení voľný.
//
// Zmiešanú cache po nasadení (CLAUDE.md, Nasadenie a cache) chytá boot.js len pri štarte. Keď
// neskorý import() zlyhá (starý modul v cache, výpadok siete), karta neostane prázdna: namiesto
// nej je hláška a tlačidlo, ktoré stiahne súbory znova a obnoví stránku - rovnako ako boot.js,
// a v jednej karte prehliadača najviac raz. Kód sa s boot.js nedelí, ten nesmie nič importovať.

import { neededParts, PARTS } from './state.js';

/** @typedef {import('./state.js').Store} Store */
/** @typedef {import('./dom.js').Dom} Dom */
/** @typedef {import('./state.js').Part} Part */
/**
 * @typedef {{ render: (state: import('./state.js').AppState, dom: Dom) => void,
 *   init: (store: Store, dom: Dom, refresh: () => Promise<void>) => void }} PartModule
 */

/** Načítané časti. render/index.js kreslí tie, o ktorých stav hovorí 'ok'. @type {Partial<Record<Part, PartModule>>} */
export const loaded = {};

/** @type {Record<Part, () => Promise<PartModule>>} */
const IMPORTS = {
    sedem: () => import('./part-sedem.js'),
    statistika: () => import('./part-statistika.js'),
    nastavenie: () => import('./part-nastavenie.js'),
};

/** Časti, ktoré sa už začali načítavať - každá sa sťahuje raz. @type {Set<Part>} */
const started = new Set();

/** Obnova stránky kvôli neskorej časti, už použitá v tejto karte prehliadača. */
const KEY = 'ray-mon-obloha-obnova-casti';

/** Bola v tejto karte prehliadača obnova už použitá? Bez sessionStorage radšej áno - nič sa neobnoví. */
function recovered() {
    try {
        return !!sessionStorage.getItem(KEY);
    } catch {
        return true;
    }
}

/**
 * Stiahne časť, prihlási jej poslucháče a povie to stavu (prekreslí sa). Zlyhanie hodí ďalej.
 * @param {Part} part @param {Store} store @param {Dom} dom @param {() => Promise<void>} refresh
 */
async function load(part, store, dom, refresh) {
    started.add(part);
    const mod = await IMPORTS[part]();
    mod.init(store, dom, refresh);
    loaded[part] = mod;
    store.setState({ parts: { ...store.get().parts, [part]: 'ok' } });
}

/**
 * Načítanie počas behu appky: zlyhanie ukáže hlášku namiesto karty. Keď sú načítané všetky časti,
 * záznam o obnove sa zmaže - ďalšie nasadenie v tej istej karte prehliadača sa tak dá obnoviť znova.
 * @param {Part} part @param {Store} store @param {Dom} dom @param {() => Promise<void>} refresh
 */
function loadLater(part, store, dom, refresh) {
    load(part, store, dom, refresh).then(
        () => {
            if (!PARTS.every((p) => store.get().parts[p] === 'ok')) return;
            try {
                sessionStorage.removeItem(KEY);
            } catch {
                // Bez sessionStorage nie je čo mazať.
            }
        },
        (err) => {
            console.error(err);
            store.setState({ parts: { ...store.get().parts, [part]: recovered() ? 'koniec' : 'chyba' } });
        },
    );
}

/**
 * Tlačidlo v hláške: stiahne vlastné skripty stránky znova cez cache: 'reload' (prepíše tým starú
 * verziu v cache) a obnoví stránku. Samotné obnovenie by nestačilo - moduly by prišli z cache.
 * Keď server neodpovedá (offline), stránka sa neobnoví, hláška povie, nech to skúsi o chvíľu.
 * @param {Store} store
 */
async function recover(store) {
    try {
        sessionStorage.setItem(KEY, '1');
        const own = performance
            .getEntriesByType('resource')
            .map((entry) => new URL(entry.name))
            .filter((url) => url.origin === location.origin && url.pathname.endsWith('.js'));
        await Promise.all(own.map((url) => fetch(url, { cache: 'reload' })));
        location.reload();
    } catch {
        const parts = store.get().parts;
        store.setState({ parts: Object.fromEntries(PARTS.map((p) => [p, parts[p] === 'chyba' ? 'koniec' : parts[p]])) });
    }
}

/**
 * Štart: počká na časti, ktoré úvodná obrazovka potrebuje (na telefóne žiadnu; zlyhanie ide ďalej
 * do boot.js, ako pri ktoromkoľvek inom module), a odteraz načíta každú časť, keď ju obrazovka
 * bude potrebovať.
 * @param {Store} store @param {Dom} dom @param {() => Promise<void>} refresh
 */
export async function initParts(store, dom, refresh) {
    await Promise.all(neededParts(store.get()).map((part) => load(part, store, dom, refresh)));
    store.subscribe((state) => {
        for (const part of neededParts(state)) if (!started.has(part)) loadLater(part, store, dom, refresh);
    });
    dom.waitRetry.addEventListener('click', () => recover(store));
}

/** Odstup neskorého sťahovania od prvého vykreslenia: prvá obrazovka dokreslí a dáta sa stiahnu bez súperenia o sieť. */
const PRELOAD_AFTER_MS = 1000;

/**
 * Po prvom vykreslení: ostatné časti, až keď je prvá obrazovka na displeji a prehliadač je voľný -
 * karta je potom pri prvom otvorení hneď hotová. Kto ju otvorí skôr, počká na ňu (initParts).
 * Udalosť load na to nestačí: appku načítava dynamický import() v boot.js a ten ju nezdrží.
 * @param {Store} store @param {Dom} dom @param {() => Promise<void>} refresh
 */
export function preloadParts(store, dom, refresh) {
    const rest = () => {
        for (const part of PARTS) if (!started.has(part)) loadLater(part, store, dom, refresh);
    };
    // Safari requestIdleCallback nepozná.
    const idle = () => ('requestIdleCallback' in window ? requestIdleCallback(rest, { timeout: 2000 }) : rest());
    // requestAnimationFrame beží tesne pred vykreslením, úloha naplánovaná z neho až po ňom.
    requestAnimationFrame(() => setTimeout(idle, PRELOAD_AFTER_MS));
}
