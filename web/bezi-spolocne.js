// Spoločné behy „Už beží“ telefónov domácnosti (docs/navrhy/bezi-spolocne.html): pri Huawei Northbound si ich telefóny
// zdieľajú cez Durable Object účtu (Worker `/bezi`). Telefón po zmene pošle behy toho spotrebiča a pri každej obnove dát
// (každú minútu a po návrate do appky) prevezme dnešné behy všetkých telefónov. Zmenu, ktorú Worker ešte nepotvrdil
// (bez siete), si pamätá v úložisku a pošle ju s ďalším dopytom - dovtedy ju odpoveď Workera neprepíše.
// Iné zdroje merania Durable Object nemajú, behy ostávajú len v telefóne (docs/to do later.md).

import { behyVeci, prevezmi } from '../shared/bezi.js';
import { localDateKey } from '../shared/solar.js';
import { spolocneBehy } from './data.js';
import { loadBeziCaka, saveBezi, saveBeziCaka } from './storage.js';

/** @typedef {import('../shared/bezi.js').Zapis} Zapis */
/**
 * Stav, ktorý zladenie potrebuje (appka aj obnova dát, web/refresh.js).
 * @typedef {{ get: () => { zdroj: import('../shared/zdroje.js').Zdroj | null, site: { timezone: string }, bezi: Zapis[],
 *   zasuvky?: Record<string, import('../shared/zasuvka.js').ZasuvkaInfo> },
 *   setState: (patch: { bezi?: Zapis[], zasuvky?: Record<string, import('../shared/zasuvka.js').ZasuvkaInfo> }) => void }} Store
 */

/**
 * Stav zásuviek spotrebičov (docs/navrhy/pracka-zasuvka.html) do stavu, keď sa zmenil: kým zásuvka meria, detail spotrebiča
 * nemá „Už beží“. `?? {}`: starý web/state.js z cache po nasadení pole nemá.
 * @param {Store} store @param {Record<string, import('../shared/zasuvka.js').ZasuvkaInfo>} zasuvky
 */
function prevezmiZasuvky(store, zasuvky) {
    if (JSON.stringify(zasuvky) !== JSON.stringify(store.get().zasuvky ?? {})) store.setState({ zasuvky });
}

/** Poradie dopytov: odpoveď staršieho dopytu, ktorá príde po novšom, už nič neprepíše. */
let poslany = 0;
let prevzaty = 0;

/**
 * Zladí behy s Workerom: pošle nepotvrdené zmeny (aj práve urobenú `zmena`) a prevezme dnešné behy domácnosti.
 * Nikdy nehádže; keď Worker neodpovie, zmeny čakajú na ďalší pokus.
 * @param {Store} store @param {import('../shared/bezi.js').Caka} [zmena] spotrebič a deň, ktoré sa práve zmenili
 */
export async function zladBehy(store, zmena) {
    const s = store.get();
    if (s.zdroj?.sposob !== 'huawei-northbound') return;
    const { zdroj } = s;
    const d = localDateKey(new Date(), s.site.timezone);
    const caka = loadBeziCaka().filter((c) => c.d === d);
    if (zmena && !caka.some((c) => c.id === zmena.id && c.d === zmena.d)) caka.push(zmena);
    saveBeziCaka(caka);
    // `?? []`: starý web/state.js z cache po nasadení pole bezi nemá.
    const zmeny = caka.map((c) => ({ ...c, behy: behyVeci(s.bezi ?? [], c.id, c.d) }));
    const cislo = ++poslany;
    const spolocne = await spolocneBehy(zdroj.pecat, d, zmeny);
    const teraz = store.get();
    // Kým sa čakalo, mohla prísť odpoveď novšieho dopytu alebo iná elektráreň.
    if (!spolocne || cislo < prevzaty || teraz.zdroj?.sposob !== zdroj.sposob || teraz.zdroj.nazov !== zdroj.nazov) return;
    prevzaty = cislo;
    prevezmiZasuvky(store, spolocne.zasuvky);
    const lokalne = teraz.bezi ?? [];
    // Potvrdená je zmena, ktorej behy sa odvtedy v telefóne nezmenili; ďalšia zmena toho istého spotrebiča ešte čaká.
    const ostava = loadBeziCaka().filter((c) => {
        const poslana = zmeny.find((z) => z.id === c.id && z.d === c.d);
        return !poslana || JSON.stringify(poslana.behy) !== JSON.stringify(behyVeci(lokalne, c.id, c.d));
    });
    saveBeziCaka(ostava);
    const bezi = prevezmi(lokalne, spolocne.bezi, ostava, d);
    if (JSON.stringify(bezi) === JSON.stringify(lokalne)) return;
    saveBezi(bezi, d);
    store.setState({ bezi });
}
