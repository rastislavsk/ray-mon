// Karta Teraz (docs/navrhy/teraz-navrh-2.html): scéna toku energie (docs/navrhy/teraz-tok-energie.html), čo zapnúť (mriežka
// dlaždíc, docs/navrhy/teraz-dlazdice.html), detail spotrebiča a výzvy. Graf
// dňa je v paneli karty Dnes (render/graf.js). Všetko počíta shared/teraz.js a texty sú v
// shared/messages.js - tu sa len zapisuje do DOM.

import { BEZI } from '../../shared/config.js';
import { escapeHtml } from '../../shared/format.js';
import { hlavickaModel, stavRiadok } from '../../shared/hlavicka.js';
import { PLAN_DNA_NOTE, TERAZ_BEZI, TERAZ_HREBEN, terazBublinaText, voiceTexts } from '../../shared/messages-core.js';
import { terazModel } from '../../shared/teraz.js';
import { bojlerDetail, bojlerDlazdica, bojlerDrahaDnes, bojlerRiadeny, TERAZ_BOJLER_TEXTS, tokDetail } from '../../shared/teraz-bojler.js';
import { localMinutes } from '../../shared/solar.js';
import { oknaSvietia, scenaModel } from '../../shared/teraz-scena.js';
import { polovicaDlazdice, stlpceDlazdic } from '../../shared/teraz-stlpce.js';
import { hviezdySvg, mesiacSvg, pocasieHtml, pocasieStav } from '../pocasie.js';
import { dashboard, shows } from '../state.js';
import { rezimIcon, tokIcon, vecIcon, weatherIcon } from './icons.js';
import { scenaSvg, tokPoleHtml } from './teraz-scena.js';
import { dialog, setHtml, setText, show } from './write.js';

/** @typedef {import('../../shared/teraz.js').TerazModel} Model */
/** @typedef {import('../dom.js').Dom} Dom */
/** @typedef {ReturnType<typeof voiceTexts>} Texts pevné texty v tóne appky */
/**
 * @typedef {{ id: string, tone: string, kind?: string, riadi?: string, rezim?: 'appka' | 'rucne' | null, pred?: string, velky: string,
 *   meno: string, podiel: number | null, draha?: number, odr: string[], potom?: { text: string, dlho: boolean } | null,
 *   bezDetailu?: boolean }} Dlazdica
 * `bezDetailu`: dlaždica bez detailu (auto zo slnka) nie je tlačidlo - ťuknutie na ňu nič neotvorí.
 */

/** Texty bubliny, keď riadok bublinu nemá. */
const BEZ_BUBLINY = { nadpis: '', text: '', tlacidlo: '' };

/** Riadok stavu merania hovorí vždy o teraz - zvolený čas je len v grafe dňa. */
const TERAZ = { preview: false, source: '' };

/**
 * Stav merania v hlavičke za miestom (shared/hlavicka.js, stavRiadok): bodka, po ťuknutí bublina s vysvetlením. Tvar bodky drží data-tone na tlačidle. Patrí karte Teraz - na ostatných kartách nie je.
 * @param {import('../state.js').AppState} state @param {Dom} dom
 */
function renderStav(state, dom) {
    const r = stavRiadok(hlavickaModel(state, state.voice), TERAZ);
    show(dom.stav, !!r && shows(state, 'terazky'));
    const { text, tone, toneText, tip } = r ?? { text: '', tone: 'off', toneText: '', tip: null };
    setText(dom.status, text);
    setText(dom.tone, toneText);
    dom.live.dataset.tone = tone;
    dom.live.disabled = !tip;
    const open = state.stavTip && !!tip;
    dom.stav.classList.toggle('open', open);
    dom.live.setAttribute('aria-expanded', String(open));
    // Čas a slovo vidno len bez bubliny - a kým appka nenabehla, keď do nich boot.js píše hlášku o chybe. S bublinou
    // ich čítačka číta ďalej, na oko stav vysvetľuje bublina (jej nadpis začína tou istou bodkou).
    dom.status.classList.toggle('sr', !!tip);
    dom.tip.dataset.tone = tone;
    show(dom.tip, open);
    show(dom.tipBg, open);
    const t = tip ?? BEZ_BUBLINY;
    setText(dom.tipTitle, t.nadpis);
    setText(dom.tipText, t.text);
    setText(dom.tipBtn, t.tlacidlo);
    show(dom.tipBtn, !!t.tlacidlo);
}

/**
 * Pás dní (docs/navrhy/teraz-pas-dni.html): každý deň je čip s menom, ikonou počasia a pásom svetla
 * od východu po západ, zlatým tam, kde slnko stačí na veľké spotrebiče; biela čiarka je teraz. Čip je
 * tlačidlo - ťuknutie ukáže plán toho dňa.
 * @param {Model['hreben']} h @param {Dom} dom
 */
function renderHreben(h, dom) {
    show(dom.tzHreben, !!h);
    if (!h) return;
    const pct = (/** @type {number} */ x) => `${Math.round(x * 1000) / 10}%`;
    dom.tzHrebenDni.setAttribute('aria-label', TERAZ_HREBEN.label);
    // Zvolený deň nie je v HTML tlačidiel - ťuknutie ich tak neprepíše a fokus ostane, kde bol.
    setHtml(
        dom.tzHrebenDni,
        h.dni
            .map(
                (d, i) =>
                    // Meno dňa a či slnko stačí je pre čítačku za skratkou - prístupné meno tak obsahuje to, čo je vidno.
                    `<button type="button" data-den="${i}"${i === 0 ? ' data-dnes' : ''}${d.nad ? ' data-nad' : ''}>` +
                    `<b>${escapeHtml(d.den)}</b>${d.pocasie ? weatherIcon(d.pocasie) : ''}` +
                    `<span class="pd-pas" aria-hidden="true"><span class="pd-okna">${d.okna.map((o) => `<i style="left:${pct(o.zac)};width:${pct(o.kon - o.zac)}"></i>`).join('')}</span>` +
                    `${i === 0 && h.teraz !== null ? `<i class="pd-teraz" style="left:${pct(h.teraz)}"></i>` : ''}</span>` +
                    `<span class="sr"> – ${escapeHtml(d.nad ? d.name : `${d.name}, ${TERAZ_HREBEN.pod}`)}</span></button>`,
            )
            .join(''),
    );
    Array.from(dom.tzHrebenDni.children).forEach((b, i) => b.setAttribute('aria-pressed', String(i === h.zvoleny)));
}

