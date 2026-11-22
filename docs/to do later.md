# To do later

Jediné miesto pre otvorené a odložené témy. Keď sa niečo odloží, patrí sem. Keď sa to urobí,
riadok sa zmaže (história ostáva v gite). Dátum = kedy sa téma odložila.

## Pred vydaním do Google Play / App Store

Odložené 22. 10. 2026. Zdieľanie nastavenia elektrárne musí v appke z obchodu fungovať bezchybne.

- **Odkazy otvárajú appku** (App Links / Universal Links): overovacie súbory musia byť na koreni domény,
  na `rastislavsk.github.io/ray-mon/` to nejde → vlastná doména alebo repozitár `rastislavsk.github.io`.
  Bez toho sa odkaz s nastavením otvorí v prehliadači a nastavenie sa uloží tam, nie do appky.
- **Vlastná doména** (z auditu 12. 11. 2026, bod 5).
- **„Zdieľať appku“** má viesť na adresu, ktorá otvorí appku, inak stránku s odkazmi do obchodov.
- **Google Play TWA** potrebuje `assetlinks.json` na koreni domény (to isté obmedzenie).
- **Apple:** tenký web obal riskuje zamietnutie (4.2), dve appky ako spam (4.3) → jedna appka.
- **Zásady ochrany údajov** – v obchodoch povinné (audit 12. 11. 2026, bod 1).
- **Licencie dát** – overiť podmienky počasia (Open-Meteo, DWD ICON-EU), radaru (OPERA) a uvedenie
  zdroja pri komerčnej/obchodnej distribúcii. (Hviezdy: BSC5 cez NASA HEASARC, vyriešené.)
- **Pozadie pod stavovým riadkom na Androide** (29. 10. 2026): webová appka pod stavový riadok kresliť
  nesmie, PR #388 ho len zafarbí. V TWA overiť edge-to-edge. Kód je pripravený (`viewport-fit=cover`,
  odsadenie o `safe-area-inset-top`). Na iPhone už funguje.
- **Limit účtu Huawei:** appka a prehliadač vo WhatsAppe sa oň delia (iné úložisko); riešenie len cache
  vo Workeri, čo porušuje „Worker nič neukladá“.
- **Widget na plochu** (25. 10. 2026): zatiaľ nie, kvôli dvom verziám (web + natívny obal). PWA skutočný
  widget nemá. Možnosti: manifest `shortcuts` + odznak; Scriptable/KWGT nad `/widget` vo Workeri;
  TWA + Glance (Android); Capacitor/Swift + WidgetKit (iOS). Každá potrebuje `/widget` s výpočtom
  v `shared/`, nastavenie cez `#nastavenie=…` a narazí na limit Huawei.

## S termínom – vrátiť sa k tomu

Odložené 19. 11. 2026 pri návrhu učenia Plánu dňa z histórie (`docs/navrhy/plan-dna-zive-data.html`,
`docs/navrhy/plan-dna-ucenie.html`). Termín je odhad, kedy bude dosť dát. Na každý je nastavená pripomienka
(naplánovaná úloha v appke Claude).

- **7. 12. 2026 – Pokojný plán 5a?** Po ~2 týždňoch Plánu dňa zo živých dát na S22 overiť, či časy na
  dlaždiciach neskáču. Ak áno, doplniť pamäť naposledy ukázaného času (posun aspoň o 30 min alebo zmena
  slnko ↔ sieť). Ak nie, riadok zmazať.
- **11. 1. 2027 – Kontrola plánu (f):** porovnať plánovaný podiel slnka s tým, čo beh naozaj dostal (história behov
  - meranie), a podľa toho doladiť rezervu na mrak (`DEN_TRIEDA.reserve`, `PLAN_DNA.zoSiete`). Treba ~6 týždňov
    behov a opravenej predpovede.
- **1. 2. 2027 – Programy spotrebičov (d) a kedy spúšťaš (e):** z histórie behov a elektromera naučiť skutočnú
  dĺžku a odber programov (`runMin`, `runKwh`, ohrevy) a okná, keď domácnosť spotrebiče naozaj púšťa. Pozor:
  hodinové súhrny na odber programu nestačia, treba 5-minútové meranie okolo behov. Bod e mení radu, preto najprv
  mockup.
- **1. 3. 2027 – Model M2:** nad tými istými dátami (už 3+ mesiace a prechod zimy do jari) skúsiť malú lineárnu
  regresiu (hodina, výška slnka, oblačnosť, teplota, deň v týždni) a porovnať s tabuľkami M1 spätným testom.
  Nasadiť, len ak je zreteľne presnejšia.

