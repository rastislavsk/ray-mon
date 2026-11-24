// Durable Object jedného účtu Huawei Northbound (návrh docs/navrhy/bojler-prebytky.html, možnosť C).
//
// Telefón aj zásuvka s bojlerom merajú z toho istého účtu. Huawei pri každom prihlásení zruší
// predchádzajúcu reláciu, dovolí 5 prihlásení za 10 minút a meranie raz za 5 minút - dve kópie
// pečate by sa navzájom odhlasovali a zamkli účet. Všetky merania účtu preto idú cez tento objekt:
// jeden token, Huawei sa pýta najviac raz za NB.meranieMs a ostatní dostanú to isté meranie.
//
// Ukladá: reláciu (token a cookies, platia 30 minút), čo meranie zistilo o elektrárni (zariadenia,
// krivku, časy dopytov - bez hesla), posledné meranie a pre bojler pamäť rozhodovania, posledný
// kontakt zásuvky, záznam dňa a režim (ručne / riadi appka). Heslo neukladá: prichádza vždy
// v pečati od telefónu či zásuvky. Pre oznámenia bojlera (docs/navrhy/spotrebic-koniec-opakovanie.html) aj odbery
// telefónov, ktoré si ich zapli - pri každej zmene ohrevu im pošle push s textom. Pre učenie Plánu dňa
// (docs/navrhy/plan-dna-ucenie.html) históriu: z každého nového merania hodinové súhrny výroby a spotreby domu
// bez bojlera a na konci dňa bojlera (shared/historia.js), najviac HISTORIA.dni dní. Telefón si ju stiahne cez /historia.
// Behy „Už beží“, ktoré si telefóny domácnosti zdieľajú (docs/navrhy/bezi-spolocne.html, shared/bezi.js), cez /bezi - za
// HISTORIA.dni dní, telefón dostane len dnešok. Model učenia (docs/navrhy/ucenie-vo-workeri.html, shared/ucenie.js) cez
// /ucenie: snímky predpovede od telefónov (`hs:`), od kedy sa učí (`uo:`) a model počítaný raz za deň (`um:`).
//
// Bez `cloudflare:workers` (Node by ho v testoch nenačítal): staršia podoba s `fetch`, ktorú
// Cloudflare podporuje ďalej. Telo dopytu je JSON od Workera, nie od používateľa.

import { BOJLER, OZNAMENIA, PUSH_TEXT } from '../../shared/config.js';
import { prahyZ, rozhodni, PAMAT_ZACIATOK, zaznamenaj, zariadenieBojlera, zmenaOhrevu } from '../../shared/bojler.js';
import { zapisZmeny } from '../../shared/bezi.js';
import { hranicaZ, pridajTeplotu, strazVodu, teplotaZ, teplotyDna } from '../../shared/bojler-voda.js';
import { domBezBojlera, sBojlerom, zapisMeranie, zlucBehy, zlucSnimky } from '../../shared/historia.js';
import { NB } from '../../shared/huawei-nb.js';
import { localDateKey } from '../../shared/solar.js';
import { naucene, spolocneOd } from '../../shared/ucenie.js';
import { bojlerZmenaText } from '../../shared/messages-oznamenia.js';
import { posliPush, vapidKlic } from './webpush.js';
import { ZdrojChyba, ZDROJE } from './zdroje.js';

/** @typedef {import('../../shared/kiosk.js').PvData} PvData */
/** @typedef {import('../../shared/bojler.js').BojlerInfo} BojlerInfo */

/** Jednorazová oprava histórie po dvoch zariadeniach (opravaDvochZariadeni): od ktorého dňa zahodiť a kedy beží. */
const OPRAVA = { od: '2026-11-23', do: '2026-12-01' };
/** @typedef {import('../../shared/historia.js').DenHistorie} DenHistorie */
/** Odber telefónu s oznámeniami bojlera. @typedef {{ e: string, keys: { p256dh: string, auth: string } }} OdberBojlera */
/** @typedef {{ get: (k: string) => Promise<unknown>, put: (k: string | Record<string, unknown>, v?: unknown) => Promise<void> }} Uloziste */

