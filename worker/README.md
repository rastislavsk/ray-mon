# Worker `ray-mon`

Živé meranie pre appku. Prehliadač sa na servery výrobcov meničov priamo nedostane, preto sa
ich za neho pýta tento Worker. Heslá ani nastavenie elektrárne neukladá. Pamätá si odbery ranného
oznámenia (KV `ODBERY`, nižšie), ktoré každú štvrťhodinu budí plánovaným behom, konce programov
spotrebičov (Durable Object `Budik`) a pri Huawei Northbound reláciu, posledné meranie, stav bojlera
a odbery jeho oznámení (Durable Object `UcetHuawei`, nižšie). Tajomstvá má dve – kľúč na zapečatenie prístupu a súkromný kľúč VAPID. Predpoveď si appka počíta sama v prehliadači.

**Zdieľanie:** `POST /zdielaj` dostane zapečatený prístup a vráti ten istý prístup s platnosťou
`ZDIELANIE.platiDni` dní (7). Len tá ide do odkazu Zdieľať appku – odkaz ostáva v správach
natrvalo, prístup v ňom nie. Kto ho otvorí včas, dostane pri prvom meraní (`/pv`) trvalú pečať;
neskôr Worker pečať odmietne (400) a appka vyzve pripojiť meranie znova. Odkazy z appiek spred
tejto zmeny nesú trvalú pečať a platia ďalej.

**Huawei Northbound a bojler na prebytky:** merania účtu Huawei Northbound idú cez Durable Object
`UcetHuawei` (`src/ucet.js`, väzba `UCTY`, len SQLite – bezplatný plán). Huawei pri každom prihlásení
zruší predchádzajúcu reláciu a meranie dovolí raz za 5 minút, takže telefón a zásuvka s bojlerom by sa
inak navzájom odhlasovali. Objekt drží reláciu (token platí 30 minút), čo meranie zistilo o elektrárni,
posledné meranie a stav bojlera; heslo nie, to prichádza vždy v pečati. `POST /bojler-pecat` vydá
z pečate telefónu menšiu pečať do skriptu zásuvky Shelly, `POST /bojler` je dopyt toho skriptu
každú minútu (`{ pecat, rele, w, e, zapKw, vypKw }` → `{ zapni }`). Rozhodnutie je v `shared/bojler.js`,
skript v `shared/bojler-skript.js`, návrh v `docs/navrhy/bojler-prebytky.html`. `POST /bojler-stav` s `{ pecat }`
vráti appke posledné hlásenie zásuvky (`{ bojler }`) bez merania – otvorená appka sa pýta každú minútu, aby dlaždica
Bojler nečakala na meranie Huawei (raz za 5 minút). Bezplatný plán Durable Objects dovolí 100 000 dopytov denne;
zásuvka a telefón ich minú asi 3 000, každá hodina otvorenej appky pridá 60.

**Radar:** `GET /radar/<snímka>?b=<bloky>` prepošle kúsky súboru OPERA pre kartu Radar (`src/radar.js`). Nič nepočíta
ani neukladá, odpovede drží cache Cloudflare. Bezplatný plán má 10 ms procesora na požiadavku.

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
Deye Cloud. Heslo ide Deye len ako SHA-256 a len pri pripojení; v pečati je token (platí 60 dní)
a údaje aplikácie s e-mailom, nie heslo. Pripojenie vráti aj `platiDo` - appka týždeň vopred
pripomenie obnovu a tá pýta len heslo: `/pripoj` dostane starú pečať a zvyšok doplní z nej
(`zPecate` v `src/zdroje.js`). Jednotky výkonu špecifikácia neuvádza: hodnota vyššia než dvojnásobok
inštalovaného výkonu sa berie vo wattoch.

