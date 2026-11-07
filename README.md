# RAY-MON

Webová appka pre domácnosť s fotovoltikou. Na jednej obrazovke
odpovedá na otázku „môžem teraz zapnúť práčku?“ a k tomu ukazuje živý výkon panelov,
predpoveď výroby na dnes a zajtra a prehľad na sedem dní. Robená je pre telefón, na
tablete a desktope má vlastné rozloženie.

Appka je statická stránka bez build kroku. Beží na GitHub Pages, predpoveď si počíta sama
z Open-Meteo a živé meranie jej sprostredkuje Cloudflare Worker.

## Čo appka ukazuje

Spodná navigácia má pod každou ikonou meno karty (na desktope je meno vedľa ikony).

|                Teraz                 |               Dnes                |               7 dní               |                  Štatistika                  |                  Nastavenie                  |
| :----------------------------------: | :-------------------------------: | :-------------------------------: | :------------------------------------------: | :------------------------------------------: |
| ![Karta Teraz](docs/img/terazky.png) | ![Karta Dnes](docs/img/mozem.png) | ![Karta 7 dní](docs/img/7dni.png) | ![Karta Štatistika](docs/img/statistika.png) | ![Karta Nastavenie](docs/img/nastavenie.png) |

Snímky sú z testovacích dát a pevného času (13:00), nie zo živej elektrárne – čísla na nich
sú syntetické. Prekresliť ich vie `npm run screenshots`. Položky sekcie Appka
v karte Nastavenie ostávajú zavreté – QR kód v Zdieľať appku kreslí knižnica z CDN.

- **Teraz** – karta je v navigácii prvá a appka sa na nej vždy otvára. Veľké číslo s aktuálnym
  výkonom, pod ním tenký pásik s percentom (koľko z toho, čo by dala jasná obloha), odkiaľ je číslo,
  štítky (ÁNO, LACNÁ SIEŤ…) a veta o teraz. Ťuknutie na štítok otvorí panel: čo platí teraz a čo
  štítok znamená. Pod nimi **Plán dňa** – veta a časová os, čo kedy zapnúť (večer na ďalší deň).
  Pod plánom graf dňa: oblačnosť po hodinách, krivka predpovede a nameraná krivka, hranica veľkých
  spotrebičov a pás plánu. Ťahom prstom alebo kurzorom po grafe (aj šípkami) si pozrieš iný čas,
  „Späť na teraz“ ho vráti.
- **Dnes** (kedysi Môžem?) – oblúk slnka a jedno veľké slovo o celom dni podľa triedy dňa: ráno podľa
  predpovede, cez deň, keď sa deň oproti ránu zlepší či pokazí, a večer podľa nameraného. Trieda dňa
  je podľa toho, koľko spotrebičov sa za deň zmestí na slnko. Pod slovom, čo dá strecha za celý deň
  v jednotkách, ktoré pozná každý: nabité mobily, km elektrickým autom a CO2eq menej.
- **Radar** – dážď a oblaky nad mapou. Časová os ukazuje posledné 2 hodiny merania a odhad na ďalšie 2 hodiny,
  prepnúť sa dá na predpoveď na dnes a zajtra. Pauza, ťah prstom po osi a rýchlosť 1×/2×/3×. Oblaky sa dajú vypnúť.
  Dáta: radarová sieť EUMETNET OPERA a model ICON-EU cez Open-Meteo, mapa OpenFreeMap a MapLibre.
- **7 dní** – prehľad dní ako predpoveď počasia: nadpis s najlepším dňom, súčet týždňa a riadky
  s počasím, zeleným pásom okna na veľké spotrebiče a kWh. Klik otvorí detail dňa s grafom z karty
  Teraz alebo detail týždňa so stĺpcami a mapou výroby hodina × deň. Na širokej obrazovke sú karty
  Dnes, Teraz a 7 dní vedľa seba v stĺpcoch.
- **Štatistika** – plagát obdobia: dnes, tento mesiac, tento rok alebo od spustenia na streche
  (prepínač obdobia na plagáte). Veľké číslo kWh, pod ním obrázok obdobia – dnešok voči predpovedi,
  mesiac ako mriežka dní, rok ako stĺpce mesiacov, celý čas ako splatený uhlík z výroby panelov – a
  očíslované riadky v jednotkách, ktoré pozná každý: nabitia mobilu, kilometre autom s porovnaním
  trasy, koľko ešte do večera, najlepší deň, úspora CO2eq a hodnota podľa tarify, teda koľko by
  za tú elektrinu človek zaplatil zo siete. Dni si appka odkladá sama, deň, keď nebola otvorená,
  v mriežke chýba a plagát to povie. Dnešok sa
  oceňuje podľa pásiem z nameranej krivky, dlhšie obdobia (kiosk ich posiela len ako súčet)
  priemernou cenou podľa toho, do ktorých pásiem padá výroba z predpovede. Koľko elektriny
  domácnosť spotrebovala sama, appka nevie – kiosk hlási len výrobu – a karta to hovorí.
  Súčty posiela len živé meranie; bez neho karta ukáže sivý plagát dneška podľa predpovede a
  ponúkne meranie pripojiť, bez cien ukáže plagát bez hodnoty a ponúkne ceny doplniť. Obe výzvy otvoria
  rovno ten krok v Nastavení.