// Polia relácie: spoločné pre všetky elektrárne účtu. Heslo sa neukladá nikde.
const RELACIA = ['token', 'cookie', 'tokenAt'];
const BEZ_ULOZENIA = ['heslo', ...RELACIA];

/** @param {Record<string, unknown>} o @param {string[]} kluce */
const vyber = (o, kluce) => Object.fromEntries(Object.entries(o).filter(([k]) => kluce.includes(k)));
/** Číslo od zásuvky, inak 0. @param {unknown} v */
const cislo = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
/** @param {Record<string, unknown>} o @param {string[]} kluce */
const bez = (o, kluce) => Object.fromEntries(Object.entries(o).filter(([k]) => !kluce.includes(k)));

/**
 * Meranie, ktoré sa Workeru vráti: meranie a prístup, ktorý si má volajúci zapečatiť (keď sa líši
 * od toho, čo poslal), alebo chyba zdroja.
 * @typedef {{ pv: PvData, pristup?: Record<string, unknown>, bojler?: BojlerInfo | null } | { chyba: { druh: 'udaje' | 'vyrobca', kod: string } }} Odpoved
 */

export class UcetHuawei {
    /** @param {{ storage: Uloziste }} state @param {{ VAPID_JWK?: string }} env @param {typeof fetch} [fetchImpl] */
    constructor(state, env, fetchImpl) {
        this.storage = state.storage;
        this.env = env ?? {};
        /** @type {typeof fetch} */
        this.fetchImpl = fetchImpl ?? ((u, i) => fetch(u, i));
        /** Meranie, ktoré práve beží, po elektrárňach - druhý dopyt naň počká. @type {Map<string, Promise<{ pv: PvData, pristup: Record<string, unknown> }>>} */
        this.bezi = new Map();
    }

    /** @param {Request} request */
    async fetch(request) {
        const req = /** @type {any} */ (await request.json());
        const now = new Date(req.now);
        try {
            const path = new URL(request.url).pathname;
            const body =
                path === '/bojler'
                    ? await this.bojler(req, now)
                    : path === '/rezim'
                      ? await this.rezim(req, now)
                      : path === '/hranica'
                        ? await this.hranica(req, now)
                        : path === '/stav'
                          ? await this.stav(req, now)
                          : path === '/oznam'
                            ? await this.oznam(req)
                            : path === '/historia'
                              ? await this.historia(req)
                              : path === '/bezi'
                                ? await this.behy(req)
                                : path === '/ucenie'
                                  ? await this.ucenie(req, now)
                                  : await this.pv(req.pristup, now);
            return Response.json(body);
        } catch (err) {
            const z = err instanceof ZdrojChyba ? err : new ZdrojChyba('vyrobca');
            return Response.json({ chyba: { druh: z.druh, kod: z.kod } });
        }
    }

    /**
     * Prístup na meranie: z pečate (heslo, meno, server) a navrch, čo objekt vie novšie - relácia
     * a zistené o elektrárni.
     * @param {Record<string, unknown>} pristup
     */
    async spojeny(pristup) {
        const plant = String(pristup.plant ?? '');
        const relacia = /** @type {Record<string, unknown> | undefined} */ (await this.storage.get('relacia'));
        const ulozeny = /** @type {Record<string, unknown> | undefined} */ (await this.storage.get(`p:${plant}`));
        const novsia = relacia && Number(relacia.tokenAt) > (Number(pristup.tokenAt) || 0);
        return { ...pristup, ...(ulozeny ?? {}), ...(novsia ? relacia : {}) };
    }

    /**
     * Meranie elektrárne: posledné, keď nie je staršie než NB.meranieMs, inak nové (jedno naraz).
     * @param {Record<string, unknown>} pristup @param {Date} now
     * @returns {Promise<{ pv: PvData, pristup: Record<string, unknown>, at: number }>}
     */
    async meraj(pristup, now) {
        const plant = String(pristup.plant ?? '');
        const posledne = /** @type {{ at: number, pv: PvData } | undefined} */ (await this.storage.get(`m:${plant}`));
        const p = await this.spojeny(pristup);
        if (posledne && now.getTime() - posledne.at < NB.meranieMs) return { pv: posledne.pv, pristup: p, at: posledne.at };
        let beh = this.bezi.get(plant);
        if (!beh) {
            beh = this.zmeraj(p, now).finally(() => this.bezi.delete(plant));
            this.bezi.set(plant, beh);
        }
        const r = await beh;
        return { ...r, at: now.getTime() };
    }