/**
 * Dlaždica spotrebiča (docs/navrhy/teraz-dlazdice.html, teraz-dlazdice-odrazky.html, teraz-pasik-zdroje.html): ikona
 * v kruhu, veľké číslo, meno, pásik slnka a siete a najviac dve odrážky, z ktorých druhou môže byť odznak. Prvky
 * idú vždy v tomto poradí a pásik je aj tam, kde nie je čo ukázať (prázdny, drží miesto): dlaždice v rade zdieľajú
 * riadky mriežky, takže číslo aj pásik sú v nich na rovnakej výške, a odrážky majú vždy miesto na dva riadky,
 * takže sú všetky dlaždice rovnako vysoké. Odrážky sú riadky `small`, pre čítačku oddelené čiarkou.
 * `kind` je druh veci, ktorá teraz nejde (lacné pásmo má modrý čas), `rezim` značka pri ikone, kto bojler zapína.
 * Zapnutý spotrebič (beží, alebo bojler, ktorému zásuvka zapla relé) má zelenú ikonu a jemný obrys (`data-zapnuty`,
 * docs/navrhy/teraz-pole-noc-bezi.html, 3A). `stlpec` (l, p) je stĺpec samostatnej dlaždice; `pol` je polovica dvojice
 * (docs/navrhy/teraz-dlazdice-stlpce.html, B): ikona vedľa čísla a jedna odrážka, mriežku riadkov nezdieľa.
 * `oziv` je dlaždica, ktorej ikona po ťuknutí na oznámenie ožije, a ako (`data-oziv`, pohyb robí CSS).
 * @param {Dlazdica} d @param {string} [stlpec] @param {boolean} [pol] @param {Ozivenie | null} [oziv]
 */
const dlazdicaHtml = (d, stlpec = '', pol = false, oziv = null) =>
    `<${znacka(d)} class="dl${pol ? ' dl-pol' : ''}"${stlpec ? ` data-stlpec="${stlpec}"` : ''}${stavDlazdice(d, oziv)}>` +
    `<span class="dl-ico" aria-hidden="true">${vecIcon(d.id)}${rezimHtml(d.rezim)}</span>` +
    `<span><span class="velky">${predHtml(d.pred)}${escapeHtml(d.velky)}</span><b>${escapeHtml(d.meno)}</b>${rezimSr(d.rezim)}` +
    `<i class="podiel"${d.podiel === null ? ' data-prazdny' : ` style="--s:${d.podiel}%;--n:${100 - (d.draha ?? 0)}%"`}></i>` +
    `<small class="odr">${d.odr.map((t) => `<span>${escapeHtml(t)}</span>`).join('<span class="sr">, </span>')}` +
    `${d.potom ? `${d.odr.length ? '<span class="sr">, </span>' : ''}<em class="potom"${d.potom.dlho ? ' data-dlho' : ''}>${escapeHtml(d.potom.text)}</em>` : ''}</small></span></${znacka(d).split(' ')[0]}>`;

/** Prvok dlaždice: tlačidlo, ktoré otvorí detail, alebo bez detailu len blok. @param {Dlazdica} d */
const znacka = (d) => (d.bezDetailu ? 'div' : 'button type="button"');

/**
 * Zapnutý spotrebič: beží (zapísaný „Už beží“), alebo bojler, ktorému zásuvka zapla relé (to je zmerané).
 * @param {Dlazdica} d
 */
const zapnuty = (d) => d.tone === 'bezi' || d.riadi === 'bezi';

/**
 * Atribúty stavu dlaždice: tón, druh, zapnutý, oživená ikona a id veci - `data-vec` otvorí detail, dlaždica bez detailu
 * má `data-id`. @param {Dlazdica} d @param {Ozivenie | null} oziv
 */
const stavDlazdice = (d, oziv) =>
    ` data-tone="${d.tone}"${d.kind ? ` data-kind="${d.kind}"` : ''}${zapnuty(d) ? ' data-zapnuty' : ''}` +
    `${oziv?.id === d.id ? ` data-oziv="${oziv.druh}"` : ''} data-${d.bezDetailu ? 'id' : 'vec'}="${d.id}"`;

/**
 * Oživená ikona po ťuknutí na oznámenie (docs/navrhy/oznamenia-animacie.html): dlaždica a druh pohybu - `plan`,
 * `koniec`, `pripomen`, pri bojleri `zapol` či `vypol` podľa toho, či teraz hreje.
 * @typedef {{ id: string, druh: string }} Ozivenie
 */

/**
 * Ktorá ikona ožije: spotrebič z oznámenia, keď má dlaždicu, inak prvý spotrebič v pláne - čo ide teraz alebo
 * najbližšie, nie čo už beží. Len pri dnešku.
 * @param {import('../state.js').AppState['tzOziv']} ciel @param {NonNullable<Model['co']>} co @param {Dlazdica[]} veci
 * @returns {Ozivenie | null}
 */
function ozivenie(ciel, co, veci) {
    if (!ciel || co.den) return null;
    return (ciel.udalost === 'plan' ? null : ozivenieVeci(ciel, veci)) ?? prvyVPlane(co);
}

/**
 * Spotrebič z oznámenia, ak má dlaždicu. Bojler sa zapol, ak teraz hreje, inak vypol.
 * @param {Exclude<import('../../shared/oznamenia.js').Ciel, { udalost: 'plan' }>} ciel @param {Dlazdica[]} veci
 * @returns {Ozivenie | null}
 */
