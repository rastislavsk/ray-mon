# Architektúra

## Prehľad

```
   Open-Meteo (žiarenie, teplota, oblačnosť)      výrobca meniča (napr. kiosk FusionSolar)
            │ pre lokalitu z Nastavenia                   │
            │                                  Cloudflare Worker: POST /pripoj, /pv
            │                                  worker/src/zdroje.js → shared/ → pv
            └──────────────┬──────────────────────────────┘
                           ▼
   Appka: web/data.js (shared/solar.js počíta predpoveď) → setState → render → DOM
```

Kľúčové rozhodnutie: **výpočet predpovede je jeden (`shared/solar.js`) a dostáva lokalitu
a zostavu panelov ako parameter.** Appka ho volá v prehliadači pre elektráreň, ktorú si
používateľ zadal v karte Nastavenie (kým zadal len polohu, pre typickú strechu v nej). Tá istá funkcia
sa dá zavolať v Node z testov, takže predpoveď je overiteľná bez prehliadača aj bez siete.

Živé meranie: človek v sprievodcovi vyberie značku meniča a spôsob pripojenia
(`shared/zdroje.js` – Huawei kiosk alebo API účet od inštalatéra, Fox ESS, SolaX, Victron, Solis, Deye) a vyplní, čo spôsob chce. Appka to pošle Workeru
(`POST /pripoj`), ten údaje overí u výrobcu a vráti nájdené elektrárne, každú so **zapečateným
prístupom** (`worker/src/pecat.js`, AES-GCM tajným kľúčom Workera). Appka si uloží len pečať;
pri meraní ju pošle Workeru (`POST /pv`) a ten ju otvorí, opýta sa výrobcu a vráti `pv`. Telefón
tak heslo, kľúč ani odkaz na kiosk nedrží v čitateľnej podobe. Worker sa pýta len serverov výrobcu
(z odkazu na kiosk berie len server a kľúč, `kioskApiUrl`) a prístupy ani nastavenie elektrárne neukladá.
Bez pripojeného merania je aj „teraz“ odhad z predpovede. Návrh a prečo práve tieto značky:
`docs/navrhy/meranie-cez-api.html`.

Ranné oznámenie (Nastavenie › Oznámenia, `docs/navrhy/oznamenia.html`): telefón sa prihlási
k Web Push a Worker si uloží len adresu odberu, hodinu a časové pásmo (KV `ODBERY`). Plánovaný
beh ho v tú hodinu zobudí prázdnym pushom. Service worker `sw.js` (v koreni, súbory necachuje;
nová appka ho má cez `obloha/sw.js` s vlastným rozsahom, aby oznámenie nieslo jej logo a nie Chrome) si stiahne predpoveď a plán dňa vypočíta tou istou funkciou jadra ako blok
Plán dňa na karte Môžem? (`shared/plan-dna.js`, `shared/oznamenia.js`). Nastavenie mu appka
odkladá do Cache API, lebo service worker nevidí localStorage (`web/oznamenia.js`).

Prístup k meraniu nie je nikdy v adrese (`initUrlMirror`) – adresa končí v histórii, synchronizácii
prehliadača aj na snímkach. Do zdieľaného odkazu ide len na výslovné zaškrtnutie, a aj vtedy
zapečatený. Nastavenia spred zapečatenia majú v `pecat` holý odkaz na kiosk; Worker ho pri prvom
meraní zapečatí a `refresh.js` si novú pečať uloží.

## Vrstvy

**`shared/` – doména bez vstupov a výstupov.** Nesmie sa dotknúť DOM, siete ani
aktuálneho času. Všetko, čo potrebuje, dostane parametrom.

| Modul                                                                        | Zodpovednosť                                                                                                         |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `config.js`                                                                  | Všetky konštanty: Dvorany a typická strecha, rozsahy nastavenia, hranice výkonu, tarifa Dvorian, spotrebiče, adresy. |
| `solar.js`                                                                   | Poloha slnka, žiarenie na rovinu panelu, výkon elektrárne, bezoblačný strop, zloženie celej predpovede.              |
| `settings.js`                                                                | Nastavenie elektrárne: kontrola vstupu, uložený formát, lokality z vyhľadávania.                                     |
| `setup.js`                                                                   | Sprievodca nastavením: poradie obrazoviek, kedy sa dá ísť ďalej, prázdne nastavenie, celkový výkon.                  |
| `zdroje.js`                                                                  | Značky meničov a spôsoby pripojenia merania (dáta pre sprievodcu), tvar pripojeného merania, interval merania.       |
| `foxess.js`, `solax.js`, `victron.js`, `huawei-nb.js`, `solis.js`, `deye.js` | API výrobcov meničov: adresy, podpis či hlavičky a prevod odpovede na formát `pv` (`md5.js` pre podpis Fox ESS).     |
| `kiosk.js`                                                                   | Parser odpovede kiosku na formát `pv`.                                                                               |
| `tariff.js`                                                                  | Tarifa: rozvrh na deň, pásmo v minúte, farby, stav spotrebičov, kontrola a čítanie uloženej tarify.                  |
| `day-plan.js`                                                                | Plán dňa po štvrťhodinách: pásmo tarify, výkon z krivky dňa a z toho farba.                                          |
| `messages.js`                                                                | Všetky texty pre používateľa – spoločný vstup do `messages-core.js`, `messages-sedem.js` a `messages-statistika.js`. |
| `chart-model.js`                                                             | Geometria grafov ako čisté dáta: body, mriežky, tooltipy, súhrny.                                                    |
| `hero-model.js`                                                              | Model hlavnej karty pre daný čas – rovnaký pre „teraz“ aj pre náhľad.                                                |
| `stats.js`                                                                   | Karta Štatistika: súčty výroby po obdobiach a ich hodnota podľa tarify, výroba rozdelená do pásiem.                  |
| `daylog.js`                                                                  | Denník výroby po dňoch pre plagát Štatistiky: kontrola, zápis vyššieho súčtu, dni obdobia.                           |
| `summary.js`                                                                 | Plagát obdobia na karte Štatistika v oboch appkách: kWh, obrázok obdobia, prepočty, najlepší deň, hodnota a uhlík.   |
| `mozem.js`                                                                   | Karta Môžem?: či teraz pustiť spotrebič, a keď nie, kedy - z plánu dňa a predpovede na ďalšie dni.                   |
| `schema.js`                                                                  | Kontrola dát zo siete: `pv` z Workera a predpoveď pred zobrazením.                                                   |
| `format.js`                                                                  | Formátovanie času a čísel pre slovenské UI.                                                                          |
| `sky.js`                                                                     | Živá obloha novej appky: dve farby pozadia z času dňa, východu a západu slnka a oblačnosti.                          |
| `mozem-sky.js`                                                               | Karta Dnes novej appky: model z `mozem.js` poskladaný pre nový vzhľad (slovo, deň v číslach, oblúk, výzvy).          |
| `teraz.js`                                                                   | Karta Teraz novej appky: číslo, odporúčanie a plán z `hero-model.js` a `day-plan.js`, graf dňa, pás odporúčaní.      |
| `day-chart.js`                                                               | Graf dňa (Teraz/Terazky, detail dňa): oblačnosť, krivky, os kW, hranica s plochou, „teraz“, náhľad, pás plánu, okno. |
| `setup-flow.js`                                                              | Sprievodca nastavením ako zmeny stavu: čo urobí každé tlačidlo a pole, kam ide „Ďalej“ a „Späť“. Pre obe appky.      |
| `setup-texts.js`                                                             | Texty a čísla sprievodcu: otázky, nápisy tlačidiel, hlásenia pod poľami, riadky zhrnutia. Pre obe appky.             |
| `nastavenie.js`                                                              | Karta Nastavenie novej appky: karta strechy, riadky ELEKTRÁREŇ, výzva dokončiť a záložky pri úprave.                 |
| `sedem-dni.js`                                                               | Karta 7 dní novej appky: riadky dní s oknom a počasím, detail dňa a týždňa z modelov karty 7 dní súčasnej appky.     |

**`boot.js` – vstup stránky.** `index.html` spúšťa len jeho; on načíta `app.js` dynamickým
`import()` a keď sa graf modulov nezíde (stará verzia modulu z cache prehliadača po nasadení),
stiahne vlastné skripty znova mimo cache a raz obnoví stránku. Nič neimportuje staticky, aby sa
spustil vždy. Podrobnosti v CLAUDE.md, sekcia o nasadení a cache.