    /** Nové meranie cez zdroj Northbound a uloženie toho, čo zistilo. @param {Record<string, unknown>} p @param {Date} now */
    async zmeraj(p, now) {
        const res = await ZDROJE['huawei-northbound'].meraj(p, { now, fetchImpl: this.fetchImpl });
        const novy = res.pristup ?? p;
        const plant = String(p.plant ?? '');
        /** @type {Record<string, unknown>} */ const zapis = {
            [`m:${plant}`]: { at: now.getTime(), pv: res.pv },
            ...(await this.doHistorie(plant, res.pv, now)),
        };
        if (res.pristup) {
            zapis[`p:${plant}`] = bez(novy, BEZ_ULOZENIA);
            if (novy.tokenAt !== p.tokenAt) zapis.relacia = vyber(novy, RELACIA);
        }
        await this.storage.put(zapis);
        return { pv: res.pv, pristup: novy };
    }

    /**
     * Nové meranie do histórie (shared/historia.js): čo treba zapísať - bežiacu hodinu vždy, dni len keď sa hodina
     * uzavrela. Dom je bez bojlera podľa posledného hlásenia zásuvky.
     * @param {string} plant @param {PvData} pv @param {Date} now @returns {Promise<Record<string, unknown>>}
     */
    async doHistorie(plant, pv, now) {
        const bojler = /** @type {BojlerInfo | undefined} */ (await this.storage.get(`b:${plant}`));
        const hodina = /** @type {import('../../shared/historia.js').Hodina | undefined} */ (await this.storage.get(`hh:${plant}`));
        const dni = /** @type {DenHistorie[] | undefined} */ (await this.storage.get(`hd:${plant}`)) ?? [];
        const domKw = domBezBojlera(pv.realTimePowerKw, pv.sietKw, bojler, now.getTime());
        const r = zapisMeranie({ hodina: hodina ?? null, dni }, { at: now.getTime(), tz: NB.pasmo, vyrobaKw: pv.realTimePowerKw, domKw });
        // Uzavretá hodina staršieho dňa mení vstup modelu učenia - prepočíta sa pri ďalšom /ucenie.
        const minulyDen = r.dni !== dni && hodina && hodina.d !== r.hodina.d;
        return {
            [`hh:${plant}`]: r.hodina,
            ...(r.dni !== dni ? { [`hd:${plant}`]: r.dni } : {}),
            ...(minulyDen ? { [`um:${plant}`]: null } : {}),
        };
    }

    /**
     * Záznam dňa bojlera sa skončil (prvý dopyt zásuvky v novom dni): jeho energia ide do histórie. Vráti, čo zapísať.
     * @param {string} plant @param {BojlerInfo | undefined} info predošlé hlásenie zásuvky @param {import('../../shared/bojler.js').Den} novy
     * @returns {Promise<Record<string, unknown>>}
     */
    async koniecDna(plant, info, novy) {
        const stary = info?.den;
        if (!stary || stary.den === novy.den) return {};
        const dni = /** @type {DenHistorie[] | undefined} */ (await this.storage.get(`hd:${plant}`)) ?? [];
        return { [`hd:${plant}`]: sBojlerom(dni, stary), [`um:${plant}`]: null };
    }

    /**
     * História elektrárne pre telefón (učenie Plánu dňa): dni od najstaršieho. Bežiaca hodina v nej ešte nie je.
     * @param {{ pristup: Record<string, unknown> }} req
     */
    async historia(req) {
        const dni = /** @type {DenHistorie[] | undefined} */ (await this.storage.get(`hd:${String(req.pristup.plant ?? '')}`));
        return { dni: dni ?? [] };
    }