- **Nastavenie** – moja elektráreň. Pri prvom otvorení sa appka spýta len na polohu; panely
  môže človek nastaviť hneď, alebo ich odložiť – vtedy karta 7 dní ukazuje predpoveď pre
  typickú strechu v jeho polohe a karty Teraz a Dnes z nej odpovedajú, s jantárovým pásom,
  že je to odhad, a tlačidlom panely zadať.
  Karta ponúka **sprievodcu**: sedem krokov s jednou
  otázkou na obrazovku a ukazovateľom postupu. Poloha kdekoľvek na svete (vyhľadávanie
  alebo ručné súradnice, potvrdí ju dnešný východ a západ slnka), výkon panelu podľa štítku
  alebo len celkový výkon zo zmluvy, jedna až tri plochy panelov (smer na kompase s dráhou
  slnka, sklon podľa typu strechy, počet panelov ako mriežka), menič, nepovinne živé meranie
  (výber značky meniča a spôsobu pripojenia: kiosk alebo API účet od inštalatéra pri Huawei FusionSolar, kľúč Fox ESS či Solis, token SolaX či Victron, aplikácia Deye), tarifa a na koniec zhrnutie s výrobou za jasného
  dneška. Tarifa: jedna cena, dve pásma (VT/NT) alebo tri a viac; rozvrh dňa sa maľuje prstom
  po kruhu (alebo zadá po úsekoch), s výnimkou pre víkend či časť roka a nepovinne s cenami,
  podľa ktorých appka sama určí, ktoré pásmo je lacné a ktoré drahé. Na čo človek nevie odpoveď, preskočí tlačidlom „Neviem“. Po uložení je
  v karte rozbaľovacia položka **Elektráreň** s prehľadom: karta s menom, celkovým výkonom,
  zostavou a kompasom plôch a pod ňou riadky, z ktorých ťuknutie otvorí len jeho krok. Tlačidlo
  Späť na telefóne vracia v sprievodcovi o obrazovku a rozbalenú sekciu Nastavenia zbalí.
  Rozbalená je najviac jedna sekcia. Nastavenie sa ukladá len v prehliadači.
  Pod elektrárňou je sekcia **Appka** (kedysi samostatná karta Info). Appka sa otvára vždy
  na karte Teraz. **Zdieľať appku**: QR kód,
  odkaz na appku a tlačidlo na poslanie cez WhatsApp. K odkazu sa dá pribaliť vlastné
  nastavenie elektrárne, voliteľne aj so živým meraním. Kto taký odkaz otvorí (alebo ho
  prilepí do Nastavenia), dostane ponuku nastavenie prevziať; appka ho bez potvrdenia neuloží.
  Nastavenie nesie aj adresa v prehliadači, takže appka pridaná na plochu iPhonu (ktorá
  úložisko Safari nevidí) ho pri prvom spustení ponúkne prevziať tiež.

Karty sa prepínajú ťuknutím v spodnej navigácii; ťah prstom do strán ich neprelistuje. Ťahom sa
listujú dni v detaile dňa na karte 7 dní: obsah ide za prstom a vedľa neho už vidno susedný deň,
po pustení dobehne na nový deň (za tretinou šírky alebo pri rýchlom švihnutí), inak sa vráti. Na
Dnes a na poslednom dni sa pás len poddá. Nad detailom je riadok so šípkou späť do prehľadu a
čipmi dní – ťuknutie na čip, tlačidlá susedných dní dole aj šípky na klávesnici listujú tým istým
pohybom. Nadpis dňa nesie ikonu oblohy a pod ním slovo (jasno, polojasno, zamračené). Po prelistovaní čítačka ohlási deň a jeho poradie. Kto má v systéme zapnutý útlm
pohybu, dostane prelistovanie bez dojazdu. Nad grafom stĺpcov v detaile týždňa je pomalé ťahanie
prezeraním s tooltipom, rýchle švihnutie ho ani neukáže. Zvislý ťah je posúvanie stránky – aj keď
prst začne na grafe – a tooltip sa pri ňom neukáže tiež.

Systémové tlačidlo Späť na telefóne a tablete (a šípka v prehliadači) vracia o krok späť
v appke: najprv zavrie detail dňa, potom sa vracia po kartách v opačnom poradí, než si
nimi prešiel. Dopredu vedie tá istá cesta naspäť. Výber vnútri karty – vybraný deň
alebo stránka pásu odporúčaní – krok navigácie nie je, na ten sa Späť nevracia.
Keď sa kroky minú, ďalšie Späť z appky odíde; v nainštalovanej appke (PWA) to znamená jej
zatvorenie. Zatvorenie sa nikde nevynucuje dvojitým stlačením – to je zvyk natívnych
androidových appiek, nie webu, a stránka sa sama zavrieť ani nevie. Adresa sa pritom
nemení, takže odkaz na appku ostáva jeden.