## Funkcie na neskôr

- **Učenie aj bez Huawei Northbound** (19. 11. 2026): návrh `docs/navrhy/plan-dna-ucenie.html` počítal s tým, že pri
  kiosku FusionSolar sa appka naučí aspoň opravu predpovede z krivky dňa v telefóne. Zatiaľ sa učí len z histórie
  z Workera, ktorú má iba Northbound. Doplniť: telefón si k snímke predpovede pripíše výrobu po hodinách z krivky dňa.
- **Spoločné behy spotrebičov aj bez Huawei Northbound** (22. 11. 2026): „Už beží“ sa medzi telefónmi
  domácnosti zdieľa cez objekt účtu Huawei (`UcetHuawei`, možnosť A). Pri inom zdroji merania (kiosk FusionSolar,
  iné meniče) taký objekt nie je a každý telefón si behy drží sám. Doplniť, napr. samostatnú „domácnosť“
  s kódom na spárovanie (možnosť B: vlastný Durable Object, párovanie cez QR).
- **Ranné oznámenie nepozná učenie ani bojler** (19. 11. 2026): service worker nemá prístup k úložisku telefónu,
  plán v rannom oznámení ide bez naučenej predpovede a bez bojlera.

- **Menič a elektromer z rôznych chvíľ?** (19. 11. 2026): 18. 11. o 13:45 appka ukázala 2,7 kW a sieť 0, FusionSolar
  o 13:40 2,89 kW a dodávku 0,9 kW. Dočasné porovnanie do logu Workera (#505) bolo 22. 11. zmazané bez vyhodnotenia,
  možnosť 2a (scéna z histórie) ostáva nerozhodnutá. Ak sa rozdiel ukáže znova, porovnanie sa dá vrátiť z gitu.
- **Dážď a sneh v ikonách počasia** (18. 11. 2026): sada má len jasno / polojasno / zamračené.
  Predpoveď zrážky po hodinách už sťahuje. Treba nakresliť ikony a pravidlo, kedy je deň „daždivý“
  či „snežný“; naraz na karte 7 dní aj v páse dní na karte Teraz.
- **Mapa Radaru širšia** (7. 11. 2026): výrez blokov okolo polohy je dočasný, prerobiť na možnosť B
  alebo C z `docs/navrhy/radar.html`.
- **Satelit na Radare** (8. 11. 2026, nechané bez zmeny): EUMETView WMS `view.eumetsat.int/geoserver/wms`,
  bez poplatkov, CORS `*`, limit 20 dopytov v okne. MTG `mtg_fd:vis06_hrfi` (deň) a `mtg_fd:ir105_hrfi`
  (aj noc), raz za 10 min, oneskorenie ~20 min, výrez ~200 kB. Licenčné podmienky EUMETSAT neprečítané.
  Rozlíšenie dažďa sa dá zvýšiť z 2 km na 1 km (`zmensenie` v `RADAR`).
- **Graf dňa na Teraz pre ľudí, čo nečítajú grafy** (1. 11. 2026, bez výberu): `docs/navrhy/teraz-obraz-dna.html`
  (A stuha dňa, B plán na dráhe s kapsulami). Mockupy na vetve `claude/teraz-obraz-dna`.
- **Karta Dnes a ranné oznámenie nepoznajú núdzové časy** z karty Teraz – zladiť.
- **Mapa Radaru na širokej obrazovke prekrýva navigáciu** (zistené pri audite, neopravené).

## Overiť na telefóne alebo na skutočných dňoch

- Scéna toku energie (17.–18. 11.): dom na kopci, počasie za scénou, impulzy, svietiace okná.
- Bublina Dnes zo strechy (PR #495).
- Bojler na prebytky: zapnutie na slnku.
- Km autom v Štatistike (PR #469, #470).
- Karta Graf dňa – variant D (PR #458).
- Teraz ako týždeň; prah `TYZDEN.minPodiel` (25 %) na skutočných dňoch.
- Hlášky celého dňa: rezerva 2/3 (PR #374).
- Dážď v štyroch silách pri skutočnom daždi (PR #420).
- Východná obloha a skutočný Mesiac (PR #439).
- Ťuknutie na oznámenie pri zatvorenej appke (PR #440); Pripomeň.
- Appka pod CSP (Radar, oznámenia) a zdieľanie s meraním na druhom telefóne do 7 dní.
- Radar: prvé otvorenie bez cache na mobilných dátach, skutočný dážď a búrky, čas oblakov na S22.