    /**
     * Spoločné behy „Už beží“ (shared/bezi.js): zmeny od telefónu zapíše, dni staršie než HISTORIA.dni zahodí a vráti
     * dnešné (`d`) behy všetkých telefónov. Bez zmien len číta - zapisuje sa, len keď sa niečo zmenilo. Zmena
     * staršieho dňa zahodí model učenia.
     * @param {{ pristup: Record<string, unknown>, d: string, zmeny: unknown }} req
     */
    async behy(req) {
        const plant = String(req.pristup.plant ?? '');
        const kluc = `bz:${plant}`;
        const stare = /** @type {import('../../shared/bezi.js').Zapis[] | undefined} */ (await this.storage.get(kluc)) ?? [];
        const bezi = zapisZmeny(stare, req.zmeny, req.d);
        if (JSON.stringify(bezi) !== JSON.stringify(stare)) {
            const minule = (/** @type {import('../../shared/bezi.js').Zapis[]} */ l) => JSON.stringify(l.filter((z) => z.d < req.d));
            await this.storage.put({ [kluc]: bezi, ...(minule(bezi) !== minule(stare) ? { [`um:${plant}`]: null } : {}) });
        }
        return { bezi: bezi.filter((z) => z.d === req.d) };
    }

    /**
     * Model učenia Plánu dňa pre telefón (docs/navrhy/ucenie-vo-workeri.html). Snímky predpovede (`snimky`, platí prvá
     * snímka dňa), behy z histórie telefónu (`behy`) a jeho „Začať odznova“ (`od`) pridá k tomu, čo má; `odznova` sa
     * učí od dneška. Model počíta naucene najviac raz za deň - pri prvom dopyte dňa a po zmene vstupov starších dní
     * (bezplatný Worker má 10 ms procesora, výpočet nad HISTORIA.dni dňami trvá niekoľko ms). Dnešok do modelu nevstupuje.
     * @param {{ pristup: Record<string, unknown>, snimky?: unknown, behy?: unknown, od?: unknown, odznova?: unknown }} req
     * @param {Date} now
     */
    async ucenie(req, now) {
        const plant = String(req.pristup.plant ?? '');
        const today = localDateKey(now, NB.pasmo);
        const v = await this.vstupyUcenia(plant, req, today);
        const um = `um:${plant}`;
        const ulozeny = /** @type {{ d: string, model: import('../../shared/ucenie.js').Naucene } | null | undefined} */ (
            await this.storage.get(um)
        );
        let model = ulozeny?.d === today && !v.zmena ? ulozeny.model : null;
        if (!model) {
            const dni = /** @type {DenHistorie[] | undefined} */ (await this.storage.get(`hd:${plant}`)) ?? [];
            model = naucene({ dni, snimky: v.snimky, behy: v.behy, today, od: v.od });
            v.zapis[um] = { d: today, model };
        }
        if (Object.keys(v.zapis).length) await this.storage.put(v.zapis);
        return { ucenie: model };
    }

    /**
     * Vstupy modelu učenia s tým, čo poslal telefón: snímky (`hs:`), behy (`bz:`), od kedy sa učí (`uo:`), čo z nich
     * zapísať a či sa zmenilo niečo pred dneškom (vtedy treba model prepočítať).
     * @param {string} plant @param {{ snimky?: unknown, behy?: unknown, od?: unknown, odznova?: unknown }} req @param {string} today
     */
    async vstupyUcenia(plant, req, today) {
        const [hs, bz, uo] = [`hs:${plant}`, `bz:${plant}`, `uo:${plant}`];
        const stareS = (await this.storage.get(hs)) ?? [];
        const stareB = (await this.storage.get(bz)) ?? [];
        const stareOd = (await this.storage.get(uo)) ?? null;
        const snimky = zlucSnimky(stareS, req.snimky, today);
        const behy = zlucBehy(stareB, req.behy, today);
        const od = req.odznova === true ? today : spolocneOd(stareOd, req.od, today);
        const text = (/** @type {unknown} */ x) => JSON.stringify(x);
        const minule = (/** @type {unknown} */ l) =>
            text((Array.isArray(l) ? l : []).filter((/** @type {{ d: string }} */ x) => x.d < today));
        /** @type {Record<string, unknown>} */ const zapis = {
            ...(text(snimky) !== text(stareS) ? { [hs]: snimky } : {}),
            ...(text(behy) !== text(stareB) ? { [bz]: behy } : {}),
            ...(od !== stareOd ? { [uo]: od } : {}),
        };
        const zmena = minule(snimky) !== minule(stareS) || minule(behy) !== minule(stareB) || od !== stareOd;
        return { snimky, behy, od, zapis, zmena };
    }

