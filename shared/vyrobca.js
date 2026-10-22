// Chyba v odpovedi výrobcu (Fox ESS, Huawei Northbound, SolisCloud, DeyeCloud), spoločná pre
// všetky značky - Worker z nej vie kód aj druh chyby bez toho, aby poznal každú značku zvlášť.

/**
 * Výrobca odpovedal neúspechom. `kod` je kód z jeho odpovede (napr. `20400`, `I0012`), `zamietol`
 * hovorí, či výrobca údaje zamietol - inak len pribrzdil (priveľa dopytov) alebo má výpadok.
 */
export class VyrobcaChyba extends Error {
    /** @param {string} vyrobca meno do správy @param {string | number} kod @param {boolean} [zamietol] */
    constructor(vyrobca, kod, zamietol = true) {
        super(`${vyrobca} ${kod}`);
        this.kod = String(kod);
        this.zamietol = zamietol;
    }
}