**`web/` – prehliadač.** `state.js` drží jediný stavový objekt; `setState` zlúči zmenu a
zavolá prekreslenie práve raz, rovnaká hodnota nespustí nič. `render/index.js` je jediné
miesto, ktoré kreslí, a kreslí len viditeľné karty. `interactions.js` obsahuje
poslucháče (karta Môžem? má vlastné `mozem-interactions.js`, sprievodca
`setup-interactions.js` nad spoločným `setup-wiring.js`, karta Terazky `terazky-interactions.js` nad spoločným `teraz-gestures.js`) a každý končí volaním `setState` – jedinou výnimkou sú tooltipy, ktoré nie sú
súčasťou stavu a zapisujú sa priamo. `dom.js` drží všetky odkazy do DOM, takže render
funkcie nikdy nevolajú `querySelector` samy. `svg.js` skladá SVG z modelu a nič nepočíta.
`memo.js` drží tri pomôcky, vďaka ktorým render zapisuje do DOM len to, čo sa naozaj
zmenilo (viď „Nezapisuj, čo sa nezmenilo“ nižšie). Karty sa ťahom prsta nelistujú, len ťuknutím
v navigácii. Ťah do strán listuje jedine dni v detaile dňa karty 7 dní: `day-pager.js` (spoločný
pre obe appky) vedie pás s dňom za prstom a vedľa neho postaví kópie susedných dní – nakreslí ich
ten istý `render`, zavolaný na chvíľu so susedným dňom v stave. Posun počas ťahu nie je v stave;
kam pás po pustení dobehne, rozhodne `shared/day-pager.js` a do stavu ide až výsledný deň.
`storage.js` ukladá nastavenie elektrárne do `localStorage` (`settings-store.js` ho znova vyváža a pridáva zrkadlenie do adresy). Kartu Nastavenie tvorí
prehľad uloženej elektrárne a sprievodca jej nastavením (`setup-interactions.js`,
`render/nastavenie.js`) a pod prehľadom sekcia Appka – zdieľanie (`render/zdielat.js`). Tá bola kedysi samostatnou
kartou Info; odtiaľ názvy `infoOpen`, `INFO_ITEMS` a id `info-share`, ktoré ostali, aby sa
nemenil stav ani HTML. `INFO_ITEMS` dnes zahŕňa všetky rozbaľovacie položky karty (Elektráreň,
Oznámenia, Zdieľať appku, Vymazať údaje): rozbalená je najviac jedna a je krokom navigácie, takže
ju tlačidlo Späť zbalí. Nová appka má to isté pre svoje sekcie Nastavenia (`nsOpen`, `NS_FOLDS`
v `obloha/web/state.js`, v kroku histórie `fold`), so zbaliteľnou hlavičkou ako Plán dňa. Popup s návodom k ciferníku zanikol s ciferníkom; položka histórie, ktorá
ho ešte nesie (`guide`), sa vráti na kartu bez neho. Sprievodca ukazuje vždy jednu obrazovku (`setupStep` a plocha
`setupRoof` v stave); poradie obrazoviek a to, či sa z nich dá ísť ďalej, je v
`shared/setup.js`. Obrazovka je krok navigácie, takže tlačidlo Späť na telefóne vracia
o ňu; „Späť“ v sprievodcovi ide cez `history.back()` (`backTo`), keď do aktuálnej položky
histórie appka prišla práve z cieľovej obrazovky - položka si to pamätá v `prev`.
Rozpísané nastavenie je v stave (`settingsDraft`); render z neho dopočíta súčty a hlásenia,
ale hodnoty polí prepíše len pri zmene `settingsRev`, plochy alebo obrazovky, aby neprepisoval
to, čo človek práve píše. Kto zadá celkový výkon namiesto výkonu panelu (`setupKwp`), tomu
`resolveDraft` dopočíta výkon panelu z počtu panelov - uložený formát sa nemení. Kompas,
nákres sklonu a mriežka panelov vznikajú ako modely v `chart-model.js` a SVG z nich skladá
`svg.js`; podiel smeru oproti najlepšiemu (`orientationShare`), východ a západ slnka
(`sunTimes`) aj výrobu za jasného dňa (`clearDayKwh`) počíta `solar.js`. Časť Tarifa má
obrazovky podľa typu sadzby (`tariffSteps`): jedna cena len typ a ceny, dve pásma aj rozvrh
a výnimky, tri a viac pásiem navyše pásma. Rozvrh sa maľuje prstom po kruhu, ktorý má tú istú
geometriu ako malé prstence tarify (`tariffRingModel`, `RING` v `shared/chart-model.js`); `<svg>` kruhu ostáva v stránke a render píše len
do jeho `<g>`, aby zachytenie prsta (pointer capture) vydržalo celý ťah. Upravovaný rozvrh
a pásmo, ktorým sa maľuje (`setupSched`, `setupBrush`), sú nastavenie vnútri obrazovky, nie
krok navigácie. Presná cesta aj pre klávesnicu je zoznam úsekov s formulárom pod kruhom.
Hodiny, graf dňa aj predpoveď idú podľa časového pásma lokality,
nie telefónu. Nastavenie sa dá zdieľať odkazom `…/#nastavenie=…` (`shareUrl` a
`readLink` v `shared/settings.js`): je zbalené za mriežkou, ktorú prehliadač
neposiela na server, a pri otvorení prejde tou istou kontrolou ako nastavenie z úložiska.
Appka ho len ponúkne prevziať (`incoming` v stave). Odkaz nesie verziu formátu (`v`,
`SHARE_LINK_VERSION`, pravidlo v `CLAUDE.md`); keď ho appka nevie prevziať - je poškodený,
alebo je z novšej verzie appky -, ponuka povie prečo (`linkError`) a ponúkne len Zavrieť. Adresa v prehliadači potom nesie vždy
uložené nastavenie (`initUrlMirror` v `web/settings-store.js`), bez zadaných panelov
je holá, a kým čaká ponuka, nesie odkaz. Dôvod je iPhone: appka pridaná na plochu má vlastné
úložisko, Safari s ňou nezdieľa nič okrem adresy. Pri prvom spustení z plochy tak ponúkne
nastavenie prevziať namiesto otázky na polohu. Prístup k živému meraniu adresa nenesie, takže
appka z plochy ho pripojí ešte raz; odkaz bez merania sa pritom s uloženým nastavením porovnáva
bez neho (`incomingSettings`), inak by appka po každom otvorení ponúkala prevziať samú seba. Z toho istého dôvodu manifest nemá `start_url` – bez
neho sa appka spúšťa z adresy, z ktorej ju človek pridal, aj s časťou za mriežkou.
`history.js` prekladá tlačidlo Späť na krok späť v appke: každý krok navigácie (karta,
detail dňa) pridá `pushState` položku do histórie prehliadača a `popstate` ju vráti tou
istou cestou ako klik – jediným `setState`. Adresa sa pritom nemení; položka histórie je
len značka s krokom navigácie, takže odkaz na appku ostáva jeden. Šípka späť v detaile dňa
je ten istý krok ako tlačidlo Späť, preto volajú `history.back()`
(`closeDetail`) a nový krok nezapisujú – inak by Späť na telefóne detail znovu otvorilo.

Prechod medzi kartami je iba CSS: `panelChange` v `state.js` dopočíta k novej karte aj smer
(`panelDir`), `renderPanels` ho vyloží na `#page[data-dir]` a zvyšok je animácia `panel-in-*`
v `style.css`. Spúšťa sa sama tým, že karta prejde z `display: none` do zobrazenia, takže ju
nič nereštartuje a JS o nej nevie. Posun je malý (24 px) a `.page` má `overflow-x: clip`,
aby posunutá karta nešla poscrollovať do strany; stráži to e2e test, ktorý meria pretečenie
počas celého prechodu, nie až po ňom.