    /**
     * Meranie pre telefón: meranie, prístup na zapečatenie (keď sa zmenil) a stav bojlera.
     * @param {Record<string, unknown>} pristup @param {Date} now @returns {Promise<Odpoved>}
     */
    async pv(pristup, now) {
        const r = await this.meraj(pristup, now);
        const bojler = await this.sTeplotami(String(pristup.plant ?? ''), now);
        const zmeneny = JSON.stringify(r.pristup) !== JSON.stringify(pristup);
        return { pv: r.pv, ...(zmeneny ? { pristup: r.pristup } : {}), bojler };
    }

    /**
     * Dopyt zásuvky: rozhodnutie a záznam dňa. Keď meranie nevyjde, rozhoduje z posledného
     * (rozhodni ho po BOJLER.tichoMin nechá vypnúť).
     * Teplotu vody (`t`) pošle len skript s teplomerom (docs/navrhy/bojler-teplota.html); bez nej ostáva posledná.
     * Hranicu teploty (docs/navrhy/bojler-hranica.html) stráži rovnako ako zásuvka a pošle jej ju (`maxC`, `minC`).
     * Bojler riadi jedno zariadenie (`bd:`, docs/navrhy/bojler-jedno-zariadenie.html): hlásenie iného či bez merania
     * príkonu sa odmietne (`odmietnute`) skôr, než sa čokoľvek zmeria či zapíše.
     * @param {{ pristup: Record<string, unknown>, id?: unknown, rele: unknown, w: unknown, e: unknown, prahy: unknown, t?: unknown }} req
     * @param {Date} now
     */
    async bojler(req, now) {
        const plant = String(req.pristup.plant ?? '');
        if (!(await this.prijmiZariadenie(plant, req, now))) return { odmietnute: true };
        await this.opravaDvochZariadeni(plant, now);
        const { sietKw, meranieAt } = await this.meranieBojlera(req.pristup, plant, now);
        const rele = req.rele === true;
        const w = cislo(req.w);
        const prahy = prahyZ(req.prahy);
        const pamat = /** @type {import('../../shared/bojler.js').Pamat | undefined} */ (await this.storage.get(`bp:${plant}`));
        const rucne = (await this.storage.get(`br:${plant}`)) === true;
        const stary = /** @type {BojlerInfo | undefined} */ (await this.storage.get(`b:${plant}`));
        const v = await this.voda(plant, req.t, stary, now);
        const r = rozhodni(pamat ?? PAMAT_ZACIATOK, {
            rele,
            w,
            sietKw,
            meranieAt,
            now: now.getTime(),
            prahy,
            rucne,
            nahriata: v.nahriata,
        });
        const energiaWh = cislo(req.e);
        const den = zaznamenaj(stary?.den ?? null, { now, tz: NB.pasmo, rele, w, energiaWh, sietKw });
        /** @type {BojlerInfo} */ const info = {
            kontaktAt: now.getTime(),
            rele,
            w,
            prebytokKw: r.prebytokKw,
            prahy,
            den,
            rucne,
            voda: v.voda,
            hranica: v.hranica,
            nahriata: v.nahriata,
        };
        await this.storage.put({
            [`bp:${plant}`]: r.pamat,
            [`b:${plant}`]: info,
            ...v.zapis,
            ...(await this.koniecDna(plant, stary, den)),
        });
        const zmena = zmenaOhrevu(stary ?? null, info);
        if (zmena) await this.oznamZmenu(plant, bojlerZmenaText(zmena), now);
        const minC = v.hranica === null ? null : v.hranica - BOJLER.vodaHystC;
        return { zapni: r.zapni, rucne, prebytokKw: r.prebytokKw, tichoMin: BOJLER.tichoMin, maxC: v.hranica, minC };
    }

