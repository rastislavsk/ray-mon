# Architektúra

## Prehľad

```
   Open-Meteo (žiarenie, teplota, oblačnosť)      Huawei FusionSolar kiosk
            │ pre lokalitu z Nastavenia                   │
            │                                  Cloudflare Worker: POST /pv
            │                                  shared/kiosk.js → pv
            └──────────────┬──────────────────────────────┘
                           ▼
   Appka: web/data.js (shared/solar.js počíta predpoveď) → setState → render → DOM
```

Kľúčové rozhodnutie: **výpočet predpovede je jeden (`shared/solar.js`) a dostáva lokalitu
a zostavu panelov ako parameter.** Appka ho volá v prehliadači pre elektráreň, ktorú si
používateľ zadal v karte Nastavenie (kým zadal len polohu, pre typickú strechu v nej). Tá istá funkcia
sa dá zavolať v Node z testov, takže predpoveď je overiteľná bez prehliadača aj bez siete.

Živé meranie: kto si v Nastavení vložil odkaz na kiosk FusionSolar, tomu ho appka pošle
Workeru (`POST /pv`, odkaz v tele) a Worker kiosk stiahne a prevedie na `pv`. Z odkazu
berie len server a kľúč kiosku (`kioskApiUrl`) a adresu dát si zloží sám, takže nesťahuje
nič iné než kiosk FusionSolar. Bez odkazu je aj „teraz“ odhad z predpovede. Worker nič
neukladá a nemá plánované behy.

## Vrstvy

**`shared/` – doména bez vstupov a výstupov.** Nesmie sa dotknúť DOM, siete ani
aktuálneho času. Všetko, čo potrebuje, dostane parametrom.

| Modul            | Zodpovednosť                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| `config.js`      | Všetky konštanty: Dvorany a typická strecha, rozsahy nastavenia, hranice výkonu, tarifa Dvorian, spotrebiče, adresy. |
| `solar.js`       | Poloha slnka, žiarenie na rovinu panelu, výkon elektrárne, bezoblačný strop, zloženie celej predpovede.              |
| `settings.js`    | Nastavenie elektrárne: kontrola vstupu, uložený formát, lokality z vyhľadávania.                                     |
| `setup.js`       | Sprievodca nastavením: poradie obrazoviek, kedy sa dá ísť ďalej, prázdne nastavenie, celkový výkon.                  |
| `kiosk.js`       | Parser odpovede kiosku na formát `pv`.                                                                               |
| `tariff.js`      | Tarifa: rozvrh na deň, pásmo v minúte, farby, stav spotrebičov, kontrola a čítanie uloženej tarify.                  |
| `day-plan.js`    | Plán dňa po štvrťhodinách: pásmo tarify, výkon z krivky dňa a z toho farba.                                          |
| `messages.js`    | Všetky texty odporúčaní pre používateľa.                                                                             |
| `chart-model.js` | Geometria grafov ako čisté dáta: body, mriežky, tooltipy, súhrny.                                                    |
| `hero-model.js`  | Model hlavnej karty pre daný čas – rovnaký pre „teraz“ aj pre náhľad.                                                |
| `stats.js`       | Karta Štatistika: súčty výroby po obdobiach a ich hodnota podľa tarify, výroba rozdelená do pásiem.                  |
| `launches.js`    | „Pustil/a som“: zápisy spustení spotrebičov, čo práve beží a súčty za mesiac.                                        |
| `daylog.js`      | Denník výroby po dňoch pre súhrn: kontrola, zápis vyššieho súčtu, dni obdobia.                                       |
| `summary.js`     | Súhrn na zdieľanie: týždeň alebo mesiac v kWh, prepočtoch, najlepšom dni, hodnote a spusteniach.                     |
| `mozem.js`       | Karta Môžem?: či teraz pustiť spotrebič, a keď nie, kedy - z plánu dňa a predpovede na ďalšie dni.                   |
| `schema.js`      | Kontrola dát zo siete: `pv` z Workera a predpoveď pred zobrazením.                                                   |
| `format.js`      | Formátovanie času a čísel pre slovenské UI.                                                                          |
| `http.js`        | Retry Workera s časovým limitom; opakuje len prechodné chyby (sieť, 5xx), 4xx nie.                                   |
| `sky.js`         | Živá obloha novej appky: dve farby pozadia z času dňa, východu a západu slnka a oblačnosti.                          |
| `mozem-sky.js`   | Karta Môžem? novej appky: model z `mozem.js` poskladaný pre nový vzhľad (štítky, mobily, oblúk slnka, výzvy).        |

