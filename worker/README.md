# Worker `ray-mon`

Živé meranie pre appku. Prehliadač sa na servery výrobcov meničov priamo nedostane, preto sa
ich za neho pýta tento Worker. Nič neukladá: nemá úložisko ani plánované behy. Má jediné
tajomstvo – kľúč na zapečatenie prístupu. Predpoveď si appka počíta sama v prehliadači.

Spôsoby pripojenia sú v `shared/zdroje.js` (čo vidí človek) a vo `src/zdroje.js` (ako sa
Worker pripojí a meria). Dnes kiosk Huawei FusionSolar, kľúč Fox ESS (Open API, podpísané
požiadavky na `www.foxesscloud.com`), token SolaX (`www.solaxcloud.com`) a token Victron VRM
(`vrmapi.victronenergy.com`). Prevod odpovedí je v `shared/` (`foxess.js`, `solax.js`,
`victron.js`), sieť vo `src/zdroje.js`. Ako často sa appka pýta, určuje `intervalMs` spôsobu
podľa limitov výrobcu (Fox ESS 1 440 dopytov denne na menič → každé 3 minúty).

**Solis** (`shared/solis.js`): kľúč od podpory Solis (API ID a API Secret), požiadavky na
`www.soliscloud.com:13333` podpísané HmacSHA1 podľa dokumentácie SolisCloud API V2.0 (Content-MD5,
Date, Authorization). Jeden dopyt `userStationList` vráti výkon aj súčty s jednotkami. Port 13333
Worker smie, lebo od dátumu kompatibility 2024-09-02 platí `allow_custom_ports`.

**Deye** (`shared/deye.js`): vlastná aplikácia majiteľa (AppId, AppSecret) a e-mail s heslom do
Deye Cloud. Heslo ide Deye len ako SHA-256 a len pri pripojení; v pečati je token (platí 60 dní),
nie heslo - po 60 dňoch treba Deye pripojiť znova. Jednotky výkonu špecifikácia neuvádza: hodnota
vyššia než dvojnásobok inštalovaného výkonu sa berie vo wattoch.

**Huawei Northbound** (`shared/huawei-nb.js`) je účet len na čítanie, ktorý zriaďuje inštalatér. Postavené
podľa oficiálnej referencie SmartPVMS Plant V600R024C10 Northbound Interface Reference-V6 (cloudová
verzia SmartPVMS 25.x je na webe Huawei momentálne nedostupná). Server zadá človek (napr.
`eu5.fusionsolar.huawei.com`) a Worker prijme len servery `*.fusionsolar.huawei.com`. Huawei dovolí
prihlásenie 5-krát za 10 minút (token platí 30 minút) a dáta v reálnom čase raz za 5 minút, preto:

- token je v pečati a Worker ho mení až po 25 minútach alebo pri kóde 305 („nie si prihlásený“),
  novú pečať vráti appke,
- meria sa raz za 5 minút a súčty všetkých elektrární či výkon všetkých meničov idú jedným dopytom,
- meranie z pripojenia appka po uložení rovno použije (`pripojenePv`), druhé by Huawei odmietol,
- cookies, ktoré server pri prihlásení nastaví (Huawei CloudWAF a relácia), idú s každým ďalším
  dopytom ako pri bežnom HTTP klientovi,
- zoznam elektrární skúša nové `/thirdData/stations` a keď ho účet nemá povolené, staršie
  `/thirdData/getStationList` (kapitola Historical Interfaces) - niektoré integrácie, napr. Shelly,
  používajú to.