function ozivenieVeci(ciel, veci) {
    const d = veci.find((x) => x.id === ciel.vec);
    if (!d) return null;
    return { id: d.id, druh: ciel.udalost === 'bojler' ? (zapnuty(d) ? 'zapol' : 'vypol') : ciel.udalost };
}

/** Prvý spotrebič v pláne: čo ide teraz, inak najbližší. @param {NonNullable<Model['co']>} co @returns {Ozivenie | null} */
function prvyVPlane(co) {
    const id = co.hore.dlazdice[0]?.id ?? co.hore.dalsi?.id ?? co.riadky[0]?.id;
    return id ? { id, druh: 'plan' } : null;
}

/**
 * Značka režimu bojlera na kraji kruhu s ikonou (docs/navrhy/teraz-pole-noc-bezi.html): ruka (ručne), slnko (riadi appka).
 * @param {'appka' | 'rucne' | null | undefined} rezim
 */
const rezimHtml = (rezim) => (rezim ? `<i class="dl-rz" data-rezim="${rezim}">${rezimIcon(rezim)}</i>` : '');

/** Režim bojlera pre čítačku slovom - kruh s ikonou čítačka nečíta. @param {'appka' | 'rucne' | null | undefined} rezim */
const rezimSr = (rezim) => (rezim ? `<span class="sr">, ${escapeHtml(TERAZ_BOJLER_TEXTS.rezim[rezim])}</span>` : '');

/**
 * Čo zapnúť (docs/navrhy/teraz-dlazdice.html): pri inom dni hláška dňa (docs/navrhy/teraz-hlaska-dna.html), pod tým dlaždice v dvoch stĺpcoch (docs/navrhy/teraz-dlazdice-stlpce.html):
 * vľavo práčka so sušičkou ako dvojica polovičných dlaždíc a umývačka podľa času, vpravo bojler a pod ním auto.
 * Poradie, z ktorého ľavý stĺpec vychádza: čo beží, čo ide teraz (alebo najbližšia vec), ďalšie spotrebiče
 * zvoleného dňa, čo dobehlo. Každá dlaždica nesie `data-vec`, ťuknutie otvorí detail spotrebiča. Bez Plánu dňa
 * (bez predpovede, nič doma) nie je. `bojler` je dlaždica bojlera, ktorý riadi zásuvka (pri dnešku, inak null).
 * `ciel` je ťuknutie na oznámenie, ktoré ešte čaká (ožije ikona jednej dlaždice).
 * @param {Model['co']} co @param {Dom} dom @param {Dlazdica | null} bojler @param {import('../state.js').AppState['tzOziv']} ciel
 */
function renderCo(co, dom, bojler, ciel) {
    show(dom.tzCo, !!co);
    if (!co) return;
    show(dom.tzDen, !!co.den);
    setText(dom.tzDenHlaska, co.den ?? '');
    const veci = dlazdiceCo(co, bojler);
    const html = dlazdiceHtml(veci, ozivenie(ciel, co, veci));
    setHtml(dom.tzDlazdice, html);
    show(dom.tzDlazdice, html !== '');
}

/**
 * Dlaždice Čo zapnúť v poradí karty: čo beží, čo ide teraz (alebo najbližšia vec), bojler riadený zásuvkou,
 * ďalšie spotrebiče zvoleného dňa, čo dobehlo. Iný deň má len svoje spotrebiče.
 * @param {NonNullable<Model['co']>} co @param {Dlazdica | null} bojler @returns {Dlazdica[]}
 */
function dlazdiceCo(co, bojler) {
    const h = co.hore;
    const dnes = !co.den;
    const p = h.dalsi;
    const hore = dnes
        ? [
              ...h.dlazdice,
              ...(p ? [{ id: p.id, tone: 'tiche', velky: p.cas, meno: p.name, podiel: p.podiel, draha: p.draha, odr: p.odr }] : []),
          ]
        : [];
    const dalsie = co.riadky.map((r) => ({
        id: r.id,
        tone: 'tiche',
        kind: r.kind,
        pred: 'pred' in r ? r.pred : '',
        velky: r.cas,
        meno: r.name,
        podiel: r.podiel,
        draha: r.draha,
        odr: r.odr,
    }));
    return [...bezia(co, dnes), ...hore, ...(dnes && bojler ? [bojler] : []), ...dalsie, ...autoCo(co)];
}

/**
 * Dlaždica auta čisto zo slnka (docs/navrhy/auto-mimo-planu.html, Z1): v pravom stĺpci pod bojlerom, bez detailu.
 * `?? null`: model zo starého shared/teraz.js z cache po nasadení `auto` nemá.
 * @param {NonNullable<Model['co']>} co @returns {Dlazdica[]}
 */
function autoCo(co) {
    const a = co.auto ?? null;
    return a ? [{ id: 'auto', tone: 'tiche', ...a, bezDetailu: true }] : [];
}

/**
 * Dva stĺpce dlaždíc (shared/teraz-stlpce.js) v jednej mriežke: bloky idú striedavo ľavý a pravý, každý má svoj
 * stĺpec (`data-stlpec`), takže sa rad zarovná, aj keď jednému stĺpcu blok chýba. Dvojica je jeden blok s dvoma
 * polovičnými dlaždicami pod sebou.
 * @param {Dlazdica[]} veci @param {Ozivenie | null} oziv
 */
function dlazdiceHtml(veci, oziv) {
    const { lavy, pravy } = stlpceDlazdic(veci);
    /** @param {Dlazdica[]} b @param {string} s */
    const blok = (b, s) =>
        b.length === 1
            ? dlazdicaHtml(b[0], s, false, oziv)
            : `<div class="dl-par" data-stlpec="${s}">${b.map((d) => dlazdicaHtml(polovicaDlazdice(d), '', true, oziv)).join('')}</div>`;
    let html = '';
    for (let i = 0; i < Math.max(lavy.length, pravy.length); i++)
        html += (lavy[i] ? blok(lavy[i], 'l') : '') + (pravy[i] ? blok(pravy[i], 'p') : '');
    return html;
}

