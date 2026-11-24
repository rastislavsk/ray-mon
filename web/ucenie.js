// Učenie Plánu dňa v telefóne (docs/navrhy/plan-dna-ucenie.html, docs/navrhy/ucenie-vo-workeri.html). Pri Huawei
// Northbound model počíta Worker a všetky telefóny domácnosti dostanú ten istý: telefón sa pýta raz za deň, keď má novú
// snímku predpovede dneška (Worker berie prvú) a pri „Začať odznova“. Prvýkrát mu pošle aj všetko, čo sa naučil sám
// (snímky, behy, od kedy sa učí). Kým model od Workera nemá, alebo pri inom zdroji merania, ho počíta sám zo snímok
// a behov v telefóne (shared/ucenie.js). Model ide do stavu; karty ho vidia cez render a Plán dňa.

import { localDateKey } from '../shared/solar.js';
import { naucene } from '../shared/ucenie.js';
import { ucenieZWorkera } from './data.js';
import { loadUcenie, loadUcenieWorkera, saveUcenieOd, saveUcenieWorkera } from './storage.js';

/** Úložisko stavu, ako ho učenie potrebuje. @typedef {import('./refresh.js').RefreshStore} Store */

/** Dopyt na Workera, ktorý práve beží - obnova dát každú minútu naň počká a druhý nepošle. @type {Promise<void> | null} */
let beziDopyt = null;

/** Model od Workera pre toto meranie (iná elektráreň má iný). @param {{ nazov: string } | null} zdroj */
function mojModel(zdroj) {
    const u = loadUcenieWorkera();
    return zdroj && u?.z === zdroj.nazov ? u : null;
}

/** Model z toho, čo má telefón (iný zdroj merania, alebo kým nemá model od Workera). @param {string} today */
function vTelefone(today) {
    const vstup = loadUcenie();
    return naucene({ dni: vstup.historia?.dni ?? [], snimky: vstup.snimky, behy: vstup.behy, today, od: vstup.od });
}

/**
 * Čo poslať Workeru: dnešnú snímku predpovede, prvýkrát (`n`) všetko, čo sa telefón naučil sám, a čakajúce „Začať odznova“.
 * @param {import('./storage.js').UcenieWorkera | null} u @param {ReturnType<typeof loadUcenie>} vstup
 * @param {import('../shared/historia.js').SnimkaPredpovede | null} snimka
 */
function teloDopytu(u, vstup, snimka) {
    const odznova = u?.o ? { odznova: true } : {};
    if (u?.n) return { snimky: snimka ? [snimka] : [], ...odznova };
    return { snimky: vstup.snimky, behy: vstup.behy, od: vstup.od, ...odznova };
}

/**
 * Model od Workera: pošle, čo Worker ešte nemá, a uloží, čo vrátil. Bez odpovede ostáva, čo telefón mal.
 * @param {import('../shared/zdroje.js').Zdroj} zdroj @param {string} today @param {typeof fetch} fetchImpl
 */
async function zWorkera(zdroj, today, fetchImpl) {
    const vstup = loadUcenie();
    const u = mojModel(zdroj);
    const snimka = vstup.snimky.find((s) => s.d === today) ?? null;
    if (u && u.d === today && (u.s || !snimka) && !u.o) return;
    const model = await ucenieZWorkera(zdroj.pecat, teloDopytu(u, vstup, snimka), fetchImpl);
    if (!model) return;
    // „Začať odznova“ stlačené počas dopytu čaká na ďalší.
    const o = loadUcenieWorkera()?.o === true && !u?.o;
    saveUcenieWorkera({ d: today, z: zdroj.nazov, s: !!snimka, n: true, o, model });
}

/**
 * Prepočíta model učenia: pri Huawei Northbound z Workera (najviac jeden dopyt naraz), inak v telefóne.
 * @param {Store} store @param {typeof fetch} [fetchImpl]
 */
export async function obnovUcenie(store, fetchImpl = fetch) {
    const s = store.get();
    const today = localDateKey(new Date(), s.site.timezone);
    const zdroj = s.zdroj?.sposob === 'huawei-northbound' ? s.zdroj : null;
    if (zdroj) {
        beziDopyt ??= zWorkera(zdroj, today, fetchImpl).finally(() => (beziDopyt = null));
        await beziDopyt;
    }
    const model = mojModel(zdroj)?.model ?? vTelefone(today);
    if (JSON.stringify(model) !== JSON.stringify(store.get().ucenie)) store.setState({ ucenie: model });
}

/**
 * „Začať odznova“ v Nastavení: appka sa učí až od dneška - pri Huawei Northbound celá domácnosť (Worker). Kým to
 * Worker nepotvrdí, čaká to v úložisku a telefón zatiaľ počíta sám.
 * @param {Store} store
 */
export async function zacniOdznova(store) {
    const s = store.get();
    saveUcenieOd(localDateKey(new Date(), s.site.timezone));
    if (s.zdroj?.sposob === 'huawei-northbound') {
        const u = mojModel(s.zdroj);
        saveUcenieWorkera({ d: u?.d ?? '', z: s.zdroj.nazov, s: u?.s ?? false, n: u?.n ?? false, o: true, model: null });
    }
    await beziDopyt;
    return obnovUcenie(store);
}