Rovnakou cestou ide aj farba pozadia. `renderHeader` zapíše farbu plánu dňa v tejto chvíli
ako `data-tier` na `<html>` a tým to preň končí; zvyšok je CSS, ktoré si podľa
toho prepne `--tint-rgb` a z neho poskladá `--bg-page`. Atribút sedí na `<html>`, nie na
`<body>`, lebo `var()` vo vnútri custom property sa dosadzuje tam, kde je property zapísaná
– `--bg-page` z `:root` by zmenu na `<body>` už nevidelo. Pozadie drží farbu plánu dňa
(`hero.tier`: cena z tarify a výkon z krivky dňa), takže hovorí to isté, čo bunka pásu plánu
pod čiarou náhľadu na grafe dňa, a pri náhľade iného času ide s ním. Bodka pri čase farbu
ceny nenesie: v oboch appkách hovorí o stave merania (`bodkaMerania` v `shared/hero-model.js`
– plná živé, polovičná zastarané, krúžok len predpoveď). Že sa farba nerozíde s modelom, strážia e2e
testy: pevné časy pokryjú zelenú, oranžovú aj červenú, tarifa s jednou cenou sivú, a náhľad na grafe overí, že sa farba
mení aj s ním a po zrušení náhľadu sa vráti.

Medzi vstupmi stavu je aj `chartSizes` – skutočné rozmery plátien grafov v pixeloch.
Napĺňa ich `ResizeObserver` v `interactions.js` a render z nich cez `fillDims` postaví
plátno presne na kartu. Rozmer teda prichádza tou istou cestou ako každý iný vstup
(udalosť → `setState` → `render`), takže render funkcie nemusia nič merať a ostávajú
čisté.

**`worker/`** je tenký: otvor pečať (`pecat.js`), opýtaj sa výrobcu (`zdroje.js`, s opakovaním pri prechodnej chybe, `http.js`), zavolaj `shared/`, vráť JSON.

## Dve appky: súčasná a „Živá obloha“

Druhý dizajn (návrh `docs/navrhy/smer-b-obloha.html`) vznikol po krokoch vedľa súčasnej appky,
v priečinku `obloha/`, a beží na `…/ray-mon/obloha/`. Pôvodne mal súčasnú appku nahradiť; od 22. 10. 2026 ostávajú obe natrvalo ako **jedno jadro, dva kabáty** (návrh
`docs/navrhy/jedno-jadro-dva-kabaty.html`, pravidlá v `CLAUDE.md`). Jadro dáva obom tie isté
odpovede, kabát smie mať vlastné obrazovky a funkcie. Štyri rozdiely, ktoré menili odpoveď
(meranie, ktoré mlčí, dva zoznamy vecí, poloha bez panelov), sú zjednotené (návrhy
`meranie-mlci.html`, `jeden-zoznam-veci.html`, `poloha-bez-panelov.html`) a jadro už nevie, pre ktorú
appku počíta.

`obloha/` má vlastnú stránku (`index.html`, `style.css`, `manifest.webmanifest`), vlastný
`boot.js` s tou istou ochranou pred zmiešanou cache ako koreňový a vlastný stav, render a
poslucháče v `obloha/web/`. Pravidlá sú tie isté: jeden stav, jedno prekreslenie, `.hidden`
s `!important`, žiadne `:hover`. Čo appky zdieľajú, nie je skopírované – nová appka importuje
ten istý súbor:

- **`shared/`** celé. Zmena výpočtu sa prejaví v oboch appkách naraz. Zoznam kariet `PANELS` je
  v `config.js`, kódové názvy sú v oboch rovnaké (karta Terazky sa v novej volá Teraz, kód
  ostáva `terazky`). Obe appky sa otvárajú vždy na prvej z nich, `PANELS[0]`.
- **Worker** – tie isté endpointy, nová appka pripája aj meria rovnako (`web/data.js`).
- **Uložené nastavenie.** Obe appky sú na jednej doméne, a teda majú jeden `localStorage`
  (`elektraren-v1`, `poloha-v1`, `dni-v1`, `pocasie-v1`, `pristup-v1`, `meranie-v1`, `sucty-v1`). Číta a zapisuje ho
  ten istý kód v `web/storage.js`, takže formát sa nemôže rozísť. `pocasie-v1` je posledné počasie
  z Open-Meteo: po otvorení z neho `refresh.js` hneď ukáže predpoveď a čerstvé dáta dotiahne popri tom
  (najviac `WEATHER_KEEP_MS` staré, meranie sa neodkladá).
- **Prístup k meraniu neplatí** (`shared/pristup.js`, návrh `docs/navrhy/meranie-pristup-neplati.html`).
  Keď Worker na `/pv` odpovie 400, výrobca prístup odmietol - nie je to výpadok. `refresh.js` odmietnutia
  počíta za sebou (`pristup-v1`, aby appka po otvorení neskúšala zlé heslo hneď znova); po dvoch appka povie
  prečo (nová: riadok pod číslom na karte Teraz a karta v Nastavení, súčasná: červený pás na Terazky
  a Môžem? a hlásenie v rozbalenej Elektrárni), zahodí posledné meranie a pýta sa už len raz za hodinu.
  „Pripojiť znova“ otvorí formulár pripojeného spôsobu (`zdrojZnova`), „Skúsiť znova“ sa opýta hneď.
  Prístup na čas (Deye, `platiDo`) appka týždeň vopred pripomenie a obnoví len heslom.
- **Spoločný rytmus meraní** (`meranie-v1`, `Rytmus` v `shared/zdroje.js`). Limity výrobcov sú na účet,
  nie na appku (Huawei dá dáta raz za 5 minút a nové prihlásenie zruší predchádzajúce). Obe appky
  v tom istom prehliadači si preto zapisujú posledný dopyt aj meranie: interval spôsobu sa ráta aj od
  nevydareného dopytu a druhej appky, druhá appka ukáže hotové meranie, pred dopytom prevezme novšiu
  pečať z uloženého nastavenia a odmietnutie (`zUloziska` v `refresh.js`) a pripájanie sa ráta ako
  dopyt. Prehliadač vo WhatsAppe či appka na ploche iPhonu majú vlastné úložisko - tie sa správajú
  ako ďalšie zariadenie.
- **Súčty, ktoré výrobca neposiela** (`sucty-v1`, `shared/sucty.js`). Rok (Fox ESS, SolaX, Victron,
  Huawei bez povoleného ročného rozhrania), mesiac (SolaX, Victron) a dnešok (Victron) appka dopočíta
  z celkovej výroby: pri prvom meraní v období si zapamätá celkovú výrobu na jeho začiatku (kotvu)
  a súčet je potom celkovo teraz mínus ona. Súčet od výrobcu má prednosť a kotvu posunie - Huawei
  posiela rok z `getKpiStationYear` raz za 6 hodín a medzitým ho appka dorátava. Kým kotva nesiaha
  na začiatok obdobia, súčet je len od prvého merania: `pv.od` to povie a plagát Štatistiky
  ukáže „od 21. 10.“ a vetu, prečo. Robí to `refresh.js` pri každom meraní od Workera (`sSuctami`),
  takže obe appky dostanú to isté. Deye celkovú výrobu nedáva - jeho mesiac a rok ostávajú prázdne.
- **Nameraná krivka dňa** (`pv.realCurveToday`). Kiosk FusionSolar ju posiela s každým meraním.
  Pripojenia cez API ju berú z historického rozhrania výrobcu: Huawei Northbound `device/history`
  (5-minútové body meniča, limit pri jednom meniči raz za 10 minút), Fox ESS `history/query`, Solis
  `stationDay`, Deye `station/history` s `granularity: 1` a Victron `stats` s `solar_yield` po 15 minútach.
  Worker sa pýta pri pripojení a potom najviac raz za 15 minút (`KRIVKA` v `shared/krivka.js`), krivku
  drží v pečati a medzitým k nej pridáva aktuálny výkon (`krivkaDnes`), aby čiara v grafe dňa došla až
  k „teraz“. SolaX priebeh dňa v API nemá - graf má len bod „teraz“.
- **Neutrálne moduly vo `web/`**, ktoré nevedia nič o stave ani DOM súčasnej appky: `store.js`
  (`createStore`), `storage.js`, `data.js`, `refresh.js` (obnova dát, meranie a denník výroby,
  hodiny), `day-pager.js` (listovanie dní v detaile dňa prstom), `nav-history.js` (kroky navigácie
  v histórii prehliadača), `setup-wiring.js` (poslucháče sprievodcu nastavením a uloženie),
  `settings-store.js` (zrkadlenie nastavenia do adresy) a `svg.js` (SVG z modelov). Vznikli vytiahnutím zo `state.js`, `settings-store.js`,
  `interactions.js` a `history.js`; tie ich používajú ďalej a správanie súčasnej
  appky sa nezmenilo. `state.js` a `settings-store.js` ich znova vyvážajú, aby sa nemuseli meniť
  ich odberatelia.