**Huawei Northbound** (`shared/huawei-nb.js`) je účet len na čítanie, ktorý zriaďuje inštalatér. Postavené
podľa oficiálnej referencie SmartPVMS Plant V600R024C10 Northbound Interface Reference-V6 a overené
proti najnovšej cloudovej **SmartPVMS 26.2.0 Northbound API Reference**
([EDOC1100589815](https://support.huawei.com/enterprise/en/doc/EDOC1100589815)). Server zadá človek (napr.
`eu5.fusionsolar.huawei.com`) a Worker prijme len servery `*.fusionsolar.huawei.com`. Huawei dovolí
prihlásenie 5-krát za 10 minút (token platí 30 minút) a dáta v reálnom čase raz za 5 minút, preto:

- token je v pečati a Worker ho mení až po 25 minútach alebo pri kóde 305 („nie si prihlásený“),
  novú pečať vráti appke,
- meria sa raz za 5 minút a súčty všetkých elektrární či výkon všetkých meničov idú jedným dopytom,
- reálne dáta rok nemajú; tohtoročnú výrobu (`PVYield`) Worker vypýta z `getKpiStationYear` pri
  pripojení a potom najviac raz za 6 hodín (`rokAt` v pečati) - rozhranie má limit 25 dopytov denne.
  Medzitým a bez povoleného rozhrania rok dorátava appka z celkovej výroby (`shared/sucty.js`),
- meranie z pripojenia appka po uložení rovno použije (`pripojenePv`), druhé by Huawei odmietol,
- cookies, ktoré server pri prihlásení nastaví (Huawei CloudWAF a relácia), idú s každým ďalším
  dopytom ako pri bežnom HTTP klientovi,
- zoznam elektrární skúša nové `/thirdData/stations` a keď ho účet nemá povolené, staršie
  `/thirdData/getStationList` (kapitola Historical Interfaces) - niektoré integrácie, napr. Shelly,
  používajú to,
- za menič sa berú typy zariadení 1 (string inverter), 38 (residential inverter) a 23093 (menič
  s batériou, PV&ESS, pribudol v 26.2.0); elektrárni, ktorá v pečati nemá ani jeden menič (pripojená
  skôr, než appka poznala 23093), Worker zoznam zariadení vypýta raz pri meraní a zapečatí (`devsAt`),
- keď Huawei počas pripájania prihlásenie zruší (305 - ten istý účet sa prihlásil aj inde, napr.
  meranie v druhej appke), Worker sa raz prihlási znova a pokračuje.

Limity sú na **účet**, nie na appku: dve appky či zariadenia s tým istým účtom sa o ne delia
a nové prihlásenie jedného zruší prihlásenie druhého. Appky v tom istom prehliadači preto idú
jedným rytmom (`meranie-v1` v `web/refresh.js`).

Najnovšia referencia pre FusionSolar (cloud) je **SmartPVMS 26.2.0 Northbound API Reference**,
[EDOC1100589815](https://support.huawei.com/enterprise/en/doc/EDOC1100589815) - na support.huawei.com cez
produkt SmartPVMS → Reference Guides (vyhľadávanie stránky hlási „content expired“). Staršia
[EDOC1100316813](https://support.huawei.com/enterprise/en/doc/EDOC1100316813) (V600R024C10): prihlásenie
`https://{doména}/thirdData/login`, ostatné ako vo verzii pre lokálnu inštaláciu.

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

Stanica nesie aj `platiDo` (ISO čas), keď výrobca dáva prístup len na čas (Deye). Pri obnove
takého prístupu ide v tele aj stará `pecat`: Worker z nej doplní údaje, ktoré človek nezadáva
znova; cudzia, poškodená či iným spôsobom zapečatená pečať nedoplní nič.

- Neznámy spôsob alebo údaje, ktoré výrobca neprijal: **400** `{ "chyba": "udaje" }`. Cudzí
  odkaz na kiosk dostane 400 bez jediného sťahovania.
- Výrobca neodpovedá: **502** `{ "chyba": "vyrobca" }`. Bez kľúča Workera: **503** `{ "chyba": "server" }`.
- Kde výrobca chybu označil kódom (Huawei, Fox ESS, Solis, Deye), odpoveď nesie aj `kod`: krok a kód, napr.
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

## Ranné oznámenie: `POST /oznamenia`, `POST /pripomen` a budenie

Telefón, ktorý si v Nastavení zapne ranný plán dňa, sa prihlási k Web Push a pošle sem
`{ endpoint, on: true, hour, tz }` – adresu odberu, hodinu (7, 8 alebo 9, `OZNAMENIA.hours`)
a časové pásmo elektrárne (v ňom sa ráta zvolená hodina; keď sa poloha zmení, appka ho pošle znova).
`on: false` odber zruší. Worker si to uloží do KV `ODBERY` pod kľúč
`o:<odtlačok adresy>` a všetko dá do metadát kľúča. Polohu, panely, tarifu ani prístup
k meraniu nepozná – plán si telefón vypočíta sám (`sw.js`, `shared/oznamenia.js`).

`POST /pripomen` s `{ endpoint, at }` objedná jednorazové budenie (tlačidlo „Pripomeň o …“
v oznámení na Androide), najviac `OZNAMENIA.remindMaxH` hodín dopredu. Kľúč `p:…` hodinu po
svojom čase sám vyprší.

Plánovaný beh (`[triggers] crons` vo `wrangler.toml`, každých 15 minút) prečíta zoznam odberov
(jedna operácia `list` na 1 000 kľúčov, metadáta prídu s ním) a pošle **prázdny push** tým, ktorým
v ich pásme práve nastala zvolená hodina, a pripomienkam, ktorých čas prišiel. Bez obsahu netreba
šifrovať telo, stačí podpis VAPID (`src/webpush.js`, WebCrypto, bez knižnice). Adresa odberu musí
byť https a patriť známej push službe (`OZNAMENIA.pushHosts`) – inak by Worker posielal
požiadavky kamkoľvek. Odber, ktorý push služba už nepozná (404, 410), Worker zmaže.

Na bezplatnom pláne má KV denne 1 000 zápisov a 1 000 operácií `list`. Budenie spraví 192 `list`
denne (odbery a pripomienky, plus jednu na každých ďalších 1 000 kľúčov), zápis je len pri zapnutí
či zmene a pri pripomienke. Zlyhaný zápis vráti 503 a appka povie, že sa to nepodarilo.

Jeden plánovaný beh smie na bezplatnom pláne poslať najviac 50 požiadaviek – teda okolo 48 pushov
v jednej štvrťhodine (kľúč VAPID sa importuje raz za beh). Keby odberov pribudlo viac, treba
Workers Paid alebo rozložiť budenie; koľko pushov zlyhalo, píše log `budenie: … zlyhalo`.
Odber sa maže pri vypnutí, keď push služba povie 404 či 410, a sám vyprší `OZNAMENIA.odberDni`
dní (180) po poslednom poslaní z appky. Appka ho pri štarte pošle znova, keď je starší než
`OZNAMENIA.obnovDni` dní (30) – telefón, na ktorom appku už nikto neotvára, tak v úložisku neostane
navždy. Odbery uložené pred touto zmenou lehotu dostanú pri prvej obnove.

Prečo ranné oznámenie nebudí Durable Object s alarmom: migráciu Durable Objectu nejde nahrať cez
`wrangler versions upload`, ktorým sa nasadzujú pull requesty – každý taký PR by v CI spadol. Pre koniec
programu (nižšie) to treba, preto sa Worker s novou migráciou nasadí ručne (`npx wrangler deploy`) ešte
pred pull requestom; potom už migrácia nová nie je a `versions upload` prejde.

## Koniec programu a bojler: push s textom

Návrh: `docs/navrhy/spotrebic-koniec-opakovanie.html`. Tieto oznámenia nesú text – Worker ho zašifruje
pre telefón podľa RFC 8291 (`zasifruj` v `src/webpush.js`, aes128gcm cez WebCrypto, bez knižnice), takže
appka k nemu pošle aj kľúče odberu (`keys.p256dh`, `keys.auth`). Service worker text len ukáže.

`POST /koniec` s `{ endpoint, keys, id, at, title, body }` objedná oznámenie o konci programu práčky, sušičky
či umývačky (text skladá appka v chvíli zápisu, najviac `PUSH_TEXT.maxText` znakov, čas najviac
`PUSH_TEXT.maxDopreduH` hodín dopredu); `at: null` ho zruší. Drží ho Durable Object `Budik` (`src/budik.js`,
väzba `BUDIK`, migrácia `v2`, jeden objekt na odber) a alarmom ho pošle presne v čase konca – nie až pri
štvrťhodinovom budení. Zápisy behov ani plán Worker nevidí.

`POST /bojler-oznamenia` s `{ pecat, endpoint, keys, on }` (pečať telefónu) zapne či vypne telefónu oznámenia
bojlera. Odbery (najviac `PUSH_TEXT.maxOdberov` na elektráreň) drží `UcetHuawei` pod `bo:<elektráreň>` a pri
každom hlásení zásuvky, v ktorom sa zmení ohrev (`zmenaOhrevu` v `shared/bojler.js`: relé a príkon nad
`BOJLER.hotovoW`), im pošle push s dôvodom – prebytok, termostat, ručne v Shelly, výpadok spojenia. Platí
v oboch režimoch. Odber, ktorý push služba nepozná (404, 410), zmaže.

Obe cesty sú v `CESTY` s obmedzením 10 volaní za minútu; appka pri ťukaní na − a + posiela koniec až po
`PUSH_TEXT.cakajMs` bez ďalšej zmeny.

### Nastavenie (raz)

```bash
cd worker
npx wrangler kv namespace create ODBERY        # id z výpisu patrí do wrangler.toml
npx wrangler secret put VAPID_JWK              # súkromný kľúč VAPID ako JWK (JSON)
```

Verejný kľúč VAPID je v `shared/config.js` (`OZNAMENIA.vapidPublic`); súkromný k nemu patrí
len do tajomstva `VAPID_JWK`, nikdy do repozitára. Nový pár kľúčov znamená, že sa každý telefón
musí prihlásiť znova (vypnúť a zapnúť oznámenia).

## Denný limit a obmedzenie počtu požiadaviek

Bezplatný plán Workers má **100 000 požiadaviek denne** (resetuje sa o polnoci UTC). Po jeho
vyčerpaní Cloudflare vracia chybu **1027** a živé meranie do konca dňa nefunguje nikomu –
appka potom ukazuje len odhad z predpovede. Každý otvorený a viditeľný telefón s kioskom
znamená jednu požiadavku za minútu, takže limit by vyčerpalo zhruba 70 kariet otvorených
celý deň, alebo niekto úmyselne.

Obmedzenie počtu požiadaviek vo Workeri (väzba `ratelimits`, `LIMIT` vo `wrangler.toml`) kvótu
nechráni: aby Worker požiadavku odmietol, musí sa spustiť, a každé spustenie sa do limitu počíta.
Chráni niečo iné – cesty, ktoré sa dajú zneužiť: `/pripoj` (skúšanie cudzích hesiel u výrobcov
cez tento Worker), `/zdielaj`, `/oznamenia` a `/pripomen` (zapĺňanie KV), `/koniec` a `/bojler-oznamenia`
(zapĺňanie Durable Objects). Tie majú 10 volaní za
minútu na adresu a cestu (`CESTY` v `src/index.js`), nad to Worker vráti 429. Počítadlo je
približné a zvlášť v každom mieste Cloudflare; keď zlyhá, požiadavka prejde. Meranie (`/pv`)
obmedzené nie je: pýta sa každú minútu z každej otvorenej appky a bez platnej pečate nič nespraví.

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