    /**
     * Dodávka do siete a čas merania pre rozhodnutie bojlera: z nového merania, keď nevyjde, z posledného (bez neho null a 0).
     * @param {Record<string, unknown>} pristup @param {string} plant @param {Date} now
     */
    async meranieBojlera(pristup, plant, now) {
        const pv = await this.meraj(pristup, now).then(
            (r) => r.pv,
            async () => /** @type {{ pv: PvData } | undefined} */ (await this.storage.get(`m:${plant}`))?.pv ?? null,
        );
        return {
            sietKw: typeof pv?.sietKw === 'number' ? pv.sietKw : null,
            meranieAt: pv?.measuredAt ? Date.parse(pv.measuredAt) : 0,
        };
    }

    /**
     * Smie toto zariadenie riadiť bojler (zariadenieBojlera)? Prvé s meraním a ID si pripne (`bd:`).
     * @param {string} plant @param {{ id?: unknown, w: unknown }} req @param {Date} now
     */
    async prijmiZariadenie(plant, req, now) {
        const pripnute = /** @type {string | undefined} */ (await this.storage.get(`bd:${plant}`)) ?? null;
        const predtym = /** @type {BojlerInfo | undefined} */ (await this.storage.get(`b:${plant}`));
        const z = zariadenieBojlera(pripnute, predtym?.kontaktAt ?? null, { id: req.id, w: req.w }, now.getTime());
        if (z.pripni) await this.storage.put(`bd:${plant}`, z.pripni);
        return z.prijmi;
    }

    /**
     * Jednorazová oprava (docs/navrhy/bojler-jedno-zariadenie.html, D): od 23. 11. 2026 hlásil bojler aj Shelly 1 Gen3
     * s teplomerom (bez merania príkonu), čím pokazil záznam dňa bojlera aj spotrebu domu v histórii. Pri prvom hlásení
     * po nasadení zahodí z histórie dni od OPRAVA.od, bežiacu hodinu a dnešný záznam bojlera. Zmazať po OPRAVA.do
     * (docs/to do later.md).
     * @param {string} plant @param {Date} now
     */
    async opravaDvochZariadeni(plant, now) {
        const t = now.getTime();
        if (t < Date.parse(OPRAVA.od) || t >= Date.parse(OPRAVA.do) || (await this.storage.get(`oprava1:${plant}`))) return;
        const dni = /** @type {DenHistorie[] | undefined} */ (await this.storage.get(`hd:${plant}`)) ?? [];
        const b = /** @type {BojlerInfo | undefined} */ (await this.storage.get(`b:${plant}`));
        await this.storage.put({
            [`oprava1:${plant}`]: now.getTime(),
            [`hd:${plant}`]: dni.filter((d) => d.d < OPRAVA.od),
            [`hh:${plant}`]: null,
            [`um:${plant}`]: null,
            ...(b ? { [`b:${plant}`]: { ...b, den: null } } : {}),
        });
    }

    /**
     * Teplota vody z hlásenia zásuvky (docs/navrhy/bojler-teplota.html): posledná (bez novej ostáva stará), čo zapísať
     * do bodov `bt:`, hranica (`bh:`) a či ju voda dosiahla (shared/bojler-voda.js, strazVodu - to isté ako v zásuvke).
     * @param {string} plant @param {unknown} raw @param {BojlerInfo | undefined} stary @param {Date} now
     */
    async voda(plant, raw, stary, now) {
        const t = teplotaZ(raw);
        const body =
            /** @type {import('../../shared/bojler-voda.js').BodyVody | undefined} */ (await this.storage.get(`bt:${plant}`)) ?? [];
        const nove = pridajTeplotu(body, t, now.getTime());
        const hranica = hranicaZ(await this.storage.get(`bh:${plant}`));
        return {
            voda: t === null ? (stary?.voda ?? null) : { t, at: now.getTime() },
            hranica,
            nahriata: strazVodu(stary?.nahriata === true, t, hranica),
            zapis: nove === body ? {} : { [`bt:${plant}`]: nove },
        };
    }

