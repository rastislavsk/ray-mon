// Durable Object jedného účtu Huawei Northbound (návrh docs/navrhy/bojler-prebytky.html, možnosť C).
//
// Telefón aj zásuvka s bojlerom merajú z toho istého účtu. Huawei pri každom prihlásení zruší
// predchádzajúcu reláciu, dovolí 5 prihlásení za 10 minút a meranie raz za 5 minút - dve kópie
// pečate by sa navzájom odhlasovali a zamkli účet. Všetky merania účtu preto idú cez tento objekt:
// jeden token, Huawei sa pýta najviac raz za NB.meranieMs a ostatní dostanú to isté meranie.
//
// Ukladá: reláciu (token a cookies, platia 30 minút), čo meranie zistilo o elektrárni (zariadenia,
// krivku, časy dopytov - bez hesla), posledné meranie a pre bojler pamäť rozhodovania, posledný
// kontakt zásuvky a záznam dňa. Heslo neukladá: prichádza vždy v pečati od telefónu či zásuvky.
//
// Bez `cloudflare:workers` (Node by ho v testoch nenačítal): staršia podoba s `fetch`, ktorú
// Cloudflare podporuje ďalej. Telo dopytu je JSON od Workera, nie od používateľa.

import { BOJLER } from '../../shared/config.js';
import { prahyZ, rozhodni, PAMAT_ZACIATOK, zaznamenaj } from '../../shared/bojler.js';
import { NB } from '../../shared/huawei-nb.js';
import { ZdrojChyba, ZDROJE } from './zdroje.js';

/** @typedef {import('../../shared/kiosk.js').PvData} PvData */
/** @typedef {import('../../shared/bojler.js').BojlerInfo} BojlerInfo */
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
    /** @param {{ storage: Uloziste }} state @param {unknown} _env @param {typeof fetch} [fetchImpl] */
    constructor(state, _env, fetchImpl) {
        this.storage = state.storage;
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
            const body = path === '/bojler' ? await this.bojler(req, now) : await this.pv(req.pristup, now);
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
        /** @type {Record<string, unknown>} */ const zapis = { [`m:${plant}`]: { at: now.getTime(), pv: res.pv } };
        if (res.pristup) {
            zapis[`p:${plant}`] = bez(novy, BEZ_ULOZENIA);
            if (novy.tokenAt !== p.tokenAt) zapis.relacia = vyber(novy, RELACIA);
        }
        await this.storage.put(zapis);
        return { pv: res.pv, pristup: novy };
    }

    /**
     * Meranie pre telefón: meranie, prístup na zapečatenie (keď sa zmenil) a stav bojlera.
     * @param {Record<string, unknown>} pristup @param {Date} now @returns {Promise<Odpoved>}
     */
    async pv(pristup, now) {
        const r = await this.meraj(pristup, now);
        const bojler = /** @type {BojlerInfo | undefined} */ (await this.storage.get(`b:${String(pristup.plant ?? '')}`));
        const zmeneny = JSON.stringify(r.pristup) !== JSON.stringify(pristup);
        return { pv: r.pv, ...(zmeneny ? { pristup: r.pristup } : {}), bojler: bojler ?? null };
    }

    /**
     * Dopyt zásuvky: rozhodnutie a záznam dňa. Keď meranie nevyjde, rozhoduje z posledného
     * (rozhodni ho po BOJLER.tichoMin nechá vypnúť).
     * @param {{ pristup: Record<string, unknown>, rele: unknown, w: unknown, e: unknown, prahy: unknown }} req @param {Date} now
     */
    async bojler(req, now) {
        const plant = String(req.pristup.plant ?? '');
        const pv = await this.meraj(req.pristup, now).then(
            (r) => r.pv,
            async () => /** @type {{ pv: PvData } | undefined} */ (await this.storage.get(`m:${plant}`))?.pv ?? null,
        );
        const rele = req.rele === true;
        const w = cislo(req.w);
        const prahy = prahyZ(req.prahy);
        const sietKw = typeof pv?.sietKw === 'number' ? pv.sietKw : null;
        const meranieAt = pv?.measuredAt ? Date.parse(pv.measuredAt) : 0;
        const pamat = /** @type {import('../../shared/bojler.js').Pamat | undefined} */ (await this.storage.get(`bp:${plant}`));
        const r = rozhodni(pamat ?? PAMAT_ZACIATOK, { rele, w, sietKw, meranieAt, now: now.getTime(), prahy });
        const stary = /** @type {BojlerInfo | undefined} */ (await this.storage.get(`b:${plant}`));
        const energiaWh = cislo(req.e);
        const den = zaznamenaj(stary?.den ?? null, { now, tz: NB.pasmo, rele, w, energiaWh, sietKw });
        /** @type {BojlerInfo} */ const info = { kontaktAt: now.getTime(), rele, w, prebytokKw: r.prebytokKw, prahy, den };
        await this.storage.put({ [`bp:${plant}`]: r.pamat, [`b:${plant}`]: info });
        return { zapni: r.zapni, prebytokKw: r.prebytokKw, tichoMin: BOJLER.tichoMin };
    }
}