/**
 * Dlaždice toho, čo človek zapol a ešte beží (docs/navrhy/teraz-bezi-spotrebic.html): idú v stĺpci hore. Iný deň ich
 * nemá. `?? []`: model zo starého shared/teraz.js z cache po nasadení toto pole nemá.
 * @param {NonNullable<Model['co']>} co @param {boolean} dnes
 */
const bezia = (co, dnes) => (dnes ? (co.bezi ?? []) : []);

/** Malé slovo pred veľkým číslom („do 20:30“, „od 22:00“). @param {string | undefined} pred */
const predHtml = (pred) => (pred ? `<span class="pred">${escapeHtml(pred)} </span>` : '');

/**
 * Os dňa v detaile spotrebiča (docs/navrhy/teraz-iny-den.html, 1A): tenká os, na nej plný úsek
 * spotrebiča (zo slnka zelený, z lacnej siete modrý), pri dnešku biela čiara „teraz“, pod tým hodiny.
 * Všetko v % osi, takže sa naťahuje so šírkou panelu.
 * @param {NonNullable<Model['os']>} os @param {NonNullable<Model['veci'][number]['slot']>} slot
 */
function osHtml(os, slot) {
    const now = slot.dnes && os.now !== null ? `<i class="os-teraz" style="left:${os.now}%"></i>` : '';
    const ticks = os.ticks.map((t) => `<span class="os-t" style="left:${t.at}%">${t.label}</span>`).join('');
    return (
        `<div class="os"><i class="os-ciara"></i>` +
        `<i class="os-usek" data-tone="${slot.tone}" style="left:${slot.left}%;width:${slot.width}%"></i>${now}${ticks}</div>`
    );
}

/**
 * Detail spotrebiča: ikona, meno, kedy a odkiaľ, od-do (pri inom dni aj deň), jeho úsek na osi dňa,
 * prečo práve vtedy a že naraz ide len toľko, koľko strecha utiahne. Otvorený, kým je v stave
 * a spotrebič je v pláne.
 * @param {import('../state.js').AppState} state @param {Model | null} m @param {Dom} dom
 */
function renderVecSheet(state, m, dom) {
    const v = state.tzVec && m && !(state.tzVec === 'bojler' && riadeny(state)) ? (m.veci.find((x) => x.id === state.tzVec) ?? null) : null;
    if (v && m?.os) {
        dom.tzVecSheet.dataset.tone = v.tone;
        setHtml(dom.tzVecIco, vecIcon(v.id));
        setText(dom.tzVecName, v.name);
        setText(dom.tzVecKedy, v.kedy);
        // Čas iného dňa nikdy bez dňa - inak by sa čítal ako dnešný.
        setHtml(dom.tzVecCas, `${v.den ? `<span class="vec-den">${escapeHtml(v.den)}</span>` : ''}${escapeHtml(v.cas)}`);
        show(dom.tzVecPas, !!v.slot);
        setHtml(dom.tzVecPas, v.slot ? osHtml(m.os, v.slot) : '');
        renderZapis(v, dom);
        setText(dom.tzVecWhy, v.why);
    }
    const id = state.tzVec;
    dialog(dom.tzVecSheet, !!v, () => (shows(state, 'terazky') && id ? dom.tzCo.querySelector(`[data-vec="${id}"]`) : null));
    if (v) polohaKolies(dom);
}

/**
 * Zápis v detaile spotrebiča (docs/navrhy/teraz-bezi-spotrebic.html, docs/navrhy/spotrebic-cas-nastavenie.html, A + D):
 * čo dnes už dobehlo, „Už beží“ a po ňom - či keď spotrebič beží - nastavenie času s „Nastaviť“: kolieska zvyšku
 * programu (práčka, sušička), výber času zapnutia (umývačka), kedy skončí; pri bežiacom aj „Nebeží“. Spotrebič, ktorý sa
 * zapísať nedá, ani iný deň zápis nemá. Že naraz ide len toľko, koľko strecha utiahne, hovorí o pláne - nie o tom, čo už beží.
 * `?? []`: model zo starého shared/teraz.js z cache po nasadení tieto polia nemá.
 * @param {object} v detail spotrebiča - iný deň (shared/tyzden.js) pole `zapis` nemá
 * @param {Dom} dom
 */
function renderZapis(v, dom) {
    /** @type {import('../../shared/teraz.js').VecZapis | null} */
    const z = 'zapis' in v ? /** @type {any} */ (v.zapis) : null;
    renderHotove(z?.hotove ?? [], dom);
    show(dom.tzVecZapis, !!z);
    const bezi = z?.stav === 'bezi';
    const cas = z?.cas ?? null;
    show(dom.tzVecNote, !bezi);
    setText(dom.tzVecNote, bezi ? '' : PLAN_DNA_NOTE);
    show(dom.tzVecZapol, !cas);
    setText(dom.tzVecZapol, TERAZ_BEZI.zapol);
    show(dom.tzVecNastav, !!cas);
    show(dom.tzVecOk, !!cas);
    setText(dom.tzVecOk, TERAZ_BEZI.nastav);
    show(dom.tzVecZrus, bezi);
    setText(dom.tzVecZrus, TERAZ_BEZI.nebezi);
    renderCas(cas, dom);
}

/**
 * Nastavenie času: „Zostáva“ s kolieskami (práčka, sušička) či „Zapnutá o“ s výberom času (umývačka) a kedy skončí.
 * @param {import('../../shared/teraz.js').NastavCas | null} cas @param {Dom} dom
 */
function renderCas(cas, dom) {
    setText(dom.tzVecTtl, cas?.zvysok ? TERAZ_BEZI.zostava : TERAZ_BEZI.zapnuta);
    setText(dom.tzVecKonci, cas?.konci ?? '');
    renderKolesa(cas?.zvysok ?? null, dom);
    renderOd(cas?.od ?? '', cas?.max ?? '', dom);
}