    /**
     * Hranica teploty od appky (docs/navrhy/bojler-hranica.html): uloží ju (null - bez hranice) a vráti stav bojlera
     * s ňou. Zásuvka ju dostane pri ďalšom hlásení.
     * @param {{ pristup: Record<string, unknown>, hranica: unknown }} req @param {Date} now
     */
    async hranica(req, now) {
        const plant = String(req.pristup.plant ?? '');
        const hranica = hranicaZ(req.hranica);
        const stary = /** @type {BojlerInfo | undefined} */ (await this.storage.get(`b:${plant}`));
        await this.storage.put({ [`bh:${plant}`]: hranica, ...(stary ? { [`b:${plant}`]: { ...stary, hranica } } : {}) });
        return { bojler: await this.sTeplotami(plant, now) };
    }

    /**
     * Oznámenia bojlera od appky: odber telefónu pridá (`on`) či odoberie. Najviac PUSH_TEXT.maxOdberov na elektráreň,
     * najstarší ide preč.
     * @param {{ pristup: Record<string, unknown>, endpoint: string, keys: OdberBojlera['keys'] | null, on: boolean }} req
     */
    async oznam(req) {
        const plant = String(req.pristup.plant ?? '');
        const stare = /** @type {OdberBojlera[]} */ ((await this.storage.get(`bo:${plant}`)) ?? []).filter((o) => o.e !== req.endpoint);
        const odbery = req.on && req.keys ? [...stare, { e: req.endpoint, keys: req.keys }].slice(-PUSH_TEXT.maxOdberov) : stare;
        await this.storage.put(`bo:${plant}`, odbery);
        return { ok: true };
    }

    /**
     * Push s textom o zmene ohrevu všetkým odberom elektrárne. Odber, ktorý push služba už nepozná (404, 410), zmaže.
     * @param {string} plant @param {{ title: string, body: string }} text @param {Date} now
     */
    async oznamZmenu(plant, text, now) {
        const odbery = /** @type {OdberBojlera[]} */ ((await this.storage.get(`bo:${plant}`)) ?? []);
        if (!odbery.length || !this.env.VAPID_JWK) return;
        const klic = await vapidKlic(this.env.VAPID_JWK);
        const data = { ...text, tag: OZNAMENIA.bojler };
        /** @type {string[]} */ const neplatne = [];
        for (const o of odbery) {
            const status = await posliPush(o.e, klic, now, this.fetchImpl, { data, keys: o.keys }).catch(() => 0);
            if (status === 404 || status === 410) neplatne.push(o.e);
        }
        if (neplatne.length)
            await this.storage.put(
                `bo:${plant}`,
                odbery.filter((o) => !neplatne.includes(o.e)),
            );
    }

    /**
     * Stav bojlera pre appku: posledné hlásenie zásuvky (null, keď sa ešte neozvala), bez merania - na Huawei nejde nič.
     * @param {{ pristup: Record<string, unknown> }} req @param {Date} now
     */
    async stav(req, now) {
        return { bojler: await this.sTeplotami(String(req.pristup.plant ?? ''), now) };
    }

    /**
     * Stav bojlera pre telefón: posledné hlásenie zásuvky a dnešné body teploty vody (null, keď sa ešte neozvala).
     * @param {string} plant @param {Date} now @returns {Promise<BojlerInfo | null>}
     */
    async sTeplotami(plant, now) {
        const bojler = /** @type {BojlerInfo | undefined} */ (await this.storage.get(`b:${plant}`));
        if (!bojler) return null;
        const body = /** @type {import('../../shared/bojler-voda.js').BodyVody | undefined} */ (await this.storage.get(`bt:${plant}`));
        return body?.length ? { ...bojler, teploty: teplotyDna(body, now, NB.pasmo) } : bojler;
    }

    /**
     * Režim od appky: ručne (skript relé neprepína) alebo riadi appka. Uloží ho a vráti stav bojlera
     * s novým režimom (null, keď sa zásuvka ešte neozvala).
     * @param {{ pristup: Record<string, unknown>, rucne: unknown }} req @param {Date} now
     */
    async rezim(req, now) {
        const plant = String(req.pristup.plant ?? '');
        const rucne = req.rucne === true;
        const stary = /** @type {BojlerInfo | undefined} */ (await this.storage.get(`b:${plant}`));
        const bojler = stary ? { ...stary, rucne } : null;
        await this.storage.put({ [`br:${plant}`]: rucne, ...(bojler ? { [`b:${plant}`]: bojler } : {}) });
        return { bojler: await this.sTeplotami(plant, now) };
    }
}