Nová appka nesmie importovať nič, čo siaha na DOM alebo stav súčasnej appky (`web/state.js`,
`web/dom.js`, `web/render/`, …). Keď niečo také potrebuje, čistá časť sa vytiahne do `shared/`
alebo do neutrálneho modulu ako vyššie.

**Rýchly štart novej appky (úloha #29).** Build krok nie je, takže každý modul je samostatný súbor
a telefón ich pred prvým zobrazením sťahuje jeden po druhom podľa importov. Preto:

- **Neskoré časti.** Pri štarte sa sťahuje len jadro: úvodná karta (Môžem? alebo Teraz), hlavička,
  navigácia a obloha. Karty 7 dní, Štatistika a Nastavenie so sprievodcom sú tri časti
  (`PARTS` v `obloha/web/state.js`, vstupy `obloha/web/part-*.js`), ktoré `obloha/web/parts.js`
  načíta dynamickým `import()` – keď ich obrazovka potrebuje (`neededParts`), inak sekundu po
  prvom vykreslení, keď je prehliadač voľný. Prvé vykreslenie čaká len na časti, ktoré úvodná
  obrazovka ukazuje (na telefóne žiadnu; na širokej obrazovke stĺpec 7 dní). Stav `parts` hovorí,
  čo je načítané; kým karta nie je, render ju neukáže prázdnu, ale ukáže hlášku `#cakam`.
- **Zmiešaná cache pri neskorej časti.** `boot.js` chráni len štart. Keď neskorý `import()`
  zlyhá, hláška ponúkne tlačidlo, ktoré stiahne vlastné skripty znova (`cache: 'reload'`) a obnoví
  stránku – v jednej karte prehliadača najviac raz (`sessionStorage`), potom už len „skús to
  o chvíľu“. Záznam sa zmaže, keď sa načítajú všetky časti.
- **Texty po kartách.** `shared/messages.js` je spoločný vstup pre súčasnú appku a testy; texty sú
  v `messages-core.js` (hlášky, Môžem?, Teraz, hlavička), `messages-sedem.js` a
  `messages-statistika.js`. Jadro novej appky a moduly `shared/`, ktoré potrebuje, importujú
  len `messages-core.js`.
- **Jedno písmo.** Archivo je jeden súbor `fonts/archivo-obloha.woff2` len so znakmi, ktoré appka
  píše (namiesto podmnožín latin a latin-ext Google Fonts). Vyrába ho `scripts/font-subset.js`
  z pôvodného súboru google/fonts; `test/font-subset.test.js` ohlási znak v textoch, ktorý
  v ňom chýba. Cudzí znak (meno obce) vykreslí záložné písmo.

Rýchlosť sa meria `npm run lighthouse:obloha` (Lighthouse, emulácia pomalého mobilu, medián z 3);
vypíše aj počet a veľkosť súborov stiahnutých pred prvým zobrazením. Lokálny server hovorí HTTP/2
ako GitHub Pages (certifikát si vyrobí `openssl`, bez neho meria cez HTTP/1.1 a povie to) – pri
HTTP/1.1 Lighthouse počíta so 6 spojeniami a appka s mnohými malými modulmi by vyšla asi o pol
sekundy pomalšia, než naozaj je. Rozhoduje však meranie nasadenej appky (PageSpeed alebo
`npm run lighthouse:obloha -- https://rastislavsk.github.io/ray-mon/obloha/`): zlepšenie, ktoré
lokálne vyzerá ako 0,1 s, sa na Pages nemusí prejaviť.

Pozadie novej appky je obloha: `skyNow` v `shared/sky.js` z času, polohy a predpovede vráti dve
farby a render ich zapíše na `<html>` ako `--s1` a `--s2`. Tie sú v `style.css` zaregistrované
cez `@property` ako farby, takže sa dajú plynulo prelínať; útlm pohybu prechod vypne tým istým
pravidlom ako všetky animácie. Hodiny v tabuľke farieb (`SKY` v `config.js`) sú hodiny dňa
z návrhu, kde slnko vychádza o 7:00 a zapadá o 18:30 – skutočný východ a západ (`sunTimes`) sa do
nich premieta po úsekoch (noc, deň, večer). Počasie sú tri stavy z oblačnosti aktuálnej hodiny
predpovede; dážď zatiaľ nie, appka zrážky nesťahuje. Bez dát je obloha sivá, kým sa prvé dáta
sťahujú, ukazuje čas dňa bez počasia.

Karta Môžem? novej appky odpovedá tým istým `mozemModel` ako súčasná – slovo, veta, časy aj
odpovede vecí sú tie isté. Stav karty, veta pod veľkým slovom aj dlaždice sa riadia Plánom dňa
(`model.plan`, spotrebiče doma z Oznámení): „áno“, keď z plánu niečo ide teraz, „počkaj“, keď
príde ešte dnes, inak „dnes už nie“. Dlaždica skupiny bez spotrebiča doma sa neukáže; pás dňa
ostáva podľa slnka (zelenej). Panel veci odpovedá ďalej za vec samu (dokedy ju ešte pustiť). `mozemSkyModel` v `shared/mozem-sky.js` ich len poskladá pre nový
vzhľad: štítky (ÁNO / POČKAJ / DNES NIE / NEVIEM a LACNÁ či DRAHÁ SIEŤ), fakt v mobiloch (naisto
len zo živého a čerstvého merania, inak s „asi“), oblúk slnka (`sunArc`: skutočný
východ a západ, zelený úsek je dnešné okno so slnkom) a vetu, prečo dáta nie sú. Pri známej polohe
bez panelov odpovedá z typickej strechy (`estimate` v `mozemModel`) a priznáva odhad - rovnako ako
súčasná appka, ktorá to hovorí jantárovým pásom pod hlavičkou a riadkom „typická strecha“.

Veci sú v skupinách (`MOZEM_GROUPS` v `config.js`, návrh A v `docs/navrhy/mozem-skupiny.html`):
veľké spotrebiče, auto a bojler. Zoznam vecí (`MOZEM_ITEMS`) je jeden pre
obe appky a dlaždice skupín (`groups` v `mozemModel`) tiež - obe appky ich kreslia rovnako, každá
vo svojich farbách. Dlaždica ukáže jednu odpoveď skupiny:
najlepšiu z jej vecí, a keď svieti, koniec slnka (spoločný pre všetky), nie štart programu.
Dokedy pustiť ktorý program, povie panel skupiny – veci pod sebou, každá so svojím časom
a vysvetlením. Veci, ktoré odpovedajú inak, vymenuje riadok pod
odpoveďou dlaždice. Dlaždica s jednou vecou otvorí rovno jej panel. Panel veci či skupiny je `<dialog>` otvorený
cez `showModal()`; otvorenie je krok navigácie (`{ panel, item }` v histórii), takže ho zatvorí
aj Späť, a krížik či Escape idú cez `history.back()` ako šípka v detaile dňa súčasnej appky.
V súčasnej appke je panel `#mozem-sheet` v `index.html` a krok navigácie je `mozemItem` (`item`
v `NavStep`).

Karta Teraz a karta Terazky súčasnej appky majú to isté rozloženie (súčasná vo vlastných farbách,
návrh A v `docs/navrhy/terazky-ako-obloha.html`). Ciferník a denný prstenec zanikli, ich úlohu
preberá graf dňa. `terazModel` v `shared/teraz.js` berie výkon, pásmo a odporúčanie z `heroModel`
(aj náhľad iného času cez `previewMinutes`), plán z `dayPlan` a krátke odpovede spotrebičov
z `deviceShorts` – obe karty z neho ukazujú to isté. Graf kreslí `web/day-chart.js` a ťah po ňom
obsluhuje `web/teraz-gestures.js`, oba neutrálne moduly spoločné pre obe appky. Meranie, ktoré mlčí (`pvFreshness`), už nie
je výkon „teraz“ v žiadnej appke (`freshPowerKw` v `shared/hero-model.js`): číslo, graf aj veta
karty Môžem? vtedy počítajú z krivky dňa a povedia, že je to odhad a odkedy meranie mlčí. Geometriu grafu kreslí
`shared/day-chart.js` (návrh C2 v `docs/navrhy/terazky-casova-os.html`): hore oblačnosť po hodinách
ako riadok buniek (sýtosť je oblačnosť), predpoveď ako prerušovanú čiaru, nameranú krivku po posledný
bod ako plnú, os kW s okrúhlym krokom (`kwGridStep`), hranicu veľkých spotrebičov (`lowKw`
z `powerThresholds`, od nej je plán zelený) a plochu pod krivkou dňa – sýtu nad hranicou, jemnú pod
ňou (`fillPath`). Pod grafom je pás plánu po polhodinách – bunka má farbu štvrťhodiny vo svojom
strede – a pod ním zátvorka nad každým oknom, keď slnko stačí, s nápisom „Zapni veľké · 9–17:30“
pod najdlhším (`fitLabel`, ten istý ako v páse spotrebičov v 7 dňoch súčasnej appky). Graf je zároveň posúvač času
(`role="slider"`): prst, kurzor aj šípky ukážu náhľad. V novej appke je náhľad krok navigácie (`preview`
v kroku histórie), takže ho zruší aj Späť; posun po grafe nový krok nepridá. V súčasnej appke krokom
nie je, rovnako ako vybraný deň. Pás odporúčaní listuje prehliadač (`scroll-snap`), bodky ukazujú stránku zo stavu.

Karta 7 dní ukazuje dni ako predpoveď počasia. `shared/sedem-dni.js` berie súčty a najlepší deň
z `weekStatsModel` (deň vyberá `bestDayIndex`, ten istý v oboch appkách), celé kWh riadkov
z `weekListModel`, hlášky z `dayDetailMessage` a `weekMessage` – čísla sú tie isté ako na karte
7 dní súčasnej appky. Zelený pás v riadku je okno na veľké veci: zelené úseky plánu dňa po
štvrťhodinách (`forecastDayPlan` v `day-plan.js`; dnešok je presne `dayPlan`, takže okno sedí
s kartami Môžem? a Teraz, iný deň počíta to isté z predpovede toho dňa). Ikona počasia je
z priemernej oblačnosti dňa cez `skyWeather` (tá istá hranica ako obloha) a kreslí ju vlastná
sada troch SVG v `obloha/web/render/icons.js`. Detail dňa kreslí ten istý graf ako karta Teraz
(`web/day-chart.js`, spoločný pre obe appky), pri inom dni než dnešok bez značky „teraz“. „Teraz“ je
bod na konci nameranej krivky, stlmené bunky pásu plánu, ktoré už prešli, a bez náhľadu aj čiara
náhľadu s časom – stojí na „teraz“, kým ju prst neposunie. Krivky sú v SVG, ktoré sa s grafom
zväčšuje; popisky (hodiny, čísla osi kW, nápis hranice veľkých spotrebičov, čas náhľadu, nápis okna) sú
HTML nad ním s pevnou veľkosťou v px, takže na tablete a počítači nerastú. Nápis hranice kladie
`limitSpot` v `shared/day-chart.js` tak, aby na žiadnej šírke neprekryl krivky, bod
„teraz“ ani čiaru náhľadu (aj s časom nad ňou): tesne nad čiaru na konci alebo na začiatku, inak nad
krivku. Keď prst pri náhľade prejde ponad nápis, nápis preskočí na voľné miesto. Polohy sú dve – pre úzky graf a pre
graf široký aspoň 448 px – a vyberá ich container query v `style.css`. Detail je krok
navigácie (`detail` v kroku histórie): Späť, Escape aj šípka späť (v detaile dňa prvý čip v riadku
dní) vrátia do prehľadu, posun prehľadu aj fokus na riadok si pamätá render. Listovanie dní
v detaile nový krok nepridá; ťahom, čipmi aj šípkami na klávesnici ho vedie `web/day-pager.js`,
ten istý ako v súčasnej appke.

Karta Nastavenie novej appky má prehľad podľa návrhu (karta strechy s kompasom plôch, riadky
ELEKTRÁREŇ; čísla skladá `shared/nastavenie.js`) a sprievodcu, ktorý je **ten istý ako v súčasnej
appke**, len v novom kabáte. Čo urobí ktoré tlačidlo, je v `shared/setup-flow.js` (čisté funkcie
stav → zmena), texty v `shared/setup-texts.js`, poslucháče vo `web/setup-wiring.js` – obrazovky
sprievodcu majú v oboch appkách tie isté id a data- atribúty, takže ich obsluhuje ten istý kód
a ukladá tým istým `web/storage.js`. Každá appka si len kreslí svoje (`web/render/nastavenie.js`,
`obloha/web/render/sprievodca.js`) a dodá krok späť cez svoju históriu. Obrazovka sprievodcu je
krok navigácie aj v novej appke (`setup` a `roof` v kroku histórie); Escape je
jeho „Späť“. Úprava panelov z prehľadu má navyše
záložky Výkon, Plochy a Menič (`editTabs`), lebo riadok Panely zahŕňa všetko o streche.

Na širšej obrazovke nová appka mení rozloženie podľa šírky okna, nie podľa druhu zariadenia.
Hranice sú `LAYOUT_PX` v `shared/config.js` (stredná šírka je tá istá, od ktorej súčasná appka
kreslí desktop); `layoutOf` v `obloha/web/state.js` z nich urobí `layout` v stave a render ho
zapíše na `<html>` ako `data-layout` – `style.css` tak nemá v `@media` ani jednu šírku natvrdo.
Pod strednou šírkou (telefón, tablet na výšku) je appka taká, ako bola. Od nej sú karty Môžem?,
Teraz a 7 dní **prehľad so stĺpcami** (`dashboard`): na tablete na šírku dva, na počítači tri,
navigácia je hore. Stĺpce sú tie isté karty, ktoré vidno naraz (`shows`), nie druhá verzia –
render každej karty sa len pýta, či je na obrazovke. `panel` je v prehľade aktívny stĺpec: vyberie
ho navigácia (presunie naň fokus, krokom v histórii to nie je – `sameNavStep` berie stĺpce prehľadu
ako jednu obrazovku) alebo to, čo v ňom človek otvorí (panel veci, náhľad, detail). Pri zmene okna
sa preto ukáže práve ten stĺpec aj s tým, čo je v ňom otvorené. Štatistika a Nastavenie sú aj na
širokej obrazovke samostatná stránka. Ťah do strán listuje len dni v detaile dňa – pás s dňom je
v stĺpci 7 dní, takže ťah inde nerobí nič.

## Prečo takto

- **Jednosmerný tok.** V pôvodnej appke volalo prekreslenie hlavnej karty šesť rôznych
  miest a stav bol v dvanástich globálnych premenných. Tu vedie z každej akcie práve jedna
  cesta: udalosť → `setState` → `render`. Preto sa nedá stať, že jedna karta ukazuje iný
  čas než druhá.
- **Modely oddelené od kreslenia.** Grafy najprv vzniknú ako čísla (`chart-model.js`) a až
  potom ako SVG. Vďaka tomu je otestovateľné aj to, čo by sa inak dalo overiť len okom.
- **Texty na jednom mieste.** Odporúčania sú mriežka tarifa × výroba v `messages.js`, nie
  reťazec podmienok roztrúsený po kóde.
- **Kontrakt dát.** `schema.js` overuje, čo prišlo zo siete. Neplatné dáta sa správajú ako
  chýbajúce, takže appka nikdy neukáže rozbitý graf.
- **Nezapisuj, čo sa nezmenilo.** Zápis do DOM označí prvok za špinavý aj vtedy, keď doň
  zapíšeš to isté, čo tam už je. Účet nepríde hneď – príde, keď si appka najbližšie vypýta
  rozmery, lebo vtedy musí prehliadač dopočítať layout. Pri ťahaní jazdca po dennom prstenci
  (kým ho súčasná appka mala) tak jeden zbytočný zápis zdražel každý ďalší pohyb prsta. `memo.js` si preto pamätá, čo sám
  naposledy zapísal, a prvky, ktoré sa menia zriedka (napríklad legenda grafu dňa),
  sa prekresľujú len pri zmene vlastných vstupov. Namerané: 1,675 → 0,675 ms na pohyb na mobilnej šírke,
  2,817 → 0,892 ms na desktope. Na karte 7 dní má to isté ešte jeden dôvod: prepísané
  tlačidlo berie so sebou fokus klávesnice, takže rebríček, prepínač dní, bodky aj tabuľka
  idú cez `writeHtml`. Keď sa obsah naozaj zmení, vráti fokus na prvok na tom istom mieste.
- **Plátno grafu sa rovná karte.** Grafy sa nekreslia na pevné plátno, ktoré potom CSS
  natiahne, ale rovno na skutočný rozmer karty (`fillDims`). Naťahovanie skresľovalo
  popisky a pri nízkej karte kreslilo do zápornej plochy; opačná voľba (zachovať pomer
  strán) zase nechávala v karte prázdne miesto.

## Vedomé odchýlky od pôvodnej appky

- **Bezoblačný strop pri teplote danej hodiny.** Pôvodná appka počítala strop pri 25 °C,
  kým predpoveď pri skutočnej teplote. V chladný jasný deň preto „využitie“ vychádzalo nad
  100 %. Tu majú obe rovnakú teplotu, takže pomer vyjadruje čistú stratu oblačnosťou.
- **Okamžité žiarenie, nie hodinový priemer.** Hodinové premenné Open-Meteo sú priemerom
  predošlej hodiny, poloha slnka sa ale počíta v čase záznamu. Krivka tak bola o pol hodiny
  posunutá proti nameranej a denný súčet nízky – oproti výpočtu po minútach o 1,5 % v lete
  a 5,4 % v zime. Premenné `_instant` patria presne k svojmu času (chyba pod 0,5 %), takže
  bod o 13:00 je výkon o 13:00, rovnako ako v krivke z kiosku. Appka si pýta aj jeden deň
  dozadu (`past_days`), inak by západne od Greenwichu večer chýbala doterajšia časť dneška.
- **Dáta sa nekomitujú do repozitára.** Pôvodná appka ukladala JSON do gitu každých päť
  minút cez GitHub Actions. Teraz sa neukladajú nikde: meranie ide z kiosku rovno do
  appky a predpoveď si appka počíta sama.
- **Tarifa je nastavenie, nie konštanta.** Pôvodne boli tarifné okná v `data-` atribútoch
  skrytého zoznamu, potom natvrdo v `config.js` – a miešali tri veci: cenu zo siete (VT a NT),
  odhad slnka (zelené okno 10:30 – 17:30, v zime do 14:30, sezóny podľa severnej pologule)
  a texty. Dnes je tarifa len cena: pásma s úrovňou lacné / bežné / drahé a rozvrh dňa, ktorý
  si človek zadá sám (viď „Tarifa a plán dňa“ nižšie). Slnko berie appka z predpovede.

## Tarifa a plán dňa

Cena elektriny a slnko sú dve nezávislé veci a appka ich tak aj drží:

- **Tarifa** (`Tariff` v `config.js`, časť nastavenia) hovorí len o cene zo siete. Má jedno až
  štyri pásma, každé s úrovňou `lacna` / `bezna` / `draha`, menom a nepovinnou cenou. Rozvrh je
  zoznam zmien pásma od polnoci, takže deň je pokrytý bez dier aj prekryvov už zo stavby.
  Prvý rozvrh platí vždy, ďalšie sú výnimky pre vybrané dni v týždni alebo mesiace (víkend,
  letná sadzba) a vyhráva posledná, ktorá na deň sedí (`scheduleFor`). Sviatky appka nepozná.
- **Slnko** je výkon z krivky dňa: namerané, za hranicou merania predpoveď (`dayKwAt`).

`dayPlan` v `shared/day-plan.js` ich spojí po štvrťhodinách: pásmo, výkon a farba. Farba
je jedno pravidlo (`smartTier`): od dolnej hranice výkonu zelená – slnko pokryje veľké
spotrebiče, cena nehrá rolu – inak farba úrovne (oranžová lacné, sivá bežné, červená drahé).
Z plánu čítajú pás plánu pod grafom dňa, pozadie stránky, texty aj spotrebiče, takže bunka pásu
v zvolenom čase a farba pozadia sú vždy to isté číslo. Plán berie krivku dňa, nie živý výkon.

Texty sú mriežka úroveň × výroba (`SLOT_MESSAGES`), v noci (slnko pod obzorom) hovoria len
o cene (`NIGHT_MESSAGES`) a bez dát ostáva len cena (`PRICE_MESSAGES`). Auto a bojler sú
„go“ aj v lacnom pásme bez slnka, ostatné spotrebiče len pri slnku; v slabý deň (špička pod
hranicou slabého dňa) nie sú sušička a umývačka odporúčané vôbec.

Nastavenie uložené pred vlastnými tarifami tarifu nemá a dostane tú Dvorian (`TARIFF`), s ktorou
appka dovtedy počítala. Tarifa ide aj do odkazu `#nastavenie=…`; rozvrh má najviac 24 zmien
za deň, aby odkaz ostal rozumne krátky.

## Karta Štatistika

Karta ukazuje súčty výroby, ktoré kiosk posiela, no appka ich predtým nezobrazovala: dnes,
mesiac, rok a od spustenia (`dailyEnergyKwh` … `cumulativeEnergyKwh`). K nim pridá **hodnotu**
– koľko by za tú elektrinu človek zaplatil zo siete podľa svojej tarify.

Úspora to nie je a karta to tak ani nenazýva: kiosk hlási len výrobu, nie spotrebu domácnosti
ani pretok do siete, takže appka nevie, koľko elektriny si človek spotreboval sám. Hodnota je
horná hranica a veta pod ňou to hovorí. Posúvač vlastnej spotreby (návrh B
v `docs/navrhy/statistika-uspory.html`) je možný ďalší krok.

Cenu počíta jedna funkcia pre všetky zdroje: `energyByBand` v `shared/stats.js` rozdelí krivku
do pásiem tarify (lichobežník medzi bodmi, pásmo v strede úseku) a `averagePrice` z toho spraví
priemernú cenu kWh. Dnešok sa oceňuje z nameranej krivky – ranná výroba v drahom pásme stojí
viac než popoludňajšia v lacnom. Mesiac, rok a „spolu“ má kiosk len ako súčet, preto dostanú
priemernú cenu podľa toho, do ktorých pásiem (aj s víkendovými a sezónnymi výnimkami) padá
výroba z predpovede na najbližší týždeň. Kto nezadal ceny všetkých pásiem, eurá nevidí vôbec –
polovičné ceny by dali polovičné eurá.

Obsah je plagát obdobia (`summaryModel` v `shared/summary.js`, návrh
`docs/navrhy/statistika-ako-suhrn.html`) - ten istý v oboch appkách, každá ho kreslí vo svojich farbách;
nová appka k nemu pridá svoje stavy bez polohy a bez panelov (`statistikaModel`). Na každé obdobie
iný obrázok: dnešok voči predpovedi, mesiac ako mriežka dní, rok ako stĺpce mesiacov, celý čas ako
splatený uhlík z výroby panelov. Štvorčeky dní a stĺpce mesiacov stoja na denníku (`shared/daylog.js`),
ktorý si appka vedie sama - kiosk dni neposiela. Denník sa dopĺňa pri každej obnove merania, vždy
vyšším súčtom dňa, a až od 03:00 miestneho času (`DAYLOG.fromMin`): tesne po polnoci môže kiosk ešte
hlásiť včerajšok. Deň, keď appka nebola otvorená, chýba a plagát to povie. Bez merania je plagát sivý
odhad dneška z predpovede a ostatné obdobia sa vybrať nedajú. Zdieľanie do story (obrázok plagátu)
appka nemá - zrušilo sa spolu so súhrnom v karte Môžem?, ktorý karta Štatistika nahradila.

Obsah karty skladá render celý do `#stats-body`, v `index.html` sú len nosiče. Obdobie (`statsPeriod`) je nastavenie
vnútri karty, nie krok navigácie. Výzvy „Doplň ceny“ a „Pripojiť živé meranie“ prepnú na kartu
Nastavenie a jedným `setState` rovno otvoria ten krok sprievodcu (`stepEdit`), takže tlačidlo
Späť vráti do Štatistiky.

## Karta Dnes (kódové meno mozem, kedysi Môžem?)

Odpoveď „čo môžem zapnúť a kedy“ dáva **Plán dňa** na karte Terazky / Teraz - je v navigácii prvá
a appka sa na nej otvára (`docs/navrhy/dnes-a-teraz.html`). Nad plánom sú štítky a veta o teraz
(`chips` a `say` z `mozemModel` - tá istá veta ako hlavička, len bez spotrebičov a časov, ktoré
povie plán), plán má vetu nad sebou (`planHead`) a nová appka aj časovú os (`lanes` z
`planDnaModel`). Súčasná appka ho kreslí ako plagát s očíslovanými riadkami, nová ako vetu s časovou
osou (`docs/navrhy/terazky-plan-dna.html`, možnosti A a B) - model je ten istý.

Karta Dnes (druhá v navigácii) má hore veľké slovo o celom dni (`shared/den-trieda.js`,
`docs/navrhy/dnes-hlasky-dna.html`): trieda dňa (výborný, dobrý, slabý, nanič) z toho istého
rozvrhu ako Plán dňa, len od polnoci - koľko spotrebičov sa za deň zmestí na slnko, a či aj
s rezervou na mrak. Ráno hovorí predpoveď, cez deň namerané s predpoveďou na zvyšok a po západe
namerané. Trieda, ktorú appka videla ráno, je v telefóne (`ranna-trieda-v1`, zapisuje ju obnova
dát vo `web/refresh.js`); keď sa deň oproti nej zmení, slovo to povie. Farba plagátu súčasnej
appky ide podľa triedy dňa, stav `go`/`wait`/… už len pre vetu, štítky a pás dňa. Pod slovom je, čo dá strecha za celý deň
(`day`: `dnesDay` v `shared/mozem.js`, prepočty mobilov, km a CO2eq tie isté ako Štatistika),
pod tým pás odporúčaní (`dnesCards` v `shared/teraz.js`: dnešok a kedy bude lepšie). Dlaždice
„Čo môžem“, Plán dňa a panel veci z nej zmizli - kódové meno `mozem` ostalo z čias,
keď sa ukladala úvodná karta. Pôvodne odpovedala jedným slovom (návrh C v
`docs/navrhy/karta-mozem.html`).

Počíta `shared/mozem.js` z plánu dňa (`dayPlan`), takže „áno“ je tá istá zelená ako v pláne
grafu dňa: výkon z krivky dňa od dolnej hranice výkonu. Stav karty je `go` (teraz je zelená),
`wait` (zelená príde ešte dnes), `none` (dnešná zelená už bola), `slabo` (dnes cez deň
nebude žiadna), `offline` (predpoveď nie je) a `loading`. Ďalšie dni berie z hodinovej
predpovede. Pre spotrebiče platia pravidlá z `DEVICES`: v slabý deň sa umývačka a sušička
neodporúčajú (`weakDay`), auto potrebuje horný prah výkonu a lacné pásmo mu stačí, len
keď dnes slnko už nepríde - neskoršie slnko vyhrá nad lacnou sieťou. Typický program
spotrebiča (`MOZEM_ITEMS` v `config.js`) určuje, dokedy ho pustiť, aby dobehol na slnku,
a koľko stojí zo siete; bez ceny v tarife sa eurá nepíšu.

Model dlaždíc skupín vecí (`groups`, `items`, `mozemSheetOf`) ostal v jadre a je pokrytý testami,
hoci ho dnes žiadna karta nekreslí.

Texty sú v `messages.js`. Hlavičku karty skladá render do `#mozem-body`, pás odporúčaní je
stály nosič v `index.html` (prekreslenie mu nezmení posunutie).

Karta kedysi vedela zapísať „Pustil/a som“ - spustenie spotrebiča na čestné slovo, z ktorého
ukazovala „beží do …“ a súčty v súhrne. Kiosk vidí len výrobu, nie spotrebu, takže to overiť
nevedela a nikto to nepoužíval; od `docs/navrhy/bez-pustil-som.html` to nie je v žiadnej appke.
Staré zápisy (`spustenia-v1`) obe appky pri štarte zmažú (`OLD_STORAGE_KEYS`, `dropOldStored`).

Štatistiku karta neukazuje, ani ako odkaz do karty Štatistika.

Obe appky sa otvárajú vždy na Teraz(kách) (`PANELS[0]`, bez polohy v sprievodcovi Nastavenia).
Voľba úvodnej karty v Nastavení bola a už nie je: starú uloženú voľbu (`prva-karta-v1`) appky pri
štarte zmažú (`OLD_STORAGE_KEYS`) a `&prva=…` v starších odkazoch nečítajú - nastavenie z takého
odkazu sa prevezme rovnako.

## Karta 7 dní na mobile

Na telefóne mala karta štyri grafy a tabuľku pod sebou – pätnásť obrazoviek scrollovania,
kým sa človek dostal k tomu, čo ho zaujímalo. Je preto rozdelená na dve obrazovky:

- **Prehľad dní** – rebríček: bublina so súčtom za týždeň (so stĺpčekmi dní v malom) a pod
  ňou sedem riadkov s pásikmi a legenda ich farieb. Zmestí sa celý na jednu obrazovku.
- **Detail dňa** – otvorí ho klik na riadok rebríčka: okno na veľké spotrebiče, časová os
  dňa, tri čísla dňa a tlačidlá na susedné dni.
- **Detail týždňa** – otvorí ho klik na bublinu „Spolu za 7 dní“: denná výroba, heatmapa
  hodina × deň a správa „Najsilnejší deň“.

Správa (`weekMessage`) patrí detailu týždňa. V detaile dňa ju nahrádza karta okna na veľké
spotrebiče nad grafom (`dayWindowCard` v `shared/messages-sedem.js`) – hovorila by to isté.

V **prehľade dní** je tá istá správa (`weekMessage`) navyše, a len vtedy, keď na ňu ostalo
miesto: prehľad má byť jedna obrazovka bez scrollovania, takže správa je bonus, nie obsah.
Rozhoduje pole `tall` v stave – viditeľná výška okna oproti `WEEK_MSG_MIN_H` (885 px).
Namerané v Chromiu pri predvolenom písme: samotný prehľad sa zmestí od 735 px, so správou
potrebuje 860 px a pri najdlhšej možnej správe na 320 px širokom displeji 878 px.

Výšku dáva `visualViewport`, nie `innerHeight` ani `@media (min-height: …)`: v mobilnom
prehliadači ukrojí adresný riadok 60 – 90 px, ktoré tie dve o sebe nevedia, a správa by sa
ukázala do priestoru, ktorý vidieť nie je. Slučka z toho nevznikne – vstupom je okno, nie
obsah, takže ukázanie správy výšku okna nezmení.

Obe obrazovky majú hlavičku so šípkou späť. Rozhoduje o tom jediné pole v stave
(`weekDetail`: `'day' | 'week' | null`), prepínajú sa len triedy `.hidden` – žiadny presun
prvkov v DOM. Poradie v detaile týždňa robí jedno pravidlo `order` v CSS, lebo heatmapa je
v HTML prvá, ale na detaile má ísť posledná.

Graf v detaile dňa je časová os (`dayTimelineModel`, návrh D3 v `docs/navrhy/`): hore riadok
heatmapy dňa – výroba po hodinách v tých istých farbách a s tou istou mierkou ako riadok dňa
v heatmape týždňa (`weekHeatMax`, stupnica nad grafom), v strede krivka oblačnosti 0–100 %
(pri dnešku „teraz“; nameranú výrobu časová os nekreslí, je to predpoveď dňa), dole pás
spotrebičov z plánu dňa po
štvrťhodinách (`fitSegments` v `shared/day-plan.js`): _zapni veľké_ je tá istá zelená ako v pláne
dňa (`smartTier`), _čiastočne_ je slnko aspoň na úrovni špičky slabého dňa, zvyšok _zo siete_.
Tarifa do pásu nevstupuje – hovorí len o slnku. Zelené okno je navyše jemná plocha cez celý
graf. Pás spotrebičov je jeden odtieň zelenej v troch stupňoch jasu, overený na farbosleposť
(pozri komentár pri tokenoch v `style.css`). Oblačnosť zaberá presne plochu medzi `padT`
a `h - padB`, takže tooltip (`chartTooltipModel`) je ten istý ako nad krivkou, len bod kreslí
na oblačnosti. Na
širokej obrazovke detail dňa nie je a priebeh ostáva krivkou s oblačnosťou.

Susedné dni pod detailom (tlačidlá „‹ Streda“ a „Piatok ›“, `#week-day-steps`) aj bodky pod
hlavičkou (`#week-day-dots`) stoja v `index.html` mimo prvkov, ktoré sa pri listovaní
prisúvajú – majú stáť, nie cestovať s obsahom. Nesú `data-day-index` a prepínajú deň tým istým poslucháčom ako bodky,
aj so smerom, z ktorého sa detail prisunie.

Tie isté tri farby nesie aj výroba po dňoch – pásik a číslo v rebríčku, stĺpec a číslo nad
ním v Dennej výrobe, číslo v stĺpci Výroba v tabuľke. Pásmo počíta jediná funkcia
`weekDayTiers` v `shared/chart-model.js`: podiel z najsilnejšieho **dňa** v týždni s tými
istými hranicami (1/3, 2/3) ako bunky heatmapy, takže obe grafiky na jednej obrazovke
merajú rovnako. Deň bez výroby pásmo nemá (`null`) a ostáva nefarbený – inak by týždeň bez
jedinej kWh vyšiel celý červený.

Sýtosť sa z heatmapy nepreberá. Tam je jediným nosičom veľkosti, pri dňoch je ňou dĺžka
pásika a výška stĺpca – slabý deň by bol krátky _aj_ vyblednutý a prakticky by zmizol.
Vybraný deň sa preto v grafe neodlišuje inou farbou, ale plnou sýtosťou (`.bar.sel`).
Legenda farieb je jedna, pod heatmapou.

Od 768 px je detail vypnutý: tam je na celú kartu miesto naraz a klik na deň ho, ako
doteraz, len vyberie vo všetkých grafoch. Rozhoduje o tom podmienka `!state.wide`
v `renderSedemdni`, a `wide` je `(min-width: 768px)` – nie desktopových 1024 px. Pravidlá
poradia blokov žijú v `@media (max-width: 1023px)`, ale to je iná hranica a iná vec:
riadia `order`, nie to, či detail vôbec existuje.

### Prečo rebríček namiesto bublín a tabuľky

Prehľad mal na telefóne tri bubliny a päťstĺpcovú tabuľku, dokopy asi štyridsať čísel. Väčšina
z nich (využitie v %, špička v kW a jej hodina) je pritom to isté, čo je o ťuknutie ďalej
v detaile dňa – a tabuľka sa aj po zoškrtaní stĺpcov na telefóne posúvala do strán, takže
prvý vodorovný ťah posunul ju a kartu prelistoval až ten druhý.

Rebríček odpovedá na to, na čo sa človek na prehľade pýta: koľko toho bude a ktorý deň je
najlepší. Dĺžka pásika je výroba dňa voči najsilnejšiemu dňu v týždni (`weekListModel`
v `shared/chart-model.js`), takže sa dni porovnajú očami, bez čítania čísel. Škáluje sa
zámerne voči týždňu, nie voči stropu jasnej oblohy: otázka je „ktorý z týchto siedmich“,
nie „koľko ubrali mraky“ – to druhé hovorí využitie v detaile dňa. Znamená to, že aj
v škaredom týždni má najsilnejší deň plný pásik; číslo vedľa neho to opravuje.

Výroba je v rebríčku v celých kWh: pri predpovedi na týždeň je desatina falošná presnosť
a v riadku zaberá miesto, ktoré patrí pásiku. Rebríček sa navyše vojde do každej šírky
(pásik je pružný stĺpec mriežky), takže na mobile nezostal ani jeden vodorovne posuvný pás
a ťah do strán prelistuje kartu hneď.

Bubliny a tabuľka žijú ďalej, len od 768 px vyššie – tam je na ne miesto a majiteľ, ktorý
ladí systém, má v tabuľke všetky stĺpce pohromade. Vidno vždy práve jednu podobu prehľadu;
rozhoduje o tom `renderView` v `web/render/sedemdni.js`.

Z tabuľky ešte predtým zmizol stĺpec „Oblačnosť“ – ten istý údaj hovoril aj stĺpec „Obloha“.

## Rozloženie na desktope

Od 1024 px sa stránka správa ako obrazovka, nie ako dokument: `body` nescrolluje a karta
vyplní výšku okna. Grafy sa tak natiahnu na veľkom monitore a stlačia na nízkom notebooku.

Od 768 px mala stránka mriežku dvoch rovnakých stĺpcov: vľavo Terazky, vpravo Dnes-Zajtra
(tá preto na desktope nemala vlastnú položku v navigácii). Keď karta Dnes-Zajtra zanikla,
mriežka zanikla s ňou a Terazky idú cez celú šírku stránky (vľavo číslo a graf dňa, vpravo
odporúčania pod sebou). Stránka je tu položkou zvislého
flexu a vystredenie cez `margin: 0 auto` jej vypína naťahovanie na šírku rodiča, takže
potrebuje `width: 100%`: karta Terazky vlastnú šírku nemá (graf dňa je
`container-type: inline-size`, teda so size containmentom v osi x), takže bez
toho by sa stránka scvrkla na svoje okraje. Stráži to e2e test „karta Terazky má celú šírku
stránky“.

Meranie pred tou zmenou ukázalo, že problém bol užší, než sa zdalo: karty Terazky
a Zdieľať sa zmestili už predtým (na 1920 × 1080 im ostávalo 347 px prázdneho miesta,
lebo mali pevnú výšku), pretekala len karta 7 dní, a to o 97 až 409 px podľa výšky okna.

Na karte 7 dní dostala tabuľka vlastný stĺpec cez obe rady mriežky. Na sedem riadkov
potrebuje 315 px výšky a 385 px šírky – toľko jej celá výška mriežky dá aj na 768 px
vysokej obrazovke. Grafy sa stlačiť dajú, riadky tabuľky pod čitateľnosť nie, tak miesto
dostane to, čo ho naozaj potrebuje.

Čo v nízkom okne ustúpi: karta Terazky sa posúva sama (`overflow-y: auto`, ako Štatistika) a nad grafom
stĺpcov zmizne riadok so súčtami (do 900 px výšky) – hovorí to isté, čo kartička „7 dní
spolu“ nad ním. Plátno grafu nikdy neklesne pod 96 px; pod tým by bolo nižšie než jeho
vlastné okraje.

## Pozor na kaskádu v CSS

Utilita `.hidden` ako jediná v `style.css` používa `!important`. Predtým stála len na konci
súboru a spoliehala sa na poradie, lenže poradie rozhoduje iba pri rovnakej špecificite:
pätnásť pravidiel s `display` ju prebíjalo a dve z nich sa naozaj prejavili – legenda grafu
ohlasovala krivku, ktorá sa nekreslila. Podrobnosti a pravidlo sú v `CLAUDE.md`; stráži to
e2e test, ktorý prejde všetky prvky vo všetkých kartách.

## Testovanie

| Vrstva            | Čím                                                                        |
| ----------------- | -------------------------------------------------------------------------- |
| Doména            | `node --test`, pokrytie `shared/` aspoň 90 % riadkov                       |
| Výstup predpovede | golden súbor `test/golden/forecast.json`                                   |
| Kontrakt dát      | `schema.js` proti výstupu parsera a predpovede                             |
| Worker            | endpoint `POST /pv` proti podvrhnutému `fetch`                             |
| Appka             | Playwright: všetky karty, interakcie, chyby v konzole, prístupnosť cez axe |
| Kaskáda CSS       | `.hidden` sa skúša na každom prvku vo všetkých kartách                     |
| Rozloženie        | na 1366 × 768 nesmie žiadna karta pretekať a tabuľka ukáže všetkých 7 dní  |

E2E testy nepoužívajú vlastné očakávané reťazce – volajú tú istú funkciu ako appka a
porovnávajú ju s DOM. Test tak nezlyhá pri zmene textu, ale zlyhá, keď sa appka rozíde
s modelom.

## Známe obmedzenia

- Fixtures v `test/fixtures/` sú syntetické, vygenerované z bezoblačného modelu, nie
  stiahnuté zo živých zdrojov. Sú deterministické, čo je pre testy výhoda; nezachytia
  však zvláštnosti, ktoré skutočná odpoveď kiosku alebo Open-Meteo môže mať.
- `pv` a `forecast` sa obnovujú rôzne často (minúta a hodina), takže `updatedAt` oboch
  častí sa bežne líši.
- V grafe dennej výroby sa popisok hodnoty nad stĺpcom môže prekryť s čiarkovanou čiarou
  stropu jasnej oblohy, keď je deň blízko stropu (typicky 2 zo 7 dní). Nesúvisí to
  s veľkosťou plátna – je to tak na každej šírke.