/** Čas zapnutia umývačky vo výbere času telefónu (prázdny = skrytý), najviac teraz (`max`). @param {string} od @param {string} max @param {Dom} dom */
function renderOd(od, max, dom) {
    show(dom.tzVecOd, !!od);
    dom.tzVecOd.max = max;
    if (od && dom.tzVecOd.value !== od) dom.tzVecOd.value = od;
}

/** Položky kolieska 0…`po` (minúty s nulou na začiatku). @param {number} po @param {boolean} nula */
const polozkyKolesa = (po, nula) =>
    Array.from({ length: po + 1 }, (_, i) => `<div aria-hidden="true">${nula ? String(i).padStart(2, '0') : i}</div>`).join('');

/**
 * Kolieska zvyšku programu práčky a sušičky: hodiny 0 až BEZI.maxZvysokMin, minúty 0–59. Sú to spinbuttony - hodnotu
 * hovoria aria-valuenow a aria-valuetext; kam sú otočené, nastaví polohaKolies, až keď je panel otvorený.
 * @param {{ h: number, m: number } | null} zv @param {Dom} dom
 */
function renderKolesa(zv, dom) {
    show(dom.tzVecKolesa, !!zv);
    if (!dom.tzVecKh.childElementCount) setHtml(dom.tzVecKh, polozkyKolesa(Math.floor(BEZI.maxZvysokMin / 60), false));
    if (!dom.tzVecKm.childElementCount) setHtml(dom.tzVecKm, polozkyKolesa(59, true));
    setText(dom.tzVecJh, TERAZ_BEZI.h);
    setText(dom.tzVecJm, TERAZ_BEZI.min);
    /** @type {Array<[HTMLElement, string, string, number]>} */
    const kolesa = [
        [dom.tzVecKh, TERAZ_BEZI.hodiny, TERAZ_BEZI.h, zv?.h ?? 0],
        [dom.tzVecKm, TERAZ_BEZI.minuty, TERAZ_BEZI.min, zv?.m ?? 0],
    ];
    dom.tzVecKh.setAttribute('aria-valuemax', String(Math.floor(BEZI.maxZvysokMin / 60)));
    for (const [el, label, jedn, hodnota] of kolesa) {
        el.setAttribute('aria-label', label);
        el.setAttribute('aria-valuenow', String(hodnota));
        el.setAttribute('aria-valuetext', `${hodnota} ${jedn}`);
    }
}

/**
 * Otočí kolieska na hodnotu zo stavu (aria-valuenow), keď na nej nestoja - po otvorení panelu, po klávesnici či ťuknutí
 * na položku a keď appka zvyšok obmedzí. Koliesko, ktoré človek práve točí (`data-toci`, web/teraz-interactions.js),
 * nechá - prekreslenie z iného dôvodu ho nesmie vrátiť. Volá sa, až keď je panel otvorený (skryté nemá rozmery).
 * @param {Dom} dom
 */
function polohaKolies(dom) {
    if (dom.tzVecKolesa.classList.contains('hidden')) return;
    for (const el of [dom.tzVecKh, dom.tzVecKm]) {
        const krok = el.firstElementChild instanceof HTMLElement ? el.firstElementChild.offsetHeight : 0;
        const ciel = Number(el.getAttribute('aria-valuenow')) * krok;
        if (krok && !el.dataset.toci && Math.abs(el.scrollTop - ciel) > 1) el.scrollTop = ciel;
    }
}

/** Čo dnes už dobehlo: riadok na beh, čas vpravo. @param {import('../../shared/teraz.js').VecZapis['hotove']} hotove @param {Dom} dom */
function renderHotove(hotove, dom) {
    show(dom.tzVecHotove, hotove.length > 0);
    setHtml(dom.tzVecHotove, hotove.map((h) => `<li>${escapeHtml(h.text)}<span>${escapeHtml(h.cas)}</span></li>`).join(''));
}

/**
 * Bublina po „Nastaviť“ a „Nebeží“ (docs/navrhy/spotrebic-cas-nastavenie.html, P1): čo sa nastavilo a či príde oznámenie
 * o konci (`koniecOznam` toho spotrebiča), s „Vrátiť“. Len na karte Teraz.
 * @param {import('../state.js').AppState} state @param {Dom} dom
 */
function renderVecBublina(state, dom) {
    // `?? null`: starý web/state.js z cache po nasadení pole vecBublina nemá.
    const b = shows(state, 'terazky') ? (state.vecBublina ?? null) : null;
    show(dom.vecBublina, !!b);
    if (!b) return;
    const oznam = state.koniecOznam?.id === b.id ? state.koniecOznam.stav : null;
    const nowMin = localMinutes(state.now, state.site.timezone);
    setText(dom.vecBublinaText, terazBublinaText(b.id, b.k === null ? null : { k: b.k }, nowMin, oznam));
    setText(dom.vecBublinaVrat, TERAZ_BEZI.vratit);
}

/**
 * Riadi bojler zásuvka? `?? null`: starý web/state.js z cache po nasadení pole bojler nemá.
 * @param {import('../state.js').AppState} state
 */
const riadeny = (state) => bojlerRiadeny(state.bojler ?? null, state.now);

/**
 * Spotrebiče, s ktorými appka radí: bojler, ktorý riadi zásuvka, nie - má vlastnú dlaždicu so stavom.
 * @param {import('../state.js').AppState} state
 */
const spotrebice = (state) => (riadeny(state) ? state.doma.filter((d) => d !== 'bojler') : state.doma);

/**
 * Meranie elektromera pre smer toku - len čerstvé (nie staršie než 15 minút), inak null.
 * @param {import('../state.js').AppState} state
 */