Referencia priamo pre FusionSolar (cloud) je **SmartPVMS V600R024C10 Northbound Interface
Reference-V6 (FusionSolar SmartPVMS)**, [EDOC1100316813](https://support.huawei.com/enterprise/en/doc/EDOC1100316813):
prihlásenie `https://{doména}/thirdData/login`, ostatné ako vo verzii pre lokálnu inštaláciu.

## Zapečatený prístup a kľúč `PECAT_KLUC`

Pri pripojení Worker prevezme údaje z formulára (odkaz, kľúč, heslo), overí ich u výrobcu
a appke vráti len **pečať**: údaje potrebné na meranie zašifrované AES-GCM (`src/pecat.js`).
Telefón tak drží balíček, ktorý vie otvoriť iba tento Worker – kto vytiahne úložisko telefónu,
k účtu výrobcu sa nedostane.

Kľúč je v nastavení Workera, nie v repozitári. Raz ho treba vytvoriť (32 náhodných bajtov
v base64) a uložiť:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

```bash
cd worker && npx wrangler secret put PECAT_KLUC
```

Bez kľúča Worker meria ďalej zo starých holých odkazov na kiosk, ale pripájať nevie (`/pripoj`
vráti 503). **Výmena kľúča** zneplatní všetky pečate – každý sa musí v Nastavení pripojiť znova.

## Endpoint `POST /pripoj`

Telo je JSON ako text: `{ "sposob": "huawei-kiosk", "udaje": { "odkaz": "https://…" } }`. Worker
údaje overí u výrobcu a vráti nájdené elektrárne:

```json
{ "stanice": [{ "nazov": "Dvorany", "pecat": "v1.…", "pv": { "realTimePowerKw": 6.41, "...": "..." } }] }
```

- Neznámy spôsob alebo údaje, ktoré výrobca neprijal: **400** `{ "chyba": "udaje" }`. Cudzí
  odkaz na kiosk dostane 400 bez jediného sťahovania.
- Výrobca neodpovedá: **502** `{ "chyba": "vyrobca" }`. Bez kľúča Workera: **503** `{ "chyba": "server" }`.
- Kde výrobca chybu označil kódom, odpoveď nesie aj `kod`: krok a kód, napr.
  `{ "chyba": "udaje", "kod": "prihlasenie:20400" }`. Nič tajné - appka podľa neho povie, čo presne
  výrobca odmietol, a ten istý riadok ide do logu Workera (Observability), kde sa dá dohľadať aj spätne.

## Endpoint `POST /pv`

Telo je text: pečať z `/pripoj`. Worker ju otvorí, opýta sa výrobcu a vráti:

```json
{ "pv": { "realTimePowerKw": 6.41, "...": "...", "updatedAt": "2026-09-05T11:00:00.000Z" } }
```

Keď sa pri meraní prístup obnovil (nový token), odpoveď nesie aj novú `pecat` a appka si ju
uloží. Prijme aj **holý odkaz na kiosk**, ktorý posielali appky spred zapečatenia: vtedy k meraniu
pribalí jeho pečať a appka si ju uloží namiesto odkazu.

- Cudzia alebo poškodená pečať, cudzí odkaz: **400** bez jediného sťahovania. Z Workera sa tak
  nedá spraviť proxy na čokoľvek iné než servery výrobcov zo `src/zdroje.js`.
- Nedostupný výrobca: **502**. Odpoveď neobsahuje odkaz, kľúč ani podrobnosti.
  Na kiosk čaká Worker najviac 5 s a pri výpadku alebo 5xx to skúsi ešte raz (`VYROBCA_RETRY`
  v `shared/config.js`). Odpoveď 4xx (napr. neplatný kľúč) sa neopakuje – druhý pokus by
  dopadol rovnako.

## Spoločné pre oba endpointy

- Údaje a pečať sú v tele, nie v adrese, aby neskončili v logoch. Worker si ich nikam neukladá
  a telo nezapisuje do logov.
- Telo je `text/plain` (aj JSON pri `/pripoj`), takže prehliadač nerobí predbežnú CORS požiadavku.
- Telo dlhšie než 10 000 znakov dostane 400.
- Iné cesty vracajú 404, iné metódy 405, `OPTIONS` dostane 204. Odpovede sa necachujú.

## Denný limit a obmedzenie počtu požiadaviek

Bezplatný plán Workers má **100 000 požiadaviek denne** (resetuje sa o polnoci UTC). Po jeho
vyčerpaní Cloudflare vracia chybu **1027** a živé meranie do konca dňa nefunguje nikomu –
appka potom ukazuje len odhad z predpovede. Každý otvorený a viditeľný telefón s kioskom
znamená jednu požiadavku za minútu, takže limit by vyčerpalo zhruba 70 kariet otvorených
celý deň, alebo niekto úmyselne.

Obmedzenie počtu požiadaviek vo Workeri (väzba `ratelimit`) zámerne nie je. Na kvótu by
nepomohlo: aby Worker požiadavku odmietol, musí sa spustiť, a každé spustenie sa do limitu
počíta. Chránilo by len kiosky FusionSolar pred zahltením cez tento Worker – pri pár
používateľoch zbytočné.

Keby sa limit začal míňať, možnosti sú dve:

- **Workers Paid** (5 $ mesačne) – denný limit nemá.
- **Vlastná doména** namiesto `workers.dev` a na nej pravidlo Rate limiting v Cloudflare
  WAF. To zastaví nadmerné požiadavky ešte pred Workerom, takže sa do kvóty nepočítajú.
  Treba potom zmeniť aj `WORKER_URL` v `shared/config.js`.

Koľko požiadaviek denne Worker dostáva, ukazuje dashboard → Workers & Pages →
`ray-mon` → Metrics.

## Nasadenie

**Git integrácia**: Cloudflare dashboard → Workers & Pages → `ray-mon` →
Settings → Build → Connect to Git, root directory `worker/`. Po každom pushnutí do `main`
sa Worker nasadí sám.

Oba príkazy bežia z Root directory, teda už z `worker/`, a `wrangler.toml` si nájdu samy:

| Príkaz                              | Ako ho nastaviť                |
| ----------------------------------- | ------------------------------ |
| **Deploy command** (vetva `main`)   | `npx wrangler deploy`          |
| **Version command** (pull requesty) | `npx wrangler versions upload` |

Prepínač `--config worker/wrangler.toml` nepatrí ani do jedného: cesta sa zdvojí na
`worker/worker/wrangler.toml` a build zlyhá na `ENOENT: no such file or directory`.
Stalo sa to pri prvom builde Workera `ray-mon` – tento súbor dovtedy tvrdil, že Version
command beží z koreňa repozitára.

## Overenie

```bash
npm --prefix worker test                                   # endpointy proti fixtures
cd worker && npx wrangler deploy --dry-run --outdir dist   # zbalí sa aj shared/
```

Podrobnejšie hlásenia sú v logoch Workera (dashboard → Observability), ktoré sú zapnuté
vo `wrangler.toml`.