## Živá obloha

Vzhľad appky je podľa návrhu [`docs/navrhy/smer-b-obloha.html`](docs/navrhy/smer-b-obloha.html):
pozadie je obloha podľa času dňa, skutočného východu a západu slnka v polohe elektrárne
a oblačnosti z predpovede.

Do novembra 2026 bola Živá obloha v priečinku `obloha/` a vedľa nej bežala pôvodná appka. Pôvodná
appka skončila, jej posledný stav má git tag `original-posledna`. V `obloha/` ostalo presmerovanie
pre staré odkazy a service worker pre odbery oznámení z tej doby.

## Ako to funguje

```
Open-Meteo (žiarenie) ──────────────────────────────→ appka počíta predpoveď
výrobca meniča (kiosk) ──→ Cloudflare Worker ─────→ appka (živé meranie)
```

Appka si pre lokalitu z karty Nastavenie stiahne z Open-Meteo hodinové žiarenie, teplotu
a oblačnosť a sama z nich dopočíta predpoveď výroby: polohu slnka, žiarenie na roviny
panelov, teplotný odber a limit meniča. Tá istá funkcia počíta aj strop pri úplne jasnej
oblohe, z ktorého vychádza údaj „využitie“. Počasie sa sťahuje najviac raz za hodinu.

Živé meranie je nepovinné. Kto si v Nastavení pripojí menič (vyberie značku a spôsob – odkaz na kiosk
Huawei FusionSolar, kľúč z Fox ESS, token zo SolaX alebo Victron), tomu appka stiahne meranie cez Worker
(každú minútu, pri značkách s prísnejšími limitmi či pomalším cloudom zriedkavejšie)
(prehliadač sa k výrobcovi priamo nedostane). Telefón drží prístup len zapečatený – otvoriť ho
vie iba Worker, a ten si ho neukladá. Bez merania appka ukazuje odhad z predpovede.

Keď nie je dostupné nič, appka ukáže „dáta nedostupné“ a nespadne.

## Štruktúra

| Priečinok                                      | Čo obsahuje                                                                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/`                                      | Doménová logika bez vstupov a výstupov: konštanty, fyzika slnka, parser kiosku, tarifa, texty, modely grafov. Beží v prehliadači, v Node aj vo Workeri. |
| `web/`                                         | Stav appky, načítanie dát, vykresľovanie po kartách, poslucháče udalostí, skladanie SVG.                                                                |
| `obloha/`                                      | Len prechod: presmerovanie starej adresy do koreňa a service worker starých odberov oznámení.                                                           |
| `worker/`                                      | Cloudflare Worker: jeden endpoint, ktorý stiahne kiosk FusionSolar.                                                                                     |
| `test/`                                        | Jednotkové testy, kontrakt dát a end-to-end testy v prehliadači.                                                                                        |
| `index.html`, `style.css`, `boot.js`, `app.js` | Samotná stránka. Žiadny bundler, žiadny framework.                                                                                                      |

Doménová logika je oddelená zámerne: to isté číslo sa nikdy nepočíta na dvoch miestach a
každá funkcia v `shared/` sa dá otestovať bez prehliadača.

## Vývoj

```bash
npm install
npm run serve     # http://127.0.0.1:8080
npm run check     # lint + formát + typy + testy
npm run test:e2e  # testy v prehliadači (Playwright)
```

Typy sa kontrolujú cez JSDoc a `tsc --checkJs`, takže v repozitári nie je ani jeden
TypeScript súbor a stránka sa nikam nekompiluje.

Testovacie dáta v `test/fixtures/` sú syntetické a deterministické, vygeneruje ich
`npm run fixtures`. Výstup predpovede je zamknutý súborom `test/golden/forecast.json`;
keď zmeníš výpočet zámerne, spusti `UPDATE_GOLDEN=1 npm test` a zmenu popíš v pull requeste.

## Nasadenie

Oboje je nasadené a beží.

- **Stránka**: GitHub Pages, _Deploy from a branch_, vetva `main`, priečinok `/ (root)`.
  Adresa: <https://rastislavsk.github.io/ray-mon/>
- **Stará adresa** `…/rackofci-energy-sro-fable/`: repozitár sa tak volal do premenovania
  na RAY-MON. GitHub Pages staré adresy neprevádza, preto na nej ostáva samostatný
  repozitár [`rackofci-energy-sro-fable`](https://github.com/rastislavsk/rackofci-energy-sro-fable)
  so stránkou, ktorá presmeruje na novú adresu aj s nastavením v odkaze. Drží pri živote
  uložené odkazy, QR kódy a ikony na ploche.
- **Worker** `ray-mon`: nasadzuje sa sám pri pushnutí do `main` cez
  Git integráciu Cloudflare. Postup a nastavenia buildu sú v
  [`worker/README.md`](worker/README.md).