function meranieToku(state) {
    const pv = state.pv;
    const at = pv?.measuredAt ? Date.parse(pv.measuredAt) : NaN;
    return pv && state.now.getTime() - at < 15 * 60 * 1000 ? { vyrobaKw: pv.realTimePowerKw, sietKw: pv.sietKw, meraneAt: at } : null;
}

/**
 * Scéna toku energie (docs/navrhy/teraz-tok-energie.html): len kresba, čísla sú v poli toku (renderTokPole). Výkon
 * panelov je číslo karty (meranie, inak predpoveď), sieť a dom len z čerstvého merania elektromera. Bez predpovede
 * scéna nie je (null). `data-tok` hovorí obsluhe ťuknutia, že je čo ukázať v paneli Elektrina teraz.
 * @param {import('../state.js').AppState} state @param {Model} m @param {Dom} dom
 */
function renderScena(state, m, dom) {
    const ok = m.kind === 'ok';
    show(dom.tzScena, ok);
    if (!ok) return null;
    const siet = meranieToku(state)?.sietKw;
    const s = scenaModel({ vyrobaKw: m.vykon, odhad: m.odhadVykonu, sietKw: typeof siet === 'number' ? siet : null });
    const noc = m.pocasie?.noc === true;
    setHtml(dom.tzScenaKresba, scenaSvg(s, noc, oknaSvietia(noc, state.now, state.site.timezone)));
    dom.tzScena.setAttribute('aria-label', s.popis);
    dom.tzScena.toggleAttribute('data-tok', !!s.siet);
    return s;
}

/**
 * Pole toku energie pod pásom dní, len pri dnešku (docs/navrhy/teraz-pole-noc-bezi.html, 1A): stojí na mieste
 * hlavičky iného dňa, takže dlaždice sú v každom dni na tej istej výške. Ťuknutie otvorí panel Elektrina teraz,
 * keď je čo ukázať (meranie elektromera hovorí, kam tečie sieť), inak je tlačidlo vypnuté.
 * @param {ReturnType<typeof scenaModel> | null} s @param {Model['co']} co @param {Dom} dom
 */
function renderTokPole(s, co, dom) {
    const ukaz = !!s && !!co && !co.den;
    show(dom.tzTok, ukaz);
    if (!s || !ukaz) return;
    setHtml(dom.tzTok, tokPoleHtml(s));
    dom.tzTok.disabled = !s.siet;
}

/**
 * Panel Elektrina teraz (T3, otvorí ho ťuknutie na scénu alebo na pole toku): panely → dom → stĺp, po vedeniach tečú bodky (rýchlosť podľa kW, pri odbere
 * od stĺpu k domu). Otvorený, kým je v stave tzChip 'tok' a meranie je čerstvé.
 * @param {import('../state.js').AppState} state @param {Dom} dom
 */
function renderTokSheet(state, dom) {
    const m = state.tzChip === 'tok' ? meranieToku(state) : null;
    const d = m ? tokDetail(m, state.now, state.site.timezone) : null;
    if (d) {
        setHtml(dom.tzTokIco, tokIcon('dom'));
        setText(dom.tzTokTtl, d.nadpis);
        setText(dom.tzTokPod, d.pod);
        const x = [34, 140, 246];
        /** @param {number} a @param {number} b @param {number | null} krok @param {string} tone @param {boolean} spat */
        const vedenie = (a, b, krok, tone, spat) =>
            `<line class="tok-ved" x1="${a}" y1="30" x2="${b}" y2="30"/>` +
            (krok === null
                ? ''
                : `<line class="tok-bod" data-tone="${tone}"${spat ? ' data-spat' : ''} x1="${a}" y1="30" x2="${b}" y2="30" style="--krok:${krok}s"/>`);
        setHtml(
            dom.tzTokGraf,
            `<svg viewBox="0 0 280 92" role="img" aria-label="${escapeHtml(d.popis)}">` +
                vedenie(x[0] + 22, x[1] - 22, d.krokSlnko, 'slnko', false) +
                vedenie(x[1] + 22, x[2] - 22, d.krokSiet, d.smer, d.smer === 'dnu') +
                d.uzly
                    .map(
                        (u, i) =>
                            `<circle class="tok-uzol" cx="${x[i]}" cy="30" r="22"/>${tokIcon(u.id, `x="${x[i] - 12}" y="18" width="24" height="24"`)}` +
                            `<text class="tok-kw"${i === 2 ? ` data-smer="${d.smer}"` : ''} x="${x[i]}" y="72">${escapeHtml(u.kw)}</text>` +
                            `<text class="tok-l" x="${x[i]}" y="87">${escapeHtml(u.l)}</text>`,
                    )
                    .join('') +
                `</svg>`,
        );
    }
    dialog(dom.tzTokSheet, !!d, () => (shows(state, 'terazky') ? dom.tzScena : null));
}

/**
 * Dlaždica bojlera, ktorý riadi zásuvka (docs/navrhy/bojler-prebytky.html, variant A): stav namiesto rady.
 * Ťuknutie otvorí panel Bojler dnes (ten istý krok ako detail spotrebiča). Inak null.
 * @param {import('../state.js').AppState} state @param {Model['co']} co @param {Model['bojler']} plan @returns {Dlazdica | null}
 */
function bojlerTeraz(state, co, plan) {
    // Len pri dnešku - iný deň v hrebeni ukazuje plán, nie čo sa deje teraz.
    if (!co || co.den || !riadeny(state) || !state.bojler) return null;
    const b = state.bojler;
    return {
        id: 'bojler',
        ...bojlerDlazdica(b, state.now, state.site.timezone, plan),
        draha: bojlerDrahaDnes(b, state.now, state.site.timezone, state.tariff),
    };
}

/**
 * Panel Bojler dnes: pás dňa, štyri čísla a behy. Otvorený, kým je v stave tzVec 'bojler' a bojler riadi zásuvka.
 * @param {import('../state.js').AppState} state @param {Dom} dom @param {Model['bojler']} plan
 */