**`boot.js` – vstup stránky.** `index.html` spúšťa len jeho; on načíta `app.js` dynamickým
`import()` a keď sa graf modulov nezíde (stará verzia modulu z cache prehliadača po nasadení),
stiahne vlastné skripty znova mimo cache a raz obnoví stránku. Nič neimportuje staticky, aby sa
spustil vždy. Podrobnosti v CLAUDE.md, sekcia o nasadení a cache.

**`web/` – prehliadač.** `state.js` drží jediný stavový objekt; `setState` zlúči zmenu a
zavolá prekreslenie práve raz, rovnaká hodnota nespustí nič. `render/index.js` je jediné
miesto, ktoré kreslí, a kreslí len viditeľné karty. `interactions.js` obsahuje
poslucháče (karta Môžem? má vlastné `mozem-interactions.js`, sprievodca
`setup-interactions.js`, pásy, ktoré listuje prehliadač, spoločné `pager.js`) a každý končí volaním `setState` – jedinou výnimkou sú tooltipy, ktoré nie sú
súčasťou stavu a zapisujú sa priamo. `dom.js` drží všetky odkazy do DOM, takže render
funkcie nikdy nevolajú `querySelector` samy. `svg.js` skladá SVG z modelu a nič nepočíta.
`memo.js` drží tri pomôcky, vďaka ktorým render zapisuje do DOM len to, čo sa naozaj
zmenilo (viď „Nezapisuj, čo sa nezmenilo“ nižšie). `swipe.js` prekladá ťahanie prstom (to, či ťah vôbec bol listovaním, rozhodne `gesture.js`) na
susednú kartu – a v detaile dňa na susedný deň, lebo detail je podobrazovka karty a gesto ju
neopúšťa – rozhodne len, čo je na rade, a zmenu urobí `setState` ako pri kliku na
navigáciu. Čo si ťahanie nechá pre seba, nie je zoznam výnimiek, ale pravidlo: keď sa
najbližší vnútorný pás pod prstom ešte má kam posunúť tým smerom, patrí gesto jemu.
Menované sú len úchytky, ktoré sa ťahajú a neposúvajú: jazdec na dennom prstenci ciferníka,
kruh rozvrhu tarify v sprievodcovi a posúvač (`input[type=range]`, sklon strechy v sprievodcovi
nastavením).
`storage.js` ukladá nastavenie elektrárne do `localStorage` (`settings-store.js` ho znova vyváža a pridáva zrkadlenie do adresy). Kartu Nastavenie tvorí
prehľad uloženej elektrárne a sprievodca jej nastavením (`setup-interactions.js`,
`render/nastavenie.js`) a pod prehľadom sekcia Appka – zdieľanie (`render/zdielat.js`). Tá bola kedysi samostatnou
kartou Info; odtiaľ názvy `infoOpen`, `INFO_ITEMS` a id `info-share`, ktoré ostali, aby sa
nemenil stav ani HTML. Návod k ciferníku je popup karty Terazky (`dialGuideOpen`); je krok
navigácie, takže ho tlačidlo Späť najprv zatvorí, a pri odchode z karty sa zatvorí tiež. Sprievodca ukazuje vždy jednu obrazovku (`setupStep` a plocha
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
geometriu ako ciferník (`tariffRingModel`); `<svg>` kruhu ostáva v stránke a render píše len
do jeho `<g>`, aby zachytenie prsta (pointer capture) vydržalo celý ťah. Upravovaný rozvrh
a pásmo, ktorým sa maľuje (`setupSched`, `setupBrush`), sú nastavenie vnútri obrazovky, nie
krok navigácie. Presná cesta aj pre klávesnicu je zoznam úsekov s formulárom pod kruhom.
Hodiny, ciferník aj predpoveď idú podľa časového pásma lokality,
nie telefónu. Nastavenie sa dá zdieľať odkazom `…/#nastavenie=…` (`shareUrl` a
`settingsFromLink` v `shared/settings.js`): je zbalené za mriežkou, ktorú prehliadač
neposiela na server, a pri otvorení prejde tou istou kontrolou ako nastavenie z úložiska.
Appka ho len ponúkne prevziať (`incoming` v stave). Adresa v prehliadači potom nesie vždy
uložené nastavenie aj s kioskom (`initUrlMirror` v `web/settings-store.js`), bez zadaných panelov
je holá, a kým čaká ponuka, nesie odkaz. Dôvod je iPhone: appka pridaná na plochu má vlastné
úložisko, Safari s ňou nezdieľa nič okrem adresy. Pri prvom spustení z plochy tak ponúkne
nastavenie prevziať namiesto otázky na polohu. Z toho istého dôvodu manifest nemá `start_url` – bez
neho sa appka spúšťa z adresy, z ktorej ju človek pridal, aj s časťou za mriežkou.
`history.js` prekladá tlačidlo Späť na krok späť v appke: každý krok navigácie (karta,
detail dňa) pridá `pushState` položku do histórie prehliadača a `popstate` ju vráti tou
istou cestou ako klik – jediným `setState`. Adresa sa pritom nemení; položka histórie je
len značka s krokom navigácie, takže odkaz na appku ostáva jeden. Šípka späť v detaile dňa
a ťah doprava z neho sú ten istý krok ako tlačidlo Späť, preto volajú `history.back()`
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
(`hero.tier`: cena z tarify a výkon z krivky dňa), nie farbu stavovej bodky (`hero.accent`,
tá počíta so živým výkonom), takže hovorí to isté, čo segment pod bežcom na dennom
prstenci. Pri
náhľade iného času ide pozadie s bežcom, kým bodka ostáva o stave teraz – preto sa model
ráta dvakrát, ale len keď náhľad naozaj beží. Že sa farba nerozíde s modelom, strážia e2e
testy: pevné časy pokryjú zelenú, oranžovú aj červenú, tarifa s jednou cenou sivú, a ťuknutie na prstenec overí, že sa farba
mení aj s bežcom a po zrušení náhľadu sa vráti.

Medzi vstupmi stavu je aj `chartSizes` – skutočné rozmery plátien grafov v pixeloch.
Napĺňa ich `ResizeObserver` v `interactions.js` a render z nich cez `fillDims` postaví
plátno presne na kartu. Rozmer teda prichádza tou istou cestou ako každý iný vstup
(udalosť → `setState` → `render`), takže render funkcie nemusia nič merať a ostávajú
čisté.

**`worker/`** je tenký: over odkaz, stiahni kiosk, zavolaj `shared/`, vráť JSON.

## Dve appky: súčasná a „Živá obloha“

Nový dizajn (návrh `docs/navrhy/smer-b-obloha.html`) vzniká po krokoch vedľa súčasnej appky,
v priečinku `obloha/`, a beží na `…/ray-mon/obloha/`. Súčasná appka sa medzitým nemení. Na konci
sa nová presunie na hlavnú adresu.

`obloha/` má vlastnú stránku (`index.html`, `style.css`, `manifest.webmanifest`), vlastný
`boot.js` s tou istou ochranou pred zmiešanou cache ako koreňový a vlastný stav, render a
poslucháče v `obloha/web/`. Pravidlá sú tie isté: jeden stav, jedno prekreslenie, `.hidden`
s `!important`, žiadne `:hover`. Čo appky zdieľajú, nie je skopírované – nová appka importuje
ten istý súbor:

- **`shared/`** celé. Zmena výpočtu sa prejaví v oboch appkách naraz. Zoznam kariet `PANELS` je
  v `config.js`, kódové názvy sú v oboch rovnaké (karta Terazky sa v novej volá Teraz, kód
  ostáva `terazky`), takže uložená úvodná karta platí v oboch bez prevodu.
- **Worker** – ten istý endpoint, nová appka posiela kiosk rovnako (`web/data.js`).
- **Uložené nastavenie.** Obe appky sú na jednej doméne, a teda majú jeden `localStorage`
  (`elektraren-v1`, `poloha-v1`, `dni-v1`, `spustenia-v1`, `prva-karta-v1`). Číta a zapisuje ho
  ten istý kód v `web/storage.js`, takže formát sa nemôže rozísť.
- **Neutrálne moduly vo `web/`**, ktoré nevedia nič o stave ani DOM súčasnej appky: `store.js`
  (`createStore`), `storage.js`, `data.js`, `refresh.js` (obnova dát, meranie a denník výroby,
  hodiny), `gesture.js` (rozpoznanie ťahu do strán) a `nav-history.js` (kroky navigácie
  v histórii prehliadača). Vznikli vytiahnutím zo `state.js`, `settings-store.js`,
  `interactions.js`, `swipe.js` a `history.js`; tie ich používajú ďalej a správanie súčasnej
  appky sa nezmenilo. `state.js` a `settings-store.js` ich znova vyvážajú, aby sa nemuseli meniť
  ich odberatelia.

Nová appka nesmie importovať nič, čo siaha na DOM alebo stav súčasnej appky (`web/state.js`,
`web/dom.js`, `web/render/`, …). Keď niečo také potrebuje, čistá časť sa vytiahne do `shared/`
alebo do neutrálneho modulu ako vyššie.

Pozadie novej appky je obloha: `skyNow` v `shared/sky.js` z času, polohy a predpovede vráti dve
farby a render ich zapíše na `<html>` ako `--s1` a `--s2`. Tie sú v `style.css` zaregistrované
cez `@property` ako farby, takže sa dajú plynulo prelínať; útlm pohybu prechod vypne tým istým
pravidlom ako všetky animácie. Hodiny v tabuľke farieb (`SKY` v `config.js`) sú hodiny dňa
z návrhu, kde slnko vychádza o 7:00 a zapadá o 18:30 – skutočný východ a západ (`sunTimes`) sa do
nich premieta po úsekoch (noc, deň, večer). Počasie sú tri stavy z oblačnosti aktuálnej hodiny
predpovede; dážď zatiaľ nie, appka zrážky nesťahuje. Bez dát je obloha sivá, kým sa prvé dáta
sťahujú, ukazuje čas dňa bez počasia.

Karta Môžem? novej appky odpovedá tým istým `mozemModel` ako súčasná – slovo, veta, časy aj
odpovede vecí sú tie isté. `mozemSkyModel` v `shared/mozem-sky.js` ich len poskladá pre nový
vzhľad: štítky (ÁNO / POČKAJ / DNES NIE / NEVIEM a LACNÁ či DRAHÁ SIEŤ), fakt v mobiloch (naisto
len zo živého a čerstvého merania, inak s „asi“), nadpis zoznamu, oblúk slnka (`sunArc`: skutočný
východ a západ, zelený úsek je okno z pása dneška) a vetu, prečo dáta nie sú. Pri známej polohe
bez panelov odpovedá z typickej strechy (`mozemModel` s `guess`, predvolene vypnutým – súčasná
appka v tom stave ďalej ukazuje „Neviem.“) a priznáva odhad. Panel veci je `<dialog>` otvorený
cez `showModal()`; otvorenie je krok navigácie (`{ panel, item }` v histórii), takže ho zatvorí
aj Späť, a krížik či Escape idú cez `history.back()` ako šípka v detaile dňa súčasnej appky.
„Pustil/a som“ zapisuje cez `web/storage.js` do `spustenia-v1`, spustenie teda vidia obe appky.

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
  tak jeden zbytočný zápis zdražel každý ďalší pohyb prsta. `memo.js` si preto pamätá, čo sám
  naposledy zapísal, a denný prstenec aj chipy spotrebičov sa prekresľujú len
  pri zmene vlastných vstupov. Namerané: 1,675 → 0,675 ms na pohyb na mobilnej šírke,
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
Z plánu čítajú denný prstenec, pozadie stránky, texty aj spotrebiče, takže segment pod bežcom
a farba pozadia sú vždy to isté číslo. Plán berie krivku dňa, nie živý výkon – stavová bodka
počíta so živým výkonom a môže sa od neho na chvíľu líšiť.

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

Obsah karty skladá render celý do `#stats-body`, v `index.html` sú len nosiče. Obdobie (`statsPeriod`) je nastavenie
vnútri karty, nie krok navigácie. Výzvy „Doplň ceny“ a „Pripojiť živé meranie“ prepnú na kartu
Nastavenie a jedným `setState` rovno otvoria ten krok sprievodcu (`stepEdit`), takže tlačidlo
Späť vráti do Štatistiky.

## Karta Môžem?

Karta Terazky je písaná pre toho, kto sa vo fotovoltike vyzná. Ostatní v rodine chcú vedieť len
to, či môžu teraz pustiť práčku, a keď nie, kedy. Karta Môžem? im odpovie jedným slovom
(návrh C v `docs/navrhy/karta-mozem.html`; varianty so zoznamom a so stories sú tam ako
zamietnuté).

Počíta `shared/mozem.js` z plánu dňa (`dayPlan`), takže „áno“ je tá istá zelená ako na dennom
prstenci: výkon z krivky dňa od dolnej hranice výkonu. Stav karty je `go` (teraz je zelená),
`wait` (zelená príde ešte dnes), `none` (dnešná zelená už bola), `slabo` (dnes cez deň
nebude žiadna), `offline` (predpoveď nie je) a `loading`. Ďalšie dni berie z hodinovej
predpovede. Pre spotrebiče platia pravidlá z `DEVICES`: v slabý deň sa umývačka a sušička
neodporúčajú ako v `deviceStates`, auto potrebuje horný prah výkonu a lacné pásmo mu stačí, len
keď dnes slnko už nepríde - neskoršie slnko vyhrá nad lacnou sieťou. Typický program
spotrebiča (`MOZEM_ITEMS` v `config.js`) určuje, dokedy ho pustiť, aby dobehol na slnku,
a koľko stojí zo siete; bez ceny v tarife sa eurá nepíšu.

Veci s ikonami nie sú na hlavnej obrazovke karty, ale o ťuknutie ďalej (návrh A
v `docs/navrhy/mozem-co-mozem.html`). Karta ich zhrnie do riadku „Čo môžem“ (`glance`
v modeli): koľko ide hneď, bodka za každú vec a výnimky slovom. Zoznam vecí je druhá obrazovka
karty ako súhrn a krok navigácie (`mozemList`, `list` v `NavStep`) - Späť ho zavrie.

Texty vrátane hlášok sú v `messages.js`. Hláška sa mení s dňom a ťuknutím (`mozemQuip`),
rozbalená vec v zozname je `mozemOpen` - oboje je nastavenie vnútri karty, nie krok navigácie.
Obsah karty skladá render celý do `#mozem-body`, v `index.html` je len nosič.

„Pustil/a som“ zapisuje spustenia spotrebičov len v telefóne (`LAUNCH_STORAGE_KEY`, najviac
`LAUNCH.limit` zápisov): dátum a minúta lokality, vec a či vtedy svietilo slnko. Logika je
v `shared/launches.js`, model karty z nej dopočíta „beží do …“ a mesačný súčet. Je to na čestné
slovo - kiosk vidí len výrobu, nie spotrebu, takže spustenie overiť nevie. Zápisy sú základ
súhrnu na zdieľanie.

Súhrn na zdieľanie (`shared/summary.js`) je obrazovka karty Môžem? a krok navigácie
(`summary` v `NavStep`): Späť ho zavrie rovnako ako detail dňa. Mesačný súčet berie presne
z kiosku, týždeň a stĺpce dní z denníka (`shared/daylog.js`), ktorý si appka vedie sama - kiosk
dni neposiela. Denník sa dopĺňa pri každej obnove merania, vždy vyšším súčtom dňa, a až od 03:00
miestneho času (`DAYLOG.fromMin`): tesne po polnoci môže kiosk ešte hlásiť včerajšok. Deň, keď
appka nebola otvorená, chýba a súhrn to povie. Obrázok pre story kreslí `web/share-image.js`
na plátno z toho istého modelu a posiela ho `navigator.share`; kde zdieľanie súborov nie je,
obrázok sa stiahne. Nič z toho neodchádza na server.

Na ktorej karte sa appka otvára, je voľba telefónu (`startPanel`), nie elektrárne: deti chcú
Môžem?, ten, kto elektráreň platí, ciferník. Predvolená je Môžem? (`START_PANELS[0]`, jediné
miesto, odkiaľ to berie aj `initialState` a `shareHash`). Ukladá sa pod vlastným kľúčom
(`START_STORAGE_KEY`), nie v nastavení, a do odkazu ide ako `&prva=terazky` za mriežkou -
predvolená karta sa nepíše. Uložená voľba vždy vyhrá; bez nej platí karta z odkazu a hneď sa
uloží (`loadStartPanel`) - odkaz tak nastaví telefón, ktorý ešte nič nemá, a nikomu neprepíše
vlastnú voľbu. Staršie odkazy „pre rodinu“ s `&prva=mozem` (z čias, keď bola predvolená
Terazky a pri zdieľaní bolo na to zaškrtávatko) platia ďalej.
Adresa v prehliadači ju nesie tiež (`initUrlMirror`), z toho istého dôvodu ako nastavenie:
appka pridaná na plochu iPhonu si z Safari prenesie len adresu. Položku „Úvodná karta“ si robí render (`render/zdielat.js`), takže zmena nepotrebovala dve
nasadenia.

## Karta 7 dní na mobile

Na telefóne mala karta štyri grafy a tabuľku pod sebou – pätnásť obrazoviek scrollovania,
kým sa človek dostal k tomu, čo ho zaujímalo. Je preto rozdelená na dve obrazovky:

- **Prehľad dní** – rebríček: bublina so súčtom za týždeň (so stĺpčekmi dní v malom) a pod
  ňou sedem riadkov s pásikmi a legenda ich farieb. Zmestí sa celý na jednu obrazovku.
- **Detail dňa** – otvorí ho klik na riadok rebríčka: tri čísla dňa, stĺpce po hodinách,
  odporúčanie (správa o tom dni) a tlačidlá na susedné dni.
- **Detail týždňa** – otvorí ho klik na bublinu „Spolu za 7 dní“: denná výroba, heatmapa
  hodina × deň a správa „Najsilnejší deň“.

Správa je jeden prvok pre obe obrazovky: v detaile dňa v ňom stojí `dayDetailMessage`,
v detaile týždňa `weekMessage`. Text v detaile dňa deň naschvál nepomenúva – hovorí to
hlavička nad ním, a inak by sa „zajtra“ ukázalo aj pri štvrtku.

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

Stĺpce v detaile dňa (`dayBarsModel`) majú farbu plánu dňa – tú istú, akú by v ten deň
a hodinu mal denný prstenec ciferníka: pásmo tarify toho dňa (aj s výnimkami rozvrhu) a výkon
z predpovede (`dayHourTiers` v `shared/day-plan.js`). Pod osou je pás cien z tarify. Mierka
a produkčné okno sú tie isté ako pri krivke, takže tooltip nad grafom sedí na oba. Riadok
heatmapy pre jeden deň, ktorý tu bol predtým, zanikol: hovoril to isté, čo stĺpce. Na širokej
obrazovke detail dňa nie je a priebeh ostáva krivkou s oblačnosťou.

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
mriežka zanikla s ňou a Terazky idú cez celú šírku stránky. Stránka je tu položkou zvislého
flexu a vystredenie cez `margin: 0 auto` jej vypína naťahovanie na šírku rodiča, takže
potrebuje `width: 100%`: karta Terazky vlastnú šírku nemá (ciferník sa počíta z percent,
odporúčanie je `container-type: inline-size`, teda so size containmentom v osi x), takže bez
toho by sa stránka scvrkla na svoje okraje. Stráži to e2e test „karta Terazky má celú šírku
stránky“.

Meranie pred tou zmenou ukázalo, že problém bol užší, než sa zdalo: karty Terazky
a Zdieľať sa zmestili už predtým (na 1920 × 1080 im ostávalo 347 px prázdneho miesta,
lebo mali pevnú výšku), pretekala len karta 7 dní, a to o 97 až 409 px podľa výšky okna.

Na karte 7 dní dostala tabuľka vlastný stĺpec cez obe rady mriežky. Na sedem riadkov
potrebuje 315 px výšky a 385 px šírky – toľko jej celá výška mriežky dá aj na 768 px
vysokej obrazovke. Grafy sa stlačiť dajú, riadky tabuľky pod čitateľnosť nie, tak miesto
dostane to, čo ho naozaj potrebuje.

Čo v nízkom okne ustúpi: ciferník sa zmenší z 240 na 190 px (do 720 px výšky) a nad grafom
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