function renderBojlerSheet(state, dom, plan) {
    const b = state.tzVec === 'bojler' && riadeny(state) ? state.bojler : null;
    if (b) {
        const d = bojlerDetail(b, state.now, state.site.timezone, plan);
        setHtml(dom.tzBojlerIco, vecIcon('bojler'));
        setText(dom.tzBojlerTtl, d.nadpis);
        setText(dom.tzBojlerPod, d.pod);
        setText(dom.tzBojlerPlan, d.plan);
        show(dom.tzBojlerPlan, !!d.plan);
        renderVoda(d.voda, dom.tzBojlerVoda);
        const R = TERAZ_BOJLER_TEXTS.rezim;
        setText(dom.tzBojlerRezimN, R.nazov);
        // Biela plocha pod zvoleným tlačidlom prejde na druhú stranu (css/teraz.css, .bj-rezim::before).
        dom.tzBojlerRezim.dataset.rucne = String(d.rezim.rucne);
        for (const btn of dom.tzBojlerRezim.querySelectorAll('button')) {
            const rucne = btn.dataset.bojlerRezim === 'rucne';
            setText(btn, rucne ? R.rucne : R.appka);
            btn.setAttribute('aria-pressed', String(rucne === d.rezim.rucne));
            btn.disabled = state.bojlerRezim === 'uklada';
        }
        setText(dom.tzBojlerRezimT, d.rezim.popis);
        // Po uložení na chvíľu zelené „Uložené“ namiesto popisu režimu.
        const ulozene = state.bojlerRezim === 'ulozene';
        show(dom.tzBojlerRezimT, !ulozene);
        show(dom.tzBojlerRezimOk, ulozene);
        setText(dom.tzBojlerRezimOkT, R.ulozene(d.rezim.rucne));
        show(dom.tzBojlerRezimChyba, state.bojlerRezim === 'chyba');
        setText(dom.tzBojlerRezimChyba, R.chyba);
        renderBojlerOznam(state, dom);
        const teraz = d.pas.teraz === null ? '' : `<i class="os-teraz" style="left:${d.pas.teraz}%"></i>`;
        setHtml(
            dom.tzBojlerPas,
            `<div class="os bj-pas"><i class="os-ciara"></i>` +
                d.pas.useky.map((u) => `<i class="os-usek" data-tone="${u.tone}" style="left:${u.left}%;width:${u.width}%"></i>`).join('') +
                teraz +
                d.pas.ticks.map((t) => `<span class="os-t" style="left:${t.at}%">${t.label}</span>`).join('') +
                `</div>`,
        );
        setHtml(
            dom.tzBojlerCisla,
            d.cisla
                .map(
                    (c) => `<div><b${c.tone ? ` data-tone="${c.tone}"` : ''}>${escapeHtml(c.v)}</b><small>${escapeHtml(c.l)}</small></div>`,
                )
                .join(''),
        );
        setHtml(
            dom.tzBojlerBehy,
            d.behy
                .map(
                    (r) =>
                        `<p><span>${escapeHtml(r.cas)}</span><i data-tone="slnko">${escapeHtml(r.slnko)}<span class="sr"> ${TERAZ_BOJLER_TEXTS.zoSlnka}</span></i>` +
                        `<i data-tone="siet">${escapeHtml(r.siet)}<span class="sr"> ${TERAZ_BOJLER_TEXTS.zoSiete}</span></i></p>`,
                )
                .join(''),
        );
    }
    dialog(dom.tzBojlerSheet, !!b, () => (shows(state, 'terazky') ? dom.tzCo.querySelector('[data-vec="bojler"]') : null));
}

/**
 * Krivka teploty vody dnes (docs/navrhy/bojler-teplota.html, P1): čiara a plocha v SVG natiahnutom na šírku panela,
 * čiara cieľa, bod teraz a popisky v HTML, aby sa písmo nenaťahovalo so SVG.
 * @param {ReturnType<typeof bojlerDetail>['voda']} v @param {HTMLElement} el
 */
function renderVoda(v, el) {
    show(el, !!v);
    if (!v) return;
    el.setAttribute('aria-label', v.popis);
    const pct = (/** @type {number} */ y) => Math.round((y / v.h) * 10000) / 100;
    const bod = `left:${Math.round((v.bod.x / v.w) * 10000) / 100}%;top:${pct(v.bod.y)}%`;
    const ciel = v.ciel
        ? `<i class="bj-voda-ciel" style="top:${pct(v.ciel.y)}%"></i><span class="bj-voda-ct" style="top:${pct(v.ciel.y)}%">${escapeHtml(v.ciel.text)}</span>`
        : '';
    setHtml(
        el,
        `<div class="bj-voda-plocha"><svg viewBox="0 0 ${v.w} ${v.h}" preserveAspectRatio="none" aria-hidden="true">` +
            v.plochy.map((d) => `<path class="bj-voda-p" d="${d}"/>`).join('') +
            v.ciary.map((d) => `<path class="bj-voda-c" d="${d}" vector-effect="non-scaling-stroke"/>`).join('') +
            `</svg>${ciel}<i class="bj-voda-bod" style="${bod}"></i>` +
            `<b class="bj-voda-t" style="${bod}">${escapeHtml(v.bod.text)}</b></div>` +
            `<div class="bj-voda-osi" aria-hidden="true">${v.ticks.map((t) => `<span style="left:${t.at}%">${t.label}</span>`).join('')}</div>`,
    );
}

/**
 * Vypínač oznámení o zapnutí a vypnutí bojlera (docs/navrhy/spotrebic-koniec-opakovanie.html) a prečo sa nepodaril.
 * `?? false`, `?? null`: starý web/state.js z cache po nasadení tieto polia nemá.
 * @param {import('../state.js').AppState} state @param {Dom} dom
 */
function renderBojlerOznam(state, dom) {
    const O = TERAZ_BOJLER_TEXTS.oznam;
    const stav = state.bojlerOznamStav ?? null;
    setText(dom.tzBojlerOznamT, O.nazov);
    dom.tzBojlerOznam.setAttribute('aria-checked', String(state.bojlerOznam ?? false));
    dom.tzBojlerOznam.disabled = stav === 'uklada';
    const chyba = stav === 'zakazane' ? O.zakazane : stav === 'chyba' ? O.chyba : '';
    show(dom.tzBojlerOznamChyba, !!chyba);
    setText(dom.tzBojlerOznamChyba, chyba);
}

/** @param {import('../state.js').AppState} state @param {Dom} dom */
export function renderTeraz(state, dom) {
    const T = voiceTexts(state.voice).TERAZ_TEXTS;
    renderStav(state, dom);
    renderVecBublina(state, dom);
    if (!shows(state, 'terazky')) {
        renderVecSheet(state, null, dom);
        dialog(dom.tzBojlerSheet, false, () => null);
        dialog(dom.tzTokSheet, false, () => null);
        return;
    }
    const m = terazModel(
        { ...state, previewMinutes: null },
        // `?? 0`: starý web/state.js z cache po nasadení pole tzDen nemá (CLAUDE.md, Nasadenie a cache).
        { online: state.online, voice: state.voice, devices: spotrebice(state), den: state.tzDen ?? 0 },
    );
    renderPocasie(state, m, dom);
    const s = renderScena(state, m, dom);
    // Svitanie (index.html): krivka dňa beží, kým appka čaká na prvú predpoveď.
    show(dom.tzSvitanie, m.kind === 'loading');
    show(dom.tzSub, m.sub !== '');
    setText(dom.tzSub, m.sub);
    show(dom.tzNote, !!m.note);
    setText(dom.tzNoteTitle, m.note?.title ?? '');
    setText(dom.tzNoteText, m.note?.text ?? '');
    show(dom.tzNoteBtn, !!m.note?.btn);
    setText(dom.tzNoteBtn, m.note?.btn ?? '');
    show(dom.tzRetry, m.retry);
    setText(dom.tzRetry, T.retry);
    show(dom.tzGuess, m.guess);
    setText(dom.tzGuessTitle, T.guessTitle);
    setText(dom.tzGuessText, T.guessText);
    setText(dom.tzGuessBtn, T.guessBtn);
    show(dom.tzAsk, m.ask);
    setText(dom.tzAskTitle, T.askTitle);
    setText(dom.tzAskText, T.askText);
    setText(dom.tzAskBtn, T.askBtn);
    renderHreben(m.co ? m.hreben : null, dom);
    // Starý web/state.js z cache po nasadení `tzOziv` nemá - undefined je ako null (CLAUDE.md, Nasadenie a cache).
    renderCo(m.co, dom, bojlerTeraz(state, m.co, m.bojler), state.tzOziv);
    renderTokPole(s, m.co, dom);
    // Dlaždice v noci na svetlom skle (docs/navrhy/teraz-pole-noc-bezi.html, 2B): tmavé sklo by na nočnej oblohe zmizlo.
    dom.tzCo.toggleAttribute('data-noc', m.pocasie?.noc === true);
    renderVecSheet(state, m, dom);
    renderBojlerSheet(state, dom, m.bojler);
    renderTokSheet(state, dom);
}

/**
 * Počasie v pozadí karty (docs/navrhy/teraz-pocasie-2.html), vždy teraz. Bez dát o počasí nie je, s vypnutou
 * živou oblohou (Nastavenie › Vzhľad) tiež - kto ju vypol, chcel pokoj. V prehľade so stĺpcami
 * nie je: vrstva siaha cez celú šírku obrazovky, nie len cez stĺpec Teraz.
 * @param {import('../state.js').AppState} state @param {Model} m @param {Dom} dom
 */
function renderPocasie(state, m, dom) {
    const p = state.liveSky && !dashboard(state) ? m.pocasie : null;
    show(dom.wx, !!p);
    // Slnko stojí v rohu; na karte Dnes ho posúva čas jej posuvníka (render/mozem.js).
    dom.wx.removeAttribute('data-dnes');
    if (p) kresliPocasie(dom.wx, p);
}

/**
 * Kresba počasia do nosiča `el` (pozadie karty, panel s grafom dňa): vrstvy, stav, sila dažďa, noc, skutočné
 * hviezdy a Mesiac. @param {HTMLElement} el @param {import('../../shared/pocasie.js').Pocasie} p
 */
export function kresliPocasie(el, p) {
    setHtml(el, pocasieHtml());
    el.dataset.wx = pocasieStav(p);
    // Sila dažďa (docs/navrhy/dazd-sily.html); staršie jadro z cache ju nepošle - kresba ukáže bežný dážď.
    if (p.dazd) el.dataset.dazd = p.dazd;
    else delete el.dataset.dazd;
    el.toggleAttribute('data-noc', p.noc);
    // Skutočné hviezdy do vlastných vrstiev, mimo HTML počasia - ich posun nereštartuje oblaky.
    // Bez nich (cez deň, alebo staršie jadro z cache po nasadení) ostanú hviezdy z CSS.
    const ma = Array.isArray(p.hviezdy);
    el.toggleAttribute('data-hviezdy', ma);
    const [a, b] = ma ? hviezdySvg(/** @type {import('../../shared/hviezdy.js').Hviezda[]} */ (p.hviezdy)) : ['', ''];
    const vrstvy = el.querySelectorAll('.wx-stars, .wx-stars2');
    setHtml(vrstvy[0], a);
    setHtml(vrstvy[1], b);
    // Mesiac len vtedy, keď naozaj stojí v poli pohľadu; rovnako mimo HTML počasia.
    const [svetlo, mesiac] = p.mesiac ? mesiacSvg(p.mesiac) : ['', ''];
    const luna = el.querySelectorAll('.wx-moonglow, .wx-moon');
    setHtml(luna[0], svetlo);
    setHtml(luna[1], mesiac);
    el.toggleAttribute('data-mesiac-stlmeny', p.mesiac?.stlmeny === true);
}
